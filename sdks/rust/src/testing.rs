//! Running an action on your own machine, with no host and no wasm.
//!
//! # Why this is in the SDK and not in your action
//!
//! A handler reaches its host through one seam, so the stand-in for that host
//! belongs beside it. Shipping it here means a test drives the same seam
//! production drives, and every action gets the same one — kept in step with the
//! wire format by the crate that defines the wire format.
//!
//! # The whole of it
//!
//! ```
//! use simpleplatform_sdk::prelude::*;
//! use simpleplatform_sdk::testing;
//!
//! #[derive(Deserialize)]
//! struct Input {
//!     id: String,
//! }
//!
//! fn handler(request: Request<Input>) -> Result<Value, Error> {
//!     let answer: Value = simple::graphql::query(
//!         "query One($id: ID!) { thing: app__thing(where: {id: {_eq: $id}}) { id } }",
//!         json!({ "id": request.data.id }),
//!     )?;
//!
//!     Ok(answer)
//! }
//!
//! let session = testing::install(|name, params| {
//!     assert_eq!(name, "action:db/execute");
//!     assert_eq!(params["variables"]["id"], json!("T1"));
//!
//!     Ok(json!({ "thing": [{ "id": "T1" }] }))
//! });
//!
//! let answer = handler(Request::new(Input { id: "T1".into() })).unwrap();
//!
//! assert_eq!(answer, json!({ "thing": [{ "id": "T1" }] }));
//! assert_eq!(session.calls().len(), 1);
//! ```
//!
//! The closure answers in *results*, not envelopes: return the data the host
//! would have produced, or an [`Error`] for a host that refused. Wrapping it in
//! `{ ok, data }` is this module's job, exactly as unwrapping it is the SDK's
//! job in production.
//!
//! # Testing the envelope as well as the answer
//!
//! [`crate::run`] works here too. Give the session a request payload and it will
//! drive the whole path — parse, handle, report — and keep the `__done__`
//! document for you to assert on:
//!
//! ```
//! use simpleplatform_sdk::prelude::*;
//! use simpleplatform_sdk::testing;
//!
//! let session = testing::install(|_name, _params| Ok(json!(null)))
//!     .with_request(json!({ "id": "T1" }));
//!
//! simple::run(|request: Request<Value>| Ok(json!({ "echoed": request.data })));
//!
//! assert_eq!(
//!     session.done().unwrap(),
//!     json!({ "data": { "echoed": { "id": "T1" } }, "errors": [], "ok": true })
//! );
//! ```
//!
//! # One session per thread
//!
//! The slot is thread-local, so tests run in parallel without seeing each
//! other's hosts. Installing twice on one thread replaces the first; dropping
//! the session empties the slot.

use std::cell::RefCell;
use std::rc::Rc;

use serde_json::{json, Value};

use crate::error::Error;
use crate::host::{self, Transport, DONE};
use crate::run::Context;

/// One thing the code under test asked its host for.
#[derive(Clone, Debug)]
pub struct Call {
    /// The action name.
    pub name: String,
    /// The parameters, exactly as they were sent.
    pub params: Value,
}

/// The shared middle of a session: what the transport writes and the test reads.
#[derive(Default)]
struct Recorder {
    calls: RefCell<Vec<Call>>,
    done: RefCell<Option<Value>>,
    request: RefCell<String>,
    context: RefCell<Context>,
}

/// A host that answers from a closure and remembers what it was asked.
struct Mock {
    reply: Box<dyn Fn(String, Value) -> Result<Value, Error>>,
    recorder: Rc<Recorder>,
}

impl Transport for Mock {
    /// The closure's answer, wrapped in the envelope a host would have sent and
    /// then unwrapped by the same code the guest uses.
    ///
    /// Going the long way round is deliberate: a test exercises the same reply
    /// ladder that runs in production, so what it proves about a handler holds
    /// for the handler as shipped.
    fn call(&self, name: String, params: Value) -> Result<Value, Error> {
        if let Ok(mut calls) = self.recorder.calls.try_borrow_mut() {
            calls.push(Call {
                name: name.clone(),
                params: params.clone(),
            });
        }

        let reply = match (self.reply)(name.clone(), params) {
            Ok(data) => json!({ "ok": true, "data": data }),
            Err(refusal) => json!({ "ok": false, "error": { "message": refusal.message() } }),
        };

        host::unwrap_reply(&name, reply)
    }

    fn cast(&self, name: String, params: Value) {
        if name == DONE {
            if let Ok(mut done) = self.recorder.done.try_borrow_mut() {
                *done = Some(params);
            }

            return;
        }

        if let Ok(mut calls) = self.recorder.calls.try_borrow_mut() {
            calls.push(Call { name, params });
        }
    }

    fn context(&self) -> Option<String> {
        let request = self.recorder.request.try_borrow().ok()?.clone();
        let context = self.recorder.context.try_borrow().ok()?.clone();

        Some(
            json!({
                "context": context,
                "data": request,
                "headers": {},
            })
            .to_string(),
        )
    }
}

/// An installed host, for as long as this value is alive.
///
/// Dropping it empties the slot, so a session cannot outlive the test that made
/// it. Hold it in a binding — `let session = ...` or `let _session = ...` — and
/// not in `let _ = ...`, which drops it immediately.
pub struct Session {
    recorder: Rc<Recorder>,
}

