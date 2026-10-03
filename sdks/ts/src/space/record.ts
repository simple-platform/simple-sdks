import type { ProtocolRequest, SpaceTransport } from './protocol.js'
import type {
  ManagedRecordFormModel,
  RecordFormCapabilities,
  RecordFormLifecycle,
  RecordFormModelTransport,
  UiRuntimeDescriptor,
} from './record-form.js'
import {
  deepFreeze,
  invalidRequest,
  invalidResponse,
  isNonBlankString,
  isObjectRecord,
  PROTOCOL_VERSION,
  readResponse,
  SpaceProtocolError,
} from './protocol.js'
import {
  initRecordFormLifecycle,
  isManagedRecordFormModel,
} from './record-form.js'

export interface RecordFieldSnapshot {
  error: null | string
  info: null | string
  readOnly: boolean
  required: boolean
  visible: boolean
}

export interface RecordFormError {
  code: string
  message: string
}

export interface RecordErrorSnapshot {
  fields: Readonly<Record<string, readonly string[]>>
  form: readonly RecordFormError[]
}

export interface RecordSnapshot {
  errors: RecordErrorSnapshot
  fields: Readonly<Record<string, RecordFieldSnapshot>>
  formInfo?: null | string
  revision: number
  values: Readonly<Record<string, unknown>>
}

export interface RecordUpdateResult {
  ok: boolean
  snapshot: RecordSnapshot
}

export interface RecordSubmitResult {
  ok: boolean
  snapshot: RecordSnapshot
}

export interface RecordHandle {
  readonly id: string
  snapshot: () => RecordSnapshot
  submit: () => Promise<RecordSubmitResult>
  update: (values: Readonly<Record<string, unknown>>) => Promise<RecordUpdateResult>
}

export const RECORDS_PROTOCOL_VERSION = 1 as const

export interface RecordReference {
  appId: string
  recordId: string
  tableName: string
}

export type OpenRecordOptions = RecordReference

export interface RecordOpenRequest extends ProtocolRequest<{
  appId: string
  recordId: string
  tableName: string
}> {
  operation: 'records.open'
}

export interface RecordOpenResult {
  form?: ManagedRecordFormModel
  sessionId: string
  snapshot: RecordSnapshot
}

export interface CurrentRecordRequest extends ProtocolRequest<Record<string, never>> {
  operation: 'record.current'
}

export interface CurrentRecordResult {
  form?: ManagedRecordFormModel
  sessionId: string
  snapshot: RecordSnapshot
}

export interface RecordUpdateRequest extends ProtocolRequest<{
  sessionId: string
  values: Readonly<Record<string, unknown>>
}> {
  operation: 'record.update'
}

export interface RecordSubmitRequest extends ProtocolRequest<{
  sessionId: string
  values?: Readonly<Record<string, unknown>>
}> {
  operation: 'record.submit'
}

export interface RecordFieldFocusRequest extends ProtocolRequest<{
  fieldName: string
  sessionId: string
}> {
  operation: 'record.focus' | 'record.blur'
}

export function isRecordFieldSnapshotMap(value: unknown): value is Readonly<Record<string, RecordFieldSnapshot>> {
  return isObjectRecord(value) && Object.values(value).every((field) => {
    if (!isObjectRecord(field))
      return false

    return (field.error === null || typeof field.error === 'string')
      && (field.info === null || typeof field.info === 'string')
      && typeof field.readOnly === 'boolean'
      && typeof field.required === 'boolean'
      && typeof field.visible === 'boolean'
  })
}

export function isRecordErrorSnapshot(value: unknown): value is RecordErrorSnapshot {
  if (!isObjectRecord(value) || !isObjectRecord(value.fields) || !Array.isArray(value.form))
    return false

  return Object.values(value.fields).every(errors => Array.isArray(errors) && errors.every(error => typeof error === 'string'))
    && value.form.every(error => isObjectRecord(error) && typeof error.code === 'string' && typeof error.message === 'string')
}

export function isRecordSnapshot(value: unknown): value is RecordSnapshot {
  if (!value || typeof value !== 'object')
    return false

  const snapshot = value as Partial<RecordSnapshot>
  return Number.isSafeInteger(snapshot.revision)
    && (snapshot.revision ?? -1) >= 0
    && isRecordErrorSnapshot(snapshot.errors)
    && isRecordFieldSnapshotMap(snapshot.fields)
    && (snapshot.formInfo === undefined || snapshot.formInfo === null || typeof snapshot.formInfo === 'string')
    && isObjectRecord(snapshot.values)
}

