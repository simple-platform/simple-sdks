/* eslint-disable antfu/no-import-dist, test/no-import-node-test */
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createSimpleClient,
  PROTOCOL_VERSION,
  SpaceProtocolError,
} from '../dist/space/core.js'

function createTransport(response) {
  const requests = []

  return {
    request: async (request) => {
      requests.push(request)
      return response(request)
    },
    requests,
  }
}

function succeed(result) {
  return request => ({
    ok: true,
    protocol: PROTOCOL_VERSION,
    requestId: request.requestId,
    result,
  })
}

function isProtocolError(code) {
  return error => error instanceof SpaceProtocolError && error.code === code
}

const createdTask = { task: { id: 'TASK000042', revision: 0, status: 'queued' } }
const recordedReply = { messageId: 'MSG000007', taskRevision: 3 }

test('creates a task through a versioned request in a standalone Space', async () => {
  const transport = createTransport(succeed(createdTask))
  const simple = createSimpleClient({ nextRequestId: () => 'request-create', taskTransport: transport })

  const result = await simple.tasks.create({
    input: { documents: ['DOC000001'], priority: 2 },
    taskTypeId: 'TTY000003',
    title: 'Review the contract packet',
  })

  assert.deepEqual(transport.requests, [{
    operation: 'task.create',
    payload: {
      input: { documents: ['DOC000001'], priority: 2 },
      taskTypeId: 'TTY000003',
      title: 'Review the contract packet',
    },
    protocol: 1,
    requestId: 'request-create',
  }])
  assert.equal('assignedToId' in transport.requests[0].payload, false)
  assert.deepEqual(result, createdTask)
})

test('sends the assignee only when the caller names one', async () => {
  const transport = createTransport(succeed(createdTask))
  const simple = createSimpleClient({ nextRequestId: () => 'request-assign', taskTransport: transport })

  await simple.tasks.create({
    assignedToId: 'USR000005',
    input: null,
    taskTypeId: 'TTY000003',
    title: 'Call the supplier',
  })

  assert.deepEqual(transport.requests[0].payload, {
    assignedToId: 'USR000005',
    input: null,
    taskTypeId: 'TTY000003',
    title: 'Call the supplier',
  })
})

test('returns only the members task.create defines', async () => {
  const transport = createTransport(succeed({
    internal: 'not part of the contract',
    task: { ...createdTask.task, agent_state: {} },
  }))
  const simple = createSimpleClient({ taskTransport: transport })

  const result = await simple.tasks.create({ input: {}, taskTypeId: 'TTY000003', title: 'Plan' })

  assert.deepEqual(result, createdTask)
})

test('replies to a task and reports the message and the task revision', async () => {
  const transport = createTransport(succeed(recordedReply))
  const requestIds = ['request-reply', 'request-answer']
  const simple = createSimpleClient({ nextRequestId: () => requestIds.shift(), taskTransport: transport })

  const reply = await simple.tasks.reply({ content: 'Approved.', taskId: 'TASK000042' })
  const answer = await simple.tasks.reply({
    content: 'The revised drawing is attached.',
    inReplyToMessageId: 'MSG000006',
    taskId: 'TASK000042',
  })

  assert.deepEqual(transport.requests, [
    {
      operation: 'task.reply',
      payload: { content: 'Approved.', taskId: 'TASK000042' },
      protocol: 1,
      requestId: 'request-reply',
    },
    {
      operation: 'task.reply',
      payload: {
        content: 'The revised drawing is attached.',
        inReplyToMessageId: 'MSG000006',
        taskId: 'TASK000042',
      },
      protocol: 1,
      requestId: 'request-answer',
    },
  ])
  assert.deepEqual(reply, recordedReply)
  assert.deepEqual(answer, recordedReply)
})

test('explains that tasks are unavailable when the host did not negotiate them', async () => {
  const simple = createSimpleClient({})
  const message = 'Tasks are unavailable because the Space host did not negotiate the task protocol.'

  await assert.rejects(
    () => simple.tasks.create({ input: {}, taskTypeId: 'TTY000003', title: 'Plan' }),
    error => isProtocolError('unavailable')(error) && error.message === message,
  )
  await assert.rejects(
    () => simple.tasks.reply({ content: 'Done.', taskId: 'TASK000042' }),
    error => isProtocolError('unavailable')(error) && error.message === message,
  )
})

test('keeps tasks independent of the record protocol', async () => {
  const taskTransport = createTransport(succeed(createdTask))
  const simple = createSimpleClient({
    context: { applicationId: 'dev.simple.system', kind: 'record', recordId: 'USR000005', tableName: 'user' },
    taskTransport,
  })

  await assert.rejects(() => simple.records.current(), isProtocolError('unavailable'))
  assert.deepEqual(await simple.tasks.create({ input: {}, taskTypeId: 'TTY000003', title: 'Plan' }), createdTask)
})

