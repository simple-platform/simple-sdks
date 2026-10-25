//! `range` and `length` take a group of bounds; `pattern` and `format` take a
//! value. Each written as the other.

#![allow(dead_code)]

use simpleplatform_sdk_macros::Schema;

#[derive(Schema)]
struct Payload {
    #[simple(range = 1)]
    days: u32,

    #[simple(length)]
    ids: Vec<String>,

    #[simple(pattern("^KNOW"))]
    prefix: String,
}

fn main() {}
