import type { DocumentHandle } from '../types.js'
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

/** A file stored but not yet attached to a record. */
export interface StagedDocumentHandle extends DocumentHandle {
  scope?: 'ephemeral' | 'record' | 'staged'
}

export interface DocumentStageInput {
  /** The file to stage. Its bytes are transferred to the host, not copied. */
  file: Blob | File
  /** Defaults to the file's own type, then to `application/octet-stream`. */
  mimeType?: string
  /** Defaults to a File's name. A plain Blob needs an explicit name. */
  name?: string
}

export interface DocumentStageResult {
  handle: StagedDocumentHandle
}

export interface SimpleDocumentsClient {
  stage: (document: DocumentStageInput) => Promise<DocumentStageResult>
}

interface DocumentStageRequest extends ProtocolRequest<{
  /** Transferred with the request, so it is detached in the Space afterwards. */
  bytes: ArrayBuffer
  mimeType: string
  name: string
}> {
  operation: 'document.stage'
}

/**
 * Uploads a file to staging without attaching it to a record. The host owns
 * storage and returns only the document handle needed by the Space's workflow.
 */
export function createDocumentsClient(
  transport: SpaceTransport | undefined,
  nextRequestId: () => string,
): SimpleDocumentsClient {
  return {
    async stage(document) {
      if (!transport) {
        throw new SpaceProtocolError({
          code: 'unavailable',
          message: 'Documents are unavailable because the Space host did not negotiate the document protocol.',
        })
      }

      const { file, mimeType, name } = readDocumentStageInput(document)
      const bytes = await file.arrayBuffer()
      const request: DocumentStageRequest = {
        operation: 'document.stage',
        payload: { bytes, mimeType, name },
        protocol: PROTOCOL_VERSION,
        requestId: nextRequestId(),
      }
      const response = await transport.request<DocumentStageResult>(request, [bytes])
      const result = readResponse(response, request)

      if (!isDocumentStageResult(result))
        throw invalidResponse('The document-stage response is malformed.')

      // Preserve host-added handle metadata while returning a Space-owned value.
      return { handle: { ...result.handle } }
    },
  }
}

function readDocumentStageInput(document: DocumentStageInput): { file: Blob, mimeType: string, name: string } {
  if (!isObjectRecord(document) || !isBlob(document.file))
    throw invalidRequest('A staged document needs a File or Blob.')

  const name = document.name ?? readFileName(document.file)
  if (!isNonBlankString(name))
    throw invalidRequest('A staged document needs a name, and a Blob has none of its own.')
  if (document.mimeType !== undefined && typeof document.mimeType !== 'string')
    throw invalidRequest('A staged document type must be a MIME type.')

  return {
    file: document.file,
    mimeType: document.mimeType || document.file.type || 'application/octet-stream',
    name,
  }
}

/** Duck-typed so a Blob from another realm, or a test double, is accepted. */
function isBlob(value: unknown): value is Blob {
  return isObjectRecord(value)
    && typeof value.arrayBuffer === 'function'
    && typeof value.size === 'number'
    && typeof value.type === 'string'
}

function readFileName(file: Blob): string | undefined {
  const { name } = file as Partial<File>
  return typeof name === 'string' ? name : undefined
}

const DOCUMENT_SCOPES: ReadonlySet<unknown> = new Set<StagedDocumentHandle['scope']>([
  'ephemeral',
  'record',
  'staged',
])

function isDocumentStageResult(value: unknown): value is DocumentStageResult {
  if (!isObjectRecord(value) || !isObjectRecord(value.handle))
    return false

  const handle = value.handle
  return isNonBlankString(handle.file_hash)
    && isNonBlankString(handle.filename)
    && typeof handle.mime_type === 'string'
    && isNonNegativeInteger(handle.size)
    && isNonBlankString(handle.storage_path)
    && (handle.scope === undefined || DOCUMENT_SCOPES.has(handle.scope))
}
