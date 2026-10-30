//! ADR 0060 slice 2: one Thermo RAW row to an opened view through the view
//! cache, with the deterministic fake provider and an injected cache root.
//! Nothing here runs ProteoWizard or touches the real application data.

use std::os::windows::fs::OpenOptionsExt as _;
use std::time::Instant;

use super::*;
use crate::preview::dto::PreviewDto;
use crate::preview::raw_view::{
    MAX_RAW_BYTES, RawViewBeginRequestDto, RawViewOperationRequestDto, RawViewPhaseDto,
    RawViewStateDto, ViewCacheSummaryDto,
};

/// A provider that records which file every preview read names, so a test can
/// say the RAW itself was never read by one.
struct Recording<R = FakeConversionRunner> {
    inner: ConvertingProvider<R>,
    sources: Arc<Mutex<Vec<PathBuf>>>,
    /// When armed, the next preview read announces itself and waits.
    park: Park,
}

type Park = Arc<Mutex<Option<(std::sync::mpsc::Sender<()>, std::sync::mpsc::Receiver<()>)>>>;

impl<R: ProcessRunner + Send + Sync> PreviewProvider for Recording<R> {
    fn availability(&self) -> (BackendAvailabilityDto, Option<InstallationIdentity>) {
        self.inner.availability()
    }

    fn run(
        &self,
        source: &Path,
        operation: &PreviewOperation,
    ) -> Result<OperationAttempt, PreviewErrorDto> {
        self.sources
            .lock()
            .expect("the recorded sources")
            .push(source.to_path_buf());
        let parked = self.park.lock().expect("the park").take();
        if let Some((started, release)) = parked {
            started.send(()).expect("announce the parked read");
            release
                .recv_timeout(Duration::from_secs(10))
                .expect("the parked read is released");
        }
        self.inner.run(source, operation)
    }

    fn use_installation(&self, home: Option<PathBuf>) {
        self.inner.use_installation(home);
    }

    fn read_conversion_configuration(&self) -> ConfigurationReading {
        self.inner.read_conversion_configuration()
    }

    fn conversion_backend(&self) -> ConversionBackendAttempt<'_> {
        self.inner.conversion_backend()
    }
}

/// One session viewing one RAW row, with its cache under a folder of its own.
struct Viewing {
    service: Arc<PreviewService>,
    raws: TestFile,
    app_data: TestFile,
    raw: PathBuf,
    handle: String,
    launches: Arc<AtomicUsize>,
    arguments: Arc<Mutex<Vec<Vec<String>>>>,
    sources: Arc<Mutex<Vec<PathBuf>>>,
    park: Park,
}

const RAW_NAME: &str = "QC pool 01.raw";

fn viewing_with<R: ProcessRunner + HasLaunchCount + Send + Sync + 'static>(
    label: &str,
    runner: R,
    arguments: Arc<Mutex<Vec<Vec<String>>>>,
    responses: Vec<Response>,
) -> Viewing {
    let raws = TestFile::new(label);
    let app_data = TestFile::new(&format!("{label}-appdata"));
    let raw = raws.thermo_raw(RAW_NAME);
    let launches = runner.launch_count();
    let mut inner = ConvertingProvider::new(evidenced_capabilities(), runner);
    inner.inner = FakeProvider::available(responses);
    let sources = Arc::new(Mutex::new(Vec::new()));
    let park = Park::default();
    let service = Arc::new(PreviewService::new(Box::new(Recording {
        inner,
        sources: Arc::clone(&sources),
        park: Arc::clone(&park),
    })));
    service.bind_view_cache(Some(app_data.directory.clone()));
    service.set_view_cache_free_space(|_| Some(1 << 40));
    let handle = add_one_acquisition(&service, &raw);
    Viewing {
        service,
        raws,
        app_data,
        raw,
        handle,
        launches,
        arguments,
        sources,
        park,
    }
}

fn viewing(label: &str) -> Viewing {
    let runner = FakeConversionRunner::new(BackendAct::Convert);
    let arguments = runner.arguments();
    viewing_with(label, runner, arguments, open_responses())
}

impl Viewing {
    fn cache(&self) -> PathBuf {
        self.app_data.directory.join("view-cache")
    }

    fn entries(&self) -> Vec<String> {
        entry_names(&self.cache().join("entries"))
    }

    fn staging(&self) -> Vec<String> {
        entry_names(&self.cache().join("staging"))
    }

    fn the_entry(&self) -> PathBuf {
        let entries = self.entries();
        assert_eq!(entries.len(), 1, "one published entry; got {entries:?}");
        self.cache().join("entries").join(&entries[0])
    }

    fn begin(&self) -> Result<u64, PreviewErrorDto> {
        let begun = self.service.begin_raw_view(&RawViewBeginRequestDto {
            handle: self.handle.clone(),
        })?;
        match begun {
            RawViewStateDto::Running { operation, .. } => Ok(operation),
            other => panic!("a begun view is running; got {other:?}"),
        }
    }

    /// Begins and runs one view to its end on this thread.
    fn view(&self) -> RawViewStateDto {
        let operation = self.begin().expect("View begins");
        self.service.run_raw_view(operation);
        self.service.raw_view_state()
    }

    fn open(&self, operation: u64) -> Result<PreviewDto, PreviewErrorDto> {
        self.service
            .open_raw_view(RawViewOperationRequestDto { operation })
    }

    /// Cancels the view the first time `phase` begins `occurrence` times.
    fn cancel_at(&self, phase: RawViewPhaseDto, occurrence: usize) {
        let service = Arc::downgrade(&self.service);
        let seen = AtomicUsize::new(0);
        self.service
            .set_raw_view_phase_hook(move |operation, entered| {
                if entered == phase
                    && seen.fetch_add(1, Ordering::SeqCst) + 1 == occurrence
                    && let Some(service) = service.upgrade()
                {
                    service.cancel_raw_view(RawViewOperationRequestDto { operation });
                }
            });
    }

    /// What the RAW's folder holds and what the RAW is: unchanged by a view.
    fn raw_facts(&self) -> (Vec<String>, Sha256Digest, std::time::SystemTime, u64) {
        let metadata = fs::metadata(&self.raw).expect("the RAW");
        (
            entry_names(&self.raws.directory),
            Sha256Digest::calculate_file(&self.raw).expect("hash the RAW"),
            metadata.modified().expect("the RAW's time"),
            metadata.len(),
        )
    }
}

