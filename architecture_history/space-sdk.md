# Embedded Space SDK Architecture

- **Status:** The foundation SDK, managed React `RecordForm`, Record-Space header actions and tabs, platform-toast request, command-driven snapshot refresh, behavior-feedback fixture, action runs, and standalone document staging are implemented in the workspace. Fixture `0.0.2-local.31` is deployed and browser-verified. `connect()` suppresses vertical edge bounce at the embedded Space document root while preserving normal scrolling; SDK tests and desktop/mobile CDP checks pass. `connect({ targetOrigin })` is the sole browser bootstrap. `simple.tasks.create()` / `simple.tasks.reply()` depend on host task-protocol negotiation. The public SDK exposes only the opaque form bridge; renderer, field registry, behavior scheduler, and managed-form host capabilities remain private.
- **Last updated:** 2026-10-02
- **Scope:** The browser-safe, framework-neutral SDK surface used by embedded Simple Spaces, its managed React UI entry point, and its future portal-compatible transport boundary.
- **Out of scope:** Public form schemas/editor registries, host record runtime internals, record-page layout, Space selection, customer-Space migration, and public-portal server implementation.

## Context

Simple has one published TypeScript SDK, `@simpleplatform/sdk`. Its package root is the Action/WASM API, while embedded Spaces need browser-safe APIs for accessing platform capabilities. Earlier Spaces copied a local MessagePort GraphQL client into each Space. That made fixes, error semantics, and migrations expensive, and it provided no behavior-aware record workflow.

The SDK must give a Space author simple, recognizable nouns without exposing host React state, auth tokens, Record Behavior source, or raw record-session internals. It also needs to remain usable by React, Vue, Svelte, and plain browser JavaScript, and be portable to a future public portal transport.

## Goals

1. Publish one TypeScript package: `@simpleplatform/sdk`.
2. Keep Action/WASM and browser APIs in explicit, safe entry points.
3. Provide a small framework-neutral Space client with clear nouns and verbs: `connect({ targetOrigin })` and `simple.record()`.
4. Preserve the platform-owned record workflow for form records, including Record Behaviors, validation, documents, authorization enforcement, and submit state.
5. Retain flexible application data access through a single SDK contract rather than copied bridge code.
6. Use transport abstractions so an iframe MessagePort and a future portal-session transport can implement the same public contracts.
7. Version and test public contracts before broad production-Space migration.

## Non-goals

- Publishing a second package such as `@simple/sdk`.
- Making browser globals available from the Action/WASM package root.
- Providing subscriptions, live events, or public `dispose()` before there is a real event source.
- Treating GraphQL mutation as a replacement for behavior-aware record updates.
- Exposing host `RecordSession` instances, route internals, cookies, or credentials to a Space.
- Publishing `simple.records.open()` or `record.close()` in the foundation release.
- Publishing form schemas, field metadata, field renderer replacement, or Record Behavior timing as a supported UI extension API.
- Removing copied bridge support or modifying B&V Spaces without an approved migration plan.

## Engineering principles

### KISS

- Keep the Space surface to namespaces a concrete capability requires: `simple.record()`, `simple.data`, `simple.documents`, and `simple.tasks`.
- Use obvious method names: `connect`, `record`, `data.query`, `data.mutate`, `documents.stage`, `record.update`, `record.submit`, `tasks.create`, and `tasks.reply`.
- Use a single bootstrap name, `connect({ targetOrigin })`; do not retain a `connectSpace` alias. Avoid subscriptions, lifecycle methods, or generic record abstractions until a concrete capability requires them.

### DRY

- The SDK serializes one versioned protocol rather than recreating host record logic.
- Existing GraphQL MessagePort support is reused by `simple.data`; it is not reimplemented as a second bridge.
- Browser and direct-adapter tests exercise the same public Space client.

### High cohesion and low coupling

- `src/space/core.ts` owns public types, validation, immutable snapshots, and the transport-neutral client.
- `src/space/index.ts` is the browser Space entry point and re-exports the core API.
- The platform owns authorization, Record Behaviors, persistence, and session lifecycle.
- A Space owns presentation and its own local UI state.

## Current-state findings

- `@simpleplatform/sdk` already owns the published TypeScript package and Action/WASM API.
- The package root must stay Action/WASM-only because importing browser globals from Actions is unsafe and invalid in the runtime.
- The host iframe bridge already carries `GRAPHQL_REQUEST` and `GRAPHQL_RESPONSE` over a dedicated MessagePort with parent-side authorization.
- The record protocol is negotiated through the existing `SPACE_READY` / `INIT_RPC` handshake and currently exposes the route's primary record only.
- Each public protocol capability has its own key in that handshake. The Space offers `action`, `document`, `form`, `header`, `record`, `task`, and `toast`; the host grants document staging, tasks, toasts, and actions independently of record access, and grants record/form/header only when a primary record session exists (`apps/platform_web/components/space-iframe.tsx` in the platform repository).
- Before `action.run`, Spaces ran their own app's actions with a `fetch` of their own to `https://triggers.<parent host>/logic`. That needs the app to name a domain in its Space network permission, which the host turns into the iframe's CSP `connect-src` (`apps/platform_web/components/space-iframe.tsx`), so a Space broke on any other domain, and each Space resolved the endpoint itself. With `action.run`, the host makes the call on behalf of the Space without direct network requests.
- Managed RecordForm uploads use private `DOCUMENT_CREATE_HANDLE_REQUEST` host capabilities. Separately, `simple.documents.stage()` supports customer-owned upload workflows and returns an unattached staged handle. The host owns upload, promotion, deletion, and authorized preview while preserving Record Behavior access to managed-form file bytes.
- The Space client deliberately receives snapshots rather than host state stores. Snapshots are immutable and replaceable after each command response.
- A managed form may receive a private command-notification from its record handle when `update()` or `submit()` replaces the snapshot. This is a one-handle UI synchronization seam, not a public live subscription API; server/live events remain deferred.
- Production B&V Spaces still use copied GraphQL bridge clients, plus in some cases identity, navigation, decryption, and theme helpers. They are not yet migrated.
- `connect({ targetOrigin })` establishes the general Space transport even when the host does not negotiate record protocol v1. `simple.data` remains available in that environment; `simple.record()` rejects with a structured `unavailable` error only when invoked.
- Space documents load from the platform assets origin and are cross-origin to the host. The host's `<iframe>` styles cannot change the embedded root viewport's overscroll behavior; `connect()` applies that browser behavior inside the Space document.
- The host explicitly supplies a `SpaceContext` during `INIT_RPC`: currently `standalone` or `record`. The SDK rejects a missing or malformed context rather than deriving page state from browser data. List context is deferred until a custom list body exists.

## Target architecture

```text
@simpleplatform/sdk
├── package root                 Action/WASM API only
├── /space                      framework-neutral Space client
│   ├── simple.record()          behavior-aware primary form record
│   ├── simple.data              flexible authorized application data
│   ├── simple.documents         standalone staged document uploads
│   ├── simple.tasks             tasks created from a task type, and replies
│   ├── simple.actions           the Space's own app's actions, run by the host
│   ├── simple.ui.header.actions.set()  record-space header action delegation
│   ├── simple.ui.tabs.set/select()     record-space tabs and navigation
│   └── simple.ui.toast.show()          platform-owned toast presentation
└── /space                      iframe MessagePort bootstrap, adapter, and core API

Embedded Space
└── BrowserSpaceTransport
    ├── SPACE_PROTOCOL_REQUEST / RESPONSE  -> host RecordSession, document, task, and action commands
    ├── GRAPHQL_REQUEST / RESPONSE          -> host-authorized GraphQL bridge
    ├── SPACE_HEADER_ACTIONS_SET / INVOKE   -> platform-owned header actions
    ├── SPACE_UI_TABS_SELECTION_CHANGED     -> host-owned record tab selection
    └── SPACE_TOAST_SHOW                    -> platform-owned toast presenter

Future public portal
└── PortalSessionTransport
    └── same /space public client, server-issued capability scope
```

