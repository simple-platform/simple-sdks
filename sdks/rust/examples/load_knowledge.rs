//! `load-knowledge`: fetch knowledge articles by id, ready to act on.
//!
//! A complete action, and a good one to read first. Its whole surface is a
//! payload, one GraphQL read and a result, which is the smallest shape a real
//! action has.
//!
//! # What to take from it
//!
//! **Describe the answer you want, then deserialise into it.** `Loaded` and
//! `Article` below are the shape the query asks for, so the answer is decoded
//! once, into types, and the handler works on Rust values from its first line.
//! An answer that does not fit that shape becomes `INVALID_QUERY_RESPONSE`
//! before the handler is entered, so there is no shape-checking to write.
//!
//! **Let a row be missing what it was not given.** Every member of `Article` is
//! optional and defaulted, because a GraphQL row may answer `null` for anything
//! it was asked for. A short row is then a row with empty members.
//!
//! **Refuse with a code.** Each refusal here carries one: a malformed or absent
//! id is `INVALID_TOOL_INPUT` with `details` naming the ids and a `hint` saying
//! what to do next, and a read the host refused arrives as
//! `QUERY_EXECUTION_FAILED`, which says a failed read changed nothing. A caller
//! that gets a code can decide what to do; a caller that gets prose has to
//! guess.

use std::collections::HashMap;

use simpleplatform_sdk::prelude::*;

/// The advertised input: knowledge record ids.
///
/// One constraint, because one is what this action actually asks for: it needs
/// at least one id to load anything, and `length` on a collection is a count of
/// its elements. The `KNOW` prefix each id carries is a rule about the strings
/// inside the collection rather than about the collection, so it is described
/// in the doc comment and enforced in `wanted_ids`, which is where the refusal
/// can name the ids that broke it.
#[derive(Deserialize, Schema)]
struct Input {
    /// Knowledge record ids (`KNOW...`).
    #[simple(length(min = 1))]
    ids: Vec<String>,
}

/// The read, in the shape the query asks for.
#[derive(Deserialize)]
struct Loaded {
    knowledge: Vec<Article>,
}

/// One row of it.
///
/// Every member is optional and defaulted, because a GraphQL row may answer
/// `null` for anything it was asked for and a selection may be narrowed later.
/// A row that arrives short is then a row with empty members, not a failure.
#[derive(Default, Deserialize)]
#[serde(default)]
struct Article {
    id: Option<String>,
    title: Option<String>,
    body: Option<String>,
    created_at: Option<String>,
    updated_at: Option<String>,
    creator: Option<Person>,
    editor: Option<Person>,
}

/// Whoever wrote or last edited a row.
#[derive(Default, Deserialize)]
#[serde(default)]
struct Person {
    first_name: Option<String>,
    last_name: Option<String>,
    email: Option<String>,
}

impl Person {
    /// The fullest name this person has, or their email, or nothing.
    fn full_name(&self) -> String {
        let first = trimmed(&self.first_name);
        let last = trimmed(&self.last_name);

        match (first.is_empty(), last.is_empty()) {
            (false, false) => format!("{first} {last}"),
            (false, true) => first,
            (true, false) => last,
            (true, true) => trimmed(&self.email),
        }
    }
}

/// One article, as this action reports it.
#[derive(Debug, Serialize)]
struct Item {
    id: String,
    title: String,
    body: String,
    updated_by: String,
    updated_at: String,
}

/// What the action returns.
#[derive(Debug, Serialize)]
struct Output {
    items: Vec<Item>,
}

const LOAD_KNOWLEDGE: &str = r#"
    query LoadKnowledgeBatch($ids: [ID!]!, $limit: Int!) {
      knowledge: dev_simple_system__knowledge(where: {id: {_in: $ids}}, limit: $limit) {
        id
        title
        body
        created_at
        updated_at
        creator { first_name last_name email }
        editor { first_name last_name email }
      }
    }"#;

fn main() {
    simple::run(handler)
}