fn ready(state: &RawViewStateDto) -> (u64, bool) {
    match state {
        RawViewStateDto::Ready {
            operation,
            cache_hit,
            ..
        } => (*operation, *cache_hit),
        other => panic!("expected ready; got {other:?}"),
    }
}

fn openable(state: &RawViewStateDto) -> bool {
    match state {
        RawViewStateDto::Ready { openable, .. } => *openable,
        other => panic!("expected ready; got {other:?}"),
    }
}

fn failed(state: &RawViewStateDto) -> (&str, bool) {
    match state {
        RawViewStateDto::Failed {
            code, retryable, ..
        } => (code.as_str(), *retryable),
        other => panic!("expected failed; got {other:?}"),
    }
}

fn cancelled_stored(state: &RawViewStateDto) -> bool {
    match state {
        RawViewStateDto::Cancelled { stored, .. } => *stored,
        other => panic!("expected cancelled; got {other:?}"),
    }
}

fn summary(service: &PreviewService) -> (usize, usize) {
    match service.describe_view_cache() {
        ViewCacheSummaryDto::Available {
            entries, in_use, ..
        } => (entries, in_use),
        ViewCacheSummaryDto::Unavailable { reason, .. } => panic!("no cache: {reason}"),
    }
}

/// Opens a directory with no sharing at all, so any other open of it fails.
fn hold_exclusively(path: &Path) -> fs::File {
    const BACKUP_SEMANTICS: u32 = 0x0200_0000;
    fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .custom_flags(BACKUP_SEMANTICS)
        .open(path)
        .expect("hold the path exclusively")
}

fn corrupt_output(entry: &Path) {
    let output = entry.join("view.mzML");
    let mut bytes = fs::read(&output).expect("read the cached copy");
    let last = bytes.len() - 2;
    bytes[last] ^= 0x01;
    fs::write(&output, bytes).expect("damage the cached copy");
}

#[test]
fn a_miss_converts_the_verified_default_publishes_once_and_opens_the_entry_not_the_raw() {
    // The spectrum load finds no response left and answers the fake's own
    // `test_exhausted`; what matters is which file it named.
    let session = viewing("raw-view-miss");
    let before = session.raw_facts();

    let state = session.view();
    let (operation, cache_hit) = ready(&state);
    assert!(!cache_hit);
    assert!(openable(&state));
    assert_eq!(session.launches.load(Ordering::SeqCst), 1);
    let entry = session.the_entry();
    assert_eq!(entry_names(&entry), vec!["entry.json", "view.mzML"]);
    assert_eq!(
        session.staging(),
        Vec::<String>::new(),
        "the attempt is removed"
    );
    // Decision 7: the key's source digest is Checking file's chunked one, and
    // it equals a one-shot hash of the RAW.
    let manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(entry.join("entry.json")).expect("the manifest"))
            .expect("the manifest parses");
    let digest = Sha256Digest::calculate_file(&session.raw).expect("hash the RAW");
    assert_eq!(
        manifest["sourceSha256"].as_str(),
        Some(digest.to_string().to_lowercase().as_str())
    );
    assert_eq!(
        summary(&session.service),
        (1, 1),
        "the ready operation pins it"
    );

    // The verified default and nothing else: the source, `--mzML --zlib`, the
    // staging output; no filter and no peak picking.
    let argv = session.arguments.lock().expect("argv")[0].clone();
    assert_eq!(argv.len(), 7, "{argv:?}");
    assert!(argv[0].ends_with(RAW_NAME), "{argv:?}");
    assert_eq!(&argv[1..4], ["--mzML", "--zlib", "--outdir"]);
    assert_eq!(argv[5], "--outfile");
    assert!(
        argv.iter()
            .all(|argument| !argument.contains("--filter") && !argument.contains("peakPicking")),
        "{argv:?}"
    );
    let staging = fs::canonicalize(session.cache().join("staging")).expect("staging");
    assert!(
        Path::new(&argv[4]).starts_with(&staging),
        "msconvert writes only under the attempt: {argv:?}"
    );

    // The open reads the pinned entry, and so does a spectrum load; never the
    // RAW. A cached view retains no summary a QC capture could copy.
    let preview = session.open(operation).expect("the ready view opens");
    assert_eq!(preview.file.file_name, RAW_NAME);
    assert_eq!(preview.qc_snapshot_token, None);
    assert!(!preview.qc_producer_identified);
    let _ = session.service.load_spectrum(&session.handle, 0);
    let sources = session.sources.lock().expect("sources").clone();
    assert_eq!(
        sources.len(),
        4,
        "three open reads and one spectrum: {sources:?}"
    );
    let output = entry.join("view.mzML");
    assert!(
        sources.iter().all(|source| source == &output),
        "{sources:?}"
    );

    let again = session
        .open(operation)
        .expect_err("a ready view opens once");
    assert_eq!(again.kind, "raw_view_not_ready");
    assert!(
        !openable(&session.service.raw_view_state()),
        "an opened view no longer offers Open"
    );
    assert_eq!(
        session.raw_facts(),
        before,
        "the RAW and its folder are untouched"
    );
}

#[test]
fn a_hit_launches_nothing_and_a_second_session_finds_the_same_entry() {
    let session = viewing("raw-view-hit");
    let (first, _) = ready(&session.view());
    let entry = session.the_entry();
    let manifest = fs::read(entry.join("entry.json")).expect("the manifest");

    // The next View ends a ready operation's pin as it begins, and that
    // operation can no longer be opened (decision 8).
    let second = session.begin().expect("View again");
    assert_eq!(summary(&session.service), (1, 0));
    session.service.run_raw_view(second);
    let (_, cache_hit) = ready(&session.service.raw_view_state());
    assert_ne!(first, second);
    assert!(cache_hit);
    assert_eq!(
        session.open(first).expect_err("superseded").kind,
        "raw_view_not_ready"
    );
    assert_eq!(
        session.launches.load(Ordering::SeqCst),
        1,
        "a hit converts nothing"
    );
    assert_eq!(
        fs::read(entry.join("entry.json")).expect("the manifest"),
        manifest,
        "an entry is written once"
    );

    // Another process sharing the cache sees the same entry.
    // (The fixture writes the same bytes, so the same source digest.)
    let other = viewing("raw-view-hit-other");
    other
        .service
        .bind_view_cache(Some(session.app_data.directory.clone()));
    let (_, cache_hit) = ready(&other.view());
    assert!(cache_hit);
    assert_eq!(other.launches.load(Ordering::SeqCst), 0);
}

