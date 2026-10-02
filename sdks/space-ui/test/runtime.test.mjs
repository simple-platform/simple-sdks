/* eslint-disable antfu/no-import-dist, test/no-import-node-test */

import assert from 'node:assert/strict'
import test from 'node:test'

import { loadRuntime, RuntimeLoadError } from '../dist/runtime.js'

function moduleUrl(source) {
  return `data:text/javascript,${encodeURIComponent(source)}`
}

test('loads one exact runtime artifact once for concurrent callers', async () => {
  const url = moduleUrl(`
    globalThis.__simpleRuntimeLoads = (globalThis.__simpleRuntimeLoads ?? 0) + 1
    export const version = '0.1.0'
  `)

  delete globalThis.__simpleRuntimeLoads
  const [first, second] = await Promise.all([
    loadRuntime({ url, version: '0.1.0' }),
    loadRuntime({ url, version: '0.1.0' }),
  ])

  assert.deepEqual(first, { version: '0.1.0' })
  assert.strictEqual(first, second)
  assert.equal(globalThis.__simpleRuntimeLoads, 1)
  delete globalThis.__simpleRuntimeLoads
})

test('rejects a runtime artifact whose exported version is not pinned', async () => {
  const url = moduleUrl('export const version = \'0.2.0\'')

  await assert.rejects(
    () => loadRuntime({ url, version: '0.1.0' }),
    error => error instanceof RuntimeLoadError
      && error.expected === '0.1.0'
      && error.received === '0.2.0',
  )
})