The browser adapter multiplexes protocol operations, GraphQL, header actions, and platform-toast requests over one dedicated `MessagePort`. It does not make the public record API dependent on the iframe protocol; another adapter can satisfy the same transport interfaces later.

`@simpleplatform/ui-kit/react` is an optional React presentation layer. Its
managed `RecordForm` uses a private host/UI-Kit transport when rendered inside a
Record Space. The first-party platform body consumes the same canonical form
implementation directly, rather than maintaining a Space-only renderer.

An embedded Space does not need a record route to use the SDK. Record protocol negotiation is an optional capability of the general browser transport.

The connection also exposes the host-supplied context:

```ts
type SpaceContext
  = | { kind: 'standalone' }
    | {
      kind: 'record'
      applicationId: string
      tableName: string
      recordId: string
    }
```

There is intentionally no inferred or `unknown` context variant. Context is descriptive page information, while `record()` remains the route-owned primary session with the shared behavior, validation, error, dirty-state, and header lifecycle.

## Ownership and security boundaries

| Owner         | Responsibility                                                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SDK           | Public types, request construction, response validation, snapshot immutability, structured client errors, and browser MessagePort adaptation.                      |
| UI Kit        | Supported managed presentation and header-action declarations; no form schema, editor registry, or workflow extension contract.                                    |
| Platform host | Handshake/origin checks, capability negotiation, record-session lookup, permission enforcement, Record Behavior execution, persistence, and GraphQL authorization. |
| Server        | Tenant, record, field, action, and data authorization; authoritative data validation and mutation enforcement.                                                     |
| Space author  | Rendering snapshots and errors, choosing permitted application-data operations, and calling record commands for record workflow writes.                            |

No presentation capability is an authorization boundary. The host and server validate every command and GraphQL operation.

## Public primitives and contracts

### Imports

```ts
import type { RecordHandle, RecordSnapshot } from '@simpleplatform/sdk/space'
import { connect } from '@simpleplatform/sdk/space'
```

### Connection and primary record

```ts
const simple = await connect({ targetOrigin })
const record = await simple.record()

await record.update({ first_name: 'Ada' })
const result = await record.submit()
const snapshot = record.snapshot()
```

`record.update()` stages completed field values and returns the host's new snapshot. `record.submit()` runs the canonical platform workflow and returns `{ ok, snapshot }`; expected validation failures are results rather than bypassable client state.

In the embedded Space document, `connect()` sets the root element's
`overscroll-behavior-y` to `none`. This suppresses vertical edge bounce at the
document boundary while leaving normal page and nested-element scrolling
available. No host protocol or public option is needed because only code inside
the cross-origin Space document can control its root viewport.

### Managed React record form — implemented locally

```tsx
import { RecordForm } from '@simpleplatform/ui-kit/react'

<RecordForm record={record} />
```

`RecordForm` renders the complete Simple form as-is. It is the supported path
for reusing complex form UI in a Record Space. It intentionally does not expose
form schemas, field metadata, editor replacement, document/reference/secret
workflows, or Record Behavior scheduling. Developers who need custom controls
continue to use the record commands above.

The first-party platform uses the same private form shell through an internal
adapter. Its rich field editors remain platform-owned and are projected into
the shell; this does not add a public renderer or editor-registry API.

### Record-Space header actions — implemented, pending reviewed release

```ts
simple.ui.header.actions.set([
  {
    icon: 'phone',
    id: 'start-call',
    label: 'Start call',
    onClick: async () => startCall(),
    type: 'primary',
  },
])
```

`actions.set()` replaces active System View Actions for the mounted Record
Space. It accepts actions in display order; callback promises automatically
drive platform-rendered button loading. `actions.set([])` intentionally shows no
Space actions, and iframe teardown restores the persisted View Actions. The
platform retains Delete, recovery, navigation, and other overflow controls.

There is no separate header submit protocol: a callback calls `record.submit()`
when it needs to submit the route record.

### Platform toast notifications — implemented locally

```ts
simple.ui.toast.show({
  description: 'Your changes are ready.',
  title: 'Saved',
  variant: 'default', // optional; 'default' or 'destructive'
})
```

This capability is available to standalone and record Spaces, independently of
record access. The SDK sends only plain text and a supported variant through
the negotiated `toast` protocol; title and description are limited to 160 and
1,000 characters. The platform validates the message and invokes its existing
toast presenter. Toast rendering, theme, React content, and action callbacks
remain platform-owned.

### Record-Space tabs — implemented

```ts
const { selectedTabId } = await simple.ui.tabs.set({
  onChange: (tabId) => {
    // iframe-local callback triggered when active tab changes
  },
  tabs: [
    { default: true, icon: 'layout-dashboard', id: 'overview', title: 'Overview' },
    { badge: 3, icon: 'message-square', id: 'messages', title: 'Messages' },
  ],
})

await simple.ui.tabs.select('messages')
```

The Space offers `protocols.tabs: [1]` in `SPACE_READY`. When the host confirms `protocols.tabs: 1` in `INIT_RPC` for a Record Space, the tabs bridge is enabled. In standalone context or when tabs capability is absent, `simple.ui.tabs.set` and `simple.ui.tabs.select` reject with `SpaceProtocolError` code `'unavailable'`.

Wire messages:

- Registration: versioned request `operation: 'ui.tabs.set'` carrying `payload: { tabs: WireTab[] }`. Wire tab format: `{ id: string, title: string, default?: true, icon?: string, badge?: string | number }`. The requestId acts as the registration identity (`registrationRequestId`). The host acknowledges with `SPACE_PROTOCOL_RESPONSE` containing `result: { selectedTabId: string | null }`. The `onChange` callback is required and is not invoked on the initial registration response.
- Selection: versioned request `operation: 'ui.tabs.select'` carrying `payload: { registrationRequestId: string, tabId: string }`. The host acknowledges with `SPACE_PROTOCOL_RESPONSE` containing `result: { selectedTabId: string }`. Programmatic selection reaches the `onChange` callback once after host acknowledgement/event, deduplicating the response and event. Calling `select()` with the already-active tab resolves immediately without sending a wire message.
- Host selection event: canonical type `SPACE_UI_TABS_SELECTION_CHANGED` carrying `{ registrationRequestId: string, selectedTabId: string }` delivered over the MessagePort. When received, the SDK routes the event to `onChange(tabId)` if `registrationRequestId` matches the active registration.
- Validation bounds: up to 32 tabs; an empty declaration clears the tab strip and returns `selectedTabId: null`. IDs match `^[a-z0-9][a-z0-9_-]{0,63}$`; titles are non-blank and at most 80 characters; text badges are non-blank and at most 20 characters; numeric badges are finite non-negative integers; icons are kebab-case Lucide icon names. Multiple defaults and duplicate IDs are rejected. If no tab specifies `default: true`, the first tab defaults to active.
- Bound and timeouts: Requests are bounded by `DEFAULT_TABS_TIMEOUT_MS = 10_000` (10 seconds), after which they reject with `timeout`.
- Superseded registrations: When `set()` begins, the pending registration identity and callback are installed immediately and events from older registrations are dropped. Only the latest acknowledged registration commits its selected state. Late responses from older sets are ignored. Callback errors are caught so transport delivery is never interrupted.

