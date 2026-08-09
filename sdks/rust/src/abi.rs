//! Every line of `unsafe` in this crate, and the only file that knows an
//! address exists.
//!
//! Compiled for `wasm32` only. Everything above this file speaks in owned
//! `String`s and `Value`s, so an action author works in values and never in
//! pointers, lengths, or allocations.
//!
//! # The imports, which are fixed
//!
//! Six functions in the `simple` namespace, and the two builds declare different
//! subsets of them. The browser worker binds `__call`, `__cast`, `__getContext`
//! and `__getContextSize`, so the *async* build declares exactly those four and
//! keeps the execution-result pair behind `#[cfg(not(feature = "async"))]`, where
//! the synchronous build picks it up.
//!
//! # How a reply arrives, twice over
//!
//! Synchronously, the host holds the reply and the guest asks for it:
//! `__getExecutionResultSize` then `__getExecutionResult(ptr)`.
//!
//! Asynchronously, there is nobody to ask. `wasm-opt --asyncify` unwinds the
//! guest at the `__call`, the host does the work while the module is parked,
//! writes the reply into memory it asked for with `allocate_buffer`, announces
//! it with `set_response_buffer`, and rewinds. Execution resumes *inside*
//! [`call`], one line past the import, and reads what arrived while it was not
//! running. The re-entry is what the double-call dance below is for: on the
//! rewind the same call site is reached a second time, and it must stop the
//! rewind rather than issue the request again.

use std::alloc::{alloc, Layout};

#[cfg(feature = "async")]
use std::sync::atomic::{AtomicI32, Ordering};

// --- Imports ---------------------------------------------------------------

#[allow(non_snake_case)]
#[link(wasm_import_module = "simple")]
unsafe extern "C" {
    /// Ask the host to run an action and answer.
    unsafe fn __call(
        name_ptr: i32,
        name_len: i32,
        params_ptr: i32,
        params_len: i32,
        context_ptr: i32,
        context_len: i32,
    );

    /// Ask the host to run an action and do not wait. `__done__` travels here.
    unsafe fn __cast(
        name_ptr: i32,
        name_len: i32,
        params_ptr: i32,
        params_len: i32,
        context_ptr: i32,
        context_len: i32,
    );

    /// Write the initial request payload into guest memory at `ptr`.
    unsafe fn __getContext(ptr: i32);

    /// How many bytes that payload takes.
    unsafe fn __getContextSize() -> i32;
}

// The pair the synchronous build declares. See the module docs.
#[cfg(not(feature = "async"))]
#[allow(non_snake_case)]
#[link(wasm_import_module = "simple")]
unsafe extern "C" {
    /// Write the pending reply into guest memory at `ptr`.
    unsafe fn __getExecutionResult(ptr: i32);

    /// How many bytes that reply takes.
    unsafe fn __getExecutionResultSize() -> i32;
}

// The asyncify controls, added to the module by `wasm-opt` and wired back to
// it by the host. Only the two the resume path needs are declared.
#[cfg(feature = "async")]
#[link(wasm_import_module = "env")]
unsafe extern "C" {
    /// 0 normal, 1 unwinding, 2 rewinding.
    unsafe fn asyncify_get_state() -> i32;

    /// Leave the rewind and carry on from here.
    unsafe fn asyncify_stop_rewind();
}

/// The state `asyncify_get_state` reports while a guest is being resumed.
#[cfg(feature = "async")]
const REWINDING: i32 = 2;

// --- Exports ---------------------------------------------------------------

/// Where the host says it put the reply, set by [`set_response_buffer`].
#[cfg(feature = "async")]
static RESPONSE_PTR: AtomicI32 = AtomicI32::new(0);

/// How long that reply is.
#[cfg(feature = "async")]
static RESPONSE_LEN: AtomicI32 = AtomicI32::new(0);

/// Give the host a region of guest memory to write into.
///
/// The host calls this itself, before resuming a parked module. Nothing frees
/// the region: an action runs once and the whole linear memory goes with it, so
/// a free list would cost bytes in every module to reclaim memory that is about
/// to be discarded anyway.
///
/// Answers with a null pointer when the request cannot be served, so the host
/// always gets an answer it can read and act on.
#[no_mangle]
pub extern "C" fn allocate_buffer(size: usize) -> *mut u8 {
    if size == 0 {
        return std::ptr::null_mut();
    }

    match Layout::from_size_align(size, 1) {
        // SAFETY: the layout is non-zero-sized, which is what `alloc` requires.
        // A null answer is the documented failure and is handed straight back.
        Ok(layout) => unsafe { alloc(layout) },
        Err(_unrepresentable) => std::ptr::null_mut(),
    }
}

