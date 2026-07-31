//! The Windows half of folder discovery: real directories, read through live
//! handles.
//!
//! Everything here is mechanism. The policy — order, budgets, cycles, what is
//! refused — lives in the parent module and is tested against a fake source, so
//! this file only has to be right about Win32.
//!
//! Two choices are worth stating because they are what make the boundary hold.
//! A directory is enumerated through the handle that opened it, not by re-
//! resolving its path for every read, so entries describe the object the walk
//! is standing in. And every open in this file passes
//! `FILE_FLAG_OPEN_REPARSE_POINT`, so a link is opened as itself and can be
//! refused, rather than silently opened as whatever it points at.

use std::ffi::{OsString, c_void};
use std::fs::{File, OpenOptions};
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::os::windows::fs::OpenOptionsExt;
use std::os::windows::io::AsRawHandle;
use std::path::Path;

use super::super::selection::FileIdentity;
use super::{ChildDirectory, DirectoryEntry, DirectorySource, DiscoveryError, DiscoveryErrorKind};

/// Lets a directory be opened at all; without it `CreateFileW` refuses one.
const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
/// Opens a link as itself. The single most important flag in this file: without
/// it a junction opens as its target and the walk leaves the chosen folder
/// without anything noticing.
const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
/// Read, write and delete. Permissive on purpose, and for the reason acceptance
/// gives: MSCanvas looking inside a folder must not be what stops its owner
/// renaming or deleting something in it. The cost is that a name can be
/// re-pointed while the walk holds the object, which is what the identity
/// comparison below is for.
const FILE_SHARE_ALL: u32 = 0x0000_0007;
const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x0000_0010;
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
/// `FileAttributeTagInfo`: attributes and reparse tag from an open handle.
///
/// Used in preference to `GetFileInformationByHandle` so this file declares one
/// imported function rather than two, and so it does not redeclare a signature
/// `selection.rs` already owns with a layout of its own.
const FILE_ATTRIBUTE_TAG_INFO_CLASS: i32 = 9;
/// `FileIdInfo`: volume serial and the whole 128-bit file ID.
const FILE_ID_INFO_CLASS: i32 = 18;
/// `FileRemoteProtocolInfo`: how a file is reached when it is reached remotely.
///
/// The point of asking is that it answers at all. Windows fails this class with
/// `ERROR_INVALID_PARAMETER` for a local object, so a call that succeeds is
/// itself the finding.
const FILE_REMOTE_PROTOCOL_INFO_CLASS: i32 = 13;
/// `FileIdExtdDirectoryRestartInfo`: begin an enumeration from the first entry.
const FILE_ID_EXTD_DIRECTORY_RESTART_INFO_CLASS: i32 = 20;
/// `FileIdExtdDirectoryInfo`: continue one.
const FILE_ID_EXTD_DIRECTORY_INFO_CLASS: i32 = 19;
const ERROR_NO_MORE_FILES: i32 = 18;
const DRIVE_REMOTE: u32 = 4;

/// The fixed part of `FILE_ID_EXTD_DIR_INFO`, up to but excluding `FileName`.
///
/// Checked against the Windows SDK (`um/winbase.h`) rather than remembered:
/// `NextEntryOffset` at 0, `FileAttributes` at 56, `FileNameLength` at 60,
/// `ReparsePointTag` at 68, `FileId` at 72, `FileName` at 88.
const ENTRY_HEADER_BYTES: usize = 88;
const ENTRY_NEXT_OFFSET: usize = 0;
const ENTRY_ATTRIBUTES_OFFSET: usize = 56;
const ENTRY_NAME_LENGTH_OFFSET: usize = 60;
const ENTRY_FILE_ID_OFFSET: usize = 72;
const ENTRY_NAME_OFFSET: usize = 88;

/// One directory enumeration's worth of records. Large enough that an ordinary
/// directory is one or two calls, small enough to be an unremarkable stack-free
/// allocation.
const ENUMERATION_BUFFER_BYTES: usize = 64 * 1024;

