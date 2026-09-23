/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import test from 'node:test'

import { build } from 'esbuild'

const context = { logic: { execution_id: 'LEX-AI-PENDING' } }

// The AI operation takes whatever it is given, so the options only have to be
// the ones `extract` insists on before it runs.
const options = { prompt: 'read it', schema: { properties: {}, type: 'object' } }

// The SDK the way an action receives it: bundled by esbuild, which is what the
// built output is written for.
async function bundle() {
  const result = await build({
    bundle: true,
    entryPoints: [new URL('../dist/ai.js', import.meta.url).pathname],
    format: 'esm',
    logLevel: 'silent',
    platform: 'neutral',
    write: false,
  })

  const source = Buffer.from(result.outputFiles[0].text).toString('base64')

  return import(`data:text/javascript;base64,${source}`)
}

const ai = await bundle()

// The stored reference the upload answers with: the file's own path, hash,
// name, type and size, and nothing of the request that asked for it.
const uploaded = {
  file_hash: 'ffce20f1c7f5',
  filename: 'contract.pdf',
  mime_type: 'application/pdf',
  size: 1234,
  storage_path: 'acme/ephemeral/ffce20f1c7f5',
}

// A runtime bridge that stores a pending file and then runs the operation,
// recording every call with its parameters as they cross — as JSON, the way
// the runtime sends them.
function install() {
  const calls = []

  globalThis.__host = {
    call(name, params) {
      calls.push({ name, params: JSON.parse(JSON.stringify(params)) })

      if (name === 'action:documents/upload-ephemeral')
        return { data: { ...uploaded }, ok: true }

      return { data: { data: {}, metadata: {} }, ok: true }
    },
    cast() {},
    getContext: () => ({}),
  }

  return calls
}

// What the operation was given, once anything pending had been stored.
function input(calls) {
  const call = calls.find(each => each.name === 'logic:dev.simple.system/ai-orchestrator')

  assert.ok(call, 'the operation never ran')

  return call.params.input
}

function pending(overrides = {}) {
  return {
    file_hash: 'ffce20f1c7f5',
    filename: 'contract.pdf',
    mime_type: 'application/pdf',
    pending: true,
    size: 1234,
    ...overrides,
  }
}

test('a pending file is read the way it was asked for, from where it was stored', async () => {
  const calls = install()

  await ai.extract(pending({ first_page: 12, last_page: 30, send_as: 'text' }), options, context)

  assert.deepEqual(input(calls), {
    ...uploaded,
    first_page: 12,
    last_page: 30,
    send_as: 'text',
  })
})

test('a pending file asked for plainly is the stored reference and nothing else', async () => {
  const calls = install()

  await ai.extract(pending(), options, context)

  assert.deepEqual(input(calls), uploaded)
})

test('the stored file is the one the upload named, not the one the handle came in with', async () => {
  const calls = install()

  await ai.extract(
    pending({ file_hash: 'stale', send_as: 'text', storage_path: 'acme/staged/stale' }),
    options,
    context,
  )

  const sent = input(calls)

  assert.equal(sent.file_hash, uploaded.file_hash)
  assert.equal(sent.storage_path, uploaded.storage_path)
  assert.equal(sent.send_as, 'text')
  assert.ok(!('pending' in sent), 'the file was stored, so the reference may not still call itself pending')
})

test('a stored file is handed over as it came in', async () => {
  const calls = install()
  const stored = {
    file_hash: 'ffce20f1c7f5',
    filename: 'contract.pdf',
    first_page: 12,
    last_page: 30,
    mime_type: 'application/pdf',
    send_as: 'text',
    size: 1234,
    storage_path: 'acme/files/ffce20f1c7f5',
  }

  await ai.extract(stored, options, context)

  assert.deepEqual(input(calls), stored)
  assert.ok(
    !calls.some(each => each.name === 'action:documents/upload-ephemeral'),
    'a stored file was uploaded again',
  )
})

test('every file in a list is stored and read the way it was asked for', async () => {
  const calls = install()

  await ai.extract(
    [pending({ send_as: 'text' }), pending({ first_page: 2, last_page: 3 })],
    options,
    context,
  )

  assert.deepEqual(input(calls), [
    { ...uploaded, send_as: 'text' },
    { ...uploaded, first_page: 2, last_page: 3 },
  ])
})
