//! Calling a service outside the platform.
//!
//! One function does the work, and five name a method for you:
//!
//! ```
//! # use simpleplatform_sdk::prelude::*;
//! # use simpleplatform_sdk::testing;
//! #[derive(Deserialize)]
//! struct Rate {
//!     usd: f64,
//! }
//!
//! # let _session = testing::install(|_name, _params| {
//! #     Ok(json!({ "body": { "usd": 1.09 }, "headers": {}, "ok": true, "status": 200 }))
//! # });
//! let rate: Rate = simple::http::get("https://api.example.com/rates/eur")?;
//!
//! assert_eq!(rate.usd, 1.09);
//! # Ok::<(), Error>(())
//! ```
//!
//! # The answer is the body
//!
//! A call answers with the response body, read into the type the call site asked
//! for — the same bargain [`crate::graphql`] makes. A body the service sent as
//! JSON is read as JSON; a body it sent as text is read as text, which is what an
//! answer type of `String` receives; and a body with nothing in it reads as
//! null, which is what `()` and `Option<_>` receive. The status decides whether
//! there is an answer at all, and travels with the failure when there is not.
//!
//! # Three outcomes, told apart at the call site
//!
//! | what happened | variant | code |
//! |---|---|---|
//! | the request produced no answer | [`Error::Host`] | `ACTION_FAILED` |
//! | the service answered outside 2xx | [`Error::Domain`] | `HTTP_STATUS_<status>` |
//! | the answer did not fit the answer type | [`Error::Json`] | `HTTP_RESPONSE_UNREADABLE` |
//!
//! So a 404 and an unreachable host are two different things to an action, by
//! the variant it matches on and by the code it reports, and the status a
//! service refused on is carried in the code, the message and the details.
//!
//! # What a failed call says about repeating it
//!
//! A service that answers 4xx has refused the request, so the repair is the
//! request. A service that answers 5xx, or that answers nothing at all, accepted
//! the request and then failed — and what repeating it costs depends on the
//! method, which is the same argument [`crate::graphql`] makes about a read and
//! a write. A `GET` changes nothing and may simply be made again; a `PUT` or a
//! `DELETE` may already have landed, and reaches the same state when it is sent
//! twice; a `POST` or a `PATCH` may already have landed, and can apply twice.
//! Each failure carries the sentence that fits it in its hint.
//!
//! # Why `get` takes a URL and nothing else
//!
//! Most calls carry no headers, so the five method functions take what that call
//! needs and no more — a URL, and a body where the method has one. A call that
//! does carry headers is a [`Request`], which is a plain struct with a
//! [`Default`], so the fields it does not set are the ones it does not write:
//!
//! ```
//! # use simpleplatform_sdk::prelude::*;
//! # use simpleplatform_sdk::testing;
//! use simpleplatform_sdk::http;
//!
//! # let _session = testing::install(|_name, _params| {
//! #     Ok(json!({ "body": [], "headers": {}, "ok": true, "status": 200 }))
//! # });
//! let leads: Vec<Value> = http::fetch(http::Request {
//!     url: "https://api.example.com/leads".to_string(),
//!     headers: http::headers(&[("Authorization", "Bearer T")]),
//!     ..http::Request::default()
//! })?;
//!
//! assert!(leads.is_empty());
//! # Ok::<(), Error>(())
//! ```
//!
//! That is one shape rather than two: no empty map to build for the common call,
//! no type parameter beyond the answer type, and no builder to learn — the struct
//! literal already names every field it sets.
//!
//! # Two requests, two names, one file
//!
//! An action already has a `Request`: the one it was called with, which the
//! prelude brings in. So an outbound request is written under the module it
//! belongs to — `http::Request` — and both names stay available in the same
//! file, each meaning one thing:
//!
//! ```
//! # use simpleplatform_sdk::prelude::*;
//! # use simpleplatform_sdk::testing;
//! use simpleplatform_sdk::http;
//!
//! #[derive(Deserialize)]
//! struct Input {
//!     lead_id: String,
//! }
//!
//! fn handler(request: Request<Input>) -> Result<Value, Error> {
//!     http::fetch(http::Request {
//!         url: format!("https://api.example.com/leads/{}", request.data.lead_id),
//!         headers: http::headers(&[("Accept", "application/json")]),
//!         ..http::Request::default()
//!     })
//! }
//!
//! # let _session = testing::install(|_name, _params| {
//! #     Ok(json!({ "body": { "id": "L1" }, "headers": {}, "ok": true, "status": 200 }))
//! # });
//! let lead = handler(Request::new(Input { lead_id: "L1".to_string() }))?;
//!
//! assert_eq!(lead["id"], json!("L1"));
//! # Ok::<(), Error>(())
//! ```

