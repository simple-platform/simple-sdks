//! A member's description is its doc comment, and only its doc comment.

#![allow(dead_code)]

use simpleplatform_sdk_macros::Schema;

#[derive(Schema)]
struct Payload {
    #[simple(description = "How many days back to look.")]
    days: u32,
}

fn main() {}
