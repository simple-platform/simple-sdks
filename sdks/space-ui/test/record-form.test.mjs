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
class TestRecordFormElement extends HTMLElement {
  connectedCallback() {
    queueMicrotask(() => {
      if (mountBehavior === 'ready') {
        this.dispatchEvent(new this.ownerDocument.defaultView.Event('simple-record-form-ready'))
      }
      else if (mountBehavior === 'error') {
        this.dispatchEvent(new this.ownerDocument.defaultView.CustomEvent('simple-record-form-error', {
          detail: { message: 'The field editor failed to load.' },
        }))
      }
    })
  }
}
customElements.define('simple-record-form', TestRecordFormElement)

const { RecordForm } = await import(new URL('../dist/react/record-form.js', import.meta.url).href)
const { createSimpleClient } = await import(new URL('../../ts/dist/space/core.js', import.meta.url).href)

after(() => Object.assign(globalThis, previousGlobals))

test('explains when the host has not negotiated managed-form support', async () => {
  const container = createConnectedContainer()
  const root = createRoot(container)

  await act(async () => root.render(createElement(RecordForm, { record: {} })))
  assert.match(container.textContent, /managed record form is unavailable/i)

  await act(async () => root.unmount())
  container.remove()
})

test('mounts the runtime-owned element inside the Space for protocol v2', async () => {
  mountBehavior = 'ready'
  const record = await createRecord()
  const container = createConnectedContainer()
  const root = createRoot(container)

  await act(async () => root.render(createElement(RecordForm, { record })))

  const element = container.querySelector('simple-record-form')
  assert.ok(element)
  assert.equal(element.record, record)
  assert.deepEqual(element.formModel, { fields: [] })
  assert.equal(container.querySelector('[aria-busy="true"]'), null)

  await act(async () => root.unmount())
  assert.equal(container.querySelector('simple-record-form'), null)
  container.remove()
})

test('waits for late form metadata before mounting, then renders the host update', async () => {
  mountBehavior = 'ready'
  let publishFormModel
  const record = await createRecord(undefined, {
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

  await act(async () => root.render(createElement(RecordForm, { record })))
  assert.equal(container.querySelector('simple-record-form'), null)
  assert.equal(container.querySelector('[aria-busy="true"]')?.getAttribute('aria-busy'), 'true')

  const loadedForm = {
    fields: [{ id: 'field-name', isRequired: true, name: 'name', readOnly: false, type: 'string' }],
  }
  await act(async () => publishFormModel?.(loadedForm))

  const element = container.querySelector('simple-record-form')
  assert.ok(element)
  assert.deepEqual(element.formModel, loadedForm)

  await act(async () => root.unmount())
  container.remove()
})

test('shows renderer mount failures accessibly and supports a clean retry', async () => {
  mountBehavior = 'error'
  const record = await createRecord()
  const container = createConnectedContainer()
  const root = createRoot(container)

  await act(async () => root.render(createElement(RecordForm, { record })))
  assert.match(container.querySelector('[role="alert"]')?.textContent ?? '', /field editor failed/i)
  assert.equal(container.querySelector('[aria-busy="true"]'), null)

  mountBehavior = 'ready'
  await act(async () => {
    container.querySelector('button')?.click()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  assert.ok(container.querySelector('simple-record-form'))
  assert.equal(container.querySelector('[aria-busy="true"]'), null)

  await act(async () => root.unmount())
  container.remove()
})

test('continues observing runtime failures after the form first becomes ready', async () => {
  mountBehavior = 'ready'
  const record = await createRecord()
  const container = createConnectedContainer()
  const root = createRoot(container)

  await act(async () => root.render(createElement(RecordForm, { record })))
  const element = container.querySelector('simple-record-form')
  assert.ok(element)

  await act(async () => {
    element.dispatchEvent(new window.CustomEvent('simple-record-form-error', {
      detail: { message: 'A lazy field editor failed after mount.' },
    }))
  })

  assert.match(container.querySelector('[role="alert"]')?.textContent ?? '', /lazy field editor failed/i)
  await act(async () => root.unmount())
  container.remove()
})

test('fails a silent mount after its readiness timeout', async (t) => {
  mountBehavior = 'silent'
  t.mock.timers.enable({ apis: ['setTimeout'] })

  const record = await createRecord()
  const container = createConnectedContainer()
  const root = createRoot(container)

  try {
    await act(async () => root.render(createElement(RecordForm, { record })))
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

test('reports when a loaded runtime does not register the custom element', async () => {
  const previousGlobals = {
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
    const runtime = {
      url: `data:text/javascript,${encodeURIComponent(`export const version = '0.1.0'`)}`,
      version: '0.1.0',
    }
    const record = await createRecord(runtime)
    const container = createConnectedContainer(isolatedWindow.document)
    const root = createRoot(container)

    await act(async () => root.render(createElement(RecordForm, { record })))
    assert.match(container.querySelector('[role="alert"]')?.textContent ?? '', /did not register RecordForm/i)

    await act(async () => root.unmount())
    container.remove()
  }
  finally {
    Object.assign(globalThis, previousGlobals)
  }
})

test('cancels a pending mount cleanly when unmounted before readiness', async () => {
  mountBehavior = 'silent'
  const record = await createRecord()
  const container = createConnectedContainer()
  const root = createRoot(container)

  await act(async () => root.render(createElement(RecordForm, { record })))
  assert.equal(container.querySelector('[aria-busy="true"]')?.getAttribute('aria-busy'), 'true')

  await act(async () => root.unmount())
  assert.equal(container.querySelector('simple-record-form'), null)
  container.remove()
})

function createConnectedContainer(documentRef = document) {
  const container = documentRef.createElement('div')
  documentRef.body.append(container)
  return container
}

async function createRecord(runtime, options = {}) {
  const form = Object.hasOwn(options, 'form') ? options.form : { fields: [] }
  const { subscribeFormModel } = options
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
    context: { applicationId: 'app', kind: 'record', recordId: 'record', tableName: 'user' },
    formModelTransport: subscribeFormModel ? { subscribeFormModel } : undefined,
    runtime,
    transport,
  }).records.current()
}
