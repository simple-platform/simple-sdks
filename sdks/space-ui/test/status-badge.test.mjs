/* eslint-disable test/no-import-node-test */

import assert from 'node:assert/strict'
import test, { after } from 'node:test'

import { Window } from 'happy-dom'
import { renderToStaticMarkup } from 'react-dom/server'

const window = new Window()
const previousGlobals = {
  customElements: globalThis.customElements,
  document: globalThis.document,
  HTMLElement: globalThis.HTMLElement,
}

Object.assign(globalThis, {
  customElements: window.customElements,
  document: window.document,
  HTMLElement: window.HTMLElement,
})

const { SimpleStatusBadge } = await import(new URL('../dist/elements/status-badge.js', import.meta.url).href)
const { StatusBadge } = await import(new URL('../dist/react/status-badge.js', import.meta.url).href)

after(() => Object.assign(globalThis, previousGlobals))

function renderBadge(attributes = {}) {
  const badge = document.createElement('simple-status-badge')
  for (const [name, value] of Object.entries(attributes)) badge.setAttribute(name, value)
  document.body.appendChild(badge)
  return badge
}

test('registers the canonical StatusBadge Element and renders its semantic tone', () => {
  assert.equal(customElements.get('simple-status-badge'), SimpleStatusBadge)

  const badge = renderBadge({ label: 'In progress', tone: 'info' })
  const base = badge.shadowRoot.querySelector('[part="base"]')

  assert.equal(base.textContent, 'In progress')
  assert.equal(base.dataset.tone, 'info')
})

test('provides the optional accessible description without hiding the visible label', () => {
  const badge = renderBadge({
    description: 'Awaiting a response from the reviewer',
    label: 'Blocked',
    tone: 'warning',
  })
  const base = badge.shadowRoot.querySelector('[part="base"]')
  const description = badge.shadowRoot.querySelector('[part="description"]')

  assert.equal(base.textContent, 'Blocked')
  assert.equal(base.getAttribute('aria-describedby'), 'description')
  assert.equal(description.textContent, 'Awaiting a response from the reviewer')
})

test('maps unsupported tones to neutral and preserves long labels', () => {
  const label = 'This long status label must remain readable even when the available Space width is constrained'
  const badge = renderBadge({ label, tone: 'mickey' })
  const base = badge.shadowRoot.querySelector('[part="base"]')

  assert.equal(base.dataset.tone, 'neutral')
  assert.equal(base.textContent, label)
})

test('uses only public semantic variables in its component stylesheet', () => {
  const badge = renderBadge({ label: 'Ready', tone: 'success' })
  const stylesheet = badge.shadowRoot.querySelector('style').textContent

  assert.match(stylesheet, /var\(--simple-color-status-success-background\)/)
  assert.doesNotMatch(stylesheet, /#[0-9a-f]{3,8}|rgb\(|hsl\(|oklch\(/i)
})

test('renders the React bridge as the canonical custom element', () => {
  const markup = renderToStaticMarkup(StatusBadge({ label: 'Ready', tone: 'success' }))

  assert.equal(markup, '<simple-status-badge label="Ready" tone="success"></simple-status-badge>')
})