### Flexible application data

```ts
const users = await simple.data.query<{ users: Array<{ id: string }> }>(
  `query Users { users: dev_simple_system__users(limit: 10) { id } }`,
)

await simple.data.mutate(
  `mutation CreateNote($body: String!) { insert_demo__note(object: { body: $body }) { id } }`,
  { body: 'Follow up.' },
)
```

`simple.data` is a supported, first-class capability for separately authorized application data. A write to the record managed by a form must use `record.update()` and `record.submit()` so behavior, validation, documents, and shared header state remain intact.

### Tasks

```ts
const { task } = await simple.tasks.create({
  assignedToId: 'USR000005', // optional; defaults to the creator
  input: { packet: 'DOC000001' }, // JSON object typed by the task type
  taskTypeId: 'TTY000003',
  title: 'Review the contract packet',
})

const { messageId, taskRevision } = await simple.tasks.reply({
  content: 'Approved.',
  inReplyToMessageId: 'MSG000006', // optional
  taskId: task.id,
})
```

The wire operations are `task.create` (payload `{ title, taskTypeId, input, assignedToId? }`, result `{ task: { id, status, revision } }`) and `task.reply` (payload `{ taskId, content, inReplyToMessageId? }`, result `{ messageId, taskRevision }`). `status` is the platform task status: `queued`, `in_progress`, `waiting`, `completed`, `cancelled`, or `failed`.

The task contract agreed with the host and server:

- `input` is a JSON object (`JsonObject`), never `null`, an array, or a scalar. The SDK refuses anything else before sending, with `invalid_request`.
- `assignedToId` is optional. The host passes it to the task service as `assigned_to_id`, which assigns the task to that user; it must be an existing user in the tenant, or the create is refused with `TASK_ASSIGNEE_INVALID` (see _Task refusals_ below). Left out, the task is assigned to its creator.
- Typed input is limited to 32,768 encoded bytes and depth 64 (data-model §4.1, TASK-D27) for every input other than the Ally `{ request }` shape, which keeps its existing limit. A task type with no input schema (`null`, absent, `{}`, or `true`) skips schema validation, but the limits still apply. The server enforces these limits; the SDK does not duplicate them.
- A refusal from the task service reaches the Space as `SpaceProtocolError` code `task_rejected`, with the service's error unchanged in `details` (see _Task refusals_ below).
- A `task.reply` retry reuses the pending message the host retained for the same task and intent instead of posting twice.

#### Task refusals

When the task channel refuses a `task.create` or a `task.reply`, the host answers a `SPACE_PROTOCOL_RESPONSE` whose `error` is `{ code: 'task_rejected', message, details }`. `message` is the channel's message and `details` is the channel error exactly as the channel sent it: `{ code, category, message, pointers, details }`. The host adds, drops, and renames nothing, and neither does the SDK: `readResponse()` in `sdks/ts/src/space/core.ts` constructs `SpaceProtocolError` from the response's `error` as received, so `error.code` is `task_rejected` and the channel's reason is `error.details.code`. The host side is `respondTaskError()` in `apps/platform_web/lib/space-runtime/service-protocol-handler.ts` of the platform repository; the platform documents the same payload in `architecture_history/record-space.md` §6.5 there, and the channel contract in `apps/simple_ai/docs/contracts/task-channel-api.md` section 10 (decision D-304, amending D-131).

Every channel refusal arrives this way, whatever its code, and `details.category` says whether the Space may send the request again. A `validation` refusal is final: `createTask()` in `apps/platform_web/lib/tasks/task-client.ts` drops the create it had retained for a retry when `isDefinitive()` in `channel-commands.ts` classifies the code as definitive, so the Space must correct the request before sending it again. A `runtime` refusal (`TASK_RUNTIME_UNAVAILABLE`, `TASK_RUNTIME_TIMEOUT`, `TASK_RUNTIME_BUSY`, `TASK_RUNTIME_REMOTE_FAILURE`) says the task service did not answer, not that the request was wrong. The host keeps the pending create, so a `task.create` with the same arguments resends it under the same task id instead of creating a second task. A create's title, input, and assignee are refused with these `validation` codes:

| `details.code`          | When                                                                                  | `details.pointers`                                 | `details.details`                   |
| ----------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------- |
| `TASK_INPUT_INVALID`    | The input fails its task type's input schema                                          | Each issue's instance pointer under `/input`, once | `{ errors, truncated }`             |
| `TASK_INPUT_INVALID`    | The title is longer than 255 characters, or the input is nested deeper than 64 levels | `/title` or `/input`                               | `{}`                                |
| `TASK_INPUT_TOO_LARGE`  | The input encodes to more than 32,768 bytes                                           | `/input`                                           | `{ measured_bytes, allowed_bytes }` |
| `TASK_ASSIGNEE_INVALID` | `assignedToId` is not an existing user in the tenant                                  | `/assigned_to_id`                                  | `{}`                                |

- `errors` holds at most 50 issues sorted by instance pointer, and `truncated` is `true` when more existed. Each issue is exactly `{ code, instance_pointer, schema_pointer }` and never carries the value.
- `instance_pointer` is relative to the input; `pointers` carries the `/input` prefix. `schema_pointer` locates the schema object that holds the failed keyword, so a `required` issue sits at the object that lacks the member and does not name the member.
- Pointers name the members of the channel command, so the assignee is `/assigned_to_id`, not the SDK's `assignedToId`.

A task type whose input schema is `{ type: 'object', properties: { amount: { type: 'integer' } }, required: ['job_id'], additionalProperties: false }`, given the input `{ amount: 'seven hundred', note: 'a private note' }`, answers:

```json
{
  "type": "SPACE_PROTOCOL_RESPONSE",
  "response": {
    "ok": false,
    "protocol": 1,
    "requestId": "request-1",
    "error": {
      "code": "task_rejected",
      "message": "The task input is invalid.",
      "details": {
        "code": "TASK_INPUT_INVALID",
        "category": "validation",
        "message": "The task input is invalid.",
        "pointers": ["/input", "/input/amount", "/input/note"],
        "details": {
          "errors": [
            { "code": "required", "instance_pointer": "", "schema_pointer": "" },
            { "code": "type", "instance_pointer": "/amount", "schema_pointer": "/properties/amount" },
            { "code": "boolean_schema", "instance_pointer": "/note", "schema_pointer": "/additionalProperties" }
          ],
          "truncated": false
        }
      }
    }
  }
}
```

The input `{ notes }` holding 32,769 characters, which encodes to 32,781 bytes, answers `details` of `{ "code": "TASK_INPUT_TOO_LARGE", "category": "validation", "message": "The task input is too large. Shorten the request or split the work into more than one task.", "pointers": ["/input"], "details": { "measured_bytes": 32781, "allowed_bytes": 32768 } }`. An assignee who is not a user answers `details` of `{ "code": "TASK_ASSIGNEE_INVALID", "category": "validation", "message": "The task assignee is invalid.", "pointers": ["/assigned_to_id"], "details": {} }`.

