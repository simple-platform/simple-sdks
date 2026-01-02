import type { Context, DocumentHandle, ExternalFileSource, StorageTarget } from './types'

import { execute as hostExecute } from './host'

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
  // Validate source
  if (!source.url || source.url.trim() === '') {
    throw new Error('Source URL is required and cannot be empty')
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
