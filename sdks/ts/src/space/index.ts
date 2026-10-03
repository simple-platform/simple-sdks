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
  RECORDS_PROTOCOL_VERSION,
  SpaceDataError,
  SpaceProtocolError,
  TABS_PROTOCOL_VERSION,
  TOAST_PROTOCOL_VERSION,
} from './core.js'
import { isObjectRecord } from './protocol.js'

export { HEADER_ACTIONS_PROTOCOL_VERSION, PROTOCOL_VERSION, RECORDS_PROTOCOL_VERSION, SpaceDataError, SpaceProtocolError, TABS_PROTOCOL_VERSION, TOAST_PROTOCOL_VERSION }
export type {
  ActionFailedDetails,
  ActionRunOptions,
  DocumentStageInput,
  DocumentStageResult,
  GraphQLVariables,
  HeaderAction,
  HeaderActionType,
  JsonObject,
  JsonValue,
  OpenRecordOptions,
  RecordErrorSnapshot,
  RecordFieldSnapshot,
  RecordFormError,
  RecordHandle,
  RecordOpenRequest,
  RecordOpenResult,
  RecordReference,
  RecordSnapshot,
  RecordSubmitResult,
  RecordUpdateResult,
  SetTabsOptions,
  SimpleActionsClient,
  SimpleClient,
  SimpleDataClient,
  SimpleDocumentsClient,
  SimpleHeaderActionsClient,
  SimpleHeaderClient,
  SimpleRecordsClient,
  SimpleTabsClient,
  SimpleTasksClient,
  SimpleToastClient,
  SpaceContext,
  SpaceDataErrorPayload,
  SpaceProtocolErrorPayload,
  SpaceTab,
  SpaceTabsSelectionEvent,
  SpaceTabsTransport,
  SpaceToastOptions,
  SpaceToastVariant,
  StagedDocumentHandle,
  TaskCreateInput,
  TaskCreateResult,
  TaskReplyInput,
  TaskReplyResult,
  TaskStatus,
} from './core.js'

interface SpaceWindowLike {
  addEventListener: (type: 'message', listener: (event: SpaceMessageEvent) => void) => void
  document: {
    documentElement: {
      style: {
        overscrollBehaviorY: string
      }
    }
  }
  parent: {
    postMessage: (message: unknown, targetOrigin: string) => void
  }
  removeEventListener: (type: 'message', listener: (event: SpaceMessageEvent) => void) => void
}

interface SpaceMessageEvent {
  data: unknown
  origin: string
  ports: MessagePortLike[]
}

export interface ConnectOptions {
  targetOrigin: string
}

/** Connects this Space to its host using the explicitly supplied host origin. */
export function connect({ targetOrigin }: ConnectOptions): Promise<SimpleClient> {
  if (!isOrigin(targetOrigin)) {
    return Promise.reject(new SpaceProtocolError({
      code: 'invalid_request',
      message: 'connect() requires targetOrigin to be an HTTP or HTTPS origin.',
    }))
  }

  const window = globalThis.window as unknown as SpaceWindowLike | undefined
  if (!window) {
    return Promise.reject(new SpaceProtocolError({
      code: 'unavailable',
      message: 'The Space SDK requires a browser window.',
    }))
  }

  // The host cannot style a cross-origin frame's viewport, where edge bounce occurs.
  window.document.documentElement.style.overscrollBehaviorY = 'none'

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
      const hasRecords = protocols?.records === RECORDS_PROTOCOL_VERSION
      resolve(createSimpleClient({
        actionTransport: protocols?.action === PROTOCOL_VERSION ? transport : undefined,
        capabilities: transport.capabilities,
        context: event.data.context,
        dataTransport: transport,
        documentTransport: protocols?.document === PROTOCOL_VERSION ? transport : undefined,
        formModelTransport: protocols?.form === MANAGED_RECORD_FORM_PROTOCOL_VERSION ? transport : undefined,
        headerTransport: hasRecord && protocols?.header === HEADER_ACTIONS_PROTOCOL_VERSION ? transport : undefined,
        recordsTransport: hasRecords ? transport : undefined,
        runtime: event.data.runtime,
        tabsTransport: hasRecord && protocols?.tabs === TABS_PROTOCOL_VERSION ? transport : undefined,
        taskTransport: protocols?.task === PROTOCOL_VERSION ? transport : undefined,
        toastTransport: protocols?.toast === TOAST_PROTOCOL_VERSION ? transport : undefined,
        transport: hasRecord ? transport : undefined,
      }))
    }

    window.addEventListener('message', onMessage)
    window.parent.postMessage({
      protocols: {
        action: [PROTOCOL_VERSION],
        document: [PROTOCOL_VERSION],
        form: [MANAGED_RECORD_FORM_PROTOCOL_VERSION],
        header: [HEADER_ACTIONS_PROTOCOL_VERSION],
        record: [PROTOCOL_VERSION],
        records: [RECORDS_PROTOCOL_VERSION],
        tabs: [TABS_PROTOCOL_VERSION],
        task: [PROTOCOL_VERSION],
        toast: [TOAST_PROTOCOL_VERSION],
      },
      type: 'SPACE_READY',
    }, targetOrigin)
  })
}

function isOrigin(targetOrigin: string): boolean {
  try {
    const url = new URL(targetOrigin)
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && url.origin === targetOrigin
  }
  catch {
    return false
  }
}

function isInitializationMessage(value: unknown): value is {
  context: unknown
  protocols?: { action?: unknown, document?: unknown, form?: unknown, header?: unknown, record?: unknown, records?: unknown, tabs?: unknown, task?: unknown, toast?: unknown }
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
