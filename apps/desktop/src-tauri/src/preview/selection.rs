//! Selection and validation of the one local mzML file a session works on.
//!
//! Rust owns the path. The webview receives an opaque handle and a display
//! name, never an absolute path, and the file itself is only ever read.

use std::collections::HashMap;
use std::ffi::OsString;
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use super::dto::{
    MAX_CANDIDATE_NAME_CHARS, MAX_RELATIVE_CONTEXT_CHARS, MAX_WORKSPACE_DATASETS, PreviewErrorDto,
    SelectedFileDto, bounded_text,
};

/// What the filesystem itself calls one file, wide enough to be told apart from
/// every other file on its volume.
///
/// The whole Windows file ID, not the 64-bit index `GetFileInformationByHandle`
/// returns: that index is documented as unique only on volumes that have one,
/// and ReFS is the counter-example the API's own successor exists for. While
/// this only rechecked a single open handle, a truncated key cost at most a
/// missed replacement; as the key that decides whether two chosen files are the
/// same acquisition, it would merge two of them into one.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub(super) struct FileIdentity {
    volume_serial: u64,
    file_id: [u8; 16],
}

impl FileIdentity {
    /// Builds an identity from what a filesystem answered.
    ///
    /// Folder discovery needs one for a directory it is holding open and one
    /// for the entry its parent described, so that it can refuse a child that
    /// is no longer the object it was told about.
    pub(super) fn new(volume_serial: u64, file_id: [u8; 16]) -> Self {
        Self {
            volume_serial,
            file_id,
        }
    }

    /// The volume this identity belongs to.
    ///
    /// A directory enumeration record carries a file ID but no serial, because
    /// every entry is on the directory's own volume; this is how that serial is
    /// supplied to complete them.
    pub(super) fn volume_serial(self) -> u64 {
        self.volume_serial
    }
}

impl fmt::Debug for FileIdentity {
    /// Deliberately opaque. An identity is for comparing, and a `Debug` that
    /// printed it would put a machine-correlatable fingerprint of the user's
    /// file into any log, panic or assertion that touched one.
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("<opaque-file-identity>")
    }
}

#[cfg(test)]
impl FileIdentity {
    /// Builds one directly, for tests that need two identities differing in a
    /// chosen place rather than whatever the filesystem hands out.
    pub(super) const fn for_test(volume_serial: u64, file_id: [u8; 16]) -> Self {
        Self {
            volume_serial,
            file_id,
        }
    }
}

/// A live hold on the filesystem object an accepted file names.
///
/// An identity names an object only while that object exists. Once its last
/// name is gone and its last handle is closed, the filesystem is free to give
/// that identity to the next object it creates -- and a registry keyed by
/// identity would then read an unrelated acquisition as a duplicate of the row
/// that used to own it. Keeping the object itself alive for as long as a
/// dataset names it is what makes that impossible rather than unlikely.
///
/// A lifetime hold and nothing else. It caches no content, it is not the handle
/// a read goes through, and it does not make the remembered path trustworthy:
/// every use still canonicalises, reopens and revalidates. It is also not a
/// lock. The handle is opened sharing read, write and delete, so the user and
/// every other program may still rename, delete, replace, read and write the
/// file while MSCanvas lists it -- a workspace row is a row, and removing one
/// is the only thing that removes one.
///
/// One thing it does cost, named here rather than left to be found. This asks
/// for read access, and Windows will not grant a later open whose own share
/// mode refuses to share that read -- so a program that opens the file offering
/// no sharing at all is refused while a row names it, and the remedy is to
/// remove the row. A writer that shares reads, which is what an in-place edit
/// does, is unaffected. It is also the rule the release tests use to ask the
/// operating system whether a lease is still held. ADR 0006 records what
/// narrowing the access mask would cost instead.
///
/// Cloned by handle rather than by object: an `AcceptedFile` is cloned on every
/// use, and reopening the file each time would be one more resolution of a path
/// that is already being revalidated. The object is released when the last
/// clone is gone.
///
/// Windows is the only platform that takes a hold here. See `LeasedObject`.
#[derive(Clone)]
pub(super) struct FileIdentityLease {
    /// Closed by `Arc`'s own drop when the last holder lets go. There is no raw
    /// handle here to close by hand and no place one could be leaked from.
    ///
    /// Never read outside a test, and that is the whole point: holding it open
    /// is what this field does, and reading it would mean something was using
    /// the lease as a source to read from rather than as a lifetime.
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "the handle is held open, not read; only a test asks whether it is still there"
        )
    )]
    handle: Arc<LeasedObject>,
}

/// What a lease holds open: the accepted file itself, on the platform where a
/// handle is what keeps an object -- and so its identity -- from being recycled.
#[cfg(windows)]
type LeasedObject = std::fs::File;

/// Nothing, elsewhere, and deliberately.
///
/// This platform's inspection establishes posture and identity from the name
/// rather than through a handle, so it has none to hand over, and opening the
/// path a second time to make one is not safe from here: std offers no
/// non-blocking open, so a path replaced by a FIFO between the posture check and
/// that open would leave the request blocked for as long as no writer arrives --
/// forever, in the ordinary case, holding a worker with it. Introducing a way to
/// hang in order to pin an identity that nothing claims to pin is the wrong
/// trade.
///
/// The type stays uniform so the registry never has to know which platform it is
/// on, and ADR 0006 claims the identity guarantee for Windows only, which is the
/// platform this application ships on and the only one its CI builds.
#[cfg(not(windows))]
type LeasedObject = ();

impl FileIdentityLease {
    /// Takes the hold, on the platform that has one to take.
    #[cfg(windows)]
    fn new(handle: std::fs::File) -> Self {
        Self {
            handle: Arc::new(handle),
        }
    }

    /// The hold this platform can take, which is none. Named so that a reader
    /// meets the fact rather than infers it from a type alias.
    #[cfg(not(windows))]
    fn unheld() -> Self {
        Self {
            handle: Arc::new(()),
        }
    }

    /// A view of whether this lease's handle is still open anywhere.
    ///
    /// Weak on purpose: a test that held a strong reference would be the reason
    /// the handle stayed open, which is the opposite of what it is asking.
    #[cfg(test)]
    pub(super) fn witness(&self) -> LeaseWitness {
        LeaseWitness(Arc::downgrade(&self.handle))
    }
}

impl fmt::Debug for FileIdentityLease {
    /// Deliberately opaque, like everything else here. A handle value is a
    /// process-local number, but printing one invites a reader of a log to
    /// treat it as something to correlate, and it says nothing a reader needs.
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("<opaque-identity-lease>")
    }
}

/// Whether a lease that was taken has since been released.
///
/// Holds nothing open itself, so asking the question does not change the
/// answer.
#[cfg(test)]
#[derive(Clone)]
pub(super) struct LeaseWitness(std::sync::Weak<LeasedObject>);

#[cfg(test)]
impl LeaseWitness {
    /// True once every holder of the leased handle has let go, which is what
    /// closes it.
    pub(super) fn is_released(&self) -> bool {
        self.0.strong_count() == 0
    }
}

/// The only open format this slice accepts. mzXML and vendor acquisitions are
/// deliberately out of scope.
const ACCEPTED_EXTENSION: &str = "mzML";

/// Whether a name ends in the one extension this boundary opens.
///
/// Extracted rather than left inline because folder discovery has to ask the
/// same question of a name it found, and two spellings of "is this an mzML"
/// would be free to drift apart. It is a proposal either way: acceptance below
/// asks it of the canonical path and remains what actually decides.
pub(super) fn has_mzml_extension(path: &Path) -> bool {
    path.extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case(ACCEPTED_EXTENSION))
}

