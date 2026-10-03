import type { SimpleActionsClient } from './actions.js'
import type { SimpleDocumentsClient } from './documents.js'
import type { SpaceTransport } from './protocol.js'
import type {
  RecordFormCapabilities,
  RecordFormModelTransport,
  UiRuntimeDescriptor,
} from './record-form.js'
import type {
  CurrentRecordRequest,
  CurrentRecordResult,
  RecordHandle,
  SimpleRecordsClient,
} from './record.js'
import type { SimpleTasksClient } from './tasks.js'
import type {
  SimpleHeaderClient,
  SimpleTabsClient,
  SimpleToastClient,
  SpaceHeaderTransport,
  SpaceTabsTransport,
  SpaceToastOptions,
  SpaceToastTransport,
} from './ui.js'
import { createActionsClient } from './actions.js'
import { createDocumentsClient } from './documents.js'
import { deepFreeze, invalidResponse, isObjectRecord, PROTOCOL_VERSION, readResponse, SpaceDataError, SpaceProtocolError } from './protocol.js'
import { createRecordsClient, isCurrentRecordResult, ProtocolRecordHandle } from './record.js'
import { createTasksClient } from './tasks.js'
import { createHeaderClient, createTabsClient, createToastClient, validateSpaceToastOptions } from './ui.js'

export type {
  ActionFailedDetails,
  ActionRunOptions,
  SimpleActionsClient,
} from './actions.js'
export type {
  DocumentStageInput,
  DocumentStageResult,
  SimpleDocumentsClient,
  StagedDocumentHandle,
} from './documents.js'
export { PROTOCOL_VERSION, SpaceDataError, SpaceProtocolError } from './protocol.js'
export type {
  ProtocolErrorResponse,
  ProtocolRequest,
  ProtocolResponse,
  ProtocolSuccessResponse,
  SpaceDataErrorPayload,
  SpaceProtocolErrorPayload,
  SpaceTransport,
} from './protocol.js'
export { getRecordFormBridge, MANAGED_RECORD_FORM_PROTOCOL_VERSION } from './record-form.js'
export type {
  ManagedRecordFormField,
  ManagedRecordFormModel,
  RecordFormCapabilities,
  RecordFormModelTransport,
  UiRuntimeDescriptor,
} from './record-form.js'
export { RECORDS_PROTOCOL_VERSION } from './record.js'
export type {
  CurrentRecordRequest,
  CurrentRecordResult,
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
  SimpleRecordsClient,
} from './record.js'
export type {
  JsonObject,
  JsonValue,
  SimpleTasksClient,
  TaskCreateInput,
  TaskCreateResult,
  TaskReplyInput,
  TaskReplyResult,
  TaskStatus,
} from './tasks.js'
export { DEFAULT_TABS_TIMEOUT_MS, HEADER_ACTIONS_PROTOCOL_VERSION, LUCIDE_ICON_NAME, TAB_ID, TABS_PROTOCOL_VERSION, TOAST_PROTOCOL_VERSION, validateTabs } from './ui.js'
export type {
  HeaderAction,
  HeaderActionType,
  SetTabsOptions,
  SimpleHeaderActionsClient,
  SimpleHeaderClient,
  SimpleTabsClient,
  SimpleToastClient,
  SpaceTab,
  SpaceTabsSelectionEvent,
  SpaceTabsTransport,
  SpaceToastOptions,
  SpaceToastVariant,
  TabsSelectPayload,
  TabsSelectRequest,
  TabsSelectResult,
  TabsSetPayload,
  TabsSetRequest,
  TabsSetResult,
  WireTab,
} from './ui.js'

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

export type GraphQLVariables = Readonly<Record<string, unknown>>

export interface SpaceDataTransport {
  execute: <TResult = unknown>(document: string, variables?: GraphQLVariables) => Promise<TResult>
}

export interface SimpleDataClient {
  mutate: <TResult = unknown>(document: string, variables?: GraphQLVariables) => Promise<TResult>
  query: <TResult = unknown>(document: string, variables?: GraphQLVariables) => Promise<TResult>
}

