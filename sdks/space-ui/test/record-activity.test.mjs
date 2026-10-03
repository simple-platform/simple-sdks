/* eslint-disable test/no-import-node-test */

import assert from 'node:assert/strict'
import test, { after } from 'node:test'

import { Window } from 'happy-dom'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

const window = new Window()
const previousGlobals = {
  customElements: globalThis.customElements,
  document: globalThis.document,
  HTMLElement: globalThis.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT,
  window: globalThis.window,
}

Object.assign(globalThis, {
  customElements: window.customElements,
  document: window.document,
  HTMLElement: window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
  window,
})

let mountBehavior = 'ready'
class TestRecordActivityElement extends HTMLElement {
  connectedCallback() {
    queueMicrotask(() => {
      if (mountBehavior === 'ready') {
        this.dispatchEvent(new this.ownerDocument.defaultView.Event('simple-record-activity-ready'))
      }
      else if (mountBehavior === 'error') {
        this.dispatchEvent(new this.ownerDocument.defaultView.CustomEvent('simple-record-activity-error', {
          detail: { message: 'The activity feed failed to load.' },
        }))
      }
    })
  }
}
customElements.define('simple-record-activity', TestRecordActivityElement)

const { RecordActivity } = await import(new URL('../dist/react/record-activity.js', import.meta.url).href)
const { createSimpleClient } = await import(new URL('../../ts/dist/space/core.js', import.meta.url).href)

after(() => Object.assign(globalThis, previousGlobals))

test('explains when the host did not provide a managed record bridge', async () => {
  const container = createConnectedContainer()
  const root = createRoot(container)

  await act(async () => root.render(createElement(RecordActivity, { record: {} })))
  assert.match(container.querySelector('[role="alert"]')?.textContent ?? '', /managed record activity is unavailable/i)

  await act(async () => root.unmount())
  container.remove()
})

test('mounts the host activity element with record identity and UI metadata', async () => {
  mountBehavior = 'ready'
  const decryptRequests = []
  const capabilities = {
    createDocumentHandle: async () => undefined,
    decrypt: async (request) => {
      decryptRequests.push(request)
      return 'decrypted'
    },
    deleteFile: async () => undefined,
    getDocumentPreview: async () => ({ url: '' }),
    navigate: async () => undefined,
  }
  const form = {
    fields: [{
      displayName: 'Name',
      id: 'field-name',
      isRequired: true,
      name: 'name',
      readOnly: false,
      type: 'string',
    }],
    recordId: 'record-1',
    tableId: 'table-1',
    tableName: 'user',
  }
  const record = await createRecord({ capabilities, form })
  const container = createConnectedContainer()
  const root = createRoot(container)

  await act(async () => root.render(createElement(RecordActivity, { record })))

  const element = container.querySelector('simple-record-activity')
  assert.ok(element)
  assert.equal(element.applicationId, 'dev.simple.system')
  assert.equal(element.recordId, 'record-1')
  assert.equal(element.tableId, 'table-1')
  assert.deepEqual(element.fields, form.fields)
  assert.equal('formModel' in element, false)
  assert.equal(typeof element.graphql, 'function')
  assert.equal(await element.decrypt({ appId: 'dev.simple.system', fieldName: 'secret', recordId: 'record-1', tableName: 'user' }), 'decrypted')
  assert.equal(decryptRequests[0].sessionId, 'session-primary')
  assert.equal(container.querySelector('[aria-busy="true"]'), null)

  await act(async () => root.unmount())
  assert.equal(container.querySelector('simple-record-activity'), null)
  container.remove()
})

test('derives the table ID from field metadata when the record metadata has none', async () => {
  mountBehavior = 'ready'
  const form = {
    fields: [{ id: 'field-name', isRequired: false, name: 'name', readOnly: false, tableId: 'table-from-field', type: 'string' }],
    recordId: 'record-1',
  }
  const record = await createRecord({ form })
  const container = createConnectedContainer()
  const root = createRoot(container)

  await act(async () => root.render(createElement(RecordActivity, { record })))

  assert.equal(container.querySelector('simple-record-activity')?.tableId, 'table-from-field')
  await act(async () => root.unmount())
  container.remove()
})

