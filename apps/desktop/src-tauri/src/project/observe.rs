//! Looking at the files a project references, and saying exactly what was seen.
//!
//! Two consumers, one mechanism. Registration and `CaptureFileFactsV1` record
//! what a file contains; verification compares what a file contains now against
//! what a record says it contained. Both go through [`observe_member`], because
//! the interesting part is the same in both: establishing a read that is worth
//! believing.
//!
//! ## What a stable read is here
//!
//! The object is opened asking to share reads and withholding write and delete
//! sharing, without traversing a reparse point at the name. Its length is taken
//! from that handle, and it is hashed through that same handle after a rewind.
//! So the bytes the digest covers are the bytes nothing could change while it
//! ran, and they belong to the object this function inspected rather than to
//! whatever the name meant a moment later.
//!
//! The cost is real and belongs here rather than in a footnote: for the
//! duration of one member's read, another program cannot open that file for
//! writing or delete it. A checking pass over a roster is therefore a brief
//! exclusive-ish hold on each file in turn, never on all of them at once. Where
//! that open is refused because somebody else already holds the file writable,
//! the answer is [`UnavailableReason::UnstableRead`] -- not "missing", not
//! "changed", and never "matching".
//!
//! ## What is deliberately not claimed
//!
//! Length and modified time are hints and are never the proof. A before/after
//! stat pair is not a general concurrent-write detector, so none is used: the
//! share mode is what makes the read stable, and where the platform cannot give
//! one the outcome says so.
//!
//! Cancellation is observed between members and between the 64 KiB chunks the
//! digest is streamed through. It is cooperative: the chunk that is being read
//! when the request arrives finishes, and the next one is not started. That is
//! the granularity the existing bounded read path has, and it is not described
//! as anything finer.

use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use mscanvas_proteowizard::Sha256Digest;

use crate::local_document;

use super::record::{
    ContentBaseline, FileFactsV1, InputRecord, Locator, MemberRole, ObservedInput, ObservedMember,
    resolve,
};

/// Why a reference could not be established as present and readable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnavailableReason {
    /// Not found at the location this check was authorised to look at. It says
    /// nothing about whether the file exists elsewhere on the machine, because
    /// nothing looked elsewhere.
    MissingAtCheckedLocation,
    /// There and not readable by this process. An access denial is this, never
    /// missing.
    Unreadable,
    /// The name is not an ordinary file this build reads -- a reparse point, a
    /// directory or a device -- or the locator does not resolve to one.
    UnsafeReference,
    /// The primary is there and a mandatory companion is not, so what is on
    /// disk is not the complete acquisition the record describes.
    IncompleteRequiredMembers,
    /// No read could be established that was worth comparing: somebody else
    /// holds the file in a way that lets them change it underneath, or the
    /// read failed partway.
    UnstableRead,
}

impl UnavailableReason {
    /// The stable wire identifier. Owned, enumerated, and never a message.
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::MissingAtCheckedLocation => "missingAtCheckedLocation",
            Self::Unreadable => "unreadable",
            Self::UnsafeReference => "unsafeReference",
            Self::IncompleteRequiredMembers => "incompleteRequiredMembers",
            Self::UnstableRead => "unstableRead",
        }
    }
}

/// What a check established about one input.
///
/// Five outcomes, and relinking is not among them: where a file *is* and what
/// it *contains* are independent, so a moved-and-edited file is reported as
/// different content at whatever location is currently recorded, and moving the
/// record to a new location is a separate confirmed operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum InputVerification {
    /// Nothing has been established. The state a reopened project starts in,
    /// and the state a cancelled check leaves behind.
    #[default]
    NotChecked,
    /// Every member is present and its bytes are the bytes the record claims.
    MatchingRecordedContent,
    /// Every member could be read, and at least one differs from the baseline.
    DifferentContent,
    Unavailable(UnavailableReason),
}

