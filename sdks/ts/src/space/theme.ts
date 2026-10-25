import { isObjectRecord } from './protocol.js'

export const THEME_PROTOCOL_VERSION = 1 as const

export interface SpaceThemeFontDescriptor {
  family: string
  provider: 'google'
  weights: number[]
}

export interface SpaceThemeFonts {
  mono?: SpaceThemeFontDescriptor
  sans?: SpaceThemeFontDescriptor
}

export interface SpaceThemeSnapshot {
  fonts?: SpaceThemeFonts
  mode: 'light' | 'dark'
  tokens: Record<string, string>
  version: 1
}

export interface SpaceDocumentElementLike {
  classList?: {
    contains?: (token: string) => boolean
    toggle?: (token: string, force?: boolean) => boolean
  }
  style?: {
    overscrollBehaviorY?: string
    removeProperty?: (property: string) => string
    setProperty?: (property: string, value: string) => void
  } & Record<string, unknown>
}

export interface SpaceLinkElementLike {
  as?: string
  crossOrigin?: string
  getAttribute?: (name: string) => string | null
  href?: string
  id?: string
  rel?: string
  remove?: () => void
  setAttribute?: (name: string, value: string) => void
  [key: string]: unknown
}

export interface SpaceHeadElementLike {
  appendChild?: (node: SpaceLinkElementLike) => SpaceLinkElementLike | unknown
  children?: SpaceLinkElementLike[] | unknown
  querySelector?: (selector: string) => SpaceLinkElementLike | null
  removeChild?: (node: SpaceLinkElementLike) => SpaceLinkElementLike | unknown
  [key: string]: unknown
}

export interface SpaceDocumentLike {
  createElement?: (tagName: string) => SpaceLinkElementLike | unknown
  documentElement?: SpaceDocumentElementLike
  head?: SpaceHeadElementLike
  querySelector?: (selector: string) => SpaceLinkElementLike | null
  [key: string]: unknown
}

export interface SpaceFontState {
  fontLink?: SpaceLinkElementLike | null
}

const FAMILY_NAME_PATTERN = /^[A-Z0-9]+(?:[ -][A-Z0-9]+)*$/i

export function parseFontDescriptor(value: unknown): SpaceThemeFontDescriptor | null {
  if (!isObjectRecord(value))
    return null

  const keys = Object.keys(value)
  if (keys.length !== 3 || !('provider' in value) || !('family' in value) || !('weights' in value))
    return null

  if (value.provider !== 'google')
    return null

  if (typeof value.family !== 'string' || value.family.length === 0 || value.family.length > 100)
    return null

  if (!FAMILY_NAME_PATTERN.test(value.family))
    return null

  if (!Array.isArray(value.weights) || value.weights.length === 0)
    return null

  const weights: number[] = []
  const seenWeights = new Set<number>()

  for (const w of value.weights) {
    if (typeof w !== 'number' || !Number.isInteger(w) || w < 100 || w > 900 || w % 100 !== 0)
      return null
    if (seenWeights.has(w))
      return null
    seenWeights.add(w)
    weights.push(w)
  }

  return {
    family: value.family,
    provider: 'google',
    weights,
  }
}

export function buildGoogleFontUrl(fonts: SpaceThemeFonts | undefined): string | null {
  if (!fonts)
    return null

  const fontEntries = [fonts.sans, fonts.mono].filter((d): d is SpaceThemeFontDescriptor => !!d)
  if (fontEntries.length === 0)
    return null

  const familyMap = new Map<string, Set<number>>()
  for (const entry of fontEntries) {
    if (entry.provider !== 'google')
      continue
    let weights = familyMap.get(entry.family)
    if (!weights) {
      weights = new Set<number>()
      familyMap.set(entry.family, weights)
    }
    for (const w of entry.weights) {
      weights.add(w)
    }
  }

  if (familyMap.size === 0)
    return null

  const params: string[] = []
  for (const [family, weightsSet] of familyMap.entries()) {
    const sortedWeights = Array.from(weightsSet).sort((a, b) => a - b)
    const formattedFamily = family.replace(/ /g, '+')
    params.push(`family=${formattedFamily}:wght@${sortedWeights.join(';')}`)
  }

  return `https://fonts.googleapis.com/css2?${params.join('&')}&display=swap`
}

