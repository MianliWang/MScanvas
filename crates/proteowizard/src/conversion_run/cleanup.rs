//! Removing a staging area by object rather than by name.
//!
//! Establishing that a path names an MSCanvas staging area and then deleting
//! through that path are two different acts, and everything between them is a
//! window. `remove_dir_all` widens it to every component of every child: each
//! name is resolved again at the moment it is unlinked, long after anything was
//! verified. The consequence of being wrong is a recursive delete of somebody
//! else's tree.
//!
//! So nothing here deletes a name. A directory is enumerated through the handle
//! that already holds it; each child is opened, proved to be the object that
//! enumeration described, and held; and deletion is a disposition set on that
//! handle. A name is only ever a way to reach an object that must then prove
//! itself, and an object that cannot prove itself is left alone.
//!
//! Nothing here refuses a volume in advance. The conversion guarantee is
//! local-only and a remote volume is where these mechanics stop being
//! dependable, but that is a reason to decide it when the destination is
//! admitted, not a reason for teardown to abandon a tree it created. A volume
//! that cannot support the calls below fails them, and a failed call is typed,
//! reclaimable residue; a volume refused in advance is a staging area nothing
//! can ever remove and a deterministic staging name blocked for good.
//!
//! Two measured facts shape the algorithm. A directory with any child refuses
//! deletion with `ERROR_DIR_NOT_EMPTY`, and a name marked for deletion does not
//! leave its parent while the handle that marked it is still open. Teardown is
//! therefore strictly post-order, and closing each child handle is part of the
//! deletion rather than tidiness afterwards. Which close is *enough* depends on
//! the disposition used, and `set_delete_disposition` says why POSIX semantics
//! are asked for first.
//!
//! All unsafe code for staging teardown lives here.

use std::fs::File;
use std::io;
use std::path::Path;

use super::{STAGING_OUTPUT_DIRECTORY, STAGING_OWNER_MARKER, StagingResidue};

/// Objects a live run already holds, so teardown never has to find them again.
///
/// A retained handle is the strongest evidence there is: the object was created
/// by this run and has been held, unrenameable, ever since. Reclamation after a
/// crash has none of that and must open and prove instead, which is the only
/// place the two entry points differ.
pub(super) struct RetainedStagingObjects {
    pub(super) output: Option<File>,
    pub(super) marker: Option<File>,
    pub(super) authority: TeardownAuthority,
}

/// What licenses a teardown to remove an entry it finds.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum TeardownAuthority {
    /// A live run may remove only the objects it created and has held ever
    /// since. An entry under an expected name that this run does not hold got
    /// there some other way — the window is narrow, but a staging area whose
    /// construction failed part-way is exactly when it is open — and this
    /// boundary does not delete data on the strength of a name it recognises.
    RetainedObjectsOnly,
    /// Reclamation has no retained objects, because the run that made them is
    /// gone. The admitted marker is the proof instead, and it vouches for the
    /// entries the admitted root listed.
    AdmittedMarker,
}

/// What opening a staging root established about it.
pub(super) enum StagingAdmission {
    /// The root holds a marker this boundary wrote. The verified marker object
    /// is retained so teardown never reopens that name.
    Owned(File),
    /// The root holds nothing. Ownership is irrelevant: removing an empty
    /// directory destroys nothing, and this is exactly what an interrupted
    /// teardown leaves behind.
    Empty,
    /// The root holds something, and no marker this boundary can vouch for.
    NotOwned,
    /// Ownership could not be decided either way, so nothing may be removed.
    NotInspectable(StagingResidue),
}

/// How deep an owned staging tree may be before teardown gives up.
///
/// The tree under the output directory is whatever the backend wrote, so it is
/// arbitrary rather than predictable. This is not a guess at what `msconvert`
/// produces; it is what stops a looping or adversarial tree from exhausting
/// memory, and exceeding it leaves residue rather than deleting an unverified
/// remainder.
#[cfg(windows)]
const MAX_STAGING_DEPTH: usize = 64;

/// How many entries one owned directory may hold before teardown gives up.
/// Same purpose: a bound on allocation, not a statement about the backend.
#[cfg(windows)]
const MAX_ENTRIES_PER_DIRECTORY: usize = 65_536;

/// Removes an owned staging area and the object it is.
///
/// The caller must already hold `root` as a verified, admitted staging-root
/// object. Ordering is fixed and load-bearing: the backend's output tree goes
/// first, the ownership marker second, the root itself last. A teardown that
/// gives up part-way therefore leaves the marker, which is the only thing that
/// makes its own residue reclaimable rather than a permanent obstruction.
#[cfg(windows)]
pub(super) fn tear_down_owned_staging(
    root: File,
    root_path: &Path,
    retained: RetainedStagingObjects,
) -> Result<(), StagingResidue> {
    tear_down_owned_staging_seamed(root, root_path, retained, &mut || {})
}

