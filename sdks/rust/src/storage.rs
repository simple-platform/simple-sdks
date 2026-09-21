//! Putting a file into the platform's store, and reading one back out.
//!
//! Two ways in — bytes this action already holds, and a file behind a URL — and
//! one thing out of both: a [`DocumentHandle`], which is the value a `:document`
//! field holds. The way out is [`read`], which takes that handle and answers with
//! the file's bytes.
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
//! # Reading a file back
//!
//! ```
//! # use simpleplatform_sdk::prelude::*;
//! # use simpleplatform_sdk::storage::DocumentHandle;
//! # use simpleplatform_sdk::testing;
//! # let file = b"%PDF-1.7 ...".to_vec();
//! # let served = file.clone();
//! # let _session = testing::install(|_name, _params| Ok(json!({ "size": 12 })))
//! #     .with_bytes(move |_name, params| {
//! #         let offset = params["offset"].as_u64().unwrap() as usize;
//! #         let length = params["length"].as_u64().unwrap() as usize;
//! #         Ok(served[offset..offset + length].to_vec())
//! #     });
//! # let handle = DocumentHandle {
//! #     file_hash: "9f86d081884c".into(),
//! #     filename: "statement.pdf".into(),
//! #     mime_type: "application/pdf".into(),
//! #     size: 12,
//! #     storage_path: "_staged/9f86d081884c".into(),
//! # };
//! let bytes = simple::storage::read(&handle)?;
//!
//! assert_eq!(bytes, file);
//! # Ok::<(), Error>(())
//! ```
//!
//! The bytes cross from the host as they are, with no JSON and no base64. The
//! size is asked for first, the buffer is allocated once at exactly that size,
//! and the file arrives in ranges of at most [`MAX_RANGE_BYTES`], each written by
//! the host straight into its place in that buffer. [`read_range`] reads part of
//! a file, and [`size`] answers how large it is without reading any of it.
//!
//! Reading is for server actions. A browser action is refused.
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

/// The host action that answers a stored file's size.
const STAT: &str = "action:storage/stat";

/// The host action that answers one range of a stored file as its bytes.
const READ: &str = "action:storage/read";

/// The longest range the host answers one read with.
///
/// [`read`] and [`read_range`] cover anything longer in ranges of this size,
/// into one buffer, so it bounds what the host holds for one call rather than
/// what an action can read.
pub const MAX_RANGE_BYTES: u64 = 16 * 1024 * 1024;

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

/// How many bytes a stored file holds, from the store's own record of it.
///
/// ```
/// # use simpleplatform_sdk::prelude::*;
/// # use simpleplatform_sdk::storage::DocumentHandle;
/// # use simpleplatform_sdk::testing;
/// # let _session = testing::install(|name, _params| {
/// #     assert_eq!(name, "action:storage/stat");
/// #     Ok(json!({ "size": 81_920 }))
/// # });
/// # let handle = DocumentHandle {
/// #     file_hash: "9f86d081884c".into(),
/// #     filename: "statement.pdf".into(),
/// #     mime_type: "application/pdf".into(),
/// #     size: 81_920,
/// #     storage_path: "_staged/9f86d081884c".into(),
/// # };
/// assert_eq!(simple::storage::size(&handle)?, 81_920);
/// # Ok::<(), Error>(())
/// ```
pub fn size(handle: &DocumentHandle) -> Result<u64, Error> {
    check_handle(handle)?;

    let answer = host::transport()?.call(STAT.to_string(), json!({ "handle": handle }))?;

    answer.get("size").and_then(Value::as_u64).ok_or_else(|| {
        Error::Host(Fault::new(
            Code::unspecified(),
            format!("{STAT} answered without a size: {answer}"),
        ))
    })
}

/// The whole of a stored file.
///
/// The size is asked for first, the buffer is allocated once at exactly that
/// size, and every range is written by the host straight into its place in it.
/// A file this action has no memory for is refused before anything is read,
/// and a range answered short — a file that changed while it was read — is
/// refused rather than handed over incomplete.
pub fn read(handle: &DocumentHandle) -> Result<Vec<u8>, Error> {
    let size = size(handle)?;

    let mut bytes = Vec::new();
    let capacity = usize::try_from(size).map_err(|_too_large| too_large(size))?;
    bytes
        .try_reserve_exact(capacity)
        .map_err(|_no_memory| too_large(size))?;

    let transport = host::transport()?;
    let mut offset = 0;

    while offset < size {
        let length = MAX_RANGE_BYTES.min(size - offset);
        let appended =
            transport.call_bytes(READ.to_string(), range(handle, offset, length), &mut bytes)?;

        if appended as u64 != length {
            return Err(short(offset, length, appended));
        }

        offset += length;
    }

    Ok(bytes)
}

