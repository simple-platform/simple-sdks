export const PROTOCOL_VERSION = 1 as const

export type SpaceContext
  = | {
    applicationId: string
    kind: 'record'
    recordId: string
    tableName: string
  }
  | {
    kind: 'standalone'
  }

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
  revision: number
  values: Readonly<Record<string, unknown>>
}

export type GraphQLVariables = Readonly<Record<string, unknown>>

export interface SpaceDataTransport {
  execute: <TResult = unknown>(document: string, variables?: GraphQLVariables) => Promise<TResult>
}

export interface SimpleDataClient {
  mutate: <TResult = unknown>(document: string, variables?: GraphQLVariables) => Promise<TResult>
  query: <TResult = unknown>(document: string, variables?: GraphQLVariables) => Promise<TResult>
}

export interface RecordHandle {
  readonly id: string
  snapshot: () => RecordSnapshot
  submit: () => Promise<RecordSubmitResult>
  update: (values: Readonly<Record<string, unknown>>) => Promise<RecordUpdateResult>
}

export interface SimpleClient {
  context: SpaceContext
  data: SimpleDataClient
  records: {
    current: () => Promise<RecordHandle>
  }
}

export interface SpaceProtocolErrorPayload {
  code: string
  details?: unknown
  message: string
}

export class SpaceProtocolError extends Error {
  readonly code: string
  readonly details?: unknown

  constructor({ code, details, message }: SpaceProtocolErrorPayload) {
    super(message)
    this.name = 'SpaceProtocolError'
    this.code = code
    this.details = details
  }
}

export interface SpaceDataErrorPayload {
  code: string
  details?: unknown
  message: string
}

export class SpaceDataError extends Error {
  readonly code: string
  readonly details?: unknown

  constructor({ code, details, message }: SpaceDataErrorPayload) {
    super(message)
    this.name = 'SpaceDataError'
    this.code = code
    this.details = details
  }
}

export interface CurrentRecordRequest {
  operation: 'record.current'
  payload: Record<string, never>
  protocol: typeof PROTOCOL_VERSION
  requestId: string
}

export interface CurrentRecordResult {
  sessionId: string
  snapshot: RecordSnapshot
}

export interface RecordUpdateRequest {
  operation: 'record.update'
  payload: {
    sessionId: string
    values: Readonly<Record<string, unknown>>
  }
  protocol: typeof PROTOCOL_VERSION
  requestId: string
}

export interface RecordUpdateResult {
  ok: boolean
  snapshot: RecordSnapshot
}

export interface RecordSubmitRequest {
  operation: 'record.submit'
  payload: {
    sessionId: string
  }
  protocol: typeof PROTOCOL_VERSION
  requestId: string
}

export interface RecordSubmitResult {
  ok: boolean
  snapshot: RecordSnapshot
}

export type ProtocolRequest = CurrentRecordRequest | RecordSubmitRequest | RecordUpdateRequest

export interface ProtocolSuccessResponse<TResult> {
  ok: true
  protocol: typeof PROTOCOL_VERSION
  requestId: string
  result: TResult
}

export interface ProtocolErrorResponse {
  error: SpaceProtocolErrorPayload
  ok: false
  protocol: typeof PROTOCOL_VERSION
  requestId: string
}

export type ProtocolResponse<TResult>
  = | ProtocolErrorResponse
    | ProtocolSuccessResponse<TResult>

export interface SpaceTransport {
  request: <TResult>(request: ProtocolRequest) => Promise<ProtocolResponse<TResult>>
}

export interface SimpleClientOptions {
  context?: SpaceContext
  dataTransport?: SpaceDataTransport
  nextRequestId?: () => string
  transport?: SpaceTransport
}

/**
 * Creates a framework-neutral Space client around a protocol transport.
 *
 * MessagePort setup is intentionally outside this factory so the same public
 * contract can be exercised in a first-party direct adapter and in any UI
 * framework without importing browser-specific code.
 */
export function createSimpleClient({
  context = { kind: 'standalone' },
  dataTransport,
  nextRequestId = createRequestId,
  transport,
}: SimpleClientOptions): SimpleClient {
  const immutableContext = immutableSpaceContext(context)

  return {
    context: immutableContext,
    data: {
      mutate: (document, variables) => executeData(dataTransport, document, variables),
      query: (document, variables) => executeData(dataTransport, document, variables),
    },
    records: {
      async current() {
        if (immutableContext.kind !== 'record') {
          throw new SpaceProtocolError({
            code: 'unavailable',
            message: 'The current record is available only when this Space is configured as a record view.',
          })
        }

        if (!transport) {
          throw new SpaceProtocolError({
            code: 'unavailable',
            message: 'The record protocol is unavailable for this record Space.',
          })
        }

        const request: CurrentRecordRequest = {
          operation: 'record.current',
          payload: {},
          protocol: PROTOCOL_VERSION,
          requestId: nextRequestId(),
        }
        const response = await transport.request<CurrentRecordResult>(request)
        const result = readResponse(response, request)

        if (!isCurrentRecordResult(result)) {
          throw invalidResponse('The primary-record response is malformed.')
        }

        return new ProtocolRecordHandle(result, nextRequestId, transport)
      },
    },
  }
}

