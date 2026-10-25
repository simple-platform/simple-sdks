//! The two documents an action ever sends back, built in one place.
//!
//! # The success envelope
//!
//! ```json
//! { "data": <what the handler returned>, "errors": [], "ok": true }
//! ```
//!
//! # The failure envelope
//!
//! A failure is a *returned value*, not a failed invocation. The call worked and
//! the body it returned says the call cannot be satisfied:
//!
//! ```json
//! { "data": { "error": { "message": "...", "extensions": { ... } } },
//!   "errors": [], "ok": true }
//! ```
//!
//! The body is the part that reaches the model — the code, the category, the
//! details and the hint all ride there — so a failure travels as the returned
//! body and `errors` stays empty. It is the same shape the platform's own data
//! actions report, built in one place here.
//!
//! # The members that are always present
//!
//! `retryable` is required, and is a JSON boolean. So are `code`, `category` and
//! `hint` — each a non-empty string — and `details`, an object. Every one of them
//! is emitted unconditionally below, with a type the constructors make
//! unrepresentable otherwise, so a failure this crate builds is always a failure
//! the platform can file.
//!
//! # The 1000-byte budget
//!
//! `message` and `hint` each travel within 1000 bytes. They are cut here, on a
//! character boundary, with a marker saying so — so what arrives is both valid
//! UTF-8 and within the bound.

use serde_json::{json, Map, Value};

use crate::error::Error;

/// What one text member may spend on the wire.
const TEXT_BYTES: usize = 1_000;

/// What is put where the cut happened, so a truncated sentence reads as one.
const CUT_MARKER: &str = "...";

/// The envelope for a handler that returned a value.
pub(crate) fn success(data: Value) -> Value {
    json!({ "data": data, "errors": [], "ok": true })
}

/// The one envelope that is written out rather than built, for the one case
/// where building it is what failed.
///
/// A run always reports, so there is always something to send: when serialising
/// the real answer does not work, this goes instead. It is a literal because a
/// literal cannot fail to serialise.
#[cfg(any(target_arch = "wasm32", test))]
pub(crate) fn unreportable() -> String {
    r#"{"data":{"error":{"message":"The action produced a result that could not be encoded as JSON.","extensions":{"code":"ACTION_FAILED","category":"internal","retryable":false,"details":{},"hint":"Return a value whose every member can be serialised."}}},"errors":[],"ok":true}"#
        .to_string()
}

/// The envelope for a handler that returned an error.
pub(crate) fn failure(error: &Error) -> Value {
    success(error_body(error))
}

/// The canonical failure body, without the envelope around it.
pub(crate) fn error_body(error: &Error) -> Value {
    let fault = error.fault();

    let details = match fault.details() {
        Value::Object(members) => Value::Object(members.clone()),
        _unreachable => Value::Object(Map::new()),
    };

    json!({
        "error": {
            "message": bounded(fault.message()),
            "extensions": {
                "code": fault.code().wire(),
                "category": fault.category().as_str(),
                "retryable": fault.retryable(),
                "details": details,
                "hint": bounded(fault.hint()),
            }
        }
    })
}

