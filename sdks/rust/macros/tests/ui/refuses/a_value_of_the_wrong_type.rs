//! A bound, a pattern and a format, each given something they do not take.

#![allow(dead_code)]

use simpleplatform_sdk_macros::Schema;

#[derive(Schema)]
struct Payload {
    #[simple(length(min = "1"))]
    ids: Vec<String>,

    #[simple(range(max = true))]
    days: u32,

    #[simple(length(max = 2.5))]
    names: Vec<String>,

    #[simple(pattern = 1)]
    prefix: String,
}

fn main() {}
