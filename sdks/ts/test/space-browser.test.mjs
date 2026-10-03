/* eslint-disable antfu/no-import-dist, test/no-import-node-test */
import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_TABS_TIMEOUT_MS, PROTOCOL_VERSION } from '../dist/space/core.js'
import {
  connect,
  SpaceDataError,
  SpaceProtocolError,
} from '../dist/space/index.js'
import { getRecordFormBridge } from '../dist/space/internal.js'

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

async function connectWithHost(port, context, protocols, runtime) {
  const spaceWindow = new FakeSpaceWindow()
  const restoreWindow = replaceGlobal('window', spaceWindow)

  try {
    const connection = connect({ targetOrigin: 'https://acme.simple.lcl' })
    spaceWindow.dispatchMessage({
      data: { context, protocols, ...(runtime ? { runtime } : {}), type: 'INIT_RPC' },
      origin: 'https://acme.simple.lcl',
      ports: [port],
    })
    return await connection
  }
  finally {
    restoreWindow()
  }
}

test('connects a Space without exposing embedded transport configuration', async () => {
  const port = new FakePort()
  const spaceWindow = new FakeSpaceWindow()
  const restoreWindow = replaceGlobal('window', spaceWindow)

  try {
    const connection = connect({ targetOrigin: 'https://acme.simple.lcl' })

    assert.deepEqual(spaceWindow.parentMessages, [{
      message: { protocols: { action: [1], document: [1], form: [2], header: [1], record: [1], records: [1], tabs: [1], task: [1], toast: [1] }, type: 'SPACE_READY' },
      targetOrigin: 'https://acme.simple.lcl',
    }])

    spaceWindow.dispatchMessage({
      data: { context: recordContext, protocols: { record: 1 }, type: 'INIT_RPC' },
      origin: 'https://acme.simple.lcl',
      ports: [port],
    })

    const simple = await connection
    assert.equal('record' in simple, false)
    const primaryRecord = simple.records.current()
    port.emit({
      response: primaryRecordResponse(port.sent[0].request.requestId),
      type: 'SPACE_PROTOCOL_RESPONSE',
    })

    assert.equal((await primaryRecord).id, 'space-session-primary')
  }
  finally {
    restoreWindow()
  }
})

test('disables root viewport overscroll when connecting an embedded Space', async () => {
  const port = new FakePort()
  const spaceWindow = new FakeSpaceWindow()
  const restoreWindow = replaceGlobal('window', spaceWindow)

  try {
    const connection = connect({ targetOrigin: 'https://acme.simple.lcl' })

    assert.equal(spaceWindow.document.documentElement.style.overscrollBehaviorY, 'none')
    assert.equal(spaceWindow.document.documentElement.style.overscrollBehaviorX, 'auto')

    spaceWindow.dispatchMessage({
      data: { context: recordContext, protocols: { record: 1 }, type: 'INIT_RPC' },
      origin: 'https://acme.simple.lcl',
      ports: [port],
    })

    assert.deepEqual((await connection).context, recordContext)
  }
  finally {
    restoreWindow()
  }
})

test('keeps the managed-form bridge out of the supported Space entry point', async () => {
  const publicSpace = await import('../dist/space/index.js')

  assert.equal('getRecordFormBridge' in publicSpace, false)
  assert.equal('connectSpace' in publicSpace, false)
})

test('requires an explicit HTTP or HTTPS origin', async () => {
  await assert.rejects(
    () => connect({ targetOrigin: 'https://acme.simple.lcl/record' }),
    error => error instanceof SpaceProtocolError
      && error.code === 'invalid_request'
      && error.message === 'connect() requires targetOrigin to be an HTTP or HTTPS origin.',
  )
})

