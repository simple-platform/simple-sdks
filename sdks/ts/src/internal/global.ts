/**
 * @file This script is the first to be imported by the SDK. Its purpose is to
 * polyfill the global scope of the JavaScript runtime with necessary APIs that
 * may be missing or non-compliant in a minimal environment like Javy/QuickJS.
 *
 * This ensures that all other modules within the SDK can reliably use standard
 * APIs like `TextEncoder` and `TextDecoder` as if they were in a browser,
 * making the SDK portable and self-sufficient.
 */

// We need polyfills in ANY environment that is not the dedicated script worker.
// The script worker is a modern browser environment with these APIs built-in.
// The Javy/QuickJS environment inside the main WASM module, however, is minimal
// and needs them for host communication.
if (typeof __IS_WORKER_BUILD__ === 'undefined' || !__IS_WORKER_BUILD__) {
  // Use `require` to ensure the import is contained within the conditional
  // block, making it easy for the bundler to tree-shake.
  // eslint-disable-next-line ts/no-require-imports
  const { TextDecoder: PolyfillDecoder, TextEncoder: PolyfillEncoder } = require('./polyfills')

  // Check if TextEncoder is not available on the global object.
  if (typeof globalThis.TextEncoder === 'undefined') {
    // If it's missing, we attach our robust polyfill to the global scope.
    globalThis.TextEncoder = PolyfillEncoder
  }

  // Do the same for TextDecoder.
  if (typeof globalThis.TextDecoder === 'undefined') {
    globalThis.TextDecoder = PolyfillDecoder
  }
}