`test/space-task.test.mjs` checks that each of these refusals, and a 50-issue refusal with `truncated: true`, reaches `SpaceProtocolError.details` deep-equal to what the host sent. `test/space-browser.test.mjs` sends the response above verbatim over a real `MessageChannel`.

### Actions

```ts
const result = await simple.actions.run<AttachResult>(
  'document-attach', // the name alone; the host adds the Space's own app
  { document_id: 'DOC000001' }, // any JSON value
  { timeoutMs: 120_000 }, // optional
)
```

The wire operation is `action.run`, with payload `{ action, input, timeoutMs? }` and result the action's JSON result, as returned. It is negotiated by its own `protocols.action` key.

The action contract agreed with the host:

- `action` is the action's name within the Space's own app, matching `/^[a-z0-9][a-z0-9-]*$/`, so it holds no `/`. The host binds the app id of the iframe's own app and runs `{ logic: "<app id>/<action>", payload: input }` through the platform's server-logic path with the user's session. The Space never names an app, so it can run only its own app's actions. The SDK refuses a name outside the pattern before sending, with `invalid_request`.
- `input` is any JSON value. The SDK refuses anything else, `undefined` included, with `invalid_request`.
- `timeoutMs` is optional. The host uses 60,000 when it is absent, accepts 1,000 to 1,200,000, refuses anything else with `invalid_request`, and aborts the server call at the timeout. The SDK checks only that it is a finite number, and sends it only when the caller gives one. It waits for the host's answer until 5,000 ms after the timeout (the default when none is given), then rejects with `timeout` and aborts the transport's wait, so a run whose answer never comes still ends and is not kept pending.
- The host answers `invalid_request`, `unsupported_protocol`, `unavailable` (it cannot run actions), `timeout` (it aborted at `timeoutMs`), `action_failed` (the server answered with a status other than 2xx or with an error result), or `network` (the request could not be made). For `action_failed`, `details` is `{ status, body }`: the HTTP status and the response body as parsed JSON, or `null` when it was not JSON. The exported `ActionFailedDetails` types it.

`test/space-action.test.mjs` checks the envelope, the name, input, and option checks, that each host answer reaches `SpaceProtocolError` with its code, message, and details unchanged, and when the SDK's own wait ends. `test/space-browser.test.mjs` sends an `action_failed` response verbatim over a real `MessageChannel`, and ends a run with `timeout` after the host closes its port.

### Errors and lifecycle

- `SpaceProtocolError` represents malformed, invalid, unsupported, unavailable, denied, or closed record, task, and action protocol operations.
- `SpaceProtocolError.details` is whatever the host sent, unchanged. For `task_rejected` it is the task channel's error, `{ code, category, message, pointers, details }` (see _Task refusals_). For `action_failed` it is `{ status, body }` (see _Actions_).
- `SpaceDataError` represents unavailable/closed data transport or a host GraphQL failure.
- The primary record belongs to the route and has no public close method.
- Internal MessagePort teardown is implementation cleanup. Public `record.close()` begins only with secondary-record support.

## Code and package layout

```text
simple-sdks/
├── architecture_history/
│   └── space-sdk.md
└── sdks/ts/
    ├── src/space/core.ts        public transport-neutral client and contracts
    ├── src/space/index.ts       browser MessagePort adapter and public entry
    ├── test/space-record.test.mjs
    ├── test/space-task.test.mjs
    ├── test/space-action.test.mjs
    ├── test/space-browser.test.mjs
    ├── package.json             explicit ./space export
    └── README.md                public usage guidance
```

## Delivery plan and stopping points

1. **Primary record read bridge — complete.** Negotiate protocol v1, open the current record, validate opaque handles, and expose immutable snapshots.
2. **Primary record update and submit — complete.** Use host-owned behavior and persistence sequencing; validate field/form feedback and header parity.
3. **Unify package and flexible data access — complete.** Publish the `@simpleplatform/sdk/space` subpaths, provide `simple.data`, and prove the deployed fixture can make a safe read without regressing the record API.
4. **Tasks — implemented locally.** Negotiate `protocols.task`, send `task.create` / `task.reply`, and contract-test envelopes, input checks, and result validation. Managed RecordForm document operations remain private to the UI Kit/platform integration.
5. **Actions run by the host — SDK side complete.** Negotiate `protocols.action`, send `action.run` with the action's name alone, and contract-test the envelope, the name, input, and timeout checks, and the pass-through of every host answer. The host side is a separate platform change.
6. **Secondary records — deferred.** Do not add preparatory runtime code or publish `simple.records.open()` / `record.close()` until this work is explicitly resumed with a concrete host and authorization design.
7. **Managed RecordForm — renderer boundary complete locally; capability parity in progress.** Extracted the shared private React renderer and layout, kept SDK renderer and transport details private, exposed only `<RecordForm record={record} />`, and made the platform form and iframe runtime use the same renderer artifact. Document, secret, and reference side-effect adapters still require end-to-end verification before this step is release-complete.
8. **Record-Space header actions — complete locally.** Implemented `simple.ui.header.actions.set(actions)` with opaque iframe callbacks, platform-rendered loading, controlled `loading` / `disabled`, persisted View-Action override semantics, and teardown restoration.
9. **Platform toast notifications — implemented locally.** Negotiate the `toast` capability independently of record context and expose `simple.ui.toast.show()` as a plain-text request to the platform-owned toast presenter.
10. **Production bridge migration — inventory complete; capability work required.** The copied-bridge inventory below identifies the supported migration groups and the intentionally deferred capabilities that currently block end-to-end rewrites. Do not retire copied bridge code before its needed replacement ships and a per-Space rollback plan is approved.
11. **Public portal transport — not started.** Add a server-issued portal session adapter that exposes the same contracts under portal-specific capability grants.
12. **Record-Space tabs — complete in the SDK workspace.** Implemented `simple.ui.tabs.set({ tabs, onChange })` and `simple.ui.tabs.select(tabId)` with `protocols.tabs: [1]`, bounded acknowledgement, input/response validation, canonical event routing via `SPACE_UI_TABS_SELECTION_CHANGED`, and registrationRequestId correlation for superseded registrations. SDK contract and MessageChannel tests pass; the host implementation and integrated fixture are maintained in their respective repositories.

Every step ends with focused automated contract tests and a browser checkpoint before the next public capability is added.

## Production copied-bridge migration inventory

**Inventory date:** September 20, 2026

The repository contains 13 copied `src/lib/simple.ts` iframe bridges. Twelve
are byte-for-byte identical and are imported only by their application's entry
point to load tenant CSS from `simple.branding.theme`. The remaining
`blinkin-administration` bridge additionally provides arbitrary GraphQL,
secret decryption, and parent-frame navigation.

| Group                | Spaces | Current copied capabilities                                   | Public replacement today                              | Migration decision                                                                                                                                                                                       |
| -------------------- | -----: | ------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Theme-only templates |     12 | `loadTheme()` reads and injects arbitrary tenant CSS          | None                                                  | Blocked intentionally by the standard-variable/theme project. Do not remove these bridges: doing so would silently drop tenant branding.                                                                 |
| Blink administration |      1 | `query`, `mutate`, `decrypt`, `navigateInParent`, `loadTheme` | `simple.data.query()` and `simple.data.mutate()` only | Blocked as an end-to-end migration. A partial replacement would leave two competing owners of the iframe handshake/MessagePort and retains the same copied bridge for decryption, navigation, and theme. |

