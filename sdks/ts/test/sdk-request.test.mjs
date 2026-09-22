/* eslint-disable test/no-import-node-test */
// What an action is handed as its request, and what the host's own value is
// left as while the SDK reads it.
//
// Inside a WASM module the request is a value the runtime parsed from the
// host's JSON, and the SDK hands that value on. It used to serialise the value
// and parse the text again, so this holds the reading to what that gave, apart
// from the two values JSON cannot write back — a negative zero and an infinite
// number — which the old reading turned into zero and null and which now
// arrive as the host sent them. Nothing else may differ, and the rule is
// checked for every document below rather than stated.
//
// The script worker in the browser reads its request from the global instead,
// where it is a JavaScript object of the host's own making, and keeps the round
// trip. That path is pinned against the old reading, unchanged.
//
// The SDK also may not write to the host's value, so a host here hands over one
// envelope and is asked afterwards what became of it, and two hosts hand over
// envelopes that cannot be written to at all.
//
// Everything runs the SDK the way an action bundles it, in a realm of its own.
import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'

import { build } from 'esbuild'

// A description two values share only if nothing an action could observe
// differs: key order, every character of every string, and the two numbers
// JSON.stringify would otherwise print as something else — a negative zero,
// which it prints as zero, and an infinity, which it prints as null.
const FINGERPRINT = `(value) => JSON.stringify(value === undefined ? { undefined: true } : value,
  (key, v) => {
    if (Object.is(v, -0)) return 'NEGATIVE ZERO'
    if (typeof v === 'number' && !Number.isFinite(v)) return 'NOT A FINITE NUMBER'
    return v
  })`

// What the handler is handed when the SDK reads the host's value as it arrived.
function asSent(text) {
  const realm = vm.createContext({})
  const fingerprint = vm.runInContext(FINGERPRINT, realm)
  const read = vm.runInContext(`(text) => {
    const request = JSON.parse(text)
    return { context: request.context, data: request.data ?? '', headers: request.headers }
  }`, realm)

  return fingerprint(read(text))
}

// What the handler was handed when the SDK parsed a serialisation of the value.
function before(text) {
  const realm = vm.createContext({})
  const fingerprint = vm.runInContext(FINGERPRINT, realm)
  const read = vm.runInContext(`(text) => {
    const request = JSON.parse(JSON.stringify(JSON.parse(text)))
    return { context: request.context, data: request.data ?? '', headers: request.headers }
  }`, realm)

  return fingerprint(read(text))
}

// The SDK as each kind of action bundles it, from the built output the package
// publishes. The browser's build hands the whole request on to the host rather
// than to a handler, so there every member of it, and the order of its keys, is
// something the far side receives.
async function bundle(async) {
  const result = await build({
    bundle: true,
    define: { __ASYNC_BUILD__: String(async), __USER_SCRIPT_BUNDLE__: '"the user script"' },
    entryPoints: [new URL('../dist/index.js', import.meta.url).pathname],
    format: 'iife',
    globalName: 'sdk',
    logLevel: 'silent',
    platform: 'neutral',
    write: false,
  })

  return result.outputFiles[0].text
}

// Freezes a value and everything under it, so that any write the SDK makes
// while reading it either throws or is there to be seen afterwards.
function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.getOwnPropertyNames(value))
      deepFreeze(value[key])

    Object.freeze(value)
  }

  return value
}

// The same description as the old reading would have printed it: the two values
// it could not write back, written the way it wrote them.
function flattened(fingerprint) {
  return fingerprint.replaceAll('"NEGATIVE ZERO"', '0').replaceAll('"NOT A FINITE NUMBER"', 'null')
}

// What the browser's host is sent when the SDK forwards the host's value as it
// arrived, and what it was sent when the SDK forwarded a serialisation of it.
function forwarded(text, roundTrip) {
  const realm = vm.createContext({})
  const fingerprint = vm.runInContext(FINGERPRINT, realm)
  const read = vm.runInContext(`(text, roundTrip) => {
    const request = JSON.parse(text)
    return {
      payload: { request: roundTrip ? JSON.parse(JSON.stringify(request)) : request },
      script: 'the user script',
    }
  }`, realm)

  return fingerprint(read(text, roundTrip))
}

const syncBundle = await bundle(false)
const asyncBundle = await bundle(true)

