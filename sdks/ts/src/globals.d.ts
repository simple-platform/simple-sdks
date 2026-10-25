/**
 * This file contains ambient declarations for global variables and functions
 * injected by the host environment (Javy/Rust) and the wasm-opt tool (Asyncify).
 *
 * As a .d.ts file, it is automatically included by the TypeScript compiler
 * and its declarations are made available globally across the entire project.
 */

/**
 * Build-time constant injected by esbuild to select the correct runtime path.
 * Will be `true` for async builds (browser) and `false` for sync builds (backend).
 */
declare const __ASYNC_BUILD__: boolean

// This global is defined by the build process. It contains the source code
// of the entire bundled user application, but only for the async build target.
declare const __USER_SCRIPT_BUNDLE__: string | undefined
declare const __IS_WORKER_BUILD__: boolean

/**
 * Host communication interface, provided by the Javy/Rust plugin.
 */
declare const __host: {
  /** Calls an action and returns its parsed response. */
  call: (name: string, params: unknown) => unknown

  /**
   * Calls an action whose reply is a run of bytes, and returns them as a
   * `Uint8Array`, or the host's refusal envelope. Absent from runtime plugins
   * that predate it, and from the browser runtime.
   */
  callBytes?: (name: string, params: unknown) => unknown

  /** Calls an action without waiting for it to answer. */
  cast: (name: string, params: unknown) => void

  /** The execution context the host assembled, already parsed. */
  getContext: () => unknown
}

// Asyncify ABI functions injected by wasm-opt
declare function asyncify_get_state(): number
declare function asyncify_stop_rewind(): void
