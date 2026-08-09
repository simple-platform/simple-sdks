//! Asking the AI engine for an answer.
//!
//! Three operations read something and answer with it — [`extract`] pulls
//! structured data out against a schema you give, [`summarize`] writes prose,
//! and [`transcribe`] turns audio or video into words. Three more hold the
//! tenant's face collection: [`enroll_face`], [`search_face`] and
//! [`delete_face`].
//!
//! ```
//! # use simpleplatform_sdk::prelude::*;
//! # use simpleplatform_sdk::ai::{Execution, Options};
//! # use simpleplatform_sdk::testing;
//! #[derive(Deserialize)]
//! struct Invoice {
//!     number: String,
//!     total: f64,
//! }
//!
//! # let _session = testing::install(|_name, _params| {
//! #     Ok(json!({
//! #         "data": { "number": "INV-8", "total": 240.0 },
//! #         "metadata": { "input_tokens": 812, "output_tokens": 24 }
//! #     }))
//! # });
//! let schema = json!({
//!     "type": "object",
//!     "properties": {
//!         "number": { "type": "string" },
//!         "total": { "type": "number" }
//!     },
//!     "required": ["number", "total"]
//! });
//!
//! let read: Execution<Invoice> = simple::ai::extract(
//!     json!({ "file_hash": "9f2c…", "mime_type": "application/pdf" }),
//!     "Read the invoice number and the total.",
//!     schema,
//!     Options::default(),
//! )?;
//!
//! assert_eq!(read.data.number, "INV-8");
//! assert_eq!(read.metadata.input_tokens, 812);
//! # Ok::<(), Error>(())
//! ```
//!
//! # The shape, and why it is this one
//!
//! **What an operation must have is an argument; what it may have is a field.**
//! An input, a prompt and a schema are the operation — leave one out and there
//! is nothing to run — so they are arguments, and the type system asks for them.
//! Everything else has a working default, so it lives in [`Options`], which
//! derives one:
//!
//! ```
//! # use simpleplatform_sdk::ai::{Model, Options};
//! # use std::time::Duration;
//! let options = Options {
//!     model: Some(Model::Large),
//!     timeout: Some(Duration::from_secs(90)),
//!     ..Default::default()
//! };
//! ```
//!
//! Nobody passes six `None`s, and a member added to [`Options`] later does not
//! disturb a call that was written with `..Default::default()`.
//!
//! **The answer type is yours.** [`extract`] is generic over what it decodes
//! into, exactly as [`crate::graphql::query`] is, so an extraction lands in your
//! own struct rather than in a `Value` you then have to pick apart. Where the
//! answer's shape is settled it is named for you instead: [`summarize`] answers
//! with prose, and [`transcribe`] answers with a [`Transcript`], because this
//! module wrote the schema that produced it.
//!
//! **Every answer carries what it cost.** An operation answers with an
//! [`Execution`] — the data and the [`Metadata`] beside it — so token counts are
//! there to record without a second call.
//!
//! # Files that have not been uploaded yet
//!
//! A document handle that is still pending is uploaded to ephemeral storage
//! before the operation runs, and the operation is given the handle that upload
//! answered with. A handle that is already stored is passed straight through,
//! and so is a list of handles, item by item. Nothing in a call site changes:
//! pass the handle you were given.

use std::fmt;
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::codes::Code;
use crate::error::{Error, Fault};
use crate::host;

/// The primitive that runs an AI operation.
const ORCHESTRATOR: &str = "logic:dev.simple.system/ai-orchestrator";

/// The host action that puts a pending file into ephemeral storage.
const UPLOAD_EPHEMERAL: &str = "action:documents/upload-ephemeral";

/// The host action that adds a face to the tenant's collection.
const FACE_ENROLL: &str = "action:ai/face/enroll";

/// The host action that searches the tenant's collection.
const FACE_SEARCH: &str = "action:ai/face/search";

/// The host action that removes faces from the tenant's collection.
const FACE_DELETE: &str = "action:ai/face/delete";

/// The size of model an operation runs on.
///
/// It is `#[non_exhaustive]`: a `match` on it needs a `_` arm, so a size added
/// later does not break an action that was already written.
#[non_exhaustive]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Model {
    /// The quickest and cheapest.
    Lite,
    /// The middle of the range.
    Medium,
    /// The one to reach for when the answer has to be right.
    Large,
    /// The largest available.
    Xl,
}

impl Model {
    /// The size exactly as it travels on the wire.
    pub fn as_str(&self) -> &str {
        match self {
            Model::Lite => "lite",
            Model::Medium => "medium",
            Model::Large => "large",
            Model::Xl => "xl",
        }
    }
}

impl fmt::Display for Model {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// What any operation may be told, beyond the inputs that define it.
///
/// Every member has a default, so a call that wants one thing changed says that
/// thing and nothing else:
///
/// ```
/// # use simpleplatform_sdk::ai::{Model, Options};
/// let options = Options {
///     model: Some(Model::Large),
///     reasoning: false,
///     ..Default::default()
/// };
/// ```
#[derive(Clone, Debug)]
pub struct Options {
    /// Which size of model to run on. Unset leaves the choice to the platform.
    pub model: Option<Model>,

    /// The role, or the standing instruction, the model holds for the whole
    /// task. Unset sends none.
    pub system_prompt: Option<String>,

    /// How far the model may range, from `0.0` for the most settled answer to
    /// `1.0` for the most inventive. Unset leaves the model's own default.
    pub temperature: Option<f64>,

    /// Whether the model works the answer out step by step, and reports how.
    /// On unless you turn it off.
    pub reasoning: bool,

    /// The most tokens the reasoning may spend. Unset leaves the platform's
    /// default, and it is read only while `reasoning` is on.
    pub reasoning_budget: Option<u32>,

    /// Whether to do the work again rather than answer from a cached result for
    /// the same input, prompt, schema, model and options.
    pub regenerate: bool,

    /// How long to wait for the answer. Unset leaves the platform's default.
    pub timeout: Option<Duration>,
}

impl Default for Options {
    /// Reasoning on, and every other choice left to the platform.
    fn default() -> Options {
        Options {
            model: None,
            system_prompt: None,
            temperature: None,
            reasoning: true,
            reasoning_budget: None,
            regenerate: false,
            timeout: None,
        }
    }
}

/// Whether to tell the speakers apart, and what to call them.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum Participants {
    /// Do not tell the speakers apart.
    #[default]
    Ignore,

