import type { DocumentHandle } from '../types.js'

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

/** A value that survives a JSON round trip unchanged. */
export type JsonValue
  = | boolean
    | JsonObject
    | null
    | number
    | string
    | readonly JsonValue[]

/** A JSON object: not `null`, not an array, and not a single value. */
export interface JsonObject {
  readonly [key: string]: JsonValue
}

/** The platform-standard status of a task. */
export type TaskStatus = 'cancelled' | 'completed' | 'failed' | 'in_progress' | 'queued' | 'waiting'

export interface TaskCreateInput {
  /** The user the task is assigned to. Omit it to assign the task to its creator. */
  assignedToId?: string
  /**
   * The typed input the task type declares for its tasks. It is always a JSON
   * object, even when the task type needs nothing: then it is `{}`.
   */
  input: JsonObject
  /** The ID of the task type the task is created from. */
  taskTypeId: string
  title: string
}

export interface TaskCreateResult {
  task: {
    id: string
    revision: number
    status: TaskStatus
  }
}

export interface TaskReplyInput {
  content: string
  /** The message this reply answers, when it answers one. */
  inReplyToMessageId?: string
  taskId: string
}

export interface TaskReplyResult {
  messageId: string
  /** The task's revision after the reply was recorded. */
  taskRevision: number
}

export interface SimpleTasksClient {
  create: (task: TaskCreateInput) => Promise<TaskCreateResult>
  reply: (reply: TaskReplyInput) => Promise<TaskReplyResult>
}

/** A stored file that is not yet attached to any record. */
export interface StagedDocumentHandle extends DocumentHandle {
  scope?: 'ephemeral' | 'record' | 'staged'
}

export interface DocumentStageInput {
  /** The file to stage. Its bytes are transferred to the host, not copied. */
  file: Blob | File
  /** Defaults to the file's own type, then to `application/octet-stream`. */
  mimeType?: string
  /** Defaults to the name of a `File`. A plain `Blob` has none, so it needs one. */
  name?: string
}

export interface DocumentStageResult {
  handle: StagedDocumentHandle
}

export interface SimpleDocumentsClient {
  stage: (document: DocumentStageInput) => Promise<DocumentStageResult>
}

export interface ActionRunOptions {
  /**
   * How long the host waits for the action before it stops and answers
   * `timeout`, in milliseconds. The host uses 60,000 when it is left out and
   * accepts 1,000 to 1,200,000.
   */
  timeoutMs?: number
}

/** The `details` of a `SpaceProtocolError` whose code is `action_failed`. */
export interface ActionFailedDetails {
  /** The action's response body as parsed JSON, or `null` when it was not JSON. */
  body: JsonValue
  /**
   * The HTTP status the server answered with. An action the host ran in the
   * browser (declared `client` or `both`) carries 200, the status the server
   * gives the same failure, and its `body` has the same `{ error: [...] }` shape.
   */
  status: number
}

export interface SimpleActionsClient {
  /**
   * Runs an action of this Space's own app where the app declares it runs
   * (on the server, or in the browser for a `client` or `both` action), as
   * the signed-in user, and returns its JSON result as the action returned it. The host
   * adds the app, so `action` is the name alone, such as `document-attach`.
   */
  run: <TResult = unknown>(action: string, input: unknown, options?: ActionRunOptions) => Promise<TResult>
}

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
  actions: SimpleActionsClient
  context: SpaceContext
  data: SimpleDataClient
  documents: SimpleDocumentsClient
  records: {
    current: () => Promise<RecordHandle>
  }
  tasks: SimpleTasksClient
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

export interface TaskCreateRequest {
  operation: 'task.create'
  payload: TaskCreateInput
  protocol: typeof PROTOCOL_VERSION
  requestId: string
}

export interface TaskReplyRequest {
  operation: 'task.reply'
  payload: TaskReplyInput
  protocol: typeof PROTOCOL_VERSION
  requestId: string
}

export interface ActionRunRequest {
  operation: 'action.run'
  payload: {
    /** The action's name within the Space's own app; the host adds the app. */
    action: string
    input: JsonValue
    timeoutMs?: number
  }
  protocol: typeof PROTOCOL_VERSION
  requestId: string
}

export interface DocumentStageRequest {
  operation: 'document.stage'
  payload: {
    /** Transferred with the request, so it is detached in the Space afterwards. */
    bytes: ArrayBuffer
    mimeType: string
    name: string
  }
  protocol: typeof PROTOCOL_VERSION
  requestId: string
}

