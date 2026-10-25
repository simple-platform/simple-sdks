/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import test from 'node:test'

import { build } from 'esbuild'

const result = await build({
  bundle: true,
  entryPoints: [new URL('../dist/tasks.js', import.meta.url).pathname],
  format: 'esm',
  logLevel: 'silent',
  platform: 'neutral',
  write: false,
})
const source = Buffer.from(result.outputFiles[0].text).toString('base64')
const tasks = await import(`data:text/javascript;base64,${source}`)

const context = { logic: { execution_id: 'LEX-TASK-CREATE' } }

function install(answer) {
  const calls = []

  globalThis.__host = {
    call(name, params) {
      calls.push({ name, params: structuredClone(params) })
      return answer(name, params)
    },
    cast() {},
    getContext: () => context,
  }

  return calls
}

test('creates a task with exactly the contract request and returns the task', async () => {
  const calls = install(() => ({
    data: { task: { id: 'TASK000042', revision: 0, status: 'queued' } },
    ok: true,
  }))

  assert.deepEqual(await tasks.create({
    input: { invoice_id: 'INV000017' },
    taskTypeId: 'TTY000003',
    title: 'Review the invoice',
  }, context), { task: { id: 'TASK000042', revision: 0, status: 'queued' } })
  assert.deepEqual(calls, [{
    name: 'action:tasks/create',
    params: {
      input: { invoice_id: 'INV000017' },
      task_type_id: 'TTY000003',
      title: 'Review the invoice',
    },
  }])
  assert.deepEqual(Object.keys(calls[0].params).sort(), ['input', 'task_type_id', 'title'])
})

test('refuses each invalid argument without posting', async () => {
  const calls = install(() => assert.fail('invalid input must not reach the host'))

  await assert.rejects(
    tasks.create({ input: {}, taskTypeId: '', title: 'Review' }, context),
    /taskTypeId is required/,
  )
  await assert.rejects(
    tasks.create({ input: {}, taskTypeId: 'TTY000003', title: '  ' }, context),
    /title is required/,
  )
  await assert.rejects(
    tasks.create({ input: [], taskTypeId: 'TTY000003', title: 'Review' }, context),
    /input must be an object/,
  )

  assert.deepEqual(calls, [])
})

test('surfaces the task service refusal message unchanged', async () => {
  install(() => ({ error: { message: 'TASK_INPUT_INVALID: /title' }, ok: false }))

  await assert.rejects(
    tasks.create({ input: {}, taskTypeId: 'TTY000003', title: 'Review' }, context),
    error => error instanceof Error && error.message === 'TASK_INPUT_INVALID: /title',
  )
})

test('refuses successful replies that do not contain a task summary', async () => {
  for (const data of [
    undefined,
    null,
    [],
    {},
    { task: null },
    { task: [] },
    { task: {} },
    { task: { id: 42, revision: 0, status: 'queued' } },
    { task: { id: 'TASK000042', revision: '0', status: 'queued' } },
    { task: { id: 'TASK000042', revision: 0, status: false } },
  ]) {
    install(() => ({ data, ok: true }))
    await assert.rejects(
      tasks.create({ input: {}, taskTypeId: 'TTY000003', title: 'Review' }, context),
      /Task creation response was not understood/,
    )
  }
})