    /// Tell the speakers apart, and label them `Participant 1`,
    /// `Participant 2`, and so on.
    Detect,

    /// Tell the speakers apart under the names given. Naming nobody asks for
    /// the same thing as [`Participants::Detect`].
    Named(Vec<String>),
}

impl Participants {
    /// Whether the speakers are to be told apart at all.
    fn wanted(&self) -> bool {
        !matches!(self, Participants::Ignore)
    }

    /// The names to identify, as one list, or nothing when none were given.
    fn names(&self) -> Option<String> {
        match self {
            Participants::Named(names) if !names.is_empty() => Some(names.join(", ")),
            _ => None,
        }
    }
}

/// What a transcription is to produce.
///
/// At least one of `include_transcript` and `summarize` has to be set, since
/// between them they are the whole of what a transcription answers with.
#[derive(Clone, Debug, Default)]
pub struct TranscribeOptions {
    /// Ask for the words that were said.
    pub include_transcript: bool,

    /// Ask for `[MM:SS]` stamps through the transcript. Read only while
    /// `include_transcript` is set.
    pub include_timestamps: bool,

    /// Ask for a summary of what was said.
    pub summarize: bool,

    /// Whether to tell the speakers apart, and what to call them.
    pub participants: Participants,
}

/// What a transcription answered with.
///
/// A member that was not asked for is empty, and every member survives an
/// answer that leaves it out.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct Transcript {
    /// The language that was heard, as an ISO 639-1 code such as `en` or `es`.
    pub language: String,

    /// The words that were said, when they were asked for.
    pub transcript: Option<String>,

    /// The summary, when it was asked for.
    pub summary: Option<String>,

    /// The speakers that were told apart, when they were asked for.
    pub participants: Vec<String>,
}

/// What an operation answered, and what it cost.
#[derive(Clone, Debug)]
pub struct Execution<T> {
    /// The answer itself, decoded into the type the call asked for.
    pub data: T,

    /// What the run spent, and how it reasoned.
    pub metadata: Metadata,
}

/// What a run spent, and how it reasoned.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Metadata {
    /// Tokens in what was sent.
    pub input_tokens: u64,

    /// Tokens in what came back.
    pub output_tokens: u64,

    /// Tokens spent reasoning, when the run reported them.
    pub reasoning_tokens: Option<u64>,

    /// The reasoning itself, when the run reported it.
    pub reasoning: Option<String>,
}

/// How far a face search reaches.
#[derive(Clone, Debug, Default)]
pub struct FaceSearch {
    /// The most matches to answer with. Unset leaves the platform's default.
    pub max_faces: Option<u32>,

    /// The similarity a match has to reach, as a percentage from `0.0` to
    /// `100.0`. Unset leaves the platform's default.
    pub similarity_threshold: Option<f64>,
}

/// Read structured data out of an input, against a schema you give.
///
/// The schema is the contract the answer is held to, and the type parameter is
/// what that answer is decoded into — so give the model the schema of the struct
/// you want back.
///
/// ```
/// # use simpleplatform_sdk::prelude::*;
/// # use simpleplatform_sdk::ai::{Execution, Options};
/// # use simpleplatform_sdk::testing;
/// #[derive(Deserialize)]
/// struct Sentiment {
///     score: f64,
/// }
///
/// # let _session = testing::install(|_name, _params| {
/// #     Ok(json!({ "data": { "score": 0.8 }, "metadata": { "output_tokens": 6 } }))
/// # });
/// let schema = json!({
///     "type": "object",
///     "properties": { "score": { "type": "number" } },
///     "required": ["score"]
/// });
///
/// let read: Execution<Sentiment> = simple::ai::extract(
///     json!("The delivery arrived early and intact."),
///     "Score the sentiment from -1.0 to 1.0.",
///     schema,
///     Options::default(),
/// )?;
///
/// assert_eq!(read.data.score, 0.8);
/// # Ok::<(), Error>(())
/// ```
pub fn extract<T: DeserializeOwned>(
    input: Value,
    prompt: &str,
    schema: Value,
    options: Options,
) -> Result<Execution<T>, Error> {
    refuse_empty(
        &input,
        "extract needs something to read.",
        "Pass the text, the document handle, or the object the extraction is to read.",
    )?;
    refuse_empty_prompt(prompt, "extract")?;

    if !schema.is_object() {
        return Err(
            Error::invalid("extract needs a JSON Schema object describing the answer.").hint(
                "Pass a schema object naming the type and the properties the answer is to have.",
            ),
        );
    }

    run("extract", input, prompt, Some(schema), &options)
}

/// Write prose about an input.
///
/// ```
/// # use simpleplatform_sdk::prelude::*;
/// # use simpleplatform_sdk::ai::Options;
/// # use simpleplatform_sdk::testing;
/// # let _session = testing::install(|_name, _params| {
/// #     Ok(json!({ "data": "A refund was agreed.", "metadata": { "output_tokens": 5 } }))
/// # });
/// let written = simple::ai::summarize(
///     json!({ "file_hash": "3a91…", "mime_type": "application/pdf" }),
///     "Summarise what was agreed, in one sentence.",
///     Options::default(),
/// )?;
///
/// assert_eq!(written.data, "A refund was agreed.");
/// # Ok::<(), Error>(())
/// ```
pub fn summarize(input: Value, prompt: &str, options: Options) -> Result<Execution<String>, Error> {
    refuse_empty(
        &input,
        "summarize needs something to read.",
        "Pass the text, the document handle, or the object the summary is to be written from.",
    )?;
    refuse_empty_prompt(prompt, "summarize")?;

    run("summarize", input, prompt, None, &options)
}

