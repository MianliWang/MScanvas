//! Filesystem guards shared by preview capture and conversion inspection.
//!
//! Backend output is read from directories that an unprivileged process wrote.
//! These helpers keep every reader on the same fail-closed rule: only a regular
//! file that is neither a symbolic link nor a reparse point may be opened, and
//! the check is repeated on the opened handle so a swap between the metadata
//! probe and the open is not silently accepted.

use std::ffi::{OsStr, OsString};
use std::fmt;
use std::fs::{File, Metadata};
use std::io;
use std::path::Path;
use std::time::SystemTime;

use thiserror::Error;

/// Suffixes a backend uses while an output file is still being written.
const PARTIAL_OUTPUT_SUFFIXES: [&str; 3] = [".part", ".partial", ".tmp"];

/// Why a path was refused as a readable regular file. No variant contains a
/// path or backend text.
#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum RegularFileError {
    #[error("the path is not a regular file")]
    NotRegularFile,
    #[error("the path is a symbolic link")]
    Symlink,
    #[error("the path is a reparse point")]
    ReparsePoint,
    #[error("the path changed between inspection and open")]
    ChangedDuringOpen,
    #[error("the path could not be inspected: {kind}")]
    Io { kind: io::ErrorKind },
}

impl RegularFileError {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::NotRegularFile => "not_regular_file",
            Self::Symlink => "symlink",
            Self::ReparsePoint => "reparse_point",
            Self::ChangedDuringOpen => "changed_during_open",
            Self::Io { .. } => "io_error",
        }
    }
}

/// Whether the entry carries the Windows reparse-point attribute.
///
/// Other platforms have no equivalent attribute, so the answer is always
/// `false` there and symbolic links are rejected by the file-type check.
#[cfg(windows)]
#[must_use]
pub fn is_reparse_point(metadata: &Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;

    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

/// Whether the entry carries the Windows reparse-point attribute.
#[cfg(not(windows))]
#[must_use]
pub const fn is_reparse_point(_metadata: &Metadata) -> bool {
    false
}

/// Rejects any entry that is not a plain regular file.
pub(crate) fn require_regular_file(metadata: &Metadata) -> Result<(), RegularFileError> {
    if metadata.file_type().is_symlink() {
        return Err(RegularFileError::Symlink);
    }
    if is_reparse_point(metadata) {
        return Err(RegularFileError::ReparsePoint);
    }
    if !metadata.is_file() {
        return Err(RegularFileError::NotRegularFile);
    }
    Ok(())
}

/// Opens a regular, non-symlink, non-reparse-point file for reading.
///
/// The link-following metadata of the opened handle is checked again so a path
/// replaced between the two observations is refused instead of read.
pub(crate) fn open_regular_file(path: &Path) -> Result<(File, u64), RegularFileError> {
    let observed = std::fs::symlink_metadata(path).map_err(io_error)?;
    require_regular_file(&observed)?;

    let file = File::open(path).map_err(io_error)?;
    let opened = file.metadata().map_err(io_error)?;
    if !opened.is_file() {
        return Err(RegularFileError::ChangedDuringOpen);
    }
    if opened.len() != observed.len() {
        return Err(RegularFileError::ChangedDuringOpen);
    }
    Ok((file, opened.len()))
}

/// Opens a regular file for reading *and* for renaming the object itself.
///
/// The extra access is what lets a caller finalize the exact object it read
/// instead of whatever a later path lookup resolves to. The posture is
/// otherwise unchanged and deliberately no weaker: the entry is refused if it is
/// a link, a reparse point or a directory, the open refuses to traverse a
/// reparse point rather than following one, and the opened handle is rechecked
/// against what was observed.
#[cfg(windows)]
pub(crate) fn open_regular_file_renameable(path: &Path) -> Result<(File, u64), RegularFileError> {
    use std::os::windows::fs::OpenOptionsExt;

    const FILE_READ_DATA: u32 = 0x0000_0001;
    const FILE_READ_ATTRIBUTES: u32 = 0x0000_0080;
    const DELETE: u32 = 0x0001_0000;
    const SYNCHRONIZE: u32 = 0x0010_0000;
    const FILE_SHARE_READ: u32 = 0x0000_0001;
    const FILE_SHARE_WRITE: u32 = 0x0000_0002;
    const FILE_SHARE_DELETE: u32 = 0x0000_0004;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;

    let observed = std::fs::symlink_metadata(path).map_err(io_error)?;
    require_regular_file(&observed)?;

    // DELETE is the access a handle-relative rename requires; it does not
    // authorize a read the ordinary open would have refused. Opening the
    // reparse point rather than following it means a link substituted at this
    // name is refused below instead of silently read through.
    let file = std::fs::OpenOptions::new()
        .read(true)
        .access_mode(FILE_READ_DATA | FILE_READ_ATTRIBUTES | SYNCHRONIZE | DELETE)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(io_error)?;
    let opened = file.metadata().map_err(io_error)?;
    require_regular_file(&opened)?;
    if opened.len() != observed.len() {
        return Err(RegularFileError::ChangedDuringOpen);
    }
    Ok((file, opened.len()))
}

/// Opens a regular file for reading. No platform outside Windows offers a
/// rename bound to the opened object through the standard library, so this is
/// the ordinary open and the guarantee built on it is correspondingly narrower.
#[cfg(not(windows))]
pub(crate) fn open_regular_file_renameable(path: &Path) -> Result<(File, u64), RegularFileError> {
    open_regular_file(path)
}

fn io_error(error: io::Error) -> RegularFileError {
    RegularFileError::Io { kind: error.kind() }
}

/// What one observed output-directory entry is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum OutputEntryKind {
    RegularFile,
    Directory,
    Symlink,
    ReparsePoint,
    Other,
}

