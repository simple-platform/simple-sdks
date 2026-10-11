import type { BrowserSpaceTransport, MessagePortLike } from './browser-transport.js'
import type { SimpleClient } from './core.js'
import type { UiRuntimeDescriptor } from './record-form.js'
import type { SpaceDocumentLike, SpaceFontState, SpaceThemeSnapshot } from './theme.js'
import { createMessagePortTransport } from './browser-transport.js'
import {
  createSimpleClient,
  HEADER_ACTIONS_PROTOCOL_VERSION,
  HEADER_STATUS_PROTOCOL_VERSION,
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
import { applyThemeSnapshot, parseThemeSnapshot, THEME_PROTOCOL_VERSION } from './theme.js'

export { HEADER_ACTIONS_PROTOCOL_VERSION, HEADER_STATUS_PROTOCOL_VERSION, PROTOCOL_VERSION, RECORDS_PROTOCOL_VERSION, SpaceDataError, SpaceProtocolError, TABS_PROTOCOL_VERSION, TOAST_PROTOCOL_VERSION }
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
  NavigationOpenOptions,
  NavigationTarget,
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
  SimpleHeaderStatusClient,
  SimpleNavigationClient,
  SimpleRecordsClient,
  SimpleTabsClient,
  SimpleTasksClient,
  SimpleToastClient,
  SpaceContext,
  SpaceDataErrorPayload,
  SpaceHeaderStatus,
  SpaceHeaderStatusTransport,
  SpaceNavigationTransport,
  SpaceProtocolErrorPayload,
  SpaceStatusTone,
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
  document: SpaceDocumentLike
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

const connections = new WeakMap<SpaceWindowLike, { promise: Promise<SimpleClient>, targetOrigin: string }>()

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

  const existing = connections.get(window)
  if (existing) {
    if (existing.targetOrigin === targetOrigin)
      return existing.promise

    return Promise.reject(new SpaceProtocolError({
      code: 'invalid_request',
      message: 'connect() already opened this Space\'s connection to a different targetOrigin.',
    }))
  }

  // The host cannot style a cross-origin frame's viewport, where edge bounce occurs.
  if (window.document.documentElement?.style)
    window.document.documentElement.style.overscrollBehaviorY = 'none'

  const promise = new Promise<SimpleClient>((resolve, reject) => {
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

      const isThemeNegotiated = event.data.protocols?.theme === THEME_PROTOCOL_VERSION
      const appliedThemeTokens = new Set<string>()
      const fontState: SpaceFontState = { fontLink: null }

      if (isThemeNegotiated && event.data.theme !== undefined) {
        const initialTheme = parseThemeSnapshot(event.data.theme)
        if (initialTheme) {
          applyThemeSnapshot(window.document, appliedThemeTokens, initialTheme, fontState)
        }
      }

      const onThemeChanged = isThemeNegotiated
        ? (snapshot: SpaceThemeSnapshot) => {
            applyThemeSnapshot(window.document, appliedThemeTokens, snapshot, fontState)
          }
        : undefined

      const transport: BrowserSpaceTransport = createMessagePortTransport(port, targetOrigin, onThemeChanged)
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
        headerStatusTransport: hasRecord && protocols?.headerStatus === HEADER_STATUS_PROTOCOL_VERSION ? transport : undefined,
        headerTransport: hasRecord && protocols?.header === HEADER_ACTIONS_PROTOCOL_VERSION ? transport : undefined,
        hostOrigin: targetOrigin,
        navigationTransport: transport,
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
        headerStatus: [HEADER_STATUS_PROTOCOL_VERSION],
        record: [PROTOCOL_VERSION],
        records: [RECORDS_PROTOCOL_VERSION],
        tabs: [TABS_PROTOCOL_VERSION],
        task: [PROTOCOL_VERSION],
        theme: [THEME_PROTOCOL_VERSION],
        toast: [TOAST_PROTOCOL_VERSION],
      },
      type: 'SPACE_READY',
    }, targetOrigin)
  }).catch((error) => {
    connections.delete(window)
    throw error
  })

  connections.set(window, { promise, targetOrigin })
  return promise
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
  protocols?: {
    action?: unknown
    document?: unknown
    form?: unknown
    header?: unknown
    headerStatus?: unknown
    record?: unknown
    records?: unknown
    tabs?: unknown
    task?: unknown
    theme?: unknown
    toast?: unknown
  }
  runtime?: UiRuntimeDescriptor
  theme?: unknown
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
