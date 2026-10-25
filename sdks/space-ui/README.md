# Simple UI Kit

`@simpleplatform/ui-kit` provides supported, consistent UI for Simple Spaces.
It is deliberately small: use a managed component when Simple owns the
workflow; use the Space SDK directly when you need to own the UI yourself.

## Status

This package is in alpha. `StatusBadge` is the current simple component.
Managed `RecordForm`, `RecordActivity`, and database-backed record views are
pre-release React interfaces. Their local fixture implementations have been
browser-verified; they are not yet a stable compatibility promise. Record-header
actions are exposed by the companion Space SDK as `simple.ui.header`; they are
not a UI Kit export.
Do not treat alpha APIs as a stable compatibility promise until they are
released with an explicit support policy.

## Installation

```bash
pnpm add @simpleplatform/ui-kit @simpleplatform/sdk
```

Managed views require the SDK's private managed-view bridge. The peer and
scaffold requirement is `@simpleplatform/sdk@^3.2.0`; 3.2.0 is the planned
compatible release and is not yet published. Published SDK 3.1.0 lacks the
bridge. Publish the compatible SDK before the UI Kit; the UI Kit release check
verifies the published SDK artifact's bridge. For local review, use matching
SDK/UI Kit feature builds. React bridges support React 18.3 or 19. The `0.0.0`
peer exception supports linked workspace builds and does not prove registry
compatibility.

Releases are tagged `v<version>-kit`. The package is below 1.0: a breaking
change raises the minor, and the default range `^0.1.0` never moves onto `0.2`
by itself.

## Current component: StatusBadge

