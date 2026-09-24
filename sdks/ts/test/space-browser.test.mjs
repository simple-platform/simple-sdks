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

test('offers every protocol capability at version 1 during the existing Space handshake', async () => {
  const spaceWindow = new FakeSpaceWindow()
  const port = new FakePort()
  const connection = connectSpace({
    targetOrigin: 'https://acme.simple.lcl',
    window: spaceWindow,
  })

  assert.deepEqual(spaceWindow.parentMessages, [{
    message: { protocols: { document: [1], record: [1], task: [1] }, type: 'SPACE_READY' },
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

test('sends task operations over the MessagePort when the host negotiates the task protocol', async () => {
  const port = new FakePort()
  const simple = await connectWithHost(port, { kind: 'standalone' }, { task: 1 })

  const created = simple.tasks.create({ input: { packet: 'DOC000001' }, taskTypeId: 'TTY000003', title: 'Review' })

  assert.deepEqual(port.sent, [{
    request: {
      operation: 'task.create',
      payload: { input: { packet: 'DOC000001' }, taskTypeId: 'TTY000003', title: 'Review' },
      protocol: 1,
      requestId: port.sent[0].request.requestId,
    },
    type: 'SPACE_PROTOCOL_REQUEST',
  }])

  port.emit({
    response: {
      ok: true,
      protocol: PROTOCOL_VERSION,
      requestId: port.sent[0].request.requestId,
      result: { task: { id: 'TASK000042', revision: 0, status: 'queued' } },
    },
    type: 'SPACE_PROTOCOL_RESPONSE',
  })

  assert.deepEqual(await created, { task: { id: 'TASK000042', revision: 0, status: 'queued' } })
  await assert.rejects(() => simple.records.current(), error => error instanceof SpaceProtocolError && error.code === 'unavailable')
})

// A refused create exactly as the host posts it, from the platform's
// end-to-end channel test; only its requestId is replaced below.
const refusedCreateResponse = '{"type":"SPACE_PROTOCOL_RESPONSE","response":{"ok":false,"protocol":1,"requestId":"request-1","error":{"code":"task_rejected","message":"The task input is invalid.","details":{"code":"TASK_INPUT_INVALID","category":"validation","message":"The task input is invalid.","pointers":["/input","/input/amount","/input/note"],"details":{"errors":[{"code":"required","instance_pointer":"","schema_pointer":""},{"code":"type","instance_pointer":"/amount","schema_pointer":"/properties/amount"},{"code":"boolean_schema","instance_pointer":"/note","schema_pointer":"/additionalProperties"}],"truncated":false}}}}}'

test('delivers a refused task create over a real MessagePort with its details unchanged', { timeout: 5000 }, async () => {
  const { port1: spacePort, port2: hostPort } = new MessageChannel()
  hostPort.onmessage = ({ data }) => {
    const message = JSON.parse(refusedCreateResponse)
    message.response.requestId = data.request.requestId
    hostPort.postMessage(message)
  }

  try {
    const simple = await connectWithHost(spacePort, { kind: 'standalone' }, { task: 1 })
    const error = await simple.tasks.create({
      input: { amount: 'seven hundred', note: 'a synthetic note' },
      taskTypeId: 'TTY000003',
      title: 'Open the job',
    }).catch(caught => caught)

    const { error: sent } = JSON.parse(refusedCreateResponse).response
    assert.ok(error instanceof SpaceProtocolError)
    assert.equal(error.code, 'task_rejected')
    assert.equal(error.message, 'The task input is invalid.')
    assert.deepEqual(error.details, sent.details)
  }
  finally {
    spacePort.close()
    hostPort.close()
  }
})

test('keeps tasks and documents unavailable, and sends nothing, when the host negotiates only the record protocol', async () => {
  const port = new FakePort()
  const simple = await connectWithHost(port, recordContext, { record: 1 })

  await assert.rejects(
    () => simple.tasks.reply({ content: 'Done.', taskId: 'TASK000042' }),
    error => error instanceof SpaceProtocolError && error.code === 'unavailable',
  )
  await assert.rejects(
    () => simple.documents.stage({ file: new File(['x'], 'x.pdf') }),
    error => error instanceof SpaceProtocolError && error.code === 'unavailable',
  )
  assert.deepEqual(port.sent, [])
})

const stagedHandle = {
  file_hash: 'a3f1c9',
  filename: 'packet.pdf',
  mime_type: 'application/pdf',
  scope: 'staged',
  size: 15,
  storage_path: 'staged/a3f1c9',
}

function stagedResponse(requestId) {
  return {
    response: { ok: true, protocol: PROTOCOL_VERSION, requestId, result: { handle: stagedHandle } },
    type: 'SPACE_PROTOCOL_RESPONSE',
  }
}

test('stages a document over the MessagePort and names its bytes in the transfer list', async () => {
  const port = new FakePort()
  const simple = await connectWithHost(port, { kind: 'standalone' }, { document: 1 })

  const staged = simple.documents.stage({ file: new File(['contract packet'], 'packet.pdf', { type: 'application/pdf' }) })
  // The bytes are read before the request is posted, so it arrives a few turns later.
  for (let turn = 0; turn < 20 && port.sent.length === 0; turn++)
    await new Promise(resolve => setImmediate(resolve))

  const [message] = port.sent
  assert.equal(message.type, 'SPACE_PROTOCOL_REQUEST')
  assert.equal(message.request.operation, 'document.stage')
  assert.equal(message.request.protocol, 1)
  assert.equal(message.request.payload.name, 'packet.pdf')
  assert.equal(message.request.payload.mimeType, 'application/pdf')
  assert.deepEqual(port.transfers[0], [message.request.payload.bytes])

  port.emit(stagedResponse(message.request.requestId))

  assert.deepEqual(await staged, { handle: stagedHandle })
})

test('transfers the staged bytes to the host instead of copying them', { timeout: 5000 }, async () => {
  const { port1: spacePort, port2: hostPort } = new MessageChannel()
  const posted = []
  const postMessage = spacePort.postMessage.bind(spacePort)
  spacePort.postMessage = (message, transfer) => {
    posted.push(message)
    postMessage(message, transfer)
  }
  const received = []
  hostPort.onmessage = ({ data }) => {
    received.push(data)
    hostPort.postMessage(stagedResponse(data.request.requestId))
  }

  try {
    const simple = await connectWithHost(spacePort, { kind: 'standalone' }, { document: 1 })
    const result = await simple.documents.stage({ file: new File(['contract packet'], 'packet.pdf') })

    assert.deepEqual(result, { handle: stagedHandle })
    assert.equal(posted[0].request.payload.bytes.byteLength, 0, 'the Space no longer owns the bytes')
    assert.equal(new TextDecoder().decode(received[0].request.payload.bytes), 'contract packet')
  }
  finally {
    spacePort.close()
    hostPort.close()
  }
})
