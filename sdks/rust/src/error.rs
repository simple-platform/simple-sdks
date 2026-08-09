//! The one error type an action ever handles.
//!
//! # Why one hand-written enum
//!
//! `anyhow` erases the variant, and its backtraces are dead weight in a guest
//! that cannot unwind. `thiserror` puts a proc-macro crate in the build graph of
//! every action in exchange for deriving `Display` on eight variants whose
//! strings are user-visible platform text — better read in the source than in an
//! attribute. So: written out, once, here.
//!
//! # Two rules this file is written to
//!
//! A message travels with a budget of **1000 bytes**. So [`Error`] front-loads
//! the actionable sentence, and [`crate::envelope`] does the cutting on a
//! character boundary, so what arrives is valid UTF-8 and within the bound.
//!
//! And **nothing on the error path may panic**: a failure reaches the caller by
//! being returned, so every function here is total.
//!
//! # `?` works on everything
//!
//! ```
//! use simpleplatform_sdk::prelude::*;
//!
//! fn parse(text: String) -> Result<i64, Error> {
//!     let number: i64 = text.trim().parse()?; // std's ParseIntError
//!     let value: Value = serde_json::from_str("{}")?; // serde_json's Error
//!     let _ = value;
//!     Ok(number)
//! }
//!
//! assert_eq!(parse(" 41 ".to_string()).unwrap(), 41);
//! assert!(parse("x".to_string()).is_err());
//! ```
//!
//! That works because of a blanket `From<E: std::error::Error>`, which the
//! standard library's reflexive `From<T> for T` forbids unless `Error` itself
//! does *not* implement `std::error::Error`. It does not, for exactly that
//! reason — the same trade `anyhow` makes. In an action this type is terminal,
//! so nothing downstream needs to convert *out* of it.

use std::fmt;

use serde_json::{Map, Value};

use crate::codes::{Category, Code};

/// Everything a failure carries onto the wire.
///
/// Held by every [`Error`] variant, so the variant says where the failure came
/// from and this says what the platform and the model are told about it.
#[derive(Clone, Debug)]
pub struct Fault {
    code: Code,
    category: Category,
    retryable: bool,
    message: String,
    details: Value,
    hint: String,
}

impl Fault {
    /// A fault carrying this code, with the code's own category and
    /// retryability, an empty details object, and no hint.
    pub fn new(code: Code, message: impl Into<String>) -> Fault {
        Fault {
            category: code.category(),
            retryable: code.retryable(),
            code,
            message: message.into(),
            details: Value::Object(Map::new()),
            hint: String::new(),
        }
    }

    /// The code this failure is filed under.
    pub fn code(&self) -> &Code {
        &self.code
    }

    /// The class this failure is reported under.
    pub fn category(&self) -> Category {
        self.category
    }

    /// Whether repeating an identical call could plausibly succeed.
    pub fn retryable(&self) -> bool {
        self.retryable
    }

    /// The sentence the model is shown. Cut at 1000 bytes on the way out.
    pub fn message(&self) -> &str {
        &self.message
    }

    /// Structured evidence beside the message. Always a JSON object.
    pub fn details(&self) -> &Value {
        &self.details
    }

    /// What to do about it. Cut at 1000 bytes on the way out.
    pub fn hint(&self) -> &str {
        &self.hint
    }
}

/// Everything that can go wrong inside an action.
///
/// The variant is the coarse triage — where the failure came from — and the
/// [`Fault`] inside it is what reaches the platform. Match on the variant when
/// you care where it happened; read [`Error::code`] when you care what it was.
///
/// It is `#[non_exhaustive]`: a `match` on it needs a `_` arm, so a variant
/// added later does not break an action that was already written.
#[non_exhaustive]
#[derive(Clone, Debug)]
pub enum Error {
    /// The payload the host sent does not match the handler's input type.
    Input(Fault),
    /// A JSON document could not be read or written.
    Json(Fault),
    /// The host could not be asked, or answered with a refusal.
    Host(Fault),
    /// A GraphQL read failed. Nothing was written.
    Query(Fault),
    /// A GraphQL write failed, and may already have landed.
    Mutation(Fault),
    /// The action decided the request cannot be satisfied.
    Domain(Fault),
    /// The handler panicked and the panic was turned into this.
    Panic(Fault),
    /// Converted from another error type by `?`.
    Other(Fault),
}

