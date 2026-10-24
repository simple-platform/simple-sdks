/* eslint-disable test/no-import-node-test */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test, { after } from 'node:test'

import { Window } from 'happy-dom'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

const window = new Window()
const previousGlobals = {
  customElements: globalThis.customElements,
  document: globalThis.document,
  HTMLElement: globalThis.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT,
  window: globalThis.window,
}

Object.assign(globalThis, {
  customElements: window.customElements,
  document: window.document,
  HTMLElement: window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
  window,
})

let mountBehavior = 'ready'

class TestRecordViewElement extends HTMLElement {
  applyProperties(properties) {
    this.propertyUpdateCount = (this.propertyUpdateCount ?? 0) + 1
    Object.assign(this, properties)
  }

  connectedCallback() {
    queueMicrotask(() => {
      if (mountBehavior === 'ready') {
        this.dispatchEvent(new this.ownerDocument.defaultView.Event('simple-record-view-ready'))
      }
      else if (mountBehavior === 'error') {
        this.dispatchEvent(new this.ownerDocument.defaultView.CustomEvent('simple-record-view-error', {
          detail: { message: 'The record view failed to render.' },
        }))
      }
    })
  }
}
customElements.define('simple-record-view', TestRecordViewElement)

const contracts = await import(new URL('../dist/contracts/index.js', import.meta.url).href)
const react = await import(new URL('../dist/react/index.js', import.meta.url).href)
const { createSimpleClient } = await import(new URL('../../ts/dist/space/core.js', import.meta.url).href)
const contractCorpus = JSON.parse(readFileSync(new URL('./fixtures/record-view-contract-v1.json', import.meta.url), 'utf8'))

for (const sample of contractCorpus.cases) {
  test(`portable managed-view contract: ${sample.name}`, () => {
    const validate = () => sample.target === 'filter'
      ? contracts.validateFilterExpression(sample.input)
      : contracts.validateViewPresetSet({ defaultPresetId: sample.input.id, presets: [sample.input], version: 1 })
    if (sample.accepted)
      assert.doesNotThrow(validate)
    else
      assert.throws(validate)
  })
}

after(() => Object.assign(globalThis, previousGlobals))

function createConnectedContainer() {
  const container = window.document.createElement('div')
  window.document.body.appendChild(container)
  return container
}

function createMockClient({ graphql = async () => ({}), runtime } = {}) {
  return createSimpleClient({
    dataTransport: { execute: graphql },
    runtime,
  })
}

const sampleTile = {
  detailFieldNames: ['status'],
  presentation: 'row',
  titleFieldName: 'title',
  version: 1,
}

const sampleListPreset = {
  config: {
    orderBy: [{ direction: 'asc', fieldName: 'title' }],
    tile: sampleTile,
  },
  iconId: 'list',
  id: 'preset-list-1',
  kind: 'list',
  title: 'All Tickets',
}

const sampleTablePreset = {
  config: {
    columns: [{ fieldName: 'title', width: 200 }],
    tile: sampleTile,
  },
  id: 'preset-table-1',
  kind: 'table',
  title: 'Ticket Table',
}

const sampleBoardPreset = {
  config: {
    laneFieldName: 'status',
    laneOrder: ['todo', 'done'],
    loadMoreSizePerLane: 10,
    orderBy: [{ direction: 'desc', fieldName: 'age' }],
    summaries: [{ fieldName: 'age', operation: 'sum' }, { fieldName: 'age', operation: 'average' }],
    tile: sampleTile,
  },
  id: 'preset-board-1',
  kind: 'board',
  title: 'Ticket Board',
}

const sampleInboxPreset = {
  config: {
    detailFieldNames: ['description'],
    listTile: sampleTile,
  },
  id: 'preset-inbox-1',
  kind: 'inbox',
  title: 'Ticket Inbox',
}

const sampleSource = {
  appId: 'acme.crm',
  kind: 'table',
  tableId: 'TBL000001',
}