/// Tell the guest where the reply to its parked call is.
#[cfg(feature = "async")]
#[no_mangle]
pub extern "C" fn set_response_buffer(ptr: i32, len: i32) {
    RESPONSE_PTR.store(ptr, Ordering::Relaxed);
    RESPONSE_LEN.store(len, Ordering::Relaxed);
}

// --- What the rest of the crate uses ---------------------------------------

/// Ask the host for the initial request payload.
///
/// The host hands it over once and forgets it, so this is called once, by
/// [`crate::run`].
pub(crate) fn context() -> Option<String> {
    // SAFETY: no arguments, no memory, and the host answers with a length.
    let size = unsafe { __getContextSize() };

    if size <= 0 {
        return None;
    }

    let mut buffer = vec![0_u8; size as usize];

    // SAFETY: the buffer is exactly the length the host just asked for and is
    // owned here for the whole call, so the host writes inside it and nowhere
    // else.
    unsafe { __getContext(buffer.as_mut_ptr() as i32) };

    String::from_utf8(buffer).ok()
}

/// Ask the host to run an action, and wait for what it answers.
///
/// Under asyncify the wait is a suspension: the second arrival at this call
/// site is the resume, and it must stop the rewind rather than ask again.
pub(crate) fn call(name: &str, params: &str) -> Option<String> {
    #[cfg(feature = "async")]
    {
        // SAFETY: no arguments and no memory. The host binds this to the
        // function `wasm-opt` added to this module.
        if unsafe { asyncify_get_state() } == REWINDING {
            // SAFETY: reached only while rewinding, which is the one state in
            // which stopping a rewind is defined.
            unsafe { asyncify_stop_rewind() };
        } else {
            request(name, params, true);
        }
    }

    #[cfg(not(feature = "async"))]
    request(name, params, true);

    reply()
}

/// Ask the host to run an action and do not wait.
pub(crate) fn cast(name: &str, params: &str) {
    request(name, params, false);
}

/// Hand the host a name and a payload.
///
/// The context arguments are sent as zero: the host assembles the execution
/// context for every call itself, so there is nothing here to supply. The import
/// signature keeps all six arguments, so the module binds as it always has.
fn request(name: &str, params: &str, expects_reply: bool) {
    let name_bytes = name.as_bytes();
    let params_bytes = params.as_bytes();

    // SAFETY: both slices are borrowed for the whole of the call below and are
    // owned by the caller, so the addresses stay valid while the host reads
    // them. The lengths are the slices' own.
    unsafe {
        if expects_reply {
            __call(
                name_bytes.as_ptr() as i32,
                name_bytes.len() as i32,
                params_bytes.as_ptr() as i32,
                params_bytes.len() as i32,
                0,
                0,
            );
        } else {
            __cast(
                name_bytes.as_ptr() as i32,
                name_bytes.len() as i32,
                params_bytes.as_ptr() as i32,
                params_bytes.len() as i32,
                0,
                0,
            );
        }
    }
}

/// The reply to a synchronous call, asked for from the host.
#[cfg(not(feature = "async"))]
fn reply() -> Option<String> {
    // SAFETY: no arguments, no memory, and the host answers with a length.
    let size = unsafe { __getExecutionResultSize() };

    if size <= 0 {
        return None;
    }

    let mut buffer = vec![0_u8; size as usize];

    // SAFETY: the buffer is exactly the length the host just asked for and is
    // owned here for the whole call.
    unsafe { __getExecutionResult(buffer.as_mut_ptr() as i32) };

    String::from_utf8(buffer).ok()
}

/// The reply to a parked call, wherever the host said it put it.
///
/// The region is forgotten here rather than by the caller, so a stale one cannot
/// be read twice and there is nothing for an action to clear or to forget to
/// clear.
#[cfg(feature = "async")]
fn reply() -> Option<String> {
    let ptr = RESPONSE_PTR.swap(0, Ordering::Relaxed);
    let len = RESPONSE_LEN.swap(0, Ordering::Relaxed);

    if ptr == 0 || len <= 0 {
        return None;
    }

    // SAFETY: the region was allocated by `allocate_buffer` in this module's own
    // memory, is never freed, and the host reported its address and length
    // together before resuming. It is copied out immediately.
    let bytes = unsafe { std::slice::from_raw_parts(ptr as *const u8, len as usize) };

    String::from_utf8(bytes.to_vec()).ok()
}
