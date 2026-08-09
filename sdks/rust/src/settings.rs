//! Reading the settings an application was configured with.
//!
//! One function, [`get`], and it answers with the type you asked for:
//!
//! ```
//! # use simpleplatform_sdk::prelude::*;
//! # use simpleplatform_sdk::testing;
//! #[derive(Deserialize)]
//! struct Billing {
//!     region: String,
//!     retries: u8,
//! }
//!
//! # let _session = testing::install(|_name, _params| {
//! #     Ok(json!({ "region": "eu-west", "retries": 3 }))
//! # });
//! let billing: Billing = simple::settings::get("billing", &["region", "retries"])?;
//!
//! assert_eq!(billing.region, "eu-west");
//! assert_eq!(billing.retries, 3);
//! # Ok::<(), Error>(())
//! ```
//!
//! # Why the answer is your own type
//!
//! A settings read answers with a map of setting name to value, and a `Value`
//! holding that map is a faithful description of the wire. It is also the shape
//! an action then has to walk by hand: index a key, ask whether it is a string,
//! decide what to do when it is not — at every use site, in every action, for a
//! set of keys the action already knew when it wrote the call.
//!
//! Naming a type moves all of that into one line. The keys asked for and the
//! fields read back are declared together, `retries` arrives as a `u8` because
//! that is what it was declared as, and a value that does not fit the
//! declaration is reported once, at the call, rather than at the first use.
//! This is the same bargain [`crate::graphql`] makes for a query result, and it
//! is made the same way — `serde`, and one type parameter — so an action author
//! learns it once.
//!
//! # Asking for the map itself
//!
//! Some settings are chosen at runtime, and then the keys are not known when the
//! call is written. `Value` is a type like any other, so asking for it hands back
//! the map exactly as it arrived:
//!
//! ```
//! # use simpleplatform_sdk::prelude::*;
//! # use simpleplatform_sdk::testing;
//! # let _session = testing::install(|_name, _params| Ok(json!({ "region": "eu-west" })));
//! let chosen = "region";
//! let settings: Value = simple::settings::get("billing", &[chosen])?;
//!
//! assert_eq!(settings[chosen], json!("eu-west"));
//! # Ok::<(), Error>(())
//! ```
//!
//! Both readings are the same call and the same wire. Which one you get is
//! decided by the type on the left, and nothing else.
//!
//! # What is settled before anything is sent
//!
//! A read names an application and at least one key, so [`get`] establishes both
//! at the call and reports a call that names neither without a round trip —
//! exactly as [`crate::graphql::query`] establishes that it was handed a
//! document. The refusal carries `INVALID_TOOL_INPUT`, and the host is left
//! alone.

use serde::de::DeserializeOwned;
use serde_json::{json, Value};

use crate::codes::Code;
use crate::error::{Error, Fault};
use crate::host;

/// The host action that reads application settings.
const SETTINGS_GET: &str = "action:settings/get";

/// Read the settings an application was configured with.
///
/// `app_id` names the application the settings belong to and `keys` names the
/// settings to read. The answer is the map of setting name to value, read into
/// `T` — your own type, or [`Value`] for the map as it arrived.
///
/// An application id that is only space, and an empty key list, are reported
/// before anything is sent.
///
/// ```
/// # use simpleplatform_sdk::prelude::*;
/// # use simpleplatform_sdk::testing;
/// # let _session = testing::install(|_name, _params| Ok(json!({ "region": "eu-west" })));
/// #[derive(Deserialize)]
/// struct Billing {
///     region: String,
/// }
///
/// let billing: Billing = simple::settings::get("billing", &["region"])?;
///
/// assert_eq!(billing.region, "eu-west");
/// # Ok::<(), Error>(())
/// ```
pub fn get<T: DeserializeOwned>(app_id: &str, keys: &[&str]) -> Result<T, Error> {
    let app_id = app_id.trim();

    if app_id.is_empty() {
        return Err(
            Error::invalid("An application id is required to read settings.")
                .hint("Pass the id of the application the settings belong to."),
        );
    }

    if keys.is_empty() {
        return Err(Error::invalid("At least one setting key is required.")
            .hint("Pass the names of the settings to read. Nothing was sent."));
    }

    let settings = host::transport()?
        .call(
            SETTINGS_GET.to_string(),
            json!({ "app_id": app_id, "keys": keys }),
        )
        .map_err(|cause| {
            Error::Host(Fault::new(Code::unspecified(), cause.message())).hint(
                "Confirm the application id and the key names, then read again. \
                 A settings read writes nothing.",
            )
        })?;

    // A settings read answers with a map of setting name to value, so anything
    // else is reported here rather than reaching `T` as a decoding failure that
    // would describe the field instead of the answer.
    if !settings.is_object() {
        return Err(Error::Json(Fault::new(
            Code::unspecified(),
            format!(
                "Settings arrive as a map of setting name to value, and this read answered with {}.",
                shape_of(&settings)
            ),
        ))
        .hint("Report this answer. A settings read writes nothing."));
    }

    serde_json::from_value(settings).map_err(|cause| {
        Error::Json(Fault::new(
            Code::unspecified(),
            format!("The settings read answered with a map this action could not read: {cause}"),
        ))
        .hint(
            "Match the fields of the type you asked for to the keys you asked for, \
             or read the answer as Value. A settings read writes nothing.",
        )
    })
}

/// What arrived, in the words a message uses for it.
fn shape_of(value: &Value) -> &'static str {
    match value {
        Value::Null => "nothing",
        Value::Bool(_) => "a true or false value",
        Value::Number(_) => "a number",
        Value::String(_) => "a string",
        Value::Array(_) => "a list",
        Value::Object(_) => "a map",
    }
}