test('exports unversioned managed-view names and validators from @simpleplatform/ui-kit/contracts', () => {
  assert.ok(Array.isArray(contracts.FILTER_OPERATORS))
  assert.ok(contracts.FILTER_OPERATORS.includes('eq'))
  assert.ok(contracts.FILTER_OPERATORS.includes('between'))
  assert.ok(Array.isArray(contracts.RECORD_TILE_PRESENTATIONS))
  assert.ok(contracts.RECORD_TILE_PRESENTATIONS.includes('row'))
  assert.ok(contracts.RECORD_TILE_PRESENTATIONS.includes('editorial'))
  assert.ok(Array.isArray(contracts.RECORD_VIEW_ICON_IDS))
  assert.ok(contracts.RECORD_VIEW_ICON_IDS.includes('list'))
  assert.ok(contracts.RECORD_VIEW_ICON_IDS.includes('check'))
  assert.ok(Array.isArray(contracts.RECORD_VIEW_KINDS))
  assert.deepEqual(contracts.RECORD_VIEW_KINDS, ['board', 'inbox', 'list', 'table'])

  assert.equal(typeof contracts.validateRecordSource, 'function')
  assert.equal(typeof contracts.validateTableRecordSource, 'function')
  assert.equal(typeof contracts.isViewItemReference, 'function')
  assert.equal(typeof contracts.validateSourceFilterExpression, 'function')
  assert.equal(typeof contracts.isRecordSource, 'function')
  assert.equal(typeof contracts.validateRecordReference, 'function')
  assert.equal(typeof contracts.validateViewItemReference, 'function')
  assert.equal(typeof contracts.validateFilterExpression, 'function')
  assert.equal(typeof contracts.validateRecordTileLayout, 'function')
  assert.equal(typeof contracts.validateRecordViewPreset, 'function')
  assert.equal(typeof contracts.validateListPreset, 'function')
  assert.equal(typeof contracts.validateDataGridPreset, 'function')
  assert.equal(typeof contracts.validateBoardPreset, 'function')
  assert.equal(typeof contracts.validateInboxPreset, 'function')
  assert.equal(typeof contracts.validateViewPresetSet, 'function')
  assert.equal(typeof contracts.validateControlledFilterProps, 'function')
  assert.ok(Object.keys(contracts).every(name => !name.endsWith('V1')), 'public contract exports should not expose implementation version suffixes')
})

test('validates database table record sources and references', () => {
  assert.deepEqual(contracts.validateRecordSource(sampleSource), sampleSource)
  assert.deepEqual(contracts.validateTableRecordSource(sampleSource), sampleSource)
  assert.equal(contracts.isRecordSource(sampleSource), true)
  assert.equal(contracts.isRecordSource({ appId: '', kind: 'table' }), false)
  assert.throws(() => contracts.validateRecordSource(null), /Record source must be an object/)
  assert.throws(() => contracts.validateRecordSource({ appId: '', kind: 'table', tableId: 'TBL000001' }), /appId/)
  assert.throws(() => contracts.validateRecordSource({ appId: '   ', kind: 'table', tableId: 'TBL000001' }), /appId/)
  assert.throws(() => contracts.validateRecordSource({ appId: 'foo', kind: 'table', tableId: '' }), /tableId/)
  assert.throws(() => contracts.validateRecordSource({ appId: 'foo', tableName: 'ticket' }), /Record source kind must be 'table'/)
  assert.throws(() => contracts.validateRecordSource({ items: [], kind: 'items' }), /Record source kind must be 'table'/)
  assert.throws(() => contracts.validateTableRecordSource({ appId: 'foo', tableName: 'ticket' }), /Record source kind must be 'table'/)
  assert.throws(() => contracts.validateTableRecordSource({ fields: [], items: [], kind: 'items' }), /Record source kind must be 'table'/)
  assert.throws(() => contracts.validateRecordSource({ appId: 'foo', extra: true, kind: 'table', tableId: 'TBL000001' }), /unsupported property/i)
  assert.throws(() => contracts.validateRecordSource({ appId: 'foo', kind: 'table', tableName: 'ticket' }), /tableName.*unsupported property|unsupported property.*tableName/i)
})

test('validates table filter expressions and record view references', () => {
  const filter = { root: { fieldName: 'title', kind: 'predicate', operator: 'contains', value: 'notes' }, version: 1 }
  assert.deepEqual(contracts.validateSourceFilterExpression(sampleSource, filter), filter)
  assert.deepEqual(contracts.validateViewItemReference({ appId: 'acme.crm', kind: 'record', recordId: 'REC1', tableName: 'ticket' }), {
    appId: 'acme.crm',
    kind: 'record',
    recordId: 'REC1',
    tableName: 'ticket',
  })
  assert.equal(contracts.isViewItemReference({ appId: 'acme.crm', kind: 'record', recordId: 'REC1', tableName: 'ticket' }), true)
  assert.equal(contracts.isViewItemReference({ itemId: 'item-42', kind: 'item' }), false)
  assert.throws(() => contracts.validateViewItemReference({ itemId: 'item-42', kind: 'item' }), /kind must be 'record'/)
})

test('rejects caller-owned JSON row sources at the public view boundary', () => {
  assert.equal(contracts.isRecordSource({ items: [], kind: 'items' }), false)
  assert.throws(() => contracts.validateRecordSource({ items: [], kind: 'items' }), /kind must be 'table'/)
})

