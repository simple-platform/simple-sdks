export const PROTOCOL_VERSION = 1 as const

export interface SpaceProtocolErrorPayload {
  code: string
  details?: unknown
  message: string
}

export class SpaceProtocolError extends Error {
  readonly code: string
  readonly details?: unknown

  constructor({ code, details, message }: SpaceProtocolErrorPayload) {
    super(message)
    this.name = 'SpaceProtocolError'
    this.code = code
    this.details = details
  }
}

export interface SpaceDataErrorPayload {
  code: string
  details?: unknown
  message: string
}

export class SpaceDataError extends Error {
  readonly code: string
  readonly details?: unknown

  constructor({ code, details, message }: SpaceDataErrorPayload) {
    super(message)
    this.name = 'SpaceDataError'
    this.code = code
    this.details = details
  }
}

export interface ProtocolRequest<TPayload = unknown> {
  operation: string
  payload: TPayload
  protocol: typeof PROTOCOL_VERSION
  requestId: string
}

export interface ProtocolSuccessResponse<TResult> {
  ok: true
  protocol: typeof PROTOCOL_VERSION
  requestId: string
  result: TResult
}

export interface ProtocolErrorResponse {
  error: SpaceProtocolErrorPayload
  ok: false
  protocol: typeof PROTOCOL_VERSION
  requestId: string
}

export type ProtocolResponse<TResult>
  = | ProtocolErrorResponse
    | ProtocolSuccessResponse<TResult>

export interface SpaceTransport {
  /**
   * `transfer` names buffers inside the request whose ownership moves to the
   * host with it instead of being copied. A transport that cannot transfer
   * sends them by value. When `signal` aborts, the transport forgets the
   * request, so a late answer is dropped, and rejects with the signal's reason.
   */
  request: <TResult>(request: ProtocolRequest, transfer?: ArrayBuffer[], signal?: AbortSignal) => Promise<ProtocolResponse<TResult>>
}

export function createRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID()

  return `space-request-${Math.random().toString(36).slice(2)}`
}

export function readResponse<TResult>(
  response: ProtocolResponse<TResult>,
  request: { protocol: typeof PROTOCOL_VERSION, requestId: string },
): TResult {
  if (response.protocol !== PROTOCOL_VERSION || response.requestId !== request.requestId) {
    throw invalidResponse('The response does not match the request envelope.')
  }

  if (!response.ok)
    throw new SpaceProtocolError(response.error)

  return response.result
}

export function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value))
    return value

  for (const child of Object.values(value))
    deepFreeze(child)

  return Object.freeze(value)
}

export function invalidResponse(message: string): SpaceProtocolError {
  return new SpaceProtocolError({ code: 'invalid_response', message })
}

export function invalidRequest(message: string): SpaceProtocolError {
  return new SpaceProtocolError({ code: 'invalid_request', message })
}

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}
