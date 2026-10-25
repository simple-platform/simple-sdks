//! Reading and writing tenant data.
//!
//! Two functions, both of which answer with the type you asked for:
//!
//! ```
//! # use simpleplatform_sdk::prelude::*;
//! # use simpleplatform_sdk::testing;
//! #[derive(Deserialize)]
//! struct Invoice {
//!     amount: f64,
//! }
//!
//! #[derive(Deserialize)]
//! struct Open {
//!     invoices: Vec<Invoice>,
//! }
//!
//! const OPEN: &str = r#"
//!   query Open($id: ID!) {
//!     invoices: crm__invoice(where: {customer_id: {_eq: $id}}, limit: 100) { amount }
//!   }"#;
//!
//! # let _session = testing::install(|_name, _params| {
//! #     Ok(json!({ "invoices": [{ "amount": 12.5 }, { "amount": 7.5 }] }))
//! # });
//! let open: Open = simple::graphql::query(OPEN, json!({ "id": "CUS1" }))?;
//! let total: f64 = open.invoices.iter().map(|invoice| invoice.amount).sum();
//!
//! assert_eq!(total, 20.0);
//! # Ok::<(), Error>(())
//! ```
//!
//! # Why the read and the write are separate functions
//!
//! A read that fails changed nothing; a write that fails *may have landed*, and
//! that single bit decides whether the call may be repeated. The party that knows
//! which of the two happened is the function that made the call, so each reports
//! its own outcome: [`query`] reports `QUERY_EXECUTION_FAILED` and [`mutate`]
//! reports `MUTATION_EXECUTION_FAILED`. An action author gets the right one by
//! calling the right function.
//!
//! The same split runs through the rest: a read whose response cannot be decoded
//! is `INVALID_QUERY_RESPONSE`, and a write whose result cannot be decoded is
//! `MUTATION_RESULT_UNREADABLE` — a write that ran and whose effect was never
//! established, which is never retried and always reported.
//!
//! # One function per intent
//!
//! There is no combined `execute`. Which function you call *is* the declaration
//! of intent, so what a failure means is settled at the call site. The document
//! check below stays what it is — a guard against an obvious mix-up, a mutation
//! handed to [`query`] or a query handed to [`mutate`] — and never the thing that
//! decides whether a write may be repeated.

use serde::de::DeserializeOwned;
use serde_json::{json, Value};

use crate::codes::Code;
use crate::error::{Error, Fault};
use crate::host::{self, DB_EXECUTE};

/// Read tenant data.
///
/// Refuses a document that is empty or that begins `mutation`, before anything
/// is sent.
///
/// ```
/// # use simpleplatform_sdk::prelude::*;
/// # use simpleplatform_sdk::testing;
/// # let _session = testing::install(|_name, _params| Ok(json!({ "rows": [] })));
/// #[derive(Deserialize)]
/// struct Answer {
///     rows: Vec<Value>,
/// }
///
/// let answer: Answer = simple::graphql::query("query Q { rows: app__thing { id } }", json!({}))?;
///
/// assert!(answer.rows.is_empty());
/// # Ok::<(), Error>(())
/// ```
pub fn query<T: DeserializeOwned>(document: &str, variables: Value) -> Result<T, Error> {
    let document = document.trim();

    if document.is_empty() {
        return Err(Error::Input(Fault::new(
            Code::QueryRequired,
            "A GraphQL query is required.",
        ))
        .hint("Provide a non-empty read-only GraphQL query."));
    }

    if is_mutation(document) {
        return Err(Error::Input(Fault::new(
            Code::QueryNotAllowed,
            "A mutation was passed to query.",
        ))
        .hint("Use simple::graphql::mutate for writes."));
    }

    let data = execute(document, variables).map_err(|cause| {
        Error::Query(Fault::new(Code::QueryExecutionFailed, cause.message()))
            .hint("Do not retry automatically. Review the query and report the execution failure.")
    })?;

    serde_json::from_value(data).map_err(|cause| {
        Error::Query(Fault::new(
            Code::InvalidQueryResponse,
            format!("The query returned a response this action could not read: {cause}"),
        ))
        .hint("Do not retry identical inputs. Report this response-decoding failure.")
    })
}

