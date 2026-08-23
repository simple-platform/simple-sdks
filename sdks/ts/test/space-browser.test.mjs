/* eslint-disable antfu/no-import-dist, test/no-import-node-test */
import assert from 'node:assert/strict'
import test from 'node:test'

import { PROTOCOL_VERSION } from '../dist/space/core.js'
import {
  connectSpace,
  SpaceDataError,
  SpaceProtocolError,
} from '../dist/space/index.js'

class FakePort {
  onmessage = null
  sent = []
  started = false

  emit(data) {
    this.onmessage?.({ data })
  }

  postMessage(message) {
    this.sent.push(message)
  }

  start() {
    this.started = true
  }
}

class FakeSpaceWindow {
  listeners = new Set()
  parentMessages = []

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

function primaryRecordResponse(requestId) {
  return {
    ok: true,
    protocol: PROTOCOL_VERSION,
    requestId,
    result: {
      sessionId: 'space-session-primary',
      snapshot: {
        errors: { fields: {}, form: [] },
        fields: {},
        revision: 0,
        values: { status: 'draft' },
      },
    },
  }
}

const recordContext = {
  applicationId: 'dev.simple.system',
  kind: 'record',
  recordId: 'USR000005',
  tableName: 'user',
}

async function connectWithHost(port, context, protocols) {
  const spaceWindow = new FakeSpaceWindow()
  const connection = connectSpace({
    targetOrigin: 'https://acme.simple.lcl',
    window: spaceWindow,
  })
  spaceWindow.dispatchMessage({
    data: { context, protocols, type: 'INIT_RPC' },
    origin: 'https://acme.simple.lcl',
    ports: [port],
  })
  return connection
}

test('forwards versioned requests over a dedicated MessagePort', async () => {
  const port = new FakePort()
  const simple = await connectWithHost(port, recordContext, { record: 1 })

  const response = simple.records.current()

  assert.equal(port.started, true)
  assert.deepEqual(port.sent, [{
    request: {
      operation: 'record.current',
      payload: {},
      protocol: 1,
      requestId: port.sent[0].request.requestId,
    },
    type: 'SPACE_PROTOCOL_REQUEST',
  }])

  port.emit({
    response: primaryRecordResponse(port.sent[0].request.requestId),
    type: 'SPACE_PROTOCOL_RESPONSE',
  })

  assert.equal((await response).id, 'space-session-primary')
})

test('multiplexes GraphQL data requests over the record protocol MessagePort', async () => {
  const port = new FakePort()
  const simple = await connectWithHost(port, { kind: 'standalone' })
  const request = simple.data.query('query ListUsers { dev_simple_system__users { id } }', { limit: 1 })
  const payload = port.sent[0].payload

  assert.equal(port.sent[0].type, 'GRAPHQL_REQUEST')
  assert.equal(payload.query, 'query ListUsers { dev_simple_system__users { id } }')
  assert.deepEqual(payload.variables, { limit: 1 })

  port.emit({
    data: { users: [{ id: 'USR000001' }] },
    id: payload.id,
    type: 'GRAPHQL_RESPONSE',
  })

  assert.deepEqual(await request, { users: [{ id: 'USR000001' }] })
})

test('maps GraphQL bridge failures to a structured Space data error', async () => {
  const port = new FakePort()
  const simple = await connectWithHost(port, { kind: 'standalone' })
  const request = simple.data.query('query RestrictedUsers { dev_simple_system__users { id } }')
  const payload = port.sent[0].payload

  port.emit({
    error: 'You cannot query users.',
    errors: [{ message: 'You cannot query users.' }],
    id: payload.id,
    type: 'GRAPHQL_RESPONSE',
  })

  await assert.rejects(
    () => request,
    error => error instanceof SpaceDataError
      && error.code === 'request_failed'
      && error.message === 'You cannot query users.',
  )
})

test('negotiates record protocol v1 during the existing Space handshake', async () => {
  const spaceWindow = new FakeSpaceWindow()
  const port = new FakePort()
  const connection = connectSpace({
    targetOrigin: 'https://acme.simple.lcl',
    window: spaceWindow,
  })

  assert.deepEqual(spaceWindow.parentMessages, [{
    message: { protocols: { record: [1] }, type: 'SPACE_READY' },
    targetOrigin: 'https://acme.simple.lcl',
  }])

  spaceWindow.dispatchMessage({
    data: { context: recordContext, protocols: { record: 1 }, type: 'INIT_RPC' },
    origin: 'https://acme.simple.lcl',
    ports: [port],
  })
  const simple = await connection
  assert.deepEqual(simple.context, recordContext)
  const primaryRecord = simple.records.current()

  port.emit({
    response: primaryRecordResponse(port.sent[0].request.requestId),
    type: 'SPACE_PROTOCOL_RESPONSE',
  })

  assert.equal((await primaryRecord).id, 'space-session-primary')
})

test('connects a standalone Space for data access when the host does not negotiate record protocol v1', async () => {
  const spaceWindow = new FakeSpaceWindow()
  const port = new FakePort()
  const connection = connectSpace({
    targetOrigin: 'https://acme.simple.lcl',
    window: spaceWindow,
  })

  spaceWindow.dispatchMessage({
    data: { context: { kind: 'standalone' }, type: 'INIT_RPC' },
    origin: 'https://acme.simple.lcl',
    ports: [port],
  })

  const simple = await connection
  assert.deepEqual(simple.context, { kind: 'standalone' })
  const query = simple.data.query('query Users { users { id } }')

  assert.equal(port.sent[0].type, 'GRAPHQL_REQUEST')
  port.emit({
    data: { users: [] },
    id: port.sent[0].payload.id,
    type: 'GRAPHQL_RESPONSE',
  })

  assert.deepEqual(await query, { users: [] })

  await assert.rejects(
    () => simple.records.current(),
    error => error instanceof SpaceProtocolError
      && error.code === 'unavailable'
      && error.message === 'The current record is available only when this Space is configured as a record view.',
  )
})

test('rejects a host handshake that does not explicitly provide Space context', async () => {
  const spaceWindow = new FakeSpaceWindow()
  const connection = connectSpace({
    targetOrigin: 'https://acme.simple.lcl',
    window: spaceWindow,
  })

  spaceWindow.dispatchMessage({
    data: { protocols: { record: 1 }, type: 'INIT_RPC' },
    origin: 'https://acme.simple.lcl',
    ports: [new FakePort()],
  })

  await assert.rejects(
    () => connection,
    error => error instanceof SpaceProtocolError
      && error.code === 'invalid_response'
      && error.message === 'The Space host did not provide valid context.',
  )
})
