import type { ProtocolRequest, SpaceTransport } from './protocol.js'
import {
  invalidRequest,
  invalidResponse,
  isNonBlankString,
  isNonNegativeInteger,
  isObjectRecord,
  PROTOCOL_VERSION,
  readResponse,
  requestWithin,
  SpaceProtocolError,
} from './protocol.js'

export const TABS_PROTOCOL_VERSION = 1 as const
export const DEFAULT_TABS_TIMEOUT_MS = 10_000

export const LUCIDE_ICON_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/
export const TAB_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/

export interface SpaceTab {
  badge?: number | string
  default?: boolean
  icon?: string
  id: string
  title: string
}

export interface SetTabsOptions {
  onChange: (tabId: string) => Promise<void> | void
  tabs: readonly SpaceTab[]
}

export interface SimpleTabsClient {
  select: (tabId: string) => Promise<void>
  set: (options: SetTabsOptions) => Promise<{ selectedTabId: string | null }>
}

export interface SpaceTabsSelectionEvent {
  registrationRequestId: string
  selectedTabId: string
}

export interface SpaceTabsTransport extends SpaceTransport {
  isClosed?: () => boolean
  subscribeTabSelected?: (listener: (event: SpaceTabsSelectionEvent) => void) => () => void
}

export interface WireTab {
  badge?: number | string
  default?: true
  icon?: string
  id: string
  title: string
}

export interface TabsSetPayload {
  tabs: WireTab[]
}

export interface TabsSetRequest extends ProtocolRequest<TabsSetPayload> {
  operation: 'ui.tabs.set'
}

export interface TabsSetResult {
  selectedTabId: string | null
}

export interface TabsSelectPayload {
  registrationRequestId: string
  tabId: string
}

export interface TabsSelectRequest extends ProtocolRequest<TabsSelectPayload> {
  operation: 'ui.tabs.select'
}

export interface TabsSelectResult {
  selectedTabId: string
}

export function validateTabs(options: SetTabsOptions): {
  onChange: (tabId: string) => Promise<void> | void
  tabs: WireTab[]
} {
  if (!isObjectRecord(options))
    throw invalidRequest('Tabs options must be an object.')

  if (typeof options.onChange !== 'function')
    throw invalidRequest('Tabs onChange must be a function.')

  if (!Array.isArray(options.tabs))
    throw invalidRequest('Tabs must be an array.')

  if (options.tabs.length > 32)
    throw invalidRequest('Tabs must contain between 0 and 32 tabs.')

  const seenIds = new Set<string>()
  let defaultCount = 0

  for (const tab of options.tabs) {
    if (!isObjectRecord(tab))
      throw invalidRequest('Each tab must be an object.')

    if (typeof tab.id !== 'string' || !TAB_ID.test(tab.id))
      throw invalidRequest(`Tab id "${String(tab.id)}" is invalid. Tab ids must match ^[a-z0-9][a-z0-9_-]{0,63}$.`)

    if (seenIds.has(tab.id))
      throw invalidRequest(`Tab ids must be unique: "${tab.id}"`)
    seenIds.add(tab.id)

    if (typeof tab.title !== 'string' || !isNonBlankString(tab.title) || tab.title.length > 80)
      throw invalidRequest(`Tab "${tab.id}" title must be a non-empty string of at most 80 characters.`)

    if (tab.default !== undefined) {
      if (typeof tab.default !== 'boolean')
        throw invalidRequest(`Tab "${tab.id}" default must be a boolean.`)
      if (tab.default)
        defaultCount++
    }

    if (tab.icon !== undefined) {
      if (typeof tab.icon !== 'string' || !LUCIDE_ICON_NAME.test(tab.icon))
        throw invalidRequest(`Tab "${tab.id}" icon must be a kebab-case Lucide icon name.`)
    }

    if (tab.badge !== undefined) {
      const isStringBadge = typeof tab.badge === 'string'
      const isNumberBadge = typeof tab.badge === 'number'

      if (isStringBadge) {
        if (!isNonBlankString(tab.badge) || tab.badge.length > 20)
          throw invalidRequest(`Tab "${tab.id}" badge must be a non-empty string of at most 20 characters.`)
      }
      else if (isNumberBadge) {
        if (!isNonNegativeInteger(tab.badge))
          throw invalidRequest(`Tab "${tab.id}" badge must be a finite non-negative integer.`)
      }
      else {
        throw invalidRequest(`Tab "${tab.id}" badge must be a non-empty string or a non-negative integer.`)
      }
    }
  }

  if (defaultCount > 1)
    throw invalidRequest('Only one tab may be marked as default.')

  const wireTabs: WireTab[] = options.tabs.map((tab, index) => {
    const isDefault = Boolean(tab.default || (defaultCount === 0 && index === 0))
    return {
      ...(tab.badge !== undefined ? { badge: tab.badge } : {}),
      ...(isDefault ? { default: true as const } : {}),
      ...(tab.icon !== undefined ? { icon: tab.icon } : {}),
      id: tab.id,
      title: tab.title,
    }
  })

  return {
    onChange: options.onChange,
    tabs: wireTabs,
  }
}