/// The teardown, with a seam at the one interval this module is about: after a
/// directory has been listed and before anything that listing named is opened
/// or removed. Production passes an empty hook; a test uses it to replace what
/// the names mean.
#[cfg(windows)]
pub(super) fn tear_down_owned_staging_seamed(
    root: File,
    root_path: &Path,
    mut retained: RetainedStagingObjects,
    after_enumeration: &mut dyn FnMut(),
) -> Result<(), StagingResidue> {
    // Everything below is judged against the volume this root lives on, so an
    // object that is somehow elsewhere can never satisfy an identity check.
    let (volume, _) = full_identity(&root).map_err(residue_for)?;
    let children = enumerate_children(&root)?;
    after_enumeration();

    // The staging root holds exactly what this boundary put there. Anything
    // else arrived from outside, and nothing here will delete it or delete
    // around it.
    let mut output = None;
    let mut marker = None;
    for child in children {
        if child.name_is(STAGING_OUTPUT_DIRECTORY) {
            output = Some(child);
        } else if child.name_is(STAGING_OWNER_MARKER) {
            marker = Some(child);
        } else {
            return Err(StagingResidue::ForeignEntry);
        }
    }

    if let Some(output) = output {
        if retained.authority == TeardownAuthority::RetainedObjectsOnly && retained.output.is_none()
        {
            return Err(StagingResidue::ForeignEntry);
        }
        let path = root_path.join(STAGING_OUTPUT_DIRECTORY);
        let opened = resolve_child(
            &path,
            &output,
            retained.output.take(),
            ChildPosture::Directory,
            volume,
        )?;
        empty_directory_tree(&opened, &path, volume, after_enumeration)?;
        dispose_and_close(opened)?;
    }
    // The marker goes after everything else and before the root, so a teardown
    // that gives up part-way leaves the proof that makes its own residue
    // reclaimable rather than a permanent obstruction.
    if let Some(marker) = marker {
        if retained.authority == TeardownAuthority::RetainedObjectsOnly && retained.marker.is_none()
        {
            return Err(StagingResidue::ForeignEntry);
        }
        // Anything at all may have arrived while the output tree was going, and
        // the root would then refuse to go with the marker already spent —
        // leaving a directory nothing can prove was ever MSCanvas's. One more
        // listing keeps the proof together with the residue. It does not close
        // the interval between this listing and the two calls below; it removes
        // the one that spans an entire tree's removal.
        let remaining = enumerate_children(&root)?;
        if let Some(unexpected) = remaining
            .iter()
            .find(|child| !child.name_is(STAGING_OWNER_MARKER))
        {
            return Err(if unexpected.name_is(STAGING_OUTPUT_DIRECTORY) {
                StagingResidue::NotRemoved {
                    kind: io::ErrorKind::DirectoryNotEmpty,
                }
            } else {
                StagingResidue::ForeignEntry
            });
        }
        let path = root_path.join(STAGING_OWNER_MARKER);
        let opened = resolve_child(
            &path,
            &marker,
            retained.marker.take(),
            ChildPosture::RegularFile,
            volume,
        )?;
        dispose_and_close(opened)?;
    }
    dispose_and_close(root)
}

/// Uses the object a run has held since it made it, or opens and proves one.
///
/// A retained handle is still checked against the listing, because an entry
/// under that name which is not the held object would mean the directory now
/// contains something this run did not create.
#[cfg(windows)]
fn resolve_child(
    path: &Path,
    enumerated: &EnumeratedChild,
    retained: Option<File>,
    posture: ChildPosture,
    parent_volume: u64,
) -> Result<File, StagingResidue> {
    let Some(retained) = retained else {
        return open_verified_child(path, enumerated, posture, parent_volume);
    };
    // A retained object is pinned, so the listing cannot describe a different
    // one at that name while this run holds it. The checks are made anyway, and
    // are exactly the ones the opened path makes, so the two cannot drift.
    if enumerated.is_reparse_point {
        return Err(StagingResidue::ReparsePointEncountered);
    }
    let expected_directory = match posture {
        ChildPosture::RegularFile => false,
        ChildPosture::Directory => true,
        ChildPosture::AsEnumerated => enumerated.is_directory,
    };
    if retained.metadata().map_err(residue_for)?.is_dir() != expected_directory {
        return Err(StagingResidue::IdentityChanged);
    }
    let (volume, file_id) = full_identity(&retained).map_err(residue_for)?;
    if file_id != enumerated.identity || volume != parent_volume {
        return Err(StagingResidue::IdentityChanged);
    }
    Ok(retained)
}

/// Removes a staging root that is already empty.
#[cfg(windows)]
pub(super) fn dispose_empty_root(root: File, _root_path: &Path) -> Result<(), StagingResidue> {
    dispose_and_close(root)
}