export type ProtocolRequest
  = | ActionRunRequest
    | CurrentRecordRequest
    | DocumentStageRequest
    | RecordSubmitRequest
    | RecordUpdateRequest
    | TaskCreateRequest
    | TaskReplyRequest

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
  /**
   * `transfer` names buffers inside the request whose ownership moves to the
   * host with it instead of being copied. A transport that cannot transfer
   * sends them by value. When `signal` aborts, the transport forgets the
   * request, so a late answer is dropped, and rejects with the signal's reason.
   */
  request: <TResult>(request: ProtocolRequest, transfer?: ArrayBuffer[], signal?: AbortSignal) => Promise<ProtocolResponse<TResult>>
}

export interface SimpleClientOptions {
  /** Present only when the host negotiated the action protocol. */
  actionTransport?: SpaceTransport
  context?: SpaceContext
  dataTransport?: SpaceDataTransport
  /** Present only when the host negotiated the document protocol. */
  documentTransport?: SpaceTransport
  nextRequestId?: () => string
  /** Present only when the host negotiated the task protocol. */
  taskTransport?: SpaceTransport
  /** Present only when the host negotiated the record protocol. */
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
  actionTransport,
  context = { kind: 'standalone' },
  dataTransport,
  documentTransport,
  nextRequestId = createRequestId,
  taskTransport,
  transport,
}: SimpleClientOptions): SimpleClient {
  const immutableContext = immutableSpaceContext(context)

  return {
    actions: createActionsClient(actionTransport, nextRequestId),
    context: immutableContext,
    data: {
      mutate: (document, variables) => executeData(dataTransport, document, variables),
      query: (document, variables) => executeData(dataTransport, document, variables),
    },
    documents: createDocumentsClient(documentTransport, nextRequestId),
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
    tasks: createTasksClient(taskTransport, nextRequestId),
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

/**
 * The host binds the Space's own app to every action it runs, so a Space names
 * only the action and cannot reach another app's. Actions are not tied to a
 * page record, so they are available in any Space whose host negotiated the
 * action protocol, standalone or record.
 */
function createActionsClient(
  transport: SpaceTransport | undefined,
  nextRequestId: () => string,
): SimpleActionsClient {
  return {
    async run<TResult = unknown>(action: string, input: unknown, options?: ActionRunOptions): Promise<TResult> {
      if (!transport) {
        throw new SpaceProtocolError({
          code: 'unavailable',
          message: 'Actions are unavailable because the Space host did not negotiate the action protocol.',
        })
      }

      const payload = readActionRunPayload(action, input, options)
      const request: ActionRunRequest = {
        operation: 'action.run',
        payload,
        protocol: PROTOCOL_VERSION,
        requestId: nextRequestId(),
      }
      const response = await requestWithin<TResult>(transport, request, actionWaitMs(payload.timeoutMs))
      // Any JSON value is a valid result, so it is returned as the host sent it.
      return readResponse(response, request)
    },
  }
}

/**
 * A staged document is stored without being attached to a record, so staging
 * is available in any Space whose host negotiated the document protocol.
 */
function createDocumentsClient(
  transport: SpaceTransport | undefined,
  nextRequestId: () => string,
): SimpleDocumentsClient {
  return {
    async stage(document) {
      if (!transport) {
        throw new SpaceProtocolError({
          code: 'unavailable',
          message: 'Documents are unavailable because the Space host did not negotiate the document protocol.',
        })
      }

      const { file, mimeType, name } = readDocumentStageInput(document)
      // A Blob cannot itself be transferred. Its bytes are read into a buffer
      // once, and that buffer is handed to the host rather than copied again.
      const bytes = await file.arrayBuffer()
      const request: DocumentStageRequest = {
        operation: 'document.stage',
        payload: { bytes, mimeType, name },
        protocol: PROTOCOL_VERSION,
        requestId: nextRequestId(),
      }
      const response = await transport.request<DocumentStageResult>(request, [bytes])
      const result = readResponse(response, request)

      if (!isDocumentStageResult(result))
        throw invalidResponse('The document-stage response is malformed.')

      return { handle: { ...result.handle } }
    },
  }
}

/**
 * Tasks are not tied to a page record, so they are available in any Space
 * whose host negotiated the task protocol, standalone or record.
 */
function createTasksClient(
  transport: SpaceTransport | undefined,
  nextRequestId: () => string,
): SimpleTasksClient {
  const requireTransport = (): SpaceTransport => {
    if (!transport) {
      throw new SpaceProtocolError({
        code: 'unavailable',
        message: 'Tasks are unavailable because the Space host did not negotiate the task protocol.',
      })
    }

    return transport
  }

  return {
    async create(task) {
      const taskTransport = requireTransport()
      const request: TaskCreateRequest = {
        operation: 'task.create',
        payload: readTaskCreatePayload(task),
        protocol: PROTOCOL_VERSION,
        requestId: nextRequestId(),
      }
      const response = await taskTransport.request<TaskCreateResult>(request)
      const result = readResponse(response, request)

      if (!isTaskCreateResult(result))
        throw invalidResponse('The task-create response is malformed.')

      const { id, revision, status } = result.task
      return { task: { id, revision, status } }
    },

    async reply(reply) {
      const taskTransport = requireTransport()
      const request: TaskReplyRequest = {
        operation: 'task.reply',
        payload: readTaskReplyPayload(reply),
        protocol: PROTOCOL_VERSION,
        requestId: nextRequestId(),
      }
      const response = await taskTransport.request<TaskReplyResult>(request)
      const result = readResponse(response, request)

      if (!isTaskReplyResult(result))
        throw invalidResponse('The task-reply response is malformed.')

      return { messageId: result.messageId, taskRevision: result.taskRevision }
    },
  }
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

function invalidRequest(message: string): SpaceProtocolError {
  return new SpaceProtocolError({ code: 'invalid_request', message })
}

/**
 * Checks a task before it is sent, so a plain-JavaScript caller learns what is
 * wrong without a host round trip. The payload names only the members the
 * operation defines; an optional member left out is not sent at all.
 */
function readTaskCreatePayload(task: TaskCreateInput): TaskCreateInput {
  if (!isObjectRecord(task))
    throw invalidRequest('A task needs a title, a task type, and its input.')
  if (!isNonBlankString(task.title))
    throw invalidRequest('A task needs a title.')
  if (!isNonBlankString(task.taskTypeId))
    throw invalidRequest('A task needs the ID of its task type.')
  if (!isJsonObject(task.input))
    throw invalidRequest('A task input must be a JSON object, and everything in it a JSON value.')
  if (task.assignedToId !== undefined && !isNonBlankString(task.assignedToId))
    throw invalidRequest('A task assignee must be a user ID.')

  return {
    ...(task.assignedToId === undefined ? {} : { assignedToId: task.assignedToId }),
    input: task.input,
    taskTypeId: task.taskTypeId,
    title: task.title,
  }
}

function readTaskReplyPayload(reply: TaskReplyInput): TaskReplyInput {
  if (!isObjectRecord(reply))
    throw invalidRequest('A task reply needs a task ID and its content.')
  if (!isNonBlankString(reply.taskId))
    throw invalidRequest('A task reply needs the ID of its task.')
  if (!isNonBlankString(reply.content))
    throw invalidRequest('A task reply needs content.')
  if (reply.inReplyToMessageId !== undefined && !isNonBlankString(reply.inReplyToMessageId))
    throw invalidRequest('A task reply can answer only a message ID.')

  return {
    content: reply.content,
    ...(reply.inReplyToMessageId === undefined ? {} : { inReplyToMessageId: reply.inReplyToMessageId }),
    taskId: reply.taskId,
  }
}

/** An action's name within its app, as the host checks it before adding the app. */
const ACTION_NAME = /^[a-z0-9][a-z0-9-]*$/

/** The host's timeout for an action run that names none. */
const DEFAULT_ACTION_TIMEOUT_MS = 60_000
/** How much longer than the host's timeout the client waits for its answer. */
const ACTION_ANSWER_GRACE_MS = 5_000
/** The longest delay `setTimeout` keeps; it runs a longer one at once. */
const MAX_TIMER_MS = 2_147_483_647

/**
 * How long a run waits for the host. The host answers `timeout` itself at the
 * timeout, so this wait only ends a run whose answer never comes, as when the
 * host has closed its port. A timeout the host refuses is answered at once, so
 * it only needs to give a delay a timer can hold.
 */
function actionWaitMs(timeoutMs: number | undefined): number {
  const hostTimeoutMs = Math.max(timeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS, 0)
  return Math.min(hostTimeoutMs + ACTION_ANSWER_GRACE_MS, MAX_TIMER_MS)
}

/**
 * Sends a request and waits at most `waitMs` for its answer. After that it
 * rejects with `timeout` and aborts the transport's wait, so the request is
 * not kept pending on a port the host may no longer read.
 */
async function requestWithin<TResult>(
  transport: SpaceTransport,
  request: ProtocolRequest,
  waitMs: number,
): Promise<ProtocolResponse<TResult>> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new SpaceProtocolError({
        code: 'timeout',
        message: `The Space host did not answer ${request.operation} within ${waitMs} milliseconds, so its outcome is unknown.`,
      })
      controller.abort(error)
      reject(error)
    }, waitMs)
  })

  try {
    return await Promise.race([transport.request<TResult>(request, undefined, controller.signal), expired])
  }
  finally {
    clearTimeout(timer)
  }
}