test('validates FilterExpression shape', () => {
  const validFilter = {
    root: {
      children: [
        { fieldName: 'status', kind: 'predicate', operator: 'eq', value: 'open' },
        { fieldName: 'age', kind: 'predicate', operator: 'between', value: 10, value2: 50 },
      ],
      kind: 'group',
      operator: 'and',
    },
    version: 1,
  }
  assert.deepEqual(contracts.validateFilterExpression(validFilter), validFilter)
  assert.equal(contracts.isFilterExpression(validFilter), true)

  assert.throws(() => contracts.validateFilterExpression({ root: validFilter.root, version: 2 }))
  assert.throws(() => contracts.validateFilterExpression({ root: { kind: 'predicate', operator: 'bad_op' }, version: 1 }))
  assert.throws(() => contracts.validateFilterExpression({ root: { children: [], kind: 'group', operator: 'not' }, version: 1 }))

  // Legacy fieldId and missing fieldName fail closed
  assert.throws(() => contracts.validateFilterExpression({
    root: { fieldId: 'status', kind: 'predicate', operator: 'eq', value: 'open' },
    version: 1,
  }), /Filter predicate fieldName must be a non-empty string/)
  assert.throws(() => contracts.validateFilterExpression({
    root: { fieldName: '', kind: 'predicate', operator: 'eq', value: 'open' },
    version: 1,
  }), /Filter predicate fieldName must be a non-empty string/)
  assert.throws(() => contracts.validateFilterExpression({
    root: { kind: 'predicate', operator: 'eq', value: 'open' },
    version: 1,
  }), /Filter predicate fieldName must be a non-empty string/)
  assert.equal(contracts.isFilterExpression({
    root: { fieldId: 'status', kind: 'predicate', operator: 'eq', value: 'open' },
    version: 1,
  }), false)

  const nestedJson = {
    root: {
      children: [{
        fieldName: 'metadata',
        kind: 'predicate',
        operator: 'contains',
        value: { labels: ['urgent', { source: 'mobile' }] },
      }],
      kind: 'group',
      operator: 'and',
    },
    version: 1,
  }
  assert.deepEqual(contracts.validateFilterExpression(nestedJson), nestedJson)
  assert.throws(() => contracts.validateFilterExpression({
    root: { fieldName: 'metadata', kind: 'predicate', operator: 'contains', value: () => 'not json' },
    version: 1,
  }), /JSON/i)

  const cyclic = {}
  cyclic.self = cyclic
  assert.throws(() => contracts.validateFilterExpression({
    root: { fieldName: 'metadata', kind: 'predicate', operator: 'contains', value: cyclic },
    version: 1,
  }), /cycles/i)

  assert.throws(() => contracts.validateFilterExpression({ extra: true, root: validFilter.root, version: 1 }), /unsupported property/i)
  assert.throws(() => contracts.validateFilterExpression({
    root: { ...validFilter.root, extra: true },
    version: 1,
  }), /unsupported property/i)
})

test('validates RecordSort shape and fails closed on legacy fieldId', () => {
  const validSort = { direction: 'asc', fieldName: 'title' }
  assert.deepEqual(contracts.validateRecordSort(validSort), validSort)
  assert.equal(contracts.isRecordSort(validSort), true)

  // Legacy fieldId, empty string, and invalid direction fail closed
  assert.throws(() => contracts.validateRecordSort({ direction: 'asc', fieldId: 'title' }), /Record sort fieldName must be a non-empty string/)
  assert.throws(() => contracts.validateRecordSort({ direction: 'asc', fieldName: '' }), /Record sort fieldName must be a non-empty string/)
  assert.throws(() => contracts.validateRecordSort({ direction: 'asc' }), /Record sort fieldName must be a non-empty string/)
  assert.throws(() => contracts.validateRecordSort({ direction: 'invalid', fieldName: 'title' }), /Record sort direction must be 'asc' or 'desc'/)
  assert.equal(contracts.isRecordSort({ direction: 'asc', fieldId: 'title' }), false)
  assert.equal(contracts.isRecordSort({ direction: 'asc', fieldName: '' }), false)
})

