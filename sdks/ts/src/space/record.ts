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
  invalidResponse,
  isObjectRecord,
  PROTOCOL_VERSION,
  readResponse,
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