#[cfg(test)]
thread_local! {
    /// How many enumerations this thread has issued.
    ///
    /// The allowance below bounds two different costs, and only one of them is
    /// visible in a result. That a walk stops *inspecting* at its allowance is
    /// observable from the summary; that it stops *reading* is not, and a check
    /// that only bounded memory would leave a directory of a million names
    /// still being read to the end. Counting the calls is the only way a test
    /// can tell those apart. Thread-local because tests run in parallel.
    pub(super) static ENUMERATION_CALLS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

#[repr(C)]
#[derive(Default)]
struct FileAttributeTagInformation {
    file_attributes: u32,
    reparse_tag: u32,
}

#[repr(C)]
#[derive(Default)]
struct FileIdInformation {
    volume_serial_number: u64,
    file_id: [u8; 16],
}

/// The size of `FILE_REMOTE_PROTOCOL_INFO`, counted from the Windows SDK
/// (`um/winbase.h`, `_FILE_REMOTE_PROTOCOL_INFO`) rather than estimated.
///
/// `StructureVersion` and `StructureSize` (`USHORT`×2) = 4, `Protocol`
/// (`ULONG`) = 4, `ProtocolMajorVersion`, `ProtocolMinorVersion`,
/// `ProtocolRevision` and `Reserved` (`USHORT`×4) = 8, `Flags` (`ULONG`) = 4 —
/// twenty bytes of header. Then `GenericReserved` (`ULONG[8]`) = 32, and the
/// `ProtocolSpecific` union, whose largest arm is `ULONG[16]` = 64. Total 116,
/// aligned to 4 because no member is wider.
///
/// This number is the whole check. Windows validates the declared length before
/// it looks at the object, so a buffer even one byte short is refused with
/// `ERROR_BAD_LENGTH` for a local file and a remote one alike — and a check
/// that reads "did the call succeed" then answers "local" for everything and
/// silently does nothing. This file shipped 88 once, and the refusal it claimed
/// to make could not happen.
pub(super) const REMOTE_PROTOCOL_INFO_BYTES: usize = 116;

/// `FILE_REMOTE_PROTOCOL_INFO`, whose contents this file never reads.
///
/// Only the size is load-bearing: whether the call succeeds is the whole
/// answer. Declared as bytes rather than as fields because naming fields
/// nothing reads would invite someone to trust them.
#[repr(C, align(4))]
struct FileRemoteProtocolInformation([u8; REMOTE_PROTOCOL_INFO_BYTES]);

// The declared size must be the size the class is told about, exactly. An
// alignment that rounded it up would pass a larger length than the buffer
// documents, and one that rounded it down would be the bug above again.
const _: () = assert!(
    std::mem::size_of::<FileRemoteProtocolInformation>() == REMOTE_PROTOCOL_INFO_BYTES,
    "FILE_REMOTE_PROTOCOL_INFO must be passed at its documented size"
);

#[link(name = "kernel32")]
unsafe extern "system" {
    #[link_name = "GetFileInformationByHandleEx"]
    fn get_file_information_by_handle_ex(
        file: *mut c_void,
        information_class: i32,
        information: *mut c_void,
        information_size: u32,
    ) -> i32;

    #[link_name = "GetDriveTypeW"]
    fn get_drive_type(root_path: *const u16) -> u32;
}

/// A directory the walk is holding open, and what it established about it.
pub(super) struct WindowsDirectory {
    /// Kept alive for as long as the walk is inside this directory: the
    /// enumeration below reads through this very handle.
    handle: File,
    identity: FileIdentity,
}

/// Reads real Windows directories.
pub(super) struct WindowsDirectorySource;

impl DirectorySource for WindowsDirectorySource {
    type Directory = WindowsDirectory;

    fn open_root(&self, root: &Path) -> Result<Self::Directory, DiscoveryError> {
        // The remote test comes first: it is the one refusal that does not need
        // the folder to exist, and a network round trip to open something this
        // slice will not walk is a round trip worth not making.
        if is_remote_root(root) {
            return Err(DiscoveryError::new(
                DiscoveryErrorKind::RemoteRootUnsupported,
            ));
        }

        let handle = open_no_follow(root)
            .map_err(|_| DiscoveryError::new(DiscoveryErrorKind::RootUnavailable))?;

        // And now ask the object, because the test above only read text. A path
        // whose own prefix is a drive letter still lands on a share if any
        // directory along the way is a link to one, and a relative path names
        // whichever drive the process happens to be sitting on. Neither is
        // visible in the string; both are visible to the handle.
        if is_remote_object(&handle) {
            return Err(DiscoveryError::new(
                DiscoveryErrorKind::RemoteRootUnsupported,
            ));
        }

        let attributes = attributes_of(&handle)
            .map_err(|()| DiscoveryError::new(DiscoveryErrorKind::RootUnavailable))?;

        // Order matters to the message: a junction is a link the user pointed
        // at, and saying "not a directory" about one would be true and useless.
        if attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(DiscoveryError::new(DiscoveryErrorKind::RootReparsePoint));
        }
        if attributes & FILE_ATTRIBUTE_DIRECTORY == 0 {
            return Err(DiscoveryError::new(DiscoveryErrorKind::RootNotDirectory));
        }

        let identity = identity_of(&handle)
            .map_err(|()| DiscoveryError::new(DiscoveryErrorKind::RootUnavailable))?;
        Ok(WindowsDirectory { handle, identity })
    }

    fn identity(&self, directory: &Self::Directory) -> FileIdentity {
        directory.identity
    }

    fn entries(
        &self,
        directory: &Self::Directory,
        limit: u64,
    ) -> Result<Vec<DirectoryEntry>, DiscoveryError> {
        let mut entries = Vec::new();
        let mut buffer = vec![0_u8; ENUMERATION_BUFFER_BYTES];
        let mut class = FILE_ID_EXTD_DIRECTORY_RESTART_INFO_CLASS;

        loop {
            // Asked before each read rather than only after, so a directory
            // holding millions of names costs one buffer past the allowance
            // instead of all of them. This is what makes the entry budget a
            // bound on what the walk spends and not merely on what it counts.
            if entries.len() as u64 >= limit {
                return Ok(entries);
            }

            #[cfg(test)]
            ENUMERATION_CALLS.with(|calls| calls.set(calls.get() + 1));

            // SAFETY: the handle outlives the call, and the buffer is a live
            // allocation whose length is passed with it. The API writes at most
            // that many bytes and reports the rest on the next call.
            let filled = unsafe {
                get_file_information_by_handle_ex(
                    directory.handle.as_raw_handle().cast(),
                    class,
                    buffer.as_mut_ptr().cast::<c_void>(),
                    u32::try_from(buffer.len()).expect("the enumeration buffer fits in a DWORD"),
                )
            };
            if filled == 0 {
                // The documented end of an enumeration, and the only failure
                // that is not one.
                return if std::io::Error::last_os_error().raw_os_error()
                    == Some(ERROR_NO_MORE_FILES)
                {
                    Ok(entries)
                } else {
                    Err(DiscoveryError::new(
                        DiscoveryErrorKind::RootEnumerationFailed,
                    ))
                };
            }

            // The records carry a file ID but no volume serial, because every
            // entry in a directory is on that directory's volume. Supplying it
            // here is what makes an entry's identity a whole one, comparable
            // against the identity of the child once it is opened.
            parse_entries(
                &buffer,
                directory.identity.volume_serial(),
                limit,
                &mut entries,
            )?;
            class = FILE_ID_EXTD_DIRECTORY_INFO_CLASS;
        }
    }

    fn open_child(
        &self,
        _parent: &Self::Directory,
        parent_path: &Path,
        entry: &DirectoryEntry,
    ) -> ChildDirectory<Self::Directory> {
        // Win32 documents no way to open a child relative to a parent handle --
        // the call that would, `NtCreateFile` with a root directory, is not a
        // documented API this project depends on. So the child is opened by
        // name, and the window that leaves is closed after the fact rather than
        // before: whatever this opens must be the object the parent enumerated,
        // or the walk does not go in.
        let Ok(handle) = open_no_follow(&parent_path.join(&entry.name)) else {
            return ChildDirectory::Inaccessible;
        };
        let Ok(attributes) = attributes_of(&handle) else {
            return ChildDirectory::Inaccessible;
        };
        if attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
            || attributes & FILE_ATTRIBUTE_DIRECTORY == 0
        {
            // The name became a link, or stopped being a directory, since the
            // parent described it.
            return ChildDirectory::IdentityChanged;
        }
        let Ok(identity) = identity_of(&handle) else {
            return ChildDirectory::Inaccessible;
        };
        if identity != entry.identity {
            return ChildDirectory::IdentityChanged;
        }
        ChildDirectory::Opened(WindowsDirectory { handle, identity })
    }
}

