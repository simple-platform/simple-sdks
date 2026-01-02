import type { Context } from './types'

import { execute as hostExecute } from './host'

/**
 * Retrieves application settings for the specified keys.
 * This function communicates with the host system's settings action and returns
 * a map of the requested settings.
 *
 * @param appId The application identifier for which to retrieve settings.
 * @param keys An array of setting keys to retrieve.
 * @param context The execution context.
 * @returns A promise that resolves with a map containing the requested settings.
 * @throws Will throw an error if the request fails or the host returns an error.
 */
export async function get(appId: string, keys: string[], context: Context): Promise<Record<string, any>> {
  if (!appId) {
    throw new Error('appId is required for settings retrieval')
  }
  if (!keys || keys.length === 0) {
    throw new Error('setting keys are required for settings retrieval')
  }

  const response = await hostExecute('action:settings/get', { app_id: appId, keys }, context)

  if (!response.ok) {
    throw new Error(response.error?.message ?? 'Settings retrieval failed')
  }

  return response.data as Record<string, any>
}