/// Decides whether an opened staging root is one this boundary made.
///
/// Every judgement is made through opened objects: the listing comes from the
/// root handle, and the marker is opened, proved to be the entry that was
/// listed, and read through that same handle. A name is never the evidence.
#[cfg(windows)]
pub(super) fn admit_staging_root(root: &File, root_path: &Path, magic: &[u8]) -> StagingAdmission {
    use std::io::Read;

    let children = match enumerate_children(root) {
        Ok(children) => children,
        Err(residue) => return StagingAdmission::NotInspectable(residue),
    };
    if children.is_empty() {
        return StagingAdmission::Empty;
    }
    let Some(entry) = children
        .iter()
        .find(|child| child.name_is(STAGING_OWNER_MARKER))
    else {
        return StagingAdmission::NotOwned;
    };
    if entry.is_directory || entry.is_reparse_point {
        return StagingAdmission::NotOwned;
    }

    let path = root_path.join(STAGING_OWNER_MARKER);
    let mut opened = match open_verified_marker(&path, entry) {
        Ok(opened) => opened,
        Err(StagingResidue::IdentityChanged | StagingResidue::ReparsePointEncountered) => {
            return StagingAdmission::NotOwned;
        }
        Err(residue) => return StagingAdmission::NotInspectable(residue),
    };

    // Read through the object that was proved, not through the name again.
    let mut content = Vec::new();
    if let Err(error) = opened.by_ref().take(64).read_to_end(&mut content) {
        return StagingAdmission::NotInspectable(residue_for(error));
    }
    if content != magic {
        return StagingAdmission::NotOwned;
    }
    StagingAdmission::Owned(opened)
}

/// Opens the marker for reading as well as removal, so admission reads the same
/// object teardown will delete.
#[cfg(windows)]
fn open_verified_marker(path: &Path, enumerated: &EnumeratedChild) -> Result<File, StagingResidue> {
    use std::os::windows::fs::MetadataExt;
    use std::os::windows::fs::OpenOptionsExt;

    const FILE_GENERIC_READ: u32 = 0x0012_0089;
    const DELETE: u32 = 0x0001_0000;
    const FILE_SHARE_READ: u32 = 0x0000_0001;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;

    if enumerated.is_reparse_point {
        return Err(StagingResidue::ReparsePointEncountered);
    }
    let opened = std::fs::OpenOptions::new()
        .read(true)
        .access_mode(FILE_GENERIC_READ | DELETE)
        .share_mode(FILE_SHARE_READ)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(residue_for)?;
    let metadata = opened.metadata().map_err(residue_for)?;
    if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 || metadata.is_dir() {
        return Err(StagingResidue::ReparsePointEncountered);
    }
    let (_, file_id) = full_identity(&opened).map_err(residue_for)?;
    if file_id != enumerated.identity {
        return Err(StagingResidue::IdentityChanged);
    }
    Ok(opened)
}

/// Removes an owned staging area.
///
/// No platform outside Windows offers a removal bound to the opened object
/// through the standard library, so this is the ordinary path-based teardown
/// and the guarantee built on it is narrower. It is not described as the same
/// one. The ordering that keeps residue reclaimable is preserved.
#[cfg(not(windows))]
pub(super) fn tear_down_owned_staging(
    root: File,
    root_path: &Path,
    retained: RetainedStagingObjects,
) -> Result<(), StagingResidue> {
    tear_down_owned_staging_seamed(root, root_path, retained, &mut || {})
}

#[cfg(not(windows))]
pub(super) fn tear_down_owned_staging_seamed(
    root: File,
    root_path: &Path,
    retained: RetainedStagingObjects,
    after_enumeration: &mut dyn FnMut(),
) -> Result<(), StagingResidue> {
    after_enumeration();
    // The same rule as on Windows, even though everything below it is weaker: a
    // live run removes only what it created and held.
    let output_path = root_path.join(STAGING_OUTPUT_DIRECTORY);
    if retained.authority == TeardownAuthority::RetainedObjectsOnly
        && retained.output.is_none()
        && output_path.exists()
    {
        return Err(StagingResidue::ForeignEntry);
    }
    drop(retained.output);
    drop(retained.marker);
    drop(root);
    residue(std::fs::remove_dir_all(output_path))?;
    residue(std::fs::remove_file(root_path.join(STAGING_OWNER_MARKER)))?;
    residue(std::fs::remove_dir(root_path))
}

#[cfg(not(windows))]
fn residue(removal: io::Result<()>) -> Result<(), StagingResidue> {
    match removal {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(StagingResidue::NotRemoved { kind: error.kind() }),
    }
}

/// What one enumeration record said about a child, before anything was opened.
#[cfg(windows)]
#[derive(Clone)]
struct EnumeratedChild {
    name: std::ffi::OsString,
    /// The 128-bit identity the parent directory reported. An opened object has
    /// to match this or it is not the child that was enumerated.
    ///
    /// The full width is deliberate. The 64-bit form is equal to the low half
    /// of this one on NTFS, but that is product behavior rather than contract,
    /// and a boundary should not rest on a filesystem coincidence.
    identity: [u8; 16],
    is_directory: bool,
    is_reparse_point: bool,
}