test('uses an opened record target in a standalone Space', async () => {
  mountBehavior = 'ready'
  const target = { appId: 'other.application', recordId: 'other-record', tableName: 'contacts' }
  const simple = createSimpleClient({
    recordsTransport: {
      request: async request => ({
        ok: true,
        protocol: 1,
        requestId: request.requestId,
        result: {
          form: { fields: [], recordId: target.recordId, tableId: 'other-table' },
          sessionId: 'opened-session',
          snapshot: { errors: { fields: {}, form: [] }, fields: {}, revision: 0, values: {} },
        },
      }),
    },
  })
  const record = await simple.records.open(target)
  const container = createConnectedContainer()
  const root = createRoot(container)

  await act(async () => root.render(createElement(RecordActivity, { record })))

  const element = container.querySelector('simple-record-activity')
  assert.ok(element)
  assert.equal(element.applicationId, target.appId)
  assert.equal(element.recordId, target.recordId)
  assert.equal(element.tableId, 'other-table')

  await act(async () => root.unmount())
  container.remove()
})

test('waits for late managed form metadata before mounting', async () => {
  mountBehavior = 'ready'
  let publishFormModel
  const record = await createRecord({
    form: undefined,
    subscribeFormModel: (listener) => {
      publishFormModel = listener
      return () => {
        publishFormModel = undefined
      }
    },
  })
  const container = createConnectedContainer()
  const root = createRoot(container)

  await act(async () => root.render(createElement(RecordActivity, { record })))
  assert.equal(container.querySelector('simple-record-activity'), null)

  const form = { fields: [], recordId: 'record-2', tableId: 'table-2' }
  await act(async () => publishFormModel?.(form))

  const element = container.querySelector('simple-record-activity')
  assert.ok(element)
  assert.equal(element.recordId, 'record-2')
  assert.equal(element.tableId, 'table-2')

  await act(async () => root.unmount())
  container.remove()
})

test('updates metadata on a mounted activity element without remounting it', async () => {
  mountBehavior = 'ready'
  let publishFormModel
  const initialForm = { fields: [], recordId: 'record-1', tableId: 'table-1' }
  const record = await createRecord({
    form: initialForm,
    subscribeFormModel: (listener) => {
      publishFormModel = listener
      return () => {
        publishFormModel = undefined
      }
    },
  })
  const container = createConnectedContainer()
  const root = createRoot(container)

  await act(async () => root.render(createElement(RecordActivity, { record })))
  const element = container.querySelector('simple-record-activity')
  assert.ok(element)

  const updatedFields = [{ id: 'field-name', isRequired: false, name: 'name', readOnly: false, type: 'string' }]
  await act(async () => publishFormModel?.({ fields: updatedFields, recordId: 'record-2', tableId: 'table-2' }))

  assert.strictEqual(container.querySelector('simple-record-activity'), element)
  assert.equal(element.recordId, 'record-2')
  assert.equal(element.tableId, 'table-2')
  assert.deepEqual(element.fields, updatedFields)

  await act(async () => root.unmount())
  container.remove()
})

test('shows an accessible error when record UI metadata has no usable table ID', async () => {
  mountBehavior = 'ready'
  const record = await createRecord({ form: { fields: [], recordId: 'record-1', tableId: '   ' } })
  const container = createConnectedContainer()
  const root = createRoot(container)

  await act(async () => root.render(createElement(RecordActivity, { record })))

  assert.match(container.querySelector('[role="alert"]')?.textContent ?? '', /missing a table ID/i)
  assert.equal(container.querySelector('[aria-busy="true"]'), null)
  assert.equal(container.querySelector('simple-record-activity'), null)

  await act(async () => root.unmount())
  container.remove()
})