use std::collections::HashMap;
use std::fmt;

use serde::de::DeserializeOwned;
use serde_json::{json, Map, Value};

use crate::codes::Code;
use crate::error::{Error, Fault};
use crate::host;

/// The host action that makes an outbound request.
const HTTP_FETCH: &str = "action:http/fetch";

/// The code an answer that could not be read is filed under.
const UNREADABLE: &str = "HTTP_RESPONSE_UNREADABLE";

/// How much of what a service said is quoted back in the failure message.
const EXCERPT_CHARS: usize = 240;

/// What marks a quotation that goes on past what is shown.
const CUT_MARKER: &str = "...";

/// The method a request is made with.
///
/// Each one says what it does to the resource it names, which is what decides
/// whether a failed call may be made again.
#[non_exhaustive]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Method {
    /// Read the resource. Changes nothing, so it may always be repeated.
    #[default]
    Get,
    /// Submit to the resource. Sent twice, it can apply twice.
    Post,
    /// Replace the resource. Sent twice, it reaches the same state.
    Put,
    /// Change part of the resource. Sent twice, it can apply twice.
    Patch,
    /// Remove the resource. Sent twice, it reaches the same state.
    Delete,
}

impl Method {
    /// The method exactly as it travels on the wire.
    pub fn as_str(&self) -> &str {
        match self {
            Method::Get => "GET",
            Method::Post => "POST",
            Method::Put => "PUT",
            Method::Patch => "PATCH",
            Method::Delete => "DELETE",
        }
    }
}

impl fmt::Display for Method {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// One outbound request.
///
/// Every field has a default — `GET`, no headers, no body — so a literal names
/// the ones it sets and closes with `..Request::default()`.
///
/// ```
/// # use simpleplatform_sdk::prelude::*;
/// # use simpleplatform_sdk::testing;
/// use simpleplatform_sdk::http::{self, Method};
///
/// #[derive(Deserialize)]
/// struct Created {
///     id: String,
/// }
///
/// # let _session = testing::install(|_name, _params| {
/// #     Ok(json!({ "body": { "id": "L1" }, "headers": {}, "ok": true, "status": 201 }))
/// # });
/// let created: Created = http::fetch(http::Request {
///     url: "https://api.example.com/leads".to_string(),
///     method: Method::Post,
///     headers: http::headers(&[("Content-Type", "application/json")]),
///     body: Some(json!({ "email": "lead@example.com" })),
/// })?;
///
/// assert_eq!(created.id, "L1");
/// # Ok::<(), Error>(())
/// ```
#[derive(Clone, Default)]
pub struct Request {
    /// The address to call. Required, and trimmed before it is sent.
    pub url: String,
    /// What to do to the resource. `GET` unless something else is named.
    pub method: Method,
    /// The headers to send, as they are written.
    pub headers: HashMap<String, String>,
    /// The body to send.
    ///
    /// A [`Value::String`] is the body itself, so a form-encoded or already
    /// rendered payload arrives byte for byte. Anything else is sent as its
    /// JSON text.
    pub body: Option<Value>,
}

impl fmt::Debug for Request {
    /// The call, and never what authorises it.
    ///
    /// A request carries credentials in two places an author does not think of as
    /// secret-shaped: `Authorization` is an ordinary entry in `headers`, and a
    /// token exchange puts a client secret in the body. Both would reach a log
    /// line through an ordinary `{:?}`.
    ///
    /// So the header NAMES are rendered and their values are not, and the body is
    /// rendered as its size. Nothing is hidden from the author -- both fields are
    /// public and print in full when asked for directly -- and what changes is
    /// only what an incidental `{:?}` of the whole request discloses.
    ///
    /// ```
    /// use simpleplatform_sdk::http::{self, Method, Request};
    ///
    /// let request = Request {
    ///     url: "https://api.example.com/leads".to_string(),
    ///     method: Method::Get,
    ///     headers: http::headers(&[("Authorization", "Bearer t-1234")]),
    ///     body: None,
    /// };
    ///
    /// assert!(!format!("{request:?}").contains("t-1234"));
    /// assert!(format!("{request:?}").contains("Authorization"));
    /// ```
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Sorted, because a map's own order varies between runs and a diagnostic
        // that reorders itself is one nobody can compare against yesterday's.
        let mut names: Vec<&str> = self.headers.keys().map(String::as_str).collect();
        names.sort_unstable();

