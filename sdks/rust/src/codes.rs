//! The failure vocabulary an action may report, as a closed enum.
//!
//! # Why this is an enum and not a string
//!
//! A failure leaves an action as a code, and the platform translates that code
//! into a canonical code, a canonical category, and — the part no action author
//! can be trusted to declare — an *effect on stored data*. A failed read changed
//! nothing; a failed write may have landed, and that single bit decides whether
//! the platform may retry the call on its own.
//!
//! The translation table stays on the platform side. What lives here is the
//! vocabulary the table is keyed by, so that a code with no translation is a
//! compile error as you type rather than something to find out later, and so that
//! there is one list to read.
//!
//! # A code you do not find here
//!
//! [`Code::Custom`] exists so an action can say "this invoice is already paid"
//! without waiting for a platform release. A custom code is carried through to
//! the model verbatim beside a generic canonical translation, which the platform
//! treats as *effect unknown* — the safe reading, since nothing establishes what
//! a code it has never seen did. Reach for a canonical variant where one fits.

use std::fmt;

/// Every code the platform's translation table is keyed by, in table order.
///
/// This is the list a cross-language conformance check reads. Keep it in step
/// with [`Code::as_str`] — the test in this module fails otherwise.
pub const CANONICAL: [&str; 25] = [
    "INVALID_TOOL_INPUT",
    "MUTATION_REQUIRED",
    "QUERY_REQUIRED",
    "INVALID_VARIABLES",
    "MISSING_GRAPHQL_VARIABLES",
    "UNDECLARED_GRAPHQL_VARIABLES",
    "UNSUPPORTED_GRAPHQL_VARIABLE_TYPE",
    "UNSUPPORTED_GRAPHQL_VARIABLE_DEFAULT",
    "INVALID_GRAPHQL_VARIABLE_VALUE",
    "INVALID_GRAPHQL_QUERY",
    "INVALID_GRAPHQL_MUTATION",
    "QUERY_NOT_ALLOWED",
    "NOT_A_MUTATION",
    "RESERVED_MUTATION_ALIAS",
    "INVALID_DATE_FILTER",
    "QUERY_FORBIDDEN",
    "QUERY_TIMEOUT",
    "DATABASE_UNAVAILABLE",
    "QUERY_EXECUTION_FAILED",
    "MUTATION_EXECUTION_FAILED",
    "MUTATION_RESULT_UNREADABLE",
    "INVALID_QUERY_RESPONSE",
    "INVALID_MUTATION_RESPONSE",
    "PAGINATION_FAILED",
    "QUERY_DATA_FAILED",
];

/// What a custom code degrades to when it is not a shape the wire accepts.
///
/// It has no entry in the platform's table, which is the honest answer: an
/// action failed for a reason the platform has no canonical name for.
pub const UNSPECIFIED: &str = "ACTION_FAILED";

/// The most bytes a code may spend on the wire.
const MAX_CODE_BYTES: usize = 64;

/// The fewest, below which a code names nothing.
const MIN_CODE_BYTES: usize = 2;

/// A code the platform can translate, or one this action defines for itself.
#[non_exhaustive]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Code {
    /// The input could not be accepted at all.
    InvalidToolInput,
    /// A write was asked for and no mutation document was given.
    MutationRequired,
    /// A read was asked for and no query document was given.
    QueryRequired,
    /// The variables were not an object map.
    InvalidVariables,
    /// The document declares variables the call did not supply.
    MissingGraphqlVariables,
    /// The call supplied variables the document does not declare.
    UndeclaredGraphqlVariables,
    /// A variable declaration uses a type the dialect does not carry.
    UnsupportedGraphqlVariableType,
    /// A variable declaration carries a default, which is not supported.
    UnsupportedGraphqlVariableDefault,
    /// A variable value does not match its declaration.
    InvalidGraphqlVariableValue,
    /// The query document was rejected.
    InvalidGraphqlQuery,
    /// The mutation document was rejected.
    InvalidGraphqlMutation,
    /// A mutation was sent where only a read is allowed.
    QueryNotAllowed,
    /// A read was sent where only a mutation is allowed.
    NotAMutation,
    /// A mutation root alias collides with a reserved result member.
    ReservedMutationAlias,
    /// A date or datetime filter is invalid.
    InvalidDateFilter,
    /// The current user may not run the operation.
    QueryForbidden,
    /// The read did not finish in time. Retryable.
    QueryTimeout,
    /// The data service is unavailable. Retryable.
    DatabaseUnavailable,
    /// The read was accepted and then failed. Nothing was written.
    QueryExecutionFailed,
    /// The write was accepted and then failed. It may have landed.
    MutationExecutionFailed,
    /// The write ran and returned a result that could not be read.
    MutationResultUnreadable,
    /// A read returned a response this action could not decode.
    InvalidQueryResponse,
    /// A write returned a response this action could not decode.
    InvalidMutationResponse,
    /// Pagination metadata could not be produced.
    PaginationFailed,
    /// A failure with no more specific account of itself.
    QueryDataFailed,
    /// A code this action defines. Translated generically, effect unknown.
    Custom(String),
}