impl Error {
    // --- Constructors an action reaches for -------------------------------

    /// The input cannot be accepted as written.
    ///
    /// ```
    /// use simpleplatform_sdk::prelude::*;
    ///
    /// let error = Error::invalid("'ids' must contain at least one id.")
    ///     .hint("Pass one or more KNOW... ids.");
    ///
    /// assert_eq!(error.code().as_str(), "INVALID_TOOL_INPUT");
    /// ```
    pub fn invalid(message: impl Into<String>) -> Error {
        Error::Input(Fault::new(Code::InvalidToolInput, message))
    }

    /// The current user may not do this. Never retried.
    pub fn denied(message: impl Into<String>) -> Error {
        Error::Domain(Fault::new(Code::QueryForbidden, message))
    }

    /// It did not finish in time. Retryable.
    pub fn timed_out(message: impl Into<String>) -> Error {
        Error::Domain(Fault::new(Code::QueryTimeout, message))
    }

    /// Something it depends on is down. Retryable.
    pub fn unavailable(message: impl Into<String>) -> Error {
        Error::Domain(Fault::new(Code::DatabaseUnavailable, message))
    }

    /// It failed, and there is no more specific account of why.
    pub fn failed(message: impl Into<String>) -> Error {
        Error::Domain(Fault::new(Code::unspecified(), message))
    }

    /// A failure this action names for itself.
    ///
    /// The code is carried to the model verbatim and translated generically,
    /// which the platform reads as *effect unknown*. Prefer a canonical code
    /// where one fits; reach for this when none does.
    ///
    /// ```
    /// use simpleplatform_sdk::prelude::*;
    ///
    /// let error = Error::domain("INVOICE_ALREADY_PAID", "This invoice is already paid.");
    ///
    /// assert_eq!(error.code().as_str(), "INVOICE_ALREADY_PAID");
    /// ```
    pub fn domain(code: impl Into<String>, message: impl Into<String>) -> Error {
        Error::Domain(Fault::new(Code::Custom(code.into()), message))
    }

    /// Anything that is not one of ours, kept for its message.
    pub fn other(cause: impl fmt::Display) -> Error {
        Error::Other(Fault::new(Code::unspecified(), cause.to_string()))
    }

    // --- Builders ---------------------------------------------------------

    /// What to do about it. This reaches the model; spend it on the repair.
    pub fn hint(mut self, hint: impl Into<String>) -> Error {
        self.fault_mut().hint = hint.into();
        self
    }

    /// Structured evidence beside the message.
    ///
    /// `details` is always a JSON object on the wire, so a value that is not one
    /// is wrapped in one under `detail` and the failure travels whole — code,
    /// category, message and hint together with the evidence.
    pub fn details(mut self, details: Value) -> Error {
        self.fault_mut().details = match details {
            object @ Value::Object(_) => object,
            other => {
                let mut wrapper = Map::new();
                wrapper.insert("detail".to_string(), other);
                Value::Object(wrapper)
            }
        };
        self
    }

    /// File this failure under a different code, taking that code's category
    /// and retryability with it.
    pub fn code_of(mut self, code: Code) -> Error {
        let fault = self.fault_mut();
        fault.category = code.category();
        fault.retryable = code.retryable();
        fault.code = code;
        self
    }

    /// Report this failure under a different category, leaving the code alone.
    pub fn category_of(mut self, category: Category) -> Error {
        self.fault_mut().category = category;
        self
    }