#[test]
fn cancel_before_storing_publishes_nothing_and_leaves_no_attempt() {
    for (phase, occurrence) in [
        (RawViewPhaseDto::CheckingSource, 1),
        (RawViewPhaseDto::CheckingCachedCopy, 1),
        (RawViewPhaseDto::Converting, 1),
        (RawViewPhaseDto::CheckingOutput, 1),
    ] {
        let session = viewing(&format!("raw-view-cancel-{phase:?}"));
        let before = session.raw_facts();
        session.cancel_at(phase, occurrence);

        let state = session.view();
        assert!(!cancelled_stored(&state), "{phase:?}");
        assert_eq!(session.entries(), Vec::<String>::new(), "{phase:?}");
        assert_eq!(session.staging(), Vec::<String>::new(), "{phase:?}");
        assert_eq!(session.raw_facts(), before, "{phase:?}");
        let expected = usize::from(phase == RawViewPhaseDto::CheckingOutput);
        assert_eq!(
            session.launches.load(Ordering::SeqCst),
            expected,
            "{phase:?}"
        );
        // A cancelled operation is never opened, and the slot is free again.
        let refused = session
            .open(operation_of(&state))
            .expect_err("a cancelled view does not open");
        assert_eq!(refused.kind, "raw_view_not_ready");
        assert!(session.begin().is_ok(), "{phase:?}: the slot was released");
    }
}

