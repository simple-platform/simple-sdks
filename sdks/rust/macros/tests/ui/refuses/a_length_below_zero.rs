//! A length counts things, so it is never below zero.

#![allow(dead_code)]

use simpleplatform_sdk_macros::Schema;

#[derive(Schema)]
struct Payload {
    #[simple(length(min = -1))]
    ids: Vec<String>,
}

fn main() {}
