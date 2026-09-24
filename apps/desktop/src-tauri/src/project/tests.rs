//! Tests for the project record store.
//!
//! Everything here runs against real files in a task-owned temporary directory
//! under the system temp root. No VM is launched, no provider is called, no
//! installer runs, and nothing outside the directory each test creates is read
//! or written.
//!
//! Where a claim is about a Windows filesystem mechanism the test says so and
//! is gated to Windows. Where a claim cannot be tested on this machine -- a
//! second physical volume, most obviously -- the limit is recorded beside the
//! test rather than approximated by something that would read as proof.

use std::cell::Cell;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Barrier};

use super::observe::{self, Cancellation, MemberObservation, UnavailableReason};
use super::record::{
    ContentBaseline, DocumentProblem, InputId, LayerId, LayerRecord, LayerSource, Locator,
    MAX_LAYERS, MemberRecord, MemberRole, ProjectDocument, RecordedOperation, RunId, RunInput,
    RunRecord, TerminalOutcome,
};
use super::{CancelOutcome, ProjectError, ProjectJobId, ProjectStore, record};

/// A directory this test owns, removed when the test ends.
pub(crate) struct Scratch {
    path: PathBuf,
}

impl Scratch {
    pub(crate) fn new(label: &str) -> Self {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "mscanvas-project-{label}-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("create the scratch directory");
        Self { path }
    }

    pub(crate) fn join(&self, name: &str) -> PathBuf {
        self.path.join(name)
    }

    /// Writes a file and answers where it is.
    pub(crate) fn write(&self, name: &str, bytes: &[u8]) -> PathBuf {
        let path = self.join(name);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create the parent directory");
        }
        fs::write(&path, bytes).expect("write the fixture");
        path
    }

    pub(crate) fn directory(&self) -> &Path {
        &self.path
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

/// A store with one open project and one registered reference.
fn store_with_reference(scratch: &Scratch, name: &str, bytes: &[u8]) -> (ProjectStore, InputId) {
    let store = ProjectStore::new();
    store.create("Test project".to_owned(), false).expect("new");
    let path = scratch.write(name, bytes);
    let id = store.register_input(&path).expect("register");
    (store, id)
}

fn verification(store: &ProjectStore, id: InputId) -> &'static str {
    let described = store.describe();
    described
        .inputs
        .iter()
        .find(|input| input.id == id.to_string())
        .map(|input| input.verification)
        .expect("the reference is described")
}

fn unavailable_reason(store: &ProjectStore, id: InputId) -> Option<&'static str> {
    let described = store.describe();
    described
        .inputs
        .iter()
        .find(|input| input.id == id.to_string())
        .and_then(|input| input.unavailable_reason)
}

/// Accepts and runs one check, the way the interface does.
fn check(store: &ProjectStore) -> Result<(), ProjectError> {
    let id = store.accept_job()?;
    store.check_linked_files(id)
}

/// Accepts and runs one capture, the way the interface does.
fn capture(store: &ProjectStore, selected: &[InputId]) -> Result<RunId, ProjectError> {
    let id = store.accept_job()?;
    store.capture_file_facts(id, selected)
}

/// A cancellation whose first chunk read waits for the test.
///
/// The worker passes `reached` once it is inside the read, then waits on
/// `proceed`. Both are two-party barriers with the test as the other party, so
/// the test can act while the operation is provably mid-read, without a sleep.
/// Every chunk the reader hands to the digest is counted, cancelled or not.
fn gated(reached: Arc<Barrier>, proceed: Arc<Barrier>) -> (Cancellation, Arc<AtomicUsize>) {
    let chunks = Arc::new(AtomicUsize::new(0));
    let counted = Arc::clone(&chunks);
    let cancellation = Cancellation::with_gate(Arc::new(move || {
        if counted.fetch_add(1, Ordering::SeqCst) == 0 {
            reached.wait();
            proceed.wait();
        }
    }));
    (cancellation, chunks)
}

/// A cancellation that only counts the chunks it is asked for.
fn counting() -> (Cancellation, Arc<AtomicUsize>) {
    let chunks = Arc::new(AtomicUsize::new(0));
    let counted = Arc::clone(&chunks);
    let cancellation = Cancellation::with_gate(Arc::new(move || {
        counted.fetch_add(1, Ordering::SeqCst);
    }));
    (cancellation, chunks)
}

/// An identifier this store never minted.
fn never_minted() -> ProjectJobId {
    ProjectJobId::parse("project-job-999999").expect("a well-formed handle")
}

// ---------------------------------------------------------------------------
// Identity through a roundtrip
// ---------------------------------------------------------------------------

#[test]
fn every_identifier_survives_a_save_and_reopen_unchanged() {
    let scratch = Scratch::new("identity");
    let (store, input_id) = store_with_reference(&scratch, "sample.txt", b"one acquisition");
    capture(&store, &[input_id]).expect("the capture completes");

    let before = store.describe();
    let project_document = scratch.join("project.mscanvas");
    store.save_as(&project_document).expect("save as");

    let reopened = ProjectStore::new();
    reopened
        .open_document(&project_document, false)
        .expect("open");
    let after = reopened.describe();

    assert_eq!(before.inputs[0].id, after.inputs[0].id);
    assert_eq!(before.artifacts[0].id, after.artifacts[0].id);
    assert_eq!(before.runs[0].id, after.runs[0].id);
    // The run still names the artifact it produced, in the spelling the
    // artifact itself carries.
    assert_eq!(
        after.runs[0].output_artifact_ids,
        vec![after.artifacts[0].id.clone()]
    );
}

#[test]
fn a_reopened_project_starts_with_every_reference_unchecked() {
    let scratch = Scratch::new("fresh-handles");
    let (store, _) = store_with_reference(&scratch, "sample.txt", b"bytes");
    let project_document = scratch.join("project.mscanvas");
    store.save_as(&project_document).expect("save as");

    let reopened = ProjectStore::new();
    reopened
        .open_document(&project_document, false)
        .expect("open");

    // Opening resolves nothing and reads nothing. Whatever the saving session
    // had established about these files is not a fact this session holds.
    assert!(
        reopened
            .describe()
            .inputs
            .iter()
            .all(|input| input.verification == "notChecked")
    );
}

#[test]
fn a_recorded_completed_run_is_history_and_not_a_schedule() {
    let scratch = Scratch::new("history");
    let (store, input_id) = store_with_reference(&scratch, "sample.txt", b"bytes");
    capture(&store, &[input_id]).expect("capture");
    let project_document = scratch.join("project.mscanvas");
    store.save_as(&project_document).expect("save as");

    let reopened = ProjectStore::new();
    reopened
        .open_document(&project_document, false)
        .expect("open");
    let described = reopened.describe();

    assert_eq!(described.runs.len(), 1);
    assert_eq!(described.runs[0].outcome, "completed");
    // Opening produced no second run, and the references it names are still
    // unchecked -- so nothing about opening ran anything.
    assert!(
        described
            .inputs
            .iter()
            .all(|input| input.verification == "notChecked")
    );
}

// ---------------------------------------------------------------------------
// Content verification
// ---------------------------------------------------------------------------

#[test]
fn altered_bytes_at_the_same_length_and_modified_time_are_detected() {
    let scratch = Scratch::new("same-length");
    let path = scratch.write("sample.txt", b"AAAAAAAAAA");
    let store = ProjectStore::new();
    store.create("Test project".to_owned(), false).expect("new");
    let id = store.register_input(&path).expect("register");

    let original = fs::metadata(&path).expect("metadata");
    let modified = original.modified().expect("modified time");

    // The same number of bytes, different content.
    fs::write(&path, b"BBBBBBBBBB").expect("rewrite");
    let handle = fs::OpenOptions::new()
        .write(true)
        .open(&path)
        .expect("reopen to restore the timestamp");
    handle
        .set_modified(modified)
        .expect("restore the modified time");
    drop(handle);

    let after = fs::metadata(&path).expect("metadata again");
    assert_eq!(after.len(), original.len(), "the length is unchanged");
    assert_eq!(
        after.modified().expect("modified"),
        modified,
        "the modified time is unchanged"
    );

    check(&store).expect("check");

    // Length and modified time are hints and both say nothing changed. Only the
    // digest of a stable read decides, which is why this is `differentContent`.
    assert_eq!(verification(&store, id), "differentContent");
}

#[test]
fn identical_content_in_a_different_object_is_not_proof_of_the_same_object() {
    let scratch = Scratch::new("copy");
    let original = scratch.write("original.txt", b"identical bytes");
    let copy = scratch.write("copy.txt", b"identical bytes");

    let store = ProjectStore::new();
    store.create("Test project".to_owned(), false).expect("new");
    let first = store.register_input(&original).expect("register original");
    let second = store.register_input(&copy).expect("register copy");

    // Two records, not one. A digest is a fact about bytes, and two files with
    // the same bytes are still two acquisitions, two events and two objects.
    assert_ne!(first, second);
    assert_eq!(store.describe().inputs.len(), 2);

    #[cfg(windows)]
    {
        let original_identity = crate::local_document::object_identity(&original);
        let copy_identity = crate::local_document::object_identity(&copy);
        assert!(original_identity.is_some());
        assert_ne!(
            original_identity, copy_identity,
            "the filesystem calls these two different objects"
        );
    }
}

#[test]
fn a_deleted_reference_is_missing_and_not_unreadable() {
    let scratch = Scratch::new("missing");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"bytes");
    fs::remove_file(scratch.join("sample.txt")).expect("remove");

    check(&store).expect("check");

    assert_eq!(verification(&store, id), "unavailable");
    assert_eq!(
        unavailable_reason(&store, id),
        Some("missingAtCheckedLocation")
    );
}

#[test]
fn a_directory_at_the_reference_location_is_unsafe_and_not_missing() {
    let scratch = Scratch::new("unsafe");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"bytes");
    let path = scratch.join("sample.txt");
    fs::remove_file(&path).expect("remove the file");
    fs::create_dir(&path).expect("put a directory at the same name");

    check(&store).expect("check");

    assert_eq!(unavailable_reason(&store, id), Some("unsafeReference"));
}

/// The invariant the same-object proof rests on: what a measurement answers
/// about is the object it read, not the name it read through.
///
/// Asserted structurally rather than by timing. The window a name-based probe
/// leaves open is between the read handle closing and that probe opening its
/// own, which is two adjacent statements with nothing a test can act in -- and
/// on Windows it cannot be widened, because the read's share mode is what stops
/// the object being replaced while the handle is held. What can be shown is the
/// property that removes the window: the identity comes back equal to the one
/// the test itself reads from a handle on the very object, and it goes on
/// naming that object after the name has been made to mean a different one.
#[test]
fn a_measurement_names_the_object_it_read_and_not_the_name_it_read_through() {
    let scratch = Scratch::new("measured-object");
    let path = scratch.write("sample.bin", b"the measured bytes");
    let held = fs::File::open(&path).expect("hold the measured object open");
    let measured = crate::local_document::object_identity_of(&held)
        .expect("the test volume identifies its objects");

    let observed = observe::observe_member(&path, &Cancellation::default());
    let MemberObservation::Observed { identity, .. } = observed else {
        panic!("the object is there and readable: {observed:?}");
    };
    assert_eq!(
        identity,
        Some(measured),
        "the measurement answers about the object, established through its own read"
    );

    // And a question put to the *name* afterwards answers about whatever the
    // name means then. Built beside the original and moved over it, so the
    // replacement cannot be handed the identity the original released.
    let replacement = scratch.write("replacement.bin", b"the measured bytes");
    drop(held);
    fs::remove_file(&path).expect("remove the measured object");
    fs::rename(&replacement, &path).expect("put the replacement in place");

    let by_name =
        crate::local_document::object_identity(&path).expect("the replacement is identified too");
    assert_ne!(
        Some(by_name),
        identity,
        "the two questions have different answers, which is the whole difficulty"
    );
}

/// The binding comparison, asked the questions the end-to-end cases cannot.
///
/// Both sides happen to order a SCIEX acquisition primary-first, so order
/// independence is never exercised by a real admission -- and "nothing proved
/// matches nothing" is a guard whose whole job is to be unreachable.
#[test]
fn the_binding_compares_object_sets_rather_than_orders() {
    let first = (1_u64, [1_u8; 16]);
    let second = (1_u64, [2_u8; 16]);
    let elsewhere = (2_u64, [1_u8; 16]);

    assert!(super::same_objects(&[first, second], &[second, first]));
    assert!(super::same_objects(&[first], &[first]));
    // Same file id, different volume. Not the same object.
    assert!(!super::same_objects(&[first], &[elsewhere]));
    // A bundle and one of its members are not the same acquisition, in either
    // direction.
    assert!(!super::same_objects(&[first, second], &[first]));
    assert!(!super::same_objects(&[first], &[first, second]));
    // Nothing proved is not the same as anything, including as nothing.
    assert!(!super::same_objects(&[], &[]));
    assert!(!super::same_objects(&[], &[first]));
}

/// An object with no identity is still readable, checkable and recordable.
///
/// Binding a measurement to an object is evidence one operation needs. A
/// volume that cannot supply it must not take registering a reference,
/// checking one or capturing its file facts away with it -- and it must not
/// borrow "another program has this file open", which would be untrue and
/// would tell the user to do something that can never work.
#[test]
fn a_measurement_without_an_identity_is_still_a_measurement() {
    let scratch = Scratch::new("unidentified");
    let path = scratch.write("sample.bin", b"readable either way");

    let observed = observe::observe_member(&path, &Cancellation::default());
    let MemberObservation::Observed { byte_length, .. } = observed else {
        panic!("the object is there and readable: {observed:?}");
    };
    assert_eq!(byte_length, 19);

    // The volumes this test can create all identify their objects, so what is
    // asserted here is the shape rather than the platform: the observation
    // carries the identity as something that may be absent, and every consumer
    // that does not need it reads the bytes regardless.
    let (store, id) = store_with_reference(&scratch, "reference.bin", b"recorded bytes");
    check(&store).expect("check");
    assert_eq!(verification(&store, id), "matchingRecordedContent");
    capture(&store, &[id]).expect("capture");
}

/// Windows-specific. A file another process holds open for writing cannot be
/// read stably, and the answer is that rather than a content judgement.
///
/// This exercises exactly one mechanism: a mandatory share mode on one file
/// this test created. It is not a claim that every unreadable file on every
/// filesystem reports this way.
#[cfg(windows)]
#[test]
fn a_file_held_writable_elsewhere_reports_an_unstable_read() {
    use std::os::windows::fs::OpenOptionsExt as _;

    const FILE_SHARE_READ: u32 = 0x0000_0001;

    let scratch = Scratch::new("unstable");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"bytes");

    // Another writer holds it, sharing reads only -- so this build cannot get
    // the write-denying handle a stable read requires.
    let held = fs::OpenOptions::new()
        .write(true)
        .share_mode(FILE_SHARE_READ)
        .open(scratch.join("sample.txt"))
        .expect("hold the file writable");

    check(&store).expect("check");
    assert_eq!(unavailable_reason(&store, id), Some("unstableRead"));

    drop(held);
    check(&store).expect("check again");
    assert_eq!(verification(&store, id), "matchingRecordedContent");
}

// ---------------------------------------------------------------------------
// Copying a held member (M9.3): one read through the held handle, hashed on
// the way into the destination
// ---------------------------------------------------------------------------

/// Bytes that are not a repetition, so a chunk written twice or out of order
/// cannot hash the same as the file.
fn varied(length: usize) -> Vec<u8> {
    let mut state = 0x9E37_79B9_u32;
    (0..length)
        .map(|_| {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            state.to_le_bytes()[0]
        })
        .collect()
}

/// A destination that remembers every chunk it was handed and can be told to
/// refuse from a byte onwards.
struct Recorder {
    bytes: Vec<u8>,
    largest_write: usize,
    writes: usize,
    refuse_after: Option<(usize, std::io::ErrorKind)>,
}

impl Recorder {
    fn new() -> Self {
        Self {
            bytes: Vec::new(),
            largest_write: 0,
            writes: 0,
            refuse_after: None,
        }
    }

    fn refusing_after(bytes: usize, kind: std::io::ErrorKind) -> Self {
        Self {
            refuse_after: Some((bytes, kind)),
            ..Self::new()
        }
    }
}

