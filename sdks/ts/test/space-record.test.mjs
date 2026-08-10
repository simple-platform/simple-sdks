/* eslint-disable antfu/no-import-dist, test/no-import-node-test */
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createSimpleClient,
  PROTOCOL_VERSION,
  SpaceProtocolError,
} from '../dist/space/core.js'

const recordContext = {
  applicationId: 'dev.simple.system',
  kind: 'record',
  recordId: 'USR000005',
  tableName: 'user',
}

function snapshot(revision, values = { status: 'draft' }) {
  return {
    errors: { fields: {}, form: [] },
    fields: {},
    revision,
    values,
  }
}

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

test('opens the primary record through a versioned request and exposes an immutable snapshot', async () => {
  const transport = createTransport(request => ({
    ok: true,
    protocol: PROTOCOL_VERSION,
    requestId: request.requestId,
    result: { sessionId: 'session-primary', snapshot: snapshot(1) },
  }))
  const simple = createSimpleClient({
    context: recordContext,
    nextRequestId: () => 'request-1',
    transport,
  })

  const record = await simple.records.current()

  assert.deepEqual(transport.requests, [{
    operation: 'record.current',
    payload: {},
    protocol: 1,
    requestId: 'request-1',
  }])
  assert.equal(record.id, 'session-primary')
  assert.deepEqual(record.snapshot(), snapshot(1))
  assert.throws(() => {
    record.snapshot().values.status = 'published'
  }, TypeError)
  assert.equal('subscribe' in record, false)
  assert.equal('dispose' in record, false)
  assert.equal('page' in simple, false)
})

test('keeps flexible GraphQL reads and writes under simple.data', async () => {
  const dataRequests = []
  const simple = createSimpleClient({
    dataTransport: {
      execute: async (document, variables) => {
        dataRequests.push({ document, variables })
        return { ok: true }
      },
    },
  })

  const query = 'query ListUsers { dev_simple_system__users { id } }'
  const mutation = 'mutation CreateThing($name: String!) { insert_demo__thing { id } }'

  assert.deepEqual(await simple.data.query(query), { ok: true })
  assert.deepEqual(await simple.data.mutate(mutation, { name: 'Ada' }), { ok: true })
  assert.deepEqual(dataRequests, [
    { document: query, variables: undefined },
    { document: mutation, variables: { name: 'Ada' } },
  ])
})

test('keeps data available outside a record Space and explains why record access is unavailable', async () => {
  const simple = createSimpleClient({
    dataTransport: {
      execute: async () => ({ users: [] }),
    },
  })

  assert.deepEqual(await simple.data.query('query Users { users { id } }'), { users: [] })
  await assert.rejects(
    () => simple.records.current(),
    error => error instanceof SpaceProtocolError
      && error.code === 'unavailable'
      && error.message === 'The current record is available only when this Space is configured as a record view.',
  )
})

test('translates host failures into a structured protocol error', async () => {
  const transport = createTransport(request => ({
    error: {
      code: 'forbidden',
      message: 'You cannot access this record.',
    },
    ok: false,
    protocol: PROTOCOL_VERSION,
    requestId: request.requestId,
  }))
  const simple = createSimpleClient({ context: recordContext, nextRequestId: () => 'request-2', transport })

  await assert.rejects(
    () => simple.records.current(),
    error => error instanceof SpaceProtocolError
      && error.code === 'forbidden'
      && error.message === 'You cannot access this record.',
  )
})

test('keeps the one-time primary-record snapshot after the host session changes', async () => {
  const transport = createTransport(request => ({
    ok: true,
    protocol: PROTOCOL_VERSION,
    requestId: request.requestId,
    result: { sessionId: 'session-primary', snapshot: snapshot(3) },
  }))
  const simple = createSimpleClient({ context: recordContext, nextRequestId: () => 'request-3', transport })
  const record = await simple.records.current()

  assert.deepEqual(record.snapshot(), snapshot(3))
  assert.equal('subscribe' in transport, false)
})

