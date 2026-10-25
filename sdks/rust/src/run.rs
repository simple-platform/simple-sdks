//! The entry point, and the one guarantee it makes.
//!
//! ```no_run
//! use simpleplatform_sdk::prelude::*;
//!
//! #[derive(Deserialize)]
//! struct Input {
//!     name: String,
//! }
//!
//! #[derive(Serialize)]
//! struct Output {
//!     greeting: String,
//! }
//!
//! fn main() {
//!     simple::run(|request: Request<Input>| {
//!         Ok(Output {
//!             greeting: format!("Hello, {}!", request.data.name),
//!         })
//!     })
//! }
//! ```
//!
//! # Exactly one `__done__`, on every path
//!
//! The host learns a run is over from `__cast("__done__", envelope)` and from
//! nothing else, so every path through this file ends in exactly one report: the
//! handler returning a value, the handler returning an error, a payload that does
//! not match the handler's input type, a host that never answered, and a panic.
//! The claim is a single atomic swap, so the panic hook and the ordinary return
//! cannot both fire.
//!
//! # No proc-macro
//!
//! `fn main() { simple::run(handler) }` rather than `#[simple::action]`. A macro
//! would generate a body the author could have written, hide the one place they
//! most want to step through, and put `syn` in the build graph of every action —
//! measured at 9.1 s of cold build for zero bytes of artifact.

use std::panic::{catch_unwind, AssertUnwindSafe};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::codes::{Category, Code};
use crate::envelope;
use crate::error::{Error, Fault};
use crate::host;

/// Request headers, as the host assembled them.
pub type Headers = Map<String, Value>;

/// Reads a member that may arrive as `null` into its default.
///
/// `#[serde(default)]` covers a member that is *absent*. Several of these arrive
/// *present and null*, which is a different thing: a run nobody triggered has no
/// trigger to name, and says so with a null.
///
/// An absent value and a null one mean the same thing here — nothing — so both
/// read as the type's default and the handler sees its input either way.
fn null_as_default<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de> + Default,
{
    Ok(Option::<T>::deserialize(deserializer)?.unwrap_or_default())
}

/// Which logic execution this is.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct Logic {
    /// Unique to this run. Quote it when reporting a failure to support.
    #[serde(default, deserialize_with = "null_as_default")]
    pub execution_id: String,
    /// The logic definition being run.
    #[serde(default, deserialize_with = "null_as_default")]
    pub id: String,
    /// What started it.
    #[serde(default, deserialize_with = "null_as_default")]
    pub trigger_id: String,
    /// The task this run belongs to, when it belongs to one.
    pub task_id: Option<String>,
    /// Where it is running.
    #[serde(default, deserialize_with = "null_as_default")]
    pub execution_env: String,
}

/// Which tenant this is running for.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct Tenant {
    /// The tenant's hostname, when it has one.
    pub host: Option<String>,
    /// The tenant's identifier, when the host sent one.
    pub id: Option<String>,
    /// The tenant's name.
    #[serde(default, deserialize_with = "null_as_default")]
    pub name: String,
}

/// Who this is running for, when it is running for anybody.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct User {
    /// The user's identifier.
    pub id: Option<String>,
}

/// The execution context, as the host assembled it.
///
/// It travels host-to-guest and is read, not passed: the host assembles the
/// context for every call itself, so there is nothing for an action to supply and
/// nothing to thread through its own functions.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default)]
pub struct Context {
    /// Which logic execution this is.
    pub logic: Logic,
    /// Which tenant this is running for.
    pub tenant: Tenant,
    /// Who this is running for.
    pub user: User,
}

/// One incoming request, with its payload already parsed.
///
/// `data` is the handler's own input type, checked before the handler runs — so
/// a payload that does not match is a typed failure with a code, reported from
/// the one place that knows what the handler expected.
#[derive(Clone, Debug)]
pub struct Request<T> {
    /// The payload, parsed into the handler's input type.
    pub data: T,
    /// The execution context, as the host assembled it.
    pub context: Context,
    /// The request headers.
    pub headers: Headers,
}

impl<T> Request<T> {
    /// A request carrying this payload and an empty context.
    ///
    /// This is how a test calls a handler directly, with no host and no wasm:
    ///
    /// ```
    /// use simpleplatform_sdk::prelude::*;
    ///
    /// struct Input {
    ///     id: String,
    /// }
    ///
    /// fn handler(request: Request<Input>) -> Result<String, Error> {
    ///     Ok(request.data.id)
    /// }
    ///
    /// let answer = handler(Request::new(Input { id: "KNOW1".into() })).unwrap();
    ///
    /// assert_eq!(answer, "KNOW1");
    /// ```
    pub fn new(data: T) -> Request<T> {
        Request {
            data,
            context: Context::default(),
            headers: Headers::new(),
        }
    }
}

/// What the host sends, before the payload inside it is parsed.
#[derive(Deserialize)]
struct Payload {
    #[serde(default)]
    context: Context,
    /// The payload, as a JSON document inside a JSON string. An absent payload
    /// and the four characters `null` both read as no payload.
    #[serde(default)]
    data: Option<String>,
    #[serde(default)]
    headers: Option<Headers>,
}

