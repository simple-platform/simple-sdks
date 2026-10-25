export interface WaitForElementMountOptions {
  element: HTMLElement
  errorEventName: string
  fallbackErrorMessage: string
  onPostMountError: (error: Error) => void
  readyEventName: string
  signal: AbortSignal
  timeoutMessage: string
  timeoutMs?: number
}

/** Watches a private custom element through readiness, later failures, or teardown. */
export function waitForElementMount({
  element,
  errorEventName,
  fallbackErrorMessage,
  onPostMountError,
  readyEventName,
  signal,
  timeoutMessage,
  timeoutMs = 15_000,
}: WaitForElementMountOptions): Promise<() => void> {
  return new Promise((resolve, reject) => {
    let isReady = false
    let isSettled = false
    let isCleaned = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    let onReady: EventListener
    let onError: EventListener
    let onAbort: EventListener

    const cleanup = () => {
      if (isCleaned)
        return
      isCleaned = true
      if (timeout)
        clearTimeout(timeout)
      element.removeEventListener(readyEventName, onReady)
      element.removeEventListener(errorEventName, onError)
      signal.removeEventListener('abort', onAbort)
    }

    const failBeforeReady = (error: Error) => {
      if (isSettled)
        return
      isSettled = true
      cleanup()
      reject(error)
    }

    onReady = () => {
      if (isSettled)
        return
      isReady = true
      isSettled = true
      if (timeout)
        clearTimeout(timeout)
      element.removeEventListener(readyEventName, onReady)
      resolve(cleanup)
    }

    onError = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: unknown }>).detail
      const message = typeof detail?.message === 'string' ? detail.message : fallbackErrorMessage
      const error = new Error(message)

      if (isReady) {
        cleanup()
        onPostMountError(error)
        return
      }

      if (isSettled)
        return

      failBeforeReady(error)
    }

    onAbort = () => {
      if (!isSettled) {
        failBeforeReady(new DOMException('Private UI mount was cancelled.', 'AbortError'))
      }
      else {
        cleanup()
      }
    }

    if (signal.aborted) {
      failBeforeReady(new DOMException('Private UI mount was cancelled.', 'AbortError'))
      return
    }

    timeout = setTimeout(() => {
      failBeforeReady(new Error(timeoutMessage))
    }, timeoutMs)

    element.addEventListener(readyEventName, onReady, { once: true })
    element.addEventListener(errorEventName, onError)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
