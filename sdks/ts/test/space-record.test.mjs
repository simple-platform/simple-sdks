/* eslint-disable antfu/no-import-dist, test/no-import-node-test */
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createSimpleClient,
  PROTOCOL_VERSION,
  RECORDS_PROTOCOL_VERSION,
  SpaceProtocolError,
} from '../dist/space/core.js'
import { connect } from '../dist/space/index.js'

const getRecordFormBridge = record => record[Symbol.for('@simpleplatform/sdk/space/managed-record-ui/v1')]

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
  assert.equal('record' in simple, false)
})

test('keeps records.current as the primary-record API and ensures simple.record is absent', async () => {
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
  assert.equal('record' in simple, false)
  assert.equal(simple.record, undefined)
  assert.deepEqual(transport.requests, [{
    operation: 'record.current',
    payload: {},
    protocol: 1,
    requestId: 'request-compatibility',
  }])
})

test('opens and reuses a target session by its complete record reference', async () => {
  const recordsTransport = createTransport(request => ({
    ok: true,
    protocol: PROTOCOL_VERSION,
    requestId: request.requestId,
    result: {
      form: { fields: [], recordId: request.payload.recordId, tableId: 'table-1' },
      sessionId: `session-${request.payload.appId}-${request.payload.recordId}`,
      snapshot: snapshot(1),
    },
  }))
  let requestNumber = 0
  const simple = createSimpleClient({
    context: recordContext,
    nextRequestId: () => `request-${++requestNumber}`,
    recordsTransport,
  })
  const target = { appId: 'app-a', recordId: 'rec-1', tableName: 'contacts' }

  const [first, concurrent] = await Promise.all([simple.records.open(target), simple.records.open(target)])
  const repeated = await simple.records.open(target)
  const otherApp = await simple.records.open({ ...target, appId: 'app-b' })

  assert.strictEqual(first, concurrent)
  assert.strictEqual(first, repeated)
  assert.notStrictEqual(first, otherApp)
  assert.equal(first.id, 'session-app-a-rec-1')
  assert.equal(getRecordFormBridge(first).applicationId, 'app-a')
  assert.equal(getRecordFormBridge(otherApp).applicationId, 'app-b')
  assert.deepEqual(recordsTransport.requests.map(request => ({ operation: request.operation, payload: request.payload })), [
    { operation: 'records.open', payload: target },
    { operation: 'records.open', payload: { ...target, appId: 'app-b' } },
  ])
})

test('updates and submits an opened session through its negotiated records transport', async () => {
  const recordsTransport = createTransport((request) => {
    if (request.operation === 'records.open') {
      return {
        ok: true,
        protocol: PROTOCOL_VERSION,
        requestId: request.requestId,
        result: {
          form: { fields: [], recordId: request.payload.recordId, tableId: 'table-1' },
          sessionId: 'session-opened',
          snapshot: snapshot(1),
        },
      }
    }

    return {
      ok: true,
      protocol: PROTOCOL_VERSION,
      requestId: request.requestId,
      result: {
        ok: true,
        snapshot: request.operation === 'record.update'
          ? snapshot(2, { status: 'ready' })
          : snapshot(3, { status: 'ready' }),
      },
    }
  })
  const requestIds = ['request-open', 'request-update', 'request-submit']
  const simple = createSimpleClient({ nextRequestId: () => requestIds.shift(), recordsTransport })
  const target = { appId: 'app-a', recordId: 'rec-1', tableName: 'contacts' }

  const record = await simple.records.open(target)
  const update = await record.update({ status: 'ready' })
  const submit = await record.submit()

  assert.deepEqual(recordsTransport.requests.map(({ operation, payload }) => ({ operation, payload })), [
    { operation: 'records.open', payload: target },
    { operation: 'record.update', payload: { sessionId: 'session-opened', values: { status: 'ready' } } },
    { operation: 'record.submit', payload: { sessionId: 'session-opened' } },
  ])
  assert.deepEqual(update.snapshot, snapshot(2, { status: 'ready' }))
  assert.deepEqual(submit.snapshot, snapshot(3, { status: 'ready' }))
  assert.deepEqual(record.snapshot(), snapshot(3, { status: 'ready' }))
})

