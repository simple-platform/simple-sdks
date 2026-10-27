import type { RecordWhere } from '@simpleplatform/sdk/graphql'
import type { SimpleClient } from '@simpleplatform/sdk/space'

export type { RecordWhere } from '@simpleplatform/sdk/graphql'

export interface TableRecordSourceV1 {
  appId: string
  kind: 'table'
  tableId: string
}

export type RecordSourceV1 = TableRecordSourceV1

export interface RecordReferenceV1 {
  appId: string
  recordId: string
  tableName: string
}

export type ViewItemReferenceV1 = RecordReferenceV1 & { kind: 'record' }

export const RECORD_VIEW_ICON_IDS_V1 = [
  'lucide:circle-alert',
  'lucide:arrow-up-right',
  'lucide:columns-3',
  'lucide:box',
  'lucide:calendar-days',
  'lucide:check',
  'lucide:clock-3',
  'lucide:file',
  'lucide:circle-question-mark',
  'lucide:inbox',
  'lucide:layout-grid',
  'lucide:list',
  'lucide:mail',
  'lucide:settings',
  'lucide:star',
  'lucide:table',
  'lucide:tag',
  'lucide:user-round',
  'lucide:video',
] as const

export type RecordViewIconIdV1 = typeof RECORD_VIEW_ICON_IDS_V1[number]

export interface RecordSortV1 {
  direction: 'asc' | 'desc'
  fieldName: string
}

export interface RecordViewSummaryV1 {
  fieldName: string
  operation: 'average' | 'max' | 'min' | 'sum'
}

export const RECORD_TILE_PRESENTATIONS_V1 = [
  'standard',
  'media',
  'message',
] as const

export type RecordTilePresentationV1 = typeof RECORD_TILE_PRESENTATIONS_V1[number]

export type RecordTileVisualV1
  = | { altFieldName?: string, fieldName: string, fit?: 'contain' | 'cover', kind: 'image' }
    | { altFieldName?: string, fieldName: string, kind: 'avatar' }
    | { iconId: RecordViewIconIdV1, kind: 'icon' }
    | {
      fallbackIconId: RecordViewIconIdV1
      fieldName: string
      iconsByValue: Record<string, RecordViewIconIdV1>
      kind: 'enum-icon'
    }

export interface RecordTileLayoutV1 {
  badgeFieldNames?: string[]
  badgeStyle?: 'filled' | 'outline'
  detailFieldNames?: string[]
  eyebrowFieldName?: string
  presentation: RecordTilePresentationV1
  subtitleFieldNames?: string[]
  titleFieldName: string
  trailingFieldName?: string
  version: 1
  visual?: RecordTileVisualV1
}

export const RECORD_VIEW_KINDS_V1 = ['board', 'inbox', 'list', 'table'] as const
export type RecordViewKindV1 = typeof RECORD_VIEW_KINDS_V1[number]

export interface RecordViewPresetBaseV1 {
  /** Native GraphQL where value; the platform validates it against the source before querying. */
  filter?: RecordWhere
  id: string
  orderBy?: RecordSortV1[]
  title: string
}

export type ListPresetV1 = RecordViewPresetBaseV1 & {
  config: {
    tile: RecordTileLayoutV1
  }
  kind: 'list'
}

export type DataGridPresetV1 = RecordViewPresetBaseV1 & {
  config: {
    columns: Array<{ fieldName: string, width?: number }>
    tile?: RecordTileLayoutV1
  }
  kind: 'table'
}

export type BoardPresetV1 = RecordViewPresetBaseV1 & {
  config: {
    laneFieldName: string
    lanePageSize?: number
    laneOrder?: string[]
    summaries?: RecordViewSummaryV1[]
    tile: RecordTileLayoutV1
  }
  kind: 'board'
}

export type InboxPresetV1 = RecordViewPresetBaseV1 & {
  kind: 'inbox'
  config:
    | { detail: 'record', detailFieldNames?: never, listTile: RecordTileLayoutV1 }
    | { detail?: 'fields', detailFieldNames: string[], listTile: RecordTileLayoutV1 }
}

export type RecordViewPresetV1
  = | DataGridPresetV1
    | InboxPresetV1
    | BoardPresetV1
    | ListPresetV1

export interface ViewPresetSetV1 {
  defaultPresetId: string
  presets: RecordViewPresetV1[]
  version: 1
}