test('validates RecordTileLayout shape and compositions', () => {
  assert.deepEqual(contracts.validateRecordTileLayout(sampleTile), sampleTile)
  assert.equal(contracts.isRecordTileLayout(sampleTile), true)
  assert.ok(contracts.RECORD_TILE_PRESENTATIONS.includes('email'))

  const personTile = {
    badgeFieldNames: ['priority'],
    detailFieldNames: ['department'],
    eyebrowFieldName: 'team',
    presentation: 'person',
    subtitleFieldName: 'role',
    titleFieldName: 'name',
    trailingFieldName: 'updatedAt',
    version: 1,
    visual: { altFieldName: 'name', fieldName: 'avatar', fit: 'cover', kind: 'image' },
  }
  assert.deepEqual(contracts.validateRecordTileLayout(personTile), personTile)

  const enumIconTile = {
    presentation: 'status',
    titleFieldName: 'name',
    version: 1,
    visual: { fallbackIconId: 'help', fieldName: 'state', iconsByValue: { active: 'check' }, kind: 'enum-icon' },
  }
  assert.deepEqual(contracts.validateRecordTileLayout(enumIconTile), enumIconTile)

  const iconTile = {
    presentation: 'spotlight',
    titleFieldName: 'headline',
    version: 1,
    visual: { iconId: 'star', kind: 'icon' },
  }
  assert.deepEqual(contracts.validateRecordTileLayout(iconTile), iconTile)

  const emailTile = {
    eyebrowFieldName: 'sender',
    presentation: 'email',
    subtitleFieldName: 'preview',
    titleFieldName: 'subject',
    trailingFieldName: 'received_at',
    version: 1,
  }
  assert.deepEqual(contracts.validateRecordTileLayout(emailTile), emailTile)
  assert.throws(() => contracts.validateRecordTileLayout({ ...emailTile, eyebrowFieldName: undefined }), /require sender, preview, and received-at fields/)
  assert.throws(() => contracts.validateRecordTileLayout({ ...emailTile, badgeFieldNames: ['state'] }), /do not support badges, details, or visuals/)

  assert.throws(() => contracts.validateRecordTileLayout({ presentation: 'unknown', titleFieldName: 'x', version: 1 }))
  assert.throws(() => contracts.validateRecordTileLayout({ presentation: 'row', titleFieldName: '', version: 1 }))
  assert.throws(() => contracts.validateRecordTileLayout({ presentation: 'row', titleFieldName: 'x', version: 2 }))

  // Legacy titleFieldId fails closed
  assert.throws(() => contracts.validateRecordTileLayout({ presentation: 'row', titleFieldId: 'name', version: 1 }), /Record tile layout titleFieldName must be a non-empty string/)
  assert.equal(contracts.isRecordTileLayout({ presentation: 'row', titleFieldId: 'name', version: 1 }), false)

  // Legacy visual image fieldId fails closed
  assert.throws(() => contracts.validateRecordTileLayout({
    presentation: 'person',
    titleFieldName: 'name',
    version: 1,
    visual: { fieldId: 'avatar', kind: 'image' },
  }), /Tile image visual requires fieldName/)
  assert.throws(() => contracts.validateRecordTileLayout({
    presentation: 'person',
    titleFieldName: 'name',
    version: 1,
    visual: { altFieldId: 'avatar', fieldId: 'avatar', kind: 'image' },
  }), /Tile image visual requires fieldName/)
  assert.throws(() => contracts.validateRecordTileLayout({
    presentation: 'person',
    titleFieldName: 'name',
    version: 1,
    visual: { altFieldName: '', fieldName: 'avatar', kind: 'image' },
  }), /Tile image visual altFieldName must be a non-empty string/)

  // Unknown visual keys fail closed instead of being silently dropped
  assert.throws(() => contracts.validateRecordTileLayout({
    presentation: 'person',
    titleFieldName: 'name',
    version: 1,
    visual: { altFieldId: 'legacy-alt', fieldName: 'avatar', kind: 'image' },
  }), /unsupported property.*altFieldId/i)

  // Legacy visual enum-icon fieldId fails closed
  assert.throws(() => contracts.validateRecordTileLayout({
    presentation: 'status',
    titleFieldName: 'name',
    version: 1,
    visual: { fallbackIconId: 'help', fieldId: 'state', iconsByValue: { active: 'check' }, kind: 'enum-icon' },
  }), /Tile enum-icon visual requires fieldName/)

  // Empty string elements in badgeFieldNames / detailFieldNames fail closed
  assert.throws(() => contracts.validateRecordTileLayout({
    badgeFieldNames: [''],
    presentation: 'row',
    titleFieldName: 'name',
    version: 1,
  }), /badgeFieldNames must be an array of non-empty strings/)
  assert.throws(() => contracts.validateRecordTileLayout({
    detailFieldNames: [''],
    presentation: 'row',
    titleFieldName: 'name',
    version: 1,
  }), /detailFieldNames must be an array of non-empty strings/)

  // Empty string in eyebrowFieldName / subtitleFieldName / trailingFieldName fail closed
  assert.throws(() => contracts.validateRecordTileLayout({
    eyebrowFieldName: '',
    presentation: 'row',
    titleFieldName: 'name',
    version: 1,
  }), /eyebrowFieldName must be a non-empty string/)
  assert.throws(() => contracts.validateRecordTileLayout({
    presentation: 'row',
    subtitleFieldName: '',
    titleFieldName: 'name',
    version: 1,
  }), /subtitleFieldName must be a non-empty string/)
  assert.throws(() => contracts.validateRecordTileLayout({
    presentation: 'row',
    titleFieldName: 'name',
    trailingFieldName: '',
    version: 1,
  }), /trailingFieldName must be a non-empty string/)
})