/// Opens a path without following a link on its final component.
pub(super) fn open_no_follow(path: &Path) -> std::io::Result<File> {
    OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_ALL)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
}

fn attributes_of(handle: &File) -> Result<u32, ()> {
    let mut information = FileAttributeTagInformation::default();
    // SAFETY: the handle outlives the call, and the out parameter is a fully
    // initialised value of the exact FILE_ATTRIBUTE_TAG_INFO layout the class
    // requires, whose size is passed with it.
    let succeeded = unsafe {
        get_file_information_by_handle_ex(
            handle.as_raw_handle().cast(),
            FILE_ATTRIBUTE_TAG_INFO_CLASS,
            (&raw mut information).cast(),
            u32::try_from(std::mem::size_of::<FileAttributeTagInformation>())
                .expect("FILE_ATTRIBUTE_TAG_INFO fits in a DWORD"),
        )
    };
    if succeeded == 0 {
        return Err(());
    }
    Ok(information.file_attributes)
}

fn identity_of(handle: &File) -> Result<FileIdentity, ()> {
    let mut information = FileIdInformation::default();
    // SAFETY: the same live handle, and an out parameter of the exact
    // FILE_ID_INFO layout whose size is passed with it.
    let identified = unsafe {
        get_file_information_by_handle_ex(
            handle.as_raw_handle().cast(),
            FILE_ID_INFO_CLASS,
            (&raw mut information).cast(),
            u32::try_from(std::mem::size_of::<FileIdInformation>())
                .expect("FILE_ID_INFO fits in a DWORD"),
        )
    };
    // A volume that cannot answer has no identity to compare, which is the same
    // position as answering with nothing.
    if identified == 0 || information.file_id == [0; 16] {
        return Err(());
    }
    Ok(FileIdentity::new(
        information.volume_serial_number,
        information.file_id,
    ))
}

