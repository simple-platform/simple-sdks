# Rust SDK

> **Official Rust SDK for the Simple Platform** — Build fast, type-safe actions with AI, GraphQL, HTTP, settings, storage and a first-class testing seam, with no lifetimes, no `async` and no `unsafe`

## Installation

Install the SDK using [cargo](https://doc.rust-lang.org/cargo/):

```bash
cargo add simpleplatform-sdk serde serde_json
```

`serde` and `serde_json` are direct dependencies of your action: a
`#[derive(Deserialize)]` expands to code that names `serde` by crate, so an
action depends on it even though the prelude re-exports the derive. An action
that would rather not add them can write
`#[serde(crate = "simpleplatform_sdk::serde")]` and use the re-export.

`#[derive(Schema)]` and the `#[simple(…)]` attribute arrive with the default
`derive` feature, the way `serde` ships its own derive. An action that writes no
member constraints turns it off with `default-features = false`.

### What an action's crate names

- `simpleplatform-sdk`, `serde` and `serde_json` as dependencies, as above.
- An `async` feature that hands the flag on to this crate:

  ```toml
  [features]
  async = [ "simpleplatform-sdk/async" ]
  ```

  This is what makes the browser artifact buildable. The two builds below select
  between two import sets, and they select with `--features async` — a flag
  cargo resolves against the crate being **built**, which is your action, not
  its dependency. So the action needs a feature of that name to pass along.
  Without it the browser build stops at `does not contain this feature: async`.
  An action whose execution environment is `server` never needs it.

- A release profile: `opt-level = "z"`, `lto = true`, `codegen-units = 1`,
  `strip = true`.
- Nothing else. `allocate_buffer` and `set_response_buffer` reach the module's
  export table from this crate on their own; no `--export` linker argument and no
  macro invocation in the action is needed.

## Quick Start

Create your first Simple Platform action. This is the whole of `src/main.rs` —
what the action is, what it accepts, and what it does:

```rust
use simpleplatform_sdk::prelude::*;

/// The lead to close, and the one it is a duplicate of.
#[derive(Deserialize, Schema)]
struct Input {
    /// The lead to close, by identifier.
    #[simple(pattern = "^LEAD", length(min = 5, max = 64))]
    lead_id: String,

    /// The lead that survives, and that the closed one points at.
    #[simple(pattern = "^LEAD", length(min = 5, max = 64))]
    duplicate_of: String,

    /// Close it only once it has been idle for this many days.
    #[simple(range(min = 1, max = 90))]
    idle_days: u32,
}

#[derive(Deserialize)]
struct Found {
    leads: Vec<Value>,
}

#[derive(Deserialize)]
struct Closed {
    result: Affected,
}

#[derive(Deserialize)]
struct Affected {
    affected_rows: i64,
}

#[derive(Serialize)]
struct Output {
    closed: String,
    merged_into: String,
    rows_changed: i64,
}

const IDLE_LEAD: &str = r#"
  query IdleLead($id: ID!, $days: Int!) {
    leads: crm__lead(where: {id: {_eq: $id}, idle_days: {_gte: $days}}, limit: 1) {
      id
    }
  }"#;

const CLOSE_LEAD: &str = r#"
  mutation CloseLead($id: ID!, $merged: ID!) {
    result: update_crm__lead(
      where: {id: {_eq: $id}}
      _set: {status: "closed", merged_into: $merged}
    ) {
      affected_rows
    }
  }"#;

/// Close a duplicate lead and point it at the record that survives.
///
/// The surviving lead keeps its activity; the duplicate is marked closed and
/// linked to it, so a later report still reaches both records.
///
/// @tool
/// @shortdesc Close a duplicate lead, pointing it at the surviving record.
/// @usewhen A lead is a duplicate of one already in the system.
/// @usewhen Two leads share a contact and one should be retired.
fn handler(request: Request<Input>) -> Result<Output, Error> {
    if request.data.lead_id == request.data.duplicate_of {
        return Err(Error::invalid("A lead cannot be a duplicate of itself.")
            .hint("Pass two different lead identifiers."));
    }

    let found: Found = simple::graphql::query(
        IDLE_LEAD,
        json!({ "id": request.data.lead_id, "days": request.data.idle_days }),
    )?;

    if found.leads.is_empty() {
        return Err(Error::invalid("That lead has been active too recently.")
            .hint("Raise idle_days, or close the lead by hand."));
    }

    let closed: Closed = simple::graphql::mutate(
        CLOSE_LEAD,
        json!({ "id": request.data.lead_id, "merged": request.data.duplicate_of }),
    )?;

    Ok(Output {
        rows_changed: closed.result.affected_rows,
        closed: request.data.lead_id,
        merged_into: request.data.duplicate_of,
    })
}

fn main() { simple::run(handler) }
```

No lifetimes, no `async`, no `unsafe`, no envelope, no context threading, one
import line.

### Build it, and run its tests

```bash
simple build com.mycompany.crm/close-duplicate-lead   # one action
simple build com.mycompany.crm                        # every action in an app
simple build --all                                    # every app

simple test com.mycompany.crm -a close-duplicate-lead # one action's tests
simple test com.mycompany.crm                         # every test in an app
simple test                                           # every test
```

`simple build` takes `--concurrency` to set how many builds run at once, and
`simple test` takes `--coverage`. Both take `--json` when something other than a
person is reading the result.

## Core Modules

The Rust SDK is organised into focused modules for different capabilities:

| Module       | Import                        | Purpose                                                |
| ------------ | ----------------------------- | ------------------------------------------------------ |
| **Core**     | `simpleplatform_sdk::prelude` | Request handling and action execution                  |
| **Schema**   | `simple::Schema`              | Member constraints, checked as you write them          |
| **AI**       | `simple::ai`                  | AI operations (extract, summarize, transcribe)         |
| **GraphQL**  | `simple::graphql`             | Database queries and mutations                         |
| **HTTP**     | `simple::http`                | External HTTP requests                                 |
| **Settings** | `simple::settings`            | Application settings retrieval                         |
| **Storage**  | `simple::storage`             | File upload and management                             |
| **Errors**   | `simple::{Error, Fault}`      | Typed failures, and what `?` converts into             |
| **Codes**    | `simple::codes`               | The canonical failure vocabulary: `Code`, `Category`   |
| **Host**     | `simple::host`                | The `Transport` an action reaches the platform through |
| **Testing**  | `simple::testing`             | Host seam for tests, with no wasm build                |

Every one of them is reached through `simple`, which the prelude brings in — so
the one import line above is still the whole of what an action imports. The
prelude also carries the types a call site has to write down: the options a call
takes, and the value it answers with. What a call chooses _inside_ one of those
keeps its module path and needs no import of its own, such as
`simple::ai::Model::Large` or `simple::storage::Auth::bearer("t-1234")`.

---

## API Documentation

### Core

`simple::run` takes your handler and drives one execution: it reads the
execution context, hands your handler its typed input, and reports the outcome.
`Request<T>` carries `data`, the input deserialised into your own type.

Every public function returns `Result`, and `?` works on anything that
implements `Display`, so an action propagates a failure without naming a type.

### Describing an Action

What an action is, and what its input looks like, is written where the code is —
in the doc comments and on the members themselves. There is nothing to keep in
step by hand.

#### The three tags

Three tags describe the action, written with `///` in the doc comment above the
handler — the same comment that carries its description:

```rust
/// Close a duplicate lead and point it at the record that survives.
///
/// The surviving lead keeps its activity; the duplicate is marked closed and
/// linked to it, so a later report still reaches both records.
///
/// @tool
/// @shortdesc Close a duplicate lead, pointing it at the surviving record.
/// @usewhen A lead is a duplicate of one already in the system.
/// @usewhen Two leads share a contact and one should be retired.
fn handler(request: Request<Input>) -> Result<Output, Error> {
    // ...
}
```

Give the handler a name to hang them on, and pass it to `simple::run`:

```rust
fn main() { simple::run(handler) }
```

| Tag          | Shape                                           | What it says                                                  |
| ------------ | ----------------------------------------------- | ------------------------------------------------------------- |
| `@tool`      | bare, no value                                  | This action can be reached as a tool                          |
| `@shortdesc` | one line, up to 300 characters, written once    | What this is, read in a listing of tools                      |
| `@usewhen`   | one line, up to 100 characters, up to ten times | One occasion for reaching for this rather than something else |

**The prose above the tags is the full description.** It stays exactly as
written — the first paragraph and everything under it — so the long form of what
this action does is the same text a developer opening the file reads.

#### Member constraints

`#[derive(Schema)]` makes `#[simple(…)]` legal on a member and checks what is
written in it. The grammar is grouped, the way the Rust ecosystem spells it:

```rust
use simpleplatform_sdk::prelude::*;

/// The leads to consider.
#[derive(Deserialize, Schema)]
struct Input {
    /// The leads to close, by identifier.
    #[simple(length(min = 1, max = 500))]
    ids: Vec<String>,

    /// How far back to look for activity.
    #[simple(range(min = 1, max = 90))]
    days: u32,

    /// Consider only leads whose reference starts here.
    #[simple(pattern = "^KNOW", length(max = 64))]
    prefix: Option<String>,

    /// Where to send the summary.
    #[simple(format = "email", default = "nobody@example.com", example = "a@b.co")]
    notify: String,

    /// Kept for callers that still send it.
    #[simple(deprecated)]
    legacy: bool,
}
```

| Written                    | Applies to              | Becomes                                                                        |
| -------------------------- | ----------------------- | ------------------------------------------------------------------------------ |
| `range(min = …, max = …)`  | numbers                 | `minimum` / `maximum`                                                          |
| `length(min = …, max = …)` | strings and collections | `minLength` / `maxLength` on a string, `minItems` / `maxItems` on a collection |
| `pattern = "…"`            | strings                 | `pattern`                                                                      |
| `format = "…"`             | strings                 | `format`                                                                       |
| `default = …`              | any member              | `default`                                                                      |
| `example = …`              | any member              | `example`                                                                      |
| `deprecated`               | any member              | `deprecated`                                                                   |

`length` is type-directed: the same two bounds mean characters on a `String` and
elements on a `Vec<T>`, so there is one length to remember rather than two.
Either bound may be written on its own, and equal bounds are a single accepted
value.

Several constraints go in one attribute, separated by commas, or in attributes
of their own — `#[simple(pattern = "^KNOW", length(max = 64))]` and
`#[simple(pattern = "^KNOW")] #[simple(length(max = 64))]` are the same thing.
Either way each constraint is written once per member. Structs, tuple structs
and enums all carry them, and a generic type needs no bounds.

Three things are deliberately absent from `#[simple(…)]`, because each already
has one place:

- **The description** is the doc comment on the member — the `///` line above it,
  and there is one place to write it.
- **Requiredness** is the type. A member is optional when it is `Option<T>` or
  carries `#[serde(default)]`, and required otherwise, so the signature and the
  schema cannot disagree.
- **The property name** is what `serde` says it is. `#[serde(rename = "…")]` and
  `#[serde(rename_all = "…")]` name the property, so the name on the wire and
  the name serde reads are the same name.

The derive generates nothing at all: a member that carries constraints costs a
built module exactly what a member without them costs. What it does is read what
was written, so a bound in the wrong shape is a compile error at the span that
holds it, with the accepted grammar in the message.

### AI Module

The AI module works on unstructured data: a document handle, a piece of text, or
an object you already hold.

#### Extract Structured Data

The schema is the contract the answer is held to, and the type parameter is what
that answer is decoded into — so an extraction lands in your own struct:

```rust
#[derive(Deserialize)]
struct Invoice {
    number: String,
    total: f64,
}

let read: Execution<Invoice> = simple::ai::extract(
    json!({ "file_hash": "9f2c…", "mime_type": "application/pdf" }),
    "Read the invoice number and the total.",
    json!({
        "type": "object",
        "properties": {
            "number": { "type": "string" },
            "total": { "type": "number" }
        },
        "required": ["number", "total"]
    }),
    Options::default(),
)?;

read.data.total; // 240.0, as an f64, because that is what Invoice declares
read.metadata.input_tokens; // what the run cost, without a second call
```

Every operation answers with an `Execution<T>`: the data, and the `Metadata`
beside it.

#### Summarize Content

```rust
let written = simple::ai::summarize(
    json!({ "file_hash": "3a91…", "mime_type": "application/pdf" }),
    "Summarise what was agreed, in one sentence.",
    Options {
        model: Some(simple::ai::Model::Large),
        ..Options::default()
    },
)?;

written.data; // "A refund was agreed."
```

#### Transcribe Audio/Video

The prompt and the schema are written for you from what you ask for, which is
why the answer is a `Transcript` rather than a type you have to name:

```rust
let heard = simple::ai::transcribe(
    json!({ "file_hash": "c07b…", "mime_type": "audio/mpeg" }),
    TranscribeOptions {
        include_transcript: true,
        include_timestamps: true,
        summarize: true,
        participants: simple::ai::Participants::Named(vec![
            "Customer".to_string(),
            "Agent".to_string(),
        ]),
    },
    Options::default(),
)?;

heard.data.language; // "en"
heard.data.transcript; // Some("[00:15] Customer: My order is late…")
heard.data.summary; // Some("The customer was refunded.")
```

#### The Face Collection

`simple::ai::enroll_face` adds a face under the subject it belongs to and
answers with its id, `simple::ai::search_face` finds the matches for an image,
and `simple::ai::delete_face` removes faces by the ids they were enrolled under:

```rust
let face_id = simple::ai::enroll_face("EMP-42", json!("iVBORw0KGgo…"))?;

let found: Value = simple::ai::search_face(
    json!("iVBORw0KGgo…"),
    FaceSearch {
        max_faces: Some(3),
        similarity_threshold: Some(92.5),
    },
)?;

let removed = simple::ai::delete_face(&[face_id])?;
```

A document handle whose file is still pending is uploaded before the operation
runs, and the operation is given the handle that upload answered with. Nothing
at a call site changes: pass the handle you were given.

### GraphQL Module

Reads and writes are separate calls, and which one you call is the declaration
of intent:

```rust
// A read.
let open: Open = simple::graphql::query(OPEN_INVOICES, json!({ "id": id }))?;

// A write.
let closed: Value = simple::graphql::mutate(CLOSE_LEAD, json!({ "id": id }))?;
```

Each reports its own outcome, so a failure says which kind of call produced it
without the action having to describe it.

### HTTP Module

The answer is the response body, read into the type the call site asked for. A
body the service sent as JSON is read as JSON; one it sent as text is what an
answer type of `String` receives; and a body with nothing in it reads as null,
which is what `()` and `Option<_>` receive.

```rust
// A read. Most calls carry no headers, so most calls are one line.
let rate: Rate = simple::http::get("https://api.example.com/rates/eur")?;

// A write.
let created: Value = simple::http::post(
    "https://api.example.com/leads",
    json!({ "email": "lead@example.com" }),
)?;
```

`put`, `patch` and `delete` are there too. A call that carries headers, or that
wants a method named alongside them, builds an `http::Request` — every field has
a default, so a literal names the ones it sets:

```rust
let updated: Value = simple::http::fetch(simple::http::Request {
    url: "https://api.example.com/leads/L1".to_string(),
    method: simple::http::Method::Patch,
    headers: simple::http::headers(&[("Authorization", "Bearer token123")]),
    body: Some(json!({ "status": "qualified" })),
})?;
```

An outbound request keeps its module path, the way everything a call chooses
does, so this adds no import line. It also keeps the two `Request`s apart: the
bare `Request<T>` a handler takes is the prelude's, and the one a call builds is
`simple::http::Request`, so a handler that builds an outbound request writes both
in the same file and each reads as what it is.

Three outcomes, told apart at the call site by the variant they match on and the
code they report:

| What happened                          | Variant         | Code                       |
| -------------------------------------- | --------------- | -------------------------- |
| the request produced no answer         | `Error::Host`   | `ACTION_FAILED`            |
| the service answered outside 2xx       | `Error::Domain` | `HTTP_STATUS_<status>`     |
| the answer did not fit the answer type | `Error::Json`   | `HTTP_RESPONSE_UNREADABLE` |

So a 404 and an unreachable service are two different things to an action, and
the status a service refused on travels in the code, the message and the details.

### Settings Module

Read the settings an application was configured with, into your own type:

```rust
#[derive(Deserialize)]
struct Billing {
    region: String,
    retries: u8,
}

let billing: Billing = simple::settings::get("dev.simple.myapp", &["region", "retries"])?;

billing.region; // "eu-west"
billing.retries; // 3, as a u8, because that is what Billing declares
```

The keys asked for and the fields read back are declared together, and a value
that does not fit the declaration is reported once, at the call. When the keys
are chosen at runtime, ask for a `Value` and the map arrives exactly as it was
sent — same call, same wire, and the type on the left decides:

```rust
let settings: Value = simple::settings::get("dev.simple.myapp", &[chosen])?;
```

### Storage Module

Two ways in — bytes this action already holds, and a file behind a URL — and one
thing out of both: a `DocumentHandle`, which is the value a `:document` field
holds.

```rust
let handle = simple::storage::upload_buffer(
    &rendered,
    "invoice.pdf",
    "application/pdf",
    Target::new("dev.simple.myapp", "documents", "attachment"),
)?;

let handle = simple::storage::upload_external(
    Source::url("https://example.com/invoice.pdf")
        .with_auth(simple::storage::Auth::bearer("your-token-here")),
    Target::new("dev.simple.myapp", "documents", "attachment"),
)?;

handle.file_hash; // the SHA-256 of the contents, which is the file's identity
handle.mime_type; // "application/pdf"
handle.size; // the size in bytes
```

The store is addressed by content, so identical bytes land under the identical
hash and are kept once: uploading a file the store already holds answers with the
handle that was already there.

Storing the file and attaching it are separate steps, and attaching it is the
one that changes tenant data — write the handle into the `:document` field with
`simple::graphql::mutate` once you have it. A credential is rendered by its
`Debug` as its scheme and its username, so a token never lands in a log line.

### Errors

`Error` is a typed enum and `Code` holds the canonical vocabulary. Build one
directly when an action wants to be specific:

```rust
return Err(Error::invalid("customer_id is required")
    .hint("Pass the customer's id as a string."));
```

`message` and `hint` each travel within 1000 bytes and are cut on a character
boundary, so what arrives is always valid UTF-8.

### Testing Module

Install a closure in place of the host and call your handler directly:

```rust
#[test]
fn it_totals_the_open_invoices() {
    let session = simple::testing::install(|name, params| {
        assert_eq!(name, "action:db/execute");
        assert_eq!(params["variables"]["id"], json!("CUS1"));

        Ok(json!({ "invoices": [{ "amount": 12.5 }, { "amount": 7.5 }] }))
    });

    let output = handler(Request::new(Input { customer_id: "CUS1".into() })).unwrap();

    assert_eq!(output.total, 20.0);
    assert_eq!(session.calls().len(), 1);
}
```

`simple::run` also works under a session, so a test can assert the exact
`__done__` document the platform reads — `session.done()`.

```bash
simple test com.mycompany.crm -a close-duplicate-lead
```

runs all of it on the host. No wasm, no toolchain, no emulator. Add `--coverage`
when you want the report.

---

## Development

This section is for contributors to this crate. An action author builds and
tests with `simple build` and `simple test`, above.

### The two artifacts

Two artifacts from one source. Each declares exactly the imports its host binds,
which is why there are two build lines rather than one.

This crate is a library, and linking it into a binary is what emits a `.wasm`
module — an example here, an action in production. `--examples` is on these
lines so that the modules exist to be inspected.

```sh
# The server build. Answers a host call synchronously.
cargo build --target wasm32-wasip1 --release --examples

# The browser build. A host call parks the module; wasm-opt resumes it.
cargo build --target wasm32-wasip1 --release --features async --examples
wasm-opt build/release.ori.async.wasm \
  -Oz --disable-gc \
  --enable-bulk-memory --enable-bulk-memory-opt --enable-sign-ext \
  --enable-nontrapping-float-to-int --enable-multivalue --enable-reference-types \
  --asyncify --pass-arg=asyncify-imports@simple.__call \
  -o build/release.async.wasm
```

**Pass the `--enable-*` flags.** Rust's `wasm32-wasip1` target emits bulk memory,
sign extension and friends by default, and binaryen validates a module against
the features it has been told to enable. These flags are the ones this crate's
output uses, so they are what `wasm-opt` needs in order to accept and optimise
it.

### Checks

```sh
cargo test                                                   # host, no wasm
cargo test --doc                                             # every example compiles
RUSTDOCFLAGS=-Dwarnings cargo doc --no-deps --workspace       # the rendered docs
cargo fmt --check
cargo clippy --all-targets -- -D warnings                    # host
cargo clippy --all-targets --features async -- -D warnings   # host, async cfg
cargo clippy --target wasm32-wasip1 --lib --examples -- -D warnings
cargo clippy --target wasm32-wasip1 --lib --examples --features async -- -D warnings
cargo build --target wasm32-wasip1 --release --examples
cargo build --target wasm32-wasip1 --release --features async --examples
```

Run them from `sdks/rust`. This directory is a two-crate workspace — the SDK and
the `Schema` derive in `macros/` — and `default-members` names both, so one
command covers the pair.

CI additionally reads the import section out of both built modules and asserts
each declares exactly what its host binds — six names for the server, four for
the browser — and that the two sets differ. The guarantee then rests on the
modules themselves rather than on the builds having been run.

`--all-targets` is deliberately absent from the two wasm lines: the tests are
host-only by design, and asking clippy to build them for wasm asks it to build
`testing`, which is not compiled there.

### The examples are the acceptance tests

`examples/load_knowledge.rs` builds for `wasm32-wasip1` as a real action does,
and its own `#[cfg(test)] mod tests` runs under `cargo test`.
`examples/close_duplicate_lead.rs` is a second action written against the crate:
two host calls — a read, then a write — and several ways to refuse.
`examples/file_expense_receipt.rs` is the modules composing in one handler —
settings for the policy, storage for the file, AI for what the file says, and
GraphQL for the record — with the same `DocumentHandle` travelling through all
four.

`macros/tests/ui/` holds the derive's compile-error suite: one file per
diagnostic, each recording the exact message and span an author sees.
`TRYBUILD=overwrite cargo test -p simpleplatform-sdk-macros` re-records them.

## License

Apache-2.0. See [LICENSE](../../LICENSE) at the repository root.