export function immutableSnapshot(snapshot: RecordSnapshot): RecordSnapshot {
  if (!isRecordSnapshot(snapshot))
    throw invalidResponse('The record snapshot is malformed.')

  return deepFreeze(structuredClone(snapshot))
}

export function isCurrentRecordResult(value: unknown): value is CurrentRecordResult {
  if (!value || typeof value !== 'object')
    return false

  const result = value as Partial<CurrentRecordResult>
  return typeof result.sessionId === 'string'
    && result.sessionId.length > 0
    && isRecordSnapshot(result.snapshot)
    && (result.form === undefined || isManagedRecordFormModel(result.form))
}

export function isRecordOpenResult(value: unknown): value is RecordOpenResult {
  if (!value || typeof value !== 'object')
    return false

  const result = value as Partial<RecordOpenResult>
  return typeof result.sessionId === 'string'
    && result.sessionId.length > 0
    && isRecordSnapshot(result.snapshot)
    && (result.form === undefined || isManagedRecordFormModel(result.form))
}

export function validateRecordReference(value: unknown): RecordReference {
  if (!isObjectRecord(value)) {
    throw invalidRequest('Record reference must be an object.')
  }
  const { appId, recordId, tableName } = value
  if (!isNonBlankString(appId)) {
    throw invalidRequest('Record appId must be a non-empty string.')
  }
  if (!isNonBlankString(tableName)) {
    throw invalidRequest('Record tableName must be a non-empty string.')
  }
  if (!isNonBlankString(recordId)) {
    throw invalidRequest('Record recordId must be a non-empty string.')
  }
  if (appId.trim() !== appId) {
    throw invalidRequest('Record appId must not contain leading or trailing whitespace.')
  }
  if (tableName.trim() !== tableName) {
    throw invalidRequest('Record tableName must not contain leading or trailing whitespace.')
  }
  if (recordId.trim() !== recordId) {
    throw invalidRequest('Record recordId must not contain leading or trailing whitespace.')
  }
  return { appId, recordId, tableName }
}

export function isRecordUpdateResult(value: unknown): value is RecordUpdateResult {
  if (!value || typeof value !== 'object')
    return false

  const result = value as Partial<RecordUpdateResult>
  return typeof result.ok === 'boolean' && isRecordSnapshot(result.snapshot)
}

export function isRecordSubmitResult(value: unknown): value is RecordSubmitResult {
  if (!value || typeof value !== 'object')
    return false

  const result = value as Partial<RecordSubmitResult>
  return typeof result.ok === 'boolean' && isRecordSnapshot(result.snapshot)
}

export class ProtocolRecordHandle implements RecordHandle {
  readonly id: string
  readonly #nextRequestId: () => string
  readonly #transport: SpaceTransport
  readonly #formLifecycle?: RecordFormLifecycle
  #snapshot: RecordSnapshot