test('refuses unavailable or malformed record opens before publishing a handle', async () => {
  const target = { appId: 'app-a', recordId: 'rec-1', tableName: 'contacts' }
  const unavailable = createSimpleClient({ context: recordContext })
  await assert.rejects(() => unavailable.records.open(target), error =>
    error instanceof SpaceProtocolError && error.code === 'unavailable')

  const recordsTransport = createTransport(request => ({
    ok: true,
    protocol: PROTOCOL_VERSION,
    requestId: request.requestId,
    result: { sessionId: '', snapshot: snapshot(1) },
  }))
  const simple = createSimpleClient({ recordsTransport })
  await assert.rejects(() => simple.records.open({ ...target, appId: ' ' }), error =>
    error instanceof SpaceProtocolError && error.code === 'invalid_request')
  assert.equal(recordsTransport.requests.length, 0)
  await assert.rejects(() => simple.records.open(target), error =>
    error instanceof SpaceProtocolError && error.code === 'invalid_response')
})

test('preserves host refusal codes and retries a failed open', async () => {
  let attempts = 0
  const recordsTransport = createTransport((request) => {
    attempts += 1
    return attempts === 1
      ? {
          error: { code: 'target_unavailable', message: 'The requested record is unavailable.' },
          ok: false,
          protocol: PROTOCOL_VERSION,
          requestId: request.requestId,
        }
      : {
          ok: true,
          protocol: PROTOCOL_VERSION,
          requestId: request.requestId,
          result: { sessionId: 'session-after-retry', snapshot: snapshot(1) },
        }
  })
  const simple = createSimpleClient({ recordsTransport })
  const target = { appId: 'app-a', recordId: 'rec-1', tableName: 'contacts' }

  await assert.rejects(() => simple.records.open(target), error =>
    error instanceof SpaceProtocolError && error.code === 'target_unavailable')
  assert.equal((await simple.records.open(target)).id, 'session-after-retry')
  assert.equal(recordsTransport.requests.length, 2)
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
  assert.equal('record' in simple, false)
  await assert.rejects(
    () => simple.records.current(),
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

test('sets and clears a negotiated header status and refuses invalid values', () => {
  const unavailable = createSimpleClient({ context: recordContext })
  assert.throws(
    () => unavailable.ui.header.status.set({ label: 'Ready', tone: 'success' }),
    error => error instanceof SpaceProtocolError
      && error.code === 'unavailable'
      && error.message === 'The header-status bridge is unavailable for this record Space.',
  )

  const published = []
  const simple = createSimpleClient({
    context: recordContext,
    headerStatusTransport: { setStatus: status => published.push(status) },
  })
  simple.ui.header.status.set({ description: 'The record is ready.', label: 'Ready', tone: 'success' })
  simple.ui.header.status.set({ description: '', label: 'Ready', tone: 'neutral' })
  simple.ui.header.status.set(null)
  assert.deepEqual(published, [
    { description: 'The record is ready.', label: 'Ready', tone: 'success' },
    { description: '', label: 'Ready', tone: 'neutral' },
    null,
  ])

  for (const status of [
    null,
    'Ready',
    [],
    {},
    { label: 42, tone: 'neutral' },
    { label: '', tone: 'neutral' },
    { label: ' '.repeat(2), tone: 'neutral' },
    { label: 'x'.repeat(81), tone: 'neutral' },
    { label: 'Ready' },
    { label: 'Ready', tone: 'primary' },
    { description: 42, label: 'Ready', tone: 'neutral' },
  ].slice(1)) {
    assert.throws(
      () => simple.ui.header.status.set(status),
      error => error instanceof SpaceProtocolError && error.code === 'invalid_request',
    )
  }
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
  const record = await simple.records.current()

  getRecordFormBridge(record).capabilities.showToast({ description: 'Upload complete.' })
  simple.ui.toast.show({ title: 'Saved' })

  assert.deepEqual(shown, [
    { description: 'Upload complete.' },
    { title: 'Saved' },
  ])
  assert.equal(getRecordFormBridge(record).capabilities.originalCapability, true)
})

test('publishes record metadata updates through the shared UI bridge', async () => {
  let publishFormModel
  const transport = createTransport(request => ({
    ok: true,
    protocol: PROTOCOL_VERSION,
    requestId: request.requestId,
    result: {
      form: { fields: [], recordId: 'record-1', tableId: 'table-1', tableName: 'contacts' },
      sessionId: 'session-primary',
      snapshot: snapshot(1),
    },
  }))
  const simple = createSimpleClient({
    context: recordContext,
    formModelTransport: {
      subscribeFormModel: (listener) => {
        publishFormModel = listener
        return () => {
          publishFormModel = undefined
        }
      },
    },
    transport,
  })
  const record = await simple.records.current()
  const bridge = getRecordFormBridge(record)
  const descriptor = Object.getOwnPropertyDescriptor(record, Symbol.for('@simpleplatform/sdk/space/managed-record-ui/v1'))
  const observed = []
  const unsubscribe = bridge.subscribeMetadata(metadata => observed.push(metadata))

  assert.equal(descriptor?.value, bridge)
  assert.equal(descriptor?.enumerable, false)
  assert.equal(descriptor?.writable, false)
  assert.deepEqual(bridge.metadata, {
    fields: [],
    recordId: 'record-1',
    tableId: 'table-1',
    tableName: 'contacts',
  })
  assert.equal(typeof bridge.blurField, 'function')

  publishFormModel({ fields: [], recordId: 'record-2', tableId: 'table-2', tableName: 'companies' })
  unsubscribe()
  assert.deepEqual(observed, [{
    fields: [],
    recordId: 'record-2',
    tableId: 'table-2',
    tableName: 'companies',
  }])
  assert.equal(publishFormModel, undefined)
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
  const record = await simple.records.current()
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

class FakePort {
  onmessage = null
  sent = []
  started = false
  transfers = []

  emit(data) {
    this.onmessage?.({ data })
  }

  postMessage(message, transfer) {
    this.sent.push(message)
    this.transfers.push(transfer)
  }

  start() {
    this.started = true
  }
}

function replaceGlobal(name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name)
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value,
    writable: true,
  })

  return () => {
    if (descriptor)
      Object.defineProperty(globalThis, name, descriptor)
    else
      delete globalThis[name]
  }
}

class FakeSpaceWindow {
  listeners = new Set()
  parentMessages = []
  document = {
    documentElement: {
      style: { overscrollBehaviorX: 'auto', overscrollBehaviorY: 'auto' },
    },
  }

  parent = {
    postMessage: (message, targetOrigin) => this.parentMessages.push({ message, targetOrigin }),
  }

  addEventListener(_type, listener) {
    this.listeners.add(listener)
  }

  dispatchMessage(event) {
    for (const listener of this.listeners)
      listener(event)
  }

  removeEventListener(_type, listener) {
    this.listeners.delete(listener)
  }
}

test('records.open opens a secondary record session and returns a RecordHandle without close()', async () => {
  assert.equal(RECORDS_PROTOCOL_VERSION, 1)
  const recordsTransport = createTransport(request => ({
    ok: true,
    protocol: PROTOCOL_VERSION,
    requestId: request.requestId,
    result: { sessionId: 'session-opened-1', snapshot: snapshot(1, { title: 'Secondary' }) },
  }))
  const simple = createSimpleClient({
    context: recordContext,
    nextRequestId: () => 'request-open-1',
    recordsTransport,
  })

  const handle = await simple.records.open({
    appId: 'app-1',
    recordId: 'rec-1',
    tableName: 'contacts',
  })

  assert.equal(handle.id, 'session-opened-1')
  assert.deepEqual(handle.snapshot(), snapshot(1, { title: 'Secondary' }))
  assert.equal(handle.close, undefined)
  assert.deepEqual(recordsTransport.requests, [{
    operation: 'records.open',
    payload: {
      appId: 'app-1',
      recordId: 'rec-1',
      tableName: 'contacts',
    },
    protocol: 1,
    requestId: 'request-open-1',
  }])
})

test('makes records.current the sole current-record API and asserts simple.record is absent', async () => {
  const transport = createTransport(request => ({
    ok: true,
    protocol: PROTOCOL_VERSION,
    requestId: request.requestId,
    result: { sessionId: 'session-primary', snapshot: snapshot(1) },
  }))
  const simple = createSimpleClient({
    context: recordContext,
    nextRequestId: () => 'req-current',
    transport,
  })

  const recordFromCurrent = await simple.records.current()
  assert.equal(recordFromCurrent.id, 'session-primary')
  assert.deepEqual(recordFromCurrent.snapshot(), snapshot(1))

  assert.equal('record' in simple, false)
  assert.equal(simple.record, undefined)
})

test('allows records.open in standalone context when recordsTransport is negotiated while current() remains unavailable', async () => {
  const recordsTransport = createTransport(request => ({
    ok: true,
    protocol: PROTOCOL_VERSION,
    requestId: request.requestId,
    result: { sessionId: 'session-opened-standalone', snapshot: snapshot(1) },
  }))

  const standalone = createSimpleClient({
    context: { kind: 'standalone' },
    recordsTransport,
  })

  // Standalone current() is unavailable
  await assert.rejects(
    () => standalone.records.current(),
    error => error instanceof SpaceProtocolError
      && error.code === 'unavailable'
      && error.message === 'The current record is available only when this Space is configured as a record view.',
  )

  // Standalone open() succeeds with negotiated transport
  const handle = await standalone.records.open({ appId: 'app-1', recordId: 'rec-1', tableName: 'table-1' })
  assert.equal(handle.id, 'session-opened-standalone')
  assert.deepEqual(handle.snapshot(), snapshot(1))
})

test('records.open returns structured unavailable errors when records capability was not negotiated', async () => {
  // Record context without recordsTransport
  const noCapabilityRecord = createSimpleClient({
    context: recordContext,
  })
  await assert.rejects(
    () => noCapabilityRecord.records.open({ appId: 'app-1', recordId: 'rec-1', tableName: 'table-1' }),
    error => error instanceof SpaceProtocolError
      && error.code === 'unavailable'
      && error.message === 'The records protocol is unavailable for this Space.',
  )

  // Standalone context without recordsTransport
  const noCapabilityStandalone = createSimpleClient({
    context: { kind: 'standalone' },
  })
  await assert.rejects(
    () => noCapabilityStandalone.records.open({ appId: 'app-1', recordId: 'rec-1', tableName: 'table-1' }),
    error => error instanceof SpaceProtocolError
      && error.code === 'unavailable'
      && error.message === 'The records protocol is unavailable for this Space.',
  )
})

test('records.open validates reference strings locally before sending', async () => {
  const recordsTransport = createTransport(request => ({
    ok: true,
    protocol: PROTOCOL_VERSION,
    requestId: request.requestId,
    result: { sessionId: 'session-1', snapshot: snapshot(1) },
  }))
  const simple = createSimpleClient({
    context: recordContext,
    recordsTransport,
  })

  // non-object references
  await assert.rejects(
    () => simple.records.open(null),
    error => error instanceof SpaceProtocolError && error.code === 'invalid_request',
  )
  await assert.rejects(
    () => simple.records.open('app/table/rec'),
    error => error instanceof SpaceProtocolError && error.code === 'invalid_request',
  )

  // invalid appId
  await assert.rejects(
    () => simple.records.open({ appId: '', recordId: 'r', tableName: 't' }),
    error => error instanceof SpaceProtocolError && error.code === 'invalid_request',
  )
  await assert.rejects(
    () => simple.records.open({ appId: '   ', recordId: 'r', tableName: 't' }),
    error => error instanceof SpaceProtocolError && error.code === 'invalid_request',
  )
  await assert.rejects(
    () => simple.records.open({ appId: 123, recordId: 'r', tableName: 't' }),
    error => error instanceof SpaceProtocolError && error.code === 'invalid_request',
  )

  // invalid tableName
  await assert.rejects(
    () => simple.records.open({ appId: 'a', recordId: 'r', tableName: '' }),
    error => error instanceof SpaceProtocolError && error.code === 'invalid_request',
  )
  await assert.rejects(
    () => simple.records.open({ appId: 'a', recordId: 'r', tableName: '   ' }),
    error => error instanceof SpaceProtocolError && error.code === 'invalid_request',
  )
  await assert.rejects(
    () => simple.records.open({ appId: 'a', recordId: 'r', tableName: 456 }),
    error => error instanceof SpaceProtocolError && error.code === 'invalid_request',
  )

  // invalid recordId
  await assert.rejects(
    () => simple.records.open({ appId: 'a', recordId: '', tableName: 't' }),
    error => error instanceof SpaceProtocolError && error.code === 'invalid_request',
  )
  await assert.rejects(
    () => simple.records.open({ appId: 'a', recordId: '   ', tableName: 't' }),
    error => error instanceof SpaceProtocolError && error.code === 'invalid_request',
  )
  await assert.rejects(
    () => simple.records.open({ appId: 'a', recordId: 789, tableName: 't' }),
    error => error instanceof SpaceProtocolError && error.code === 'invalid_request',
  )

  // whitespace in appId
  await assert.rejects(
    () => simple.records.open({ appId: '  app', recordId: 'r', tableName: 't' }),
    error => error instanceof SpaceProtocolError && error.code === 'invalid_request',
  )
  await assert.rejects(
    () => simple.records.open({ appId: 'app  ', recordId: 'r', tableName: 't' }),
    error => error instanceof SpaceProtocolError && error.code === 'invalid_request',
  )

  // whitespace in tableName
  await assert.rejects(
    () => simple.records.open({ appId: 'a', recordId: 'r', tableName: '  table' }),
    error => error instanceof SpaceProtocolError && error.code === 'invalid_request',
  )
  await assert.rejects(
    () => simple.records.open({ appId: 'a', recordId: 'r', tableName: 'table  ' }),
    error => error instanceof SpaceProtocolError && error.code === 'invalid_request',
  )

  // whitespace in recordId
  await assert.rejects(
    () => simple.records.open({ appId: 'a', recordId: '  rec', tableName: 't' }),
    error => error instanceof SpaceProtocolError && error.code === 'invalid_request',
  )
  await assert.rejects(
    () => simple.records.open({ appId: 'a', recordId: 'rec  ', tableName: 't' }),
    error => error instanceof SpaceProtocolError && error.code === 'invalid_request',
  )

  // nothing was sent
  assert.equal(recordsTransport.requests.length, 0)
})

test('records.open rejects malformed host responses and mismatched envelopes', async () => {
  // Mismatched requestId
  const mismatchedTransport = createTransport(() => ({
    ok: true,
    protocol: PROTOCOL_VERSION,
    requestId: 'other-request-id',
    result: { sessionId: 'session-1', snapshot: snapshot(1) },
  }))
  const mismatchedSimple = createSimpleClient({
    context: recordContext,
    nextRequestId: () => 'req-open-mismatch',
    recordsTransport: mismatchedTransport,
  })
  await assert.rejects(
    () => mismatchedSimple.records.open({ appId: 'a', recordId: 'r', tableName: 't' }),
    error => error instanceof SpaceProtocolError && error.code === 'invalid_response',
  )

  // Malformed result: missing sessionId
  const missingSessionTransport = createTransport(request => ({
    ok: true,
    protocol: PROTOCOL_VERSION,
    requestId: request.requestId,
    result: { snapshot: snapshot(1) },
  }))
  const missingSessionSimple = createSimpleClient({
    context: recordContext,
    recordsTransport: missingSessionTransport,
  })
  await assert.rejects(
    () => missingSessionSimple.records.open({ appId: 'a', recordId: 'r', tableName: 't' }),
    error => error instanceof SpaceProtocolError && error.code === 'invalid_response',
  )

  // Malformed result: malformed snapshot
  const malformedSnapshotTransport = createTransport(request => ({
    ok: true,
    protocol: PROTOCOL_VERSION,
    requestId: request.requestId,
    result: { sessionId: 'session-1', snapshot: { revision: 1 } },
  }))
  const malformedSnapshotSimple = createSimpleClient({
    context: recordContext,
    recordsTransport: malformedSnapshotTransport,
  })
  await assert.rejects(
    () => malformedSnapshotSimple.records.open({ appId: 'a', recordId: 'r', tableName: 't' }),
    error => error instanceof SpaceProtocolError && error.code === 'invalid_response',
  )

  // Host error response
  const hostErrorTransport = createTransport(request => ({
    error: { code: 'record_not_found', message: 'Record does not exist.' },
    ok: false,
    protocol: PROTOCOL_VERSION,
    requestId: request.requestId,
  }))
  const hostErrorSimple = createSimpleClient({
    context: recordContext,
    recordsTransport: hostErrorTransport,
  })
  await assert.rejects(
    () => hostErrorSimple.records.open({ appId: 'a', recordId: 'r', tableName: 't' }),
    error => error instanceof SpaceProtocolError
      && error.code === 'record_not_found'
      && error.message === 'Record does not exist.',
  )
})

test('repeated opens for the same exact reference within one client share one pending promise and one handle', async () => {
  let resolveHostResponse
  const recordsTransport = createTransport(request => new Promise((resolve) => {
    resolveHostResponse = () => resolve({
      ok: true,
      protocol: PROTOCOL_VERSION,
      requestId: request.requestId,
      result: { sessionId: 'session-shared', snapshot: snapshot(1) },
    })
  }))
  const simple = createSimpleClient({
    context: recordContext,
    nextRequestId: () => 'req-shared-open',
    recordsTransport,
  })

  const ref = { appId: 'app-shared', recordId: 'rec-1', tableName: 'tbl' }
  const promise1 = simple.records.open(ref)
  const promise2 = simple.records.open(ref)

  assert.equal(promise1, promise2, 'Concurrent opens for the same reference must share the exact same pending promise')
  assert.equal(recordsTransport.requests.length, 1)

  resolveHostResponse()

  const [handle1, handle2] = await Promise.all([promise1, promise2])
  assert.equal(handle1, handle2, 'Resolved handles for concurrent opens must be identical')

  // A subsequent open after resolution also returns the same handle
  const handle3 = await simple.records.open(ref)
  assert.equal(handle3, handle1, 'Subsequent open for the same reference must return the existing handle')
  assert.equal(recordsTransport.requests.length, 1, 'No additional request is sent for repeated opens')

  // Different reference creates a separate session
  const differentRefTransport = createTransport(request => ({
    ok: true,
    protocol: PROTOCOL_VERSION,
    requestId: request.requestId,
    result: { sessionId: `session-${request.payload.recordId}`, snapshot: snapshot(1) },
  }))
  const multiSimple = createSimpleClient({
    context: recordContext,
    nextRequestId: () => 'req-multi',
    recordsTransport: differentRefTransport,
  })
  const handleA = await multiSimple.records.open({ appId: 'a', recordId: '1', tableName: 't' })
  const handleB = await multiSimple.records.open({ appId: 'a', recordId: '2', tableName: 't' })
  assert.notEqual(handleA, handleB)
  assert.equal(differentRefTransport.requests.length, 2)
})

test('record cache keys preserve tuple identity when identifiers contain separators', async () => {
  const recordsTransport = createTransport(request => ({
    ok: true,
    protocol: PROTOCOL_VERSION,
    requestId: request.requestId,
    result: { sessionId: `session-${recordsTransport.requests.length}`, snapshot: snapshot(1) },
  }))
  const simple = createSimpleClient({
    context: recordContext,
    recordsTransport,
  })

  const first = await simple.records.open({ appId: 'a\0b', recordId: 'd', tableName: 'c' })
  const second = await simple.records.open({ appId: 'a', recordId: 'd', tableName: 'b\0c' })

  assert.notEqual(first, second)
  assert.equal(recordsTransport.requests.length, 2)
})

test('failed open promise cleans up pending cache to allow subsequent retry', async () => {
  let failFirst = true
  const recordsTransport = createTransport((request) => {
    if (failFirst) {
      failFirst = false
      return {
        error: { code: 'temporary_failure', message: 'Host is busy' },
        ok: false,
        protocol: PROTOCOL_VERSION,
        requestId: request.requestId,
      }
    }
    return {
      ok: true,
      protocol: PROTOCOL_VERSION,
      requestId: request.requestId,
      result: { sessionId: 'session-retry', snapshot: snapshot(1) },
    }
  })
  const simple = createSimpleClient({
    context: recordContext,
    recordsTransport,
  })
  const ref = { appId: 'app-retry', recordId: 'r', tableName: 't' }

  await assert.rejects(
    () => simple.records.open(ref),
    error => error instanceof SpaceProtocolError && error.code === 'temporary_failure',
  )

  // Subsequent open can now succeed
  const handle = await simple.records.open(ref)
  assert.equal(handle.id, 'session-retry')
  assert.equal(recordsTransport.requests.length, 2)
})

test('opened handle relies on records.open form and does not subscribe to primary formModelTransport', async () => {
  let primaryFormSubscriber
  const secondaryFormModel = {
    fields: [{ id: 'f2', isRequired: true, name: 'secondaryField', readOnly: false, type: 'string' }],
  }

  const formModelTransport = {
    subscribeFormModel: (listener) => {
      primaryFormSubscriber = listener
      return () => {
        primaryFormSubscriber = undefined
      }
    },
  }

  const recordsTransport = createTransport(request => ({
    ok: true,
    protocol: PROTOCOL_VERSION,
    requestId: request.requestId,
    result: { form: secondaryFormModel, sessionId: 'session-secondary', snapshot: snapshot(1) },
  }))

  const simple = createSimpleClient({
    context: recordContext,
    formModelTransport,
    recordsTransport,
  })

  const openedHandle = await simple.records.open({ appId: 'a', recordId: 'r', tableName: 't' })
  const bridge = getRecordFormBridge(openedHandle)
  assert.ok(bridge, 'Bridge should be created when form is present in records.open response')
  assert.deepEqual(bridge.form, secondaryFormModel)

  // Secondary bridge does not subscribe to the primary formModelTransport
  assert.ok(!primaryFormSubscriber, 'Secondary handle must not subscribe to primary form stream')
})

test('binds opaque sessionId into managed document capability requests for record handles', async () => {
  const previewRequests = []
  const deleteRequests = []
  const createHandleRequests = []
  const decryptRequests = []

  const capabilities = {
    createDocumentHandle: async (req) => {
      createHandleRequests.push(req)
      return { file_hash: 'hash-1' }
    },
    decrypt: async (req) => {
      decryptRequests.push(req)
      return 'decrypted-secret'
    },
    deleteFile: async (req) => {
      deleteRequests.push(req)
    },
    getDocumentPreview: async (req) => {
      previewRequests.push(req)
      return { url: 'https://preview.local/file' }
    },
  }

  const recordsTransport = createTransport(request => ({
    ok: true,
    protocol: PROTOCOL_VERSION,
    requestId: request.requestId,
    result: {
      form: { fields: [] },
      sessionId: 'session-scoped-123',
      snapshot: snapshot(1),
    },
  }))

  const simple = createSimpleClient({
    capabilities,
    context: recordContext,
    recordsTransport,
  })

  const handle = await simple.records.open({ appId: 'app1', recordId: 'rec1', tableName: 'tbl1' })
  const bridge = getRecordFormBridge(handle)
  assert.ok(bridge?.capabilities)

  // 1. getDocumentPreview carries sessionId
  await bridge.capabilities.getDocumentPreview({ fieldName: 'avatar', fileHash: 'hash-abc' })
  assert.equal(previewRequests.length, 1)
  assert.deepEqual(previewRequests[0], {
    fieldName: 'avatar',
    fileHash: 'hash-abc',
    sessionId: 'session-scoped-123',
  })

  // 2. deleteFile context carries sessionId
  await bridge.capabilities.deleteFile({ context: { source: 'user' }, fileHash: 'hash-abc' })
  assert.equal(deleteRequests.length, 1)
  assert.deepEqual(deleteRequests[0], {
    context: { sessionId: 'session-scoped-123', source: 'user' },
    fileHash: 'hash-abc',
  })

  // 3. createDocumentHandle target carries sessionId
  await bridge.capabilities.createDocumentHandle({
    bytes: new ArrayBuffer(4),
    lifecycle: 'record',
    mime: 'text/plain',
    name: 'test.txt',
    target: { field: 'doc' },
  })
  assert.equal(createHandleRequests.length, 1)
  assert.deepEqual(createHandleRequests[0].target, {
    field: 'doc',
    sessionId: 'session-scoped-123',
  })

  // 4. decrypt carries sessionId
  const val = await bridge.capabilities.decrypt({
    appId: 'app1',
    fieldName: 'secret',
    recordId: 'rec1',
    tableName: 'tbl1',
  })
  assert.equal(val, 'decrypted-secret')
  assert.equal(decryptRequests.length, 1)
  assert.deepEqual(decryptRequests[0], {
    appId: 'app1',
    fieldName: 'secret',
    recordId: 'rec1',
    sessionId: 'session-scoped-123',
    tableName: 'tbl1',
  })
})

test('preserves createDocumentHandle requests that omit target for staged file handling', async () => {
  const createHandleRequests = []
  const capabilities = {
    createDocumentHandle: async (req) => {
      createHandleRequests.push(req)
      return { file_hash: 'hash-staged' }
    },
    decrypt: async () => 'secret',
    deleteFile: async () => {},
    getDocumentPreview: async () => ({ url: 'https://preview.local/file' }),
  }

  const recordsTransport = createTransport(request => ({
    ok: true,
    protocol: PROTOCOL_VERSION,
    requestId: request.requestId,
    result: {
      form: { fields: [] },
      sessionId: 'session-scoped-staged',
      snapshot: snapshot(1),
    },
  }))

  const simple = createSimpleClient({
    capabilities,
    context: recordContext,
    recordsTransport,
  })

  const handle = await simple.records.open({ appId: 'app1', recordId: 'rec1', tableName: 'tbl1' })
  const bridge = getRecordFormBridge(handle)
  assert.ok(bridge?.capabilities)

  const stagedRequest = {
    bytes: new ArrayBuffer(8),
    lifecycle: 'staged',
    mime: 'text/plain',
    name: 'staged.txt',
  }

  const result = await bridge.capabilities.createDocumentHandle(stagedRequest)
  assert.deepEqual(result, { file_hash: 'hash-staged' })
  assert.equal(createHandleRequests.length, 1)
  assert.equal('target' in createHandleRequests[0], false, 'target must remain absent for staged handle requests')
  assert.equal(createHandleRequests[0].target, undefined)
  assert.deepEqual(createHandleRequests[0], stagedRequest)
})

test('requires and preserves deleteFile context while augmenting with sessionId', async () => {
  const deleteRequests = []
  const capabilities = {
    createDocumentHandle: async () => ({ file_hash: 'hash-1' }),
    decrypt: async () => 'secret',
    deleteFile: async (req) => {
      deleteRequests.push(req)
    },
    getDocumentPreview: async () => ({ url: 'https://preview.local/file' }),
  }

  const recordsTransport = createTransport(request => ({
    ok: true,
    protocol: PROTOCOL_VERSION,
    requestId: request.requestId,
    result: {
      form: { fields: [] },
      sessionId: 'session-scoped-del',
      snapshot: snapshot(1),
    },
  }))

  const simple = createSimpleClient({
    capabilities,
    context: recordContext,
    recordsTransport,
  })

  const handle = await simple.records.open({ appId: 'app1', recordId: 'rec1', tableName: 'tbl1' })
  const bridge = getRecordFormBridge(handle)
  assert.ok(bridge?.capabilities)

  const deleteRequest = {
    context: {
      componentId: 'file-dropzone',
      source: 'user-delete',
    },
    fileHash: 'hash-abc',
  }

  await bridge.capabilities.deleteFile(deleteRequest)
  assert.equal(deleteRequests.length, 1)
  assert.deepEqual(deleteRequests[0], {
    context: {
      componentId: 'file-dropzone',
      sessionId: 'session-scoped-del',
      source: 'user-delete',
    },
    fileHash: 'hash-abc',
  })
})

test('connect negotiates records protocol capability at version 1', async () => {
  const port = new FakePort()
  const spaceWindow = new FakeSpaceWindow()
  const restoreWindow = replaceGlobal('window', spaceWindow)

  try {
    const connection = connect({ targetOrigin: 'https://acme.simple.lcl' })
    spaceWindow.dispatchMessage({
      data: {
        context: recordContext,
        protocols: { records: 1 },
        type: 'INIT_RPC',
      },
      origin: 'https://acme.simple.lcl',
      ports: [port],
    })

    const simple = await connection
    const openPromise = simple.records.open({ appId: 'app1', recordId: 'USR001', tableName: 'users' })

    assert.equal(port.sent.length, 1)
    const [msg] = port.sent
    assert.equal(msg.type, 'SPACE_PROTOCOL_REQUEST')
    assert.equal(msg.request.operation, 'records.open')
    assert.equal(msg.request.protocol, 1)
    assert.deepEqual(msg.request.payload, { appId: 'app1', recordId: 'USR001', tableName: 'users' })

    port.emit({
      response: {
        ok: true,
        protocol: 1,
        requestId: msg.request.requestId,
        result: { sessionId: 'session-connected', snapshot: snapshot(1) },
      },
      type: 'SPACE_PROTOCOL_RESPONSE',
    })

    const handle = await openPromise
    assert.equal(handle.id, 'session-connected')
  }
  finally {
    restoreWindow()
  }
})

test('connect does not enable records when records capability was not negotiated', async () => {
  const port = new FakePort()
  const spaceWindow = new FakeSpaceWindow()
  const restoreWindow = replaceGlobal('window', spaceWindow)

  try {
    const connection = connect({ targetOrigin: 'https://acme.simple.lcl' })
    spaceWindow.dispatchMessage({
      data: {
        context: recordContext,
        protocols: { record: 1 },
        type: 'INIT_RPC',
      },
      origin: 'https://acme.simple.lcl',
      ports: [port],
    })

    const simple = await connection
    await assert.rejects(
      () => simple.records.open({ appId: 'app1', recordId: 'USR001', tableName: 'users' }),
      error => error instanceof SpaceProtocolError
        && error.code === 'unavailable'
        && error.message === 'The records protocol is unavailable for this Space.',
    )
  }
  finally {
    restoreWindow()
  }
})