Load the stylesheet as described in [Loading the stylesheet](#loading-the-stylesheet)
before using this example.

```tsx
import { StatusBadge } from '@simpleplatform/ui-kit/react'

export function DeploymentState() {
  return <StatusBadge label="Ready" tone="success" />
}
```

| Prop          | Type                    | Required | Purpose                                                               |
| ------------- | ----------------------- | -------- | --------------------------------------------------------------------- |
| `label`       | `string`                | Yes      | Visible status text.                                                  |
| `tone`        | `SimpleStatusBadgeTone` | Yes      | Semantic color: `neutral`, `info`, `success`, `warning`, or `danger`. |
| `description` | `string`                | No       | Additional context for assistive technology.                          |

Import the exported contract instead of maintaining a duplicate tone union:

```ts
import type { SimpleStatusBadgeTone } from '@simpleplatform/ui-kit/contracts'
import { SIMPLE_STATUS_BADGE_TONES } from '@simpleplatform/ui-kit/contracts'
```

Both exports are also available from the package root, `@simpleplatform/ui-kit`.

`StatusBadge` is a React bridge for the canonical
`<simple-status-badge>` Web Component. UI Kit components receive explicit
props; the package provides no React provider or implicit SDK client.

The Web Component can also be used without React. Import the `elements`
entry once before using its tag in HTML, and load the stylesheet as described
in [Loading the stylesheet](#loading-the-stylesheet):

```ts
import '@simpleplatform/ui-kit/elements'
```

```html
<simple-status-badge label="Ready" tone="success"></simple-status-badge>
```

### Loading the stylesheet

In a Space that uses Tailwind 4, import the kit's stylesheet inside the Space's
Tailwind stylesheet, directly after `@import "tailwindcss";`. For example,
`src/styles/theme.css` should begin with:

```css
@import "tailwindcss";
@import "@simpleplatform/ui-kit/theme.css";
```

Import that Space stylesheet once from the entry point, such as `src/main.tsx`:

```ts
import './styles/theme.css'
```

The kit contains an `@theme` block that maps Tailwind names to the platform's
theme tokens and an `@layer utilities` block, so both stylesheets need to pass
through Tailwind together. Importing the kit's stylesheet separately from
JavaScript can leave its `@theme` block unprocessed, which the browser ignores,
and place the utilities layer before Tailwind's base layer. The base reset then
overrides utilities, removing padding, margins, and borders.

In a Space without Tailwind, import `@simpleplatform/ui-kit/theme.css` in the
Space's own stylesheet and import that stylesheet once from the entry point.
A plain import supplies the Geist and Geist Mono font files, the `:root`
platform theme tokens and `.dark` color overrides, the responsive `.container`
width rules, and the Lucide icon sizing rules. These are ordinary CSS and work
without Tailwind; the browser ignores the `@theme` block, so a plain import does
not generate Tailwind utilities or provide its theme aliases. The kit's
stylesheet does not bundle Tailwind or its base reset.

The fonts are bundled with the Space so they load inside its cross-origin
iframe. `StatusBadge` uses the shared platform tokens for its light and dark
colors and dimensions. Its neutral tone uses `--simple-color-surface-sunken`
for the background, `--simple-color-border-default` for the border, and
`--simple-color-text-secondary` for the text; these tokens contain complete
CSS color values, not bare HSL triplets. The other tones use the corresponding
`--simple-color-status-info*`, `--simple-color-status-success*`,
`--simple-color-status-warning*`, and `--simple-color-status-danger*` tokens.
A Space may override the `--simple-*` tokens in its own CSS after the imports,
including `--simple-font-family-sans` for the font stack. These tokens are shared
with other UI that uses the platform theme; they are not component-local
`--simple-status-badge-*` variables.

### Runtime boundary

The Simple host supplies the exact UI Runtime to the managed component bridge
during the Space handshake. `RecordForm`, `RecordActivity`, and the managed
database-backed views load it automatically; the runtime loader and URL are
private implementation details, not supported Space APIs.
Space authors should never choose or hard-code a runtime URL.

`RecordForm` and `RecordActivity` use a bridge on SDK-created record handles.
Managed views take the SDK client, a table source, and a validated preset. The
public adapter entry point is `@simpleplatform/ui-kit/react`; runtime elements
and bridge metadata remain private.

### Framework support

Managed `RecordForm`, `RecordActivity`, and record-view components are currently
available only from `@simpleplatform/ui-kit/react`. Simple's renderer itself runs
inside the Space iframe, so React is not an architectural requirement for customer
Spaces; no public framework-neutral managed form, activity, or view element has
shipped. Private runtime elements are not supported HTML APIs.

`StatusBadge` has a public Web Component entry. Non-React Spaces can use
`@simpleplatform/sdk/space` to build their own record and view controls with the
authorized SDK APIs. The private managed UI runtime elements are not a supported
cross-framework contract.

## RecordForm

`RecordForm` is the default choice for a Record Space that wants the complete
Simple record experience without rebuilding it.

Load the stylesheet as described in [Loading the stylesheet](#loading-the-stylesheet)
before using this example.

```tsx
import type { RecordHandle } from '@simpleplatform/sdk/space'
import { connect } from '@simpleplatform/sdk/space'
import { RecordForm } from '@simpleplatform/ui-kit/react'
import { useEffect, useState } from 'react'

const client = connect({ targetOrigin: new URL(document.referrer).origin })

export function App() {
  const [record, setRecord] = useState<RecordHandle | null>(null)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let active = true
    void client
      .then(simple => simple.records.current())
      .then((value) => {
        if (active)
          setRecord(value)
      })
      .catch((reason: unknown) => {
        if (active)
          setError(reason instanceof Error ? reason : new Error('Could not load the record.'))
      })

    return () => {
      active = false
    }
  }, [])

  if (error)
    return <p role="alert">{error.message}</p>

  if (!record) {
    return <p>Loading record…</p>
  }

  return <RecordForm record={record} />
}
```

The component mounts the same private React form renderer and field editors
used by Simple's standard record page inside the Space iframe. It includes:

- field layout, labels, help text, and required/read-only/visibility behavior;
- Record Behavior feedback and server validation messages;
- the platform's supported primitive and specialized field workflows,
  including references, documents, secrets, enums, date/time, and JSON; and
- accessible labels, validation messages, and pending states.

The form also refreshes when the same `record` handle completes an
`update()` or `submit()` command elsewhere in the Space, including from a
`simple.ui.header` action. Live server subscriptions are still deferred; the
form renders its initial snapshot and snapshots produced by commands.

The platform remains the source of truth. `RecordForm` does not execute Record
Behaviors or persist records directly; it renders the managed record session
and calls the existing record commands. It accepts both the route-owned handle
from `simple.records.current()` and an opened handle from `simple.records.open()`.
An opened record session stays available until the Space connection ends, even
if its `RecordForm` is unmounted earlier. Simple's field implementations are
not published as customer extension points. The browser runtime is
inspectable, however; authorization and privileged operations must always be
enforced by the host/server, not by keeping client implementation hidden.

The private stylesheet and Radix overlays are contained inside the managed
form's Shadow DOM; the Space's theme custom properties can still inherit. The
platform and Space use the same field renderer through different adapters.

This integration is pre-release. Automated tests cover the private renderer,
field workflows, and bridge, but release still requires a deployed browser
comparison with the standard form and explicit approval. Do not treat this
documentation as confirmation of browser parity.

### What RecordForm does not expose

`RecordForm` is not a schema-driven form framework. The following stay inside
Simple and are not supported extension APIs:

- form schema and field metadata transport;
- field editor registry or per-field renderer replacement;
- RecordForm's document attachment/promotion lifecycle, reference search,
  secret decryption, and JSON-editor internals. Document upload and promotion
  are handled by the managed form's private host adapter. Customer-owned
  uploads can use the separate public `simple.documents.stage({ file })` API;
  staging does not attach the file to a record.
- Record Behavior scheduling and host session events.

This boundary lets Simple improve complex field workflows without requiring
customer Spaces to track internal form contracts.

## RecordActivity

`RecordActivity` is the managed component for displaying the platform activity
stream (audit log changes and notes) for a record handle.

Load the stylesheet as described in [Loading the stylesheet](#loading-the-stylesheet)
before using this example.

```tsx
import type { RecordHandle } from '@simpleplatform/sdk/space'
import { connect } from '@simpleplatform/sdk/space'
import { RecordActivity } from '@simpleplatform/ui-kit/react'
import { useEffect, useState } from 'react'

const client = connect({ targetOrigin: new URL(document.referrer).origin })

export function ActivityView() {
  const [record, setRecord] = useState<RecordHandle | null>(null)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let active = true
    void client
      .then(simple => simple.records.current())
      .then((value) => {
        if (active)
          setRecord(value)
      })
      .catch((reason: unknown) => {
        if (active)
          setError(reason instanceof Error ? reason : new Error('Could not load the record.'))
      })

    return () => {
      active = false
    }
  }, [])

  if (error)
    return <p role="alert">{error.message}</p>

  if (!record) {
    return <p>Loading record…</p>
  }

  return <RecordActivity record={record} />
}
```

| Prop     | Type           | Required | Purpose                                                                     |
| -------- | -------------- | -------- | --------------------------------------------------------------------------- |
| `record` | `RecordHandle` | Yes      | A record handle from `simple.records.current()` or `simple.records.open()`. |

### Supported context and behavior

`RecordActivity` accepts the route record in a Record Space or an opened record
in a Record or standalone Space. The private record UI bridge supplies the target
application ID, table ID, record ID, and fields. When rendered without this
bridge or required identity metadata, it renders an accessible error alert with
a retry action. Metadata refreshes update the mounted activity element in place
so a note draft and the feed's pagination state are preserved.

The managed activity stream provides:

- **Audit changes**: Detailed change history for record fields, formatted with
  field display names and human-readable diffs.
- **Notes**: Chronological view of collaborator notes with author information
  and timestamps, plus note composer functionality to submit new notes.
- **Show more pagination**: Incremental loading of older audit events and notes
  as users request more history.
- **Loading and failures**: The activity panel shows skeleton rows while its
  initial queries load. Runtime setup errors render an accessible alert with a
  "Try again" action. Activity query failures show the panel's inline error
  message; that state currently has no separate retry control.

### Runtime boundary

Like `RecordForm`, `RecordActivity` mounts the canonical `<simple-record-activity>`
Web Component from the host-supplied Simple UI Runtime inside the Space iframe.
It receives `applicationId`, `tableId`, `recordId`, `fields`, `graphql`, and the
existing optional decrypt capability from the private record UI bridge. The
runtime descriptor, loader, and underlying GraphQL operations are
private implementation details and not customer extension points. This integration
remains pre-release; local browser parity has been verified in the fixture.

## Managed database-backed views

Managed views render authorized records from a table through the existing host
bridge. They accept configuration rather than row arrays, GraphQL documents, or
render callbacks. The platform validates preset fields against the current
readable schema and keeps authorization, filtering, ordering, paging, and field
formatting in its existing record path.

The package exports `ListView`, `DataGrid`, and `Board` from
`@simpleplatform/ui-kit/react`. Their contracts are exported from
`@simpleplatform/ui-kit/contracts`.

`ListView` uses the same tile preset for grid cards in a wide container and
continuous rows in a narrow container. The layout follows the component's
container width, including when it sits in a narrow Space on a wide screen.

Inbox remains a platform Custom View preset and renderer. Spaces do not expose
an `InboxView`; they can use List, DataGrid, and Board while platform routes
continue to use Inbox.

List, DataGrid, and Board provide their platform-owned filter controls.
Standalone `ConditionBuilder` and `ConditionSummary` components are not public
Space APIs yet.

### Maintaining the shared contract fixtures

`test/fixtures/record-view-contract-v1.json` in this package is the authority;
the platform keeps a tracked mirror so each repo can run its tests independently.
Edit the authority, then run these commands from the SDK repo with both checkouts available:

```sh
node scripts/sync-record-view-contract.mjs ../simple
node scripts/sync-record-view-contract.mjs ../simple --check
```

Commit both copies together. The corpus covers legacy Board page-size normalization
and current Show more with numeric summaries.

Public TypeScript names omit a version suffix. The saved `views` preset-set
envelope, filter expressions, and tile layouts retain their `version: 1` fields.

```tsx
import type { SimpleClient } from '@simpleplatform/sdk/space'
import type {
  FilterExpression,
  ListPreset,
  TableRecordSource,
  ViewItemReference,
} from '@simpleplatform/ui-kit/contracts'
import { ListView } from '@simpleplatform/ui-kit/react'
import { useState } from 'react'

const source: TableRecordSource = {
  appId: 'com.example.crm',
  kind: 'table',
  tableId: 'TBL000123',
}

const preset: ListPreset = {
  config: {
    tile: {
      presentation: 'row',
      subtitleFieldName: 'status',
      titleFieldName: 'title',
      version: 1,
    },
  },
  id: 'open-tickets',
  kind: 'list',
  title: 'Open tickets',
}

export function TicketList({ client, openTicket }: {
  client: SimpleClient
  openTicket: (reference: ViewItemReference) => void
}) {
  const [filter, setFilter] = useState<FilterExpression | undefined>(preset.filter)

  return (
    <ListView
      client={client}
      source={source}
      preset={preset}
      filter={filter}
      onFilterChange={setFilter}
      onItemOpen={openTicket}
    />
  )
}
```

Import `ViewItemReference` from `@simpleplatform/ui-kit/contracts` for the
callback type in this example. The source is `{ kind: 'table', appId, tableId }`;
`tableId` is the platform table metadata record ID, not the logical SCL table
name. The platform resolves it and verifies app ownership before using its
existing record hooks. Presets are versioned and discriminated as `list`, `table`,
`board`, or `inbox`; Inbox is platform-only. Fields use logical SCL names. `onItemOpen` receives only
`{ kind: 'record', appId, tableName, recordId }`. Navigation and record actions
stay with the Space. Controlled views pass both `filter` and
`onFilterChange`; otherwise the preset's filter initializes view state.

The view's built-in filter controls share the versioned `FilterExpression`
with saved preset filters. A Space may control that view state with `filter`
and `onFilterChange`; filter-builder components remain platform-owned. Preset
icons are derived from `kind`. Tile visuals use provider-qualified IDs from
`RECORD_VIEW_ICON_IDS`, such as `lucide:star`.
QuickFilterBar is excluded from the first phase.
`DataGrid` mounts the existing platform TanStack GenericTable, including its
column configuration, sorting/resizing/pinning, cell menus, filter dialog,
refresh, page export and pager. Narrow containers use platform tiles with the
same fetched rows and sorting state. With no tile configured, the first visible
selected column becomes the labeled title and every other selected column is
shown as a labeled value. A configured tile emphasizes its bound fields and
appends the remaining visible columns once. Filter changes preserve user sort;
changed sort defaults apply intentionally. `onItemOpen` handles record and reference
opens; omitting it makes navigation unavailable. Route-only New/custom actions
are supplied by the platform route host.

Configured email tiles also retain the remaining selected DataGrid columns as
labeled values. Ordinary List/Inbox email tiles keep their sender/date,
subject, and preview layout.

Simple and advanced filters reject numeric input that JavaScript cannot
represent without changing its value; invalid text stays visible for correction.
JSON key operands remain strings, including keys such as `"123"` or `"true"`.
Nested AND/OR groups and multi-value operands retain their complete meaning
when opening the advanced editor or adding a simple field filter.

`Board` may call `onMoveRequest`; it does not persist a move by itself.
Use `client.records.open()`, check `update()` and `submit()` results, and reject
the callback when the managed workflow fails. Lanes must use an enum field.
Narrow boards load cards only for the selected lane and keep each lane's Show
more limit when switching. Lane totals are queried independently for all lanes,
even when no numeric summaries are configured. Pending totals show a loading
indicator; failed totals show unavailable rather than zero. At narrow widths
the Board uses horizontally scrollable lane tabs, a full-width vertical record
stack, and a per-card **Move** action listing every destination lane. Wider
boards retain multi-lane drag-and-drop. Configure the per-lane batch with
`lanePageSize`; it defaults to 50, matching List and DataGrid. Optional `summaries` display up to
three database-backed numeric aggregates over all matching authorized records
in each lane after its preset and active filters, using `sum`, `average`,
`min`, or `max`. The platform validates summary fields against the table
schema. Set preset `orderBy` to sort cards within each lane by up to five fields;
`laneOrder` controls the lane order.

```ts
import type { BoardPreset } from '@simpleplatform/ui-kit/contracts'

const boardPreset: BoardPreset = {
  config: {
    laneFieldName: 'stage',
    lanePageSize: 50,
    summaries: [
      { fieldName: 'amount', operation: 'sum' },
      { fieldName: 'amount', operation: 'average' },
    ],
    tile: { presentation: 'row', titleFieldName: 'name', version: 1 },
  },
  id: 'opportunities',
  kind: 'board',
  orderBy: [{ direction: 'desc', fieldName: 'amount' }],
  title: 'Opportunities',
}
```

Preset selectors on the platform and fixture show the family icon beside the
title. On a platform Custom View route, the most recently selected preset is
stored in local browser preferences per application and Custom View. An
explicit `?preset=<id>` URL selection takes precedence; if a remembered preset
was removed, the platform uses `defaultPresetId`. A Space receives an explicit
`preset` prop and owns preset selection state.

Space tiles use the same `RecordTileLayout` in List/Table/Board `config.tile`.
The platform Inbox uses `config.listTile`. Its `detail` defaults to `fields`,
which requires `detailFieldNames`; `detail: 'record'` renders the platform
RecordPage and does not accept `detailFieldNames`. The compositions are `row`,
`person`, `media`, `editorial`, `email`, `status`, and `spotlight`. Email uses `titleFieldName` for
the subject, `eyebrowFieldName` for the sender, `subtitleFieldName` for a
two-line plain-text preview, and `trailingFieldName` for the received date/time.
The platform Inbox displays sender and relative date together above the subject.
List/Inbox email tiles omit generic badges, detail fields, and icons; DataGrid
retains selected fields as labeled values. Bind
title/subtitle/eyebrow/trailing, badge/detail fields, a safe catalog icon, an
enum icon map, or an authorized document image. Values stay inline and safe inside the parent open action;
references request only the target ID/display field and fall back to the ID
when unavailable. Arbitrary HTML/CSS, image URLs, row arrays and render callbacks
are not supported.

`InboxPreset` describes platform Custom View configuration only. The
Space UI Kit does not export an Inbox renderer.

The Space collection components do not expose an imperative ref. Space code
owns source, preset, and navigation state; managed List, DataGrid, and Board do
not host an editable record-detail session.

Public components take an explicit preset. To reuse a saved Custom View, load
its active List-type record with the existing SDK query, verify target table,
call `validateViewPresetSet(customization.views)`, and choose a List, Table, or
Board preset. Skip platform-only Inbox presets. Initialize controlled filters from `selected.filter` when
desired; controlled `filter={undefined}` deliberately means unfiltered. The
fixture uses this approach rather than separate hardcoded presets.

Contract bounds are 20 presets, 80-character IDs, 120-character titles, 200-character
unpadded field names, 40 fields per column/detail/badge array, 5 sort fields,
80–800px column widths, and 20 total Board lanes with batches of at most 50
records per lane. Enum icon maps allow 100 unpadded nonempty values of at most 200
characters and only exported catalog icons. Portable SDK and schema-aware
platform validators remain separate and run matching versioned conformance
fixtures. Container width selects the responsive DataGrid presentation; it is
not configurable in the preset.

The `dev.simple.ui_fixtures` Space API Demo includes a database-backed tile
playground: saved presets, Apply/Reset tile JSON, List/Table/Board previews,
phone/full widths, simple/advanced filters, and generated component code. Its
14 scenario families are seeded database records; preview JSON supplies layout
only. Final deployed visual/device acceptance for these additions is tracked
separately from passing unit/package checks.

See `simple/architecture_history/space-views.md` for the current platform
contract, implementation status, verification, and release gates. Future view
API designs are in `simple/architecture_history/space-view-roadmap.md`.
This API is pre-release.

## Build a custom form instead

Use the Space SDK when a managed form is not the right presentation. You own
the markup, controls, and local UI state; the platform still owns behavior
execution, validation, authorization, and persistence.

```ts
const record = await simple.records.current()

await record.update({ status: 'active' })

const result = await record.submit()
if (!result.ok) {
  const snapshot = record.snapshot()
  console.log(snapshot.formInfo)
  console.log(snapshot.errors.form)
  console.log(snapshot.errors.fields)
}
```

Use `record.update()` and `record.submit()` for the route record. Do not use
`simple.data.mutate()` to bypass its record workflow.

## Customize the Record Space header

A Record Space can replace persisted System **View Actions** in the platform
header while it is mounted.

```ts
simple.ui.header.actions.set([
  {
    icon: 'phone',
    id: 'start-call',
    label: 'Start call',
    onClick: async () => {
      await startCall()
    },
    type: 'primary',
  },
])
```

`actions.set()` accepts actions in display order. Each action has:

```ts
interface HeaderAction {
  id: string
  label: string
  icon?: string
  type?: 'primary' | 'secondary' | 'outline' | 'destructive'
  disabled?: boolean
  loading?: boolean
  onClick: () => void | Promise<void>
}
```

The platform renders the buttons; the callback remains inside the Space. A
promise-returning callback automatically shows loading and disables that
button until it settles. Use `loading` and `disabled` when the action reflects
work that started outside the click handler.

```tsx
useEffect(() => {
  simple.ui.header.actions.set([
    {
      disabled: syncing,
      id: 'sync',
      label: syncing ? 'Syncing…' : 'Sync now',
      loading: syncing,
      onClick: syncNow,
      type: 'secondary',
    },
  ])
}, [simple, syncing])
```

Calling `actions.set([])` intentionally renders no main actions. While a custom
Record Space is active, `actions.set()` completely replaces the platform
`Update` button and persisted View Actions; the platform does not guess whether
your Space contains a form. The default actions return when the Space iframe
unloads or the user selects the standard view.
There is no `clearActions()` API.

The override does not take over platform-owned overflow controls such as
Delete, view recovery, or navigation. If a Space needs a save workflow, expose
it explicitly and call the record-level `record.submit()` command:

```ts
simple.ui.header.actions.set([
  {
    id: 'save-and-start-call',
    label: 'Save and start call',
    onClick: async () => {
      const result = await record.submit()
      if (!result.ok) {
        simple.ui.toast.show({
          description: 'Correct the validation messages in the form before saving again.',
          title: 'Validation Error',
          variant: 'destructive',
        })
        return
      }

      simple.ui.toast.show({
        description: 'The record was updated successfully.',
        title: 'Record updated',
      })
      await startCall()
    },
    type: 'primary',
  },
])
```

Expected record validation failures return `{ ok: false }`; they are rendered
by `RecordForm` or available from `record.snapshot()`. Unexpected rejected
header callbacks are reported to the developer console only; there is no
automatic toast, modal, or button error presentation. Catch failures and call
`simple.ui.toast.show()` when the Space should provide user-facing feedback.
`record.submit()` stays headless, and inline field/form messages remain the
source of detailed validation guidance.

## Record Space tabs

A Record Space can declare tabs in the platform header:

```tsx
import { useEffect, useState } from 'react'

export function MyRecordSpace({ simple }) {
  const [activeTab, setActiveTab] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    simple.ui.tabs.set({
      onChange: (tabId) => {
        if (mounted)
          setActiveTab(tabId)
      },
      tabs: [
        { default: true, icon: 'layout-dashboard', id: 'overview', title: 'Overview' },
        { badge: 2, icon: 'history', id: 'timeline', title: 'Timeline' },
        { badge: 'Beta', icon: 'settings', id: 'settings', title: 'Settings' },
      ],
    }).then(({ selectedTabId }) => {
      if (mounted)
        setActiveTab(selectedTabId)
    })

    return () => {
      mounted = false
    }
  }, [simple])

  return <div>{activeTab === 'overview' ? <OverviewView /> : <OtherView />}</div>
}
```

Tabs declaration accepts up to 32 tabs and requires an `onChange` callback. An
empty declaration clears the current tab strip and returns `selectedTabId: null`.
Each tab requires an `id` (matching `^[a-z0-9][a-z0-9_-]{0,63}$`) and a non-blank `title`
(up to 80 characters), and accepts optional `default: true`, kebab-case Lucide
`icon`, and a string (up to 20 characters) or finite non-negative integer `badge`.
If no tab sets `default: true`, the first tab defaults to active.

Programmatic selection uses `simple.ui.tabs.select(tabId)`, which resolves only
after host acknowledgement:

```ts
await simple.ui.tabs.select('timeline')
```

Selection and URL routing remain host-owned. Host selection events use
`SPACE_UI_TABS_SELECTION_CHANGED` correlated by `registrationRequestId` and trigger
the iframe-local `onChange` callback. Calling `select()` with the currently active
tab resolves immediately without wire traffic; selecting an inactive tab reaches
the `onChange` callback once, deduplicating the response and event.

## Multiple records

`simple.records.current()` returns the route-owned primary record;
`simple.records.open({ appId, tableName, recordId })` opens an independently
authorized session for another record. Opened sessions live until the Space
connection ends. Each handle submits independently; the SDK does not provide an
atomic multi-record transaction or infer save order from the forms on screen.
A header action never silently submits every visible form.

For all-or-nothing multi-record workflows, use a server-side transactional
Action when that capability is available; sequential browser submits cannot
provide a transaction.

## Development

```bash
pnpm --filter @simpleplatform/ui-kit typecheck
pnpm --filter @simpleplatform/ui-kit test
```

Every component release requires a public-contract test, accessibility
coverage, a packed-package consumer test, and a deployed SDK-built Space
fixture.