test('refuses a task that cannot be created before anything is sent', async () => {
  const transport = createTransport(succeed(createdTask))
  const simple = createSimpleClient({ taskTransport: transport })
  const valid = { input: {}, taskTypeId: 'TTY000003', title: 'Plan' }
  const cyclic = {}
  cyclic.self = cyclic

  const invalid = [
    undefined,
    { ...valid, title: '   ' },
    { ...valid, title: undefined },
    { ...valid, taskTypeId: '' },
    { ...valid, input: undefined },
    { ...valid, input: new Date(0) },
    { ...valid, input: { at: new Date(0) } },
    { ...valid, input: [Number.NaN] },
    { ...valid, input: { run: () => {} } },
    { ...valid, input: new Map() },
    { ...valid, input: cyclic },
    { ...valid, assignedToId: '' },
    { ...valid, assignedToId: 5 },
  ]

  for (const task of invalid)
    await assert.rejects(() => simple.tasks.create(task), isProtocolError('invalid_request'))

  assert.deepEqual(transport.requests, [])
})

test('accepts a task input that repeats a value without being cyclic', async () => {
  const transport = createTransport(succeed(createdTask))
  const simple = createSimpleClient({ taskTransport: transport })
  const shared = { code: 'A1' }

  await simple.tasks.create({ input: { first: shared, second: shared }, taskTypeId: 'TTY000003', title: 'Plan' })

  assert.equal(transport.requests.length, 1)
})

test('refuses a reply that cannot be recorded before anything is sent', async () => {
  const transport = createTransport(succeed(recordedReply))
  const simple = createSimpleClient({ taskTransport: transport })
  const valid = { content: 'Done.', taskId: 'TASK000042' }

  const invalid = [
    undefined,
    { ...valid, taskId: '' },
    { ...valid, content: ' \n ' },
    { ...valid, content: 42 },
    { ...valid, inReplyToMessageId: '' },
  ]

  for (const reply of invalid)
    await assert.rejects(() => simple.tasks.reply(reply), isProtocolError('invalid_request'))

  assert.deepEqual(transport.requests, [])
})

test('translates a task refusal from the host into a structured protocol error', async () => {
  const transport = createTransport(request => ({
    error: { code: 'not_found', message: 'The task type does not exist.' },
    ok: false,
    protocol: PROTOCOL_VERSION,
    requestId: request.requestId,
  }))
  const simple = createSimpleClient({ taskTransport: transport })

  await assert.rejects(
    () => simple.tasks.create({ input: {}, taskTypeId: 'TTY999999', title: 'Plan' }),
    error => isProtocolError('not_found')(error) && error.message === 'The task type does not exist.',
  )
})

test('rejects a task response that does not match the request envelope', async () => {
  const transport = createTransport(() => ({
    ok: true,
    protocol: PROTOCOL_VERSION,
    requestId: 'another-request',
    result: recordedReply,
  }))
  const simple = createSimpleClient({ nextRequestId: () => 'request-reply', taskTransport: transport })

  await assert.rejects(
    () => simple.tasks.reply({ content: 'Done.', taskId: 'TASK000042' }),
    isProtocolError('invalid_response'),
  )
})

test('rejects a malformed task result', async () => {
  const malformedCreates = [
    {},
    { task: { id: '', revision: 0, status: 'queued' } },
    { task: { id: 'TASK000042', revision: -1, status: 'queued' } },
    { task: { id: 'TASK000042', revision: 1.5, status: 'queued' } },
    { task: { id: 'TASK000042', revision: 0, status: 'archived' } },
  ]

  for (const result of malformedCreates) {
    const simple = createSimpleClient({ taskTransport: createTransport(succeed(result)) })
    await assert.rejects(
      () => simple.tasks.create({ input: {}, taskTypeId: 'TTY000003', title: 'Plan' }),
      isProtocolError('invalid_response'),
    )
  }

  const malformedReplies = [
    {},
    { messageId: '', taskRevision: 1 },
    { messageId: 'MSG000007', taskRevision: '1' },
  ]

  for (const result of malformedReplies) {
    const simple = createSimpleClient({ taskTransport: createTransport(succeed(result)) })
    await assert.rejects(
      () => simple.tasks.reply({ content: 'Done.', taskId: 'TASK000042' }),
      isProtocolError('invalid_response'),
    )
  }
})

test('accepts every platform-standard task status', async () => {
  for (const status of ['queued', 'in_progress', 'waiting', 'completed', 'cancelled', 'failed']) {
    const result = { task: { id: 'TASK000042', revision: 0, status } }
    const simple = createSimpleClient({ taskTransport: createTransport(succeed(result)) })

    assert.deepEqual(await simple.tasks.create({ input: {}, taskTypeId: 'TTY000003', title: 'Plan' }), result)
  }
})