/// Whether an opened object is reached over a remote protocol.
///
/// `FileRemoteProtocolInfo` is documented to describe how a file is reached
/// when it is reached remotely, and to fail with `ERROR_INVALID_PARAMETER`
/// otherwise. So the answer is whether the call succeeds, not anything it
/// wrote: nothing here reads the buffer. Treating a failure as "local" is the
/// safe direction to be wrong in only because the path test already refused
/// everything that names a share outright; this closes the case the path
/// cannot see, where an ordinary-looking local path passes through a link to
/// one.
pub(super) fn is_remote_object(handle: &File) -> bool {
    ask_remote_protocol(handle, REMOTE_PROTOCOL_INFO_BYTES) != 0
}

/// Asks the remote-protocol class with a chosen declared length.
///
/// The length is a parameter for one reason: a test has to be able to show that
/// getting it wrong is the difference between asking about the object and being
/// refused before the object is consulted. Production has exactly one caller and
/// it passes the documented size.
pub(super) fn ask_remote_protocol(handle: &File, declared_bytes: usize) -> i32 {
    let mut information = FileRemoteProtocolInformation([0; REMOTE_PROTOCOL_INFO_BYTES]);
    // SAFETY: the handle outlives the call, and the out parameter is a live
    // allocation of `REMOTE_PROTOCOL_INFO_BYTES`. The declared length is never
    // larger than that allocation -- production passes exactly it, and the one
    // test that passes anything else passes less.
    debug_assert!(declared_bytes <= REMOTE_PROTOCOL_INFO_BYTES);
    unsafe {
        get_file_information_by_handle_ex(
            handle.as_raw_handle().cast(),
            FILE_REMOTE_PROTOCOL_INFO_CLASS,
            (&raw mut information).cast(),
            u32::try_from(declared_bytes).expect("FILE_REMOTE_PROTOCOL_INFO fits in a DWORD"),
        )
    }
}

