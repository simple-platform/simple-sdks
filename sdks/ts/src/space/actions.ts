import type { ProtocolRequest, SpaceTransport } from './protocol.js'
import type { JsonValue } from './tasks.js'
import {
  invalidRequest,
  isObjectRecord,
  PROTOCOL_VERSION,
  readResponse,
  requestWithin,
  SpaceProtocolError,
} from './protocol.js'
import { isJsonValue } from './tasks.js'

export { requestWithin }

export interface ActionRunOptions {
  /**
   * How long the host waits for the action before it stops and answers
   * `timeout`, in milliseconds. The host uses 60,000 when it is left out and
   * accepts 1,000 to 1,200,000.
   */
  timeoutMs?: number
}

/** The `details` of a `SpaceProtocolError` whose code is `action_failed`. */
export interface ActionFailedDetails {
  /** The action's response body as parsed JSON, or `null` when it was not JSON. */
  body: JsonValue
  /**
   * The HTTP status the server answered with. An action the host ran in the
   * browser (declared `client` or `both`) carries 200, the status the server
   * gives the same failure, and its `body` has the same `{ error: [...] }` shape.
   */
  status: number
}

export interface SimpleActionsClient {
  /**
   * Runs an action of this Space's own app where the app declares it runs
   * (on the server, or in the browser for a `client` or `both` action), as
   * the signed-in user, and returns its JSON result as the action returned it. The host
   * adds the app, so `action` is the name alone, such as `document-attach`.
   */
  run: <TResult = unknown>(action: string, input: unknown, options?: ActionRunOptions) => Promise<TResult>
}

export interface ActionRunRequest extends ProtocolRequest<{
  /** The action's name within the Space's own app; the host adds the app. */
  action: string
  input: JsonValue
  timeoutMs?: number
}> {
  operation: 'action.run'
}

/** An action's name within its app, as the host checks it before adding the app. */
const ACTION_NAME = /^[a-z0-9][a-z0-9-]*$/

/** The host's timeout for an action run that names none. */
const DEFAULT_ACTION_TIMEOUT_MS = 60_000
/** How much longer than the host's timeout the client waits for its answer. */
const ACTION_ANSWER_GRACE_MS = 5_000
/** The longest delay `setTimeout` keeps; it runs a longer one at once. */
const MAX_TIMER_MS = 2_147_483_647

/**
 * How long a run waits for the host. The host answers `timeout` itself at the
 * timeout, so this wait only ends a run whose answer never comes, as when the
 * host has closed its port. A timeout the host refuses is answered at once, so
 * it only needs to give a delay a timer can hold.
 */
export function actionWaitMs(timeoutMs: number | undefined): number {
  const hostTimeoutMs = Math.max(timeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS, 0)
  return Math.min(hostTimeoutMs + ACTION_ANSWER_GRACE_MS, MAX_TIMER_MS)
}

/**
 * Checks an action run before it is sent. The timeout's range is the host's to
 * enforce, so only its type is checked here, and it is sent only when given.
 */
export function readActionRunPayload(
  action: string,
  input: unknown,
  options: ActionRunOptions | undefined,
): ActionRunRequest['payload'] {
  if (typeof action !== 'string' || !ACTION_NAME.test(action))
    throw invalidRequest('An action is named alone, in lowercase letters, digits, and hyphens, such as "document-attach".')
  if (!isJsonValue(input))
    throw invalidRequest('An action input must be a JSON value, and everything in it a JSON value.')
  if (options !== undefined && !isObjectRecord(options))
    throw invalidRequest('Action options must be an object.')

  const timeoutMs = options?.timeoutMs
  if (timeoutMs !== undefined && (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs)))
    throw invalidRequest('An action timeout must be a number of milliseconds.')

  return {
    action,
    input,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  }
}

/**
 * The host binds the Space's own app to every action it runs, so a Space names
 * only the action and cannot reach another app's. Actions are not tied to a
 * page record, so they are available in any Space whose host negotiated the
 * action protocol, standalone or record.
 */
export function createActionsClient(
  transport: SpaceTransport | undefined,
  nextRequestId: () => string,
): SimpleActionsClient {
  return {
    async run<TResult = unknown>(action: string, input: unknown, options?: ActionRunOptions): Promise<TResult> {
      if (!transport) {
        throw new SpaceProtocolError({
          code: 'unavailable',
          message: 'Actions are unavailable because the Space host did not negotiate the action protocol.',
        })
      }

      const payload = readActionRunPayload(action, input, options)
      const request: ActionRunRequest = {
        operation: 'action.run',
        payload,
        protocol: PROTOCOL_VERSION,
        requestId: nextRequestId(),
      }
      const response = await requestWithin<TResult>(transport, request, actionWaitMs(payload.timeoutMs))
      // Any JSON value is a valid result, so it is returned as the host sent it.
      return readResponse(response, request)
    },
  }
}