        formatter
            .debug_struct("Request")
            .field("url", &self.url)
            .field("method", &self.method)
            .field("headers", &names)
            .field("body", &self.body.as_ref().map(Sized_))
            .finish()
    }
}

/// Renders a body as how much of it there is, rather than what it says.
struct Sized_<'a>(&'a Value);

impl fmt::Debug for Sized_<'_> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.0 {
            Value::String(text) => write!(formatter, "<string, {} bytes>", text.len()),
            other => write!(formatter, "<{} json bytes>", other.to_string().len()),
        }
    }
}

/// The headers for a request, from the pairs that make them up.
///
/// A header map is `HashMap<String, String>`, and this is the one line that
/// builds one from string literals.
///
/// ```
/// use simpleplatform_sdk::http;
///
/// let sending = http::headers(&[
///     ("Authorization", "Bearer T"),
///     ("Accept", "application/json"),
/// ]);
///
/// assert_eq!(sending["Accept"], "application/json");
/// ```
pub fn headers(pairs: &[(&str, &str)]) -> HashMap<String, String> {
    pairs
        .iter()
        .map(|(name, value)| ((*name).to_string(), (*value).to_string()))
        .collect()
}

/// Make a request and answer with its body.
///
/// Refuses a request with no URL before anything is sent.
///
/// ```
/// # use simpleplatform_sdk::prelude::*;
/// # use simpleplatform_sdk::testing;
/// use simpleplatform_sdk::http::{self, Method};
///
/// # let _session = testing::install(|_name, _params| {
/// #     Ok(json!({ "body": "pong", "headers": {}, "ok": true, "status": 200 }))
/// # });
/// let answer: String = http::fetch(http::Request {
///     url: "https://api.example.com/ping".to_string(),
///     method: Method::Get,
///     ..http::Request::default()
/// })?;
///
/// assert_eq!(answer, "pong");
/// # Ok::<(), Error>(())
/// ```
pub fn fetch<T: DeserializeOwned>(request: Request) -> Result<T, Error> {
    let url = request.url.trim().to_string();

    if url.is_empty() {
        return Err(Error::invalid("A URL is required for an HTTP request.")
            .hint("Set the request's url to the address to call."));
    }

    let method = request.method;
    let request = Request { url, ..request };

    let answer = host::transport()?
        .call(HTTP_FETCH.to_string(), params(&request))
        .map_err(|cause| {
            cause.hint(format!(
                "The request produced no answer. {}",
                repeat_advice(method)
            ))
        })?;

    let response = read(answer)?;

    if !response.ok {
        return Err(refused(method, &response));
    }

    decode(response.body)
}

/// Read a resource.
///
/// ```
/// # use simpleplatform_sdk::prelude::*;
/// # use simpleplatform_sdk::testing;
/// # let _session = testing::install(|_name, _params| {
/// #     Ok(json!({ "body": { "id": "L1" }, "headers": {}, "ok": true, "status": 200 }))
/// # });
/// let lead: Value = simple::http::get("https://api.example.com/leads/L1")?;
///
/// assert_eq!(lead["id"], json!("L1"));
/// # Ok::<(), Error>(())
/// ```
pub fn get<T: DeserializeOwned>(url: &str) -> Result<T, Error> {
    fetch(request(url, Method::Get, None))
}

/// Submit to a resource.
///
/// ```
/// # use simpleplatform_sdk::prelude::*;
/// # use simpleplatform_sdk::testing;
/// # let _session = testing::install(|_name, _params| {
/// #     Ok(json!({ "body": { "id": "L2" }, "headers": {}, "ok": true, "status": 201 }))
/// # });
/// let created: Value = simple::http::post(
///     "https://api.example.com/leads",
///     json!({ "email": "lead@example.com" }),
/// )?;
///
/// assert_eq!(created["id"], json!("L2"));
/// # Ok::<(), Error>(())
/// ```
pub fn post<T: DeserializeOwned>(url: &str, body: Value) -> Result<T, Error> {
    fetch(request(url, Method::Post, Some(body)))
}

