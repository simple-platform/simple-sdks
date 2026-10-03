# TypeScript SDK

> **Official TypeScript SDK for the Simple Platform** — Build powerful, type-safe logic modules with AI, GraphQL, HTTP, and security capabilities

## Installation

Install the SDK using [pnpm](https://pnpm.io):

```bash
pnpm add @simpleplatform/sdk
```

## Quick Start

Create your first Simple Platform action:

```typescript
import simple from '@simpleplatform/sdk'

simple.Handle(async (request) => {
  const data = request.parse<{ name: string }>()

  return {
    message: `Hello, ${data.name}! Welcome to the Simple Platform.`,
    timestamp: new Date().toISOString()
  }
})
```

## Core Modules

The TypeScript SDK is organized into focused modules for different capabilities:

| **Core** | `@simpleplatform/sdk` | Request handling and action execution |
| **AI** | `@simpleplatform/sdk/ai` | AI operations (extract, summarize, transcribe) |
| **GraphQL** | `@simpleplatform/sdk/graphql` | Database queries and mutations |
| **HTTP** | `@simpleplatform/sdk/http` | External HTTP requests |
| **Security** | `@simpleplatform/sdk/security` | Security policy authoring |
| **Settings** | `@simpleplatform/sdk/settings` | Application settings retrieval |
| **Storage** | `@simpleplatform/sdk/storage` | File upload, and reading a stored file's bytes |
| **Space** | `@simpleplatform/sdk/space` | Record, data, document, task, UI, and action capabilities in a Space |

## Embedded Spaces

Use the Space subpath inside a browser Space. The package root remains the
Action/WASM API, so Action code never imports browser globals by accident.

```typescript
import { connect } from '@simpleplatform/sdk/space'

const simple = await connect({ targetOrigin: new URL(document.referrer).origin })
const record = await simple.records.current()

await record.update({ first_name: 'Ada' }) // Stages values and runs update Behavior.
const result = await record.submit() // Runs submit Behavior, then persists on success.

if (!result.ok) {
  const { errors, fields } = record.snapshot()
  // Render every field's error/info plus form-level errors.
}
```

Connect once when the Space starts and reuse the returned client. One embedded iframe has one host MessagePort handshake.
`targetOrigin` is the host's origin, not a full URL. If the embedding setup
does not provide a referrer, supply the host origin from the Space's trusted
configuration.

`simple.records.current()` returns the platform-owned record for the current
record page. Its handle exposes immutable snapshots, `update(values)`, and
`submit()`. The host enforces permissions and runs Record Behaviors; the Space
only renders the returned state. Snapshots may also include `formInfo` for
behavior-produced form-level guidance.

### Open another managed record

`simple.records.open()` requests an independently managed record by its
application, table, and record IDs in both Record Space and general Space. The
host resolves and authorizes the target; the supplied IDs identify a record but
do not grant access. The target uses the table's standard form.

```ts
const related = await simple.records.open({
  appId: 'com.example.crm',
  recordId: 'CON000123',
  tableName: 'contacts',
})

if (simple.context.kind === 'record') {
  const current = await simple.records.current()
  // A Space can render <RecordForm record={current} /> and
  // <RecordForm record={related} /> at the same time.
}

await related.update({ status: 'active' })
const result = await related.submit()
if (!result.ok)
  console.log(related.snapshot().errors)
```

Each handle has independent values, validation, behavior, and submit state.
Each `submit()` saves only that handle; multiple records are not an atomic
transaction. Opening the same target more than once in one Space connection
returns the same live handle and session. The host disposes opened sessions
when the Space connection ends; there is no per-record close method. Opening
the route-owned record itself rejects with `already_current`; use
`simple.records.current()` for it.
`open()` requires a host that negotiated the records capability; when that
transport is absent, `open()` returns a structured `unavailable` error. In
general Space context, `records.current()` remains unavailable while `open()`
succeeds whenever records transport was negotiated. An older host may still
support `current()` through the existing `record` capability while lacking
`open()`. Missing and inaccessible records return the same generic
`target_unavailable` error.

### Managed record UI and header actions (pre-release)

The companion UI Kit currently implements a managed React form for Record
Spaces:

```tsx
<RecordForm record={record} />
```

It renders the complete Simple form without exposing field schemas, editor
registries, document/reference/secret internals, or Record Behavior timing as
public APIs. When a Space needs fully custom presentation, keep using the
record handle's `snapshot()`, `update()`, and `submit()` commands.

Record Spaces can replace the platform main actions in the header while
mounted:

```ts
simple.ui.header.actions.set([
  {
    id: 'start-call',
    label: 'Start call',
    onClick: async () => startCall(),
    type: 'primary',
  },
])
```

Promise-returning callbacks show button loading automatically. `actions.set([])`
renders no main actions. While a custom Record Space is active, this replaces
the platform `Update` button and persisted View Actions; those defaults return
when the Space unloads or the user selects the standard view. The full
pre-release interface and examples live in the
[`@simpleplatform/ui-kit` README](../space-ui/README.md).

A header action owns its own save feedback. `record.submit()` returns validation
state without choosing UI; call `simple.ui.toast.show()` when the Space should
also show a platform toast. `RecordForm` continues to display detailed field
and form messages inline.

### Show a platform toast

Any Space can show feedback with Simple's existing toast presenter and theme:

```ts
simple.ui.toast.show({
  description: 'Your changes are ready.',
  title: 'Saved',
})

simple.ui.toast.show({
  description: 'The changes could not be saved.',
  variant: 'destructive',
})
```

At least one of `title` or `description` is required, and both are plain text.
Titles are limited to 160 characters and descriptions to 1,000. The supported
variants are `default` and `destructive`. React content and toast action
callbacks are not sent across the iframe boundary.

### Record Space tabs

Record Spaces can declare tabs in the platform record header:

```ts
const { selectedTabId } = await simple.ui.tabs.set({
  onChange: (tabId) => {
    console.log(`Active tab changed to ${tabId}`)
  },
  tabs: [
    { icon: 'layout-dashboard', id: 'overview', title: 'Overview' },
    { badge: 3, icon: 'message-square', id: 'messages', title: 'Messages' },
    { badge: 'New', icon: 'file-text', id: 'documents', title: 'Documents' },
  ],
})

// Programmatically select a declared tab
await simple.ui.tabs.select('messages')
```

Tabs are configured with up to 32 tabs and a required `onChange` callback. An
empty list clears the current declaration and resolves with
`{ selectedTabId: null }`.
Each tab requires an `id` (1–64 characters matching `^[a-z0-9][a-z0-9_-]{0,63}$`)
and a non-blank `title` (up to 80 characters), with optional `default: true`,
optional kebab-case Lucide `icon`, and optional `badge` (non-blank text up to 20
characters or a finite non-negative integer). At most one tab may set `default: true`;
if none is specified, the first tab defaults to active.

The host negotiates `protocols.tabs: [1]` and owns selection and URL state.
Registration uses `ui.tabs.set`, which assigns a `registrationRequestId` and
acknowledges the initial `selectedTabId` without firing `onChange`. Host-to-Space
selection changes are delivered via canonical `SPACE_UI_TABS_SELECTION_CHANGED` with
`{ registrationRequestId, selectedTabId }` and routed to `onChange`. Events for
superseded registrations are dropped immediately.

Programmatic selection uses `ui.tabs.select`, sending `{ registrationRequestId, tabId }`.
Selecting the already-active tab resolves immediately without wire traffic.
Selecting an inactive declared tab resolves after host acknowledgement and reaches
the `onChange` callback once, deduplicating the response and event. Both methods fail
with structured `SpaceProtocolError` code `'unavailable'` outside a record Space or
when the tabs capability was not negotiated.

### Space context

`simple.context` is explicit host-provided page context. It is never inferred
from a Space URL or the iframe DOM.

```ts
switch (simple.context.kind) {
  case 'standalone':
    break
  case 'record':
    console.log(
      simple.context.applicationId,
      simple.context.tableName,
      simple.context.recordId,
    )
    break
}
```

The two exact context forms are `{ kind: 'standalone' }` and
`{ kind: 'record', applicationId, tableName, recordId }`. There is no
`unknown` context variant. A missing or malformed context rejects
`connect({ targetOrigin })` with `SpaceProtocolError` code `invalid_response`.

`connect({ targetOrigin })` works in any embedded Space, including standalone dashboards
and tools. In a non-record Space, `simple.data` remains available and
`simple.records.open()` succeeds whenever the records capability was negotiated,
while `simple.records.current()` rejects with `SpaceProtocolError` code
`unavailable` and explains that the current record requires a record view.
In an older host, `records.current()` can remain available through the `record`
capability while `records.open()` requires the newer `records` capability.

When `connect()` runs in the Space document, it disables vertical root
overscroll bounce. Normal scrolling inside the Space remains enabled.

Each capability beyond `simple.data` is negotiated with the host when the Space
connects. A capability the host did not negotiate rejects with
`SpaceProtocolError` code `unavailable` when it is called, and sends nothing.

The same `connect({ targetOrigin })` and `simple.records.current()` vocabulary is
reserved for future publicly hosted Spaces. That transport and its
authentication model are not implemented yet; authors should not add
portal-specific connection code now.

### Space data access

Use `simple.data` for application data that is not the record form currently
being edited. It uses the Space's existing, host-authorized GraphQL bridge.

```typescript
const users = await simple.data.query<{ users: Array<{ id: string, email: string }> }>(
  `query ListUsers($limit: Int!) {
    users: dev_simple_system__users(limit: $limit) {
      id
      email
    }
  }`,
  { limit: 10 },
)

const result = await simple.data.mutate<{ insert_demo__note: { id: string } }>(
  `mutation CreateNote($body: String!) {
    insert_demo__note(object: { body: $body }) {
      id
    }
  }`,
  { body: 'Follow up with the customer.' },
)
```

Use `record.update()` and `record.submit()` for writes to the current record.
Those commands preserve Record Behaviors, validation, permissions, and the
shared record state used by the platform. The managed `RecordForm` coordinates
its specialized document-field workflow through Simple's private host adapter.
For a customer-owned upload workflow, stage a file through the public document
API:

```ts
const { handle } = await simple.documents.stage({ file })
```

The returned handle describes a staged upload; staging does not attach the file
to a record. The managed `RecordForm` continues to own its specialized
document-field workflow through Simple's private host adapter.
`simple.data.mutate()` is for other authorized application data and must not
bypass the record workflow.

### Space tasks

`simple.tasks` creates a task from a task type and replies on a task. Tasks are
not the page's record, so they work in standalone and record Spaces alike.

```typescript
const { task } = await simple.tasks.create({
  assignedToId: 'USR000005', // Optional: defaults to the user creating the task.
  input: { packet: 'DOC000001' }, // The typed input the task type declares.
  taskTypeId: 'TTY000003',
  title: 'Review the contract packet',
})

const { messageId, taskRevision } = await simple.tasks.reply({
  content: 'The revised drawing is attached.',
  inReplyToMessageId: 'MSG000006', // Optional: the message this reply answers.
  taskId: task.id,
})
```

`create()` returns `{ task: { id, status, revision } }`, where `status` is one
of `queued`, `in_progress`, `waiting`, `completed`, `cancelled`, or `failed`.
`reply()` returns the new message's ID and the task's revision after the reply.

`input` is always a JSON object; pass `{}` when the task type needs no input.
Everything inside it must be a JSON value (plain objects, arrays, strings,
finite numbers, booleans, and `null`) so it means the same thing on every
transport. `null`, an array, or a single value as the input itself is refused.
The host holds a task type's typed input to 32,768 encoded bytes and 64 levels
of nesting.

`assignedToId`, when given, must name an existing user in the tenant; left out,
the task is assigned to the user creating it.

A request the SDK can tell is incomplete is refused before it is sent, with
`SpaceProtocolError` code `invalid_request`.

When the task service refuses a create or a reply, the call rejects with
`SpaceProtocolError` code `task_rejected`, whatever the reason. Its `message` is
the service's message, and its `details` is the service's error exactly as sent:
`{ code, category, message, pointers, details }`. Neither the host nor the SDK
adds, drops, or renames anything in it. The reason is `details.code`, not
`error.code`:

```typescript
import { SpaceProtocolError } from '@simpleplatform/sdk/space'

try {
  await simple.tasks.create({ input: { amount: 700 }, taskTypeId: 'TTY000003', title: 'Open the job' })
}
catch (error) {
  if (!(error instanceof SpaceProtocolError) || error.code !== 'task_rejected')
    throw error

  const refusal = error.details as { category: string, code: string, details: unknown, pointers: string[] }
  // refusal.category says whether to correct the request or send it again,
  // refusal.code says why, and refusal.pointers says where.
  console.warn(refusal.category, refusal.code, refusal.pointers)
}
```

`details.category` says whether to correct the request or send it again:

- `validation` is final. The request is wrong, and the host keeps nothing of
  the refused create, so correct the request before sending it again.
- `runtime` means the task service did not answer, not that the request is
  wrong. Its codes are `TASK_RUNTIME_UNAVAILABLE`, `TASK_RUNTIME_TIMEOUT`,
  `TASK_RUNTIME_BUSY`, and `TASK_RUNTIME_REMOTE_FAILURE`. The host keeps the
  pending create, so calling `create()` again with the same arguments resends
  that create under the same task id, and a create that did land is not made
  twice.

A create's title, input, and assignee are refused with these `validation`
codes:

| `details.code`          | When                                                                                  | `details.pointers`                                        | `details.details`                   |
| ----------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------- |
| `TASK_INPUT_INVALID`    | The input fails its task type's input schema                                          | Each issue's `instance_pointer` under `/input`, once each | `{ errors, truncated }`             |
| `TASK_INPUT_INVALID`    | The title is longer than 255 characters, or the input is nested deeper than 64 levels | `/title` or `/input`                                      | `{}`                                |
| `TASK_INPUT_TOO_LARGE`  | The input encodes to more than 32,768 bytes                                           | `/input`                                                  | `{ measured_bytes, allowed_bytes }` |
| `TASK_ASSIGNEE_INVALID` | `assignedToId` is not a user in the tenant                                            | `/assigned_to_id`                                         | `{}`                                |

For a schema failure, `errors` holds at most 50 issues sorted by
`instance_pointer`, and `truncated` is `true` when there were more. Each issue
is exactly `{ code, instance_pointer, schema_pointer }` and never carries the
value that failed. `instance_pointer` is relative to the input, while
`pointers` carries the `/input` prefix. `schema_pointer` is the location in the
task type's input schema of the object holding the keyword that failed.

For example, a task type whose input schema is
`{ type: 'object', properties: { amount: { type: 'integer' } }, required: ['job_id'], additionalProperties: false }`
refuses the input `{ amount: 'seven hundred', note: 'a private note' }` with
this `error.details`:

```json
{
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
```

A `required` issue points at the object that lacks the member, not at the
member: above it sits at `/input` and does not name `job_id`.

The input `{ notes }`, where `notes` holds 32,769 characters and the input
encodes to 32,781 bytes, is refused with:

```json
{
  "code": "TASK_INPUT_TOO_LARGE",
  "category": "validation",
  "message": "The task input is too large. Shorten the request or split the work into more than one task.",
  "pointers": ["/input"],
  "details": { "measured_bytes": 32781, "allowed_bytes": 32768 }
}
```

An assignee who is not a user in the tenant is refused with:

```json
{
  "code": "TASK_ASSIGNEE_INVALID",
  "category": "validation",
  "message": "The task assignee is invalid.",
  "pointers": ["/assigned_to_id"],
  "details": {}
}
```

Pointers name the members of the task service's command, not the SDK's
arguments, so the assignee is `/assigned_to_id` rather than `assignedToId`. A
refused `reply()` arrives the same way, with the service's own code in
`details.code` and the same categories: after a `runtime` refusal, calling
`reply()` again with the same arguments resends the kept message rather than
posting it twice.

### Space actions

`simple.actions.run()` runs an action of the Space's own app where the app
declares it runs, as the signed-in user, and returns the action's JSON result:
a `server` action on the server, a `client` or `both` action in the browser, in
the platform page's own workers. The host makes the
call, so the Space makes no network request of its own: it names no domain,
needs no `network` permission to reach the platform, and handles no sign-in.
Actions work in standalone and record Spaces alike.

```typescript
interface AttachResult { data: { document_id: string, status: string } }

const result = await simple.actions.run<AttachResult>(
  'document-attach',
  { document_id: 'DOC000001', job_id: 'JOB000007' },
  { timeoutMs: 120_000 }, // Optional: how long the host waits, in milliseconds.
)
```

`action` is the action's name alone, such as `document-attach`: lowercase
letters, digits, and hyphens, starting with a letter or a digit. The host adds
the Space's own app, so a Space runs only its own app's actions and never names
an app. `input` is any JSON value and reaches the action as its payload; pass
`{}` or `null` when the action takes none. The result is the action's JSON
result as it returned it, unchecked: `TResult` is the caller's description of
it.

`timeoutMs` defaults to 60,000, and the host accepts 1,000 to 1,200,000. When it
runs out, the host stops waiting and the call rejects with `timeout`. If the
host's answer never comes, as when the host has closed its end of the
connection, the SDK stops waiting 5,000 ms after the timeout and rejects with
`timeout` itself, so a call always ends. Either way the action may still
complete, so a caller whose action writes should re-read before
offering to run it again.

A request the SDK can tell is malformed is refused before it is sent, with
`SpaceProtocolError` code `invalid_request`: a name outside that pattern, an
input that is not a JSON value, or a `timeoutMs` that is not a number. The host
checks the range of `timeoutMs`.

A call that does not return a result rejects with `SpaceProtocolError`, and its
`code` says why:

| `code`                 | When                                                                      | `details`          |
| ---------------------- | ------------------------------------------------------------------------- | ------------------ |
| `invalid_request`      | The name, input, or options are malformed, or `timeoutMs` is out of range | None               |
| `unsupported_protocol` | The host does not support the protocol version                            | None               |
| `unavailable`          | The host did not negotiate actions, or cannot run them                    | None               |
| `timeout`              | The action did not answer within `timeoutMs`, or the host did not answer  | None               |
| `action_failed`        | The server answered with a status other than 2xx, or with an error result | `{ status, body }` |
| `network`              | The host could not make the request                                       | None               |

For `action_failed`, `details` is an `ActionFailedDetails`: `status` is the
HTTP status the server answered with, and `body` is the response body as
parsed JSON, or `null` when it was not JSON. An action the host ran in the
browser carries 200 and the same `{ error: [...] }` body shape the server
gives for the same failure. Neither the host nor the SDK
changes the body, so an action's own error envelope is read from it:

```typescript
import type { ActionFailedDetails } from '@simpleplatform/sdk/space'
import { SpaceProtocolError } from '@simpleplatform/sdk/space'

try {
  await simple.actions.run('document-attach', { document_id: 'DOC000001' })
}
catch (error) {
  if (!(error instanceof SpaceProtocolError) || error.code !== 'action_failed')
    throw error

  const { body, status } = error.details as ActionFailedDetails
  // body is the action's own response, such as its error envelope.
  console.warn(status, body)
}
```

---

## API Documentation

### Describing an Action

What an action is, and when to reach for it, is written where the code is — in
the JSDoc comment above the handler, the same comment that carries its
description:

```typescript
/**
 * Close a duplicate lead and point it at the record that survives.
 *
 * The surviving lead keeps its activity; the duplicate is marked closed and
 * linked to it, so a later report still reaches both records.
 *
 * @tool
 * @shortdesc Close a duplicate lead, pointing it at the surviving record.
 * @usewhen A lead is a duplicate of one already in the system.
 * @usewhen Two leads share a contact and one should be retired.
 */
simple.Handle(async (request) => {
  // ...
})
```

| Tag             | Shape                                           | What it says                                                                                                                              |
| --------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `@tool`         | bare, no value                                  | This action can be reached as a tool                                                                                                      |
| `@shortdesc`    | one line, up to 300 characters, written once    | What this is, read in a listing of tools                                                                                                  |
| `@usewhen`      | one line, up to 100 characters, up to ten times | One occasion for reaching for this rather than something else                                                                             |
| `@parallelsafe` | bare, no value, only alongside `@tool`          | This tool changes no stored data and sends nothing, so it may run at the same time as the other parallel-safe calls next to it in a batch |

`@parallelsafe` is a claim you make about your own action; the platform does
not verify it. It changes only which calls of a batch may overlap — consecutive
parallel-safe calls may run at the same time, and every other call still runs
alone, in the order asked. It never changes whether a failed call is retried,
nor the platform's assumption that a failed call may have changed stored data.
The build refuses it without `@tool`, with a value, or written twice. Write it
only when the action is read-only:

```typescript
/**
 * Look up a lead's open activity.
 *
 * @tool
 * @shortdesc Look up a lead's open activity.
 * @usewhen A caller wants a lead's current open activity.
 * @parallelsafe
 */
simple.Handle(async (request) => {
  // reads only — no writes, no outbound calls
})
```

The prose above the tags is the full description, and stays exactly as
written. Each tag is declared in `tsdoc.json` (`{"tagName": "@parallelsafe",
"syntaxKind": "modifier"}` alongside `@tool`, `@shortdesc` and `@usewhen`), so
an editor with TSDoc support recognizes it instead of flagging it as unknown.

### AI Module

The AI module provides powerful capabilities for working with unstructured data.

#### Extract Structured Data

Extract structured information from documents, text, or images using AI:

```typescript
import { extract } from '@simpleplatform/sdk/ai'

const result = await extract(
  documentHandle,
  {
    prompt: 'Extract customer information from this invoice',
    schema: {
      properties: {
        customerName: { type: 'string' },
        invoiceDate: { format: 'date', type: 'string' },
        totalAmount: { type: 'number' }
      },
      required: ['customerName', 'totalAmount', 'invoiceDate'],
      type: 'object'
    }
  },
  request.context
)

console.log(result.data) // { customerName: "...", totalAmount: 1250.00, ... }
console.log(result.metadata.inputTokens) // Token usage for auditing
```

#### Summarize Content

Generate concise summaries of documents or long-form text:

```typescript
import { summarize } from '@simpleplatform/sdk/ai'

const result = await summarize(
  longDocument,
  {
    model: 'large',
    prompt: 'Provide a 3-sentence executive summary'
  },
  request.context
)

console.log(result.data) // "This document outlines..."
```

#### Transcribe Audio/Video

Transcribe audio or video files with optional participant identification:

```typescript
import { transcribe } from '@simpleplatform/sdk/ai'

const result = await transcribe(
  audioFile,
  {
    includeTimestamps: true,
    includeTranscript: true,
    participants: ['Customer', 'Support Agent'],
    summarize: true
  },
  request.context
)

console.log(result.data.transcript) // "[00:15] Customer: I need help with..."
console.log(result.data.summary) // "Customer called regarding..."
console.log(result.data.participants) // ["Customer", "Support Agent"]
```

#### Transcribe PDF Pages

Read the pages of a PDF that have no usable text of their own — scans,
image-only exhibits — from their images. Each such page is transcribed once,
and it is the same transcription an `extract` or `summarize` that asks for text
is given in the page's place, so the text you hold for an image page is exactly
the text the answer was built on. Pages with a readable text layer are not
returned.

```typescript
import { transcribePages } from '@simpleplatform/sdk/ai'

const { data } = await transcribePages(
  { ...contract, first_page: 40, last_page: 52 },
  {},
  request.context
)

for (const page of data.pages) {
  if ('error' in page) {
    console.log(`page ${page.page} could not be read: ${page.error}`)
    continue
  }

  console.log(page.page, page.text)
}
```

Pages are numbered in the original document. Transcriptions are kept per
version of the file and page, so a page already read for an `extract` or
`summarize` that asked for text (`deliver_as: 'text'`) is not read again.

A page is not transcribed twice to check itself: that would be the same model
reading the same image again, doubling the cost of every scanned page without
adding independence. To check an answer independently, read the pages a second
way — as the document itself (`deliver_as: 'document'`) — and compare.

#### How Files Travelled

Every AI result says how each file it carried reached the model, in
`metadata.delivery`: `deliveredAs` (`'document'`, `'text'` or `'image'`), the
range it was cut to, the pages transcribed from their images, and — when text
was asked for and the document was sent instead — a `fallback` naming the pages
that could not be read and why.

```typescript
const result = await extract({ ...contract, deliver_as: 'text' }, { prompt, schema }, request.context)

for (const file of result.metadata.delivery ?? []) {
  if (file.fallback)
    console.log(`${file.filename} was read as a PDF: ${file.fallback.message}`)
}
```

### GraphQL Module

Execute type-safe database operations with GraphQL:

```typescript
import * as graphql from '@simpleplatform/sdk/graphql'

// Query data
const users = await graphql.query<{ users: Array<{ id: string, name: string }> }>(
  `query GetUsers($status: String!) {
    users(where: { status: { _eq: $status } }) {
      id
      name
      email
    }
  }`,
  { status: 'active' },
  request.context
)

// Mutate data
const result = await graphql.mutate(
  `mutation UpdateUser($id: ID!, $name: String!) {
    updateUser(id: $id, name: $name) {
      id
      name
    }
  }`,
  { id: '123', name: 'Jane Doe' },
  request.context
)
```

### HTTP Module

Make external HTTP requests with a clean interface:

```typescript
import * as http from '@simpleplatform/sdk/http'

// GET request
const data = await http.get(
  'https://api.example.com/users',
  { Authorization: 'Bearer token123' },
  request.context
)

// POST request
const result = await http.post(
  'https://api.example.com/orders',
  { productId: '456', quantity: 2 },
  { 'Content-Type': 'application/json' },
  request.context
)

// Custom request
const response = await http.fetch(
  {
    body: { status: 'completed' },
    headers: { Authorization: 'Bearer token123' },
    method: 'PATCH',
    url: 'https://api.example.com/data'
  },
  request.context
)

// A browser request that carries the page's cookies
const session = await http.fetch(
  {
    credentials: 'include',
    url: 'https://api.example.com/session'
  },
  request.context
)
```

`credentials` is the browser's credentials mode for the request: `'omit'`,
`'same-origin'` or `'include'`. A request that names none sends none, and the
browser host then omits credentials. A cross-origin request that includes them
still needs the endpoint to allow the page's origin and credentials through
CORS. The server host has no browser credentials and ignores the option.

### Security Module

Define declarative security policies with a fluent, global-style API:

```typescript
// security.js - Security policy manifest

// Define reusable rules
const when = {
  isDraft: { filter: { status: { _eq: 'Draft' } } },
  isOwner: { filter: { creator_id: { _eq: '$user.id' } } },
  isPublished: { filter: { status: { _eq: 'Published' } } }
}

const hide = {
  sensitive: deny('ssn', 'salary', 'bank_account')
}

// Define policies for resources
policy('myapp/table/document', {
  // Auditors have read-only access with hidden sensitive fields
  auditor: {
    aggregate: {
      allow: { count: true },
      allowRawData: false
    },
    read: hide.sensitive
  },

  // Managers have full access
  manager: {
    '*': true
  },

  // Regular users can only read their own published documents
  user: {
    create: true,
    edit: [when.isOwner, when.isDraft],
    read: [when.isOwner, when.isPublished]
  }
})

// Policy for logic/action resources
policy('myapp/logic/send-notification', {
  manager: { execute: true },
  user: { execute: true }
})
```

### Settings Module

Retrieve application settings securely:

```typescript
import * as settings from '@simpleplatform/sdk/settings'

const config = await settings.get(
  'dev.simple.myapp',
  ['api_key', 'webhook_url', 'max_retries'],
  request.context
)

console.log(config.api_key) // "sk_live_..."
console.log(config.max_retries) // 3
```

### Storage Module

Upload files from external sources to the platform's content-addressable storage:

```typescript
import { uploadExternal } from '@simpleplatform/sdk/storage'

const documentHandle = await uploadExternal(
  {
    auth: {
      bearer_token: 'your-token-here',
      type: 'bearer'
    },
    url: 'https://example.com/invoice.pdf'
  },
  {
    app_id: 'dev.simple.myapp',
    field_name: 'attachment',
    table_name: 'documents'
  },
  request.context
)

console.log(documentHandle.file_hash) // SHA-256 hash
console.log(documentHandle.mime_type) // "application/pdf"
console.log(documentHandle.size) // File size in bytes
```

The way back out takes the same handle and answers with the file's bytes:

```typescript
import { read, readRange, size } from '@simpleplatform/sdk/storage'

const bytes: Uint8Array = await read(documentHandle, request.context)

const length = await size(documentHandle, request.context) // without reading any of it
const head = await readRange(documentHandle, 0, 1024, request.context) // the first kilobyte
```

The bytes cross from the host as they are, with no JSON and no base64. `read`
asks for the size first and reads the file in ranges of at most
`MAX_RANGE_BYTES` (16 MiB): a file that fits one range arrives as one array, and
a larger one is read into a single buffer allocated once at exactly its size.
`readRange` asks for the size first too, so a range that runs past the end of
the file answers with exactly the bytes up to the end, and one that starts at or
past the end is refused before any of it is read.

Reading is for server actions; a browser action is refused. It needs a runtime
plugin that provides `__host.callBytes`, and an older plugin is refused with a
message saying so rather than handed bytes it would try to read as JSON.

### Type Definitions

The TypeScript SDK is **fully typed** with comprehensive TypeScript definitions. Leverage IDE autocompletion and compile-time type checking:

```typescript
import type { Context, DocumentHandle, SimpleResponse } from '@simpleplatform/sdk'
import type { AIExtractOptions, JSONSchema } from '@simpleplatform/sdk/ai'

// All types are exported for your use
const schema: JSONSchema = {
  properties: {
    age: { type: 'number' },
    name: { type: 'string' }
  },
  type: 'object'
}
```

---

## Development

See the [main repository README](../../README.md#development) for setup instructions using Devbox.

## License

Apache License 2.0 - See [LICENSE](../../LICENSE) for details.
