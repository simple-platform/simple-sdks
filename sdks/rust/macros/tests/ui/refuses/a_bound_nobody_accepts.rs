//! A bound inside `range` or `length` that is not `min` or `max`.

#![allow(dead_code)]

use simpleplatform_sdk_macros::Schema;

#[derive(Schema)]
struct Payload {
    #[simple(range(minimum = 1))]
    days: u32,

    #[simple(length(exactly = 3))]
    ids: Vec<String>,
}

fn main() {}