#[cfg(windows)]
impl EnumeratedChild {
    fn name_is(&self, expected: &str) -> bool {
        self.name == std::ffi::OsStr::new(expected)
    }
}

/// What a child must turn out to be once it is open.
#[cfg(windows)]
#[derive(Clone, Copy, PartialEq, Eq)]
enum ChildPosture {
    RegularFile,
    Directory,
    /// Either, decided by what the enumeration reported.
    AsEnumerated,
}

/// One directory the engine is holding, and how far through it teardown is.
#[cfg(windows)]
struct Frame {
    /// `None` for the directory the caller asked to empty, which stays.
    handle: Option<File>,
    path: std::path::PathBuf,
    children: Vec<EnumeratedChild>,
    next: usize,
}

/// Removes every child of an owned directory, leaving the directory itself.
///
/// The traversal is an explicit stack rather than recursion, so an arbitrary
/// backend tree cannot exhaust the call stack, and it is post-order: a directory
/// is deleted only once every one of its children has been deleted and closed.
#[cfg(windows)]
fn empty_directory_tree(
    top: &File,
    top_path: &Path,
    volume: u64,
    after_enumeration: &mut dyn FnMut(),
) -> Result<(), StagingResidue> {
    let children = enumerate_children(top)?;
    after_enumeration();
    let mut stack = vec![Frame {
        handle: None,
        path: top_path.to_path_buf(),
        children,
        next: 0,
    }];

    while let Some(frame) = stack.last_mut() {
        let Some(child) = frame.children.get(frame.next).cloned() else {
            let finished = stack.pop().expect("the frame was just observed");
            match finished.handle {
                // Every child is gone, so this directory can go too.
                Some(handle) => dispose_and_close(handle)?,
                // The directory the caller keeps.
                None => return Ok(()),
            }
            continue;
        };
        frame.next += 1;

        let child_path = frame.path.join(&child.name);
        let opened = open_verified_child(&child_path, &child, ChildPosture::AsEnumerated, volume)?;
        if child.is_directory {
            if stack.len() >= MAX_STAGING_DEPTH {
                return Err(StagingResidue::TraversalLimitReached);
            }
            let children = enumerate_children(&opened)?;
            after_enumeration();
            stack.push(Frame {
                handle: Some(opened),
                path: child_path,
                children,
                next: 0,
            });
        } else {
            dispose_and_close(opened)?;
        }
    }

    Ok(())
}

/// Opens a child, follows nothing, and proves it is the object enumeration saw.
///
/// A reparse point is refused rather than removed. Deleting the link alone would
/// be safe, but refusing is the rule this boundary keeps when it cannot account
/// for what it is looking at: nothing here has to be clever about a link that
/// MSCanvas did not create.
#[cfg(windows)]
fn open_verified_child(
    path: &Path,
    enumerated: &EnumeratedChild,
    posture: ChildPosture,
    parent_volume: u64,
) -> Result<File, StagingResidue> {
    use std::os::windows::fs::MetadataExt;
    use std::os::windows::fs::OpenOptionsExt;

    const FILE_LIST_DIRECTORY: u32 = 0x0000_0001;
    const FILE_READ_ATTRIBUTES: u32 = 0x0000_0080;
    const DELETE: u32 = 0x0001_0000;
    const SYNCHRONIZE: u32 = 0x0010_0000;
    const FILE_SHARE_READ: u32 = 0x0000_0001;
    const FILE_SHARE_WRITE: u32 = 0x0000_0002;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;

    if enumerated.is_reparse_point {
        return Err(StagingResidue::ReparsePointEncountered);
    }

    // Delete sharing is withheld: from here until this object is gone, nothing
    // else may rename, replace or unlink it, so the identity proved below stays
    // the identity that is deleted. Readers and writers are still admitted,
    // because neither can make it a different object.
    let mut access = FILE_READ_ATTRIBUTES | DELETE | SYNCHRONIZE;
    if enumerated.is_directory {
        access |= FILE_LIST_DIRECTORY;
    }
    let opened = std::fs::OpenOptions::new()
        .read(true)
        .access_mode(access)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(residue_for)?;

    let metadata = opened.metadata().map_err(residue_for)?;
    if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err(StagingResidue::ReparsePointEncountered);
    }
    let expected_directory = match posture {
        ChildPosture::RegularFile => false,
        ChildPosture::Directory => true,
        ChildPosture::AsEnumerated => enumerated.is_directory,
    };
    if metadata.is_dir() != expected_directory {
        return Err(StagingResidue::IdentityChanged);
    }

    // The name reached an object; only its identity says it is the right one.
    // `FILE_ID_INFO` documents this pairing as what uniquely identifies a file:
    // the 128-bit id together with the volume it lives on.
    let (volume, file_id) = full_identity(&opened).map_err(residue_for)?;
    if file_id != enumerated.identity || volume != parent_volume {
        return Err(StagingResidue::IdentityChanged);
    }
    Ok(opened)
}