export type ControlledFilterPropsV1
  = | { filter?: never, onFilterChange?: never }
    | {
      filter: RecordWhere | undefined
      onFilterChange: (filter: RecordWhere | undefined) => void
    }

export interface RecordViewPropsV1<TPreset extends RecordViewPresetV1> {
  client: SimpleClient
  onItemOpen?: (reference: ViewItemReferenceV1) => void
  preset: TPreset
  source: RecordSourceV1
}

export type ListViewProps = RecordViewPropsV1<ListPresetV1> & ControlledFilterPropsV1
export type DataGridProps = RecordViewPropsV1<DataGridPresetV1> & ControlledFilterPropsV1
export interface BoardMoveRequestV1 {
  from: string | null
  item: ViewItemReferenceV1
  laneFieldName: string
  to: string | null
}

export type BoardProps = RecordViewPropsV1<BoardPresetV1> & ControlledFilterPropsV1 & {
  onMoveRequest?: (request: BoardMoveRequestV1) => Promise<void>
}

export class RecordViewContractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RecordViewContractError'
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim() === value
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: Iterable<string>, label: string): void {
  const allowedKeys = new Set(allowed)
  const unexpected = Object.keys(value).find(key => !allowedKeys.has(key))
  if (unexpected)
    throw new RecordViewContractError(`${label} contains an unsupported property: ${unexpected}.`)
}

export function validateTableRecordSourceV1(value: unknown): TableRecordSourceV1 {
  if (!isPlainObject(value))
    throw new RecordViewContractError('Record source must be an object.')
  if (value.kind !== 'table')
    throw new RecordViewContractError('Record source kind must be \'table\'.')
  assertOnlyKeys(value, ['kind', 'appId', 'tableId'], 'Table source')
  if (!isNonEmptyString(value.appId))
    throw new RecordViewContractError('Table source appId must be a non-empty string without whitespace padding.')
  if (!isNonEmptyString(value.tableId))
    throw new RecordViewContractError('Table source tableId must be a non-empty string without whitespace padding.')
  return { appId: value.appId, kind: 'table', tableId: value.tableId }
}

export function validateRecordSourceV1(value: unknown): RecordSourceV1 {
  return validateTableRecordSourceV1(value)
}

export function isRecordSourceV1(value: unknown): value is RecordSourceV1 {
  try {
    validateRecordSourceV1(value)
    return true
  }
  catch {
    return false
  }
}

export function validateRecordReferenceV1(value: unknown): RecordReferenceV1 {
  if (!isPlainObject(value)) {
    throw new RecordViewContractError('Record reference must be an object.')
  }
  if (!isNonEmptyString(value.appId)) {
    throw new RecordViewContractError('Record reference appId must be a non-empty string.')
  }
  if (!isNonEmptyString(value.tableName)) {
    throw new RecordViewContractError('Record reference tableName must be a non-empty string.')
  }
  if (!isNonEmptyString(value.recordId)) {
    throw new RecordViewContractError('Record reference recordId must be a non-empty string.')
  }
  return {
    appId: value.appId,
    recordId: value.recordId,
    tableName: value.tableName,
  }
}

export function isRecordReferenceV1(value: unknown): value is RecordReferenceV1 {
  try {
    validateRecordReferenceV1(value)
    return true
  }
  catch {
    return false
  }
}

export function validateViewItemReferenceV1(value: unknown): ViewItemReferenceV1 {
  if (!isPlainObject(value)) {
    throw new RecordViewContractError('View item reference must be an object.')
  }
  if (value.kind !== 'record')
    throw new RecordViewContractError(`View item reference kind must be 'record', got '${String(value.kind)}'.`)
  assertOnlyKeys(value, ['appId', 'kind', 'recordId', 'tableName'], 'Record view item reference')
  return { ...validateRecordReferenceV1(value), kind: 'record' }
}

export function isViewItemReferenceV1(value: unknown): value is ViewItemReferenceV1 {
  try {
    validateViewItemReferenceV1(value)
    return true
  }
  catch {
    return false
  }
}