#[test]
fn cancel_during_storing_or_the_new_entry_check_keeps_the_stored_copy() {
    for (phase, occurrence) in [
        (RawViewPhaseDto::Storing, 1),
        (RawViewPhaseDto::CheckingCachedCopy, 2),
    ] {
        let session = viewing(&format!("raw-view-stored-{phase:?}-{occurrence}"));
        session.cancel_at(phase, occurrence);

        assert!(cancelled_stored(&session.view()), "{phase:?}");
        assert_eq!(session.entries().len(), 1, "{phase:?}");
        assert_eq!(session.staging(), Vec::<String>::new());
        assert_eq!(summary(&session.service), (1, 0), "nothing pins it");

        // The next View verifies it as a hit.
        session.service.set_raw_view_phase_hook(|_, _| {});
        assert!(ready(&session.view()).1, "{phase:?}");
        assert_eq!(session.launches.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn a_cancel_while_msconvert_runs_ends_cancelled_and_every_slot_route_answers_raw_view_busy() {
    let (runner, started, release) = FakeConversionRunner::new(BackendAct::Convert).blocking();
    let arguments = runner.arguments();
    let mut responses = open_responses();
    responses.extend(open_responses());
    let session = viewing_with("raw-view-running", runner, arguments, responses);
    let mzml = session.raws.readable_mzml("other.mzML");
    let mzml_handle = match session
        .service
        .add_files_now(std::slice::from_ref(&mzml))
        .outcomes
        .first()
    {
        Some(WorkspaceAddOutcomeDto::Added { dataset }) => dataset.handle.clone(),
        other => panic!("an mzML row; got {other:?}"),
    };
    let service = &session.service;
    // Read before the run: the configuration read does not wait for the gate.
    let receipt = current_receipt(service);
    let document = current_document(service);
    let operation = session.begin().expect("View begins");
    let worker = Arc::clone(&session.service);
    let thread = std::thread::spawn(move || worker.run_raw_view(operation));
    started
        .recv_timeout(Duration::from_secs(10))
        .expect("msconvert starts");

    let busy = |error: PreviewErrorDto| assert_eq!(error.kind, "raw_view_busy");
    busy(session.begin().expect_err("one view at a time"));
    busy(
        service
            .add_files(std::slice::from_ref(&mzml))
            .expect_err("adding waits"),
    );
    busy(
        service
            .remove_datasets(std::slice::from_ref(&session.handle))
            .expect_err("the RAW row being prepared stays"),
    );
    busy(
        service
            .open_preview(&mzml_handle)
            .expect_err("no other open"),
    );
    busy(
        service
            .load_spectrum(&mzml_handle, 0)
            .expect_err("no spectrum"),
    );
    busy(service.clear_view_cache().expect_err("no Clear"));
    busy(service.clear_workspace().expect_err("no clear"));
    busy(service.begin_folder_import().expect_err("no folder"));
    // The drop callback reads the lock-free mirror; its transfer object is the
    // queue's (ADR 0060 slice 2 notes, deferred).
    let paths = vec![mzml.clone()];
    assert!(matches!(
        service.reserve_native_drop_signal(NativeDropSignal::Drop { paths: &paths }),
        Some(NativeDropDispatch::ConversionBusy)
    ));
    let refused = service.begin_conversion_queue(
        &begin_request(
            std::slice::from_ref(&mzml_handle),
            ConversionIntent::SHIPPED,
            ConversionConflictPolicyDto::Fail,
            receipt,
        ),
        document,
    );
    assert_eq!(begin_refusal(&refused).kind, "raw_view_busy");
    assert!(matches!(
        service.raw_view_state(),
        RawViewStateDto::Running {
            phase: RawViewPhaseDto::Converting,
            ..
        }
    ));

    service.cancel_raw_view(RawViewOperationRequestDto { operation });
    release.send(()).expect("release msconvert");
    thread.join().expect("the worker ends");
    assert!(!cancelled_stored(&service.raw_view_state()));
    assert_eq!(session.entries(), Vec::<String>::new());
    assert_eq!(session.staging(), Vec::<String>::new());
    // A late Cancel answers the state and changes nothing.
    assert!(!cancelled_stored(
        &service.cancel_raw_view(RawViewOperationRequestDto { operation })
    ));
    assert!(
        service.open_preview(&mzml_handle).is_ok(),
        "the slot is free"
    );
}

#[test]
fn a_queue_awaiting_a_destination_refuses_view_with_conversion_busy() {
    let session = viewing("raw-view-queue");
    let service = &session.service;
    let answered = service.begin_conversion_queue(
        &begin_request(
            std::slice::from_ref(&session.handle),
            ConversionIntent::SHIPPED,
            ConversionConflictPolicyDto::Fail,
            current_receipt(service),
        ),
        current_document(service),
    );
    assert!(
        matches!(answered.outcome, ConversionBeginOutcomeDto::Reserved { .. }),
        "{answered:?}"
    );
    let refused = session.begin().expect_err("a queue holds the slot");
    assert_eq!(refused.kind, "conversion_busy");
    assert_eq!(session.launches.load(Ordering::SeqCst), 0);
    assert!(matches!(service.raw_view_state(), RawViewStateDto::Idle));
}

#[test]
fn a_raw_over_one_and_a_half_gib_is_refused_before_any_work() {
    let session = viewing("raw-view-large");
    let large = session.raws.thermo_raw("large.raw");
    fs::OpenOptions::new()
        .write(true)
        .open(&large)
        .and_then(|file| file.set_len(MAX_RAW_BYTES + 1))
        .expect("a RAW one byte over the limit");
    let handle = add_one_acquisition(&session.service, &large);
    let refused = session
        .service
        .begin_raw_view(&RawViewBeginRequestDto {
            handle: handle.clone(),
        })
        .expect_err("refused before any work");
    assert_eq!(refused.kind, "view_cache_entry_too_large");
    assert!(!refused.retryable);
    assert!(matches!(
        session.service.raw_view_state(),
        RawViewStateDto::Idle
    ));
    assert_eq!(session.launches.load(Ordering::SeqCst), 0);
    // At the limit itself it is admitted.
    session
        .service
        .remove_datasets(&[handle])
        .expect("the row goes");
    fs::OpenOptions::new()
        .write(true)
        .open(&large)
        .and_then(|file| file.set_len(MAX_RAW_BYTES))
        .expect("a RAW at the limit");
    let handle = add_one_acquisition(&session.service, &large);
    assert!(
        session
            .service
            .begin_raw_view(&RawViewBeginRequestDto { handle })
            .is_ok()
    );
    session.service.abandon_raw_view(1);
}

#[test]
fn short_space_fails_after_checking_file_without_evicting_and_states_both_numbers() {
    let session = viewing("raw-view-space");
    session.service.set_view_cache_free_space(|_| Some(1_024));
    let state = session.view();
    assert_eq!(failed(&state), ("view_cache_no_space", true));
    let RawViewStateDto::Failed {
        needed_bytes,
        free_bytes,
        ..
    } = state
    else {
        unreachable!()
    };
    assert_eq!(free_bytes, Some(1_024));
    let raw_bytes = fs::metadata(&session.raw).expect("the RAW").len();
    assert_eq!(needed_bytes, Some(3 * raw_bytes + (2 << 30)));
    assert_eq!(session.launches.load(Ordering::SeqCst), 0);
    assert_eq!(session.staging(), Vec::<String>::new());

    // Free space that cannot be read is not too little of it.
    session.service.set_view_cache_free_space(|_| None);
    assert_eq!(failed(&session.view()), ("view_cache_unreadable", true));
    assert_eq!(session.launches.load(Ordering::SeqCst), 0);
}

#[test]
fn a_failed_conversion_reports_its_own_code_and_publishes_nothing() {
    let runner = FakeConversionRunner::new(BackendAct::Fail);
    let arguments = runner.arguments();
    let session = viewing_with("raw-view-failed", runner, arguments, open_responses());
    let state = session.view();
    let (code, retryable) = failed(&state);
    assert_eq!(code, "backend_rejected");
    assert!(!retryable);
    assert_eq!(session.entries(), Vec::<String>::new());
    assert_eq!(session.staging(), Vec::<String>::new());
    let RawViewStateDto::Failed { message, .. } = state else {
        unreachable!()
    };
    assert!(!message.contains("GiB"), "{message}");
}

#[test]
fn a_disk_that_fills_during_the_run_fails_as_the_conversion_and_states_the_free_space() {
    // Room before the run; less than the reserve once it has failed. The
    // reason never claims a full disk, because msconvert does not say why.
    let runner = FakeConversionRunner::new(BackendAct::Fail);
    let arguments = runner.arguments();
    let session = viewing_with("raw-view-disk-full", runner, arguments, open_responses());
    let probes = AtomicUsize::new(0);
    session.service.set_view_cache_free_space(move |_| {
        Some(if probes.fetch_add(1, Ordering::SeqCst) == 0 {
            1 << 40
        } else {
            1 << 30
        })
    });
    let state = session.view();
    assert_eq!(failed(&state), ("backend_rejected", false));
    let RawViewStateDto::Failed { message, .. } = state else {
        unreachable!()
    };
    assert!(
        message.ends_with(" 1.0 GiB are free on the drive that holds MSCanvas's application data."),
        "{message}"
    );
    assert!(!message.to_lowercase().contains("full"), "{message}");
    assert_eq!(session.entries(), Vec::<String>::new());
    assert_eq!(session.staging(), Vec::<String>::new());
}

fn rewrite_in_place(raw: &Path) {
    let mut bytes = fs::read(raw).expect("the RAW");
    let last = bytes.len() - 1;
    bytes[last] ^= 0xFF;
    fs::write(raw, bytes).expect("rewrite the RAW in place");
}

#[test]
fn a_raw_rewritten_before_or_after_the_run_fails_with_raw_view_source_changed() {
    // Before the run, its own pin finds it; after, Checking output does.
    for (phase, launches) in [
        (RawViewPhaseDto::Converting, 0),
        (RawViewPhaseDto::CheckingOutput, 1),
    ] {
        let session = viewing(&format!("raw-view-changed-{phase:?}"));
        let raw = session.raw.clone();
        session.service.set_raw_view_phase_hook(move |_, entered| {
            if entered == phase {
                rewrite_in_place(&raw);
            }
        });
        assert_eq!(
            failed(&session.view()),
            ("raw_view_source_changed", true),
            "{phase:?}"
        );
        assert_eq!(session.launches.load(Ordering::SeqCst), launches);
        assert_eq!(session.entries(), Vec::<String>::new());
        assert_eq!(session.staging(), Vec::<String>::new());
    }
}

#[test]
fn a_raw_that_grew_past_the_limit_after_it_was_added_is_refused_at_its_first_chunk() {
    let session = viewing("raw-view-grew");
    fs::OpenOptions::new()
        .write(true)
        .open(&session.raw)
        .and_then(|file| file.set_len(MAX_RAW_BYTES + 1))
        .expect("the RAW grows after it was added");
    assert_eq!(
        failed(&session.view()),
        ("view_cache_entry_too_large", false)
    );
    assert_eq!(session.launches.load(Ordering::SeqCst), 0);
    assert_eq!(session.staging(), Vec::<String>::new());
}

#[test]
fn a_damaged_entry_is_removed_and_converted_again_once() {
    let first = viewing("raw-view-damaged");
    ready(&first.view());
    let entry = first.the_entry();
    let app_data = first.app_data.directory.clone();
    drop(first.service);
    corrupt_output(&entry);

    let second = viewing("raw-view-damaged-again");
    second.service.bind_view_cache(Some(app_data));
    let (_, cache_hit) = ready(&second.view());
    assert!(!cache_hit);
    assert_eq!(second.launches.load(Ordering::SeqCst), 1);
    assert_eq!(entry_names(&entry), vec!["entry.json", "view.mzML"]);
}

#[test]
fn a_cached_copy_that_cannot_be_checked_or_removed_ends_retryable_before_any_conversion() {
    // Unreadable: the entry's directory is held by something else.
    let first = viewing("raw-view-unreadable");
    ready(&first.view());
    let entry = first.the_entry();
    let app_data = first.app_data.directory.clone();
    drop(first.service);
    let second = viewing("raw-view-unreadable-again");
    second.service.bind_view_cache(Some(app_data));
    {
        let _held = hold_exclusively(&entry);
        assert_eq!(
            failed(&second.view()),
            ("view_cache_entry_unavailable", true)
        );
    }
    assert_eq!(second.launches.load(Ordering::SeqCst), 0);
    assert_eq!(entry_names(&entry), vec!["entry.json", "view.mzML"]);

    // Damaged, and a part of it cannot be removed just now.
    corrupt_output(&entry);
    {
        let _held = fs::OpenOptions::new()
            .read(true)
            .share_mode(0x1)
            .open(entry.join("entry.json"))
            .expect("hold the manifest without delete sharing");
        assert_eq!(
            failed(&second.view()),
            ("view_cache_entry_unavailable", true)
        );
    }
    assert_eq!(second.launches.load(Ordering::SeqCst), 0, "never a miss");
}

#[test]
fn pins_end_with_the_next_open_or_the_row_and_removing_the_row_deletes_nothing() {
    let mut responses = open_responses();
    responses.extend(open_responses());
    let runner = FakeConversionRunner::new(BackendAct::Convert);
    let arguments = runner.arguments();
    let session = viewing_with("raw-view-pins", runner, arguments, responses);
    let (operation, _) = ready(&session.view());
    assert_eq!(summary(&session.service), (1, 1));
    let kept = session.service.clear_view_cache().expect("Clear runs");
    assert_eq!((kept.removed, kept.kept_in_use), (0, 1));

    // The open takes the pin over; opening another row ends it.
    session.open(operation).expect("open");
    assert_eq!(summary(&session.service), (1, 1));
    let mzml = session.raws.readable_mzml("other.mzML");
    let mzml_handle = match session
        .service
        .add_files_now(std::slice::from_ref(&mzml))
        .outcomes
        .first()
    {
        Some(WorkspaceAddOutcomeDto::Added { dataset }) => dataset.handle.clone(),
        other => panic!("an mzML row; got {other:?}"),
    };
    session
        .service
        .open_preview(&mzml_handle)
        .expect("open mzML");
    assert_eq!(summary(&session.service), (1, 0));

    // A ready view never opened is released by removing its row, which
    // deletes neither the RAW nor the entry.
    let (_, cache_hit) = ready(&session.view());
    assert!(cache_hit);
    assert_eq!(summary(&session.service), (1, 1));
    session
        .service
        .remove_datasets(std::slice::from_ref(&session.handle))
        .expect("the row goes");
    assert!(session.raw.is_file());
    assert_eq!(summary(&session.service), (1, 0));
    assert!(
        !openable(&session.service.raw_view_state()),
        "the row's pin went with it"
    );
    let cleared = session.service.clear_view_cache().expect("Clear runs");
    assert_eq!((cleared.removed, cleared.kept_in_use), (1, 0));
    assert_eq!(session.entries(), Vec::<String>::new());
    assert!(session.raw.is_file(), "Clear never touches a RAW");
}

#[test]
fn the_raw_is_never_opened_for_writing() {
    let session = viewing("raw-view-read-only");
    let original = fs::metadata(&session.raw).expect("the RAW").permissions();
    let mut read_only = original.clone();
    read_only.set_readonly(true);
    fs::set_permissions(&session.raw, read_only).expect("make the RAW read-only");
    let before = session.raw_facts();

    let (operation, _) = ready(&session.view());
    session.open(operation).expect("open");
    assert_eq!(session.raw_facts(), before);
    assert!(
        fs::metadata(&session.raw)
            .expect("the RAW")
            .permissions()
            .readonly()
    );

    fs::set_permissions(&session.raw, original).expect("let the fixture be removed");
}

#[test]
fn a_vendor_row_is_never_previewed_or_read_directly() {
    let session = viewing("raw-view-direct");
    assert_eq!(
        session
            .service
            .open_preview(&session.handle)
            .expect_err("no direct open")
            .kind,
        "dataset_not_previewable"
    );
    assert_eq!(
        session
            .service
            .load_spectrum(&session.handle, 0)
            .expect_err("no direct read")
            .kind,
        "dataset_not_previewable"
    );
    assert!(session.sources.lock().expect("sources").is_empty());
}

#[test]
fn an_mzml_row_is_not_viewed_through_the_cache_and_an_unbound_cache_refuses() {
    let session = viewing("raw-view-refusals");
    let mzml = session.raws.readable_mzml("other.mzML");
    let mzml_handle = match session
        .service
        .add_files_now(std::slice::from_ref(&mzml))
        .outcomes
        .first()
    {
        Some(WorkspaceAddOutcomeDto::Added { dataset }) => dataset.handle.clone(),
        other => panic!("an mzML row; got {other:?}"),
    };
    let refused = session
        .service
        .begin_raw_view(&RawViewBeginRequestDto {
            handle: mzml_handle,
        })
        .expect_err("only a Thermo RAW row");
    assert_eq!(refused.kind, "raw_view_unsupported_source");

    session.service.bind_view_cache(None);
    assert_eq!(
        session.begin().expect_err("no folder").kind,
        "view_cache_unavailable"
    );
    assert!(matches!(
        session.service.describe_view_cache(),
        ViewCacheSummaryDto::Unavailable {
            reason: "rootUnresolved",
            ..
        }
    ));

    // A folder MSCanvas did not make is left alone.
    let foreign = TestFile::new("raw-view-foreign");
    fs::create_dir(foreign.directory.join("view-cache")).expect("someone else's folder");
    session
        .service
        .bind_view_cache(Some(foreign.directory.clone()));
    assert_eq!(
        session.begin().expect_err("not ours").kind,
        "view_cache_root_unrecognized"
    );
    assert_eq!(
        entry_names(&foreign.directory.join("view-cache")),
        Vec::<String>::new()
    );
    assert_eq!(session.launches.load(Ordering::SeqCst), 0);
}

#[test]
fn the_begin_request_has_no_intent_field() {
    let refused = serde_json::from_str::<RawViewBeginRequestDto>(
        r#"{"handle":"dataset-1","intentId":"mzml+none+all+mz64-int32+zlib"}"#,
    );
    assert!(refused.is_err(), "View carries no intent");
    assert!(serde_json::from_str::<RawViewBeginRequestDto>(r#"{"handle":"dataset-1"}"#).is_ok());
}

#[test]
fn a_superseded_open_ends_the_view_and_leaves_its_entry_for_the_next_view() {
    let session = viewing("raw-view-superseded");
    let (operation, _) = ready(&session.view());

    // The open's first read parks while it holds the backend gate.
    let (started, observe) = std::sync::mpsc::channel();
    let (release, parked) = std::sync::mpsc::channel();
    *session.park.lock().expect("the park") = Some((started, parked));
    let opening = {
        let service = Arc::clone(&session.service);
        std::thread::spawn(move || service.open_raw_view(RawViewOperationRequestDto { operation }))
    };
    observe
        .recv_timeout(Duration::from_secs(10))
        .expect("the open reads");

    // A newer request for the same row supersedes it (ADR 0056 decision 4).
    let spectrum = {
        let service = Arc::clone(&session.service);
        let handle = session.handle.clone();
        std::thread::spawn(move || service.load_spectrum(&handle, 0))
    };
    let deadline = Instant::now() + Duration::from_secs(10);
    while session.service.requests_made(&session.handle) < 2 {
        assert!(
            Instant::now() < deadline,
            "the spectrum never claimed its turn"
        );
        std::thread::yield_now();
    }
    release.send(()).expect("release the open");

    let superseded = opening
        .join()
        .expect("the open ends")
        .expect_err("a newer request won");
    assert_eq!(superseded.kind, "selection_superseded");
    // With no view open, the RAW row is still never read directly.
    let refused = spectrum
        .join()
        .expect("the spectrum ends")
        .expect_err("no preview to read");
    assert_eq!(refused.kind, "dataset_not_previewable");
    assert_eq!(summary(&session.service), (1, 0), "the pin ended with it");
    assert!(!openable(&session.service.raw_view_state()));
    assert_eq!(
        session.open(operation).expect_err("opened once").kind,
        "raw_view_not_ready"
    );

    let (_, cache_hit) = ready(&session.view());
    assert!(cache_hit, "the entry stayed, so the next View is a hit");
    assert_eq!(session.launches.load(Ordering::SeqCst), 1);
}

#[test]
fn cancel_and_clear_ends_a_running_view_and_deletes_nothing() {
    use crate::preview::dto::{WorkspaceClearActionDto, WorkspaceClearOutcomeDto};

    let (runner, started, release) = FakeConversionRunner::new(BackendAct::Convert).blocking();
    let arguments = runner.arguments();
    let session = viewing_with("raw-view-clear", runner, arguments, open_responses());
    let before = session.raw_facts();
    let document = current_document(&session.service);
    let operation = session.begin().expect("View begins");
    let worker = Arc::clone(&session.service);
    let thread = std::thread::spawn(move || worker.run_raw_view(operation));
    started
        .recv_timeout(Duration::from_secs(10))
        .expect("msconvert starts");

    let plan = session
        .service
        .plan_workspace_clear(document)
        .expect("a plan");
    assert_eq!(
        (plan.total_count, plan.removable_count, plan.protected_count),
        (1, 0, 1),
        "the RAW row being prepared is active work"
    );
    let clearing = {
        let service = Arc::clone(&session.service);
        let id = plan.plan_id.clone();
        std::thread::spawn(move || {
            service.execute_workspace_clear(&id, WorkspaceClearActionDto::CancelAndClear, document)
        })
    };
    let deadline = Instant::now() + Duration::from_secs(10);
    while !session.service.raw_view_cancel_requested_for_test() {
        assert!(
            Instant::now() < deadline,
            "the clear never cancelled the view"
        );
        std::thread::yield_now();
    }
    release.send(()).expect("release msconvert");
    thread.join().expect("the worker ends");

    let outcome = clearing.join().expect("the clear ends");
    assert!(
        matches!(outcome, WorkspaceClearOutcomeDto::Removed { .. }),
        "{outcome:?}"
    );
    assert!(!cancelled_stored(&session.service.raw_view_state()));
    assert!(session.service.roster().datasets.is_empty());
    assert_eq!(session.entries(), Vec::<String>::new());
    assert_eq!(session.staging(), Vec::<String>::new());
    assert_eq!(session.raw_facts(), before, "the RAW is untouched");
}

#[test]
fn an_entry_removed_before_its_check_fails_lost_and_converts_nothing_more() {
    let session = viewing("raw-view-lost");
    let entries = session.cache().join("entries");
    let seen = AtomicUsize::new(0);
    session.service.set_raw_view_phase_hook(move |_, phase| {
        // The second check is of the entry just published; another process
        // evicts it first.
        if phase == RawViewPhaseDto::CheckingCachedCopy && seen.fetch_add(1, Ordering::SeqCst) == 1
        {
            for name in entry_names(&entries) {
                fs::remove_dir_all(entries.join(name)).expect("evicted elsewhere");
            }
        }
    });
    assert_eq!(failed(&session.view()), ("view_cache_entry_lost", true));
    assert_eq!(session.launches.load(Ordering::SeqCst), 1);
    assert_eq!(session.entries(), Vec::<String>::new());
    assert_eq!(session.staging(), Vec::<String>::new());
}

#[test]
fn something_else_in_the_entrys_place_fails_unrecognized_and_is_left_alone() {
    let first = viewing("raw-view-unrecognized");
    ready(&first.view());
    let entry = first.the_entry();
    let app_data = first.app_data.directory.clone();
    drop(first.service);
    fs::remove_dir_all(&entry).expect("the entry goes");
    fs::write(&entry, b"not MSCanvas's").expect("a file in the entry's place");

    let second = viewing("raw-view-unrecognized-again");
    second.service.bind_view_cache(Some(app_data));
    assert_eq!(
        failed(&second.view()),
        ("view_cache_entry_unrecognized", false)
    );
    assert_eq!(second.launches.load(Ordering::SeqCst), 0);
    assert_eq!(fs::read(&entry).expect("left as found"), b"not MSCanvas's");
}

#[test]
fn a_refused_publishing_rename_fails_not_stored_and_its_held_attempt_waits_for_a_later_sweep() {
    const SHARE_READ_WRITE: u32 = 0x1 | 0x2;
    const BACKUP_SEMANTICS: u32 = 0x0200_0000;

    let session = viewing("raw-view-not-stored");
    let staging = session.cache().join("staging");
    let held = Arc::new(Mutex::new(None));
    let holder = Arc::clone(&held);
    session.service.set_raw_view_phase_hook(move |_, phase| {
        if phase == RawViewPhaseDto::Storing {
            // As a scanner reading the new copy would: no delete sharing, so
            // the staged entry can be neither renamed nor removed.
            let attempts = entry_names(&staging);
            let entry = staging.join(&attempts[0]).join("entry");
            *holder.lock().expect("held") = Some(
                fs::OpenOptions::new()
                    .read(true)
                    .share_mode(SHARE_READ_WRITE)
                    .custom_flags(BACKUP_SEMANTICS)
                    .open(entry)
                    .expect("hold the staged entry"),
            );
        }
    });
    assert_eq!(failed(&session.view()), ("view_cache_not_stored", true));
    assert_eq!(session.launches.load(Ordering::SeqCst), 1);
    assert_eq!(session.entries(), Vec::<String>::new(), "nothing published");
    assert_eq!(session.staging().len(), 1, "the held attempt stays");
    drop(held.lock().expect("held").take());

    // This process's own attempt is left by its sweep (decision 6; ADR 0060
    // slice 2 notes): only a later session, once this owner is gone, removes
    // it. Nothing is published from it.
    session.service.set_raw_view_phase_hook(|_, _| {});
    assert!(!ready(&session.view()).1);
    assert_eq!(session.entries().len(), 1);
    assert_eq!(session.staging().len(), 1, "left for a later session");
}

#[test]
fn a_cancel_accepted_after_the_last_read_still_ends_cancelled_and_releases_the_pin() {
    // Decision 10: Cancel always ends the operation `cancelled`, also when it
    // lands after the work reached an entry and before the operation settled.
    for hit in [false, true] {
        let session = viewing(&format!("raw-view-settle-{hit}"));
        if hit {
            ready(&session.view());
        }
        let service = Arc::downgrade(&session.service);
        session.service.set_raw_view_settle_hook(move |operation| {
            if let Some(service) = service.upgrade() {
                service.cancel_raw_view(RawViewOperationRequestDto { operation });
            }
        });
        let state = session.view();
        assert_eq!(cancelled_stored(&state), !hit, "stored only by a miss");
        assert_eq!(
            session
                .open(operation_of(&state))
                .expect_err("never opened")
                .kind,
            "raw_view_not_ready"
        );
        assert_eq!(summary(&session.service), (1, 0), "no pin is left");

        // Once settled, a Cancel is a late press.
        session.service.set_raw_view_settle_hook(|_| {});
        let (operation, _) = ready(&session.view());
        assert!(openable(
            &session
                .service
                .cancel_raw_view(RawViewOperationRequestDto { operation })
        ));
        assert_eq!(session.launches.load(Ordering::SeqCst), 1);
    }
}

#[test]
fn retry_of_a_terminal_queue_answers_raw_view_busy_while_a_view_runs() {
    let session = viewing("raw-view-retry");
    let service = &session.service;
    // Held open for writing, the item fails retryably and launches nothing.
    let held = session.raws.thermo_raw("held.raw");
    let blocked = add_one_acquisition(service, &held);
    let destination = destination_root(&session.raws, "out");
    let writer = hold_for_writing(&held);
    let update = queue_and_run(service, &[blocked], &destination);
    assert_eq!(terminal_queue(&update).retryable_failed_count, 1);
    drop(writer);

    // A terminal queue leaves the slot to View, and then Retry waits for it.
    let operation = session
        .begin()
        .expect("View begins beside a terminal queue");
    assert_eq!(
        service
            .retry_conversion_queue(current_document(service))
            .expect_err("no rerun beside a view")
            .kind,
        "raw_view_busy"
    );
    assert_eq!(session.launches.load(Ordering::SeqCst), 0);
    service.run_raw_view(operation);
    ready(&service.raw_view_state());
    assert!(
        service
            .retry_conversion_queue(current_document(service))
            .is_ok()
    );
}

impl HasLaunchCount for StopAwareRunner {
    fn launch_count(&self) -> Arc<AtomicUsize> {
        self.launches()
    }
}

impl Viewing {
    /// ADR 0015 and decision 10: the backend is quarantined, and the attempt
    /// stays, marker and all, for a later session's sweep.
    fn assert_quarantined_with_the_attempt_kept(&self) {
        assert_eq!(self.entries(), Vec::<String>::new(), "nothing published");
        let attempts = self.staging();
        assert_eq!(attempts.len(), 1, "the attempt stays");
        assert!(
            self.cache()
                .join("staging")
                .join(&attempts[0])
                .join("owner.json")
                .is_file()
        );
        assert_eq!(
            self.begin().expect_err("quarantined").kind,
            "backend_quarantined"
        );
    }
}

#[test]
fn an_unconfirmed_end_of_msconvert_quarantines_the_backend_and_keeps_the_attempt() {
    // A Cancel whose termination could not be confirmed.
    let (runner, started, release) = StopAwareRunner::parked(StopEnding::Unterminated);
    let session = viewing_with(
        "raw-view-unterminated",
        runner,
        Arc::default(),
        open_responses(),
    );
    let operation = session.begin().expect("View begins");
    let worker = {
        let service = Arc::clone(&session.service);
        std::thread::spawn(move || service.run_raw_view(operation))
    };
    started
        .recv_timeout(Duration::from_secs(10))
        .expect("msconvert starts");
    session
        .service
        .cancel_raw_view(RawViewOperationRequestDto { operation });
    release.send(()).expect("release msconvert");
    worker.join().expect("the worker ends");
    assert!(!cancelled_stored(&session.service.raw_view_state()));
    session.assert_quarantined_with_the_attempt_kept();

    // A run that left its process unaccounted for, with no Cancel.
    let runner = FakeConversionRunner::new(BackendAct::StrandAnOwnedProcess);
    let arguments = runner.arguments();
    let session = viewing_with("raw-view-stranded", runner, arguments, open_responses());
    assert_eq!(failed(&session.view()), ("backend_execution_failed", false));
    session.assert_quarantined_with_the_attempt_kept();
}

#[test]
fn a_new_entry_that_cannot_be_checked_just_now_fails_unavailable_and_stays() {
    let session = viewing("raw-view-new-unreadable");
    let entries = session.cache().join("entries");
    let held = Arc::new(Mutex::new(None));
    let holder = Arc::clone(&held);
    let seen = AtomicUsize::new(0);
    session.service.set_raw_view_phase_hook(move |_, phase| {
        // The second check is of the entry just published; something else
        // holds it at that moment.
        if phase == RawViewPhaseDto::CheckingCachedCopy && seen.fetch_add(1, Ordering::SeqCst) == 1
        {
            let names = entry_names(&entries);
            *holder.lock().expect("held") = Some(hold_exclusively(&entries.join(&names[0])));
        }
    });
    assert_eq!(
        failed(&session.view()),
        ("view_cache_entry_unavailable", true)
    );
    drop(held.lock().expect("held").take());
    assert_eq!(session.entries().len(), 1, "published, and left");

    session.service.set_raw_view_phase_hook(|_, _| {});
    assert!(ready(&session.view()).1, "the next View checks it as a hit");
    assert_eq!(session.launches.load(Ordering::SeqCst), 1);
}

/// Runs `fill` once, as this view's Storing begins.
fn when_storing(session: &Viewing, fill: impl Fn() + Send + Sync + 'static) {
    let done = AtomicBool::new(false);
    session.service.set_raw_view_phase_hook(move |_, phase| {
        if phase == RawViewPhaseDto::Storing && !done.swap(true, Ordering::SeqCst) {
            fill();
        }
    });
}

#[test]
fn a_place_another_process_filled_first_is_never_overwritten() {
    // Its key: every session here converts the same bytes with one build.
    let probe = viewing("raw-view-occupied-key");
    ready(&probe.view());
    let key = probe.entries()[0].clone();

    // A sound entry another session published first is used, and this
    // operation's attempt is dropped.
    let session = viewing("raw-view-occupied-sound");
    let app_data = session.app_data.directory.clone();
    let theirs = Arc::new(Mutex::new(Vec::new()));
    let manifest = Arc::clone(&theirs);
    let place = session.cache().join("entries").join(&key);
    when_storing(&session, move || {
        let other = viewing("raw-view-occupied-sound-other");
        other.service.bind_view_cache(Some(app_data.clone()));
        ready(&other.view());
        *manifest.lock().expect("manifest") =
            fs::read(place.join("entry.json")).expect("their manifest");
    });
    let (_, cache_hit) = ready(&session.view());
    assert!(!cache_hit, "this operation converted");
    assert_eq!(session.launches.load(Ordering::SeqCst), 1);
    assert_eq!(session.staging(), Vec::<String>::new());
    assert_eq!(
        fs::read(session.the_entry().join("entry.json")).expect("the manifest"),
        *theirs.lock().expect("manifest"),
        "the entry there is left as it was"
    );

    // A damaged one is removed, and this attempt is published in its place.
    let session = viewing("raw-view-occupied-damaged");
    let app_data = session.app_data.directory.clone();
    let place = session.cache().join("entries").join(&key);
    when_storing(&session, move || {
        {
            let other = viewing("raw-view-occupied-damaged-other");
            other.service.bind_view_cache(Some(app_data.clone()));
            ready(&other.view());
        }
        corrupt_output(&place);
    });
    let (_, cache_hit) = ready(&session.view());
    assert!(!cache_hit);
    assert_eq!(session.staging(), Vec::<String>::new());
    session.service.set_raw_view_phase_hook(|_, _| {});
    assert!(ready(&session.view()).1, "what it published verifies");
    assert_eq!(session.launches.load(Ordering::SeqCst), 1);

    // Something MSCanvas did not make is left exactly as found.
    let session = viewing("raw-view-occupied-foreign");
    let foreign = session.cache().join("entries").join(&key);
    let place = foreign.clone();
    when_storing(&session, move || {
        fs::write(&place, b"not MSCanvas's").expect("a file in the entry's place");
    });
    assert_eq!(
        failed(&session.view()),
        ("view_cache_entry_unrecognized", false)
    );
    assert_eq!(
        fs::read(&foreign).expect("left as found"),
        b"not MSCanvas's"
    );
    assert_eq!(session.staging(), Vec::<String>::new());
}

fn operation_of(state: &RawViewStateDto) -> u64 {
    match state {
        RawViewStateDto::Running { operation, .. }
        | RawViewStateDto::Ready { operation, .. }
        | RawViewStateDto::Failed { operation, .. }
        | RawViewStateDto::Cancelled { operation, .. } => *operation,
        RawViewStateDto::Idle => panic!("no operation"),
    }
}