impl OutputEntryKind {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::RegularFile => "regular_file",
            Self::Directory => "directory",
            Self::Symlink => "symlink",
            Self::ReparsePoint => "reparse_point",
            Self::Other => "other",
        }
    }

    fn classify(metadata: &Metadata) -> Self {
        if metadata.file_type().is_symlink() {
            Self::Symlink
        } else if is_reparse_point(metadata) {
            Self::ReparsePoint
        } else if metadata.is_dir() {
            Self::Directory
        } else if metadata.is_file() {
            Self::RegularFile
        } else {
            Self::Other
        }
    }
}

/// One observed output-directory entry.
///
/// The entry name is derived from a source acquisition name and is therefore
/// sensitive. It is never exposed directly and never reaches a debug
/// projection; callers compare it through predicates instead.
#[derive(Clone, PartialEq, Eq)]
pub struct OutputDirectoryEntry {
    name: OsString,
    kind: OutputEntryKind,
    byte_length: u64,
    modified: Option<SystemTime>,
}

impl fmt::Debug for OutputDirectoryEntry {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("OutputDirectoryEntry")
            .field("name", &"<opaque-sensitive>")
            .field("name_byte_count", &self.name.as_encoded_bytes().len())
            .field("kind", &self.kind)
            .field("byte_length", &self.byte_length)
            .field("modified_observed", &self.modified.is_some())
            .finish()
    }
}

impl OutputDirectoryEntry {
    #[must_use]
    pub const fn kind(&self) -> OutputEntryKind {
        self.kind
    }

    #[must_use]
    pub const fn byte_length(&self) -> u64 {
        self.byte_length
    }

    /// Whether the entry name is exactly the expected one.
    #[must_use]
    pub fn has_name(&self, expected: &OsStr) -> bool {
        self.name == expected
    }

    /// Whether the entry carries an extension equal to `expected`, ignoring
    /// ASCII case.
    #[must_use]
    pub fn has_extension(&self, expected: &str) -> bool {
        Path::new(&self.name).extension().is_some_and(|extension| {
            extension
                .as_encoded_bytes()
                .eq_ignore_ascii_case(expected.as_bytes())
        })
    }

