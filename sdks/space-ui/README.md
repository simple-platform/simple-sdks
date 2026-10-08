# Simple UI Kit

`@simpleplatform/ui-kit` provides supported, consistent UI for Simple Spaces.
It is deliberately small: use a managed component when Simple owns the
workflow; use the Space SDK directly when you need to own the UI yourself.

## Status

This package is in alpha. `StatusBadge` is the current simple component.
Managed `RecordForm` and `RecordActivity` are pre-release interfaces and still require deployed
browser-parity approval. Record-header actions are exposed by the companion
Space SDK as `simple.ui.header`; they are not a UI Kit export.
Do not treat alpha APIs as a stable compatibility promise until they are
released with an explicit support policy.

## Current component: StatusBadge

```tsx
import { StatusBadge } from '@simpleplatform/ui-kit/react'
import '@simpleplatform/ui-kit/theme.css'

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
entry once before using its tag in HTML:

```ts
import '@simpleplatform/ui-kit/elements'
import '@simpleplatform/ui-kit/theme.css'
```

```html
<simple-status-badge label="Ready" tone="success"></simple-status-badge>
```

Import `theme.css` in the Space entry point. It bundles the Geist font files
with the Space (so they load inside its cross-origin iframe) and provides
`StatusBadge` defaults that use the platform's own light and dark colors and
dimensions. The neutral tone follows the Space's `--secondary`, `--border`, and
`--secondary-foreground` tokens when defined (as HSL triplets, the platform's
convention), with fallback colors otherwise. A Space may override any
`--simple-status-badge-*` variable in its own CSS, and may override the default
font stack as well. These names stay component-local: the platform-wide semantic
CSS-variable contract is a separate project.

### Runtime boundary

The Simple host supplies the exact UI Runtime to the managed component bridge
during the Space handshake. `<RecordForm />` and `<RecordActivity />` load it automatically; the runtime
loader and URL are private implementation details, not supported Space APIs.
Space authors should never choose or hard-code a runtime URL.

The UI Kit reads host metadata and authorized callbacks from SDK-created record
handles through a versioned symbol. Space authors use the `RecordForm` and
`RecordActivity` components; there is no managed UI adapter package entry point.

### Framework support

The managed `RecordForm` and `RecordActivity` exports are currently available only from
`@simpleplatform/ui-kit/react`. Simple's renderer itself runs inside the Space
iframe, so React is not an architectural requirement for customer Spaces; the
current limitation is that a public framework-neutral form or activity element has not
been shipped. The private runtime elements are not supported HTML APIs.

The intended direction is to expose a public element from
`@simpleplatform/ui-kit/elements` and make the React component a thin adapter
over it. Vue, Svelte, or plain JavaScript could then pass a `RecordHandle` as an
element property and use the same managed form. Until that element has a
documented lifecycle, property, error, loading, and cleanup contract, non-React
Spaces can use `@simpleplatform/sdk/space` to build custom controls with
`simple.records.current()` or `simple.records.open()`. The managed `RecordForm`
itself remains available only through the React entry point.

## RecordForm

`RecordForm` is the default choice for a Record Space that wants the complete
Simple record experience without rebuilding it.

```tsx
import type { RecordHandle } from '@simpleplatform/sdk/space'
import { connect } from '@simpleplatform/sdk/space'
import { RecordForm } from '@simpleplatform/ui-kit/react'
import { useEffect, useState } from 'react'
import '@simpleplatform/ui-kit/theme.css'

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
  are handled by the managed form's private host adapter; a standalone file
  staging API is not currently exposed to Spaces.
- Record Behavior scheduling and host session events.

This boundary lets Simple improve complex field workflows without requiring
customer Spaces to track internal form contracts.

## RecordActivity

`RecordActivity` is the managed component for displaying the platform activity
stream (audit log changes and notes) for a record handle.

```tsx
import type { RecordHandle } from '@simpleplatform/sdk/space'
import { connect } from '@simpleplatform/sdk/space'
import { RecordActivity } from '@simpleplatform/ui-kit/react'
import { useEffect, useState } from 'react'
import '@simpleplatform/ui-kit/theme.css'

const client = connect({ targetOrigin: new URL(document.referrer).origin })

export function ActivityView() {
  const [record, setRecord] = useState<RecordHandle | null>(null)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let active = true
    void client
      .then(simple => simple.record())
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

| Prop     | Type           | Required | Purpose                                                            |
| -------- | -------------- | -------- | ------------------------------------------------------------------ |
| `record` | `RecordHandle` | Yes      | A record handle from `simple.record()` or `simple.records.open()`. |

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
is pre-release and subject to deployed browser-parity approval.

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

The first release supports the route-owned primary record only. A future
secondary-record API will let a Space explicitly define a multi-record save
plan. `RecordForm` does not infer a save order from the forms on screen, and a
header action never silently submits every visible form.

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