/// Load one or more knowledge articles by id, with execution-ready fields.
///
/// Every article comes back with its title, its body, and the name of whoever
/// last touched it with the time they did, in the order the ids were given. An
/// id that matches nothing is named in the refusal rather than dropped from the
/// answer, so a caller either gets every article it asked for or is told which
/// one it cannot have.
///
/// @tool
/// @short_desc Fetch knowledge articles by id, each with its title, body, and who last updated it when.
/// @when_use The id of a knowledge article is known and its contents are needed.
/// @when_use Several knowledge ids came out of a search and have to be read together.
fn handler(request: Request<Input>) -> Result<Output, Error> {
    let ids = wanted_ids(request.data.ids)?;

    let loaded: Loaded =
        simple::graphql::query(LOAD_KNOWLEDGE, json!({ "ids": ids, "limit": ids.len() }))?;

    let mut found: HashMap<String, Item> = loaded
        .knowledge
        .into_iter()
        .filter_map(|article| {
            let id = trimmed(&article.id);

            if id.is_empty() {
                return None;
            }

            Some((id.clone(), item(id, article)))
        })
        .collect();

    let missing: Vec<&String> = ids.iter().filter(|id| !found.contains_key(*id)).collect();

    if !missing.is_empty() {
        return Err(Error::invalid(format!(
            "Knowledge article(s) not found: {}.",
            join(&missing)
        ))
        .details(json!({ "missing": missing }))
        .hint("Search for the article before loading it, or drop the id that does not exist."));
    }

    Ok(Output {
        items: ids
            .iter()
            .filter_map(|id| found.remove(id))
            .collect::<Vec<Item>>(),
    })
}

/// The ids to load: trimmed, de-duplicated, and every one of them a `KNOW` id.
fn wanted_ids(requested: Vec<String>) -> Result<Vec<String>, Error> {
    let mut wanted: Vec<String> = Vec::with_capacity(requested.len());
    let mut invalid: Vec<String> = Vec::new();

    for id in requested {
        let id = id.trim().to_string();

        if id.is_empty() {
            continue;
        }

        if !id.starts_with("KNOW") {
            invalid.push(id);
            continue;
        }

        if !wanted.contains(&id) {
            wanted.push(id);
        }
    }

    if !invalid.is_empty() {
        return Err(
            Error::invalid(format!("Invalid knowledge id(s): {}.", join(&invalid)))
                .details(json!({ "invalid": invalid }))
                .hint("A knowledge id begins with KNOW."),
        );
    }

    if wanted.is_empty() {
        return Err(Error::invalid("'ids' must contain at least one KNOW id.")
            .hint("Pass one or more knowledge record ids."));
    }

    Ok(wanted)
}

/// One row, reduced to what a caller can act on.
///
/// The editor's name is preferred over the creator's, and the updated timestamp
/// over the created one, because what a reader wants is the state of the article
/// now rather than its provenance.
fn item(id: String, article: Article) -> Item {
    let editor = article.editor.unwrap_or_default().full_name();
    let creator = article.creator.unwrap_or_default().full_name();

    Item {
        id,
        title: trimmed(&article.title),
        body: trimmed(&article.body),
        updated_by: if editor.is_empty() { creator } else { editor },
        updated_at: match trimmed(&article.updated_at) {
            empty if empty.is_empty() => trimmed(&article.created_at),
            updated => updated,
        },
    }
}

/// A value the row may not have carried, as a trimmed string.
fn trimmed(value: &Option<String>) -> String {
    value.as_deref().unwrap_or_default().trim().to_string()
}

/// A list of names, for a sentence.
fn join<T: std::fmt::Display>(values: &[T]) -> String {
    values
        .iter()
        .map(T::to_string)
        .collect::<Vec<String>>()
        .join(", ")
}

#[cfg(test)]
mod tests {
    use simpleplatform_sdk::testing;

    use super::*;

    fn article(id: &str) -> Value {
        json!({
            "id": id,
            "title": format!("Title of {id}"),
            "body": "  Body.  ",
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-02-02T00:00:00Z",
            "creator": { "first_name": "Ada", "last_name": "Lovelace", "email": "ada@acme.test" },
            "editor": { "first_name": "Grace", "last_name": null, "email": "grace@acme.test" }
        })
    }

