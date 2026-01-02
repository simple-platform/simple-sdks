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
 * WebAssembly memory bridge interface, provided by the Javy/Rust plugin.
 */
declare const __wasm: {
  alloc: (size: number) => number
  clear_response_buffer: () => void
  dealloc: (ptr: number, size: number) => void
  get_response_len: () => number
  get_response_ptr: () => number
  read_string: (ptr: number, len: number) => string
  write_string: (ptr: number, data: string) => void
}

/**
 * Host communication interface, provided by the Javy/Rust plugin.
 */
declare const __host: {
  call: (
    namePtr: number,
    nameLen: number,
    paramsPtr: number,
    paramsLen: number,
    contextPtr: number,
    contextLen: number,
  ) => void

  cast: (
    namePtr: number,
    nameLen: number,
    paramsPtr: number,
    paramsLen: number,
    contextPtr: number,
    contextLen: number,
  ) => void

  getContext: (ptr: number) => void
  getContextSize: () => number
  getExecutionResult: (ptr: number) => void
  getExecutionResultSize: () => number
}

// Asyncify ABI functions injected by wasm-opt
declare function asyncify_get_state(): number
declare function asyncify_stop_rewind(): void
