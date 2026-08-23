import type {
  GraphQLVariables,
  ProtocolRequest,
  ProtocolResponse,
  SimpleClient,
  SpaceDataTransport,
  SpaceTransport,
} from './core.js'

import {
  createSimpleClient,
  isSpaceContext,
  PROTOCOL_VERSION,
  SpaceDataError,
  SpaceProtocolError,
} from './core.js'

export {
  SpaceDataError,
  SpaceProtocolError,
}
export type {
  GraphQLVariables,
  RecordErrorSnapshot,
  RecordFieldSnapshot,
  RecordFormError,
  RecordHandle,
  RecordSnapshot,
  RecordSubmitResult,
  RecordUpdateResult,
  SimpleClient,
  SimpleDataClient,
  SpaceContext,
  SpaceDataErrorPayload,
  SpaceProtocolErrorPayload,
} from './core.js'

interface MessagePortLike {
  onmessage: null | ((event: { data: unknown }) => void)
  postMessage: (message: unknown) => void
  start?: () => void
}

interface BrowserSpaceTransport extends SpaceDataTransport, SpaceTransport {}

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

/**
 * Connects any embedded Space to its parent through the dedicated MessagePort
 * handshake. Record operations become available only when the host negotiates
 * record protocol v1 for a configured record view.
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

      const transport = createMessagePortTransport(port)
      const recordTransport = event.data.protocols?.record === PROTOCOL_VERSION
        ? transport
        : undefined
      resolve(createSimpleClient({
        context: event.data.context,
        dataTransport: transport,
        transport: recordTransport,
      }))
    }

    window.addEventListener('message', onMessage)
    window.parent.postMessage({
      protocols: { record: [PROTOCOL_VERSION] },
      type: 'SPACE_READY',
    }, targetOrigin)
  })
}

function createMessagePortTransport(port: MessagePortLike): BrowserSpaceTransport {
  const pendingData = new Map<string, {
    reject: (reason?: unknown) => void
    resolve: (result: unknown) => void
  }>()
  const pending = new Map<string, {
    resolve: (response: ProtocolResponse<unknown>) => void
  }>()
  port.onmessage = (event) => {
    const message = event.data
    if (!message || typeof message !== 'object')
      return

    const envelope = message as Partial<{
      data: unknown
      error: unknown
      errors: unknown
      id: unknown
      response: ProtocolResponse<unknown>
      type: string
    }>
    if (envelope.type === 'SPACE_PROTOCOL_RESPONSE' && envelope.response) {
      const requestId = envelope.response.requestId
      const request = pending.get(requestId)
      if (!request)
        return

      pending.delete(requestId)
      request.resolve(envelope.response)
      return
    }

    if (envelope.type !== 'GRAPHQL_RESPONSE' || typeof envelope.id !== 'string')
      return

    const request = pendingData.get(envelope.id)
    if (!request)
      return

    pendingData.delete(envelope.id)
    if (envelope.error || envelope.errors) {
      request.reject(new SpaceDataError({
        code: 'request_failed',
        details: envelope.errors,
        message: readGraphQLErrorMessage(envelope.error, envelope.errors),
      }))
      return
    }

    request.resolve(envelope.data)
  }
  port.start?.()

  return {
    execute: <TResult>(document: string, variables?: GraphQLVariables) => {
      return new Promise<TResult>((resolve, reject) => {
        const id = createDataRequestId()
        pendingData.set(id, { reject, resolve: result => resolve(result as TResult) })
        port.postMessage({
          payload: { id, query: document, variables },
          type: 'GRAPHQL_REQUEST',
        })
      })
    },
    request: <TResult>(request: ProtocolRequest) => {
      return new Promise<ProtocolResponse<TResult>>((resolve) => {
        pending.set(request.requestId, {
          resolve: response => resolve(response as ProtocolResponse<TResult>),
        })
        port.postMessage({ request, type: 'SPACE_PROTOCOL_REQUEST' })
      })
    },
  }
}

function createDataRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID()

  return `space-data-${Math.random().toString(36).slice(2)}`
}

function readGraphQLErrorMessage(error: unknown, errors: unknown): string {
  if (typeof error === 'string' && error)
    return error

  if (Array.isArray(errors)) {
    const firstError = errors[0]
    if (firstError && typeof firstError === 'object') {
      const details = firstError as {
        extensions?: { details?: { message?: unknown }, issues?: Array<{ message?: unknown }> }
        message?: unknown
      }
      const issue = details.extensions?.issues?.[0]?.message
      if (typeof issue === 'string' && issue)
        return issue
      const message = details.extensions?.details?.message
      if (typeof message === 'string' && message)
        return message
      if (typeof details.message === 'string' && details.message)
        return details.message
    }
  }

  return 'GraphQL request failed.'
}

function isInitializationMessage(value: unknown): value is {
  context?: unknown
  protocols?: { record?: unknown }
  type: 'INIT_RPC'
} {
  if (!value || typeof value !== 'object')
    return false

  return (value as { type?: unknown }).type === 'INIT_RPC'
}
