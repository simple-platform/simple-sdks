import type { ProtocolRequest, SpaceTransport } from './protocol.js'
import {
  invalidRequest,
  invalidResponse,
  isNonBlankString,
  isNonNegativeInteger,
  isObjectRecord,
  PROTOCOL_VERSION,
  readResponse,
  SpaceProtocolError,
} from './protocol.js'

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
   *
   * `_metadata` at its root is reserved for the platform and is not part of the
   * task type's input. To start the task only after other tasks have ended, list
   * them: `{ _metadata: { start_after: [{ task_id, on? }] } }`. `on` names states
   * of the listed task's own task type that end it; left out, the states that map
   * to `completed`. The task waits, with no model call, until every listed task
   * has ended in a state its entry allows, and is cancelled if one ends in a
   * state its entry does not allow. Its doer is given the `read-task-output`
   * tool for the listed tasks. See "Space tasks" in the README.
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

export interface TaskCreateRequest extends ProtocolRequest<TaskCreateInput> {
  operation: 'task.create'
}

export interface TaskReplyRequest extends ProtocolRequest<TaskReplyInput> {
  operation: 'task.reply'
}

/**
 * Checks a task before it is sent, so a plain-JavaScript caller learns what is
 * wrong without a host round trip. The payload names only the members the
 * operation defines; an optional member left out is not sent at all.
 */
export function readTaskCreatePayload(task: TaskCreateInput): TaskCreateInput {
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

export function readTaskReplyPayload(reply: TaskReplyInput): TaskReplyInput {
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

/**
 * The task.create contract takes an object for input, never null, an array, or
 * a single value, so a caller learns that here instead of from the host.
 */
export function isJsonObject(value: unknown): value is JsonObject {
  return isObjectRecord(value) && isJsonValue(value)
}

/**
 * Accepts only what JSON carries unchanged. A structured clone would pass a
 * Date, Map, or class instance through a MessagePort and a JSON transport
 * would not, so the task input is held to JSON on every transport.
 */
export function isJsonValue(value: unknown, ancestors = new Set<object>()): value is JsonValue {
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

export const TASK_STATUSES: ReadonlySet<unknown> = new Set<TaskStatus>([
  'cancelled',
  'completed',
  'failed',
  'in_progress',
  'queued',
  'waiting',
])

export function isTaskCreateResult(value: unknown): value is TaskCreateResult {
  if (!isObjectRecord(value) || !isObjectRecord(value.task))
    return false

  const { id, revision, status } = value.task
  return isNonBlankString(id) && isNonNegativeInteger(revision) && TASK_STATUSES.has(status)
}

export function isTaskReplyResult(value: unknown): value is TaskReplyResult {
  return isObjectRecord(value) && isNonBlankString(value.messageId) && isNonNegativeInteger(value.taskRevision)
}

/**
 * Tasks are not tied to a page record, so they are available in any Space
 * whose host negotiated the task protocol, standalone or record.
 */
export function createTasksClient(
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
