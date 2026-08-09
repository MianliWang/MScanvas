//! Creating one small file MSCanvas made, in a folder the user chose.
//!
//! Finalization already knows how to give an object a name without replacing
//! anything, and cleanup already knows how to remove an object a handle names.
//! What did not exist is the other half: making the object in the first place.
//! Every writer in this crate until now moved a file `msconvert` had produced,
//! so "write these bytes there" had no implementation and no guarantees.
//!
//! It is the same shape as finalization and for the same reasons. Nothing is
//! ever written to the name the user chose: a private sibling is created
//! exclusively, filled, forced to disk, and only then *renamed* — by handle, so
//! the object that is published is the object that was written, and without
//! replacement, so a name that is already taken is a refusal rather than a loss.
//! A failure anywhere removes the sibling through the handle that made it.
//!
//! The two things this refuses are the two it can decide from here: a parent
//! that is not a directory, and a name that is not one plain component. Whether
//! the parent is somewhere these guarantees hold at all — a local volume rather
//! than a redirector, a directory rather than a link to one — is admission's
//! question and is answered before this is called.

use std::ffi::OsStr;
use std::fs::File;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

#[cfg(windows)]
use super::cleanup;
use super::finalize;

/// How many distinct temporary names are tried before giving up.
///
/// A name carries the process id and a nanosecond reading, so a collision means
/// two exports of one process inside one clock tick. Retrying a few times costs
/// nothing; retrying forever would turn a directory nothing can be created in
/// into a loop.
const MAX_TEMPORARY_NAME_ATTEMPTS: u32 = 8;

/// Why one small file could not be written.
///
/// Closed and path-free, and every member is a different thing to tell the
/// person who asked. `TargetExists` in particular is not an error about the
/// filesystem: it is the no-clobber rule doing its job, and the recovery is to
/// choose another name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocalFileWriteError {
    /// The name is not one ordinary path component.
    UnsafeName,
    /// The parent could not be opened, or is not a directory.
    ParentNotUsable { kind: io::ErrorKind },
    /// No private sibling could be created to write into.
    TemporaryNotCreated { kind: io::ErrorKind },
    /// The bytes could not be written to the sibling.
    NotWritten { kind: io::ErrorKind },
    /// The bytes were written and could not be forced to the device.
    NotFlushed { kind: io::ErrorKind },
    /// Something already answers to the chosen name. Nothing was replaced.
    TargetExists,
    /// The sibling was written and could not be given the chosen name.
    NotFinalized { kind: io::ErrorKind },
}

impl LocalFileWriteError {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::UnsafeName => "artifact_unsafe_name",
            Self::ParentNotUsable { .. } => "artifact_parent_not_usable",
            Self::TemporaryNotCreated { .. } => "artifact_temporary_not_created",
            Self::NotWritten { .. } => "artifact_not_written",
            Self::NotFlushed { .. } => "artifact_not_flushed",
            Self::TargetExists => "artifact_target_exists",
            Self::NotFinalized { .. } => "artifact_not_finalized",
        }
    }
}

/// One failed write, and what it left behind.
///
/// The two are reported together and never collapsed. "This could not be
/// written" and "this could not be written and there is now a file in your
/// folder that MSCanvas cannot remove" are different things to be told, and
/// folding the second into the first would hide the only part of a failure the
/// user has to act on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LocalFileWriteFailure {
    error: LocalFileWriteError,
    temporary_left_behind: bool,
}

impl LocalFileWriteFailure {
    #[must_use]
    pub const fn error(self) -> LocalFileWriteError {
        self.error
    }

    /// Whether the private sibling could not be removed after the failure.
    ///
    /// False for every failure that happened before one existed, which is most
    /// of them.
    #[must_use]
    pub const fn temporary_left_behind(self) -> bool {
        self.temporary_left_behind
    }

    const fn of(error: LocalFileWriteError) -> Self {
        Self {
            error,
            temporary_left_behind: false,
        }
    }
}