const MAX_PRESETS = 20
const MAX_VIEW_FIELDS = 40
const MAX_SORT_FIELDS = 5
const MAX_LANES = 20
const MAX_LANE_PAGE_SIZE = 50
const SAFE_TILE_ICON_IDS = new Set<string>(RECORD_VIEW_ICON_IDS_V1)
const isSafeTileIconId = (value: unknown): value is RecordViewIconIdV1 => typeof value === 'string' && SAFE_TILE_ICON_IDS.has(value)
export function validateRecordSortV1(value: unknown): RecordSortV1 {
  if (!isPlainObject(value)) {
    throw new RecordViewContractError('Record sort must be an object.')
  }
  if (!isNonEmptyString(value.fieldName)) {
    throw new RecordViewContractError('Record sort fieldName must be a non-empty string.')
  }
  assertOnlyKeys(value, ['direction', 'fieldName'], 'Record sort')
  if (value.fieldName.length > 200)
    throw new RecordViewContractError('Record sort fieldName must be at most 200 characters.')
  if (value.direction !== 'asc' && value.direction !== 'desc') {
    throw new RecordViewContractError(`Record sort direction must be 'asc' or 'desc', got ${String(value.direction)}.`)
  }
  return {
    direction: value.direction,
    fieldName: value.fieldName,
  }
}

export function isRecordSortV1(value: unknown): value is RecordSortV1 {
  try {
    validateRecordSortV1(value)
    return true
  }
  catch {
    return false
  }
}