test('shows runtime mount failures accessibly and supports retry', async () => {
  mountBehavior = 'error'
  const record = await createRecord()
  const container = createConnectedContainer()
  const root = createRoot(container)

  await act(async () => root.render(createElement(RecordActivity, { record })))
  assert.match(container.querySelector('[role="alert"]')?.textContent ?? '', /activity feed failed to load/i)

  mountBehavior = 'ready'
  await act(async () => {
    container.querySelector('button')?.click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  assert.ok(container.querySelector('simple-record-activity'))
  assert.equal(container.querySelector('[aria-busy="true"]'), null)

  await act(async () => root.unmount())
  container.remove()
})

test('continues observing runtime failures after the activity element becomes ready', async () => {
  mountBehavior = 'ready'
  const record = await createRecord()
  const container = createConnectedContainer()
  const root = createRoot(container)

  await act(async () => root.render(createElement(RecordActivity, { record })))
  const element = container.querySelector('simple-record-activity')
  assert.ok(element)

  await act(async () => {
    element.dispatchEvent(new window.CustomEvent('simple-record-activity-error', {
      detail: { message: 'A lazy activity section failed after mount.' },
    }))
  })

  assert.match(container.querySelector('[role="alert"]')?.textContent ?? '', /lazy activity section failed/i)
  await act(async () => root.unmount())
  container.remove()
})

test('reports when the loaded runtime has not registered the activity element', async () => {
  const originalGlobals = {
    customElements: globalThis.customElements,
    document: globalThis.document,
    HTMLElement: globalThis.HTMLElement,
    window: globalThis.window,
  }
  const isolatedWindow = new Window()
  Object.assign(globalThis, {
    customElements: isolatedWindow.customElements,
    document: isolatedWindow.document,
    HTMLElement: isolatedWindow.HTMLElement,
    window: isolatedWindow,
  })

  try {
    const record = await createRecord()
    const container = createConnectedContainer(isolatedWindow.document)
    const root = createRoot(container)

    await act(async () => root.render(createElement(RecordActivity, { record })))
    assert.match(container.querySelector('[role="alert"]')?.textContent ?? '', /did not register RecordActivity/i)

    await act(async () => root.unmount())
    container.remove()
  }
  finally {
    Object.assign(globalThis, originalGlobals)
  }
})

test('cancels a pending activity mount cleanly when unmounted before readiness', async () => {
  mountBehavior = 'silent'
  const record = await createRecord()
  const container = createConnectedContainer()
  const root = createRoot(container)

  await act(async () => root.render(createElement(RecordActivity, { record })))
  assert.equal(container.querySelector('[aria-busy="true"]')?.getAttribute('aria-busy'), 'true')

  await act(async () => root.unmount())
  assert.equal(container.querySelector('simple-record-activity'), null)
  container.remove()
})

test('fails a silent activity mount after its readiness timeout', async (t) => {
  mountBehavior = 'silent'
  t.mock.timers.enable({ apis: ['setTimeout'] })

  const record = await createRecord()
  const container = createConnectedContainer()
  const root = createRoot(container)

  try {
    await act(async () => root.render(createElement(RecordActivity, { record })))
    await act(async () => {
      t.mock.timers.tick(15_000)
      await Promise.resolve()
    })

    assert.match(container.querySelector('[role="alert"]')?.textContent ?? '', /did not become ready in time/i)
    assert.equal(container.querySelector('[aria-busy="true"]'), null)
    await act(async () => root.unmount())
    container.remove()
  }
  finally {
    t.mock.timers.reset()
  }
})

function createConnectedContainer(documentRef = document) {
  const container = documentRef.createElement('div')
  documentRef.body.append(container)
  return container
}

async function createRecord(options = {}) {
  const form = Object.hasOwn(options, 'form') ? options.form : { fields: [], recordId: 'record-1', tableId: 'table-1' }
  const { capabilities, subscribeFormModel } = options
  const transport = {
    request: async request => ({
      ok: true,
      protocol: 1,
      requestId: request.requestId,
      result: {
        ...(form === undefined ? {} : { form }),
        sessionId: 'session-primary',
        snapshot: { errors: { fields: {}, form: [] }, fields: {}, revision: 0, values: {} },
      },
    }),
  }
  return await createSimpleClient({
    capabilities,
    context: { applicationId: 'dev.simple.system', kind: 'record', recordId: 'record-1', tableName: 'user' },
    formModelTransport: subscribeFormModel ? { subscribeFormModel } : undefined,
    transport,
  }).records.current()
}