/// Writes `bytes` into `directory` under `file_name`, replacing nothing.
///
/// # Errors
///
/// Answers with the first thing that went wrong, and with whether a private
/// temporary object was left behind. On every failing path the chosen name is
/// untouched: either it was never reached, or the rename that would have taken
/// it is the thing that failed.
pub fn write_new_local_file(
    directory: &Path,
    file_name: &OsStr,
    bytes: &[u8],
) -> Result<(), LocalFileWriteFailure> {
    let file_name = finalize::single_component(file_name)
        .map_err(|_| LocalFileWriteFailure::of(LocalFileWriteError::UnsafeName))?;
    // Pinned for the whole write. The target name is formed against this
    // directory's path afterwards, and a directory that could be renamed away in
    // between would leave the rename naming somewhere nobody chose.
    let parent = finalize::DestinationDirectory::open(directory).map_err(|error| {
        LocalFileWriteFailure::of(LocalFileWriteError::ParentNotUsable { kind: error.kind() })
    })?;
    write_through_temporary(&parent, directory, file_name, bytes)
}

#[cfg(windows)]
fn write_through_temporary(
    _parent: &finalize::DestinationDirectory,
    directory: &Path,
    file_name: &OsStr,
    bytes: &[u8],
) -> Result<(), LocalFileWriteFailure> {
    let (mut temporary, _temporary_path) = create_private_sibling(directory)?;
    if let Err(error) = fill(&mut temporary, bytes) {
        return Err(discard(temporary, error));
    }
    // By handle. The temporary name may already mean something else by now and
    // it does not matter: the kernel renames the object this handle holds, which
    // is the object the bytes went into.
    match finalize::rename_object_to(&temporary, &directory.join(file_name)) {
        Ok(()) => {
            // The handle now names the published file. Dropping it publishes
            // nothing further and withholds nothing further.
            drop(temporary);
            Ok(())
        }
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            Err(discard(temporary, LocalFileWriteError::TargetExists))
        }
        Err(error) => Err(discard(
            temporary,
            LocalFileWriteError::NotFinalized { kind: error.kind() },
        )),
    }
}

/// The standard library offers no rename bound to an open object and no
/// no-clobber rename outside Windows. A hard link fails when the target exists,
/// so the no-clobber rule holds; the link is made from the temporary *name*, so
/// this platform does not carry the object-bound guarantee and does not claim
/// it. Finalization draws exactly this line for exactly this reason.
///
/// It is weaker in one further way that is stated rather than hidden: a link
/// that succeeded and a sibling that could not then be unlinked is answered as
/// the success it is, because the file the caller asked for exists. Windows
/// reports that residue because its removal goes through the handle that made
/// the object and can be told apart from every other outcome; here it cannot.
#[cfg(not(windows))]
fn write_through_temporary(
    _parent: &finalize::DestinationDirectory,
    directory: &Path,
    file_name: &OsStr,
    bytes: &[u8],
) -> Result<(), LocalFileWriteFailure> {
    let (mut temporary, temporary_path) = create_private_sibling(directory)?;
    if let Err(error) = fill(&mut temporary, bytes) {
        drop(temporary);
        return Err(unlink(&temporary_path, error));
    }
    drop(temporary);
    let error = match std::fs::hard_link(&temporary_path, directory.join(file_name)) {
        Ok(()) => {
            let _ = std::fs::remove_file(&temporary_path);
            return Ok(());
        }
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            LocalFileWriteError::TargetExists
        }
        Err(error) => LocalFileWriteError::NotFinalized { kind: error.kind() },
    };
    Err(unlink(&temporary_path, error))
}