impl std::io::Write for Recorder {
    fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
        if let Some((limit, kind)) = self.refuse_after
            && self.bytes.len() + buffer.len() > limit
        {
            return Err(std::io::Error::from(kind));
        }
        self.bytes.extend_from_slice(buffer);
        self.largest_write = self.largest_write.max(buffer.len());
        self.writes += 1;
        Ok(buffer.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[test]
fn a_copy_through_the_held_handle_is_the_objects_bytes_and_their_digest() {
    let scratch = Scratch::new("copy");
    let bytes = varied(300 * 1024 + 17);
    let path = scratch.write("source.bin", &bytes);

    let opened = observe::open_member(&path).expect("opened");
    let mut destination = Recorder::new();
    let copied = opened
        .copy_into(&mut destination, &Cancellation::default())
        .expect("copied");

    assert_eq!(
        destination.bytes, bytes,
        "the destination holds the object's bytes"
    );
    assert_eq!(copied.byte_length, bytes.len() as u64);
    assert_eq!(
        copied.digest,
        mscanvas_proteowizard::Sha256Digest::calculate(&bytes).expect("digest"),
        "the digest is of the bytes the destination was handed"
    );
    // Streamed, never whole: no chunk larger than the digest's own buffer.
    assert!(destination.writes > 1);
    assert!(
        destination.largest_write <= 64 * 1024,
        "{}",
        destination.largest_write
    );

    // And the same handle, measured where it is, agrees with its own copy.
    let held = opened.measure(&Cancellation::default()).expect("measured");
    assert_eq!(
        (held.byte_length, held.digest),
        (copied.byte_length, copied.digest)
    );
}

/// Windows-specific: what the held handle protects while a copy is in
/// progress, asserted mid-copy rather than assumed. The source cannot be
/// deleted, renamed or opened for writing, and the copy that finishes is the
/// original's bytes.
#[cfg(windows)]
#[test]
fn a_held_member_cannot_be_changed_deleted_or_renamed_while_it_is_copied() {
    let scratch = Scratch::new("copy-held");
    let bytes = varied(256 * 1024);
    let path = scratch.write("source.bin", &bytes);
    let reached = Arc::new(Barrier::new(2));
    let proceed = Arc::new(Barrier::new(2));
    let (cancellation, _) = gated(Arc::clone(&reached), Arc::clone(&proceed));

    let copied = std::thread::scope(|scope| {
        let copying = scope.spawn(|| {
            let opened = observe::open_member(&path).expect("opened");
            let mut destination = Recorder::new();
            let copied = opened.copy_into(&mut destination, &cancellation);
            (copied, destination.bytes)
        });
        reached.wait();
        assert!(fs::remove_file(&path).is_err(), "delete refused while held");
        assert!(
            fs::rename(&path, scratch.join("moved.bin")).is_err(),
            "rename refused while held"
        );
        assert!(
            fs::OpenOptions::new().write(true).open(&path).is_err(),
            "a writer refused while held"
        );
        proceed.wait();
        copying.join().expect("the copy thread")
    });
    let (copied, written) = copied;
    let copied = copied.expect("copied");
    assert_eq!(written, bytes);
    assert_eq!(copied.byte_length, bytes.len() as u64);
    assert_eq!(
        fs::read(&path).expect("the source"),
        bytes,
        "and it is untouched"
    );
}

#[test]
fn a_cancel_during_a_copy_stops_it_between_chunks_with_no_digest() {
    let scratch = Scratch::new("copy-cancel");
    let bytes = varied(512 * 1024);
    let path = scratch.write("source.bin", &bytes);
    let slot = Arc::new(std::sync::Mutex::new(None::<Cancellation>));
    let seen = Arc::new(AtomicUsize::new(0));
    let cancellation = {
        let slot = Arc::clone(&slot);
        let seen = Arc::clone(&seen);
        Cancellation::with_gate(Arc::new(move || {
            // Cancel as the third chunk is about to be read.
            if seen.fetch_add(1, Ordering::SeqCst) == 2
                && let Some(own) = slot.lock().expect("slot").as_ref()
            {
                own.request();
            }
        }))
    };
    *slot.lock().expect("slot") = Some(cancellation.clone());

    let opened = observe::open_member(&path).expect("opened");
    let mut destination = Recorder::new();
    let copied = opened.copy_into(&mut destination, &cancellation);
    // The gate held a clone of its own cancellation; let both go.
    slot.lock().expect("slot").take();
    assert_eq!(copied, Err(observe::CopyFailure::Cancelled));
    // Two chunks went through and nothing after them did.
    assert_eq!(destination.bytes.len(), 2 * 64 * 1024);
    assert_eq!(seen.load(Ordering::SeqCst), 3);
}

#[test]
fn a_destination_that_refuses_a_chunk_is_named_by_why() {
    let scratch = Scratch::new("copy-refused");
    let bytes = varied(200 * 1024);
    let path = scratch.write("source.bin", &bytes);
    let opened = observe::open_member(&path).expect("opened");

    let mut full = Recorder::refusing_after(100 * 1024, std::io::ErrorKind::StorageFull);
    assert_eq!(
        opened.copy_into(&mut full, &Cancellation::default()),
        Err(observe::CopyFailure::DestinationFull)
    );
    assert!(full.bytes.len() <= 100 * 1024, "a prefix at most");

    let mut refused = Recorder::refusing_after(0, std::io::ErrorKind::PermissionDenied);
    assert_eq!(
        opened.copy_into(&mut refused, &Cancellation::default()),
        Err(observe::CopyFailure::DestinationUnwritable)
    );
    assert!(refused.bytes.is_empty());

    // The same handle copies whole afterwards: a refusal does not spend it.
    let mut whole = Recorder::new();
    opened
        .copy_into(&mut whole, &Cancellation::default())
        .expect("copied");
    assert_eq!(whole.bytes, bytes);
}

#[cfg(windows)]
#[test]
fn a_volume_says_what_this_process_may_write_and_an_object_how_many_names_it_has() {
    let scratch = Scratch::new("names");
    assert!(
        crate::local_document::available_bytes(scratch.directory()).is_some_and(|free| free > 0)
    );
    assert_eq!(
        crate::local_document::available_bytes(&scratch.join("not-there")),
        None,
        "a directory that is not there answers nothing, not zero"
    );
    let path = scratch.write("one.bin", b"named once");
    let count =
        |path: &Path| crate::local_document::link_count_of(&fs::File::open(path).expect("open"));
    assert_eq!(count(&path), Some(1));
    fs::hard_link(&path, scratch.join("two.bin")).expect("a second name");
    assert_eq!(count(&path), Some(2));
    fs::remove_file(&path).expect("the first name goes");
    assert_eq!(count(&scratch.join("two.bin")), Some(1));
}

#[test]
fn an_empty_member_copies_as_empty_with_the_empty_digest() {
    let scratch = Scratch::new("copy-empty");
    let path = scratch.write("empty.bin", b"");
    let opened = observe::open_member(&path).expect("opened");
    let mut destination = Recorder::new();
    let copied = opened
        .copy_into(&mut destination, &Cancellation::default())
        .expect("copied");
    assert_eq!(copied.byte_length, 0);
    assert_eq!(
        copied.digest,
        mscanvas_proteowizard::Sha256Digest::calculate(b"").expect("digest")
    );
}

#[test]
fn an_incomplete_required_member_set_is_its_own_outcome() {
    let scratch = Scratch::new("incomplete");
    let store = ProjectStore::new();
    store.create("Test project".to_owned(), false).expect("new");

    // A record with a mandatory companion, built directly: the SCIEX rule is
    // what decides that a `.wiff` has one, and this test is about what a check
    // does with the record, not about the family rule.
    let primary = scratch.write("run.wiff", b"primary bytes");
    scratch.write("run.wiff.scan", b"companion bytes");
    let id = store.register_input(&primary).expect("register");

    let described = store.describe();
    assert_eq!(
        described.inputs[0].members.len(),
        2,
        "the companion the family mandates is recorded as a member"
    );

    check(&store).expect("check");
    assert_eq!(verification(&store, id), "matchingRecordedContent");

    // The primary is still there; the companion is not. That is not a missing
    // input and not changed content.
    fs::remove_file(scratch.join("run.wiff.scan")).expect("remove the companion");
    check(&store).expect("check again");
    assert_eq!(
        unavailable_reason(&store, id),
        Some("incompleteRequiredMembers")
    );
}

#[test]
fn a_wiff_primary_without_its_companion_is_refused_at_registration() {
    let scratch = Scratch::new("half-bundle");
    let store = ProjectStore::new();
    store.create("Test project".to_owned(), false).expect("new");
    let primary = scratch.write("lonely.wiff", b"primary bytes");

    let refusal = store.register_input(&primary).expect_err("a refusal");

    // A primary alone is not a verified complete acquisition, and registering
    // one as though it were would make every later check lie about it.
    assert_eq!(
        refusal,
        ProjectError::Unavailable(UnavailableReason::IncompleteRequiredMembers)
    );
    assert!(store.describe().inputs.is_empty());
}

// ---------------------------------------------------------------------------
// Locators and relinking
// ---------------------------------------------------------------------------

#[test]
fn a_project_and_its_data_copied_together_still_resolve() {
    let origin = Scratch::new("origin");
    let store = ProjectStore::new();
    store.create("Portable".to_owned(), false).expect("new");
    let data = origin.write("data/sample.txt", b"portable bytes");
    store.register_input(&data).expect("register");

    let project_document = origin.join("project.mscanvas");
    store.save_as(&project_document).expect("save as");

    // Saved beside its data, the reference became relative.
    assert_eq!(
        store.describe().inputs[0].locator_kind,
        super::dto::LocatorKind::InsideProject
    );

    // Copy both to a different directory, as a user moving a project would.
    let elsewhere = Scratch::new("elsewhere");
    fs::create_dir_all(elsewhere.join("data")).expect("create the data directory");
    fs::copy(&data, elsewhere.join("data/sample.txt")).expect("copy the data");
    fs::copy(&project_document, elsewhere.join("project.mscanvas")).expect("copy the project");

    let moved = ProjectStore::new();
    moved
        .open_document(&elsewhere.join("project.mscanvas"), false)
        .expect("open the copy");
    check(&moved).expect("check");

    assert_eq!(
        moved.describe().inputs[0].verification,
        "matchingRecordedContent",
        "a relative locator resolves against wherever the project now is"
    );
}

#[test]
fn save_as_rebases_external_references_rather_than_reinterpreting_them() {
    let data_home = Scratch::new("external-data");
    let first_home = Scratch::new("first-home");
    let data = data_home.write("sample.txt", b"external bytes");

    let store = ProjectStore::new();
    store.create("External".to_owned(), false).expect("new");
    store.register_input(&data).expect("register");
    store
        .save_as(&first_home.join("project.mscanvas"))
        .expect("first save");
    assert_eq!(
        store.describe().inputs[0].locator_kind,
        super::dto::LocatorKind::OutsideProject
    );

    // A decoy at the same relative name under the new directory. If Save As
    // reinterpreted a stored string instead of rebasing a resolved path, the
    // reference would silently start pointing at this instead.
    let second_home = Scratch::new("second-home");
    second_home.write("sample.txt", b"a completely different file");
    store
        .save_as(&second_home.join("project.mscanvas"))
        .expect("second save");

    check(&store).expect("check");
    assert_eq!(
        store.describe().inputs[0].verification,
        "matchingRecordedContent",
        "the reference still names the external file it always named"
    );
    assert_eq!(
        store.describe().inputs[0].locator_kind,
        super::dto::LocatorKind::OutsideProject
    );
}

#[test]
fn relinking_a_matching_candidate_moves_the_locator_and_keeps_the_identifier() {
    let scratch = Scratch::new("relink-match");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"stable bytes");
    capture(&store, &[id]).expect("capture");
    let artifact_before = store.describe().artifacts[0].id.clone();

    // The file moves. Same bytes, new location.
    let moved = scratch.join("moved/sample.txt");
    fs::create_dir_all(moved.parent().expect("parent")).expect("create");
    fs::rename(scratch.join("sample.txt"), &moved).expect("move it");

    check(&store).expect("check");
    assert_eq!(
        unavailable_reason(&store, id),
        Some("missingAtCheckedLocation")
    );

    let matches = store.propose_relink(id, &moved).expect("propose");
    assert!(matches, "the candidate holds the recorded bytes");

    // Proposing commits nothing.
    assert_eq!(
        unavailable_reason(&store, id),
        Some("missingAtCheckedLocation")
    );
    assert!(store.describe().inputs[0].relink_proposed);

    store.commit_relink(id).expect("commit");
    check(&store).expect("check again");

    assert_eq!(verification(&store, id), "matchingRecordedContent");
    // The logical record is the same record, and the history that named it
    // still names it.
    assert_eq!(store.describe().inputs[0].id, id.to_string());
    assert_eq!(store.describe().artifacts[0].id, artifact_before);
    assert_eq!(store.describe().runs[0].input_ids, vec![id.to_string()]);
}

#[test]
fn relinking_a_differing_candidate_does_not_replace_the_recorded_baseline() {
    let scratch = Scratch::new("relink-differs");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"original bytes");
    let recorded = store.describe().inputs[0].members[0].recorded_byte_length;

    let candidate = scratch.write("other/sample.txt", b"different bytes entirely");
    let matches = store.propose_relink(id, &candidate).expect("propose");
    assert!(!matches, "the candidate does not hold the recorded bytes");

    store.commit_relink(id).expect("commit anyway");

    // Committed, because where a file is and what it contains are independent:
    // a user may well be pointing at a file that has since been edited.
    assert_eq!(verification(&store, id), "differentContent");
    // And the baseline is untouched. A check saw new bytes; it did not get to
    // rewrite what the record claims was registered.
    assert_eq!(
        store.describe().inputs[0].members[0].recorded_byte_length,
        recorded
    );
}

#[test]
fn a_relink_examines_only_the_candidate_it_was_given() {
    let scratch = Scratch::new("relink-scope");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"bytes");
    // A decoy with identical bytes sits in the same directory. Nothing scans
    // for it, so nothing finds it.
    scratch.write("decoy.txt", b"bytes");
    fs::remove_file(scratch.join("sample.txt")).expect("remove");

    check(&store).expect("check");
    assert_eq!(
        unavailable_reason(&store, id),
        Some("missingAtCheckedLocation")
    );
    // No proposal appeared on its own.
    assert!(!store.describe().inputs[0].relink_proposed);
}

// ---------------------------------------------------------------------------
// The untrusted document
// ---------------------------------------------------------------------------

/// Builds one minimal valid document, for a test to then break in one place.
fn valid_document() -> ProjectDocument {
    let mut document = ProjectDocument::new("Fixture".to_owned());
    let input_id = InputId::new();
    document.inputs.push(super::record::InputRecord {
        id: input_id,
        label: "sample.txt".to_owned(),
        locator: Locator::ProjectRelative {
            path: "sample.txt".to_owned(),
        },
        members: vec![MemberRecord {
            role: MemberRole::Primary,
            relative_name: String::new(),
            baseline: ContentBaseline {
                byte_length: 5,
                sha256: "A".repeat(64),
            },
        }],
    });
    document.runs.push(RunRecord {
        id: RunId::new(),
        operation: RecordedOperation::CaptureFileFactsV1,
        inputs: vec![RunInput::Input { input_id }],
        output_artifact_ids: Vec::new(),
        outcome: TerminalOutcome::Failed,
        application_version: "0.1.0".to_owned(),
        started_at: "2026-09-19T00:00:00Z".to_owned(),
        finished_at: "2026-09-19T00:00:01Z".to_owned(),
        targeted_ms1: None,
    });
    document
}

fn refused(document: &ProjectDocument) -> DocumentProblem {
    let bytes = record::serialize(document).expect("serialize");
    record::parse(&bytes).expect_err("a refusal")
}

#[test]
fn the_fixture_document_is_accepted_so_the_refusals_below_mean_something() {
    let bytes = record::serialize(&valid_document()).expect("serialize");
    record::parse(&bytes).expect("the unbroken fixture parses");
}

#[test]
fn a_duplicate_identifier_is_refused() {
    let mut document = valid_document();
    let duplicate = document.inputs[0].clone();
    document.inputs.push(duplicate);
    assert_eq!(refused(&document), DocumentProblem::DuplicateIdentifier);
}

#[test]
fn a_dangling_run_reference_is_refused() {
    let mut document = valid_document();
    document.runs[0].inputs = vec![RunInput::Input {
        input_id: InputId::new(),
    }];
    assert_eq!(refused(&document), DocumentProblem::DanglingReference);
}

#[test]
fn a_failed_run_carrying_an_artifact_is_refused() {
    let mut document = valid_document();
    document.runs[0].output_artifact_ids = vec![mscanvas_core::ArtifactId::new()];
    // Dangling first, which is itself the point: a failed run cannot name an
    // artifact because a failed run produced none to name.
    assert_eq!(refused(&document), DocumentProblem::DanglingReference);
}

#[test]
fn a_completed_run_producing_nothing_is_refused() {
    let mut document = valid_document();
    document.runs[0].outcome = TerminalOutcome::Completed;
    assert_eq!(refused(&document), DocumentProblem::InconsistentRecord);
}

#[test]
fn an_unknown_schema_version_is_refused_as_unsupported_rather_than_malformed() {
    let mut document = valid_document();
    document.schema_version = record::SCHEMA_VERSION + 1;
    assert_eq!(refused(&document), DocumentProblem::UnsupportedVersion);
}

#[test]
fn a_truncated_document_is_refused() {
    let bytes = record::serialize(&valid_document()).expect("serialize");
    let truncated = &bytes[..bytes.len() / 2];
    assert_eq!(
        record::parse(truncated).expect_err("a refusal"),
        DocumentProblem::Malformed
    );
}

#[test]
fn an_oversized_document_is_refused_without_being_parsed() {
    let scratch = Scratch::new("oversized");
    let path = scratch.join("project.mscanvas");
    let oversized = vec![b'{'; (record::MAX_DOCUMENT_BYTES + 1) as usize];
    fs::write(&path, &oversized).expect("write");

    let store = ProjectStore::new();
    let refusal = store.open_document(&path, false).expect_err("a refusal");

    assert_eq!(refusal, ProjectError::Document(DocumentProblem::Oversized));
}

#[test]
fn a_traversal_locator_is_refused_and_reaches_nothing() {
    for path in ["../escape.txt", "sub/../../escape.txt", "/absolute.txt"] {
        let locator = Locator::ProjectRelative {
            path: path.to_owned(),
        };
        assert_eq!(
            record::validate_locator(&locator).expect_err("a refusal"),
            DocumentProblem::InvalidLocator,
            "{path} must not be a project-relative locator"
        );
    }
}

#[test]
fn unc_and_device_references_are_refused_by_shape() {
    for path in [
        r"\\server\share\file.txt",
        r"\\?\C:\file.txt",
        r"\\.\PhysicalDrive0",
        "//server/share/file.txt",
    ] {
        let locator = Locator::LocalAbsolute {
            path: PathBuf::from(path),
        };
        assert_eq!(
            record::validate_locator(&locator).expect_err("a refusal"),
            DocumentProblem::InvalidLocator,
            "{path} must not be an absolute locator"
        );
    }
}

#[test]
fn a_refused_document_leaves_the_open_project_exactly_as_it_was() {
    let scratch = Scratch::new("refusal-preserves");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"bytes");
    let before = store.describe();

    let broken = scratch.join("broken.mscanvas");
    fs::write(&broken, b"{ this is not a project document").expect("write");

    let refusal = store.open_document(&broken, true).expect_err("a refusal");
    assert_eq!(refusal, ProjectError::Document(DocumentProblem::Malformed));

    let after = store.describe();
    assert_eq!(after.name, before.name);
    assert_eq!(after.inputs.len(), 1);
    assert_eq!(after.inputs[0].id, id.to_string());
}

#[test]
fn a_member_name_carrying_a_separator_is_refused() {
    let mut document = valid_document();
    document.inputs[0].members.push(MemberRecord {
        role: MemberRole::RequiredCompanion,
        relative_name: "../outside.txt".to_owned(),
        baseline: ContentBaseline {
            byte_length: 1,
            sha256: "B".repeat(64),
        },
    });
    assert_eq!(refused(&document), DocumentProblem::InvalidLocator);
}

// ---------------------------------------------------------------------------
// Write authority
// ---------------------------------------------------------------------------

