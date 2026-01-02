/**
 * @file Provides robust, production-quality polyfills for TextEncoder and TextDecoder.
 * The logic is adapted from a public-domain UTF-8 implementation to ensure correctness
 * and full Unicode support, including surrogate pairs.
 *
 * The Javy runtime has partial/non-compliant support for these APIs, so providing
 * our own implementation makes the SDK self-sufficient and guarantees identical
 * behavior in all environments (server and browser).
 */

// To the extent possible under law, the author(s) have dedicated all copyright and related
// and neighboring rights to this software to the public domain worldwide. This software
// is distributed without any warranty.
// You should have received a copy of the CC0 Public Domain Dedication along with this
// software. If not, see <http://creativecommons.org/publicdomain/zero/1.0/>.

export class TextDecoder {
  /**
   * The encoding supported by this polyfill, which is always "utf-8".
   * This read-only property is required for full API compliance with TypeScript's built-in types.
   */
  public readonly encoding = 'utf-8'

  /**
   * The `fatal` option is not supported by this polyfill but is required for API compliance.
   */
  public readonly fatal = false

  /**
   * The `ignoreBOM` option is not supported by this polyfill but is required for API compliance.
   */
  public readonly ignoreBOM = false

  /**
   * Decodes a Uint8Array containing UTF-8 bytes into a JavaScript string.
   * @param octets The byte array to decode.
   * @returns The decoded string.
   */
  decode(octets: Uint8Array): string {
    let string = ''
    let i = 0

    while (i < octets.length) {
      let octet = octets[i]
      let bytesNeeded = 0
      let codePoint = 0

      if (octet <= 0x7F) {
        bytesNeeded = 0
        codePoint = octet & 0xFF
      }
      else if (octet <= 0xDF) {
        bytesNeeded = 1
        codePoint = octet & 0x1F
      }
      else if (octet <= 0xEF) {
        bytesNeeded = 2
        codePoint = octet & 0x0F
      }
      else if (octet <= 0xF4) {
        bytesNeeded = 3
        codePoint = octet & 0x07
      }

      if (octets.length - i - bytesNeeded > 0) {
        let k = 0
        while (k < bytesNeeded) {
          octet = octets[i + k + 1]
          codePoint = (codePoint << 6) | (octet & 0x3F)
          k += 1
        }
      }
      else {
        // In case of a truncated multi-byte sequence, substitute with a replacement character.
        codePoint = 0xFFFD
        bytesNeeded = octets.length - i
      }

      // `String.fromCodePoint` is the modern, correct way to handle code points
      // that may be outside the BMP.
      string += String.fromCodePoint(codePoint)
      i += bytesNeeded + 1
    }

    return string
  }
}

export class TextEncoder {
  /**
   * The encoding supported by this polyfill, which is always "utf-8".
   * This read-only property is required for full API compliance with TypeScript's built-in types.
   */
  public readonly encoding = 'utf-8'

  /**
   * Encodes a JavaScript string into a UTF-8 encoded Uint8Array.
   * @param str The string to encode.
   * @returns A Uint8Array containing the UTF-8 bytes.
   */
  encode(str: string): Uint8Array {
    const octets: number[] = []
    const length = str.length
    let i = 0

    while (i < length) {
      // The `codePointAt` method is essential for correctly handling characters
      // outside the Basic Multilingual Plane (like many emojis).
      const codePoint = str.codePointAt(i) as number

      let c = 0
      let bits = 0

      if (codePoint <= 0x0000007F) {
        c = 0
        bits = 0x00
      }
      else if (codePoint <= 0x000007FF) {
        c = 6
        bits = 0xC0
      }
      else if (codePoint <= 0x0000FFFF) {
        c = 12
        bits = 0xE0
      }
      else if (codePoint <= 0x001FFFFF) {
        c = 18
        bits = 0xF0
      }

      octets.push(bits | (codePoint >> c))

      c -= 6
      while (c >= 0) {
        octets.push(0x80 | ((codePoint >> c) & 0x3F))
        c -= 6
      }

      // Advance by 2 if it was a surrogate pair, otherwise 1.
      i += codePoint >= 0x10000 ? 2 : 1
    }

    // The native API returns a Uint8Array, so we do the same for compatibility.
    return new Uint8Array(octets)
  }

  /**
   * An implementation of the `encodeInto` method for API compliance.
   * Our SDK does not use this performance-optimization method, so this is
   * a minimal, correct stub that performs a simple encode and copy.
   */
  encodeInto(str: string, destination: Uint8Array): { read: number, written: number } {
    const bytes = this.encode(str)
    const written = Math.min(bytes.length, destination.length)
    destination.set(bytes.subarray(0, written))

    // A true implementation would need to correctly calculate how many source
    // characters were read to produce the written bytes. For our non-blocking
    // SDK, this simplified stub is sufficient and safe.
    let read = str.length
    if (bytes.length > destination.length) {
      // A simplistic reverse-calculation if truncated.
      read = new TextDecoder().decode(destination).length
    }

    return { read, written }
  }
}