/// Creates one private sibling nothing else may write, delete or replace.
///
/// `create_new` is what makes it private: the object is this call's or the call
/// fails. `DELETE` is taken up front so the sibling can be removed through this
/// exact handle after a failure, without reopening a name that may by then mean
/// something else, and a reparse point is refused rather than followed.
#[cfg(windows)]
fn create_private_sibling(directory: &Path) -> Result<(File, PathBuf), LocalFileWriteFailure> {
    use std::os::windows::fs::OpenOptionsExt as _;

    const FILE_GENERIC_READ: u32 = 0x0012_0089;
    const FILE_GENERIC_WRITE: u32 = 0x0012_0116;
    const DELETE: u32 = 0x0001_0000;
    /// Readers are welcome; writers and deleters are not, for as long as this
    /// object is being filled.
    const FILE_SHARE_READ: u32 = 0x0000_0001;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;

    let mut last = io::ErrorKind::AlreadyExists;
    for attempt in 0..MAX_TEMPORARY_NAME_ATTEMPTS {
        let candidate = directory.join(temporary_name(attempt));
        match std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .access_mode(FILE_GENERIC_READ | FILE_GENERIC_WRITE | DELETE)
            .share_mode(FILE_SHARE_READ)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
            .open(&candidate)
        {
            Ok(file) => return Ok((file, candidate)),
            Err(error) => {
                last = error.kind();
                if last != io::ErrorKind::AlreadyExists {
                    break;
                }
            }
        }
    }
    Err(LocalFileWriteFailure::of(
        LocalFileWriteError::TemporaryNotCreated { kind: last },
    ))
}

#[cfg(not(windows))]
fn create_private_sibling(directory: &Path) -> Result<(File, PathBuf), LocalFileWriteFailure> {
    let mut last = io::ErrorKind::AlreadyExists;
    for attempt in 0..MAX_TEMPORARY_NAME_ATTEMPTS {
        let candidate = directory.join(temporary_name(attempt));
        match std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(file) => return Ok((file, candidate)),
            Err(error) => {
                last = error.kind();
                if last != io::ErrorKind::AlreadyExists {
                    break;
                }
            }
        }
    }
    Err(LocalFileWriteFailure::of(
        LocalFileWriteError::TemporaryNotCreated { kind: last },
    ))
}

/// A name nothing else in this folder is likely to hold, and that says whose it
/// is.
///
/// Leading dot and an explicit product prefix, so a sibling that does survive a
/// crash is recognisable as something MSCanvas left rather than a mystery.
fn temporary_name(attempt: u32) -> String {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |since| since.as_nanos());
    format!(
        ".mscanvas-export-{}-{unique}-{attempt}.tmp",
        std::process::id()
    )
}

/// Writes every byte and forces them to the device.
///
/// The sync is the point. Without it the rename can publish a name whose
/// contents are still in a cache, and a machine that loses power between the two
/// leaves a file this application says it wrote and that holds nothing.
fn fill(temporary: &mut File, bytes: &[u8]) -> Result<(), LocalFileWriteError> {
    temporary
        .write_all(bytes)
        .map_err(|error| LocalFileWriteError::NotWritten { kind: error.kind() })?;
    temporary
        .flush()
        .map_err(|error| LocalFileWriteError::NotFlushed { kind: error.kind() })?;
    temporary
        .sync_all()
        .map_err(|error| LocalFileWriteError::NotFlushed { kind: error.kind() })
}

/// Removes the sibling through the handle that made it, and says whether it
/// went.
#[cfg(windows)]
fn discard(temporary: File, error: LocalFileWriteError) -> LocalFileWriteFailure {
    let removed = cleanup::set_delete_disposition(&temporary).is_ok();
    // The name does not leave the directory until the last handle closes, so
    // this close is part of the removal rather than tidiness after it.
    drop(temporary);
    LocalFileWriteFailure {
        error,
        temporary_left_behind: !removed,
    }
}

