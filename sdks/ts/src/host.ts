import type { Context, SimpleResponse } from './types'

import { allocate, deallocate, decoder, readBufferSlice, stringToPtr } from './internal/memory'

// This is a "magic" constant that will be replaced by `true` or `false`
// by the esbuild --define flag during the build process.
declare const __ASYNC_BUILD__: boolean

/**
 * Executes an action synchronously on the host system and returns the response.
 *
 * NOTE: The memory model for this execution is that the entire WASM instance is
 * ephemeral. Memory is allocated for this single execution and then discarded
 * when the instance is terminated. Therefore, a manual memory reset is not required.
 *
 * This function has two internal implementations selected at build time:
 * 1. ASYNC_BUILD = true: For browsers, uses Asyncify to pause/resume execution.
 * 2. ASYNC_BUILD = false: For Elixir, uses a synchronous call-and-get-result pattern.
 */
export function execute<T = any>(actionName: string, params: any, context: Context): SimpleResponse<T> {
  // We must track the pointers for the parameters so we can free them after the call.
  // They are declared here to be accessible in the `finally` block.
  let actionNamePtr = 0
  let actionNameLen = 0
  let paramsPtr = 0
  let paramsLen = 0
  let contextPtr = 0
  let contextLen = 0

  try {
    const paramsJSON = JSON.stringify(params ?? null)
    const contextJSON = JSON.stringify(context)

    ;[actionNamePtr, actionNameLen] = stringToPtr(actionName)
    ;[paramsPtr, paramsLen] = stringToPtr(paramsJSON)
    ;[contextPtr, contextLen] = stringToPtr(contextJSON)

    if (__ASYNC_BUILD__) {
      // --- ASYNCIFY-AWARE PATH (FOR BROWSER) ---
      let responsePtr = 0
      let responseLen = 0

      try {
        // State 2 is "Rewinding". This check implements the stateful "double call"
        // pattern required by Asyncify.
        if (asyncify_get_state() === 2) {
          // This is the second call, during the rewind. We just need to stop the
          // rewind so that normal execution can resume.
          asyncify_stop_rewind()
        }
        else {
          // This is the first call. Call the host to start the async operation.
          // The host will then trigger the unwind.
          __host.call(actionNamePtr, actionNameLen, paramsPtr, paramsLen, contextPtr, contextLen)
        }

        // --- EXECUTION PAUSES HERE OR CONTINUES AFTER REWIND IS STOPPED ---

        // The host has placed the response in memory. Read it using pointers
        // retrieved from the Javy plugin.
        responsePtr = __wasm.get_response_ptr()
        responseLen = __wasm.get_response_len()

        const resultBytes = readBufferSlice(responsePtr, responseLen)
        const resultJSON = decoder.decode(resultBytes)

        // Immediately clear the response buffer pointers in the Javy plugin to
        // prevent reading stale data on subsequent nested calls.
        __wasm.clear_response_buffer()

        return JSON.parse(resultJSON) as SimpleResponse<T>
      }
      finally {
        // 1. Free the result buffer allocated by the host.
        if (responsePtr > 0) {
          deallocate(responsePtr, responseLen)
        }
      }
    }
    else {
      // --- SYNCHRONOUS PATH (FOR ELIXIR BACKEND) ---
      let resultPtr = 0
      let resultLen = 0

      try {
        // 1. Make the synchronous call. The host now holds the result.
        __host.call(actionNamePtr, actionNameLen, paramsPtr, paramsLen, contextPtr, contextLen)

        // 2. Ask the host for the size of the result.
        resultLen = __host.getExecutionResultSize()
        if (resultLen === 0) {
          return { error: { message: 'Host returned an empty result.' }, ok: false }
        }

        // 3. Allocate memory inside WASM for the result.
        resultPtr = allocate(resultLen)

        // 4. Ask the host to write the result into our buffer.
        __host.getExecutionResult(resultPtr)

        // 5. Read the result from our buffer and return it.
        const resultBytes = readBufferSlice(resultPtr, resultLen)
        const resultJSON = decoder.decode(resultBytes)

        return JSON.parse(resultJSON) as SimpleResponse<T>
      }
      finally {
        // Free the result buffer allocated by us.
        if (resultPtr > 0) {
          deallocate(resultPtr, resultLen)
        }
      }
    }
  }
  finally {
    // 2. Free the parameter buffers we allocated before the host call.
    if (actionNamePtr > 0) {
      deallocate(actionNamePtr, actionNameLen)
    }

    if (paramsPtr > 0) {
      deallocate(paramsPtr, paramsLen)
    }

    if (contextPtr > 0) {
      deallocate(contextPtr, contextLen)
    }
  }
}

/**
 * Executes an action asynchronously on the host system (fire-and-forget).
 */
export function executeAsync(actionName: string, params: any, context: Context): void {
  const paramsJSON = JSON.stringify(params ?? null)
  const contextJSON = JSON.stringify(context)

  const [actionNamePtr, actionNameLen] = stringToPtr(actionName)
  const [paramsPtr, paramsLen] = stringToPtr(paramsJSON)
  const [contextPtr, contextLen] = stringToPtr(contextJSON)

  // Make the asynchronous (fire-and-forget) call to the host.
  __host.cast(actionNamePtr, actionNameLen, paramsPtr, paramsLen, contextPtr, contextLen)
}

/**
 * Retrieves the initial context payload from the host. This function orchestrates
 * the "pull" mechanism required by the execution environment.
 *
 * It first asks the host for the payload size, then allocates memory within
 * the WASM module, and finally asks the host to write the payload into the
 * allocated buffer.
 *
 * @returns A Uint8Array containing the context payload.
 */
export function getContext(): Uint8Array {
  // Ask the host for the size of the data.
  const size = __host.getContextSize()
  if (size === 0) {
    return new Uint8Array(0)
  }

  // Allocate memory for the data inside the WASM module's buffer.
  const ptr = allocate(size)
  let buffer: Uint8Array

  try {
    // Ask the host to write the data into the allocated memory region.
    __host.getContext(ptr)

    // Now that the data is in our memory, create a slice to read it.
    buffer = readBufferSlice(ptr, size)
  }
  finally {
    // Free the memory we allocated now that the data is in a JS-owned buffer.
    deallocate(ptr, size)
  }

  return buffer
}
