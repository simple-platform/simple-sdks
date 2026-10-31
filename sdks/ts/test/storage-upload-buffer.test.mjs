/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import test from 'node:test'

import { build } from 'esbuild'

const KIB = 1024
const context = { logic: { execution_id: 'LEX-STORAGE-UPLOAD' } }
const documentHandle = { file_hash: '9f86d081884c7d65', filename: 'statement.pdf', mime_type: 'application/pdf', size: 3, storage_path: '_staged/9f86d081884c7d65' }
const target = { app_id: 'dev.simple.system', field_name: 'attachment', table_name: 'documents' }

// The SDK the way an action receives it: bundled by esbuild, which is what the
// built output is written for.
const bundled = await build({
  bundle: true,
  entryPoints: [new URL('../dist/storage.js', import.meta.url).pathname],
  format: 'esm',
  logLevel: 'silent',
  platform: 'neutral',
  write: false,
})

const source = Buffer.from(bundled.outputFiles[0].text).toString('base64')

// A server action's runtime has none of these, so an SDK that reaches for one
// fails here the way it fails in an action. The `Buffer` this file compares
// against is its own import, not the global.
for (const missing of ['atob', 'btoa', 'Buffer'])
  delete globalThis[missing]

const storage = await import(`data:text/javascript;base64,${source}`)

// A host that keeps what it is asked and answers as the platform does. The
// parameters are recorded as JSON, the way the runtime sends them.
function install() {
  const calls = []

  globalThis.__host = {
    call(name, params) {
      calls.push({ name, params: JSON.parse(JSON.stringify(params)) })
      if (Buffer.from(params.source.bytes, 'base64').length === 0)
        return { ok: false, error: { message: 'Decoded bytes are empty' } }

      return { data: documentHandle, ok: true }
    },
    cast() {},
    getContext: () => ({}),
  }

  return calls
}

// What an upload puts on the wire for `bytes`.
async function encoded(bytes) {
  const calls = install()

  await storage.uploadBuffer(bytes, 'statement.pdf', 'application/pdf', target, context)

  assert.equal(calls.length, 1)
  return calls[0].params.source.bytes
}

function standard(bytes) {
  return Buffer.from(bytes).toString('base64')
}

// Bytes in no pattern an encoder could pass by accident, the same on every run
// so that a failure can be reproduced.
function noise(length) {
  const bytes = new Uint8Array(length)
  let state = 1

  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 1103515245) + 12345) & 0x7FFFFFFF
    bytes[i] = state >>> 16
  }

  return bytes
}

test('an upload calls the host once and answers with its handle', async () => {
  const calls = install()

  const answered = await storage.uploadBuffer(new Uint8Array([102, 111, 111]), 'statement.pdf', 'application/pdf', target, context)

  assert.deepEqual(calls, [{
    name: 'action:storage/upload-external',
    params: { source: { bytes: 'Zm9v', filename: 'statement.pdf', mime_type: 'application/pdf' }, target },
  }])
  assert.deepEqual(answered, documentHandle)
})

test('an empty buffer is refused before calling the host', async () => {
  const calls = install()

  await assert.rejects(
    storage.uploadBuffer(new Uint8Array(), 'statement.pdf', 'application/pdf', target, context),
    { message: 'An upload needs at least one byte, and this buffer is empty.' },
  )
  assert.equal(calls.length, 0)
})

// The standard's own test vectors, which pin the alphabet and the padding
// without trusting any other encoder.
test('bytes are sent in the standard alphabet with standard padding', async () => {
  const vectors = [
    ['f', 'Zg=='],
    ['fo', 'Zm8='],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg=='],
    ['fooba', 'Zm9vYmE='],
    ['foobar', 'Zm9vYmFy'],
  ]

  for (const [text, expected] of vectors)
    assert.equal(await encoded(Buffer.from(text)), expected)

  assert.equal(await encoded(new Uint8Array([0xFB, 0xFF])), '+/8=')
  assert.equal(await encoded(new Uint8Array([0xFF, 0xFF, 0xFF])), '////')
  assert.equal(await encoded(new Uint8Array([0x00, 0x00, 0x00])), 'AAAA')
})

test('every short length matches the standard encoding', async () => {
  for (let length = 1; length <= 96; length++) {
    const bytes = noise(length)

    assert.equal(await encoded(bytes), standard(bytes), `${length} bytes`)
  }
})

// Three and 256 share no factor, so 768 bytes put every value in every place
// of a group. A top bit that turned into a sign would show here.
test('every byte value survives in every place of a group', async () => {
  const bytes = Uint8Array.from({ length: 768 }, (_, i) => i % 256)

  assert.equal(await encoded(bytes), standard(bytes))
})

// Well past what one call can take as arguments, which is 65,535 in an action
// and a stack's worth in a browser, so bytes spread into a call fail here.
for (const remainder of [0, 1, 2]) {
  test(`a buffer of several hundred KiB, ${remainder} past a whole group, matches the standard encoding`, async () => {
    const bytes = noise(600 * KIB + remainder)

    assert.equal(bytes.length % 3, remainder)
    assert.equal(await encoded(bytes), standard(bytes))
  })
}

test('an ArrayBuffer is encoded as its bytes', async () => {
  const bytes = noise(KIB)

  assert.equal(await encoded(bytes.buffer), standard(bytes))
})

test('a view encodes its own bytes, not the buffer around it', async () => {
  const bytes = noise(KIB).subarray(10, 21)

  assert.equal(bytes.length, 11)
  assert.equal(await encoded(bytes), standard(bytes))
})
