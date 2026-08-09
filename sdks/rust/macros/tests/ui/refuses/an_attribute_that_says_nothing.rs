//! An attribute with no constraints in it, and one that never opened its
//! parentheses.

#![allow(dead_code)]

use simpleplatform_sdk_macros::Schema;

#[derive(Schema)]
struct Payload {
    #[simple]
    days: u32,

    #[simple()]
    ids: Vec<String>,

    #[simple = "length(max = 64)"]
    prefix: String,

    #[simple(range())]
    limit: u64,

    #[simple(pattern = "")]
    reference: String,
}

fn main() {}
