/* eslint-disable test/no-import-node-test */
// What an action is handed as its request, held to what it was handed before the
// request data stopped taking a serialise-and-parse round trip.
//
// The SDK used to read its request by turning the host's already-parsed value
// back into text and parsing that. It still does, for everything except the data
// string. That is only safe if nothing an action can see has changed, so this
// runs the SDK the way an action bundles it, in a realm of its own, against a
// host that hands over each document below, and compares what the handler
// receives with `JSON.parse(JSON.stringify(value))` — the old reading — down to
// key order, escapes and the sign of a zero.
//
// It also asserts the reason for the change: the data string is never
// serialised. Without that, a regression that put the round trip back would pass
// every equality here.
import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'

import { build } from 'esbuild'

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

const syncBundle = await bundle(false)
const asyncBundle = await bundle(true)

// A description two values share only if nothing an action could observe
// differs: key order, every character of every string, and the sign of a zero,
// which JSON.stringify would otherwise print as zero.
const FINGERPRINT = `(value) => JSON.stringify(value === undefined ? { undefined: true } : value,
  (key, v) => (Object.is(v, -0) ? 'NEGATIVE ZERO' : v))`

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

// What the browser's host was sent when the SDK parsed a serialisation of the value.
function beforeForwarded(text) {
  const realm = vm.createContext({})
  const fingerprint = vm.runInContext(FINGERPRINT, realm)
  const read = vm.runInContext(`(text) => ({
    payload: { request: JSON.parse(JSON.stringify(JSON.parse(text))) },
    script: 'the user script',
  })`, realm)

  return fingerprint(read(text))
}

// Runs the SDK once against a host that answers getContext with `text` parsed in
// the guest's own realm, as the runtime does. Returns what the handler saw, what
// the SDK reported to the host, and the longest string it serialised while it
// read the request. `initialPayload` puts the request on the global instead, the
// way the script worker's host does.
async function handle(text, { code = syncBundle, initialPayload = false } = {}) {
  const called = []
  const sent = []
  const realm = vm.createContext({})
  const parse = vm.runInContext('(text) => text === undefined ? undefined : JSON.parse(text)', realm)
  const fingerprint = vm.runInContext(FINGERPRINT, realm)

  realm.__host = {
    call: (name, value) => {
      called.push({ name, value: fingerprint(value) })
      return vm.runInContext('({ data: "from the worker", ok: true })', realm)
    },
    cast: (name, value) => sent.push({ name, value: fingerprint(value) }),
    getContext: () => parse(text),
  }

  if (initialPayload)
    realm.__SIMPLE_INITIAL_PAYLOAD__ = { request: parse(text) }

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

  await realm.sdk.default.Handle((request) => {
    spy.restore()
    received = fingerprint({ context: request.context, data: request.data(), headers: request.headers })
    return 'handled'
  })

  spy.restore()

  return { called, longest: spy.longest, received, sent }
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
  // A negative zero outside the data is turned into zero by the round trip, and
  // must still be; inside the data it is text and must stay text.
  `{"context":{"n":-0.0,"m":[-0,0,-0.0]},"data":"{${backslash}"a${backslash}":-0}","headers":{"z":-0}}`,
  // The data is not always first, and its key keeps its place.
  '{"headers":{"b":1},"data":"x","context":{"a":2}}',
  '{"data":"x","z":1,"a":2,"10":3,"2":4}',
  `{"data":"${backslash}ud800${backslash}udc00${backslash}ud800","context":{}}`,
  '{"__proto__":{"polluted":true},"data":"y","context":{"__proto__":1}}',
  '{"data":"","context":{},"headers":{}}',
  // Anything that is not a request with string data takes the whole round trip.
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

test('a request reaches the handler exactly as it did before', async () => {
  for (const text of requests) {
    const { received, sent } = await handle(text)

    assert.equal(received, before(text), `the request read from ${text.slice(0, 80)} changed`)
    assert.deepEqual(
      sent.map(s => s.name),
      ['__done__'],
      `the SDK answered ${text.slice(0, 80)} differently`,
    )
  }
})

test('the browser build forwards the request exactly as it did before', async () => {
  for (const text of requests) {
    const { called } = await handle(text, { code: asyncBundle })

    assert.deepEqual(
      called,
      [{ name: 'runtime/script:execute', value: beforeForwarded(text) }],
      `the request forwarded from ${text.slice(0, 80)} changed`,
    )
  }
})

test('a request the host leaves on the global reaches the handler unchanged', async () => {
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

// The point of the change: a large request's data is handed over without being
// serialised, so nothing the SDK writes while reading it is anywhere near its size.
test('a large request is read without its data being serialised', async () => {
  const text = requests[0]
  const data = JSON.parse(text).data
  const { longest } = await handle(text)

  assert.ok(data.length > 100_000, 'the large request is not large')
  assert.ok(longest < 1_000, `the SDK serialised ${longest} characters while reading a request whose data is ${data.length}`)
})