test('forwards versioned requests over a dedicated MessagePort', async () => {
  const port = new FakePort()
  const simple = await connectWithHost(port, recordContext, { header: 1, record: 1 })

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

test('offers supported Space capabilities including document staging', async () => {
  const spaceWindow = new FakeSpaceWindow()
  const port = new FakePort()
  const restoreWindow = replaceGlobal('window', spaceWindow)

  try {
    const connection = connect({ targetOrigin: 'https://acme.simple.lcl' })

    assert.deepEqual(spaceWindow.parentMessages, [{
      message: { protocols: { action: [1], document: [1], form: [2], header: [1], record: [1], records: [1], tabs: [1], task: [1], toast: [1] }, type: 'SPACE_READY' },
      targetOrigin: 'https://acme.simple.lcl',
    }])

    spaceWindow.dispatchMessage({
      data: { context: recordContext, protocols: { document: 1, record: 1 }, type: 'INIT_RPC' },
      origin: 'https://acme.simple.lcl',
      ports: [port],
    })
    const simple = await connection
    assert.deepEqual(simple.context, recordContext)
    assert.equal('record' in simple, false)
    assert.equal(typeof simple.documents.stage, 'function')
    const primaryRecord = simple.records.current()

    port.emit({
      response: primaryRecordResponse(port.sent[0].request.requestId),
      type: 'SPACE_PROTOCOL_RESPONSE',
    })

    assert.equal((await primaryRecord).id, 'space-session-primary')
  }
  finally {
    restoreWindow()
  }
})

test('SPACE_READY advertises supported protocol versions including records: [1]', () => {
  const spaceWindow = new FakeSpaceWindow()
  const restoreWindow = replaceGlobal('window', spaceWindow)

  try {
    connect({ targetOrigin: 'https://acme.simple.lcl' })
    assert.equal(spaceWindow.parentMessages.length, 1)
    const [readyMessage] = spaceWindow.parentMessages
    assert.equal(readyMessage.targetOrigin, 'https://acme.simple.lcl')
    assert.equal(readyMessage.message.type, 'SPACE_READY')
    assert.deepEqual(readyMessage.message.protocols, {
      action: [1],
      document: [1],
      form: [2],
      header: [1],
      record: [1],
      records: [1],
      tabs: [1],
      task: [1],
      toast: [1],
    })
  }
  finally {
    restoreWindow()
  }
})

test('keeps the host-selected UI Runtime descriptor private to the managed form bridge', async () => {
  const port = new FakePort()
  const runtime = {
    url: 'https://acme.simple.lcl/ui-runtime/ui-runtime-abc123.js',
    version: '0.1.0',
  }
  const simple = await connectWithHost(port, recordContext, { form: 2, record: 1 }, runtime)
  assert.equal(Object.hasOwn(simple.ui, 'runtime'), false)

  const opening = simple.records.current()
  const response = primaryRecordResponse(port.sent.at(-1).request.requestId)
  response.result.form = { fields: [] }
  port.emit({ response, type: 'SPACE_PROTOCOL_RESPONSE' })

  const record = await opening
  const bridge = getRecordFormBridge(record)
  assert.deepEqual(bridge.runtime, runtime)
  assert.equal(Object.isFrozen(bridge.runtime), true)
})

test('keeps header callbacks inside the Space while sending only button state to the host', async () => {
  const port = new FakePort()
  const simple = await connectWithHost(port, recordContext, { header: 1, record: 1 })
  assert.equal('setActions' in simple.ui.header, false)
  let completeAction
  const actionCompletion = new Promise((resolve) => {
    completeAction = resolve
  })

  simple.ui.header.actions.set([{
    disabled: false,
    icon: 'phone',
    id: 'start-call',
    label: 'Start call',
    onClick: () => actionCompletion,
    type: 'primary',
  }])

  assert.deepEqual(port.sent.at(-1), {
    actions: [{
      disabled: false,
      icon: 'phone',
      id: 'start-call',
      label: 'Start call',
      loading: undefined,
      type: 'primary',
    }],
    type: 'SPACE_HEADER_ACTIONS_SET',
  })

  port.emit({
    actionId: 'start-call',
    invocationId: 'invoke-1',
    type: 'SPACE_HEADER_ACTION_INVOKE',
  })
  completeAction()
  await new Promise(resolve => setImmediate(resolve))

  assert.deepEqual(port.sent.at(-1), {
    actionId: 'start-call',
    invocationId: 'invoke-1',
    ok: true,
    type: 'SPACE_HEADER_ACTION_RESULT',
  })
})

test('actions.set rejects with structured unavailable errors in standalone context or when host capability is absent', async () => {
  const standalonePort = new FakePort()
  const standalone = await connectWithHost(standalonePort, { kind: 'standalone' }, { header: 1 })
  assert.equal('setActions' in standalone.ui.header, false)
  assert.throws(
    () => standalone.ui.header.actions.set([]),
    error => error instanceof SpaceProtocolError
      && error.code === 'unavailable'
      && error.message === 'Header actions are available only when this Space is configured as a record view.',
  )

  const unsupportedPort = new FakePort()
  const unsupported = await connectWithHost(unsupportedPort, recordContext, { record: 1 })
  assert.equal('setActions' in unsupported.ui.header, false)
  assert.throws(
    () => unsupported.ui.header.actions.set([]),
    error => error instanceof SpaceProtocolError
      && error.code === 'unavailable'
      && error.message === 'The header-action bridge is unavailable for this record Space.',
  )
})

test('actions.set retains loading state and handles callback failures', async () => {
  const port = new FakePort()
  const simple = await connectWithHost(port, recordContext, { header: 1, record: 1 })

  simple.ui.header.actions.set([{
    disabled: true,
    id: 'refresh',
    label: 'Refreshing…',
    loading: true,
    onClick: () => {
      throw new Error('Action failed to execute.')
    },
  }])

  assert.deepEqual(port.sent.at(-1), {
    actions: [{
      disabled: true,
      icon: undefined,
      id: 'refresh',
      label: 'Refreshing…',
      loading: true,
      type: undefined,
    }],
    type: 'SPACE_HEADER_ACTIONS_SET',
  })

  port.emit({
    actionId: 'refresh',
    invocationId: 'invoke-fail',
    type: 'SPACE_HEADER_ACTION_INVOKE',
  })
  await new Promise(resolve => setImmediate(resolve))

  assert.deepEqual(port.sent.at(-1), {
    actionId: 'refresh',
    error: 'Action failed to execute.',
    invocationId: 'invoke-fail',
    ok: false,
    type: 'SPACE_HEADER_ACTION_RESULT',
  })
})

test('sends plain-text toast requests only when the host negotiates toast support', async () => {
  const port = new FakePort()
  const simple = await connectWithHost(port, { kind: 'standalone' }, { toast: 1 })

  simple.ui.toast.show({ description: 'Saved.', variant: 'default' })

  assert.deepEqual(port.sent, [{
    options: { description: 'Saved.', variant: 'default' },
    type: 'SPACE_TOAST_SHOW',
  }])

  const unsupportedPort = new FakePort()
  const unsupported = await connectWithHost(unsupportedPort, { kind: 'standalone' }, {})
  assert.throws(
    () => unsupported.ui.toast.show({ description: 'Saved.' }),
    error => error instanceof SpaceProtocolError && error.code === 'unavailable',
  )
  assert.deepEqual(unsupportedPort.sent, [])
})

test('does not advertise the rejected legacy managed-form transport', async () => {
  const port = new FakePort()
  const simple = await connectWithHost(port, recordContext, { form: 2, record: 1 })
  assert.equal(simple.context.kind, 'record')
})

test('exposes only private form metadata for the iframe-owned form protocol', async () => {
  const port = new FakePort()
  const simple = await connectWithHost(port, recordContext, { form: 2, record: 1 })
  const opening = simple.records.current()
  const requestId = port.sent.at(-1).request.requestId
  const response = primaryRecordResponse(requestId)
  response.result.form = {
    fields: [{
      displayName: 'First name',
      id: 'field-first-name',
      isRequired: true,
      name: 'first_name',
      position: 0,
      readOnly: false,
      type: 'string',
    }],
  }
  port.emit({ response, type: 'SPACE_PROTOCOL_RESPONSE' })

  const record = await opening
  const bridge = getRecordFormBridge(record)

  assert.deepEqual(bridge?.form, response.result.form)
  assert.equal('mount' in bridge, false)
})

test('renders a managed form when its first metadata arrives after record.current', async () => {
  const port = new FakePort()
  const simple = await connectWithHost(port, recordContext, { form: 2, record: 1 })
  const initialFormUpdate = {
    fields: [{ id: 'field-name', isRequired: true, name: 'name', readOnly: false, type: 'string' }],
  }

  // Form configuration can finish loading before or after the Space asks for
  // its record. Keep the newest host model until RecordForm subscribes.
  port.emit({ form: initialFormUpdate, type: 'SPACE_RECORD_FORM_UPDATE' })
  const recordRequest = simple.records.current()
  const requestId = port.sent[0].request.requestId
  port.emit({ response: primaryRecordResponse(requestId), type: 'SPACE_PROTOCOL_RESPONSE' })
  const record = await recordRequest
  const bridge = getRecordFormBridge(record)
  assert.ok(bridge)

  let receivedForm
  const unsubscribe = bridge.subscribeFormModel((form) => {
    receivedForm = form
  })
  assert.deepEqual(receivedForm, initialFormUpdate)

  const nextFormUpdate = {
    fields: [{ id: 'field-email', isRequired: false, name: 'email', readOnly: false, type: 'string' }],
  }
  port.emit({ form: nextFormUpdate, type: 'SPACE_RECORD_FORM_UPDATE' })
  assert.deepEqual(bridge.form, nextFormUpdate)
  assert.deepEqual(receivedForm, nextFormUpdate)
  unsubscribe()
})

test('includes private submit-preparation values in the host-owned record submit', async () => {
  const port = new FakePort()
  const simple = await connectWithHost(port, recordContext, { form: 2, record: 1 })
  const opening = simple.records.current()
  const response = primaryRecordResponse(port.sent.at(-1).request.requestId)
  response.result.form = { fields: [] }
  port.emit({ response, type: 'SPACE_PROTOCOL_RESPONSE' })

  const record = await opening
  const bridge = getRecordFormBridge(record)
  assert.ok(bridge)
  bridge.registerSubmitPreparation(async () => ({
    document: [{ file_hash: 'uploaded-file' }],
  }))

  const submitting = record.submit()
  for (let turn = 0; turn < 20 && !port.sent.some(message => message.request?.operation === 'record.submit'); turn++)
    await new Promise(resolve => setImmediate(resolve))

  const request = port.sent.find(message => message.request?.operation === 'record.submit')?.request
  assert.ok(request)
  assert.equal(request.operation, 'record.submit')
  assert.deepEqual(request.payload, {
    sessionId: 'space-session-primary',
    values: { document: [{ file_hash: 'uploaded-file' }] },
  })

  port.emit({
    response: {
      ok: true,
      protocol: PROTOCOL_VERSION,
      requestId: request.requestId,
      result: { ok: true, snapshot: { ...response.result.snapshot, revision: 1 } },
    },
    type: 'SPACE_PROTOCOL_RESPONSE',
  })
  assert.equal((await submitting).ok, true)
})

test('routes private RecordForm capabilities through the existing Space port', async () => {
  const port = new FakePort()
  const simple = await connectWithHost(port, recordContext, { form: 2, record: 1 })
  const opening = simple.records.current()
  const response = primaryRecordResponse(port.sent.at(-1).request.requestId)
  response.result.form = {
    fields: [{
      id: 'field-document',
      isRequired: false,
      name: 'document',
      readOnly: false,
      type: 'document',
    }],
  }
  port.emit({ response, type: 'SPACE_PROTOCOL_RESPONSE' })

  const record = await opening
  const capabilities = getRecordFormBridge(record)?.capabilities
  const decrypt = capabilities.decrypt({ appId: 'app', fieldName: 'secret', recordId: 'record', tableName: 'users' })
  const decryptRequest = port.sent.at(-1)
  assert.equal(decryptRequest.type, 'DECRYPT_REQUEST')
  port.emit({ id: decryptRequest.id, type: 'DECRYPT_RESPONSE', value: 'plain-text' })
  assert.equal(await decrypt, 'plain-text')

  const create = capabilities.createDocumentHandle({
    bytes: new ArrayBuffer(2),
    lifecycle: 'staged',
    mime: 'text/plain',
    name: 'note.txt',
  })
  const createRequest = port.sent.at(-1)
  assert.equal(createRequest.type, 'DOCUMENT_CREATE_HANDLE_REQUEST')
  port.emit({ handle: { file_hash: 'hash' }, id: createRequest.id, type: 'DOCUMENT_CREATE_HANDLE_RESPONSE' })
  assert.deepEqual(await create, { file_hash: 'hash' })

  const navigate = capabilities.navigate('/om/app/users/record')
  assert.deepEqual(port.sent.at(-1), {
    payload: {
      target: 'same-tab',
      url: 'https://acme.simple.lcl/om/app/users/record',
    },
    type: 'NAVIGATE_REQUEST',
  })
  await navigate
})

test('connects a standalone Space for data access when the host does not negotiate record protocol v1', async () => {
  const spaceWindow = new FakeSpaceWindow()
  const port = new FakePort()
  const restoreWindow = replaceGlobal('window', spaceWindow)

  try {
    const connection = connect({ targetOrigin: 'https://acme.simple.lcl' })
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
  }
  finally {
    restoreWindow()
  }
})

test('rejects a host handshake that does not explicitly provide Space context', async () => {
  const spaceWindow = new FakeSpaceWindow()
  const restoreWindow = replaceGlobal('window', spaceWindow)

  try {
    const connection = connect({ targetOrigin: 'https://acme.simple.lcl' })
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
  }
  finally {
    restoreWindow()
  }
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

test('keeps tasks and actions unavailable, and sends nothing, when the host negotiates only the record protocol', { timeout: 5000 }, async () => {
  const port = new FakePort()
  const simple = await connectWithHost(port, recordContext, { record: 1 })

  await assert.rejects(
    () => simple.tasks.reply({ content: 'Done.', taskId: 'TASK000042' }),
    error => error instanceof SpaceProtocolError && error.code === 'unavailable',
  )
  await assert.rejects(
    () => simple.actions.run('document-attach', {}),
    error => error instanceof SpaceProtocolError && error.code === 'unavailable',
  )
  assert.deepEqual(port.sent, [])
})

test('runs an action over the MessagePort when the host negotiates the action protocol', async () => {
  const port = new FakePort()
  const simple = await connectWithHost(port, { kind: 'standalone' }, { action: 1 })

  const ran = simple.actions.run('document-attach', { document_id: 'DOC000001' }, { timeoutMs: 120_000 })

  assert.deepEqual(port.sent, [{
    request: {
      operation: 'action.run',
      payload: { action: 'document-attach', input: { document_id: 'DOC000001' }, timeoutMs: 120_000 },
      protocol: 1,
      requestId: port.sent[0].request.requestId,
    },
    type: 'SPACE_PROTOCOL_REQUEST',
  }])
  assert.deepEqual(port.transfers[0], [])

  port.emit({
    response: {
      ok: true,
      protocol: PROTOCOL_VERSION,
      requestId: port.sent[0].request.requestId,
      result: { data: { document_id: 'DOC000001', status: 'attached' } },
    },
    type: 'SPACE_PROTOCOL_RESPONSE',
  })

  assert.deepEqual(await ran, { data: { document_id: 'DOC000001', status: 'attached' } })
  await assert.rejects(() => simple.tasks.reply({ content: 'Done.', taskId: 'TASK000042' }), error => error instanceof SpaceProtocolError && error.code === 'unavailable')
})

// A failed action as the host posts it: the logic endpoint's status and its
// parsed body, carrying the action's error envelope. Only the requestId is
// replaced below.
const failedActionResponse = '{"type":"SPACE_PROTOCOL_RESPONSE","response":{"ok":false,"protocol":1,"requestId":"request-1","error":{"code":"action_failed","message":"The action failed.","details":{"status":422,"body":{"error":{"version":1,"code":"DOCUMENT_NOT_FOUND","category":"validation","message":"The document does not exist.","retryable":false,"pointers":["/document_id"],"details":null,"hint":"Choose a document that is still in the job.","repair":null,"execution_id":"EXE000001"}}}}}}'

test('ends an action with timeout when the host has closed its port', { timeout: 5000 }, async (t) => {
  const { port1: spacePort, port2: hostPort } = new MessageChannel()

  try {
    const simple = await connectWithHost(spacePort, { kind: 'standalone' }, { action: 1 })
    // The host tore its end down, as it does when its Space view rebuilds the
    // connection, so the request below is posted into a port nobody reads.
    hostPort.close()
    t.mock.timers.enable({ apis: ['setTimeout'] })

    const ran = simple.actions.run('document-attach', { document_id: 'DOC000001' }, { timeoutMs: 1000 })
    t.mock.timers.tick(6000)

    await assert.rejects(ran, error => error instanceof SpaceProtocolError && error.code === 'timeout')
  }
  finally {
    spacePort.close()
    hostPort.close()
  }
})

test('delivers a failed action over a real MessagePort with its status and body unchanged', { timeout: 5000 }, async () => {
  const { port1: spacePort, port2: hostPort } = new MessageChannel()
  hostPort.onmessage = ({ data }) => {
    const message = JSON.parse(failedActionResponse)
    message.response.requestId = data.request.requestId
    hostPort.postMessage(message)
  }

  try {
    const simple = await connectWithHost(spacePort, { kind: 'standalone' }, { action: 1 })
    const error = await simple.actions.run('document-attach', { document_id: 'DOC000009' }).catch(caught => caught)

    const { error: sent } = JSON.parse(failedActionResponse).response
    assert.ok(error instanceof SpaceProtocolError)
    assert.equal(error.code, 'action_failed')
    assert.equal(error.message, 'The action failed.')
    assert.deepEqual(error.details, sent.details)
  }
  finally {
    spacePort.close()
    hostPort.close()
  }
})

test('routes tab registration, selection, and selected events over a real MessageChannel', { timeout: 5000 }, async () => {
  const { port1: spacePort, port2: hostPort } = new MessageChannel()
  const events = []
  const hostReceived = []

  hostPort.onmessage = ({ data }) => {
    hostReceived.push(data)
    if (data.type === 'SPACE_PROTOCOL_REQUEST') {
      if (data.request.operation === 'ui.tabs.set') {
        hostPort.postMessage({
          response: {
            ok: true,
            protocol: PROTOCOL_VERSION,
            requestId: data.request.requestId,
            result: { selectedTabId: 'tab-1' },
          },
          type: 'SPACE_PROTOCOL_RESPONSE',
        })
      }
      else if (data.request.operation === 'ui.tabs.select') {
        hostPort.postMessage({
          response: {
            ok: true,
            protocol: PROTOCOL_VERSION,
            requestId: data.request.requestId,
            result: { selectedTabId: data.request.payload.tabId },
          },
          type: 'SPACE_PROTOCOL_RESPONSE',
        })
      }
    }
  }

  try {
    const simple = await connectWithHost(spacePort, recordContext, { record: 1, tabs: 1 })

    const { selectedTabId } = await simple.ui.tabs.set({
      onChange: tabId => events.push(tabId),
      tabs: [
        { id: 'tab-1', title: 'Tab 1' },
        { id: 'tab-2', title: 'Tab 2' },
      ],
    })

    const registrationRequestId = hostReceived[0].request.requestId
    assert.equal(selectedTabId, 'tab-1')
    assert.deepEqual(hostReceived[0], {
      request: {
        operation: 'ui.tabs.set',
        payload: {
          tabs: [
            { default: true, id: 'tab-1', title: 'Tab 1' },
            { id: 'tab-2', title: 'Tab 2' },
          ],
        },
        protocol: 1,
        requestId: registrationRequestId,
      },
      type: 'SPACE_PROTOCOL_REQUEST',
    })

    // Host emits canonical tab selected event correlated to registrationRequestId
    hostPort.postMessage({
      registrationRequestId,
      selectedTabId: 'tab-2',
      type: 'SPACE_UI_TABS_SELECTION_CHANGED',
    })
    await new Promise(resolve => setImmediate(resolve))

    assert.deepEqual(events, ['tab-2'])

    // Programmatic select over MessagePort includes registrationRequestId and updates onChange
    await simple.ui.tabs.select('tab-1')
    assert.equal(hostReceived.length, 2)
    assert.deepEqual(hostReceived[1], {
      request: {
        operation: 'ui.tabs.select',
        payload: {
          registrationRequestId,
          tabId: 'tab-1',
        },
        protocol: 1,
        requestId: hostReceived[1].request.requestId,
      },
      type: 'SPACE_PROTOCOL_REQUEST',
    })
    assert.deepEqual(events, ['tab-2', 'tab-1'])

    // Subsequent host event for the same tab does not duplicate callback
    hostPort.postMessage({
      registrationRequestId,
      selectedTabId: 'tab-1',
      type: 'SPACE_UI_TABS_SELECTION_CHANGED',
    })
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(events, ['tab-2', 'tab-1'])
  }
  finally {
    spacePort.close()
    hostPort.close()
  }
})

test('ends a tab request with timeout when the host has closed its port', { timeout: 5000 }, async (t) => {
  const { port1: spacePort, port2: hostPort } = new MessageChannel()

  try {
    const simple = await connectWithHost(spacePort, recordContext, { record: 1, tabs: 1 })
    hostPort.close()
    t.mock.timers.enable({ apis: ['setTimeout'] })

    const setPromise = simple.ui.tabs.set({
      onChange: () => {},
      tabs: [{ id: 'tab-1', title: 'Tab 1' }],
    })
    t.mock.timers.tick(DEFAULT_TABS_TIMEOUT_MS)

    await assert.rejects(setPromise, error => error instanceof SpaceProtocolError && error.code === 'timeout')
  }
  finally {
    spacePort.close()
    hostPort.close()
  }
})
