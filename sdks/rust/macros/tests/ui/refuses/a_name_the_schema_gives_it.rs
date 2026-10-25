//! The words a constraint puts in the schema, written back on the member. Each
//! one names the constraint that writes it.

use simpleplatform_sdk_macros::Schema;

#[derive(Schema)]
struct Input {
    /// The refund, by identifier.
    #[simple(minLength = 5)]
    refund_id: String,

    /// The currency code.
    #[simple(max_length = 3)]
    code: String,

    /// The leads to close.
    #[simple(minItems = 1)]
    ids: Vec<String>,

    /// How many days back to look.
    #[simple(minimum = 1)]
    days: u32,

    /// How many days back at most.
    #[simple(maximum = 90)]
    back: u32,
}

fn main() {}