test('validates discriminated preset kinds', () => {
  assert.deepEqual(contracts.validateListPreset(sampleListPreset), sampleListPreset)
  assert.deepEqual(contracts.validateDataGridPreset(sampleTablePreset), sampleTablePreset)
  assert.deepEqual(contracts.validateBoardPreset(sampleBoardPreset), sampleBoardPreset)
  assert.deepEqual(contracts.validateBoardPreset({ ...sampleBoardPreset, iconId: 'kanban', kind: 'kanban' }), {
    ...sampleBoardPreset,
    iconId: 'board',
  })
  assert.deepEqual(contracts.validateBoardPreset({
    ...sampleBoardPreset,
    config: { ...sampleBoardPreset.config, loadMoreSizePerLane: undefined, pageSizePerLane: 10 },
  }).config.loadMoreSizePerLane, 10)
  assert.deepEqual(contracts.validateBoardPreset(sampleBoardPreset).config.summaries, [
    { fieldName: 'age', operation: 'sum' },
    { fieldName: 'age', operation: 'average' },
  ])
  assert.throws(() => contracts.validateBoardPreset({
    ...sampleBoardPreset,
    config: { ...sampleBoardPreset.config, pageSizePerLane: 10 },
  }), /both loadMoreSizePerLane and legacy pageSizePerLane/i)
  assert.deepEqual(contracts.validateInboxPreset(sampleInboxPreset), sampleInboxPreset)

  // Discriminated rejection
  assert.throws(() => contracts.validateListPreset(sampleTablePreset), /kind.*list/i)
  assert.throws(() => contracts.validateDataGridPreset(sampleListPreset), /kind.*table/i)
  assert.throws(() => contracts.validateBoardPreset(sampleListPreset), /kind.*board/i)
  assert.throws(() => contracts.validateInboxPreset(sampleListPreset), /kind.*inbox/i)

  // Missing config requirement / legacy ID shapes fail closed
  assert.throws(() => contracts.validateBoardPreset({
    config: { tile: sampleTile },
    id: 'k1',
    kind: 'board',
    title: 'k',
  }), /laneFieldName/i)
  assert.throws(() => contracts.validateBoardPreset({
    config: { laneFieldId: 'status', tile: sampleTile },
    id: 'k1',
    kind: 'board',
    title: 'k',
  }), /laneFieldName/i)
  assert.equal(contracts.isBoardPreset({
    config: { laneFieldId: 'status', tile: sampleTile },
    id: 'k1',
    kind: 'board',
    title: 'k',
  }), false)

  assert.throws(() => contracts.validateInboxPreset({
    config: { listTile: sampleTile },
    id: 'i1',
    kind: 'inbox',
    title: 'i',
  }), /detailFieldNames/i)
  assert.throws(() => contracts.validateInboxPreset({
    config: { detailFieldIds: ['description'], listTile: sampleTile },
    id: 'i1',
    kind: 'inbox',
    title: 'i',
  }), /detailFieldNames/i)
  assert.equal(contracts.isInboxPreset({
    config: { detailFieldIds: ['description'], listTile: sampleTile },
    id: 'i1',
    kind: 'inbox',
    title: 'i',
  }), false)

  assert.throws(() => contracts.validateDataGridPreset({
    config: { columns: [{ fieldId: 'title', width: 200 }] },
    id: 't1',
    kind: 'table',
    title: 't',
  }), /fieldName/i)
  assert.throws(() => contracts.validateDataGridPreset({
    config: { columns: [{ fieldName: '', width: 200 }] },
    id: 't1',
    kind: 'table',
    title: 't',
  }), /fieldName/i)
  assert.equal(contracts.validateDataGridPreset({
    config: { columns: [{ fieldName: 'title' }], narrowPresentation: 'table' },
    id: 't1',
    kind: 'table',
    title: 't',
  }).config.narrowPresentation, undefined)
  assert.equal(contracts.isDataGridPreset({
    config: { columns: [{ fieldId: 'title', width: 200 }] },
    id: 't1',
    kind: 'table',
    title: 't',
  }), false)

  // Legacy orderBy in preset fails closed
  assert.throws(() => contracts.validateListPreset({
    config: {
      orderBy: [{ direction: 'asc', fieldId: 'title' }],
      tile: sampleTile,
    },
    id: 'l1',
    kind: 'list',
    title: 'l',
  }), /fieldName/i)
})

