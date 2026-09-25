/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import test from 'node:test'

import { build } from 'esbuild'

const context = { logic: { execution_id: 'LEX-AI-TRANSCRIBE' } }

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

const contract = {
  file_hash: 'ffce20f1c7f5',
  filename: 'contract.pdf',
  mime_type: 'application/pdf',
  size: 1234,
  storage_path: 'acme/records/ffce20f1c7f5',
}

// A runtime bridge that answers the operation with `answer`, recording every
// call with its parameters as they cross — as JSON, the way the runtime sends
// them.
function install(answer) {
  const calls = []

  globalThis.__host = {
    call(name, params) {
      calls.push({ name, params: JSON.parse(JSON.stringify(params)) })
      return { data: answer, ok: true }
    },
    cast() {},
    getContext: () => ({}),
  }

  return calls
}

test('transcribePages asks for the transcribe operation with the pages on the reference and no prompt', async () => {
  const calls = install({
    data: {
      pages: [
        { page: 41, text: 'Scope of Work' },
        { error: 'the answer carries no pages', page: 42 },
      ],
    },
    metadata: { delivery: null, input_tokens: 0, output_tokens: 0, reasoning_tokens: 0 },
  })

  const result = await ai.transcribePages({ ...contract, first_page: 40, last_page: 52 }, {}, context)

  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'logic:dev.simple.system/ai-orchestrator')

  const payload = calls[0].params
  assert.equal(payload.operation, 'transcribe')
  assert.deepEqual(payload.input, { ...contract, first_page: 40, last_page: 52 })
  assert.equal('prompt' in payload, false)
  assert.equal('schema' in payload, false)

  assert.deepEqual(result.data.pages, [
    { page: 41, text: 'Scope of Work' },
    { error: 'the answer carries no pages', page: 42 },
  ])

  assert.equal(result.metadata.inputTokens, 0)
  assert.equal('delivery' in result.metadata, false)
})

test('transcribePages answers a page with no text as unread, never as text that is not there', async () => {
  install({
    data: {
      pages: [
        { page: 7, text: '' },
        { error: 'the model timed out', page: 8, text: 'Scope of' },
        { page: 9 },
        { page: 10, transcriptions: ['Scope of Work', 'Scope of Work'] },
      ],
    },
    metadata: {},
  })

  const result = await ai.transcribePages(contract, {}, context)

  assert.deepEqual(result.data.pages, [
    { page: 7, text: '' },
    { error: 'the model timed out', page: 8 },
    { error: 'no transcription was returned for this page', page: 9 },
    { error: 'no transcription was returned for this page', page: 10 },
  ])
})

test('transcribePages refuses anything that is not a PDF before the host is asked', async () => {
  const calls = install({ data: { pages: [] }, metadata: {} })

  await assert.rejects(
    ai.transcribePages({ ...contract, filename: 'rates.csv', mime_type: 'text/csv' }, {}, context),
    /reads the pages of a PDF/,
  )

  await assert.rejects(ai.transcribePages({ filename: 'x.pdf' }, {}, context), /valid DocumentHandle/)

  assert.equal(calls.length, 0)
})

test('transcribePages reads a PDF type written with parameters or in capitals', async () => {
  const calls = install({ data: { pages: [] }, metadata: {} })

  const result = await ai.transcribePages({ ...contract, mime_type: 'Application/PDF; version=1.7' }, {}, context)

  assert.equal(calls.length, 1)
  assert.deepEqual(result.data.pages, [])
})
