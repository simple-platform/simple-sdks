import type { Context, DocumentHandle, ExternalFileSource, StorageTarget } from './types'

import { execute as hostExecute, executeBytes as hostExecuteBytes } from './host'

/** The host action that answers a stored file's size. */
const STAT = 'action:storage/stat'

/** The host action that answers one range of a stored file as its bytes. */
const READ = 'action:storage/read'

/**
 * The longest range the host answers one read with.
 *
 * `read` and `readRange` cover anything longer in ranges of this size, into one
 * buffer, so it bounds what the host holds for one call rather than what an
 * action can read.
 */
export const MAX_RANGE_BYTES = 16 * 1024 * 1024

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

/**
 * Returns how many bytes a stored file holds, from the store's own record of it
 * rather than the handle's `size`.
 *
 * @param handle The document handle, exactly as a `:document` field holds it.
 * @param context The execution context for the request.
 * @returns A promise that resolves with the file's size in bytes.
 * @throws If the handle does not name a stored file, or the host refuses.
 *
 * @example
 * ```typescript
 * const bytes = await size(record.attachment, request.context)
 * ```
 */
export async function size(handle: DocumentHandle, context: Context): Promise<number> {
  checkHandle(handle)

  const response = await hostExecute<{ size?: unknown }>(STAT, { handle }, context)

  if (!response.ok)
    throw refused(STAT, response.error?.message)

  const answered = response.data?.size

  if (typeof answered !== 'number' || !Number.isSafeInteger(answered) || answered < 0)
    throw new Error(`${STAT} answered without a size: ${JSON.stringify(response.data ?? null)}`)

  return answered
}

/**
 * Returns the whole of a stored file, as its bytes.
 *
 * The size is asked for first, and the file arrives in ranges of at most
 * `MAX_RANGE_BYTES`, each handed over by the host as it is — no JSON and no
 * base64. A file that fits one range arrives as one array holding exactly its
 * bytes. A larger one is read into a single buffer allocated once at exactly
 * the file's size, and is refused before any range is read when this action
 * has no memory for it. A range answered short — a file that changed while it
 * was read — is refused rather than handed over incomplete.
 *
 * Reading is for server actions; a browser action is refused.
 *
 * @param handle The document handle, exactly as a `:document` field holds it.
 * @param context The execution context for the request.
 * @returns A promise that resolves with the file's bytes.
 * @throws If the handle does not name a stored file, the host refuses, or the
 * file changed while it was read.
 *
 * @example
 * ```typescript
 * const bytes = await read(record.attachment, request.context)
 * const text = new TextDecoder().decode(bytes)
 * ```
 */
export async function read(handle: DocumentHandle, context: Context): Promise<Uint8Array> {
  const total = await size(handle, context)

  return total === 0 ? new Uint8Array(0) : readSpan(handle, 0, total, context)
}

/**
 * Returns up to `length` bytes of a stored file, starting `offset` bytes in.
 *
 * The size is asked for first, so the range is held at what the file has past
 * `offset`: one that runs past the end answers with exactly the bytes up to
 * the end, and one that starts at or past the end is refused before any range
 * is read. What is left is read as `read` reads a whole file — in ranges of at
 * most `MAX_RANGE_BYTES`, into one buffer, each range answered in full or
 * refused.
 *
 * Asking for the size first is also what makes a host that cannot read stored
 * files refuse in its own words, before any range is asked of it.
 *
 * @param handle The document handle, exactly as a `:document` field holds it.
 * @param offset How many bytes into the file the range starts, zero or more.
 * @param length How many bytes to read, one or more.
 * @param context The execution context for the request.
 * @returns A promise that resolves with the range's bytes.
 * @throws If the handle or the range is not valid, the range starts at or past
 * the end of the file, or the host refuses.
 *
 * @example
 * ```typescript
 * const head = await readRange(record.attachment, 0, 1024, request.context)
 * ```
 */
export async function readRange(
  handle: DocumentHandle,
  offset: number,
  length: number,
  context: Context,
): Promise<Uint8Array> {
  checkHandle(handle)

  if (!Number.isSafeInteger(offset) || offset < 0)
    throw new Error('A range needs an offset that is a whole number of bytes, zero or more.')

  if (!Number.isSafeInteger(length) || length < 1)
    throw new Error('A range needs at least one byte. Pass a length of one or more, or ask size() how large the file is.')

  const total = await size(handle, context)

  if (offset >= total)
    throw new Error(`The range starts at byte ${offset}, at or past the end of the file, which is ${total} bytes. Ask size() how large the file is, and start the range before its end.`)

  return readSpan(handle, offset, Math.min(length, total - offset), context)
}

/**
 * Exactly `length` bytes from `offset`, which the file's size says are there.
 *
 * One range is returned as the host handed it over. More are read into one
 * buffer, allocated once at exactly `length` before any of them is asked for.
 */
async function readSpan(handle: DocumentHandle, offset: number, length: number, context: Context): Promise<Uint8Array> {
  if (length <= MAX_RANGE_BYTES)
    return readExactly(handle, offset, length, context)

  const bytes = allocate(length)

  for (let done = 0; done < length; done += MAX_RANGE_BYTES) {
    const part = await readExactly(handle, offset + done, Math.min(MAX_RANGE_BYTES, length - done), context)
    bytes.set(part, done)
  }

  return bytes
}

/** One range, which must be answered in full. */
async function readExactly(handle: DocumentHandle, offset: number, length: number, context: Context): Promise<Uint8Array> {
  const response = await hostExecuteBytes(READ, { handle, length, offset }, context)

  if (!response.ok)
    throw new Error(response.error?.message ?? `${READ} failed: The host refused the call and gave no reason.`)

  const part = response.data as Uint8Array

  if (part.length !== length)
    throw new Error(`The file answered ${part.length} bytes for the ${length} at offset ${offset}, so it is not the size it was when the read began. Read it again.`)

  return part
}

/** The error for a call the host refused in its envelope, naming the call. */
function refused(actionName: string, message: string | undefined): Error {
  if (message === undefined || message.trim() === '')
    return new Error(`${actionName} failed: The host refused the call and gave no reason.`)

  return new Error(`${actionName} failed: ${message}`)
}

/** A buffer of exactly `length` bytes, or a refusal saying there is no room. */
function allocate(length: number): Uint8Array {
  try {
    return new Uint8Array(length)
  }
  catch {
    throw new Error(`Reading ${length} bytes needs more memory than this action has. Raise the action's mem_limit, or read the file in parts with readRange.`)
  }
}

/** Whether a handle carries what the host locates a stored file by. */
function checkHandle(handle: DocumentHandle): void {
  for (const member of ['storage_path', 'filename', 'file_hash'] as const) {
    const value: unknown = handle?.[member]

    if (typeof value !== 'string' || value.trim() === '')
      throw new Error(`A document handle needs ${member}. Pass the handle exactly as the :document field holds it.`)
  }
}
