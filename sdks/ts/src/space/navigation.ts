import type { SpaceProtocolErrorPayload } from './protocol.js'
import { invalidRequest, isObjectRecord, SpaceProtocolError } from './protocol.js'

/**
 * Where the platform opens the path. `same-tab` opens it in the platform tab
 * the Space is shown in (a Space cannot navigate its own frame); `new-tab`
 * opens it in a new browser tab.
 *
 * These are the platform's own names, not the browser's `_self` and `_blank`.
 * The platform's navigation message has carried `same-tab` and `new-tab`
 * since before this call existed, so keeping them leaves that contract
 * untouched and gives one set of names from a Space to the platform page,
 * with no mapping in between. They also say where a platform page opens
 * rather than which browsing context a link uses, which leaves room for
 * targets a browser has no name for, such as a popup or the developer studio.
 */
export type NavigationTarget = 'same-tab' | 'new-tab'

export interface NavigationOpenOptions {
  path: string
  target?: NavigationTarget
}

export interface SimpleNavigationClient {
  open: (options: NavigationOpenOptions) => void
}

export interface SpaceNavigationTransport {
  navigate: (url: string, target: NavigationTarget) => void
}

export function createNavigationClient(
  hostOrigin: string | undefined,
  transport: SpaceNavigationTransport | undefined,
): SimpleNavigationClient {
  return {
    open(options) {
      if (!isObjectRecord(options))
        throw invalidRequest('Navigation options must be an object.')

      const { path, target } = options
      if (typeof path !== 'string' || path.length === 0 || !path.startsWith('/') || path.startsWith('//') || path.includes('\\'))
        throw invalidRequest('Navigation path must be a host-relative path starting with one slash, with no backslash.')

      const resolvedTarget = target === undefined ? 'same-tab' : target
      if (resolvedTarget !== 'same-tab' && resolvedTarget !== 'new-tab')
        throw invalidRequest('Navigation target must be "same-tab" or "new-tab".')

      if (!hostOrigin || new URL(hostOrigin).protocol !== 'https:') {
        throw new SpaceProtocolError({
          code: 'unavailable',
          message: 'Platform navigation is available only when connected to an HTTPS host.',
        } satisfies SpaceProtocolErrorPayload)
      }

      if (!transport) {
        throw new SpaceProtocolError({
          code: 'unavailable',
          message: 'The platform-navigation bridge is unavailable for this Space.',
        })
      }

      // URL parsing drops a tab or a newline, which can turn a path into another host's address.
      const url = new URL(path, hostOrigin)
      if (url.origin !== new URL(hostOrigin).origin)
        throw invalidRequest('Navigation path must stay on the host this Space is connected to.')

      transport.navigate(url.href, resolvedTarget)
    },
  }
}
