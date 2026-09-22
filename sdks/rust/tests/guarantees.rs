//! The guarantees this crate holds at its public surface, exercised from
//! outside the crate — so everything reached here is something an action author
//! can reach too.
//!
//! Each test is named for the property it holds. Between them they pin the
//! public surface, the single report a run makes, the shape of the envelope,
//! the shape numbers keep on the wire, and how a document is classified as a
//! read or a write.

use simpleplatform_sdk::prelude::*;
use simpleplatform_sdk::testing;

// ---------------------------------------------------------------------------
// The public surface
// ---------------------------------------------------------------------------

/// `abi` is private and `cfg(target_arch = "wasm32")`; `host::set`,
/// `host::transport`, `host::unwrap_reply`, `host::DONE` and `envelope` are all
/// `pub(crate)`. The only public things in `host` are the `Transport` trait and
/// its three methods. An action writes values and reads values; addresses,
/// allocations and the ambient slot are the crate's business.
///
/// This test holds that line: it uses the whole public surface, and the
/// commented lines below do not compile.
#[test]
fn the_public_surface_carries_no_pointer_no_allocation_and_no_setter() {
    // simpleplatform_sdk::abi::allocate_buffer(8);        // private module
    // simpleplatform_sdk::host::set(None);                // pub(crate)
    // simpleplatform_sdk::host::transport();              // pub(crate)
    // simpleplatform_sdk::envelope::success(json!({}));   // private module

    let _session = testing::install(|_name, _params| Ok(json!(null)));
    let error = Error::invalid("x").hint("y").details(json!({ "a": 1 }));

    assert_eq!(error.code().as_str(), "INVALID_TOOL_INPUT");
    assert!(error.body()["error"]["extensions"]["retryable"].is_boolean());
}

// ---------------------------------------------------------------------------
// The report a run makes, and how many of them there are
// ---------------------------------------------------------------------------

/// A run reports exactly once, and the first report is the one that stands.
///
/// In a guest the slot is a `OnceLock`, so a second `run` is inert: `install`
/// answers before the second handler is reached. On the test seam `install`
/// always answers `Ok`, so a second handler does run, and its result is then
/// discarded by `claim_report`. Either way the platform is told the first
/// result and nothing else. Call `run` once, from `main`.
#[test]
fn a_second_run_reports_the_first_result_and_discards_the_rest() {
    let session = testing::install(|_name, _params| Ok(json!(null))).with_request(json!({}));

    let mut ran = 0;

    simple::run(|_request: Request<Value>| {
        ran += 1;
        Ok(json!({ "n": 1 }))
    });
    simple::run(|_request: Request<Value>| {
        ran += 1;
        let _: Value =
            simple::graphql::query("query Q { rows { id } }", json!({})).unwrap_or(Value::Null);
        Ok(json!({ "n": 2 }))
    });

    assert_eq!(ran, 2, "the seam runs every handler it is given");
    assert_eq!(
        session.calls().len(),
        1,
        "and a host call the discarded handler made is a real call"
    );
    assert_eq!(
        session.done().unwrap()["data"],
        json!({ "n": 1 }),
        "only the first report survives, on both sides"
    );
}

/// A `run` nested inside a handler still produces exactly one report.
///
/// On the test seam the inner run's result is the one reported. A guest reports
/// `ACTION_FAILED` / "The action was started twice in one run." Either way one
/// report leaves the module, so keep `run` at the top of `main` and return from
/// the handler rather than starting a second one.
#[test]
fn a_run_nested_inside_a_handler_still_reports_exactly_once() {
    let session = testing::install(|_name, _params| Ok(json!(null))).with_request(json!({}));

    simple::run(|_request: Request<Value>| {
        simple::run(|_inner: Request<Value>| Ok(json!({ "from": "the inner run" })));
        Ok(json!({ "from": "the outer run" }))
    });

    assert_eq!(
        session.done().unwrap()["data"],
        json!({ "from": "the inner run" }),
        "a guest reports a started-twice failure for this handler"
    );
}