/// Turn audio or video into words.
///
/// `document` is the handle of an uploaded audio or video file. The prompt and
/// the schema are written here, from what `wanted` asks for, which is why the
/// answer is a [`Transcript`] rather than a type you have to name.
///
/// ```
/// # use simpleplatform_sdk::prelude::*;
/// # use simpleplatform_sdk::ai::{Options, Participants, TranscribeOptions};
/// # use simpleplatform_sdk::testing;
/// # let _session = testing::install(|_name, _params| {
/// #     Ok(json!({
/// #         "data": {
/// #             "language": "en",
/// #             "transcript": "Customer: My order is late.\nAgent: I have refunded it.",
/// #             "participants": ["Customer", "Agent"]
/// #         },
/// #         "metadata": { "input_tokens": 4_200, "output_tokens": 96 }
/// #     }))
/// # });
/// let heard = simple::ai::transcribe(
///     json!({ "file_hash": "c07b…", "mime_type": "audio/mpeg" }),
///     TranscribeOptions {
///         include_transcript: true,
///         participants: Participants::Named(vec!["Customer".into(), "Agent".into()]),
///         ..Default::default()
///     },
///     Options::default(),
/// )?;
///
/// assert_eq!(heard.data.language, "en");
/// assert_eq!(heard.data.participants, ["Customer", "Agent"]);
/// # Ok::<(), Error>(())
/// ```
pub fn transcribe(
    document: Value,
    wanted: TranscribeOptions,
    options: Options,
) -> Result<Execution<Transcript>, Error> {
    refuse_unless_media(&document)?;

    if !wanted.include_transcript && !wanted.summarize {
        return Err(
            Error::invalid("transcribe needs to be told what to produce.")
                .hint("Set include_transcript, summarize, or both."),
        );
    }

    let prompt = transcribe_prompt(&wanted);

    run(
        "extract",
        document,
        &prompt,
        Some(transcribe_schema(&wanted)),
        &options,
    )
}

/// Add a face to the tenant's collection, under the subject it belongs to.
///
/// `image` is either a base64 image or a document handle. The answer is the id
/// of the enrolled face, which is what [`delete_face`] takes.
///
/// ```
/// # use simpleplatform_sdk::prelude::*;
/// # use simpleplatform_sdk::testing;
/// # let _session = testing::install(|_name, _params| Ok(json!({ "face_id": "FACE-1" })));
/// let face_id = simple::ai::enroll_face("EMP-42", json!("iVBORw0KGgo…"))?;
///
/// assert_eq!(face_id, "FACE-1");
/// # Ok::<(), Error>(())
/// ```
pub fn enroll_face(subject_id: &str, image: Value) -> Result<String, Error> {
    if subject_id.trim().is_empty() {
        return Err(
            Error::invalid("enroll_face needs the subject the face belongs to.")
                .hint("Pass the id the face is to be found under, such as an employee or user id."),
        );
    }

    refuse_empty(
        &image,
        "enroll_face needs an image of the face.",
        "Pass a base64 image, or the handle of an uploaded one.",
    )?;

    let image = upload_pending(image)?;

    let enrolled = host::transport()?
        .call(
            FACE_ENROLL.to_string(),
            json!({ "image": image, "subject_id": subject_id }),
        )
        .map_err(|cause| {
            cause.hint(
                "Search the subject before enrolling the same face again, and report the failure.",
            )
        })?;

    enrolled
        .get("face_id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| {
            Error::Json(Fault::new(
                Code::unspecified(),
                "The enrolment answered without the id of the face it enrolled.",
            ))
            .hint("Search the subject to establish what was enrolled before enrolling again.")
        })
}

/// Find the faces in the tenant's collection that match an image.
///
/// `image` is either a base64 image or a document handle. The matches are
/// decoded into the type the call asks for; name your own to read them, or ask
/// for a [`Value`] to keep them whole.
///
/// ```
/// # use simpleplatform_sdk::prelude::*;
/// # use simpleplatform_sdk::ai::FaceSearch;
/// # use simpleplatform_sdk::testing;
/// # let _session = testing::install(|_name, _params| Ok(json!([{ "subject_id": "EMP-42" }])));
/// let found: Value = simple::ai::search_face(
///     json!("iVBORw0KGgo…"),
///     FaceSearch {
///         max_faces: Some(3),
///         similarity_threshold: Some(92.5),
///     },
/// )?;
///
/// assert_eq!(found[0]["subject_id"], json!("EMP-42"));
/// # Ok::<(), Error>(())
/// ```
pub fn search_face<T: DeserializeOwned>(image: Value, options: FaceSearch) -> Result<T, Error> {
    refuse_empty(
        &image,
        "search_face needs an image to search with.",
        "Pass a base64 image, or the handle of an uploaded one.",
    )?;

    let image = upload_pending(image)?;

    let mut narrowing = Map::new();

    if let Some(max_faces) = options.max_faces {
        narrowing.insert("max_faces".to_string(), Value::from(max_faces));
    }

    if let Some(threshold) = options
        .similarity_threshold
        .filter(|value| value.is_finite())
    {
        narrowing.insert("similarity_threshold".to_string(), Value::from(threshold));
    }

    let found = host::transport()?
        .call(
            FACE_SEARCH.to_string(),
            json!({ "image": image, "options": narrowing }),
        )
        .map_err(|cause| {
            cause.hint("Nothing in the collection was changed. Report the search failure.")
        })?;

    serde_json::from_value(found).map_err(|cause| {
        Error::Json(Fault::new(
            Code::unspecified(),
            format!("The matches could not be read into the type this action asked for: {cause}"),
        ))
        .hint("Read the matches as a Value, or name a type that matches what the search answers.")
    })
}