// Runs the SDK once against a host that answers getContext with `text` parsed
// in the guest's own realm, as the runtime does. Returns what the handler saw,
// what the SDK reported to the host, what became of the host's own value, and
// the longest string the SDK serialised while it read the request.
//
// The host serves one envelope to every call. The runtime parses the host's
// bytes afresh each time, which would hide a write to the value it handed over;
// the SDK may not need that. `prepare` is the host making its envelope
// something the SDK cannot write to, and `initialPayload` puts the request on
// the global instead, the way the script worker's host does.
async function handle(text, { code = syncBundle, initialPayload = false, inspect, prepare } = {}) {
  const called = []
  const sent = []
  const realm = vm.createContext({})
  const parse = vm.runInContext('(text) => text === undefined ? undefined : JSON.parse(text)', realm)
  const fingerprint = vm.runInContext(FINGERPRINT, realm)

  const envelope = prepare ? prepare(parse(text)) : parse(text)
  const envelopeBefore = fingerprint(envelope)
  let reads = 0

  realm.__host = {
    call: (name, value) => {
      called.push({ name, value: fingerprint(value) })
      return vm.runInContext('({ data: "from the worker", ok: true })', realm)
    },
    cast: (name, value) => sent.push({ name, value: fingerprint(value) }),
    getContext: () => {
      reads += 1
      return envelope
    },
  }

  if (initialPayload)
    realm.__SIMPLE_INITIAL_PAYLOAD__ = { request: envelope }

  vm.runInContext(code, realm)

  const spy = vm.runInContext(`(() => {
    const original = JSON.stringify
    const spy = { longest: 0, restore: () => { JSON.stringify = original } }
    JSON.stringify = function (...args) {
      const out = original.apply(this, args)
      if (typeof out === 'string') spy.longest = Math.max(spy.longest, out.length)
      return out
    }
    return spy
  })()`, realm)

  let received
  let inspected

  await realm.sdk.default.Handle((request) => {
    spy.restore()
    received = fingerprint({ context: request.context, data: request.data(), headers: request.headers })

    if (inspect)
      inspected = inspect(request, realm)

    return 'handled'
  })

  spy.restore()

  return {
    called,
    envelope: { after: fingerprint(envelope), before: envelopeBefore, value: envelope },
    inspected,
    longest: spy.longest,
    reads,
    received,
    sent,
  }
}

const char = code => String.fromCharCode(code)
const backslash = char(92)

// Every character a JSON string can carry that an encoder or decoder might treat
// specially, including a lone surrogate, which only an escape can express.
const awkward = [
  ...Array.from({ length: 32 }, (_, code) => char(code)),
  char(34),
  backslash,
  char(127),
  '/',
  String.fromCodePoint(0x2028, 0x2029, 0xE9, 0x65E5, 0x1F642),
  char(0xD800),
  `${backslash}u0041`,
].join('')

const records = Array.from({ length: 2000 }, (_, i) => ({ id: i, name: `record ${i} ${awkward}`, score: i / 3 }))

const context = { logic: { execution_id: 'LEX-REQUEST', timeout: 30000 }, tenant: { id: 't', name: 'acme' }, user: { id: 'u' } }

// Requests a host sends, as the text it sends them in.
const requests = [
  JSON.stringify({ context, data: JSON.stringify({ records }), headers: { 'content-type': 'application/json' } }),
  JSON.stringify({ context, data: JSON.stringify(awkward), headers: { [awkward]: awkward } }),
  // A negative zero outside the data was turned into zero by the round trip and
  // now arrives as it was sent; inside the data it is text and stays text.
  `{"context":{"n":-0.0,"m":[-0,0,-0.0]},"data":"{${backslash}"a${backslash}":-0}","headers":{"z":-0}}`,
  // A number JSON has a spelling for but no value: the round trip wrote it back
  // as null, and it now arrives as the infinity the host's text asked for.
  '{"context":{"big":1e999,"small":-1e999},"data":"x","headers":{"huge":[1e999,1]}}',
  // The data is not always first, and its key keeps its place.
  '{"headers":{"b":1},"data":"x","context":{"a":2}}',
  '{"data":"x","z":1,"a":2,"10":3,"2":4}',
  `{"data":"${backslash}ud800${backslash}udc00${backslash}ud800","context":{}}`,
  '{"__proto__":{"polluted":true},"data":"y","context":{"__proto__":1}}',
  '{"data":"","context":{},"headers":{}}',
  // A request whose data is not a string is read the same way as any other.
  '{"context":{},"headers":{}}',
  '{"data":5,"context":{}}',
  '{"data":null,"context":{}}',
  '{"data":{"a":-0},"context":{}}',
  '{"data":["x"],"context":{}}',
  '5',
  '"text"',
  '[]',
  '[1,-0]',
  'true',
]

