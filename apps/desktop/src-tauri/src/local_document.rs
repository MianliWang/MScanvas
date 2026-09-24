//! Reading and replacing one small local document, for every consumer that has
//! one.
//!
//! This is the mechanism the UI preference store was built with, lifted out of
//! it unchanged so that the project store does not become a second
//! implementation of the same Win32 sequence. Nothing about *which* document,
//! *where* it lives, or *what* it contains is decided here: a caller supplies
//! the directory, the published name, the byte bound and the prefix its own
//! private temporaries carry, and keeps its own refusal vocabulary. What is
//! shared is only the part where getting it wrong means writing over something
//! nobody chose, or half of a document.
//!
//! ## Replacement
//!
//! A bounded private sibling in the same directory, filled, then given the
//! final name by handle with `ReplaceIfExists`. The old file is never deleted
//! or truncated first, so every failing path leaves the last confirmed document
//! exactly where it was. Only the temporary object this operation created is
//! cleaned up, and a cleanup that fails is reported rather than folded into the
//! write failure.
//!
//! What this does not claim is durability across a crash or a power loss. The
//! bytes are flushed and ordered before the replace, which is what makes the
//! published name mean either the old document or the new one and never a
//! partial file. It is not a claim that a machine losing power mid-replace
//! comes back with either.

use std::io;
use std::path::{Path, PathBuf};

/// How many distinct private sibling names one publish will try.
///
/// A small bound rather than a retry loop. Each attempt uses `CREATE_NEW`, so a
/// collision means the name is taken; eight of them failing in a directory the
/// caller is writing into is a fault to report, not a thing to keep trying.
const TEMPORARY_ATTEMPTS: u32 = 8;

/// FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE.
#[cfg(windows)]
const SHARE_ALL: u32 = 7;

/// FILE_FLAG_OPEN_REPARSE_POINT: open the link itself, never its target.
#[cfg(windows)]
pub const OPEN_REPARSE_POINT: u32 = 0x0020_0000;

/// FILE_ATTRIBUTE_REPARSE_POINT.
#[cfg(windows)]
const ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;

/// FILE_ATTRIBUTE_DIRECTORY.
#[cfg(windows)]
const ATTRIBUTE_DIRECTORY: u32 = 0x0000_0010;

/// Why a bounded read did not produce bytes.
///
/// Deliberately not a caller's error type. Each consumer has its own vocabulary
/// for what an unusable document means to *it*, and this is the small set of
/// facts the mechanism can establish on its own.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReadRefusal {
    /// The file is there and this process could not read it.
    Unreadable,
    /// Longer than the caller's bound. Never read whole, never parsed.
    Oversized,
    /// The name is not an ordinary file -- a link, a reparse point, a directory
    /// or a device.
    UnsafeTarget,
}

/// Why a publish did not happen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteRefusal {
    /// The published name currently holds something this mechanism does not
    /// replace. Nothing was created and nothing was replaced.
    UnsafeTarget,
    /// No private sibling could be created, or its bytes could not be written.
    /// The published document, if there was one, is untouched.
    NotWritten,
    /// The bytes were written and could not take the published name. The
    /// published document, if there was one, is untouched.
    NotPublished,
}

/// A refused publish, and whether it left a residue.
///
/// The two are reported together because "it was not saved" and "it was not
/// saved and there is now a file beside it that MSCanvas could not remove" are
/// different things to be told.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PublishFailure {
    pub refusal: WriteRefusal,
    pub temporary_left_behind: bool,
}

impl PublishFailure {
    const fn of(refusal: WriteRefusal) -> Self {
        Self {
            refusal,
            temporary_left_behind: false,
        }
    }
}

/// Whether the published name currently holds something this mechanism will not
/// replace.
///
/// `false` also covers "nothing is there", which is the ordinary first write.
#[must_use]
pub fn unsafe_published_name(target: &Path) -> bool {
    match std::fs::symlink_metadata(target) {
        Ok(metadata) => !metadata.is_file() || is_reparse_point(&metadata),
        Err(error) if error.kind() == io::ErrorKind::NotFound => false,
        // Something is in the way and cannot be described. Refusing is the
        // honest answer; replacing what cannot be inspected is not.
        Err(_) => true,
    }
}

