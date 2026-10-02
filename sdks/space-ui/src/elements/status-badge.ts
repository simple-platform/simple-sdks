import type { SimpleStatusBadgeTone } from '../contracts/status-badge.js'

import { SIMPLE_STATUS_BADGE_TONES } from '../contracts/status-badge.js'

const STATUS_BADGE_TAG_NAME = 'simple-status-badge'

const STATUS_BADGE_STYLES = `
  :host {
    display: inline-block;
    font-family: var(--simple-status-badge-font-family);
  }

  [part="base"] {
    align-items: center;
    background: var(--simple-status-badge-neutral-background);
    border: 1px solid var(--simple-status-badge-neutral-border);
    border-radius: var(--simple-status-badge-radius);
    box-sizing: border-box;
    color: var(--simple-status-badge-neutral-foreground);
    display: inline-flex;
    font-size: var(--simple-status-badge-font-size);
    font-weight: var(--simple-status-badge-font-weight);
    line-height: var(--simple-status-badge-line-height);
    max-width: 100%;
    min-height: var(--simple-status-badge-min-height);
    overflow-wrap: anywhere;
    padding: 0 var(--simple-status-badge-padding-inline);
  }

  [part="base"][data-tone="info"] {
    background: var(--simple-status-badge-info-background);
    border-color: var(--simple-status-badge-info-border);
    color: var(--simple-status-badge-info-foreground);
  }

  [part="base"][data-tone="success"] {
    background: var(--simple-status-badge-success-background);
    border-color: var(--simple-status-badge-success-border);
    color: var(--simple-status-badge-success-foreground);
  }

  [part="base"][data-tone="warning"] {
    background: var(--simple-status-badge-warning-background);
    border-color: var(--simple-status-badge-warning-border);
    color: var(--simple-status-badge-warning-foreground);
  }

  [part="base"][data-tone="danger"] {
    background: var(--simple-status-badge-danger-background);
    border-color: var(--simple-status-badge-danger-border);
    color: var(--simple-status-badge-danger-foreground);
  }

  [part="description"] {
    clip: rect(0 0 0 0);
    clip-path: inset(50%);
    height: 1px;
    overflow: hidden;
    position: absolute;
    white-space: nowrap;
    width: 1px;
  }
`

const HTMLElementBase: typeof HTMLElement = globalThis.HTMLElement ?? class {} as typeof HTMLElement

/** A semantic state label for platform and Space surfaces. */
export class SimpleStatusBadge extends HTMLElementBase {
  static get observedAttributes() {
    return ['description', 'label', 'tone']
  }

  get description(): string {
    return this.getAttribute('description') ?? ''
  }

  set description(value: string) {
    this.setAttribute('description', value)
  }

  get label(): string {
    return this.getAttribute('label') ?? ''
  }

  set label(value: string) {
    this.setAttribute('label', value)
  }

  get tone(): SimpleStatusBadgeTone {
    const tone = this.getAttribute('tone')
    return isStatusBadgeTone(tone) ? tone : 'neutral'
  }

  set tone(value: SimpleStatusBadgeTone) {
    this.setAttribute('tone', value)
  }

  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
  }

  attributeChangedCallback(): void {
    this.render()
  }

  connectedCallback(): void {
    this.render()
  }

  private render(): void {
    const style = document.createElement('style')
    style.textContent = STATUS_BADGE_STYLES

    const badge = document.createElement('span')
    badge.dataset.tone = this.tone
    badge.setAttribute('part', 'base')
    badge.textContent = this.label

    const children = [style, badge]
    if (this.description) {
      const description = document.createElement('span')
      description.id = 'description'
      description.setAttribute('part', 'description')
      description.textContent = this.description
      badge.setAttribute('aria-describedby', description.id)
      children.push(description)
    }

    this.shadowRoot?.replaceChildren(...children)
  }
}

export function defineSimpleStatusBadge(): void {
  if (typeof customElements === 'undefined' || customElements.get(STATUS_BADGE_TAG_NAME))
    return

  customElements.define(STATUS_BADGE_TAG_NAME, SimpleStatusBadge)
}

function isStatusBadgeTone(value: null | string): value is SimpleStatusBadgeTone {
  return typeof value === 'string' && SIMPLE_STATUS_BADGE_TONES.includes(value as SimpleStatusBadgeTone)
}

defineSimpleStatusBadge()
