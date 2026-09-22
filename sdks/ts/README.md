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
| **Storage**  | `@simpleplatform/sdk/storage`  | File upload and management                     |
| **Space**    | `@simpleplatform/sdk/space`    | Behavior-aware record workflows in a Space     |

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
```

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