impl InputVerification {
    /// The stable wire identifier for the outcome itself.
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::NotChecked => "notChecked",
            Self::MatchingRecordedContent => "matchingRecordedContent",
            Self::DifferentContent => "differentContent",
            Self::Unavailable(_) => "unavailable",
        }
    }

    /// The reason, where the outcome has one.
    #[must_use]
    pub const fn reason(self) -> Option<UnavailableReason> {
        match self {
            Self::Unavailable(reason) => Some(reason),
            _ => None,
        }
    }
}

/// What the filesystem calls one object, wide enough to tell it apart from
/// every other object on its volume.
///
/// Operation-scoped evidence and nothing else. It is never written to a project
/// document: which object a name meant during one measurement is a fact about
/// that measurement, not a property of the reference.
pub type ObjectIdentity = (u64, [u8; 16]);

/// What one member's bytes were, or why they could not be established.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemberObservation {
    Observed {
        byte_length: u64,
        digest: Sha256Digest,
        /// The object those bytes came out of, read through the same handle
        /// they were read through and before it was released.
        ///
        /// This is what makes the digest evidence about an *object* rather than
        /// about a name. Two identity reads taken after the handle closed can
        /// agree with each other while describing a file that replaced the one
        /// that was hashed; one taken from the open object cannot.
        ///
        /// `None` on a filesystem that has no identity to give. That is not a
        /// failure of the read and deliberately does not become one: recording
        /// what a file contains, checking it against a record and capturing
        /// file facts are all answerable without it, and they went on being
        /// answerable on such a volume before this evidence existed. Only an
        /// operation that has to bind a proof to an object needs it, and only
        /// that operation refuses without it.
        identity: Option<ObjectIdentity>,
    },
    Unavailable(UnavailableReason),
}

/// The cancellation state of one accepted operation.
///
/// One per operation, minted when the operation is accepted and released with
/// it. That is the whole design: a cancel request names an operation and sets
/// *its* flag, so there is no flag that outlives the work it was for and no
/// way for a request to land on whatever happens to run next.
///
/// A small type rather than the conversion lane's cancellation, which carries
/// staging-recovery duties that have nothing to do with reading a file.
#[derive(Clone, Default)]
pub struct Cancellation {
    requested: Arc<AtomicBool>,
    /// Test-only: called once per chunk the cooperative reader hands to the
    /// digest, so a test can hold an operation inside a read and cancel it
    /// there. Absent from every non-test build.
    #[cfg(test)]
    gate: Option<Arc<dyn Fn() + Send + Sync>>,
}

impl Cancellation {
    /// Asks the operation this belongs to to stop at its next opportunity.
    pub fn request(&self) {
        self.requested.store(true, Ordering::Relaxed);
    }

    /// Whether a stop has been asked for.
    #[must_use]
    pub fn requested(&self) -> bool {
        self.requested.load(Ordering::Relaxed)
    }

    /// Lets a test observe and hold each chunk the reader hands to the digest.
    #[cfg(test)]
    pub fn with_gate(gate: Arc<dyn Fn() + Send + Sync>) -> Self {
        Self {
            requested: Arc::new(AtomicBool::new(false)),
            gate: Some(gate),
        }
    }

    /// One chunk is about to be read.
    fn chunk(&self) {
        #[cfg(test)]
        if let Some(gate) = &self.gate {
            gate();
        }
    }
}

impl std::fmt::Debug for Cancellation {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Cancellation")
            .field("requested", &self.requested())
            .finish_non_exhaustive()
    }
}

/// A reader that stops handing out bytes once its operation is cancelled.
///
/// Wraps the open object the digest is streamed from, so the check happens at
/// the same bounded 64 KiB boundary the hash already works in. A cancelled
/// read answers an error the digest cannot mistake for content; the caller
/// then asks the flag which of the two it was.
struct Cooperative<'a> {
    inner: &'a std::fs::File,
    cancellation: &'a Cancellation,
}

