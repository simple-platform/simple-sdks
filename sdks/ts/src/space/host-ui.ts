import type { SpaceTransport } from './protocol.js'
import type { RecordReference } from './record.js'
import type { JsonObject } from './tasks.js'
import { invalidRequest, invalidResponse, isObjectRecord, PROTOCOL_VERSION, readResponse, SpaceProtocolError } from './protocol.js'
import { isJsonValue } from './tasks.js'

export const HOST_UI_PROTOCOL_VERSION = 1 as const
export interface NewRecordOptions { appId: string, tableName: string, defaults?: JsonObject }
export type PanelContent = ({ kind: 'record' } & RecordReference) | { kind: 'space', spaceId: string }
export interface SimpleNewRecordClient {
  /** Opens the platform form without navigating. Null means the user cancelled. */
  open: (options: NewRecordOptions) => Promise<RecordReference | null>
}
export interface SimplePanelClient {
  /** The host owns the panel chrome; arbitrary workflows use a Space of this app. */
  open: (content: PanelContent) => Promise<{ id: string }>
  close: (id: string) => Promise<boolean>
}
const identifier = (value: unknown) => typeof value === 'string' && /^[\w.-]{1,200}$/.test(value)

export function validateNewRecordOptions(value: unknown): NewRecordOptions {
  if (!isObjectRecord(value) || !identifier(value.appId) || !identifier(value.tableName)
    || (value.defaults !== undefined && (!isObjectRecord(value.defaults) || !isJsonValue(value.defaults) || JSON.stringify(value.defaults).length > 65536))) {
    throw invalidRequest('A new record requires appId, tableName, and optional JSON defaults (up to 64 KB).')
  }
  return { appId: value.appId as string, tableName: value.tableName as string, ...(value.defaults === undefined ? {} : { defaults: value.defaults as JsonObject }) }
}
export function validatePanelContent(value: unknown): PanelContent {
  if (!isObjectRecord(value))
    throw invalidRequest('Panel content must name a record or an app-owned Space.')
  if (value.kind === 'record' && identifier(value.appId) && identifier(value.tableName) && identifier(value.recordId))
    return { appId: value.appId as string, kind: 'record', recordId: value.recordId as string, tableName: value.tableName as string }
  if (value.kind === 'space' && identifier(value.spaceId))
    return { kind: 'space', spaceId: value.spaceId as string }
  throw invalidRequest('Panel content must name a record or an app-owned Space.')
}
export function createHostUiClients(transport: SpaceTransport | undefined, nextRequestId: () => string): { newRecord: SimpleNewRecordClient, panel: SimplePanelClient } {
  const request = async <T>(operation: string, payload: unknown): Promise<T> => {
    if (!transport)
      throw new SpaceProtocolError({ code: 'unavailable', message: 'Host dialogs and panels are unavailable in this host.' })
    const envelope = { operation, payload, protocol: PROTOCOL_VERSION, requestId: nextRequestId() }
    return readResponse(await transport.request<T>(envelope), envelope)
  }
  return {
    newRecord: { open: async (options) => {
      const result = await request<RecordReference | null>('ui.newRecord.open', validateNewRecordOptions(options))
      if (result !== null && (!isObjectRecord(result) || !identifier(result.appId) || !identifier(result.tableName) || !identifier(result.recordId)))
        throw invalidResponse('The new-record result is malformed.')
      return result
    } },
    panel: {
      close: async (id) => {
        if (!identifier(id))
          throw invalidRequest('Panel id must be a non-empty identifier.')
        const result = await request<boolean>('ui.panel.close', { id })
        if (typeof result !== 'boolean')
          throw invalidResponse('The panel close result is malformed.')
        return result
      },
      open: async (content) => {
        const result = await request<{ id: string }>('ui.panel.open', validatePanelContent(content))
        if (!isObjectRecord(result) || !identifier(result.id))
          throw invalidResponse('The panel result is malformed.')
        return result
      },
    },
  }
}