#[test]
fn a_destination_not_named_as_a_project_is_refused() {
    let scratch = Scratch::new("bad-name");
    let (store, _) = store_with_reference(&scratch, "sample.txt", b"bytes");
    let refusal = store
        .save_as(&scratch.join("project.txt"))
        .expect_err("a refusal");
    assert_eq!(refusal, ProjectError::DestinationNotNamed);
}

#[test]
fn saving_over_an_unrelated_existing_file_is_refused_and_preserves_it() {
    let scratch = Scratch::new("unrelated");
    let (store, _) = store_with_reference(&scratch, "sample.txt", b"bytes");
    let occupied = scratch.join("somebody-elses.mscanvas");
    fs::write(&occupied, b"important content that is not a project").expect("write");

    let refusal = store.save_as(&occupied).expect_err("a refusal");

    assert_eq!(refusal, ProjectError::DestinationNotAProject);
    assert_eq!(
        fs::read(&occupied).expect("read"),
        b"important content that is not a project",
        "the file is exactly as it was"
    );
}

#[test]
fn saving_over_a_referenced_acquisition_is_refused_and_preserves_it() {
    let scratch = Scratch::new("over-source");
    let store = ProjectStore::new();
    store.create("Test project".to_owned(), false).expect("new");
    // A referenced file that is *also* named as a project document, which is
    // the one case the "is it a project" rule alone cannot catch.
    let referenced = scratch.write("acquisition.mscanvas", b"acquisition bytes");
    store.register_input(&referenced).expect("register");

    let refusal = store.save_as(&referenced).expect_err("a refusal");

    assert!(
        matches!(
            refusal,
            ProjectError::DestinationAliasesInput | ProjectError::DestinationNotAProject
        ),
        "refused, by identity or by shape: {refusal:?}"
    );
    assert_eq!(
        fs::read(&referenced).expect("read"),
        b"acquisition bytes",
        "the referenced file is exactly as it was"
    );
}

/// Windows-specific. A hard link is a second name for one object, so a
/// destination that is a hard-linked alias of a referenced file must be refused
/// by identity rather than by name.
#[cfg(windows)]
#[test]
fn a_hard_linked_alias_of_a_referenced_file_is_refused_by_identity() {
    let scratch = Scratch::new("hard-link");
    let store = ProjectStore::new();
    store.create("Test project".to_owned(), false).expect("new");
    let referenced = scratch.write("acquisition.dat", b"acquisition bytes");
    store.register_input(&referenced).expect("register");

    let alias = scratch.join("alias.mscanvas");
    if fs::hard_link(&referenced, &alias).is_err() {
        // Hard links need both names on one volume and a filesystem that
        // supports them. Where this machine cannot make one, the mechanism is
        // untested rather than reported as passing.
        eprintln!("skipped: this filesystem did not create a hard link");
        return;
    }

    let refusal = store.save_as(&alias).expect_err("a refusal");
    assert_eq!(refusal, ProjectError::DestinationAliasesInput);
    assert_eq!(
        fs::read(&referenced).expect("read"),
        b"acquisition bytes",
        "the referenced object is exactly as it was, under either name"
    );
}

#[test]
fn save_before_any_save_as_is_refused_rather_than_guessing_a_location() {
    let scratch = Scratch::new("unpublished");
    let (store, _) = store_with_reference(&scratch, "sample.txt", b"bytes");
    assert_eq!(
        store.save().expect_err("a refusal"),
        ProjectError::NotYetPublished
    );
}

#[test]
fn a_stale_save_does_not_overwrite_another_writers_state() {
    let scratch = Scratch::new("stale");
    let (store, _) = store_with_reference(&scratch, "sample.txt", b"bytes");
    let document = scratch.join("project.mscanvas");
    store.save_as(&document).expect("first save");

    // A second session opens the same document and publishes over it.
    let other = ProjectStore::new();
    other.open_document(&document, false).expect("open");
    other.save().expect("the other session saves");
    let other_bytes = fs::read(&document).expect("read");

    // The first session still believes it holds the current revision.
    let refusal = store.save().expect_err("a refusal");

    assert_eq!(refusal, ProjectError::StaleDocument);
    assert_eq!(
        fs::read(&document).expect("read again"),
        other_bytes,
        "the other session's document is exactly as it left it"
    );
}

#[test]
fn an_external_replacement_at_the_bound_name_is_refused() {
    let scratch = Scratch::new("replaced");
    let (store, _) = store_with_reference(&scratch, "sample.txt", b"bytes");
    let document = scratch.join("project.mscanvas");
    store.save_as(&document).expect("save as");

    // Something else entirely now occupies the bound name.
    fs::write(&document, b"not a project at all").expect("replace");

    assert_eq!(
        store.save().expect_err("a refusal"),
        ProjectError::StaleDocument
    );
    assert_eq!(
        fs::read(&document).expect("read"),
        b"not a project at all",
        "whatever is there is left alone"
    );
}

#[test]
fn a_repeated_save_advances_the_revision_and_stays_bound() {
    let scratch = Scratch::new("revisions");
    let (store, _) = store_with_reference(&scratch, "sample.txt", b"bytes");
    let document = scratch.join("project.mscanvas");
    store.save_as(&document).expect("save as");
    store.save().expect("second save");
    store.save().expect("third save");

    let bytes = fs::read(&document).expect("read");
    let parsed = record::parse(&bytes).expect("parse");
    assert_eq!(parsed.revision, 3);
    assert!(!store.describe().dirty);
}

#[test]
fn unsaved_changes_block_a_replacement_until_the_caller_says_to_discard() {
    let scratch = Scratch::new("unsaved");
    let (store, _) = store_with_reference(&scratch, "sample.txt", b"bytes");
    assert!(store.describe().dirty);

    assert_eq!(
        store
            .create("Another".to_owned(), false)
            .expect_err("a refusal"),
        ProjectError::UnsavedChanges
    );
    assert_eq!(store.describe().inputs.len(), 1);

    store
        .create("Another".to_owned(), true)
        .expect("discarding");
    assert!(store.describe().inputs.is_empty());
}

#[test]
fn a_save_leaves_no_temporary_beside_the_document() {
    let scratch = Scratch::new("no-residue");
    let (store, _) = store_with_reference(&scratch, "sample.txt", b"bytes");
    store
        .save_as(&scratch.join("project.mscanvas"))
        .expect("save as");

    let residue: Vec<_> = fs::read_dir(scratch.directory())
        .expect("list")
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
        .collect();
    assert!(residue.is_empty(), "no temporary was left behind");
}

// ---------------------------------------------------------------------------
// The capture operation
// ---------------------------------------------------------------------------

#[test]
fn a_capture_records_the_bytes_it_actually_observed() {
    let scratch = Scratch::new("capture");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"twelve bytes");
    capture(&store, &[id]).expect("capture");

    let described = store.describe();
    assert_eq!(described.artifacts.len(), 1);
    assert_eq!(described.artifacts[0].observed_input_count, 1);
    assert_eq!(described.artifacts[0].observed_member_count, 1);
    assert_eq!(described.runs.len(), 1);
    assert_eq!(described.runs[0].operation, "captureFileFactsV1");
    assert_eq!(described.runs[0].outcome, "completed");
    assert_eq!(
        described.runs[0].application_version,
        env!("CARGO_PKG_VERSION")
    );
}

#[test]
fn a_capture_over_a_missing_reference_records_a_failure_and_no_artifact() {
    let scratch = Scratch::new("capture-fails");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"bytes");
    fs::remove_file(scratch.join("sample.txt")).expect("remove");

    let refusal = capture(&store, &[id]).expect_err("a refusal");
    assert_eq!(
        refusal,
        ProjectError::Unavailable(UnavailableReason::MissingAtCheckedLocation)
    );

    let described = store.describe();
    assert!(
        described.artifacts.is_empty(),
        "a failed observation fabricates nothing"
    );
    assert_eq!(described.runs.len(), 1);
    assert_eq!(described.runs[0].outcome, "failed");
    assert!(described.runs[0].output_artifact_ids.is_empty());
}

#[test]
fn a_cancelled_capture_records_a_cancellation_and_no_artifact() {
    let scratch = Scratch::new("capture-cancelled");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"bytes");
    let operation = store.accept_job().expect("accept");
    assert_eq!(store.cancel_job(operation), CancelOutcome::Cancelled);

    let refusal = store
        .capture_file_facts(operation, &[id])
        .expect_err("a refusal");
    assert_eq!(refusal, ProjectError::Cancelled);

    // The operation was accepted and dispatched, so its cancellation is a
    // fact of its history. What it did not do is produce anything.
    let described = store.describe();
    assert!(described.artifacts.is_empty());
    assert_eq!(described.runs[0].outcome, "cancelled");
}

#[test]
fn a_capture_of_nothing_is_refused() {
    let scratch = Scratch::new("capture-nothing");
    let (store, _) = store_with_reference(&scratch, "sample.txt", b"bytes");
    assert_eq!(
        capture(&store, &[]).expect_err("a refusal"),
        ProjectError::NothingSelected
    );
    assert!(store.describe().runs.is_empty(), "no run was invented");
}

#[test]
fn a_reference_recorded_work_used_is_refused_removal_and_one_nothing_used_goes() {
    let scratch = Scratch::new("remove");
    let (store, captured) = store_with_reference(&scratch, "sample.txt", b"bytes");
    let cancelled = store
        .register_input(&scratch.write("cancelled.txt", b"cancelled"))
        .expect("register");
    let unused = store
        .register_input(&scratch.write("unused.txt", b"unused"))
        .expect("register");
    capture(&store, &[captured]).expect("capture");
    // A cancelled capture is history too: it records a run and no artifact.
    let operation = store.accept_job().expect("accept");
    assert_eq!(store.cancel_job(operation), CancelOutcome::Cancelled);
    assert_eq!(
        store.capture_file_facts(operation, &[cancelled]),
        Err(ProjectError::Cancelled)
    );
    store
        .save_as(&scratch.join("project.mscanvas"))
        .expect("saved, so a refusal that dirtied it would show");
    let before = document_of(&store);

    // Neither is cascaded: the run, the record and the reference all stay.
    for pinned in [captured, cancelled] {
        assert_eq!(
            store.remove_input(pinned),
            Err(ProjectError::InputUsedByRun)
        );
    }
    assert_eq!(document_of(&store), before, "nothing was removed");
    assert!(!store.describe().dirty, "a refusal dirties nothing");

    // Control: a reference nothing recorded goes, and its file stays.
    store.remove_input(unused).expect("removed");
    assert_eq!(document_of(&store).inputs.len(), 2);
    assert!(
        scratch.join("unused.txt").exists(),
        "removing a record never removes a file"
    );
}

// ---------------------------------------------------------------------------
// Cancellation leaves nothing established
// ---------------------------------------------------------------------------

#[test]
fn a_cancelled_check_leaves_references_unchecked() {
    let scratch = Scratch::new("cancel-check");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"bytes");
    // Registration established a match. A cancelled check must not turn that
    // into a weaker claim, and must not leave a partial one either.
    check(&store).expect("a real check");
    assert_eq!(verification(&store, id), "matchingRecordedContent");

    let operation = store.accept_job().expect("accept");
    assert_eq!(store.cancel_job(operation), CancelOutcome::Cancelled);
    store
        .check_linked_files(operation)
        .expect("the cancelled check");

    assert_eq!(verification(&store, id), "notChecked");

    // And the cancellation ended with the operation it was for. The next
    // check is a new operation and runs.
    check(&store).expect("the next check");
    assert_eq!(verification(&store, id), "matchingRecordedContent");
}

// ---------------------------------------------------------------------------
// Cancellation belongs to one accepted operation
// ---------------------------------------------------------------------------

#[test]
fn a_cancel_with_nothing_running_does_not_cancel_the_next_operation() {
    let scratch = Scratch::new("idle-cancel");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"bytes");

    // Nothing is running. A cancel now is a click on nothing: it names no
    // operation, it is told so, and it must not be remembered as a credit
    // against whatever the user starts next. This is the regression the old
    // store-wide flag failed.
    let dirty_before = store.describe().dirty;
    assert_eq!(
        store.cancel_job(never_minted()),
        CancelOutcome::NoActiveOperation
    );
    assert!(
        store.describe().runs.is_empty(),
        "an idle cancel invents no run"
    );
    assert_eq!(
        store.describe().dirty,
        dirty_before,
        "an idle cancel changes nothing"
    );

    check(&store).expect("the next check");
    assert_eq!(
        verification(&store, id),
        "matchingRecordedContent",
        "an idle cancel must not have cancelled the check that followed it"
    );

    // The same for a cancel that names an operation which has already
    // finished: it is late, it finds nothing, and the one after it runs.
    let finished = store.accept_job().expect("accept");
    store.check_linked_files(finished).expect("run");
    assert_eq!(store.cancel_job(finished), CancelOutcome::NoActiveOperation);
    check(&store).expect("the next check again");
    assert_eq!(verification(&store, id), "matchingRecordedContent");
}

#[test]
fn an_operation_cancelled_after_acceptance_never_opens_a_file() {
    let scratch = Scratch::new("cancel-before-start");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"bytes");
    check(&store).expect("a real check");

    // Accepted, not started. This is the window between the user pressing the
    // button and the worker opening its first file, and it is not idle: the
    // operation already has an identity, and a cancel that names it lands.
    let (cancellation, chunks) = counting();
    let operation = store.accept_job_with(cancellation).expect("accept");
    assert_eq!(store.cancel_job(operation), CancelOutcome::Cancelled);

    store
        .check_linked_files(operation)
        .expect("the check runs and does nothing");
    assert_eq!(verification(&store, id), "notChecked");
    assert_eq!(
        chunks.load(Ordering::SeqCst),
        0,
        "no file was read: the cancel arrived before any expensive I/O"
    );

    // The same window, for a capture.
    let (cancellation, chunks) = counting();
    let operation = store.accept_job_with(cancellation).expect("accept");
    assert_eq!(store.cancel_job(operation), CancelOutcome::Cancelled);
    assert_eq!(
        store.capture_file_facts(operation, &[id]),
        Err(ProjectError::Cancelled)
    );
    assert_eq!(chunks.load(Ordering::SeqCst), 0);
    let described = store.describe();
    assert!(described.artifacts.is_empty());
    assert_eq!(described.runs.len(), 1);
    assert_eq!(described.runs[0].outcome, "cancelled");

    // Control: the next operation is a new one and completes.
    capture(&store, &[id]).expect("completes");
    assert_eq!(store.describe().artifacts.len(), 1);
}

#[test]
fn a_cancel_during_a_read_wins_before_commit() {
    let scratch = Scratch::new("cancel-mid-read");
    // Four 64 KiB chunks, so there is a "next chunk" for the cancel to stop.
    let path = scratch.write("big.bin", &vec![0x5A; 200 * 1024]);
    let store = ProjectStore::new();
    store.create("Fixture".to_owned(), false).expect("new");
    let id = store.register_input(&path).expect("register");
    let store = Arc::new(store);

    let reached = Arc::new(Barrier::new(2));
    let proceed = Arc::new(Barrier::new(2));
    let (cancellation, chunks) = gated(Arc::clone(&reached), Arc::clone(&proceed));
    let operation = store.accept_job_with(cancellation).expect("accept");

    let worker = {
        let store = Arc::clone(&store);
        std::thread::spawn(move || store.capture_file_facts(operation, &[id]))
    };
    // The worker is inside its first chunk and cannot commit.
    reached.wait();
    assert_eq!(store.cancel_job(operation), CancelOutcome::Cancelled);
    proceed.wait();

    assert_eq!(
        worker.join().expect("the worker"),
        Err(ProjectError::Cancelled)
    );
    // The flag is checked at every chunk boundary before the read. The gate
    // held the worker at the first boundary, so the cancel was seen there and
    // no chunk was read at all: one boundary reached, none crossed. A full
    // read of this file crosses five (four of data, one that finds the end).
    assert_eq!(chunks.load(Ordering::SeqCst), 1);

    let described = store.describe();
    assert!(
        described.artifacts.is_empty(),
        "a cancel that won before commit published no artifact"
    );
    assert_eq!(described.runs[0].outcome, "cancelled");
    assert_eq!(
        described.inputs[0].members[0].recorded_byte_length,
        200 * 1024,
        "the recorded baseline is untouched"
    );

    // Control: a fresh operation reads the whole file and completes, and its
    // reader crossed every boundary the cancelled one did not.
    let (cancellation, chunks) = counting();
    let operation = store.accept_job_with(cancellation).expect("accept");
    store
        .capture_file_facts(operation, &[id])
        .expect("completes");
    assert_eq!(chunks.load(Ordering::SeqCst), 5);
    let described = store.describe();
    assert_eq!(described.artifacts.len(), 1);
    assert_eq!(described.runs[1].outcome, "completed");

    // And the history that resulted is a valid document: the cancelled run
    // names no artifact, the completed one names exactly its own.
    let document = scratch.join("project.mscanvas");
    store.save_as(&document).expect("save as");
    let reopened = ProjectStore::new();
    reopened.open_document(&document, false).expect("open");
    let after = reopened.describe();
    assert_eq!(after.runs[0].outcome, "cancelled");
    assert!(after.runs[0].output_artifact_ids.is_empty());
    assert_eq!(
        after.runs[1].output_artifact_ids,
        vec![after.artifacts[0].id.clone()]
    );
}

#[test]
fn a_cancel_names_only_its_own_operation_while_another_runs() {
    let scratch = Scratch::new("cancel-names-one");
    let path = scratch.write("big.bin", &vec![0x33; 200 * 1024]);
    let store = ProjectStore::new();
    store.create("Fixture".to_owned(), false).expect("new");
    let id = store.register_input(&path).expect("register");
    let store = Arc::new(store);

    // An earlier operation, finished. Its identifier is now a late one.
    let earlier = store.accept_job().expect("accept");
    store.check_linked_files(earlier).expect("run");

    let reached = Arc::new(Barrier::new(2));
    let proceed = Arc::new(Barrier::new(2));
    let (cancellation, _) = gated(Arc::clone(&reached), Arc::clone(&proceed));
    let current = store.accept_job_with(cancellation).expect("accept");
    assert_ne!(earlier, current);

    let worker = {
        let store = Arc::clone(&store);
        std::thread::spawn(move || store.check_linked_files(current))
    };
    reached.wait();

    // While it runs: a late cancel for the earlier operation names nothing
    // that is running; an identifier never minted names nothing at all; a
    // second operation is refused; and running this one twice is refused.
    assert_eq!(store.cancel_job(earlier), CancelOutcome::Stale);
    assert_eq!(store.cancel_job(never_minted()), CancelOutcome::Stale);
    assert_eq!(store.accept_job(), Err(ProjectError::AlreadyRunning));
    assert_eq!(
        store.check_linked_files(current),
        Err(ProjectError::AlreadyRunning)
    );

    // Cancelling the running operation itself, twice, is one cancellation.
    assert_eq!(store.cancel_job(current), CancelOutcome::Cancelled);
    assert_eq!(store.cancel_job(current), CancelOutcome::Cancelled);
    proceed.wait();
    worker.join().expect("the worker").expect("the check");
    assert_eq!(verification(&store, id), "notChecked");

    // Once it is gone, its identifier is late too, and the next operation
    // runs to completion.
    assert_eq!(store.cancel_job(current), CancelOutcome::NoActiveOperation);
    check(&store).expect("the next check");
    assert_eq!(verification(&store, id), "matchingRecordedContent");
}

