//! What an author sees when they get `#[simple(…)]` wrong.
//!
//! Every file under `refuses/` is a mistake someone will make, and every one has
//! a `.stderr` beside it holding the whole diagnostic: the message word for
//! word, the file, the line, the column and the span underlined beneath the
//! source. Compiling it is what produces that diagnostic, so the recorded file
//! is the error as an author actually reads it — not a description of it.
//!
//! Every file under `accepts/` is written correctly and compiles and runs. They
//! are what keeps the refusals honest: an attribute that refuses everything
//! would pass every test in `refuses/` and none of these.
//!
//! To re-record the `.stderr` files after changing a message:
//!
//! ```text
//! TRYBUILD=overwrite cargo test -p simpleplatform-sdk-macros
//! ```

#[test]
fn the_grammar_is_accepted_and_a_mistake_in_it_is_a_compile_error() {
    let cases = trybuild::TestCases::new();

    cases.pass("tests/ui/accepts/*.rs");
    cases.compile_fail("tests/ui/refuses/*.rs");
}
