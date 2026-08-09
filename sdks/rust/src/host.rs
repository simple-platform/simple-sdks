//! The ambient transport: what an action talks to, and where it is kept.
//!
//! # Why it is ambient
//!
//! The host assembles the execution context for every call itself, so an action
//! has nothing to pass it and no reason to carry a context parameter down through
//! its own functions.
//!
//! What remains is a transport, and there is exactly one of it per run. It lives
//! in a slot [`crate::run`] fills before the handler is called, so
//! [`crate::graphql`] can reach it without an argument and without a handle.
//!
//! # Two slots, because there are two worlds
//!
//! Under `wasm32` the guest is single-threaded, the transport is the real ABI,
//! and a `OnceLock` fails safe in both directions that matter: a second `set`
//! answers `Err` instead of corrupting, and a read before the first `set` is
//! `None` — a typed error rather than a panic.
//!
//! Off `wasm32` — which is `cargo test`, on the developer's own machine — the
//! transport is whatever a test installed, tests run in parallel threads, and a
//! `thread_local!` is the only honest home for it.
//!
//! **The split is by target, not by `cfg(test)`.** `cfg(test)` is set only while
//! *this* crate's own tests build; an action crate running `cargo test` sees this
//! crate compiled without it. Splitting by target is what puts the seam in the
//! crate an action depends on, which is the audience it exists for.

use serde_json::Value;

use crate::error::Error;

/// The action name a run reports its result under. The host learns a run is
/// over from this and from nothing else.
pub(crate) const DONE: &str = "__done__";

/// The host action that executes a GraphQL document.
pub(crate) const DB_EXECUTE: &str = "action:db/execute";

/// What an action can ask of its host.
///
/// Implemented twice: once for the real ABI inside a module, and once by
/// [`crate::testing`] for a host on your own machine. It is public so that the
/// two are visibly the same contract, and so a later phase can add a transport
/// without changing what an action sees.
pub trait Transport {
    /// Run an action and answer with its result.
    ///
    /// The envelope the host replies in is unwrapped here, so callers see
    /// either the result or a typed error and never a three-member document
    /// they have to inspect themselves.
    fn call(&self, name: String, params: Value) -> Result<Value, Error>;

    /// Run an action and do not wait for it.
    fn cast(&self, name: String, params: Value);

    /// The initial request payload, exactly as the host wrote it.
    fn context(&self) -> Option<String>;
}

/// Turn the host's reply envelope into a result.
///
/// `{ "ok": true, "data": ... }` becomes the data, and anything else becomes a
/// typed error carrying whatever the host said. It is written once, here, so
/// every call site gets the same reading of the same reply.
pub(crate) fn unwrap_reply(name: &str, reply: Value) -> Result<Value, Error> {
    if reply.get("ok").and_then(Value::as_bool) == Some(true) {
        return Ok(reply.get("data").cloned().unwrap_or(Value::Null));
    }

    let message = reply
        .get("error")
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .filter(|message| !message.trim().is_empty())
        .unwrap_or("The host refused the call and gave no reason.");

    // A refused call establishes nothing about what it did before refusing, so
    // it takes the generic code rather than a canonical one that would claim
    // more than is known.
    Err(Error::Host(crate::error::Fault::new(
        crate::codes::Code::unspecified(),
        format!("{name} failed: {message}"),
    )))
}

#[cfg(target_arch = "wasm32")]
pub(crate) use guest::{claim_report, install, report, transport};

#[cfg(not(target_arch = "wasm32"))]
pub(crate) use native::{claim_report, install, report, transport};

/// The slot as it exists inside a running module.
#[cfg(target_arch = "wasm32")]
mod guest {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::OnceLock;

    use serde_json::Value;

    use super::{Transport, DONE};
    use crate::abi;
    use crate::error::Error;

    /// The real ABI, as a value with nothing in it. There is one host and it
    /// holds no state, so the slot below marks initialisation rather than
    /// storing anything.
    struct Guest;

    impl Transport for Guest {
        fn call(&self, name: String, params: Value) -> Result<Value, Error> {
            let payload = serde_json::to_string(&params).map_err(|cause| {
                Error::Json(crate::error::Fault::new(
                    crate::codes::Code::InvalidToolInput,
                    format!("The parameters for {name} could not be encoded: {cause}"),
                ))
            })?;

            let reply = abi::call(&name, &payload).ok_or_else(|| {
                Error::Host(crate::error::Fault::new(
                    crate::codes::Code::unspecified(),
                    format!("{name} returned nothing the action could read."),
                ))
            })?;

            let value: Value = serde_json::from_str(&reply).map_err(|cause| {
                Error::Json(crate::error::Fault::new(
                    crate::codes::Code::unspecified(),
                    format!("{name} answered with something that is not JSON: {cause}"),
                ))
            })?;

            super::unwrap_reply(&name, value)
        }