#[cfg(test)]
mod tests {
    use serde::Deserialize;
    use serde_json::json;

    use super::*;
    use crate::testing;

    #[derive(Debug, Deserialize)]
    struct Billing {
        region: String,
        retries: u8,
    }

    #[test]
    fn a_read_answers_with_the_type_that_was_asked_for() {
        let _session = testing::install(|name, params| {
            assert_eq!(name, SETTINGS_GET);
            assert_eq!(params["app_id"], json!("billing"));
            assert_eq!(params["keys"], json!(["region", "retries"]));

            Ok(json!({ "region": "eu-west", "retries": 3 }))
        });

        let billing: Billing = get("billing", &["region", "retries"]).unwrap();

        assert_eq!(billing.region, "eu-west");
        assert_eq!(billing.retries, 3);
    }

    #[test]
    fn the_map_itself_is_had_by_asking_for_value() {
        let _session = testing::install(|_name, _params| Ok(json!({ "region": "eu-west" })));

        let settings: Value = get("billing", &["region"]).unwrap();

        assert_eq!(settings, json!({ "region": "eu-west" }));
    }

    #[test]
    fn one_call_carries_the_application_and_every_key_in_the_order_given() {
        let session = testing::install(|_name, _params| Ok(json!({})));

        let _: Value = get("billing", &["retries", "region", "currency"]).unwrap();

        let calls = session.calls();

        assert_eq!(calls.len(), 1, "one read is one round trip");
        assert_eq!(calls[0].name, "action:settings/get");
        assert_eq!(
            calls[0].params,
            json!({ "app_id": "billing", "keys": ["retries", "region", "currency"] })
        );
    }

    #[test]
    fn an_empty_key_list_is_reported_before_anything_is_sent() {
        let session = testing::install(|_name, _params| Ok(json!({})));

        let error = get::<Value>("billing", &[]).unwrap_err();

        assert_eq!(error.code().as_str(), "INVALID_TOOL_INPUT");
        assert!(session.calls().is_empty(), "nothing was sent");
    }

    #[test]
    fn an_application_id_that_names_nothing_is_reported_before_anything_is_sent() {
        let session = testing::install(|_name, _params| Ok(json!({})));

        assert_eq!(
            get::<Value>("", &["region"]).unwrap_err().code().as_str(),
            "INVALID_TOOL_INPUT"
        );
        assert_eq!(
            get::<Value>("   ", &["region"])
                .unwrap_err()
                .code()
                .as_str(),
            "INVALID_TOOL_INPUT"
        );
        assert!(session.calls().is_empty(), "nothing was sent");
    }

    #[test]
    fn both_refusals_say_which_one_was_missing() {
        let _session = testing::install(|_name, _params| Ok(json!({})));

        assert!(get::<Value>(" ", &["region"])
            .unwrap_err()
            .message()
            .contains("application id"));
        assert!(get::<Value>("billing", &[])
            .unwrap_err()
            .message()
            .contains("setting key"));
    }

    #[test]
    fn the_application_id_is_sent_without_the_space_around_it() {
        let session = testing::install(|_name, _params| Ok(json!({})));

        let _: Value = get("  billing\n", &["region"]).unwrap();

        assert_eq!(session.calls()[0].params["app_id"], json!("billing"));
    }

    #[test]
    fn a_host_refusal_keeps_its_own_message() {
        let _session = testing::install(|_name, _params| Err(Error::failed("permission denied")));

        let error = get::<Value>("billing", &["region"]).unwrap_err();

        assert!(error.message().contains("permission denied"));
        assert!(matches!(error, Error::Host(_)));
    }

    #[test]
    fn an_answer_that_is_not_a_map_says_what_arrived() {
        let _session = testing::install(|_name, _params| Ok(json!(["region"])));

        let error = get::<Value>("billing", &["region"]).unwrap_err();

        assert_eq!(error.code().as_str(), "ACTION_FAILED");
        assert!(error.message().contains("a list"));
    }

    #[test]
    fn an_answer_whose_values_do_not_fit_the_type_is_reported_at_the_call() {
        let _session =
            testing::install(|_name, _params| Ok(json!({ "region": "eu-west", "retries": "3" })));

        let error = get::<Billing>("billing", &["region", "retries"]).unwrap_err();

        assert_eq!(error.code().as_str(), "ACTION_FAILED");
        assert!(matches!(error, Error::Json(_)));
    }

    #[test]
    fn a_key_the_type_declares_and_the_answer_omits_is_reported_at_the_call() {
        let _session = testing::install(|_name, _params| Ok(json!({ "region": "eu-west" })));

        let error = get::<Billing>("billing", &["region", "retries"]).unwrap_err();

        assert!(error.message().contains("retries"));
    }

    #[test]
    fn every_shape_the_wire_carries_has_a_word() {
        assert_eq!(shape_of(&json!(null)), "nothing");
        assert_eq!(shape_of(&json!(true)), "a true or false value");
        assert_eq!(shape_of(&json!(3)), "a number");
        assert_eq!(shape_of(&json!("region")), "a string");
        assert_eq!(shape_of(&json!([])), "a list");
        assert_eq!(shape_of(&json!({})), "a map");
    }

    #[test]
    fn a_read_with_no_host_installed_is_an_error_and_not_a_panic() {
        let error = get::<Value>("billing", &["region"]).unwrap_err();

        assert!(error.message().contains("No host is installed"));
    }
}
