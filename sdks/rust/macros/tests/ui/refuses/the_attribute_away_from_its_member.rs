//! `#[simple(…)]` constrains a member, so it is written on one.

#![allow(dead_code)]

use simpleplatform_sdk_macros::Schema;

#[derive(Schema)]
#[simple(length(max = 64))]
struct Payload {
    days: u32,
}

#[derive(Schema)]
enum Choice {
    #[simple(length(max = 8))]
    Named { name: String },
}

fn main() {}