#[test]
fn closing_and_reopening_while_a_check_runs_discards_its_answer() {
    let scratch = Scratch::new("cancel-reopen");
    let path = scratch.write("big.bin", &vec![0x77; 200 * 1024]);
    let store = ProjectStore::new();
    store.create("Fixture".to_owned(), false).expect("new");
    let id = store.register_input(&path).expect("register");
    let document = scratch.join("project.mscanvas");
    store.save_as(&document).expect("save as");
    let store = Arc::new(store);

    let reached = Arc::new(Barrier::new(2));
    let proceed = Arc::new(Barrier::new(2));
    let (cancellation, _) = gated(Arc::clone(&reached), Arc::clone(&proceed));
    let operation = store.accept_job_with(cancellation).expect("accept");
    let worker = {
        let store = Arc::clone(&store);
        std::thread::spawn(move || store.check_linked_files(operation))
    };
    reached.wait();

    // The same document, closed and reopened underneath the running check.
    // Reopening keeps every identifier, so the check's answers would still
    // find rows to land in -- which is exactly why the generation, not the
    // identifiers, decides whether they may.
    store.close(false).expect("close");
    store.open_document(&document, false).expect("reopen");
    proceed.wait();
    worker.join().expect("the worker").expect("the check");

    assert_eq!(
        verification(&store, id),
        "notChecked",
        "an answer computed for the closed incarnation was not applied to the reopened one"
    );
    // The delayed operation's identifier now names nothing.
    assert_eq!(
        store.cancel_job(operation),
        CancelOutcome::NoActiveOperation
    );
    // Control: the reopened project runs its own check.
    check(&store).expect("the next check");
    assert_eq!(verification(&store, id), "matchingRecordedContent");
}

#[test]
fn a_cancelled_unstarted_operation_is_not_handed_to_the_next_activation() {
    let scratch = Scratch::new("cancel-unstarted-reuse");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"bytes");

    // Accepted and cancelled, and its run never arrives -- a reload or a lost
    // request between the acceptance and the run. Found by the delta review:
    // the idempotent acceptance handed this identifier, flag and all, to the
    // next activation, whose check then did nothing without saying so.
    let abandoned = store.accept_job().expect("accept");
    assert_eq!(store.cancel_job(abandoned), CancelOutcome::Cancelled);

    let next = store.accept_job().expect("accept again");
    assert_ne!(
        next, abandoned,
        "a cancelled operation is finished; the next activation is a new one"
    );
    store.check_linked_files(next).expect("runs");
    assert_eq!(
        verification(&store, id),
        "matchingRecordedContent",
        "the cancel stayed with the operation it named"
    );
    // The abandoned identifier names nothing that can run, and running the
    // next as a capture records no cancelled run the user never asked for.
    assert_eq!(
        store.check_linked_files(abandoned),
        Err(ProjectError::StaleOperation)
    );
    capture(&store, &[id]).expect("completes");
    let described = store.describe();
    assert_eq!(described.runs.len(), 1);
    assert_eq!(described.runs[0].outcome, "completed");
}

#[test]
fn a_completion_that_wins_first_keeps_its_outcome() {
    let scratch = Scratch::new("cancel-late");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"bytes");
    let operation = store.accept_job().expect("accept");
    store
        .capture_file_facts(operation, &[id])
        .expect("completes");

    // The cancel is late. It rewrites nothing.
    assert_eq!(
        store.cancel_job(operation),
        CancelOutcome::NoActiveOperation
    );
    let described = store.describe();
    assert_eq!(described.runs[0].outcome, "completed");
    assert_eq!(described.artifacts.len(), 1);
}

#[test]
fn an_unstarted_operation_is_superseded_when_the_project_moves() {
    let scratch = Scratch::new("cancel-supersede");
    let (store, _) = store_with_reference(&scratch, "sample.txt", b"bytes");

    // Accepting twice at one generation is one operation, so a doubled press
    // cannot start two.
    let first = store.accept_job().expect("accept");
    assert_eq!(store.accept_job().expect("accept again"), first);

    // The project is replaced before it starts. It cannot run against the new
    // one, so the new one's operation takes its place and it is refused.
    store.create("Another".to_owned(), true).expect("replace");
    let path = scratch.write("other.txt", b"other bytes");
    let id = store.register_input(&path).expect("register");
    let second = store.accept_job().expect("accept for the new project");
    assert_ne!(first, second);
    assert_eq!(
        store.check_linked_files(first),
        Err(ProjectError::StaleOperation)
    );
    store
        .check_linked_files(second)
        .expect("the new project runs its own");
    assert_eq!(verification(&store, id), "matchingRecordedContent");

    // Finished identifiers cannot run again either.
    assert_eq!(
        store.check_linked_files(second),
        Err(ProjectError::StaleOperation)
    );
}

// ---------------------------------------------------------------------------
// The recorded timestamp
// ---------------------------------------------------------------------------

#[test]
fn the_recorded_instant_is_a_real_rfc_3339_date() {
    assert_eq!(super::format_rfc3339(0), "1970-01-01T00:00:00Z");
    assert_eq!(super::format_rfc3339(86_399), "1970-01-01T23:59:59Z");
    assert_eq!(super::format_rfc3339(86_400), "1970-01-02T00:00:00Z");
    // A leap day, which is the case the civil-date conversion exists for.
    assert_eq!(super::format_rfc3339(1_709_164_800), "2024-02-29T00:00:00Z");
    assert_eq!(super::format_rfc3339(1_758_240_000), "2025-09-19T00:00:00Z");
}

// ---------------------------------------------------------------------------
// Physical limits this machine cannot test
// ---------------------------------------------------------------------------

/// Recorded rather than approximated.
///
/// A second physical volume is what would settle whether a project copied
/// across volumes behaves as the relative-locator tests suggest, and whether
/// the 128-bit file ID distinguishes objects that collide on a truncated index.
/// This machine has one volume available to the test process, so both remain
/// untested here. Copying between two directories is not copying between two
/// volumes, and this test exists so that the difference is written down rather
/// than assumed away by a test that reads like cross-volume coverage.
#[test]
fn cross_volume_behaviour_is_not_covered_by_these_tests() {
    // Deliberately asserts only the thing that is true: the tests above use one
    // volume.
    let scratch = Scratch::new("one-volume");
    let first = scratch.write("a.txt", b"a");
    let second = scratch.write("b/c.txt", b"c");

    #[cfg(windows)]
    {
        let first_volume = crate::local_document::object_identity(&first).map(|(volume, _)| volume);
        let second_volume =
            crate::local_document::object_identity(&second).map(|(volume, _)| volume);
        assert_eq!(
            first_volume, second_volume,
            "both fixtures are on one volume, which is the limit this records"
        );
    }
    #[cfg(not(windows))]
    {
        let _ = (first, second);
    }
}

// ---------------------------------------------------------------------------
// Review findings: a document that cannot be saved again
// ---------------------------------------------------------------------------

#[test]
fn a_reference_a_record_observed_is_refused_removal_with_no_run_naming_it() {
    let scratch = Scratch::new("orphan-artifact");
    let store = ProjectStore::new();
    store.create("Fixture".to_owned(), false).expect("new");
    let path = scratch.write("sample.txt", b"bytes");
    let id = store.register_input(&path).expect("register");

    // An artifact observing this input with no run naming it. `validate`
    // accepts such a document -- an earlier build, another tool, a hand edit --
    // so this is a shape a user can legitimately be holding.
    {
        let mut session = store
            .session
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let project = session.project.as_mut().expect("the open project");
        project
            .document
            .artifacts
            .push(super::record::ArtifactRecord {
                id: mscanvas_core::ArtifactId::new(),
                label: "File facts: sample.txt".to_owned(),
                payload: super::record::ArtifactPayload::FileFactsV1(super::record::FileFactsV1 {
                    observations: vec![super::record::ObservedInput {
                        input_id: id,
                        members: vec![super::record::ObservedMember {
                            role: MemberRole::Primary,
                            relative_name: String::new(),
                            byte_length: 5,
                            sha256: "A".repeat(64),
                        }],
                    }],
                }),
            });
    }

    let before = document_of(&store);

    // The record is history whatever produced it. Removing the reference
    // alone would leave it observing an input the document no longer has --
    // refused as `DanglingReference` on every later Save -- and removing the
    // record with it would be deleting history nobody asked to delete.
    assert_eq!(store.remove_input(id), Err(ProjectError::InputUsedByRun));
    assert_eq!(document_of(&store), before);
    store
        .save_as(&scratch.join("project.mscanvas"))
        .expect("the project is still saveable");
}

#[test]
fn a_capture_over_a_reference_removed_while_it_ran_is_discarded() {
    let scratch = Scratch::new("capture-stale");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"bytes");

    // What a removal does to work that is already in flight, exercised through
    // the one thing that decides it: the session generation. Removing a record
    // advances it, and a capture that started earlier must not commit a run
    // naming a record the document no longer has.
    let before = {
        let session = store
            .session
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        session.generation
    };
    store.remove_input(id).expect("remove");
    let after = {
        let session = store
            .session
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        session.generation
    };
    assert_ne!(
        before, after,
        "a removal must be visible to work that is already running"
    );

    // And the document is saveable, which is the failure the guard prevents.
    store
        .save_as(&scratch.join("project.mscanvas"))
        .expect("the project is still saveable");
}

#[test]
fn a_save_as_over_a_newer_revision_of_the_same_project_is_refused() {
    let scratch = Scratch::new("save-as-stale");
    let (store, _) = store_with_reference(&scratch, "sample.txt", b"bytes");
    let document = scratch.join("project.mscanvas");
    store.save_as(&document).expect("first save");

    // A second session opens the same document and publishes over it.
    let other = ProjectStore::new();
    other.open_document(&document, false).expect("open");
    other.save().expect("the other session saves");
    let other_bytes = fs::read(&document).expect("read");

    // The first session picks Save As and points at that same name. Publishing
    // would not only discard the other writer: it would leave two documents
    // claiming this project at the same revision, after which neither session
    // could tell a stale save from a fresh one ever again.
    let refusal = store.save_as(&document).expect_err("a refusal");

    assert_eq!(refusal, ProjectError::StaleDocument);
    assert_eq!(fs::read(&document).expect("read again"), other_bytes);
}

#[test]
fn a_save_as_over_a_different_project_is_refused() {
    let scratch = Scratch::new("save-as-other");
    let (mine, _) = store_with_reference(&scratch, "mine.txt", b"mine");
    let (theirs, _) = store_with_reference(&scratch, "theirs.txt", b"theirs");

    let occupied = scratch.join("theirs.mscanvas");
    theirs.save_as(&occupied).expect("their save");
    let their_bytes = fs::read(&occupied).expect("read");

    let refusal = mine.save_as(&occupied).expect_err("a refusal");

    // A project document is still somebody else's file. The save dialog carries
    // no overwrite prompt, so there is no confirmation behind which replacing
    // one could be the right answer.
    assert_eq!(refusal, ProjectError::DestinationNotAProject);
    assert_eq!(fs::read(&occupied).expect("read again"), their_bytes);
}

#[test]
fn saving_repeatedly_to_the_same_chosen_name_keeps_working() {
    // The rule above must not break the ordinary case: Save As twice to the
    // same place is a user replacing their own current document.
    let scratch = Scratch::new("save-as-twice");
    let (store, _) = store_with_reference(&scratch, "sample.txt", b"bytes");
    let document = scratch.join("project.mscanvas");
    store.save_as(&document).expect("first");
    store.save_as(&document).expect("second");
    store.save_as(&document).expect("third");

    let parsed = record::parse(&fs::read(&document).expect("read")).expect("parse");
    assert_eq!(parsed.revision, 3);
}

// ---------------------------------------------------------------------------
// Review findings: digests, and names that are not what they look like
// ---------------------------------------------------------------------------

#[test]
fn a_lower_case_recorded_digest_still_matches_identical_bytes() {
    let scratch = Scratch::new("digest-case");
    let (store, _) = store_with_reference(&scratch, "sample.txt", b"stable bytes");
    let document = scratch.join("project.mscanvas");
    store.save_as(&document).expect("save as");

    // A digest written in lower case -- by `sha256sum`, by another tool, or by
    // a hand edit. `valid_digest` accepts either case, so this document opens.
    let text = String::from_utf8(fs::read(&document).expect("read")).expect("utf-8");
    let lowered = text
        .split('"')
        .map(|piece| {
            if piece.len() == 64 && piece.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                piece.to_ascii_lowercase()
            } else {
                piece.to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join("\"");
    assert!(lowered != text, "the fixture actually changed case");
    fs::write(&document, lowered.as_bytes()).expect("write");

    let reopened = ProjectStore::new();
    reopened.open_document(&document, false).expect("open");
    check(&reopened).expect("check");

    // The bytes are identical. Telling the user their data changed because two
    // spellings of one digest were compared as strings would be a false alarm
    // they could never clear.
    assert_eq!(
        reopened.describe().inputs[0].verification,
        "matchingRecordedContent"
    );
}

#[test]
fn a_name_that_is_not_the_file_it_looks_like_is_refused() {
    // Each of these parses as a single `Component::Normal`, and none of them is
    // the ordinary directory entry it appears to be on Windows.
    for name in [
        // An alternate data stream of the file beside it: it opens, reports
        // itself as an ordinary file, and has content no directory listing
        // shows.
        "sample.txt:payload",
        // Trailing dots and spaces are stripped, so these are `sample.txt` --
        // which would let one file be recorded as two distinct members.
        "sample.txt ",
        "sample.txt.",
        // Device names are reserved in every directory.
        "NUL",
        "con",
        "COM1.raw",
        // Characters Win32 does not permit in a name at all.
        "why?.txt",
        "pipe|.txt",
    ] {
        let mut document = valid_document();
        document.inputs[0].members.push(MemberRecord {
            role: MemberRole::RequiredCompanion,
            relative_name: name.to_owned(),
            baseline: ContentBaseline {
                byte_length: 1,
                sha256: "B".repeat(64),
            },
        });
        assert_eq!(
            refused(&document),
            DocumentProblem::InvalidLocator,
            "{name} must not be accepted as a member name"
        );

        let locator = Locator::ProjectRelative {
            path: name.to_owned(),
        };
        assert_eq!(
            record::validate_locator(&locator).expect_err("a refusal"),
            DocumentProblem::InvalidLocator,
            "{name} must not be accepted as a relative locator"
        );
    }
}

#[test]
fn a_legitimately_long_file_name_is_still_registerable() {
    // Windows allows 255 characters in one name. Holding a *name* to the bound
    // this application uses for a *label* would make a real acquisition
    // impossible to reference at all, which is a refusal with no remedy: the
    // user cannot shorten a name their instrument wrote.
    let scratch = Scratch::new("long-name");
    let long = format!("{}.raw", "a".repeat(240));
    let path = scratch.write(&long, b"acquisition bytes");

    let store = ProjectStore::new();
    store.create("Fixture".to_owned(), false).expect("new");
    let id = store.register_input(&path).expect("register");

    store
        .save_as(&scratch.join("project.mscanvas"))
        .expect("save as");
    check(&store).expect("check");
    assert_eq!(verification(&store, id), "matchingRecordedContent");
    // And saved beside its data, so the reference is portable rather than
    // silently falling back to an absolute one.
    assert_eq!(
        store.describe().inputs[0].locator_kind,
        super::dto::LocatorKind::InsideProject
    );
}

#[test]
fn ordinary_names_are_still_accepted() {
    // The rule above must not refuse the names a real acquisition carries.
    for name in [
        "QC_pool_01.mzML",
        "batch 07.wiff.scan",
        "run-2026-09-19.raw",
        "\u{91c7}\u{96c6}_01.raw",
        ".hidden",
        "console.txt",
        "com1x.raw",
    ] {
        let locator = Locator::ProjectRelative {
            path: format!("data/{name}"),
        };
        assert_eq!(
            record::validate_locator(&locator),
            Ok(()),
            "{name} is an ordinary file name"
        );
    }
}

#[test]
fn an_alternate_data_stream_is_refused_before_anything_reads_it() {
    let scratch = Scratch::new("ads");
    let host = scratch.write("host.txt", b"visible");
    // Written only so the refusal is about a name that would otherwise resolve.
    // On a filesystem without streams this write simply fails, and the refusal
    // below is the same either way.
    let stream = scratch.join("host.txt:payload");
    let stream_exists = fs::write(&stream, b"content nothing lists").is_ok();

    let store = ProjectStore::new();
    store.create("Fixture".to_owned(), false).expect("new");
    store.register_input(&host).expect("register the host");
    let document = scratch.join("project.mscanvas");
    store.save_as(&document).expect("save as");

    // A received document naming the stream as a member of the host.
    let text = String::from_utf8(fs::read(&document).expect("read")).expect("utf-8");
    let tampered = text.replace(
        "\"relativeName\": \"\"",
        "\"relativeName\": \"host.txt:payload\"",
    );
    assert!(tampered != text, "the fixture actually changed");
    fs::write(&document, tampered.as_bytes()).expect("write");

    let reopened = ProjectStore::new();
    let refusal = reopened
        .open_document(&document, false)
        .expect_err("a refusal");

    assert_eq!(
        refusal,
        ProjectError::Document(DocumentProblem::InvalidLocator)
    );
    // Nothing was loaded, so nothing went on to measure a stream and record it
    // as an ordinary member.
    assert!(!reopened.describe().open);
    if stream_exists {
        assert!(
            fs::read(&stream).is_ok(),
            "the refusal touched nothing on disk"
        );
    }
}

// ---------------------------------------------------------------------------
// M8.2: lineage, and the integrity that makes it unambiguous
// ---------------------------------------------------------------------------

/// The lineage of one artifact, as the interface receives it.
fn artifact_lineage(store: &ProjectStore, index: usize) -> (Option<String>, Vec<String>) {
    let described = store.describe();
    let artifact = &described.artifacts[index];
    (
        artifact.produced_by_run_id.clone(),
        artifact.source_input_ids.clone(),
    )
}

#[test]
fn an_input_reaches_its_run_and_that_run_reaches_its_artifact() {
    let scratch = Scratch::new("lineage-forward");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"bytes");
    // A second reference the run does not consume, so "used by" is a lookup
    // rather than "everything in the project".
    let other = scratch.write("unused.txt", b"other bytes");
    let unused = store.register_input(&other).expect("register");
    capture(&store, &[id]).expect("capture");

    let described = store.describe();
    let input = described
        .inputs
        .iter()
        .find(|candidate| candidate.id == id.to_string())
        .expect("the reference");
    let run = &described.runs[0];
    let artifact = &described.artifacts[0];

    // input -> run
    assert_eq!(input.consumed_by_run_ids, vec![run.id.clone()]);
    // run -> input, and run -> artifact
    assert_eq!(run.input_ids, vec![id.to_string()]);
    assert_eq!(run.output_artifact_ids, vec![artifact.id.clone()]);
    // The reference nothing used says so, rather than borrowing the other's run.
    let untouched = described
        .inputs
        .iter()
        .find(|candidate| candidate.id == unused.to_string())
        .expect("the unused reference");
    assert!(untouched.consumed_by_run_ids.is_empty());
}

#[test]
fn an_artifact_reaches_its_producing_run_and_its_source_inputs() {
    let scratch = Scratch::new("lineage-backward");
    let store = ProjectStore::new();
    store.create("Fixture".to_owned(), false).expect("new");
    let first = store
        .register_input(&scratch.write("one.txt", b"one"))
        .expect("register");
    let second = store
        .register_input(&scratch.write("two.txt", b"two"))
        .expect("register");
    capture(&store, &[first, second]).expect("capture");

    let described = store.describe();
    let (produced_by, sources) = artifact_lineage(&store, 0);

    assert_eq!(produced_by, Some(described.runs[0].id.clone()));
    // In the artifact's own order, and both of them: an artifact that observed
    // two references names two.
    assert_eq!(sources, vec![first.to_string(), second.to_string()]);
    assert_eq!(described.artifacts[0].observed_input_count, 2);
}

#[test]
fn lineage_survives_save_close_and_reopen() {
    let scratch = Scratch::new("lineage-roundtrip");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"bytes");
    capture(&store, &[id]).expect("capture");
    let before = store.describe();

    let document = scratch.join("project.mscanvas");
    store.save_as(&document).expect("save as");
    store.close(false).expect("close");
    assert!(!store.describe().open);
    store.open_document(&document, false).expect("reopen");

    let after = store.describe();
    // Every edge, by identifier, unchanged.
    assert_eq!(
        after.inputs[0].consumed_by_run_ids,
        before.inputs[0].consumed_by_run_ids
    );
    assert_eq!(after.runs[0].input_ids, before.runs[0].input_ids);
    assert_eq!(
        after.runs[0].output_artifact_ids,
        before.runs[0].output_artifact_ids
    );
    assert_eq!(
        after.artifacts[0].produced_by_run_id,
        before.artifacts[0].produced_by_run_id
    );
    assert_eq!(
        after.artifacts[0].source_input_ids,
        before.artifacts[0].source_input_ids
    );
    // And the reopened session establishes nothing about the files.
    assert_eq!(after.inputs[0].verification, "notChecked");
}