  constructor(
    { form, sessionId, snapshot }: CurrentRecordResult,
    nextRequestId: () => string,
    transport: SpaceTransport,
    runtime: UiRuntimeDescriptor | undefined,
    graphql: (document: string, variables?: Readonly<Record<string, unknown>>) => Promise<unknown>,
    capabilities: RecordFormCapabilities | undefined,
    formModelTransport: RecordFormModelTransport | undefined,
  ) {
    this.id = sessionId
    this.#nextRequestId = nextRequestId
    this.#snapshot = immutableSnapshot(snapshot)
    this.#transport = transport
    this.#formLifecycle = initRecordFormLifecycle(this, {
      capabilities,
      form,
      formModelTransport,
      graphql,
      runtime,
      setActiveField: (operation, fieldName) => this.setActiveField(operation, fieldName),
    })
  }

  private async setActiveField(operation: 'record.blur' | 'record.focus', fieldName: string): Promise<void> {
    const request: RecordFieldFocusRequest = {
      operation,
      payload: { fieldName, sessionId: this.id },
      protocol: PROTOCOL_VERSION,
      requestId: this.#nextRequestId(),
    }
    const response = await this.#transport.request<Record<string, never>>(request)
    readResponse(response, request)
  }

  private setSnapshot(snapshot: RecordSnapshot): void {
    this.#snapshot = snapshot
    this.#formLifecycle?.notifySnapshot(snapshot)
  }

  snapshot(): RecordSnapshot {
    return this.#snapshot
  }

  async update(values: Readonly<Record<string, unknown>>): Promise<RecordUpdateResult> {
    const request: RecordUpdateRequest = {
      operation: 'record.update',
      payload: {
        sessionId: this.id,
        values,
      },
      protocol: PROTOCOL_VERSION,
      requestId: this.#nextRequestId(),
    }
    const response = await this.#transport.request<RecordUpdateResult>(request)
    const result = readResponse(response, request)

    if (!isRecordUpdateResult(result))
      throw invalidResponse('The record-update response is malformed.')

    const snapshot = immutableSnapshot(result.snapshot)
    this.setSnapshot(snapshot)
    return { ok: result.ok, snapshot }
  }

  async submit(): Promise<RecordSubmitResult> {
    const values = await this.#formLifecycle?.prepareSubmit() ?? {}

    const request: RecordSubmitRequest = {
      operation: 'record.submit',
      payload: {
        sessionId: this.id,
        ...(Object.keys(values).length > 0 ? { values } : {}),
      },
      protocol: PROTOCOL_VERSION,
      requestId: this.#nextRequestId(),
    }
    const response = await this.#transport.request<RecordSubmitResult>(request)
    const result = readResponse(response, request)

    if (!isRecordSubmitResult(result))
      throw invalidResponse('The record-submit response is malformed.')

    const snapshot = immutableSnapshot(result.snapshot)
    this.setSnapshot(snapshot)
    return { ok: result.ok, snapshot }
  }
}

export interface SimpleRecordsClient {
  /**
   * Returns the route-owned record provided by the current Record Space.
   */
  current: () => Promise<RecordHandle>
  /**
   * Returns an independently managed record session for the target reference.
   * The host retains it for the Space connection and disposes it at teardown.
   */
  open: (reference: RecordReference) => Promise<RecordHandle>
}

export interface CreateRecordsClientOptions {
  capabilities?: RecordFormCapabilities
  currentRecord: () => Promise<RecordHandle>
  graphql: (document: string, variables?: Readonly<Record<string, unknown>>) => Promise<unknown>
  nextRequestId: () => string
  recordsTransport?: SpaceTransport
  runtime?: UiRuntimeDescriptor
}

export function createRecordsClient({
  capabilities,
  currentRecord,
  graphql,
  nextRequestId,
  recordsTransport,
  runtime,
}: CreateRecordsClientOptions): SimpleRecordsClient {
  const sessions = new Map<string, Promise<RecordHandle>>()

  const openSession = async (validated: RecordReference, transport: SpaceTransport): Promise<RecordHandle> => {
    const request: RecordOpenRequest = {
      operation: 'records.open',
      payload: {
        appId: validated.appId,
        recordId: validated.recordId,
        tableName: validated.tableName,
      },
      protocol: PROTOCOL_VERSION,
      requestId: nextRequestId(),
    }

    const response = await transport.request<RecordOpenResult>(request)
    const result = readResponse(response, request)

    if (!isRecordOpenResult(result)) {
      throw invalidResponse('The record-open response is malformed.')
    }

    return new ProtocolRecordHandle(
      result,
      nextRequestId,
      transport,
      runtime,
      graphql,
      capabilities,
      undefined,
    )
  }

  const open = (reference: RecordReference): Promise<RecordHandle> => {
    if (!recordsTransport) {
      return Promise.reject(new SpaceProtocolError({
        code: 'unavailable',
        message: 'The records protocol is unavailable for this Space.',
      }))
    }

    const transport = recordsTransport

    let validated: RecordReference
    try {
      validated = validateRecordReference(reference)
    }
    catch (error) {
      return Promise.reject(error)
    }

    const key = JSON.stringify([validated.appId, validated.tableName, validated.recordId])

    const existing = sessions.get(key)
    if (existing)
      return existing

    const pending = openSession(validated, transport)
    sessions.set(key, pending)
    pending.catch(() => {
      if (sessions.get(key) === pending)
        sessions.delete(key)
    })
    return pending
  }

  return {
    current: currentRecord,
    open,
  }
}