/// One text member, cut to what the wire carries.
///
/// The cut lands on a character boundary and the marker fits inside the budget,
/// so what arrives is both valid UTF-8 and within the bound.
fn bounded(text: &str) -> String {
    if text.len() <= TEXT_BYTES {
        return text.to_string();
    }

    let budget = TEXT_BYTES - CUT_MARKER.len();
    let mut end = budget;

    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }

    let mut cut = String::with_capacity(TEXT_BYTES);
    cut.push_str(&text[..end]);
    cut.push_str(CUT_MARKER);
    cut
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codes::Code;

    #[test]
    fn a_success_carries_no_errors_and_says_so() {
        let envelope = success(json!({ "items": [] }));

        assert_eq!(envelope["ok"], json!(true));
        assert_eq!(envelope["errors"], json!([]));
        assert_eq!(envelope["data"], json!({ "items": [] }));
    }

    #[test]
    fn a_failure_rides_as_the_returned_value() {
        let envelope = failure(&Error::invalid("No."));

        assert_eq!(
            envelope["ok"],
            json!(true),
            "a reported failure is a returned value, not a failed invocation"
        );
        assert_eq!(envelope["errors"], json!([]));
        assert!(envelope["data"]["error"].is_object());
    }

    #[test]
    fn every_member_the_platform_requires_is_present_and_typed() {
        let envelope = failure(&Error::timed_out("It timed out.").hint("Narrow it."));
        let extensions = &envelope["data"]["error"]["extensions"];

        assert!(envelope["data"]["error"]["message"].is_string());
        assert!(extensions["code"].is_string());
        assert!(extensions["category"].is_string());
        assert!(
            extensions["retryable"].is_boolean(),
            "`retryable` is always present and always a JSON boolean"
        );
        assert!(extensions["details"].is_object());
        assert!(extensions["hint"].is_string());

        assert_eq!(extensions["code"], json!("QUERY_TIMEOUT"));
        assert_eq!(extensions["category"], json!("timeout"));
        assert_eq!(extensions["retryable"], json!(true));
    }

    #[test]
    fn an_unwriteable_custom_code_still_leaves_a_readable_failure() {
        let envelope = failure(&Error::domain("not a code", "It failed."));

        assert_eq!(
            envelope["data"]["error"]["extensions"]["code"],
            json!(crate::codes::UNSPECIFIED)
        );
    }

    #[test]
    fn a_long_message_is_cut_to_the_wire_budget() {
        let long = "e".repeat(5_000);
        let envelope = failure(&Error::invalid(long.clone()).hint(long));

        let message = envelope["data"]["error"]["message"].as_str().unwrap();
        let hint = envelope["data"]["error"]["extensions"]["hint"]
            .as_str()
            .unwrap();

        assert_eq!(message.len(), TEXT_BYTES);
        assert_eq!(hint.len(), TEXT_BYTES);
        assert!(message.ends_with(CUT_MARKER));
    }

    #[test]
    fn the_cut_never_splits_a_character() {
        // Three bytes each, so the budget of 997 does not land on a boundary.
        let wide = "\u{4e16}".repeat(2_000);
        let envelope = failure(&Error::invalid(wide));

        let message = envelope["data"]["error"]["message"].as_str().unwrap();

        assert!(message.len() <= TEXT_BYTES);
        assert!(message.ends_with(CUT_MARKER));
        assert!(message
            .chars()
            .all(|character| character != char::REPLACEMENT_CHARACTER));
    }

    #[test]
    fn the_last_resort_envelope_is_readable_too() {
        let envelope: Value = serde_json::from_str(&unreportable()).unwrap();
        let extensions = &envelope["data"]["error"]["extensions"];

        assert_eq!(envelope["ok"], json!(true));
        assert!(envelope["data"]["error"]["message"].is_string());
        assert!(extensions["code"].is_string());
        assert!(extensions["category"].is_string());
        assert!(extensions["retryable"].is_boolean());
        assert!(extensions["details"].is_object());
        assert!(extensions["hint"].is_string());
    }

    #[test]
    fn an_integer_does_not_arrive_as_a_float() {
        let envelope = success(json!({ "count": 3_i64 }));

        assert_eq!(envelope["data"]["count"].to_string(), "3");
        assert!(envelope["data"]["count"].is_i64());
    }

    #[test]
    fn a_read_failure_and_a_write_failure_are_told_apart() {
        let read = failure(&Error::invalid("x").code_of(Code::QueryExecutionFailed));
        let write = failure(&Error::invalid("x").code_of(Code::MutationExecutionFailed));

        assert_eq!(
            read["data"]["error"]["extensions"]["code"],
            json!("QUERY_EXECUTION_FAILED")
        );
        assert_eq!(
            write["data"]["error"]["extensions"]["code"],
            json!("MUTATION_EXECUTION_FAILED")
        );
    }
}
