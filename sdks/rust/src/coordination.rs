//! Holding a key so two runs do not do the same check-then-write at once.
//!
//! A key belongs to this app in this tenant. A run can hold one key at a time;
//! [`lock`] waits for the requested duration, and [`unlock`] lets the key go
//! before the run ends. Locks are for actions, not record behaviors.
//!
//! ```
//! # use simpleplatform_sdk::prelude::*;
//! # use simpleplatform_sdk::testing;
//! # let _session = testing::install(|name, _params| {
//! #     Ok(match name.as_str() {
//! #         "action:coordination/lock" => json!({ "acquired": true }),
//! #         "action:coordination/unlock" => json!({ "released": true }),
//! #         _ => json!(null),
//! #     })
//! # });
//! # fn read_report() -> Result<Value, Error> { Ok(json!({})) }
//! # fn write_report(_report: Value) -> Result<(), Error> { Ok(()) }
//! use std::time::Duration;
//!
//! if simple::coordination::lock("daily-report", Duration::from_secs(5))? {
//!     let current = read_report()?;
//!     write_report(current)?;
//!     simple::coordination::unlock("daily-report")?;
//! }
//! # Ok::<(), Error>(())
//! ```

use std::time::Duration;

use serde_json::{json, Value};

use crate::error::Error;
use crate::host;

/// The host action that waits to hold a coordination key.
const COORDINATION_LOCK: &str = "action:coordination/lock";
/// The host action that lets this run's coordination key go.
const COORDINATION_UNLOCK: &str = "action:coordination/unlock";
const MAX_KEY_BYTES: usize = 1_024;

/// Try to hold a coordination key, waiting up to `wait`.
///
/// The wait is sent as whole milliseconds; any fractional millisecond is
/// rounded down. Returns `false` when another run still holds the key after
/// the wait. A run holding the same key already gets `true` from the host.
///
/// The key must be a non-empty string no longer than 1,024 UTF-8 bytes. A run
/// may hold one key at a time. Locks are released when the run ends.
pub fn lock(key: &str, wait: Duration) -> Result<bool, Error> {
    validate_key(key)?;

    let wait_ms = u64::try_from(wait.as_millis()).map_err(|_| {
        Error::invalid("A coordination lock wait must fit in whole milliseconds sent to the host.")
            .hint("Pass a shorter wait duration. Nothing was sent.")
    })?;

    let answer = host::transport()?.call(
        COORDINATION_LOCK.to_string(),
        json!({ "key": key, "wait_ms": wait_ms }),
    )?;

    read_boolean(&answer, "acquired", "lock")
}

/// Let this run's coordination key go before the run ends.
///
/// Returns `false` when this run did not hold `key`. The key must be a
/// non-empty string no longer than 1,024 UTF-8 bytes.
pub fn unlock(key: &str) -> Result<bool, Error> {
    validate_key(key)?;

    let answer = host::transport()?.call(COORDINATION_UNLOCK.to_string(), json!({ "key": key }))?;

    read_boolean(&answer, "released", "unlock")
}

fn validate_key(key: &str) -> Result<(), Error> {
    if key.is_empty() {
        return Err(
            Error::invalid("A coordination key must be a non-empty string.")
                .hint("Pass a key containing at least one character. Nothing was sent."),
        );
    }

    if key.len() > MAX_KEY_BYTES {
        return Err(
            Error::invalid("A coordination key must be at most 1,024 UTF-8 bytes.")
                .hint("Shorten the key. Nothing was sent."),
        );
    }

    Ok(())
}

