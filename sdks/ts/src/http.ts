import type { Context } from './types'

import { execute as hostExecute } from './host'

/**
 * Represents the configuration for an HTTP request.
 */
export interface HttpRequest {
  body?: any
  headers?: Record<string, string>
  method?: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT'
  url: string
}

/**
 * The result of an HTTP request.
 *
 * The host always answers `action:http/fetch` with this envelope, so the parsed
 * payload is reached through `body` rather than being the resolved value itself.
 */
export interface HttpResponse<T = any> {
  /** The parsed response payload. */
  body: T

  /** Response headers. A header repeated by the server arrives as an array. */
  headers: Record<string, string | string[]>

  /** True when `status` is in the 2xx range. */
  ok: boolean

  /** The HTTP status code returned by the remote server. */
  status: number
}

export async function del<T = any>(url: string, headers: Record<string, string>, context: Context): Promise<HttpResponse<T>> {
  return fetch({ headers, method: 'DELETE', url }, context)
}

/**
 * Executes an HTTP request and returns the status, headers, and parsed body.
 * This provides an ergonomic API for HTTP operations by handling host
 * communication and error checking internally.
 *
 * A non-2xx reply from the remote server is not an error: it resolves with
 * `ok` set to false and the status and body intact. Only a failure to reach
 * the server, or a malformed request, throws.
 *
 * @param request The HTTP request configuration.
 * @param context The execution context for the request.
 * @returns A promise that resolves with the response envelope.
 * @throws Will throw an error if host communication or the network request fails.
 */
export async function fetch<T = any>(request: HttpRequest, context: Context): Promise<HttpResponse<T>> {
  if (!request.url) {
    throw new Error('URL is required for HTTP request')
  }

  const hostRequest = {
    body: request.body ? JSON.stringify(request.body) : undefined,
    headers: request.headers,
    method: request.method ?? 'GET',
    url: request.url,
  }

  const response = await hostExecute('action:http/fetch', hostRequest, context)

  // This `ok` reports whether the host could carry out the call at all, which
  // is a different question from the HTTP status carried inside the payload.
  if (!response.ok) {
    throw new Error(response.error?.message ?? 'HTTP request failed')
  }

  return response.data as HttpResponse<T>
}

export async function get<T = any>(url: string, headers: Record<string, string>, context: Context): Promise<HttpResponse<T>> {
  return fetch({ headers, method: 'GET', url }, context)
}

export async function patch<T = any>(url: string, body: any, headers: Record<string, string>, context: Context): Promise<HttpResponse<T>> {
  return fetch({ body, headers, method: 'PATCH', url }, context)
}

export async function post<T = any>(url: string, body: any, headers: Record<string, string>, context: Context): Promise<HttpResponse<T>> {
  return fetch({ body, headers, method: 'POST', url }, context)
}

export async function put<T = any>(url: string, body: any, headers: Record<string, string>, context: Context): Promise<HttpResponse<T>> {
  return fetch({ body, headers, method: 'PUT', url }, context)
}
