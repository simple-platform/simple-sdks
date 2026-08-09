//! A constraint that is not one, spelled close enough to say which was meant.

#![allow(dead_code)]

use simpleplatform_sdk_macros::Schema;

#[derive(Schema)]
struct Payload {
    #[simple(rnage(min = 1))]
    days: u32,

    #[simple(collection = "leads")]
    source: String,
}

fn main() {}