/**
 * Checks an action run before it is sent. The timeout's range is the host's to
 * enforce, so only its type is checked here, and it is sent only when given.
 */
function readActionRunPayload(
  action: string,
  input: unknown,
  options: ActionRunOptions | undefined,
): ActionRunRequest['payload'] {
  if (typeof action !== 'string' || !ACTION_NAME.test(action))
    throw invalidRequest('An action is named alone, in lowercase letters, digits, and hyphens, such as "document-attach".')
  if (!isJsonValue(input))
    throw invalidRequest('An action input must be a JSON value, and everything in it a JSON value.')
  if (options !== undefined && !isObjectRecord(options))
    throw invalidRequest('Action options must be an object.')

  const timeoutMs = options?.timeoutMs
  if (timeoutMs !== undefined && (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs)))
    throw invalidRequest('An action timeout must be a number of milliseconds.')

  return {
    action,
    input,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  }
}

/**
 * The task.create contract takes an object for input, never null, an array, or
 * a single value, so a caller learns that here instead of from the host.
 */
function isJsonObject(value: unknown): value is JsonObject {
  return isObjectRecord(value) && isJsonValue(value)
}

/**
 * Accepts only what JSON carries unchanged. A structured clone would pass a
 * Date, Map, or class instance through a MessagePort and a JSON transport
 * would not, so task and action input are held to JSON on every transport.
 */
