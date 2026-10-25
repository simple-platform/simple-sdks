//! Whether a member has to be sent is its type. There is no key for it, so the
//! signature and the schema say one thing.

use simpleplatform_sdk_macros::Schema;

#[derive(Schema)]
struct Input {
    /// Quote against this date rather than today.
    #[simple(required = false)]
    as_of: Option<String>,

    /// Whether to round the answer.
    #[simple(optional)]
    round: bool,

    /// Who to notify.
    #[simple(nullable = true)]
    notify: String,
}

fn main() {}
