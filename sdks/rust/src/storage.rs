//! Putting a file into the platform's store.
//!
//! Two ways in — bytes this action already holds, and a file behind a URL — and
//! one thing out of both: a [`DocumentHandle`], which is the value a `:document`
//! field holds.
//!
//! ```
//! # use simpleplatform_sdk::prelude::*;
//! # use simpleplatform_sdk::testing;
//! use simpleplatform_sdk::storage::Target;
//!
//! # let _session = testing::install(|_name, _params| {
//! #     Ok(json!({
//! #         "file_hash": "c3ab8ff13720e8ad9047dd39466b3c89",
//! #         "filename": "report.pdf",
//! #         "mime_type": "application/pdf",
//! #         "size": 6,
//! #         "storage_path": "documents/c3/ab/c3ab8ff13720e8ad9047dd39466b3c89",
//! #     }))
//! # });
//! let target = Target::new("dev.simple.system", "documents", "attachment");
//! let handle = simple::storage::upload_buffer(b"foobar", "report.pdf", "application/pdf", target)?;
//!
//! assert_eq!(handle.filename, "report.pdf");
//! assert_eq!(handle.size, 6);
//! # Ok::<(), Error>(())
//! ```
//!
//! # The handle is the point
//!
//! An upload stores the file and answers with a handle to it. Attaching that
//! handle to a record is a separate step, and the one that changes tenant data:
//! write the handle into the `:document` field with [`crate::graphql::mutate`]
//! once you have it. So the two halves stay separable — the file is in the store
//! whether or not the record was written, and the store is the only thing
//! [`upload_buffer`] and [`upload_external`] touch.
//!
//! # The same bytes are the same file
//!
//! The store is addressed by the SHA-256 of the contents, which is the
//! `file_hash` on the handle. Identical bytes land under the identical hash and
//! are kept once, so uploading a file the store already holds costs a hash and
//! answers with the handle that was already there.
//!
//! # Why the bytes are encoded here
//!
//! The call travels as JSON, and JSON carries text. So a buffer is base64 on the
//! wire — encoded once, at this boundary, in the same standard alphabet with the
//! same padding every SDK uses, and decoded by the platform before the file is
//! stored. An action passes `&[u8]` and never sees the encoding.

use std::fmt;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::codes::Code;
use crate::error::{Error, Fault};
use crate::host;

/// The host action that stores a file and answers with its handle.
const UPLOAD_EXTERNAL: &str = "action:storage/upload-external";

/// A stored file, as a `:document` field holds it.
///
/// This is a pointer to the contents rather than the contents: it is what an
/// upload answers with, what a record stores, and what identifies the file
/// afterwards.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub struct DocumentHandle {
    /// The SHA-256 of the contents, which is the file's identity in the store.
    pub file_hash: String,
    /// The name the file is stored under.
    pub filename: String,
    /// The media type of the contents, such as `application/pdf`.
    pub mime_type: String,
    /// The size of the contents in bytes.
    pub size: u64,
    /// Where the store keeps the file.
    pub storage_path: String,
}

/// The record field a stored file is destined for.
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub struct Target {
    /// The app that owns the table.
    pub app_id: String,
    /// The table the record lives in.
    pub table_name: String,
    /// The `:document` field the handle is stored in.
    pub field_name: String,
}

impl Target {
    /// A target named by its app, its table and its field.
    ///
    /// ```
    /// use simpleplatform_sdk::storage::Target;
    ///
    /// let target = Target::new("dev.simple.system", "documents", "attachment");
    ///
    /// assert_eq!(target.field_name, "attachment");
    /// ```
    pub fn new(
        app_id: impl Into<String>,
        table_name: impl Into<String>,
        field_name: impl Into<String>,
    ) -> Target {
        Target {
            app_id: app_id.into(),
            table_name: table_name.into(),
            field_name: field_name.into(),
        }
    }
}

/// The credential a URL is read with.
///
/// It is `#[non_exhaustive]`: a `match` on it needs a `_` arm, so a scheme added
/// later does not break an action that was already written.
#[non_exhaustive]
#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Auth {
    /// A username and a password.
    Basic {
        /// The username.
        username: String,
        /// The password.
        password: String,
    },
    /// A bearer token.
    Bearer {
        /// The token.
        bearer_token: String,
    },
}