/// Run an action.
///
/// Installs the panic hook, reads the request, parses it into the handler's
/// input type, calls the handler, and reports the result — exactly once,
/// whatever happens.
///
/// It returns nothing, because there is nobody to return to: the result travels
/// to the host, and everything that could go wrong has already been turned into
/// a failure the host can read.
pub fn run<T, R, F>(handler: F)
where
    T: DeserializeOwned,
    R: Serialize,
    F: FnOnce(Request<T>) -> Result<R, Error>,
{
    install_panic_hook();

    let envelope = match catch_unwind(AssertUnwindSafe(|| execute(handler))) {
        Ok(Ok(data)) => envelope::success(data),
        Ok(Err(error)) => envelope::failure(&error),
        Err(payload) => envelope::failure(&panicked(&panic_text(payload.as_ref()))),
    };

    // The hook may already have reported this run, in which case it said
    // everything there was to say and a second report would be a second result.
    if host::claim_report() {
        host::report(envelope);
    }
}

/// Everything between the host handing over a request and handing back a value.
fn execute<T, R, F>(handler: F) -> Result<Value, Error>
where
    T: DeserializeOwned,
    R: Serialize,
    F: FnOnce(Request<T>) -> Result<R, Error>,
{
    host::install()?;

    let transport = host::transport()?;

    let payload = transport.context().ok_or_else(|| {
        Error::failed("The host sent no request payload.")
            .hint("This is a platform fault; quote the logic execution id when reporting it.")
    })?;

    let request = parse::<T>(&payload)?;
    let result = handler(request)?;

    let data = serde_json::to_value(result).map_err(|cause| {
        // The handler already ran, so nothing here establishes that it changed
        // nothing. The generic code is the one that claims no more than that.
        Error::Json(Fault::new(
            Code::unspecified(),
            format!("The action's result could not be encoded as JSON: {cause}"),
        ))
        .category_of(Category::Internal)
    })?;

    reject_bare_string(&data)?;

    Ok(data)
}

/// The host's request document, turned into a typed request.
fn parse<T: DeserializeOwned>(payload: &str) -> Result<Request<T>, Error> {
    let payload: Payload = serde_json::from_str(payload).map_err(|cause| {
        Error::Input(Fault::new(
            Code::InvalidToolInput,
            format!("The request the host sent could not be read: {cause}"),
        ))
    })?;

    let text = payload.data.unwrap_or_default();
    let text = if text.trim().is_empty() {
        "null"
    } else {
        text.as_str()
    };

    let data: T = serde_json::from_str(text).map_err(|cause| {
        Error::Input(Fault::new(
            Code::InvalidToolInput,
            format!("The action input is invalid: {cause}"),
        ))
        .hint("Send an object matching this action's advertised input schema.")
    })?;

    Ok(Request {
        data,
        context: payload.context,
        headers: payload.headers.unwrap_or_default(),
    })
}

/// Refuse a result that is a bare JSON string.
///
/// A returned string is re-parsed as JSON on the way out, so a bare string is not
/// a value an action can return unchanged. Naming it — `{ "text": ... }` — sends
/// it as written, and the refusal here says so while the author is still looking
/// at their own code.
fn reject_bare_string(data: &Value) -> Result<(), Error> {
    if !data.is_string() {
        return Ok(());
    }

    Err(
        Error::failed("An action cannot return a bare string.").hint(
            "Return an object with a named member instead, for example { \"text\": ... }. \
         The platform re-parses a returned string as JSON.",
        ),
    )
}

/// A recovered panic, as a failure.
///
/// The effect is unknown by construction: a panic proves nothing about what the
/// action had already done, so nothing here claims it changed nothing.
fn panicked(text: &str) -> Error {
    Error::Panic(Fault::new(
        Code::unspecified(),
        format!("The action panicked: {text}"),
    ))
    .category_of(Category::Internal)
    .hint("This is a fault in the action. Quote the logic execution id when reporting it.")
}

/// Whatever a panic payload has to say for itself.
///
/// A panic carries `&str` when the message is a literal and `String` when it is
/// formatted. A payload of any other type still yields a sentence, so a panic
/// always has something to report.
fn panic_text(payload: &(dyn std::any::Any + Send)) -> String {
    if let Some(text) = payload.downcast_ref::<&str>() {
        return (*text).to_string();
    }

    if let Some(text) = payload.downcast_ref::<String>() {
        return text.clone();
    }

    "no message".to_string()
}