export interface SimpleClient {
  actions: SimpleActionsClient
  context: SpaceContext
  data: SimpleDataClient
  documents: SimpleDocumentsClient
  /** Record session capabilities for the current Space. */
  records: SimpleRecordsClient
  tasks: SimpleTasksClient
  ui: {
    header: SimpleHeaderClient
    tabs: SimpleTabsClient
    toast: SimpleToastClient
  }
}

export interface SimpleClientOptions {
  /** Present only when the host negotiated the action protocol. */
  actionTransport?: SpaceTransport
  capabilities?: RecordFormCapabilities
  context?: SpaceContext
  dataTransport?: SpaceDataTransport
  /** Present only when the host negotiated the document protocol. */
  documentTransport?: SpaceTransport
  formModelTransport?: RecordFormModelTransport
  headerTransport?: SpaceHeaderTransport
  nextRequestId?: () => string
  /** Present only when the host negotiated the records protocol. */
  recordsTransport?: SpaceTransport
  runtime?: UiRuntimeDescriptor
  tabsTransport?: SpaceTabsTransport
  taskTransport?: SpaceTransport
  toastTransport?: SpaceToastTransport
  transport?: SpaceTransport
}

/** Composes Space capabilities around the host transports supplied by `connect`. */
export function createSimpleClient({
  actionTransport,
  capabilities,
  context = { kind: 'standalone' },
  dataTransport,
  documentTransport,
  formModelTransport,
  headerTransport,
  nextRequestId = createRequestId,
  recordsTransport,
  runtime,
  tabsTransport,
  taskTransport,
  toastTransport,
  transport,
}: SimpleClientOptions): SimpleClient {
  const immutableContext = deepFreeze(structuredClone(context))
  const recordFormCapabilities = capabilities && toastTransport
    ? {
        ...capabilities,
        showToast: (options: SpaceToastOptions) => toastTransport.showToast(validateSpaceToastOptions(options)),
      }
    : capabilities

  const record = async (): Promise<RecordHandle> => {
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
    if (!isCurrentRecordResult(result))
      throw invalidResponse('The primary-record response is malformed.')

    return new ProtocolRecordHandle(
      result,
      nextRequestId,
      transport,
      runtime,
      (document, variables) => executeData(dataTransport, document, variables),
      recordFormCapabilities,
      formModelTransport,
    )
  }

  const records = createRecordsClient({
    capabilities: recordFormCapabilities,
    currentRecord: record,
    graphql: (document, variables) => executeData(dataTransport, document, variables),
    nextRequestId,
    recordsTransport,
    runtime,
  })

  return {
    actions: createActionsClient(actionTransport, nextRequestId),
    context: immutableContext,
    data: {
      mutate: (document, variables) => executeData(dataTransport, document, variables),
      query: (document, variables) => executeData(dataTransport, document, variables),
    },
    documents: createDocumentsClient(documentTransport, nextRequestId),
    records,
    tasks: createTasksClient(taskTransport, nextRequestId),
    ui: {
      header: createHeaderClient(immutableContext.kind === 'record', headerTransport),
      tabs: createTabsClient(immutableContext.kind === 'record', tabsTransport, nextRequestId),
      toast: createToastClient(toastTransport),
    },
  }
}

export function isSpaceContext(value: unknown): value is SpaceContext {
  if (!isObjectRecord(value))
    return false

  if (value.kind === 'standalone')
    return true

  return value.kind === 'record'
    && typeof value.applicationId === 'string'
    && value.applicationId.length > 0
    && typeof value.tableName === 'string'
    && value.tableName.length > 0
    && typeof value.recordId === 'string'
    && value.recordId.length > 0
}

function executeData<TResult>(
  dataTransport: SpaceDataTransport | undefined,
  document: string,
  variables?: GraphQLVariables,
): Promise<TResult> {
  if (!dataTransport) {
    return Promise.reject(new SpaceDataError({
      code: 'unavailable',
      message: 'The Space data transport is unavailable.',
    }))
  }

  return dataTransport.execute<TResult>(document, variables)
}

function createRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID()

  return `space-request-${Math.random().toString(36).slice(2)}`
}
