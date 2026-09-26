//! Where the UI preference record lives, and how it is replaced.
//!
//! ## Path policy
//!
//! One fixed per-user application-local directory, resolved through Tauri's own
//! path resolver, and one fixed file name inside it. Neither is chosen by the
//! webview, and neither is derived from anything the webview sends: the renderer
//! has no way to name a directory, a file, a key or a prefix, so there is no
//! path for it to point somewhere else.
//!
//! Application-local rather than roaming, because this is machine-local
//! interface state: a density that suits one display is not a setting to carry
//! onto another machine. Deliberately not the executable's directory, the
//! checkout, the process working directory, an acquisition folder or anywhere a
//! renderer could reach -- a per-user directory the installer does not own is
//! the one place a standard user can always write and where nothing else of the
//! product's lives.
//!
//! ## Replacement
//!
//! Through [`crate::local_document`], which owns the bounded read and the
//! same-directory private-sibling replacement this store was built with and
//! which the project store now shares. What stays here is the part that is
//! about preferences: where the file is, what bound it is read under, what
//! prefix its temporaries carry, and how the mechanism's refusals read in this
//! store's own vocabulary.

use std::path::PathBuf;

use crate::local_document::{self, PublishFailure, ReadRefusal, WriteRefusal};

use super::record::{MAX_RECORD_BYTES, RecordProblem, UiPreferences, read_record, write_record};

/// The fixed file name. One record, one name, in every build.
const PREFERENCE_FILE_NAME: &str = "ui-preferences.json";

/// The prefix every private sibling this writer creates carries.
///
/// Named so that a residue left by a failed write is recognisable as this
/// application's and as temporary, and so that it can never collide with the
/// published name.
const TEMPORARY_PREFIX: &str = ".mscanvas-ui-preferences-";

/// The directory this store owns, and the one file inside it.
///
/// Constructed from a resolved directory rather than from a string the caller
/// assembled, so there is one place that decides where preferences live.
#[derive(Debug, Clone)]
pub struct PreferenceRoot {
    directory: PathBuf,
}

impl PreferenceRoot {
    /// Binds a resolved per-user directory as this session's preference root.
    #[must_use]
    pub fn new(directory: PathBuf) -> Self {
        Self { directory }
    }

    /// The published record's full path.
    ///
    /// Private, and there is deliberately no accessor for the directory either:
    /// nothing outside this module needs the location, and a getter is how an
    /// absolute path ends up in a message, a log or a transfer object.
    fn file(&self) -> PathBuf {
        self.directory.join(PREFERENCE_FILE_NAME)
    }
}

/// What reading the stored record found.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StoredRecord {
    /// Nothing is stored. An ordinary first run.
    Absent,
    /// A record this build accepts, whole.
    Usable(UiPreferences),
    /// Something is stored and this build will not use it. The bytes are
    /// untouched, and stay untouched until a user confirms replacing them.
    Unusable(RecordProblem),
}

/// Why a publish did not happen, and whether it left a residue.
///
/// The two are reported together for the same reason the conversion writer
/// reports them together: "your preferences were not saved" and "your
/// preferences were not saved and there is now a file in your profile that
/// MSCanvas could not remove" are different things to be told.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WriteFailure {
    pub error: WriteError,
    pub temporary_left_behind: bool,
}

impl WriteFailure {
    const fn of(error: WriteError) -> Self {
        Self {
            error,
            temporary_left_behind: false,
        }
    }
}

/// The enumerated ways a publish can fail.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteError {
    /// The per-user directory could not be created or opened.
    DirectoryUnusable,
    /// The published name is currently something this build does not own -- a
    /// link, a reparse point, a directory or a device. Nothing is replaced.
    UnsafeTarget,
    /// No private sibling could be created, or its bytes could not be written.
    /// The published record, if there was one, is untouched.
    NotWritten,
    /// The bytes were written and could not take the published name. The
    /// published record, if there was one, is untouched.
    NotPublished,
    /// The record serialized to more than the stored bound. Unreachable for the
    /// closed record this store holds, and refused rather than published.
    Oversized,
}

