import type { SimpleClient } from '@simpleplatform/sdk/space'
import type {
  BoardMoveRequestV1,
  BoardProps,
  DataGridProps,
  FilterExpressionV1,
  ListViewProps,
  RecordSourceV1,
  RecordViewPresetV1,
  ViewItemReferenceV1,
} from '../contracts/views.js'

import { useEffect, useRef, useState } from 'react'
import {
  RecordViewContractError,
  validateBoardPresetV1,
  validateControlledFilterPropsV1,
  validateDataGridPresetV1,
  validateListPresetV1,
  validateRecordSourceV1,
  validateSourceFilterExpressionV1,
} from '../contracts/views.js'
import { loadRuntime, RuntimeLoadError } from '../runtime.js'
import { waitForElementMount } from './mount-boundary.js'
import { getManagedUiBridge } from './record-bridge.js'

export type ViewComponentKind
  = | 'board'
    | 'list'
    | 'table'

interface RuntimeRecordViewElement extends HTMLElement {
  applyProperties?: (properties: RuntimeRecordViewProperties) => void
  filter?: FilterExpressionV1
  filterControlled?: boolean
  graphql?: (document: string, variables?: Readonly<Record<string, unknown>>) => Promise<unknown>
  kind?: ViewComponentKind
  onFilterChange?: (filter: FilterExpressionV1 | undefined) => void
  onMoveRequest?: (request: BoardMoveRequestV1) => Promise<void>
  onItemOpen?: (reference: ViewItemReferenceV1) => void
  preset?: RecordViewPresetV1
  source?: RecordSourceV1
  viewKind?: ViewComponentKind
}

interface RuntimeRecordViewProperties {
  filter?: FilterExpressionV1
  filterControlled: boolean
  graphql: NonNullable<RuntimeRecordViewElement['graphql']>
  kind: ViewComponentKind
  onFilterChange?: (filter: FilterExpressionV1 | undefined) => void
  onItemOpen?: (reference: ViewItemReferenceV1) => void
  onMoveRequest?: (request: BoardMoveRequestV1) => Promise<void>
  preset?: RecordViewPresetV1
  source: RecordSourceV1
  viewKind: ViewComponentKind
}

type LoadState
  = | { error: Error, kind: 'error' }
    | { kind: 'loading' }
    | { kind: 'ready' }

const VIEW_READY_EVENT = 'simple-record-view-ready'
const VIEW_ERROR_EVENT = 'simple-record-view-error'

interface GenericRecordViewProps {
  client: SimpleClient
  filter?: FilterExpressionV1
  onFilterChange?: (filter: FilterExpressionV1 | undefined) => void
  onMoveRequest?: (request: BoardMoveRequestV1) => Promise<void>
  onItemOpen?: (reference: ViewItemReferenceV1) => void
  preset?: RecordViewPresetV1
  source: RecordSourceV1
  viewKind: ViewComponentKind
}

function validateRecordViewProps(props: GenericRecordViewProps): void {
  validateRecordSourceV1(props.source)
  switch (props.viewKind) {
    case 'list':
      validateListPresetV1(props.preset)
      validateControlledFilterPropsV1(props)
      break
    case 'table':
      validateDataGridPresetV1(props.preset)
      validateControlledFilterPropsV1(props)
      break
    case 'board':
      validateBoardPresetV1(props.preset)
      validateControlledFilterPropsV1(props)
      if (props.onMoveRequest !== undefined && typeof props.onMoveRequest !== 'function')
        throw new RecordViewContractError('onMoveRequest must be a function.')
      break
  }
  if (props.preset?.filter !== undefined)
    validateSourceFilterExpressionV1(props.source, props.preset.filter)
  if (props.filter !== undefined)
    validateSourceFilterExpressionV1(props.source, props.filter)
  if (props.onItemOpen !== undefined && typeof props.onItemOpen !== 'function')
    throw new RecordViewContractError('onItemOpen must be a function.')
}

