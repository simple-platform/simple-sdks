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

| Module       | Import                         | Purpose                                        |
| ------------ | ------------------------------ | ---------------------------------------------- |
| **Core**     | `@simpleplatform/sdk`          | Request handling and action execution          |
| **AI**       | `@simpleplatform/sdk/ai`       | AI operations (extract, summarize, transcribe) |
| **GraphQL**  | `@simpleplatform/sdk/graphql`  | Database queries and mutations                 |
| **HTTP**     | `@simpleplatform/sdk/http`     | External HTTP requests                         |
| **Security** | `@simpleplatform/sdk/security` | Security policy authoring                      |
| **Settings** | `@simpleplatform/sdk/settings` | Application settings retrieval                 |
| **Storage**  | `@simpleplatform/sdk/storage`  | File upload, and reading a stored file's bytes |
| **Space**    | `@simpleplatform/sdk/space`    | Records, data, tasks, and documents in a Space |

## Embedded Spaces

Use the explicit Space subpaths inside an embedded browser Space. The package
root remains the Action/WASM API, so Action code never imports browser globals
by accident.

```typescript
import { connectSpace } from '@simpleplatform/sdk/space'

const hostOrigin = new URL(document.referrer).origin
const simple = await connectSpace({ targetOrigin: hostOrigin })
const record = await simple.records.current()

await record.update({ first_name: 'Ada' }) // Stages values and runs update Behavior.
const result = await record.submit() // Runs submit Behavior, then persists on success.

if (!result.ok) {
  const { errors, fields } = record.snapshot()
  // Render every field's error/info plus form-level errors.
}
```

Connect once when the Space starts and reuse the returned client. One embedded iframe has one host MessagePort handshake.

`records.current()` returns the platform-owned record for the current record
page. Its handle exposes immutable snapshots, `update(values)`, and `submit()`.
The host enforces permissions and runs Record Behaviors; the Space only renders
the returned state.

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
`connectSpace()` with `SpaceProtocolError` code `invalid_response`.

`connectSpace()` works in any embedded Space, including standalone dashboards
and tools. In a non-record Space, `simple.data` remains available while
`simple.records.current()` rejects with `SpaceProtocolError` code `unavailable`
and explains that the Space must be configured as a record view.

Each capability beyond `simple.data` is negotiated with the host when the Space
connects. A capability the host did not negotiate rejects with
`SpaceProtocolError` code `unavailable` when it is called, and sends nothing.

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
Those commands preserve Record Behaviors, validation, documents, and the shared
record state used by the platform header. `simple.data.mutate()` is for other
authorized application data; it must not be used to bypass a record workflow.

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

### Space documents

`simple.documents.stage()` stores a file without attaching it to any record and
returns its handle. The host uploads it, so a large file never travels inside
an action request. The file's bytes are transferred to the host, not copied.

```typescript
const picker = document.querySelector<HTMLInputElement>('#packet')!
const { handle } = await simple.documents.stage({ file: picker.files![0] })

// A plain Blob has no name of its own, so it needs one.
await simple.documents.stage({
  file: new Blob([csv]),
  mimeType: 'text/csv',
  name: 'quantities.csv',
})
```

The handle is `{ file_hash, filename, mime_type, size, storage_path, scope? }`.
`name` defaults to a `File`'s own name, and `mimeType` to the file's type, then
to `application/octet-stream`. A staged document is not attached to anything
yet; attach its handle through the workflow that owns the record.

---

## API Documentation

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
