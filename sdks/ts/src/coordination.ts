import type { Context, SimpleResponse } from './types'

import { execute as hostExecute } from './host'

const LOCK_ACTION = 'action:coordination/lock'
const UNLOCK_ACTION = 'action:coordination/unlock'
const MAX_KEY_BYTES = 1_024

function utf8ByteLength(value: string): number {
  let bytes = 0

  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)

    if (code <= 0x7F) {
      bytes += 1
    }
    else if (code <= 0x7FF) {
      bytes += 2
    }
    else if (code >= 0xD800 && code <= 0xDBFF && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1)

      if (next >= 0xDC00 && next <= 0xDFFF) {
        bytes += 4
        i++
      }
      else {
        throw new Error('A coordination key cannot contain an unpaired UTF-16 surrogate because the runtime would replace it, causing distinct keys to become identical.')
      }
    }
    else if (code >= 0xD800 && code <= 0xDFFF) {
      throw new Error('A coordination key cannot contain an unpaired UTF-16 surrogate because the runtime would replace it, causing distinct keys to become identical.')
    }
    else {
      bytes += 3
    }
  }

  return bytes
}

function validateKey(key: string): void {
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error('A coordination key must be a non-empty string.')
  }

  if (utf8ByteLength(key) > MAX_KEY_BYTES) {
    throw new Error('A coordination key must be at most 1,024 UTF-8 bytes.')
  }
}

function readAnswer(
  response: SimpleResponse<unknown> | null | undefined,
  field: 'acquired' | 'released',
  operation: 'lock' | 'unlock',
): boolean {
  if (!response || typeof response !== 'object') {
    throw new Error(`The coordination ${operation} answer did not include a ${field} boolean.`)
  }

  if (!response.ok) {
    throw new Error(response.error?.message ?? `Coordination ${operation} failed.`)
  }

  const answer = response.data as Record<string, unknown> | null | undefined

  if (typeof answer?.[field] !== 'boolean') {
    throw new TypeError(`The coordination ${operation} answer did not include a ${field} boolean.`)
  }

  return answer[field] as boolean
}

/**
 * Try to hold a coordination key for this run, waiting up to waitMs.
 *
 * Returns false if another run still holds the key when the wait expires.
 */
export async function lock(
  key: string,
  options: { waitMs: number },
  context: Context,
): Promise<boolean> {
  validateKey(key)

  if (!options || !Number.isInteger(options.waitMs) || options.waitMs < 0) {
    throw new Error('A coordination lock wait must be a whole number of milliseconds, zero or more.')
  }

  const response = hostExecute<unknown>(LOCK_ACTION, { key, wait_ms: options.waitMs }, context)

  return readAnswer(response, 'acquired', 'lock')
}

/** Let this run's coordination key go before the run ends. */
export async function unlock(key: string, context: Context): Promise<boolean> {
  validateKey(key)

  const response = hostExecute<unknown>(UNLOCK_ACTION, { key }, context)

  return readAnswer(response, 'released', 'unlock')
}
