import type { SimpleStatusBadgeTone } from '../contracts/status-badge.js'

import { createElement } from 'react'

import '../elements/status-badge.js'

export interface StatusBadgeProps {
  /** Extra context announced with the visible label when a screen reader reads the badge. */
  description?: string
  label: string
  tone: SimpleStatusBadgeTone
}

/** React bridge for the canonical <simple-status-badge> Element. */
export function StatusBadge({ description, label, tone }: StatusBadgeProps) {
  return createElement('simple-status-badge', { description, label, tone })
}