export function isSpaceContext(value: unknown): value is SpaceContext {
  if (!value || typeof value !== 'object') {
    return false
  }

  const context = value as Partial<SpaceContext>
  if (context.kind === 'standalone') {
    return true
  }

  return context.kind === 'record'
    && typeof context.applicationId === 'string'
    && context.applicationId.length > 0
    && typeof context.tableName === 'string'
    && context.tableName.length > 0
    && typeof context.recordId === 'string'
    && context.recordId.length > 0
}

function executeData<TResult>(
  dataTransport: SpaceDataTransport | undefined,
  document: string,
  variables: GraphQLVariables | undefined,
): Promise<TResult> {
  if (!dataTransport) {
    return Promise.reject(new SpaceDataError({
      code: 'unavailable',
      message: 'The Space data transport is unavailable.',
    }))
  }

  return dataTransport.execute<TResult>(document, variables)
}

class ProtocolRecordHandle implements RecordHandle {
  readonly id: string
  readonly #nextRequestId: () => string
  readonly #transport: SpaceTransport
  #snapshot: RecordSnapshot

  constructor(
    { sessionId, snapshot }: CurrentRecordResult,
    nextRequestId: () => string,
    transport: SpaceTransport,
  ) {
    this.id = sessionId
    this.#nextRequestId = nextRequestId
    this.#snapshot = immutableSnapshot(snapshot)
    this.#transport = transport
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
    this.#snapshot = snapshot
    return { ok: result.ok, snapshot }
  }

  async submit(): Promise<RecordSubmitResult> {
    const request: RecordSubmitRequest = {
      operation: 'record.submit',
      payload: { sessionId: this.id },
      protocol: PROTOCOL_VERSION,
      requestId: this.#nextRequestId(),
    }
    const response = await this.#transport.request<RecordSubmitResult>(request)
    const result = readResponse(response, request)

    if (!isRecordSubmitResult(result))
      throw invalidResponse('The record-submit response is malformed.')

    const snapshot = immutableSnapshot(result.snapshot)
    this.#snapshot = snapshot
    return { ok: result.ok, snapshot }
  }
}

function createRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID()

  return `space-request-${Math.random().toString(36).slice(2)}`
}

function immutableSnapshot(snapshot: RecordSnapshot): RecordSnapshot {
  if (!isRecordSnapshot(snapshot))
    throw invalidResponse('The record snapshot is malformed.')

  return deepFreeze(structuredClone(snapshot))
}

function immutableSpaceContext(context: SpaceContext): SpaceContext {
  return deepFreeze(structuredClone(context))
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value))
    return value

  for (const child of Object.values(value))
    deepFreeze(child)

  return Object.freeze(value)
}

function invalidResponse(message: string): SpaceProtocolError {
  return new SpaceProtocolError({ code: 'invalid_response', message })
}

function isCurrentRecordResult(value: unknown): value is CurrentRecordResult {
  if (!value || typeof value !== 'object')
    return false

  const result = value as Partial<CurrentRecordResult>
  return typeof result.sessionId === 'string' && result.sessionId.length > 0 && isRecordSnapshot(result.snapshot)
}

function isRecordSnapshot(value: unknown): value is RecordSnapshot {
  if (!value || typeof value !== 'object')
    return false

  const snapshot = value as Partial<RecordSnapshot>
  return Number.isSafeInteger(snapshot.revision)
    && (snapshot.revision ?? -1) >= 0
    && isRecordErrorSnapshot(snapshot.errors)
    && isRecordFieldSnapshotMap(snapshot.fields)
    && isObjectRecord(snapshot.values)
}

function isRecordUpdateResult(value: unknown): value is RecordUpdateResult {
  if (!value || typeof value !== 'object')
    return false

  const result = value as Partial<RecordUpdateResult>
  return typeof result.ok === 'boolean' && isRecordSnapshot(result.snapshot)
}

function isRecordSubmitResult(value: unknown): value is RecordSubmitResult {
  if (!value || typeof value !== 'object')
    return false

  const result = value as Partial<RecordSubmitResult>
  return typeof result.ok === 'boolean' && isRecordSnapshot(result.snapshot)
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isRecordErrorSnapshot(value: unknown): value is RecordErrorSnapshot {
  if (!isObjectRecord(value) || !isObjectRecord(value.fields) || !Array.isArray(value.form))
    return false

  return Object.values(value.fields).every(errors => Array.isArray(errors) && errors.every(error => typeof error === 'string'))
    && value.form.every(error => isObjectRecord(error) && typeof error.code === 'string' && typeof error.message === 'string')
}

function isRecordFieldSnapshotMap(value: unknown): value is Readonly<Record<string, RecordFieldSnapshot>> {
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

function readResponse<TResult>(
  response: ProtocolResponse<TResult>,
  request: ProtocolRequest,
): TResult {
  if (response.protocol !== PROTOCOL_VERSION || response.requestId !== request.requestId) {
    throw invalidResponse('The response does not match the request envelope.')
  }

  if (!response.ok)
    throw new SpaceProtocolError(response.error)

  return response.result
}
