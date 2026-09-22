/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import test from 'node:test'

import { build } from 'esbuild'

const MIB = 1024 * 1024
const context = { logic: { execution_id: 'LEX-STORAGE-READ' } }

// The SDK the way an action receives it: bundled by esbuild, which is what the
// built output is written for. `plugins` swaps a module the way the browser
// build does.
async function bundle(plugins = []) {
  const result = await build({
    bundle: true,
    entryPoints: [new URL('../dist/storage.js', import.meta.url).pathname],
    format: 'esm',
    logLevel: 'silent',
    platform: 'neutral',
    plugins,
    write: false,
  })

  const source = Buffer.from(result.outputFiles[0].text).toString('base64')

  return import(`data:text/javascript;base64,${source}`)
}

const storage = await bundle()

function handle(overrides = {}) {
  return {
    file_hash: '9f86d081884c7d65',
    filename: 'statement.pdf',
    mime_type: 'application/pdf',
    size: 0,
    storage_path: '_staged/9f86d081884c7d65',
    ...overrides,
  }
}

// Every byte value, so bytes that went through any text decoding on the way
// cannot compare equal.
function everyByte(count) {
  const bytes = new Uint8Array(count)

  for (let i = 0; i < count; i++)
    bytes[i] = (i * 7 + 3) % 256

  return bytes
}

function same(actual, expected) {
  return Buffer.compare(
    Buffer.from(actual.buffer, actual.byteOffset, actual.length),
    Buffer.from(expected.buffer, expected.byteOffset, expected.length),
  ) === 0
}

// A runtime bridge answering from `host`, recording every call with its
// parameters as they cross — as JSON, the way the runtime sends them.
function install(host) {
  const calls = []
  const record = answer => (name, params) => {
    calls.push({ name, params: JSON.parse(JSON.stringify(params)) })
    return answer(name, calls.at(-1).params)
  }

  globalThis.__host = {
    call: record(host.call ?? (() => assert.fail('no call expected'))),
    cast() {},
    getContext: () => ({}),
    ...(host.callBytes ? { callBytes: record(host.callBytes) } : {}),
  }

  return calls
}

// A host serving `file` the way the platform does: its size from the store,
// and each range as its bytes, up to the end of the file. A range starting at
// or past the end is refused, as the store refuses it.
function serving(file) {
  return install({
    call(name) {
      assert.equal(name, 'action:storage/stat')
      return { data: { size: file.length }, ok: true }
    },
    callBytes(name, { length, offset }) {
      assert.equal(name, 'action:storage/read')

      if (offset >= file.length)
        return { error: { message: '\'offset\' is at or past the end of the file.' }, ok: false }

      return file.slice(offset, Math.min(file.length, offset + length))
    },
  })
}

function ranges(calls) {
  return calls
    .filter(call => call.name === 'action:storage/read')
    .map(call => [call.params.offset, call.params.length])
}

test('a read answers the file byte for byte', async () => {
  const file = everyByte(5_000)
  serving(file)

  assert.deepEqual(await storage.read(handle(), context), file)
})

test('a file that fits one range is the array the host handed over, not a copy', async () => {
  const handed = everyByte(64)
  install({
    call: () => ({ data: { size: 64 }, ok: true }),
    callBytes: () => handed,
  })

  assert.equal(await storage.read(handle(), context), handed)
})

test('a larger file is read in ranges no longer than the host answers, into one buffer of exactly its size', async () => {
  const file = everyByte(40 * MIB + 17)
  const calls = serving(file)

  const bytes = await storage.read(handle(), context)

  assert.equal(bytes.length, file.length)
  assert.equal(bytes.buffer.byteLength, file.length)
  assert.ok(same(bytes, file), 'the bytes read are not the file')
  assert.deepEqual(ranges(calls), [
    [0, 16 * MIB],
    [16 * MIB, 16 * MIB],
    [32 * MIB, 8 * MIB + 17],
  ])
})

test('every call carries the handle it was given', async () => {
  const calls = serving(everyByte(10))

  await storage.read(handle(), context)

  assert.equal(calls.length, 2)

  for (const call of calls)
    assert.deepEqual(call.params.handle, handle())
})

test('an empty file is read without asking for a range', async () => {
  const calls = serving(new Uint8Array(0))

  assert.deepEqual(await storage.read(handle(), context), new Uint8Array(0))
  assert.equal(calls.length, 1)
})

test('a range answered short is refused rather than handed over', async () => {
  install({
    call: () => ({ data: { size: 100 }, ok: true }),
    callBytes: () => new Uint8Array(60),
  })

  await assert.rejects(storage.read(handle(), context), /60 bytes for the 100 at offset 0/)
})

test('a host refusal reaches the caller with its own message, naming the call', async () => {
  install({
    call: () => ({ data: { size: 10 }, ok: true }),
    callBytes: () => ({ error: { message: 'No stored file matches this handle.' }, ok: false }),
  })

  await assert.rejects(storage.read(handle(), context), {
    message: 'action:storage/read failed: No stored file matches this handle.',
  })

  install({ call: () => ({ error: { message: 'No stored file matches this handle.' }, ok: false }) })

  await assert.rejects(storage.size(handle(), context), {
    message: 'action:storage/stat failed: No stored file matches this handle.',
  })
})

