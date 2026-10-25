//! File an expense from a receipt that lives behind a URL.
//!
//! The two other examples are GraphQL actions. This one is the whole surface in
//! one handler: `settings` for the policy the tenant configured, `storage` for
//! the file, `ai` for what the file says, and `graphql` for the record — one `?`
//! between each and one `Error` out of all of them.
//!
//! Two things to take from it. The order is deliberate: the store is addressed
//! by content, so putting the file in first is the step that can be repeated
//! without filing the expense twice, and every refusal after it says so. And a
//! `DocumentHandle` travels: `storage` answers with one, `ai` reads it, the
//! mutation writes it into the record's `:document` field, and the action hands
//! the same handle back.

use simpleplatform_sdk::prelude::*;

/// The app the expense table and the policy both belong to.
const APP_ID: &str = "dev.simple.expenses";

/// The advertised input: who the expense is for, and where the receipt is.
///
/// Both constraints below are ones the handler enforces in its first few
/// lines, which is what makes them worth writing: a blank member is refused
/// there, so `length(min = 1)` says the same thing to a caller before it sends
/// anything. `format` says what kind of string the address is, and the
/// approval limit and the currency are deliberately absent — they are what the
/// tenant configured, read from `settings` at run time, so they are not this
/// payload's to declare.
#[derive(Deserialize, Schema)]
struct Input {
    /// The employee the expense is filed against.
    #[simple(length(min = 1))]
    employee_id: String,

    /// Where the receipt is read from.
    #[simple(length(min = 1), format = "uri")]
    receipt_url: String,
}

/// What this tenant configured, rather than what this action assumes.
#[derive(Deserialize)]
struct Policy {
    approval_limit: f64,
    currency: String,
}

/// What the receipt says, read out of the file against the schema below.
#[derive(Deserialize)]
struct Receipt {
    merchant: String,
    currency: String,
    total: f64,
}

#[derive(Deserialize)]
struct Filed {
    expense: Expense,
}

#[derive(Deserialize)]
struct Expense {
    id: String,
}

// The output type needs `Serialize`, and that is all the SDK asks of it.
// `Debug` is here for the tests below, where `Result::unwrap_err` wants the
// `Ok` type to carry it.
#[derive(Debug, Serialize)]
struct Output {
    expense_id: String,
    merchant: String,
    total: f64,
    receipt: DocumentHandle,
}

const FILE_EXPENSE: &str = r#"
    mutation FileExpense($employee: ID!, $merchant: String!, $total: numeric!, $receipt: jsonb!) {
      expense: insert_expenses__expense_one(
        object: {
          employee_id: $employee
          merchant: $merchant
          total: $total
          receipt: $receipt
          status: "submitted"
        }
      ) {
        id
      }
    }"#;

fn main() {
    simple::run(handler)
}

/// File an expense for an employee from a receipt held at an address.
///
/// The receipt is stored first and read afterwards, so the merchant, the
/// currency and the total on the expense are the ones on the file rather than
/// ones supplied alongside it. A receipt in a currency this app does not file
/// in, or a total over the approval limit the tenant configured, is refused
/// with the file already stored and the expense not filed.
///
/// @tool
/// @shortdesc File an expense from a receipt, reading its merchant, currency and total out of the file.
/// @usewhen An employee has a receipt that should become a filed expense.
fn handler(request: Request<Input>) -> Result<Output, Error> {
    let employee = request.data.employee_id.trim();
    let receipt_url = request.data.receipt_url.trim();

    if employee.is_empty() {
        return Err(Error::invalid("An expense is filed against an employee.")
            .hint("Pass the id of the employee the receipt belongs to."));
    }

    if receipt_url.is_empty() {
        return Err(Error::invalid("An expense is filed from a receipt.")
            .hint("Pass the address the receipt is read from."));
    }

    let policy: Policy = simple::settings::get(APP_ID, &["approval_limit", "currency"])?;

    let receipt = simple::storage::upload_external(
        Source::url(receipt_url),
        Target::new(APP_ID, "expense", "receipt"),
    )?;

    let read: Execution<Receipt> = simple::ai::extract(
        simple::serde_json::to_value(&receipt)?,
        "Read the merchant, the currency and the total from this receipt.",
        json!({
            "type": "object",
            "properties": {
                "merchant": { "type": "string" },
                "currency": { "type": "string" },
                "total": { "type": "number" }
            },
            "required": ["merchant", "currency", "total"]
        }),
        Options::default(),
    )?;

    let claim = read.data;

    if claim.currency != policy.currency {
        return Err(Error::domain(
            "RECEIPT_CURRENCY_MISMATCH",
            format!(
                "The receipt is in {} and this app files expenses in {}.",
                claim.currency, policy.currency
            ),
        )
        .details(json!({ "expected": policy.currency, "receipt": claim.currency }))
        .hint("File it against an app configured for that currency. The file is stored; the expense is not."));
    }

    if claim.total > policy.approval_limit {
        return Err(Error::domain(
            "EXPENSE_OVER_LIMIT",
            format!(
                "{} {} is over the {} approval limit.",
                claim.total, claim.currency, policy.approval_limit
            ),
        )
        .details(json!({
            "limit": policy.approval_limit,
            "merchant": claim.merchant,
            "total": claim.total,
        }))
        .hint("Send it for approval instead. The file is stored; the expense is not."));
    }

    let filed: Filed = simple::graphql::mutate(
        FILE_EXPENSE,
        json!({
            "employee": employee,
            "merchant": &claim.merchant,
            "receipt": &receipt,
            "total": claim.total,
        }),
    )?;

    Ok(Output {
        expense_id: filed.expense.id,
        merchant: claim.merchant,
        total: claim.total,
        receipt,
    })
}