/// Removes one owned object: a regular file, or a directory already emptied.
#[cfg(windows)]
fn dispose_and_close(object: File) -> Result<(), StagingResidue> {
    set_delete_disposition(&object).map_err(residue_for)?;
    // The name does not leave its parent until the last handle closes, so this
    // close is part of the deletion rather than tidiness after it.
    drop(object);
    Ok(())
}

#[cfg(windows)]
fn residue_for(error: io::Error) -> StagingResidue {
    StagingResidue::NotRemoved { kind: error.kind() }
}

/// The volume serial and 128-bit file identity of an open object.
#[cfg(windows)]
pub(super) fn full_identity(object: &File) -> io::Result<(u64, [u8; 16])> {
    use std::ffi::c_void;
    use std::mem::size_of;
    use std::os::windows::io::AsRawHandle;

    /// `FileIdInfo` in `FILE_INFO_BY_HANDLE_CLASS`.
    const FILE_ID_INFO_CLASS: i32 = 0x12;

    #[repr(C)]
    #[derive(Default)]
    struct FileIdInformation {
        volume_serial_number: u64,
        file_id: [u8; 16],
    }

    #[cfg(all(target_env = "msvc", target_pointer_width = "64"))]
    const _: [(); 24] = [(); size_of::<FileIdInformation>()];

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
    // SAFETY: `object` owns a live handle and `information` is the exact repr(C)
    // FILE_ID_INFO buffer the class requires for the duration of the call.
    let queried = unsafe {
        get_file_information_by_handle_ex(
            object.as_raw_handle(),
            FILE_ID_INFO_CLASS,
            (&raw mut information).cast(),
            u32::try_from(size_of::<FileIdInformation>()).expect("FILE_ID_INFO fits in DWORD"),
        )
    };
    if queried == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok((information.volume_serial_number, information.file_id))
}

