import type { RecordHandle } from '@simpleplatform/sdk/space'

import { useEffect, useRef, useState } from 'react'

import { loadRuntime, RuntimeLoadError } from '../runtime.js'
import { waitForElementMount } from './mount-boundary.js'
import { getManagedRecordBridge } from './record-bridge.js'

interface RecordFormProps {
  record: RecordHandle
}

interface RuntimeRecordFormElement extends HTMLElement {
  blurField?: (fieldName: string) => Promise<void>
  focusField?: (fieldName: string) => Promise<void>
  formModel?: unknown
  graphql?: (document: string, variables?: Readonly<Record<string, unknown>>) => Promise<unknown>
  capabilities?: unknown
  navigate?: (path: string) => Promise<void>
  registerSubmitPreparation?: (preparation: () => Promise<Readonly<Record<string, unknown>> | undefined>) => () => void
  record?: RecordHandle
  subscribe?: (listener: (snapshot: unknown) => void) => () => void
}

type LoadState
  = | { error: Error, kind: 'error' }
    | { kind: 'loading' }
    | { kind: 'ready' }

const FORM_READY_EVENT = 'simple-record-form-ready'
const FORM_ERROR_EVENT = 'simple-record-form-error'

/**
 * Renders the host-owned RecordForm without exposing its field registry or
 * form model as customer extension points.
 */
export function RecordForm({ record }: RecordFormProps) {
  return <RecordFormInstance key={record.id} record={record} />
}

function RecordFormInstance({ record }: RecordFormProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const bridge = getManagedRecordBridge(record)
  const [formModel, setFormModel] = useState<unknown>(() => bridge?.form)
  const formModelRef = useRef(formModel)
  formModelRef.current = formModel
  const hasFormModel = formModel !== undefined

  useEffect(() => {
    if (!bridge)
      return

    setFormModel(bridge.form)
    return bridge.subscribeFormModel(setFormModel)
  }, [bridge])

  useEffect(() => {
    const element = containerRef.current?.querySelector('simple-record-form') as RuntimeRecordFormElement | null
    if (element)
      element.formModel = formModel
  }, [formModel])

  useEffect(() => {
    if (!bridge) {
      setState({
        error: new Error('The managed record form is unavailable for this Record Space.'),
        kind: 'error',
      })
      return
    }
    if (!hasFormModel || !containerRef.current)
      return

    let disposed = false
    let failed = false
    let element: RuntimeRecordFormElement | undefined
    let disposeMount: (() => void) | undefined
    const mountController = new AbortController()

    const mount = async () => {
      try {
        if (bridge.runtime)
          await loadRuntime(bridge.runtime)

        if (!customElements.get('simple-record-form')) {
          throw new Error('The Simple UI Runtime did not register RecordForm.')
        }

        if (disposed || !containerRef.current)
          return

        element = document.createElement('simple-record-form') as RuntimeRecordFormElement
        element.blurField = bridge.blurField
        element.focusField = bridge.focusField
        element.formModel = formModelRef.current
        element.graphql = bridge.graphql
        element.capabilities = bridge.capabilities
        element.navigate = bridge.capabilities?.navigate
        element.registerSubmitPreparation = bridge.registerSubmitPreparation
        element.record = record
        element.subscribe = bridge.subscribe
        const ready = waitForElementMount({
          element,
          errorEventName: FORM_ERROR_EVENT,
          fallbackErrorMessage: 'The RecordForm could not be rendered.',
          onPostMountError: (error) => {
            failed = true
            if (!disposed)
              setState({ error, kind: 'error' })
          },
          readyEventName: FORM_READY_EVENT,
          signal: mountController.signal,
          timeoutMessage: 'The RecordForm did not become ready in time.',
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
      if (containerRef.current && element && containerRef.current.contains(element))
        containerRef.current.replaceChildren()
    }
  }, [attempt, bridge, hasFormModel, record])

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
      data-simple-managed-record-form=""
      ref={containerRef}
    />
  )
}

export type { RecordFormProps }
