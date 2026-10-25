//! Bounds that cross, so nothing at all satisfies them.

#![allow(dead_code)]

use simpleplatform_sdk_macros::Schema;

#[derive(Schema)]
struct Payload {
    #[simple(range(min = 10, max = 1))]
    days: u32,

    #[simple(length(min = 500, max = 1))]
    ids: Vec<String>,
}

fn main() {}