test('stages a completed record update and replaces the local snapshot with its response', async () => {
  const transport = createTransport((request) => {
    if (request.operation === 'record.current') {
      return {
        ok: true,
        protocol: PROTOCOL_VERSION,
        requestId: request.requestId,
        result: { sessionId: 'session-primary', snapshot: snapshot(1, { first_name: 'Before' }) },
      }
    }

    return {
      ok: true,
      protocol: PROTOCOL_VERSION,
      requestId: request.requestId,
      result: {
        ok: true,
        snapshot: snapshot(2, { first_name: 'After' }),
      },
    }
  })
  const requestIds = ['request-open', 'request-update']
  const simple = createSimpleClient({ context: recordContext, nextRequestId: () => requestIds.shift(), transport })
  const record = await simple.records.current()

  const result = await record.update({ first_name: 'After' })

  assert.deepEqual(transport.requests, [
    {
      operation: 'record.current',
      payload: {},
      protocol: 1,
      requestId: 'request-open',
    },
    {
      operation: 'record.update',
      payload: {
        sessionId: 'session-primary',
        values: { first_name: 'After' },
      },
      protocol: 1,
      requestId: 'request-update',
    },
  ])
  assert.deepEqual(result, {
    ok: true,
    snapshot: snapshot(2, { first_name: 'After' }),
  })
  assert.deepEqual(record.snapshot(), snapshot(2, { first_name: 'After' }))
})

test('submits the opaque record session and replaces the local snapshot for successful and validation results', async () => {
  const transport = createTransport((request) => {
    if (request.operation === 'record.current') {
      return {
        ok: true,
        protocol: PROTOCOL_VERSION,
        requestId: request.requestId,
        result: { sessionId: 'session-primary', snapshot: snapshot(1, { first_name: 'Before' }) },
      }
    }

    return {
      ok: true,
      protocol: PROTOCOL_VERSION,
      requestId: request.requestId,
      result: {
        ok: false,
        snapshot: {
          ...snapshot(2, { first_name: 'Before' }),
          errors: {
            fields: {},
            form: [{ code: 'form_error', message: 'First name is required.' }],
          },
        },
      },
    }
  })
  const requestIds = ['request-open', 'request-submit']
  const simple = createSimpleClient({ context: recordContext, nextRequestId: () => requestIds.shift(), transport })
  const record = await simple.records.current()

  const result = await record.submit()

  assert.deepEqual(transport.requests, [
    {
      operation: 'record.current',
      payload: {},
      protocol: 1,
      requestId: 'request-open',
    },
    {
      operation: 'record.submit',
      payload: { sessionId: 'session-primary' },
      protocol: 1,
      requestId: 'request-submit',
    },
  ])
  assert.deepEqual(result, {
    ok: false,
    snapshot: {
      ...snapshot(2, { first_name: 'Before' }),
      errors: {
        fields: {},
        form: [{ code: 'form_error', message: 'First name is required.' }],
      },
    },
  })
  assert.deepEqual(record.snapshot(), result.snapshot)
})

test('rejects a response that does not match the request envelope', async () => {
  const transport = createTransport(() => ({
    ok: true,
    protocol: PROTOCOL_VERSION,
    requestId: 'another-request',
    result: { sessionId: 'session-primary', snapshot: snapshot(1) },
  }))
  const simple = createSimpleClient({ context: recordContext, nextRequestId: () => 'request-4', transport })

  await assert.rejects(
    () => simple.records.current(),
    error => error instanceof SpaceProtocolError && error.code === 'invalid_response',
  )
})

test('rejects a malformed record snapshot that cannot render behavior feedback safely', async () => {
  const transport = createTransport(request => ({
    ok: true,
    protocol: PROTOCOL_VERSION,
    requestId: request.requestId,
    result: { sessionId: 'session-primary', snapshot: { revision: 1 } },
  }))
  const simple = createSimpleClient({ context: recordContext, nextRequestId: () => 'request-malformed-snapshot', transport })

  await assert.rejects(
    () => simple.records.current(),
    error => error instanceof SpaceProtocolError && error.code === 'invalid_response',
  )
})