/// Validates a caller-supplied path and describes it without leaking it.
///
/// Extension and regular-file posture are checked here rather than in the
/// webview, so a frontend defect cannot widen what the backend will open.
pub fn accept_mzml_file(path: &Path) -> Result<AcceptedFile, PreviewErrorDto> {
    // Posture, length, identity and the lease that keeps that identity the
    // file's own all come from one inspection, so they describe the same file.
    // Establishing them separately would let a replacement land in between and
    // be accepted as what the user chose.
    let inspected = inspect_selected_file(path)?;

    let canonical = std::fs::canonicalize(path).map_err(|_| unresolvable())?;
    if !has_mzml_extension(&canonical) {
        return Err(PreviewErrorDto::new(
            "unsupported_extension",
            "MSCanvas opens .mzML files in this version.",
            false,
        ));
    }

    let file_name = canonical
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .ok_or_else(|| {
            PreviewErrorDto::new("file_has_no_name", "That path has no file name.", false)
        })?;

    Ok(AcceptedFile {
        path: canonical,
        file_name,
        byte_length: inspected.byte_length,
        identity: inspected.identity,
        lease: inspected.lease,
    })
}

/// What one inspection of the selected path established about it.
struct InspectedFile {
    byte_length: u64,
    identity: FileIdentity,
    /// The handle the two answers above came from, kept open. Held by whatever
    /// the inspection is for: an accepted file keeps it, and a caller that only
    /// wanted the identity drops it with the rest of this value.
    lease: FileIdentityLease,
}

/// Inspects the selected path through a single open handle, and hands that
/// handle back as the file's identity lease.
///
/// The handle is opened without following links, so the posture test sees the
/// name the user picked rather than whatever it points at, and the length and
/// filesystem identity that come back describe that same object. A path is not
/// an identity: another regular file can take the same name at any moment, and
/// two separate inspections would let it be accepted as the chosen one.
///
/// The same handle is what a registered dataset then holds, so the identity it
/// was accepted with stays that object's for as long as the dataset names it.
/// Opening a second handle for the lease would leave a gap between the two --
/// small, but exactly the gap the lease exists to close.
#[cfg(windows)]
fn inspect_selected_file(path: &Path) -> Result<InspectedFile, PreviewErrorDto> {
    use std::ffi::c_void;
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::AsRawHandle;

    /// Needed to open a directory at all, so one can be rejected by attribute
    /// rather than by a failure that reads like a missing file.
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    /// Opens a link itself rather than its target.
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x0000_0010;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;
    /// Read, write and delete. Permissive while inspecting, because another
    /// program holding the file open is not a reason to refuse to look at it --
    /// and permissive for as long as the lease is held afterwards, because
    /// MSCanvas listing a file must not be what stops its owner deleting,
    /// renaming or replacing it. The read window takes a stricter handle of its
    /// own, for the length of one read.
    const FILE_SHARE_ALL: u32 = 0x0000_0007;
    /// `FileIdInfo`, the information class that answers with the whole file ID.
    const FILE_ID_INFO_CLASS: i32 = 0x12;

    #[repr(C)]
    #[derive(Default)]
    struct FileTime {
        low: u32,
        high: u32,
    }

    #[repr(C)]
    #[derive(Default)]
    struct ByHandleFileInformation {
        file_attributes: u32,
        creation_time: FileTime,
        last_access_time: FileTime,
        last_write_time: FileTime,
        volume_serial_number: u32,
        file_size_high: u32,
        file_size_low: u32,
        number_of_links: u32,
        file_index_high: u32,
        file_index_low: u32,
    }

    #[repr(C)]
    #[derive(Default)]
    struct FileIdInformation {
        volume_serial_number: u64,
        file_id: [u8; 16],
    }

    // The equivalent std accessors are still unstable. The pair of calls is the
    // one the ProteoWizard crate makes for a source identity: attributes and
    // length from the first, the whole file ID from the second.
    #[link(name = "kernel32")]
    unsafe extern "system" {
        #[link_name = "GetFileInformationByHandle"]
        fn get_file_information_by_handle(
            file: *mut c_void,
            information: *mut ByHandleFileInformation,
        ) -> i32;

        #[link_name = "GetFileInformationByHandleEx"]
        fn get_file_information_by_handle_ex(
            file: *mut c_void,
            information_class: i32,
            information: *mut c_void,
            information_size: u32,
        ) -> i32;
    }

    let file = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_ALL)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(|_| unresolvable())?;

    let mut information = ByHandleFileInformation::default();
    // SAFETY: the file outlives the call, so its handle stays valid, and the
    // out parameter is a fully initialized value of the layout the API writes.
    let succeeded = unsafe {
        get_file_information_by_handle(file.as_raw_handle().cast(), &raw mut information)
    };
    if succeeded == 0 {
        return Err(PreviewErrorDto::new(
            "file_not_inspectable",
            "That file could not be inspected.",
            true,
        ));
    }

    if information.file_attributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT) != 0
    {
        return Err(not_a_regular_file());
    }

    let mut file_id_information = FileIdInformation::default();
    // SAFETY: the same live handle inspected above, and the out parameter is a
    // fully initialized value of the exact FILE_ID_INFO layout the class
    // requires, whose size is passed with it.
    let identified = unsafe {
        get_file_information_by_handle_ex(
            file.as_raw_handle().cast(),
            FILE_ID_INFO_CLASS,
            (&raw mut file_id_information).cast(),
            u32::try_from(std::mem::size_of::<FileIdInformation>())
                .expect("FILE_ID_INFO fits in a DWORD"),
        )
    };
    // A filesystem that cannot answer this one has no identity to bind to,
    // which is the same position as answering with nothing.
    if identified == 0 || file_id_information.file_id == [0; 16] {
        return Err(PreviewErrorDto::new(
            "file_identity_unavailable",
            "That file's identity could not be established, so MSCanvas did not open it.",
            false,
        ));
    }

    Ok(InspectedFile {
        byte_length: (u64::from(information.file_size_high) << 32)
            | u64::from(information.file_size_low),
        identity: FileIdentity {
            volume_serial: file_id_information.volume_serial_number,
            file_id: file_id_information.file_id,
        },
        // The very handle the two answers above were read through.
        lease: FileIdentityLease::new(file),
    })
}

#[cfg(not(windows))]
fn inspect_selected_file(path: &Path) -> Result<InspectedFile, PreviewErrorDto> {
    use mscanvas_proteowizard::is_reparse_point;
    use std::os::unix::fs::MetadataExt;

    // std offers no O_NOFOLLOW open, so the link test and the identity are
    // established separately here. The comparison on every use is what closes
    // the gap that leaves.
    let selected = std::fs::symlink_metadata(path).map_err(|_| unresolvable())?;
    if selected.file_type().is_symlink() || is_reparse_point(&selected) || !selected.is_file() {
        return Err(not_a_regular_file());
    }
    // Device and inode, which is what this platform has. They are carried in
    // the same value type so everything above can compare identities without
    // knowing the platform -- not because there is a file ID here to widen to.
    let mut file_id = [0_u8; 16];
    file_id[..8].copy_from_slice(&selected.ino().to_ne_bytes());
    Ok(InspectedFile {
        byte_length: selected.len(),
        identity: FileIdentity {
            volume_serial: selected.dev(),
            file_id,
        },
        // Nothing is held here, and `LeasedObject` says why: this inspection has
        // no handle to hand over, and opening the path again to make one would
        // introduce a way for a selection to hang. Unchanged from before the
        // lease existed, which is what this platform's coverage -- and ADR
        // 0006 -- already claim.
        lease: FileIdentityLease::unheld(),
    })
}