#[cfg(windows)]
#[must_use]
pub fn is_reparse_point(metadata: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt as _;
    metadata.file_attributes() & ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
#[must_use]
pub fn is_reparse_point(metadata: &std::fs::Metadata) -> bool {
    metadata.file_type().is_symlink()
}

#[cfg(windows)]
#[must_use]
pub fn is_ordinary_file(metadata: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt as _;
    let attributes = metadata.file_attributes();
    attributes & (ATTRIBUTE_REPARSE_POINT | ATTRIBUTE_DIRECTORY) == 0
}

#[cfg(not(windows))]
#[must_use]
pub fn is_ordinary_file(metadata: &std::fs::Metadata) -> bool {
    metadata.file_type().is_file()
}

/// Opens a document without traversing a link at its name.
///
/// `OPEN_REPARSE_POINT` opens the link itself where the name is one, which is
/// what lets the attribute check refuse it. The flag is ignored for an ordinary
/// file, so the usual case pays nothing for it.
///
/// # Errors
///
/// Whatever the platform answered, unclassified. Callers distinguish "not
/// there" from "there and refused" themselves, because which of those is
/// interesting differs between them.
#[cfg(windows)]
pub fn open_for_read(target: &Path) -> io::Result<std::fs::File> {
    use std::os::windows::fs::OpenOptionsExt as _;
    std::fs::OpenOptions::new()
        .read(true)
        .share_mode(SHARE_ALL)
        .custom_flags(OPEN_REPARSE_POINT)
        .open(target)
}

/// Opens a document for reading.
///
/// # Errors
///
/// Whatever the platform answered, unclassified.
#[cfg(not(windows))]
pub fn open_for_read(target: &Path) -> io::Result<std::fs::File> {
    std::fs::File::open(target)
}

/// Reads a published document's bytes, bounded, without following a link.
///
/// `Ok(None)` is "nothing is stored", which is not a refusal. Size is judged
/// before any bytes are pulled in, and the read itself is bounded again by one
/// byte more than the limit, so an oversized or truncated-then-grown file
/// cannot become an unbounded read.
///
/// # Errors
///
/// A [`ReadRefusal`] for a name that exists and did not yield bytes this
/// mechanism will hand back.
pub fn read_bounded(target: &Path, max_bytes: u64) -> Result<Option<Vec<u8>>, ReadRefusal> {
    let file = match open_for_read(target) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        // Classified only once opening has already failed, so the ordinary path
        // stays a single handle-based judgement. A name that cannot be opened
        // at all is either something this mechanism does not own or a refusal,
        // and those are different things to tell a reader.
        Err(_) => return Err(unopenable_name(target)),
    };
    let metadata = file.metadata().map_err(|_| ReadRefusal::Unreadable)?;
    // Asked of the open object rather than of the name. A check on the name
    // followed by an open is two different things being judged; this is one.
    if !is_ordinary_file(&metadata) {
        return Err(ReadRefusal::UnsafeTarget);
    }
    if metadata.len() > max_bytes {
        return Err(ReadRefusal::Oversized);
    }
    let mut bytes = Vec::new();
    io::Read::read_to_end(&mut io::Read::take(&file, max_bytes + 1), &mut bytes)
        .map_err(|_| ReadRefusal::Unreadable)?;
    if bytes.len() as u64 > max_bytes {
        return Err(ReadRefusal::Oversized);
    }
    Ok(Some(bytes))
}

/// What the filesystem calls one object, wide enough to tell it apart from
/// every other object on its volume.
///
/// The whole 128-bit file ID from `FILE_ID_INFO`, not the 64-bit index
/// `GetFileInformationByHandle` returns: that index is documented as unique
/// only on volumes that have one, and ReFS is the counter-example the API's own
/// successor exists for. A caller asking whether two names mean one file wants
/// the answer that is right on every volume.
///
/// Read through an open handle, so a name whose meaning changed between two
/// calls cannot make two different objects look like one. `None` where the name
/// does not resolve, cannot be opened, or sits on a filesystem that has no
/// identity to give -- all of which mean the same thing to a caller: this
/// question was not answered, so do not act as though it was.
#[cfg(windows)]
#[must_use]
pub fn object_identity(path: &Path) -> Option<(u64, [u8; 16])> {
    object_identity_of(&open_for_read(path).ok()?)
}