/// Whether a root lives somewhere this slice makes no claims about.
///
/// A UNC path is refused for what it is rather than for what a drive-type call
/// says about it. `GetDriveTypeW` can only answer about a share it can reach,
/// and a host that is down or does not exist answers `DRIVE_NO_ROOT_DIR` — so
/// asking would refuse reachable shares and admit unreachable ones, which is
/// precisely backwards. A drive letter is a question the API can answer, and
/// that is the only case it is asked.
fn is_remote_root(root: &Path) -> bool {
    use std::path::{Component, Prefix};

    match root.components().next() {
        Some(Component::Prefix(prefix)) => match prefix.kind() {
            Prefix::UNC(..) | Prefix::VerbatimUNC(..) => true,
            Prefix::Disk(..) | Prefix::VerbatimDisk(..) => {
                let mut root_only: Vec<u16> = prefix.as_os_str().encode_wide().collect();
                root_only.push(u16::from(b'\\'));
                root_only.push(0);
                // SAFETY: a NUL-terminated wide string that outlives the call.
                let kind = unsafe { get_drive_type(root_only.as_ptr()) };
                kind == DRIVE_REMOTE
            }
            // A device or verbatim-device path is not a folder a picker
            // produces, and this slice has nothing to say about one.
            Prefix::DeviceNS(..) | Prefix::Verbatim(..) => true,
        },
        // A relative or drive-rootless path does name a volume — whichever one
        // the process is standing on — but not one that can be read out of the
        // text. It is left to `is_remote_object`, which asks the opened handle
        // and does not have to guess.
        _ => false,
    }
}

/// Walks one buffer of `FILE_ID_EXTD_DIR_INFO` records.
///
/// Every offset and length the filesystem supplies is checked before it is
/// used. A record that does not fit the buffer it arrived in, or a name that
/// does not fit its record, is an invariant failure rather than something to
/// read past.
fn parse_entries(
    buffer: &[u8],
    volume_serial: u64,
    limit: u64,
    entries: &mut Vec<DirectoryEntry>,
) -> Result<(), DiscoveryError> {
    let invariant = || DiscoveryError::new(DiscoveryErrorKind::FilesystemInvariantFailed);
    let mut offset = 0_usize;

    loop {
        if entries.len() as u64 >= limit {
            return Ok(());
        }

        let record = buffer.get(offset..).ok_or_else(invariant)?;
        if record.len() < ENTRY_HEADER_BYTES {
            return Err(invariant());
        }

        let next = u32::from_le_bytes(
            record[ENTRY_NEXT_OFFSET..ENTRY_NEXT_OFFSET + 4]
                .try_into()
                .map_err(|_| invariant())?,
        ) as usize;
        let attributes = u32::from_le_bytes(
            record[ENTRY_ATTRIBUTES_OFFSET..ENTRY_ATTRIBUTES_OFFSET + 4]
                .try_into()
                .map_err(|_| invariant())?,
        );
        let name_bytes = u32::from_le_bytes(
            record[ENTRY_NAME_LENGTH_OFFSET..ENTRY_NAME_LENGTH_OFFSET + 4]
                .try_into()
                .map_err(|_| invariant())?,
        ) as usize;
        // A wide name is a whole number of UTF-16 code units by definition, and
        // no entry has no name at all. Neither is producible by NTFS, which is
        // why both are refused rather than interpreted.
        if name_bytes == 0 || !name_bytes.is_multiple_of(2) {
            return Err(invariant());
        }
        let name_end = ENTRY_NAME_OFFSET
            .checked_add(name_bytes)
            .ok_or_else(invariant)?;
        if name_end > record.len() {
            return Err(invariant());
        }
        // A record must contain its own name, not merely reach into whatever
        // the buffer holds after it. Checking against `record.len()` alone
        // would let a name declared longer than the record read the beginning
        // of the next one and call the result a filename; and a `next` shorter
        // than a header would have this loop decode a second entry out of the
        // middle of this one. Both come from the kernel, so neither is expected
        // — which is exactly why an unexpected one must stop rather than be
        // interpreted.
        if next != 0 && next < name_end {
            return Err(invariant());
        }

        let mut file_id = [0_u8; 16];
        file_id.copy_from_slice(
            record
                .get(ENTRY_FILE_ID_OFFSET..ENTRY_FILE_ID_OFFSET + 16)
                .ok_or_else(invariant)?,
        );

        let name_units: Vec<u16> = record[ENTRY_NAME_OFFSET..name_end]
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        let name = OsString::from_wide(&name_units);

        // `.` and `..` are the directory describing itself and its parent, not
        // children. The walk would loop forever on either.
        if name != "." && name != ".." {
            entries.push(DirectoryEntry {
                name,
                is_directory: attributes & FILE_ATTRIBUTE_DIRECTORY != 0,
                is_reparse_point: attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0,
                identity: FileIdentity::new(volume_serial, file_id),
            });
        }

        if next == 0 {
            return Ok(());
        }
        offset = offset.checked_add(next).ok_or_else(invariant)?;
        if offset >= buffer.len() {
            return Err(invariant());
        }
    }
}

