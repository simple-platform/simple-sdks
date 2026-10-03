import type { RecordHandle, RecordSnapshot, RecordUiBridge, RecordUiMetadata } from './record.js'
import type { SpaceToastOptions } from './ui.js'
import { deepFreeze, invalidResponse, isObjectRecord } from './protocol.js'

export const MANAGED_RECORD_FORM_PROTOCOL_VERSION = 2 as const

export interface UiRuntimeDescriptor {
  readonly url: string
  readonly version: string
}

export interface ManagedRecordFormField {
  constraints?: unknown
  description?: string
  displayName?: string
  id: string
  isRequired: boolean
  name: string
  position?: number
  readOnly: boolean
  relationship?: unknown
  tableId?: string
  type: string
}

export interface ManagedRecordFormModel {
  fields: readonly ManagedRecordFormField[]
  recordId?: string
  tableId?: string
  tableName?: string
}

export type ManagedRecordFormSnapshotListener = (snapshot: RecordSnapshot) => void
export type RecordFormSubmitPreparation = () => Promise<Readonly<Record<string, unknown>> | undefined>

export interface RecordFormCapabilities {
  createDocumentHandle: (request: {
    bytes: ArrayBuffer
    lifecycle?: 'pending' | 'record' | 'staged'
    mime: string
    name: string
    target?: Record<string, unknown>
  }) => Promise<unknown>
  decrypt: (request: {
    appId: string
    fieldName: string
    recordId: string
    sessionId?: string
    tableName: string
  }) => Promise<string>
  deleteFile: (request: { context: Record<string, string>, fileHash: string }) => Promise<void>
  getDocumentPreview: (request: { fieldName: string, fileHash: string, sessionId?: string }) => Promise<{ bytes: ArrayBuffer, mimeType: string } | { url: string }>
  navigate: (path: string) => Promise<void>
  showToast?: (options: SpaceToastOptions) => void
}

export interface RecordFormBridge extends RecordUiBridge {
  blurField: (fieldName: string) => Promise<void>
  focusField: (fieldName: string) => Promise<void>
  form: unknown
  registerSubmitPreparation: (preparation: RecordFormSubmitPreparation) => () => void
  subscribeFormModel: (listener: (form: unknown) => void) => () => void
  subscribe: (listener: ManagedRecordFormSnapshotListener) => () => void
}

export interface RecordFormModelTransport {
  subscribeFormModel: (listener: (form: unknown) => void) => () => void
}

export interface RecordFormLifecycle {
  notifySnapshot: (snapshot: RecordSnapshot) => void
  prepareSubmit: () => Promise<Record<string, unknown>>
}

export interface RecordFormLifecycleOptions {
  applicationId?: string
  capabilities?: RecordFormCapabilities
  form?: ManagedRecordFormModel
  formModelTransport?: RecordFormModelTransport
  graphql: (document: string, variables?: Readonly<Record<string, unknown>>) => Promise<unknown>
  runtime?: UiRuntimeDescriptor
  setActiveField: (operation: 'record.blur' | 'record.focus', fieldName: string) => Promise<void>
}

const recordUiBridges = new WeakMap<object, RecordFormBridge>()

/**
 * Private lookup used only by the UI Kit bridge.
 * @internal
 */
export function getRecordFormBridge(record: RecordHandle): RecordFormBridge | undefined {
  return recordUiBridges.get(record as object)
}

/** Private lookup for managed record UI that does not need form controls. */
export function getRecordUiBridge(record: RecordHandle): RecordUiBridge | undefined {
  return recordUiBridges.get(record as object)
}

export function isManagedRecordFormModel(value: unknown): value is ManagedRecordFormModel {
  if (!isObjectRecord(value) || !Array.isArray(value.fields))
    return false

  if (value.tableId !== undefined && typeof value.tableId !== 'string')
    return false

  return value.fields.every((field) => {
    if (!isObjectRecord(field))
      return false

    return typeof field.id === 'string'
      && typeof field.name === 'string'
      && typeof field.type === 'string'
      && typeof field.isRequired === 'boolean'
      && typeof field.readOnly === 'boolean'
      && (field.position === undefined || typeof field.position === 'number')
      && (field.description === undefined || typeof field.description === 'string')
      && (field.displayName === undefined || typeof field.displayName === 'string')
      && (field.tableId === undefined || typeof field.tableId === 'string')
  })
}