export function validateRecordTileLayoutV1(value: unknown): RecordTileLayoutV1 {
  if (!isPlainObject(value)) {
    throw new RecordViewContractError('Record tile layout must be an object.')
  }
  if (value.version !== 1) {
    throw new RecordViewContractError(`Record tile layout version must be 1, got ${String(value.version)}.`)
  }
  if (!RECORD_TILE_PRESENTATIONS_V1.includes(value.presentation as RecordTilePresentationV1)) {
    throw new RecordViewContractError(`Invalid tile presentation: ${String(value.presentation)}.`)
  }
  if (!isNonEmptyString(value.titleFieldName)) {
    throw new RecordViewContractError('Record tile layout titleFieldName must be a non-empty string.')
  }
  if (value.badgeStyle !== undefined && (value.presentation !== 'standard' || !['filled', 'outline'].includes(String(value.badgeStyle))))
    throw new RecordViewContractError('Tile badgeStyle must be filled or outline on standard tiles.')
  if (value.presentation === 'message') {
    if (!isNonEmptyString(value.eyebrowFieldName)
      || !Array.isArray(value.subtitleFieldNames)
      || value.subtitleFieldNames.length === 0
      || value.subtitleFieldNames.length > MAX_VIEW_FIELDS
      || !value.subtitleFieldNames.every(name => isNonEmptyString(name) && name.length <= 200)
      || !isNonEmptyString(value.trailingFieldName)) {
      throw new RecordViewContractError('Message tiles require sender, preview, and received-at fields.')
    }
    if (value.badgeFieldNames !== undefined || value.detailFieldNames !== undefined || value.visual !== undefined) {
      throw new RecordViewContractError('Email tiles do not support badges, details, or visuals.')
    }
  }
  assertOnlyKeys(value, ['badgeFieldNames', 'badgeStyle', 'detailFieldNames', 'eyebrowFieldName', 'presentation', 'subtitleFieldNames', 'titleFieldName', 'trailingFieldName', 'version', 'visual'], 'Record tile layout')
  for (const name of ['titleFieldName', 'eyebrowFieldName', 'trailingFieldName'] as const) {
    const fieldName = value[name]
    if (fieldName !== undefined && (typeof fieldName !== 'string' || fieldName.length > 200))
      throw new RecordViewContractError(`Record tile layout ${name} must be at most 200 characters.`)
  }

  let visual: RecordTileVisualV1 | undefined
  if (value.visual !== undefined) {
    if (!isPlainObject(value.visual)) {
      throw new RecordViewContractError('Tile visual must be an object.')
    }
    if (value.visual.kind === 'image') {
      if (!isNonEmptyString(value.visual.fieldName)) {
        throw new RecordViewContractError('Tile image visual requires fieldName.')
      }
      if (value.visual.altFieldName !== undefined && !isNonEmptyString(value.visual.altFieldName)) {
        throw new RecordViewContractError('Tile image visual altFieldName must be a non-empty string.')
      }
      if (value.visual.fieldName.length > 200 || (typeof value.visual.altFieldName === 'string' && value.visual.altFieldName.length > 200))
        throw new RecordViewContractError('Tile image visual field names must be at most 200 characters.')
      if (value.visual.fit !== undefined && value.visual.fit !== 'cover' && value.visual.fit !== 'contain') {
        throw new RecordViewContractError(`Tile image visual fit must be 'cover' or 'contain', got ${String(value.visual.fit)}.`)
      }
      assertOnlyKeys(value.visual, ['altFieldName', 'fieldName', 'fit', 'kind'], 'Tile image visual')
      visual = {
        ...(value.visual.altFieldName ? { altFieldName: value.visual.altFieldName } : {}),
        fieldName: value.visual.fieldName,
        ...(value.visual.fit ? { fit: value.visual.fit } : {}),
        kind: 'image',
      }
    }
    else if (value.visual.kind === 'avatar') {
      if (value.presentation !== 'standard')
        throw new RecordViewContractError('Tile avatar visuals are only supported on standard tiles.')
      if (!isNonEmptyString(value.visual.fieldName))
        throw new RecordViewContractError('Tile avatar visual requires fieldName.')
      if (value.visual.altFieldName !== undefined && !isNonEmptyString(value.visual.altFieldName))
        throw new RecordViewContractError('Tile avatar visual altFieldName must be a non-empty string.')
      if (value.visual.fieldName.length > 200 || (typeof value.visual.altFieldName === 'string' && value.visual.altFieldName.length > 200))
        throw new RecordViewContractError('Tile avatar visual field names must be at most 200 characters.')
      assertOnlyKeys(value.visual, ['altFieldName', 'fieldName', 'kind'], 'Tile avatar visual')
      visual = {
        ...(value.visual.altFieldName ? { altFieldName: value.visual.altFieldName } : {}),
        fieldName: value.visual.fieldName,
        kind: 'avatar',
      }
    }
    else if (value.visual.kind === 'icon') {
      if (!isNonEmptyString(value.visual.iconId)) {
        throw new RecordViewContractError('Tile icon visual requires iconId.')
      }
      if (!isSafeTileIconId(value.visual.iconId))
        throw new RecordViewContractError(`Tile icon is not in the platform icon catalogue: ${value.visual.iconId}.`)
      assertOnlyKeys(value.visual, ['iconId', 'kind'], 'Tile icon visual')
      visual = { iconId: value.visual.iconId, kind: 'icon' }
    }
    else if (value.visual.kind === 'enum-icon') {
      if (!isNonEmptyString(value.visual.fieldName)) {
        throw new RecordViewContractError('Tile enum-icon visual requires fieldName.')
      }
      if (!isPlainObject(value.visual.iconsByValue)) {
        throw new RecordViewContractError('Tile enum-icon visual requires iconsByValue map.')
      }
      const iconValues = Object.keys(value.visual.iconsByValue)
      if (iconValues.length > 100 || iconValues.some(key => !isNonEmptyString(key) || key.length > 200))
        throw new RecordViewContractError('Tile enum-icon map must contain at most 100 unpadded, non-empty values of at most 200 characters.')
      if (!isNonEmptyString(value.visual.fallbackIconId)) {
        throw new RecordViewContractError('Tile enum-icon visual requires fallbackIconId.')
      }
      if (value.visual.fieldName.length > 200)
        throw new RecordViewContractError('Tile enum-icon fieldName must be at most 200 characters.')
      for (const iconId of [value.visual.fallbackIconId, ...Object.values(value.visual.iconsByValue)]) {
        if (!isSafeTileIconId(iconId))
          throw new RecordViewContractError(`Tile icon is not in the platform icon catalogue: ${String(iconId)}.`)
      }
      assertOnlyKeys(value.visual, ['fallbackIconId', 'fieldName', 'iconsByValue', 'kind'], 'Tile enum icon visual')
      visual = {
        fallbackIconId: value.visual.fallbackIconId as RecordViewIconIdV1,
        fieldName: value.visual.fieldName,
        iconsByValue: Object.fromEntries(Object.entries(value.visual.iconsByValue).map(([key, iconId]) => [key, iconId as RecordViewIconIdV1])),
        kind: 'enum-icon',
      }
    }
    else {
      throw new RecordViewContractError(`Invalid tile visual kind: ${String(value.visual.kind)}.`)
    }
  }

  const checkOptionalStringArray = (arr: unknown, name: string): string[] | undefined => {
    if (arr === undefined)
      return undefined
    if (!Array.isArray(arr) || arr.length > MAX_VIEW_FIELDS || !arr.every(item => isNonEmptyString(item) && item.length <= 200)) {
      throw new RecordViewContractError(`Tile layout ${name} must be an array of non-empty strings.`)
    }
    if (new Set(arr).size !== arr.length)
      throw new RecordViewContractError(`Tile layout ${name} cannot contain duplicate fields.`)
    return arr
  }

  if (value.eyebrowFieldName !== undefined && !isNonEmptyString(value.eyebrowFieldName)) {
    throw new RecordViewContractError('Tile layout eyebrowFieldName must be a non-empty string.')
  }
  if (value.trailingFieldName !== undefined && !isNonEmptyString(value.trailingFieldName)) {
    throw new RecordViewContractError('Tile layout trailingFieldName must be a non-empty string.')
  }

  return {
    ...(value.badgeFieldNames !== undefined ? { badgeFieldNames: checkOptionalStringArray(value.badgeFieldNames, 'badgeFieldNames') } : {}),
    ...(value.badgeStyle !== undefined ? { badgeStyle: value.badgeStyle as RecordTileLayoutV1['badgeStyle'] } : {}),
    ...(value.detailFieldNames !== undefined ? { detailFieldNames: checkOptionalStringArray(value.detailFieldNames, 'detailFieldNames') } : {}),
    ...(isNonEmptyString(value.eyebrowFieldName) ? { eyebrowFieldName: value.eyebrowFieldName } : {}),
    presentation: value.presentation as RecordTilePresentationV1,
    ...(value.subtitleFieldNames !== undefined ? { subtitleFieldNames: checkOptionalStringArray(value.subtitleFieldNames, 'subtitleFieldNames') } : {}),
    titleFieldName: value.titleFieldName,
    ...(isNonEmptyString(value.trailingFieldName) ? { trailingFieldName: value.trailingFieldName } : {}),
    version: 1,
    ...(visual ? { visual } : {}),
  }
}

