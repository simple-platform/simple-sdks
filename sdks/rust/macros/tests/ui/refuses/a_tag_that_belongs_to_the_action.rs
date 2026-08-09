//! The action's own tags, written on a member.

#![allow(dead_code)]

use simpleplatform_sdk_macros::Schema;

#[derive(Schema)]
struct Payload {
    #[simple(short_desc = "The days to look back over.")]
    days: u32,

    #[simple(when_use = "Looking back over a window.")]
    window: u32,

    #[simple(tool)]
    ids: Vec<String>,
}

fn main() {}
