//! Close a lead as a duplicate of another one.
//!
//! A worked example of the shape most actions have: two GraphQL calls — a read,
//! then a write — and several ways to refuse before either of them happens.
//!
//! Two things to take from it. Reads and writes are separate calls, so a read
//! goes through `simple::graphql::query` and a write through
//! `simple::graphql::mutate`. And every refusal is an `Error` with a code, a
//! `details` object naming what went wrong and a `hint` saying what to do about
//! it, so the caller can act on the refusal instead of guessing at it.

use simpleplatform_sdk::prelude::*;

/// The advertised input: the lead to close, and the one it duplicates.
///
/// No `#[simple(…)]` on either member, because this action asks nothing of
/// these two strings that the type has not already said. They are required
/// because they are not `Option<String>`, they are named by `serde`, and they
/// are described by the doc comments below. A lead id has no shape to write a
/// `pattern` for and no length to bound, and the one rule that does apply — the
/// two ids are different — is about the pair rather than either member, so the
/// handler is where it is checked and where the refusal explains it.
#[derive(Deserialize, Schema)]
struct Input {
    /// The lead to close, by identifier.
    lead_id: String,

    /// The lead it duplicates, which is the one that survives.
    duplicate_of: String,
}

#[derive(Deserialize)]
struct Lead {
    id: String,
    status: String,
    email: Option<String>,
}

#[derive(Deserialize)]
struct Found {
    leads: Vec<Lead>,
}

#[derive(Deserialize)]
struct Closed {
    result: Affected,
}

#[derive(Deserialize)]
struct Affected {
    affected_rows: i64,
}

// The output type needs `Serialize`, and that is all the SDK asks of it.
// `Debug` is here for the tests below, where `Result::unwrap_err` wants the
// `Ok` type to carry it.
#[derive(Debug, Serialize)]
struct Output {
    closed: String,
    merged_into: String,
    rows_changed: i64,
}

const FIND_LEADS: &str = r#"
    query FindLeads($ids: [ID!]!) {
      leads: crm__lead(where: {id: {_in: $ids}}, limit: 2) {
        id
        status
        email
      }
    }"#;

const CLOSE_LEAD: &str = r#"
    mutation CloseLead($id: ID!, $merged: ID!) {
      result: update_crm__lead(
        where: {id: {_eq: $id}}
        _set: {status: "closed", merged_into: $merged}
      ) {
        affected_rows
      }
    }"#;

fn main() {
    simple::run(handler)
}

/// Close a duplicate lead and point it at the record that survives.
///
/// The surviving lead keeps its activity; the duplicate is marked closed and
/// linked to it, so a later report still reaches both. Both leads have to
/// exist and to carry the same email address before anything is written, and a
/// lead that is already closed is left as it is.
///
/// @tool
/// @short_desc Close a duplicate lead, pointing it at the surviving record.
/// @when_use A lead is a duplicate of one already in the system.
/// @when_use Two leads share a contact and one should be retired.
fn handler(request: Request<Input>) -> Result<Output, Error> {
    let duplicate = request.data.lead_id.trim();
    let survivor = request.data.duplicate_of.trim();

    if duplicate == survivor {
        return Err(Error::invalid("A lead cannot be a duplicate of itself.")
            .hint("Pass two different lead ids."));
    }

    let found: Found = simple::graphql::query(FIND_LEADS, json!({ "ids": [duplicate, survivor] }))?;

    let duplicate_lead = found
        .leads
        .iter()
        .find(|lead| lead.id == duplicate)
        .ok_or_else(|| {
            Error::invalid(format!("Lead {duplicate} does not exist."))
                .details(json!({ "missing": duplicate }))
                .hint("Search for the lead before closing it.")
        })?;

    let survivor_lead = found
        .leads
        .iter()
        .find(|lead| lead.id == survivor)
        .ok_or_else(|| {
            Error::invalid(format!("Lead {survivor} does not exist."))
                .details(json!({ "missing": survivor }))
                .hint("Search for the lead before merging into it.")
        })?;

    if duplicate_lead.status == "closed" {
        return Err(Error::domain(
            "LEAD_ALREADY_CLOSED",
            format!("Lead {duplicate} is already closed."),
        )
        .hint("Nothing to do."));
    }

    if duplicate_lead.email != survivor_lead.email {
        return Err(Error::domain(
            "LEAD_EMAIL_MISMATCH",
            "The two leads do not share an email address.",
        )
        .details(json!({
            "duplicate": duplicate_lead.email,
            "survivor": survivor_lead.email,
        }))
        .hint("Confirm these are the same person before merging them."));
    }

    let closed: Closed =
        simple::graphql::mutate(CLOSE_LEAD, json!({ "id": duplicate, "merged": survivor }))?;

    Ok(Output {
        closed: duplicate.to_string(),
        merged_into: survivor.to_string(),
        rows_changed: closed.result.affected_rows,
    })
}