function deriveTableId(target: readonly ManagedRecordFormField[] | ManagedRecordFormModel): string | undefined {
  const fields = 'fields' in target ? target.fields : target
  if ('fields' in target && typeof target.tableId === 'string' && target.tableId.trim().length > 0)
    return target.tableId.trim()
  for (const field of fields) {
    if (typeof field?.tableId === 'string' && field.tableId.trim().length > 0)
      return field.tableId.trim()
  }
  return undefined
}

export function immutableManagedRecordForm(form: ManagedRecordFormModel): ManagedRecordFormModel {
  return deepFreeze(structuredClone(form))
}

export function immutableRuntimeDescriptor(runtime: UiRuntimeDescriptor): UiRuntimeDescriptor {
  return Object.freeze({
    url: runtime.url,
    version: runtime.version,
  })
}

export function initRecordFormLifecycle(
  record: RecordHandle,
  options: RecordFormLifecycleOptions,
): RecordFormLifecycle | undefined {
  const { applicationId, capabilities, form, formModelTransport, graphql, runtime, setActiveField } = options
  if (!form && !formModelTransport)
    return undefined

  let currentForm = form ? immutableManagedRecordForm(form) : undefined
  let stopTransportSubscription: (() => void) | undefined
  const formListeners = new Set<(form: unknown) => void>()
  const metadataListeners = new Set<(metadata: RecordUiMetadata) => void>()
  const snapshotListeners = new Set<ManagedRecordFormSnapshotListener>()
  const submitPreparations = new Set<RecordFormSubmitPreparation>()
  let currentMetadata = currentForm ? recordUiMetadata(currentForm) : undefined

  const publishFormModel = (updatedForm: unknown) => {
    if (!isManagedRecordFormModel(updatedForm))
      return

    currentForm = immutableManagedRecordForm(updatedForm)
    currentMetadata = recordUiMetadata(currentForm)
    for (const formListener of formListeners)
      formListener(currentForm)
    for (const metadataListener of metadataListeners)
      metadataListener(currentMetadata)
  }

  const startFormModelSubscription = () => {
    if (!stopTransportSubscription && formModelTransport && (formListeners.size > 0 || metadataListeners.size > 0)) {
      stopTransportSubscription = formModelTransport.subscribeFormModel(publishFormModel)
    }
  }

  const stopFormModelSubscription = () => {
    if (formListeners.size === 0 && metadataListeners.size === 0) {
      stopTransportSubscription?.()
      stopTransportSubscription = undefined
    }
  }

  const boundCapabilities: RecordFormCapabilities | undefined = capabilities
    ? {
        ...capabilities,
        createDocumentHandle: request =>
          capabilities.createDocumentHandle(
            request.target
              ? {
                  ...request,
                  target: {
                    ...request.target,
                    sessionId: record.id,
                  },
                }
              : request,
          ),
        decrypt: request =>
          capabilities.decrypt({
            ...request,
            sessionId: record.id,
          }),
        deleteFile: request =>
          capabilities.deleteFile({
            ...request,
            context: {
              ...request.context,
              sessionId: record.id,
            },
          }),
        getDocumentPreview: request =>
          capabilities.getDocumentPreview({
            ...request,
            sessionId: record.id,
          }),
      }
    : undefined

  const bridge: RecordFormBridge = {
    applicationId,
    blurField: fieldName => setActiveField('record.blur', fieldName),
    capabilities: boundCapabilities,
    focusField: fieldName => setActiveField('record.focus', fieldName),
    get form() {
      return currentForm
    },
    graphql,
    get metadata() {
      return currentMetadata
    },
    registerSubmitPreparation: (preparation) => {
      submitPreparations.add(preparation)
      return () => submitPreparations.delete(preparation)
    },
    runtime: runtime ? immutableRuntimeDescriptor(runtime) : undefined,
    subscribe: (listener) => {
      snapshotListeners.add(listener)
      return () => snapshotListeners.delete(listener)
    },
    subscribeFormModel: (listener) => {
      formListeners.add(listener)
      startFormModelSubscription()

      return () => {
        formListeners.delete(listener)
        stopFormModelSubscription()
      }
    },
    subscribeMetadata: (listener) => {
      metadataListeners.add(listener)
      startFormModelSubscription()
      return () => {
        metadataListeners.delete(listener)
        stopFormModelSubscription()
      }
    },
  }
  recordUiBridges.set(record as object, bridge)

  return {
    notifySnapshot: (snapshot: RecordSnapshot) => {
      for (const listener of snapshotListeners)
        listener(snapshot)
    },
    prepareSubmit: async () => {
      const values: Record<string, unknown> = {}
      for (const preparation of submitPreparations) {
        const preparedValues = await preparation()
        if (preparedValues)
          Object.assign(values, preparedValues)
      }
      return values
    },
  }
}

