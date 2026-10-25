//! What goes on the wire, as bytes.
//!
//! Every other test in this crate asserts on a `serde_json::Value` — a tree that
//! has already been parsed. The platform reads bytes: the ones
//! `serde_json::to_string` produced, decoded by a strict JSON parser. So this
//! file drives [`simpleplatform_sdk::run`] over every ending an action has,
//! serialises each `__done__` document exactly as the guest transport does,
//! asserts the wire invariants on the bytes themselves, and writes them to
//! `wire-bytes.json` in the target directory this test was built into.
//!
//! The dump is a side effect, not the test: every claim below is asserted here.

use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::PathBuf;

use simpleplatform_sdk::codes::CANONICAL;
use simpleplatform_sdk::prelude::*;
use simpleplatform_sdk::testing;

/// One recorded ending: what produced it, and the bytes it produced.
struct Recorded {
    case: String,
    bytes: String,
}

/// Drive `run` once with this payload and handler, and keep the bytes.
///
/// `serde_json::to_string` is what the guest transport calls on the `__done__`
/// parameters, so these are the bytes a module would have handed the host.
fn record<T, R, F>(case: &str, payload: Value, handler: F) -> Recorded
where
    T: serde::de::DeserializeOwned,
    R: Serialize,
    F: FnOnce(Request<T>) -> Result<R, Error>,
{
    let session = testing::install(|_name, _params| Ok(json!(null))).with_request(payload);

    simpleplatform_sdk::run(handler);

    let done = session
        .done()
        .unwrap_or_else(|| panic!("{case}: the run reported no __done__ at all"));

    Recorded {
        case: case.to_string(),
        bytes: serde_json::to_string(&done).expect("the __done__ document must serialise"),
    }
}

/// A handler that fails with exactly this error.
fn fails(error: Error) -> impl FnOnce(Request<Value>) -> Result<Value, Error> {
    move |_request| Err(error)
}

/// The failure extensions of one recorded document, re-parsed from its bytes.
fn extensions(recorded: &Recorded) -> Value {
    let document: Value = serde_json::from_str(&recorded.bytes).expect("valid JSON");

    document["data"]["error"]["extensions"].clone()
}

