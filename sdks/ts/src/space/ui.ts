import { SpaceProtocolError } from './protocol.js'

export const HEADER_ACTIONS_PROTOCOL_VERSION = 1 as const
export const TOAST_PROTOCOL_VERSION = 1 as const

export type HeaderActionType = 'destructive' | 'outline' | 'primary' | 'secondary'

/**
 * A platform-rendered action supplied by a mounted Record Space.
 *
 * The callback stays in the Space. The host receives only presentation state
 * and asks the Space to invoke the callback when its button is clicked.
 */
export interface HeaderAction {
  disabled?: boolean
  icon?: string
  id: string
  label: string
  loading?: boolean
  onClick: () => Promise<void> | void
  type?: HeaderActionType
}

export interface SimpleHeaderClient {
  setActions: (actions: readonly HeaderAction[]) => void
}

export interface SpaceHeaderTransport {
  setActions: (actions: readonly HeaderAction[]) => void
}

export type SpaceToastVariant = 'default' | 'destructive'

export type SpaceToastOptions = {
  variant?: SpaceToastVariant
} & (
  | { description: string, title?: string }
  | { description?: string, title: string }
)

export interface SimpleToastClient {
  show: (options: SpaceToastOptions) => void
}

export interface SpaceToastTransport {
  showToast: (options: SpaceToastOptions) => void
}

export function validateHeaderActions(actions: readonly HeaderAction[]): readonly HeaderAction[] {
  const ids = new Set<string>()

  return actions.map((action) => {
    if (!action || typeof action !== 'object'
      || typeof action.id !== 'string' || !action.id.trim()
      || typeof action.label !== 'string' || !action.label.trim()
      || typeof action.onClick !== 'function') {
      throw new TypeError('Each header action requires a non-empty id, a non-empty label, and an onClick callback.')
    }

    if (ids.has(action.id)) {
      throw new TypeError(`Header action ids must be unique: ${action.id}`)
    }
    ids.add(action.id)

    if (action.type && !['destructive', 'outline', 'primary', 'secondary'].includes(action.type)) {
      throw new TypeError(`Unsupported header action type: ${action.type}`)
    }

    if (action.disabled !== undefined && typeof action.disabled !== 'boolean')
      throw new TypeError(`Header action disabled must be a boolean: ${action.id}`)

    if (action.loading !== undefined && typeof action.loading !== 'boolean')
      throw new TypeError(`Header action loading must be a boolean: ${action.id}`)

    if (action.icon !== undefined && typeof action.icon !== 'string')
      throw new TypeError(`Header action icon must be a string: ${action.id}`)

    return { ...action }
  })
}

export const MAX_TOAST_TITLE_LENGTH = 160
export const MAX_TOAST_DESCRIPTION_LENGTH = 1000

export function validateSpaceToastOptions(options: SpaceToastOptions): SpaceToastOptions {
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw new TypeError('Toast options must be an object.')

  const candidate = options as { description?: unknown, title?: unknown, variant?: unknown }
  if (candidate.title !== undefined
    && (typeof candidate.title !== 'string' || !candidate.title.trim() || candidate.title.length > MAX_TOAST_TITLE_LENGTH)) {
    throw new TypeError(`Toast title must be a non-empty string of at most ${MAX_TOAST_TITLE_LENGTH} characters.`)
  }

  if (candidate.description !== undefined
    && (typeof candidate.description !== 'string' || !candidate.description.trim() || candidate.description.length > MAX_TOAST_DESCRIPTION_LENGTH)) {
    throw new TypeError(`Toast description must be a non-empty string of at most ${MAX_TOAST_DESCRIPTION_LENGTH} characters.`)
  }

  if (candidate.title === undefined && candidate.description === undefined)
    throw new TypeError('A toast requires a title or description.')

  if (candidate.variant !== undefined && candidate.variant !== 'default' && candidate.variant !== 'destructive')
    throw new TypeError(`Unsupported toast variant: ${String(candidate.variant)}`)

  return {
    ...(candidate.description === undefined ? {} : { description: candidate.description }),
    ...(candidate.title === undefined ? {} : { title: candidate.title }),
    ...(candidate.variant === undefined ? {} : { variant: candidate.variant }),
  } as SpaceToastOptions
}

export function createHeaderClient(
  isRecordSpace: boolean,
  headerTransport?: SpaceHeaderTransport,
): SimpleHeaderClient {
  return {
    setActions(actions) {
      if (!isRecordSpace) {
        throw new SpaceProtocolError({
          code: 'unavailable',
          message: 'Header actions are available only when this Space is configured as a record view.',
        })
      }

      if (!headerTransport) {
        throw new SpaceProtocolError({
          code: 'unavailable',
          message: 'The header-action bridge is unavailable for this record Space.',
        })
      }

      headerTransport.setActions(validateHeaderActions(actions))
    },
  }
}

export function createToastClient(
  toastTransport?: SpaceToastTransport,
): SimpleToastClient {
  return {
    show(options) {
      if (!toastTransport) {
        throw new SpaceProtocolError({
          code: 'unavailable',
          message: 'The platform-toast bridge is unavailable for this Space.',
        })
      }

      toastTransport.showToast(validateSpaceToastOptions(options))
    },
  }
}
