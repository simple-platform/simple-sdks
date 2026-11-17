/**
 * @file Base64 for the JSON boundary, worked out by hand.
 *
 * A server action's runtime has neither `btoa` nor `Buffer`, so nothing here
 * reaches for a global. It is arithmetic over the bytes, and it answers the same
 * in every runtime the SDK runs in.
 */

/** The standard alphabet of RFC 4648, which is the one the platform decodes. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** What takes the place of a symbol when the last group of bytes runs short. */
const PAD = '='

/**
 * Encodes bytes as base64, in the standard alphabet with the standard padding
 * and no line breaks, which is the form the platform accepts.
 *
 * Bytes are read by index and counted by `length`, so a caller passes a plain
 * view, as uploadBuffer does: it builds one over the upload's own bytes, which
 * no subclass can misreport. The bytes are read in a loop, three at a time, and
 * never spread into a call. A spread makes every byte an argument, and a call
 * takes at most 65,535 of those in a server action and a stack's worth in a
 * browser.
 *
 * @param bytes The bytes to encode.
 * @returns The encoded text, which is empty when there are no bytes.
 */
export function encodeBase64(bytes: Uint8Array): string {
  let encoded = ''

  for (let start = 0; start < bytes.length; start += 3) {
    const left = bytes.length - start

    // Left to right: the first byte takes the top eight of twenty-four bits. A
    // read past the end answers nothing, so a group of one or two leaves the
    // rest zero.
    const group = ((bytes[start] ?? 0) << 16) | ((bytes[start + 1] ?? 0) << 8) | (bytes[start + 2] ?? 0)

    encoded += ALPHABET.charAt(group >>> 18)
      + ALPHABET.charAt((group >>> 12) & 0x3F)
      + (left > 1 ? ALPHABET.charAt((group >>> 6) & 0x3F) : PAD)
      + (left > 2 ? ALPHABET.charAt(group & 0x3F) : PAD)
  }

  return encoded
}