test('a request reaches the handler as the host sent it', async () => {
  for (const text of requests) {
    const { received, sent } = await handle(text)

    assert.equal(received, asSent(text), `the request read from ${text.slice(0, 80)} is not what the host sent`)
    assert.deepEqual(
      sent.map(s => s.name),
      ['__done__'],
      `the SDK answered ${text.slice(0, 80)} differently`,
    )
  }
})

test('the reading differs from the old one only where JSON could not write the value back', async () => {
  for (const text of requests) {
    assert.equal(
      flattened(asSent(text)),
      before(text),
      `the request read from ${text.slice(0, 80)} changed by more than a negative zero or an infinity`,
    )
  }
})

test('the host keeps the envelope it handed over', async () => {
  for (const text of requests) {
    const { envelope, inspected, reads } = await handle(text, {
      // What an action reading the context itself sees — the SDK exports that
      // call — held to the data the SDK handed the action.
      inspect: (request, realm) => request.data() === (realm.__host.getContext()?.data ?? ''),
    })

    assert.equal(envelope.after, envelope.before, `the SDK wrote to the envelope it was handed for ${text.slice(0, 80)}`)
    assert.equal(reads, 2, `the SDK read the context ${reads - 1} times rather than once`)
    assert.ok(inspected, `an action reading the context itself saw other data for ${text.slice(0, 80)}`)
  }
})

test('an envelope that cannot be written to is read', async () => {
  for (const text of requests) {
    const { envelope, received } = await handle(text, { prepare: deepFreeze })

    assert.equal(received, asSent(text), `the frozen request from ${text.slice(0, 80)} is not what the host sent`)
    assert.equal(envelope.after, envelope.before, `the frozen envelope for ${text.slice(0, 80)} changed`)
  }
})

test('data the host answers from a getter is read once and never serialised', async () => {
  const text = requests[0]
  const data = JSON.parse(text).data
  let reads = 0

  const { inspected, longest, received } = await handle(text, {
    // The reads the getter has answered by the time the handler runs. One of
    // them is the description this harness takes of the envelope before the
    // run; the rest are the SDK's.
    inspect: () => reads - 1,
    prepare: (envelope) => {
      Object.defineProperty(envelope, 'data', {
        configurable: false,
        enumerable: true,
        get: () => {
          reads += 1
          return data
        },
      })

      return envelope
    },
  })

  assert.equal(received, asSent(text), 'a request whose data came from a getter is not what the host sent')
  assert.equal(inspected, 1, `the SDK asked for the data ${inspected} times`)
  assert.ok(longest < 1_000, `the SDK serialised ${longest} characters of a request whose data is a getter`)
})

test('the browser build forwards the request as the host sent it', async () => {
  for (const text of requests) {
    const { called } = await handle(text, { code: asyncBundle })

    assert.deepEqual(
      called,
      [{ name: 'runtime/script:execute', value: forwarded(text, false) }],
      `the request forwarded from ${text.slice(0, 80)} is not what the host sent`,
    )
    assert.equal(
      flattened(forwarded(text, false)),
      forwarded(text, true),
      `the request forwarded from ${text.slice(0, 80)} changed by more than a negative zero or an infinity`,
    )
  }
})

test('a request the host leaves on the global still takes the round trip', async () => {
  for (const text of requests) {
    const { received } = await handle(text, { initialPayload: true })

    assert.equal(received, before(text), `the request read from ${text.slice(0, 80)} on the global changed`)
  }
})

test('a payload the host never sent ends the run as it did', async () => {
  const { received, sent } = await handle(undefined)

  assert.equal(received, undefined)
  assert.deepEqual(sent, [{
    name: '__done__',
    value: JSON.stringify({ data: null, errors: ['no input payload provided by the host environment'], ok: false }),
  }])
})

test('a payload that is not a request at all ends the run as it did', async () => {
  const realm = vm.createContext({})
  const message = vm.runInContext('(() => { const r = null; try { r.context } catch (e) { return e.message } })()', realm)
  const { received, sent } = await handle('null')

  assert.equal(received, undefined)
  assert.deepEqual(sent, [{ name: '__done__', value: JSON.stringify({ data: null, errors: [message], ok: false }) }])
})

// The point of the change: a large request is handed over without being
// serialised at all, so nothing the SDK writes while reading it is anywhere
// near its size.
test('a large request is read without anything being serialised', async () => {
  const text = requests[0]
  const data = JSON.parse(text).data
  const { longest } = await handle(text)

  assert.ok(data.length > 100_000, 'the large request is not large')
  assert.equal(longest, 0, `the SDK serialised ${longest} characters while reading a request whose data is ${data.length}`)
})