/// The filesystem's own identity for a path, for the generation stamp.
///
/// The same inspection acceptance uses, so the two can never disagree about
/// what identity a path has. Anything that is not an acceptable regular file
/// reports no identity, which a comparison reads as a change.
pub(super) fn file_identity(path: &Path) -> Option<FileIdentity> {
    inspect_selected_file(path)
        .ok()
        .map(|inspected| inspected.identity)
}

/// Holds the accepted file open in a way that blocks its replacement.
///
/// Comparing identity before and after a read cannot see a file that is
/// swapped away and swapped back while the read is in progress. A handle that
/// permits other readers but not deletion or rename removes that window
/// outright for as long as it is held.
///
/// Required, not best effort. The only way this open fails is that another
/// program already holds the file with an access this share mode will not
/// permit — which means the file is in use by a writer, and that is exactly
/// when a preview of it would be unreliable. Reading on anyway would drop the
/// guarantee at the moment it matters most.
#[cfg(windows)]
pub(super) fn lock_against_replacement(path: &Path) -> Result<std::fs::File, PreviewErrorDto> {
    use std::os::windows::fs::OpenOptionsExt;

    /// Other readers are welcome; writers, deletion and rename are not.
    const FILE_SHARE_READ: u32 = 0x0000_0001;

    std::fs::OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .open(path)
        .map_err(|_| {
            PreviewErrorDto::new(
                "source_in_use",
                "Another program is using that file, so MSCanvas did not read it. \
                 Try again once that program has finished with it.",
                true,
            )
        })
}

/// POSIX has no equivalent: a path can always be replaced out from under an
/// open descriptor, so there is no handle to require. The identity comparison
/// before and after the read is the guarantee there.
#[cfg(not(windows))]
pub(super) const fn lock_against_replacement(
    _path: &Path,
) -> Result<Option<std::fs::File>, PreviewErrorDto> {
    Ok(None)
}

/// Whether nothing at all is holding this file open.
///
/// Asked the one way Windows answers exactly: by requesting the object while
/// offering no sharing, which the system grants only when there is no existing
/// handle to conflict with. An identity lease asks to read, and a request that
/// shares nothing cannot coexist with a reader, so this is decided by the share
/// rules rather than by timing -- which is what makes it usable as a test of
/// whether a lease was released rather than a guess about when.
///
/// The handle it opens to find out is dropped before the answer is returned.
#[cfg(all(windows, test))]
pub(super) fn nothing_else_holds_open(path: &Path) -> bool {
    use std::os::windows::fs::OpenOptionsExt;

    std::fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(path)
        .is_ok()
}

fn unresolvable() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "file_not_resolvable",
        "That file could not be opened. It may have been moved or renamed.",
        true,
    )
}

fn not_a_regular_file() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "not_a_regular_file",
        "That path is not a regular file.",
        false,
    )
}

/// One file the session accepted, and the hold that keeps it the file it was.
///
/// Not comparable as a whole, deliberately. Two acceptances of one object are
/// the same file and hold different handles, so a derived equality would answer
/// that they differ. What callers compare is the path and the identity, which
/// is what `revalidate` does.
#[derive(Clone)]
pub struct AcceptedFile {
    path: PathBuf,
    file_name: String,
    byte_length: u64,
    identity: FileIdentity,
    /// Keeps the object alive, so `identity` above cannot come to name a
    /// different one while this file is registered.
    ///
    /// Never read: what it does is exist for as long as this value does, and
    /// go when it goes.
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "the lease is held for its lifetime, not read; only a test asks after it"
        )
    )]
    lease: FileIdentityLease,
}

impl fmt::Debug for AcceptedFile {
    /// Deliberately opaque. This holds the absolute path the boundary exists to
    /// keep in Rust, and a workspace holds one of these per dataset -- so a
    /// single `{:?}` of anything containing them would put the user's whole
    /// roster into a log or a panic message.
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("<opaque-accepted-file>")
    }
}

impl AcceptedFile {
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    #[must_use]
    pub fn file_name(&self) -> &str {
        &self.file_name
    }

    #[must_use]
    pub const fn byte_length(&self) -> u64 {
        self.byte_length
    }

    /// The filesystem identity this file was accepted with.
    #[must_use]
    pub(super) const fn identity(&self) -> FileIdentity {
        self.identity
    }

    /// Whether the hold this file was accepted with is still open.
    ///
    /// The lease itself is not reachable from here, in test builds or any
    /// other: a caller that could take a copy of it could keep an object alive
    /// past the row that named it, which is the failure this exists to watch
    /// for rather than to enable.
    #[cfg(test)]
    pub(super) fn lease_witness(&self) -> LeaseWitness {
        self.lease.witness()
    }
}

/// One dataset of a session, named by a number the session allocated.
///
/// Opaque, but not a secret. What stops a value from naming a file the user did
/// not choose is that only Rust can turn one into a path, and does so against a
/// registry that revalidates the file every time -- not that the number is hard
/// to guess. Never reused within the process, so a reply that arrives after its
/// dataset is gone cannot land on whatever was added next.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(super) struct DatasetId(u64);

/// The spelling the boundary already speaks. The frontend holds these strings
/// today, so the type is new and the wire is not.
const HANDLE_PREFIX: &str = "file-";

impl DatasetId {
    /// The handle string this dataset is known by outside Rust.
    pub(super) fn handle(self) -> String {
        format!("{HANDLE_PREFIX}{}", self.0)
    }

    /// Reads a handle the frontend sent back. Anything else is not a dataset
    /// this session ever allocated, which resolves like one that is gone.
    ///
    /// Byte-equal or nothing. `u64::from_str` also accepts a leading plus and
    /// leading zeros, so without the round-trip `file-0`, `file-00` and
    /// `file-+0` would all reach one dataset -- three spellings of a handle
    /// this session never issued, one of which would then come back in a reply
    /// as a fourth.
    pub(super) fn parse(handle: &str) -> Option<Self> {
        let id = Self(handle.strip_prefix(HANDLE_PREFIX)?.parse().ok()?);
        (id.handle() == handle).then_some(id)
    }
}

impl fmt::Debug for DatasetId {
    /// The number alone, which names a dataset and nothing about the file.
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "dataset-{}", self.0)
    }
}

/// How a dataset came to be in the session.
///
/// Private, never serialized, and not part of a dataset's identity: two names
/// for one acquisition are one row whichever route each name arrived by. It
/// exists for exactly one visible purpose -- telling two rows with the same
/// final filename apart -- and ADR 0006 permits that and nothing else.
#[derive(Clone, PartialEq, Eq)]
pub(super) enum DatasetOrigin {
    /// Named directly in the file picker. There is nowhere else to say it came
    /// from: the user pointed at the file, not at a tree containing it.
    Direct,
    /// Found under a folder the user chose, at these components below it.
    ///
    /// The *parent* components only, root name excluded and filename excluded.
    /// The filename is already on the accepted file, and repeating it here
    /// would make a display context that ends in the name it is disambiguating.
    /// Empty means the file sat at the top of the chosen folder.
    Folder { relative_parents: Vec<OsString> },
}

impl fmt::Debug for DatasetOrigin {
    /// Opaque about the folder half. Components under the user's chosen root
    /// are the one path-shaped thing this type holds, and a derived `Debug`
    /// would put them into the first log line or panic that touched a dataset.
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Direct => formatter.write_str("<direct>"),
            Self::Folder { relative_parents } => {
                write!(formatter, "<folder depth {}>", relative_parents.len())
            }
        }
    }
}

/// One accepted file, and the dataset the session knows it as.
#[derive(Clone)]
pub(super) struct RegisteredDataset {
    id: DatasetId,
    file: AcceptedFile,
    origin: DatasetOrigin,
}

