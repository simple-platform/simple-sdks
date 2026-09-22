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
  install({
    call: () => ({ data: { size: 10 }, ok: true }),
    callBytes: () => ({ data: 'not bytes', ok: true }),
  })

  await assert.rejects(storage.readRange(handle(), 0, 10, context), {
    message: 'action:storage/read was refused and gave no reason.',
  })
})

test('a file larger than this action can hold is refused before any range', async () => {
  const largest = Number.MAX_SAFE_INTEGER
  const calls = install({ call: () => ({ data: { size: largest }, ok: true }) })

  await assert.rejects(storage.read(handle(), context), {
    message: `Reading ${largest} bytes needs more memory than this action has. Raise the action's mem_limit, or read the file in parts with readRange.`,
  })
  assert.equal(calls.length, 1)

  await assert.rejects(storage.readRange(handle(), 0, largest, context), /needs more memory than this action has/)
  assert.equal(calls.length, 2, 'one size lookup each, and no range')
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

test('a range answers exactly that range, after asking for the size', async () => {
  const file = everyByte(10_000)
  const calls = serving(file)

  assert.deepEqual(await storage.readRange(handle(), 4_000, 1_500, context), file.slice(4_000, 5_500))
  assert.deepEqual(calls.map(call => call.name), ['action:storage/stat', 'action:storage/read'])
})

test('a range running past the end answers up to the end', async () => {
  const file = everyByte(10_000)
  serving(file)

  assert.deepEqual(await storage.readRange(handle(), 9_990, 100, context), file.slice(9_990))
})

test('a range starting at or past the end is refused before any range', async () => {
  for (const offset of [10, 11, 20]) {
    const calls = serving(everyByte(10))

    await assert.rejects(storage.readRange(handle(), offset, 1, context), {
      message: `The range starts at byte ${offset}, at or past the end of the file, which is 10 bytes. Ask size() how large the file is, and start the range before its end.`,
    })
    assert.deepEqual(ranges(calls), [])
  }
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

test('a runtime without the byte reply is refused with what to install, before any range', async () => {
  const calls = install({ call: () => ({ data: { size: 10 }, ok: true }) })

  await assert.rejects(storage.readRange(handle(), 0, 10, context), /__host\.callBytes.*Install a runtime plugin/)
  assert.deepEqual(calls.map(call => call.name), ['action:storage/stat'])
})

// The cases every SDK is pinned to: the file's size, the offset and the length
// asked for, and the offset and length of every range the host is asked for in
// turn. A range is held at what the file has past its offset, so a file ending
// exactly where a range of 16 MiB does never leads to asking at the end.
test('a range is held at what the file has at every boundary', async () => {
  const largest = everyByte(32 * MIB + 5)

  const cases = [
    [16 * MIB, 0, 16 * MIB, [[0, 16 * MIB]]],
    [16 * MIB, 0, 16 * MIB + 1, [[0, 16 * MIB]]],
    [16 * MIB + 1, 0, 16 * MIB + 1, [[0, 16 * MIB], [16 * MIB, 1]]],
    [32 * MIB + 5, 0, 32 * MIB + 5, [[0, 16 * MIB], [16 * MIB, 16 * MIB], [32 * MIB, 5]]],
    [32 * MIB + 5, 0, 48 * MIB, [[0, 16 * MIB], [16 * MIB, 16 * MIB], [32 * MIB, 5]]],
    [32 * MIB + 5, 16 * MIB, 16 * MIB + 1, [[16 * MIB, 16 * MIB], [32 * MIB, 1]]],
    [32 * MIB, 16 * MIB, 16 * MIB + 1, [[16 * MIB, 16 * MIB]]],
    [10, 9, 5, [[9, 1]]],
  ]

  for (const [size, offset, length, asked] of cases) {
    const file = largest.subarray(0, size)
    const calls = serving(file)

    const bytes = await storage.readRange(handle(), offset, length, context)
    const end = Math.min(size, offset + length)

    assert.equal(bytes.length, end - offset, `${size} ${offset} ${length}`)
    assert.equal(bytes.buffer.byteLength, bytes.length, `${size} ${offset} ${length}`)
    assert.ok(same(bytes, file.subarray(offset, end)), `${size} ${offset} ${length}`)
    assert.deepEqual(ranges(calls), asked, `${size} ${offset} ${length}`)
    assert.equal(calls[0].name, 'action:storage/stat')
  }

  for (const [size, offset, length] of [
    [0, 0, 1],
    [10, 10, 1],
    [10, 11, 1],
    [10, 20, 32 * MIB],
    [16 * MIB, 16 * MIB, 16 * MIB + 1],
  ]) {
    const calls = serving(largest.subarray(0, size))

    await assert.rejects(
      storage.readRange(handle(), offset, length, context),
      new RegExp(`at or past the end of the file, which is ${size} bytes`),
    )
    assert.deepEqual(ranges(calls), [], `${size} ${offset} ${length}`)
  }

  for (const size of [0, 16 * MIB, 16 * MIB + 1, 32 * MIB + 5]) {
    const file = largest.subarray(0, size)
    serving(file)

    assert.ok(same(await storage.read(handle(), context), file), `${size}`)
  }
})

// A host from before stored files could be read answers a byte read in its
// JSON envelope, as though the envelope were the file. The size is asked for
// first, which such a host refuses as a request it does not know, so the
// envelope is never asked for and never handed over.
test('a host that cannot read stored files refuses before any range', async () => {
  const calls = install({
    call: name => ({ error: { message: `Unknown request: ${name}` }, ok: false }),
    callBytes: () => new TextEncoder().encode('{"ok":false,"error":{"message":"Unknown request: action:storage/read"}}'),
  })

  const message = 'action:storage/stat failed: Unknown request: action:storage/stat'

  await assert.rejects(storage.readRange(handle(), 0, 64, context), { message })
  await assert.rejects(storage.readRange(handle(), 0, 32 * MIB, context), { message })
  await assert.rejects(storage.read(handle(), context), { message })
  assert.deepEqual(ranges(calls), [])
})

test('a browser action is refused before any range is read', async () => {
  // The browser host answers the size lookup, the way it answers any call,
  // by posting the reply back to the worker.
  const posted = []
  const listeners = []
  globalThis.self = {
    addEventListener: (_type, listener) => listeners.push(listener),
    postMessage(message) {
      posted.push(message)
      queueMicrotask(() => {
        for (const listener of listeners) {
          listener({
            data: { requestId: message.requestId, response: { data: { size: 10 }, ok: true }, type: 'host_response' },
          })
        }
      })
    },
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
  assert.deepEqual(posted.map(message => message.request.name), ['action:storage/stat'])
})
