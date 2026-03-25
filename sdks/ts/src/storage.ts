import type { Context, DocumentHandle, ExternalFileSource, StorageTarget } from './types'

import { execute as hostExecute } from './host'

/**
 * Uploads an in-memory binary buffer as a document to the platform's storage system.
 *
 * Accepts any binary content (images, PDFs, etc.) as an `ArrayBuffer` or `Uint8Array`.
 * The bytes are base64-encoded once here at the JSON boundary, decoded on the backend,
 * and then stored via the same pipeline as `uploadExternal`.
 *
 * @param buffer The binary content to upload.
 * @param filename The filename to assign to the stored document.
 * @param mimeType The MIME type of the content (e.g. `'application/pdf'`, `'image/png'`).
 * @param target The target location where the file should be stored.
 * @param context The execution context for the request.
 * @returns A promise that resolves with a DocumentHandle containing file metadata.
 *
 * @example
 * ```typescript
 * const handle = await uploadBuffer(
 *   pdfBytes,
 *   'report.pdf',
 *   'application/pdf',
 *   { app_id: 'dev.simple.system', table_name: 'documents', field_name: 'attachment' },
 *   context
 * )
 * ```
 */
export async function uploadBuffer(
  buffer: ArrayBuffer | Uint8Array,
  filename: string,
  mimeType: string,
  target: StorageTarget,
  context: Context,
): Promise<DocumentHandle> {
  if (!filename || filename.trim() === '')
    throw new Error('filename is required')

  if (!mimeType || mimeType.trim() === '')
    throw new Error('mimeType is required')

  if (!target.app_id || target.app_id.trim() === '')
    throw new Error('Target app_id is required and cannot be empty')

  if (!target.table_name || target.table_name.trim() === '')
    throw new Error('Target table_name is required and cannot be empty')

  if (!target.field_name || target.field_name.trim() === '')
    throw new Error('Target field_name is required and cannot be empty')

  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer

  // Base64-encode at the JSON boundary (JSON.stringify cannot carry raw binary)
  const base64 = btoa(String.fromCharCode(...bytes))

  const source: ExternalFileSource = { bytes: base64, filename, mime_type: mimeType }

  const response = await hostExecute<DocumentHandle>(
    'action:storage/upload-external',
    { source, target },
    context,
  )

  if (!response.ok)
    throw new Error(response.error?.message ?? 'Buffer upload failed')

  return response.data as DocumentHandle
}

/**
 * Uploads a file from an external URL to the platform's storage system.
 *
 * This function downloads a file from the specified external source and uploads it
 * to the target location in the platform's storage. The file is content-addressed
 * using SHA-256 hashing, enabling automatic deduplication.
 *
 * @param source The external file source configuration including URL and optional authentication.
 * @param target The target location where the file should be stored.
 * @param context The execution context for the request.
 * @returns A promise that resolves with a DocumentHandle containing file metadata.
 * @throws Will throw an error if validation fails or the upload operation fails.
 *
 * @example
 * ```typescript
 * const handle = await uploadExternal(
 *   {
 *     url: 'https://example.com/document.pdf',
 *     auth: {
 *       type: 'bearer',
 *       bearer_token: 'your-token-here'
 *     }
 *   },
 *   {
 *     app_id: 'dev.simple.system',
 *     table_name: 'documents',
 *     field_name: 'attachment'
 *   },
 *   context
 * );
 * ```
 */
export async function uploadExternal(
  source: ExternalFileSource,
  target: StorageTarget,
  context: Context,
): Promise<DocumentHandle> {
  // Validate source: must have either url or bytes
  if ((!source.url || source.url.trim() === '') && !source.bytes) {
    throw new Error('Either source URL or bytes must be provided')
  }

  // Validate target
  if (!target.app_id || target.app_id.trim() === '') {
    throw new Error('Target app_id is required and cannot be empty')
  }

  if (!target.table_name || target.table_name.trim() === '') {
    throw new Error('Target table_name is required and cannot be empty')
  }

  if (!target.field_name || target.field_name.trim() === '') {
    throw new Error('Target field_name is required and cannot be empty')
  }

  // Validate auth if provided
  if (source.auth) {
    if (source.auth.type !== 'basic' && source.auth.type !== 'bearer') {
      throw new Error('Auth type must be either "basic" or "bearer"')
    }

    if (source.auth.type === 'bearer' && (!source.auth.bearer_token || source.auth.bearer_token.trim() === '')) {
      throw new Error('Bearer token is required when auth type is "bearer"')
    }

    if (source.auth.type === 'basic') {
      if (!source.auth.username || source.auth.username.trim() === '') {
        throw new Error('Username is required when auth type is "basic"')
      }

      if (!source.auth.password || source.auth.password.trim() === '') {
        throw new Error('Password is required when auth type is "basic"')
      }
    }
  }

  // Call the host function
  const response = await hostExecute<DocumentHandle>(
    'action:storage/upload-external',
    { source, target },
    context,
  )

  if (!response.ok) {
    throw new Error(response.error?.message ?? 'External file upload failed')
  }

  return response.data as DocumentHandle
}