impl Code {
    /// The code exactly as it travels on the wire.
    ///
    /// For [`Code::Custom`] this is the string as given, which may not be a
    /// shape the wire accepts; [`Code::wire`] is what the envelope emits.
    pub fn as_str(&self) -> &str {
        match self {
            Code::InvalidToolInput => "INVALID_TOOL_INPUT",
            Code::MutationRequired => "MUTATION_REQUIRED",
            Code::QueryRequired => "QUERY_REQUIRED",
            Code::InvalidVariables => "INVALID_VARIABLES",
            Code::MissingGraphqlVariables => "MISSING_GRAPHQL_VARIABLES",
            Code::UndeclaredGraphqlVariables => "UNDECLARED_GRAPHQL_VARIABLES",
            Code::UnsupportedGraphqlVariableType => "UNSUPPORTED_GRAPHQL_VARIABLE_TYPE",
            Code::UnsupportedGraphqlVariableDefault => "UNSUPPORTED_GRAPHQL_VARIABLE_DEFAULT",
            Code::InvalidGraphqlVariableValue => "INVALID_GRAPHQL_VARIABLE_VALUE",
            Code::InvalidGraphqlQuery => "INVALID_GRAPHQL_QUERY",
            Code::InvalidGraphqlMutation => "INVALID_GRAPHQL_MUTATION",
            Code::QueryNotAllowed => "QUERY_NOT_ALLOWED",
            Code::NotAMutation => "NOT_A_MUTATION",
            Code::ReservedMutationAlias => "RESERVED_MUTATION_ALIAS",
            Code::InvalidDateFilter => "INVALID_DATE_FILTER",
            Code::QueryForbidden => "QUERY_FORBIDDEN",
            Code::QueryTimeout => "QUERY_TIMEOUT",
            Code::DatabaseUnavailable => "DATABASE_UNAVAILABLE",
            Code::QueryExecutionFailed => "QUERY_EXECUTION_FAILED",
            Code::MutationExecutionFailed => "MUTATION_EXECUTION_FAILED",
            Code::MutationResultUnreadable => "MUTATION_RESULT_UNREADABLE",
            Code::InvalidQueryResponse => "INVALID_QUERY_RESPONSE",
            Code::InvalidMutationResponse => "INVALID_MUTATION_RESPONSE",
            Code::PaginationFailed => "PAGINATION_FAILED",
            Code::QueryDataFailed => "QUERY_DATA_FAILED",
            Code::Custom(code) => code.as_str(),
        }
    }

    /// The code as the envelope emits it.
    ///
    /// A custom code that is not `[A-Z0-9_]`, or is too short or too long,
    /// becomes [`UNSPECIFIED`]. A code travels as an opaque key, so the one that
    /// leaves here is always a key the failure can be filed under, and the
    /// substitution is one line to read at the point it happens.
    pub fn wire(&self) -> &str {
        match self {
            Code::Custom(code) if !wire_safe(code) => UNSPECIFIED,
            other => other.as_str(),
        }
    }

    /// The generic code, for a failure the platform has no canonical name for.
    ///
    /// A failure this SDK did not classify — a panic, an unencodable result, a
    /// host that answered nothing — establishes nothing about what the action
    /// had already done. This code claims exactly that much, which is why it is
    /// used in place of a canonical one that would say more.
    pub fn unspecified() -> Code {
        Code::Custom(UNSPECIFIED.to_string())
    }

    /// The category this code is reported under when nothing narrower is said.
    pub fn category(&self) -> Category {
        match self {
            Code::InvalidToolInput
            | Code::MutationRequired
            | Code::QueryRequired
            | Code::InvalidVariables
            | Code::MissingGraphqlVariables
            | Code::UndeclaredGraphqlVariables
            | Code::UnsupportedGraphqlVariableType
            | Code::UnsupportedGraphqlVariableDefault
            | Code::InvalidGraphqlVariableValue
            | Code::InvalidGraphqlQuery
            | Code::InvalidGraphqlMutation
            | Code::QueryNotAllowed
            | Code::NotAMutation
            | Code::ReservedMutationAlias
            | Code::InvalidDateFilter => Category::Validation,
            Code::QueryForbidden => Category::Authorization,
            Code::QueryTimeout => Category::Timeout,
            Code::DatabaseUnavailable => Category::Availability,
            Code::QueryExecutionFailed
            | Code::MutationExecutionFailed
            | Code::MutationResultUnreadable => Category::Execution,
            Code::InvalidQueryResponse | Code::InvalidMutationResponse => Category::Response,
            Code::PaginationFailed => Category::Pagination,
            Code::QueryDataFailed => Category::Internal,
            Code::Custom(_) => Category::Execution,
        }
    }