/// Marks the exact object a handle names for deletion.
///
/// POSIX semantics are asked for first, because they are the only form under
/// which closing *this* handle is enough to free the name in the parent.
/// Without them any third party's handle keeps the directory entry alive, and
/// the parent's own removal then fails with `ERROR_DIR_NOT_EMPTY` through no
/// fault of the ordering here. The read-only flag removes the other avoidable
/// refusal. The fallback exists because filesystems that do not implement the
/// newer class are real.
#[cfg(windows)]
pub(super) fn set_delete_disposition(object: &File) -> io::Result<()> {
    use std::ffi::c_void;
    use std::mem::size_of;
    use std::os::windows::io::AsRawHandle;

    /// `FileDispositionInfo` and `FileDispositionInfoEx`.
    const FILE_DISPOSITION_INFO_CLASS: i32 = 4;
    const FILE_DISPOSITION_INFO_EX_CLASS: i32 = 21;
    const FILE_DISPOSITION_FLAG_DELETE: u32 = 0x0000_0001;
    const FILE_DISPOSITION_FLAG_POSIX_SEMANTICS: u32 = 0x0000_0002;
    const FILE_DISPOSITION_FLAG_IGNORE_READONLY_ATTRIBUTE: u32 = 0x0000_0010;
    /// The three ways a filesystem says it does not implement the class.
    const ERROR_INVALID_FUNCTION: i32 = 1;
    const ERROR_NOT_SUPPORTED: i32 = 50;
    const ERROR_INVALID_PARAMETER: i32 = 87;

    #[repr(C)]
    struct FileDispositionInformation {
        delete_file: u8,
    }

    #[repr(C)]
    struct FileDispositionInformationEx {
        flags: u32,
    }

    #[cfg(all(target_env = "msvc", target_pointer_width = "64"))]
    const _: [(); 1] = [(); size_of::<FileDispositionInformation>()];
    #[cfg(all(target_env = "msvc", target_pointer_width = "64"))]
    const _: [(); 4] = [(); size_of::<FileDispositionInformationEx>()];

    #[link(name = "kernel32")]
    unsafe extern "system" {
        #[link_name = "SetFileInformationByHandle"]
        fn set_file_information_by_handle(
            file: *mut c_void,
            information_class: i32,
            information: *mut c_void,
            information_size: u32,
        ) -> i32;
    }

    let mut extended = FileDispositionInformationEx {
        flags: FILE_DISPOSITION_FLAG_DELETE
            | FILE_DISPOSITION_FLAG_POSIX_SEMANTICS
            | FILE_DISPOSITION_FLAG_IGNORE_READONLY_ATTRIBUTE,
    };
    // SAFETY: `object` owns a live handle and `extended` is the exact repr(C)
    // FILE_DISPOSITION_INFO_EX buffer the class requires for the call.
    let disposed = unsafe {
        set_file_information_by_handle(
            object.as_raw_handle(),
            FILE_DISPOSITION_INFO_EX_CLASS,
            (&raw mut extended).cast(),
            u32::try_from(size_of::<FileDispositionInformationEx>())
                .expect("FILE_DISPOSITION_INFO_EX fits in DWORD"),
        )
    };
    if disposed != 0 {
        return Ok(());
    }
    // Read before anything else can clobber the thread's last error.
    let refused = io::Error::last_os_error();
    if !matches!(
        refused.raw_os_error(),
        Some(ERROR_INVALID_FUNCTION | ERROR_NOT_SUPPORTED | ERROR_INVALID_PARAMETER)
    ) {
        return Err(refused);
    }

    let mut plain = FileDispositionInformation { delete_file: 1 };
    // SAFETY: as above, for the one-byte FILE_DISPOSITION_INFO.
    let disposed = unsafe {
        set_file_information_by_handle(
            object.as_raw_handle(),
            FILE_DISPOSITION_INFO_CLASS,
            (&raw mut plain).cast(),
            u32::try_from(size_of::<FileDispositionInformation>())
                .expect("FILE_DISPOSITION_INFO fits in DWORD"),
        )
    };
    if disposed == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

/// Lists the immediate children of a directory through its own handle.
///
/// No path is resolved. What comes back is what that directory object contains,
/// including the 128-bit identity each child had at that moment, which is the
/// only thing a later open is allowed to be checked against.
#[cfg(windows)]
fn enumerate_children(directory: &File) -> Result<Vec<EnumeratedChild>, StagingResidue> {
    use std::ffi::{OsStr, OsString, c_void};
    use std::mem::{align_of, offset_of, size_of};
    use std::os::windows::ffi::OsStringExt;
    use std::os::windows::io::AsRawHandle;

    /// `FileIdExtdDirectoryInfo` and its restart form. The extended class is
    /// the one that reports the full 128-bit identity, which is the same value
    /// space `FILE_ID_INFO` answers with on an opened object; the older class
    /// reports 64 bits whose relationship to it is NTFS product behavior rather
    /// than contract.
    const FILE_ID_EXTD_DIRECTORY_INFO_CLASS: i32 = 19;
    const FILE_ID_EXTD_DIRECTORY_RESTART_INFO_CLASS: i32 = 20;
    const ERROR_NO_MORE_FILES: i32 = 18;
    const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x0000_0010;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;

    /// The fixed prefix of `FILE_ID_EXTD_DIR_INFO`. The trailing `FileName` is a
    /// variable-length array each record sizes itself, so it is read through a
    /// byte offset rather than as a struct field.
    #[repr(C)]
    struct FileIdExtdDirectoryInformation {
        next_entry_offset: u32,
        file_index: u32,
        creation_time: i64,
        last_access_time: i64,
        last_write_time: i64,
        change_time: i64,
        end_of_file: i64,
        allocation_size: i64,
        file_attributes: u32,
        file_name_length: u32,
        ea_size: u32,
        reparse_point_tag: u32,
        file_id: [u8; 16],
        file_name: [u16; 1],
    }

    const FILE_NAME_OFFSET: usize = offset_of!(FileIdExtdDirectoryInformation, file_name);
    const HEADER_BYTES: usize = size_of::<FileIdExtdDirectoryInformation>();

    #[cfg(all(target_env = "msvc", target_pointer_width = "64"))]
    const _: [(); 96] = [(); HEADER_BYTES];
    #[cfg(all(target_env = "msvc", target_pointer_width = "64"))]
    const _: [(); 8] = [(); align_of::<FileIdExtdDirectoryInformation>()];
    #[cfg(all(target_env = "msvc", target_pointer_width = "64"))]
    const _: [(); 60] = [(); offset_of!(FileIdExtdDirectoryInformation, file_name_length)];
    #[cfg(all(target_env = "msvc", target_pointer_width = "64"))]
    const _: [(); 72] = [(); offset_of!(FileIdExtdDirectoryInformation, file_id)];
    #[cfg(all(target_env = "msvc", target_pointer_width = "64"))]
    const _: [(); 88] = [(); FILE_NAME_OFFSET];

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

    // A `u64` element type gives the eight-byte alignment the documented entry
    // layout asks for, and 64 KiB is large enough that a maximal entry can
    // always fit — so a short-buffer answer stays a hard refusal rather than a
    // branch that could silently truncate the view of a directory.
    let mut buffer = vec![0_u64; 8 * 1024];
    let capacity = buffer.len() * size_of::<u64>();
    let information_size = u32::try_from(capacity).expect("the buffer fits a DWORD");
    let mut children: Vec<EnumeratedChild> = Vec::new();
    // The first call restarts the directory cursor, so an enumeration never
    // resumes one that something else left part-way through.
    let mut class = FILE_ID_EXTD_DIRECTORY_RESTART_INFO_CLASS;

    loop {
        // SAFETY: `directory` owns a live handle and the buffer is a correctly
        // aligned writable region of exactly `information_size` bytes.
        let listed = unsafe {
            get_file_information_by_handle_ex(
                directory.as_raw_handle(),
                class,
                buffer.as_mut_ptr().cast(),
                information_size,
            )
        };
        if listed == 0 {
            // Read before anything else can clobber the thread's last error.
            let error = io::Error::last_os_error();
            if error.raw_os_error() == Some(ERROR_NO_MORE_FILES) {
                return Ok(children);
            }
            return Err(residue_for(error));
        }
        class = FILE_ID_EXTD_DIRECTORY_INFO_CLASS;

        let base: *const u8 = buffer.as_ptr().cast();
        let mut cursor = 0_usize;
        loop {
            // The fixed prefix must lie wholly inside the buffer before any
            // field of it is read. A malformed or hostile length refuses the
            // whole enumeration; it never reads past the buffer.
            let header_end = cursor
                .checked_add(HEADER_BYTES)
                .ok_or(StagingResidue::NotEnumerable)?;
            if header_end > capacity {
                return Err(StagingResidue::NotEnumerable);
            }

            // SAFETY: the prefix was just proven to lie inside the buffer, which
            // the API filled with `FILE_ID_EXTD_DIR_INFO` records. Every field
            // is read unaligned because filesystem drivers have been observed to
            // violate the documented eight-byte entry alignment, which the
            // standard library also defends against.
            let (next_entry_offset, file_attributes, file_name_length, file_id, name_base) = unsafe {
                let record = base.add(cursor).cast::<FileIdExtdDirectoryInformation>();
                (
                    (&raw const (*record).next_entry_offset).read_unaligned(),
                    (&raw const (*record).file_attributes).read_unaligned(),
                    (&raw const (*record).file_name_length).read_unaligned(),
                    (&raw const (*record).file_id).read_unaligned(),
                    base.add(cursor).add(FILE_NAME_OFFSET),
                )
            };

            // The length counts bytes and excludes any terminator.
            let name_bytes =
                usize::try_from(file_name_length).map_err(|_| StagingResidue::NotEnumerable)?;
            if name_bytes % size_of::<u16>() != 0 {
                return Err(StagingResidue::NotEnumerable);
            }
            let name_end = cursor
                .checked_add(FILE_NAME_OFFSET)
                .and_then(|start| start.checked_add(name_bytes))
                .ok_or(StagingResidue::NotEnumerable)?;
            if name_end > capacity {
                return Err(StagingResidue::NotEnumerable);
            }

            // SAFETY: the name's last byte was just proven to lie inside the
            // buffer, and its length is a whole number of UTF-16 units. The
            // copy is byte-wise because `cursor` accumulates driver-supplied
            // offsets, so the trailing array is not necessarily two-byte
            // aligned — the same reason every scalar above is read unaligned.
            let mut units = vec![0_u16; name_bytes / size_of::<u16>()];
            unsafe {
                std::ptr::copy_nonoverlapping(
                    name_base,
                    units.as_mut_ptr().cast::<u8>(),
                    name_bytes,
                );
            }
            let name = OsString::from_wide(&units);

            // A name is only ever joined onto a directory path, so anything
            // that is not one plain component is refused before it can be. The
            // identity check would catch an escape afterwards; this is the
            // layer that stops it being attempted.
            if units.iter().any(|unit| matches!(unit, 0 | 0x2F | 0x5C)) {
                return Err(StagingResidue::NotEnumerable);
            }
            // This class returns the dot entries, and descending into `..`
            // would leave the tree altogether.
            if name != OsStr::new(".") && name != OsStr::new("..") {
                if children.len() >= MAX_ENTRIES_PER_DIRECTORY {
                    return Err(StagingResidue::TraversalLimitReached);
                }
                children.push(EnumeratedChild {
                    name,
                    identity: file_id,
                    is_directory: file_attributes & FILE_ATTRIBUTE_DIRECTORY != 0,
                    is_reparse_point: file_attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0,
                });
            }

            if next_entry_offset == 0 {
                break;
            }
            // A forward step shorter than one record is what turns a malformed
            // chain into an endless reparse of the same bytes.
            let step =
                usize::try_from(next_entry_offset).map_err(|_| StagingResidue::NotEnumerable)?;
            if step < HEADER_BYTES {
                return Err(StagingResidue::NotEnumerable);
            }
            cursor = cursor
                .checked_add(step)
                .ok_or(StagingResidue::NotEnumerable)?;
            if cursor >= capacity {
                return Err(StagingResidue::NotEnumerable);
            }
        }
    }
}

/// Removes a staging root that is already empty.
#[cfg(not(windows))]
pub(super) fn dispose_empty_root(root: File, root_path: &Path) -> Result<(), StagingResidue> {
    drop(root);
    residue(std::fs::remove_dir(root_path))
}

/// Decides whether a staging root is one this boundary made.
///
/// This platform has no object-bound open, so the judgement is the same
/// name-based one it has always been, and the guarantee built on it is
/// correspondingly narrower.
#[cfg(not(windows))]
pub(super) fn admit_staging_root(_root: &File, root_path: &Path, magic: &[u8]) -> StagingAdmission {
    let mut entries = match std::fs::read_dir(root_path) {
        Ok(entries) => entries,
        Err(error) => return StagingAdmission::NotInspectable(residue_of(error)),
    };
    match entries.next() {
        None => return StagingAdmission::Empty,
        Some(Err(error)) => return StagingAdmission::NotInspectable(residue_of(error)),
        Some(Ok(_)) => {}
    }
    let path = root_path.join(STAGING_OWNER_MARKER);
    let metadata = match std::fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(_) => return StagingAdmission::NotOwned,
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return StagingAdmission::NotOwned;
    }
    match std::fs::read(&path) {
        Ok(content) if content == magic => match File::open(&path) {
            Ok(opened) => StagingAdmission::Owned(opened),
            Err(error) => StagingAdmission::NotInspectable(residue_of(error)),
        },
        Ok(_) => StagingAdmission::NotOwned,
        Err(error) => StagingAdmission::NotInspectable(residue_of(error)),
    }
}