/// Write tenant data.
///
/// Refuses a document that is empty or that does not begin `mutation`, before
/// anything is sent.
pub fn mutate<T: DeserializeOwned>(document: &str, variables: Value) -> Result<T, Error> {
    let document = document.trim();

    if document.is_empty() {
        return Err(Error::Input(Fault::new(
            Code::MutationRequired,
            "A GraphQL mutation is required.",
        ))
        .hint("Provide a non-empty mutation document."));
    }

    if !is_mutation(document) {
        return Err(Error::Input(Fault::new(
            Code::NotAMutation,
            "A query was passed to mutate.",
        ))
        .hint("Use simple::graphql::query for reads. Nothing was written."));
    }

    let data = execute(document, variables).map_err(|cause| {
        Error::Mutation(Fault::new(Code::MutationExecutionFailed, cause.message())).hint(
            "Treat the effect as unknown: read the target rows back before any further write. \
             Do not repeat the mutation blindly.",
        )
    })?;

    serde_json::from_value(data).map_err(|cause| {
        Error::Mutation(Fault::new(
            Code::MutationResultUnreadable,
            format!("The mutation ran but its result could not be read: {cause}"),
        ))
        .hint(
            "Treat the effect as unknown: read the target rows back to confirm what changed \
             before any further write.",
        )
    })
}

/// One document, one round trip, one unwrapped result.
fn execute(document: &str, variables: Value) -> Result<Value, Error> {
    host::transport()?.call(
        DB_EXECUTE.to_string(),
        json!({ "query": document, "variables": variables }),
    )
}

/// Whether a document asks for a write.
///
/// This is a guard against an obvious mix-up, and never the thing that decides
/// what a failure means. That decision is made by which function was called.
///
/// The operation is read past anything GraphQL ignores, so a document is
/// classified by its operation whatever precedes it. An author who writes
///
/// ```graphql
/// # close the duplicate
/// mutation M { update_lead { id } }
/// ```
///
/// has written a mutation, and [`mutate`] sends it.
fn is_mutation(document: &str) -> bool {
    let rest = skip_ignored(document);

    let Some(rest) = rest.strip_prefix("mutation") else {
        return false;
    };

    // `mutationFoo` is not the mutation keyword. A name carries on with a name
    // character; anything else — `{`, `(`, `@`, a space, or the end — ends it.
    !rest.starts_with(|c: char| c.is_alphanumeric() || c == '_')
}