#[cfg(test)]
mod tests {
    use simpleplatform_sdk::testing;

    use super::*;

    fn input(lead_id: &str, duplicate_of: &str) -> Request<Input> {
        Request::new(Input {
            lead_id: lead_id.to_string(),
            duplicate_of: duplicate_of.to_string(),
        })
    }

    fn two_leads() -> Value {
        json!({
            "leads": [
                { "id": "LEAD1", "status": "open", "email": "a@example.com" },
                { "id": "LEAD2", "status": "open", "email": "a@example.com" }
            ]
        })
    }

    #[test]
    fn it_closes_the_duplicate_and_reports_what_changed() {
        let session = testing::install(|_name, params| {
            if params["query"].as_str().unwrap().contains("mutation") {
                Ok(json!({ "result": { "affected_rows": 1 } }))
            } else {
                Ok(two_leads())
            }
        });

        let output = handler(input("LEAD1", "LEAD2")).unwrap();

        assert_eq!(output.closed, "LEAD1");
        assert_eq!(output.rows_changed, 1);
        assert_eq!(session.calls().len(), 2);
    }

    #[test]
    fn a_lead_that_is_its_own_duplicate_is_refused_before_any_read() {
        let session = testing::install(|_name, _params| Ok(json!(null)));

        let error = handler(input("LEAD1", "LEAD1")).unwrap_err();

        assert_eq!(error.code().as_str(), "INVALID_TOOL_INPUT");
        assert!(session.calls().is_empty());
    }

    #[test]
    fn a_mismatched_email_stops_the_write() {
        let session = testing::install(|_name, _params| {
            Ok(json!({
                "leads": [
                    { "id": "LEAD1", "status": "open", "email": "a@example.com" },
                    { "id": "LEAD2", "status": "open", "email": "b@example.com" }
                ]
            }))
        });

        let error = handler(input("LEAD1", "LEAD2")).unwrap_err();

        assert_eq!(error.code().as_str(), "LEAD_EMAIL_MISMATCH");
        assert_eq!(session.calls().len(), 1, "nothing was written");
    }

    #[test]
    fn a_write_the_host_refused_says_the_effect_is_unknown() {
        let _session = testing::install(|_name, params| {
            if params["query"].as_str().unwrap().contains("mutation") {
                Err(Error::failed("deadlock detected"))
            } else {
                Ok(two_leads())
            }
        });

        let error = handler(input("LEAD1", "LEAD2")).unwrap_err();

        assert_eq!(error.code().as_str(), "MUTATION_EXECUTION_FAILED");
    }

    #[test]
    fn the_whole_run_reports_one_envelope_the_platform_can_read() {
        let session = testing::install(|_name, _params| Ok(json!(null)))
            .with_request(json!({ "lead_id": "LEAD1", "duplicate_of": "LEAD1" }));

        simple::run(handler);

        let done = session.done().unwrap();

        assert_eq!(done["ok"], json!(true));
        assert_eq!(
            done["data"]["error"]["extensions"]["retryable"],
            json!(false)
        );
    }
}
