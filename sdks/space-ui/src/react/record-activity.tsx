import type { RecordHandle } from '@simpleplatform/sdk/space'
import { useEffect, useRef, useState } from 'react'

import { loadRuntime, RuntimeLoadError } from '../runtime.js'
import { waitForElementMount } from './mount-boundary.js'
import { getManagedRecordBridge } from './record-bridge.js'

interface RecordActivityProps {
  record: RecordHandle
}

interface RuntimeRecordActivityElement extends HTMLElement {
  applicationId?: string
  decrypt?: (request: { appId: string, fieldName: string, recordId: string, tableName: string }) => Promise<string>
  fields?: unknown
  graphql?: (document: string, variables?: Readonly<Record<string, unknown>>) => Promise<unknown>
  recordId?: string
  tableId?: string
}

type LoadState
  = | { error: Error, kind: 'error' }
    | { kind: 'loading' }
    | { kind: 'ready' }

const ACTIVITY_READY_EVENT = 'simple-record-activity-ready'
const ACTIVITY_ERROR_EVENT = 'simple-record-activity-error'

/**
 * Renders the host-owned RecordActivity without exposing its field registry or
 * activity query internals as customer extension points.
 */
export function RecordActivity({ record }: RecordActivityProps) {
  return <RecordActivityInstance key={record.id} record={record} />
}

function RecordActivityInstance({ record }: RecordActivityProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const elementRef = useRef<RuntimeRecordActivityElement | undefined>(undefined)
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const bridge = getManagedRecordBridge(record)
  const [metadata, setMetadata] = useState(() => bridge?.metadata)
  const metadataRef = useRef(metadata)
  const isErrorVisibleRef = useRef(false)
  metadataRef.current = metadata
  isErrorVisibleRef.current = state.kind === 'error'
  const metadataStatus = metadata === undefined
    ? 'missing'
    : metadata.tableId?.trim() && metadata.recordId?.trim()
      ? 'ready'
      : 'invalid'

  useEffect(() => {
    if (!bridge)
      return

    setMetadata(bridge.metadata)
    return bridge.subscribeMetadata(setMetadata)
  }, [bridge])

  useEffect(() => {
    const element = elementRef.current
    if (!element || !metadata || metadataStatus !== 'ready')
      return

    element.tableId = metadata.tableId?.trim()
    element.recordId = metadata.recordId?.trim()
    element.fields = metadata.fields
  }, [metadata, metadataStatus])

  useEffect(() => {
    if (!bridge || !bridge.applicationId) {
      setState({
        error: new Error('The managed record activity is unavailable for this Record Space.'),
        kind: 'error',
      })
      return
    }
    if (metadataStatus === 'missing')
      return
    if (metadataStatus === 'invalid') {
      const message = !metadata?.tableId?.trim()
        ? 'The managed record activity is missing a table ID.'
        : 'The managed record activity is missing a record ID.'
      setState({ error: new Error(message), kind: 'error' })
      return
    }
    if (!containerRef.current) {
      if (metadataStatus === 'ready' && isErrorVisibleRef.current) {
        setState({ kind: 'loading' })
        setAttempt(current => current + 1)
        return
      }
      setState({ error: new Error('The managed record activity could not initialize its mount point.'), kind: 'error' })
      return
    }

    let disposed = false
    let failed = false
    let element: RuntimeRecordActivityElement | undefined
    let disposeMount: (() => void) | undefined
    const mountController = new AbortController()

    const mount = async () => {
      try {
        if (bridge.runtime)
          await loadRuntime(bridge.runtime)

        if (!customElements.get('simple-record-activity')) {
          throw new Error('The Simple UI Runtime did not register RecordActivity.')
        }

        if (disposed || !containerRef.current)
          return

        const latestMetadata = metadataRef.current
        const tableId = latestMetadata?.tableId?.trim()
        const recordId = latestMetadata?.recordId?.trim()
        if (!latestMetadata || !tableId || !recordId) {
          throw new Error('The managed record activity is missing its record metadata.')
        }

        element = document.createElement('simple-record-activity') as RuntimeRecordActivityElement
        element.applicationId = bridge.applicationId
        element.tableId = tableId
        element.recordId = recordId
        element.fields = latestMetadata.fields
        element.decrypt = bridge.capabilities?.decrypt
        element.graphql = bridge.graphql
        elementRef.current = element

        const ready = waitForElementMount({
          element,
          errorEventName: ACTIVITY_ERROR_EVENT,
          fallbackErrorMessage: 'The RecordActivity could not be rendered.',
          onPostMountError: (error) => {
            failed = true
            if (!disposed)
              setState({ error, kind: 'error' })
          },
          readyEventName: ACTIVITY_READY_EVENT,
          signal: mountController.signal,
          timeoutMessage: 'The RecordActivity did not become ready in time.',
        })
        containerRef.current.replaceChildren(element)
        disposeMount = await ready
        if (!disposed && !failed)
          setState({ kind: 'ready' })
      }
      catch (error) {
        if (!disposed) {
          const failure = error instanceof RuntimeLoadError || error instanceof Error
            ? error
            : new Error('The Simple UI Runtime could not be loaded.')
          setState({ error: failure, kind: 'error' })
        }
      }
    }

    void mount()
    return () => {
      disposed = true
      mountController.abort()
      disposeMount?.()
      if (elementRef.current === element)
        elementRef.current = undefined
      if (containerRef.current && element && containerRef.current.contains(element))
        containerRef.current.replaceChildren()
    }
  }, [attempt, bridge, metadataStatus, record])

  if (state.kind === 'error') {
    return (
      <div role="alert">
        <p>{state.error.message}</p>
        <button
          onClick={() => {
            setState({ kind: 'loading' })
            setAttempt(current => current + 1)
          }}
          type="button"
        >
          Try again
        </button>
      </div>
    )
  }

  return (
    <div
      aria-busy={state.kind === 'loading' ? 'true' : undefined}
      data-simple-managed-record-activity=""
      ref={containerRef}
    />
  )
}

export type { RecordActivityProps }