#[cfg(test)]
mod tests {
    use simpleplatform_sdk::testing;

    use super::*;

    /// The action names of the four calls this action makes, in the order it
    /// makes them.
    const SETTINGS: &str = "action:settings/get";
    const UPLOAD: &str = "action:storage/upload-external";
    const ORCHESTRATOR: &str = "logic:dev.simple.system/ai-orchestrator";
    const DATABASE: &str = "action:db/execute";

    fn input(employee_id: &str, receipt_url: &str) -> Request<Input> {
        Request::new(Input {
            employee_id: employee_id.to_string(),
            receipt_url: receipt_url.to_string(),
        })
    }

    fn stored_receipt() -> Value {
        json!({
            "file_hash": "9f86d081884c7d65",
            "filename": "receipt.pdf",
            "mime_type": "application/pdf",
            "size": 24_576,
            "storage_path": "documents/9f/86/9f86d081884c7d65",
        })
    }

    /// A host that answers each of the four calls, with the receipt the model
    /// reads out of the file decided by the test.
    fn host(currency: &'static str, total: f64) -> impl Fn(String, Value) -> Result<Value, Error> {
        move |name, _params| match name.as_str() {
            SETTINGS => Ok(json!({ "approval_limit": 250.0, "currency": "USD" })),
            UPLOAD => Ok(stored_receipt()),
            ORCHESTRATOR => Ok(json!({
                "data": { "merchant": "Blue Bottle", "currency": currency, "total": total },
                "metadata": { "input_tokens": 1_840, "output_tokens": 32 },
            })),
            _ => Ok(json!({ "expense": { "id": "EXP-1" } })),
        }
    }

    #[test]
    fn it_stores_the_receipt_reads_it_and_files_what_it_says() {
        let session = testing::install(host("USD", 18.5));

        let output = handler(input("EMP-42", "https://example.com/receipt.pdf")).unwrap();

        assert_eq!(output.expense_id, "EXP-1");
        assert_eq!(output.merchant, "Blue Bottle");
        assert_eq!(output.total, 18.5);
        assert_eq!(output.receipt.file_hash, "9f86d081884c7d65");

        let calls = session.calls();

        assert_eq!(
            calls
                .iter()
                .map(|call| call.name.as_str())
                .collect::<Vec<_>>(),
            [SETTINGS, UPLOAD, ORCHESTRATOR, DATABASE],
        );

        // The handle the store answered with is the one the model was given and
        // the one the record was written with.
        assert_eq!(calls[2].params["input"], stored_receipt());
        assert_eq!(calls[3].params["variables"]["receipt"], stored_receipt());
    }

    #[test]
    fn an_expense_over_the_limit_is_not_filed() {
        let session = testing::install(host("USD", 940.0));

        let error = handler(input("EMP-42", "https://example.com/receipt.pdf")).unwrap_err();

        assert_eq!(error.code().as_str(), "EXPENSE_OVER_LIMIT");
        assert_eq!(
            session.calls().len(),
            3,
            "the file is stored and the expense is not"
        );
    }

    #[test]
    fn a_receipt_in_another_currency_is_not_filed() {
        let session = testing::install(host("EUR", 18.5));

        let error = handler(input("EMP-42", "https://example.com/receipt.pdf")).unwrap_err();

        assert_eq!(error.code().as_str(), "RECEIPT_CURRENCY_MISMATCH");
        assert_eq!(session.calls().len(), 3);
    }

    #[test]
    fn an_expense_with_nothing_to_read_is_refused_before_anything_is_sent() {
        let session = testing::install(host("USD", 18.5));

        let error = handler(input("EMP-42", "   ")).unwrap_err();

        assert_eq!(error.code().as_str(), "INVALID_TOOL_INPUT");
        assert!(session.calls().is_empty());
    }
}