impl RegisteredDataset {
    pub(super) const fn id(&self) -> DatasetId {
        self.id
    }

    pub(super) const fn file(&self) -> &AcceptedFile {
        &self.file
    }

    pub(super) const fn origin(&self) -> &DatasetOrigin {
        &self.origin
    }
}

impl fmt::Debug for RegisteredDataset {
    /// The dataset, never the file behind it.
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "<registered {:?}>", self.id())
    }
}

/// What adding a file to the workspace did.
///
/// A file that is already there is an ordinary answer rather than a failure:
/// the user asked for it to be in the workspace, and it is. Carries the dataset
/// it resolved to and nothing else -- no path, no identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum AddDatasetOutcome {
    Added {
        id: DatasetId,
    },
    Duplicate {
        existing_id: DatasetId,
    },
    /// The workspace already holds `MAX_WORKSPACE_DATASETS`, so this file was
    /// not added. Nothing was allocated and nothing was kept: the identifier
    /// sequence does not advance for a file the session refused, and the
    /// handle the candidate arrived holding is dropped with it.
    Full,
}

impl AddDatasetOutcome {
    /// The dataset the file is now known as, where there is one.
    ///
    /// For a caller that only needs to name the file it just added, adding and
    /// finding a duplicate answer the same question. Callers that must tell
    /// them apart -- the roster, which reports a duplicate rather than drawing
    /// a row -- match on the variants instead. A full workspace registered
    /// nothing, so there is nothing to name.
    pub(super) const fn registered_id(self) -> Option<DatasetId> {
        match self {
            Self::Added { id } | Self::Duplicate { existing_id: id } => Some(id),
            Self::Full => None,
        }
    }

    /// The dataset this outcome names, for the fixtures that cannot be full.
    ///
    /// Panics rather than defaulting, so a test that unexpectedly filled its
    /// workspace fails where it happened instead of quietly asserting about a
    /// dataset nothing registered.
    #[cfg(test)]
    pub(super) fn id(self) -> DatasetId {
        self.registered_id()
            .expect("this addition registered a dataset")
    }
}

/// Why a dataset stopped being part of the session.
///
/// Recorded because the three are different events to a reader of this code,
/// and none of them may carry a path or an operating-system message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum RevocationReason {
    /// The picker replaced the current selection, which is what it did before
    /// the roster existed. Retained for the focused regression coverage of that
    /// behaviour and reached from nowhere else.
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "the roster replaced the picker's replacement semantics"
        )
    )]
    ReplacedBySelection,
    /// The user removed this one dataset.
    Removed,
    /// The user emptied the workspace.
    Cleared,
}

/// The datasets a session holds, in the order they were added.
///
/// Holds no lock of its own. Removing a dataset has to reach its runtime state
/// in the same breath as its row, and a registry that locked itself would make
/// that two steps with a gap in between -- so the service owns one lock over
/// both.
#[derive(Default)]
pub(super) struct DatasetRegistry {
    /// Only ever counts up, including across an emptied workspace, so an
    /// identifier is never handed out twice in one process.
    next_id: u64,
    order: Vec<DatasetId>,
    datasets: HashMap<DatasetId, RegisteredDataset>,
    /// One filesystem object, one dataset. This is what makes two names for the
    /// same acquisition a duplicate rather than two rows.
    ///
    /// Every key here is an identity some row's lease is holding open. An
    /// identity names an object only while that object exists, and a filesystem
    /// is free to hand a deleted file's ID to the next one it creates -- so an
    /// index of identities nothing keeps alive would eventually answer for a
    /// file the user never added. The lease is what makes each key still its
    /// row's, and a replacement that arrives under a familiar name a different
    /// dataset rather than a duplicate of the one it replaced.
    by_identity: HashMap<FileIdentity, DatasetId>,
}

impl fmt::Debug for DatasetRegistry {
    /// How many, never which.
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let held = self.len();
        let noun = if held == 1 { "dataset" } else { "datasets" };
        write!(formatter, "<registry of {held} {noun}>")
    }
}

impl DatasetRegistry {
    /// Adds an accepted file, or reports the dataset it already is, or refuses
    /// it because the workspace is full.
    ///
    /// Takes the file by value, which is what keeps the handle count honest. A
    /// duplicate was accepted like any other file and arrived holding a lease
    /// of its own; returning here drops it, so the object ends up held once, by
    /// the row that already named it, rather than once per time the user
    /// happened to add it. A file refused for capacity is dropped the same way.
    ///
    /// Duplicates are decided before capacity, and the order is the point. A
    /// file already in a full workspace is still in it: answering "full" would
    /// tell the user to remove rows to make space for something that needs
    /// none, and would report a row they already have as a file they failed to
    /// add.
    pub(super) fn add_direct(&mut self, file: AcceptedFile) -> AddDatasetOutcome {
        self.add(file, DatasetOrigin::Direct)
    }

    /// Adds a file found under a folder the user chose, remembering where.
    ///
    /// The components are the parents below the chosen root, which is the only
    /// thing that can tell two rows with one filename apart. They are recorded
    /// even when nothing collides yet: whether a name is ambiguous is a
    /// property of the whole roster and changes as rows arrive and leave, so
    /// deciding it at insertion would be deciding it once for a question that
    /// keeps being asked.
    pub(super) fn add_discovered(
        &mut self,
        file: AcceptedFile,
        relative_parents: Vec<OsString>,
    ) -> AddDatasetOutcome {
        self.add(file, DatasetOrigin::Folder { relative_parents })
    }

    fn add(&mut self, file: AcceptedFile, origin: DatasetOrigin) -> AddDatasetOutcome {
        if let Some(&existing_id) = self.by_identity.get(&file.identity()) {
            // The existing row keeps the origin it was registered with. The
            // second name for one acquisition is not a second acquisition, and
            // rewriting where the row "came from" would move a user's row
            // under them because they happened to point at it twice.
            return AddDatasetOutcome::Duplicate { existing_id };
        }
        if self.order.len() >= MAX_WORKSPACE_DATASETS {
            return AddDatasetOutcome::Full;
        }
        let id = DatasetId(self.next_id);
        // Checked, so the invariant is absolute rather than nearly so. Wrapping
        // is the one way this allocator could hand out an identifier twice, and
        // a release build wraps silently.
        self.next_id = self
            .next_id
            .checked_add(1)
            .expect("a session cannot allocate more than u64::MAX datasets");
        self.by_identity.insert(file.identity(), id);
        self.datasets
            .insert(id, RegisteredDataset { id, file, origin });
        self.order.push(id);
        AddDatasetOutcome::Added { id }
    }

    pub(super) fn get(&self, id: DatasetId) -> Option<&RegisteredDataset> {
        self.datasets.get(&id)
    }

    pub(super) fn contains(&self, id: DatasetId) -> bool {
        self.datasets.contains_key(&id)
    }

    pub(super) fn len(&self) -> usize {
        self.order.len()
    }

    /// The datasets in the order they were added.
    pub(super) fn ids(&self) -> &[DatasetId] {
        &self.order
    }

