//! Every constraint, in every shape it is written in.

#![allow(dead_code)]

use simpleplatform_sdk_macros::Schema;

#[derive(Schema)]
struct Payload {
    /// Doc comment becomes the description.
    #[simple(length(min = 1, max = 500))]
    ids: Vec<String>,

    /// How many days back to look.
    #[simple(range(min = 1, max = 90))]
    days: u32,

    /// Two constraints in one attribute.
    #[simple(pattern = "^KNOW", length(max = 64))]
    prefix: String,

    /// The same two, in attributes of their own.
    #[simple(pattern = "^LEAD")]
    #[simple(length(min = 4))]
    reference: String,

    /// A bound on one side only.
    #[simple(range(max = 1000))]
    limit: u64,

    /// Numbers that are not whole, and numbers below zero.
    #[simple(range(min = -273.15, max = 1000.5))]
    celsius: f64,

    /// Equal bounds are a single accepted value, not a contradiction.
    #[simple(range(min = 7, max = 7), length(min = 0, max = 0))]
    exact: String,

    /// A format, a default and an example.
    #[simple(format = "email", default = "nobody@example.com", example = "a@b.co")]
    address: String,

    /// Values that are not strings.
    #[simple(default = 30, example = -1)]
    offset: i32,

    /// Written on its own, with no value.
    #[simple(deprecated)]
    legacy: bool,

    /// Every constraint at once.
    #[simple(
        range(min = 0, max = 10),
        length(min = 1, max = 2),
        pattern = "^a",
        format = "uuid",
        default = 1,
        example = 2,
        deprecated
    )]
    everything: String,

    /// A member with no constraints at all.
    untouched: Option<String>,
}

/// A tuple struct constrains its members by position.
#[derive(Schema)]
struct Pair(#[simple(range(min = 1))] u32, #[simple(length(max = 3))] String);

/// An enum carries constraints on the members of its variants.
#[derive(Schema)]
enum Choice {
    Nothing,
    Named {
        #[simple(length(min = 1))]
        name: String,
    },
    One(#[simple(range(max = 5))] u8),
}

/// A generic type needs no bounds, because nothing is generated.
#[derive(Schema)]
struct Wrapper<T> {
    #[simple(length(min = 1))]
    items: Vec<T>,
}

fn main() {
    let _ = Payload {
        ids: Vec::new(),
        days: 1,
        prefix: String::new(),
        reference: String::new(),
        limit: 0,
        celsius: 0.0,
        exact: String::new(),
        address: String::new(),
        offset: 0,
        legacy: false,
        everything: String::new(),
        untouched: None,
    };

    let _ = Pair(1, String::new());
    let _ = Choice::Nothing;
    let _ = Choice::Named { name: String::new() };
    let _ = Choice::One(1);
    let _ = Wrapper::<u8> { items: Vec::new() };
}