#[test]
fn a_changed_or_missing_file_leaves_the_lineage_it_was_used_by_intact() {
    let scratch = Scratch::new("lineage-vs-current");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"original bytes");
    capture(&store, &[id]).expect("capture");
    let recorded = store.describe();
    let run = recorded.runs[0].id.clone();
    let artifact = recorded.artifacts[0].id.clone();
    let baseline = recorded.inputs[0].members[0].recorded_byte_length;

    // The file changes under the project.
    fs::write(scratch.join("sample.txt"), b"different bytes entirely").expect("rewrite");
    check(&store).expect("check");
    assert_eq!(verification(&store, id), "differentContent");

    let after_change = store.describe();
    assert_eq!(
        after_change.inputs[0].consumed_by_run_ids,
        vec![run.clone()]
    );
    assert_eq!(after_change.runs[0].outcome, "completed");
    assert_eq!(
        after_change.artifacts[0].produced_by_run_id,
        Some(run.clone())
    );
    assert_eq!(
        after_change.inputs[0].members[0].recorded_byte_length, baseline,
        "a current-state check rewrote no history"
    );

    // And then it is gone entirely.
    fs::remove_file(scratch.join("sample.txt")).expect("remove");
    check(&store).expect("check again");
    assert_eq!(
        unavailable_reason(&store, id),
        Some("missingAtCheckedLocation")
    );

    let after_missing = store.describe();
    assert_eq!(
        after_missing.inputs[0].consumed_by_run_ids,
        vec![run.clone()]
    );
    assert_eq!(after_missing.artifacts[0].produced_by_run_id, Some(run));
    assert_eq!(
        after_missing.artifacts[0].source_input_ids,
        vec![id.to_string()]
    );
    assert_eq!(
        after_missing.artifacts[0].id, artifact,
        "a file that is gone did not erase what was recorded from it"
    );
}

#[test]
fn an_artifact_no_run_claims_says_so_rather_than_naming_one() {
    let scratch = Scratch::new("lineage-orphan");
    let store = ProjectStore::new();
    store.create("Fixture".to_owned(), false).expect("new");
    let kept = store
        .register_input(&scratch.write("kept.txt", b"kept"))
        .expect("register");
    let dropped = store
        .register_input(&scratch.write("dropped.txt", b"dropped"))
        .expect("register");
    capture(&store, &[kept]).expect("capture the kept one");

    // An artifact whose producing run is gone but which observes a reference
    // the project still has. The schema permits it, so the projection must
    // have an answer for it that is neither an error nor a guess.
    {
        let mut session = store
            .session
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let project = session.project.as_mut().expect("the open project");
        project
            .document
            .artifacts
            .push(super::record::ArtifactRecord {
                id: mscanvas_core::ArtifactId::new(),
                label: "File facts: dropped.txt".to_owned(),
                payload: super::record::ArtifactPayload::FileFactsV1(super::record::FileFactsV1 {
                    observations: vec![super::record::ObservedInput {
                        input_id: dropped,
                        members: vec![super::record::ObservedMember {
                            role: MemberRole::Primary,
                            relative_name: String::new(),
                            byte_length: 7,
                            sha256: "A".repeat(64),
                        }],
                    }],
                }),
            });
    }

    let described = store.describe();
    assert_eq!(described.artifacts.len(), 2);
    assert!(
        described.artifacts[1].produced_by_run_id.is_none(),
        "no run claims it, and naming one would be inventing provenance"
    );
    // It still knows what it observed.
    assert_eq!(
        described.artifacts[1].source_input_ids,
        vec![dropped.to_string()]
    );
    // The one that does have a producer is unaffected.
    assert_eq!(
        described.artifacts[0].produced_by_run_id,
        Some(described.runs[0].id.clone())
    );
    // And the document is still one this build publishes.
    store
        .save_as(&scratch.join("project.mscanvas"))
        .expect("an artifact without a producer is a valid document");
}

#[test]
fn a_document_the_capture_path_wrote_still_opens_under_the_new_rules() {
    // The positive control for every refusal below: the shapes M8.2 refuses
    // must be shapes this build cannot produce, or a project saved by M8.1
    // would stop opening.
    let scratch = Scratch::new("lineage-positive-control");
    let store = ProjectStore::new();
    store.create("Fixture".to_owned(), false).expect("new");
    let first = store
        .register_input(&scratch.write("one.txt", b"one"))
        .expect("register");
    let second = store
        .register_input(&scratch.write("two.txt", b"two"))
        .expect("register");
    // Several runs over overlapping selections, which is the shape a real
    // session produces: two artifacts, two runs, one shared reference.
    capture(&store, &[first]).expect("first capture");
    capture(&store, &[first, second]).expect("second capture");
    fs::remove_file(scratch.join("two.txt")).expect("remove");
    assert!(capture(&store, &[second]).is_err(), "a failed run too");

    let document = scratch.join("project.mscanvas");
    store.save_as(&document).expect("save as");

    let bytes = fs::read(&document).expect("read");
    let parsed = record::parse(&bytes).expect("a document this build wrote still parses");
    assert_eq!(parsed.runs.len(), 3);
    assert_eq!(parsed.artifacts.len(), 2);

    let reopened = ProjectStore::new();
    reopened.open_document(&document, false).expect("reopen");
    let described = reopened.describe();
    // Each artifact has exactly one producer, and the shared reference names
    // both completed runs.
    assert!(
        described
            .artifacts
            .iter()
            .all(|a| a.produced_by_run_id.is_some())
    );
    let shared = described
        .inputs
        .iter()
        .find(|input| input.id == first.to_string())
        .expect("the shared reference");
    assert_eq!(shared.consumed_by_run_ids.len(), 2);
}

#[test]
fn two_runs_claiming_one_artifact_are_refused_rather_than_resolved() {
    let mut document = valid_document();
    let artifact_id = mscanvas_core::ArtifactId::new();
    document.artifacts.push(super::record::ArtifactRecord {
        id: artifact_id,
        label: "File facts".to_owned(),
        payload: super::record::ArtifactPayload::FileFactsV1(super::record::FileFactsV1 {
            observations: Vec::new(),
        }),
    });
    let input_id = document.inputs[0].id;
    for _ in 0..2 {
        document.runs.push(RunRecord {
            id: RunId::new(),
            operation: RecordedOperation::CaptureFileFactsV1,
            inputs: vec![RunInput::Input { input_id }],
            output_artifact_ids: vec![artifact_id],
            outcome: TerminalOutcome::Completed,
            application_version: "0.1.0".to_owned(),
            started_at: "2026-09-22T00:00:00Z".to_owned(),
            finished_at: "2026-09-22T00:00:01Z".to_owned(),
            targeted_ms1: None,
        });
    }

    // "What produced this" would have two answers. Picking one is inventing
    // provenance and dropping the edge is hiding the disagreement, so the
    // document is refused whole.
    assert_eq!(refused(&document), DocumentProblem::AmbiguousProducer);
}

#[test]
fn one_run_claiming_one_artifact_twice_is_refused() {
    let mut document = valid_document();
    let artifact_id = mscanvas_core::ArtifactId::new();
    document.artifacts.push(super::record::ArtifactRecord {
        id: artifact_id,
        label: "File facts".to_owned(),
        payload: super::record::ArtifactPayload::FileFactsV1(super::record::FileFactsV1 {
            observations: Vec::new(),
        }),
    });
    document.runs[0].outcome = TerminalOutcome::Completed;
    document.runs[0].output_artifact_ids = vec![artifact_id, artifact_id];

    assert_eq!(refused(&document), DocumentProblem::AmbiguousProducer);
}

#[test]
fn a_run_consuming_one_input_twice_is_refused() {
    let mut document = valid_document();
    let input_id = document.inputs[0].id;
    document.runs[0].inputs = vec![RunInput::Input { input_id }, RunInput::Input { input_id }];

    assert_eq!(refused(&document), DocumentProblem::DuplicateIdentifier);
}

#[test]
fn an_artifact_observing_one_input_twice_is_refused() {
    let mut document = valid_document();
    let input_id = document.inputs[0].id;
    let member = super::record::ObservedMember {
        role: MemberRole::Primary,
        relative_name: String::new(),
        byte_length: 5,
        sha256: "A".repeat(64),
    };
    document.artifacts.push(super::record::ArtifactRecord {
        id: mscanvas_core::ArtifactId::new(),
        label: "File facts".to_owned(),
        payload: super::record::ArtifactPayload::FileFactsV1(super::record::FileFactsV1 {
            observations: vec![
                super::record::ObservedInput {
                    input_id,
                    members: vec![member.clone()],
                },
                super::record::ObservedInput {
                    input_id,
                    members: vec![member],
                },
            ],
        }),
    });

    assert_eq!(refused(&document), DocumentProblem::DuplicateIdentifier);
}

#[test]
fn a_capture_asked_for_one_reference_twice_is_refused_before_it_runs() {
    let scratch = Scratch::new("lineage-duplicate-capture");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"bytes");

    // Refused at the entry, not at the next Save. A run that consumed one
    // reference twice is a document `validate` will not publish, and writing
    // one would leave a project that cannot be saved and has no repair.
    assert_eq!(
        capture(&store, &[id, id]).expect_err("a refusal"),
        ProjectError::UnknownRecord
    );
    let described = store.describe();
    assert!(described.runs.is_empty(), "no run was recorded");
    assert!(described.artifacts.is_empty());

    // Control: the same reference once still captures.
    capture(&store, &[id]).expect("completes");
    assert_eq!(store.describe().runs.len(), 1);
}

#[test]
fn an_unknown_schema_version_still_governs_a_document_with_lineage() {
    // The M8.1 open policy is unchanged by anything M8.2 added: the version is
    // decided before any relationship is examined.
    let mut document = valid_document();
    document.schema_version = record::SCHEMA_VERSION + 1;
    let artifact_id = mscanvas_core::ArtifactId::new();
    document.artifacts.push(super::record::ArtifactRecord {
        id: artifact_id,
        label: "File facts".to_owned(),
        payload: super::record::ArtifactPayload::FileFactsV1(super::record::FileFactsV1 {
            observations: Vec::new(),
        }),
    });
    // Ambiguous as well, so that whichever rule answers first is visible.
    for _ in 0..2 {
        document.runs.push(RunRecord {
            id: RunId::new(),
            operation: RecordedOperation::CaptureFileFactsV1,
            inputs: vec![RunInput::Input {
                input_id: document.inputs[0].id,
            }],
            output_artifact_ids: vec![artifact_id],
            outcome: TerminalOutcome::Completed,
            application_version: "0.1.0".to_owned(),
            started_at: "2026-09-22T00:00:00Z".to_owned(),
            finished_at: "2026-09-22T00:00:01Z".to_owned(),
            targeted_ms1: None,
        });
    }

    assert_eq!(
        refused(&document),
        DocumentProblem::UnsupportedVersion,
        "the version decides before the relationships are read"
    );
}

#[test]
fn a_lineage_query_answers_fully_for_files_that_are_not_there() {
    let scratch = Scratch::new("lineage-no-io");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"bytes");
    capture(&store, &[id]).expect("capture");
    let document = scratch.join("project.mscanvas");
    store.save_as(&document).expect("save as");

    // Every referenced file is gone, and so is the directory they were in.
    // Anything that touched the filesystem to answer would now answer
    // differently -- or not at all.
    fs::remove_file(scratch.join("sample.txt")).expect("remove");

    let reopened = ProjectStore::new();
    reopened.open_document(&document, false).expect("open");
    let described = reopened.describe();

    assert_eq!(described.inputs[0].consumed_by_run_ids.len(), 1);
    assert_eq!(
        described.artifacts[0].produced_by_run_id,
        Some(described.runs[0].id.clone())
    );
    assert_eq!(
        described.artifacts[0].source_input_ids,
        vec![id.to_string()]
    );
    // And nothing was established about the files, because nothing looked.
    assert_eq!(described.inputs[0].verification, "notChecked");
}

#[test]
fn removing_an_unused_reference_leaves_every_lineage_edge_where_it_was() {
    let scratch = Scratch::new("lineage-remove");
    let store = ProjectStore::new();
    store.create("Fixture".to_owned(), false).expect("new");
    let kept = store
        .register_input(&scratch.write("kept.txt", b"kept"))
        .expect("register");
    let removed = store
        .register_input(&scratch.write("removed.txt", b"removed"))
        .expect("register");
    capture(&store, &[kept]).expect("capture kept");
    let before = document_of(&store);

    store.remove_input(removed).expect("remove");

    // The reference goes and nothing else does: its removal is not an edit to
    // any recorded relationship.
    let after = document_of(&store);
    assert_eq!(after.inputs, before.inputs[..1]);
    assert_eq!(after.runs, before.runs);
    assert_eq!(after.artifacts, before.artifacts);
    let described = store.describe();
    assert_eq!(described.inputs[0].id, kept.to_string());
    assert_eq!(
        described.inputs[0].consumed_by_run_ids,
        vec![described.runs[0].id.clone()]
    );
    assert_eq!(
        described.artifacts[0].produced_by_run_id,
        Some(described.runs[0].id.clone())
    );
    store
        .save_as(&scratch.join("project.mscanvas"))
        .expect("still saveable");
}

// ---------------------------------------------------------------------------
// M8.4: layer identity and provenance
// ---------------------------------------------------------------------------

/// Remembers a workspace row for one reference the way the bridge does:
/// accept, prove, and record the proof's own objects under a handle.
///
/// No workspace is involved, so no lease is held on the file afterwards --
/// which is what lets a test delete the file and see whether anything looked.
fn admit(store: &ProjectStore, id: InputId, handle: &str) {
    let job = store.accept_job().expect("accept");
    let proof = store.prove_admissible(job, id).expect("proved");
    store
        .record_admission(&proof, handle, proof.identities())
        .expect("the row is remembered");
}

/// The roster's answer where the remembered row is still there.
fn live(_handle: &str) -> bool {
    true
}

/// The open document, exactly as the store holds it.
fn document_of(store: &ProjectStore) -> ProjectDocument {
    let session = store
        .session
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    session
        .project
        .as_ref()
        .expect("the open project")
        .document
        .clone()
}

/// The workspace row the description remembers for one reference, if any.
fn remembered_row(store: &ProjectStore, id: InputId) -> Option<String> {
    store
        .describe()
        .inputs
        .iter()
        .find(|input| input.id == id.to_string())
        .and_then(|input| input.workbench_dataset_handle.clone())
}

/// The layers alone, as the document stores them.
fn layers_value(document: &ProjectDocument) -> serde_json::Value {
    serde_json::to_value(&document.layers).expect("serializable")
}

/// Everything the interface sees except the layers, for "nothing else
/// changed" comparisons.
fn described_without_layers(store: &ProjectStore) -> serde_json::Value {
    let mut value = serde_json::to_value(store.describe()).expect("serializable");
    value.as_object_mut().expect("an object").remove("layers");
    value
}