    /// Removes one dataset. Returns what was removed, so a caller can tell a
    /// revocation that did something from one that found nothing.
    ///
    /// The removed row carries the dataset's identity lease out with it, and
    /// dropping it is what closes the handle. A caller that stored the returned
    /// value somewhere -- in an error, a snapshot, a reply -- would keep the
    /// object alive past the row that named it, which is the one way this can
    /// come to hold a file the workspace no longer lists.
    ///
    /// Not the whole of removing a dataset: a session also derives state from
    /// one, and that has to go in the same breath. Go through the workspace,
    /// which owns both.
    pub(super) fn revoke(
        &mut self,
        id: DatasetId,
        reason: RevocationReason,
    ) -> Option<RegisteredDataset> {
        // Required of the caller and deliberately not stored. It names the
        // event here and in tests; nothing reports revocations yet, and a
        // record with no reader would be a second answer to keep true once the
        // roster starts reporting them for real.
        let _ = reason;
        let removed = self.datasets.remove(&id)?;
        // Both indexes, or the identity would keep answering for a dataset that
        // is gone and the next addition of that file would be called a
        // duplicate of nothing.
        debug_assert_eq!(
            self.by_identity.get(&removed.file.identity()),
            Some(&id),
            "one filesystem object, one dataset: the index entry is this row's"
        );
        self.by_identity.remove(&removed.file.identity());
        self.order.retain(|held| *held != id);
        Some(removed)
    }
}

/// Rechecks the file a dataset was accepted as, before every use of it.
///
/// The checks made when the file was chosen do not stay true. A path can be
/// replaced by a link between the picker and the read, and the command planning
/// that follows resolves paths again, so the accepted-at-pick posture has to be
/// re-established each time rather than remembered.
pub(super) fn revalidate(remembered: &AcceptedFile) -> Result<AcceptedFile, PreviewErrorDto> {
    let current = accept_mzml_file(remembered.path())?;
    // Both, because a name can come to point elsewhere and a different file can
    // also take the same name.
    if current.path() != remembered.path() || current.identity != remembered.identity {
        return Err(PreviewErrorDto::new(
            "file_identity_changed",
            "That name no longer refers to the file that was opened. Open it again to continue.",
            false,
        ));
    }
    Ok(current)
}

/// What a handle that names no live dataset answers with.
pub(super) fn unknown_dataset() -> PreviewErrorDto {
    PreviewErrorDto::new(
        "unknown_file_handle",
        "That file is no longer open. Open it again to continue.",
        false,
    )
}

/// What may be said about a file that was never accepted.
///
/// The last component of the chosen path and nothing else. A rejected candidate
/// has no dataset to name it by, and the user still has to be able to tell which
/// of the files they picked did not arrive -- but the folder it sits in is
/// exactly what this boundary keeps in Rust, and a rejection is no reason to
/// give it up. A path with no final component reports nothing rather than
/// inventing something.
///
/// `Path::file_name` is a single component by construction: neither Windows nor
/// POSIX permits a separator inside one, so what comes back cannot be a path.
pub(super) fn candidate_display_name(path: &Path) -> String {
    path.file_name().map_or_else(
        || "(unnamed file)".to_owned(),
        |name| bounded_text(&name.to_string_lossy(), MAX_CANDIDATE_NAME_CHARS),
    )
}

/// What the boundary is told about one accepted file.
///
/// `relative_context` is the caller's, because whether a name is ambiguous is a
/// property of the whole roster rather than of one row. `None` is the ordinary
/// answer and the one every non-colliding row gets.
pub(super) fn selected_file_dto(
    id: DatasetId,
    file: &AcceptedFile,
    relative_context: Option<String>,
) -> SelectedFileDto {
    SelectedFileDto {
        handle: id.handle(),
        file_name: file.file_name().to_owned(),
        byte_length: file.byte_length(),
        relative_context,
    }
}

/// What each row must say about itself so that no two rows read alike.
///
/// Computed over the whole live registry, every time a roster is built, because
/// the answer changes as rows arrive and leave: adding a second `sample.mzML`
/// gives both of them context, and removing one takes it away from the survivor.
/// Deciding it once at insertion would freeze an answer to a question that keeps
/// being asked.
///
/// Only exact final-filename collisions produce anything. A unique name needs no
/// help, and a folder location shown beside one would be a path fragment on
/// screen for no reason -- which is the whole of what ADR 0006 permits here.
pub(super) fn relative_contexts(registry: &DatasetRegistry) -> HashMap<DatasetId, String> {
    let mut by_name: HashMap<&str, Vec<DatasetId>> = HashMap::new();
    for id in registry.ids() {
        if let Some(dataset) = registry.get(*id) {
            by_name
                .entry(dataset.file().file_name())
                .or_default()
                .push(*id);
        }
    }

    let mut contexts = HashMap::new();
    for ids in by_name.into_values() {
        if ids.len() < 2 {
            continue;
        }
        // What each colliding row would say on its own. Two rows can still land
        // on the same words -- two folders with one `data` subdirectory, or two
        // files added directly -- so the group is checked before it is trusted.
        let described: Vec<(DatasetId, String)> = ids
            .iter()
            .filter_map(|id| {
                registry
                    .get(*id)
                    .map(|d| (*id, describe_origin(d.origin())))
            })
            .collect();
        let mut seen: HashMap<&str, usize> = HashMap::new();
        for (_, description) in &described {
            *seen.entry(description.as_str()).or_default() += 1;
        }
        for (id, description) in &described {
            // The fallback names the row rather than the filesystem. It is the
            // session's own identifier, which is already the handle the webview
            // holds, so it reveals nothing a caller does not have -- and it is
            // stable for as long as the row is, so the same roster read twice
            // says the same thing.
            let context = if seen.get(description.as_str()).copied().unwrap_or(0) > 1 {
                format!("{description} · workspace item {}", id.0)
            } else {
                description.clone()
            };
            contexts.insert(*id, bounded_context(&context));
        }
    }
    contexts
}