test('validates ViewPresetSet consistency', () => {
  const validSet = {
    defaultPresetId: 'preset-list-1',
    presets: [sampleListPreset, sampleTablePreset],
    version: 1,
  }
  assert.deepEqual(contracts.validateViewPresetSet(validSet), validSet)

  assert.throws(() => contracts.validateViewPresetSet({
    defaultPresetId: sampleListPreset.id,
    presets: [{ ...sampleListPreset, iconId: 'unsafe-icon' }],
    version: 1,
  }), /icon is not in the platform icon catalogue/i)

  // Default preset ID must exist in presets
  assert.throws(() => contracts.validateViewPresetSet({
    defaultPresetId: 'non-existent',
    presets: [sampleListPreset],
    version: 1,
  }), /defaultPresetId/i)

  // Duplicate preset IDs rejected
  assert.throws(() => contracts.validateViewPresetSet({
    defaultPresetId: 'preset-list-1',
    presets: [sampleListPreset, { ...sampleTablePreset, id: 'preset-list-1' }],
    version: 1,
  }), /duplicate/i)

  assert.throws(() => contracts.validateViewPresetSet({ ...validSet, extra: true }), /unsupported property/i)
  assert.throws(() => contracts.validateViewPresetSet({
    defaultPresetId: sampleListPreset.id,
    presets: [{ ...sampleListPreset, config: { ...sampleListPreset.config, extra: true } }],
    version: 1,
  }), /unsupported property/i)
  assert.throws(() => contracts.validateViewPresetSet({
    defaultPresetId: sampleListPreset.id,
    presets: [{ ...sampleListPreset, config: { tile: { ...sampleTile, className: 'unsafe' } } }],
    version: 1,
  }), /unsupported property/i)
  assert.throws(() => contracts.validateViewPresetSet({
    defaultPresetId: 'preset-0',
    presets: Array.from({ length: 21 }, (_, index) => ({
      ...sampleListPreset,
      id: `preset-${index}`,
    })),
    version: 1,
  }), /1 to 20 presets/i)
  assert.throws(() => contracts.validateDataGridPreset({
    ...sampleTablePreset,
    config: { columns: Array.from({ length: 41 }, () => ({ fieldName: 'title' })) },
  }), /1 to 40 columns/i)
  assert.throws(() => contracts.validateBoardPreset({
    ...sampleBoardPreset,
    config: { ...sampleBoardPreset.config, loadMoreSizePerLane: 26 },
  }), /between 1 and 25/i)
  assert.throws(() => contracts.validateBoardPreset({
    ...sampleBoardPreset,
    config: { ...sampleBoardPreset.config, summaries: [{ fieldName: 'age', operation: 'sum' }, { fieldName: 'age', operation: 'sum' }] },
  }), /cannot contain duplicates/i)
  assert.throws(() => contracts.validateBoardPreset({
    ...sampleBoardPreset,
    config: { ...sampleBoardPreset.config, summaries: [{ fieldName: 'age', operation: 'count' }] },
  }), /operation must be average/i)
})

test('validates ControlledFilterProps', () => {
  assert.equal(contracts.isControlledFilterProps({}), true)
  assert.equal(contracts.isControlledFilterProps({ filter: undefined, onFilterChange: () => {} }), true)
  assert.equal(contracts.isControlledFilterProps({ filter: { root: { fieldName: 'x', kind: 'predicate', operator: 'eq', value: 'sample' }, version: 1 }, onFilterChange: () => {} }), true)

  assert.throws(() => contracts.validateControlledFilterProps({ filter: { root: { fieldId: 'x', kind: 'predicate', operator: 'eq' }, version: 1 }, onFilterChange: () => {} }), /fieldName/i)
  assert.deepEqual(contracts.validateControlledFilterProps({ filter: undefined }), {})
  assert.throws(() => contracts.validateControlledFilterProps({ onFilterChange: () => {} }), /filter/i)
  assert.throws(() => contracts.validateControlledFilterProps({ filter: undefined, onFilterChange: 'not-a-fn' }), /function/i)
})

