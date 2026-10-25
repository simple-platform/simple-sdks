//! `deprecated` is written on its own.

#![allow(dead_code)]

use simpleplatform_sdk_macros::Schema;

#[derive(Schema)]
struct Payload {
    #[simple(deprecated = true)]
    legacy: bool,
}

fn main() {}