### Affected Spaces

- `com.hiranigroup.workspace`: `executive-dashboard`, `land-surveying`
- `com.newera.workspace`: `field-ops`, `field-ops-worker`, `onboarding`,
  `onboarding-employee`, `payroll-hub`, `vendor-ap`, `workforce-matrix`
- `com.unitedfacade.workspace`: `construction-leads-management`,
  `construction-project-management`, `executive-pulse`
- `dev.simple.blinkin`: `blinkin-administration`

### Required migration order

1. **Theme transport first.** Deliver the already-planned standard
   `--simple-*` variable snapshot from the host. Migrate the twelve
   theme-only Spaces as one bounded, no-data-contract wave. Keep their
   existing CSS consuming variables; remove only the raw-settings query and
   copied bridge after deployed visual parity and rollback checks pass.
2. **Navigation and vault-decryption capability decisions.** Decide whether
   each should become a narrow public SDK namespace. They must not be
   reintroduced as generic raw MessagePort access. The Blink Space requires
   both before its copied bridge can be removed.
3. **Blink administration migration.** Once all of its capabilities have
   supported replacements, replace its local bridge with one `connect({ targetOrigin })`
   client, migrate GraphQL uses to `simple.data`, then browser-validate
   queries, mutations, secret access, navigation, tenant theme, error paths,
   and rollback before deleting `src/lib/simple.ts`.

### Guardrails

- Do not change a production Space merely because its GraphQL calls can map to
  `simple.data`; the legacy bridge owns one shared handshake and cannot safely
  coexist with a second client for unsupported operations.
- Do not make arbitrary CSS injection, generic MessagePort access, or broad
  parent navigation public merely to speed migration.
- Each migration wave needs a pinned SDK/UI package version, a pre-deploy
  browser checklist, and a rollback by restoring the prior Space asset
  version. No copied bridge is removed until the affected Space passes its
  own tests and a deployed tenant check.

## Validation and rollout

- Build and typecheck `@simpleplatform/sdk` before consuming it from a Space fixture.
- Contract-test request envelopes, response validation, immutable snapshots, record results, data-request multiplexing, and structured bridge failures.
- Build and test the internal `record-protocol` fixture against the current local SDK package.
- Deploy the fixture to the internal local tenant and verify the platform header/body boundary, `simple.data.query()` success, staged record update, default-view recovery, and browser console/network health.
- Keep GraphQL mutation browser checks out of the fixture when a contract test proves serialization; browser validation should not create fixture data unnecessarily.
- Migrate production Spaces only after a written capability-by-capability migration plan and rollback path.

## Risks and open questions

### Risks

- **Record workflow bypass:** Documentation and SDK examples must keep record writes on `simple.record()`; host enforcement remains authoritative.
- **Transport drift:** New transports must satisfy existing contract tests rather than change the public client shape.
- **Copied bridge migration:** Production Spaces use more capabilities than data access. Removing bridge handlers before a migration inventory would cause customer regressions.
- **Versioned asset mismatch:** Deployment manifests must be built after their app version is written; otherwise the host can resolve a Space asset path that was never uploaded.

### Open questions

1. Which data operations will a future portal session permit, and how are those scopes declared per Space?
2. What record-loader API and ownership model are needed for `simple.records.open()`?
3. When a reliable event source exists, what ordering and replay contract should a subscription API provide?
4. Which non-record bridge capabilities—identity, navigation, decryption, documents, AI, and theme—need first-class SDK namespaces before B&V migration begins?
5. What release lanes and compatibility policy will govern published `@simpleplatform/sdk/space` versions?
6. Should a `required` schema issue name the member that is missing? Today it sits at the object that lacks the member (`instance_pointer: ""`, pointer `/input`), so a Space cannot tell which member to ask for. Naming it would change the issue format in `apps/simple_ai/lib/simple_ai/tasks/json_schema.ex` in the platform repository.

## Decision history

### 2026-08-09 — One package with explicit environment subpaths

- **Decision:** Consolidate the embedded Space APIs into `@simpleplatform/sdk/space` and `@simpleplatform/sdk/space/browser`; keep the package root Action/WASM-only.
- **Reason:** Developers install one SDK while explicit imports prevent accidental browser/Action runtime mixing.
- **Supersedes:** The staging `@simple/sdk` package and the public `simple.page.primaryRecord()` naming.

### 2026-08-09 — Small noun-led Space API

- **Decision:** Use `simple.records` for behavior-aware form records and `simple.data` for flexible authorized application data. The primary-record entry point is `simple.records.current()`.
- **Reason:** The names tell a developer which contract to choose without a deep hierarchy or duplicate aliases.

### 2026-08-09 — Record lifecycle remains host-owned

- **Decision:** Expose immutable snapshots plus `update()` and `submit()` for the current record; do not expose subscriptions, public `dispose()`, or `close()` for it.
- **Reason:** The host owns the route session and Simple does not yet have a reliable live-event source. Secondary lifecycle starts only with secondary records.

### 2026-08-09 — Preserve flexible data access in the unified SDK

- **Decision:** Provide `simple.data.query()` and `simple.data.mutate()` through the existing secured GraphQL MessagePort bridge, mapping failures to `SpaceDataError`.
- **Reason:** It is a useful first-class capability and gives existing Spaces a migration path away from copied bridge clients without adding a parallel transport.
- **Boundary:** This does not authorize bypassing the form record workflow; record-form writes remain `record.update()` and `record.submit()`.

### 2026-08-09 — Portal compatibility is transport-level, not API-level

- **Decision:** A future public portal uses a server-issued, capability-scoped transport that implements the same Space client contracts.
- **Reason:** The public API remains portable while portal authentication, routing, and authorization stay server controlled.

### 2026-08-09 — Secondary records start with host ownership, not a speculative SDK method

- **Decision:** Do not add `simple.records.open()` until the platform has an internal per-Space session registry plus a real host loader that creates fully configured, independently submit-capable record sessions. The registry is an internal platform concern; it does not widen the public SDK yet.
- **Reason:** An opaque handle is only meaningful when the host owns its authorization, behavior, persistence, and cleanup lifecycle. Publishing `open()` earlier would either create an incomplete contract or duplicate React form orchestration in the browser API.
- **Implementation and validation:** The internal registry now accepts loader-owned session options, creates only secondary handles, keeps each session and submit adapter isolated, refuses to close the primary route handle, and disposes all owned sessions on iframe teardown. Focused host/runtime tests pass. It remains entirely internal: no SDK method or browser GraphQL loader was added.

### 2026-08-09 — Freeze the foundation SDK at the primary-record contract

- **Decision:** Ship only `simple.records.current()`, `record.update()`, `record.submit()`, and `simple.data.query()` / `simple.data.mutate()` in the foundation release. Defer `simple.records.open()` and `record.close()`.
- **Reason:** The primary-record contract is browser-validated and useful on its own. Secondary records require a separate authorization, document, Activity, and lifecycle rollout that should not delay or complicate the foundation.
- **Boundary:** Retain internal registry/loader work as unpublished preparation. Do not add protocol messages, browser SDK methods, examples, or migration guidance for secondary records until the work is explicitly resumed.

### 2026-08-09 — Report embedded Space height without widening the public API

