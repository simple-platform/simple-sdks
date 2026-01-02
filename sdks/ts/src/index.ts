import type { Context, SimpleRequest, SimpleResponse } from './types'
import * as host from './host'

import './internal/global'

export * from './storage'
export * from './types'

/**
 * Defines the signature for a user's action handler.
 */
export type Handler<TResult = any> = (request: Request) => Promise<TResult> | TResult

/**
 * Represents an incoming action request with ergonomic access to its data.
 * This class will be exposed as `simple.Request`.
 */
export class Request {
  public readonly context: Context
  public readonly headers: Record<string, any>
  private readonly rawData: string

  constructor(simpleRequest: SimpleRequest) {
    this.context = simpleRequest.context
    this.headers = simpleRequest.headers
    this.rawData = simpleRequest.data ?? ''
  }

  /** Returns the raw data string from the request. */
  data(): string {
    return this.rawData
  }

  /** Parses the request data JSON into a new object. */
  parse<T>(): T {
    if (!this.rawData) {
      throw new Error('no data to parse')
    }
    try {
      return JSON.parse(this.rawData) as T
    }
    catch (e: any) {
      throw new Error(`failed to parse data: ${e.message}`)
    }
  }
}

function execute<T = any>(actionName: string, params: any, context: Context): SimpleResponse<T> {
  return host.execute(actionName, params, context)
}

// --- Internal Implementations ---

function executeAsync(actionName: string, params: any, context: Context): void {
  return host.executeAsync(actionName, params, context)
}

/**
 * The main entry point for a Simple Logic action.
 *
 * This function provides a transparent developer experience by detecting the
 * execution environment and choosing the optimal strategy.
 *
 * - In a synchronous environment (like the Elixir backend), it executes the
 *   handler directly. With QuickJS's event loop enabled, it can now correctly
 *   await async handlers and their host calls.
 * - In an asynchronous, constrained environment (like the browser), it
 *   automatically offloads the *entire bundled application script* to an
 *   unconstrained script worker for execution.
 *
 * @returns In most environments, this function returns `Promise<void>` as it
 *   signals completion via a fire-and-forget host call. However, when executed
 *   inside the script worker (`__IS_WORKER_BUILD__`), it returns the `Promise`
 *   from the user's handler. This is critical for allowing the script worker
 *   to correctly `await` the completion of the user's async logic.
 */
async function handle(handler: Handler): Promise<any> {
  // Context 2: We are inside the unconstrained script worker.
  // This is the highest-priority check.
  if (typeof __IS_WORKER_BUILD__ !== 'undefined' && __IS_WORKER_BUILD__) {
    // The wrapper (`build.js`) is responsible for the try/catch block.
    // The job of `handle` here is ONLY to parse the input and pass the
    // resulting promise to the wrapper via the secure channel.
    const inputText = readInputFromHost()

    if (!inputText) {
      // If setup fails, we must put a rejected promise on the channel.
      const error = new Error('no input payload provided by the host environment')
      if ((globalThis as any).__SIMPLE_PROMISE_CHANNEL__) {
        ; (globalThis as any).__SIMPLE_PROMISE_CHANNEL__.promise = Promise.reject(error)
      }

      // Re-throwing ensures the worker's main catch block can see the error too.
      throw error
    }

    const simpleReq: SimpleRequest = JSON.parse(inputText)
    const request = new Request(simpleReq)
    const resultPromise = Promise.resolve(handler(request))

    if (!(globalThis as any).__SIMPLE_PROMISE_CHANNEL__) {
      throw new Error('CRITICAL: Script worker context is missing the promise channel.')
    }

    // This is the key: place the promise on the channel and exit synchronously.
    ; (globalThis as any).__SIMPLE_PROMISE_CHANNEL__.promise = resultPromise
    return // DO NOT return the promise here.
  }

  // All other contexts (WASM Loader, Elixir Backend) are handled below.
  let context: Context | undefined
  try {
    const inputText = readInputFromHost()

    if (!inputText) {
      returnError('no input payload provided by the host environment', undefined)
      return
    }

    const simpleReq: SimpleRequest = JSON.parse(inputText)
    context = simpleReq.context

    // Context 1: This is the initial WASM loader running in the browser.
    // Its only job is to start the script worker.
    if (__ASYNC_BUILD__) {
      // --- ASYNC PATH (BROWSER) ---
      // We are in the constrained WASM environment. We cannot run the async
      // handler here. Instead, we use the pre-bundled user script string
      // and send it to the host to be run in an unconstrained worker.
      if (typeof __USER_SCRIPT_BUNDLE__ === 'undefined') {
        throw new TypeError('CRITICAL: __USER_SCRIPT_BUNDLE__ is not defined in async build. Check the build script.')
      }

      const payload = { request: simpleReq }

      const result = await host.execute('runtime/script:execute', {
        payload,
        script: __USER_SCRIPT_BUNDLE__,
      }, context)

      if (!result.ok) {
        throw new Error(result.error?.message ?? 'Unconstrained script execution failed')
      }

      returnSuccess(result.data, context)
      return
    }

    // Context 3: This is the synchronous path for the Elixir backend.
    const request = new Request(simpleReq)
    const resultPromise = Promise.resolve(handler(request))
    const result = await resultPromise

    returnSuccess(result, context as Context)
  }
  catch (e: any) {
    // This catch block is ONLY for the non-worker paths.
    // Worker errors are handled by the try/catch in `script.worker.ts`.
    returnError(e.message, context)
  }
}

/**
 * Transparently reads the initial payload from the host.
 * This function is designed to work in two contexts:
 * 1. Inside a WASM module, where it reads from the host via ABI calls.
 * 2. Inside a standard JS script worker, where the host places the payload
 *    on the global scope as `__SIMPLE_INITIAL_PAYLOAD__`.
 */
function readInputFromHost(): string {
  if ((globalThis as any).__SIMPLE_INITIAL_PAYLOAD__) {
    // This global variable is set by the script.worker.ts before executing the user's bundle.
    return JSON.stringify((globalThis as any).__SIMPLE_INITIAL_PAYLOAD__.request)
  }

  // Otherwise, we are in the main WASM module and must read from the host ABI.
  const buffer = host.getContext()
  return new TextDecoder().decode(buffer)
}

function returnError(message: string, context?: Context): void {
  const response = { data: null, errors: [message], ok: false }

  // Provide a minimal, safe context if the original is not available.
  const safeContext = context ?? { logic: { execution_id: 'unknown' } } as Context
  host.executeAsync('__done__', response, safeContext)
}

function returnSuccess(data: any, context: Context): void {
  // With the async handle function, we no longer need to check for promises here.
  const response = { data, errors: [], ok: true }
  host.executeAsync('__done__', response, context)
}

// --- The Default Export Object ---
// This creates the single `simple` object that users will import.
const simple = {
  Execute: execute,
  ExecuteAsync: executeAsync,
  Handle: handle,
  Request,
}

export default simple