/// Everything the document stores except the layers.
fn document_without_layers(store: &ProjectStore) -> serde_json::Value {
    let mut value = serde_json::to_value(document_of(store)).expect("serializable");
    value.as_object_mut().expect("an object").remove("layers");
    value
}

/// The fixture with a second reference and one layer per reference, for the
/// refusals below to break in one place.
fn document_with_two_layers() -> ProjectDocument {
    let mut document = valid_document();
    let mut second = document.inputs[0].clone();
    second.id = InputId::new();
    second.label = "other.txt".to_owned();
    second.locator = Locator::ProjectRelative {
        path: "other.txt".to_owned(),
    };
    document.inputs.push(second);
    let sources: Vec<InputId> = document.inputs.iter().map(|input| input.id).collect();
    for input_id in sources {
        document.layers.push(LayerRecord {
            id: LayerId::new(),
            source: LayerSource::Input { input_id },
        });
    }
    document
}

fn refused_value(value: &serde_json::Value) -> DocumentProblem {
    let bytes = serde_json::to_vec(value).expect("serialize");
    record::parse(&bytes).expect_err("a refusal")
}

#[test]
fn an_attached_reference_becomes_one_layer_sourced_from_it() {
    let scratch = Scratch::new("layer-create");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"bytes");
    admit(&store, id, "dataset-1");
    // Published first, so that the dirty flag below is the layer's doing.
    store
        .save_as(&scratch.join("project.mscanvas"))
        .expect("save as");
    assert!(!store.describe().dirty);

    let layer = store.create_layer(id, live).expect("the layer is created");

    let document = document_of(&store);
    assert_eq!(document.layers.len(), 1);
    assert_eq!(document.layers[0].id, layer);
    assert_eq!(
        document.layers[0].source,
        LayerSource::Input { input_id: id }
    );
    let described = store.describe();
    assert!(described.dirty);
    assert_eq!(described.layers.len(), 1);
    assert_eq!(described.layers[0].id, layer.to_string());
    assert_eq!(described.layers[0].source_input_id, id.to_string());
}

#[test]
fn creating_the_layer_again_answers_the_same_layer_without_dirtying_a_saved_project() {
    let scratch = Scratch::new("layer-idempotent");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"bytes");
    admit(&store, id, "dataset-1");
    let first = store.create_layer(id, live).expect("created");
    store
        .save_as(&scratch.join("project.mscanvas"))
        .expect("save as");
    assert!(!store.describe().dirty);

    let asked = Cell::new(0);
    let second = store
        .create_layer(id, |_| {
            asked.set(asked.get() + 1);
            true
        })
        .expect("answered");

    assert_eq!(second, first);
    assert_eq!(document_of(&store).layers.len(), 1);
    assert!(
        !store.describe().dirty,
        "answering with an existing layer changes nothing"
    );
    assert_eq!(
        asked.get(),
        0,
        "an existing layer is not conditional on the row, so the roster is not asked"
    );
}

#[test]
fn a_layer_survives_save_close_and_reopen_and_no_row_is_restored() {
    let scratch = Scratch::new("layer-roundtrip");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"bytes");
    admit(&store, id, "dataset-1");
    let layer = store.create_layer(id, live).expect("created");
    let document = scratch.join("project.mscanvas");
    store.save_as(&document).expect("save as");
    store.save().expect("save");
    let before = store.describe();
    assert_eq!(
        before.inputs[0].workbench_dataset_handle.as_deref(),
        Some("dataset-1")
    );

    store.close(false).expect("close");
    store.open_document(&document, false).expect("reopen");

    let reopened = document_of(&store);
    assert_eq!(reopened.layers.len(), 1);
    assert_eq!(reopened.layers[0].id, layer);
    assert_eq!(
        reopened.layers[0].source,
        LayerSource::Input { input_id: id }
    );
    let after = store.describe();
    assert_eq!(after.layers[0].id, before.layers[0].id);
    assert_eq!(
        after.layers[0].source_input_id,
        before.layers[0].source_input_id
    );
    assert!(
        after
            .inputs
            .iter()
            .all(|input| input.workbench_dataset_handle.is_none()),
        "a document restores no row: the handle was never in it"
    );
}

#[test]
fn save_as_to_another_directory_keeps_the_layer_and_its_source() {
    let first_home = Scratch::new("layer-first-home");
    let (store, id) = store_with_reference(&first_home, "sample.txt", b"bytes");
    admit(&store, id, "dataset-1");
    let layer = store.create_layer(id, live).expect("created");
    store
        .save_as(&first_home.join("project.mscanvas"))
        .expect("first save");

    let second_home = Scratch::new("layer-second-home");
    let elsewhere = second_home.join("project.mscanvas");
    store.save_as(&elsewhere).expect("second save");

    let reopened = ProjectStore::new();
    reopened
        .open_document(&elsewhere, false)
        .expect("open the second document");
    let document = document_of(&reopened);
    assert_eq!(document.layers.len(), 1);
    assert_eq!(document.layers[0].id, layer);
    assert_eq!(document.layers[0].source.input_id(), id);
    assert_eq!(
        reopened.describe().layers[0].id,
        store.describe().layers[0].id
    );
}

#[test]
fn a_reopened_layer_is_there_before_any_row_and_a_new_admission_converges_on_it() {
    let scratch = Scratch::new("layer-reopen-converge");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"bytes");
    let other = store
        .register_input(&scratch.write("other.txt", b"other"))
        .expect("register");
    admit(&store, id, "dataset-1");
    let layer = store.create_layer(id, live).expect("created");
    let document = scratch.join("project.mscanvas");
    store.save_as(&document).expect("save as");
    store.close(false).expect("close");
    store.open_document(&document, false).expect("reopen");
    assert!(
        store
            .describe()
            .inputs
            .iter()
            .all(|input| input.workbench_dataset_handle.is_none())
    );

    // Negative control: a reference with no layer and no row is refused, and
    // with no remembered row there is nothing to ask the roster about.
    let asked = Cell::new(0);
    assert_eq!(
        store.create_layer(other, |_| {
            asked.set(asked.get() + 1);
            true
        }),
        Err(ProjectError::NotInWorkbench)
    );
    assert_eq!(asked.get(), 0);
    // The reference that has a layer answers with it, row or no row.
    assert_eq!(
        store.create_layer(id, |_| {
            asked.set(asked.get() + 1);
            true
        }),
        Ok(layer)
    );
    assert_eq!(asked.get(), 0);

    // Positive control: a fresh admission through the ordinary path converges
    // on the same layer rather than minting a second.
    check(&store).expect("check");
    admit(&store, id, "dataset-7");
    assert_eq!(store.create_layer(id, live), Ok(layer));
    assert_eq!(document_of(&store).layers.len(), 1);
    // And the other reference, once admitted, gets one of its own.
    admit(&store, other, "dataset-8");
    let second = store.create_layer(other, live).expect("created");
    assert_ne!(second, layer);
    assert_eq!(document_of(&store).layers.len(), 2);
}

#[test]
fn the_source_check_state_neither_gates_nor_rewrites_the_layer() {
    let scratch = Scratch::new("layer-check-state");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"bytes");
    admit(&store, id, "dataset-1");
    // Save As resets every verification while keeping the association.
    store
        .save_as(&scratch.join("project.mscanvas"))
        .expect("save as");
    assert_eq!(verification(&store, id), "notChecked");
    assert_eq!(remembered_row(&store, id).as_deref(), Some("dataset-1"));

    let layer = store
        .create_layer(id, live)
        .expect("association-based, not check-based");
    assert_eq!(
        verification(&store, id),
        "notChecked",
        "creating a layer ran no check"
    );
    let before = layers_value(&document_of(&store));

    fs::remove_file(scratch.join("sample.txt")).expect("remove");
    check(&store).expect("check");
    assert_eq!(
        unavailable_reason(&store, id),
        Some("missingAtCheckedLocation")
    );

    let after = document_of(&store);
    assert_eq!(layers_value(&after), before);
    assert_eq!(after.layers[0].id, layer);
}

#[test]
fn relinking_the_source_keeps_the_layer_and_detaches_its_row() {
    let scratch = Scratch::new("layer-relink");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"stable bytes");
    admit(&store, id, "dataset-1");
    let layer = store.create_layer(id, live).expect("created");
    let before = layers_value(&document_of(&store));

    let copy = scratch.write("moved/sample.txt", b"stable bytes");
    assert!(store.propose_relink(id, &copy).expect("propose"));
    store.commit_relink(id).expect("commit");

    let document = document_of(&store);
    assert_eq!(layers_value(&document), before);
    assert_eq!(document.layers[0].id, layer);
    assert_eq!(document.layers[0].source.input_id(), id);
    // The record names a different object now, so the row this session
    // admitted for the old one is dropped -- and the layer's projection is
    // detached until a new admission. The layer itself is the same layer.
    assert_eq!(remembered_row(&store, id), None);
    assert_eq!(store.create_layer(id, live), Ok(layer));
}

#[test]
fn removing_a_layer_changes_nothing_but_the_layer() {
    let scratch = Scratch::new("layer-remove");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"bytes");
    let other = store
        .register_input(&scratch.write("other.txt", b"other"))
        .expect("register");
    capture(&store, &[id, other]).expect("capture");
    admit(&store, id, "dataset-1");
    admit(&store, other, "dataset-2");
    let layer = store.create_layer(id, live).expect("created");
    // An outstanding proposal too, so the whole session state is on the table.
    let candidate = scratch.write("elsewhere/other.txt", b"other");
    store.propose_relink(other, &candidate).expect("propose");
    let described_before = described_without_layers(&store);
    let document_before = document_without_layers(&store);

    store.remove_layer(layer).expect("removed");

    assert!(document_of(&store).layers.is_empty());
    assert_eq!(described_without_layers(&store), described_before);
    assert_eq!(document_without_layers(&store), document_before);
    assert_eq!(
        store.remove_layer(layer),
        Err(ProjectError::UnknownRecord),
        "a layer that is gone is gone"
    );
    assert_eq!(
        store.remove_layer(LayerId::new()),
        Err(ProjectError::UnknownRecord)
    );
}

#[test]
fn a_reference_with_a_layer_is_refused_removal_until_the_layer_goes() {
    let scratch = Scratch::new("layer-blocks-removal");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"bytes");
    admit(&store, id, "dataset-1");
    let layer = store.create_layer(id, live).expect("created");
    store
        .save_as(&scratch.join("project.mscanvas"))
        .expect("save as");
    let document_before = serde_json::to_value(document_of(&store)).expect("serializable");
    let described_before = serde_json::to_value(store.describe()).expect("serializable");

    assert_eq!(
        store.remove_input(id),
        Err(ProjectError::LayerDependsOnInput)
    );

    assert_eq!(
        serde_json::to_value(document_of(&store)).expect("serializable"),
        document_before
    );
    assert_eq!(
        serde_json::to_value(store.describe()).expect("serializable"),
        described_before
    );
    assert!(!store.describe().dirty, "a refusal dirties nothing");

    store.remove_layer(layer).expect("remove the layer");
    store.remove_input(id).expect("now the reference goes");
    let document = document_of(&store);
    assert!(document.inputs.is_empty());
    assert!(document.layers.is_empty());
    record::validate(&document).expect("a valid document");
}

#[test]
fn two_layers_sharing_one_identifier_are_refused_and_two_distinct_ones_parse() {
    let document = document_with_two_layers();
    let bytes = record::serialize(&document).expect("serialize");
    let parsed = record::parse(&bytes).expect("distinct identifiers over distinct sources parse");
    assert_eq!(parsed.layers, document.layers);

    let mut duplicated = document;
    duplicated.layers[1].id = duplicated.layers[0].id;
    assert_eq!(refused(&duplicated), DocumentProblem::DuplicateIdentifier);
}

#[test]
fn a_layer_naming_a_reference_the_document_lacks_is_refused() {
    let mut document = document_with_two_layers();
    document.layers[1].source = LayerSource::Input {
        input_id: InputId::new(),
    };
    assert_eq!(refused(&document), DocumentProblem::DanglingReference);
}

#[test]
fn a_layer_of_an_unknown_source_kind_or_with_an_extra_field_is_malformed() {
    let document = document_with_two_layers();

    let mut unknown_kind = serde_json::to_value(&document).expect("serializable");
    unknown_kind["layers"][0]["source"]["kind"] = serde_json::Value::from("run");
    assert_eq!(refused_value(&unknown_kind), DocumentProblem::Malformed);

    let mut extra_field = serde_json::to_value(&document).expect("serializable");
    extra_field["layers"][0]["label"] = serde_json::Value::from("a name a layer does not hold");
    assert_eq!(refused_value(&extra_field), DocumentProblem::Malformed);

    // One level down, inside the source itself, which is where a session fact
    // would be smuggled in. Refused, not dropped on read and lost on save.
    let mut extra_in_source = serde_json::to_value(&document).expect("serializable");
    extra_in_source["layers"][0]["source"]["datasetId"] = serde_json::Value::from("file-3");
    assert_eq!(refused_value(&extra_in_source), DocumentProblem::Malformed);

    // Control: the same document, untouched, is accepted through the same
    // path, so the three refusals above are about what was added.
    let untouched = serde_json::to_value(&document).expect("serializable");
    let bytes = serde_json::to_vec(&untouched).expect("serialize");
    assert_eq!(
        record::parse(&bytes).expect("accepted").layers,
        document.layers
    );
}

#[test]
fn two_layers_of_one_reference_are_refused_rather_than_normalised() {
    let mut document = document_with_two_layers();
    document.layers[1].source = document.layers[0].source;
    assert_eq!(refused(&document), DocumentProblem::DuplicateIdentifier);
}

#[test]
fn more_layers_than_the_bound_are_refused_as_oversized() {
    let mut document = valid_document();
    let input_id = document.inputs[0].id;
    document.layers = (0..=MAX_LAYERS)
        .map(|_| LayerRecord {
            id: LayerId::new(),
            source: LayerSource::Input { input_id },
        })
        .collect();
    assert_eq!(refused(&document), DocumentProblem::Oversized);

    // At the bound it is the duplicate source that refuses, so the count was
    // what refused above and not the shape.
    document.layers.truncate(MAX_LAYERS);
    assert_eq!(refused(&document), DocumentProblem::DuplicateIdentifier);
}

#[test]
fn a_reference_that_was_never_admitted_is_refused_without_asking_the_roster() {
    let scratch = Scratch::new("layer-never-admitted");
    let (store, id) = store_with_reference(&scratch, "notes.txt", b"not an acquisition");
    check(&store).expect("check");
    assert_eq!(verification(&store, id), "matchingRecordedContent");

    let asked = Cell::new(0);
    let refusal = store.create_layer(id, |_| {
        asked.set(asked.get() + 1);
        true
    });

    assert_eq!(refusal, Err(ProjectError::NotInWorkbench));
    assert_eq!(
        asked.get(),
        0,
        "with no remembered row there is nothing to ask about"
    );
    assert!(document_of(&store).layers.is_empty());
}

#[test]
fn a_remembered_row_the_roster_no_longer_has_is_refused_after_one_question() {
    let scratch = Scratch::new("layer-row-gone");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"bytes");
    admit(&store, id, "dataset-1");

    let asked = Cell::new(0);
    let refusal = store.create_layer(id, |handle| {
        assert_eq!(
            handle, "dataset-1",
            "the roster is asked about the remembered row"
        );
        asked.set(asked.get() + 1);
        false
    });

    assert_eq!(refusal, Err(ProjectError::NotInWorkbench));
    assert_eq!(asked.get(), 1);
    assert!(document_of(&store).layers.is_empty());
    // The handle stays remembered: it was the roster's answer that changed,
    // and the interface resolves the handle against the roster either way.
    assert_eq!(remembered_row(&store, id).as_deref(), Some("dataset-1"));
}

#[test]
fn a_project_closed_while_the_roster_is_asked_gets_no_layer() {
    let scratch = Scratch::new("layer-stale-close");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"bytes");
    admit(&store, id, "dataset-1");
    store
        .save_as(&scratch.join("project.mscanvas"))
        .expect("save as");

    // The roster is asked with the session lock released, which is the window
    // this closes the project in.
    let outcome = store.create_layer(id, |_| {
        store.close(true).expect("close while the lock is released");
        true
    });

    assert_eq!(outcome, Err(ProjectError::StaleDocument));
    assert!(!store.describe().open);
}

#[test]
fn a_different_reference_removed_while_the_roster_is_asked_gets_no_layer_written() {
    let scratch = Scratch::new("layer-stale-other");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"bytes");
    let other = store
        .register_input(&scratch.write("other.txt", b"other"))
        .expect("register");
    admit(&store, id, "dataset-1");

    let outcome = store.create_layer(id, |_| {
        store
            .remove_input(other)
            .expect("remove the other reference");
        true
    });

    assert_eq!(outcome, Err(ProjectError::StaleDocument));
    let document = document_of(&store);
    assert!(
        document.layers.is_empty(),
        "no layer was written into a project that moved"
    );
    assert_eq!(document.inputs.len(), 1);
    // Control: asked again against the project as it now is, it is created.
    assert!(store.create_layer(id, live).is_ok());
}

#[test]
fn the_source_removed_while_the_roster_is_asked_leaves_no_dangling_layer() {
    let scratch = Scratch::new("layer-stale-same");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"bytes");
    admit(&store, id, "dataset-1");

    let outcome = store.create_layer(id, |_| {
        store.remove_input(id).expect("remove the very reference");
        true
    });

    assert_eq!(outcome, Err(ProjectError::StaleDocument));
    let document = document_of(&store);
    assert!(document.inputs.is_empty());
    assert!(document.layers.is_empty());
    record::validate(&document).expect("nothing dangles");
}

#[test]
fn creating_and_removing_a_layer_reads_no_file() {
    let scratch = Scratch::new("layer-no-read");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"bytes");
    admit(&store, id, "dataset-1");
    // The file is gone before the layer is asked for. Anything that opened,
    // read or hashed it would now answer differently -- or not at all.
    fs::remove_file(scratch.join("sample.txt")).expect("remove");

    let layer = store
        .create_layer(id, live)
        .expect("a missing file is no obstacle to a layer");
    let described = store.describe();
    assert_eq!(described.layers[0].id, layer.to_string());
    assert_eq!(
        verification(&store, id),
        "matchingRecordedContent",
        "nothing looked, so nothing was re-established"
    );
    store.remove_layer(layer).expect("removed");
    assert_eq!(verification(&store, id), "matchingRecordedContent");
    assert!(store.describe().layers.is_empty());
}