impl WriteError {
    /// The stable wire identifier. Owned, enumerated, and never a message.
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::DirectoryUnusable => "directoryUnusable",
            Self::UnsafeTarget => "unsafeTarget",
            Self::NotWritten => "notWritten",
            Self::NotPublished => "notPublished",
            Self::Oversized => "oversized",
        }
    }

    /// Whether trying the same save again could reasonably succeed.
    ///
    /// A locked or refused file often frees up; a published name that is a
    /// directory will still be one on the next press, and offering Retry for it
    /// would be an invitation to press a button that cannot work.
    #[must_use]
    pub const fn retryable(self) -> bool {
        match self {
            Self::DirectoryUnusable | Self::NotWritten | Self::NotPublished => true,
            Self::UnsafeTarget | Self::Oversized => false,
        }
    }
}

/// How the shared mechanism's refusals read in this store's vocabulary.
const fn from_write_refusal(failure: PublishFailure) -> WriteFailure {
    WriteFailure {
        error: match failure.refusal {
            WriteRefusal::UnsafeTarget => WriteError::UnsafeTarget,
            WriteRefusal::NotWritten => WriteError::NotWritten,
            WriteRefusal::NotPublished => WriteError::NotPublished,
        },
        temporary_left_behind: failure.temporary_left_behind,
    }
}

/// The same, for a read. `Oversized` keeps its own name here because the
/// interface says something different about it than about an unreadable file.
const fn from_read_refusal(refusal: ReadRefusal) -> RecordProblem {
    match refusal {
        ReadRefusal::Unreadable => RecordProblem::Unreadable,
        ReadRefusal::Oversized => RecordProblem::Oversized,
        ReadRefusal::UnsafeTarget => RecordProblem::UnsafeTarget,
    }
}

/// Reads the stored record, or says why it cannot be used.
///
/// Every outcome leaves the file as it was found. Size is judged before any
/// bytes are parsed, and the read itself is bounded, so an oversized or
/// truncated-then-grown file cannot become an unbounded read.
#[must_use]
pub fn read(root: &PreferenceRoot) -> StoredRecord {
    match local_document::read_bounded(&root.file(), MAX_RECORD_BYTES) {
        Ok(None) => StoredRecord::Absent,
        Ok(Some(bytes)) => match read_record(&bytes) {
            Ok(record) => StoredRecord::Usable(record),
            Err(problem) => StoredRecord::Unusable(problem),
        },
        Err(refusal) => StoredRecord::Unusable(from_read_refusal(refusal)),
    }
}

/// Publishes one validated record over whatever is stored.
///
/// # Errors
///
/// Answers the first thing that went wrong and whether a private sibling was
/// left behind. On every failing path the published name still holds the record
/// it held before, because nothing removes or truncates it: the replace either
/// takes the name or does not happen.
pub fn publish(root: &PreferenceRoot, record: &UiPreferences) -> Result<(), WriteFailure> {
    let bytes = write_record(record).ok_or(WriteFailure::of(WriteError::NotWritten))?;
    if bytes.len() as u64 > MAX_RECORD_BYTES {
        return Err(WriteFailure::of(WriteError::Oversized));
    }
    std::fs::create_dir_all(&root.directory)
        .map_err(|_| WriteFailure::of(WriteError::DirectoryUnusable))?;
    // The published name is judged before anything is created, inside the
    // shared mechanism: a name that is a link, a directory or a device is not
    // this build's record, and taking it would be writing somewhere nobody
    // chose.
    local_document::publish_through_temporary(
        &root.directory,
        &root.file(),
        &bytes,
        TEMPORARY_PREFIX,
    )
    .map_err(from_write_refusal)
}
