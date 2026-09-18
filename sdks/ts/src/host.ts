import type { Context, SimpleResponse } from './types'

interface HostBridge {
  call?: unknown
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
