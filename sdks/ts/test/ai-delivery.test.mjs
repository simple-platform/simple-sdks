/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import test from 'node:test'

import { build } from 'esbuild'

const context = { logic: { execution_id: 'LEX-AI-DELIVERY' } }

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

test('a result says how each file travelled, in the SDK\'s casing, with nulls left out', async () => {
  install({
    data: { total: 7 },
    metadata: {
      delivery: [
        {
          delivered_as: 'text',
          fallback: null,
          filename: 'contract.pdf',
          first_page: 12,
          last_page: 30,
          transcribed_pages: [14, 15],
        },
        {
          delivered_as: 'document',
          fallback: { message: 'page 3: the tool is down', pages: [3], reason: 'transcription_failed' },
          filename: 'exhibit.pdf',
          first_page: null,
          last_page: null,
          transcribed_pages: [],
        },
      ],
      input_tokens: 900,
      output_tokens: 120,
      reasoning: null,
      reasoning_tokens: 40,
    },
  })

  const result = await ai.extract(
    [{ ...contract, deliver_as: 'text', first_page: 12, last_page: 30 }],
    { prompt: 'read it', schema: { properties: {}, type: 'object' } },
    context,
  )

  assert.deepEqual(result.metadata.delivery, [
    { deliveredAs: 'text', filename: 'contract.pdf', firstPage: 12, lastPage: 30, transcribedPages: [14, 15] },
    {
      deliveredAs: 'document',
      fallback: { message: 'page 3: the tool is down', pages: [3], reason: 'transcription_failed' },
      filename: 'exhibit.pdf',
      transcribedPages: [],
    },
  ])

  // The fields a result always carried are unchanged.
  assert.equal(result.metadata.inputTokens, 900)
  assert.equal(result.metadata.outputTokens, 120)
  assert.equal(result.metadata.reasoningTokens, 40)
})

test('a result that reports no delivery carries none', async () => {
  install({ data: 'a summary', metadata: { input_tokens: 1, output_tokens: 2 } })

  const result = await ai.summarize('some text', { prompt: 'sum it up' }, context)

  assert.equal('delivery' in result.metadata, false)
  assert.equal(result.data, 'a summary')
})
