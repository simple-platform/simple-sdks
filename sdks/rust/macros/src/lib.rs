//! The derive that makes `#[simple(…)]` legal, and checks what is written in it.
//!
//! An action depends on `simpleplatform-sdk` and reaches this crate through it.
//! `use simpleplatform_sdk::prelude::*;` brings [`Schema`] into scope, and the
//! `simple` helper attribute comes with it.

#![deny(missing_docs)]
#![deny(unsafe_code)]
#![deny(rustdoc::broken_intra_doc_links)]

mod constraints;

use proc_macro::TokenStream;
use syn::{parse_macro_input, DeriveInput};

/// Constraints on the members of an action's input or output type.
///
/// ```
/// use simpleplatform_sdk_macros::Schema;
///
/// #[derive(Schema)]
/// struct Payload {
///     /// Doc comment becomes the description.
///     #[simple(length(min = 1, max = 500))]
///     ids: Vec<String>,
///
///     /// How many days back to look.
///     #[simple(range(min = 1, max = 90))]
///     days: u32,
///
///     /// Only keys starting here.
///     #[simple(pattern = "^KNOW", length(max = 64))]
///     prefix: String,
/// }
/// ```
///
/// # What this derive generates
///
/// Nothing. It expands to an empty token stream, so a member that carries
/// constraints costs a built module exactly what a member without them costs.
/// Its whole job is the two things a derive is uniquely able to do: register
/// `simple` as an inert helper attribute, so writing one is legal Rust, and
/// read what was written, so a mistake in one is a compile error at the span
/// that holds it.
///
/// # The constraints
///
/// | written | applies to | becomes |
/// |---|---|---|
/// | `range(min = …, max = …)` | numbers | `minimum` / `maximum` |
/// | `length(min = …, max = …)` | strings and collections | `minLength` / `maxLength` on a string, `minItems` / `maxItems` on a collection |
/// | `pattern = "…"` | strings | `pattern` |
/// | `format = "…"` | strings | `format` |
/// | `default = …` | any member | `default` |
/// | `example = …` | any member | `example` |
/// | `deprecated` | any member | `deprecated` |
///
/// `length` is type-directed: the same two bounds mean characters on a
/// `String` and elements on a `Vec<T>`, so there is one length to remember
/// rather than two.
///
/// Several constraints go in one attribute, separated by commas, or in
/// attributes of their own — `#[simple(pattern = "^KNOW", length(max = 64))]`
/// and `#[simple(pattern = "^KNOW")] #[simple(length(max = 64))]` are the same
/// thing. Either way each constraint is written once per member.
///
/// # What is *not* written here
///
/// - **The description** is the doc comment. `/// Collection identifiers.`
///   above the member is the description, and there is one place to write it.
/// - **Requiredness** is the type. A member is optional when it is `Option<T>`
///   or carries `#[serde(default)]`, and required otherwise, so the signature
///   and the schema cannot disagree.
/// - **The property name** is what `serde` says it is. `#[serde(rename = "…")]`
///   and `#[serde(rename_all = "…")]` name the property, so the name on the
///   wire and the name serde reads are the same name.
#[proc_macro_derive(Schema, attributes(simple))]
pub fn schema(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);

    match constraints::check(&input) {
        Ok(()) => TokenStream::new(),
        Err(error) => error.into_compile_error().into(),
    }
}
