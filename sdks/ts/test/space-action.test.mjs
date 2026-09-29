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

function refuse(error) {
  return request => ({
    error,
    ok: false,
    protocol: PROTOCOL_VERSION,
    requestId: request.requestId,
  })
}

function isProtocolError(code) {
  return error => error instanceof SpaceProtocolError && error.code === code
}

const attached = { data: { document_id: 'DOC000001', status: 'attached' } }

test('runs an action of the Space\'s own app through a versioned request', async () => {
  const transport = createTransport(succeed(attached))
  const simple = createSimpleClient({ actionTransport: transport, nextRequestId: () => 'request-run' })

  const result = await simple.actions.run('document-attach', { document_id: 'DOC000001', job_id: 'JOB000007' })

  assert.deepEqual(transport.requests, [{
    operation: 'action.run',
    payload: {
      action: 'document-attach',
      input: { document_id: 'DOC000001', job_id: 'JOB000007' },
    },
    protocol: 1,
    requestId: 'request-run',
  }])
  assert.equal('timeoutMs' in transport.requests[0].payload, false)
  assert.deepEqual(result, attached)
})

test('sends the timeout only when the caller gives one', async () => {
  const transport = createTransport(succeed(attached))
  const simple = createSimpleClient({ actionTransport: transport })

  await simple.actions.run('document-attach', { document_id: 'DOC000001' }, { timeoutMs: 120_000 })
  await simple.actions.run('document-attach', { document_id: 'DOC000001' }, {})
  await simple.actions.run('document-attach', { document_id: 'DOC000001' }, { timeoutMs: undefined })
  // Only the timeout is read from the options; the host, not the Space, names the app.
  await simple.actions.run('document-attach', {}, { appId: 'dev.simple.system', timeoutMs: 5000 })

  assert.deepEqual(transport.requests[0].payload, {
    action: 'document-attach',
    input: { document_id: 'DOC000001' },
    timeoutMs: 120_000,
  })
  assert.equal('timeoutMs' in transport.requests[1].payload, false)
  assert.equal('timeoutMs' in transport.requests[2].payload, false)
  assert.deepEqual(transport.requests[3].payload, { action: 'document-attach', input: {}, timeoutMs: 5000 })
})

test('sends any JSON value as the input, unchanged', async () => {
  const transport = createTransport(succeed(null))
  const simple = createSimpleClient({ actionTransport: transport })
  const shared = { code: 'A1' }
  const inputs = [null, {}, [], ['DOC000001'], 'DOC000001', 0, 42.5, true, false, { first: shared, second: shared }]

  for (const input of inputs)
    await simple.actions.run('job-refresh', input)

  assert.deepEqual(transport.requests.map(request => request.payload.input), inputs)
})

test('returns the action\'s JSON result exactly as the host sent it', async () => {
  const results = [null, {}, [], [1, 2], 'done', 0, false, attached, { data: [{ id: 'JOB000007' }], pagination: { next: null } }]

  for (const result of results) {
    const simple = createSimpleClient({ actionTransport: createTransport(succeed(structuredClone(result))) })
    assert.deepEqual(await simple.actions.run('job-list', {}), result)
  }
})

test('accepts every action name the contract allows', async () => {
  const transport = createTransport(succeed(null))
  const simple = createSimpleClient({ actionTransport: transport })
  const names = ['document-attach', 'a', '0', '9-lives', 'job-list-v2', 'x--y', 'trailing-']

  for (const name of names)
    await simple.actions.run(name, {})

  assert.deepEqual(transport.requests.map(request => request.payload.action), names)
})

test('explains that actions are unavailable when the host did not negotiate them', async () => {
  const simple = createSimpleClient({})

  await assert.rejects(
    () => simple.actions.run('document-attach', {}),
    error => isProtocolError('unavailable')(error)
      && error.message === 'Actions are unavailable because the Space host did not negotiate the action protocol.',
  )
})

test('keeps actions independent of the record, task, and document protocols', async () => {
  const transport = createTransport(succeed(attached))
  const simple = createSimpleClient({
    actionTransport: transport,
    context: { applicationId: 'dev.simple.system', kind: 'record', recordId: 'USR000005', tableName: 'user' },
  })

  await assert.rejects(() => simple.records.current(), isProtocolError('unavailable'))
  await assert.rejects(() => simple.tasks.reply({ content: 'Done.', taskId: 'TASK000042' }), isProtocolError('unavailable'))
  await assert.rejects(() => simple.documents.stage({ file: new File(['x'], 'x.pdf') }), isProtocolError('unavailable'))
  assert.deepEqual(await simple.actions.run('document-attach', {}), attached)
})

test('refuses a name that is not an action of the Space\'s own app before anything is sent', async () => {
  const transport = createTransport(succeed(null))
  const simple = createSimpleClient({ actionTransport: transport })
  const names = [
    undefined,
    null,
    42,
    '',
    ' ',
    'dev.simple.system/document-attach',
    '/document-attach',
    'document-attach/',
    '../document-attach',
    'Document-Attach',
    'document_attach',
    'document.attach',
    'document attach',
    ' document-attach',
    'document-attach\n',
    '-document-attach',
  ]

  for (const name of names) {
    await assert.rejects(
      () => simple.actions.run(name, {}),
      error => isProtocolError('invalid_request')(error)
        && error.message === 'An action is named alone, in lowercase letters, digits, and hyphens, such as "document-attach".',
    )
  }

  assert.deepEqual(transport.requests, [])
})

