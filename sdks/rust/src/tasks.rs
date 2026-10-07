//! Creating tasks from a server action.
//!
//! The platform assigns the task to the user the action is running as and
//! creates the task and first-message ids. An action that must not start the
//! same work twice checks its own record before calling [`create`].

use serde::Deserialize;
use serde_json::{json, Value};

use crate::codes::Code;
use crate::error::{Error, Fault};
use crate::host;

/// The task returned after creation.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct Task {
    /// The platform-generated task identifier.
    pub id: String,
    /// The task's current revision.
    pub revision: u64,
    /// The task's current status.
    pub status: String,
}

/// The result of creating a task.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct CreateResult {
    /// The created task.
    pub task: Task,
}

/// Create a task for the user the server action is running as.
///
/// `input` must be a JSON object. The platform assigns both generated ids.
/// Check the action's own record first if it must not start the same work
/// twice.
pub fn create(task_type_id: &str, title: &str, input: Value) -> Result<CreateResult, Error> {
    if task_type_id.trim().is_empty() {
        return Err(Error::invalid(
            "task_type_id is required for task creation.",
        ));
    }
    if title.trim().is_empty() {
        return Err(Error::invalid("title is required for task creation."));
    }
    if !input.is_object() {
        return Err(Error::invalid("input must be an object for task creation."));
    }

    let data = host::transport()?.call(
        "action:tasks/create".to_string(),
        json!({
            "task_type_id": task_type_id,
            "title": title,
            "input": input,
        }),
    )?;

    serde_json::from_value(data).map_err(|cause| {
        Error::Host(Fault::new(
            Code::unspecified(),
            format!("Task creation returned an unreadable response: {cause}"),
        ))
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{create, CreateResult, Task};
    use crate::{testing, Error};

    #[test]
    fn creates_a_task_and_returns_the_platform_task() {
        let session = testing::install(|name, params| {
            assert_eq!(name, "action:tasks/create");
            assert_eq!(
                params,
                json!({
                    "task_type_id": "TTY000003",
                    "title": "Review the invoice",
                    "input": { "invoice_id": "INV000017" },
                })
            );
            Ok(json!({ "task": { "id": "TASK000042", "revision": 1, "status": "open" } }))
        });

        let result = create(
            "TTY000003",
            "Review the invoice",
            json!({ "invoice_id": "INV000017" }),
        )
        .unwrap();

        assert_eq!(
            result,
            CreateResult {
                task: Task {
                    id: "TASK000042".to_string(),
                    revision: 1,
                    status: "open".to_string(),
                },
            }
        );
        assert_eq!(session.calls().len(), 1);
        assert_eq!(session.calls()[0].name, "action:tasks/create");
        assert_eq!(
            session.calls()[0].params,
            json!({
                "task_type_id": "TTY000003",
                "title": "Review the invoice",
                "input": { "invoice_id": "INV000017" },
            })
        );
        assert_eq!(
            session.calls()[0]
                .params
                .as_object()
                .unwrap()
                .keys()
                .cloned()
                .collect::<Vec<_>>(),
            ["input", "task_type_id", "title"]
        );
    }

    #[test]
    fn an_empty_task_type_id_is_refused_before_anything_is_sent() {
        let session = testing::install(|_name, _params| Ok(json!({ "task": {} })));

        let error = create("  ", "Review", json!({})).unwrap_err();

        assert_eq!(error.code().as_str(), "INVALID_TOOL_INPUT");
        assert!(session.calls().is_empty());
    }

    #[test]
    fn an_empty_title_is_refused_before_anything_is_sent() {
        let session = testing::install(|_name, _params| Ok(json!({ "task": {} })));

        let error = create("TTY000003", "", json!({})).unwrap_err();

        assert_eq!(error.code().as_str(), "INVALID_TOOL_INPUT");
        assert!(session.calls().is_empty());
    }

    #[test]
    fn a_non_object_input_is_refused_before_anything_is_sent() {
        let session = testing::install(|_name, _params| Ok(json!({ "task": {} })));

        let error = create("TTY000003", "Review", json!([])).unwrap_err();

        assert_eq!(error.code().as_str(), "INVALID_TOOL_INPUT");
        assert!(session.calls().is_empty());
    }

    #[test]
    fn a_task_service_refusal_preserves_the_host_message() {
        let _session =
            testing::install(|_name, _params| Err(Error::failed("TASK_INPUT_INVALID: /title")));

        let error = create("TTY000003", "Review", json!({})).unwrap_err();

        assert!(matches!(error, Error::Host(_)));
        assert_eq!(
            error.message(),
            "action:tasks/create failed: TASK_INPUT_INVALID: /title"
        );
    }
}