impl io::Read for Cooperative<'_> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        self.cancellation.chunk();
        if self.cancellation.requested() {
            return Err(io::Error::other("the operation was cancelled"));
        }
        io::Read::read(&mut self.inner, buffer)
    }
}

/// Opens an object so that the bytes read from it cannot change while they are
/// read.
///
/// Read sharing is granted, because another reader invalidates nothing. Write
/// and delete sharing are withheld: the first is what makes the digest below
/// cover a fixed sequence of bytes, and the second is what stops the *name*
/// being made to mean a different object between the open and the read.
///
/// This is the posture the conversion lane opens a source with, for the same
/// reason. It is not a lock the application holds: it lasts exactly as long as
/// one member's measurement.
#[cfg(windows)]
fn open_for_stable_read(path: &Path) -> io::Result<std::fs::File> {
    use std::os::windows::fs::OpenOptionsExt as _;

    const FILE_SHARE_READ: u32 = 0x0000_0001;

    std::fs::OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .custom_flags(local_document::OPEN_REPARSE_POINT)
        .open(path)
}

/// Opens an object for reading.
///
/// No platform outside Windows offers a mandatory share mode through the
/// standard library, so this holds the object open without preventing anyone
/// from writing to it. The guarantee is correspondingly narrower and is not
/// described as equivalent; Windows is the platform this application ships on.
#[cfg(not(windows))]
fn open_for_stable_read(path: &Path) -> io::Result<std::fs::File> {
    std::fs::File::open(path)
}

/// ERROR_SHARING_VIOLATION and ERROR_LOCK_VIOLATION.
///
/// Matched on the raw code rather than on an `ErrorKind`, because these are
/// exactly the two answers that mean "somebody else can change this file" and
/// the standard library does not promise a stable kind for either.
#[cfg(windows)]
fn is_sharing_refusal(error: &io::Error) -> bool {
    matches!(error.raw_os_error(), Some(32 | 33))
}

#[cfg(not(windows))]
fn is_sharing_refusal(_error: &io::Error) -> bool {
    false
}

/// Measures one file through a stable read.
///
/// Every outcome leaves the file exactly as it was found. Nothing here writes,
/// creates, renames or removes anything.
///
/// A cancellation that arrives during the read ends it at the next chunk and
/// is reported as [`UnavailableReason::UnstableRead`]: no digest was
/// established. The caller distinguishes that from a genuinely unstable read
/// by asking the flag, which is the one thing that knows.
#[must_use]
pub fn observe_member(path: &Path, cancellation: &Cancellation) -> MemberObservation {
    let file = match open_for_stable_read(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return MemberObservation::Unavailable(UnavailableReason::MissingAtCheckedLocation);
        }
        Err(error) if is_sharing_refusal(&error) => {
            return MemberObservation::Unavailable(UnavailableReason::UnstableRead);
        }
        // Everything else is classified from the name rather than guessed at
        // from the open error. A directory refuses this open with "access
        // denied", because the flag that would open one is deliberately not
        // asked for -- so trusting the error kind here would report every
        // directory as a permission problem, which is a different thing to tell
        // a user and the wrong one.
        Err(_) => return MemberObservation::Unavailable(unopenable(path)),
    };
    let Ok(metadata) = file.metadata() else {
        return MemberObservation::Unavailable(UnavailableReason::Unreadable);
    };
    // Asked of the open object rather than of the name, so what is judged and
    // what is read are the same thing.
    if !local_document::is_ordinary_file(&metadata) {
        return MemberObservation::Unavailable(UnavailableReason::UnsafeReference);
    }
    let byte_length = metadata.len();
    let mut handle = &file;
    if io::Seek::rewind(&mut handle).is_err() {
        return MemberObservation::Unavailable(UnavailableReason::UnstableRead);
    }
    let reader = Cooperative {
        inner: &file,
        cancellation,
    };
    let digest = match Sha256Digest::calculate_reader(reader) {
        Ok(digest) => digest,
        // The handle was open and the read did not finish. That is not a fact
        // about the content, so it must not be reported as one.
        Err(_) => return MemberObservation::Unavailable(UnavailableReason::UnstableRead),
    };
    // Taken from the object the bytes came out of, while `file` is still open,
    // and deliberately not from the path afterwards. The whole point of the
    // share mode above is that this object cannot be replaced or deleted while
    // it is held; asking the *name* once the handle is gone would answer about
    // whatever the name means then, and two such answers agreeing proves only
    // that they were taken after the same replacement.
    let identity = local_document::object_identity_of(&file);
    MemberObservation::Observed {
        byte_length,
        digest,
        identity,
    }
}

