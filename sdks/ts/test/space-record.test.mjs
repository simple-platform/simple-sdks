/* eslint-disable antfu/no-import-dist, test/no-import-node-test */
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createSimpleClient,
  getRecordFormBridge,
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

  const record = await simple.record()

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

test('keeps records.current as a compatibility alias for simple.record', async () => {
  const transport = createTransport(request => ({
    ok: true,
    protocol: PROTOCOL_VERSION,
    requestId: request.requestId,
    result: { sessionId: 'session-primary', snapshot: snapshot(1) },
  }))
  const simple = createSimpleClient({
    context: recordContext,
    nextRequestId: () => 'request-compatibility',
    transport,
  })

  const record = await simple.records.current()

  assert.equal(record.id, 'session-primary')
  assert.deepEqual(transport.requests, [{
    operation: 'record.current',
    payload: {},
    protocol: 1,
    requestId: 'request-compatibility',
  }])
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
    () => simple.record(),
    error => error instanceof SpaceProtocolError
      && error.code === 'unavailable'
      && error.message === 'The current record is available only when this Space is configured as a record view.',
  )

  assert.equal('setActions' in simple.ui.header, false)
  assert.throws(
    () => simple.ui.header.actions.set([]),
    error => error instanceof SpaceProtocolError
      && error.code === 'unavailable'
      && error.message === 'Header actions are available only when this Space is configured as a record view.',
  )
})

test('requires a negotiated header bridge and validates declarative header actions', () => {
  const simple = createSimpleClient({ context: recordContext })
  assert.equal('setActions' in simple.ui.header, false)
  assert.throws(
    () => simple.ui.header.actions.set([]),
    error => error instanceof SpaceProtocolError
      && error.code === 'unavailable'
      && error.message === 'The header-action bridge is unavailable for this record Space.',
  )

  const published = []
  const bridgedSimple = createSimpleClient({
    context: recordContext,
    headerTransport: { setActions: actions => published.push(actions) },
  })
  assert.equal('setActions' in bridgedSimple.ui.header, false)
  const action = { id: 'sync', label: 'Sync', onClick: () => {} }
  bridgedSimple.ui.header.actions.set([action])
  assert.deepEqual(published, [[action]])
  assert.throws(
    () => bridgedSimple.ui.header.actions.set([{ id: 'sync', label: 'Again', onClick: () => {} }, { id: 'sync', label: 'Duplicate', onClick: () => {} }]),
    /Header action ids must be unique/,
  )
  assert.throws(
    () => bridgedSimple.ui.header.actions.set([{ disabled: 'no', id: 'sync', label: 'Sync', onClick: () => {} }]),
    /Header action disabled must be a boolean/,
  )
  assert.throws(
    () => bridgedSimple.ui.header.actions.set([{ icon: 42, id: 'sync', label: 'Sync', onClick: () => {} }]),
    /Header action icon must be a string/,
  )
  assert.throws(
    () => bridgedSimple.ui.header.actions.set([{ id: 'sync', label: 'Sync', loading: 'yes', onClick: () => {} }]),
    /Header action loading must be a boolean/,
  )
})

test('shows platform toasts in any Space through the negotiated host bridge', () => {
  const unavailable = createSimpleClient({})
  assert.throws(
    () => unavailable.ui.toast.show({ description: 'Saved.' }),
    error => error instanceof SpaceProtocolError
      && error.code === 'unavailable'
      && error.message === 'The platform-toast bridge is unavailable for this Space.',
  )

  const shown = []
  const simple = createSimpleClient({
    toastTransport: { showToast: options => shown.push(options) },
  })
  simple.ui.toast.show({ description: 'Saved.' })
  simple.ui.toast.show({ title: 'Could not save', variant: 'destructive' })
  simple.ui.toast.show({ action: () => {}, description: 'Rich content is not forwarded.' })

  assert.deepEqual(shown, [
    { description: 'Saved.' },
    { title: 'Could not save', variant: 'destructive' },
    { description: 'Rich content is not forwarded.' },
  ])
  assert.throws(() => simple.ui.toast.show({}), /requires a title or description/)
  assert.throws(() => simple.ui.toast.show({ description: 'Saved.', title: ' ' }), /Toast title must be/)
  assert.throws(() => simple.ui.toast.show({ description: 42 }), /Toast description must be/)
  assert.throws(() => simple.ui.toast.show({ description: 'Saved.', variant: 'success' }), /Unsupported toast variant/)
  assert.throws(() => simple.ui.toast.show({ title: 'x'.repeat(161) }), /at most 160 characters/)
  assert.throws(() => simple.ui.toast.show({ description: 'x'.repeat(1001) }), /at most 1000 characters/)
})

test('routes private RecordForm toasts through the same platform toast transport', async () => {
  const shown = []
  const transport = createTransport(request => ({
    ok: true,
    protocol: PROTOCOL_VERSION,
    requestId: request.requestId,
    result: { sessionId: 'session-primary', snapshot: snapshot(1) },
  }))
  const simple = createSimpleClient({
    capabilities: { originalCapability: true },
    context: recordContext,
    formModelTransport: { subscribeFormModel: () => () => {} },
    toastTransport: { showToast: options => shown.push(options) },
    transport,
  })
  const record = await simple.record()

  getRecordFormBridge(record).capabilities.showToast({ description: 'Upload complete.' })
  simple.ui.toast.show({ title: 'Saved' })

  assert.deepEqual(shown, [
    { description: 'Upload complete.' },
    { title: 'Saved' },
  ])
  assert.equal(getRecordFormBridge(record).capabilities.originalCapability, true)
})

test('does not expose a RecordForm bridge when the host omits form metadata', async () => {
  const transport = createTransport(request => ({
    ok: true,
    protocol: PROTOCOL_VERSION,
    requestId: request.requestId,
    result: { sessionId: 'session-primary', snapshot: snapshot(1) },
  }))
  const simple = createSimpleClient({ context: recordContext, transport })
  const record = await simple.records.current()

  assert.deepEqual(record.snapshot().values, snapshot(1).values)
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

test('notifies the private managed form bridge when a command changes the snapshot', async () => {
  const transport = createTransport((request) => {
    if (request.operation === 'record.current') {
      return {
        ok: true,
        protocol: PROTOCOL_VERSION,
        requestId: request.requestId,
        result: {
          form: { fields: [] },
          sessionId: 'session-primary',
          snapshot: snapshot(1),
        },
      }
    }

    return {
      ok: true,
      protocol: PROTOCOL_VERSION,
      requestId: request.requestId,
      result: {
        ok: false,
        snapshot: {
          ...snapshot(2),
          formInfo: 'Please choose Ready before submitting.',
        },
      },
    }
  })
  const simple = createSimpleClient({ context: recordContext, nextRequestId: (() => {
    const ids = ['request-open', 'request-submit']
    return () => ids.shift()
  })(), transport })
  const record = await simple.record()
  const snapshots = []
  const bridge = getRecordFormBridge(record)
  const unsubscribe = bridge.subscribe(value => snapshots.push(value))

  await record.submit()
  unsubscribe()

  assert.deepEqual(snapshots, [{
    ...snapshot(2),
    formInfo: 'Please choose Ready before submitting.',
  }])
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
