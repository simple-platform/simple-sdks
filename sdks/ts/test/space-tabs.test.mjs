/* eslint-disable antfu/no-import-dist, test/no-import-node-test */
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createSimpleClient,
  DEFAULT_TABS_TIMEOUT_MS,
  LUCIDE_ICON_NAME,
  PROTOCOL_VERSION,
  SpaceProtocolError,
  TAB_ID,
  TABS_PROTOCOL_VERSION,
  validateTabs,
} from '../dist/space/core.js'

function isProtocolError(code) {
  return error => error instanceof SpaceProtocolError && error.code === code
}

const recordContext = {
  applicationId: 'dev.simple.system',
  kind: 'record',
  recordId: 'USR000005',
  tableName: 'user',
}

function createTransport(handler) {
  const requests = []
  const listeners = new Set()
  let closed = false

  return {
    emitTabSelected(registrationRequestId, selectedTabId) {
      const event = typeof registrationRequestId === 'object' && registrationRequestId !== null
        ? registrationRequestId
        : { registrationRequestId, selectedTabId }
      for (const listener of listeners)
        listener(event)
    },
    isClosed() {
      return closed
    },
    request: async (request, transfer, signal) => {
      requests.push(request)
      if (signal?.aborted)
        throw signal.reason
      return handler(request)
    },
    requests,
    setClosed(value) {
      closed = value
    },
    subscribeTabSelected(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
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

test('tabs fail with structured unavailable errors when context is standalone or capability not negotiated', async () => {
  assert.equal(TABS_PROTOCOL_VERSION, 1)
  const transport = createTransport(succeed({ selectedTabId: 'overview' }))

  // Standalone context with transport provided
  const standalone = createSimpleClient({
    context: { kind: 'standalone' },
    tabsTransport: transport,
  })
  assert.equal(typeof standalone.ui.tabs.set, 'function')
  assert.equal(typeof standalone.ui.tabs.select, 'function')
  await assert.rejects(
    () => standalone.ui.tabs.set({ onChange: () => {}, tabs: [{ id: 'overview', title: 'Overview' }] }),
    error => isProtocolError('unavailable')(error)
      && error.message === 'Tabs are available only when this Space is configured as a record view.',
  )
  await assert.rejects(
    () => standalone.ui.tabs.select('overview'),
    error => isProtocolError('unavailable')(error)
      && error.message === 'Tabs are available only when this Space is configured as a record view.',
  )

  // Record context without tabsTransport
  const noCapability = createSimpleClient({
    context: recordContext,
  })
  assert.equal(typeof noCapability.ui.tabs.set, 'function')
  assert.equal(typeof noCapability.ui.tabs.select, 'function')
  await assert.rejects(
    () => noCapability.ui.tabs.set({ onChange: () => {}, tabs: [{ id: 'overview', title: 'Overview' }] }),
    error => isProtocolError('unavailable')(error)
      && error.message === 'The tabs bridge is unavailable for this record Space.',
  )
  await assert.rejects(
    () => noCapability.ui.tabs.select('overview'),
    error => isProtocolError('unavailable')(error)
      && error.message === 'The tabs bridge is unavailable for this record Space.',
  )

  assert.equal(transport.requests.length, 0)
})

test('validates tab input options and individual fields before sending', async () => {
  const transport = createTransport(succeed({ selectedTabId: 'overview' }))
  const simple = createSimpleClient({
    context: recordContext,
    tabsTransport: transport,
  })

  // Invalid options container
  await assert.rejects(() => simple.ui.tabs.set(null), isProtocolError('invalid_request'))
  await assert.rejects(() => simple.ui.tabs.set([]), isProtocolError('invalid_request'))
  await assert.rejects(() => simple.ui.tabs.set({ tabs: 'invalid' }), isProtocolError('invalid_request'))
  await assert.rejects(() => simple.ui.tabs.set({ tabs: null }), isProtocolError('invalid_request'))

  // onChange is required and must be a function
  await assert.rejects(
    () => simple.ui.tabs.set({ tabs: [{ id: 'tab-1', title: 'Tab 1' }] }),
    error => isProtocolError('invalid_request')(error) && error.message.includes('onChange must be a function'),
  )
  await assert.rejects(
    () => simple.ui.tabs.set({ onChange: 'not-a-fn', tabs: [{ id: 'tab-1', title: 'Tab 1' }] }),
    error => isProtocolError('invalid_request')(error) && error.message.includes('onChange must be a function'),
  )

  await assert.rejects(
    () => simple.ui.tabs.set({ tabs: [] }),
    error => isProtocolError('invalid_request')(error) && error.message.includes('onChange must be a function'),
  )

  // Bounds: 0-32 tabs
  const thirtyThreeTabs = Array.from({ length: 33 }, (_, i) => ({ id: `tab-${i}`, title: `Tab ${i}` }))
  await assert.rejects(
    () => simple.ui.tabs.set({ onChange: () => {}, tabs: thirtyThreeTabs }),
    error => isProtocolError('invalid_request')(error) && error.message === 'Tabs must contain between 0 and 32 tabs.',
  )

  // Invalid tab elements
  await assert.rejects(() => simple.ui.tabs.set({ onChange: () => {}, tabs: [null] }), isProtocolError('invalid_request'))
  await assert.rejects(() => simple.ui.tabs.set({ onChange: () => {}, tabs: ['tab-id'] }), isProtocolError('invalid_request'))

  // Invalid tab IDs: must match ^[a-z0-9][a-z0-9_-]{0,63}$
  for (const badId of ['', '   ', '-start-dash', '_start-under', 'Upper', 'has space', 'a'.repeat(65)]) {
    await assert.rejects(
      () => simple.ui.tabs.set({ onChange: () => {}, tabs: [{ id: badId, title: 'Title' }] }),
      isProtocolError('invalid_request'),
    )
  }

  // Duplicate tab ID
  await assert.rejects(
    () => simple.ui.tabs.set({ onChange: () => {}, tabs: [{ id: 'dup', title: 'A' }, { id: 'dup', title: 'B' }] }),
    isProtocolError('invalid_request'),
  )

  // Invalid title: non-blank and at most 80 characters
  for (const badTitle of ['', '   ', 123, 'a'.repeat(81)]) {
    await assert.rejects(
      () => simple.ui.tabs.set({ onChange: () => {}, tabs: [{ id: 't1', title: badTitle }] }),
      isProtocolError('invalid_request'),
    )
  }

  // Multiple defaults
  await assert.rejects(
    () => simple.ui.tabs.set({
      onChange: () => {},
      tabs: [{ default: true, id: 't1', title: 'T1' }, { default: true, id: 't2', title: 'T2' }],
    }),
    error => isProtocolError('invalid_request')(error) && error.message === 'Only one tab may be marked as default.',
  )

  // Invalid default type
  await assert.rejects(
    () => simple.ui.tabs.set({ onChange: () => {}, tabs: [{ default: 'yes', id: 't1', title: 'T1' }] }),
    isProtocolError('invalid_request'),
  )

  // Invalid icon (not kebab-case Lucide icon or not string)
  for (const invalidIcon of ['Phone', 'phone_call', '-phone', 'phone-', 'phone--call', '', '   ', 123]) {
    await assert.rejects(
      () => simple.ui.tabs.set({ onChange: () => {}, tabs: [{ icon: invalidIcon, id: 't1', title: 'T1' }] }),
      isProtocolError('invalid_request'),
    )
  }

  // Invalid text badge (empty string, blank, > 20 chars)
  for (const invalidTextBadge of ['', '   ', 'a'.repeat(21)]) {
    await assert.rejects(
      () => simple.ui.tabs.set({ onChange: () => {}, tabs: [{ badge: invalidTextBadge, id: 't1', title: 'T1' }] }),
      isProtocolError('invalid_request'),
    )
  }

  // Invalid numeric badge (negative number, float, NaN, Infinity, boolean, object)
  for (const invalidNumericBadge of [-1, -42, 3.14, Number.NaN, Number.POSITIVE_INFINITY, true, false, {}]) {
    await assert.rejects(
      () => simple.ui.tabs.set({ onChange: () => {}, tabs: [{ badge: invalidNumericBadge, id: 't1', title: 'T1' }] }),
      isProtocolError('invalid_request'),
    )
  }

  for (const invalidTone of ['primary', '', null, 42]) {
    await assert.rejects(
      () => simple.ui.tabs.set({ onChange: () => {}, tabs: [{ badgeTone: invalidTone, id: 't1', title: 'T1' }] }),
      isProtocolError('invalid_request'),
    )
  }

  // Nothing was sent because validation rejected before transport
  assert.equal(transport.requests.length, 0)
})

test('normalizes defaults and preserves valid icons and badges within bounds', async () => {
  assert.equal(typeof validateTabs, 'function')
  const directValidation = validateTabs({
    onChange: () => {},
    tabs: [{ id: 'tab-norm', title: 'Norm' }],
  })
  assert.equal(directValidation.tabs[0].default, true)

  assert.ok(TAB_ID.test('a'))
  assert.ok(TAB_ID.test('tab-1'))
  assert.ok(TAB_ID.test('tab_1'))
  assert.ok(TAB_ID.test('a'.repeat(64)))
  assert.equal(TAB_ID.test('a'.repeat(65)), false)
  assert.ok(LUCIDE_ICON_NAME.test('layout-dashboard'))

  let capturedRequest
  const transport = createTransport((request) => {
    capturedRequest = request
    return {
      ok: true,
      protocol: PROTOCOL_VERSION,
      requestId: request.requestId,
      result: { selectedTabId: 'tab-1' },
    }
  })
  const simple = createSimpleClient({
    context: recordContext,
    nextRequestId: () => 'req-defaults-1',
    tabsTransport: transport,
  })

  // When no tab is marked default, the first tab becomes default
  const result1 = await simple.ui.tabs.set({
    onChange: () => {},
    tabs: [
      { icon: 'layout-dashboard', id: 'tab-1', title: 'Dashboard' },
      { badge: 0, icon: 'message-square-more', id: 'tab-2', title: 'Messages' },
      { badge: 'a'.repeat(20), icon: 'file-text-2', id: 'tab-3', title: 'a'.repeat(80) },
    ],
  })

  assert.deepEqual(result1, { selectedTabId: 'tab-1' })
  assert.deepEqual(capturedRequest, {
    operation: 'ui.tabs.set',
    payload: {
      tabs: [
        { default: true, icon: 'layout-dashboard', id: 'tab-1', title: 'Dashboard' },
        { badge: 0, icon: 'message-square-more', id: 'tab-2', title: 'Messages' },
        { badge: 'a'.repeat(20), icon: 'file-text-2', id: 'tab-3', title: 'a'.repeat(80) },
      ],
    },
    protocol: 1,
    requestId: 'req-defaults-1',
  })

  for (const badgeTone of ['neutral', 'info', 'success', 'warning', 'danger']) {
    await simple.ui.tabs.set({
      onChange: () => {},
      tabs: [{ badge: 3, badgeTone, id: 'tab-1', title: badgeTone }],
    })
    assert.deepEqual(capturedRequest.payload.tabs[0], {
      badge: 3,
      badgeTone,
      default: true,
      id: 'tab-1',
      title: badgeTone,
    })
  }

  // When an explicit default is provided, it is preserved and first tab is not marked default
  const simple2 = createSimpleClient({
    context: recordContext,
    nextRequestId: () => 'req-defaults-2',
    tabsTransport: transport,
  })
  await simple2.ui.tabs.set({
    onChange: () => {},
    tabs: [
      { id: 'tab-1', title: 'First' },
      { default: true, id: 'tab-2', title: 'Second' },
    ],
  })

  assert.deepEqual(capturedRequest.payload.tabs, [
    { id: 'tab-1', title: 'First' },
    { default: true, id: 'tab-2', title: 'Second' },
  ])
})

test('acknowledges initial selection without calling onChange and routes correlated selected events', async () => {
  const events = []
  const transport = createTransport(succeed({ selectedTabId: 'overview' }))
  const simple = createSimpleClient({
    context: recordContext,
    nextRequestId: () => 'reg-1',
    tabsTransport: transport,
  })

  const { selectedTabId } = await simple.ui.tabs.set({
    onChange: (tabId) => {
      events.push(tabId)
    },
    tabs: [
      { id: 'overview', title: 'Overview' },
      { id: 'details', title: 'Details' },
    ],
  })

  assert.equal(selectedTabId, 'overview')
  assert.equal(events.length, 0) // onChange is NOT called on initial acknowledged set

  // Host emits tab selected event correlated to reg-1
  transport.emitTabSelected('reg-1', 'details')
  assert.deepEqual(events, ['details'])

  // Emitting the already active tab does not re-invoke onChange
  transport.emitTabSelected('reg-1', 'details')
  assert.deepEqual(events, ['details'])

  // Switching back to overview triggers onChange
  transport.emitTabSelected('reg-1', 'overview')
  assert.deepEqual(events, ['details', 'overview'])

  // Stale event with a different registration id is ignored
  transport.emitTabSelected('stale-reg-id', 'details')
  assert.deepEqual(events, ['details', 'overview'])
})

test('handles programmatic select success, unknown id, pre-registration, already-active, and deduplication', async () => {
  const events = []
  const transport = createTransport((request) => {
    if (request.operation === 'ui.tabs.set')
      return { ok: true, protocol: PROTOCOL_VERSION, requestId: request.requestId, result: { selectedTabId: 'tab-1' } }
    if (request.operation === 'ui.tabs.select')
      return { ok: true, protocol: PROTOCOL_VERSION, requestId: request.requestId, result: { selectedTabId: request.payload.tabId } }
    throw new Error(`Unexpected operation: ${request.operation}`)
  })
  const simple = createSimpleClient({
    context: recordContext,
    nextRequestId: () => 'reg-select-1',
    tabsTransport: transport,
  })

  // Pre-registration select is rejected
  await assert.rejects(
    () => simple.ui.tabs.select('tab-1'),
    error => isProtocolError('invalid_request')(error)
      && error.message === 'Cannot select a tab before tabs have been registered.',
  )
  assert.equal(transport.requests.length, 0)

  // Register tabs
  await simple.ui.tabs.set({
    onChange: t => events.push(t),
    tabs: [
      { id: 'tab-1', title: 'Tab 1' },
      { id: 'tab-2', title: 'Tab 2' },
    ],
  })
  assert.equal(transport.requests.length, 1)
  assert.equal(events.length, 0)

  // Selecting an unknown tab is rejected
  await assert.rejects(
    () => simple.ui.tabs.select('unknown-tab'),
    error => isProtocolError('invalid_request')(error)
      && error.message.includes('unknown-tab'),
  )
  assert.equal(transport.requests.length, 1)

  // Selecting the already active tab resolves immediately without sending a request or calling onChange
  await simple.ui.tabs.select('tab-1')
  assert.equal(transport.requests.length, 1) // no new wire traffic
  assert.equal(events.length, 0)

  // Selecting an inactive declared tab sends request with registrationRequestId and tabId
  let reqCount = 0
  const client2 = createSimpleClient({
    context: recordContext,
    nextRequestId: () => `req-select-${++reqCount}`,
    tabsTransport: transport,
  })
  await client2.ui.tabs.set({
    onChange: t => events.push(t),
    tabs: [{ id: 'tab-1', title: 'Tab 1' }, { id: 'tab-2', title: 'Tab 2' }],
  })
  assert.equal(events.length, 0)

  // Programmatic select invokes onChange after host response
  await client2.ui.tabs.select('tab-2')
  assert.deepEqual(transport.requests.at(-1), {
    operation: 'ui.tabs.select',
    payload: {
      registrationRequestId: 'req-select-1',
      tabId: 'tab-2',
    },
    protocol: 1,
    requestId: 'req-select-2',
  })
  assert.deepEqual(events, ['tab-2'])

  // Subsequent host event for the same selection is deduplicated and does not invoke onChange again
  transport.emitTabSelected('req-select-1', 'tab-2')
  assert.deepEqual(events, ['tab-2'])

  // Programmatic select again when tab-2 is already active is a no-op
  await client2.ui.tabs.select('tab-2')
  assert.deepEqual(events, ['tab-2'])
})

test('programmatic select deduplicates when host event arrives before response', async () => {
  const events = []
  let resolveSelectResponse
  const transport = createTransport((request) => {
    if (request.operation === 'ui.tabs.set')
      return { ok: true, protocol: PROTOCOL_VERSION, requestId: request.requestId, result: { selectedTabId: 'tab-1' } }
    if (request.operation === 'ui.tabs.select') {
      return new Promise((resolve) => {
        resolveSelectResponse = () => resolve({
          ok: true,
          protocol: PROTOCOL_VERSION,
          requestId: request.requestId,
          result: { selectedTabId: request.payload.tabId },
        })
      })
    }
    throw new Error(`Unexpected operation: ${request.operation}`)
  })

  const simple = createSimpleClient({
    context: recordContext,
    nextRequestId: () => 'reg-concurrent-1',
    tabsTransport: transport,
  })

  await simple.ui.tabs.set({
    onChange: t => events.push(t),
    tabs: [{ id: 'tab-1', title: 'Tab 1' }, { id: 'tab-2', title: 'Tab 2' }],
  })

  // Start programmatic selection of tab-2
  const selectPromise = simple.ui.tabs.select('tab-2')

  // Host sends event BEFORE response
  transport.emitTabSelected('reg-concurrent-1', 'tab-2')
  assert.deepEqual(events, ['tab-2']) // callback reached upon event

  // Now host response resolves
  resolveSelectResponse()
  await selectPromise

  // Callback was not called a second time
  assert.deepEqual(events, ['tab-2'])
})

test('rejects programmatic select when host returns mismatched or malformed result', async () => {
  // Host returns wrong selectedTabId
  const badIdTransport = createTransport((request) => {
    if (request.operation === 'ui.tabs.set')
      return { ok: true, protocol: 1, requestId: request.requestId, result: { selectedTabId: 'tab-1' } }
    return { ok: true, protocol: 1, requestId: request.requestId, result: { selectedTabId: 'wrong-tab' } }
  })
  const client1 = createSimpleClient({ context: recordContext, tabsTransport: badIdTransport })
  await client1.ui.tabs.set({
    onChange: () => {},
    tabs: [{ id: 'tab-1', title: 'Tab 1' }, { id: 'tab-2', title: 'Tab 2' }],
  })
  await assert.rejects(
    () => client1.ui.tabs.select('tab-2'),
    isProtocolError('invalid_response'),
  )

  // Host returns non-object result
  const badObjTransport = createTransport((request) => {
    if (request.operation === 'ui.tabs.set')
      return { ok: true, protocol: 1, requestId: request.requestId, result: { selectedTabId: 'tab-1' } }
    return { ok: true, protocol: 1, requestId: request.requestId, result: null }
  })
  const client2 = createSimpleClient({ context: recordContext, tabsTransport: badObjTransport })
  await client2.ui.tabs.set({
    onChange: () => {},
    tabs: [{ id: 'tab-1', title: 'Tab 1' }, { id: 'tab-2', title: 'Tab 2' }],
  })
  await assert.rejects(
    () => client2.ui.tabs.select('tab-2'),
    isProtocolError('invalid_response'),
  )
})

test('handles concurrent/superseded set ordering, drops old events immediately, and ignores late response', async () => {
  const eventsA = []
  const eventsB = []
  let resolveSetA
  let resolveSetB

  const transport = createTransport((request) => {
    if (request.requestId === 'req-set-A') {
      return new Promise((resolve) => {
        resolveSetA = () => resolve({
          ok: true,
          protocol: 1,
          requestId: 'req-set-A',
          result: { selectedTabId: 'tab-a1' },
        })
      })
    }
    if (request.requestId === 'req-set-B') {
      return new Promise((resolve) => {
        resolveSetB = () => resolve({
          ok: true,
          protocol: 1,
          requestId: 'req-set-B',
          result: { selectedTabId: 'tab-b1' },
        })
      })
    }
    if (request.operation === 'ui.tabs.select') {
      return {
        ok: true,
        protocol: 1,
        requestId: request.requestId,
        result: { selectedTabId: request.payload.tabId },
      }
    }
    throw new Error(`Unexpected request: ${request.requestId}`)
  })

  let reqCount = 0
  const simple = createSimpleClient({
    context: recordContext,
    nextRequestId: () => {
      reqCount++
      if (reqCount === 1)
        return 'req-set-A'
      if (reqCount === 2)
        return 'req-set-B'
      return `req-other-${reqCount}`
    },
    tabsTransport: transport,
  })

  // Start set A (in flight)
  const promiseA = simple.ui.tabs.set({
    onChange: t => eventsA.push(t),
    tabs: [{ id: 'tab-a1', title: 'Tab A1' }, { id: 'tab-a2', title: 'Tab A2' }],
  })

  // Immediately start set B (supersedes set A before A even responds)
  const promiseB = simple.ui.tabs.set({
    onChange: t => eventsB.push(t),
    tabs: [{ id: 'tab-b1', title: 'Tab B1' }, { id: 'tab-b2', title: 'Tab B2' }],
  })

  // Event from old set A must be dropped immediately!
  transport.emitTabSelected('req-set-A', 'tab-a2')
  assert.equal(eventsA.length, 0)
  assert.equal(eventsB.length, 0)

  // Stale event with unknown registration id must be dropped!
  transport.emitTabSelected('unknown-reg', 'tab-a2')
  assert.equal(eventsA.length, 0)
  assert.equal(eventsB.length, 0)

  // Now set B resolves first
  resolveSetB()
  const resultB = await promiseB
  assert.deepEqual(resultB, { selectedTabId: 'tab-b1' })

  // Event for set B works
  transport.emitTabSelected('req-set-B', 'tab-b2')
  assert.equal(eventsA.length, 0)
  assert.deepEqual(eventsB, ['tab-b2'])

  // Now set A finishes late: its response must be ignored and not overwrite B's state!
  resolveSetA()
  const resultA = await promiseA
  assert.deepEqual(resultA, { selectedTabId: 'tab-a1' })

  // An event for A is still dropped!
  transport.emitTabSelected('req-set-A', 'tab-a1')
  assert.equal(eventsA.length, 0)
  assert.deepEqual(eventsB, ['tab-b2'])

  // Active registration is still B
  await simple.ui.tabs.select('tab-b1')
  assert.deepEqual(eventsB, ['tab-b2', 'tab-b1'])
})

test('ignores a late error response from a set superseded by a newer registration', async () => {
  let resolveOldSet
  const transport = createTransport((request) => {
    if (request.requestId === 'old-set') {
      return new Promise((resolve) => {
        resolveOldSet = () => resolve(refuse({ code: 'invalid_request', message: 'Registration was replaced.' })(request))
      })
    }
    return succeed({ selectedTabId: 'current' })(request)
  })

  let requestNumber = 0
  const simple = createSimpleClient({
    context: recordContext,
    nextRequestId: () => ++requestNumber === 1 ? 'old-set' : 'new-set',
    tabsTransport: transport,
  })

  const oldSet = simple.ui.tabs.set({
    onChange: () => {},
    tabs: [{ id: 'old', title: 'Old' }],
  })
  assert.deepEqual(await simple.ui.tabs.set({
    onChange: () => {},
    tabs: [{ id: 'current', title: 'Current' }],
  }), { selectedTabId: 'current' })

  resolveOldSet()
  assert.deepEqual(await oldSet, { selectedTabId: null })
  assert.deepEqual(transport.requests.map(request => request.requestId), ['old-set', 'new-set'])
})

test('ignores a late transport rejection from a set superseded by a newer registration', async () => {
  let rejectOldSet
  const transport = createTransport((request) => {
    if (request.requestId === 'old-set') {
      return new Promise((_, reject) => {
        rejectOldSet = () => reject(new Error('Space transport disconnected.'))
      })
    }
    return succeed({ selectedTabId: 'current' })(request)
  })

  let requestNumber = 0
  const simple = createSimpleClient({
    context: recordContext,
    nextRequestId: () => ++requestNumber === 1 ? 'old-set' : 'new-set',
    tabsTransport: transport,
  })

  const oldSet = simple.ui.tabs.set({
    onChange: () => {},
    tabs: [{ id: 'old', title: 'Old' }],
  })
  assert.deepEqual(await simple.ui.tabs.set({
    onChange: () => {},
    tabs: [{ id: 'current', title: 'Current' }],
  }), { selectedTabId: 'current' })

  rejectOldSet()
  assert.deepEqual(await oldSet, { selectedTabId: null })
})

test('rejects malformed or mismatched host responses on set', async () => {
  // Host answers unknown selectedTabId
  const badIdTransport = createTransport(succeed({ selectedTabId: 'non-existent' }))
  const client1 = createSimpleClient({ context: recordContext, tabsTransport: badIdTransport })
  await assert.rejects(
    () => client1.ui.tabs.set({ onChange: () => {}, tabs: [{ id: 'tab-1', title: 'Tab 1' }] }),
    isProtocolError('invalid_response'),
  )

  // Host answers null selectedTabId
  const nullIdTransport = createTransport(succeed({ selectedTabId: null }))
  const client2 = createSimpleClient({ context: recordContext, tabsTransport: nullIdTransport })
  await assert.rejects(
    () => client2.ui.tabs.set({ onChange: () => {}, tabs: [{ id: 'tab-1', title: 'Tab 1' }] }),
    isProtocolError('invalid_response'),
  )

  // Host answers non-object
  const nonObjTransport = createTransport(succeed('invalid-result'))
  const client3 = createSimpleClient({ context: recordContext, tabsTransport: nonObjTransport })
  await assert.rejects(
    () => client3.ui.tabs.set({ onChange: () => {}, tabs: [{ id: 'tab-1', title: 'Tab 1' }] }),
    isProtocolError('invalid_response'),
  )

  // Response with mismatched requestId
  const mismatchedReqTransport = createTransport(_request => ({
    ok: true,
    protocol: 1,
    requestId: 'other-id',
    result: { selectedTabId: 'tab-1' },
  }))
  const client4 = createSimpleClient({ context: recordContext, tabsTransport: mismatchedReqTransport })
  await assert.rejects(
    () => client4.ui.tabs.set({ onChange: () => {}, tabs: [{ id: 'tab-1', title: 'Tab 1' }] }),
    isProtocolError('invalid_response'),
  )

  // Host error response
  const refuseTransport = createTransport(refuse({ code: 'internal_error', message: 'Host failed' }))
  const client5 = createSimpleClient({ context: recordContext, tabsTransport: refuseTransport })
  await assert.rejects(
    () => client5.ui.tabs.set({ onChange: () => {}, tabs: [{ id: 'tab-1', title: 'Tab 1' }] }),
    error => error instanceof SpaceProtocolError && error.code === 'internal_error' && error.message === 'Host failed',
  )
})

test('times out when host does not answer within timeout period', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const silentTransport = {
    request: () => new Promise(() => {}),
  }
  const simple = createSimpleClient({
    context: recordContext,
    tabsTransport: silentTransport,
  })

  const setPromise = simple.ui.tabs.set({ onChange: () => {}, tabs: [{ id: 't1', title: 'T1' }] })
  t.mock.timers.tick(DEFAULT_TABS_TIMEOUT_MS)

  await assert.rejects(
    setPromise,
    error => isProtocolError('timeout')(error)
      && error.message === `The Space host did not answer ui.tabs.set within ${DEFAULT_TABS_TIMEOUT_MS} milliseconds, so its outcome is unknown.`,
  )
})

test('reports callback errors without interrupting transport or later event delivery', async (t) => {
  const errorSpy = t.mock.method(console, 'error', () => {})
  const events = []
  const transport = createTransport(succeed({ selectedTabId: 't1' }))
  const simple = createSimpleClient({
    context: recordContext,
    nextRequestId: () => 'reg-cb-err',
    tabsTransport: transport,
  })

  await simple.ui.tabs.set({
    onChange: (tabId) => {
      events.push(tabId)
      if (tabId === 't2')
        throw new Error('Callback crash!')
      if (tabId === 't3')
        return Promise.reject(new Error('Async callback crash!'))
    },
    tabs: [
      { id: 't1', title: 'T1' },
      { id: 't2', title: 'T2' },
      { id: 't3', title: 'T3' },
    ],
  })

  // t2 throws in onChange
  transport.emitTabSelected('reg-cb-err', 't2')
  assert.deepEqual(events, ['t2'])
  assert.equal(errorSpy.mock.callCount(), 1)
  assert.match(errorSpy.mock.calls[0].arguments[0], /tabs onChange callback failed/)

  // Next event t3 still delivered successfully!
  transport.emitTabSelected('reg-cb-err', 't3')
  await Promise.resolve()
  assert.deepEqual(events, ['t2', 't3'])
  assert.equal(errorSpy.mock.callCount(), 2)

  // A rejected async callback also leaves later event delivery intact.
  transport.emitTabSelected('reg-cb-err', 't1')
  assert.deepEqual(events, ['t2', 't3', 't1'])
})

test('ignores events when transport is closed', async () => {
  const events = []
  const transport = createTransport(succeed({ selectedTabId: 't1' }))
  const simple = createSimpleClient({
    context: recordContext,
    nextRequestId: () => 'reg-closed',
    tabsTransport: transport,
  })

  await simple.ui.tabs.set({
    onChange: tabId => events.push(tabId),
    tabs: [{ id: 't1', title: 'T1' }, { id: 't2', title: 'T2' }],
  })

  transport.setClosed(true)
  transport.emitTabSelected('reg-closed', 't2')

  assert.equal(events.length, 0)
})

test('handles empty tab declaration to clear tabs, resolves selectedTabId: null, and rejects non-null responses', async () => {
  // Direct validation accepts empty array and returns WireTab[] empty array
  const validated = validateTabs({
    onChange: () => {},
    tabs: [],
  })
  assert.deepEqual(validated.tabs, [])

  // Direct validation requires onChange even when tabs is empty
  assert.throws(
    () => validateTabs({ tabs: [] }),
    error => isProtocolError('invalid_request')(error) && error.message.includes('onChange must be a function'),
  )

  let capturedRequest
  const transport = createTransport((request) => {
    capturedRequest = request
    return succeed({ selectedTabId: null })(request)
  })

  const simple = createSimpleClient({
    context: recordContext,
    nextRequestId: () => 'reg-empty-1',
    tabsTransport: transport,
  })

  const events = []
  const result = await simple.ui.tabs.set({
    onChange: tabId => events.push(tabId),
    tabs: [],
  })

  // Resolves selectedTabId: null and does not invoke onChange
  assert.deepEqual(result, { selectedTabId: null })
  assert.equal(events.length, 0)
  assert.deepEqual(capturedRequest, {
    operation: 'ui.tabs.set',
    payload: { tabs: [] },
    protocol: 1,
    requestId: 'reg-empty-1',
  })

  // Host events for empty registration are ignored
  transport.emitTabSelected('reg-empty-1', 'overview')
  assert.equal(events.length, 0)

  // Selecting a tab rejects with unknown tab id
  await assert.rejects(
    () => simple.ui.tabs.select('overview'),
    error => isProtocolError('invalid_request')(error) && error.message.includes('Unknown tab id: "overview"'),
  )

  // Non-empty response for empty tabs declaration is rejected as invalid_response
  const nonNullTransport = createTransport(succeed({ selectedTabId: 'overview' }))
  const simpleBadResponse = createSimpleClient({
    context: recordContext,
    tabsTransport: nonNullTransport,
  })
  await assert.rejects(
    () => simpleBadResponse.ui.tabs.set({ onChange: () => {}, tabs: [] }),
    isProtocolError('invalid_response'),
  )

  // Empty string response for empty tabs declaration is also rejected
  const emptyStrTransport = createTransport(succeed({ selectedTabId: '' }))
  const simpleEmptyStr = createSimpleClient({
    context: recordContext,
    tabsTransport: emptyStrTransport,
  })
  await assert.rejects(
    () => simpleEmptyStr.ui.tabs.set({ onChange: () => {}, tabs: [] }),
    isProtocolError('invalid_response'),
  )
})

test('empty tab declaration clears previously active registration state', async () => {
  const events = []
  const transport = createTransport((request) => {
    if (request.operation === 'ui.tabs.set') {
      if (request.payload.tabs.length === 0)
        return succeed({ selectedTabId: null })(request)
      return succeed({ selectedTabId: 't1' })(request)
    }
    if (request.operation === 'ui.tabs.select') {
      return succeed({ selectedTabId: request.payload.tabId })(request)
    }
    throw new Error(`Unexpected operation: ${request.operation}`)
  })

  let reqCount = 0
  const simple = createSimpleClient({
    context: recordContext,
    nextRequestId: () => `req-${++reqCount}`,
    tabsTransport: transport,
  })

  // Initial non-empty registration
  await simple.ui.tabs.set({
    onChange: tabId => events.push(tabId),
    tabs: [{ id: 't1', title: 'T1' }, { id: 't2', title: 'T2' }],
  })
  assert.equal(events.length, 0)

  // Programmatic select works
  await simple.ui.tabs.select('t2')
  assert.deepEqual(events, ['t2'])

  // Now clear tabs using empty declaration
  const clearResult = await simple.ui.tabs.set({
    onChange: tabId => events.push(tabId),
    tabs: [],
  })
  assert.deepEqual(clearResult, { selectedTabId: null })

  // Previously acknowledged tabs are no longer selectable
  await assert.rejects(
    () => simple.ui.tabs.select('t1'),
    error => isProtocolError('invalid_request')(error) && error.message.includes('Unknown tab id: "t1"'),
  )
  await assert.rejects(
    () => simple.ui.tabs.select('t2'),
    error => isProtocolError('invalid_request')(error) && error.message.includes('Unknown tab id: "t2"'),
  )

  // Events from the old registration are ignored
  transport.emitTabSelected('req-1', 't1')
  assert.deepEqual(events, ['t2'])

  // Events for the empty registration are ignored
  transport.emitTabSelected('req-3', 't1')
  assert.deepEqual(events, ['t2'])
})

test('supersedes active registration on set start and rejects select during pending or failed replacement', async () => {
  let resolvePendingSet
  const transport = createTransport((request) => {
    if (request.operation === 'ui.tabs.set') {
      if (request.requestId === 'req-step-1')
        return succeed({ selectedTabId: 't1' })(request)
      if (request.requestId === 'req-step-3') {
        return new Promise((resolve) => {
          resolvePendingSet = () => resolve(succeed({ selectedTabId: 't3' })(request))
        })
      }
    }
    if (request.operation === 'ui.tabs.select')
      return succeed({ selectedTabId: request.payload.tabId })(request)
    throw new Error(`Unexpected request: ${request.requestId}`)
  })

  let reqCount = 0
  const simple = createSimpleClient({
    context: recordContext,
    nextRequestId: () => `req-step-${++reqCount}`,
    tabsTransport: transport,
  })

  const events = []
  await simple.ui.tabs.set({
    onChange: t => events.push(t),
    tabs: [{ id: 't1', title: 'T1' }, { id: 't2', title: 'T2' }],
  })

  // Verify initial registration works
  await simple.ui.tabs.select('t2')
  assert.deepEqual(events, ['t2'])

  // Start replacement set (stays pending)
  const pendingSetPromise = simple.ui.tabs.set({
    onChange: t => events.push(t),
    tabs: [{ id: 't3', title: 'T3' }, { id: 't4', title: 'T4' }],
  })

  // Calling select during pending replacement must NOT use older registration
  await assert.rejects(
    () => simple.ui.tabs.select('t1'),
    error => isProtocolError('invalid_request')(error)
      && error.message === 'Cannot select a tab before tabs have been registered.',
  )
  await assert.rejects(
    () => simple.ui.tabs.select('t2'),
    error => isProtocolError('invalid_request')(error)
      && error.message === 'Cannot select a tab before tabs have been registered.',
  )
  await assert.rejects(
    () => simple.ui.tabs.select('t3'),
    error => isProtocolError('invalid_request')(error)
      && error.message === 'Cannot select a tab before tabs have been registered.',
  )

  // Events for old registration during pending replacement are dropped
  transport.emitTabSelected('req-step-1', 't1')
  assert.deepEqual(events, ['t2'])

  // Events for pending registration before acknowledgement are dropped
  transport.emitTabSelected('req-step-3', 't4')
  assert.deepEqual(events, ['t2'])

  // Resolve replacement
  resolvePendingSet()
  const replacementResult = await pendingSetPromise
  assert.deepEqual(replacementResult, { selectedTabId: 't3' })

  // Now selecting t4 in the new registration works
  await simple.ui.tabs.select('t4')
  assert.deepEqual(events, ['t2', 't4'])
})

test('clears active registration on set start so select is rejected after replacement fails', async () => {
  let shouldFail = false
  const transport = createTransport((request) => {
    if (request.operation === 'ui.tabs.set') {
      if (shouldFail)
        return refuse({ code: 'internal_error', message: 'Host failed registration' })(request)
      return succeed({ selectedTabId: 't1' })(request)
    }
    if (request.operation === 'ui.tabs.select')
      return succeed({ selectedTabId: request.payload.tabId })(request)
    throw new Error(`Unexpected request: ${request.operation}`)
  })

  let reqCount = 0
  const simple = createSimpleClient({
    context: recordContext,
    nextRequestId: () => `req-fail-${++reqCount}`,
    tabsTransport: transport,
  })

  const events = []
  await simple.ui.tabs.set({
    onChange: t => events.push(t),
    tabs: [{ id: 't1', title: 'T1' }, { id: 't2', title: 'T2' }],
  })

  // Initial selection works
  await simple.ui.tabs.select('t2')
  assert.deepEqual(events, ['t2'])

  // Now replacement fails
  shouldFail = true
  await assert.rejects(
    () => simple.ui.tabs.set({
      onChange: t => events.push(t),
      tabs: [{ id: 't3', title: 'T3' }],
    }),
    error => isProtocolError('internal_error')(error) && error.message === 'Host failed registration',
  )

  // Older registration must NOT remain selectable after replacement fails
  await assert.rejects(
    () => simple.ui.tabs.select('t1'),
    error => isProtocolError('invalid_request')(error)
      && error.message === 'Cannot select a tab before tabs have been registered.',
  )
  await assert.rejects(
    () => simple.ui.tabs.select('t2'),
    error => isProtocolError('invalid_request')(error)
      && error.message === 'Cannot select a tab before tabs have been registered.',
  )
  await assert.rejects(
    () => simple.ui.tabs.select('t3'),
    error => isProtocolError('invalid_request')(error)
      && error.message === 'Cannot select a tab before tabs have been registered.',
  )

  // Events from the old registration or failed replacement are dropped
  transport.emitTabSelected('req-fail-1', 't1')
  transport.emitTabSelected('req-fail-3', 't3')
  assert.deepEqual(events, ['t2'])
})

test('rejects select during pending and after failed empty replacement', async () => {
  let resolveEmptySet
  const transport = createTransport((request) => {
    if (request.requestId === 'req-init')
      return succeed({ selectedTabId: 't1' })(request)
    if (request.requestId === 'req-empty-pending') {
      return new Promise((resolve) => {
        resolveEmptySet = () => resolve(succeed({ selectedTabId: 'unexpected-non-null' })(request))
      })
    }
    throw new Error(`Unexpected request: ${request.requestId}`)
  })

  let reqId = 'req-init'
  const simple = createSimpleClient({
    context: recordContext,
    nextRequestId: () => reqId,
    tabsTransport: transport,
  })

  await simple.ui.tabs.set({
    onChange: () => {},
    tabs: [{ id: 't1', title: 'T1' }],
  })

  // Start empty replacement
  reqId = 'req-empty-pending'
  const pendingPromise = simple.ui.tabs.set({
    onChange: () => {},
    tabs: [],
  })

  // Select during pending empty replacement rejects
  await assert.rejects(
    () => simple.ui.tabs.select('t1'),
    error => isProtocolError('invalid_request')(error)
      && error.message === 'Cannot select a tab before tabs have been registered.',
  )

  // Resolve with invalid response (non-null selectedTabId for empty declaration)
  resolveEmptySet()
  await assert.rejects(
    pendingPromise,
    isProtocolError('invalid_response'),
  )

  // Select after failed empty replacement rejects
  await assert.rejects(
    () => simple.ui.tabs.select('t1'),
    error => isProtocolError('invalid_request')(error)
      && error.message === 'Cannot select a tab before tabs have been registered.',
  )
})

test('ignores a late error response for a select superseded by a newer registration', async () => {
  let finishSelect
  const transport = createTransport((request) => {
    if (request.operation === 'ui.tabs.set')
      return succeed({ selectedTabId: request.payload.tabs[0].id })(request)
    if (request.operation === 'ui.tabs.select') {
      return new Promise((resolve) => {
        finishSelect = () => resolve(refuse({ code: 'invalid_request', message: 'Old tab declaration was replaced.' })(request))
      })
    }
    throw new Error(`Unexpected operation: ${request.operation}`)
  })

  let requestNumber = 0
  const simple = createSimpleClient({
    context: recordContext,
    nextRequestId: () => `late-response-${++requestNumber}`,
    tabsTransport: transport,
  })

  await simple.ui.tabs.set({
    onChange: () => {},
    tabs: [{ id: 'first', title: 'First' }, { id: 'old', title: 'Old' }],
  })
  const pendingSelection = simple.ui.tabs.select('old')
  await simple.ui.tabs.set({
    onChange: () => {},
    tabs: [{ id: 'current', title: 'Current' }],
  })

  finishSelect()
  await assert.doesNotReject(pendingSelection)
})