#[cfg(test)]
mod tests {
    //! What the filesystem hands back, said badly.
    //!
    //! The fake source the traversal tests use starts from `DirectoryEntry`
    //! values, so it cannot reach this decoder at all. These tests are the only
    //! place the buffer itself is on trial, and every one of them asks the same
    //! question: when a record's own lengths and offsets do not describe
    //! something inside the buffer it arrived in, does the parser refuse, or
    //! does it read on?

    use super::*;

    const VOLUME: u64 = 0x00AB_CDEF;

    /// One `FILE_ID_EXTD_DIR_INFO`, built field by field.
    ///
    /// Everything a malformed record could lie about is a field here rather
    /// than a constant, because each test is exactly one such lie.
    struct Record {
        next: u32,
        attributes: u32,
        declared_name_bytes: Option<u32>,
        file_id: [u8; 16],
        name: &'static str,
        /// Bytes to cut from the end after the record is built.
        truncate_by: usize,
    }

    impl Record {
        fn named(name: &'static str) -> Self {
            Self {
                next: 0,
                attributes: 0,
                declared_name_bytes: None,
                file_id: [7; 16],
                name,
                truncate_by: 0,
            }
        }

        fn build(&self) -> Vec<u8> {
            let units: Vec<u16> = self.name.encode_utf16().collect();
            let mut bytes = vec![0_u8; ENTRY_NAME_OFFSET];
            for unit in &units {
                bytes.extend_from_slice(&unit.to_le_bytes());
            }
            let actual = u32::try_from(units.len() * 2).expect("a test name fits");
            let declared = self.declared_name_bytes.unwrap_or(actual);

            bytes[ENTRY_NEXT_OFFSET..ENTRY_NEXT_OFFSET + 4]
                .copy_from_slice(&self.next.to_le_bytes());
            bytes[ENTRY_ATTRIBUTES_OFFSET..ENTRY_ATTRIBUTES_OFFSET + 4]
                .copy_from_slice(&self.attributes.to_le_bytes());
            bytes[ENTRY_NAME_LENGTH_OFFSET..ENTRY_NAME_LENGTH_OFFSET + 4]
                .copy_from_slice(&declared.to_le_bytes());
            bytes[ENTRY_FILE_ID_OFFSET..ENTRY_FILE_ID_OFFSET + 16].copy_from_slice(&self.file_id);

            bytes.truncate(bytes.len() - self.truncate_by);
            bytes
        }
    }