export function isRecordTileLayoutV1(value: unknown): value is RecordTileLayoutV1 {
  try {
    validateRecordTileLayoutV1(value)
    return true
  }
  catch {
    return false
  }
}

function validatePresetBase(value: unknown): RecordViewPresetBaseV1 {
  if (!isPlainObject(value)) {
    throw new RecordViewContractError('Preset must be an object.')
  }
  if (!isNonEmptyString(value.id)) {
    throw new RecordViewContractError('Preset id must be a non-empty string.')
  }
  if (!isNonEmptyString(value.title)) {
    throw new RecordViewContractError('Preset title must be a non-empty string.')
  }
  assertOnlyKeys(value, ['config', 'filter', 'id', 'kind', 'orderBy', 'title'], 'Preset')
  if (value.id.length > 80 || value.title.length > 120)
    throw new RecordViewContractError('Preset id must be at most 80 characters and title at most 120 characters.')
  const filter = value.filter as RecordWhere | undefined
  const orderBy = validateOrderBy(value.orderBy)
  return {
    ...(value.filter !== undefined ? { filter } : {}),
    id: value.id,
    ...(orderBy ? { orderBy } : {}),
    title: value.title,
  }
}

function validateOrderBy(orderBy: unknown): RecordSortV1[] | undefined {
  if (orderBy === undefined)
    return undefined
  if (!Array.isArray(orderBy) || orderBy.length > MAX_SORT_FIELDS) {
    throw new RecordViewContractError(`Preset orderBy must contain at most ${MAX_SORT_FIELDS} sort fields.`)
  }
  const sorts = orderBy.map(validateRecordSortV1)
  if (new Set(sorts.map(sort => sort.fieldName)).size !== sorts.length)
    throw new RecordViewContractError('Preset orderBy cannot contain duplicate fields.')
  return sorts
}

export function validateListPresetV1(value: unknown): ListPresetV1 {
  const base = validatePresetBase(value)
  const obj = value as Record<string, unknown>
  if (obj.kind !== 'list') {
    throw new RecordViewContractError(`List preset kind must be 'list', got ${String(obj.kind)}.`)
  }
  if (!isPlainObject(obj.config)) {
    throw new RecordViewContractError('List preset config must be an object.')
  }
  const tile = validateRecordTileLayoutV1(obj.config.tile)
  assertOnlyKeys(obj.config, ['tile'], 'List preset config')
  return {
    ...base,
    config: {
      tile,
    },
    kind: 'list',
  }
}