- **Decision:** After the existing v1 handshake succeeds, `connectSpace()` automatically reports the iframe document height to its parent and observes later size changes when `ResizeObserver` is available.
- **Reason:** On record pages the host can let the iframe grow to its contents and keep a single platform-owned page scrollbar. Authors do not need a new API call, and standalone iframe hosts can ignore the report.
- **Boundary:** The report is a small postMessage layout signal, not a record protocol operation or public SDK capability. It is sent only to the already configured parent origin, deduplicates unchanged sizes, and does not change `simple.records` or `simple.data`.
- **Validation:** The browser bridge contract test covers the initial report, and package build/tests pass.

### 2026-08-10 — Keep iframe sizing outside the Space SDK

- **Decision:** Remove automatic content-height reporting from `connectSpace()`.
- **Reason:** The record host now gives its iframe a flex-sized remaining viewport below the platform header, so browser CSS—not a cross-origin postMessage signal—controls the iframe size. This removes an SDK responsibility that is neither a Space capability nor needed by the handshake.
- **Boundary:** A Space still controls its own document scrolling within the iframe. No public API or record/data transport behavior changes.
- **Supersedes:** The 2026-08-09 content-height reporting decision.

### 2026-08-10 — Make standalone Space transport the SDK baseline

- **Decision:** `connectSpace()` succeeds for every embedded Space with a valid MessagePort. Record protocol negotiation is optional: `simple.data` works with the general bridge, and `simple.records.current()` throws `SpaceProtocolError` code `unavailable` only when the host did not provide a route-owned record session.
- **Reason:** Data-only dashboards, tools, and future portal surfaces should use the same published SDK rather than retain copied bridge clients. An optional record capability must not make otherwise supported SDK functions unavailable.
- **Boundary:** Browser bootstrapping still requires an embedded browser and a valid host MessagePort. The SDK does not invent a record session for standalone Spaces, and record writes remain behavior-aware record commands whenever a record session exists.

### 2026-08-10 — Return explicit host context from every Space connection

- **Decision:** `connectSpace()` returns `simple.context`, a discriminated `SpaceContext` supplied by the host in the `INIT_RPC` handshake. Its only allowed variants are `standalone`, `list`, and `record`; list provides `applicationId` and `tableName`, while record also provides `recordId`. Missing or malformed context rejects the connection with `SpaceProtocolError` code `invalid_response`.
- **Reason:** Future list Spaces and public-portal transports need unambiguous page facts without URL guessing. Returning that information from the connection keeps the Space client simple and makes a host's declared capability boundary observable to an author.
- **Boundary:** Context does not create or locate a record session. `simple.records.current()` remains necessary because it refers to the host-owned current record session, including behavior sequencing, validation feedback, dirty state, and the platform header's shared lifecycle. `simple.records.open()` remains deferred.

### 2026-08-10 — One documented browser connection entry point

- **Decision:** Use `connectSpace()` as the only documented browser bootstrap, imported from `@simpleplatform/sdk/space/browser`. New scaffolds call it directly rather than generating a copied bridge or adding a second bootstrap name.
- **Reason:** A single explicit name keeps examples, migrations, and support guidance aligned with the published package contract.
- **Boundary:** This does not change the SDK's capability surface or force a bulk rewrite of existing Spaces. Their copied bridge remains only as staged migration compatibility until each unsupported capability has a public replacement.

### 2026-08-10 — Defer list context until list Spaces exist

- **Decision:** The current documented `SpaceContext` has only `standalone` and `record` variants. Do not document or rely on a `list` variant until Simple supports a custom list body and the host provides that context.
- **Reason:** Listing unsupported variants makes the public contract look more complete than the deployed host implementation and encourages code paths no current Space can exercise.
- **Supersedes:** The earlier planning decision that included a list context variant in the foundation contract.

### 2026-08-10 — Make `/space` the complete browser entry point

- **Decision:** Space authors import `connectSpace()` and all Space types from `@simpleplatform/sdk/space`. Internally, `src/space/core.ts` remains transport-neutral and `src/space/index.ts` owns the browser handshake. Do not publish a second `/space/browser` alias.
- **Reason:** One import path is easier to learn and removes an artificial distinction for the only currently implemented Space environment, while the internal core/browser boundary remains cohesive and portal-ready.
- **Protocol cleanup:** The private operation is `record.current`, matching the public `simple.records.current()` name. The current context union contains only `standalone` and `record`.
- **Scope cleanup:** Remove the unused delete capability and unpublished secondary-record preparation from the foundation. Deferred features should add their infrastructure when their actual host, authorization, and lifecycle contracts are approved.
- **Supersedes:** The documented `/space/browser` bootstrap, the staging `page.primaryRecord` wire name, and decisions to retain preparatory secondary-record runtime code.

### 2026-08-10 — Keep the public Space export smaller than its transport internals

- **Decision:** Export `connectSpace()`, the supported client/record/context types, and structured errors from `@simpleplatform/sdk/space`. Keep protocol envelopes, transports, request factories, and protocol version constants internal to the package.
- **Reason:** Space authors need the capability API, not the MessagePort implementation. Publishing transport plumbing would create compatibility obligations without a supported use case.

### 2026-08-10 — Remove the fabricated update capability

- **Decision:** Remove `RecordSnapshot.capabilities.canUpdate` from the foundation SDK.
- **Reason:** The host route does not yet supply authoritative permission state, so the field always reported `true`. Omitting it is more accurate than exposing guessed security metadata.
- **Boundary:** Host and server authorization continue to reject unauthorized writes. A future capability field requires a real shared permission source and contract tests for both allowed and denied states.

### 2026-09-20 — Render the managed RecordForm inside the Space iframe

- **Decision:** `<RecordForm record={record} />` is rendered by the private UI Runtime inside the Space iframe. Protocol v2 sends only serialized field metadata and the public record snapshot/commands needed by that runtime element. Protocol v1 remains available for legacy Spaces and continues to use the host overlay bridge.
- **Reason:** Space-owned headers, summaries, and related UI must remain visible around the managed form. Rendering the private implementation in the host frame would cover the Space and couple custom layout to platform DOM.
- **Boundary:** The public SDK exposes only `RecordHandle`, the React bridge, and the versioned runtime loader. Form stores, editor registries, Record Behaviors, document/reference/secret workflows, and persistence remain private. Live record subscriptions are intentionally deferred.

### 2026-09-20 — Let a Record Space override persisted View Actions declaratively

- **Decision:** Add `simple.ui.header.setActions(actions)`. While a Record Space is mounted, this replaces its persisted System View Actions. `setActions([])` intentionally renders none; persisted actions return when the iframe unloads. There is no `clearActions()` method.
- **Reason:** The platform must continue to own header rendering, accessibility, loading affordances, teardown, and platform-only controls. A concise declaration gives a Space custom actions without exposing System Trigger or Logic configuration or accepting arbitrary header React nodes.
- **Loading and submit:** The host renders each action and automatically marks it loading while its iframe callback's promise is pending. `loading` and `disabled` allow controlled state. A callback submits the route record through the existing `record.submit()` command; there is no separate header submit operation.
- **Boundary:** This override affects persisted View Actions only. Platform-owned Delete, recovery, navigation, and overflow controls remain outside it. The primary-record foundation does not infer multi-record save order; secondary records and explicit submit orchestration remain a separate capability.

### 2026-09-20 — Use one Space vocabulary across embedded and future public hosts