test('ListView mounts <simple-record-view> adapter without RecordHandle', async () => {
  mountBehavior = 'ready'
  const client = createMockClient()
  const container = createConnectedContainer()
  const root = createRoot(container)
  let openedRecord = null

  await act(async () => {
    root.render(createElement(react.ListView, {
      client,
      onItemOpen: (ref) => { openedRecord = ref },
      preset: sampleListPreset,
      source: sampleSource,
    }))
  })

  const element = container.querySelector('simple-record-view')
  assert.ok(element, '<simple-record-view> custom element must be mounted')
  assert.equal(element.style.display, 'block')
  assert.equal(element.style.width, '100%')
  assert.equal(element.style.height, '100%')
  assert.equal(container.querySelector('[data-simple-managed-record-view]').style.height, '100%')
  assert.equal(element.viewKind, 'list')
  assert.deepEqual(element.source, sampleSource)
  assert.deepEqual(element.preset, sampleListPreset)
  assert.equal(element.client, undefined, 'the runtime element receives only its private data bridge')
  assert.equal(typeof element.graphql, 'function')
  assert.equal(element.propertyUpdateCount, 1)

  element.onItemOpen?.({ appId: 'acme.crm', kind: 'record', recordId: 'rec-1', tableName: 'ticket' })
  assert.deepEqual(openedRecord, { appId: 'acme.crm', kind: 'record', recordId: 'rec-1', tableName: 'ticket' })

  await act(async () => root.unmount())
  container.remove()
})

test('batches updated view props into one runtime element update', async () => {
  mountBehavior = 'ready'
  const client = createMockClient()
  const container = createConnectedContainer()
  const root = createRoot(container)

  await act(async () => {
    root.render(createElement(react.ListView, {
      client,
      preset: sampleListPreset,
      source: sampleSource,
    }))
  })

  const element = container.querySelector('simple-record-view')
  assert.equal(element.propertyUpdateCount, 1)

  await act(async () => {
    root.render(createElement(react.ListView, {
      client,
      preset: { ...sampleListPreset, title: 'Updated Tickets' },
      source: sampleSource,
    }))
  })

  assert.equal(element.propertyUpdateCount, 2)
  assert.equal(element.preset.title, 'Updated Tickets')

  await act(async () => root.unmount())
  container.remove()
})

test('rejects non-function onItemOpen callbacks before mounting', async () => {
  const container = createConnectedContainer()
  const root = createRoot(container)

  await act(async () => {
    root.render(createElement(react.ListView, {
      client: createMockClient(),
      onItemOpen: 'not-a-function',
      preset: sampleListPreset,
      source: sampleSource,
    }))
  })

  assert.match(container.querySelector('[role="alert"]')?.textContent ?? '', /onItemOpen must be a function/i)
  assert.equal(container.querySelector('simple-record-view'), null)

  await act(async () => root.unmount())
  container.remove()
})

test('DataGrid mounts <simple-record-view> with table preset', async () => {
  mountBehavior = 'ready'
  const client = createMockClient()
  const container = createConnectedContainer()
  const root = createRoot(container)

  await act(async () => {
    root.render(createElement(react.DataGrid, {
      client,
      preset: sampleTablePreset,
      source: sampleSource,
    }))
  })

  const element = container.querySelector('simple-record-view')
  assert.ok(element)
  assert.equal(element.viewKind, 'table')
  assert.deepEqual(element.preset, sampleTablePreset)
  assert.equal(element.onReferenceOpen, undefined, 'Reference opens must use the public onItemOpen callback')

  await act(async () => root.unmount())
  container.remove()
})

test('Board mounts <simple-record-view> and binds onMoveRequest', async () => {
  mountBehavior = 'ready'
  const client = createMockClient()
  const container = createConnectedContainer()
  const root = createRoot(container)
  let moveRequestHandled = null

  await act(async () => {
    root.render(createElement(react.Board, {
      client,
      onMoveRequest: async (req) => { moveRequestHandled = req },
      preset: sampleBoardPreset,
      source: sampleSource,
    }))
  })

  const element = container.querySelector('simple-record-view')
  assert.ok(element)
  assert.equal(element.viewKind, 'board')
  assert.deepEqual(element.preset, sampleBoardPreset)

  const moveReq = { from: 'todo', item: { appId: 'a', kind: 'record', recordId: '1', tableName: 't' }, laneFieldName: 'status', to: 'done' }
  await element.onMoveRequest?.(moveReq)
  assert.deepEqual(moveRequestHandled, moveReq)

  await act(async () => root.unmount())
  container.remove()
})