    fn parse(buffer: &[u8]) -> Result<Vec<DirectoryEntry>, DiscoveryError> {
        let mut entries = Vec::new();
        parse_entries(buffer, VOLUME, u64::MAX, &mut entries)?;
        Ok(entries)
    }

    fn assert_refused(buffer: &[u8]) {
        let error = parse(buffer).expect_err("a malformed buffer is refused");
        assert_eq!(
            error.kind(),
            DiscoveryErrorKind::FilesystemInvariantFailed,
            "a malformed record is a filesystem invariant failure, not any other outcome"
        );
    }

    #[test]
    fn a_chain_of_well_formed_records_yields_every_entry() {
        let mut first = Record::named("alpha.mzML");
        first.next = u32::try_from(first.build().len()).expect("a test record fits");
        let mut buffer = first.build();
        buffer.extend_from_slice(&Record::named("beta.mzML").build());

        let entries = parse(&buffer).expect("a well-formed buffer parses");

        let names: Vec<_> = entries.iter().map(|entry| entry.name.clone()).collect();
        assert_eq!(
            names,
            vec![OsString::from("alpha.mzML"), OsString::from("beta.mzML")]
        );
    }

    #[test]
    fn the_directories_own_entries_for_itself_and_its_parent_are_not_children() {
        // Entering `..` would climb straight out of the folder the user chose;
        // entering `.` would never terminate.
        let mut dot = Record::named(".");
        dot.attributes = FILE_ATTRIBUTE_DIRECTORY;
        dot.next = u32::try_from(dot.build().len()).expect("a test record fits");
        let mut dot_dot = Record::named("..");
        dot_dot.attributes = FILE_ATTRIBUTE_DIRECTORY;
        dot_dot.next = u32::try_from(dot_dot.build().len()).expect("a test record fits");

        let mut buffer = dot.build();
        buffer.extend_from_slice(&dot_dot.build());
        buffer.extend_from_slice(&Record::named("real.mzML").build());

        let entries = parse(&buffer).expect("a well-formed buffer parses");

        let names: Vec<_> = entries.iter().map(|entry| entry.name.clone()).collect();
        assert_eq!(names, vec![OsString::from("real.mzML")]);
    }

    #[test]
    fn a_records_attributes_decide_what_kind_of_entry_it_is() {
        let mut plain = Record::named("file.mzML");
        plain.next = u32::try_from(plain.build().len()).expect("a test record fits");
        let mut folder = Record::named("folder");
        folder.attributes = FILE_ATTRIBUTE_DIRECTORY;
        folder.next = u32::try_from(folder.build().len()).expect("a test record fits");
        let mut link = Record::named("link");
        link.attributes = FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT;

        let mut buffer = plain.build();
        buffer.extend_from_slice(&folder.build());
        buffer.extend_from_slice(&link.build());

        let entries = parse(&buffer).expect("a well-formed buffer parses");

        assert!(!entries[0].is_directory && !entries[0].is_reparse_point);
        assert!(entries[1].is_directory && !entries[1].is_reparse_point);
        // The one that matters: a reparse tag on a directory entry survives
        // decoding, because refusing it later depends on seeing it here.
        assert!(entries[2].is_directory && entries[2].is_reparse_point);
    }

    #[test]
    fn an_entry_takes_the_volume_serial_of_the_directory_it_was_read_from() {
        // The records carry a file ID and no serial. Stamping the parent's is
        // what makes the identity whole enough to compare a child against.
        let entries = parse(&Record::named("sample.mzML").build()).expect("a well-formed buffer");

        assert_eq!(entries[0].identity, FileIdentity::new(VOLUME, [7; 16]));
    }

    #[test]
    fn a_record_shorter_than_its_own_header_is_refused() {
        let mut record = Record::named("sample.mzML");
        record.truncate_by = record.build().len() - (ENTRY_HEADER_BYTES - 1);

        assert_refused(&record.build());
    }

