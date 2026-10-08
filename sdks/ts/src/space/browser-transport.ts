import type { GraphQLVariables, SpaceDataTransport } from './core.js'
import type { SpaceNavigationTransport } from './navigation.js'
import type { ProtocolRequest, ProtocolResponse, SpaceTransport } from './protocol.js'
import type { RecordFormCapabilities } from './record-form.js'
import type { HeaderAction, SpaceHeaderTransport, SpaceTabsSelectionEvent, SpaceTabsTransport, SpaceToastOptions, SpaceToastTransport } from './ui.js'
import {
  SpaceDataError,
  SpaceProtocolError,
} from './protocol.js'
import {
  createFormModelSubscriptionManager,
  createRecordFormCapabilities,
} from './record-form.js'

export interface MessagePortLike {
  close?: () => void
  onmessage: null | ((event: { data: unknown }) => void)
  postMessage: (message: unknown, transfer?: ArrayBuffer[]) => void
  start?: () => void
}

export interface BrowserSpaceTransport extends SpaceDataTransport, SpaceHeaderTransport, SpaceNavigationTransport, SpaceTabsTransport, SpaceToastTransport, SpaceTransport {
  capabilities: RecordFormCapabilities
  subscribeFormModel: (listener: (form: unknown) => void) => () => void
}