/// The same question, asked of an object that is already open.
///
/// The one form that can bind a measurement to an object: a caller holding the
/// handle it read bytes through gets the identity of *that* object, not of
/// whatever the name means by the time a second open happens. Everything the
/// name-taking form above does is this, after an open.
#[cfg(windows)]
#[must_use]
pub fn object_identity_of(file: &std::fs::File) -> Option<(u64, [u8; 16])> {
    use std::ffi::c_void;
    use std::os::windows::io::AsRawHandle as _;

    /// `FileIdInfo`, the information class that answers with the whole file ID.
    const FILE_ID_INFO_CLASS: i32 = 0x12;

    #[repr(C)]
    #[derive(Default)]
    struct FileIdInformation {
        volume_serial_number: u64,
        file_id: [u8; 16],
    }

    // The equivalent std accessors are still unstable, and the ones that are
    // stable answer with the truncated index this deliberately does not use.
    #[link(name = "kernel32")]
    unsafe extern "system" {
        #[link_name = "GetFileInformationByHandleEx"]
        fn get_file_information_by_handle_ex(
            file: *mut c_void,
            information_class: i32,
            information: *mut c_void,
            information_size: u32,
        ) -> i32;
    }

    let mut information = FileIdInformation::default();
    // SAFETY: the file outlives the call, so its handle stays valid, and the
    // out parameter is a fully initialized value of the exact FILE_ID_INFO
    // layout the class requires, whose size is passed with it.
    let answered = unsafe {
        get_file_information_by_handle_ex(
            file.as_raw_handle().cast(),
            FILE_ID_INFO_CLASS,
            (&raw mut information).cast(),
            u32::try_from(std::mem::size_of::<FileIdInformation>())
                .expect("FILE_ID_INFO fits in a DWORD"),
        )
    };
    // A filesystem that cannot answer this has no identity to compare, which is
    // the same position as not having been asked.
    if answered == 0 || information.file_id == [0; 16] {
        return None;
    }
    Some((information.volume_serial_number, information.file_id))
}

/// The device and inode this name resolves to.
///
/// Narrower than the Windows form above and stated as such: this platform is
/// not one this application ships on, and the guarantee is whatever `stat`
/// gives.
#[cfg(not(windows))]
#[must_use]
pub fn object_identity(path: &Path) -> Option<(u64, [u8; 16])> {
    object_identity_of(&std::fs::File::open(path).ok()?)
}

/// The same question, asked of an object that is already open.
///
/// Narrower than the Windows form for the reason above, and identical to it in
/// the one way that matters here: what it answers about is the object the
/// caller is holding rather than the object a name currently resolves to.
#[cfg(not(windows))]
#[must_use]
pub fn object_identity_of(file: &std::fs::File) -> Option<(u64, [u8; 16])> {
    use std::os::unix::fs::MetadataExt as _;

    let metadata = file.metadata().ok()?;
    let mut file_id = [0_u8; 16];
    // Native byte order, which is the encoding the workspace's own inspection
    // uses for the same number. Two spellings of one inode would compare as two
    // different objects on a big-endian machine, and these identities are
    // compared *across* those two modules.
    file_id[..8].copy_from_slice(&metadata.ino().to_ne_bytes());
    Some((metadata.dev(), file_id))
}