test('updates props on mounted <simple-record-view> element without remounting', async () => {
  mountBehavior = 'ready'
  const client = createMockClient()
  const container = createConnectedContainer()
  const root = createRoot(container)

  await act(async () => {
    root.render(createElement(react.ListView, {
      client,
      filter: undefined,
      onFilterChange: () => {},
      preset: sampleListPreset,
      source: sampleSource,
    }))
  })

  const element1 = container.querySelector('simple-record-view')
  assert.ok(element1)

  const updatedFilter = { root: { fieldName: 'status', kind: 'predicate', operator: 'eq', value: 'closed' }, version: 1 }

  await act(async () => {
    root.render(createElement(react.ListView, {
      client,
      filter: updatedFilter,
      onFilterChange: () => {},
      preset: sampleListPreset,
      source: sampleSource,
    }))
  })

  const element2 = container.querySelector('simple-record-view')
  assert.strictEqual(element2, element1, 'Element must not be remounted on controlled filter update')
  assert.deepEqual(element2.filter, updatedFilter)

  await act(async () => root.unmount())
  container.remove()
})

test('shows clear mount failure when SimpleClient is missing private UI bridge', async () => {
  const invalidClient = {}
  const container = createConnectedContainer()
  const root = createRoot(container)

  await act(async () => {
    root.render(createElement(react.ListView, {
      client: invalidClient,
      preset: sampleListPreset,
      source: sampleSource,
    }))
  })

  const alert = container.querySelector('[role="alert"]')
  assert.ok(alert)
  assert.match(alert.textContent ?? '', /managed record view is unavailable/i)

  await act(async () => root.unmount())
  container.remove()
})

test('shows clear mount failure when preset kind does not match component', async () => {
  const client = createMockClient()
  const container = createConnectedContainer()
  const root = createRoot(container)

  await act(async () => {
    root.render(createElement(react.ListView, {
      client,
      preset: sampleTablePreset, // Table preset passed to ListView!
      source: sampleSource,
    }))
  })

  const alert = container.querySelector('[role="alert"]')
  assert.ok(alert)
  assert.match(alert.textContent ?? '', /kind.*list/i)

  await act(async () => root.unmount())
  container.remove()
})

test('recovers automatically when an invalid preset is corrected', async () => {
  mountBehavior = 'ready'
  const client = createMockClient()
  const container = createConnectedContainer()
  const root = createRoot(container)

  await act(async () => {
    root.render(createElement(react.ListView, {
      client,
      preset: sampleTablePreset,
      source: sampleSource,
    }))
  })

  assert.match(container.querySelector('[role="alert"]')?.textContent ?? '', /kind.*list/i)

  await act(async () => {
    root.render(createElement(react.ListView, {
      client,
      preset: sampleListPreset,
      source: sampleSource,
    }))
  })

  assert.equal(container.querySelector('[role="alert"]'), null)
  assert.ok(container.querySelector('simple-record-view'))

  await act(async () => root.unmount())
  container.remove()
})

test('reports missing sources without crashing and recovers when configured', async () => {
  mountBehavior = 'ready'
  const client = createMockClient()
  for (const source of [null, undefined]) {
    const container = createConnectedContainer()
    const root = createRoot(container)

    await act(async () => {
      root.render(createElement(react.ListView, { client, preset: sampleListPreset, source }))
    })

    assert.match(container.querySelector('[role="alert"]')?.textContent ?? '', /Record source must be an object/i)
    assert.equal(container.querySelector('simple-record-view'), null)

    await act(async () => {
      root.render(createElement(react.ListView, { client, preset: sampleListPreset, source: sampleSource }))
    })

    assert.equal(container.querySelector('[role="alert"]'), null)
    assert.deepEqual(container.querySelector('simple-record-view')?.source, sampleSource)
    await act(async () => root.unmount())
    container.remove()
  }
})

test('shows clear mount failure when element emits error and supports retry', async () => {
  mountBehavior = 'error'
  const client = createMockClient()
  const container = createConnectedContainer()
  const root = createRoot(container)

  await act(async () => {
    root.render(createElement(react.ListView, {
      client,
      preset: sampleListPreset,
      source: sampleSource,
    }))
  })

  const alert = container.querySelector('[role="alert"]')
  assert.ok(alert)
  assert.match(alert.textContent ?? '', /failed to render/i)

  const retryButton = alert.querySelector('button')
  assert.ok(retryButton)

  mountBehavior = 'ready'
  await act(async () => {
    retryButton.click()
  })

  assert.equal(container.querySelector('[role="alert"]'), null)
  assert.ok(container.querySelector('simple-record-view'))

  await act(async () => root.unmount())
  container.remove()
})