#[test]
fn a_document_with_a_remembered_row_and_a_layer_serializes_no_session_fact() {
    let scratch = Scratch::new("layer-serialized-shape");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"bytes");
    admit(&store, id, "dataset-1");
    let layer = store.create_layer(id, live).expect("created");
    // Saved beside its data so the locator is relative: what is asserted below
    // is about the document's own vocabulary, not the machine's temp path.
    store
        .save_as(&scratch.join("project.mscanvas"))
        .expect("save as");
    assert_eq!(remembered_row(&store, id).as_deref(), Some("dataset-1"));

    let bytes = record::serialize(&document_of(&store)).expect("serialize");
    let text = String::from_utf8(bytes).expect("utf-8");
    let lowered = text.to_ascii_lowercase();
    for forbidden in ["dataset", "handle", "identity", "volume", "fileid"] {
        assert!(
            !lowered.contains(forbidden),
            "the document must not carry {forbidden:?}"
        );
    }
    let value: serde_json::Value = serde_json::from_str(&text).expect("json");
    assert_eq!(
        value["layers"],
        serde_json::json!([{
            "id": layer.to_string(),
            "source": { "kind": "input", "inputId": id.to_string() },
        }])
    );

    // The projection names the layer, its source and the runs that consumed it
    // (none here) -- identifiers from the document, and no session fact.
    let described = serde_json::to_value(store.describe()).expect("serializable");
    assert_eq!(
        described["layers"],
        serde_json::json!([{
            "id": layer.to_string(),
            "sourceInputId": id.to_string(),
            "consumedByRunIds": [],
        }])
    );
}

#[test]
fn the_development_only_earlier_schemas_are_refused_rather_than_migrated() {
    assert_eq!(record::SCHEMA_VERSION, 4);
    assert_eq!(ProjectDocument::new("Fixture".to_owned()).schema_version, 4);

    // Schema 3 is M8's, and it was never published either: M9.1 refuses it
    // exactly as M8.5 refused schema 2, rather than carrying a migration for
    // a format no user holds.
    for earlier in [1, 2, 3] {
        let mut document = valid_document();
        document.schema_version = earlier;
        assert_eq!(
            refused(&document),
            DocumentProblem::UnsupportedVersion,
            "schema {earlier}"
        );
    }
}

// ---------------------------------------------------------------------------
// M8.4 review: the cases the first pass left unexercised
// ---------------------------------------------------------------------------

#[test]
fn removing_a_layer_from_a_saved_project_marks_it_unsaved() {
    let scratch = Scratch::new("layer-remove-dirty");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"bytes");
    admit(&store, id, "dataset-1");
    let layer = store.create_layer(id, live).expect("created");
    store
        .save_as(&scratch.join("project.mscanvas"))
        .expect("save as");
    assert!(!store.describe().dirty, "published, so nothing is unsaved");

    store.remove_layer(layer).expect("removed");

    // Without this a saved project could lose a layer and close without being
    // asked, and the layer would be back on the next open.
    assert!(store.describe().dirty);
}

#[test]
fn a_create_that_lands_while_another_asks_the_roster_converges_on_one_layer() {
    let scratch = Scratch::new("layer-concurrent-create");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"bytes");
    admit(&store, id, "dataset-1");

    // The second create runs in the window the first one released the lock
    // for. Creating a layer does not advance the generation, so the only thing
    // that stops a second record for the same reference is the re-check after
    // the lock is taken again.
    let inner = Cell::new(None);
    let outer = store
        .create_layer(id, |_| {
            inner.set(Some(store.create_layer(id, live).expect("inner create")));
            true
        })
        .expect("outer create");

    assert_eq!(Some(outer), inner.get());
    assert_eq!(document_of(&store).layers.len(), 1);
    record::validate(&document_of(&store)).expect("one layer per reference");
}

#[test]
fn a_save_as_while_the_roster_is_asked_gets_no_layer() {
    let scratch = Scratch::new("layer-stale-save-as");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"bytes");
    admit(&store, id, "dataset-1");
    let elsewhere = Scratch::new("layer-stale-save-as-elsewhere");
    let destination = elsewhere.join("project.mscanvas");

    let outcome = store.create_layer(id, |_| {
        store
            .save_as(&destination)
            .expect("save as while the lock is released");
        true
    });

    assert_eq!(outcome, Err(ProjectError::StaleDocument));
    assert!(document_of(&store).layers.is_empty());
    let reopened = ProjectStore::new();
    reopened.open_document(&destination, false).expect("open");
    assert!(
        document_of(&reopened).layers.is_empty(),
        "nothing was published that the save did not already hold"
    );
}

#[test]
fn a_relink_committed_while_the_roster_is_asked_gets_no_layer() {
    let scratch = Scratch::new("layer-stale-relink");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"stable bytes");
    admit(&store, id, "dataset-1");
    let copy = scratch.write("moved/sample.txt", b"stable bytes");
    assert!(store.propose_relink(id, &copy).expect("propose"));

    let outcome = store.create_layer(id, |_| {
        store
            .commit_relink(id)
            .expect("commit while the lock is released");
        true
    });

    assert_eq!(outcome, Err(ProjectError::StaleDocument));
    assert!(document_of(&store).layers.is_empty());
    // The record names a different object now and its row was dropped, so a
    // fresh ask is refused on the project's own terms, not on the stale one.
    assert_eq!(
        store.create_layer(id, live),
        Err(ProjectError::NotInWorkbench)
    );
}

#[test]
fn the_same_document_reopened_while_the_roster_is_asked_gets_no_layer() {
    let scratch = Scratch::new("layer-stale-reopen");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"bytes");
    admit(&store, id, "dataset-1");
    let document = scratch.join("project.mscanvas");
    store.save_as(&document).expect("save as");

    // Reopening the same file keeps every identifier, so the reference is
    // still found by id afterwards. The generation is what says it is not the
    // same session's project any more.
    let outcome = store.create_layer(id, |_| {
        store
            .open_document(&document, true)
            .expect("reopen while the lock is released");
        true
    });

    assert_eq!(outcome, Err(ProjectError::StaleDocument));
    assert!(document_of(&store).layers.is_empty());
    assert_eq!(
        remembered_row(&store, id),
        None,
        "a reopen remembers no row"
    );
}

#[test]
fn a_project_replaced_while_the_roster_is_asked_gets_no_layer() {
    let scratch = Scratch::new("layer-stale-replace");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"bytes");
    admit(&store, id, "dataset-1");

    let outcome = store.create_layer(id, |_| {
        store
            .create("Another project".to_owned(), true)
            .expect("replace while the lock is released");
        true
    });

    assert_eq!(outcome, Err(ProjectError::StaleDocument));
    let document = document_of(&store);
    assert!(document.inputs.is_empty());
    assert!(document.layers.is_empty());
}

// ---------------------------------------------------------------------------
// M8.5: the QC summary snapshot, in the store and in the document
// ---------------------------------------------------------------------------

/// One snapshot, as a retained preview would hand it over.
fn qc_snapshot() -> record::AcquisitionQcSnapshotV1 {
    let at = |value: &str| record::RecordedRetentionTime {
        value: value.to_owned(),
        unit: record::RecordedUnit::NotEmitted,
    };
    record::AcquisitionQcSnapshotV1 {
        total_spectrum_count: 12,
        ms_level_counts: vec![
            record::MsLevelCountRecord::Level {
                ms_level: 2,
                spectrum_count: 4,
            },
            record::MsLevelCountRecord::Other { spectrum_count: 1 },
            record::MsLevelCountRecord::Level {
                ms_level: 1,
                spectrum_count: 7,
            },
        ],
        chromatogram_count: record::ReportedCount::NotReported {},
        retention_time: record::RetentionTimeSummary::Reported {
            minimum: at("0.1"),
            at_25_percent_base_peak_intensity: at("0.15"),
            at_50_percent_base_peak_intensity: at("0.2"),
            at_75_percent_base_peak_intensity: at("0.25"),
            maximum: at("0.3"),
        },
        producer: record::PreviewProducer {
            tool: record::ProducerTool::Msaccess,
            executable_sha256: "A1".repeat(32),
            release: Some("3.0.26204".to_owned()),
            build_date: None,
            source_revision: Some("a09eea9".to_owned()),
        },
    }
}

/// A store whose one reference is in the Workbench and has a layer.
fn qc_ready(scratch: &Scratch) -> (ProjectStore, InputId, LayerId) {
    let (store, id) = store_with_reference(scratch, "sample.mzML", b"bytes");
    admit(&store, id, "dataset-1");
    let layer = store.create_layer(id, live).expect("a layer");
    (store, id, layer)
}

/// How many QC runs and QC snapshots the open document holds.
fn qc_history(store: &ProjectStore) -> (usize, usize) {
    let document = document_of(store);
    (
        document
            .runs
            .iter()
            .filter(|run| run.operation == RecordedOperation::CaptureAcquisitionQcSnapshotV1)
            .count(),
        document
            .artifacts
            .iter()
            .filter(|artifact| {
                matches!(
                    artifact.payload,
                    record::ArtifactPayload::AcquisitionQcSnapshotV1(_)
                )
            })
            .count(),
    )
}

#[test]
fn a_capture_asks_about_the_remembered_row_and_commits_one_run_and_its_snapshot() {
    let scratch = Scratch::new("qc-store-commit");
    let (store, _, layer) = qc_ready(&scratch);
    let asked = std::cell::RefCell::new(Vec::new());

    let artifact = store
        .capture_qc_snapshot(layer, |handle| {
            asked.borrow_mut().push(handle.to_owned());
            Ok(qc_snapshot())
        })
        .expect("captured");

    assert_eq!(asked.into_inner(), vec!["dataset-1".to_owned()]);
    let document = document_of(&store);
    let run = document.runs.last().expect("the run");
    assert_eq!(
        run.operation,
        RecordedOperation::CaptureAcquisitionQcSnapshotV1
    );
    assert_eq!(run.inputs, vec![RunInput::Layer { layer_id: layer }]);
    assert_eq!(run.output_artifact_ids, vec![artifact]);
    assert_eq!(run.outcome, TerminalOutcome::Completed);
    assert_eq!(
        document.artifacts.last().map(|recorded| &recorded.payload),
        Some(&record::ArtifactPayload::AcquisitionQcSnapshotV1(Box::new(
            qc_snapshot()
        )))
    );
    assert!(store.describe().dirty);
    record::validate(&document).expect("the document is still one this build saves");
}

#[test]
fn a_layer_with_no_remembered_row_is_refused_without_asking_the_workspace() {
    let scratch = Scratch::new("qc-store-no-row");
    let (store, id, layer) = qc_ready(&scratch);
    // Relinking drops the remembered row, and keeps the layer.
    let candidate = scratch.write("moved.mzML", b"bytes");
    store.propose_relink(id, &candidate).expect("proposed");
    store.commit_relink(id).expect("relinked");
    let asked = Cell::new(false);

    let outcome = store.capture_qc_snapshot(layer, |_| {
        asked.set(true);
        Ok(qc_snapshot())
    });

    assert_eq!(outcome, Err(ProjectError::NotInWorkbench));
    assert!(!asked.get());
    assert_eq!(qc_history(&store), (0, 0));
}

#[test]
fn a_refusal_from_the_workspace_records_nothing() {
    let scratch = Scratch::new("qc-store-refused");
    let (store, _, layer) = qc_ready(&scratch);
    for refusal in [
        ProjectError::PreviewNotCurrent,
        ProjectError::ProducerUnidentified,
        ProjectError::NotInWorkbench,
    ] {
        assert_eq!(
            store.capture_qc_snapshot(layer, |_| Err(refusal)),
            Err(refusal)
        );
    }
    assert_eq!(qc_history(&store), (0, 0));
    assert_eq!(
        store.capture_qc_snapshot(LayerId::new(), |_| Ok(qc_snapshot())),
        Err(ProjectError::UnknownRecord)
    );
}

#[test]
fn a_project_that_moved_while_the_preview_was_asked_gets_no_run_and_no_snapshot() {
    type Move = fn(&ProjectStore, &Scratch, InputId, LayerId);
    let moves: [(&str, Move); 5] = [
        ("the layer was removed", |store, _, _, layer| {
            store.remove_layer(layer).expect("removed");
        }),
        (
            "the source was admitted as another row",
            |store, _, id, _| {
                admit(store, id, "dataset-2");
            },
        ),
        ("the project was replaced", |store, _, _, _| {
            store.create("Another".to_owned(), true).expect("replaced");
        }),
        ("the project was closed", |store, _, _, _| {
            store.close(true).expect("closed");
        }),
        ("the source was relinked", |store, scratch, id, _| {
            let candidate = scratch.write("relinked.mzML", b"bytes");
            store.propose_relink(id, &candidate).expect("proposed");
            store.commit_relink(id).expect("relinked");
        }),
    ];
    for (what, change) in moves {
        let scratch = Scratch::new("qc-store-moved");
        let (store, id, layer) = qc_ready(&scratch);

        let outcome = store.capture_qc_snapshot(layer, |_| {
            change(&store, &scratch, id, layer);
            Ok(qc_snapshot())
        });

        assert_eq!(outcome, Err(ProjectError::StaleDocument), "{what}");
        if store.describe().open {
            assert_eq!(qc_history(&store), (0, 0), "{what}");
            record::validate(&document_of(&store)).expect("nothing dangles");
        }
    }

    // Control: nothing moved, so the same capture commits.
    let scratch = Scratch::new("qc-store-unmoved");
    let (store, _, layer) = qc_ready(&scratch);
    store
        .capture_qc_snapshot(layer, |_| Ok(qc_snapshot()))
        .expect("captured");
    assert_eq!(qc_history(&store), (1, 1));
}

#[test]
fn a_capture_at_the_history_bound_is_refused_before_the_workspace_is_asked() {
    let scratch = Scratch::new("qc-store-bound");
    let (store, _, layer) = qc_ready(&scratch);
    {
        let mut session = store
            .session
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let document = &mut session.project.as_mut().expect("open").document;
        let filler = RunRecord {
            id: RunId::new(),
            operation: RecordedOperation::CaptureFileFactsV1,
            inputs: vec![RunInput::Input {
                input_id: document.inputs[0].id,
            }],
            output_artifact_ids: Vec::new(),
            outcome: TerminalOutcome::Failed,
            application_version: "0.1.0".to_owned(),
            started_at: "2026-09-22T00:00:00Z".to_owned(),
            finished_at: "2026-09-22T00:00:01Z".to_owned(),
            targeted_ms1: None,
        };
        document.runs.resize(record::MAX_RUNS, filler);
    }
    let asked = Cell::new(false);

    let outcome = store.capture_qc_snapshot(layer, |_| {
        asked.set(true);
        Ok(qc_snapshot())
    });

    assert_eq!(outcome, Err(ProjectError::Oversized));
    assert!(!asked.get());
}

#[test]
fn a_layer_a_run_consumed_is_not_removed_and_a_layer_nothing_consumed_is() {
    let scratch = Scratch::new("qc-store-remove");
    let (store, id, layer) = qc_ready(&scratch);
    store
        .capture_qc_snapshot(layer, |_| Ok(qc_snapshot()))
        .expect("captured");
    let before = document_of(&store);

    assert_eq!(store.remove_layer(layer), Err(ProjectError::LayerUsedByRun));
    assert_eq!(document_of(&store), before, "nothing was removed");
    // The run consumed the reference through its layer, so the reference is
    // pinned by history -- not sent to remove a layer that cannot go.
    assert_eq!(store.remove_input(id), Err(ProjectError::InputUsedByRun));
    assert_eq!(document_of(&store), before);

    // Control: a layer with no history of its own still goes.
    let other = store
        .register_input(&scratch.write("other.mzML", b"other"))
        .expect("register");
    admit(&store, other, "dataset-3");
    let unused = store.create_layer(other, live).expect("a layer");
    store.remove_layer(unused).expect("removed");
}

/// A valid document holding one layer, one QC run and the snapshot it produced.
fn qc_document() -> (ProjectDocument, LayerId, mscanvas_core::ArtifactId) {
    let mut document = valid_document();
    let layer = LayerId::new();
    document.layers.push(LayerRecord {
        id: layer,
        source: LayerSource::Input {
            input_id: document.inputs[0].id,
        },
    });
    let artifact = mscanvas_core::ArtifactId::new();
    document.artifacts.push(record::ArtifactRecord {
        id: artifact,
        label: "QC summary: sample.txt".to_owned(),
        payload: record::ArtifactPayload::AcquisitionQcSnapshotV1(Box::new(qc_snapshot())),
    });
    document.runs.push(RunRecord {
        id: RunId::new(),
        operation: RecordedOperation::CaptureAcquisitionQcSnapshotV1,
        inputs: vec![RunInput::Layer { layer_id: layer }],
        output_artifact_ids: vec![artifact],
        outcome: TerminalOutcome::Completed,
        application_version: "0.1.0".to_owned(),
        started_at: "2026-09-22T00:00:00Z".to_owned(),
        finished_at: "2026-09-22T00:00:00Z".to_owned(),
        targeted_ms1: None,
    });
    (document, layer, artifact)
}

/// The snapshot inside a document, to break in one place.
fn snapshot_in(document: &mut ProjectDocument) -> &mut record::AcquisitionQcSnapshotV1 {
    match &mut document.artifacts.last_mut().expect("the snapshot").payload {
        record::ArtifactPayload::AcquisitionQcSnapshotV1(snapshot) => snapshot,
        record::ArtifactPayload::FileFactsV1(_)
        | record::ArtifactPayload::TargetedMs1ResultV1(_) => {
            panic!("not the snapshot")
        }
    }
}

/// Parses the QC fixture after one edit to its JSON, the way a hand edit would.
fn parsed_after(
    edit: impl FnOnce(&mut serde_json::Value),
) -> Result<ProjectDocument, DocumentProblem> {
    let (document, _, _) = qc_document();
    let mut value = serde_json::to_value(&document).expect("json");
    edit(&mut value);
    record::parse(&serde_json::to_vec(&value).expect("bytes"))
}