/// Up to `length` bytes of a stored file, starting `offset` bytes in.
///
/// A range that runs past the end answers with the bytes up to the end; one
/// that starts at or past the end is refused. A range longer than
/// [`MAX_RANGE_BYTES`] is read in several, into one buffer.
pub fn read_range(handle: &DocumentHandle, offset: u64, length: u64) -> Result<Vec<u8>, Error> {
    check_handle(handle)?;

    if length == 0 {
        return Err(Error::invalid("A range needs at least one byte.")
            .hint("Pass a length of one or more, or ask size() how large the file is."));
    }

    let mut bytes = Vec::new();
    let capacity = usize::try_from(length).map_err(|_too_large| too_large(length))?;
    bytes
        .try_reserve_exact(capacity)
        .map_err(|_no_memory| too_large(length))?;

    let transport = host::transport()?;
    let mut read = 0;

    while read < length {
        let wanted = MAX_RANGE_BYTES.min(length - read);
        let appended = transport.call_bytes(
            READ.to_string(),
            range(handle, offset + read, wanted),
            &mut bytes,
        )?;

        read += appended as u64;

        // The file ended inside this range.
        if (appended as u64) < wanted {
            break;
        }
    }

    Ok(bytes)
}

/// The parameters of one range read.
fn range(handle: &DocumentHandle, offset: u64, length: u64) -> Value {
    json!({ "handle": handle, "offset": offset, "length": length })
}

/// A file this action cannot hold.
fn too_large(size: u64) -> Error {
    Error::failed(format!(
        "The file is {size} bytes, more than this action has memory for."
    ))
    .hint("Raise the action's mem_limit, or read the file in parts with read_range.")
}

/// A range the host answered with fewer bytes than the file's size promised.
fn short(offset: u64, length: u64, appended: usize) -> Error {
    Error::Host(Fault::new(
        Code::unspecified(),
        format!(
            "The file answered {appended} bytes for the {length} at offset {offset}, \
             so it is not the size it was when the read began."
        ),
    ))
    .hint("Read it again.")
}