    /// Whether repeating an identical call could plausibly succeed.
    ///
    /// Only a confirmed timeout and a confirmed unavailability say yes, and the
    /// platform narrows even those with what it knows about the tool. It never
    /// widens them, so an action claiming a write failure is retryable is not
    /// believed — which is why this is derived here rather than asked for.
    pub fn retryable(&self) -> bool {
        matches!(self, Code::QueryTimeout | Code::DatabaseUnavailable)
    }
}

impl fmt::Display for Code {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.wire())
    }
}

/// The coarse class a failure belongs to, as the action reports it.
///
/// The platform derives its own canonical category from the code and keeps this
/// one beside it, so drift between the two stays visible rather than silently
/// overriding either.
#[non_exhaustive]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Category {
    /// The call cannot be accepted as written.
    Validation,
    /// The current user may not do this.
    Authorization,
    /// It did not finish in time.
    Timeout,
    /// Something it depends on is down.
    Availability,
    /// It was accepted and then failed.
    Execution,
    /// What came back could not be read.
    Response,
    /// Paging over the result failed.
    Pagination,
    /// A fault in the action itself.
    Internal,
}

impl Category {
    /// The category exactly as it travels on the wire.
    pub fn as_str(&self) -> &str {
        match self {
            Category::Validation => "validation",
            Category::Authorization => "authorization",
            Category::Timeout => "timeout",
            Category::Availability => "availability",
            Category::Execution => "execution",
            Category::Response => "response",
            Category::Pagination => "pagination",
            Category::Internal => "internal",
        }
    }
}

impl fmt::Display for Category {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// Whether a custom code is a shape the wire accepts.
fn wire_safe(code: &str) -> bool {
    (MIN_CODE_BYTES..=MAX_CODE_BYTES).contains(&code.len())
        && code
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'_')
        && code.as_bytes()[0].is_ascii_uppercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every canonical variant, so the two lists below can be checked against
    /// each other. Adding a variant without adding it here is a compile error
    /// in `each_variant_is_canonical`, which matches exhaustively.
    const EVERY: [Code; 25] = [
        Code::InvalidToolInput,
        Code::MutationRequired,
        Code::QueryRequired,
        Code::InvalidVariables,
        Code::MissingGraphqlVariables,
        Code::UndeclaredGraphqlVariables,
        Code::UnsupportedGraphqlVariableType,
        Code::UnsupportedGraphqlVariableDefault,
        Code::InvalidGraphqlVariableValue,
        Code::InvalidGraphqlQuery,
        Code::InvalidGraphqlMutation,
        Code::QueryNotAllowed,
        Code::NotAMutation,
        Code::ReservedMutationAlias,
        Code::InvalidDateFilter,
        Code::QueryForbidden,
        Code::QueryTimeout,
        Code::DatabaseUnavailable,
        Code::QueryExecutionFailed,
        Code::MutationExecutionFailed,
        Code::MutationResultUnreadable,
        Code::InvalidQueryResponse,
        Code::InvalidMutationResponse,
        Code::PaginationFailed,
        Code::QueryDataFailed,
    ];

    #[test]
    fn every_variant_is_canonical() {
        // An exhaustive match: a new variant fails to compile here until it is
        // either added to `EVERY` and `CANONICAL`, or excluded on purpose.
        for code in EVERY.iter() {
            let known = match code {
                Code::Custom(_) => false,
                _ => CANONICAL.contains(&code.as_str()),
            };

            assert!(known, "{} is not in CANONICAL", code.as_str());
        }

        assert_eq!(EVERY.len(), CANONICAL.len());
    }

    #[test]
    fn canonical_order_matches_the_enum() {
        let listed: Vec<&str> = EVERY.iter().map(Code::as_str).collect();

        assert_eq!(listed, CANONICAL.to_vec());
    }

    #[test]
    fn only_confirmed_timeouts_and_outages_are_retryable() {
        let retryable: Vec<&str> = EVERY
            .iter()
            .filter(|code| code.retryable())
            .map(Code::as_str)
            .collect();

        assert_eq!(retryable, vec!["QUERY_TIMEOUT", "DATABASE_UNAVAILABLE"]);
    }

    #[test]
    fn a_custom_code_the_wire_cannot_carry_is_replaced() {
        assert_eq!(Code::Custom("INVOICE_PAID".into()).wire(), "INVOICE_PAID");
        assert_eq!(Code::Custom("invoice paid".into()).wire(), UNSPECIFIED);
        assert_eq!(Code::Custom(String::new()).wire(), UNSPECIFIED);
        assert_eq!(Code::Custom("_LEADING".into()).wire(), UNSPECIFIED);
        assert_eq!(Code::Custom("X".repeat(65)).wire(), UNSPECIFIED);
    }
}