test('a refusal that gives no reason still names the call', async () => {
  for (const refusal of [{ ok: false }, { error: { message: ' ' }, ok: false }]) {
    install({
      call: () => ({ data: { size: 10 }, ok: true }),
      callBytes: () => refusal,
    })

    await assert.rejects(storage.read(handle(), context), {
      message: 'action:storage/read failed: The host refused the call and gave no reason.',
    })

    install({ call: () => refusal })

    await assert.rejects(storage.size(handle(), context), {
      message: 'action:storage/stat failed: The host refused the call and gave no reason.',
    })
  }
})

test('a reply that is not bytes is a refusal, whatever it says', async () => {
  install({ callBytes: () => ({ data: 'not bytes', ok: true }) })

  await assert.rejects(storage.readRange(handle(), 0, 10, context), {
    message: 'action:storage/read was refused and gave no reason.',
  })
})

test('a file larger than this action can hold is refused before any range', async () => {
  const calls = install({ call: () => ({ data: { size: Number.MAX_SAFE_INTEGER }, ok: true }) })

  await assert.rejects(storage.read(handle(), context), /more memory than this action has/)
  assert.equal(calls.length, 1)
})

test('size answers what the store reports', async () => {
  install({ call: () => ({ data: { size: 81_920 }, ok: true }) })

  assert.equal(await storage.size(handle(), context), 81_920)
})

test('a size that is not a count of bytes is refused', async () => {
  for (const data of [{}, { size: -1 }, { size: 1.5 }, { size: '12' }, null]) {
    install({ call: () => ({ data, ok: true }) })

    await assert.rejects(storage.size(handle(), context), /answered without a size/)
  }
})

test('a range answers exactly that range', async () => {
  const file = everyByte(10_000)
  serving(file)

  assert.deepEqual(await storage.readRange(handle(), 4_000, 1_500, context), file.slice(4_000, 5_500))
})

test('a range running past the end answers up to the end', async () => {
  const file = everyByte(10_000)
  serving(file)

  assert.deepEqual(await storage.readRange(handle(), 9_990, 100, context), file.slice(9_990))
})

test('a range starting past the end is refused', async () => {
  serving(everyByte(10))

  await assert.rejects(storage.readRange(handle(), 10, 1, context), /at or past the end/)
})

test('a range longer than one read is read into one buffer, in whole ranges', async () => {
  const file = everyByte(40 * MIB + 17)
  const calls = serving(file)

  const bytes = await storage.readRange(handle(), 1, 40 * MIB, context)

  assert.equal(bytes.length, 40 * MIB)
  assert.ok(same(bytes, file.subarray(1, 40 * MIB + 1)), 'the bytes read are not the range')
  assert.deepEqual(ranges(calls), [
    [1, 16 * MIB],
    [16 * MIB + 1, 16 * MIB],
    [32 * MIB + 1, 8 * MIB],
  ])
})

// The end of the file falls exactly where one range ends, so a reader that
// asked for the next range would be asking at the end, and be refused.
test('a long range ending past a file that fills whole ranges answers up to the end', async () => {
  const file = everyByte(16 * MIB)
  const calls = serving(file)

  const bytes = await storage.readRange(handle(), 0, 32 * MIB, context)

  assert.equal(bytes.length, 16 * MIB)
  assert.ok(same(bytes, file), 'the bytes read are not the file')
  assert.deepEqual(ranges(calls), [[0, 16 * MIB]])
})

test('a long range starting past the end is refused before any range', async () => {
  const calls = serving(everyByte(10))

  await assert.rejects(storage.readRange(handle(), 20, 32 * MIB, context), /at or past the end/)
  assert.deepEqual(ranges(calls), [])
})

test('a range that is empty or not a whole number of bytes is refused before anything is sent', async () => {
  const calls = serving(everyByte(10))

  for (const [offset, length] of [[0, 0], [0, -1], [-1, 1], [1.5, 1], [0, 0.5], [0, Number.NaN], [2 ** 53, 1]])
    await assert.rejects(storage.readRange(handle(), offset, length, context), /A range needs/)

  assert.deepEqual(calls, [])
})

test('a handle missing what names the file is refused before anything is sent', async () => {
  const calls = serving(everyByte(10))

  for (const broken of [
    handle({ storage_path: '' }),
    handle({ filename: ' ' }),
    handle({ file_hash: undefined }),
  ]) {
    await assert.rejects(storage.read(broken, context), /A document handle needs/)
    await assert.rejects(storage.readRange(broken, 0, 1, context), /A document handle needs/)
  }

  assert.deepEqual(calls, [])
})

test('a runtime without the byte reply is refused with what to install', async () => {
  const calls = install({ call: () => ({ data: { size: 10 }, ok: true }) })

  await assert.rejects(storage.readRange(handle(), 0, 10, context), /__host\.callBytes.*Install a runtime plugin/)
  assert.deepEqual(calls, [])
})

test('a browser action is refused before anything is sent', async () => {
  const posted = []
  globalThis.self = {
    addEventListener() {},
    postMessage: message => posted.push(message),
  }

  const browser = await bundle([{
    name: 'worker-host',
    setup(build) {
      build.onResolve({ filter: /^\.\/host$/ }, () => ({
        path: new URL('../dist/worker-override.js', import.meta.url).pathname,
      }))
    },
  }])

  await assert.rejects(browser.readRange(handle(), 0, 10, context), /only a server action can receive/)
  assert.deepEqual(posted, [])
})