#[cfg(not(windows))]
fn residue_of(error: io::Error) -> StagingResidue {
    StagingResidue::NotRemoved { kind: error.kind() }
}

/// The measurements this teardown is built on, kept honest the same way
/// `a_root_directory_relative_rename_is_unavailable` keeps finalization's.
///
/// A directory with any child refuses deletion, so teardown must be post-order;
/// and a name marked for deletion leaves its parent when the marking handle
/// closes, so closing each child is part of the deletion rather than tidiness
/// afterwards. If either stops holding, the ordering above is the wrong one and
/// this fails before anything else does.
#[cfg(all(test, windows))]
#[test]
fn the_deletion_semantics_this_teardown_relies_on() {
    use std::os::windows::fs::OpenOptionsExt;

    const ERROR_DIR_NOT_EMPTY: i32 = 145;
    const DELETE: u32 = 0x0001_0000;
    const SYNCHRONIZE: u32 = 0x0010_0000;
    const FILE_LIST_DIRECTORY: u32 = 0x0000_0001;
    const FILE_READ_ATTRIBUTES: u32 = 0x0000_0080;
    const FILE_SHARE_READ: u32 = 0x0000_0001;
    const FILE_SHARE_WRITE: u32 = 0x0000_0002;
    const FILE_SHARE_DELETE: u32 = 0x0000_0004;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock after Unix epoch")
        .as_nanos();
    let root = std::env::temp_dir().join(format!(
        "mscanvas-deletion-semantics-{}-{timestamp}",
        std::process::id()
    ));
    std::fs::create_dir(&root).expect("create the probe root");
    let child = root.join("child.bin");
    std::fs::write(&child, b"child").expect("write the probe child");

    let open_directory = || {
        std::fs::OpenOptions::new()
            .read(true)
            .access_mode(FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES | DELETE | SYNCHRONIZE)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
            .open(&root)
            .expect("open the probe root")
    };

    // A directory with any child refuses to go.
    let directory = open_directory();
    let refused =
        set_delete_disposition(&directory).expect_err("a populated directory was removed");
    assert_eq!(
        refused.raw_os_error(),
        Some(ERROR_DIR_NOT_EMPTY),
        "a populated directory refused deletion for an unexpected reason: {refused}"
    );
    drop(directory);
    assert!(root.is_dir(), "the refused directory went anyway");

    // Somebody else holds the child, sharing everything. POSIX semantics are
    // asked for first because they are the only form under which closing *our*
    // handle is enough to free the name; the fallback waits for the last handle,
    // which is a slower outcome rather than a wrong one.
    let third_party = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
        .open(&child)
        .expect("hold the probe child open");
    let ours = std::fs::OpenOptions::new()
        .read(true)
        .access_mode(FILE_READ_ATTRIBUTES | DELETE | SYNCHRONIZE)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(&child)
        .expect("open the probe child for deletion");
    set_delete_disposition(&ours).expect("mark the probe child");
    drop(ours);

    let directory = open_directory();
    let parent = set_delete_disposition(&directory);
    drop(directory);
    if child.exists() {
        // The fallback was taken. The name is still there, so the parent must
        // still refuse — which is exactly the situation POSIX semantics avoid.
        assert_eq!(
            parent
                .expect_err("an occupied directory was removed")
                .raw_os_error(),
            Some(ERROR_DIR_NOT_EMPTY),
        );
        drop(third_party);
        let directory = open_directory();
        set_delete_disposition(&directory).expect("remove the emptied probe root");
        drop(directory);
    } else {
        parent.expect("remove the emptied probe root");
        drop(third_party);
    }
    assert!(!root.exists(), "the probe root outlived its own deletion");
}