export function isListPresetV1(value: unknown): value is ListPresetV1 {
  try {
    validateListPresetV1(value)
    return true
  }
  catch {
    return false
  }
}

export function validateDataGridPresetV1(value: unknown): DataGridPresetV1 {
  const base = validatePresetBase(value)
  const obj = value as Record<string, unknown>
  if (obj.kind !== 'table') {
    throw new RecordViewContractError(`DataGrid preset kind must be 'table', got ${String(obj.kind)}.`)
  }
  if (!isPlainObject(obj.config)) {
    throw new RecordViewContractError('DataGrid preset config must be an object.')
  }
  assertOnlyKeys(obj.config, ['columns', 'tile'], 'DataGrid preset config')
  if (!Array.isArray(obj.config.columns) || obj.config.columns.length === 0 || obj.config.columns.length > MAX_VIEW_FIELDS) {
    throw new RecordViewContractError(`DataGrid preset columns must contain 1 to ${MAX_VIEW_FIELDS} columns.`)
  }
  const columns = obj.config.columns.map((col: unknown) => {
    if (!isPlainObject(col) || !isNonEmptyString(col.fieldName)) {
      throw new RecordViewContractError('Column definition must include non-empty fieldName.')
    }
    assertOnlyKeys(col, ['fieldName', 'width'], 'DataGrid column')
    if (col.fieldName.length > 200) {
      throw new RecordViewContractError('DataGrid fieldName must be at most 200 characters.')
    }
    if (col.width !== undefined && (typeof col.width !== 'number' || !Number.isFinite(col.width) || col.width < 80 || col.width > 800)) {
      throw new RecordViewContractError('Column width must be between 80 and 800 pixels.')
    }
    return {
      fieldName: col.fieldName as string,
      ...(col.width !== undefined ? { width: col.width as number } : {}),
    }
  })
  if (new Set(columns.map(column => column.fieldName)).size !== columns.length)
    throw new RecordViewContractError('DataGrid columns cannot contain duplicate fields.')
  const tile = obj.config.tile !== undefined ? validateRecordTileLayoutV1(obj.config.tile) : undefined
  return {
    ...base,
    config: {
      columns,
      ...(tile ? { tile } : {}),
    },
    kind: 'table',
  }
}

export function isDataGridPresetV1(value: unknown): value is DataGridPresetV1 {
  try {
    validateDataGridPresetV1(value)
    return true
  }
  catch {
    return false
  }
}

export function validateBoardPresetV1(value: unknown): BoardPresetV1 {
  const base = validatePresetBase(value)
  const obj = value as Record<string, unknown>
  if (obj.kind !== 'board') {
    throw new RecordViewContractError(`Board preset kind must be 'board', got ${String(obj.kind)}.`)
  }
  if (!isPlainObject(obj.config)) {
    throw new RecordViewContractError('Board preset config must be an object.')
  }
  if (!isNonEmptyString(obj.config.laneFieldName)) {
    throw new RecordViewContractError('Board preset laneFieldName must be a non-empty string.')
  }
  if (obj.config.laneFieldName.length > 200)
    throw new RecordViewContractError('Board preset laneFieldName must be at most 200 characters.')
  assertOnlyKeys(obj.config, ['laneFieldName', 'laneOrder', 'lanePageSize', 'summaries', 'tile'], 'Board preset config')
  const tile = validateRecordTileLayoutV1(obj.config.tile)
  if (obj.config.laneOrder !== undefined && (!Array.isArray(obj.config.laneOrder) || obj.config.laneOrder.length === 0 || obj.config.laneOrder.length > MAX_LANES || !obj.config.laneOrder.every(isNonEmptyString))) {
    throw new RecordViewContractError(`Board preset laneOrder must contain 1 to ${MAX_LANES} non-empty strings.`)
  }
  if (Array.isArray(obj.config.laneOrder) && new Set(obj.config.laneOrder).size !== obj.config.laneOrder.length) {
    throw new RecordViewContractError('Board preset laneOrder cannot contain duplicate values.')
  }
  if (obj.config.lanePageSize !== undefined && (!Number.isInteger(obj.config.lanePageSize) || (obj.config.lanePageSize as number) < 1 || (obj.config.lanePageSize as number) > MAX_LANE_PAGE_SIZE))
    throw new RecordViewContractError(`Board preset lanePageSize must be between 1 and ${MAX_LANE_PAGE_SIZE}.`)
  const summaries = validateRecordViewSummariesV1(obj.config.summaries)
  return {
    ...base,
    config: {
      laneFieldName: obj.config.laneFieldName,
      ...(obj.config.laneOrder ? { laneOrder: obj.config.laneOrder as string[] } : {}),
      ...(obj.config.lanePageSize !== undefined ? { lanePageSize: obj.config.lanePageSize as number } : {}),
      ...(summaries ? { summaries } : {}),
      tile,
    },
    kind: 'board',
  }
}

