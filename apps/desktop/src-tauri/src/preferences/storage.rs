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
//! A bounded private sibling in the same directory, filled, then given the
//! final name by handle with `ReplaceIfExists`. The old file is never deleted or
//! truncated first, so every failing path leaves the last confirmed record
//! exactly where it was. Only the temporary object this operation created is
//! cleaned up, and a cleanup that fails is reported rather than folded into the
//! write failure.
//!
//! What this does not claim is durability across a crash or a power loss. The
//! bytes are flushed and ordered before the replace, which is what makes the
//! published name mean either the old record or the new one and never a partial
//! file. It is not a claim that a machine losing power mid-replace comes back
//! with either.

use std::io;
use std::path::{Path, PathBuf};

use super::record::{MAX_RECORD_BYTES, RecordProblem, UiPreferences, read_record, write_record};

/// The fixed file name. One record, one name, in every build.
const PREFERENCE_FILE_NAME: &str = "ui-preferences.json";

/// The prefix every private sibling this writer creates carries.
///
/// Named so that a residue left by a failed write is recognisable as this
/// application's and as temporary, and so that it can never collide with the
/// published name.
const TEMPORARY_PREFIX: &str = ".mscanvas-ui-preferences-";

/// How many distinct private sibling names one publish will try.
///
/// A small bound rather than a retry loop. Each attempt uses `CREATE_NEW`, so a
/// collision means the name is taken; eight of them failing in a directory this
/// application owns is a fault to report, not a thing to keep trying.
const TEMPORARY_ATTEMPTS: u32 = 8;

/// FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE.
#[cfg(windows)]
const SHARE_ALL: u32 = 7;

/// FILE_FLAG_OPEN_REPARSE_POINT: open the link itself, never its target.
#[cfg(windows)]
const OPEN_REPARSE_POINT: u32 = 0x0020_0000;

/// FILE_ATTRIBUTE_REPARSE_POINT.
#[cfg(windows)]
const ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;

/// FILE_ATTRIBUTE_DIRECTORY.
#[cfg(windows)]
const ATTRIBUTE_DIRECTORY: u32 = 0x0000_0010;

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