/// What one row's origin says about where it is, before any tie-break.
fn describe_origin(origin: &DatasetOrigin) -> String {
    match origin {
        // Not a location, and deliberately not phrased as one. A picked file
        // has no place under a chosen folder to describe, and inventing one --
        // "top level", say -- would put it in a tree the user never named.
        DatasetOrigin::Direct => "Added directly".to_owned(),
        DatasetOrigin::Folder { relative_parents } if relative_parents.is_empty() => {
            "Top level".to_owned()
        }
        DatasetOrigin::Folder { relative_parents } => relative_parents
            .iter()
            .map(|component| component.to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join("\\"),
    }
}

/// Bounds a context, keeping the components nearest the filename.
///
/// Truncating from the end would drop the very components that disambiguate,
/// since the deepest one is the one closest to the file. What is lost is the
/// shallow end, and the ellipsis leads so a reader can see that something was.
fn bounded_context(value: &str) -> String {
    if value.chars().count() <= MAX_RELATIVE_CONTEXT_CHARS {
        return value.to_owned();
    }
    // One character of the budget is the ellipsis itself.
    let keep = MAX_RELATIVE_CONTEXT_CHARS.saturating_sub(1);
    let tail: String = value
        .chars()
        .skip(value.chars().count().saturating_sub(keep))
        .collect();
    format!("…{tail}")
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new(label: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock after Unix epoch")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "mscanvas-selection-{label}-{}-{nonce}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("create selection test directory");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn only_regular_mzml_files_are_accepted() {
        let directory = TestDirectory::new("accept");
        let accepted = directory.path().join("sample.mzML");
        fs::write(&accepted, b"<mzML/>").expect("write accepted fixture");
        let wrong_extension = directory.path().join("sample.mzXML");
        fs::write(&wrong_extension, b"<mzXML/>").expect("write rejected fixture");
        let directory_input = directory.path().join("acquisition.mzML");
        fs::create_dir(&directory_input).expect("create directory input");

        let file = accept_mzml_file(&accepted).expect("a regular mzML file is accepted");
        assert_eq!(file.file_name(), "sample.mzML");
        assert_eq!(file.byte_length(), 7);

        assert_eq!(
            accept_mzml_file(&wrong_extension).map(|_| ()),
            Err(PreviewErrorDto::new(
                "unsupported_extension",
                "MSCanvas opens .mzML files in this version.",
                false,
            ))
        );
        assert_eq!(
            accept_mzml_file(&directory_input).map(|_| ()),
            Err(PreviewErrorDto::new(
                "not_a_regular_file",
                "That path is not a regular file.",
                false,
            ))
        );
        assert_eq!(
            accept_mzml_file(&directory.path().join("absent.mzML")).map(|_| ()),
            Err(PreviewErrorDto::new(
                "file_not_resolvable",
                "That file could not be opened. It may have been moved or renamed.",
                true,
            ))
        );
    }

    #[test]
    fn a_case_insensitive_extension_is_still_mzml() {
        let directory = TestDirectory::new("case");
        let path = directory.path().join("SAMPLE.MZML");
        fs::write(&path, b"<mzML/>").expect("write fixture");

        assert!(accept_mzml_file(&path).is_ok());
    }

    /// Creating a symlink needs a privilege that an ordinary Windows session
    /// may not have, so this reports whether the link was actually created
    /// rather than failing the suite for an environment reason.
    #[cfg(windows)]
    fn try_symlink(target: &Path, link: &Path) -> bool {
        std::os::windows::fs::symlink_file(target, link).is_ok()
    }

    #[cfg(not(windows))]
    fn try_symlink(target: &Path, link: &Path) -> bool {
        std::os::unix::fs::symlink(target, link).is_ok()
    }

    #[test]
    fn a_link_to_a_regular_mzml_file_is_still_rejected() {
        let directory = TestDirectory::new("symlink");
        let target = directory.path().join("target.mzML");
        fs::write(&target, b"<mzML/>").expect("write link target");
        let link = directory.path().join("link.mzML");
        if !try_symlink(&target, &link) {
            // No symlink privilege here; the ordering this test guards is
            // still exercised by the reparse-point branch on Windows hosts
            // that do grant it.
            return;
        }

        assert_eq!(
            accept_mzml_file(&link).map(|_| ()),
            Err(PreviewErrorDto::new(
                "not_a_regular_file",
                "That path is not a regular file.",
                false,
            ))
        );
        // The target itself remains perfectly acceptable.
        assert!(accept_mzml_file(&target).is_ok());
    }

    #[test]
    fn two_identities_differing_only_above_the_first_64_bits_are_different() {
        // The regression this widening exists for. The old identity was the
        // 64-bit index, so two files differing only above it compared equal --
        // and as the key for "is this the same acquisition", equal means
        // merged.
        let mut lower_only = [0_u8; 16];
        lower_only[..8].copy_from_slice(&7_u64.to_ne_bytes());
        let mut with_upper = lower_only;
        with_upper[8..].copy_from_slice(&1_u64.to_ne_bytes());

        assert_ne!(
            FileIdentity::for_test(3, lower_only),
            FileIdentity::for_test(3, with_upper)
        );
        // The same identity is still the same one.
        assert_eq!(
            FileIdentity::for_test(3, with_upper),
            FileIdentity::for_test(3, with_upper)
        );
        // And a file with the same ID on another volume is another file.
        assert_ne!(
            FileIdentity::for_test(3, with_upper),
            FileIdentity::for_test(4, with_upper)
        );
    }

    #[test]
    fn an_identity_is_opaque_when_printed() {
        // It fingerprints one of the user's files, and a `Debug` that printed
        // it would put that fingerprint into any log, panic or assertion that
        // touched one.
        let mut file_id = [0_u8; 16];
        file_id[..8].copy_from_slice(&0x0123_4567_89ab_cdef_u64.to_ne_bytes());

        let rendered = format!("{:?}", FileIdentity::for_test(0xfeed_face, file_id));

        assert_eq!(rendered, "<opaque-file-identity>");
        assert!(!rendered.contains("feedface"));
        assert!(!rendered.contains("cdef"));
    }

    #[test]
    fn accepting_the_same_file_twice_reports_the_same_identity() {
        let directory = TestDirectory::new("stable-identity");
        let path = directory.path().join("sample.mzML");
        fs::write(&path, b"<mzML/>").expect("write fixture");

        let first = accept_mzml_file(&path).expect("accepted");
        let second = accept_mzml_file(&path).expect("accepted again");

        assert_eq!(first.identity(), second.identity());
    }

    /// Two names for one file. The identities must agree, because ADR 0006 will
    /// ask exactly this question to decide whether the user added the same
    /// acquisition twice.
    #[cfg(windows)]
    #[test]
    fn a_hard_link_and_its_target_are_one_file() {
        let directory = TestDirectory::new("hard-link");
        let target = directory.path().join("acquisition.mzML");
        fs::write(&target, b"<mzML/>").expect("write target");
        let link = directory.path().join("another-name.mzML");
        fs::hard_link(&target, &link).expect(
            "the test volume must support hard links; without one this cannot establish that \
             two names for one file share an identity",
        );

        let accepted_target = accept_mzml_file(&target).expect("the target is accepted");
        let accepted_link = accept_mzml_file(&link).expect("the link is accepted");

        assert_eq!(accepted_target.identity(), accepted_link.identity());
        // Same file, two names: the paths are what differ.
        assert_ne!(accepted_target.path(), accepted_link.path());
        assert_ne!(accepted_target.file_name(), accepted_link.file_name());
    }

    #[test]
    fn a_file_recreated_at_the_same_path_has_a_different_identity() {
        // No sleep and no reliance on the modification time: the identity alone
        // has to tell these apart, which is what the length and timestamp
        // beside it cannot promise for a same-sized rewrite in the same tick.
        let directory = TestDirectory::new("recreated");
        let path = directory.path().join("sample.mzML");
        fs::write(&path, b"<mzML/>").expect("write original");
        // A second name for the original, so unlinking the first cannot hand
        // its file ID back to the allocator. Without it a filesystem is free to
        // reuse the ID for the replacement, and this would be asserting how an
        // allocator behaves rather than whether two files compare as two.
        let keepalive = directory.path().join("still-here.mzML");
        fs::hard_link(&path, &keepalive).expect(
            "the test volume must support hard links; without one the original file cannot be \
             kept alive while its name is reused",
        );
        let original = accept_mzml_file(&path).expect("accepted");

        fs::remove_file(&path).expect("remove the original name");
        fs::write(&path, b"<mzML/>").expect("write the replacement");
        let replacement = accept_mzml_file(&path).expect("the replacement is accepted");

        assert_eq!(
            original.byte_length(),
            replacement.byte_length(),
            "the test needs two files the length cannot tell apart"
        );
        assert_ne!(original.identity(), replacement.identity());
        // The original is still there under its other name, and still itself.
        assert_eq!(
            accept_mzml_file(&keepalive)
                .expect("the surviving name is accepted")
                .identity(),
            original.identity()
        );
    }

    /// Writes an mzML fixture and accepts it, which is the only way into the
    /// registry.
    fn accepted(directory: &TestDirectory, name: &str, body: &[u8]) -> AcceptedFile {
        let path = directory.path().join(name);
        fs::write(&path, body).unwrap_or_else(|error| panic!("write {name}: {error}"));
        accept_mzml_file(&path).unwrap_or_else(|error| panic!("{name} is accepted: {error:?}"))
    }

    #[test]
    fn handles_are_opaque_and_never_carry_the_path() {
        let directory = TestDirectory::new("registry");
        let file = accepted(&directory, "sample.mzML", b"<mzML/>");
        let mut registry = DatasetRegistry::default();

        let id = registry.add_direct(file.clone()).id();
        let dto = selected_file_dto(id, &file, None);

        assert_eq!(dto.file_name, "sample.mzML");
        let rendered = serde_json::to_string(&dto).expect("the handle serializes");
        assert!(!rendered.contains("mscanvas-selection-registry"));
        assert!(!rendered.contains(':') || !rendered.contains('\\'));

        assert_eq!(
            DatasetId::parse(&dto.handle),
            Some(id),
            "the handle the boundary receives is the one that comes back"
        );
        assert_eq!(
            registry
                .get(id)
                .expect("a registered dataset resolves")
                .file()
                .file_name(),
            "sample.mzML"
        );
        assert_eq!(
            DatasetId::parse("file-does-not-exist"),
            None,
            "a handle this session never allocated names nothing"
        );
        // One dataset, one spelling. `u64::from_str` would take all three of
        // these for the dataset above, and a handle the boundary never issued
        // must not reach one.
        for invented in ["file-00", "file-+0", "file- 0", "FILE-0", "file-0 "] {
            assert_eq!(
                DatasetId::parse(invented),
                None,
                "{invented} is not a handle this session issued"
            );
        }
    }

    #[test]
    fn a_path_replaced_by_a_link_after_selection_is_refused_on_use() {
        let directory = TestDirectory::new("relink");
        let chosen = directory.path().join("chosen.mzML");
        let elsewhere = directory.path().join("elsewhere.mzML");
        fs::write(&chosen, b"<mzML/>").expect("write chosen fixture");
        fs::write(&elsewhere, b"<mzML> another acquisition </mzML>").expect("write other fixture");
        let remembered = accept_mzml_file(&chosen).expect("accepted");
        assert!(revalidate(&remembered).is_ok());

        // The chosen name is swapped for a link to a different acquisition.
        fs::remove_file(&chosen).expect("remove the chosen file");
        if !try_symlink(&elsewhere, &chosen) {
            return;
        }

        assert_eq!(
            revalidate(&remembered).map(|_| ()),
            Err(PreviewErrorDto::new(
                "not_a_regular_file",
                "That path is not a regular file.",
                false,
            ))
        );
    }

    #[test]
    fn a_file_replaced_by_another_regular_file_is_refused_on_use() {
        let directory = TestDirectory::new("replaced");
        let chosen = directory.path().join("chosen.mzML");
        fs::write(&chosen, b"<mzML/>").expect("write chosen fixture");
        let remembered = accept_mzml_file(&chosen).expect("accepted");
        assert!(revalidate(&remembered).is_ok());

        // Same name, same canonical path, different acquisition.
        fs::remove_file(&chosen).expect("remove the chosen file");
        fs::write(&chosen, b"<mzML> a different acquisition </mzML>").expect("write replacement");

        assert_eq!(
            revalidate(&remembered).map(|_| ()),
            Err(PreviewErrorDto::new(
                "file_identity_changed",
                "That name no longer refers to the file that was opened. Open it again to continue.",
                false,
            ))
        );
    }

    #[test]
    fn a_revoked_dataset_leaves_nothing_in_the_registry() {
        let directory = TestDirectory::new("revoke");
        let first = accepted(&directory, "first.mzML", b"<mzML/>");
        let second = accepted(&directory, "second.mzML", b"<mzML/>");
        let mut registry = DatasetRegistry::default();
        let first_id = registry.add_direct(first.clone()).id();
        let second_id = registry.add_direct(second).id();

        let removed = registry.revoke(first_id, RevocationReason::Removed);

        assert_eq!(
            removed
                .expect("the dataset that was there is returned")
                .id(),
            first_id
        );
        assert!(!registry.contains(first_id));
        assert!(registry.get(first_id).is_none());
        assert_eq!(registry.ids(), [second_id], "the rest keep their order");
        assert!(
            registry
                .revoke(first_id, RevocationReason::Removed)
                .is_none(),
            "a second removal finds nothing to remove"
        );
        // The identity index goes with it: without that, adding the file again
        // would be called a duplicate of a dataset that no longer exists.
        assert_eq!(
            registry.add_direct(first).id(),
            DatasetId(2),
            "a re-added file is a new dataset, not the one that was removed"
        );
    }

    #[test]
    fn identifiers_are_never_handed_out_twice() {
        let directory = TestDirectory::new("monotonic");
        let first = accepted(&directory, "first.mzML", b"<mzML/>");
        let second = accepted(&directory, "second.mzML", b"<mzML/>");
        let mut registry = DatasetRegistry::default();
        let first_id = registry.add_direct(first.clone()).id();
        let second_id = registry.add_direct(second).id();

        for id in registry.ids().to_vec() {
            registry.revoke(id, RevocationReason::Cleared);
        }

        assert_eq!(registry.len(), 0);
        assert!(registry.ids().is_empty());
        // The allocator does not rewind. A reply still in flight for one of the
        // emptied datasets cannot land on whatever is added next.
        let after_clear = registry.add_direct(first).id();
        assert_ne!(after_clear, first_id);
        assert_ne!(after_clear, second_id);
    }

    #[cfg(windows)]
    #[test]
    fn two_names_for_one_file_are_one_dataset() {
        let directory = TestDirectory::new("duplicate-link");
        let target = directory.path().join("acquisition.mzML");
        fs::write(&target, b"<mzML/>").expect("write target");
        let link = directory.path().join("another-name.mzML");
        fs::hard_link(&target, &link).expect(
            "the test volume must support hard links; without one this cannot establish that two \
             names for one file are one dataset",
        );
        let mut registry = DatasetRegistry::default();
        let first = registry.add_direct(accept_mzml_file(&target).expect("the target is accepted"));

        let again = registry.add_direct(accept_mzml_file(&link).expect("the link is accepted"));

        let AddDatasetOutcome::Added { id } = first else {
            panic!("the first addition is a new dataset");
        };
        assert_eq!(again, AddDatasetOutcome::Duplicate { existing_id: id });
        // Nothing about the workspace moved: no row, no identifier, no order.
        assert_eq!(registry.ids(), [id]);
        assert_eq!(
            registry
                .get(id)
                .expect("the dataset is still there")
                .file()
                .file_name(),
            "acquisition.mzML",
            "the duplicate did not replace what was registered"
        );
    }

    #[test]
    fn a_byte_identical_copy_is_a_second_dataset() {
        // Two acquisitions that happen to be identical are two things the user
        // added, and the roster has to be able to hold both. This is why the
        // key is the filesystem identity rather than the content.
        let directory = TestDirectory::new("duplicate-copy");
        let original = accepted(&directory, "original.mzML", b"<mzML/>");
        let copy = accepted(&directory, "copy.mzML", b"<mzML/>");
        assert_eq!(original.byte_length(), copy.byte_length());
        let mut registry = DatasetRegistry::default();

        let first = registry.add_direct(original).id();
        let second = registry.add_direct(copy).id();

        assert_ne!(first, second);
        assert_eq!(registry.ids(), [first, second]);
    }

    #[test]
    fn additions_append_and_removals_keep_the_rest_in_order() {
        let directory = TestDirectory::new("order");
        let mut registry = DatasetRegistry::default();
        let ids: Vec<DatasetId> = ["a.mzML", "b.mzML", "c.mzML"]
            .iter()
            .map(|name| {
                registry
                    .add_direct(accepted(&directory, name, b"<mzML/>"))
                    .id()
            })
            .collect();

        registry.revoke(ids[1], RevocationReason::Removed);
        let readded = registry
            .add_direct(accepted(&directory, "d.mzML", b"<mzML/>"))
            .id();

        assert_eq!(registry.ids(), [ids[0], ids[2], readded]);
    }

    #[test]
    fn nothing_in_the_registry_prints_a_path() {
        // A roster is many paths in one structure. One `{:?}` of it in a log or
        // a panic message would be enough to put them all somewhere they should
        // not be.
        let directory = TestDirectory::new("opaque");
        let file = accepted(&directory, "sample.mzML", b"<mzML/>");
        let path = file.path().display().to_string();
        let mut registry = DatasetRegistry::default();
        let id = registry.add_direct(file.clone()).id();
        let dataset = registry.get(id).expect("registered");

        let rendered = format!("{registry:?} {dataset:?} {id:?} {file:?}");

        assert!(
            !rendered.contains(&path),
            "debug output must not carry the path"
        );
        assert!(!rendered.contains("sample.mzML"));
        assert!(!rendered.contains(directory.path().to_string_lossy().as_ref()));
        assert_eq!(
            rendered,
            "<registry of 1 dataset> <registered dataset-0> dataset-0 <opaque-accepted-file>"
        );
    }

    #[test]
    fn a_lease_is_opaque_when_printed() {
        // A handle value is process-local and says nothing a reader of a log
        // needs, but printing one invites treating it as something to
        // correlate -- and the path it was opened from is the thing this
        // boundary exists to keep in Rust.
        let directory = TestDirectory::new("opaque-lease");
        let path = directory.path().join("sample.mzML");
        fs::write(&path, b"<mzML/>").expect("write fixture");
        #[cfg(windows)]
        let lease = FileIdentityLease::new(fs::File::open(&path).expect("open the fixture"));
        #[cfg(not(windows))]
        let lease = FileIdentityLease::unheld();

        let rendered = format!("{lease:?}");

        assert_eq!(rendered, "<opaque-identity-lease>");
        assert!(!rendered.contains("sample.mzML"));
        assert!(!rendered.contains(directory.path().to_string_lossy().as_ref()));
        // No number at all, which is what keeps a raw handle out of it.
        assert!(!rendered.chars().any(|character| character.is_ascii_digit()));
    }

    #[test]
    fn revoking_a_dataset_releases_the_hold_it_had_on_its_file() {
        let directory = TestDirectory::new("revoke-lease");
        let file = accepted(&directory, "sample.mzML", b"<mzML/>");
        let held = file.lease_witness();
        let mut registry = DatasetRegistry::default();
        let id = registry.add_direct(file).id();

        assert!(!held.is_released(), "a registered dataset holds its file");

        assert!(
            registry.revoke(id, RevocationReason::Removed).is_some(),
            "the dataset that was there is removed"
        );

        // The removed row carried the lease out with it and nothing kept a
        // copy. A revocation that returned the row into an error, a snapshot or
        // a reply would leave the session pinning a file it no longer lists.
        assert!(held.is_released(), "and lets go of it when the row goes");
    }

    /// The lease as the operating system sees it, rather than as a reference
    /// count in this process.
    #[cfg(windows)]
    #[test]
    fn while_a_dataset_is_registered_nothing_else_can_take_its_file() {
        let directory = TestDirectory::new("exclusive");
        let path = directory.path().join("sample.mzML");
        fs::write(&path, b"<mzML/>").expect("write fixture");
        assert!(
            nothing_else_holds_open(&path),
            "the fixture starts held by nothing"
        );
        let mut registry = DatasetRegistry::default();
        let id = registry
            .add_direct(accept_mzml_file(&path).expect("accepted"))
            .id();

        assert!(
            !nothing_else_holds_open(&path),
            "a registered dataset is holding its file open"
        );

        assert!(registry.revoke(id, RevocationReason::Removed).is_some());
        assert!(
            nothing_else_holds_open(&path),
            "and a revoked one is holding nothing"
        );
    }

    /// The failure this lease exists to make impossible.
    ///
    /// Windows-only because the identity it defends is the Windows file ID, and
    /// because the sharing that lets the user move and delete a listed file is
    /// a Windows rule.
    #[cfg(windows)]
    #[test]
    fn a_file_created_where_a_registered_one_used_to_be_is_a_second_dataset() {
        let directory = TestDirectory::new("pinned-identity");
        let chosen = directory.path().join("acquisition.mzML");
        fs::write(&chosen, b"<mzML/>").expect("write the first acquisition");
        let mut registry = DatasetRegistry::default();
        let first = registry
            .add_direct(accept_mzml_file(&chosen).expect("accepted"))
            .id();
        let pinned = registry
            .get(first)
            .expect("the dataset is registered")
            .file()
            .identity();

        // Both of these are things the user is still allowed to do to a file
        // MSCanvas has listed. The lease shares rename and delete precisely so
        // that listing a file is not a claim on it.
        let moved = directory.path().join("moved-away.mzML");
        fs::rename(&chosen, &moved).expect("a listed file can still be renamed");
        fs::write(&chosen, b"<mzML> a different acquisition </mzML>")
            .expect("write the replacement");
        // And now nothing but the registry's lease keeps the first object
        // alive: it has no name left. Without that hold this is the moment its
        // identity becomes free for the filesystem to hand to something else.
        fs::remove_file(&moved).expect("a listed file can still be deleted");

        let replacement = accept_mzml_file(&chosen).expect("the replacement is accepted");

        // Two objects alive at the same moment cannot share an identity, and
        // the first is alive because a row still names it.
        assert_ne!(replacement.identity(), pinned);
        let AddDatasetOutcome::Added { id } = registry.add_direct(replacement) else {
            panic!("a file that arrives under a familiar name is not the file that left");
        };
        assert_ne!(id, first);
        assert_eq!(
            registry.ids(),
            [first, id],
            "both rows, in the order they were added"
        );
        // The row that named the file the user removed still names that file
        // and still holds it. What its name now points at is a question for
        // the next use of it, which is where it is answered:
        assert_eq!(
            registry
                .get(first)
                .expect("the first dataset is still registered")
                .file()
                .identity(),
            pinned
        );
        assert_eq!(
            revalidate(
                registry
                    .get(first)
                    .expect("the first dataset is still registered")
                    .file()
            )
            .map(|_| ()),
            Err(PreviewErrorDto::new(
                "file_identity_changed",
                "That name no longer refers to the file that was opened. Open it again to continue.",
                false,
            )),
            "the registry never rebinds a row to an object the user did not add"
        );
    }

    /// Two names for one file, and the handle the second one arrived with.
    #[cfg(windows)]
    #[test]
    fn a_duplicate_addition_lets_go_of_the_handle_it_arrived_with() {
        let directory = TestDirectory::new("duplicate-lease");
        let target = directory.path().join("acquisition.mzML");
        fs::write(&target, b"<mzML/>").expect("write target");
        let link = directory.path().join("another-name.mzML");
        fs::hard_link(&target, &link).expect(
            "the test volume must support hard links; without one this cannot establish what a \
             duplicate addition does with the handle it opened",
        );
        let mut registry = DatasetRegistry::default();
        let first = registry
            .add_direct(accept_mzml_file(&target).expect("the target is accepted"))
            .id();

        // Accepted like any other file, so it arrives holding a lease of its
        // own -- there is no way to know it is a duplicate before it does.
        let again = accept_mzml_file(&link).expect("the second name is accepted");
        let temporary = again.lease_witness();

        assert_eq!(
            registry.add_direct(again),
            AddDatasetOutcome::Duplicate { existing_id: first }
        );

        assert!(
            temporary.is_released(),
            "a duplicate keeps no hold of its own; the row that was already there is the holder"
        );
        assert!(
            !nothing_else_holds_open(&target),
            "and that row is still holding it"
        );
        // One hold, not two: letting the single row go is all it takes.
        assert!(registry.revoke(first, RevocationReason::Removed).is_some());
        assert!(
            nothing_else_holds_open(&target),
            "a duplicate that had kept its handle would still be holding this"
        );
    }
}