    #[test]
    fn it_loads_articles_in_the_order_they_were_asked_for() {
        let session = testing::install(|_name, params| {
            assert_eq!(params["variables"]["ids"], json!(["KNOW2", "KNOW1"]));
            assert_eq!(params["variables"]["limit"], json!(2));

            Ok(json!({ "knowledge": [article("KNOW1"), article("KNOW2")] }))
        });

        let output = handler(Request::new(Input {
            ids: vec!["KNOW2".into(), " KNOW1 ".into(), "KNOW2".into()],
        }))
        .unwrap();

        assert_eq!(
            output.items.iter().map(|item| &item.id).collect::<Vec<_>>(),
            vec!["KNOW2", "KNOW1"]
        );
        assert_eq!(output.items[0].body, "Body.");
        assert_eq!(output.items[0].updated_by, "Grace");
        assert_eq!(output.items[0].updated_at, "2026-02-02T00:00:00Z");
        assert_eq!(session.calls().len(), 1);
    }

    #[test]
    fn a_row_with_no_editor_falls_back_to_its_creator() {
        let _session = testing::install(|_name, _params| {
            Ok(json!({
                "knowledge": [{
                    "id": "KNOW1",
                    "title": "T",
                    "body": "B",
                    "created_at": "2026-01-01T00:00:00Z",
                    "updated_at": null,
                    "creator": { "first_name": "Ada", "last_name": "Lovelace" },
                    "editor": null
                }]
            }))
        });

        let output = handler(Request::new(Input {
            ids: vec!["KNOW1".into()],
        }))
        .unwrap();

        assert_eq!(output.items[0].updated_by, "Ada Lovelace");
        assert_eq!(output.items[0].updated_at, "2026-01-01T00:00:00Z");
    }

    #[test]
    fn an_id_that_is_not_a_knowledge_id_is_refused_before_the_read() {
        let session = testing::install(|_name, _params| Ok(json!({ "knowledge": [] })));

        let error = handler(Request::new(Input {
            ids: vec!["KNOW1".into(), "PROJ9".into()],
        }))
        .unwrap_err();

        assert_eq!(error.code().as_str(), "INVALID_TOOL_INPUT");
        assert!(error.message().contains("PROJ9"));
        assert!(session.calls().is_empty());
    }

    #[test]
    fn an_article_that_does_not_exist_is_named() {
        let _session =
            testing::install(|_name, _params| Ok(json!({ "knowledge": [article("KNOW1")] })));

        let error = handler(Request::new(Input {
            ids: vec!["KNOW1".into(), "KNOW404".into()],
        }))
        .unwrap_err();

        assert!(error.message().contains("KNOW404"));
        assert_eq!(error.fault().details()["missing"], json!(["KNOW404"]));
    }

    #[test]
    fn a_read_that_answers_with_the_wrong_shape_is_a_response_failure() {
        let _session = testing::install(|_name, _params| Ok(json!({ "knowledge": "nope" })));

        let error = handler(Request::new(Input {
            ids: vec!["KNOW1".into()],
        }))
        .unwrap_err();

        assert_eq!(error.code().as_str(), "INVALID_QUERY_RESPONSE");
    }

    #[test]
    fn a_read_the_host_refused_says_a_failed_read_changed_nothing() {
        let _session =
            testing::install(|_name, _params| Err(Error::failed("database unavailable")));

        let error = handler(Request::new(Input {
            ids: vec!["KNOW1".into()],
        }))
        .unwrap_err();

        assert_eq!(error.code().as_str(), "QUERY_EXECUTION_FAILED");
    }

    #[test]
    fn the_whole_run_reports_one_readable_envelope() {
        let session =
            testing::install(|_name, _params| Ok(json!({ "knowledge": [article("KNOW1")] })))
                .with_request(json!({ "ids": ["KNOW1"] }));

        simple::run(handler);

        let done = session.done().unwrap();

        assert_eq!(done["ok"], json!(true));
        assert_eq!(done["errors"], json!([]));
        assert_eq!(done["data"]["items"][0]["id"], json!("KNOW1"));
    }

    #[test]
    fn a_failing_run_reports_a_failure_the_platform_can_read() {
        let session = testing::install(|_name, _params| Ok(json!({ "knowledge": [] })))
            .with_request(json!({ "ids": ["NOPE"] }));

        simple::run(handler);

        let extensions = session.done().unwrap()["data"]["error"]["extensions"].clone();

        assert_eq!(extensions["code"], json!("INVALID_TOOL_INPUT"));
        assert_eq!(extensions["category"], json!("validation"));
        assert_eq!(extensions["retryable"], json!(false));
        assert!(extensions["details"].is_object());
        assert!(extensions["hint"].is_string());
    }
}