export function createMessagePortTransport(port: MessagePortLike, targetOrigin: string): BrowserSpaceTransport {
  const headerCallbacks = new Map<string, () => Promise<void> | void>()
  const formModelManager = createFormModelSubscriptionManager()
  const pendingData = new Map<string, {
    reject: (reason?: unknown) => void
    resolve: (result: unknown) => void
  }>()
  const pending = new Map<string, {
    resolve: (response: ProtocolResponse<unknown>) => void
  }>()
  const pendingCapabilities = new Map<string, {
    reject: (reason?: unknown) => void
    responseType: string
    resolve: (value: unknown) => void
  }>()
  const tabListeners = new Set<(event: SpaceTabsSelectionEvent) => void>()
  let isPortClosed = false
  if (typeof (port as unknown as EventTarget).addEventListener === 'function') {
    (port as unknown as EventTarget).addEventListener('close', () => {
      isPortClosed = true
    })
  }

  port.onmessage = (event) => {
    const message = event.data
    if (!message || typeof message !== 'object')
      return

    const envelope = message as Partial<{
      data: unknown
      error: unknown
      errors: unknown
      form: unknown
      id: unknown
      response: ProtocolResponse<unknown>
      type: string
    }>
    if (envelope.type === 'SPACE_RECORD_FORM_UPDATE') {
      formModelManager.handleUpdate(envelope.form)
      return
    }

    if (envelope.type === 'SPACE_PROTOCOL_RESPONSE' && envelope.response) {
      const requestId = envelope.response.requestId
      const request = pending.get(requestId)
      if (!request)
        return

      pending.delete(requestId)
      request.resolve(envelope.response)
      return
    }

    if (typeof envelope.type === 'string' && envelope.type.endsWith('_RESPONSE') && typeof envelope.id === 'string') {
      const request = pendingCapabilities.get(envelope.id)
      if (request && envelope.type === request.responseType) {
        pendingCapabilities.delete(envelope.id)
        if (envelope.error) {
          request.reject(new SpaceProtocolError({
            code: 'request_failed',
            message: typeof envelope.error === 'string' ? envelope.error : 'The private capability request failed.',
          }))
        }
        else {
          request.resolve(envelope)
        }
        return
      }
    }

    if (envelope.type === 'SPACE_HEADER_ACTION_INVOKE') {
      const invocation = readHeaderActionInvocation(message)
      if (!invocation)
        return

      const callback = headerCallbacks.get(invocation.actionId)
      if (!callback) {
        port.postMessage({
          actionId: invocation.actionId,
          error: 'The requested header action is no longer registered.',
          invocationId: invocation.invocationId,
          ok: false,
          type: 'SPACE_HEADER_ACTION_RESULT',
        })
        return
      }

      Promise.resolve()
        .then(callback)
        .then(() => {
          port.postMessage({
            actionId: invocation.actionId,
            invocationId: invocation.invocationId,
            ok: true,
            type: 'SPACE_HEADER_ACTION_RESULT',
          })
        })
        .catch((error: unknown) => {
          port.postMessage({
            actionId: invocation.actionId,
            error: error instanceof Error ? error.message : 'The header action failed.',
            invocationId: invocation.invocationId,
            ok: false,
            type: 'SPACE_HEADER_ACTION_RESULT',
          })
        })
      return
    }

    if (envelope.type !== 'GRAPHQL_RESPONSE' || typeof envelope.id !== 'string') {
      if (envelope.type === 'SPACE_UI_TABS_SELECTION_CHANGED') {
        const candidate = envelope as Partial<{ registrationRequestId: unknown, selectedTabId: unknown }>
        if (typeof candidate.registrationRequestId === 'string' && typeof candidate.selectedTabId === 'string') {
          const event: SpaceTabsSelectionEvent = {
            registrationRequestId: candidate.registrationRequestId,
            selectedTabId: candidate.selectedTabId,
          }
          for (const listener of tabListeners) {
            try {
              listener(event)
            }
            catch {
              // Callback errors must not break transport
            }
          }
        }
      }
      return
    }

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

  const requestCapability = <TResult>(type: string, payload: unknown, responseType: string): Promise<TResult> => {
    return new Promise<TResult>((resolve, reject) => {
      const id = createDataRequestId()
      pendingCapabilities.set(id, { reject, resolve: value => resolve(value as TResult), responseType })
      port.postMessage({ id, payload, type })
    })
  }

  return {
    capabilities: createRecordFormCapabilities(requestCapability, msg => port.postMessage(msg), targetOrigin),
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
    isClosed: () => isPortClosed || Boolean((port as { closed?: boolean }).closed),
    navigate: (url, target) => {
      port.postMessage({
        payload: { target, url },
        type: 'NAVIGATE_REQUEST',
      })
    },
    request: <TResult>(request: ProtocolRequest, transfer: ArrayBuffer[] = [], signal?: AbortSignal) => {
      return new Promise<ProtocolResponse<TResult>>((resolve, reject) => {
        const abort = () => {
          pending.delete(request.requestId)
          reject(signal?.reason)
        }
        pending.set(request.requestId, {
          resolve: (response) => {
            signal?.removeEventListener('abort', abort)
            resolve(response as ProtocolResponse<TResult>)
          },
        })
        signal?.addEventListener('abort', abort, { once: true })
        port.postMessage({ request, type: 'SPACE_PROTOCOL_REQUEST' }, transfer)
      })
    },
    setActions: (actions: readonly HeaderAction[]) => {
      headerCallbacks.clear()
      for (const action of actions)
        headerCallbacks.set(action.id, action.onClick)

      port.postMessage({
        actions: actions.map(({ disabled, icon, id, label, loading, type }) => ({
          disabled,
          icon,
          id,
          label,
          loading,
          type,
        })),
        type: 'SPACE_HEADER_ACTIONS_SET',
      })
    },
    showToast: (options: SpaceToastOptions) => {
      port.postMessage({ options, type: 'SPACE_TOAST_SHOW' })
    },
    subscribeFormModel: (listener: (form: unknown) => void) => {
      return formModelManager.subscribeFormModel(listener)
    },
    subscribeTabSelected: (listener: (event: SpaceTabsSelectionEvent) => void) => {
      tabListeners.add(listener)
      return () => {
        tabListeners.delete(listener)
      }
    },
  }
}

function readHeaderActionInvocation(value: unknown): null | { actionId: string, invocationId: string } {
  if (!value || typeof value !== 'object')
    return null

  const message = value as Partial<{ actionId: unknown, invocationId: unknown }>
  if (typeof message.actionId !== 'string' || !message.actionId
    || typeof message.invocationId !== 'string' || !message.invocationId) {
    return null
  }

  return { actionId: message.actionId, invocationId: message.invocationId }
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