/// Remove faces from the tenant's collection, by the ids they were enrolled
/// under.
///
/// The answer is the ids the platform reports as removed.
///
/// ```
/// # use simpleplatform_sdk::prelude::*;
/// # use simpleplatform_sdk::testing;
/// # let _session = testing::install(|_name, _params| Ok(json!({ "deleted": ["FACE-1"] })));
/// let removed = simple::ai::delete_face(&["FACE-1".to_string()])?;
///
/// assert_eq!(removed, ["FACE-1"]);
/// # Ok::<(), Error>(())
/// ```
pub fn delete_face(face_ids: &[String]) -> Result<Vec<String>, Error> {
    if face_ids.is_empty() {
        return Err(Error::invalid("delete_face needs at least one face id.")
            .hint("Pass the ids enroll_face answered with."));
    }

    let removed = host::transport()?
        .call(FACE_DELETE.to_string(), json!({ "face_ids": face_ids }))
        .map_err(|cause| {
            cause.hint(
                "Treat the removal as unfinished: search the collection to establish what is \
                 still in it before deleting again.",
            )
        })?;

    let listed = match &removed {
        Value::Array(ids) => Some(ids),
        other => other.get("deleted").and_then(Value::as_array),
    };

    Ok(listed
        .map(|ids| {
            ids.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default())
}

/// One operation: upload what is pending, ask the primitive, read the answer.
fn run<T: DeserializeOwned>(
    operation: &str,
    input: Value,
    prompt: &str,
    schema: Option<Value>,
    options: &Options,
) -> Result<Execution<T>, Error> {
    let input = upload_pending(input)?;

    let answered = host::transport()?
        .call(
            ORCHESTRATOR.to_string(),
            payload(operation, input, prompt, schema, options),
        )
        .map_err(|cause| {
            cause.hint(
                "No tenant record was changed. Review the input, the prompt and the schema, \
                 and report the failure.",
            )
        })?;

    // The metadata is read on its own and never decides the outcome, so a run
    // that answered is reported as one whatever it said about its own cost.
    let metadata = metadata_of(answered.get("metadata"));
    let data = answered.get("data").cloned().unwrap_or(Value::Null);

    let data = serde_json::from_value(data).map_err(|cause| {
        Error::Json(Fault::new(
            Code::unspecified(),
            format!("The {operation} answer could not be read into the type this action asked for: {cause}"),
        ))
        .hint(
            "The operation ran. Read the answer as a Value, or name a type that matches the \
             schema, rather than running it again.",
        )
    })?;

    Ok(Execution { data, metadata })
}

/// Everything the primitive is told about one operation.
///
/// A choice that was not made is left out, so what arrives is what the call
/// asked for and the platform's own defaults fill the rest.
fn payload(
    operation: &str,
    input: Value,
    prompt: &str,
    schema: Option<Value>,
    options: &Options,
) -> Value {
    // The engine reads `reasoning` and `reasoning_budget` from here, and the
    // whole map is part of the key a cached result is found under.
    let mut universal = Map::new();

    universal.insert("reasoning".to_string(), Value::Bool(options.reasoning));

    if let Some(budget) = options.reasoning_budget {
        universal.insert("reasoning_budget".to_string(), Value::from(budget));
    }

    if let Some(temperature) = options.temperature.filter(|value| value.is_finite()) {
        universal.insert("temperature".to_string(), Value::from(temperature));
    }

    let mut payload = Map::new();

    payload.insert("operation".to_string(), Value::from(operation));
    payload.insert("input".to_string(), input);
    payload.insert("prompt".to_string(), Value::from(prompt));
    payload.insert("options".to_string(), Value::Object(universal));
    payload.insert("regenerate".to_string(), Value::Bool(options.regenerate));

    if let Some(schema) = schema {
        payload.insert("schema".to_string(), schema);
    }

    if let Some(model) = options.model {
        payload.insert("model".to_string(), Value::from(model.as_str()));
    }

    if let Some(system_prompt) = &options.system_prompt {
        payload.insert(
            "systemPrompt".to_string(),
            Value::from(system_prompt.as_str()),
        );
    }

    if let Some(timeout) = options.timeout {
        payload.insert("timeout".to_string(), Value::from(milliseconds(timeout)));
    }

    Value::Object(payload)
}

/// A duration as the milliseconds the wire carries.
fn milliseconds(timeout: Duration) -> u64 {
    u64::try_from(timeout.as_millis()).unwrap_or(u64::MAX)
}

/// What a run reported about itself.
fn metadata_of(metadata: Option<&Value>) -> Metadata {
    let Some(metadata) = metadata else {
        return Metadata::default();
    };

    Metadata {
        input_tokens: count(metadata, "input_tokens").unwrap_or(0),
        output_tokens: count(metadata, "output_tokens").unwrap_or(0),
        reasoning_tokens: count(metadata, "reasoning_tokens"),
        reasoning: metadata
            .get("reasoning")
            .and_then(Value::as_str)
            .map(str::to_string),
    }
}

/// One token count, when it is there and is a count.
fn count(metadata: &Value, key: &str) -> Option<u64> {
    metadata.get(key).and_then(Value::as_u64)
}

/// Put whatever is still pending into ephemeral storage, and answer with what
/// the operation is to be given instead.
///
/// A handle that is already stored, and anything that is not a handle at all,
/// comes back as it went in.
fn upload_pending(value: Value) -> Result<Value, Error> {
    if is_pending(&value) {
        return host::transport()?
            .call(UPLOAD_EPHEMERAL.to_string(), value)
            .map_err(|cause| {
                cause.hint(
                    "The file was not uploaded and the operation did not run. Upload the file, \
                     then pass the handle that upload answered with.",
                )
            });
    }

    if let Value::Array(items) = value {
        let mut uploaded = Vec::with_capacity(items.len());

        for item in items {
            uploaded.push(upload_pending(item)?);
        }

        return Ok(Value::Array(uploaded));
    }

    Ok(value)
}

/// Whether this is a document handle whose file is still to be uploaded.
///
/// It is one when it says it is pending and carries the hash of the file it
/// stands for, since that hash is what the upload is asked for by.
fn is_pending(value: &Value) -> bool {
    value.get("pending").and_then(Value::as_bool) == Some(true) && has_file_hash(value)
}

/// Whether this carries the hash of a file.
fn has_file_hash(value: &Value) -> bool {
    value
        .get("file_hash")
        .and_then(Value::as_str)
        .is_some_and(|hash| !hash.is_empty())
}

/// Refuse a value that names nothing, in the words of whoever needed it.
fn refuse_empty(value: &Value, message: &str, hint: &str) -> Result<(), Error> {
    let empty = match value {
        Value::Null => true,
        Value::String(text) => text.is_empty(),
        _ => false,
    };

    if empty {
        return Err(Error::invalid(message).hint(hint));
    }

    Ok(())
}

/// Refuse an operation that has been given nothing to do.
fn refuse_empty_prompt(prompt: &str, operation: &str) -> Result<(), Error> {
    if prompt.trim().is_empty() {
        return Err(Error::invalid(format!("{operation} needs a prompt."))
            .hint("Say what the operation is to produce, in a sentence the model can act on."));
    }

    Ok(())
}

/// Refuse anything that is not the handle of an audio or video file.
fn refuse_unless_media(document: &Value) -> Result<(), Error> {
    if !has_file_hash(document) {
        return Err(
            Error::invalid("transcribe needs a document handle to work on.").hint(
                "Pass the handle of the uploaded file, the one carrying file_hash and mime_type.",
            ),
        );
    }

    let media = document
        .get("mime_type")
        .and_then(Value::as_str)
        .map(str::to_lowercase)
        .is_some_and(|mime| mime.starts_with("audio/") || mime.starts_with("video/"));

    if !media {
        return Err(Error::invalid("transcribe works on audio and video.")
            .hint("Pass a handle whose mime_type begins audio/ or video/."));
    }

    Ok(())
}

/// The schema a transcription is held to, written from what was asked for.
fn transcribe_schema(wanted: &TranscribeOptions) -> Value {
    let identify = wanted.participants.wanted();

    let mut properties = Map::new();
    let mut required = vec![Value::from("language")];

    properties.insert(
        "language".to_string(),
        json!({
            "description": "The detected language of the audio (ISO 639-1 code, e.g., \"en\", \"es\")",
            "type": "string"
        }),
    );

    if wanted.include_transcript {
        let description = match (identify, wanted.include_timestamps) {
            (true, true) => {
                "The full transcript with participant labels and timestamps. \
                 Format: [MM:SS] Participant Name: text"
            }
            (true, false) => {
                "The full transcript with participant labels. Format: Participant Name: text"
            }
            (false, true) => "The full transcript with timestamps. Format: [MM:SS] text",
            (false, false) => "The full transcript of the audio",
        };

        properties.insert(
            "transcript".to_string(),
            json!({ "description": description, "type": "string" }),
        );
        required.push(Value::from("transcript"));
    }

    if wanted.summarize {
        let description = if identify {
            "A concise summary of the audio content, including key points from each participant"
        } else {
            "A concise summary of the audio content"
        };

        properties.insert(
            "summary".to_string(),
            json!({ "description": description, "type": "string" }),
        );
        required.push(Value::from("summary"));
    }

    if identify {
        properties.insert(
            "participants".to_string(),
            json!({
                "description": "List of identified participants in the audio",
                "items": { "type": "string" },
                "type": "array"
            }),
        );
        required.push(Value::from("participants"));
    }

    json!({ "properties": properties, "required": required, "type": "object" })
}

/// The prompt a transcription runs on, written from what was asked for.
fn transcribe_prompt(wanted: &TranscribeOptions) -> String {
    let identify = wanted.participants.wanted();
    let names = wanted.participants.names();

    let mut prompt = String::from("Analyze this audio/video file and provide:\n");

    if wanted.include_transcript {
        if identify {
            match &names {
                Some(names) => {
                    prompt.push_str("- A complete transcript identifying these participants: ");
                    prompt.push_str(names);
                    prompt.push_str(". ");
                }
                None => prompt.push_str(
                    "- A complete transcript with participant identification \
                     (label participants as Participant 1, Participant 2, etc.). ",
                ),
            }

            if wanted.include_timestamps {
                prompt.push_str(
                    "Include timestamps in [MM:SS] format before each participant segment.\n",
                );
            } else {
                prompt.push_str("Format each line as \"Participant Name: text\".\n");
            }
        } else if wanted.include_timestamps {
            prompt.push_str(
                "- A complete transcript with timestamps in [MM:SS] format before each segment\n",
            );
        } else {
            prompt.push_str("- A complete transcript of all spoken content\n");
        }
    }

    if wanted.summarize {
        if identify {
            prompt.push_str("- A concise summary highlighting key points from each participant\n");
        } else {
            prompt.push_str("- A concise summary of the main points and key information\n");
        }
    }

    if identify {
        match &names {
            Some(names) => {
                prompt.push_str("- Identify and distinguish between these participants: ");
                prompt.push_str(names);
                prompt.push('\n');
            }
            None => prompt.push_str("- Identify and list all distinct participants in the audio\n"),
        }
    }

    prompt.push_str("- The detected language code (ISO 639-1 format)\n");

    prompt
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::testing;

    /// What the primitive answers when a test does not care what came back.
    fn answered() -> Value {
        json!({ "data": { "ok": true }, "metadata": { "input_tokens": 1, "output_tokens": 2 } })
    }

    #[test]
    fn an_extraction_asks_the_primitive_and_answers_with_the_type_it_was_asked_for() {
        #[derive(Debug, Deserialize, PartialEq)]
        struct Invoice {
            number: String,
            total: f64,
        }

        let session = testing::install(|name, params| {
            assert_eq!(name, ORCHESTRATOR);
            assert_eq!(params["operation"], json!("extract"));
            assert_eq!(params["prompt"], json!("Read it."));
            assert_eq!(params["input"], json!("INV-8, 240.00"));
            assert_eq!(params["schema"]["type"], json!("object"));

            Ok(json!({
                "data": { "number": "INV-8", "total": 240.0 },
                "metadata": { "input_tokens": 11, "output_tokens": 3 }
            }))
        });

        let read: Execution<Invoice> = extract(
            json!("INV-8, 240.00"),
            "Read it.",
            json!({ "type": "object" }),
            Options::default(),
        )
        .unwrap();

        assert_eq!(
            read.data,
            Invoice {
                number: "INV-8".to_string(),
                total: 240.0
            }
        );
        assert_eq!(read.metadata.input_tokens, 11);
        assert_eq!(read.metadata.output_tokens, 3);
        assert_eq!(session.calls().len(), 1);
    }

    #[test]
    fn a_default_call_reasons_does_not_regenerate_and_leaves_the_rest_to_the_platform() {
        let session = testing::install(|_name, _params| Ok(answered()));

        let _: Execution<Value> = extract(
            json!("text"),
            "Read it.",
            json!({ "type": "object" }),
            Options::default(),
        )
        .unwrap();

        let sent = session.calls()[0].params.clone();

        assert_eq!(sent["options"], json!({ "reasoning": true }));
        assert_eq!(sent["regenerate"], json!(false));
        assert!(sent.get("model").is_none());
        assert!(sent.get("systemPrompt").is_none());
        assert!(sent.get("timeout").is_none());
    }

    #[test]
    fn every_option_that_was_set_travels_with_the_operation() {
        let session = testing::install(|_name, _params| Ok(answered()));

        let _: Execution<Value> = extract(
            json!("text"),
            "Read it.",
            json!({ "type": "object" }),
            Options {
                model: Some(Model::Xl),
                system_prompt: Some("You are an auditor.".to_string()),
                temperature: Some(0.25),
                reasoning: false,
                reasoning_budget: Some(2_048),
                regenerate: true,
                timeout: Some(Duration::from_secs(90)),
            },
        )
        .unwrap();

        let sent = session.calls()[0].params.clone();

        assert_eq!(sent["model"], json!("xl"));
        assert_eq!(sent["systemPrompt"], json!("You are an auditor."));
        assert_eq!(sent["regenerate"], json!(true));
        assert_eq!(sent["timeout"], json!(90_000));
        assert_eq!(
            sent["options"],
            json!({ "reasoning": false, "reasoning_budget": 2_048, "temperature": 0.25 })
        );
    }

    #[test]
    fn a_summary_answers_with_the_prose_and_carries_no_schema() {
        let session = testing::install(|_name, params| {
            assert_eq!(params["operation"], json!("summarize"));
            assert!(params.get("schema").is_none());

            Ok(json!({ "data": "A refund was agreed.", "metadata": { "output_tokens": 5 } }))
        });

        let written = summarize(json!("A long thread."), "One sentence.", Options::default())
            .expect("a summary answers with prose");

        assert_eq!(written.data, "A refund was agreed.");
        assert_eq!(written.metadata.output_tokens, 5);
        assert_eq!(session.calls().len(), 1);
    }

    #[test]
    fn a_pending_document_is_uploaded_before_the_operation_reads_it() {
        let session = testing::install(|name, _params| {
            if name == UPLOAD_EPHEMERAL {
                return Ok(json!({ "file_hash": "abc", "storage_path": "ephemeral/abc" }));
            }

            Ok(answered())
        });

        let _: Execution<Value> = extract(
            json!({ "file_hash": "abc", "pending": true }),
            "Read it.",
            json!({ "type": "object" }),
            Options::default(),
        )
        .unwrap();

        let calls = session.calls();

        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].name, UPLOAD_EPHEMERAL);
        assert_eq!(calls[1].name, ORCHESTRATOR);
        assert_eq!(
            calls[1].params["input"],
            json!({ "file_hash": "abc", "storage_path": "ephemeral/abc" }),
            "the operation reads the handle the upload answered with"
        );
    }

    #[test]
    fn a_document_that_is_already_stored_is_read_where_it_is() {
        let session = testing::install(|_name, _params| Ok(answered()));

        let handle = json!({ "file_hash": "abc", "mime_type": "application/pdf" });

        let _: Execution<Value> = extract(
            handle.clone(),
            "Read it.",
            json!({ "type": "object" }),
            Options::default(),
        )
        .unwrap();

        let calls = session.calls();

        assert_eq!(calls.len(), 1, "nothing was uploaded");
        assert_eq!(calls[0].params["input"], handle);
    }

    #[test]
    fn a_list_of_documents_is_uploaded_item_by_item() {
        let session = testing::install(|name, params| {
            if name == UPLOAD_EPHEMERAL {
                return Ok(json!({ "stored": params["file_hash"] }));
            }

            Ok(answered())
        });

        let _: Execution<Value> = extract(
            json!([
                { "file_hash": "one", "pending": true },
                { "file_hash": "two", "mime_type": "image/png" },
                { "file_hash": "three", "pending": true }
            ]),
            "Read them.",
            json!({ "type": "object" }),
            Options::default(),
        )
        .unwrap();

        let calls = session.calls();

        assert_eq!(calls.len(), 3, "two uploads and the operation");
        assert_eq!(
            calls[2].params["input"],
            json!([
                { "stored": "one" },
                { "file_hash": "two", "mime_type": "image/png" },
                { "stored": "three" }
            ])
        );
    }

    #[test]
    fn a_handle_is_pending_only_while_it_says_so_and_carries_a_hash_to_upload_by() {
        assert!(is_pending(&json!({ "file_hash": "abc", "pending": true })));
        assert!(!is_pending(&json!({ "file_hash": "abc" })));
        assert!(!is_pending(&json!({ "pending": true })));
        assert!(!is_pending(&json!({ "file_hash": "", "pending": true })));
        assert!(!is_pending(
            &json!({ "file_hash": "abc", "pending": "yes" })
        ));
        assert!(!is_pending(&json!("some words")));
        assert!(!is_pending(&json!([
            { "file_hash": "abc", "pending": true }
        ])));
    }

    #[test]
    fn an_answer_that_reports_nothing_about_its_cost_is_still_an_answer() {
        let _session = testing::install(|_name, _params| Ok(json!({ "data": "done" })));

        let written = summarize(json!("text"), "One sentence.", Options::default()).unwrap();

        assert_eq!(written.data, "done");
        assert_eq!(written.metadata, Metadata::default());
    }

    #[test]
    fn reasoning_reaches_the_caller_when_the_run_reported_it() {
        let _session = testing::install(|_name, _params| {
            Ok(json!({
                "data": "done",
                "metadata": {
                    "input_tokens": 9,
                    "output_tokens": 4,
                    "reasoning": "Read the total from the last line.",
                    "reasoning_tokens": 120
                }
            }))
        });

        let written = summarize(json!("text"), "One sentence.", Options::default()).unwrap();

        assert_eq!(written.metadata.reasoning_tokens, Some(120));
        assert_eq!(
            written.metadata.reasoning.as_deref(),
            Some("Read the total from the last line.")
        );
    }

    #[test]
    fn an_operation_with_nothing_to_do_is_refused_before_anything_is_sent() {
        let session = testing::install(|_name, _params| Ok(answered()));

        let missing_input = extract::<Value>(
            json!(null),
            "Read it.",
            json!({ "type": "object" }),
            Options::default(),
        )
        .unwrap_err();

        let missing_prompt = extract::<Value>(
            json!("text"),
            "   ",
            json!({ "type": "object" }),
            Options::default(),
        )
        .unwrap_err();

        let missing_schema =
            extract::<Value>(json!("text"), "Read it.", json!([]), Options::default()).unwrap_err();

        let missing_summary_input =
            summarize(json!(""), "One sentence.", Options::default()).unwrap_err();

        for refusal in [
            &missing_input,
            &missing_prompt,
            &missing_schema,
            &missing_summary_input,
        ] {
            assert_eq!(refusal.code().as_str(), "INVALID_TOOL_INPUT");
        }

        assert!(session.calls().is_empty());
    }

    #[test]
    fn a_transcription_writes_its_own_schema_and_prompt() {
        let session = testing::install(|_name, _params| {
            Ok(json!({
                "data": { "language": "en", "transcript": "Hello." },
                "metadata": { "input_tokens": 400, "output_tokens": 12 }
            }))
        });

        let heard = transcribe(
            json!({ "file_hash": "abc", "mime_type": "AUDIO/MPEG" }),
            TranscribeOptions {
                include_transcript: true,
                ..Default::default()
            },
            Options::default(),
        )
        .expect("an uppercase mime type is the same mime type");

        assert_eq!(heard.data.language, "en");
        assert_eq!(heard.data.transcript.as_deref(), Some("Hello."));
        assert_eq!(heard.data.summary, None);
        assert!(heard.data.participants.is_empty());

        let sent = session.calls()[0].params.clone();

        assert_eq!(sent["operation"], json!("extract"));
        assert_eq!(
            sent["schema"]["required"],
            json!(["language", "transcript"])
        );
        assert_eq!(sent["schema"]["properties"]["transcript"]["type"], "string");
        assert_eq!(
            sent["prompt"],
            json!(
                "Analyze this audio/video file and provide:\n\
                 - A complete transcript of all spoken content\n\
                 - The detected language code (ISO 639-1 format)\n"
            )
        );
    }

    #[test]
    fn named_participants_reach_both_the_prompt_and_the_schema() {
        let session = testing::install(|_name, _params| {
            Ok(json!({ "data": { "language": "en", "participants": ["Customer", "Agent"] } }))
        });

        let heard = transcribe(
            json!({ "file_hash": "abc", "mime_type": "video/mp4" }),
            TranscribeOptions {
                include_transcript: true,
                include_timestamps: true,
                summarize: true,
                participants: Participants::Named(vec![
                    "Customer".to_string(),
                    "Agent".to_string(),
                ]),
            },
            Options::default(),
        )
        .unwrap();

        assert_eq!(heard.data.participants, ["Customer", "Agent"]);

        let sent = session.calls()[0].params.clone();
        let prompt = sent["prompt"].as_str().unwrap_or_default().to_string();

        assert_eq!(
            sent["schema"]["required"],
            json!(["language", "transcript", "summary", "participants"])
        );
        assert_eq!(
            sent["schema"]["properties"]["participants"]["items"]["type"],
            json!("string")
        );
        assert!(prompt.contains("identifying these participants: Customer, Agent. "));
        assert!(prompt.contains("Include timestamps in [MM:SS] format"));
        assert!(
            prompt.contains("- A concise summary highlighting key points from each participant\n")
        );
        assert!(prompt
            .contains("- Identify and distinguish between these participants: Customer, Agent\n"));
    }

    #[test]
    fn detected_participants_are_labelled_rather_than_named() {
        let session =
            testing::install(|_name, _params| Ok(json!({ "data": { "language": "en" } })));

        let _ = transcribe(
            json!({ "file_hash": "abc", "mime_type": "audio/wav" }),
            TranscribeOptions {
                include_transcript: true,
                participants: Participants::Detect,
                ..Default::default()
            },
            Options::default(),
        )
        .unwrap();

        let prompt = session.calls()[0].params["prompt"]
            .as_str()
            .unwrap_or_default()
            .to_string();

        assert!(prompt.contains("label participants as Participant 1, Participant 2, etc."));
        assert!(prompt.contains("Format each line as \"Participant Name: text\".\n"));
        assert!(prompt.contains("- Identify and list all distinct participants in the audio\n"));
    }

    #[test]
    fn naming_nobody_asks_for_the_same_thing_as_detecting() {
        let wanted = |participants| TranscribeOptions {
            include_transcript: true,
            participants,
            ..Default::default()
        };

        assert_eq!(
            transcribe_prompt(&wanted(Participants::Named(Vec::new()))),
            transcribe_prompt(&wanted(Participants::Detect))
        );
        assert_eq!(
            transcribe_schema(&wanted(Participants::Named(Vec::new()))),
            transcribe_schema(&wanted(Participants::Detect))
        );
    }

    #[test]
    fn a_transcription_that_cannot_run_is_refused_before_anything_is_sent() {
        let session = testing::install(|_name, _params| Ok(answered()));

        let audio = json!({ "file_hash": "abc", "mime_type": "audio/mpeg" });

        let nothing_wanted = transcribe(
            audio.clone(),
            TranscribeOptions::default(),
            Options::default(),
        )
        .unwrap_err();

        let not_media = transcribe(
            json!({ "file_hash": "abc", "mime_type": "application/pdf" }),
            TranscribeOptions {
                include_transcript: true,
                ..Default::default()
            },
            Options::default(),
        )
        .unwrap_err();

        let not_a_handle = transcribe(
            json!("some words"),
            TranscribeOptions {
                summarize: true,
                ..Default::default()
            },
            Options::default(),
        )
        .unwrap_err();

        for refusal in [&nothing_wanted, &not_media, &not_a_handle] {
            assert_eq!(refusal.code().as_str(), "INVALID_TOOL_INPUT");
        }

        assert!(session.calls().is_empty());
    }

    #[test]
    fn an_enrolment_answers_with_the_id_the_face_was_filed_under() {
        let session = testing::install(|name, params| {
            assert_eq!(name, FACE_ENROLL);
            assert_eq!(params["subject_id"], json!("EMP-42"));
            assert_eq!(params["image"], json!("iVBORw0KGgo"));

            Ok(json!({ "face_id": "FACE-1" }))
        });

        assert_eq!(
            enroll_face("EMP-42", json!("iVBORw0KGgo")).unwrap(),
            "FACE-1"
        );
        assert_eq!(session.calls().len(), 1);
    }

    #[test]
    fn an_enrolment_uploads_a_pending_image_first() {
        let session = testing::install(|name, _params| {
            if name == UPLOAD_EPHEMERAL {
                return Ok(json!({ "file_hash": "abc", "storage_path": "ephemeral/abc" }));
            }

            Ok(json!({ "face_id": "FACE-1" }))
        });

        enroll_face("EMP-42", json!({ "file_hash": "abc", "pending": true })).unwrap();

        let calls = session.calls();

        assert_eq!(calls[0].name, UPLOAD_EPHEMERAL);
        assert_eq!(
            calls[1].params["image"],
            json!({ "file_hash": "abc", "storage_path": "ephemeral/abc" })
        );
    }

    #[test]
    fn an_enrolment_without_a_subject_or_an_image_is_refused() {
        let session = testing::install(|_name, _params| Ok(json!({ "face_id": "FACE-1" })));

        assert_eq!(
            enroll_face("  ", json!("image"))
                .unwrap_err()
                .code()
                .as_str(),
            "INVALID_TOOL_INPUT"
        );
        assert_eq!(
            enroll_face("EMP-42", json!(null))
                .unwrap_err()
                .code()
                .as_str(),
            "INVALID_TOOL_INPUT"
        );
        assert!(session.calls().is_empty());
    }

    #[test]
    fn an_enrolment_that_answers_without_an_id_is_reported_rather_than_guessed_at() {
        let _session = testing::install(|_name, _params| Ok(json!({ "enrolled": true })));

        let error = enroll_face("EMP-42", json!("image")).unwrap_err();

        assert!(matches!(error, Error::Json(_)));
        assert_eq!(error.code().as_str(), "ACTION_FAILED");
    }

    #[test]
    fn a_search_carries_only_the_narrowing_it_was_given() {
        let session = testing::install(|name, params| {
            assert_eq!(name, FACE_SEARCH);

            Ok(json!({ "matches": params["options"].clone() }))
        });

        let wide: Value = search_face(json!("image"), FaceSearch::default()).unwrap();

        let narrow: Value = search_face(
            json!("image"),
            FaceSearch {
                max_faces: Some(3),
                similarity_threshold: Some(92.5),
            },
        )
        .unwrap();

        assert_eq!(wide["matches"], json!({}), "the platform's own defaults");
        assert_eq!(
            narrow["matches"],
            json!({ "max_faces": 3, "similarity_threshold": 92.5 })
        );
        assert_eq!(session.calls().len(), 2);
    }

    #[test]
    fn a_search_answers_with_the_type_the_call_asked_for() {
        #[derive(Debug, Deserialize, PartialEq)]
        struct Match {
            similarity: f64,
            subject_id: String,
        }

        let _session = testing::install(|_name, _params| {
            Ok(json!([{ "similarity": 99.1, "subject_id": "EMP-42" }]))
        });

        let found: Vec<Match> = search_face(json!("image"), FaceSearch::default()).unwrap();

        assert_eq!(
            found,
            vec![Match {
                similarity: 99.1,
                subject_id: "EMP-42".to_string()
            }]
        );
    }

    #[test]
    fn a_search_with_no_image_is_refused_before_anything_is_sent() {
        let session = testing::install(|_name, _params| Ok(json!([])));

        let error = search_face::<Value>(json!(null), FaceSearch::default()).unwrap_err();

        assert_eq!(error.code().as_str(), "INVALID_TOOL_INPUT");
        assert!(session.calls().is_empty());
    }

    #[test]
    fn a_removal_reports_the_ids_the_platform_says_it_removed() {
        let session = testing::install(|name, params| {
            assert_eq!(name, FACE_DELETE);
            assert_eq!(params["face_ids"], json!(["FACE-1", "FACE-2"]));

            Ok(json!({ "deleted": ["FACE-1"] }))
        });

        let removed = delete_face(&["FACE-1".to_string(), "FACE-2".to_string()]).unwrap();

        assert_eq!(removed, ["FACE-1"]);
        assert_eq!(session.calls().len(), 1);
    }

    #[test]
    fn a_removal_reads_a_bare_list_of_ids_as_well() {
        let _session = testing::install(|_name, _params| Ok(json!(["FACE-1", "FACE-2"])));

        assert_eq!(
            delete_face(&["FACE-1".to_string()]).unwrap(),
            ["FACE-1", "FACE-2"]
        );
    }

    #[test]
    fn a_removal_that_names_nothing_removed_answers_with_nothing() {
        let _session = testing::install(|_name, _params| Ok(json!({ "ok": true })));

        assert!(delete_face(&["FACE-1".to_string()]).unwrap().is_empty());
    }

    #[test]
    fn a_removal_with_no_ids_is_refused_before_anything_is_sent() {
        let session = testing::install(|_name, _params| Ok(json!([])));

        let error = delete_face(&[]).unwrap_err();

        assert_eq!(error.code().as_str(), "INVALID_TOOL_INPUT");
        assert!(session.calls().is_empty());
    }

    #[test]
    fn what_the_host_said_survives_into_every_failure() {
        let _session = testing::install(|_name, _params| Err(Error::failed("the engine is busy")));

        let operation = summarize(json!("text"), "One sentence.", Options::default()).unwrap_err();
        let enrolment = enroll_face("EMP-42", json!("image")).unwrap_err();
        let search = search_face::<Value>(json!("image"), FaceSearch::default()).unwrap_err();
        let removal = delete_face(&["FACE-1".to_string()]).unwrap_err();

        for failure in [&operation, &enrolment, &search, &removal] {
            assert!(failure.message().contains("the engine is busy"));
            assert!(!failure.fault().hint().is_empty(), "and says what to do");
        }
    }

    #[test]
    fn an_answer_that_does_not_fit_the_type_is_reported_as_having_run() {
        let _session = testing::install(|_name, _params| Ok(json!({ "data": { "total": 240.0 } })));

        let error = summarize(json!("text"), "One sentence.", Options::default()).unwrap_err();

        assert!(matches!(error, Error::Json(_)));
        assert_eq!(error.code().as_str(), "ACTION_FAILED");
        assert!(error
            .fault()
            .hint()
            .contains("rather than running it again"));
    }

    #[test]
    fn a_timeout_travels_as_the_milliseconds_the_wire_carries() {
        assert_eq!(milliseconds(Duration::from_secs(30)), 30_000);
        assert_eq!(milliseconds(Duration::from_millis(1)), 1);
        assert_eq!(milliseconds(Duration::MAX), u64::MAX);
    }

    #[test]
    fn every_model_names_itself_as_the_wire_spells_it() {
        assert_eq!(Model::Lite.to_string(), "lite");
        assert_eq!(Model::Medium.to_string(), "medium");
        assert_eq!(Model::Large.to_string(), "large");
        assert_eq!(Model::Xl.to_string(), "xl");
    }
}