- **Decision:** Document `connect()` and `simple.record()` as the primary Space bootstrap and route-record APIs. Keep `connectSpace(options)` and `simple.records.current()` as temporary deprecated compatibility aliases for existing embedded deployments.
- **Reason:** An iframe-hosted Space and a future publicly hosted Space are both Spaces. Their authentication and transport differ, but authors should not learn different connection or record APIs merely because the host changes.
- **Boundary:** `connect()` does not make portal transport available today. It uses the existing embedded MessagePort bridge and derives the already-required host origin internally. A future direct transport must satisfy the same client contract. The host remains authoritative for record sessions, authorization, behavior execution, validation, and persistence.
- **Supersedes:** The earlier decision to make `connectSpace()` and `simple.records.current()` the sole documented browser vocabulary.

### 2026-09-23 — Negotiate tasks as their own Space capability

- **Decision:** Add `simple.tasks.create()` and `simple.tasks.reply()` as the `task.create` and `task.reply` operations of the existing `SPACE_PROTOCOL_REQUEST` envelope at protocol version 1. The Space offers `protocols.task: [1]` in `SPACE_READY` beside `record`. The SDK sends task operations only when the host answers `protocols.task: 1` in `INIT_RPC`; otherwise both methods reject with `SpaceProtocolError` code `unavailable` and post nothing.
- **Reason:** A task is not the page's record, so tasks must work in standalone Spaces, where the host negotiates no record protocol. A key of its own lets a host, or a future portal transport, grant tasks independently of records. Gating on the negotiated key also keeps a call from waiting forever on a host that has no handler for the request.
- **Boundary:** The change is additive: the envelope version stays 1 and record behavior is unchanged, and a host that reads only `protocols.record` ignores the new key. Task `input` is held to JSON values so it means the same on the MessagePort and on a JSON portal transport. The SDK refuses an incomplete request before sending it (`invalid_request`) and validates results (`invalid_response`); the host stays authoritative for task-type input validation, assignment, and authorization.

### 2026-09-23 — Stage documents through the Space protocol and transfer their bytes

- **Decision:** Add `simple.documents.stage()` as the `document.stage` operation at protocol version 1, negotiated by its own `protocols.document` key. The payload is `{ bytes, name, mimeType }`: `bytes` is an `ArrayBuffer` read once from the caller's `File` or `Blob` and named in the MessagePort transfer list, so the bytes move to the host instead of being copied. The result is `{ handle }`, the staged `DocumentHandle` with its optional `scope`.
- **Reason:** Spaces uploaded through the ad hoc `DOCUMENT_CREATE_HANDLE_REQUEST` message, answered outside the protocol and re-implemented by each Space. As a protocol operation it gains request correlation, structured errors, and validated results, while large files stay out of action request bodies.
- **Boundary:** Only the staged lifecycle is covered. Attaching to a record, pending AI handles, promotion, and deletion stay on their existing paths until each has a concrete consumer. `SpaceTransport.request()` gains an optional transfer list; a transport that cannot transfer sends the buffer by value. This change does not remove the legacy host message; retiring it belongs to the bridge-migration step.

### 2026-09-24 — Hold task input to a JSON object

- **Decision:** `TaskCreateInput.input` is typed `JsonObject`, exported from `@simpleplatform/sdk/space`, and `simple.tasks.create()` refuses `null`, an array, or a scalar input before sending, with `SpaceProtocolError` code `invalid_request`. `assignedToId` stays in the payload: the host forwards it as `assigned_to_id`, and the task is assigned to its creator when it is left out. `document.stage` keeps its `bytes` field, and `SPACE_READY` keeps offering `document`, `record`, and `task` at version 1.
- **Reason:** The agreed wire contract with the host and server takes an object for task input. A `JsonValue` type let a caller compile a call the server refuses, so the type and the client-side check now match the contract, and the caller learns it without a round trip. The assignee is kept because callers need to name one: the first consumer assigns its task to the user who created the record the task concerns.
- **Boundary:** The typed-input limits (32,768 encoded bytes, depth 64) and the 50-issue cap are enforced by the server alone; the SDK documents them and passes the refusal's `details` through, rather than keeping a second copy of the limits that could drift. No authorization check is added; Aegis owns that later.
- **Supersedes:** The 2026-09-23 boundary that held task `input` to any JSON value.

### 2026-09-24 — Keep a task refusal's channel error intact

- **Decision:** A task refusal reaches the Space as `SpaceProtocolError` code `task_rejected`, the host's code, with the channel's message as `message` and the channel error `{ code, category, message, pointers, details }` as `details`, unchanged. The SDK does not lift `details.code` into `error.code`, rename pointers to the SDK's argument names, or type the details. The README and _Task refusals_ above say that every channel refusal arrives this way and that `details.category` decides whether the Space may send the request again: a `validation` refusal is final, and a `runtime` refusal (`TASK_RUNTIME_*`) can be retried with the same arguments because the host keeps the pending create. They document the create's `validation` codes (`TASK_INPUT_INVALID`, `TASK_INPUT_TOO_LARGE`, `TASK_ASSIGNEE_INVALID`) with the payloads the platform's channel tests produce.
- **Reason:** The platform now keeps these three codes on the channel instead of folding them into `TASK_COMMAND_INVALID` (platform decision D-304) and sends the schema issues with them, so a Space can tell its user what to correct. The payload is already the channel's published contract; passing it through leaves one definition of it, in the platform, rather than an SDK copy that could drift. `error.code` stays the transport-level answer, so `task_rejected`, `timeout`, and `runtime_error` remain distinguishable without reading `details`.
- **Boundary:** No SDK code changes; `readResponse()` already passes the host's `error` through. Tests now pin the exact payloads, over the core client and over a real `MessageChannel`. The SDK still checks no input limits of its own and adds no authorization check. The `required` issue's missing member is an open platform question, not an SDK one.
- **Supersedes:** The earlier contract lines, which placed `truncated` at `details.truncated` and did not say where a channel code arrives. `truncated` is at `details.details.truncated`, and the channel code is at `details.code` under `task_rejected`.

### 2026-09-26 — Let Spaces request platform-owned toasts

- **Decision:** Expose `simple.ui.toast.show({ title?, description?, variant? })` for every Space. Negotiate `protocols.toast: [1]` independently of record access and send only plain text plus the `default` / `destructive` variant through `SPACE_TOAST_SHOW`.
- **Reason:** Space feedback should use the same platform-owned toast presenter and theme without copying its implementation or allowing an iframe to inject host React nodes.
- **Boundary:** The platform validates the payload and remains responsible for rendering. Title and description are limited to 160 and 1,000 characters; React nodes, callbacks, and toast actions are not part of this API. This does not alter header-action failure reporting.

### 2026-09-29 — Keep document lifecycle private to managed RecordForm

- **Decision:** Remove `simple.documents.stage()` and the public `document.stage` protocol from the pre-release Space SDK. Keep managed RecordForm uploads, promotion, deletion, and previews behind private UI Kit/platform host capabilities.
- **Reason:** No customer-owned standalone upload workflow has been approved. Exposing raw staging would make customers own storage lifecycle details while duplicating the managed form's existing private path; the platform also did not negotiate the public `document` protocol.
- **Boundary:** This removes no managed RecordForm upload or authenticated preview behavior. Record Behaviors still need access to selected file bytes, so the platform host retains those bytes in a session-scoped pending-file store until the Space session closes. The public SDK does not expose storage APIs, staged handles, or document protocol types.
- **Supersedes:** The 2026-09-23 staged-document public API decision and the document-protocol portion of the 2026-09-24 task-input decision.

