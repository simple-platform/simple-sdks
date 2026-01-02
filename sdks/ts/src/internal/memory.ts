/**
 * @fileoverview WebAssembly Memory Management Module
 *
 * Provides a high-level interface for managing WebAssembly linear memory operations.
 * This module handles string-based data exchange between JavaScript and the WASM
 * runtime through direct UTF-8 operations, avoiding unnecessary serialization overhead.
 *
 * ## Architecture
 *
 * The memory bridge operates on two main principles:
 * - **Direct String Operations**: Strings are passed directly between JS and WASM
 * - **UTF-8 Encoding**: All string data is handled as UTF-8 encoded bytes
 *
 * ## Usage
 *
 * ```typescript
 * // Allocate memory for a string
 * const [ptr, len] = stringToPtr("Hello, World!")
 *
 * // Read data back from memory
 * const data = readBufferSlice(ptr, len)
 * ```
 */

// =============================================================================
// TEXT ENCODING UTILITIES
// =============================================================================

/** Reusable TextEncoder instance for UTF-8 string encoding. */
const encoder = new TextEncoder()

/** Reusable TextDecoder instance for UTF-8 string decoding. */
export const decoder = new TextDecoder('utf-8')

// =============================================================================
// MEMORY ALLOCATION
// =============================================================================

/**
 * Allocates a block of memory within the WebAssembly linear memory space.
 *
 * This function provides the primary interface for requesting memory from
 * the WASM module's allocator. The returned pointer can be used for
 * subsequent read/write operations.
 *
 * @param size - Number of bytes to allocate
 * @returns Memory pointer (offset) to the allocated block
 *
 * @example
 * ```typescript
 * const ptr = allocate(1024) // Allocate 1KB
 * ```
 */
export function allocate(size: number): number {
  return __wasm.alloc(size)
}

// =============================================================================
// STRING MEMORY OPERATIONS
// =============================================================================

/**
 *
 * @param ptr - Memory pointer to deallocate
 * @param size -  Number of bytes to deallocate
 *
 * @example
 * ```typescript
 * deallocate(ptr, 1024) // Deallocate 1KB
 * ```
 */
export function deallocate(ptr: number, size: number): void {
  __wasm.dealloc(ptr, size)
}

/**
 * Reads string data from WebAssembly memory and returns it as UTF-8 bytes.
 *
 * This function provides a safe interface for reading string data from
 * WASM memory, with proper error handling and fallback behavior.
 *
 * @param ptr - Memory pointer to read from
 * @param len - Number of bytes to read
 * @returns UTF-8 encoded bytes of the string data
 *
 * @example
 * ```typescript
 * const data = readBufferSlice(ptr, len)
 * const text = decoder.decode(data) // Convert back to string
 * ```
 */
export function readBufferSlice(ptr: number, len: number): Uint8Array {
  if (len === 0) {
    return new Uint8Array(0)
  }

  try {
    const str = __wasm.read_string(ptr, len)
    return encoder.encode(str)
  }
  catch (error) {
    console.error(`Memory read failed at ptr=${ptr}, len=${len}:`, error)
    return new Uint8Array(0)
  }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Reads a string directly from WebAssembly memory.
 *
 * This is a convenience function that combines memory reading and UTF-8
 * decoding in a single operation.
 *
 * @param ptr - Memory pointer to read from
 * @param len - Number of bytes to read
 * @returns The decoded UTF-8 string
 *
 * @example
 * ```typescript
 * const text = readString(ptr, len)
 * ```
 */
export function readString(ptr: number, len: number): string {
  if (len === 0) {
    return ''
  }

  try {
    return __wasm.read_string(ptr, len)
  }
  catch (error) {
    console.error(`String read failed at ptr=${ptr}, len=${len}:`, error)
    return ''
  }
}

/**
 * Writes a JavaScript string to WebAssembly memory and returns its location.
 *
 * This function handles the complete process of:
 * 1. Calculating the UTF-8 byte length of the string
 * 2. Allocating sufficient memory in the WASM linear memory
 * 3. Writing the string data to the allocated location
 *
 * @param str - The string to write to memory
 * @returns A tuple containing [pointer, byte_length]
 *
 * @example
 * ```typescript
 * const [ptr, len] = stringToPtr("Hello, World!")
 * // ptr points to the string data, len is the byte length
 * ```
 */
export function stringToPtr(str: string): [number, number] {
  if (str.length === 0) {
    return [allocate(0), 0]
  }

  const bytes = encoder.encode(str)
  const ptr = allocate(bytes.length)

  __wasm.write_string(ptr, str)

  return [ptr, bytes.length]
}
