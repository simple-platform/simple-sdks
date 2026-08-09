//! Write Simple platform actions in Rust.
//!
//! ```no_run
//! use simpleplatform_sdk::prelude::*;
//!
//! #[derive(Deserialize)]
//! struct Input {
//!     customer_id: String,
//! }
//!
//! #[derive(Deserialize)]
//! struct Open {
//!     invoices: Vec<Invoice>,
//! }
//!
//! #[derive(Deserialize)]
//! struct Invoice {
//!     amount: f64,
//! }
//!
//! #[derive(Serialize)]
//! struct Output {
//!     customer_id: String,
//!     total: f64,
//! }
//!
//! const OPEN_INVOICES: &str = r#"
//!   query Open($id: ID!) {
//!     invoices: crm__invoice(where: {customer_id: {_eq: $id}, status: {_eq: "open"}}, limit: 500) {
//!       amount
//!     }
//!   }"#;
//!
//! fn main() {
//!     simple::run(|request: Request<Input>| {
//!         let open: Open =
//!             simple::graphql::query(OPEN_INVOICES, json!({ "id": request.data.customer_id }))?;
//!
//!         Ok(Output {
//!             total: open.invoices.iter().map(|invoice| invoice.amount).sum(),
//!             customer_id: request.data.customer_id,
//!         })
//!     })
//! }
//! ```
//!
//! No lifetimes, no `async`, no `unsafe`, no envelope, no context threading, one
//! import line.
//!
//! # Describing an action
//!
//! What an action is, and what its input looks like, is written where the code
//! is — in the doc comments and on the members themselves. There is nothing to
//! keep in step by hand.
//!
//! Three tags describe the action, written with `///` in the doc comment above
//! the handler — the same comment that carries its description:
//!
//! ```text
//! /// Close a duplicate lead and point it at the record that survives.
//! ///
//! /// The surviving lead keeps its activity; the duplicate is marked closed
//! /// and linked to it, so a later report still reaches both.
//! ///
//! /// @tool
//! /// @shortdesc Close a duplicate lead, pointing it at the surviving record.
//! /// @usewhen A lead is a duplicate of one already in the system.
//! /// @usewhen Two leads share a contact and one should be retired.
//! fn handler(request: Request<Input>) -> Result<Output, Error> { /* ... */ }
//! ```
//!
//! - `@tool` — bare, with no value. It marks the action as one that can be
//!   reached as a tool.
//! - `@shortdesc` — one line, up to 300 characters. What this is, read in a
//!   listing of tools.
//! - `@usewhen` — one line, up to 100 characters, written up to ten times. One
//!   occasion each, for reaching for this rather than something else.
//!
//! The prose above the tags stays as written, and is the full description.
//!
//! [`Schema`] describes the members, and [the derive's own
//! documentation](Schema) is the reference for it:
//!
//! ```
//! use simpleplatform_sdk::prelude::*;
//!
//! /// The leads to consider.
//! #[derive(Deserialize, Schema)]
//! struct Input {
//!     /// The leads to close, by identifier.
//!     #[simple(length(min = 1, max = 500))]
//!     ids: Vec<String>,
//!
//!     /// How far back to look for activity.
//!     #[simple(range(min = 1, max = 90))]
//!     days: u32,
//!
//!     /// Consider only leads whose reference starts here.
//!     #[simple(pattern = "^KNOW", length(max = 64))]
//!     prefix: Option<String>,
//! }
//! ```
//!
//! `#[derive(Schema)]` generates nothing at all. It makes `#[simple(…)]` legal
//! to write and checks what is written in it, so a bound in the wrong shape is
//! a compile error at the span that holds it rather than a surprise later.
//!
//! Three things are deliberately absent from `#[simple(…)]`, because each has
//! one place already:
//!
//! - **The description** is the doc comment on the member.
//! - **Requiredness** is the type: optional when `Option<T>` or
//!   `#[serde(default)]`, required otherwise.
//! - **The property name** is `serde`'s: `#[serde(rename = "…")]` and
//!   `#[serde(rename_all = "…")]`.
//!
//! # What this crate takes on so an action does not
//!
//! Rust is a hard language and an action is a small piece of business logic.
//! Resolving that tension is this crate's job:
//!
//! | Rust difficulty | who deals with it |
//! |---|---|
//! | lifetimes and borrows | nothing in the public surface carries one |
//! | `async`, executors, `Pin` | a handler is a plain `fn`; asyncify is a build flag |
//! | `unsafe`, raw pointers, the ABI | `abi.rs`, behind [`host::Transport`] |
//! | `allocate_buffer`, memory | [`run`] owns it |
//! | a panic inside a guest | the panic hook reports a failure envelope |
//! | `Box<dyn Error>` conversion noise | `?` converts anything into [`Error`] |
//! | choosing an error crate | there is one [`Error`], and it ships here |
//! | forgetting to report a result | [`run`] guarantees exactly one `__done__` |
//! | naming a failure the platform can file | [`Code`] is the vocabulary |
//! | writing a mock host in every action | [`testing`] |
//!
//! # The parts
//!
//! - [`run`] — the entry point, and the one report it makes.
//! - [`Request`] — a payload already parsed into your own input type.
//! - [`Error`] and [`Code`] — one error type, one failure vocabulary.
//! - [`Schema`] — the constraints on a member, checked as you write them.
//! - [`testing`] — a host on your own machine, with no wasm anywhere.
//!
//! Five modules reach the platform, and each answers with the type the call site
//! asked for:
//!
//! - [`graphql`] — reading and writing tenant data.
//! - [`http`] — calling a service outside the platform.
//! - [`ai`] — extracting, summarising, transcribing, and the face collection.
//! - [`settings`] — the settings an application was configured with.
//! - [`storage`] — putting a file into the platform's store, and the
//!   [`DocumentHandle`] that comes back.
//!
//! They compose in one handler: read the configuration with [`settings`], store
//! a file with [`storage`], read what it says with [`ai`], and write the record
//! with [`graphql`] — one `?` between each, and one [`Error`] out of all of them.
//! `examples/file_expense_receipt.rs` is that action, written out.
//!
//! # Building an action
//!
//! Two artifacts from one source. The default build is for the server, which
//! answers a host call synchronously:
//!
//! ```text
//! cargo build --target wasm32-wasip1 --release
//! ```
//!
//! The `async` build is for the browser, where a host call parks the module and
//! `wasm-opt --asyncify` resumes it:
//!
//! ```text
//! cargo build --target wasm32-wasip1 --release --features async
//! wasm-opt release.ori.async.wasm -Oz --disable-gc \
//!   --enable-bulk-memory --enable-bulk-memory-opt --enable-sign-ext \
//!   --enable-nontrapping-float-to-int --enable-multivalue --enable-reference-types \
//!   --asyncify --pass-arg=asyncify-imports@simple.__call -o release.async.wasm
//! ```
//!
//! The `--enable-*` flags are required: Rust's `wasm32-wasip1` target enables
//! bulk memory and friends by default, and binaryen validates the features it is
//! told about.
//!
//! The two builds declare different imports, which is what the `async` feature
//! selects for you. See `src/abi.rs`.