function isJsonValue(value: unknown, ancestors = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return true
  if (typeof value === 'number')
    return Number.isFinite(value)
  if (!value || typeof value !== 'object' || ancestors.has(value))
    return false

  const prototype = Object.getPrototypeOf(value)
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null)
    return false

  ancestors.add(value)
  const valid = Object.values(value).every(child => isJsonValue(child, ancestors))
  ancestors.delete(value)
  return valid
}

function readDocumentStageInput(document: DocumentStageInput): { file: Blob, mimeType: string, name: string } {
  if (!isObjectRecord(document) || !isBlob(document.file))
    throw invalidRequest('A staged document needs a File or Blob.')

  const name = document.name ?? readFileName(document.file)
  if (!isNonBlankString(name))
    throw invalidRequest('A staged document needs a name, and a Blob has none of its own.')
  if (document.mimeType !== undefined && typeof document.mimeType !== 'string')
    throw invalidRequest('A staged document type must be a MIME type.')

  return {
    file: document.file,
    mimeType: document.mimeType || document.file.type || 'application/octet-stream',
    name,
  }
}

/** Duck-typed so a Blob from another realm, or a test double, is accepted. */
function isBlob(value: unknown): value is Blob {
  if (!isObjectRecord(value))
    return false

  return typeof value.arrayBuffer === 'function' && typeof value.size === 'number' && typeof value.type === 'string'
}

function readFileName(file: Blob): string | undefined {
  const { name } = file as Partial<File>
  return typeof name === 'string' ? name : undefined
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

const DOCUMENT_SCOPES: ReadonlySet<unknown> = new Set<StagedDocumentHandle['scope']>([
  'ephemeral',
  'record',
  'staged',
])

function isDocumentStageResult(value: unknown): value is DocumentStageResult {
  if (!isObjectRecord(value) || !isObjectRecord(value.handle))
    return false

  const handle = value.handle
  return isNonBlankString(handle.file_hash)
    && isNonBlankString(handle.filename)
    && typeof handle.mime_type === 'string'
    && isNonNegativeInteger(handle.size)
    && isNonBlankString(handle.storage_path)
    && (handle.scope === undefined || DOCUMENT_SCOPES.has(handle.scope))
}

const TASK_STATUSES: ReadonlySet<unknown> = new Set<TaskStatus>([
  'cancelled',
  'completed',
  'failed',
  'in_progress',
  'queued',
  'waiting',
])

function isTaskCreateResult(value: unknown): value is TaskCreateResult {
  if (!isObjectRecord(value) || !isObjectRecord(value.task))
    return false

  const { id, revision, status } = value.task
  return isNonBlankString(id) && isNonNegativeInteger(revision) && TASK_STATUSES.has(status)
}

function isTaskReplyResult(value: unknown): value is TaskReplyResult {
  return isObjectRecord(value) && isNonBlankString(value.messageId) && isNonNegativeInteger(value.taskRevision)
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
