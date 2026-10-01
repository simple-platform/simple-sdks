import type { BrowserSpaceTransport, MessagePortLike } from './browser-transport.js'
import type { SimpleClient } from './core.js'
import type { UiRuntimeDescriptor } from './record-form.js'
import { createMessagePortTransport } from './browser-transport.js'
import {
  createSimpleClient,
  HEADER_ACTIONS_PROTOCOL_VERSION,
  isSpaceContext,
  MANAGED_RECORD_FORM_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  SpaceDataError,
  SpaceProtocolError,
  TOAST_PROTOCOL_VERSION,
} from './core.js'
import { isObjectRecord } from './protocol.js'

export { SpaceDataError, SpaceProtocolError }
export type {
  ActionFailedDetails,
  ActionRunOptions,
  GraphQLVariables,
  HeaderAction,
  HeaderActionType,
  JsonObject,
  JsonValue,
  RecordErrorSnapshot,
  RecordFieldSnapshot,
  RecordFormError,
  RecordHandle,
  RecordSnapshot,
  RecordSubmitResult,
  RecordUpdateResult,
  SimpleActionsClient,
  SimpleClient,
  SimpleDataClient,
  SimpleHeaderClient,
  SimpleTasksClient,
  SimpleToastClient,
  SpaceContext,
  SpaceDataErrorPayload,
  SpaceProtocolErrorPayload,
  SpaceToastOptions,
  SpaceToastVariant,
  TaskCreateInput,
  TaskCreateResult,
  TaskReplyInput,
  TaskReplyResult,
  TaskStatus,
} from './core.js'

export interface SpaceWindowLike {
  addEventListener: (type: 'message', listener: (event: SpaceMessageEvent) => void) => void
  parent: {
    postMessage: (message: unknown, targetOrigin: string) => void
  }
  removeEventListener: (type: 'message', listener: (event: SpaceMessageEvent) => void) => void
}

export interface SpaceMessageEvent {
  data: unknown
  origin: string
  ports: MessagePortLike[]
}

export interface ConnectSpaceOptions {
  targetOrigin: string
  window?: SpaceWindowLike
}

/** Connects the current Space to its Simple host. */
export function connect(): Promise<SimpleClient> {
  try {
    return connectSpace({ targetOrigin: readHostOrigin() })
  }
  catch (error) {
    return Promise.reject(error)
  }
}

/**
 * Connects an embedded Space through the host's dedicated MessagePort.
 *
 * @deprecated Use `connect()`. This lower-level bootstrap remains temporarily
 * for existing embedded Space deployments.
 */
export function connectSpace({ targetOrigin, window = globalThis.window }: ConnectSpaceOptions): Promise<SimpleClient> {
  if (!window) {
    return Promise.reject(new SpaceProtocolError({
      code: 'unavailable',
      message: 'The Space SDK requires a browser window.',
    }))
  }

  return new Promise((resolve, reject) => {
    const onMessage = (event: SpaceMessageEvent) => {
      if (event.origin !== targetOrigin || !isInitializationMessage(event.data))
        return

      window.removeEventListener('message', onMessage)
      const port = event.ports[0]
      if (!port) {
        reject(new SpaceProtocolError({
          code: 'unavailable',
          message: 'The Space host did not provide a MessagePort.',
        }))
        return
      }

      if (!isSpaceContext(event.data.context)) {
        reject(new SpaceProtocolError({
          code: 'invalid_response',
          message: 'The Space host did not provide valid context.',
        }))
        return
      }

      const transport: BrowserSpaceTransport = createMessagePortTransport(port, targetOrigin)
      const protocols = event.data.protocols
      const hasRecord = protocols?.record === PROTOCOL_VERSION
      resolve(createSimpleClient({
        actionTransport: protocols?.action === PROTOCOL_VERSION ? transport : undefined,
        capabilities: transport.capabilities,
        context: event.data.context,
        dataTransport: transport,
        formModelTransport: protocols?.form === MANAGED_RECORD_FORM_PROTOCOL_VERSION ? transport : undefined,
        headerTransport: hasRecord && protocols?.header === HEADER_ACTIONS_PROTOCOL_VERSION ? transport : undefined,
        runtime: event.data.runtime,
        taskTransport: protocols?.task === PROTOCOL_VERSION ? transport : undefined,
        toastTransport: protocols?.toast === TOAST_PROTOCOL_VERSION ? transport : undefined,
        transport: hasRecord ? transport : undefined,
      }))
    }

    window.addEventListener('message', onMessage)
    window.parent.postMessage({
      protocols: {
        action: [PROTOCOL_VERSION],
        form: [MANAGED_RECORD_FORM_PROTOCOL_VERSION],
        header: [HEADER_ACTIONS_PROTOCOL_VERSION],
        record: [PROTOCOL_VERSION],
        task: [PROTOCOL_VERSION],
        toast: [TOAST_PROTOCOL_VERSION],
      },
      type: 'SPACE_READY',
    }, targetOrigin)
  })
}

function readHostOrigin(): string {
  const referrer = globalThis.document?.referrer
  if (!referrer) {
    throw new SpaceProtocolError({
      code: 'unavailable',
      message: 'Simple could not determine the host for this Space.',
    })
  }

  try {
    return new URL(referrer).origin
  }
  catch {
    throw new SpaceProtocolError({
      code: 'invalid_response',
      message: 'Simple received an invalid Space host origin.',
    })
  }
}

function isInitializationMessage(value: unknown): value is {
  context: unknown
  protocols?: { action?: unknown, form?: unknown, header?: unknown, record?: unknown, task?: unknown, toast?: unknown }
  runtime?: UiRuntimeDescriptor
  type: 'INIT_RPC'
} {
  if (!isObjectRecord(value) || value.type !== 'INIT_RPC')
    return false

  return value.runtime === undefined || isUiRuntimeDescriptor(value.runtime)
}

function isUiRuntimeDescriptor(value: unknown): value is UiRuntimeDescriptor {
  if (!isObjectRecord(value))
    return false

  const { url, version } = value
  if (typeof url !== 'string' || !url || typeof version !== 'string' || !version)
    return false

  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:'
  }
  catch {
    return false
  }
}