export function parseThemeSnapshot(value: unknown): SpaceThemeSnapshot | null {
  if (!isObjectRecord(value))
    return null

  const { mode, tokens, version } = value
  if (version !== 1 || (mode !== 'light' && mode !== 'dark') || !isObjectRecord(tokens))
    return null

  const acceptedTokens: Record<string, string> = {}
  for (const [name, tokenValue] of Object.entries(tokens)) {
    if (name.startsWith('--simple-') && typeof tokenValue === 'string') {
      acceptedTokens[name] = tokenValue
    }
  }

  let acceptedFonts: SpaceThemeFonts | undefined
  if (isObjectRecord(value.fonts)) {
    const sans = parseFontDescriptor(value.fonts.sans)
    const mono = parseFontDescriptor(value.fonts.mono)

    if (sans || mono) {
      acceptedFonts = {}
      if (sans)
        acceptedFonts.sans = sans
      if (mono)
        acceptedFonts.mono = mono
    }
  }

  const snapshot: SpaceThemeSnapshot = {
    mode,
    tokens: acceptedTokens,
    version: 1,
  }

  if (acceptedFonts) {
    snapshot.fonts = acceptedFonts
  }

  return snapshot
}

export function syncGoogleFontLink(
  document: SpaceDocumentLike | undefined,
  fonts: SpaceThemeFonts | undefined,
  fontState?: SpaceFontState,
): void {
  if (!document || !document.head)
    return

  const head = document.head
  const url = buildGoogleFontUrl(fonts)

  let link: SpaceLinkElementLike | null = fontState?.fontLink ?? null

  if (link && Array.isArray(head.children) && !head.children.includes(link)) {
    link = null
  }

  if (!link) {
    if (typeof head.querySelector === 'function') {
      link = head.querySelector('link[data-simple-font="google"]')
    }
    else if (typeof document.querySelector === 'function') {
      link = document.querySelector('link[data-simple-font="google"]')
    }
    else if (Array.isArray(head.children)) {
      link = (head.children as SpaceLinkElementLike[]).find(
        child => child.rel === 'stylesheet' && (
          (typeof child.getAttribute === 'function' && child.getAttribute('data-simple-font') === 'google')
          || (child as Record<string, unknown>)['data-simple-font'] === 'google'
        ),
      ) ?? null
    }
  }

  if (url) {
    if (link) {
      link.href = url
    }
    else if (typeof document.createElement === 'function' && typeof head.appendChild === 'function') {
      const newLink = document.createElement('link') as SpaceLinkElementLike
      newLink.rel = 'stylesheet'
      newLink.href = url
      if (typeof newLink.setAttribute === 'function') {
        newLink.setAttribute('data-simple-font', 'google')
      }
      else {
        (newLink as Record<string, unknown>)['data-simple-font'] = 'google'
      }
      head.appendChild(newLink)
      link = newLink
    }
    if (fontState) {
      fontState.fontLink = link
    }
  }
  else {
    if (link) {
      if (typeof link.remove === 'function') {
        link.remove()
      }
      else if (typeof head.removeChild === 'function') {
        head.removeChild(link)
      }
    }
    if (fontState) {
      fontState.fontLink = null
    }
  }
}

function isDocumentLike(value: SpaceDocumentLike | SpaceDocumentElementLike): value is SpaceDocumentLike {
  return 'documentElement' in value || 'head' in value || 'createElement' in value
}

export function applyThemeSnapshot(
  target: SpaceDocumentLike | SpaceDocumentElementLike | undefined,
  appliedTokens: Set<string>,
  snapshot: SpaceThemeSnapshot,
  fontState?: SpaceFontState,
): void {
  if (!target)
    return

  const document: SpaceDocumentLike | undefined = isDocumentLike(target)
    ? target
    : undefined
  const documentElement: SpaceDocumentElementLike | undefined = isDocumentLike(target)
    ? target.documentElement
    : target

  if (documentElement) {
    if (typeof documentElement.classList?.toggle === 'function') {
      documentElement.classList.toggle('dark', snapshot.mode === 'dark')
    }

    const style = documentElement.style
    if (style) {
      for (const name of appliedTokens) {
        if (typeof style.removeProperty === 'function') {
          style.removeProperty(name)
        }
        else {
          delete (style as Record<string, unknown>)[name]
        }
      }
      appliedTokens.clear()

      for (const [name, value] of Object.entries(snapshot.tokens)) {
        if (typeof style.setProperty === 'function') {
          style.setProperty(name, value)
        }
        else {
          (style as Record<string, unknown>)[name] = value
        }
        appliedTokens.add(name)
      }
    }
  }

  if (document) {
    syncGoogleFontLink(document, snapshot.fonts, fontState)
  }
}