test('refuses an input that is not a JSON value before anything is sent', async () => {
  const transport = createTransport(succeed(null))
  const simple = createSimpleClient({ actionTransport: transport })
  const cyclic = {}
  cyclic.self = cyclic
  const inputs = [
    undefined,
    new Date(0),
    { at: new Date(0) },
    [Number.NaN],
    Number.POSITIVE_INFINITY,
    { run: () => {} },
    new Map(),
    10n,
    cyclic,
  ]

  for (const input of inputs) {
    await assert.rejects(
      () => simple.actions.run('document-attach', input),
      error => isProtocolError('invalid_request')(error)
        && error.message === 'An action input must be a JSON value, and everything in it a JSON value.',
    )
  }

  assert.deepEqual(transport.requests, [])
})

test('refuses options it cannot send before anything is sent', async () => {
  const transport = createTransport(succeed(null))
  const simple = createSimpleClient({ actionTransport: transport })

  for (const options of [null, 'fast', 60_000, []]) {
    await assert.rejects(
      () => simple.actions.run('document-attach', {}, options),
      error => isProtocolError('invalid_request')(error) && error.message === 'Action options must be an object.',
    )
  }

  for (const timeoutMs of ['60000', Number.NaN, Number.POSITIVE_INFINITY, null]) {
    await assert.rejects(
      () => simple.actions.run('document-attach', {}, { timeoutMs }),
      error => isProtocolError('invalid_request')(error)
        && error.message === 'An action timeout must be a number of milliseconds.',
    )
  }

  assert.deepEqual(transport.requests, [])
})

test('leaves the range of the timeout to the host', async () => {
  const message = 'timeoutMs must be between 1000 and 1200000.'
  const transport = createTransport(refuse({ code: 'invalid_request', message }))
  const simple = createSimpleClient({ actionTransport: transport })

  const error = await simple.actions.run('document-attach', {}, { timeoutMs: 999 }).catch(caught => caught)

  assert.equal(transport.requests[0].payload.timeoutMs, 999)
  assert.ok(isProtocolError('invalid_request')(error))
  assert.equal(error.message, message)
})

// Synthetic failures in the shapes the logic endpoint answers with.
const actionFailures = {
  'a 200 that carries an error result': {
    body: { error: [{ data: 'The action stopped before it finished.', source: 'action' }] },
    status: 200,
  },
  'a refusal carrying the action\'s error envelope': {
    body: {
      error: {
        category: 'validation',
        code: 'DOCUMENT_NOT_FOUND',
        details: null,
        execution_id: 'EXE000001',
        hint: 'Choose a document that is still in the job.',
        message: 'The document does not exist.',
        pointers: ['/document_id'],
        repair: null,
        retryable: false,
        version: 1,
      },
    },
    status: 422,
  },
  'a server error with no JSON body': {
    body: null,
    status: 502,
  },
}

for (const [failureCase, details] of Object.entries(actionFailures)) {
  test(`passes ${failureCase} to the Space with its status and body unchanged`, async () => {
    const message = 'The action failed.'
    // The client gets its own copy, so any change it made would show below.
    const transport = createTransport(refuse({ code: 'action_failed', details: structuredClone(details), message }))
    const simple = createSimpleClient({ actionTransport: transport })

    const error = await simple.actions.run('document-attach', { document_id: 'DOC000001' }).catch(caught => caught)

    assert.ok(isProtocolError('action_failed')(error))
    assert.equal(error.message, message)
    assert.deepEqual(error.details, details)
  })
}

test('keeps a timeout, a network failure, and the other host answers apart from a failed action', async () => {
  const answers = [
    { code: 'timeout', message: 'The action did not answer within 60000 ms.' },
    { code: 'network', message: 'The action request could not be sent.' },
    { code: 'unavailable', message: 'This host cannot run actions.' },
    { code: 'unsupported_protocol', message: 'Protocol version 1 is not supported.' },
    { code: 'invalid_request', message: 'The action name is invalid.' },
  ]

  for (const answer of answers) {
    const simple = createSimpleClient({ actionTransport: createTransport(refuse(answer)) })
    const error = await simple.actions.run('document-attach', {}).catch(caught => caught)

    assert.ok(isProtocolError(answer.code)(error))
    assert.equal(error.message, answer.message)
    assert.equal(error.details, undefined)
  }
})

test('rejects an action response that does not match the request envelope', async () => {
  const transport = createTransport(() => ({
    ok: true,
    protocol: PROTOCOL_VERSION,
    requestId: 'another-request',
    result: attached,
  }))
  const simple = createSimpleClient({ actionTransport: transport, nextRequestId: () => 'request-run' })

  await assert.rejects(() => simple.actions.run('document-attach', {}), isProtocolError('invalid_response'))
})