impl Auth {
    /// Read the URL with a bearer token.
    ///
    /// ```
    /// use simpleplatform_sdk::storage::Auth;
    ///
    /// let auth = Auth::bearer("t-1234");
    ///
    /// assert!(matches!(auth, Auth::Bearer { .. }));
    /// ```
    pub fn bearer(bearer_token: impl Into<String>) -> Auth {
        Auth::Bearer {
            bearer_token: bearer_token.into(),
        }
    }

    /// Read the URL with a username and a password.
    pub fn basic(username: impl Into<String>, password: impl Into<String>) -> Auth {
        Auth::Basic {
            username: username.into(),
            password: password.into(),
        }
    }
}

impl fmt::Debug for Auth {
    /// The scheme, and never the secret.
    ///
    /// A credential is written by hand and read by a host, and the one place it
    /// has no business appearing is a log line. So this renders the scheme, and
    /// the username that names the account, and stops there.
    ///
    /// ```
    /// use simpleplatform_sdk::storage::Auth;
    ///
    /// assert_eq!(format!("{:?}", Auth::bearer("t-1234")), "Bearer { .. }");
    /// ```
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Auth::Basic { username, .. } => formatter
                .debug_struct("Basic")
                .field("username", username)
                .finish_non_exhaustive(),
            Auth::Bearer { .. } => formatter.debug_struct("Bearer").finish_non_exhaustive(),
        }
    }
}

/// The file an external upload reads.
#[derive(Clone, Debug, Serialize)]
pub struct Source {
    /// The URL the file is read from.
    pub url: String,
    /// The credential the URL is read with, for a URL that needs one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth: Option<Auth>,
}

impl Source {
    /// A file at this URL, read without a credential.
    pub fn url(url: impl Into<String>) -> Source {
        Source {
            url: url.into(),
            auth: None,
        }
    }

    /// The same file, read with this credential.
    ///
    /// ```
    /// use simpleplatform_sdk::storage::{Auth, Source};
    ///
    /// let source = Source::url("https://example.com/report.pdf").with_auth(Auth::bearer("t-1234"));
    ///
    /// assert!(source.auth.is_some());
    /// ```
    pub fn with_auth(mut self, auth: Auth) -> Source {
        self.auth = Some(auth);
        self
    }
}

/// Store bytes this action already holds.
///
/// The buffer, the name and the media type are all required, and each is checked
/// before anything is sent: an empty buffer, a blank name, a blank media type or
/// an incomplete [`Target`] is refused where it costs nothing.
///
/// ```
/// # use simpleplatform_sdk::prelude::*;
/// # use simpleplatform_sdk::testing;
/// use simpleplatform_sdk::storage::Target;
///
/// # let _session = testing::install(|_name, params| {
/// #     assert_eq!(params["source"]["bytes"], json!("Zm9vYmFy"));
/// #     Ok(json!({
/// #         "file_hash": "c3ab8ff137",
/// #         "filename": "notes.txt",
/// #         "mime_type": "text/plain",
/// #         "size": 6,
/// #         "storage_path": "documents/c3/ab/c3ab8ff137",
/// #     }))
/// # });
/// let handle = simple::storage::upload_buffer(
///     b"foobar",
///     "notes.txt",
///     "text/plain",
///     Target::new("dev.simple.system", "documents", "attachment"),
/// )?;
///
/// assert_eq!(handle.file_hash, "c3ab8ff137");
/// # Ok::<(), Error>(())
/// ```
pub fn upload_buffer(
    bytes: &[u8],
    filename: &str,
    mime_type: &str,
    target: Target,
) -> Result<DocumentHandle, Error> {
    if bytes.is_empty() {
        return Err(
            Error::invalid("An upload needs at least one byte, and this buffer is empty.")
                .hint("Pass the file's contents."),
        );
    }

    if filename.trim().is_empty() {
        return Err(Error::invalid("An upload needs a filename.")
            .hint("Pass the name the file is stored under, such as report.pdf."));
    }

    if mime_type.trim().is_empty() {
        return Err(Error::invalid("An upload needs a media type.")
            .hint("Pass the type of the contents, such as application/pdf."));
    }

    check_target(&target)?;

    let source = json!({
        "bytes": encode(bytes),
        "filename": filename,
        "mime_type": mime_type,
    });

    send(source, target)
}