/// A guest module is built with `panic = abort`: a panic is a trap, and the
/// SDK's panic hook reports the run as failed — `ACTION_FAILED` with
/// `category: internal` — before the trap. So an action signals a refusal by
/// returning `Err`, not by unwinding.
///
/// The test seam is an ordinary host binary, where unwinding works: a handler
/// that guards a call with `catch_unwind` recovers and reports its own result.
#[test]
fn the_test_seam_unwinds_so_a_guarded_call_reports_the_handlers_own_result() {
    let session = testing::install(|_name, _params| Ok(json!(null))).with_request(json!({}));

    simple::run(|_request: Request<Value>| {
        let recovered = std::panic::catch_unwind(|| -> i32 { panic!("inner") }).is_err();
        Ok(json!({ "recovered": recovered }))
    });

    assert_eq!(
        session.done().unwrap()["data"],
        json!({ "recovered": true }),
        "a guest reports a panic as a failure rather than recovering from it"
    );
}

// ---------------------------------------------------------------------------
// Reads and writes, and how a document is classified
// ---------------------------------------------------------------------------

/// Reads and writes are separate calls: `query` carries a read, `mutate`
/// carries a write, and each accepts only its own kind of document.
///
/// The operation is read past everything GraphQL ignores ahead of the first
/// real token — whitespace, commas, a byte-order mark and comments — so a
/// document that opens with a comment is classified by its operation, like any
/// other document. A commented mutation is a mutation.
#[test]
fn a_document_that_opens_with_a_comment_is_classified_by_its_operation() {
    const COMMENTED: &str = "# close the duplicate\nmutation M { update_lead { id } }";

    let session = testing::install(|_name, _params| Ok(json!({ "update_lead": { "id": "L1" } })));

    let refused = simple::graphql::query::<Value>(COMMENTED, json!({})).unwrap_err();

    assert_eq!(refused.code().as_str(), "QUERY_NOT_ALLOWED");
    assert!(
        session.calls().is_empty(),
        "the write was not sent as a read"
    );

    let written: Value = simple::graphql::mutate(COMMENTED, json!({}))
        .expect("a commented mutation is still a mutation");

    assert_eq!(written, json!({ "update_lead": { "id": "L1" } }));
    assert_eq!(session.calls().len(), 1);
}

// ---------------------------------------------------------------------------
// The envelope
// ---------------------------------------------------------------------------

/// `message` and `hint` are held to the 1000-byte budget the platform reads
/// them with. `details` is author-supplied and is carried whole, so put in it
/// what the caller needs in order to act, and keep it to that.
#[test]
fn message_and_hint_are_bounded_and_details_is_carried_whole() {
    let rows: Vec<Value> = (0..20_000)
        .map(|n| json!({ "id": n, "pad": "xxxxxxxxxx" }))
        .collect();

    let error = Error::invalid("e".repeat(5_000))
        .hint("h".repeat(5_000))
        .details(json!({ "rows": rows }));

    let body = error.body();
    let extensions = &body["error"]["extensions"];

    assert_eq!(body["error"]["message"].as_str().unwrap().len(), 1_000);
    assert_eq!(extensions["hint"].as_str().unwrap().len(), 1_000);
    assert!(
        extensions["details"].to_string().len() > 500_000,
        "details is carried whole"
    );
}

/// A trimmed message lands on the 1000-byte budget exactly, whatever the width
/// of the characters it is made of, and never inside a character.
#[test]
fn a_trimmed_message_fits_the_budget_exactly_at_every_character_width() {
    for width in ["e", "\u{00e9}", "\u{4e16}", "\u{1f600}"] {
        let error = Error::invalid(width.repeat(2_000));
        let message = error.body()["error"]["message"]
            .as_str()
            .unwrap()
            .to_string();

        assert!(message.len() <= 1_000, "{width} overran the budget");
        assert!(message.ends_with("..."));
        assert!(std::str::from_utf8(message.as_bytes()).is_ok());
    }
}

