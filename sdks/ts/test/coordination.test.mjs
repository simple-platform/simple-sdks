/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import test from 'node:test'

import { build } from 'esbuild'

const context = { logic: { execution_id: 'LEX-COORDINATION' } }

// Bundle the built SDK entry and stand in for the value-based runtime host.
async function bundle() {
  const result = await build({
    bundle: true,
    entryPoints: [new URL('../dist/coordination.js', import.meta.url).pathname],
    format: 'esm',
    logLevel: 'silent',
    platform: 'neutral',
    write: false,
  })

  const source = Buffer.from(result.outputFiles[0].text).toString('base64')

  return import(`data:text/javascript;base64,${source}`)
}

const coordination = await bundle()

function install(answer) {
  const calls = []
  globalThis.__host = {
    call(name, params) {
      const call = { name, params: JSON.parse(JSON.stringify(params)) }
      calls.push(call)
      return answer(call)
    },
    cast() {},
    getContext: () => ({}),
  }

  return calls
}

test('invalid keys are refused before the host is called', async () => {
  const calls = install(() => ({ data: { acquired: true }, ok: true }))

  for (const key of [null, 1, '', 'a'.repeat(1_025), 'é'.repeat(513), '😀'.repeat(257)]) {
    await assert.rejects(coordination.lock(key, { waitMs: 0 }, context), /coordination key/i)
    await assert.rejects(coordination.unlock(key, context), /coordination key/i)
  }

  assert.deepEqual(calls, [])
})

test('keys with an unpaired UTF-16 surrogate are refused before the host is called', async () => {
  const calls = install(() => ({ data: { acquired: true }, ok: true }))

  for (const key of ['\ud800', '\udc00']) {
    await assert.rejects(
      coordination.lock(key, { waitMs: 0 }, context),
      /unpaired UTF-16 surrogate because the runtime would replace it/,
    )
    await assert.rejects(
      coordination.unlock(key, context),
      /unpaired UTF-16 surrogate because the runtime would replace it/,
    )
  }

  assert.deepEqual(calls, [])
})

test('keys at the UTF-8 byte limit are accepted', async () => {
  const calls = install(({ name }) => ({
    data: name === 'action:coordination/lock' ? { acquired: true } : { released: true },
    ok: true,
  }))

  assert.equal(await coordination.lock('é'.repeat(512), { waitMs: 0 }, context), true)
  assert.equal(await coordination.unlock('😀'.repeat(256), context), true)
  assert.equal(calls.length, 2)
})

test('invalid waits are refused before the host is called', async () => {
  const calls = install(() => ({ data: { acquired: true }, ok: true }))

  for (const waitMs of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '0', null, undefined]) {
    await assert.rejects(coordination.lock('key', { waitMs }, context), /whole number of milliseconds/)
  }

  await assert.rejects(coordination.lock('key', null, context), /whole number of milliseconds/)
  assert.deepEqual(calls, [])
})

test('lock sends the exact action and parameters and accepts a zero wait', async () => {
  const calls = install(() => ({ data: { acquired: true }, ok: true }))

  assert.equal(await coordination.lock('report', { waitMs: 0 }, context), true)
  assert.deepEqual(calls, [{
    name: 'action:coordination/lock',
    params: { key: 'report', wait_ms: 0 },
  }])
})

test('lock returns true for a held key again and surfaces the platform error for another key', async () => {
  const calls = install(({ params }) => params.key === 'report'
    ? { data: { acquired: true }, ok: true }
    : { error: { message: 'This run already holds a lock on another key; unlock it first.' }, ok: false })

  assert.equal(await coordination.lock('report', { waitMs: 10 }, context), true)
  assert.equal(await coordination.lock('report', { waitMs: 10 }, context), true)
  await assert.rejects(
    coordination.lock('other', { waitMs: 10 }, context),
    { message: 'This run already holds a lock on another key; unlock it first.' },
  )
  assert.deepEqual(calls.map(call => call.params.key), ['report', 'report', 'other'])
})

test('unlock sends the exact action and parameters and returns true or false', async () => {
  let released = true
  const calls = install(() => ({ data: { released }, ok: true }))

  assert.equal(await coordination.unlock('report', context), true)
  released = false
  assert.equal(await coordination.unlock('report', context), false)
  assert.deepEqual(calls.map(call => call.name), [
    'action:coordination/unlock',
    'action:coordination/unlock',
  ])
  assert.deepEqual(calls.map(call => call.params), [{ key: 'report' }, { key: 'report' }])
})

test('a refused lock and unlock keep the host message', async () => {
  install(() => ({ error: { message: 'permission denied' }, ok: false }))

  await assert.rejects(coordination.lock('report', { waitMs: 1 }, context), { message: 'permission denied' })
  await assert.rejects(coordination.unlock('report', context), { message: 'permission denied' })
})

test('answers without the result boolean are errors', async () => {
  install(() => ({ data: {}, ok: true }))

  await assert.rejects(coordination.lock('report', { waitMs: 1 }, context), /acquired boolean/)
  await assert.rejects(coordination.unlock('report', context), /released boolean/)
})