function recordUiMetadata(form: ManagedRecordFormModel): RecordUiMetadata {
  const tableId = deriveTableId(form)
  return Object.freeze({
    fields: form.fields,
    ...(form.recordId ? { recordId: form.recordId } : {}),
    ...(tableId ? { tableId } : {}),
    ...(form.tableName ? { tableName: form.tableName } : {}),
  })
}

export interface FormModelSubscriptionManager {
  handleUpdate: (form: unknown) => void
  subscribeFormModel: (listener: (form: unknown) => void) => () => void
}

export function createFormModelSubscriptionManager(): FormModelSubscriptionManager {
  const formModelListeners = new Set<(form: unknown) => void>()
  let latestFormModel: unknown
  let hasFormModelUpdate = false

  return {
    handleUpdate(form: unknown): void {
      latestFormModel = form
      hasFormModelUpdate = true
      for (const listener of formModelListeners)
        listener(latestFormModel)
    },
    subscribeFormModel(listener: (form: unknown) => void): () => void {
      formModelListeners.add(listener)
      if (hasFormModelUpdate)
        listener(latestFormModel)
      return () => formModelListeners.delete(listener)
    },
  }
}

export function createRecordFormCapabilities(
  requestCapability: <TResult>(type: string, payload: unknown, responseType: string) => Promise<TResult>,
  postMessage: (message: unknown) => void,
  targetOrigin: string,
): RecordFormCapabilities {
  return {
    createDocumentHandle: async (request) => {
      const response = await requestCapability<{ handle: unknown }>('DOCUMENT_CREATE_HANDLE_REQUEST', request, 'DOCUMENT_CREATE_HANDLE_RESPONSE')
      return response.handle
    },
    decrypt: async (request) => {
      const response = await requestCapability<{ value: string }>('DECRYPT_REQUEST', request, 'DECRYPT_RESPONSE')
      return response.value
    },
    deleteFile: async (request) => {
      await requestCapability('DOCUMENT_DELETE_FILE_REQUEST', request, 'DOCUMENT_DELETE_FILE_RESPONSE')
    },
    getDocumentPreview: async (request) => {
      const response = await requestCapability<{ bytes?: unknown, mimeType?: unknown, url?: unknown }>(
        'DOCUMENT_PREVIEW_REQUEST',
        request,
        'DOCUMENT_PREVIEW_RESPONSE',
      )

      if (typeof response.url === 'string' && response.url)
        return { url: response.url }

      if (response.bytes instanceof ArrayBuffer && typeof response.mimeType === 'string' && response.mimeType)
        return { bytes: response.bytes, mimeType: response.mimeType }

      throw invalidResponse('The document preview response was invalid.')
    },
    navigate: async (path) => {
      const url = new URL(path, targetOrigin).toString()
      if (url.startsWith(`${targetOrigin}/`)) {
        postMessage({
          payload: { target: 'same-tab', url },
          type: 'NAVIGATE_REQUEST',
        })
      }
    },
  }
}