/// Every ending this SDK can reach, as bytes.
fn every_ending() -> Vec<Recorded> {
    let mut recorded = vec![
        // --- successes ---------------------------------------------------
        record("success/empty", json!({}), |_r: Request<Value>| {
            Ok(json!({}))
        }),
        record("success/integers", json!({}), |_r: Request<Value>| {
            #[derive(Serialize)]
            struct Counts {
                count: i64,
                zero: u8,
                negative: i32,
                big: u64,
                beyond_double: u64,
                float: f64,
                whole_float: f64,
            }

            Ok(Counts {
                count: 3,
                zero: 0,
                negative: -17,
                big: u64::MAX,
                beyond_double: 9_007_199_254_740_993,
                float: 12.5,
                whole_float: 20.0,
            })
        }),
        record("success/nested", json!({}), |_r: Request<Value>| {
            Ok(json!({
                "items": [{ "id": "KNOW1", "rank": 1 }, { "id": "KNOW2", "rank": 2 }],
                "total": 2,
                "cursor": Value::Null,
            }))
        }),
        // A payload member named `error`, carried as ordinary data.
        record(
            "success/root-aliased-error",
            json!({}),
            |_r: Request<Value>| Ok(json!({ "error": [{ "id": "E1" }], "ok": true })),
        ),
        // --- failures, one per constructor -------------------------------
        record(
            "failure/invalid",
            json!({}),
            fails(
                Error::invalid("'ids' must contain at least one KNOW id.")
                    .details(json!({ "invalid": ["X1"] }))
                    .hint("A knowledge id begins with KNOW."),
            ),
        ),
        record(
            "failure/denied",
            json!({}),
            fails(Error::denied("Not yours.")),
        ),
        record(
            "failure/timed-out",
            json!({}),
            fails(Error::timed_out("The read timed out.")),
        ),
        record(
            "failure/unavailable",
            json!({}),
            fails(Error::unavailable("The data service is down.")),
        ),
        record(
            "failure/failed",
            json!({}),
            fails(Error::failed("It did not work.")),
        ),
        record(
            "failure/custom-code",
            json!({}),
            fails(Error::domain(
                "INVOICE_ALREADY_PAID",
                "This invoice is already paid.",
            )),
        ),
        record(
            "failure/unwritable-custom-code",
            json!({}),
            fails(Error::domain("not a code", "It failed.")),
        ),
        record(
            "failure/details-not-an-object",
            json!({}),
            fails(Error::invalid("No.").details(json!(["a", "b"]))),
        ),
        record(
            "failure/no-hint-no-details",
            json!({}),
            fails(Error::invalid("No.")),
        ),
        record(
            "failure/retryable-narrowed",
            json!({}),
            fails(Error::timed_out("Timed out.").retryable(false)),
        ),
        // --- failures the SDK raises for itself ---------------------------
        record(
            "failure/panic",
            json!({}),
            |_r: Request<Value>| -> Result<Value, Error> { panic!("the action fell over") },
        ),
        record("failure/bare-string", json!({}), |_r: Request<Value>| {
            Ok(json!("just a string"))
        }),
        record(
            "failure/unencodable-result",
            json!({}),
            |_r: Request<Value>| {
                // A map whose keys are not strings has no JSON spelling, so
                // encoding it is refused and the run reports a failure.
                let mut map: BTreeMap<(u8, u8), &str> = BTreeMap::new();
                map.insert((1, 2), "x");

                Ok(map)
            },
        ),
        record(
            "failure/payload-does-not-match",
            json!({ "wrong": 1 }),
            |_r: Request<Needs>| -> Result<Value, Error> { panic!("must not run") },
        ),
        // --- the 1000-byte bound ------------------------------------------
        record(
            "failure/long-ascii",
            json!({}),
            fails(Error::invalid("e".repeat(5_000)).hint("h".repeat(5_000))),
        ),
        record(
            "failure/long-multibyte",
            json!({}),
            // Three bytes each, so the 997-byte budget cannot land on a
            // character boundary.
            fails(Error::invalid("\u{4e16}".repeat(2_000)).hint("\u{4e16}".repeat(2_000))),
        ),
        record(
            "failure/long-four-byte",
            json!({}),
            // Four bytes each: 997 % 4 != 0 either.
            fails(Error::invalid("\u{1f600}".repeat(1_000))),
        ),
        record(
            "failure/exactly-1000-bytes",
            json!({}),
            fails(Error::invalid("e".repeat(1_000)).hint("h".repeat(1_000))),
        ),
        record(
            "failure/1001-bytes",
            json!({}),
            fails(Error::invalid("e".repeat(1_001))),
        ),
        // --- values JSON has no spelling for ------------------------------
        record("success/not-a-number", json!({}), |_r: Request<Value>| {
            #[derive(Serialize)]
            struct Measures {
                nan: f64,
                infinity: f64,
                negative_infinity: f64,
            }

            Ok(Measures {
                nan: f64::NAN,
                infinity: f64::INFINITY,
                negative_infinity: f64::NEG_INFINITY,
            })
        }),
        // --- results that are not objects ---------------------------------
        record("success/array", json!({}), |_r: Request<Value>| {
            Ok(json!([1, 2, 3]))
        }),
        record("success/number", json!({}), |_r: Request<Value>| {
            Ok(json!(7))
        }),
        record("success/bool", json!({}), |_r: Request<Value>| {
            Ok(json!(false))
        }),
        record("success/null", json!({}), |_r: Request<Value>| {
            Ok(Value::Null)
        }),
        // --- text that has to survive being encoded twice ------------------
        record("success/awkward-text", json!({}), |_r: Request<Value>| {
            Ok(json!({
                "control": "a\u{0}b\tc\nd\re\u{8}f",
                "quotes": "she said \"no\" and \\escaped\\",
                "unicode": "\u{4e16}\u{754c} \u{1f600} \u{0301}combining",
                "html": "</script><script>alert(1)</script>",
            }))
        }),
        record(
            "failure/awkward-text",
            json!({}),
            fails(
                Error::invalid("a\u{0}b\"c\\d\ne \u{1f600}")
                    .hint("</script> \u{4e16}")
                    .details(json!({ "k\u{0}ey": "v\"al" })),
            ),
        ),
    ];

    // --- every canonical code, filed under itself -------------------------
    for code in every_code() {
        let name = code.as_str().to_string();

        recorded.push(record(
            &format!("failure/code/{name}"),
            json!({}),
            fails(Error::invalid("A failure filed under this code.").code_of(code)),
        ));
    }

    recorded
}