/// Why a name that exists could not be opened.
fn unopenable(path: &Path) -> UnavailableReason {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if !metadata.is_file() || local_document::is_reparse_point(&metadata) => {
            UnavailableReason::UnsafeReference
        }
        Ok(_) => UnavailableReason::Unreadable,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            UnavailableReason::MissingAtCheckedLocation
        }
        Err(_) => UnavailableReason::Unreadable,
    }
}

/// Where one member of an input sits, given the input's resolved primary path.
///
/// The locator names the primary; a companion is a single file name beside it.
/// A primary whose resolved path has no parent directory has no place to hold a
/// companion, which is why this can answer `None`.
fn member_path(primary: &Path, member: &super::record::MemberRecord) -> Option<PathBuf> {
    if member.relative_name.is_empty() {
        return Some(primary.to_path_buf());
    }
    primary
        .parent()
        .map(|directory| directory.join(&member.relative_name))
}

/// One member, as one measurement found it: what it held, what the record says
/// it held, and which object both of those are about.
struct ObservedMemberObject {
    observed: ObservedMember,
    baseline: ContentBaseline,
    identity: Option<ObjectIdentity>,
}

/// Measures every member of one input, in record order with the primary first.
///
/// Answers the members it managed to measure, or the first reason it could not.
/// Stops at the first unavailable member: there is nothing to learn from
/// hashing the rest of a bundle whose primary is gone, and a check that kept
/// going would hold more files open for longer to say the same thing.
fn observe_input(
    input: &InputRecord,
    base_directory: &Path,
    cancellation: &Cancellation,
) -> Result<Vec<ObservedMemberObject>, UnavailableReason> {
    let primary =
        resolve(&input.locator, base_directory).map_err(|_| UnavailableReason::UnsafeReference)?;

    let mut ordered: Vec<&super::record::MemberRecord> = input.members.iter().collect();
    ordered.sort_by_key(|member| match member.role {
        MemberRole::Primary => 0_u8,
        MemberRole::RequiredCompanion => 1,
    });

    let mut observed = Vec::with_capacity(ordered.len());
    for member in ordered {
        if cancellation.requested() {
            return Err(UnavailableReason::UnstableRead);
        }
        let Some(path) = member_path(&primary, member) else {
            return Err(UnavailableReason::UnsafeReference);
        };
        match observe_member(&path, cancellation) {
            MemberObservation::Observed {
                byte_length,
                digest,
                identity,
            } => observed.push(ObservedMemberObject {
                observed: ObservedMember {
                    role: member.role,
                    relative_name: member.relative_name.clone(),
                    byte_length,
                    sha256: digest.to_string(),
                },
                baseline: member.baseline.clone(),
                identity,
            }),
            // A missing companion is a different fact from a missing input: the
            // acquisition the record describes is incomplete rather than gone.
            MemberObservation::Unavailable(UnavailableReason::MissingAtCheckedLocation)
                if member.role == MemberRole::RequiredCompanion =>
            {
                return Err(UnavailableReason::IncompleteRequiredMembers);
            }
            MemberObservation::Unavailable(reason) => return Err(reason),
        }
    }
    Ok(observed)
}