/// Drops what GraphQL ignores before a document's first real token.
///
/// Whitespace, line terminators, commas, a byte-order mark, and `#` comments to
/// the end of their line. Commas are ignored tokens in GraphQL exactly as
/// whitespace is, which is why they are here rather than being a typo.
fn skip_ignored(document: &str) -> &str {
    let mut rest = document.trim_start_matches('\u{feff}');

    loop {
        rest = rest.trim_start_matches(|c: char| c.is_whitespace() || c == ',');

        let Some(comment) = rest.strip_prefix('#') else {
            return rest;
        };

        // A comment runs to the line terminator, and the last line may have none.
        rest = comment.find(['\n', '\r']).map_or("", |end| &comment[end..]);
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::testing;

    #[test]
    fn a_read_answers_with_the_type_that_was_asked_for() {
        let _session = testing::install(|name, params| {
            assert_eq!(name, DB_EXECUTE);
            assert_eq!(params["query"], json!("query Q { rows { id } }"));
            assert_eq!(params["variables"], json!({ "limit": 1 }));

            Ok(json!({ "rows": [{ "id": "A" }] }))
        });

        let answer: Value = query("query Q { rows { id } }", json!({ "limit": 1 })).unwrap();

        assert_eq!(answer, json!({ "rows": [{ "id": "A" }] }));
    }

    #[test]
    fn a_mutation_sent_to_query_is_refused_before_anything_is_sent() {
        let session = testing::install(|_name, _params| Ok(json!({})));

        let error = query::<Value>("mutation M { insert_thing { id } }", json!({})).unwrap_err();

        assert_eq!(error.code().as_str(), "QUERY_NOT_ALLOWED");
        assert!(session.calls().is_empty());
    }

    #[test]
    fn a_query_sent_to_mutate_is_refused_before_anything_is_sent() {
        let session = testing::install(|_name, _params| Ok(json!({})));

        let error = mutate::<Value>("query Q { thing { id } }", json!({})).unwrap_err();

        assert_eq!(error.code().as_str(), "NOT_A_MUTATION");
        assert!(session.calls().is_empty());
    }

    #[test]
    fn an_empty_document_names_which_one_was_missing() {
        let _session = testing::install(|_name, _params| Ok(json!({})));

        assert_eq!(
            query::<Value>("   ", json!({}))
                .unwrap_err()
                .code()
                .as_str(),
            "QUERY_REQUIRED"
        );
        assert_eq!(
            mutate::<Value>("", json!({})).unwrap_err().code().as_str(),
            "MUTATION_REQUIRED"
        );
    }

    #[test]
    fn a_failed_read_and_a_failed_write_carry_different_codes() {
        let _session = testing::install(|_name, _params| Err(Error::failed("the host said no")));

        assert_eq!(
            query::<Value>("query Q { a }", json!({}))
                .unwrap_err()
                .code()
                .as_str(),
            "QUERY_EXECUTION_FAILED",
            "a failed read changed nothing"
        );
        assert_eq!(
            mutate::<Value>("mutation M { a }", json!({}))
                .unwrap_err()
                .code()
                .as_str(),
            "MUTATION_EXECUTION_FAILED",
            "a failed write may have landed"
        );
    }

    #[test]
    fn an_unreadable_result_says_so_differently_for_a_read_and_a_write() {
        let _session = testing::install(|_name, _params| Ok(json!({ "rows": "not a list" })));

        #[derive(Debug, serde::Deserialize)]
        struct Shape {
            #[allow(dead_code)]
            rows: Vec<Value>,
        }

        assert_eq!(
            query::<Shape>("query Q { rows { a } }", json!({}))
                .unwrap_err()
                .code()
                .as_str(),
            "INVALID_QUERY_RESPONSE"
        );
        assert_eq!(
            mutate::<Shape>("mutation M { rows { a } }", json!({}))
                .unwrap_err()
                .code()
                .as_str(),
            "MUTATION_RESULT_UNREADABLE"
        );
    }

    #[test]
    fn the_host_message_survives_into_the_failure() {
        let _session = testing::install(|_name, _params| Err(Error::failed("permission denied")));

        let error = query::<Value>("query Q { a }", json!({})).unwrap_err();

        assert!(error.message().contains("permission denied"));
    }

    // Whatever GraphQL ignores comes off first, so the operation is what
    // classifies the document.
    #[test]
    fn an_operation_behind_ignored_tokens_is_still_a_mutation() {
        assert!(is_mutation(
            "# close the duplicate\nmutation M { update_lead { id } }"
        ));
        assert!(is_mutation("#no space\r\nmutation M { x }"));
        assert!(is_mutation("# one\n  # two\n\nmutation M { x }"));
        assert!(is_mutation("\u{feff}mutation M { x }"));
        assert!(is_mutation(",,\n mutation M { x }"));
    }

    #[test]
    fn an_operation_behind_ignored_tokens_is_still_a_query() {
        assert!(!is_mutation("# fetch the leads\nquery Q { leads { id } }"));
        assert!(!is_mutation("# mutation M { x }\nquery Q { leads { id } }"));
        assert!(!is_mutation("{ leads { id } }"));
        assert!(!is_mutation(""));
        assert!(!is_mutation("# a comment and nothing else"));
    }

    // `mutation` is a keyword, not a prefix.
    #[test]
    fn a_name_that_merely_begins_mutation_is_not_the_keyword() {
        assert!(!is_mutation("mutationLog { id }"));
        assert!(!is_mutation("mutation_log { id }"));
        assert!(is_mutation("mutation{ x }"));
        assert!(is_mutation("mutation M($id: ID!) { x }"));
    }

    #[test]
    fn a_commented_mutation_is_written_by_mutate() {
        let session =
            testing::install(|_name, _params| Ok(json!({ "update_lead": { "id": "L1" } })));

        const DOCUMENT: &str = "# close the duplicate\nmutation M { update_lead { id } }";

        let answer: Value =
            mutate(DOCUMENT, json!({})).expect("a commented mutation is a mutation");

        assert_eq!(answer, json!({ "update_lead": { "id": "L1" } }));
        assert_eq!(session.calls().len(), 1);
    }

    #[test]
    fn a_commented_mutation_is_refused_by_query() {
        let session = testing::install(|_name, _params| Ok(json!(null)));

        const DOCUMENT: &str = "# close the duplicate\nmutation M { update_lead { id } }";

        let error = query::<Value>(DOCUMENT, json!({})).unwrap_err();

        assert_eq!(error.code().as_str(), "QUERY_NOT_ALLOWED");
        assert_eq!(session.calls().len(), 0, "nothing was sent");
    }
}