fn read_boolean(answer: &Value, field: &str, operation: &str) -> Result<bool, Error> {
    answer.get(field).and_then(Value::as_bool).ok_or_else(|| {
        Error::failed(format!(
            "The coordination {operation} answer did not include a {field} boolean."
        ))
    })
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use serde_json::json;

    use super::*;
    use crate::testing;

    #[test]
    fn invalid_keys_are_refused_before_the_host_is_called() {
        let session = testing::install(|_name, _params| Ok(json!({ "acquired": true })));

        for key in ["", &"a".repeat(1_025), &"é".repeat(513)] {
            assert_eq!(
                lock(key, Duration::ZERO).unwrap_err().code().as_str(),
                "INVALID_TOOL_INPUT"
            );
            assert_eq!(
                unlock(key).unwrap_err().code().as_str(),
                "INVALID_TOOL_INPUT"
            );
        }

        assert!(session.calls().is_empty(), "nothing was sent");
    }

    #[test]
    fn a_key_at_the_utf8_byte_limit_is_accepted() {
        let key = "é".repeat(512);
        let expected_key = key.clone();
        let session = testing::install(move |name, params| {
            assert_eq!(name, COORDINATION_LOCK);
            assert_eq!(params["key"], json!(expected_key));
            assert_eq!(params["wait_ms"], json!(1_234));
            Ok(json!({ "acquired": true }))
        });

        assert!(lock(&key, Duration::from_millis(1_234)).unwrap());
        assert_eq!(session.calls().len(), 1);
    }

    #[test]
    fn the_wait_is_sent_as_whole_milliseconds() {
        let session = testing::install(|_name, params| {
            assert_eq!(params["wait_ms"], json!(1));
            Ok(json!({ "acquired": true }))
        });

        assert!(lock("key", Duration::from_micros(1_999)).unwrap());
        assert_eq!(session.calls()[0].name, COORDINATION_LOCK);
    }

    #[test]
    fn lock_passes_the_platform_error_through_for_another_key() {
        let session = testing::install(|_name, params| {
            if params["key"] == "report" {
                Ok(json!({ "acquired": true }))
            } else {
                Err(Error::failed(
                    "This run already holds a lock on another key; unlock it first.",
                ))
            }
        });

        assert!(lock("report", Duration::ZERO).unwrap());
        assert!(lock("report", Duration::ZERO).unwrap());
        assert!(lock("other", Duration::ZERO)
            .unwrap_err()
            .message()
            .contains("This run already holds a lock on another key; unlock it first."));
        assert_eq!(session.calls().len(), 3);
    }

    #[test]
    fn unlock_sends_the_exact_action_and_parameters_and_returns_true_or_false() {
        let released = std::cell::Cell::new(true);
        let session = testing::install(move |name, params| {
            assert_eq!(name, COORDINATION_UNLOCK);
            assert_eq!(params, json!({ "key": "report" }));
            let answer = json!({ "released": released.replace(false) });
            Ok(answer)
        });

        assert!(unlock("report").unwrap());
        assert!(!unlock("report").unwrap());
        assert_eq!(session.calls().len(), 2);
        assert!(session
            .calls()
            .iter()
            .all(|call| call.name == COORDINATION_UNLOCK));
    }

    #[test]
    fn a_refused_lock_and_unlock_keep_the_host_message() {
        let _session = testing::install(|_name, _params| Err(Error::failed("permission denied")));

        assert!(lock("key", Duration::ZERO)
            .unwrap_err()
            .message()
            .contains("permission denied"));
        assert!(unlock("key")
            .unwrap_err()
            .message()
            .contains("permission denied"));
    }

    #[test]
    fn answers_without_the_result_boolean_are_errors() {
        let _session = testing::install(|_name, _params| Ok(json!({})));

        assert!(lock("key", Duration::ZERO)
            .unwrap_err()
            .message()
            .contains("acquired boolean"));
        assert!(unlock("key")
            .unwrap_err()
            .message()
            .contains("released boolean"));
    }

    #[test]
    fn a_wait_larger_than_the_wire_integer_is_refused_without_a_call() {
        let session = testing::install(|_name, _params| Ok(json!({ "acquired": true })));
        let wait = Duration::from_secs(u64::MAX);

        let error = lock("key", wait).unwrap_err();

        assert!(error.message().contains("fit in whole milliseconds"));
        assert!(session.calls().is_empty());
    }
}