    /// Opens this entry inside `directory` under the regular-file guard.
    ///
    /// Callers read an entry without ever holding its name, so an output name
    /// derived from a source acquisition cannot leak into a diagnostic.
    pub fn open_in(&self, directory: &Path) -> Result<(File, u64), RegularFileError> {
        open_regular_file(&directory.join(&self.name))
    }

    /// Whether the entry name ends with a suffix a backend uses for output it
    /// has not finished writing.
    #[must_use]
    pub fn has_partial_suffix(&self) -> bool {
        let name = self.name.as_encoded_bytes();
        PARTIAL_OUTPUT_SUFFIXES.iter().any(|suffix| {
            name.len() >= suffix.len()
                && name[name.len() - suffix.len()..].eq_ignore_ascii_case(suffix.as_bytes())
        })
    }
}

/// An ordered snapshot of one output directory.
///
/// Equality between two snapshots is what distinguishes an untouched directory
/// from one a failed backend wrote into.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct OutputDirectorySnapshot {
    entries: Vec<OutputDirectoryEntry>,
}

impl OutputDirectorySnapshot {
    #[must_use]
    pub fn entries(&self) -> &[OutputDirectoryEntry] {
        &self.entries
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    /// Whether any entry looks like output the backend never finished writing.
    #[must_use]
    pub fn contains_partial_output(&self) -> bool {
        self.entries
            .iter()
            .any(OutputDirectoryEntry::has_partial_suffix)
    }
}

/// Records every entry of an output directory in a stable name order.
pub fn snapshot_output_directory(
    directory: &Path,
) -> Result<OutputDirectorySnapshot, RegularFileError> {
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(directory).map_err(io_error)? {
        let entry = entry.map_err(io_error)?;
        let metadata = std::fs::symlink_metadata(entry.path()).map_err(io_error)?;
        entries.push(OutputDirectoryEntry {
            name: entry.file_name(),
            kind: OutputEntryKind::classify(&metadata),
            byte_length: metadata.len(),
            modified: metadata.modified().ok(),
        });
    }
    entries.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(OutputDirectorySnapshot { entries })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stable_ids_are_distinct_and_path_free() {
        let ids = [
            RegularFileError::NotRegularFile.stable_id(),
            RegularFileError::Symlink.stable_id(),
            RegularFileError::ReparsePoint.stable_id(),
            RegularFileError::ChangedDuringOpen.stable_id(),
            RegularFileError::Io {
                kind: io::ErrorKind::PermissionDenied,
            }
            .stable_id(),
        ];
        let unique = ids.iter().collect::<std::collections::BTreeSet<_>>();
        assert_eq!(unique.len(), ids.len());

        let rendered = format!(
            "{:?}",
            RegularFileError::Io {
                kind: io::ErrorKind::NotFound
            }
        );
        assert!(!rendered.contains('/') && !rendered.contains('\\'));
    }

    #[test]
    fn a_directory_is_not_a_regular_file() {
        let directory = std::env::current_dir().expect("test current directory");
        let metadata = std::fs::symlink_metadata(&directory).expect("directory metadata");

        assert_eq!(
            require_regular_file(&metadata),
            Err(RegularFileError::NotRegularFile)
        );
        assert_eq!(
            open_regular_file(&directory).err(),
            Some(RegularFileError::NotRegularFile)
        );
    }

    #[test]
    fn a_missing_path_reports_a_bounded_io_kind() {
        let missing = std::env::current_dir()
            .expect("test current directory")
            .join("mscanvas-fs-guard-missing-path.invalid");

        assert_eq!(
            open_regular_file(&missing).err(),
            Some(RegularFileError::Io {
                kind: io::ErrorKind::NotFound
            })
        );
    }
}