    #[test]
    fn a_truncated_final_record_is_refused_rather_than_read_past() {
        // The header survives and claims a name the buffer no longer holds.
        let mut record = Record::named("sample.mzML");
        record.truncate_by = 4;

        assert_refused(&record.build());
    }

    #[test]
    fn a_name_longer_than_its_record_is_refused() {
        let mut record = Record::named("sample.mzML");
        record.declared_name_bytes = Some(4096);

        assert_refused(&record.build());
    }

    #[test]
    fn a_name_length_that_is_not_a_whole_number_of_code_units_is_refused() {
        let mut record = Record::named("sample.mzML");
        record.declared_name_bytes = Some(7);

        assert_refused(&record.build());
    }

    #[test]
    fn a_name_length_that_would_overflow_the_record_end_is_refused() {
        let mut record = Record::named("sample.mzML");
        record.declared_name_bytes = Some(u32::MAX - 1);

        assert_refused(&record.build());
    }

    #[test]
    fn a_next_offset_past_the_end_of_the_buffer_is_refused() {
        // The lie that would matter most: a chain that says "there is another
        // record" and points outside the allocation the API filled.
        let mut record = Record::named("sample.mzML");
        record.next = 1_000_000;

        assert_refused(&record.build());
    }

    #[test]
    fn a_next_offset_landing_exactly_at_the_end_of_the_buffer_is_refused() {
        let mut record = Record::named("sample.mzML");
        let length = record.build().len();
        record.next = u32::try_from(length).expect("a test record fits");

        // There is no record there -- the buffer ends. Continuing would read a
        // header out of whatever follows the allocation.
        assert_refused(&record.build());
    }

    #[test]
    fn a_next_offset_into_the_middle_of_a_record_is_refused() {
        // The second record is long on purpose. An earlier version of this test
        // used a short one and passed for the wrong reason -- the remainder was
        // simply smaller than a header -- which would have let a chain that
        // lands inside a record go unnoticed.
        let mut first = Record::named("alpha.mzML");
        first.next = u32::try_from(first.build().len() + 40).expect("a test record fits");
        let mut buffer = first.build();
        buffer.extend_from_slice(&Record::named("a-considerably-longer-name.mzML").build());
        assert!(buffer.len() > usize::try_from(first.next).unwrap() + ENTRY_HEADER_BYTES);

        // Landing mid-record would decode a name length out of the middle of a
        // file ID and call whatever followed a filename.
        assert_refused(&buffer);
    }

    #[test]
    fn a_next_offset_shorter_than_a_header_is_refused() {
        // Without this, the loop steps a few bytes into the record it is
        // already reading and decodes a second, invented entry out of its
        // middle.
        let mut record = Record::named("alpha.mzML");
        record.next = 8;

        assert_refused(&record.build());
    }

    #[test]
    fn a_name_that_runs_into_the_following_record_is_refused() {
        // The name fits the buffer, so a length check against the buffer alone
        // accepts it -- and 30 bytes of the next record become part of a
        // filename. A record has to contain its own name.
        let mut first = Record::named("aa");
        let honest = first.build().len();
        first.declared_name_bytes = Some(64);
        first.next = u32::try_from(honest).expect("a test record fits");
        let mut buffer = first.build();
        buffer.extend_from_slice(&Record::named("beta.mzML").build());

        assert_refused(&buffer);
    }

    #[test]
    fn a_source_that_stops_at_the_allowance_is_not_an_error() {
        // The parser is where the entry allowance is actually honoured, so
        // stopping early has to be an ordinary return rather than a refusal.
        let mut first = Record::named("alpha.mzML");
        first.next = u32::try_from(first.build().len()).expect("a test record fits");
        let mut buffer = first.build();
        buffer.extend_from_slice(&Record::named("beta.mzML").build());

        let mut entries = Vec::new();
        parse_entries(&buffer, VOLUME, 1, &mut entries).expect("stopping early is not a failure");

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, OsString::from("alpha.mzML"));
    }

    #[test]
    fn an_empty_buffer_is_refused_rather_than_read_as_an_entry() {
        assert_refused(&[]);
    }
}