/// The volume a directory is on, as the filesystem numbers it.
///
/// The same 64-bit serial [`object_identity`] answers for a file, so the two
/// can be compared to ask whether a file and a directory share a volume.
/// `None` where the directory cannot be opened or its volume cannot say --
/// which a caller must treat as "not established", never as "different".
#[cfg(windows)]
#[must_use]
pub fn directory_volume(path: &Path) -> Option<u64> {
    use std::os::windows::fs::OpenOptionsExt as _;

    /// FILE_FLAG_BACKUP_SEMANTICS: the flag that lets a directory be opened.
    const BACKUP_SEMANTICS: u32 = 0x0200_0000;
    let directory = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(SHARE_ALL)
        .custom_flags(BACKUP_SEMANTICS | OPEN_REPARSE_POINT)
        .open(path)
        .ok()?;
    object_identity_of(&directory).map(|(volume, _)| volume)
}

/// The device a directory is on.
#[cfg(not(windows))]
#[must_use]
pub fn directory_volume(path: &Path) -> Option<u64> {
    use std::os::unix::fs::MetadataExt as _;
    std::fs::metadata(path).ok().map(|metadata| metadata.dev())
}

/// How many bytes this process could write below `directory` now, quotas
/// included.
///
/// An observation, not a reservation: another writer can take the space the
/// next moment, so a caller still handles a write that fails for want of it.
/// `None` where the volume cannot say, which is "not established", never
/// "none free".
#[cfg(windows)]
#[must_use]
pub fn available_bytes(directory: &Path) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt as _;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        #[link_name = "GetDiskFreeSpaceExW"]
        fn get_disk_free_space_ex_w(
            directory: *const u16,
            available_to_caller: *mut u64,
            total: *mut u64,
            total_free: *mut u64,
        ) -> i32;
    }

    let mut name: Vec<u16> = directory.as_os_str().encode_wide().collect();
    if name.contains(&0) {
        return None;
    }
    name.push(0);
    let mut available = 0_u64;
    // SAFETY: `name` is a terminated wide string that outlives the call, the
    // one out parameter asked for is a valid `u64`, and the two not asked for
    // are null, which the function documents as allowed.
    let answered = unsafe {
        get_disk_free_space_ex_w(
            name.as_ptr(),
            &raw mut available,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    (answered != 0).then_some(available)
}

/// Not established off Windows.
#[cfg(not(windows))]
#[must_use]
pub fn available_bytes(_directory: &Path) -> Option<u64> {
    None
}

/// Why a name that exists could not be opened.
fn unopenable_name(target: &Path) -> ReadRefusal {
    match std::fs::symlink_metadata(target) {
        Ok(metadata) if !metadata.is_file() || is_reparse_point(&metadata) => {
            ReadRefusal::UnsafeTarget
        }
        _ => ReadRefusal::Unreadable,
    }
}

/// Creates one private sibling in `directory`, fills it, and gives it `target`'s
/// name.
///
/// `temporary_prefix` names the residue a failed write can leave, so that it is
/// recognisable as this application's, as temporary, and as belonging to one
/// consumer rather than another. It must not be a prefix any published name
/// carries.
///
/// The published name is judged unsafe before anything is created; a caller
/// that has its own further conditions on the destination checks them first.
///
/// # Errors
///
/// A [`PublishFailure`] naming the first thing that went wrong and whether a
/// private sibling was left behind. On every failing path the published name
/// still holds whatever it held before.
pub fn publish_through_temporary(
    directory: &Path,
    target: &Path,
    bytes: &[u8],
    temporary_prefix: &str,
) -> Result<(), PublishFailure> {
    publish(directory, target, bytes, temporary_prefix, true)
}

/// [`publish_through_temporary`], for a name that must not exist yet.
///
/// The same private sibling and the same handle-bound rename, with replacement
/// refused: a document that appeared at the name after the caller looked is
/// left exactly where it is and the publish fails. For a first publish to a
/// chosen name, where replacing anything would be replacing something nobody
/// approved.
///
/// # Errors
///
/// As [`publish_through_temporary`], with [`WriteRefusal::NotPublished`] where
/// the name was taken.
pub fn publish_new_through_temporary(
    directory: &Path,
    target: &Path,
    bytes: &[u8],
    temporary_prefix: &str,
) -> Result<(), PublishFailure> {
    publish(directory, target, bytes, temporary_prefix, false)
}

fn publish(
    directory: &Path,
    target: &Path,
    bytes: &[u8],
    temporary_prefix: &str,
    replace: bool,
) -> Result<(), PublishFailure> {
    if unsafe_published_name(target) {
        return Err(PublishFailure::of(WriteRefusal::UnsafeTarget));
    }
    let (mut temporary, temporary_path) = create_private_sibling(directory, temporary_prefix)?;
    if fill(&mut temporary, bytes).is_err() {
        return Err(discard(
            temporary,
            &temporary_path,
            WriteRefusal::NotWritten,
        ));
    }
    match replace_with(&temporary, &temporary_path, target, replace) {
        Ok(()) => {
            // The handle now names the published document. Dropping it
            // publishes nothing further and withholds nothing further.
            drop(temporary);
            Ok(())
        }
        Err(_) => Err(discard(
            temporary,
            &temporary_path,
            WriteRefusal::NotPublished,
        )),
    }
}

/// The private sibling's name for one attempt.
fn temporary_name(prefix: &str, attempt: u32) -> String {
    format!("{prefix}{}-{attempt}.tmp", std::process::id())
}

/// Opens one `CREATE_NEW` sibling under a name only this writer would choose.
///
/// `DELETE` access is not optional: a handle-bound rename is a rename *of this
/// object*, and the kernel will not perform one through a handle that could not
/// also remove it. Sharing is read-only for the object's whole lifetime, so
/// nothing can write into or delete the bytes between filling and publishing.
#[cfg(windows)]
fn create_private_sibling(
    directory: &Path,
    prefix: &str,
) -> Result<(std::fs::File, PathBuf), PublishFailure> {
    use std::os::windows::fs::OpenOptionsExt as _;

    const FILE_GENERIC_READ: u32 = 0x0012_0089;
    const FILE_GENERIC_WRITE: u32 = 0x0012_0116;
    const DELETE: u32 = 0x0001_0000;
    const FILE_SHARE_READ: u32 = 0x0000_0001;

    for attempt in 0..TEMPORARY_ATTEMPTS {
        let path = directory.join(temporary_name(prefix, attempt));
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
            Err(_) => return Err(PublishFailure::of(WriteRefusal::NotWritten)),
        }
    }
    Err(PublishFailure::of(WriteRefusal::NotWritten))
}

