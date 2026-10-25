# `simpleplatform-sdk-macros`

> Member constraints for Simple Platform actions written in Rust

This crate is an implementation detail of
[`simpleplatform-sdk`](https://crates.io/crates/simpleplatform-sdk). Depend on
that instead — it re-exports everything here, so an action names one dependency
and writes one import line.

```bash
cargo add simpleplatform-sdk
```

```rust
use simpleplatform_sdk::prelude::*;

#[derive(Deserialize, Schema)]
struct Payload {
    /// The customer to total.
    #[simple(length(min = 1, max = 64))]
    customer_id: String,

    /// How far back to look.
    #[simple(range(min = 1, max = 90))]
    days: Option<u32>,
}
```

`#[derive(Schema)]` generates no code. It makes `#[simple(...)]` a legal
attribute and checks what is written in it, so a mistake is a compile error with
the accepted grammar in the message. The schema itself is read from the source.

## The grammar

| written                    | what it constrains                                         |
| -------------------------- | ---------------------------------------------------------- |
| `range(min = …, max = …)`  | how large a number may be                                  |
| `length(min = …, max = …)` | how long a string is, or how many items a collection holds |
| `pattern = "…"`            | the shape of a string                                      |
| `format = "…"`             | the kind of string, such as `email`                        |
| `default = …`              | the value used when none is sent                           |
| `example = …`              | a value worth showing                                      |
| `deprecated`               | that a member is on its way out                            |

Whether a member is required is its **type**, not a key here: write `Option<T>`
or `#[serde(default)]` to make it optional, and neither to require it. A
member's description is its doc comment.

## License

Apache-2.0. See [LICENSE](../../../LICENSE) at the repository root.
