/**
 * @file SDK Worker Override Module.
 * This file exports worker-compatible implementations of `execute` and
 * `executeAsync`. The SDK's build tool will use esbuild's `alias` feature
 * to replace the original `@simple/sdk/host` module with this one during
 * the async application build.
 */

// State and listeners are sandboxed within this module's closure.
const pendingHostRequests = new Map()

// eslint-disable-next-line no-restricted-globals
self.addEventListener('message', (event) => {
  const message = event.data
  if (message.type !== 'host_response')
    return

  const pending = pendingHostRequests.get(message.requestId)
  if (!pending)
    return

  message.response.ok
    ? pending.resolve(message.response)
    : pending.reject(new Error(message.response.error ?? 'Unknown host error'))

  pendingHostRequests.delete(message.requestId)
})

/**
 * Worker-compatible implementation that returns a Promise and uses postMessage.
 * @returns {Promise<import('./types').SimpleResponse<any>>} A promise that resolves with the host response
 */
export function execute(actionName, params, context) {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID()
    pendingHostRequests.set(requestId, { reject, resolve })

    const hostRequest = {
      context,
      executionId: context.logic.execution_id,
      name: actionName,
      params,
      type: 'hostRequest',
    }

    // eslint-disable-next-line no-restricted-globals
    self.postMessage({
      request: hostRequest,
      requestId,
      type: 'host_request',
    })
  })
}

/**
 * Worker-compatible fire-and-forget implementation.
 */
export function executeAsync(actionName, params, context) {
  const hostRequest = {
    context,
    executionId: context.logic.execution_id,
    name: actionName,
    params,
    type: 'hostRequest',
  }

  // eslint-disable-next-line no-restricted-globals
  self.postMessage({
    request: hostRequest,
    type: 'host_cast',
  })
}

/**
 * This module replaces host.ts, which also exports getContext.
 * We provide a stub here, as it's not used in the worker context.
 */
export function getContext() {
  console.warn('getContext() was called in a script worker context, which is not supported.')
  return new Uint8Array(0)
}