/// Store a file the platform reads from a URL.
///
/// The URL and any credential on it are checked before anything is sent, as is
/// the [`Target`].
///
/// ```
/// # use simpleplatform_sdk::prelude::*;
/// # use simpleplatform_sdk::testing;
/// use simpleplatform_sdk::storage::{Auth, Source, Target};
///
/// # let _session = testing::install(|_name, params| {
/// #     assert_eq!(params["source"]["auth"]["type"], json!("bearer"));
/// #     Ok(json!({
/// #         "file_hash": "9f86d081884c",
/// #         "filename": "statement.pdf",
/// #         "mime_type": "application/pdf",
/// #         "size": 81_920,
/// #         "storage_path": "documents/9f/86/9f86d081884c",
/// #     }))
/// # });
/// let handle = simple::storage::upload_external(
///     Source::url("https://example.com/statement.pdf").with_auth(Auth::bearer("t-1234")),
///     Target::new("dev.simple.system", "documents", "attachment"),
/// )?;
///
/// assert_eq!(handle.size, 81_920);
/// # Ok::<(), Error>(())
/// ```
pub fn upload_external(source: Source, target: Target) -> Result<DocumentHandle, Error> {
    if source.url.trim().is_empty() {
        return Err(
            Error::invalid("An external upload needs a URL to read from.")
                .hint("Pass the address of the file, or use upload_buffer for bytes you hold."),
        );
    }

    if let Some(auth) = &source.auth {
        check_auth(auth)?;
    }

    check_target(&target)?;

    send(serde_json::to_value(&source)?, target)
}

/// One upload, one round trip, one handle.
fn send(source: Value, target: Target) -> Result<DocumentHandle, Error> {
    let params = json!({ "source": source, "target": serde_json::to_value(&target)? });

    let stored = host::transport()?
        .call(UPLOAD_EXTERNAL.to_string(), params)
        .map_err(|cause| {
            Error::Host(Fault::new(Code::unspecified(), cause.message())).hint(
                "Nothing was attached to the record. The store is addressed by content, \
                 so the same bytes uploaded again answer with the same handle.",
            )
        })?;

    serde_json::from_value(stored).map_err(|cause| {
        Error::Json(Fault::new(
            Code::unspecified(),
            format!("The upload finished and its handle could not be read: {cause}"),
        ))
        .hint(
            "Report this. The file is stored under the hash of its contents, \
             so uploading the same bytes again answers with the handle.",
        )
    })
}

/// Whether a target names a field to attach to.
fn check_target(target: &Target) -> Result<(), Error> {
    let named = [
        ("app_id", &target.app_id),
        ("table_name", &target.table_name),
        ("field_name", &target.field_name),
    ];

    for (member, value) in named {
        if value.trim().is_empty() {
            return Err(Error::invalid(format!("A storage target needs {member}."))
                .hint("Name the app, the table, and the :document field the handle goes in."));
        }
    }

    Ok(())
}

/// Whether a credential carries what its scheme needs.
///
/// The scheme itself is settled by [`Auth`] — there are two, and each holds its
/// own members — so what is left to check is that the members say something.
fn check_auth(auth: &Auth) -> Result<(), Error> {
    match auth {
        Auth::Basic { username, password } => {
            if username.trim().is_empty() {
                return Err(Error::invalid("Basic authentication needs a username.")
                    .hint("Pass the username, or read the URL without a credential."));
            }

            if password.trim().is_empty() {
                return Err(Error::invalid("Basic authentication needs a password.")
                    .hint("Pass the password, or read the URL without a credential."));
            }
        }
        Auth::Bearer { bearer_token } => {
            if bearer_token.trim().is_empty() {
                return Err(Error::invalid("Bearer authentication needs a token.")
                    .hint("Pass the token, or read the URL without a credential."));
            }
        }
    }

    Ok(())
}

/// The symbols base64 spends, in their standard order.
const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// What fills a group that ran out of bytes.
const PAD: char = '=';

/// The bytes as base64: three bytes to four symbols, padded to a multiple of
/// four, in the standard alphabet.
fn encode(bytes: &[u8]) -> String {
    let mut encoded = String::with_capacity(bytes.len().div_ceil(3) * 4);

    for group in bytes.chunks(3) {
        let mut packed = 0_u32;

        // Left to right: the first byte takes the top eight of twenty-four bits,
        // and a group of one or two leaves the rest zero.
        for (index, byte) in group.iter().enumerate() {
            packed |= u32::from(*byte) << (16 - 8 * index);
        }

        encoded.push(symbol(packed >> 18));
        encoded.push(symbol(packed >> 12));
        encoded.push(if group.len() > 1 {
            symbol(packed >> 6)
        } else {
            PAD
        });
        encoded.push(if group.len() > 2 { symbol(packed) } else { PAD });
    }

    encoded
}