### 2026-09-29 — Run the Space's own actions through the host

- **Decision:** Add `simple.actions.run(action, input, options?)` as the `action.run` operation at protocol version 1, negotiated by its own `protocols.action` key. The payload is `{ action, input, timeoutMs? }`. The host binds the Space's own app to `action` and runs it through the platform's server-logic path with the user's session; the result is the action's JSON result as returned. A failure keeps the host's code, and `action_failed` carries `{ status, body }` in `details`, typed by the exported `ActionFailedDetails`.
- **Reason:** A Space ran its app's actions with its own `fetch` to `https://triggers.<parent host>/logic`. That needs the app to name a domain in its Space network permission, which the host turns into the iframe's CSP `connect-src`, so a Space broke on any other domain (a local instance was blocked), and each Space resolved the endpoint and relied on the session cookie itself. With the host making the call, a Space makes no direct network request, names no domain, and needs no network permission to reach the platform. The host binds the app, rather than accepting one from the Space, so a Space reaches only its own app's actions. `action_failed` keeps the status and the parsed body because a Space reads an action's structured error envelope from the body, and `timeout` stays a code of its own because a timed-out action may still have completed.
- **Boundary:** The change is additive: the envelope version stays 1, and a host that reads only the other keys ignores `action`. The SDK checks the name pattern, that `input` is a JSON value, and that `timeoutMs` is a number. The timeout's range, the app binding, and authorization stay with the host and server, as the task input limits do, so the SDK keeps no second copy of them that could drift. The SDK sets no timer of its own, since the host aborts at `timeoutMs` and answers `timeout`, and it does not validate the result, since any JSON value is one. Only the TypeScript SDK has a Space client, so the Rust and Go SDKs have nothing to match. The host side is a separate platform change.

### 2026-09-29 — End an action run whose answer never comes

- **Decision:** `simple.actions.run()` waits for the host's answer until 5,000 ms after the run's timeout, `timeoutMs` or the host's default of 60,000, then rejects with `SpaceProtocolError` code `timeout` and aborts the transport's wait. `SpaceTransport.request()` gains an optional `AbortSignal`; the MessagePort transport forgets the request when it aborts, so a late answer is dropped. The wait is floored at 5,000 ms and capped at the longest delay a timer keeps, so a timeout the host refuses still gets the host's `invalid_request`.
- **Reason:** The host closes its end of the port whenever its Space view rebuilds the connection, as on a changed record session, context, or developer mode, and the Space does not handshake again, so a run posted afterwards was never answered and waited forever, leaving an upload or confirm spinner up for good. Before `action.run`, a Space's own `fetch` always ended at its timeout; an action run has to end as surely.
- **Boundary:** The host still owns the timeout: it answers `timeout` at `timeoutMs`, and the SDK's wait only ends a run whose answer never comes. The SDK keeps the host's default to arm the wait, not to check or send it; `timeoutMs` is still sent only when given, and its range is still the host's. Records, tasks, and documents keep their unbounded wait; they are not changed here.
- **Supersedes:** The 2026-09-29 boundary line that the SDK sets no timer of its own for an action run.

### 2026-10-02 — Require the host origin and restore public document staging

- **Decision:** Make `connect({ targetOrigin })` the sole Space bootstrap. The caller supplies the exact HTTP(S) origin; the SDK no longer infers it from `document.referrer` and does not export a `connectSpace` alias. Restore `simple.documents.stage({ file, name?, mimeType? })` and the v1 `document.stage` operation, negotiated independently of record access. Staging returns `{ handle }` and does not attach a file to a record.
- **Reason:** A single explicit bootstrap keeps the public API simple while making host selection visible to Space authors and leaving room for future hosting arrangements. Existing Spaces also depend on staged document uploads, so removing the API broke a shipped workflow; preserving the existing platform upload path restores compatibility without exposing managed RecordForm internals.
- **Boundary:** The SDK transfers file bytes to the host and validates the returned handle. The platform remains responsible for storage and authorization. Managed RecordForm's upload, promotion, deletion, and preview lifecycle stays on its private adapter; standalone staging is a separate opt-in capability.
- **Supersedes:** The 2026-09-20 decision to infer the host origin and temporarily keep `connectSpace(options)`, and the 2026-09-29 decision to remove public document staging.

### 2026-10-02 — Rename header actions to simple.ui.header.actions.set

- **Decision:** Rename the public Record Space header-action API from `simple.ui.header.setActions(actions)` to `simple.ui.header.actions.set(actions)` with no compatibility alias.
- **Reason:** Groups header action controls under an explicit `actions` namespace on `simple.ui.header` for Part 1 of the record Space tabs project, establishing consistent sub-capability grouping.
- **Boundary:** Private wire message types (`SPACE_HEADER_ACTIONS_SET`, `SPACE_HEADER_ACTION_INVOKE`, `SPACE_HEADER_ACTION_RESULT`) and MessagePort transport semantics remain unchanged. Button loading, status, and rendering remain host-owned while action callbacks remain iframe-local.
- **Supersedes:** The public method signature in the 2026-09-20 header-action decision (`simple.ui.header.setActions`).

### 2026-10-02 — Record Space tabs contract

- **Decision:** Expose `simple.ui.tabs.set({ tabs, onChange })` returning `Promise<{ selectedTabId: string | null }>` and `simple.ui.tabs.select(tabId)` returning `Promise<void>`. Negotiate `protocols.tabs: [1]` in Record Space context. Registration and selection use versioned `SPACE_PROTOCOL_REQUEST` operations `ui.tabs.set` and `ui.tabs.select`. The host owns selection and URL state, and selection events route to iframe-local `onChange(tabId)` via `SPACE_UI_TABS_SELECTION_CHANGED` correlated by `registrationRequestId`.
- **Reason:** Record Spaces require standard tabbed navigation rendered by the platform host without duplicating tab UI inside the iframe or coupling the platform to iframe React nodes.
- **Boundary:** Tab presentation, URL synchronisation, and selection state remain platform-owned. The SDK validates tab definitions (up to 32 tabs, with empty declarations clearing the strip; IDs matching `^[a-z0-9][a-z0-9_-]{0,63}$`, non-blank titles up to 80 chars, non-blank text badges up to 20 chars or finite non-negative numeric badges, kebab-case Lucide icons, and single default) before sending, applies a 10-second request timeout, correlates events using `registrationRequestId`, drops events from superseded registrations or closed transports, and reports callback errors without interrupting transport. The platform host implementation is maintained in `simple/architecture_history/record-space-tabs.md`.

### 2026-10-02 — Suppress vertical edge bounce in embedded Spaces

- **Decision:** `connect()` sets `document.documentElement.style.overscrollBehaviorY` to `none` in the Space document.
- **Reason:** The platform iframe is cross-origin, so host CSS cannot control the embedded root scroller. Applying the rule inside the SDK's existing browser bootstrap suppresses root-edge bounce without disabling normal scrolling or adding a new public API.
- **Boundary:** This applies to Space documents that use the current SDK bootstrap. Existing immutable Space bundles must be rebuilt to include the updated SDK. The host iframe element's overscroll style alone did not stop the child document's edge bounce in Chrome.