/// Whether a handle names a stored file.
fn check_handle(handle: &DocumentHandle) -> Result<(), Error> {
    let named = [
        ("storage_path", &handle.storage_path),
        ("filename", &handle.filename),
        ("file_hash", &handle.file_hash),
    ];

    for (member, value) in named {
        if value.trim().is_empty() {
            return Err(Error::invalid(format!("A document handle needs {member}."))
                .hint("Pass the handle exactly as the :document field holds it."));
        }
    }

    Ok(())
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

    fn handle() -> DocumentHandle {
        DocumentHandle {
            file_hash: "9f86d081884c7d65".to_string(),
            filename: "statement.pdf".to_string(),
            mime_type: "application/pdf".to_string(),
            size: 0,
            storage_path: "_staged/9f86d081884c7d65".to_string(),
        }
    }

    /// Every byte value, so bytes passed through any text decoding on the way
    /// could not compare equal.
    fn every_byte(count: usize) -> Vec<u8> {
        (0..count).map(|i| ((i * 7 + 3) % 256) as u8).collect()
    }

    /// A session serving `file` the way the host does: its size from the store,
    /// and each range as its bytes, up to the end of the file.
    fn serving(file: Vec<u8>) -> testing::Session {
        let size = file.len();

        testing::install(move |name, _params| {
            assert_eq!(name, "action:storage/stat");
            Ok(json!({ "size": size }))
        })
        .with_bytes(move |name, params| {
            assert_eq!(name, "action:storage/read");
            let offset = params["offset"].as_u64().unwrap() as usize;
            let length = params["length"].as_u64().unwrap() as usize;

            if offset >= file.len() {
                return Err(Error::invalid(
                    "'offset' is at or past the end of the file.",
                ));
            }

            Ok(file[offset..file.len().min(offset + length)].to_vec())
        })
    }

    #[test]
    fn a_read_answers_the_file_byte_for_byte() {
        let file = every_byte(5_000);
        let _session = serving(file.clone());

        assert_eq!(read(&handle()).unwrap(), file);
    }

    #[test]
    fn a_read_allocates_once_at_exactly_the_size_the_store_reports() {
        let file = every_byte(40 * 1024 * 1024 + 17);
        let _session = serving(file.clone());

        let bytes = read(&handle()).unwrap();

        assert_eq!(bytes.len(), file.len());
        assert_eq!(bytes.capacity(), file.len());
        assert!(bytes == file);
    }

    #[test]
    fn a_large_read_asks_for_ranges_no_longer_than_the_host_answers() {
        let file = every_byte(40 * 1024 * 1024 + 17);
        let session = serving(file);

        read(&handle()).unwrap();

        let ranges: Vec<(u64, u64)> = session
            .calls()
            .iter()
            .filter(|call| call.name == "action:storage/read")
            .map(|call| {
                (
                    call.params["offset"].as_u64().unwrap(),
                    call.params["length"].as_u64().unwrap(),
                )
            })
            .collect();

        let mib = 1024 * 1024;
        assert_eq!(
            ranges,
            vec![
                (0, 16 * mib),
                (16 * mib, 16 * mib),
                (32 * mib, 8 * mib + 17)
            ]
        );
    }

    #[test]
    fn every_read_carries_the_handle_it_was_given() {
        let session = serving(every_byte(10));

        read(&handle()).unwrap();

        for call in session.calls() {
            assert_eq!(
                call.params["handle"],
                serde_json::to_value(handle()).unwrap()
            );
        }
    }

    #[test]
    fn an_empty_file_is_read_without_asking_for_a_range() {
        let session = serving(Vec::new());

        assert_eq!(read(&handle()).unwrap(), Vec::<u8>::new());
        assert_eq!(session.calls().len(), 1);
    }

    #[test]
    fn a_range_answered_short_is_refused_rather_than_handed_over() {
        let _session = testing::install(|_name, _params| Ok(json!({ "size": 100 })))
            .with_bytes(|_name, _params| Ok(vec![0; 60]));

        let error = read(&handle()).unwrap_err();

        assert!(error.message().contains("60 bytes for the 100 at offset 0"));
    }

    #[test]
    fn a_host_refusal_reaches_the_caller_with_its_own_message() {
        let _session = testing::install(|_name, _params| Ok(json!({ "size": 10 }))).with_bytes(
            |_name, _params| Err(Error::invalid("No stored file matches this handle.")),
        );

        let error = read(&handle()).unwrap_err();

        assert!(error
            .message()
            .contains("action:storage/read failed: No stored file matches this handle."));
    }

    #[test]
    fn a_file_larger_than_this_action_can_hold_is_refused_before_any_range() {
        let session = testing::install(|_name, _params| Ok(json!({ "size": u64::MAX })));

        let error = read(&handle()).unwrap_err();

        assert!(error
            .message()
            .contains("more than this action has memory for"));
        assert_eq!(session.calls().len(), 1);
    }

    #[test]
    fn size_answers_what_the_store_reports() {
        let _session = testing::install(|_name, _params| Ok(json!({ "size": 81_920 })));

        assert_eq!(size(&handle()).unwrap(), 81_920);
    }

    #[test]
    fn a_range_answers_exactly_that_range() {
        let file = every_byte(10_000);
        let _session = serving(file.clone());

        assert_eq!(
            read_range(&handle(), 4_000, 1_500).unwrap(),
            file[4_000..5_500]
        );
    }

    #[test]
    fn a_range_running_past_the_end_answers_up_to_the_end() {
        let file = every_byte(10_000);
        let _session = serving(file.clone());

        assert_eq!(read_range(&handle(), 9_990, 100).unwrap(), file[9_990..]);
    }

    #[test]
    fn a_range_starting_past_the_end_is_refused() {
        let _session = serving(every_byte(10));

        assert!(read_range(&handle(), 10, 1).is_err());
    }

    #[test]
    fn an_empty_range_is_refused_before_anything_is_sent() {
        let session = serving(every_byte(10));

        assert!(read_range(&handle(), 0, 0).is_err());
        assert!(session.calls().is_empty());
    }

    #[test]
    fn a_handle_missing_what_names_the_file_is_refused_before_anything_is_sent() {
        let session = serving(every_byte(10));

        for broken in [
            DocumentHandle {
                storage_path: String::new(),
                ..handle()
            },
            DocumentHandle {
                filename: " ".to_string(),
                ..handle()
            },
            DocumentHandle {
                file_hash: String::new(),
                ..handle()
            },
        ] {
            assert_eq!(
                read(&broken).unwrap_err().code().as_str(),
                "INVALID_TOOL_INPUT"
            );
        }

        assert!(session.calls().is_empty());
    }

    #[test]
    fn a_session_with_no_bytes_reply_says_how_to_give_it_one() {
        let _session = testing::install(|_name, _params| Ok(json!({ "size": 10 })));

        let error = read(&handle()).unwrap_err();

        assert!(error.message().contains("was given no way to"));
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