/// Turn a panic into a reported failure rather than an opaque trap.
///
/// Only inside a module. A guest cannot unwind, so `catch_unwind` never catches
/// there and the hook is the last thing that runs before the trap — it is the
/// only chance to tell the host anything at all.
///
/// Off `wasm32` the hook is deliberately *not* installed: `set_hook` is
/// process-global, so the standard hook is left in place for everything else
/// sharing the process, and `catch_unwind` covers this side.
#[cfg(target_arch = "wasm32")]
fn install_panic_hook() {
    use std::sync::Once;

    static INSTALLED: Once = Once::new();

    INSTALLED.call_once(|| {
        std::panic::set_hook(Box::new(|info| {
            if !host::claim_report() {
                return;
            }

            let where_at = match info.location() {
                Some(location) => format!(" at {}:{}", location.file(), location.line()),
                None => String::new(),
            };

            let text = format!("{}{where_at}", panic_text(info.payload()));

            host::report(envelope::failure(&panicked(&text)));
        }));
    });
}

#[cfg(not(target_arch = "wasm32"))]
fn install_panic_hook() {}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[derive(Debug, Deserialize)]
    struct Input {
        ids: Vec<String>,
    }

    fn payload(data: Option<&str>) -> String {
        let mut document = Map::new();
        document.insert(
            "context".to_string(),
            json!({ "logic": { "execution_id": "EXEC1" }, "tenant": { "name": "acme" } }),
        );
        document.insert(
            "data".to_string(),
            data.map(|text| json!(text)).unwrap_or(Value::Null),
        );
        document.insert("headers".to_string(), json!({ "x-trace": "1" }));

        Value::Object(document).to_string()
    }

    #[test]
    fn the_payload_is_parsed_into_the_handlers_own_type() {
        let request: Request<Input> = parse(&payload(Some(r#"{"ids":["KNOW1"]}"#))).unwrap();

        assert_eq!(request.data.ids, vec!["KNOW1".to_string()]);
        assert_eq!(request.context.logic.execution_id, "EXEC1");
        assert_eq!(request.context.tenant.name, "acme");
        assert_eq!(request.headers["x-trace"], json!("1"));
    }

    #[test]
    fn a_payload_that_does_not_match_is_a_typed_failure_before_the_handler_runs() {
        let error = parse::<Input>(&payload(Some(r#"{"nope":1}"#))).unwrap_err();

        assert_eq!(error.code().as_str(), "INVALID_TOOL_INPUT");
        assert!(error.message().contains("input is invalid"));
    }

    #[test]
    fn an_absent_payload_reads_as_null_rather_than_as_a_parse_error() {
        let request: Request<Option<Input>> = parse(&payload(None)).unwrap();

        assert!(request.data.is_none());
    }

    #[test]
    fn an_encoded_null_reads_the_same_as_an_absent_one() {
        let request: Request<Option<Input>> = parse(&payload(Some("null"))).unwrap();

        assert!(request.data.is_none());
    }

    #[test]
    fn a_context_the_host_only_half_filled_still_reads() {
        let document = json!({ "context": { "logic": { "execution_id": "unknown" } } });
        let request: Request<Option<Input>> = parse(&document.to_string()).unwrap();

        assert_eq!(request.context.logic.execution_id, "unknown");
        assert_eq!(request.context.tenant.name, "");
    }

    #[test]
    fn a_bare_string_result_is_refused_and_a_named_one_is_not() {
        assert!(reject_bare_string(&json!("123")).is_err());
        assert!(reject_bare_string(&json!({ "text": "123" })).is_ok());
        assert!(reject_bare_string(&json!(123)).is_ok());
        assert!(reject_bare_string(&json!(null)).is_ok());
    }

    #[test]
    fn a_panic_payload_is_read_whichever_type_it_is() {
        let text: Box<dyn std::any::Any + Send> = Box::new("boom");
        assert_eq!(panic_text(text.as_ref()), "boom");

        let owned: Box<dyn std::any::Any + Send> = Box::new("boom".to_string());
        assert_eq!(panic_text(owned.as_ref()), "boom");

        let neither: Box<dyn std::any::Any + Send> = Box::new(7_u8);
        assert_eq!(panic_text(neither.as_ref()), "no message");
    }
}

#[cfg(test)]
mod null_valued_members {
    use super::*;

    /// A member declared as a string is accepted when it arrives as `null`.
    ///
    /// `#[serde(default)]` covers a member that is absent; these arrive present
    /// and null, and read as the empty string.
    #[test]
    fn a_null_trigger_id_is_not_a_failure() {
        let context: Context = serde_json::from_str(
            r#"{"logic":{"execution_id":"LEX-1","id":"LGC-1","trigger_id":null,
                "task_id":null,"execution_env":"server"},
                "tenant":{"name":"acme"},"user":{"id":"USR-1"}}"#,
        )
        .expect("a context with a null trigger id must deserialise");

        assert_eq!(context.logic.trigger_id, "");
    }

    #[test]
    fn a_null_tenant_name_is_not_a_failure() {
        let context: Context = serde_json::from_str(
            r#"{"logic":{"execution_id":"LEX-1","id":"LGC-1","trigger_id":"TRG-1",
                "execution_env":"server"},
                "tenant":{"name":null},"user":{}}"#,
        )
        .expect("a null tenant name must deserialise");

        assert_eq!(context.tenant.name, "");
    }
}
