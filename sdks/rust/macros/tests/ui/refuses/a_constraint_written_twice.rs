//! The same constraint twice on one member, in one attribute and across two.

#![allow(dead_code)]

use simpleplatform_sdk_macros::Schema;

#[derive(Schema)]
struct Payload {
    #[simple(range(min = 1), range(max = 90))]
    days: u32,

    #[simple(length(max = 8))]
    #[simple(length(max = 16))]
    prefix: String,

    #[simple(range(min = 1, min = 2))]
    limit: u64,
}

fn main() {}
