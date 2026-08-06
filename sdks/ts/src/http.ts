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

export async function del<T = any>(url: string, headers: Record<string, string>, context: Context): Promise<T> {
  return fetch({ headers, method: 'DELETE', url }, context)
}

/**
 * Executes an HTTP request and returns the response data directly.
 * This provides an ergonomic API for HTTP operations by handling host communication
 * and error checking internally.
 *
 * @param request The HTTP request configuration.
 * @param context The execution context for the request.
 * @returns A promise that resolves with the HTTP response data.
 * @throws Will throw an error if the request fails or the host returns an error.
 */
export async function fetch<T = any>(request: HttpRequest, context: Context): Promise<T> {
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

  if (!response.ok) {
    throw new Error(response.error?.message ?? 'HTTP request failed')
  }

  return response.data as T
}

export async function get<T = any>(url: string, headers: Record<string, string>, context: Context): Promise<T> {
  return fetch({ headers, method: 'GET', url }, context)
}

export async function patch<T = any>(url: string, body: any, headers: Record<string, string>, context: Context): Promise<T> {
  return fetch({ body, headers, method: 'PATCH', url }, context)
}

export async function post<T = any>(url: string, body: any, headers: Record<string, string>, context: Context): Promise<T> {
  return fetch({ body, headers, method: 'POST', url }, context)
}

export async function put<T = any>(url: string, body: any, headers: Record<string, string>, context: Context): Promise<T> {
  return fetch({ body, headers, method: 'PUT', url }, context)
}