function validateRecordViewSummariesV1(value: unknown): RecordViewSummaryV1[] | undefined {
  if (value === undefined)
    return undefined
  if (!Array.isArray(value) || value.length > 3)
    throw new RecordViewContractError('Board summaries must contain at most 3 numeric summaries.')
  const summaries = value.map((entry) => {
    if (!isPlainObject(entry))
      throw new RecordViewContractError('Board summary must be an object.')
    assertOnlyKeys(entry, ['fieldName', 'operation'], 'Board summary')
    if (!isNonEmptyString(entry.fieldName) || entry.fieldName.length > 200)
      throw new RecordViewContractError('Board summary fieldName must be a non-empty string of at most 200 characters.')
    if (entry.operation !== 'average' && entry.operation !== 'max' && entry.operation !== 'min' && entry.operation !== 'sum')
      throw new RecordViewContractError('Board summary operation must be average, max, min, or sum.')
    return { fieldName: entry.fieldName, operation: entry.operation as RecordViewSummaryV1['operation'] }
  })
  if (new Set(summaries.map(summary => `${summary.operation}:${summary.fieldName}`)).size !== summaries.length)
    throw new RecordViewContractError('Board summaries cannot contain duplicates.')
  return summaries
}

export function isBoardPresetV1(value: unknown): value is BoardPresetV1 {
  if (!isPlainObject(value) || value.kind !== 'board')
    return false
  try {
    validateBoardPresetV1(value)
    return true
  }
  catch {
    return false
  }
}

export function validateInboxPresetV1(value: unknown): InboxPresetV1 {
  const base = validatePresetBase(value)
  const obj = value as Record<string, unknown>
  if (obj.kind !== 'inbox') {
    throw new RecordViewContractError(`Inbox preset kind must be 'inbox', got ${String(obj.kind)}.`)
  }
  if (!isPlainObject(obj.config)) {
    throw new RecordViewContractError('Inbox preset config must be an object.')
  }
  const listTile = validateRecordTileLayoutV1(obj.config.listTile)
  if (obj.config.detail !== undefined && obj.config.detail !== 'fields' && obj.config.detail !== 'record')
    throw new RecordViewContractError('Inbox detail must be fields or record.')
  if (obj.config.detail === 'record' && obj.config.detailFieldNames !== undefined) {
    throw new RecordViewContractError('Inbox detailFieldNames are only valid when detail is fields.')
  }
  const detailFieldNames = obj.config.detail === 'record' ? undefined : obj.config.detailFieldNames
  if (detailFieldNames !== undefined && (!Array.isArray(detailFieldNames) || detailFieldNames.length === 0 || detailFieldNames.length > MAX_VIEW_FIELDS || !detailFieldNames.every(name => isNonEmptyString(name) && name.length <= 200))) {
    throw new RecordViewContractError(`Inbox preset detailFieldNames must contain 1 to ${MAX_VIEW_FIELDS} non-empty field names.`)
  }
  if (detailFieldNames === undefined && obj.config.detail !== 'record') {
    throw new RecordViewContractError(`Inbox preset detailFieldNames must contain 1 to ${MAX_VIEW_FIELDS} non-empty field names.`)
  }
  if (Array.isArray(detailFieldNames) && new Set(detailFieldNames).size !== detailFieldNames.length)
    throw new RecordViewContractError('Inbox preset detailFieldNames cannot contain duplicates.')
  assertOnlyKeys(obj.config, ['detail', 'detailFieldNames', 'listTile'], 'Inbox preset config')
  const detailConfig = obj.config.detail === 'record'
    ? { detail: 'record' as const }
    : {
        ...(obj.config.detail === 'fields' ? { detail: 'fields' as const } : {}),
        detailFieldNames: detailFieldNames as string[],
      }

  return {
    ...base,
    config: {
      ...detailConfig,
      listTile,
    },
    kind: 'inbox',
  }
}