export function createTabsClient(
  isRecordSpace: boolean,
  tabsTransport?: SpaceTabsTransport,
  nextRequestId: () => string = () => `space-tabs-${Math.random().toString(36).slice(2)}`,
): SimpleTabsClient {
  let hasRegistered = false
  let pendingRegistrationRequestId: string | null = null
  let committedRegistrationRequestId: string | null = null
  let declaredTabs: ReadonlyMap<string, WireTab> | null = null
  let currentSelectedTabId: string | null = null
  let currentOnChange: ((tabId: string) => Promise<void> | void) | null = null

  const invokeOnChange = (tabId: string) => {
    if (currentOnChange) {
      try {
        const result = currentOnChange(tabId)
        if (result && typeof (result as Promise<unknown>).catch === 'function') {
          (result as Promise<unknown>).catch(reportOnChangeError)
        }
      }
      catch (error) {
        // Callback errors must not break transport/event delivery
        reportOnChangeError(error)
      }
    }
  }

  const handleTabSelected = (event: SpaceTabsSelectionEvent) => {
    if (tabsTransport?.isClosed?.())
      return

    if (!event || typeof event !== 'object')
      return

    const { registrationRequestId, selectedTabId } = event
    if (typeof registrationRequestId !== 'string' || typeof selectedTabId !== 'string')
      return

    // "drop events from old registrations immediately after a newer set begins"
    // "Ignore events for superseded registration IDs."
    if (registrationRequestId !== pendingRegistrationRequestId)
      return

    // "only commit selected state for the latest acknowledged registration"
    if (!hasRegistered || registrationRequestId !== committedRegistrationRequestId)
      return

    if (!declaredTabs || !declaredTabs.has(selectedTabId))
      return

    if (selectedTabId === currentSelectedTabId)
      return

    currentSelectedTabId = selectedTabId
    invokeOnChange(selectedTabId)
  }

  if (tabsTransport?.subscribeTabSelected) {
    tabsTransport.subscribeTabSelected(handleTabSelected)
  }

  return {
    async select(tabId: string): Promise<void> {
      if (!isRecordSpace) {
        throw new SpaceProtocolError({
          code: 'unavailable',
          message: 'Tabs are available only when this Space is configured as a record view.',
        })
      }

      if (!tabsTransport) {
        throw new SpaceProtocolError({
          code: 'unavailable',
          message: 'The tabs bridge is unavailable for this record Space.',
        })
      }

      if (!hasRegistered || !declaredTabs || !committedRegistrationRequestId)
        throw invalidRequest('Cannot select a tab before tabs have been registered.')

      if (typeof tabId !== 'string' || !declaredTabs.has(tabId))
        throw invalidRequest(`Unknown tab id: "${String(tabId)}"`)

      if (tabId === currentSelectedTabId)
        return

      const request: TabsSelectRequest = {
        operation: 'ui.tabs.select',
        payload: {
          registrationRequestId: committedRegistrationRequestId,
          tabId,
        },
        protocol: PROTOCOL_VERSION,
        requestId: nextRequestId(),
      }

      const response = await requestWithin<TabsSelectResult>(tabsTransport, request, DEFAULT_TABS_TIMEOUT_MS)

      // A newer set makes this command obsolete. Ignore its late host response,
      // including an error for the registration the host has already replaced.
      if (!hasRegistered || committedRegistrationRequestId !== request.payload.registrationRequestId)
        return

      const result = readResponse(response, request)

      if (!isObjectRecord(result) || result.selectedTabId !== tabId)
        throw invalidResponse('The host tabs selection response is malformed or did not match the requested tab.')

      // Ignore if superseded while request was in-flight
      if (committedRegistrationRequestId !== request.payload.registrationRequestId)
        return

      if (currentSelectedTabId !== tabId) {
        currentSelectedTabId = tabId
        invokeOnChange(tabId)
      }
    },

    async set(options: SetTabsOptions): Promise<{ selectedTabId: string | null }> {
      if (!isRecordSpace) {
        throw new SpaceProtocolError({
          code: 'unavailable',
          message: 'Tabs are available only when this Space is configured as a record view.',
        })
      }

      if (!tabsTransport) {
        throw new SpaceProtocolError({
          code: 'unavailable',
          message: 'The tabs bridge is unavailable for this record Space.',
        })
      }

      const { onChange, tabs: wireTabs } = validateTabs(options)
      const registrationRequestId = nextRequestId()

      // On every valid set start, supersede and clear client active registration state immediately
      pendingRegistrationRequestId = registrationRequestId
      currentOnChange = onChange
      hasRegistered = false
      committedRegistrationRequestId = null
      declaredTabs = null
      currentSelectedTabId = null

      const request: TabsSetRequest = {
        operation: 'ui.tabs.set',
        payload: { tabs: wireTabs },
        protocol: PROTOCOL_VERSION,
        requestId: registrationRequestId,
      }

      let selectedTabId: null | string
      try {
        const response = await requestWithin<TabsSetResult>(tabsTransport, request, DEFAULT_TABS_TIMEOUT_MS)
        const result = readResponse(response, request)

        if (!isObjectRecord(result))
          throw invalidResponse('The tabs response is malformed.')

        if (wireTabs.length === 0) {
          if (result.selectedTabId !== null)
            throw invalidResponse('The host selectedTabId is malformed or does not match any registered tab.')
          selectedTabId = null
        }
        else {
          if (typeof result.selectedTabId !== 'string' || !wireTabs.some(t => t.id === result.selectedTabId))
            throw invalidResponse('The host selectedTabId is malformed or does not match any registered tab.')
          selectedTabId = result.selectedTabId
        }
      }
      catch (error) {
        // Replacing a registration supersedes its in-flight request. Ignore a
        // late host or transport error from that obsolete registration.
        if (registrationRequestId !== pendingRegistrationRequestId)
          return { selectedTabId: null }
        throw error
      }

      // "Ignore a late response from an older set."
      if (registrationRequestId !== pendingRegistrationRequestId)
        return { selectedTabId }

      // "only commit selected state for the latest acknowledged registration"
      const tabMap = new Map<string, WireTab>()
      for (const t of wireTabs)
        tabMap.set(t.id, t)

      declaredTabs = tabMap
      committedRegistrationRequestId = registrationRequestId
      currentSelectedTabId = selectedTabId
      hasRegistered = true

      return { selectedTabId }
    },
  }
}

function reportOnChangeError(error: unknown): void {
  console.error('The Space tabs onChange callback failed.', error)
}