/// Every failure the SDK can produce carries the five members the platform
/// reads, each with the type it reads them as: a filled `code`, a filled
/// `category`, a JSON boolean `retryable`, an object `details` and a string
/// `hint`.
#[test]
fn every_failure_the_sdk_builds_carries_a_boolean_retryable() {
    let errors = vec![
        Error::invalid("a"),
        Error::denied("b"),
        Error::timed_out("c"),
        Error::unavailable("d"),
        Error::failed("e"),
        Error::domain("INVOICE_PAID", "f"),
        Error::domain("not a code", "g"),
        Error::other(std::io::Error::other("h")),
        Error::invalid("i").retryable(true),
        Error::timed_out("j").category_of(Category::Internal),
        Error::invalid("k").details(json!(["not an object"])),
    ];

    for error in errors {
        let body = error.body();
        let extensions = &body["error"]["extensions"];

        assert!(extensions["retryable"].is_boolean(), "{}", error.message());
        assert!(extensions["details"].is_object(), "{}", error.message());
        assert!(extensions["hint"].is_string(), "{}", error.message());
        assert!(!extensions["code"].as_str().unwrap().is_empty());
        assert!(!extensions["category"].as_str().unwrap().is_empty());
    }
}

/// An integer arrives as an integer and a float arrives as a float. Both hold
/// through `run`'s success envelope, so a schema-typed decimal keeps its point
/// and a count keeps its exact digits.
#[test]
fn numbers_keep_the_shape_they_left_with() {
    let session = testing::install(|_name, _params| Ok(json!(null))).with_request(json!({}));

    #[derive(Serialize)]
    struct Out {
        count: i64,
        big: u64,
        rate: f64,
        round: f64,
    }

    simple::run(|_request: Request<Value>| {
        Ok(Out {
            count: 3,
            big: 9_007_199_254_740_993,
            rate: 0.1,
            round: 3.0,
        })
    });

    let data = session.done().unwrap()["data"].clone();

    assert_eq!(data["count"].to_string(), "3");
    assert_eq!(data["big"].to_string(), "9007199254740993");
    assert_eq!(data["rate"].to_string(), "0.1");
    assert_eq!(
        data["round"].to_string(),
        "3.0",
        "a float that happens to be whole must not arrive as an integer"
    );
}

/// A handler returns a structure, not a bare string: a string at the top level
/// is refused and the run reports `ACTION_FAILED`. A string one level down is
/// ordinary data and is carried through as it was written.
#[test]
fn a_bare_string_is_refused_and_a_nested_one_is_not() {
    let session = testing::install(|_name, _params| Ok(json!(null))).with_request(json!({}));

    simple::run(|_request: Request<Value>| Ok(json!("123")));

    assert_eq!(
        session.done().unwrap()["data"]["error"]["extensions"]["code"],
        json!("ACTION_FAILED")
    );

    let session = testing::install(|_name, _params| Ok(json!(null))).with_request(json!({}));

    simple::run(|_request: Request<Value>| Ok(json!({ "text": "123" })));

    assert_eq!(session.done().unwrap()["data"], json!({ "text": "123" }));
}

/// A result may name one of its members `error`. It is carried as data and the
/// run is reported as the success it is, with `ok` true and an empty `errors`.
#[test]
fn a_success_whose_only_member_is_named_error_is_reported_as_a_success() {
    let session = testing::install(|_name, _params| Ok(json!(null))).with_request(json!({}));

    simple::run(|_request: Request<Value>| Ok(json!({ "error": { "row": 7 } })));

    let done = session.done().unwrap();

    assert_eq!(done["ok"], json!(true));
    assert_eq!(
        done["data"],
        json!({ "error": { "row": 7 } }),
        "the member is carried through as ordinary data"
    );
}

// ---------------------------------------------------------------------------
// What the host answers
// ---------------------------------------------------------------------------

/// A host answer that does not fit the shape the caller asked for reaches the
/// caller as a typed error, on every shape the seam can produce.
#[test]
fn an_unreadable_host_answer_is_always_a_typed_error() {
    let _session = testing::install(|_name, _params| Ok(json!({ "rows": "not a list" })));

    #[derive(Debug, Deserialize)]
    struct Shape {
        #[allow(dead_code)]
        rows: Vec<Value>,
    }

    assert_eq!(
        simple::graphql::query::<Shape>("query Q { rows { a } }", json!({}))
            .unwrap_err()
            .code()
            .as_str(),
        "INVALID_QUERY_RESPONSE"
    );
}

/// A host call made before `run` has installed anything is a typed error, not a
/// panic and not a hang.
#[test]
fn a_call_with_no_host_installed_is_a_typed_error() {
    let error = simple::graphql::query::<Value>("query Q { a }", json!({})).unwrap_err();

    assert_eq!(error.code().as_str(), "QUERY_EXECUTION_FAILED");
    assert!(error.message().contains("No host is installed"));
}