#[test]
fn the_qc_fixture_document_is_accepted_and_reads_back_exactly() {
    let (document, _, _) = qc_document();
    let bytes = record::serialize(&document).expect("serialize");
    assert_eq!(record::parse(&bytes).expect("parses"), document);

    // Absence and presence each read back as themselves: a reported count is
    // not an absent one, and absent retention times are not reported ones.
    let (mut variant, _, _) = qc_document();
    let snapshot = snapshot_in(&mut variant);
    snapshot.chromatogram_count = record::ReportedCount::Reported { count: 0 };
    snapshot.retention_time = record::RetentionTimeSummary::NotReported {};
    let bytes = record::serialize(&variant).expect("serialize");
    let read = record::parse(&bytes).expect("parses");
    assert_eq!(read, variant);
    assert_ne!(read, document);
    let value: serde_json::Value = serde_json::from_slice(&bytes).expect("json");
    assert_eq!(
        value["artifacts"][0]["payload"]["chromatogramCount"],
        serde_json::json!({ "kind": "reported", "count": 0 })
    );
    assert_eq!(
        value["artifacts"][0]["payload"]["retentionTime"],
        serde_json::json!({ "kind": "notReported" })
    );
}

#[test]
fn a_lower_case_producer_digest_is_read_in_the_one_spelling_this_build_writes() {
    let read = parsed_after(|value| {
        value["artifacts"][0]["payload"]["producer"]["executableSha256"] =
            serde_json::json!("a1".repeat(32));
    })
    .expect("parses");
    match &read.artifacts[0].payload {
        record::ArtifactPayload::AcquisitionQcSnapshotV1(snapshot) => {
            assert_eq!(snapshot.producer.executable_sha256, "A1".repeat(32));
        }
        record::ArtifactPayload::FileFactsV1(_)
        | record::ArtifactPayload::TargetedMs1ResultV1(_) => {
            panic!("not the snapshot")
        }
    }
}

#[test]
fn a_run_that_crosses_its_operation_is_refused() {
    // Control.
    let (document, _, _) = qc_document();
    record::validate(&document).expect("the fixture is valid");

    // A QC run consuming a reference rather than a layer.
    let (mut document, _, _) = qc_document();
    let input_id = document.inputs[0].id;
    document.runs[1].inputs = vec![RunInput::Input { input_id }];
    assert_eq!(refused(&document), DocumentProblem::InconsistentRecord);

    // A QC run consuming the layer and a reference.
    let (mut document, layer, _) = qc_document();
    let input_id = document.inputs[0].id;
    document.runs[1].inputs = vec![
        RunInput::Layer { layer_id: layer },
        RunInput::Input { input_id },
    ];
    assert_eq!(refused(&document), DocumentProblem::InconsistentRecord);

    // A file-facts run claiming the snapshot.
    let (mut document, _, _) = qc_document();
    document.runs[1].operation = RecordedOperation::CaptureFileFactsV1;
    assert_eq!(refused(&document), DocumentProblem::InconsistentRecord);

    // A file-facts run consuming a layer.
    let (mut document, layer, _) = qc_document();
    document.runs[0].inputs = vec![RunInput::Layer { layer_id: layer }];
    assert_eq!(refused(&document), DocumentProblem::InconsistentRecord);

    // A snapshot no run claims has lost its lineage.
    let (mut document, _, _) = qc_document();
    document.runs.pop();
    assert_eq!(refused(&document), DocumentProblem::InconsistentRecord);

    // A layer the document does not have, and one layer named twice.
    let (mut document, _, _) = qc_document();
    document.runs[1].inputs = vec![RunInput::Layer {
        layer_id: LayerId::new(),
    }];
    assert_eq!(refused(&document), DocumentProblem::DanglingReference);
    let (mut document, layer, _) = qc_document();
    document.runs[1].inputs = vec![
        RunInput::Layer { layer_id: layer },
        RunInput::Layer { layer_id: layer },
    ];
    assert_eq!(refused(&document), DocumentProblem::DuplicateIdentifier);
}

#[test]
fn snapshot_values_that_contradict_the_run_summary_contract_are_refused() {
    type Break = fn(&mut record::AcquisitionQcSnapshotV1);
    let cases: [(&str, Break, DocumentProblem); 10] = [
        (
            "a total that is not the sum",
            |snapshot| snapshot.total_spectrum_count = 13,
            DocumentProblem::InconsistentRecord,
        ),
        (
            "no buckets",
            |snapshot| {
                snapshot.ms_level_counts.clear();
                snapshot.total_spectrum_count = 0;
            },
            DocumentProblem::InconsistentRecord,
        ),
        (
            "one level twice",
            |snapshot| {
                snapshot
                    .ms_level_counts
                    .push(record::MsLevelCountRecord::Level {
                        ms_level: 1,
                        spectrum_count: 0,
                    });
            },
            DocumentProblem::InconsistentRecord,
        ),
        (
            "two other buckets",
            |snapshot| {
                snapshot
                    .ms_level_counts
                    .push(record::MsLevelCountRecord::Other { spectrum_count: 0 });
            },
            DocumentProblem::InconsistentRecord,
        ),
        (
            "more buckets than a snapshot holds",
            |snapshot| {
                snapshot.ms_level_counts = (1..=65)
                    .map(|ms_level| record::MsLevelCountRecord::Level {
                        ms_level,
                        spectrum_count: 0,
                    })
                    .collect();
                snapshot.total_spectrum_count = 0;
            },
            DocumentProblem::Oversized,
        ),
        (
            "a minimum above the maximum",
            |snapshot| {
                if let record::RetentionTimeSummary::Reported { minimum, .. } =
                    &mut snapshot.retention_time
                {
                    minimum.value = "9".to_owned();
                }
            },
            DocumentProblem::InconsistentRecord,
        ),
        (
            "a value in a spelling this build does not write",
            |snapshot| {
                if let record::RetentionTimeSummary::Reported { maximum, .. } =
                    &mut snapshot.retention_time
                {
                    maximum.value = "0.30".to_owned();
                }
            },
            DocumentProblem::Malformed,
        ),
        (
            "a value that is not a finite number",
            |snapshot| {
                if let record::RetentionTimeSummary::Reported {
                    at_50_percent_base_peak_intensity,
                    ..
                } = &mut snapshot.retention_time
                {
                    at_50_percent_base_peak_intensity.value = "NaN".to_owned();
                }
            },
            DocumentProblem::Malformed,
        ),
        (
            "a digest that is not one",
            |snapshot| snapshot.producer.executable_sha256 = "not-a-digest".to_owned(),
            DocumentProblem::Malformed,
        ),
        (
            "a build label with a control character",
            |snapshot| snapshot.producer.release = Some("3.0\n26204".to_owned()),
            DocumentProblem::Malformed,
        ),
    ];
    for (what, broken, problem) in cases {
        let (mut document, _, _) = qc_document();
        broken(snapshot_in(&mut document));
        assert_eq!(refused(&document), problem, "{what}");
    }
}

#[test]
fn a_retention_time_has_one_spelling_and_it_reads_back_to_the_same_bits() {
    use record::{RecordedRetentionTime, RecordedUnit};

    // Values whose shortest spelling is long, tiny, huge, signed zero, or not
    // the decimal a reader would guess.
    for value in [
        0.1 + 0.2,
        1.0 / 3.0,
        123.456,
        5e-324,
        2.225_073_858_507_201_4e-308,
        f64::MAX,
        1e21,
        -0.0,
        0.0,
    ] {
        let recorded = RecordedRetentionTime::of(value, RecordedUnit::NotEmitted).expect("finite");
        assert_eq!(
            recorded.number().map(f64::to_bits),
            Some(value.to_bits()),
            "{value:e}"
        );
        let text = serde_json::to_string(&recorded).expect("json");
        let back: RecordedRetentionTime = serde_json::from_str(&text).expect("read back");
        assert_eq!(back, recorded, "{value:e}");
    }
    assert_eq!(
        RecordedRetentionTime::of(f64::NAN, RecordedUnit::NotEmitted),
        None
    );
    assert_eq!(
        RecordedRetentionTime::of(f64::INFINITY, RecordedUnit::NotEmitted),
        None
    );

    // Every one of these is the same binary64 as 0.3, and none is the text
    // this build writes for it, so none is a value it recorded.
    for spelling in [
        "0.30",
        "3e-1",
        "+0.3",
        ".3",
        "0.299999999999999988897769753748434595763683319091796875",
    ] {
        assert_eq!(
            spelling.parse::<f64>().map(f64::to_bits),
            Ok(0.3_f64.to_bits())
        );
        let recorded = RecordedRetentionTime {
            value: spelling.to_owned(),
            unit: RecordedUnit::NotEmitted,
        };
        assert_eq!(recorded.number(), None, "{spelling}");
    }
}

#[test]
fn a_field_the_snapshot_does_not_hold_is_refused_at_every_level() {
    type Edit = fn(&mut serde_json::Value);
    let edits: [(&str, Edit); 15] = [
        ("inside a reported count", |value| {
            value["artifacts"][0]["payload"]["chromatogramCount"] =
                serde_json::json!({ "kind": "reported", "count": 3, "unit": "each" });
        }),
        ("inside a level bucket", |value| {
            value["artifacts"][0]["payload"]["msLevelCounts"][0]["note"] =
                serde_json::json!("guessed");
        }),
        ("inside absent retention times", |value| {
            value["artifacts"][0]["payload"]["retentionTime"] =
                serde_json::json!({ "kind": "notReported", "minimum": "0.1" });
        }),
        ("inside a reference run input", |value| {
            value["runs"][0]["inputs"][0]["path"] = serde_json::json!("C:/data/sample.txt");
        }),
        ("beside the payload kind", |value| {
            value["artifacts"][0]["payload"]["datasetId"] = serde_json::json!("dataset-1");
        }),
        ("inside a bucket", |value| {
            value["artifacts"][0]["payload"]["msLevelCounts"][1]["msLevel"] = serde_json::json!(3);
        }),
        ("inside an absent count", |value| {
            value["artifacts"][0]["payload"]["chromatogramCount"]["count"] = serde_json::json!(0);
        }),
        ("inside the retention times", |value| {
            value["artifacts"][0]["payload"]["retentionTime"]["unit"] = serde_json::json!("min");
        }),
        ("inside one retention time", |value| {
            value["artifacts"][0]["payload"]["retentionTime"]["minimum"]["seconds"] =
                serde_json::json!(6);
        }),
        ("inside the producer", |value| {
            value["artifacts"][0]["payload"]["producer"]["path"] =
                serde_json::json!("C:/pwiz/msaccess.exe");
        }),
        ("inside a run input", |value| {
            value["runs"][1]["inputs"][0]["datasetId"] = serde_json::json!("dataset-1");
        }),
        ("an unknown payload kind", |value| {
            value["artifacts"][0]["payload"]["kind"] = serde_json::json!("qcGradeV1");
        }),
        ("an unknown count kind", |value| {
            value["artifacts"][0]["payload"]["chromatogramCount"] =
                serde_json::json!({ "kind": "zero" });
        }),
        ("an omitted count", |value| {
            value["artifacts"][0]["payload"]
                .as_object_mut()
                .expect("object")
                .remove("chromatogramCount");
        }),
        ("an omitted build label", |value| {
            value["artifacts"][0]["payload"]["producer"]
                .as_object_mut()
                .expect("object")
                .remove("buildDate");
        }),
    ];
    for (what, edit) in edits {
        assert_eq!(
            parsed_after(edit).expect_err("a refusal"),
            DocumentProblem::Malformed,
            "{what}"
        );
    }
    // Control: the untouched document, and an explicit `null` label, parse.
    parsed_after(|_| {}).expect("the untouched document parses");
    parsed_after(|value| {
        value["artifacts"][0]["payload"]["producer"]["release"] = serde_json::Value::Null;
    })
    .expect("an unreported label is an explicit null");
}

#[test]
fn a_schema_two_document_is_refused_as_unsupported_and_not_migrated() {
    // The shape M8.4 wrote, literally: a run naming `inputIds`.
    let input = InputId::new();
    let text = serde_json::json!({
        "schemaVersion": 2,
        "projectId": ProjectDocument::new("x".to_owned()).project_id,
        "revision": 1,
        "name": "Written by M8.4",
        "inputs": [{
            "id": input,
            "label": "sample.txt",
            "locator": { "kind": "projectRelative", "path": "sample.txt" },
            "members": [{
                "role": "primary",
                "relativeName": "",
                "baseline": { "byteLength": 5, "sha256": "A".repeat(64) },
            }],
        }],
        "artifacts": [],
        "runs": [{
            "id": RunId::new(),
            "operation": "captureFileFactsV1",
            "inputIds": [input],
            "outputArtifactIds": [],
            "outcome": "failed",
            "applicationVersion": "0.1.0",
            "startedAt": "2026-09-22T00:00:00Z",
            "finishedAt": "2026-09-22T00:00:01Z",
        }],
        "layers": [],
    });
    assert_eq!(
        record::parse(&serde_json::to_vec(&text).expect("bytes")),
        Err(DocumentProblem::UnsupportedVersion)
    );
}

/// Fills the open document, directly, to within `slack` bytes -- and at most one
/// padding observation more -- of the size a Save publishes.
///
/// With a record whose observations are only padding: a capture measures bytes
/// rather than validating what it did not write. Answers how to take the
/// padding back out.
fn fill_to_just_short(store: &ProjectStore, slack: u64) -> impl Fn(&ProjectStore) {
    let size = |store: &ProjectStore| {
        record::serialize(&document_of(store))
            .expect("serializable")
            .len() as u64
    };
    let observation = |input_id| super::record::ObservedInput {
        input_id,
        members: vec![super::record::ObservedMember {
            role: MemberRole::Primary,
            relative_name: "p".repeat(200),
            byte_length: 1,
            sha256: "A".repeat(64),
        }],
    };
    let pad = |store: &ProjectStore, count: usize| {
        let mut session = store
            .session
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let document = &mut session.project.as_mut().expect("open").document;
        let input_id = document.inputs[0].id;
        document.artifacts.push(super::record::ArtifactRecord {
            id: mscanvas_core::ArtifactId::new(),
            label: "padding".to_owned(),
            payload: super::record::ArtifactPayload::FileFactsV1(super::record::FileFactsV1 {
                observations: (0..count).map(|_| observation(input_id)).collect(),
            }),
        });
    };
    // One first, so every measured record is added to an array that already
    // has one: the first element of an empty array costs differently.
    pad(store, 1);
    let unpadded = size(store);
    pad(store, 1);
    let one = size(store);
    pad(store, 2);
    let two = size(store);
    // What one more observation costs, and what a padding record costs besides.
    let each = (two - one) - (one - unpadded);
    let overhead = (one - unpadded) - each;
    let wanted = (record::MAX_DOCUMENT_BYTES - two - overhead - slack) / each;
    pad(store, usize::try_from(wanted).expect("a count"));
    let filled = size(store);
    assert!(filled + slack <= record::MAX_DOCUMENT_BYTES, "{filled}");
    assert!(
        record::MAX_DOCUMENT_BYTES - filled < slack + each,
        "{filled}"
    );
    |store: &ProjectStore| {
        let mut session = store
            .session
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let document = &mut session.project.as_mut().expect("open").document;
        document
            .artifacts
            .retain(|artifact| !artifact.label.starts_with("padding"));
    }
}

#[test]
fn a_capture_that_would_make_the_document_unsaveable_is_refused_whole() {
    // A snapshot cannot be removed once recorded, so one that took the
    // document past what a Save publishes would leave it unsaveable forever.
    let scratch = Scratch::new("qc-store-size");
    let (store, _, layer) = qc_ready(&scratch);
    let unpad = fill_to_just_short(&store, 256);
    let before = document_of(&store);

    assert_eq!(
        store.capture_qc_snapshot(layer, |_| Ok(qc_snapshot())),
        Err(ProjectError::Oversized)
    );
    assert_eq!(
        document_of(&store),
        before,
        "neither the run nor the snapshot stayed"
    );

    // Control: with room for it, the same capture commits.
    unpad(&store);
    store
        .capture_qc_snapshot(layer, |_| Ok(qc_snapshot()))
        .expect("captured once there is room");
}

#[test]
fn a_file_facts_capture_that_would_make_the_document_unsaveable_records_nothing() {
    // The same rule on the other writer of history: once a QC run pins a
    // reference, its file-facts history cannot be removed either, so a
    // file-facts capture must not be what makes the document unsaveable.
    let scratch = Scratch::new("facts-store-size");
    let (store, id) = store_with_reference(&scratch, "sample.txt", b"bytes");
    let unpad = fill_to_just_short(&store, 64);
    let before = document_of(&store);

    assert_eq!(capture(&store, &[id]), Err(ProjectError::Oversized));
    assert_eq!(
        document_of(&store),
        before,
        "neither the run nor the record stayed"
    );

    // Control: with room for it, the same capture commits both.
    unpad(&store);
    let runs = document_of(&store).runs.len();
    capture(&store, &[id]).expect("captured once there is room");
    let after = document_of(&store);
    assert_eq!(after.runs.len(), runs + 1);
    assert!(
        after
            .artifacts
            .iter()
            .any(|artifact| !artifact.label.starts_with("padding"))
    );
}

#[test]
fn the_size_measure_keeps_room_for_the_widest_revision() {
    // A Save writes the revision plus one, so a document that fits exactly now
    // fails the first Save that gives its revision another digit. The measure
    // keeps room for the widest revision there is; set here to the byte.
    let scratch = Scratch::new("store-revision-room");
    let (store, _) = store_with_reference(&scratch, "sample.txt", b"bytes");
    let _unpad = fill_to_just_short(&store, 1024);
    let leave = |room: u64| {
        let mut session = store
            .session
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let document = &mut session.project.as_mut().expect("open").document;
        let last = document.artifacts.len() - 1;
        document.artifacts[last].label = "padding".to_owned();
        let now = record::serialize(document).expect("serializable").len() as u64;
        let widen = usize::try_from(record::MAX_DOCUMENT_BYTES - now - room).expect("a width");
        document.artifacts[last].label = format!("padding{}", "x".repeat(widen));
        let after = record::serialize(document).expect("serializable").len() as u64;
        assert_eq!(record::MAX_DOCUMENT_BYTES - after, room);
    };

    leave(0);
    assert!(
        !super::fits_every_later_save(&document_of(&store)),
        "exactly full"
    );
    leave(18);
    assert!(
        !super::fits_every_later_save(&document_of(&store)),
        "one digit short"
    );
    leave(19);
    assert!(
        super::fits_every_later_save(&document_of(&store)),
        "room for any revision"
    );
}