    /// Narrow the retryability verdict.
    ///
    /// It can only be narrowed: a code that is not retryable stays that way, so
    /// an action cannot talk the platform into repeating a write.
    pub fn retryable(mut self, retryable: bool) -> Error {
        let fault = self.fault_mut();
        fault.retryable = fault.retryable && retryable;
        self
    }

    // --- Readers ----------------------------------------------------------

    /// Everything this failure carries onto the wire.
    pub fn fault(&self) -> &Fault {
        match self {
            Error::Input(fault)
            | Error::Json(fault)
            | Error::Host(fault)
            | Error::Query(fault)
            | Error::Mutation(fault)
            | Error::Domain(fault)
            | Error::Panic(fault)
            | Error::Other(fault) => fault,
        }
    }

    /// The code this failure is filed under.
    pub fn code(&self) -> &Code {
        self.fault().code()
    }

    /// The class this failure is reported under.
    pub fn category(&self) -> Category {
        self.fault().category()
    }

    /// The sentence the model is shown.
    pub fn message(&self) -> &str {
        self.fault().message()
    }

    /// Whether repeating an identical call could plausibly succeed.
    pub fn is_retryable(&self) -> bool {
        self.fault().retryable()
    }

    /// The canonical failure body, exactly as the platform reads it.
    ///
    /// Returning this from a handler instead of returning `Err` is what an
    /// action does when a failure is a *result* rather than a fault — the call
    /// worked, and the answer is that it cannot be satisfied.
    pub fn body(&self) -> Value {
        crate::envelope::error_body(self)
    }

    fn fault_mut(&mut self) -> &mut Fault {
        match self {
            Error::Input(fault)
            | Error::Json(fault)
            | Error::Host(fault)
            | Error::Query(fault)
            | Error::Mutation(fault)
            | Error::Domain(fault)
            | Error::Panic(fault)
            | Error::Other(fault) => fault,
        }
    }
}

impl fmt::Display for Error {
    /// The actionable sentence, and nothing else.
    ///
    /// This is the string that travels within the 1000-byte budget and that the
    /// model reads, so it carries no `Debug` decoration, no variant name and no
    /// code prefix. All of those are available from the accessors, and the
    /// budget is spent on what whoever reads it has to act on.
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.message())
    }
}

/// Everything `?` can reach, in one impl.
///
/// This is why `Error` does not implement `std::error::Error`: the standard
/// library's reflexive `impl<T> From<T> for T` would overlap with this one the
/// moment it did.
impl<E> From<E> for Error
where
    E: std::error::Error + 'static,
{
    fn from(cause: E) -> Error {
        Error::Other(Fault::new(Code::unspecified(), cause.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn a_constructor_takes_its_codes_category_and_verdict() {
        let timeout = Error::timed_out("The read timed out.");

        assert_eq!(timeout.code().as_str(), "QUERY_TIMEOUT");
        assert_eq!(timeout.category(), Category::Timeout);
        assert!(timeout.is_retryable());
    }

    #[test]
    fn retryability_narrows_and_never_widens() {
        let narrowed = Error::timed_out("x").retryable(false);
        assert!(!narrowed.is_retryable());

        let widened = Error::invalid("x").retryable(true);
        assert!(!widened.is_retryable());
    }

    #[test]
    fn details_that_are_not_an_object_are_wrapped_in_one() {
        let error = Error::invalid("x").details(json!(["a", "b"]));

        assert_eq!(
            error.fault().details(),
            &json!({ "detail": ["a", "b"] }),
            "details is always a JSON object on the wire"
        );
    }

    #[test]
    fn a_foreign_error_converts_through_the_question_mark() {
        fn convert() -> Result<(), Error> {
            let _: i64 = "nope".parse()?;
            Ok(())
        }

        let error = convert().unwrap_err();

        assert!(matches!(error, Error::Other(_)));
        assert_eq!(error.code().as_str(), crate::codes::UNSPECIFIED);
    }

    #[test]
    fn display_is_the_message_alone() {
        let error = Error::invalid("'ids' is required.").hint("Pass one id.");

        assert_eq!(error.to_string(), "'ids' is required.");
    }
}