export function isInboxPresetV1(value: unknown): value is InboxPresetV1 {
  try {
    validateInboxPresetV1(value)
    return true
  }
  catch {
    return false
  }
}

export function validateRecordViewPresetV1(value: unknown): RecordViewPresetV1 {
  if (!isPlainObject(value)) {
    throw new RecordViewContractError('Preset must be an object.')
  }
  switch (value.kind) {
    case 'list':
      return validateListPresetV1(value)
    case 'table':
      return validateDataGridPresetV1(value)
    case 'board':
      return validateBoardPresetV1(value)
    case 'inbox':
      return validateInboxPresetV1(value)
    default:
      throw new RecordViewContractError(`Unknown record view preset kind: ${String(value.kind)}.`)
  }
}

export function isRecordViewPresetV1(value: unknown): value is RecordViewPresetV1 {
  try {
    validateRecordViewPresetV1(value)
    return true
  }
  catch {
    return false
  }
}

export function validateViewPresetSetV1(value: unknown): ViewPresetSetV1 {
  if (!isPlainObject(value)) {
    throw new RecordViewContractError('ViewPresetSet must be an object.')
  }
  assertOnlyKeys(value, ['defaultPresetId', 'presets', 'version'], 'ViewPresetSet')
  if (value.version !== 1) {
    throw new RecordViewContractError(`ViewPresetSet version must be 1, got ${String(value.version)}.`)
  }
  if (!isNonEmptyString(value.defaultPresetId)) {
    throw new RecordViewContractError('ViewPresetSet defaultPresetId must be a non-empty string.')
  }
  if (value.defaultPresetId.length > 80)
    throw new RecordViewContractError('ViewPresetSet defaultPresetId must be at most 80 characters.')
  if (!Array.isArray(value.presets) || value.presets.length === 0 || value.presets.length > MAX_PRESETS) {
    throw new RecordViewContractError(`ViewPresetSet presets must contain 1 to ${MAX_PRESETS} presets.`)
  }
  const presets = value.presets.map(validateRecordViewPresetV1)
  const ids = new Set<string>()
  for (const preset of presets) {
    if (ids.has(preset.id)) {
      throw new RecordViewContractError(`Duplicate preset id found: ${preset.id}.`)
    }
    ids.add(preset.id)
  }
  if (!ids.has(value.defaultPresetId)) {
    throw new RecordViewContractError(`defaultPresetId '${value.defaultPresetId}' not found in presets.`)
  }
  return {
    defaultPresetId: value.defaultPresetId,
    presets,
    version: 1,
  }
}

export function isViewPresetSetV1(value: unknown): value is ViewPresetSetV1 {
  try {
    validateViewPresetSetV1(value)
    return true
  }
  catch {
    return false
  }
}

export function validateControlledFilterPropsV1(props: unknown): ControlledFilterPropsV1 {
  if (!isPlainObject(props)) {
    throw new RecordViewContractError('Props must be an object.')
  }
  const hasFilter = 'filter' in props
  const hasOnFilterChange = 'onFilterChange' in props

  if (!hasFilter && !hasOnFilterChange) {
    return {} as ControlledFilterPropsV1
  }

  if (hasFilter && props.filter === undefined && !hasOnFilterChange) {
    return {} as ControlledFilterPropsV1
  }

  if (hasFilter && !hasOnFilterChange) {
    throw new RecordViewContractError('Controlled filter requires onFilterChange callback.')
  }
  if (!hasFilter && hasOnFilterChange) {
    throw new RecordViewContractError('Controlled onFilterChange requires a filter prop.')
  }

  if (typeof props.onFilterChange !== 'function') {
    throw new RecordViewContractError('onFilterChange must be a function.')
  }

  return {
    filter: props.filter as RecordWhere | undefined,
    onFilterChange: props.onFilterChange as (filter: RecordWhere | undefined) => void,
  }
}

export function isControlledFilterPropsV1(props: unknown): props is ControlledFilterPropsV1 {
  try {
    validateControlledFilterPropsV1(props)
    return true
  }
  catch {
    return false
  }
}