/// Replace a resource.
pub fn put<T: DeserializeOwned>(url: &str, body: Value) -> Result<T, Error> {
    fetch(request(url, Method::Put, Some(body)))
}

/// Change part of a resource.
pub fn patch<T: DeserializeOwned>(url: &str, body: Value) -> Result<T, Error> {
    fetch(request(url, Method::Patch, Some(body)))
}

/// Remove a resource.
///
/// `delete` is a name Rust leaves free, so the method keeps the word it is
/// called everywhere else — here, and in [`Method::Delete`].
///
/// A service that answers `204` sends no body, and no body reads as null, which
/// is what an answer type of `()` receives:
///
/// ```
/// # use simpleplatform_sdk::prelude::*;
/// # use simpleplatform_sdk::testing;
/// # let _session = testing::install(|_name, _params| {
/// #     Ok(json!({ "body": "", "headers": {}, "ok": true, "status": 204 }))
/// # });
/// simple::http::delete::<()>("https://api.example.com/leads/L1")?;
/// # Ok::<(), Error>(())
/// ```
pub fn delete<T: DeserializeOwned>(url: &str) -> Result<T, Error> {
    fetch(request(url, Method::Delete, None))
}

/// The request a method function makes: a URL, a method, and a body where the
/// method carries one.
fn request(url: &str, method: Method, body: Option<Value>) -> Request {
    Request {
        url: url.to_string(),
        method,
        headers: HashMap::new(),
        body,
    }
}

/// The parameters as the host reads them.
///
/// A member is present when it has something to say: headers that are empty and
/// a body that was never set are left out rather than sent as nothing.
fn params(request: &Request) -> Value {
    let mut params = Map::new();

    params.insert("url".to_string(), json!(request.url));
    params.insert("method".to_string(), json!(request.method.as_str()));

    if !request.headers.is_empty() {
        params.insert("headers".to_string(), json!(request.headers));
    }

    if let Some(body) = &request.body {
        params.insert("body".to_string(), json!(wire_body(body)));
    }

    Value::Object(params)
}

