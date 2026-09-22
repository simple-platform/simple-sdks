import type { Context, SimpleResponse } from './types'

interface HostBridge {
  call?: unknown
  callBytes?: unknown
  cast?: unknown
  getContext?: unknown
  getContextSize?: unknown
  getExecutionResult?: unknown
  getExecutionResultSize?: unknown
}

const ABI_MISMATCH_MESSAGE = 'Simple SDK 2.0.0 requires the value-based runtime ABI: __host.call and __host.cast accept values, and __host.getContext returns the execution context. Install a runtime plugin released with the matching SDK.'

function assertRuntimeAbi(): void {
  const host = (globalThis as { __host?: HostBridge }).__host
  const hasValueBridge = typeof host?.call === 'function'
    && typeof host.cast === 'function'
    && typeof host.getContext === 'function'
  const hasLegacyBridge = typeof host?.getContextSize === 'function'
    || typeof host?.getExecutionResult === 'function'
    || typeof host?.getExecutionResultSize === 'function'

  if (!hasValueBridge || hasLegacyBridge) {
    throw new Error(ABI_MISMATCH_MESSAGE)
  }
}

const BYTES_ABI_MISSING_MESSAGE = 'Reading a reply as bytes needs __host.callBytes, which this runtime plugin does not provide. Install a runtime plugin released with the matching SDK.'

/**
 * Calls an action on the host and returns its response.
 *
 * The runtime owns serialization and memory for this boundary. The SDK passes
 * the action name and parameters as JavaScript values, and the host returns the
 * parsed response as a value.
 */
export function execute<T = any>(actionName: string, params: any, context: Context): SimpleResponse<T> {
  assertRuntimeAbi()
  void context

  return __host.call(actionName, params ?? null) as SimpleResponse<T>
}

/**
 * Calls an action whose reply is a run of bytes, such as a range of a stored
 * file, and returns them.
 *
 * The runtime hands the bytes over as a `Uint8Array` that owns them: no JSON,
 * no base64, and no address. A host that refused answers with its ordinary
 * envelope instead, returned here as a failed response, so a caller checks
 * `ok` exactly as it does for `execute`. Its message names the call — `<action>
 * failed: <the host's reason>` — worded as the Rust and Go SDKs word it.
 *
 * A runtime plugin released before this call existed does not provide it, and
 * is refused here, before anything is sent, rather than handed a reply it
 * would try to read as JSON.
 */
export function executeBytes(actionName: string, params: any, context: Context): SimpleResponse<Uint8Array> {
  assertRuntimeAbi()
  void context

  if (typeof __host.callBytes !== 'function') {
    throw new TypeError(BYTES_ABI_MISSING_MESSAGE)
  }

  const reply = __host.callBytes(actionName, params ?? null)

  if (reply instanceof Uint8Array) {
    return { data: reply, ok: true }
  }

  // The runtime answers with bytes or with the host's refusal, and nothing
  // else. A refusal that says it succeeded is still a refusal: no bytes came.
  const refusal = reply as SimpleResponse | null | undefined

  if (refusal?.ok !== false)
    return { error: { message: `${actionName} was refused and gave no reason.` }, ok: false }

  const reason = refusal.error?.message

  if (typeof reason !== 'string' || reason.trim() === '')
    return { error: { message: `${actionName} failed: The host refused the call and gave no reason.` }, ok: false }

  return { error: { message: `${actionName} failed: ${reason}` }, ok: false }
}

/**
 * Calls an action on the host without waiting for it to answer.
 */
export function executeAsync(actionName: string, params: any, context: Context): void {
  assertRuntimeAbi()
  void context

  __host.cast(actionName, params ?? null)
}

/**
 * Returns the execution context the host assembled for this run.
 */
export function getContext(): any {
  assertRuntimeAbi()

  return __host.getContext()
}
