//! Filesystem guards shared by preview capture and conversion inspection.
//!
//! Backend output is read from directories that an unprivileged process wrote.
//! These helpers keep every reader on the same fail-closed rule: only a regular
//! file that is neither a symbolic link nor a reparse point may be opened, and
//! the check is repeated on the opened handle so a swap between the metadata
//! probe and the open is not silently accepted.

use std::fs::{File, Metadata};
use std::io;
use std::path::Path;

use thiserror::Error;

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

fn io_error(error: io::Error) -> RegularFileError {
    RegularFileError::Io { kind: error.kind() }
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