/// The symbol for the low six bits of `packed`.
fn symbol(packed: u32) -> char {
    // Six bits count to sixty-three and the alphabet holds sixty-four symbols,
    // so there is always one to answer with.
    char::from(ALPHABET[(packed & 0b11_1111) as usize])
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::testing;

    /// What the host answers with for an upload that landed.
    fn stored() -> Value {
        json!({
            "file_hash": "c3ab8ff13720e8ad9047dd39466b3c89",
            "filename": "report.pdf",
            "mime_type": "application/pdf",
            "size": 6,
            "storage_path": "documents/c3/ab/c3ab8ff13720e8ad9047dd39466b3c89",
        })
    }

    fn target() -> Target {
        Target::new("dev.simple.system", "documents", "attachment")
    }

    #[test]
    fn a_buffer_travels_base64_encoded_beside_its_name_and_type() {
        let session = testing::install(|_name, _params| Ok(stored()));

        upload_buffer(b"foobar", "report.pdf", "application/pdf", target()).unwrap();

        let calls = session.calls();

        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "action:storage/upload-external");
        assert_eq!(
            calls[0].params["source"],
            json!({
                "bytes": "Zm9vYmFy",
                "filename": "report.pdf",
                "mime_type": "application/pdf",
            })
        );
        assert_eq!(
            calls[0].params["target"],
            json!({
                "app_id": "dev.simple.system",
                "table_name": "documents",
                "field_name": "attachment",
            })
        );
    }

    #[test]
    fn a_stored_file_answers_with_every_member_of_its_handle() {
        let _session = testing::install(|_name, _params| Ok(stored()));

        let handle = upload_buffer(b"foobar", "report.pdf", "application/pdf", target()).unwrap();

        assert_eq!(
            handle,
            DocumentHandle {
                file_hash: "c3ab8ff13720e8ad9047dd39466b3c89".to_string(),
                filename: "report.pdf".to_string(),
                mime_type: "application/pdf".to_string(),
                size: 6,
                storage_path: "documents/c3/ab/c3ab8ff13720e8ad9047dd39466b3c89".to_string(),
            }
        );
    }

    #[test]
    fn an_empty_buffer_is_refused_before_anything_is_sent() {
        let session = testing::install(|_name, _params| Ok(stored()));

        let error = upload_buffer(&[], "report.pdf", "application/pdf", target()).unwrap_err();

        assert_eq!(error.code().as_str(), "INVALID_TOOL_INPUT");
        assert!(session.calls().is_empty());
    }

    #[test]
    fn a_blank_name_or_type_is_refused_before_anything_is_sent() {
        let session = testing::install(|_name, _params| Ok(stored()));

        for (filename, mime_type) in [("   ", "application/pdf"), ("report.pdf", "")] {
            let error = upload_buffer(b"foobar", filename, mime_type, target()).unwrap_err();

            assert_eq!(error.code().as_str(), "INVALID_TOOL_INPUT");
        }

        assert!(session.calls().is_empty());
    }

    #[test]
    fn a_target_missing_a_member_names_the_one_it_is_missing() {
        let session = testing::install(|_name, _params| Ok(stored()));

        let incomplete = [
            (Target::new("", "documents", "attachment"), "app_id"),
            (
                Target::new("dev.simple.system", " ", "attachment"),
                "table_name",
            ),
            (
                Target::new("dev.simple.system", "documents", ""),
                "field_name",
            ),
        ];

        for (target, member) in incomplete {
            let error = upload_buffer(b"foobar", "report.pdf", "application/pdf", target)
                .expect_err("an incomplete target names nothing to attach to");

            assert_eq!(error.code().as_str(), "INVALID_TOOL_INPUT");
            assert!(error.message().contains(member), "{}", error.message());
        }

        assert!(session.calls().is_empty());
    }

    #[test]
    fn a_url_upload_carries_the_url_alone_when_it_needs_no_credential() {
        let session = testing::install(|_name, _params| Ok(stored()));

        upload_external(Source::url("https://example.com/report.pdf"), target()).unwrap();

        assert_eq!(
            session.calls()[0].params["source"],
            json!({ "url": "https://example.com/report.pdf" }),
            "a source with no credential carries no auth member"
        );
    }

    #[test]
    fn a_credential_travels_under_its_own_scheme() {
        let session = testing::install(|_name, _params| Ok(stored()));

        upload_external(
            Source::url("https://example.com/report.pdf").with_auth(Auth::bearer("t-1234")),
            target(),
        )
        .unwrap();

        upload_external(
            Source::url("https://example.com/report.pdf").with_auth(Auth::basic("ada", "s3cret")),
            target(),
        )
        .unwrap();

        let calls = session.calls();

        assert_eq!(
            calls[0].params["source"]["auth"],
            json!({ "type": "bearer", "bearer_token": "t-1234" })
        );
        assert_eq!(
            calls[1].params["source"]["auth"],
            json!({ "type": "basic", "username": "ada", "password": "s3cret" })
        );
    }

    #[test]
    fn a_blank_url_is_refused_before_anything_is_sent() {
        let session = testing::install(|_name, _params| Ok(stored()));

        let error = upload_external(Source::url("  "), target()).unwrap_err();

        assert_eq!(error.code().as_str(), "INVALID_TOOL_INPUT");
        assert!(session.calls().is_empty());
    }

    #[test]
    fn a_credential_with_nothing_in_it_is_refused_before_anything_is_sent() {
        let session = testing::install(|_name, _params| Ok(stored()));

        let blank = [
            Auth::bearer("  "),
            Auth::basic("", "s3cret"),
            Auth::basic("ada", " "),
        ];

        for auth in blank {
            let error = upload_external(
                Source::url("https://example.com/report.pdf").with_auth(auth),
                target(),
            )
            .expect_err("a credential that says nothing cannot read the URL");

            assert_eq!(error.code().as_str(), "INVALID_TOOL_INPUT");
        }

        assert!(session.calls().is_empty());
    }

    #[test]
    fn a_refused_upload_keeps_the_hosts_own_message() {
        let _session = testing::install(|_name, _params| Err(Error::failed("the store is full")));

        let error =
            upload_buffer(b"foobar", "report.pdf", "application/pdf", target()).unwrap_err();

        assert!(matches!(error, Error::Host(_)));
        assert!(error.message().contains("the store is full"));
        assert!(!error.is_retryable());
    }

    #[test]
    fn a_handle_that_cannot_be_read_is_reported_rather_than_returned() {
        let _session = testing::install(|_name, _params| Ok(json!({ "filename": "report.pdf" })));

        let error =
            upload_buffer(b"foobar", "report.pdf", "application/pdf", target()).unwrap_err();

        assert!(matches!(error, Error::Json(_)));
        assert!(error.message().contains("could not be read"));
    }

    #[test]
    fn an_upload_with_no_host_to_send_it_to_says_so() {
        let error =
            upload_buffer(b"foobar", "report.pdf", "application/pdf", target()).unwrap_err();

        assert!(error.message().contains("No host is installed"));
    }

    // The standard test vectors, which pin the alphabet and the padding.
    #[test]
    fn bytes_encode_to_the_standard_alphabet_with_standard_padding() {
        assert_eq!(encode(b""), "");
        assert_eq!(encode(b"f"), "Zg==");
        assert_eq!(encode(b"fo"), "Zm8=");
        assert_eq!(encode(b"foo"), "Zm9v");
        assert_eq!(encode(b"foob"), "Zm9vYg==");
        assert_eq!(encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(encode(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn the_last_two_symbols_of_the_alphabet_are_plus_and_slash() {
        assert_eq!(encode(&[0xfb, 0xff]), "+/8=");
        assert_eq!(encode(&[0xff, 0xff, 0xff]), "////");
        assert_eq!(encode(&[0x00, 0x00, 0x00]), "AAAA");
    }

    #[test]
    fn every_byte_value_survives_the_encoding() {
        let every: Vec<u8> = (0..=255).collect();
        let encoded = encode(&every);

        assert_eq!(encoded.len(), 344, "256 bytes fill 86 groups of four");
        assert!(encoded.ends_with("/w=="));
        assert!(encoded
            .chars()
            .all(|symbol| symbol == PAD || ALPHABET.contains(&(symbol as u8))));
    }

    #[test]
    fn a_credential_is_not_written_out_by_a_debug_rendering() {
        let source =
            Source::url("https://example.com/report.pdf").with_auth(Auth::bearer("t-1234"));

        let rendered = format!("{source:?}");

        assert!(!rendered.contains("t-1234"));
        assert!(rendered.contains("Bearer"));

        let basic = format!("{:?}", Auth::basic("ada", "s3cret"));

        assert!(!basic.contains("s3cret"));
        assert!(basic.contains("ada"));
    }
}
