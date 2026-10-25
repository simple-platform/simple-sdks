/* eslint-disable antfu/no-import-dist, test/no-import-node-test */
import assert from 'node:assert/strict'
import test from 'node:test'

import { connect, SpaceProtocolError } from '../dist/space/index.js'

class FakePort {
  onmessage = null
  sent = []

  postMessage(message) {
    this.sent.push(message)
  }

  start() {}
}

class FakeSpaceWindow {
  listeners = new Set()

  document = {
    documentElement: {
      style: { overscrollBehaviorY: 'auto' },
    },
  }

  parent = {
    postMessage() {},
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

async function connectWithHost(origin = 'https://acme.simple.lcl', context = { applicationId: 'app-a', kind: 'record', recordId: 'rec-1', tableName: 'contacts' }) {
  const port = new FakePort()
  const spaceWindow = new FakeSpaceWindow()
  const restoreWindow = replaceGlobal('window', spaceWindow)

  try {
    const connection = connect({ targetOrigin: origin })
    spaceWindow.dispatchMessage({
      data: { context, type: 'INIT_RPC' },
      origin,
      ports: [port],
    })
    return { port, simple: await connection }
  }
  finally {
    restoreWindow()
  }
}

test('navigation sends each target to the host unchanged', async () => {
  const { port, simple } = await connectWithHost()

  simple.navigation.open({ path: '/om/app-a/contacts/rec-2', target: 'same-tab' })
  simple.navigation.open({ path: '/om/app-a/contacts/rec-2', target: 'new-tab' })

  assert.deepEqual(port.sent, [
    { payload: { target: 'same-tab', url: 'https://acme.simple.lcl/om/app-a/contacts/rec-2' }, type: 'NAVIGATE_REQUEST' },
    { payload: { target: 'new-tab', url: 'https://acme.simple.lcl/om/app-a/contacts/rec-2' }, type: 'NAVIGATE_REQUEST' },
  ])
})

test('navigation defaults to same-tab and works in a standalone Space', async () => {
  const { port, simple } = await connectWithHost('https://acme.simple.lcl', { kind: 'standalone' })

  const result = simple.navigation.open({ path: '/tasks/task-123' })

  assert.equal(result, undefined)
  assert.deepEqual(port.sent, [
    { payload: { target: 'same-tab', url: 'https://acme.simple.lcl/tasks/task-123' }, type: 'NAVIGATE_REQUEST' },
  ])
})

test('navigation rejects invalid paths and targets with invalid_request', async () => {
  const { port, simple } = await connectWithHost()

  for (const path of [undefined, null, 12, '', 'tasks/task-123', '//evil.example/path', '/\\evil.example/path', '/\t/evil.example/path', '/\n/evil.example/path']) {
    assert.throws(
      () => simple.navigation.open({ path }),
      error => error instanceof SpaceProtocolError && error.code === 'invalid_request',
      `expected path ${String(path)} to be refused`,
    )
  }

  for (const target of ['_self', '_blank', 'new-window', '_top', '_parent', '', null, 1]) {
    assert.throws(
      () => simple.navigation.open({ path: '/tasks/task-123', target }),
      error => error instanceof SpaceProtocolError && error.code === 'invalid_request',
      `expected target ${String(target)} to be refused`,
    )
  }

  assert.equal(port.sent.length, 0)
})

test('navigation accepts a path holding a colon, since it cannot leave the host', async () => {
  const { port, simple } = await connectWithHost()

  simple.navigation.open({ path: '/tasks/task-123?at=a:b' })

  assert.deepEqual(port.sent, [
    { payload: { target: 'same-tab', url: 'https://acme.simple.lcl/tasks/task-123?at=a:b' }, type: 'NAVIGATE_REQUEST' },
  ])
})

test('navigation is unavailable when the connected host origin is not HTTPS', async () => {
  const { port, simple } = await connectWithHost('http://acme.simple.lcl')

  assert.throws(
    () => simple.navigation.open({ path: '/om/app-a/contacts/rec-2' }),
    error => error instanceof SpaceProtocolError && error.code === 'unavailable',
  )
  assert.equal(port.sent.length, 0)
})

test('navigation returns immediately without awaiting a host response', async () => {
  const { port, simple } = await connectWithHost()

  const result = simple.navigation.open({ path: '/tasks/task-123', target: 'new-tab' })

  assert.equal(result, undefined)
  assert.equal(port.sent.length, 1)
  assert.deepEqual(port.sent[0], {
    payload: { target: 'new-tab', url: 'https://acme.simple.lcl/tasks/task-123' },
    type: 'NAVIGATE_REQUEST',
  })
})