#[cfg(not(windows))]
fn create_private_sibling(
    directory: &Path,
    prefix: &str,
) -> Result<(std::fs::File, PathBuf), PublishFailure> {
    for attempt in 0..TEMPORARY_ATTEMPTS {
        let path = directory.join(temporary_name(prefix, attempt));
        match std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(file) => return Ok((file, path)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err(PublishFailure::of(WriteRefusal::NotWritten)),
        }
    }
    Err(PublishFailure::of(WriteRefusal::NotWritten))
}

/// Writes the bytes and orders them before the replace.
///
/// `sync_data` is what makes the published name mean one whole document or the
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
fn discard(temporary: std::fs::File, path: &Path, refusal: WriteRefusal) -> PublishFailure {
    drop(temporary);
    PublishFailure {
        refusal,
        temporary_left_behind: std::fs::remove_file(path).is_err(),
    }
}

/// Gives the open object the published name, replacing what is there only
/// where `replace` says so.
///
/// By handle, so the temporary name may already mean something else and it does
/// not matter: the kernel renames the object these bytes went into. `Flags` is
/// written as a whole `DWORD` -- `1` is `ReplaceIfExists = TRUE` under either
/// reading of the SDK union, `0` refuses an existing name -- and leaves no
/// indeterminate filler byte.
#[cfg(windows)]
fn replace_with(
    file: &std::fs::File,
    _temporary_path: &Path,
    target: &Path,
    replace: bool,
) -> io::Result<()> {
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
        (&raw mut (*header).Anonymous.Flags).write(u32::from(replace));
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
fn replace_with(
    _file: &std::fs::File,
    temporary_path: &Path,
    target: &Path,
    replace: bool,
) -> io::Result<()> {
    if !replace && std::fs::symlink_metadata(target).is_ok() {
        return Err(io::Error::from(io::ErrorKind::AlreadyExists));
    }
    std::fs::rename(temporary_path, target)
}
