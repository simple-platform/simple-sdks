/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import test from 'node:test'

import { build } from 'esbuild'

const context = { logic: { execution_id: 'LEX-HTTP-FETCH' } }

// The SDK the way an action receives it: bundled by esbuild, which is what the
// built output is written for.
async function bundle() {
  const result = await build({
    bundle: true,
    entryPoints: [new URL('../dist/http.js', import.meta.url).pathname],
    format: 'esm',
    logLevel: 'silent',
    platform: 'neutral',
    write: false,
  })

  const source = Buffer.from(result.outputFiles[0].text).toString('base64')

  return import(`data:text/javascript;base64,${source}`)
}

const http = await bundle()

// A runtime bridge that answers every call with a completed exchange, and
// records each call's parameters as they cross — as JSON, the way the runtime
// sends them, so a member left undefined is a member the host never sees.
function install() {
  const calls = []

  globalThis.__host = {
    call(name, params) {
      calls.push({ name, params: JSON.parse(JSON.stringify(params)) })

      return { data: { body: null, headers: {}, ok: true, status: 200 }, ok: true }
    },
    cast() {},
    getContext: () => ({}),
  }

  return calls
}

for (const credentials of ['include', 'omit', 'same-origin']) {
  test(`a request asking for credentials '${credentials}' reaches the host asking for it`, async () => {
    const calls = install()

    await http.fetch({ credentials, url: 'https://api.example.com/session' }, context)

    assert.equal(calls.length, 1)
    assert.equal(calls[0].name, 'action:http/fetch')
    assert.equal(calls[0].params.credentials, credentials)
  })
}

test('a request that names no credentials mode sends none, so the host applies its own', async () => {
  const calls = install()

  await http.fetch({ url: 'https://api.example.com/session' }, context)

  assert.equal(calls.length, 1)
  assert.equal(Object.hasOwn(calls[0].params, 'credentials'), false)
})

test('the credentials mode travels with the rest of the request', async () => {
  const calls = install()

  await http.fetch({
    body: { status: 'completed' },
    credentials: 'include',
    headers: { Accept: 'application/json' },
    method: 'PATCH',
    url: 'https://api.example.com/data',
  }, context)

  assert.deepEqual(calls[0].params, {
    body: '{"status":"completed"}',
    credentials: 'include',
    headers: { Accept: 'application/json' },
    method: 'PATCH',
    url: 'https://api.example.com/data',
  })
})

test('the method helpers name no credentials mode', async () => {
  const calls = install()

  await http.get('https://api.example.com/a', {}, context)
  await http.post('https://api.example.com/a', { id: 1 }, {}, context)

  assert.deepEqual(calls.map(call => Object.hasOwn(call.params, 'credentials')), [false, false])
})