#[derive(Debug, serde::Deserialize)]
struct Needs {
    #[allow(dead_code)]
    required: String,
}

/// Every canonical variant. Written out rather than parsed out of `CANONICAL`,
/// because the point is to prove the enum and that list agree.
fn every_code() -> Vec<Code> {
    vec![
        Code::InvalidToolInput,
        Code::MutationRequired,
        Code::QueryRequired,
        Code::InvalidVariables,
        Code::MissingGraphqlVariables,
        Code::UndeclaredGraphqlVariables,
        Code::UnsupportedGraphqlVariableType,
        Code::UnsupportedGraphqlVariableDefault,
        Code::InvalidGraphqlVariableValue,
        Code::InvalidGraphqlQuery,
        Code::InvalidGraphqlMutation,
        Code::QueryNotAllowed,
        Code::NotAMutation,
        Code::ReservedMutationAlias,
        Code::InvalidDateFilter,
        Code::QueryForbidden,
        Code::QueryTimeout,
        Code::DatabaseUnavailable,
        Code::QueryExecutionFailed,
        Code::MutationExecutionFailed,
        Code::MutationResultUnreadable,
        Code::InvalidQueryResponse,
        Code::InvalidMutationResponse,
        Code::PaginationFailed,
        Code::QueryDataFailed,
    ]
}

/// Where the dump lands: the target directory this test was built into.
///
/// Read off the test binary's own path — `<target>/<profile>/deps/<binary>` —
/// rather than assembled from the manifest directory. The build's output goes
/// wherever `CARGO_TARGET_DIR` points, so that is where the dump belongs and is
/// the one directory cargo is already guaranteed to have created.
fn dump_path() -> PathBuf {
    let binary = env::current_exe().expect("the test binary knows its own path");

    binary
        .ancestors()
        .nth(3)
        .expect("the test binary sits three directories inside the target directory")
        .join("wire-bytes.json")
}

#[test]
fn every_ending_is_dumped_and_readable() {
    let recorded = every_ending();

    let dump: Vec<Value> = recorded
        .iter()
        .map(|one| json!({ "case": one.case, "bytes": one.bytes }))
        .collect();

    let path = dump_path();

    fs::write(
        &path,
        serde_json::to_string_pretty(&dump).expect("the dump serialises"),
    )
    .unwrap_or_else(|why| panic!("the dump is written to {}: {why}", path.display()));

    assert!(recorded.len() >= 45, "every ending should be recorded");

    // Read it back rather than trusting the write: the claim is that the dump
    // on disk is a document, holding every ending, that a reader can parse.
    let written = fs::read_to_string(&path)
        .unwrap_or_else(|why| panic!("the dump is read back from {}: {why}", path.display()));

    let parsed: Vec<Value> = serde_json::from_str(&written).expect("the dump parses");

    assert_eq!(
        parsed.len(),
        recorded.len(),
        "the dump holds every ending that was recorded"
    );

    for (one, entry) in recorded.iter().zip(&parsed) {
        assert_eq!(entry["case"], json!(one.case));
        assert_eq!(entry["bytes"], json!(one.bytes));
    }
}

#[test]
fn every_document_carries_the_three_members_the_host_destructures() {
    // The report is destructured into `data`, `ok` and `errors`, so every
    // document carries exactly those three and nothing else.
    for one in every_ending() {
        let document: Value = serde_json::from_str(&one.bytes).expect("valid JSON");

        assert!(
            document.get("data").is_some(),
            "{}: no `data` member to destructure",
            one.case
        );
        assert_eq!(document["ok"], json!(true), "{}", one.case);
        assert_eq!(
            document["errors"],
            json!([]),
            "{}: `errors` is always the empty list",
            one.case
        );
        assert_eq!(
            document.as_object().map(|members| members.len()),
            Some(3),
            "{}: the envelope carries exactly data, errors and ok",
            one.case
        );
    }
}