impl Session {
    /// Everything the code under test asked the host for, in order.
    ///
    /// The `__done__` report is not among them; it is [`Session::done`].
    pub fn calls(&self) -> Vec<Call> {
        self.recorder
            .calls
            .try_borrow()
            .map(|calls| calls.clone())
            .unwrap_or_default()
    }

    /// The `__done__` document, once [`crate::run`] has reported one.
    pub fn done(&self) -> Option<Value> {
        self.recorder
            .done
            .try_borrow()
            .ok()
            .and_then(|done| done.clone())
    }

    /// The payload [`crate::run`] will hand the handler.
    pub fn with_request(self, data: Value) -> Session {
        if let Ok(mut request) = self.recorder.request.try_borrow_mut() {
            *request = data.to_string();
        }

        self
    }

    /// The execution context [`crate::run`] will hand the handler.
    pub fn with_context(self, context: Context) -> Session {
        if let Ok(mut slot) = self.recorder.context.try_borrow_mut() {
            *slot = context;
        }

        self
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        host::set(None);
    }
}

/// Install a host for this thread that answers from `reply`.
///
/// `reply` is handed the action name and its parameters, and answers with the
/// data the host would have produced or an [`Error`] for a host that refused.
pub fn install<F>(reply: F) -> Session
where
    F: Fn(String, Value) -> Result<Value, Error> + 'static,
{
    let recorder = Rc::new(Recorder {
        request: RefCell::new("null".to_string()),
        ..Recorder::default()
    });

    host::set(Some(Rc::new(Mock {
        reply: Box::new(reply),
        recorder: Rc::clone(&recorder),
    })));

    Session { recorder }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::run::Request;

    #[test]
    fn a_session_records_what_it_was_asked() {
        let session = install(|_name, _params| Ok(json!({ "rows": [] })));

        let _: Value = crate::graphql::query("query Q { rows { a } }", json!({ "x": 1 })).unwrap();

        let calls = session.calls();

        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "action:db/execute");
        assert_eq!(calls[0].params["variables"], json!({ "x": 1 }));
    }

    #[test]
    fn a_refusing_host_reaches_the_caller_as_an_error() {
        let _session = install(|_name, _params| Err(Error::denied("nope")));

        let error = crate::graphql::query::<Value>("query Q { a }", json!({})).unwrap_err();

        assert!(error.message().contains("nope"));
    }

    #[test]
    fn the_slot_is_empty_once_the_session_is_dropped() {
        {
            let _session = install(|_name, _params| Ok(json!(null)));
            assert!(host::transport().is_ok());
        }

        assert!(host::transport().is_err());
    }

    #[test]
    fn run_reports_a_success_envelope() {
        let session = install(|_name, _params| Ok(json!(null))).with_request(json!({ "a": 1 }));

        crate::run(|request: Request<Value>| Ok(json!({ "seen": request.data })));

        assert_eq!(
            session.done().unwrap(),
            json!({ "data": { "seen": { "a": 1 } }, "errors": [], "ok": true })
        );
    }

    #[test]
    fn run_reports_a_failure_envelope_and_still_says_ok() {
        let session = install(|_name, _params| Ok(json!(null))).with_request(json!({}));

        crate::run(|_request: Request<Value>| {
            Err::<Value, Error>(Error::invalid("no id").hint("Send an id."))
        });

        let done = session.done().unwrap();

        assert_eq!(done["ok"], json!(true));
        assert_eq!(
            done["data"]["error"]["extensions"]["code"],
            json!("INVALID_TOOL_INPUT")
        );
        assert_eq!(
            done["data"]["error"]["extensions"]["retryable"],
            json!(false)
        );
        assert_eq!(
            done["data"]["error"]["extensions"]["hint"],
            json!("Send an id.")
        );
    }

    #[test]
    fn run_reports_exactly_once_even_when_the_handler_panics() {
        let session = install(|_name, _params| Ok(json!(null))).with_request(json!({}));

        crate::run(|_request: Request<Value>| -> Result<Value, Error> {
            panic!("the action fell over")
        });

        let done = session.done().unwrap();

        assert!(done["data"]["error"]["message"]
            .as_str()
            .unwrap()
            .contains("the action fell over"));
    }

    #[test]
    fn a_payload_that_does_not_match_never_reaches_the_handler() {
        let session = install(|_name, _params| Ok(json!(null))).with_request(json!({ "a": 1 }));

        #[derive(Debug, serde::Deserialize)]
        struct Needs {
            #[allow(dead_code)]
            required: String,
        }

        crate::run(|_request: Request<Needs>| -> Result<Value, Error> {
            panic!("the handler must not run")
        });

        assert_eq!(
            session.done().unwrap()["data"]["error"]["extensions"]["code"],
            json!("INVALID_TOOL_INPUT")
        );
    }

    #[test]
    fn the_context_the_session_was_given_reaches_the_handler() {
        let mut context = Context::default();
        context.logic.execution_id = "EXEC9".to_string();
        context.tenant.name = "acme".to_string();

        let session = install(|_name, _params| Ok(json!(null)))
            .with_request(json!({}))
            .with_context(context);

        crate::run(|request: Request<Value>| {
            Ok(json!({
                "execution": request.context.logic.execution_id,
                "tenant": request.context.tenant.name,
            }))
        });

        assert_eq!(
            session.done().unwrap()["data"],
            json!({ "execution": "EXEC9", "tenant": "acme" })
        );
    }
}
