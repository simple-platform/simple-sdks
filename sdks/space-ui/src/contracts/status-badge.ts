/** The semantic state categories supported by the public StatusBadge contract. */
export const SIMPLE_STATUS_BADGE_TONES = [
  'neutral',
  'info',
  'success',
  'warning',
  'danger',
] as const

export type SimpleStatusBadgeTone = typeof SIMPLE_STATUS_BADGE_TONES[number]