        fn cast(&self, name: String, params: Value) {
            // A cast has nowhere to report a failure to, and the one cast that
            // matters is `__done__` — which is how the host learns a run
            // finished. An envelope that cannot be encoded is replaced by one
            // that always can, so the report is made either way.
            let payload = serde_json::to_string(&params)
                .unwrap_or_else(|_unencodable| crate::envelope::unreportable());

            abi::cast(&name, &payload);
        }

        fn context(&self) -> Option<String> {
            abi::context()
        }
    }

    static TRANSPORT: OnceLock<Guest> = OnceLock::new();
    static REPORTED: AtomicBool = AtomicBool::new(false);

    /// Fill the slot. A second call answers `Err`, which is what a run entered
    /// twice looks like.
    pub(crate) fn install() -> Result<(), Error> {
        TRANSPORT.set(Guest).map_err(|_already| {
            Error::failed("The action was started twice in one run.")
                .hint("Call simple::run once, from main.")
        })
    }

    /// What is in the slot, or a typed error saying nothing is.
    pub(crate) fn transport() -> Result<&'static dyn Transport, Error> {
        TRANSPORT
            .get()
            .map(|guest| guest as &dyn Transport)
            .ok_or_else(|| {
                Error::failed("The action tried to reach the host before it had started.")
                    .hint("Do the work inside the handler passed to simple::run.")
            })
    }

    /// True exactly once, for whoever gets there first.
    pub(crate) fn claim_report() -> bool {
        !REPORTED.swap(true, Ordering::SeqCst)
    }

    /// Tell the host the run is over.
    ///
    /// This does not go through the slot: the panic hook can be reached before
    /// the slot is filled, and the report is made whether it was filled or not.
    pub(crate) fn report(envelope: Value) {
        Guest.cast(DONE.to_string(), envelope);
    }
}

/// The slot as it exists on the machine an action is written on.
#[cfg(not(target_arch = "wasm32"))]
mod native {
    use std::cell::{Cell, RefCell};
    use std::rc::Rc;

    use serde_json::Value;

    use super::{Transport, DONE};
    use crate::error::Error;

    thread_local! {
        static TRANSPORT: RefCell<Option<Rc<dyn Transport>>> = const { RefCell::new(None) };
        static REPORTED: Cell<bool> = const { Cell::new(false) };
    }

    /// Put a transport in this thread's slot, and forget any report already
    /// made. Called by the test seam, never by an action.
    pub(crate) fn set(transport: Option<Rc<dyn Transport>>) {
        TRANSPORT.with(|slot| {
            if let Ok(mut slot) = slot.try_borrow_mut() {
                *slot = transport;
            }
        });
        REPORTED.with(|reported| reported.set(false));
    }

    /// Nothing to fill: off `wasm32` the slot is filled by whoever is testing.
    pub(crate) fn install() -> Result<(), Error> {
        Ok(())
    }

    /// What this thread installed, or a typed error saying nothing did.
    pub(crate) fn transport() -> Result<Rc<dyn Transport>, Error> {
        TRANSPORT
            .with(|slot| slot.try_borrow().ok().and_then(|slot| slot.clone()))
            .ok_or_else(|| {
                Error::failed("No host is installed on this thread.")
                    .hint("Install one with simple::testing::install before calling the handler.")
            })
    }

    /// True exactly once per installed session.
    pub(crate) fn claim_report() -> bool {
        REPORTED.with(|reported| !reported.replace(true))
    }

    /// Hand the finished envelope to whatever is standing in for the host.
    ///
    /// With nothing installed there is nobody to tell, so it goes to stderr —
    /// which is where a developer running a handler by hand will look.
    pub(crate) fn report(envelope: Value) {
        match transport() {
            Ok(transport) => transport.cast(DONE.to_string(), envelope),
            Err(_nothing_installed) => {
                eprintln!("[simple] no host installed; the run reported: {envelope}");
            }
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
pub(crate) use native::set;

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn a_successful_reply_unwraps_to_its_data() {
        let reply = json!({ "ok": true, "data": { "rows": [] } });

        assert_eq!(
            unwrap_reply("action:db/execute", reply).unwrap(),
            json!({ "rows": [] })
        );
    }

    #[test]
    fn a_refusal_keeps_the_hosts_own_message() {
        let reply = json!({ "ok": false, "error": { "message": "permission denied" } });
        let error = unwrap_reply("action:db/execute", reply).unwrap_err();

        assert!(error.message().contains("permission denied"));
    }

    #[test]
    fn a_refusal_with_no_message_still_says_something() {
        let error = unwrap_reply("action:db/execute", json!({ "ok": false })).unwrap_err();

        assert!(error.message().contains("gave no reason"));
    }

    #[test]
    fn a_reply_with_no_data_member_is_null_rather_than_an_error() {
        let reply = json!({ "ok": true });

        assert_eq!(unwrap_reply("x", reply).unwrap(), json!(null));
    }
}