/// The body as the wire carries it: one string.
fn wire_body(body: &Value) -> String {
    match body {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

/// What the service answered.
struct Response {
    /// The status it answered with.
    status: u64,
    /// Whether that status carries a result.
    ok: bool,
    /// The body it sent.
    body: Value,
}

/// Read the answer once, so everything below works from the same three facts.
fn read(answer: Value) -> Result<Response, Error> {
    let status = answer
        .get("status")
        .and_then(Value::as_u64)
        .ok_or_else(|| {
            unreadable("The answer to the request carried no HTTP status.").hint(
                "Treat the effect as unknown and establish the outcome by reading the \
                 resource back.",
            )
        })?;

    let ok = answer
        .get("ok")
        .and_then(Value::as_bool)
        .unwrap_or(is_success(status));

    let body = match answer {
        Value::Object(mut members) => members.remove("body").unwrap_or(Value::Null),
        _not_an_object => Value::Null,
    };

    Ok(Response { status, ok, body })
}

/// Whether a status carries a result.
fn is_success(status: u64) -> bool {
    (200..300).contains(&status)
}

/// Read the body into the type the call site asked for.
fn decode<T: DeserializeOwned>(body: Value) -> Result<T, Error> {
    serde_json::from_value(as_json(body)).map_err(|cause| {
        unreadable(format!(
            "The response body does not match the type this action asked for: {cause}"
        ))
        .hint(
            "Ask for a type that matches what the service answers with, or take the body as a \
             Value and read it from there.",
        )
    })
}

/// The body as a JSON value.
///
/// A body the service sent as JSON is already one. A body it sent as text is
/// read as JSON when it is JSON, and stays text when it is not — which is what
/// an answer type of `String` receives. A body with nothing in it is null.
fn as_json(body: Value) -> Value {
    match body {
        Value::String(text) if text.trim().is_empty() => Value::Null,
        Value::String(text) => match serde_json::from_str(&text) {
            Ok(json) => json,
            Err(_text_rather_than_json) => Value::String(text),
        },
        already_json => already_json,
    }
}

/// The failure for a status that carries no result.
fn refused(method: Method, response: &Response) -> Error {
    let status = response.status;

    Error::Domain(Fault::new(
        Code::Custom(format!("HTTP_STATUS_{status}")),
        format!("The service answered {status}.{}", excerpt(&response.body)),
    ))
    .details(json!({ "status": status }))
    .hint(status_advice(method, status))
}

/// The failure for an answer that could not be read.
fn unreadable(message: impl Into<String>) -> Error {
    Error::Json(Fault::new(Code::Custom(UNREADABLE.to_string()), message))
}

/// What to do about a status that carries no result.
fn status_advice(method: Method, status: u64) -> String {
    match status {
        400..=499 => "The service refused the request as written. Correct the address, the \
                      headers or the body before sending it again."
            .to_string(),
        500..=599 => format!(
            "The service failed after accepting the request. {}",
            repeat_advice(method)
        ),
        _other => "The service answered without delivering a result. Establish what this \
                   status means for this service before sending the request again."
            .to_string(),
    }
}

/// What repeating this method costs when a call has already been made and its
/// effect is not established.
fn repeat_advice(method: Method) -> &'static str {
    match method {
        Method::Get => {
            "A GET changes nothing, so the same call may be made again once the cause is \
             addressed."
        }
        Method::Put | Method::Delete => {
            "Treat the effect as unknown: read the resource back to establish what happened. \
             A PUT or a DELETE sent twice reaches the same state."
        }
        Method::Post | Method::Patch => {
            "Treat the effect as unknown: read the resource back before sending it again, \
             since a POST or a PATCH sent twice can apply twice."
        }
    }
}

/// What the service said, as the sentence a failure carries.
///
/// The failure message travels within a byte budget, so the status comes first
/// and this is bounded to what fits beside it.
fn excerpt(body: &Value) -> String {
    match body {
        Value::Null => String::new(),
        Value::String(text) => said(text),
        rendered => said(&rendered.to_string()),
    }
}

/// The opening of a piece of text, quoted.
fn said(text: &str) -> String {
    let mut characters = text.trim().chars();
    let shown: String = characters.by_ref().take(EXCERPT_CHARS).collect();

    if shown.is_empty() {
        return String::new();
    }

    let marker = if characters.next().is_some() {
        CUT_MARKER
    } else {
        ""
    };

    format!(" It said: {shown}{marker}")
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::testing;

    /// The answer a host gives for a call that reached the service.
    fn answered(status: u64, body: Value) -> Value {
        json!({
            "body": body,
            "headers": { "content-type": "application/json" },
            "ok": is_success(status),
            "status": status,
        })
    }

    #[test]
    fn a_read_asks_for_the_address_and_answers_with_the_body() {
        let session = testing::install(move |name, params| {
            assert_eq!(name, HTTP_FETCH);
            assert_eq!(params["url"], json!("https://api.example.com/leads/L1"));
            assert_eq!(params["method"], json!("GET"));
            assert_eq!(params.get("headers"), None, "no headers were asked for");
            assert_eq!(params.get("body"), None, "a GET carries no body");

            Ok(answered(200, json!({ "id": "L1" })))
        });

        #[derive(Debug, serde::Deserialize)]
        struct Lead {
            id: String,
        }

        let lead: Lead = get("https://api.example.com/leads/L1").unwrap();

        assert_eq!(lead.id, "L1");
        assert_eq!(session.calls().len(), 1);
    }

    #[test]
    fn headers_and_a_body_travel_with_the_request() {
        let session = testing::install(|_name, params| {
            assert_eq!(params["headers"]["Authorization"], json!("Bearer T"));
            assert_eq!(params["body"], json!(r#"{"email":"lead@example.com"}"#));

            Ok(answered(201, json!({ "id": "L2" })))
        });

        let created: Value = fetch(Request {
            url: "https://api.example.com/leads".to_string(),
            method: Method::Post,
            headers: headers(&[("Authorization", "Bearer T")]),
            body: Some(json!({ "email": "lead@example.com" })),
        })
        .unwrap();

        assert_eq!(created, json!({ "id": "L2" }));
        assert_eq!(session.calls().len(), 1);
    }

    // The wire carries one string, and a body that is already a string is the
    // string it carries.
    #[test]
    fn a_body_that_is_text_is_sent_as_itself() {
        let _session = testing::install(|_name, params| {
            assert_eq!(params["body"], json!("grant_type=client_credentials"));

            Ok(answered(200, json!(null)))
        });

        let _: Value = post(
            "https://api.example.com/token",
            json!("grant_type=client_credentials"),
        )
        .unwrap();
    }

    #[test]
    fn each_method_function_names_its_own_method() {
        let session = testing::install(|_name, _params| Ok(answered(200, json!(null))));

        let _: Value = get("https://api.example.com/a").unwrap();
        let _: Value = post("https://api.example.com/a", json!({})).unwrap();
        let _: Value = put("https://api.example.com/a", json!({})).unwrap();
        let _: Value = patch("https://api.example.com/a", json!({})).unwrap();
        let _: Value = delete("https://api.example.com/a").unwrap();

        let sent: Vec<Value> = session
            .calls()
            .iter()
            .map(|call| call.params["method"].clone())
            .collect();

        assert_eq!(
            sent,
            vec![
                json!("GET"),
                json!("POST"),
                json!("PUT"),
                json!("PATCH"),
                json!("DELETE")
            ]
        );
    }

    #[test]
    fn a_blank_url_is_refused_before_anything_is_sent() {
        let session = testing::install(|_name, _params| Ok(answered(200, json!(null))));

        let error = get::<Value>("   ").unwrap_err();

        assert_eq!(error.code().as_str(), "INVALID_TOOL_INPUT");
        assert!(session.calls().is_empty(), "nothing was sent");
    }

    #[test]
    fn the_address_is_sent_trimmed() {
        let _session = testing::install(|_name, params| {
            assert_eq!(params["url"], json!("https://api.example.com/a"));

            Ok(answered(200, json!(null)))
        });

        let _: Value = get("  https://api.example.com/a\n").unwrap();
    }

    // The three outcomes, told apart by the variant and by the code.
    #[test]
    fn a_status_outside_2xx_is_a_failure_carrying_that_status() {
        let _session = testing::install(|_name, _params| {
            Ok(answered(404, json!({ "detail": "no such lead" })))
        });

        let error = get::<Value>("https://api.example.com/leads/L9").unwrap_err();

        assert!(matches!(error, Error::Domain(_)));
        assert_eq!(error.code().as_str(), "HTTP_STATUS_404");
        assert_eq!(error.fault().details(), &json!({ "status": 404 }));
        assert!(error.message().contains("404"));
        assert!(error.message().contains("no such lead"));
    }

    #[test]
    fn a_request_that_produced_no_answer_is_a_different_failure() {
        let _session = testing::install(|_name, _params| {
            Err(Error::failed("HTTP request failed: connection refused"))
        });

        let error = get::<Value>("https://api.example.com/leads").unwrap_err();

        assert!(matches!(error, Error::Host(_)));
        assert_eq!(error.code().as_str(), "ACTION_FAILED");
        assert!(error.message().contains("connection refused"));
    }

    #[test]
    fn a_body_that_does_not_fit_the_answer_type_says_so() {
        let _session = testing::install(|_name, _params| Ok(answered(200, json!({ "id": 7 }))));

        #[derive(Debug, serde::Deserialize)]
        struct Lead {
            #[allow(dead_code)]
            id: String,
        }

        let error = get::<Lead>("https://api.example.com/leads/L1").unwrap_err();

        assert!(matches!(error, Error::Json(_)));
        assert_eq!(error.code().as_str(), UNREADABLE);
    }

    #[test]
    fn an_answer_with_no_status_is_read_as_unreadable() {
        let _session = testing::install(|_name, _params| Ok(json!({ "body": { "id": "L1" } })));

        let error = get::<Value>("https://api.example.com/leads/L1").unwrap_err();

        assert_eq!(error.code().as_str(), UNREADABLE);
        assert!(error.message().contains("status"));
    }

    #[test]
    fn a_text_body_reads_into_a_string() {
        let _session = testing::install(|_name, _params| Ok(answered(200, json!("pong"))));

        let answer: String = get("https://api.example.com/ping").unwrap();

        assert_eq!(answer, "pong");
    }

    #[test]
    fn a_body_sent_as_json_text_reads_as_json() {
        let _session =
            testing::install(|_name, _params| Ok(answered(200, json!(r#"{"id":"L1"}"#))));

        let lead: Value = get("https://api.example.com/leads/L1").unwrap();

        assert_eq!(lead, json!({ "id": "L1" }));
    }

    #[test]
    fn a_body_with_nothing_in_it_reads_as_null() {
        let _session = testing::install(|_name, _params| Ok(answered(204, json!(""))));

        let answer: Value = delete("https://api.example.com/leads/L1").unwrap();

        assert_eq!(answer, json!(null));

        delete::<()>("https://api.example.com/leads/L1").expect("no body is an answer of its own");
    }

    #[test]
    fn an_answer_with_no_body_member_reads_as_null() {
        let _session = testing::install(|_name, _params| Ok(json!({ "ok": true, "status": 200 })));

        let answer: Option<String> = get("https://api.example.com/a").unwrap();

        assert_eq!(answer, None);
    }

    // The status is what says whether there is an answer, so it stands on its
    // own when the host states only that.
    #[test]
    fn the_status_alone_decides_a_success() {
        let _session =
            testing::install(|_name, _params| Ok(json!({ "body": "made", "status": 201 })));

        let answer: String = post("https://api.example.com/leads", json!({})).unwrap();

        assert_eq!(answer, "made");
    }

    #[test]
    fn the_status_alone_decides_a_refusal() {
        let _session =
            testing::install(|_name, _params| Ok(json!({ "body": "gone", "status": 410 })));

        let error = get::<Value>("https://api.example.com/leads/L1").unwrap_err();

        assert_eq!(error.code().as_str(), "HTTP_STATUS_410");
    }

    // A service that refuses a request has not acted on it; a service that
    // fails after accepting one may have.
    #[test]
    fn a_refusal_and_a_failure_advise_differently() {
        let _session = testing::install(|_name, _params| Ok(answered(422, json!("bad email"))));

        let refusal = post::<Value>("https://api.example.com/leads", json!({})).unwrap_err();

        assert!(refusal.fault().hint().contains("refused the request"));

        let _session = testing::install(|_name, _params| Ok(answered(500, json!("boom"))));

        let failure = post::<Value>("https://api.example.com/leads", json!({})).unwrap_err();

        assert!(failure.fault().hint().contains("can apply twice"));
    }

    #[test]
    fn what_a_failed_call_advises_follows_the_method() {
        assert!(repeat_advice(Method::Get).contains("changes nothing"));
        assert!(repeat_advice(Method::Put).contains("same state"));
        assert!(repeat_advice(Method::Delete).contains("same state"));
        assert!(repeat_advice(Method::Post).contains("apply twice"));
        assert!(repeat_advice(Method::Patch).contains("apply twice"));
    }

    #[test]
    fn a_call_that_never_answered_advises_by_its_method() {
        let _session = testing::install(|_name, _params| Err(Error::failed("timed out")));

        let read = get::<Value>("https://api.example.com/a").unwrap_err();
        let write = post::<Value>("https://api.example.com/a", json!({})).unwrap_err();

        assert!(read.fault().hint().contains("changes nothing"));
        assert!(write.fault().hint().contains("Treat the effect as unknown"));
    }

    #[test]
    fn a_long_answer_is_quoted_up_to_what_fits() {
        let _session = testing::install(|_name, _params| Ok(answered(500, json!("x".repeat(900)))));

        let error = get::<Value>("https://api.example.com/a").unwrap_err();

        assert!(error.message().ends_with(CUT_MARKER));
        assert!(error.message().len() < 400);
    }

    #[test]
    fn a_status_with_nothing_beside_it_is_still_a_sentence() {
        let _session = testing::install(|_name, _params| Ok(answered(503, json!(null))));

        let error = get::<Value>("https://api.example.com/a").unwrap_err();

        assert_eq!(error.message(), "The service answered 503.");
    }

    #[test]
    fn every_method_travels_under_the_name_the_wire_uses() {
        assert_eq!(Method::default(), Method::Get);
        assert_eq!(Method::Get.to_string(), "GET");
        assert_eq!(Method::Post.as_str(), "POST");
        assert_eq!(Method::Put.as_str(), "PUT");
        assert_eq!(Method::Patch.as_str(), "PATCH");
        assert_eq!(Method::Delete.as_str(), "DELETE");
    }

    #[test]
    fn the_headers_a_call_names_are_the_headers_it_sends() {
        let built = headers(&[("Accept", "application/json"), ("X-Trace", "T1")]);

        assert_eq!(built["Accept"], "application/json");
        assert_eq!(built["X-Trace"], "T1");
        assert_eq!(built.len(), 2);
        assert!(headers(&[]).is_empty());
    }

    // Every code this module reports is one the wire carries as written.
    #[test]
    fn the_codes_this_module_reports_travel_as_written() {
        assert_eq!(
            Code::Custom("HTTP_STATUS_404".to_string()).wire(),
            "HTTP_STATUS_404"
        );
        assert_eq!(Code::Custom(UNREADABLE.to_string()).wire(), UNREADABLE);
    }
}