#[cfg(not(windows))]
fn unlink(temporary: &Path, error: LocalFileWriteError) -> LocalFileWriteFailure {
    LocalFileWriteFailure {
        error,
        temporary_left_behind: std::fs::remove_file(temporary).is_err(),
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    fn scratch(label: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock after Unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "mscanvas-artifact-{label}-{}-{unique}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).expect("the scratch directory is created");
        root
    }

    /// The ordinary path: the bytes land under the chosen name and no sibling
    /// survives.
    #[test]
    fn a_new_file_is_created_and_leaves_no_temporary_behind() {
        let root = scratch("create");

        write_new_local_file(&root, OsStr::new("report.json"), b"{}\n")
            .expect("an ordinary local folder accepts a new file");

        assert_eq!(
            std::fs::read(root.join("report.json")).expect("the file is readable"),
            b"{}\n"
        );
        let entries: Vec<_> = std::fs::read_dir(&root)
            .expect("the folder lists")
            .map(|entry| entry.expect("an entry").file_name())
            .collect();
        assert_eq!(entries, vec![std::ffi::OsString::from("report.json")]);

        std::fs::remove_dir_all(&root).expect("the scratch directory is removed");
    }

    /// The no-clobber rule, and the whole of it: the existing bytes are the ones
    /// still there afterwards, and nothing new is left in the folder.
    #[test]
    fn an_occupied_name_is_refused_without_touching_it() {
        let root = scratch("occupied");
        let target = root.join("report.json");
        std::fs::write(&target, b"original").expect("the fixture is written");

        let failure = write_new_local_file(&root, OsStr::new("report.json"), b"replacement")
            .expect_err("an occupied name is refused");

        assert_eq!(failure.error(), LocalFileWriteError::TargetExists);
        assert!(!failure.temporary_left_behind());
        assert_eq!(
            std::fs::read(&target).expect("the fixture is readable"),
            b"original"
        );
        let entries: Vec<_> = std::fs::read_dir(&root)
            .expect("the folder lists")
            .map(|entry| entry.expect("an entry").file_name())
            .collect();
        assert_eq!(entries, vec![std::ffi::OsString::from("report.json")]);

        std::fs::remove_dir_all(&root).expect("the scratch directory is removed");
    }

    /// Only one plain component may become a name, so nothing can be steered out
    /// of the folder that was admitted.
    #[test]
    fn only_one_plain_name_may_be_created() {
        let root = scratch("names");

        for name in [
            r"..\escape.json",
            r"nested\report.json",
            "..",
            "",
            r"C:\absolute.json",
        ] {
            let failure = write_new_local_file(&root, OsStr::new(name), b"{}")
                .expect_err("only one plain component is a name");
            assert_eq!(failure.error(), LocalFileWriteError::UnsafeName, "{name}");
        }

        std::fs::remove_dir_all(&root).expect("the scratch directory is removed");
    }

    /// A parent that is not a directory is refused before anything is created.
    #[test]
    fn a_parent_that_is_not_a_directory_is_refused() {
        let root = scratch("parent");
        let file = root.join("not-a-folder");
        std::fs::write(&file, b"bytes").expect("the fixture is written");

        let failure = write_new_local_file(&file, OsStr::new("report.json"), b"{}")
            .expect_err("a file is not a parent");

        assert!(matches!(
            failure.error(),
            LocalFileWriteError::ParentNotUsable { .. }
        ));
        assert!(!failure.temporary_left_behind());

        std::fs::remove_dir_all(&root).expect("the scratch directory is removed");
    }

    /// Every refusal has its own identifier, and none of them is a path.
    #[test]
    fn stable_ids_are_distinct_and_path_free() {
        let ids = [
            LocalFileWriteError::UnsafeName.stable_id(),
            LocalFileWriteError::ParentNotUsable {
                kind: io::ErrorKind::NotFound,
            }
            .stable_id(),
            LocalFileWriteError::TemporaryNotCreated {
                kind: io::ErrorKind::PermissionDenied,
            }
            .stable_id(),
            LocalFileWriteError::NotWritten {
                kind: io::ErrorKind::WriteZero,
            }
            .stable_id(),
            LocalFileWriteError::NotFlushed {
                kind: io::ErrorKind::Other,
            }
            .stable_id(),
            LocalFileWriteError::TargetExists.stable_id(),
            LocalFileWriteError::NotFinalized {
                kind: io::ErrorKind::PermissionDenied,
            }
            .stable_id(),
        ];

        let mut unique: Vec<&str> = ids.to_vec();
        unique.sort_unstable();
        unique.dedup();
        assert_eq!(unique.len(), ids.len());
        for id in ids {
            assert!(
                !id.contains('\\') && !id.contains('/') && !id.contains(':'),
                "{id}"
            );
        }
    }
}
