import type { RecordHandle } from '@simpleplatform/sdk/space'
import type { RuntimeDescriptor } from '../runtime.js'

const MANAGED_RECORD_UI_SYMBOL = Symbol.for('@simpleplatform/sdk/space/managed-record-ui/v1')

interface ManagedRecordMetadata {
  fields: unknown
  recordId?: string
  tableId?: string
}

interface ManagedRecordCapabilities {
  decrypt?: (request: { appId: string, fieldName: string, recordId: string, tableName: string }) => Promise<string>
  navigate?: (path: string) => Promise<void>
}

interface ManagedRecordBridge {
  applicationId?: string
  blurField: (fieldName: string) => Promise<void>
  capabilities?: ManagedRecordCapabilities
  focusField: (fieldName: string) => Promise<void>
  form?: unknown
  graphql: (document: string, variables?: Readonly<Record<string, unknown>>) => Promise<unknown>
  metadata?: ManagedRecordMetadata
  registerSubmitPreparation: (preparation: () => Promise<Readonly<Record<string, unknown>> | undefined>) => () => void
  runtime?: RuntimeDescriptor
  subscribe: (listener: (snapshot: unknown) => void) => () => void
  subscribeFormModel: (listener: (form: unknown) => void) => () => void
  subscribeMetadata: (listener: (metadata: ManagedRecordMetadata) => void) => () => void
}

/** Finds the SDK-owned bridge without adding a package export or RecordHandle member. */
export function getManagedRecordBridge(record: RecordHandle): ManagedRecordBridge | undefined {
  if (!record || typeof record !== 'object')
    return undefined

  const bridge = (record as unknown as Record<symbol, unknown>)[MANAGED_RECORD_UI_SYMBOL]
  return bridge && typeof bridge === 'object' ? bridge as ManagedRecordBridge : undefined
}