#[test]
fn retryable_is_present_and_a_json_boolean_on_every_failure() {
    for one in every_ending() {
        if !one.case.starts_with("failure/") {
            continue;
        }

        let extensions = extensions(&one);

        assert!(
            extensions.get("retryable").is_some(),
            "{}: `retryable` is one of the five members every failure carries",
            one.case
        );
        assert!(
            extensions["retryable"].is_boolean(),
            "{}: `retryable` is {}, not a JSON boolean",
            one.case,
            extensions["retryable"]
        );
        // The bytes themselves, not the parsed tree: `true`/`false` unquoted.
        assert!(
            one.bytes.contains(r#""retryable":true"#) || one.bytes.contains(r#""retryable":false"#),
            "{}: `retryable` is not spelled as a bare JSON boolean on the wire",
            one.case
        );
    }
}

#[test]
fn every_member_the_host_requires_is_present_with_its_exact_type() {
    // A failure carries five members and their types are fixed: a filled
    // `code` and `category`, a boolean `retryable`, an object `details` and a
    // string `hint`, alongside a filled `message`.
    for one in every_ending() {
        if !one.case.starts_with("failure/") {
            continue;
        }

        let document: Value = serde_json::from_str(&one.bytes).expect("valid JSON");
        let error = &document["data"]["error"];
        let extensions = &error["extensions"];

        assert!(
            error["message"]
                .as_str()
                .is_some_and(|m| !m.trim().is_empty()),
            "{}: message is not a filled string",
            one.case
        );
        assert!(
            extensions["code"]
                .as_str()
                .is_some_and(|c| !c.trim().is_empty()),
            "{}: code is not a filled string",
            one.case
        );
        assert!(
            extensions["category"]
                .as_str()
                .is_some_and(|c| !c.trim().is_empty()),
            "{}: category is not a filled string",
            one.case
        );
        assert!(
            extensions["details"].is_object(),
            "{}: details is {}, and it is always an object",
            one.case,
            extensions["details"]
        );
        assert!(
            extensions["hint"].is_string(),
            "{}: hint is not a string",
            one.case
        );
        assert_eq!(
            extensions.as_object().map(|members| members.len()),
            Some(5),
            "{}: extensions carries exactly the five members",
            one.case
        );
    }
}

#[test]
fn a_failure_body_is_a_single_error_member_and_nothing_else() {
    // A reported failure is one member named `error`, holding a `message` and
    // an `extensions` object. Both halves of that shape are held here, so the
    // body reads the same way whichever way it is looked at.
    for one in every_ending() {
        if !one.case.starts_with("failure/") {
            continue;
        }

        let document: Value = serde_json::from_str(&one.bytes).expect("valid JSON");
        let body = &document["data"];

        assert!(
            body.get("extensions").is_none(),
            "{}: a failure body carries no top-level `extensions`",
            one.case
        );
        assert_eq!(
            body.as_object().map(|members| members.len()),
            Some(1),
            "{}: the failure body carries `error` and nothing else",
            one.case
        );
        assert!(body["error"]["message"].is_string(), "{}", one.case);
        assert!(body["error"]["extensions"].is_object(), "{}", one.case);
    }
}

#[test]
fn every_code_on_the_wire_has_a_translation_or_is_deliberately_generic() {
    // The canonical list is what the platform's table is keyed by. Every code
    // that reaches the wire is one of three things, each of them a decision
    // somebody made: canonical, the SDK's own generic code, or one the action
    // author chose with `Error::domain`.
    for one in every_ending() {
        if !one.case.starts_with("failure/") {
            continue;
        }

        let code = extensions(&one)["code"].as_str().unwrap().to_string();
        let canonical = CANONICAL.contains(&code.as_str());
        let generic = code == simpleplatform_sdk::codes::UNSPECIFIED;
        let author_chosen = one.case.contains("custom-code");

        assert!(
            canonical || generic || author_chosen,
            "{}: `{code}` is neither in the platform's table nor the SDK's generic code",
            one.case
        );
    }
}

#[test]
fn every_message_and_hint_is_inside_the_bound_and_still_valid_utf8() {
    for one in every_ending() {
        if !one.case.starts_with("failure/") {
            continue;
        }

        let document: Value = serde_json::from_str(&one.bytes).expect("valid JSON");
        let message = document["data"]["error"]["message"].as_str().unwrap();
        let hint = document["data"]["error"]["extensions"]["hint"]
            .as_str()
            .unwrap();

        // 1000 bytes is inside the bound, so landing exactly on it is landing
        // inside it.
        assert!(
            message.len() <= 1_000,
            "{}: the message is {} bytes, past the 1000-byte bound",
            one.case,
            message.len()
        );
        assert!(
            hint.len() <= 1_000,
            "{}: the hint is {} bytes",
            one.case,
            hint.len()
        );

        // Re-parsing already proved it is valid UTF-8; this proves the trim
        // landed on a character boundary rather than inside a character.
        assert!(
            !message.contains(char::REPLACEMENT_CHARACTER),
            "{}: the message trim split a character",
            one.case
        );
        assert!(
            !hint.contains(char::REPLACEMENT_CHARACTER),
            "{}: the hint trim split a character",
            one.case
        );
    }
}

#[test]
fn a_trimmed_message_says_it_was_trimmed() {
    let long = record(
        "long",
        json!({}),
        fails(Error::invalid("e".repeat(5_000)).hint("h".repeat(5_000))),
    );
    let document: Value = serde_json::from_str(&long.bytes).unwrap();

    let message = document["data"]["error"]["message"].as_str().unwrap();
    let hint = document["data"]["error"]["extensions"]["hint"]
        .as_str()
        .unwrap();

    assert_eq!(message.len(), 1_000);
    assert!(message.ends_with("..."));
    assert_eq!(hint.len(), 1_000);
    assert!(hint.ends_with("..."));
}

#[test]
fn a_message_of_exactly_the_bound_is_kept_whole_and_one_byte_over_is_trimmed() {
    let at = record("at", json!({}), fails(Error::invalid("e".repeat(1_000))));
    let over = record("over", json!({}), fails(Error::invalid("e".repeat(1_001))));

    let at: Value = serde_json::from_str(&at.bytes).unwrap();
    let over: Value = serde_json::from_str(&over.bytes).unwrap();

    let at = at["data"]["error"]["message"].as_str().unwrap();
    let over = over["data"]["error"]["message"].as_str().unwrap();

    assert_eq!(at.len(), 1_000);
    assert!(!at.ends_with("..."), "1000 bytes is inside the bound");

    assert_eq!(over.len(), 1_000);
    assert!(over.ends_with("..."));
}

#[test]
fn an_integer_is_spelled_as_an_integer_in_the_bytes() {
    let recorded = record("integers", json!({}), |_r: Request<Value>| {
        #[derive(Serialize)]
        struct Counts {
            count: i64,
            zero: u8,
            negative: i32,
            big: u64,
            beyond_double: u64,
            float: f64,
            whole_float: f64,
        }

        Ok(Counts {
            count: 3,
            zero: 0,
            negative: -17,
            big: u64::MAX,
            beyond_double: 9_007_199_254_740_993,
            float: 12.5,
            whole_float: 20.0,
        })
    });

    // The bytes, not the parsed tree: a float would read `3.0` here.
    assert!(
        recorded.bytes.contains(r#""count":3"#),
        "{}",
        recorded.bytes
    );
    assert!(recorded.bytes.contains(r#""zero":0"#), "{}", recorded.bytes);
    assert!(
        recorded.bytes.contains(r#""negative":-17"#),
        "{}",
        recorded.bytes
    );
    assert!(
        recorded.bytes.contains(r#""big":18446744073709551615"#),
        "a u64 beyond i64 keeps every digit: {}",
        recorded.bytes
    );
    assert!(
        recorded
            .bytes
            .contains(r#""beyond_double":9007199254740993"#),
        "an integer past 2^53 is not rounded through a double: {}",
        recorded.bytes
    );
    assert!(
        recorded.bytes.contains(r#""float":12.5"#),
        "{}",
        recorded.bytes
    );

    // The other direction: a float declared as one stays a float, so a
    // schema-typed decimal does not arrive as an integer.
    assert!(
        recorded.bytes.contains(r#""whole_float":20.0"#),
        "a whole-valued f64 must not collapse to an integer: {}",
        recorded.bytes
    );

    let document: Value = serde_json::from_str(&recorded.bytes).unwrap();

    assert!(document["data"]["count"].is_i64());
    assert!(document["data"]["big"].is_u64());
    assert!(document["data"]["whole_float"].is_f64());
}

#[test]
fn every_document_is_json_a_strict_parser_accepts() {
    // The reader on the other side is a strict JSON parser: `NaN`, `Infinity`
    // and raw control bytes inside strings are not JSON, and none of them
    // reaches the wire from here.
    for one in every_ending() {
        assert!(
            !one.bytes.contains("NaN") && !one.bytes.contains("Infinity"),
            "{}: a value JSON cannot spell reached the wire: {}",
            one.case,
            one.bytes
        );

        for byte in one.bytes.bytes() {
            assert!(
                byte >= 0x20 || byte == b'\t' || byte == b'\n' || byte == b'\r',
                "{}: a raw control byte reached the wire",
                one.case
            );
        }

        // Byte-exact round trip: parse and re-serialise must be identical.
        let parsed: Value = serde_json::from_str(&one.bytes)
            .unwrap_or_else(|cause| panic!("{}: not parseable JSON: {cause}", one.case));

        assert_eq!(
            serde_json::to_string(&parsed).unwrap(),
            one.bytes,
            "{}: the bytes do not survive a round trip",
            one.case
        );
    }
}

#[test]
fn a_float_json_cannot_spell_becomes_null_rather_than_invalid_json() {
    let recorded = record("nan", json!({}), |_r: Request<Value>| {
        #[derive(Serialize)]
        struct Measures {
            nan: f64,
            infinity: f64,
        }

        Ok(Measures {
            nan: f64::NAN,
            infinity: f64::INFINITY,
        })
    });

    assert!(
        recorded.bytes.contains(r#""nan":null"#),
        "{}",
        recorded.bytes
    );
    assert!(
        recorded.bytes.contains(r#""infinity":null"#),
        "{}",
        recorded.bytes
    );
}

#[test]
fn the_enum_and_the_canonical_list_are_the_same_set() {
    let codes = every_code();
    let from_enum: Vec<&str> = codes.iter().map(Code::as_str).collect();
    let from_list: Vec<&str> = CANONICAL.to_vec();

    assert_eq!(from_enum, from_list, "the enum and CANONICAL have drifted");
    assert_eq!(from_enum.len(), 25);
}

#[test]
fn an_integer_the_host_sent_is_still_an_integer_when_it_goes_back() {
    // The inbound half. The host encodes the request payload as a JSON document
    // inside a JSON string, so a number makes two decoding hops before a
    // handler sees it and two encoding hops on the way back.
    let recorded = record(
        "echo",
        json!({
            "count": 3,
            "big": 9_007_199_254_740_993_i64,
            "float": 12.5,
            "whole_float": 20.0,
        }),
        |request: Request<Value>| Ok(json!({ "echoed": request.data })),
    );

    assert!(
        recorded.bytes.contains(r#""count":3"#),
        "{}",
        recorded.bytes
    );
    assert!(
        recorded.bytes.contains(r#""big":9007199254740993"#),
        "an integer past 2^53 must not be rounded through a double: {}",
        recorded.bytes
    );
    assert!(
        recorded.bytes.contains(r#""float":12.5"#),
        "{}",
        recorded.bytes
    );
    assert!(
        recorded.bytes.contains(r#""whole_float":20.0"#),
        "a float must not arrive as an integer: {}",
        recorded.bytes
    );
}

#[test]
fn a_code_survives_the_round_trip_to_the_wire_unchanged() {
    for code in every_code() {
        let wanted = code.as_str().to_string();
        let recorded = record("code", json!({}), fails(Error::invalid("x").code_of(code)));

        assert_eq!(
            extensions(&recorded)["code"],
            json!(wanted),
            "the code an action chose must be the code that arrives"
        );
    }
}