#![deny(missing_docs)]
#![deny(unsafe_code)]
#![deny(rustdoc::broken_intra_doc_links)]

#[allow(unsafe_code)]
#[cfg(target_arch = "wasm32")]
mod abi;

pub mod ai;
pub mod codes;
mod envelope;
mod error;
pub mod graphql;
pub mod host;
pub mod http;
mod run;
pub mod settings;
pub mod storage;

#[cfg(not(target_arch = "wasm32"))]
pub mod testing;

pub use crate::codes::{Category, Code};
pub use crate::error::{Error, Fault};
pub use crate::host::Transport;
pub use crate::run::{run, Context, Headers, Logic, Request, Tenant, User};

/// A stored file, re-exported from [`storage`].
///
/// It is here because it belongs to more than one module: [`storage`] answers
/// with it, [`ai`] reads one, [`graphql`] writes one into a `:document` field,
/// and an action names it in its own output type. The definition and its
/// documentation live in [`storage`].
pub use crate::storage::DocumentHandle;

/// Constraints on the members of an action's types, re-exported.
///
/// The derive lives in its own crate, because a crate that defines a procedural
/// macro may export only macros. An action never names that crate: it depends
/// on this one, whose default `derive` feature brings the derive in and puts it
/// here and in the [`prelude`], so `use simpleplatform_sdk::prelude::*;` is
/// still the whole import list. The `simple` helper attribute comes with it.
///
/// An action that writes no constraints turns the feature off with
/// `default-features = false`, and then compiles no procedural macro at all.
#[cfg(feature = "derive")]
pub use simpleplatform_sdk_macros::Schema;

/// `serde`, re-exported.
///
/// An action normally depends on `serde` itself — the generated `Cargo.toml`
/// lists it — because a `#[derive(Deserialize)]` expands to code that names the
/// crate. This re-export is here for an action that would rather not, and can
/// write `#[serde(crate = "simpleplatform_sdk::serde")]` instead.
pub use serde;

/// `serde_json`, re-exported, for the same reason as [`serde`].
pub use serde_json;

/// Everything an action needs, in one line.
///
/// ```
/// use simpleplatform_sdk::prelude::*;
/// ```
///
/// That brings in [`simple`](crate) itself — so a call reads `simple::run`,
/// `simple::graphql::query` and `simple::http::get` — along with [`Request`],
/// [`Error`], [`Value`](serde_json::Value), the [`json!`](serde_json::json)
/// macro, the two serde derives, and [`Schema`], which carries the
/// `#[simple(…)]` attribute with it.
///
/// # What a module puts here, and what it keeps
///
/// A module's types stay in the module. The exception is a type an action has
/// to write down in order to make the call — the ones that appear in a public
/// signature, which are the options a call takes and the value it answers with:
/// [`ai::Options`], [`ai::TranscribeOptions`], [`ai::FaceSearch`],
/// [`ai::Execution`], [`storage::Source`], [`storage::Target`] and
/// [`DocumentHandle`].
///
/// What a call chooses *inside* one of those is reached through its own module
/// and needs no import, because [`simple`](crate) is already in scope:
/// `simple::ai::Model::Large`, `simple::ai::Participants::Detect`,
/// `simple::storage::Auth::bearer("t-1234")`. A settings read names no type at
/// all, and neither do the five HTTP method functions.
///
/// [`http::Request`] is the one signature type that stays in its module, so that
/// `Request` here always means the request an action was called with. An
/// outbound request is written under the module it belongs to —
/// `use simpleplatform_sdk::http;`, then `http::fetch(http::Request { .. })` —
/// which keeps both names available in the same file, each meaning one thing.
pub mod prelude {
    pub use crate as simple;

    pub use crate::ai::{Execution, FaceSearch, Options, TranscribeOptions};
    pub use crate::codes::{Category, Code};
    pub use crate::error::Error;
    pub use crate::run::{Context, Request};
    pub use crate::storage::{DocumentHandle, Source, Target};

    #[cfg(feature = "derive")]
    pub use crate::Schema;

    pub use serde::{Deserialize, Serialize};
    pub use serde_json::{json, Value};
}