/// Reads the stored record, or says why it cannot be used.
///
/// Every outcome leaves the file as it was found. Size is judged before any
/// bytes are parsed, and the read itself is bounded, so an oversized or
/// truncated-then-grown file cannot become an unbounded read.
#[must_use]
pub fn read(root: &PreferenceRoot) -> StoredRecord {
    match read_bytes(&root.file()) {
        Ok(None) => StoredRecord::Absent,
        Ok(Some(bytes)) => match read_record(&bytes) {
            Ok(record) => StoredRecord::Usable(record),
            Err(problem) => StoredRecord::Unusable(problem),
        },
        Err(problem) => StoredRecord::Unusable(problem),
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
    let target = root.file();
    // Judged before anything is created. A name that is a link, a directory or
    // a device is not this build's record, and taking it would be writing
    // somewhere nobody chose.
    if let Some(problem) = unsafe_published_name(&target) {
        return Err(WriteFailure::of(problem));
    }
    publish_through_temporary(&root.directory, &target, &bytes)
}

/// Whether the published name currently holds something this build does not
/// own.
///
/// `None` also covers "nothing is there", which is the ordinary first write.
fn unsafe_published_name(target: &Path) -> Option<WriteError> {
    match std::fs::symlink_metadata(target) {
        Ok(metadata) if !metadata.is_file() => Some(WriteError::UnsafeTarget),
        Ok(metadata) if is_reparse_point(&metadata) => Some(WriteError::UnsafeTarget),
        Ok(_) => None,
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        // Something is in the way and cannot be described. Refusing is the
        // honest answer; replacing what cannot be inspected is not.
        Err(_) => Some(WriteError::UnsafeTarget),
    }
}

#[cfg(windows)]
fn is_reparse_point(metadata: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt as _;
    metadata.file_attributes() & ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn is_reparse_point(metadata: &std::fs::Metadata) -> bool {
    metadata.file_type().is_symlink()
}

/// Reads the published file's bytes, bounded, without following a link.
///
/// `Ok(None)` is "nothing is stored", which is not a problem. Everything else
/// that is not a usable read is a [`RecordProblem`], because at this boundary
/// "there is a file and it cannot be read" and "the file is not JSON" are both
/// things the interface has to explain rather than crash on.
fn read_bytes(target: &Path) -> Result<Option<Vec<u8>>, RecordProblem> {
    let file = match open_for_read(target) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        // Classified only once opening has already failed, so the ordinary path
        // stays a single handle-based judgement. A name that cannot be opened at
        // all is either something this build does not own or a refusal, and
        // those are different things to tell a reader.
        Err(_) => return Err(unopenable_name(target)),
    };
    let metadata = file.metadata().map_err(|_| RecordProblem::Unreadable)?;
    // Asked of the open object rather than of the name. A check on the name
    // followed by an open is two different things being judged; this is one.
    if !is_ordinary_file(&metadata) {
        return Err(RecordProblem::UnsafeTarget);
    }
    if metadata.len() > MAX_RECORD_BYTES {
        return Err(RecordProblem::Oversized);
    }
    // Bounded again at the read, by one byte more than the limit. The length
    // above describes the file when it was opened, and a file that grew since
    // must be refused rather than read whole.
    let mut bytes = Vec::new();
    io::Read::read_to_end(&mut io::Read::take(&file, MAX_RECORD_BYTES + 1), &mut bytes)
        .map_err(|_| RecordProblem::Unreadable)?;
    if bytes.len() as u64 > MAX_RECORD_BYTES {
        return Err(RecordProblem::Oversized);
    }
    Ok(Some(bytes))
}

/// Why a name that exists could not be opened.
///
/// A directory, a link or a device at the published name is not this build's
/// record, whatever the open error happened to be; anything else that exists
/// and will not open is a refusal to report as one.
fn unopenable_name(target: &Path) -> RecordProblem {
    match std::fs::symlink_metadata(target) {
        Ok(metadata) if !metadata.is_file() || is_reparse_point(&metadata) => {
            RecordProblem::UnsafeTarget
        }
        _ => RecordProblem::Unreadable,
    }
}

/// Opens the stored record without traversing a link at its name.
///
/// `OPEN_REPARSE_POINT` opens the link itself where the name is one, which is
/// what lets the attribute check below refuse it. The flag is ignored for an
/// ordinary file, so the usual case pays nothing for it.
#[cfg(windows)]
fn open_for_read(target: &Path) -> io::Result<std::fs::File> {
    use std::os::windows::fs::OpenOptionsExt as _;
    std::fs::OpenOptions::new()
        .read(true)
        .share_mode(SHARE_ALL)
        .custom_flags(OPEN_REPARSE_POINT)
        .open(target)
}

#[cfg(not(windows))]
fn open_for_read(target: &Path) -> io::Result<std::fs::File> {
    std::fs::File::open(target)
}

#[cfg(windows)]
fn is_ordinary_file(metadata: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt as _;
    let attributes = metadata.file_attributes();
    attributes & (ATTRIBUTE_REPARSE_POINT | ATTRIBUTE_DIRECTORY) == 0
}

#[cfg(not(windows))]
fn is_ordinary_file(metadata: &std::fs::Metadata) -> bool {
    metadata.file_type().is_file()
}

/// Creates one private sibling, fills it, and gives it the published name.
fn publish_through_temporary(
    directory: &Path,
    target: &Path,
    bytes: &[u8],
) -> Result<(), WriteFailure> {
    let (mut temporary, temporary_path) = create_private_sibling(directory)?;
    if fill(&mut temporary, bytes).is_err() {
        return Err(discard(temporary, &temporary_path, WriteError::NotWritten));
    }
    match replace_with(&temporary, &temporary_path, target) {
        Ok(()) => {
            // The handle now names the published record. Dropping it publishes
            // nothing further and withholds nothing further.
            drop(temporary);
            Ok(())
        }
        Err(_) => Err(discard(
            temporary,
            &temporary_path,
            WriteError::NotPublished,
        )),
    }
}

/// The private sibling's name for one attempt.
fn temporary_name(attempt: u32) -> String {
    format!("{TEMPORARY_PREFIX}{}-{attempt}.tmp", std::process::id())
}

/// Opens one `CREATE_NEW` sibling under a name only this writer would choose.
///
/// `DELETE` access is not optional: a handle-bound rename is a rename *of this
/// object*, and the kernel will not perform one through a handle that could not
/// also remove it. Sharing is read-only for the object's whole lifetime, so
/// nothing can write into or delete the bytes between filling and publishing.
#[cfg(windows)]
fn create_private_sibling(directory: &Path) -> Result<(std::fs::File, PathBuf), WriteFailure> {
    use std::os::windows::fs::OpenOptionsExt as _;

    const FILE_GENERIC_READ: u32 = 0x0012_0089;
    const FILE_GENERIC_WRITE: u32 = 0x0012_0116;
    const DELETE: u32 = 0x0001_0000;
    const FILE_SHARE_READ: u32 = 0x0000_0001;

    for attempt in 0..TEMPORARY_ATTEMPTS {
        let path = directory.join(temporary_name(attempt));
        match std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .access_mode(FILE_GENERIC_READ | FILE_GENERIC_WRITE | DELETE)
            .share_mode(FILE_SHARE_READ)
            .custom_flags(OPEN_REPARSE_POINT)
            .open(&path)
        {
            Ok(file) => return Ok((file, path)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err(WriteFailure::of(WriteError::NotWritten)),
        }
    }
    Err(WriteFailure::of(WriteError::NotWritten))
}

#[cfg(not(windows))]
fn create_private_sibling(directory: &Path) -> Result<(std::fs::File, PathBuf), WriteFailure> {
    for attempt in 0..TEMPORARY_ATTEMPTS {
        let path = directory.join(temporary_name(attempt));
        match std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(file) => return Ok((file, path)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err(WriteFailure::of(WriteError::NotWritten)),
        }
    }
    Err(WriteFailure::of(WriteError::NotWritten))
}

/// Writes the bytes and orders them before the replace.
///
/// `sync_data` is what makes the published name mean one whole record or the
/// other. It is not a durability claim about a machine losing power; see the
/// module header.
fn fill(file: &mut std::fs::File, bytes: &[u8]) -> io::Result<()> {
    io::Write::write_all(file, bytes)?;
    io::Write::flush(file)?;
    file.sync_data()
}

/// Removes the one temporary object this operation created, and reports whether
/// that removal failed.
///
/// Nothing else in the directory is touched. A residue from some earlier run is
/// not this operation's to remove, and removing it would be cleaning up state
/// another process may still be using.
fn discard(temporary: std::fs::File, path: &Path, error: WriteError) -> WriteFailure {
    drop(temporary);
    WriteFailure {
        error,
        temporary_left_behind: std::fs::remove_file(path).is_err(),
    }
}

/// Gives the open object the published name, replacing what is there.
///
/// By handle, so the temporary name may already mean something else and it does
/// not matter: the kernel renames the object these bytes went into. `Flags` is
/// written as a `1` `DWORD`, which is `ReplaceIfExists = TRUE` under either
/// reading of the SDK union and leaves no indeterminate filler byte.
#[cfg(windows)]
fn replace_with(file: &std::fs::File, _temporary_path: &Path, target: &Path) -> io::Result<()> {
    use std::mem::{align_of, offset_of, size_of};
    use std::os::windows::ffi::OsStrExt as _;
    use std::os::windows::io::AsRawHandle as _;

    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Storage::FileSystem::{
        FILE_RENAME_INFO, FileRenameInfo, SetFileInformationByHandle,
    };

    const NAME_OFFSET: usize = offset_of!(FILE_RENAME_INFO, FileName);

    let mut name: Vec<u16> = target.as_os_str().encode_wide().collect();
    if name.is_empty() || name.contains(&0) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "a rename target may not be empty or contain an interior null",
        ));
    }
    // The length counts bytes and excludes the terminator, and the Win32 entry
    // point still resolves the name as a wide string, so the buffer carries one.
    let name_length = u32::try_from(name.len() * size_of::<u16>()).map_err(|_| {
        io::Error::new(io::ErrorKind::InvalidInput, "the rename target is too long")
    })?;
    name.push(0);

    let buffer_bytes = NAME_OFFSET + name.len() * size_of::<u16>();
    let information_size = u32::try_from(buffer_bytes).map_err(|_| {
        io::Error::new(io::ErrorKind::InvalidInput, "the rename target is too long")
    })?;
    // A `u64` element type gives the handle field the alignment it needs and
    // zeroes both the union filler and the trailing padding; a byte vector would
    // only be byte-aligned.
    const _: () = assert!(align_of::<FILE_RENAME_INFO>() <= align_of::<u64>());
    let mut buffer = vec![0_u64; buffer_bytes.div_ceil(size_of::<u64>())];
    let base: *mut u8 = buffer.as_mut_ptr().cast();

    // SAFETY: `buffer` is at least `buffer_bytes` long and eight-byte aligned,
    // so `base` is a valid, correctly aligned `FILE_RENAME_INFO`. Each field is
    // written through its own raw place at the offset the `repr(C)` layout fixes,
    // and the name with its terminator fits exactly in the trailing bytes.
    unsafe {
        let header = base.cast::<FILE_RENAME_INFO>();
        (&raw mut (*header).Anonymous.Flags).write(1);
        (&raw mut (*header).RootDirectory).write(HANDLE(std::ptr::null_mut()));
        (&raw mut (*header).FileNameLength).write(name_length);
        base.add(NAME_OFFSET)
            .cast::<u16>()
            .copy_from_nonoverlapping(name.as_ptr(), name.len());
    }

    // SAFETY: the handle is live for the call, and `base` points at a fully
    // initialized `FILE_RENAME_INFO` of exactly `information_size` bytes that
    // outlives it. `buffer` is still owned here, which is what keeps it alive.
    unsafe {
        SetFileInformationByHandle(
            HANDLE(file.as_raw_handle()),
            FileRenameInfo,
            base.cast(),
            information_size,
        )
    }
    .map_err(|error| io::Error::from_raw_os_error(error.code().0 & 0xFFFF))
}

/// `rename` replaces on this platform, and there is no handle-bound form of it.
///
/// Stated rather than hidden: the guarantee here is the weaker one of a name
/// being renamed, not the object the bytes went into. Windows is the supported
/// target and carries the stronger form above.
#[cfg(not(windows))]
fn replace_with(_file: &std::fs::File, temporary_path: &Path, target: &Path) -> io::Result<()> {
    std::fs::rename(temporary_path, target)
}