/// One input, as one measurement found it.
///
/// Two answers from one pass, because they are two halves of one claim. The
/// verification says whether the *bytes* are the recorded bytes; the identities
/// say which *objects* those bytes came out of, in record order with the
/// primary first. An operation that has to bind a proof to an object needs
/// both, and taking them from two passes would let them describe two moments.
///
/// The identities are empty for every outcome that is not
/// `MatchingRecordedContent`: nothing is proven, so there is nothing to bind.
/// They are also empty where the filesystem could not identify one of the
/// objects -- a partial binding is not a weaker binding, it is none -- and the
/// caller refuses rather than binding to what it happens to know.
#[derive(Debug, Clone)]
pub struct VerifiedProjectObject {
    pub verification: InputVerification,
    identities: Vec<ObjectIdentity>,
}

impl VerifiedProjectObject {
    /// The objects the measurement was taken from, primary first.
    #[must_use]
    pub fn identities(&self) -> &[ObjectIdentity] {
        &self.identities
    }
}

/// Establishes what is currently true about one input's files.
///
/// A cancellation that arrives before the input is finished leaves it
/// `NotChecked`: a partial check is not a weaker result, it is no result.
#[must_use]
pub fn verify_input(
    input: &InputRecord,
    base_directory: &Path,
    cancellation: &Cancellation,
) -> InputVerification {
    verify_input_objects(input, base_directory, cancellation).verification
}

/// The same measurement, with the objects it was taken from.
///
/// The form the reattachment boundary uses. A check only has to say what it
/// found; an operation that is about to hand a file to workspace admission has
/// to be able to say afterwards that the object admitted is the object hashed.
#[must_use]
pub fn verify_input_objects(
    input: &InputRecord,
    base_directory: &Path,
    cancellation: &Cancellation,
) -> VerifiedProjectObject {
    let unproven = |verification| VerifiedProjectObject {
        verification,
        identities: Vec::new(),
    };
    if cancellation.requested() {
        return unproven(InputVerification::NotChecked);
    }
    match observe_input(input, base_directory, cancellation) {
        Ok(observed) => {
            if cancellation.requested() {
                return unproven(InputVerification::NotChecked);
            }
            // Case-insensitively, for the reason `ContentBaseline::matches`
            // gives: a digest has no case to carry meaning in, and comparing
            // spellings would report identical bytes as changed.
            let matching = observed.iter().all(|member| {
                member.baseline.byte_length == member.observed.byte_length
                    && member
                        .baseline
                        .sha256
                        .eq_ignore_ascii_case(&member.observed.sha256)
            });
            if matching {
                VerifiedProjectObject {
                    verification: InputVerification::MatchingRecordedContent,
                    // All of them or none. A set missing one member's object
                    // is not a set this can be compared against, and comparing
                    // the ones it has would answer a narrower question than
                    // the one being asked.
                    identities: observed
                        .iter()
                        .map(|member| member.identity)
                        .collect::<Option<Vec<_>>>()
                        .unwrap_or_default(),
                }
            } else {
                unproven(InputVerification::DifferentContent)
            }
        }
        Err(_) if cancellation.requested() => unproven(InputVerification::NotChecked),
        Err(reason) => unproven(InputVerification::Unavailable(reason)),
    }
}

/// Why `CaptureFileFactsV1` did not produce an artifact.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptureFailure {
    /// One of the selected inputs could not be observed. The identifier is the
    /// caller's to report; the reason is this.
    InputUnavailable(UnavailableReason),
    /// The user cancelled. Not a failure of the files, and not an artifact.
    Cancelled,
    /// Nothing was selected.
    NothingSelected,
}