function applyRecordViewProperties(
  element: RuntimeRecordViewElement,
  props: GenericRecordViewProps,
  graphql: NonNullable<RuntimeRecordViewElement['graphql']>,
): void {
  const properties: RuntimeRecordViewProperties = {
    filter: props.filter,
    filterControlled: typeof props.onFilterChange === 'function',
    graphql,
    kind: props.viewKind,
    onFilterChange: props.onFilterChange,
    onItemOpen: props.onItemOpen,
    onMoveRequest: props.onMoveRequest,
    preset: props.preset,
    source: props.source,
    viewKind: props.viewKind,
  }
  if (element.applyProperties) {
    element.applyProperties(properties)
    return
  }
  Object.assign(element, properties)
}

function RecordViewAdapter(props: GenericRecordViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const bridge = getManagedUiBridge(props.client)

  const propsRef = useRef(props)
  propsRef.current = props
  const propsValidationError = useRef<string>()

  // Synchronize dynamic prop updates onto the mounted element without remounting
  useEffect(() => {
    try {
      validateRecordViewProps(props)
    }
    catch (err) {
      const error = err instanceof Error ? err : new Error('Invalid record view configuration.')
      if (propsValidationError.current !== error.message) {
        propsValidationError.current = error.message
        setState({ error, kind: 'error' })
      }
      return
    }

    if (propsValidationError.current) {
      propsValidationError.current = undefined
      if (containerRef.current?.querySelector('simple-record-view')) {
        setState({ kind: 'ready' })
      }
      else {
        setState({ kind: 'loading' })
        setAttempt(current => current + 1)
      }
    }

    const element = containerRef.current?.querySelector('simple-record-view') as RuntimeRecordViewElement | null
    if (element && bridge?.graphql) {
      applyRecordViewProperties(element, props, bridge.graphql)
    }
  }, [
    props.source,
    props.preset,
    props.filter,
    props.onFilterChange,
    props.onItemOpen,
    props.onMoveRequest,
    props.viewKind,
  ])

  useEffect(() => {
    if (!bridge) {
      setState({
        error: new Error('The managed record view is unavailable for this Space.'),
        kind: 'error',
      })
      return
    }

    try {
      validateRecordViewProps(props)
    }
    catch (err) {
      setState({
        error: err instanceof Error ? err : new Error('Invalid record view configuration.'),
        kind: 'error',
      })
      return
    }

    let disposed = false
    let failed = false
    let element: RuntimeRecordViewElement | undefined
    let disposeMount: (() => void) | undefined
    const mountController = new AbortController()

    const mount = async () => {
      try {
        const currentProps = propsRef.current
        validateRecordViewProps(currentProps)
        if (bridge.runtime) {
          await loadRuntime(bridge.runtime)
        }

        if (!customElements.get('simple-record-view')) {
          throw new Error('The Simple UI Runtime did not register RecordView.')
        }

        if (disposed || !containerRef.current) {
          return
        }

        element = document.createElement('simple-record-view') as RuntimeRecordViewElement
        element.style.display = 'block'
        element.style.width = '100%'
        element.style.height = '100%'
        applyRecordViewProperties(element, currentProps, bridge.graphql)

        const ready = waitForElementMount({
          element,
          errorEventName: VIEW_ERROR_EVENT,
          fallbackErrorMessage: 'The record view could not be rendered.',
          onPostMountError: (error) => {
            failed = true
            if (!disposed) {
              setState({ error, kind: 'error' })
            }
          },
          readyEventName: VIEW_READY_EVENT,
          signal: mountController.signal,
          timeoutMessage: 'The record view did not become ready in time.',
        })

        containerRef.current.replaceChildren(element)
        disposeMount = await ready
        if (!disposed && !failed) {
          setState({ kind: 'ready' })
        }
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
      if (containerRef.current && element && containerRef.current.contains(element)) {
        containerRef.current.replaceChildren()
      }
    }
  }, [attempt, bridge, props.source?.kind, props.viewKind])

  return (
    <>
      {state.kind === 'error' && (
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
      )}
      <div
        aria-busy={state.kind === 'loading' ? 'true' : undefined}
        data-simple-managed-record-view=""
        style={{ height: '100%', minHeight: 0 }}
        ref={containerRef}
      />
    </>
  )
}

export function ListView(props: ListViewProps) {
  return <RecordViewAdapter {...props} viewKind="list" />
}

export function DataGrid(props: DataGridProps) {
  return <RecordViewAdapter {...props} viewKind="table" />
}

export function Board(props: BoardProps) {
  return <RecordViewAdapter {...props} viewKind="board" />
}