/// Records what a selected set of inputs actually contains, right now.
///
/// The one real operation in this slice. It reads lengths and SHA-256 digests
/// through stable reads and returns them as a typed payload. It converts
/// nothing, interprets nothing, and asserts nothing about whether these files
/// are scientifically anything.
///
/// # Errors
///
/// A [`CaptureFailure`]. A capture that cannot observe every selected input
/// produces no partial artifact: half a record of what a file contained is not
/// a record of what a file contained.
pub fn capture_file_facts(
    inputs: &[&InputRecord],
    base_directory: &Path,
    cancellation: &Cancellation,
) -> Result<FileFactsV1, CaptureFailure> {
    if inputs.is_empty() {
        return Err(CaptureFailure::NothingSelected);
    }
    let mut observations = Vec::with_capacity(inputs.len());
    for input in inputs {
        if cancellation.requested() {
            return Err(CaptureFailure::Cancelled);
        }
        let observed = observe_input(input, base_directory, cancellation).map_err(|reason| {
            if cancellation.requested() {
                CaptureFailure::Cancelled
            } else {
                CaptureFailure::InputUnavailable(reason)
            }
        })?;
        observations.push(ObservedInput {
            input_id: input.id,
            members: observed.into_iter().map(|member| member.observed).collect(),
        });
    }
    if cancellation.requested() {
        return Err(CaptureFailure::Cancelled);
    }
    Ok(FileFactsV1 { observations })
}

/// Builds the member records one newly registered input starts with.
///
/// The baseline is whatever was observed at registration. That is the whole
/// claim: these were the bytes when the reference was made.
///
/// # Errors
///
/// The first reason a member could not be measured.
pub fn register_members(
    primary: &Path,
    companions: &[PathBuf],
) -> Result<Vec<super::record::MemberRecord>, UnavailableReason> {
    let mut members = Vec::with_capacity(1 + companions.len());
    // Observed once. Reading the primary a second time to classify a failure
    // would be measuring a different moment than the one that failed.
    //
    // Registration is not a cancellable operation: it is one read the user
    // just asked for through a dialog, so it carries a flag nobody can set.
    let uncancellable = Cancellation::default();
    match observe_member(primary, &uncancellable) {
        MemberObservation::Observed {
            byte_length,
            digest,
            // Registration records what a file *contained*. Which object it was
            // is evidence for one operation and is deliberately not stored.
            identity: _,
        } => members.push(super::record::MemberRecord {
            role: MemberRole::Primary,
            relative_name: String::new(),
            baseline: ContentBaseline::observed(byte_length, digest),
        }),
        MemberObservation::Unavailable(reason) => return Err(reason),
    }
    for companion in companions {
        let Some(name) = companion.file_name().and_then(|name| name.to_str()) else {
            return Err(UnavailableReason::UnsafeReference);
        };
        match observe_member(companion, &uncancellable) {
            MemberObservation::Observed {
                byte_length,
                digest,
                identity: _,
            } => members.push(super::record::MemberRecord {
                role: MemberRole::RequiredCompanion,
                relative_name: name.to_owned(),
                baseline: ContentBaseline::observed(byte_length, digest),
            }),
            // A mandatory companion that is not there at registration means the
            // bundle being registered is not complete, which is the same fact
            // a later check would report.
            MemberObservation::Unavailable(UnavailableReason::MissingAtCheckedLocation) => {
                return Err(UnavailableReason::IncompleteRequiredMembers);
            }
            MemberObservation::Unavailable(reason) => return Err(reason),
        }
    }
    Ok(members)
}

/// The locator a newly registered input carries, given where the project is.
///
/// Separate from [`register_members`] because a project that has not been saved
/// yet has no directory to be relative to, and an absolute reference is the
/// honest answer until it does.
#[must_use]
pub fn registered_locator(primary: &Path, base_directory: Option<&Path>) -> Locator {
    match base_directory {
        Some(directory) => super::record::locator_for(primary, directory),
        None => Locator::LocalAbsolute {
            path: primary.to_path_buf(),
        },
    }
}
