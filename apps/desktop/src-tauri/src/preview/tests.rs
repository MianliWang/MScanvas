//! Deterministic coverage for the preview boundary.
//!
//! Every test substitutes a provider at the application boundary, so none of
//! them needs a local ProteoWizard installation and none of them can reach a
//! real backend. The fake lives under `cfg(test)` only, so no production
//! command can ever return mock data.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use mscanvas_proteowizard::{
    PreviewOperation, PreviewOutcome, PreviewOutputEntry, PreviewOutputManifest, ProcessOutput,
    Termination, interpret_preview,
};

use super::backend::{OperationAttempt, PreviewProvider, interpretation_error};
use super::dto::{
    BackendAvailabilityDto, BackendFailureDto, PreviewErrorDto, SelectedSpectrumOutcomeDto,
};
use super::installation::InstallationIdentity;
use super::service::PreviewService;

const METADATA_OUTPUT: &str = concat!(
    // Printed before any section header, which the parser keeps separately.
    "sourceFile: D:\\MSData\\private\\before-any-section.mzML\n",
    "fileDescription:\n",
    "  sourceFile: D:\\MSData\\private\\sample.mzML\n",
    "sampleList:\n",
    "  sample: pooled reference\n",
    "instrumentConfigurationList:\n",
    "  analyzer: FTMS\n",
    "softwareList:\n",
    "  software: ProteoWizard\n",
    "dataProcessingList\n",
    "  processing: conversion\n",
);

const SPECTRUM_TABLE_OUTPUT: &str = concat!(
    "# sample.mzML\n",
    "index\tid\tevent\tanalyzer\tmsLevel\trt\tmzLow\tmzHigh\tbasePeakMZ\tbasePeakInt\tTIC\t",
    "charge\tprecursorMZ\tthermo_monoMZ\tfilterStringMZ\tionInjectionTime\n",
    "0\t19\t1\tFTMS\tms1\t0.10\t100\t1000\t445.12\t9000\t120000\t\t\t\t\t\n",
    "1\t20\t2\tFTMS\tms2\t0.20\t100\t1000\t333.33\t5000\t60000\t2\t445.12\t\t\t\n",
    "2\t21\t1\tFTMS\tms1\t0.30\t100\t1000\t500.00\t7000\t80000\t\t\t\t\t\n",
);

/// A table whose native identifiers are path-shaped, which nothing stops an
/// acquisition from containing.
///
/// The rows a session records are kept as the backend reported them, because
/// reconciling a later spectrum against redacted text would compare two
/// different strings. That makes them the one place in the session where a path
/// can arrive without passing through the redactor.
const PATH_SHAPED_SPECTRUM_TABLE_OUTPUT: &str = concat!(
    "# sample.mzML\n",
    "index\tid\tevent\tanalyzer\tmsLevel\trt\tmzLow\tmzHigh\tbasePeakMZ\tbasePeakInt\tTIC\t",
    "charge\tprecursorMZ\tthermo_monoMZ\tfilterStringMZ\tionInjectionTime\n",
    "0\tD:\\MSData\\private-run.raw#19\t1\tFTMS\tms1\t0.10\t100\t1000\t445.12\t9000\t120000\t\t\t\t\t\n",
);

/// A second acquisition's table, told apart from the first by every value a
/// selected spectrum is reconciled against.
///
/// Two datasets opened with the same canned table would let a test that claims
/// each keeps its own rows pass while they shared one.
const OTHER_SPECTRUM_TABLE_OUTPUT: &str = concat!(
    "# other.mzML\n",
    "index\tid\tevent\tanalyzer\tmsLevel\trt\tmzLow\tmzHigh\tbasePeakMZ\tbasePeakInt\tTIC\t",
    "charge\tprecursorMZ\tthermo_monoMZ\tfilterStringMZ\tionInjectionTime\n",
    "0\t807\t1\tFTMS\tms1\t4.10\t100\t1000\t612.45\t2200\t31000\t\t\t\t\t\n",
    "1\t808\t2\tFTMS\tms2\t4.20\t100\t1000\t488.90\t1400\t19000\t2\t612.45\t\t\t\n",
);

/// One spectrum of that second acquisition, agreeing with the row above.
fn other_selected_spectrum_output(index: u64, points: &[(f64, f64)]) -> String {
    let mut text = String::from("# other.mzML\n#\n");
    text.push_str(&format!("# index: {index}\n"));
    text.push_str(&format!("# id: scan={}\n", index + 807));
    text.push_str(&format!("# scanNumber: {}\n", index + 807));
    text.push_str("# massAnalyzerType: FTMS\n");
    text.push_str("# scanEvent: 1\n");
    text.push_str("# msLevel: 1\n");
    text.push_str("# retentionTime: 4.10\n");
    text.push_str("# filterString: synthetic\n");
    text.push_str("# mzLow: 100\n");
    text.push_str("# mzHigh: 1000\n");
    text.push_str("# basePeakMZ: 612.45000000\n");
    text.push_str("# basePeakIntensity: 2200.00000000\n");
    text.push_str("# totalIonCurrent: 31000.00000000\n");
    text.push_str("# precursorCount: 0\n");
    text.push_str(&format!("# binary ({}):\n", points.len()));
    for (mz, intensity) in points {
        text.push_str(&format!("{mz:.8} {intensity:.8}\n"));
    }
    text
}

fn run_summary_output() -> String {
    let headers = [
        "Filename",
        "Timestamp",
        "Vendor",
        "Model",
        "Serial#",
        "MS1s",
        "MS2s",
        "Zooms",
        "Charges",
        "MS1 PtsMean",
        "MS1 PtsMin",
        "MS1 PtsQ1",
        "MS1 PtsQ2",
        "MS1 PtsQ3",
        "MS1 PtsMax",
        "MS2 PtsMean",
        "MS2 PtsMin",
        "MS2 PtsQ1",
        "MS2 PtsQ2",
        "MS2 PtsQ3",
        "MS2 PtsMax",
        "MinRT",
        "RT@25%BPI",
        "RT@50%BPI",
        "RT@75%BPI",
        "MaxRT",
    ];
    let values = [
        "sample.mzML",
        "2026-07-27",
        "vendor",
        "model",
        "serial",
        "2",
        "1",
        "0",
        "0",
        "15",
        "15",
        "15",
        "15",
        "15",
        "15",
        "8",
        "8",
        "8",
        "8",
        "8",
        "8",
        "0.10",
        "0.15",
        "0.20",
        "0.25",
        "0.30",
    ];
    format!("{}\n{}\n", headers.join("\t"), values.join("\t"))
}

fn selected_spectrum_output(index: u64, points: &[(f64, f64)]) -> String {
    let mut text = String::from("# sample.mzML\n#\n");
    text.push_str(&format!("# index: {index}\n"));
    text.push_str(&format!("# id: scan={}\n", index + 19));
    text.push_str(&format!("# scanNumber: {}\n", index + 19));
    text.push_str("# massAnalyzerType: FTMS\n");
    text.push_str("# scanEvent: 1\n");
    text.push_str("# msLevel: 1\n");
    text.push_str("# retentionTime: 0.10\n");
    text.push_str("# filterString: synthetic\n");
    text.push_str("# mzLow: 100\n");
    text.push_str("# mzHigh: 1000\n");
    text.push_str("# basePeakMZ: 445.12000000\n");
    text.push_str("# basePeakIntensity: 9000.00000000\n");
    text.push_str("# totalIonCurrent: 120000.00000000\n");
    text.push_str("# precursorCount: 0\n");
    text.push_str(&format!("# binary ({}):\n", points.len()));
    for (mz, intensity) in points {
        text.push_str(&format!("{mz:.8} {intensity:.8}\n"));
    }
    text
}

fn completed_process(stdout: &str) -> ProcessOutput {
    let bytes = stdout.as_bytes().to_vec();
    let total = bytes.len() as u64;
    ProcessOutput {
        stdout: bytes,
        stderr: Vec::new(),
        stdout_total_bytes: total,
        stderr_total_bytes: 0,
        stdout_truncated: false,
        stderr_truncated: false,
        exit_code: Some(0),
        elapsed: std::time::Duration::from_millis(1),
        termination: Termination::Exited,
        max_active_processes: None,
        final_active_processes: None,
        peak_job_memory_bytes: None,
    }
}

/// The response a fake provider gives for one operation.
enum Response {
    /// Interpret this generated-file payload through the real typed parser.
    File(String),
    /// Interpret this stdout payload through the real typed parser.
    Stdout(String),
    /// Exit zero with no generated output, which the contract reads as the
    /// typed "this index does not exist" answer.
    NoOutput,
    /// A generated file larger than this boundary reads in one piece. The real
    /// backend produces this for an acquisition whose spectrum table exceeds
    /// `MAX_PREVIEW_OUTPUT_BYTES`; a measured 26,431-spectrum run reaches 2.76
    /// MiB of the 8 MiB ceiling, so about 76,600 spectra is where it starts.
    OversizedFile {
        captured_bytes: u64,
        total_bytes: u64,
    },
    Error(PreviewErrorDto),
}

/// One named backend, distinguishable from any other by name alone.
///
/// The paths need not exist: what a test needs is two identities that differ,
/// and two that do not.
fn backend(label: &str, release: &str) -> InstallationIdentity {
    let home = PathBuf::from(format!(r"C:\fake\{label}"));
    InstallationIdentity::for_test(&home.join(MSCONVERT), &home.join(MSACCESS), release)
}

const MSCONVERT: &str = "msconvert.exe";
const MSACCESS: &str = "msaccess.exe";

/// A backend whose tools are real files, so the pre-flight -- which asks the
/// filesystem and launches nothing -- has something to look at.
struct InstalledFiles {
    home: PathBuf,
}

impl InstalledFiles {
    fn new(label: &str) -> Self {
        let home =
            std::env::temp_dir().join(format!("mscanvas-tools-{label}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&home);
        fs::create_dir_all(&home).expect("tool directory");
        fs::write(home.join(MSCONVERT), b"msconvert").expect("msconvert");
        fs::write(home.join(MSACCESS), b"msaccess").expect("msaccess");
        Self { home }
    }

    fn identity(&self) -> InstallationIdentity {
        InstallationIdentity::for_test(
            &self.home.join(MSCONVERT),
            &self.home.join(MSACCESS),
            "3.0.26013",
        )
    }

    /// Replaces one executable, as an installer repairing in place would.
    fn replace_msaccess(&self) {
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(self.home.join(MSACCESS), b"a different msaccess entirely").expect("replace");
    }
}

impl Drop for InstalledFiles {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.home);
    }
}

/// The part of a fake's world a test can still reach after the provider has
/// been handed to the service.
///
/// Needed because the interesting changes happen to the machine while the
/// application is running: an installation is upgraded, removed, or replaced,
/// and nothing asked for that.
#[derive(Clone)]
struct FakeWorld {
    resolved: Arc<Mutex<Option<InstallationIdentity>>>,
    requested: Arc<Mutex<Vec<PreviewOperation>>>,
    looks: Arc<Mutex<usize>>,
}

impl FakeWorld {
    fn new(resolved: Option<InstallationIdentity>) -> Self {
        Self {
            resolved: Arc::new(Mutex::new(resolved)),
            requested: Arc::new(Mutex::new(Vec::new())),
            looks: Arc::new(Mutex::new(0)),
        }
    }

    /// Points this world at a different backend, or at none. Models the machine
    /// changing underneath a running application.
    fn resolves_to(&self, identity: Option<InstallationIdentity>) {
        *self.resolved.lock().expect("test lock") = identity;
    }

    fn resolved_backend(&self) -> Option<InstallationIdentity> {
        self.resolved.lock().expect("test lock").clone()
    }

    /// How many backend operations have actually been run, so a test can say
    /// that something was refused *before* one was spent on it.
    fn requested_count(&self) -> usize {
        self.requested.lock().expect("test lock").len()
    }

    /// How many times the backend has been resolved. Resolving is two help
    /// probes and two executable hashes in production, so a test can say that
    /// a cheap check stayed cheap.
    fn availability_count(&self) -> usize {
        *self.looks.lock().expect("test lock")
    }
}

/// A deterministic stand-in for a user-installed ProteoWizard.
///
/// It still runs every payload through the real typed interpreter, so tests
/// exercise the production parsing contract rather than a parallel one.
struct FakeProvider {
    availability: BackendAvailabilityDto,
    /// What a chosen folder reports. `None` means every chosen folder is a
    /// folder with no usable installation in it.
    chosen_availability: Option<BackendAvailabilityDto>,
    chosen: Mutex<Option<PathBuf>>,
    /// Which backend this fake's world resolves to, whatever was requested.
    ///
    /// Separate from `chosen` on purpose: that is the configuration, this is
    /// what it resolves to, and the whole point of the model under test is that
    /// the two move independently.
    world: FakeWorld,
    responses: Mutex<Vec<Response>>,
    batches: Mutex<usize>,
}

impl FakeProvider {
    fn available(responses: Vec<Response>) -> Self {
        Self {
            availability: BackendAvailabilityDto {
                state: "available".to_owned(),
                origin: "automatic".to_owned(),
                installation_generation: 0,
                release: Some("3.0.26204".to_owned()),
                build_date: Some("Jul 23 2026".to_owned()),
                same_installation: true,
                failure: None,
            },
            chosen_availability: None,
            chosen: Mutex::new(None),
            world: FakeWorld::new(Some(backend("installed", "3.0.26013"))),
            responses: Mutex::new(responses),
            batches: Mutex::new(0),
        }
    }

    fn unavailable() -> Self {
        Self {
            availability: BackendAvailabilityDto {
                state: "unavailable".to_owned(),
                origin: "automatic".to_owned(),
                installation_generation: 0,
                release: None,
                build_date: None,
                same_installation: false,
                failure: Some(BackendFailureDto {
                    kind: "backend_not_found".to_owned(),
                    summary: "ProteoWizard was not found.".to_owned(),
                    corrective_action: "Install ProteoWizard separately.".to_owned(),
                }),
            },
            chosen_availability: None,
            chosen: Mutex::new(None),
            world: FakeWorld::new(None),
            responses: Mutex::new(vec![Response::Error(PreviewErrorDto::new(
                "backend_not_found",
                "ProteoWizard was not found.",
                false,
            ))]),
            batches: Mutex::new(0),
        }
    }

    /// A provider that finds nothing on its own but works in a chosen folder.
    fn only_when_chosen() -> Self {
        let mut provider = Self::unavailable();
        // A world that resolves to a real backend once a folder is chosen. It
        // stays masked while the verdict is unavailable, exactly as production
        // masks it, so "nothing found" and "found this" remain distinguishable.
        provider.world = FakeWorld::new(Some(backend("chosen", "3.0.26204")));
        provider.chosen_availability = Some(BackendAvailabilityDto {
            state: "available".to_owned(),
            origin: "chosen".to_owned(),
            installation_generation: 0,
            release: Some("3.0.26204".to_owned()),
            build_date: Some("Jul 23 2026".to_owned()),
            same_installation: true,
            failure: None,
        });
        provider
    }

    /// A handle onto this fake's world that survives being boxed.
    fn clone_world(&self) -> FakeWorld {
        self.world.clone()
    }

    fn resolved_backend(&self) -> Option<InstallationIdentity> {
        self.world.resolved_backend()
    }

    /// Re-derived on every call from what is currently chosen, exactly as
    /// production does. A fake that returned a fixed verdict would pass the
    /// stale-banner test without the code being able to.
    fn verdict(&self) -> BackendAvailabilityDto {
        let chosen = self.chosen.lock().expect("test lock").clone();
        let Some(chosen) = chosen else {
            return self.availability.clone();
        };
        match &self.chosen_availability {
            Some(availability) => availability.clone(),
            None => BackendAvailabilityDto {
                state: "unavailable".to_owned(),
                origin: "chosen".to_owned(),
                installation_generation: 0,
                release: None,
                build_date: None,
                same_installation: false,
                failure: Some(BackendFailureDto {
                    kind: "backend_not_found".to_owned(),
                    summary: format!(
                        "No ProteoWizard was found in that folder ({} characters).",
                        chosen.as_os_str().len()
                    ),
                    corrective_action: "Choose another folder, or go back to searching \
                                        automatically."
                        .to_owned(),
                }),
            },
        }
    }

    fn requested_operations(&self) -> Vec<PreviewOperation> {
        self.world.requested.lock().expect("test lock").clone()
    }

    fn batch_count(&self) -> usize {
        *self.batches.lock().expect("test lock")
    }
}

impl PreviewProvider for FakeProvider {
    fn use_installation(&self, home: Option<PathBuf>) {
        *self.chosen.lock().expect("test lock") = home;
    }

    fn availability(&self) -> (BackendAvailabilityDto, Option<InstallationIdentity>) {
        *self.world.looks.lock().expect("test lock") += 1;
        let verdict = self.verdict();
        // Only a usable backend has an identity, exactly as production does:
        // an installation that cannot be used is not one a preview could have
        // come from.
        let identity = (verdict.state == "available")
            .then(|| self.world.resolved_backend())
            .flatten();
        (verdict, identity)
    }

    fn run(
        &self,
        _source: &Path,
        operation: &PreviewOperation,
    ) -> Result<OperationAttempt, PreviewErrorDto> {
        self.world
            .requested
            .lock()
            .expect("test lock")
            .push(operation.clone());
        let mut responses = self.responses.lock().expect("test lock");
        if responses.is_empty() {
            return Err(PreviewErrorDto::new("test_exhausted", "no response", false));
        }
        let response = responses.remove(0);
        drop(responses);

        let (process, manifest) = match response {
            Response::File(text) => (
                completed_process(""),
                PreviewOutputManifest::single_complete_file(text.into_bytes()),
            ),
            Response::Stdout(text) => (completed_process(&text), PreviewOutputManifest::empty()),
            Response::NoOutput => (completed_process(""), PreviewOutputManifest::empty()),
            Response::OversizedFile {
                captured_bytes,
                total_bytes,
            } => (
                completed_process(""),
                PreviewOutputManifest::new(vec![PreviewOutputEntry::incomplete_file(
                    captured_bytes,
                    total_bytes,
                )]),
            ),
            Response::Error(error) => {
                return Ok(OperationAttempt {
                    installation: self.resolved_backend(),
                    outcome: Err(error),
                });
            }
        };
        let outcome =
            interpret_preview(operation, &process, &manifest).map_err(interpretation_error)?;
        Ok(OperationAttempt {
            installation: self.resolved_backend(),
            outcome: Ok(outcome),
        })
    }

    fn run_batch(
        &self,
        source: &Path,
        operations: &[PreviewOperation],
    ) -> Result<Vec<OperationAttempt>, PreviewErrorDto> {
        *self.batches.lock().expect("test lock") += 1;
        // Stops at the first failure, as the production batch does. A fake that
        // ran on would let a test claim the batch stopped when it had not.
        let mut attempts = Vec::with_capacity(operations.len());
        for operation in operations {
            let attempt = self.run(source, operation)?;
            let failed = attempt.outcome.is_err();
            attempts.push(attempt);
            if failed {
                break;
            }
        }
        Ok(attempts)
    }
}

/// Holds the backend gate open until released, so the requests behind it can be
/// observed waiting rather than raced against.
///
/// Only the first operation waits. Everything after it runs immediately, which
/// is what lets one test watch several queued requests come through in whatever
/// order the gate grants them.
struct BlockFirstProvider {
    inner: FakeProvider,
    started: std::sync::mpsc::Sender<()>,
    release: Mutex<Option<std::sync::mpsc::Receiver<()>>>,
}

impl PreviewProvider for BlockFirstProvider {
    fn use_installation(&self, _home: Option<PathBuf>) {}

    fn availability(&self) -> (BackendAvailabilityDto, Option<InstallationIdentity>) {
        self.inner.availability()
    }

    fn run(
        &self,
        source: &Path,
        operation: &PreviewOperation,
    ) -> Result<OperationAttempt, PreviewErrorDto> {
        if let Some(release) = self.release.lock().expect("test lock").take() {
            let _ = self.started.send(());
            // Not ignored. A test that timed out here would go on to pass a
            // little late, and the thing it is watching for -- a lock held
            // where it should not be -- looks exactly like that.
            release
                .recv_timeout(std::time::Duration::from_secs(10))
                .expect("the test released the gate rather than timing out");
        }
        self.inner.run(source, operation)
    }
}

struct TestFile {
    directory: PathBuf,
    path: PathBuf,
}

impl TestFile {
    fn new(label: &str) -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock after Unix epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "mscanvas-preview-tests-{label}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).expect("create test directory");
        let path = directory.join("sample.mzML");
        fs::write(&path, b"<mzML/>").expect("write test source");
        Self { directory, path }
    }
}

impl TestFile {
    /// Another acquisition beside this one, for the tests that need the session
    /// to hold more than one dataset.
    fn sibling(&self, name: &str) -> PathBuf {
        let path = self.directory.join(name);
        fs::write(&path, b"<mzML> another acquisition </mzML>").expect("write sibling source");
        path
    }
}

impl Drop for TestFile {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.directory);
    }
}

fn open_responses() -> Vec<Response> {
    vec![
        Response::File(METADATA_OUTPUT.to_owned()),
        Response::Stdout(run_summary_output()),
        Response::File(SPECTRUM_TABLE_OUTPUT.to_owned()),
    ]
}

#[test]
fn an_unavailable_backend_is_a_typed_state_not_an_error() {
    let service = PreviewService::new(Box::new(FakeProvider::unavailable()));

    let availability = service.inspect_backend();

    assert_eq!(availability.state, "unavailable");
    // MSCanvas never claims to supply a backend.
    let rendered = serde_json::to_string(&availability).expect("availability serializes");
    assert!(!rendered.to_lowercase().contains("bundled"));
    let failure = availability
        .failure
        .expect("an unavailable backend explains itself");
    assert_eq!(failure.kind, "backend_not_found");
    assert!(!failure.corrective_action.is_empty());
}

#[test]
fn choosing_an_installation_reports_that_installation_and_not_the_previous_one() {
    // The banner may never carry a verdict from before the change. Choosing and
    // probing are one call for exactly this reason: any gap between them is a
    // window in which "available" is shown for an installation nobody is using.
    let service = PreviewService::new(Box::new(FakeProvider::only_when_chosen()));
    let before = service.inspect_backend();
    assert_eq!(before.state, "unavailable");
    assert_eq!(before.origin, "automatic");

    let after = service.use_installation(Some(PathBuf::from("C:\\pwiz")));

    assert_eq!(after.state, "available");
    assert_eq!(after.origin, "chosen");
    assert!(after.failure.is_none());
    // And it stays that way for later readings, not just the one that changed it.
    assert_eq!(service.inspect_backend().origin, "chosen");
}

#[test]
fn a_chosen_folder_with_no_installation_can_be_undone() {
    // Without this the session is stuck: the chosen folder is the only place
    // MSCanvas looks, and a working installation it would have found on its own
    // sits unused with nothing to say so.
    let service = PreviewService::new(Box::new(FakeProvider::available(Vec::new())));
    let failed = service.use_installation(Some(PathBuf::from("C:\\not-an-installation")));
    assert_eq!(failed.state, "unavailable");
    assert_eq!(failed.origin, "chosen");
    let failure = failed
        .failure
        .expect("a folder that holds no installation explains itself");
    assert!(!failure.corrective_action.is_empty());

    let restored = service.use_installation(None);

    assert_eq!(restored.state, "available");
    assert_eq!(restored.origin, "automatic");
    assert!(restored.failure.is_none());
}

/// A provider that says when its batch has finished, so a test can queue an
/// installation change directly behind one open.
struct SignallingProvider {
    inner: FakeProvider,
    finished: Mutex<Option<std::sync::mpsc::Sender<()>>>,
}

impl PreviewProvider for SignallingProvider {
    fn use_installation(&self, home: Option<PathBuf>) {
        self.inner.use_installation(home);
    }

    fn availability(&self) -> (BackendAvailabilityDto, Option<InstallationIdentity>) {
        self.inner.availability()
    }

    fn run(
        &self,
        source: &Path,
        operation: &PreviewOperation,
    ) -> Result<OperationAttempt, PreviewErrorDto> {
        self.inner.run(source, operation)
    }

    fn run_batch(
        &self,
        source: &Path,
        operations: &[PreviewOperation],
    ) -> Result<Vec<OperationAttempt>, PreviewErrorDto> {
        let results = self.inner.run_batch(source, operations);
        // Sent while the gate is still held, so the waiting change queues
        // behind this open rather than racing it.
        if let Some(sender) = self.finished.lock().expect("test lock").take() {
            let _ = sender.send(());
        }
        results
    }
}

#[test]
fn a_change_queued_behind_an_open_is_not_absorbed_into_what_that_open_recorded() {
    // The rows an open records are the work of the installation in use for its
    // batch. A change waiting on the gate takes effect the moment that open
    // releases it, so anything read after that point describes the installation
    // which replaced the one that did the reading -- and a preview stamped that
    // way passes the very check that exists to refuse it.
    let file = TestFile::new("queued-change");
    let responses = vec![
        Response::File(METADATA_OUTPUT.to_owned()),
        Response::Stdout(run_summary_output()),
        Response::File(SPECTRUM_TABLE_OUTPUT.to_owned()),
        Response::File(selected_spectrum_output(0, &[(445.12, 9000.0)])),
    ];
    let (sender, receiver) = std::sync::mpsc::channel();
    let service = std::sync::Arc::new(PreviewService::new(Box::new(SignallingProvider {
        inner: FakeProvider::available(responses),
        finished: Mutex::new(Some(sender)),
    })));
    let selected = service.accept_file(&file.path).expect("accepted");

    let change = {
        let service = std::sync::Arc::clone(&service);
        std::thread::spawn(move || {
            receiver
                .recv()
                .expect("the open reports its batch finished");
            // Blocks on the backend gate until the open releases it.
            service.use_installation(Some(PathBuf::from(r"C:\pwiz")));
        })
    };

    service
        .open_preview(&selected.handle)
        .expect("the file opens");
    change.join().expect("the queued change completes");

    let error = service
        .load_spectrum(&selected.handle, 0)
        .expect_err("a spectrum is not reconciled against another installation's table");

    assert_eq!(error.kind, "installation_changed_since_preview");
}

#[test]
fn a_spectrum_is_refused_rather_than_reconciled_across_an_installation_change() {
    // The table's rows are what a selected spectrum is reconciled against, and
    // they were read by whichever installation was in use then. Comparing
    // across a change would call the difference between two installations a
    // finding about the file. Dropping the comparison is not the alternative:
    // it is what keeps the row the user clicked and the panel beside it
    // describing the same spectrum.
    let file = TestFile::new("installation-change");
    let responses = vec![
        Response::File(METADATA_OUTPUT.to_owned()),
        Response::Stdout(run_summary_output()),
        Response::File(SPECTRUM_TABLE_OUTPUT.to_owned()),
        Response::File(selected_spectrum_output(0, &[(445.12, 9000.0)])),
    ];
    let service = PreviewService::new(Box::new(FakeProvider::available(responses)));
    let selected = service.accept_file(&file.path).expect("accepted");
    service
        .open_preview(&selected.handle)
        .expect("the file opens");

    service.use_installation(Some(PathBuf::from(r"C:\pwiz")));

    let error = service
        .load_spectrum(&selected.handle, 0)
        .expect_err("a spectrum is not reconciled against another installation's table");

    assert_eq!(error.kind, "installation_changed_since_preview");
    // Not retryable: reading again changes nothing. Opening the file again is
    // the action, and the message says so.
    assert!(!error.retryable);
    assert!(error.summary.contains("Open the file again"));
}

#[test]
fn asking_for_the_installation_already_in_use_is_not_a_change() {
    // Every caller reads a higher generation as "the installation changed" and
    // throws away what the previous one read. Advancing it for a request that
    // switches nothing would make "Search automatically" while already
    // automatic, or re-picking the same folder, cost the user their open file
    // and a fresh read of it for no reason.
    let file = TestFile::new("no-op-change");
    let responses = vec![
        Response::File(METADATA_OUTPUT.to_owned()),
        Response::Stdout(run_summary_output()),
        Response::File(SPECTRUM_TABLE_OUTPUT.to_owned()),
        Response::File(selected_spectrum_output(0, &[(445.12, 9000.0)])),
    ];
    let service = PreviewService::new(Box::new(FakeProvider::available(responses)));
    let selected = service.accept_file(&file.path).expect("accepted");
    service
        .open_preview(&selected.handle)
        .expect("the file opens");

    // Already on automatic discovery, so this switches nothing.
    let again = service.use_installation(None);
    assert_eq!(again.installation_generation, 0);
    assert_eq!(again.origin, "automatic");

    // And what the previous reading produced is still usable, rather than
    // refused as another installation's work.
    service
        .load_spectrum(&selected.handle, 0)
        .expect("a spectrum still belongs to the installation that read the table");

    // A real switch still advances it, and asking for that same folder again
    // does not.
    let chosen = service.use_installation(Some(PathBuf::from(r"C:\pwiz")));
    assert_eq!(chosen.installation_generation, 1);
    let same = service.use_installation(Some(PathBuf::from(r"C:\pwiz")));
    assert_eq!(same.installation_generation, 1);
    // Switching back is a change again.
    assert_eq!(service.use_installation(None).installation_generation, 2);
}

#[test]
fn a_verdict_says_where_it_belongs_in_the_sequence_of_installation_changes() {
    // Request order is not service order: the two commands contend for one
    // gate, and it does not grant in the order they were called. A caller that
    // trusted its own ordering could show the installation a choice replaced
    // while every later operation used the chosen one. The number is what lets
    // it tell, and it is read under the gate that served the verdict.
    let service = PreviewService::new(Box::new(FakeProvider::only_when_chosen()));
    assert_eq!(service.inspect_backend().installation_generation, 0);

    let chosen = service.use_installation(Some(PathBuf::from("C:\\pwiz")));
    assert_eq!(chosen.installation_generation, 1);
    // A plain reading does not advance it -- only a change does.
    assert_eq!(service.inspect_backend().installation_generation, 1);

    let restored = service.use_installation(None);
    assert_eq!(restored.installation_generation, 2);
    assert_eq!(restored.origin, "automatic");
}

#[test]
fn a_chosen_folder_never_leaves_a_path_in_what_the_webview_receives() {
    // The webview is not allowed to learn a filesystem path, and choosing an
    // installation is a new way for one to reach it: unlike an install root,
    // this path is somewhere the user navigated to and may say who they are.
    //
    // Against the production provider, not a fake, because the fake cannot
    // answer this -- the text at issue comes from the crate's own discovery
    // failures. Hermetic all the same: a configured home is used as given and
    // never falls back, so a folder that does not exist fails before anything
    // is launched.
    let provider = super::backend::ProteoWizardProvider::new();
    let chosen = std::env::temp_dir().join("mscanvas-no-such-installation-9f2c1a");
    assert!(!chosen.exists(), "the test folder must not exist");
    provider.use_installation(Some(chosen));

    let (availability, identity) = provider.availability();

    assert_eq!(availability.state, "unavailable");
    assert_eq!(availability.origin, "chosen");
    // Nothing resolved, so there is no identity. It must not be `Some` of
    // anything: an unusable installation compares equal to no preview's.
    assert!(identity.is_none());
    // And the reason names what is actually wrong with the folder rather than
    // repeating the crate's one sentence for every configured location.
    let failure = availability
        .failure
        .as_ref()
        .expect("a chosen folder that does not work explains itself");
    assert_eq!(failure.kind, "chosen_folder_missing");
    // The identity itself is unserialisable by construction, so the only thing
    // that can carry a path out of here is the transfer object.
    let rendered = serde_json::to_string(&availability).expect("availability serializes");
    assert!(
        !rendered.contains("mscanvas-no-such-installation"),
        "{rendered}"
    );
    // No path shape of any kind: a separator is what carries a path, and the
    // rendering escapes each backslash, so one escaped pair is one separator.
    assert!(!rendered.contains("\\\\"), "{rendered}");
    assert!(
        !rendered.contains(&std::env::temp_dir().to_string_lossy().to_string()),
        "{rendered}"
    );
}

#[test]
fn opening_a_file_returns_typed_metadata_run_summary_and_rows() {
    let file = TestFile::new("open");
    let provider = Box::new(FakeProvider::available(open_responses()));
    let service = PreviewService::new(provider);
    let selected = service
        .accept_file(&file.path)
        .expect("the file is accepted");

    let preview = service
        .open_preview(&selected.handle)
        .expect("preview loads");

    assert_eq!(preview.file.file_name, "sample.mzML");
    // Five named sections plus the lines printed before the first of them.
    assert_eq!(preview.metadata.sections.len(), 6);
    assert_eq!(preview.run_summary.total_spectrum_count, 3);
    assert_eq!(preview.run_summary.ms_levels.len(), 2);
    // The measured formatter emits no chromatogram count, which is not zero.
    assert_eq!(preview.run_summary.chromatogram_count, None);
    let range = preview
        .run_summary
        .retention_time_range
        .expect("a retention-time range was emitted");
    assert!(!range.minimum.unit_known && !range.maximum.unit_known);
    assert_eq!(preview.spectrum_table.rows.len(), 3);
    assert_eq!(preview.spectrum_table.total_row_count, 3);
    assert!(!preview.spectrum_table.truncated);
    assert_eq!(preview.spectrum_table.rows[1].ms_level, 2);
    assert_eq!(preview.spectrum_table.rows[1].precursor_mz, Some(445.12));
    assert_eq!(preview.spectrum_table.rows[0].precursor_mz, None);
}

#[test]
fn one_open_action_resolves_the_backend_once_for_every_panel() {
    let file = TestFile::new("batch");
    let provider = FakeProvider::available(open_responses());
    let provider = Box::new(provider);
    let service = PreviewService::new(provider);
    let selected = service.accept_file(&file.path).expect("accepted");

    service
        .open_preview(&selected.handle)
        .expect("preview loads");

    // Asserted through the service surface: metadata, run summary and the
    // spectrum table are requested as one batch rather than three independent
    // discoveries.
    let provider = FakeProvider::available(open_responses());
    let operations = super::backend::open_operations();
    let results = provider
        .run_batch(&file.path, &operations)
        .expect("the batch runs");
    assert_eq!(results.len(), 3);
    assert_eq!(provider.batch_count(), 1);
    assert_eq!(provider.requested_operations(), operations);
}

#[test]
fn malformed_preview_output_maps_to_a_bounded_typed_error() {
    let file = TestFile::new("malformed");
    let service = PreviewService::new(Box::new(FakeProvider::available(vec![Response::File(
        "not a metadata document".to_owned(),
    )])));
    let selected = service.accept_file(&file.path).expect("accepted");

    let error = service
        .open_preview(&selected.handle)
        .expect_err("unusable output is refused");

    assert_eq!(error.kind, "malformed_output");
    // Bounded detail is a stable structural identifier, never backend prose.
    assert_eq!(error.detail.as_deref(), Some("missing_required_section"));
    let rendered = serde_json::to_string(&error).expect("the error serializes");
    assert!(!rendered.contains("mscanvas-preview-tests"));
}

#[test]
fn a_missing_required_result_is_refused_rather_than_shown_as_empty() {
    let file = TestFile::new("missing");
    let service = PreviewService::new(Box::new(FakeProvider::available(vec![Response::NoOutput])));
    let selected = service.accept_file(&file.path).expect("accepted");

    let error = service
        .open_preview(&selected.handle)
        .expect_err("a missing required result is refused");

    assert_eq!(error.kind, "missing_required_output");
}

#[test]
fn a_selected_spectrum_returns_its_arrays_and_canonical_identity() {
    let file = TestFile::new("spectrum");
    let service = PreviewService::new(Box::new(FakeProvider::available(vec![Response::File(
        selected_spectrum_output(0, &[(100.5, 10.0), (200.25, 40.0)]),
    )])));
    let selected = service.accept_file(&file.path).expect("accepted");

    let outcome = service
        .load_spectrum(&selected.handle, 0)
        .expect("the spectrum loads");

    let SelectedSpectrumOutcomeDto::Spectrum { spectrum } = outcome else {
        panic!("a present spectrum is not the unavailable outcome");
    };
    assert_eq!(spectrum.index, 0);
    assert_eq!(spectrum.scan_number, Some(19));
    assert_eq!(spectrum.point_count, 2);
    assert_eq!(spectrum.mz, vec![100.5, 200.25]);
    assert_eq!(spectrum.intensity, vec![10.0, 40.0]);
    assert!(!spectrum.truncated);
    // Neither representation nor array units were emitted, so neither is claimed.
    assert!(!spectrum.representation_known);
    assert!(!spectrum.value_units_known);
    assert!(!spectrum.retention_time.unit_known);
}

#[test]
fn a_spectrum_with_no_peaks_is_a_valid_spectrum_not_a_no_result() {
    let file = TestFile::new("empty-spectrum");
    let service = PreviewService::new(Box::new(FakeProvider::available(vec![Response::File(
        selected_spectrum_output(2, &[]),
    )])));
    let selected = service.accept_file(&file.path).expect("accepted");

    let outcome = service
        .load_spectrum(&selected.handle, 2)
        .expect("an empty spectrum loads");

    let SelectedSpectrumOutcomeDto::Spectrum { spectrum } = outcome else {
        panic!("an empty spectrum is still a spectrum");
    };
    assert_eq!(spectrum.point_count, 0);
    assert!(spectrum.mz.is_empty());
    assert!(spectrum.intensity.is_empty());
}

#[test]
fn an_unavailable_index_is_a_typed_no_result() {
    let file = TestFile::new("no-result");
    let service = PreviewService::new(Box::new(FakeProvider::available(vec![Response::NoOutput])));
    let selected = service.accept_file(&file.path).expect("accepted");

    let outcome = service
        .load_spectrum(&selected.handle, 4_096)
        .expect("an unavailable index is not an error");

    assert_eq!(
        outcome,
        SelectedSpectrumOutcomeDto::Unavailable {
            requested_index: 4_096
        }
    );
}

#[test]
fn transferred_metadata_is_redacted_and_bounded() {
    let file = TestFile::new("redaction");
    let service = PreviewService::new(Box::new(FakeProvider::available(open_responses())));
    let selected = service.accept_file(&file.path).expect("accepted");

    let preview = service
        .open_preview(&selected.handle)
        .expect("preview loads");
    let rendered = serde_json::to_string(&preview).expect("the preview serializes");

    // The opened path never reaches the webview, even inside metadata text.
    assert!(!rendered.contains("mscanvas-preview-tests"));
    assert!(!rendered.to_lowercase().contains("d:\\\\msdata"));
    // The document's own recorded source path is a path the user did not
    // choose, so it is removed too.
    assert!(!rendered.to_lowercase().contains("msdata"));
    assert!(rendered.contains("<path>"));

    let long_line = "x".repeat(4_000);
    assert!(
        super::dto::bounded_text(&long_line, super::dto::MAX_METADATA_LINE_CHARS)
            .chars()
            .count()
            <= super::dto::MAX_METADATA_LINE_CHARS + 1
    );
}

#[test]
fn absolute_path_shapes_are_removed_from_displayable_text() {
    use super::dto::redact_absolute_paths;

    assert_eq!(
        redact_absolute_paths(r"sourceFile: D:\MSData\sample.mzML"),
        "sourceFile: <path>"
    );
    assert_eq!(
        redact_absolute_paths("location: file:///D:/MSData/sample.mzML"),
        "location: <path>"
    );

    // Shapes taken from a real acquisition's metadata, with the values replaced.
    // A `sourceFile` location is written at acquisition time, so it names the
    // instrument's own drive rather than anything the session redactor knows,
    // and a real directory name may contain a space and mix separators.
    assert_eq!(
        redact_absolute_paths("      location: file:///E:/Instrument Data/2026/run"),
        "      location: <path>"
    );
    assert_eq!(
        redact_absolute_paths(r"      location: file:///D:/Some Folder\plate\A01"),
        "      location: <path>"
    );
    assert_eq!(
        redact_absolute_paths(r"share: \\server\data\sample.mzML"),
        "share: <path>"
    );
    // A path containing spaces is removed whole. Stopping at the first space
    // would leave the rest of the path on screen.
    assert_eq!(
        redact_absolute_paths(r"sourceFile: D:\Grant Study\Spec\private.raw"),
        "sourceFile: <path>"
    );
    // The marker is found wherever it appears, not only at a token start.
    assert_eq!(
        redact_absolute_paths(r"sourceFile=D:\private\sample.raw"),
        "sourceFile=<path>"
    );
    assert_eq!(
        redact_absolute_paths(r#"<sourceFile location="file:///D:/private/x.raw"/>"#),
        "<sourceFile location=\"<path>"
    );
    // Ordinary scientific text keeps its shape, including trailing whitespace.
    assert_eq!(
        redact_absolute_paths("analyzer: FTMS resolution 70000\n"),
        "analyzer: FTMS resolution 70000\n"
    );
    assert_eq!(redact_absolute_paths("ratio: 3:1"), "ratio: 3:1");
    // A POSIX absolute path has one leading slash, and an mzML written on
    // Linux or macOS is just as revealing when previewed on Windows.
    assert_eq!(
        redact_absolute_paths("sourceFile=/home/alice/private/run.raw"),
        "sourceFile=<path>"
    );
    assert_eq!(
        redact_absolute_paths("sourceFile: /Volumes/Lab Share/run.raw"),
        "sourceFile: <path>"
    );
    // A `key:value` colon is a boundary like any other. Only the `://` of a
    // URI authority is exempt.
    assert_eq!(
        redact_absolute_paths("source:/home/alice/run.raw"),
        "source:<path>"
    );
    assert_eq!(
        redact_absolute_paths(r"path:\\server\share\run.raw"),
        "path:<path>"
    );
    // Backend text brackets and separates values in several ways.
    assert_eq!(
        redact_absolute_paths("source=(/home/alice/run.raw)"),
        "source=(<path>"
    );
    assert_eq!(
        redact_absolute_paths(r"source=[\\server\share\run.raw]"),
        "source=[<path>"
    );
    // A path segment is not restricted to filename-looking characters.
    assert_eq!(
        redact_absolute_paths("source=/$HOME/private.raw"),
        "source=<path>"
    );
    assert_eq!(
        redact_absolute_paths("source=/@archive/run.raw"),
        "source=<path>"
    );
    // A directory name may begin with a space. After `=` the value starts
    // wherever it starts; after a space the same shape would be prose.
    assert_eq!(
        redact_absolute_paths("source=/ private/run.raw"),
        "source=<path>"
    );
    // A POSIX path may begin with a non-ASCII directory name.
    assert_eq!(
        redact_absolute_paths("source=/用户/王/样本.raw"),
        "source=<path>"
    );
    // A controlled-vocabulary URL is not a filesystem path and stays readable,
    // and neither is a unit or an m/z label.
    assert_eq!(
        redact_absolute_paths("cv: http://psi.hupo.org/ms/mzml"),
        "cv: http://psi.hupo.org/ms/mzml"
    );
    assert_eq!(
        redact_absolute_paths("scanWindow: 200-2000 m/z at counts/second"),
        "scanWindow: 200-2000 m/z at counts/second"
    );
    assert_eq!(redact_absolute_paths("ratio: 3 / 4"), "ratio: 3 / 4");
    // Non-ASCII is legitimate in an mzML field. Nothing here may slice text at
    // a byte offset that is not a character boundary.
    assert_eq!(
        redact_absolute_paths("sample: 標準サンプル f中文"),
        "sample: 標準サンプル f中文"
    );
    assert_eq!(
        redact_absolute_paths(r"sample: 標準 D:\データ\run.mzML"),
        "sample: 標準 <path>"
    );
    // Each line is judged on its own, so one path does not blank the rest.
    assert_eq!(
        redact_absolute_paths("software: pwiz\nsourceFile: C:/data/a.mzML\nmsLevel: 2"),
        "software: pwiz\nsourceFile: <path>\nmsLevel: 2"
    );
}

#[test]
fn a_non_finite_value_is_refused_rather_than_serialized() {
    assert!(super::dto::require_finite(1.5).is_ok());
    let error = super::dto::require_finite(f64::NAN).expect_err("NaN cannot be displayed");
    assert_eq!(error.kind, "non_finite_value");
    assert!(super::dto::require_finite(f64::INFINITY).is_err());
    assert!(super::dto::require_finite_option(None).is_ok());
    assert!(super::dto::require_finite_option(Some(f64::NEG_INFINITY)).is_err());
}

/// Rewrites the source part-way through a batch, standing in for another
/// program replacing the acquisition while MSCanvas is reading it.
struct RewritingProvider {
    inner: FakeProvider,
    target: PathBuf,
    runs: Mutex<usize>,
}

impl PreviewProvider for RewritingProvider {
    fn use_installation(&self, _home: Option<PathBuf>) {}

    fn availability(&self) -> (BackendAvailabilityDto, Option<InstallationIdentity>) {
        self.inner.availability()
    }

    fn run(
        &self,
        source: &Path,
        operation: &PreviewOperation,
    ) -> Result<OperationAttempt, PreviewErrorDto> {
        let result = self.inner.run(source, operation);
        let mut runs = self.runs.lock().expect("test lock");
        *runs += 1;
        if *runs == 1 {
            // May fail, and that is a pass: the service holds the file against
            // replacement for the duration of a read, which is the stronger of
            // the two defences.
            let _ = fs::write(&self.target, b"<mzML> rewritten </mzML>");
        }
        result
    }
}

#[test]
fn a_source_rewritten_between_operations_is_refused_rather_than_combined() {
    let file = TestFile::new("generation");
    let provider = Box::new(RewritingProvider {
        inner: FakeProvider::available(open_responses()),
        target: file.path.clone(),
        runs: Mutex::new(0),
    });
    let service = PreviewService::new(provider);
    let selected = service.accept_file(&file.path).expect("accepted");

    let outcome = service.open_preview(&selected.handle);

    // Two defences, and the file cannot come back describing another run
    // through either of them. Where the file could not be replaced at all the
    // preview is simply correct; where it could, the result is refused.
    let replaced = fs::read(&file.path).expect("read back the source") != b"<mzML/>";
    if replaced {
        let error = outcome.expect_err("results from two generations are never combined");
        assert_eq!(error.kind, "source_changed_during_preview");
        // Reading again once the writer has finished is worth offering.
        assert!(error.retryable);
    } else {
        outcome.expect("an unreplaceable source previews normally");
    }
}

#[test]
fn backend_labels_are_redacted_and_bounded_like_any_other_backend_text() {
    use super::backend::backend_label;

    // Both labels come from the installed tool's own help output.
    assert_eq!(
        backend_label("3.0.26204 built from D:/build/private/pwiz"),
        "3.0.26204 built from <path>"
    );
    let long = backend_label(&"9".repeat(4_000));
    assert!(long.chars().count() <= 121, "{}", long.chars().count());
    assert_eq!(backend_label("3.0.26204"), "3.0.26204");
}

#[test]
fn only_one_backend_operation_runs_at_a_time() {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// Records the highest number of operations ever in flight together.
    struct ConcurrencyProbe {
        inner: FakeProvider,
        active: AtomicUsize,
        peak: Arc<AtomicUsize>,
    }

    impl PreviewProvider for ConcurrencyProbe {
        fn use_installation(&self, _home: Option<PathBuf>) {}

        fn availability(&self) -> (BackendAvailabilityDto, Option<InstallationIdentity>) {
            self.inner.availability()
        }

        fn run(
            &self,
            source: &Path,
            operation: &PreviewOperation,
        ) -> Result<OperationAttempt, PreviewErrorDto> {
            let active = self.active.fetch_add(1, Ordering::SeqCst) + 1;
            self.peak.fetch_max(active, Ordering::SeqCst);
            std::thread::sleep(std::time::Duration::from_millis(20));
            let result = self.inner.run(source, operation);
            self.active.fetch_sub(1, Ordering::SeqCst);
            result
        }
    }

    let file = TestFile::new("concurrency");
    let peak = Arc::new(AtomicUsize::new(0));
    let mut responses = Vec::new();
    for _ in 0..4 {
        responses.push(Response::File(selected_spectrum_output(
            0,
            &[(445.12, 9000.0)],
        )));
    }
    let service = Arc::new(PreviewService::new(Box::new(ConcurrencyProbe {
        inner: FakeProvider::available(responses),
        active: AtomicUsize::new(0),
        peak: Arc::clone(&peak),
    })));
    let selected = service.accept_file(&file.path).expect("accepted");

    let workers: Vec<_> = (0..4)
        .map(|_| {
            let service = Arc::clone(&service);
            let handle = selected.handle.clone();
            std::thread::spawn(move || service.load_spectrum(&handle, 0))
        })
        .collect();
    for worker in workers {
        let _ = worker.join().expect("worker finished");
    }

    // Four selections, never two processes at once.
    assert_eq!(peak.load(Ordering::SeqCst), 1);
}

#[test]
fn opening_another_file_supersedes_a_spectrum_still_waiting_for_its_turn() {
    use std::sync::Arc;
    use std::sync::mpsc;

    let file = TestFile::new("supersede");
    let (started, observe_start) = mpsc::channel();
    let (release, wait_for_release) = mpsc::channel();
    let service = Arc::new(PreviewService::new(Box::new(BlockFirstProvider {
        inner: FakeProvider::available(vec![
            Response::File(selected_spectrum_output(0, &[(445.12, 9000.0)])),
            Response::File(selected_spectrum_output(1, &[(333.33, 5000.0)])),
        ]),
        started,
        release: Mutex::new(Some(wait_for_release)),
    })));
    let first = service.accept_file(&file.path).expect("accepted");

    // One request occupies the only process slot.
    let running = {
        let service = Arc::clone(&service);
        let handle = first.handle.clone();
        std::thread::spawn(move || service.load_spectrum(&handle, 0))
    };
    observe_start
        .recv_timeout(std::time::Duration::from_secs(10))
        .expect("the first request reached the provider");

    // A second one queues behind it.
    let waiting = {
        let service = Arc::clone(&service);
        let handle = first.handle.clone();
        std::thread::spawn(move || service.load_spectrum(&handle, 1))
    };
    // Waited for rather than slept on. Replacing the selection before this
    // request has claimed its turn answers `unknown_file_handle`, which is a
    // different thing from the supersession this test is about.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while service.requests_made(&first.handle) < 2 {
        assert!(
            std::time::Instant::now() < deadline,
            "the queued request never claimed its turn"
        );
        std::thread::yield_now();
    }

    // The user opens another file while it is still waiting.
    service.accept_file(&file.path).expect("accepted again");
    release.send(()).expect("the provider is still waiting");

    assert!(
        running
            .join()
            .expect("the running request finished")
            .is_ok()
    );
    let superseded = waiting
        .join()
        .expect("the waiting request finished")
        .expect_err("a request for a file the user has left never starts");
    assert_eq!(superseded.kind, "selection_superseded");
}

#[test]
fn metadata_printed_before_the_first_section_is_shown_rather_than_counted() {
    let file = TestFile::new("leading");
    let service = PreviewService::new(Box::new(FakeProvider::available(open_responses())));
    let selected = service.accept_file(&file.path).expect("accepted");

    let preview = service
        .open_preview(&selected.handle)
        .expect("the preview loads");

    let leading = preview
        .metadata
        .sections
        .first()
        .expect("a section for the lines before the first one");
    assert_eq!(leading.id, "leading");
    assert_eq!(leading.total_entry_count, 1);
    // Shown, and redacted like every other metadata line.
    assert!(
        !leading.entries[0].contains("MSData"),
        "{}",
        leading.entries[0]
    );
    assert!(
        leading.entries[0].contains("<path>"),
        "{}",
        leading.entries[0]
    );
}

#[test]
fn an_acquisition_larger_than_one_read_is_refused_whole_rather_than_shown_in_part() {
    // No test covered this user-visible state. A run whose spectrum table
    // exceeds `MAX_PREVIEW_TEXT_BYTES` is refused outright: the parser needs
    // the whole output, and a list cut mid-file would read as a shorter
    // acquisition than the one on disk.
    let file = TestFile::new("oversized");
    let responses = vec![
        Response::File(METADATA_OUTPUT.to_owned()),
        Response::Stdout(run_summary_output()),
        // Taken from the limit rather than restated, so raising the limit moves
        // the case instead of leaving it testing a number nothing enforces.
        Response::OversizedFile {
            captured_bytes: mscanvas_proteowizard::MAX_PREVIEW_TEXT_BYTES,
            total_bytes: mscanvas_proteowizard::MAX_PREVIEW_TEXT_BYTES + 4 * 1024 * 1024,
        },
    ];
    let service = PreviewService::new(Box::new(FakeProvider::available(responses)));
    let selected = service.accept_file(&file.path).expect("accepted");

    let error = service
        .open_preview(&selected.handle)
        .expect_err("a partial spectrum list is never presented as a whole one");

    assert_eq!(error.kind, "incomplete_parser_input");
    // Not retryable: reading again produces the same output. The limit is a
    // named limit of this version, not a transient condition.
    assert!(!error.retryable);
    // The detail states both sizes, so the reader can see how far over it is.
    let detail = error.detail.expect("the sizes are part of the message");
    assert!(detail.contains("8388608"), "{detail}");
    assert!(detail.contains("12582912"), "{detail}");

    // Metadata and the run summary parsed. Today they are discarded with the
    // batch: the whole open fails and the user is told nothing about the run.
    assert!(
        service.open_preview(&selected.handle).is_err(),
        "the provider is exhausted, so this documents that nothing was retained"
    );
}

#[test]
fn a_spectrum_that_measures_something_else_than_its_table_row_is_refused() {
    let file = TestFile::new("facts-conflict");
    // The table says row 0 peaks at m/z 445.12; the binary formatter says 512.
    let conflicting_table = SPECTRUM_TABLE_OUTPUT.replace("	445.12	9000	", "	512.25	9000	");
    let responses = vec![
        Response::File(METADATA_OUTPUT.to_owned()),
        Response::Stdout(run_summary_output()),
        Response::File(conflicting_table),
        Response::File(selected_spectrum_output(0, &[(445.12, 9000.0)])),
    ];
    let service = PreviewService::new(Box::new(FakeProvider::available(responses)));
    let selected = service.accept_file(&file.path).expect("accepted");
    service
        .open_preview(&selected.handle)
        .expect("the preview loads");

    let error = service
        .load_spectrum(&selected.handle, 0)
        .expect_err("a row and its detail panel never report different measurements");
    assert_eq!(error.kind, "spectrum_facts_conflict");
}

#[test]
fn rounded_table_values_are_not_treated_as_a_contradiction() {
    let file = TestFile::new("facts-rounding");
    // The table rounds; the binary formatter does not. That is not a conflict.
    let responses = vec![
        Response::File(METADATA_OUTPUT.to_owned()),
        Response::Stdout(run_summary_output()),
        Response::File(SPECTRUM_TABLE_OUTPUT.to_owned()),
        Response::File(selected_spectrum_output(0, &[(445.1237, 9000.4)])),
    ];
    let service = PreviewService::new(Box::new(FakeProvider::available(responses)));
    let selected = service.accept_file(&file.path).expect("accepted");
    service
        .open_preview(&selected.handle)
        .expect("the preview loads");

    assert!(service.load_spectrum(&selected.handle, 0).is_ok());
}

#[test]
fn a_spectrum_that_contradicts_its_table_row_is_refused() {
    let file = TestFile::new("identity-conflict");
    // The table says index 0 is scan 4242; the binary formatter says scan 19.
    let conflicting_table = SPECTRUM_TABLE_OUTPUT.replace("0	19	1	", "0	4242	1	");
    let responses = vec![
        Response::File(METADATA_OUTPUT.to_owned()),
        Response::Stdout(run_summary_output()),
        Response::File(conflicting_table),
        Response::File(selected_spectrum_output(0, &[(445.12, 9000.0)])),
    ];

    let service = PreviewService::new(Box::new(FakeProvider::available(responses)));
    let selected = service.accept_file(&file.path).expect("accepted");
    service
        .open_preview(&selected.handle)
        .expect("the preview loads");

    let error = service
        .load_spectrum(&selected.handle, 0)
        .expect_err("a row and its detail panel never describe different scans");
    assert_eq!(error.kind, "spectrum_identity_conflict");
}

#[test]
fn a_spectrum_is_refused_when_the_file_changed_after_it_was_opened() {
    let file = TestFile::new("regeneration");
    let mut responses = open_responses();
    responses.push(Response::File(selected_spectrum_output(
        0,
        &[(445.12, 9000.0)],
    )));
    let service = PreviewService::new(Box::new(FakeProvider::available(responses)));
    let selected = service.accept_file(&file.path).expect("accepted");
    service
        .open_preview(&selected.handle)
        .expect("the preview loads");

    fs::write(&file.path, b"<mzML> a different acquisition </mzML>").expect("rewrite the source");

    let error = service
        .load_spectrum(&selected.handle, 0)
        .expect_err("a spectrum from another generation is never shown beside stale metadata");
    assert_eq!(error.kind, "source_changed_since_preview");
}

#[test]
fn a_spectrum_identifier_is_redacted_and_bounded_like_any_other_backend_text() {
    let redactor = super::backend::reporting_redactor(Path::new(r"D:\MSData\private\sample.mzML"));

    // The opened path is removed, as it is everywhere else.
    assert!(
        !super::service::displayable_identifier(
            r"file=D:\MSData\private\sample.mzML scan=19",
            &redactor,
        )
        .contains("MSData")
    );
    // So is an unrelated path the document itself recorded, which the session
    // redactor knows nothing about.
    assert!(
        !super::service::displayable_identifier(
            "source=/home/alice/private/run.raw scan=19",
            &redactor,
        )
        .contains("/home/alice")
    );
    // And the value is bounded, because a file may put anything in a native
    // identifier and this one is rendered in every table row.
    let long = format!("scan=19 note={}", "a".repeat(4_000));
    let bounded = super::service::displayable_identifier(&long, &redactor);
    assert!(
        bounded.chars().count() <= 201,
        "{}",
        bounded.chars().count()
    );
    // An ordinary identifier passes through unchanged.
    assert_eq!(
        super::service::displayable_identifier(
            "controllerType=0 controllerNumber=1 scan=19",
            &redactor,
        ),
        "controllerType=0 controllerNumber=1 scan=19"
    );
}

#[test]
fn a_stale_handle_cannot_be_used_after_the_registry_forgets_it() {
    let file = TestFile::new("handle");
    let service = PreviewService::new(Box::new(FakeProvider::available(Vec::new())));
    service.accept_file(&file.path).expect("accepted");

    let error = service
        .open_preview("file-not-registered")
        .expect_err("an unknown handle is refused");

    assert_eq!(error.kind, "unknown_file_handle");
}

#[test]
fn only_regular_mzml_files_reach_the_provider() {
    let file = TestFile::new("validation");
    let service = PreviewService::new(Box::new(FakeProvider::available(Vec::new())));
    let wrong = file.directory.join("sample.mzXML");
    fs::write(&wrong, b"<mzXML/>").expect("write rejected fixture");

    assert_eq!(
        service.accept_file(&wrong).map(|_| ()).unwrap_err().kind,
        "unsupported_extension"
    );
    // A directory is refused for being a directory, which is more use than
    // complaining about the extension it does not have.
    assert_eq!(
        service
            .accept_file(&file.directory)
            .map(|_| ())
            .unwrap_err()
            .kind,
        "not_a_regular_file"
    );
}

#[test]
fn the_open_action_never_requests_a_chromatogram_or_tic_operation() {
    let provider = FakeProvider::available(open_responses());
    let file = TestFile::new("operations");

    let operations = super::backend::open_operations();
    provider
        .run_batch(&file.path, &operations)
        .expect("the batch runs");

    assert!(
        provider
            .requested_operations()
            .iter()
            .all(|operation| !matches!(operation, PreviewOperation::Tic { .. })),
        "this slice must never request a TIC"
    );
}

#[test]
fn a_selected_spectrum_request_uses_the_fixed_formatter_precision() {
    assert_eq!(
        super::backend::selected_spectrum_operation(7),
        PreviewOperation::SpectrumByIndex {
            index: 7,
            precision: super::backend::SELECTED_SPECTRUM_PRECISION,
        }
    );
}

#[test]
fn a_preview_outcome_is_never_constructed_outside_the_typed_interpreter() {
    // Guards the fake itself: it must build outcomes through the production
    // interpreter, so a test can never assert against a parallel parser.
    let manifest = PreviewOutputManifest::single_complete_file(METADATA_OUTPUT.as_bytes().to_vec());
    let outcome = interpret_preview(
        &PreviewOperation::Metadata,
        &completed_process(""),
        &manifest,
    )
    .expect("the fixture parses through the production interpreter");
    assert!(matches!(outcome, PreviewOutcome::Value(_)));
}

/// A provider that works whether or not a folder is chosen.
///
/// Needed to model the case where choosing a folder resolves to the very tools
/// automatic discovery was already using, which is a change of configuration
/// and no change of backend at all.
fn usable_either_way(responses: Vec<Response>) -> FakeProvider {
    let mut provider = FakeProvider::available(responses);
    provider.chosen_availability = Some(BackendAvailabilityDto {
        state: "available".to_owned(),
        origin: "chosen".to_owned(),
        installation_generation: 0,
        release: Some("3.0.26013".to_owned()),
        build_date: None,
        same_installation: true,
        failure: None,
    });
    provider
}

fn opened_preview_responses() -> Vec<Response> {
    vec![
        Response::File(METADATA_OUTPUT.to_owned()),
        Response::Stdout(run_summary_output()),
        Response::File(SPECTRUM_TABLE_OUTPUT.to_owned()),
        Response::File(selected_spectrum_output(0, &[(445.12, 9000.0)])),
    ]
}

#[test]
fn automatic_discovery_resolving_to_a_different_installation_is_a_change() {
    // Nothing was requested and nothing was configured: the installation in use
    // was removed and discovery fell back to another one. A request can never
    // show that, and only the resolved pair can.
    let provider = Box::new(FakeProvider::available(Vec::new()));
    let world = provider.clone_world();
    let service = PreviewService::new(provider);
    assert_eq!(service.inspect_backend().installation_generation, 0);

    world.resolves_to(Some(backend("elsewhere", "3.0.25000")));

    assert_eq!(service.inspect_backend().installation_generation, 1);
    // Still automatic: what changed is which backend that resolves to, which is
    // a different question from what was asked for.
    assert_eq!(service.inspect_backend().origin, "automatic");
}

#[test]
fn a_chosen_folder_that_resolves_to_the_tools_already_in_use_is_not_a_change() {
    // The configuration changed and the backend did not. Counting the request
    // would discard a perfectly good preview for a switch that switched nothing.
    let file = TestFile::new("same-tools");
    let service = PreviewService::new(Box::new(usable_either_way(opened_preview_responses())));
    let selected = service.accept_file(&file.path).expect("accepted");
    service
        .open_preview(&selected.handle)
        .expect("the file opens");
    let before = service.inspect_backend().installation_generation;

    let chosen = service.use_installation(Some(PathBuf::from(r"C:\fake\installed")));

    assert_eq!(chosen.origin, "chosen");
    // Origin is about the request; the generation is about the backend. This is
    // the case that shows they are not the same question.
    assert_eq!(chosen.installation_generation, before);
    service
        .load_spectrum(&selected.handle, 0)
        .expect("the preview is still the work of the backend still in use");
}

#[test]
fn an_old_preview_is_refused_before_a_spectrum_is_launched_for_it() {
    // Both halves matter: refused, and refused without spending a process on a
    // reading that was never going to be shown. The pre-flight asks the
    // filesystem and launches nothing, so this is the shape it catches -- the
    // tools it recorded are not the files that are there now.
    let file = TestFile::new("refused-early");
    let tools = InstalledFiles::new("refused-early");
    let provider = Box::new(FakeProvider::available(opened_preview_responses()));
    let world = provider.clone_world();
    world.resolves_to(Some(tools.identity()));
    let service = PreviewService::new(provider);
    let selected = service.accept_file(&file.path).expect("accepted");
    service
        .open_preview(&selected.handle)
        .expect("the file opens");
    let operations_after_open = world.requested_count();

    // Replaced in place: the path did not move and nothing was requested, so
    // only the file itself can show it.
    tools.replace_msaccess();

    let error = service
        .load_spectrum(&selected.handle, 0)
        .expect_err("a spectrum is not reconciled against another backend's table");

    assert_eq!(error.kind, "installation_changed_since_preview");
    assert!(!error.retryable);
    assert_eq!(
        world.requested_count(),
        operations_after_open,
        "the spectrum must be refused before its operation is run"
    );
}

#[test]
fn a_spectrum_selection_does_not_re_resolve_the_backend() {
    // The pre-flight must not cost what it saves. Resolving again would mean
    // two help probes and two executable hashes on every row a user clicks, to
    // avoid one launch in the rare case the backend changed underneath.
    let file = TestFile::new("no-extra-discovery");
    let tools = InstalledFiles::new("no-extra-discovery");
    let provider = Box::new(FakeProvider::available(opened_preview_responses()));
    let world = provider.clone_world();
    world.resolves_to(Some(tools.identity()));
    let service = PreviewService::new(provider);
    let selected = service.accept_file(&file.path).expect("accepted");
    service
        .open_preview(&selected.handle)
        .expect("the file opens");
    let looks_after_open = world.availability_count();

    service
        .load_spectrum(&selected.handle, 0)
        .expect("the spectrum is read");

    assert_eq!(
        world.availability_count(),
        looks_after_open,
        "reading a row must not resolve the backend again"
    );
}

#[test]
fn an_in_place_upgrade_advances_the_sequence_even_though_nothing_was_requested() {
    let provider = Box::new(FakeProvider::available(Vec::new()));
    let world = provider.clone_world();
    let service = PreviewService::new(provider);
    assert_eq!(service.inspect_backend().installation_generation, 0);

    // Same paths, different build. This is what an installer that upgrades in
    // place leaves behind, and it is invisible to anything comparing requests.
    world.resolves_to(Some(backend("installed", "3.0.99999")));

    assert_eq!(service.inspect_backend().installation_generation, 1);
    // And looking again at an unchanged backend is not another change.
    assert_eq!(service.inspect_backend().installation_generation, 1);
}

#[test]
fn a_backend_that_disappears_and_returns_unchanged_is_one_change_each_way() {
    let provider = Box::new(FakeProvider::available(Vec::new()));
    let world = provider.clone_world();
    let service = PreviewService::new(provider);
    let original = world.resolved_backend();
    assert_eq!(service.inspect_backend().installation_generation, 0);

    world.resolves_to(None);
    assert_eq!(service.inspect_backend().installation_generation, 1);

    world.resolves_to(original);
    assert_eq!(service.inspect_backend().installation_generation, 2);
}

#[test]
fn no_backend_identity_reaches_the_webview_through_any_transfer_object() {
    // The identity is unserialisable by construction, so what is left to check
    // is that nothing derived from it is copied into something that is.
    let file = TestFile::new("no-identity-leak");
    let service = PreviewService::new(Box::new(
        FakeProvider::available(opened_preview_responses()),
    ));
    let selected = service.accept_file(&file.path).expect("accepted");
    let preview = service
        .open_preview(&selected.handle)
        .expect("the file opens");
    let availability = service.inspect_backend();

    for rendered in [
        serde_json::to_string(&preview).expect("preview serializes"),
        serde_json::to_string(&availability).expect("availability serializes"),
        serde_json::to_string(&selected).expect("selection serializes"),
    ] {
        assert!(!rendered.contains("msconvert"), "{rendered}");
        assert!(!rendered.contains("msaccess"), "{rendered}");
        assert!(!rendered.contains(r"C:\fake"), "{rendered}");
    }
}

#[test]
fn every_spectrum_after_an_open_that_noticed_a_change_still_works() {
    // An open is a look at the backend, and one that keeps what it saw to
    // itself leaves the sequence naming the installation before it. The first
    // spectrum load would then notice, advance the sequence, and match on
    // identity -- and every load after it would be refused by a sequence check
    // for a change that had already been accounted for.
    let file = TestFile::new("open-observes");
    let provider = Box::new(FakeProvider::available(vec![
        Response::File(METADATA_OUTPUT.to_owned()),
        Response::Stdout(run_summary_output()),
        Response::File(SPECTRUM_TABLE_OUTPUT.to_owned()),
        Response::File(selected_spectrum_output(0, &[(445.12, 9000.0)])),
        Response::File(selected_spectrum_output(0, &[(445.12, 9000.0)])),
    ]));
    let world = provider.clone_world();
    let service = PreviewService::new(provider);
    let selected = service.accept_file(&file.path).expect("accepted");
    // Looked at once, so there is a previous observation to differ from.
    service.inspect_backend();

    // The machine changes with nothing looking at it, and the open is the first
    // thing to see the new backend.
    world.resolves_to(Some(backend("replacement", "3.0.26999")));
    service
        .open_preview(&selected.handle)
        .expect("the file opens against whatever is installed now");

    service
        .load_spectrum(&selected.handle, 0)
        .expect("the first spectrum comes from the backend that read the table");
    service
        .load_spectrum(&selected.handle, 0)
        .expect("and so does every one after it");
}

/// What the spectrum step is given when execution itself fails after the
/// backend was resolved -- a launch refused, a wait interrupted, output that
/// could not be captured. Retryable, because retrying is the right advice when
/// the installation has not changed.
fn retryable_launch_failure() -> Response {
    Response::Error(PreviewErrorDto::new(
        "backend_launch_failed",
        "The backend could not be started for that request.",
        true,
    ))
}

#[test]
fn a_retryable_failure_under_a_replaced_backend_is_reported_as_the_change_it_is() {
    // The pre-flight passes because the recorded tools are untouched, discovery
    // then resolves a different installation, and execution under it fails for
    // a reason that says nothing about which backend ran. Propagating that
    // error would leave the banner and the table describing the installation
    // that read them while every retry ran the new one.
    let file = TestFile::new("failure-under-replacement");
    let tools = InstalledFiles::new("failure-under-replacement");
    let provider = Box::new(FakeProvider::available(vec![
        Response::File(METADATA_OUTPUT.to_owned()),
        Response::Stdout(run_summary_output()),
        Response::File(SPECTRUM_TABLE_OUTPUT.to_owned()),
        retryable_launch_failure(),
    ]));
    let world = provider.clone_world();
    world.resolves_to(Some(tools.identity()));
    let service = PreviewService::new(provider);
    let selected = service.accept_file(&file.path).expect("accepted");
    service
        .open_preview(&selected.handle)
        .expect("the file opens under the installation it found");
    let before = service.inspect_backend().installation_generation;

    world.resolves_to(Some(backend("replacement", "3.0.26999")));

    let error = service
        .load_spectrum(&selected.handle, 0)
        .expect_err("a spectrum read by another backend is not shown beside this table");

    // The recovery the user can act on, not the launch error underneath it.
    assert_eq!(error.kind, "installation_changed_since_preview");
    assert!(!error.retryable);
    assert!(error.summary.contains("Open the file again"));
    // And the change was observed rather than lost with the failure, so the
    // banner cannot stay on the installation that is no longer running.
    assert!(service.inspect_backend().installation_generation > before);
}

#[test]
fn a_retryable_failure_under_the_same_backend_keeps_its_own_error() {
    // Nothing changed, so the operation's own failure is the truth about this
    // read -- including that retrying it is worth offering.
    let file = TestFile::new("failure-same-backend");
    let tools = InstalledFiles::new("failure-same-backend");
    let provider = Box::new(FakeProvider::available(vec![
        Response::File(METADATA_OUTPUT.to_owned()),
        Response::Stdout(run_summary_output()),
        Response::File(SPECTRUM_TABLE_OUTPUT.to_owned()),
        retryable_launch_failure(),
    ]));
    let world = provider.clone_world();
    world.resolves_to(Some(tools.identity()));
    let service = PreviewService::new(provider);
    let selected = service.accept_file(&file.path).expect("accepted");
    service
        .open_preview(&selected.handle)
        .expect("the file opens");
    let before = service.inspect_backend().installation_generation;

    let error = service
        .load_spectrum(&selected.handle, 0)
        .expect_err("the read failed");

    assert_eq!(error.kind, "backend_launch_failed");
    assert!(error.retryable);
    assert_eq!(service.inspect_backend().installation_generation, before);
}

#[test]
fn an_open_stops_at_its_first_failed_operation() {
    // Every operation in the batch is a ProteoWizard process, and the failures
    // that stop the first are the ones that would stop the rest. Running them
    // anyway spends two more launches to learn the same thing and delays the
    // error the user is waiting for.
    let file = TestFile::new("stop-at-first-failure");
    let provider = Box::new(FakeProvider::available(vec![
        retryable_launch_failure(),
        Response::Stdout(run_summary_output()),
        Response::File(SPECTRUM_TABLE_OUTPUT.to_owned()),
    ]));
    let world = provider.clone_world();
    let service = PreviewService::new(provider);
    let selected = service.accept_file(&file.path).expect("accepted");

    let error = service
        .open_preview(&selected.handle)
        .expect_err("the first operation failed");

    // The failure the user is waiting for, not one invented for a short batch.
    assert_eq!(error.kind, "backend_launch_failed");
    assert!(error.retryable);
    assert_eq!(
        world.requested_count(),
        1,
        "nothing after the failed operation should have been run"
    );
}

#[test]
fn choosing_a_file_keeps_the_session_holding_exactly_one_dataset() {
    // The workspace can hold several datasets. The picker deliberately does not
    // use that. A file the user cannot see, curate or remove is a capability
    // they never asked for and have no way to withdraw, so the roster interface
    // is what will add a second one -- not this entry point.
    let file = TestFile::new("one-at-a-time");
    let other = file.sibling("other.mzML");
    let service = PreviewService::new(Box::new(FakeProvider::available(Vec::new())));

    let first = service.accept_file(&file.path).expect("accepted");
    let second = service.accept_file(&other).expect("accepted again");

    assert_ne!(first.handle, second.handle);
    assert_eq!(service.dataset_count(), 1);
    assert_eq!(
        service
            .open_preview(&first.handle)
            .expect_err("the previous handle is revoked")
            .kind,
        "unknown_file_handle"
    );
}

#[test]
fn managing_the_workspace_never_reaches_the_backend() {
    /// Fails the test outright if anything registry-shaped tries to start a
    /// process or probe an installation.
    struct NoProcess;

    impl PreviewProvider for NoProcess {
        fn use_installation(&self, _home: Option<PathBuf>) {
            panic!("holding datasets must not reconfigure the backend");
        }

        fn availability(&self) -> (BackendAvailabilityDto, Option<InstallationIdentity>) {
            panic!("holding datasets must not probe the backend");
        }

        fn run(
            &self,
            _source: &Path,
            _operation: &PreviewOperation,
        ) -> Result<OperationAttempt, PreviewErrorDto> {
            panic!("holding datasets must not launch a process");
        }
    }

    let file = TestFile::new("no-process");
    let other = file.sibling("other.mzML");
    let service = PreviewService::new(Box::new(NoProcess));

    service.accept_file(&file.path).expect("accepted");
    service.accept_file(&other).expect("accepted again");
    service.add_dataset(&file.path).expect("added alongside");
    assert_eq!(service.dataset_count(), 2);

    // And emptying a workspace that holds more than one is still no process.
    // This is also the only place the multi-dataset path through `clear` runs:
    // the picker reaches it with one dataset and never more.
    service.accept_file(&other).expect("accepted a third time");

    assert_eq!(service.dataset_count(), 1);
}

/// Two names for one file. Windows-only because the identity this decides on is
/// the Windows file ID, and a hard link is how two names come to share one.
#[cfg(windows)]
#[test]
fn adding_one_file_under_two_names_is_one_dataset() {
    let file = TestFile::new("duplicate");
    let link = file.directory.join("another-name.mzML");
    fs::hard_link(&file.path, &link).expect(
        "the test volume must support hard links; without one this cannot establish that two \
         names for one file are one dataset",
    );
    let service = PreviewService::new(Box::new(FakeProvider::available(Vec::new())));
    let first = service.add_dataset(&file.path).expect("added");

    let again = service.add_dataset(&link).expect("added again");

    assert_eq!(again.handle, first.handle, "one file, one dataset");
    assert_eq!(service.dataset_count(), 1);
    // Described as it was registered. The second name is another way to reach
    // the same acquisition, not a rename of the row the user already has.
    assert_eq!(again.file_name, "sample.mzML");
}

#[test]
fn two_datasets_each_keep_their_own_preview_facts() {
    let file = TestFile::new("per-dataset");
    let other = file.sibling("other.mzML");
    // Two different acquisitions. The rows a spectrum is reconciled against
    // agree with one and contradict the other, so a shared or swapped record
    // fails rather than passing quietly.
    let responses = vec![
        Response::File(METADATA_OUTPUT.to_owned()),
        Response::Stdout(run_summary_output()),
        Response::File(SPECTRUM_TABLE_OUTPUT.to_owned()),
        Response::File(METADATA_OUTPUT.to_owned()),
        Response::Stdout(run_summary_output()),
        Response::File(OTHER_SPECTRUM_TABLE_OUTPUT.to_owned()),
        Response::File(selected_spectrum_output(0, &[(445.12, 9000.0)])),
        Response::File(other_selected_spectrum_output(0, &[(612.45, 2200.0)])),
    ];
    let service = PreviewService::new(Box::new(FakeProvider::available(responses)));
    let first = service.add_dataset(&file.path).expect("added");
    let second = service.add_dataset(&other).expect("added");

    service
        .open_preview(&first.handle)
        .expect("the first preview loads");
    let second_preview = service
        .open_preview(&second.handle)
        .expect("the second preview loads");

    // Neither open took the other's facts with it, which one shared record of
    // "the preview" would have done.
    assert!(service.holds_preview_state(&first.handle));
    assert!(service.holds_preview_state(&second.handle));
    assert_eq!(
        second_preview.spectrum_table.rows.len(),
        2,
        "the second dataset was read as itself"
    );
    for (handle, scan) in [(&first.handle, 19_u64), (&second.handle, 807)] {
        let Ok(SelectedSpectrumOutcomeDto::Spectrum { spectrum }) =
            service.load_spectrum(handle, 0)
        else {
            panic!("each dataset reconciles a spectrum against its own rows");
        };
        assert_eq!(
            spectrum.scan_number,
            Some(scan),
            "and against its own rows rather than the other dataset's"
        );
    }
}

#[test]
fn work_on_one_dataset_never_supersedes_work_on_another() {
    use std::sync::Arc;
    use std::sync::mpsc;

    let file = TestFile::new("cross-dataset");
    let other = file.sibling("other.mzML");
    let (started, observe_start) = mpsc::channel();
    let (release, wait_for_release) = mpsc::channel();
    let service = Arc::new(PreviewService::new(Box::new(BlockFirstProvider {
        inner: FakeProvider::available(vec![
            Response::File(selected_spectrum_output(0, &[(445.12, 9000.0)])),
            Response::File(selected_spectrum_output(0, &[(445.12, 9000.0)])),
            Response::File(selected_spectrum_output(0, &[(445.12, 9000.0)])),
        ]),
        started,
        release: Mutex::new(Some(wait_for_release)),
    })));
    let first = service.add_dataset(&file.path).expect("added");
    let second = service.add_dataset(&other).expect("added");
    assert_eq!(service.dataset_count(), 2);

    let spectrum = |handle: &str, index: u64| {
        let service = Arc::clone(&service);
        let handle = handle.to_owned();
        std::thread::spawn(move || service.load_spectrum(&handle, index))
    };
    // Waits for a request to have been claimed rather than guessing at it with
    // a sleep. The order these two queue in is the whole point of the test: a
    // single session-wide ticket only cancels the second if the third claimed
    // its number afterwards.
    let claimed = |handle: &str, requests: u64| {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while service.requests_made(handle) < requests {
            assert!(
                std::time::Instant::now() < deadline,
                "a spawned request never claimed its turn"
            );
            std::thread::yield_now();
        }
    };
    // One request occupies the only process slot.
    let running = spectrum(&first.handle, 0);
    observe_start
        .recv_timeout(std::time::Duration::from_secs(10))
        .expect("the first request reached the provider");
    // The same dataset is asked again and queues behind it. This is the request
    // the user is now waiting for.
    let waiting = spectrum(&first.handle, 0);
    claimed(&first.handle, 2);
    // Then, and only then, a request in the other dataset arrives.
    let elsewhere = spectrum(&second.handle, 0);
    claimed(&second.handle, 1);
    // Exactly one, which is what makes waiting for it an ordering and not a
    // guess. A session-wide counter would already be past two here, so this
    // request would be released before it had claimed anything and the test
    // would be watching a race instead of a rule.
    assert_eq!(
        service.requests_made(&second.handle),
        1,
        "a dataset counts its own requests and nobody else's"
    );
    release.send(()).expect("the provider is still waiting");

    assert!(
        running
            .join()
            .expect("the running request finished")
            .is_ok()
    );
    // The one this test exists for. Under a single session-wide ticket, the
    // other dataset's arrival would have cancelled this one, throwing away a
    // read for a row the user is still looking at.
    waiting
        .join()
        .expect("the waiting request finished")
        .expect("a request nobody has moved on from still runs");
    elsewhere
        .join()
        .expect("the other dataset's request finished")
        .expect("a request in another dataset runs on its own turn");
}

#[test]
fn a_preview_that_finishes_after_its_dataset_is_gone_records_nothing() {
    use std::sync::Arc;
    use std::sync::mpsc;

    let file = TestFile::new("late-reply");
    let other = file.sibling("other.mzML");
    let (started, observe_start) = mpsc::channel();
    let (release, wait_for_release) = mpsc::channel();
    let service = Arc::new(PreviewService::new(Box::new(BlockFirstProvider {
        inner: FakeProvider::available(open_responses()),
        started,
        release: Mutex::new(Some(wait_for_release)),
    })));
    let first = service.accept_file(&file.path).expect("accepted");

    let opening = {
        let service = Arc::clone(&service);
        let handle = first.handle.clone();
        std::thread::spawn(move || service.open_preview(&handle))
    };
    observe_start
        .recv_timeout(std::time::Duration::from_secs(10))
        .expect("the open reached the provider");
    // The user picks another file while the read is still running. That this
    // returns at all is the proof that the workspace stays answerable while a
    // backend process holds the gate.
    let second = service.accept_file(&other).expect("accepted again");
    release.send(()).expect("the provider is still waiting");

    // The work had already started, so it is not cancelled and its caller is
    // answered.
    opening
        .join()
        .expect("the open finished")
        .expect("a read that had already started still completes");
    // What it must not do is record anything. Preview facts under a dataset the
    // session has let go of would sit under an identifier nothing can reach and
    // nothing will ever clear.
    assert!(!service.holds_preview_state(&first.handle));
    assert!(
        !service.holds_preview_state(&second.handle),
        "and they must not land on the dataset that replaced it"
    );
    assert_eq!(service.dataset_count(), 1);
}

#[test]
fn changing_the_installation_rereads_nothing() {
    // A workspace of twenty datasets must not become twenty queued backend jobs
    // because the user pointed at another ProteoWizard. What a change
    // invalidates is backend-derived and is refused when the user next asks for
    // something; rereading one is a thing they ask for, one dataset at a time.
    let file = TestFile::new("reread");
    let other = file.sibling("other.mzML");
    let provider = Box::new(FakeProvider::available(open_responses()));
    let world = provider.clone_world();
    let service = PreviewService::new(provider);
    let first = service.accept_file(&file.path).expect("accepted");
    service
        .open_preview(&first.handle)
        .expect("the preview loads");
    let second = service.add_dataset(&other).expect("added");
    let before = world.requested_count();

    service.use_installation(Some(file.directory.clone()));

    assert_eq!(
        world.requested_count(),
        before,
        "changing the installation runs no preview operation"
    );
    // The roster and everything derived from the source are left alone. The
    // recorded preview is now stale against the installation in use, which the
    // checks around a spectrum are what catch.
    assert_eq!(service.dataset_count(), 2);
    assert!(service.holds_preview_state(&first.handle));
    assert!(!service.holds_preview_state(&second.handle));
}

#[test]
fn a_batch_that_answers_the_wrong_question_records_nothing() {
    /// Answers every operation of the batch with the first one's.
    ///
    /// The provider contract does not promise that the i-th attempt answers the
    /// i-th operation. A batch of the right length that is nonetheless short of
    /// a required result is the state the open action has to refuse before it
    /// records anything, and this is what produces it.
    struct AlwaysTheFirstQuestion(FakeProvider);

    impl PreviewProvider for AlwaysTheFirstQuestion {
        fn use_installation(&self, home: Option<PathBuf>) {
            self.0.use_installation(home);
        }

        fn availability(&self) -> (BackendAvailabilityDto, Option<InstallationIdentity>) {
            self.0.availability()
        }

        fn run(
            &self,
            source: &Path,
            operation: &PreviewOperation,
        ) -> Result<OperationAttempt, PreviewErrorDto> {
            self.0.run(source, operation)
        }

        fn run_batch(
            &self,
            source: &Path,
            operations: &[PreviewOperation],
        ) -> Result<Vec<OperationAttempt>, PreviewErrorDto> {
            let first = operations.first().expect("the open batch is not empty");
            operations
                .iter()
                .map(|_| self.0.run(source, first))
                .collect()
        }
    }

    let file = TestFile::new("wrong-answers");
    let service = PreviewService::new(Box::new(AlwaysTheFirstQuestion(FakeProvider::available(
        vec![
            Response::File(METADATA_OUTPUT.to_owned()),
            Response::File(METADATA_OUTPUT.to_owned()),
            Response::File(METADATA_OUTPUT.to_owned()),
        ],
    ))));
    let selected = service.accept_file(&file.path).expect("accepted");

    let error = service
        .open_preview(&selected.handle)
        .expect_err("a batch short of a required result is refused");

    assert_eq!(error.kind, "preview_result_missing");
    // The refusal is the whole of it. A dataset owning preview facts the user
    // was never shown would put rows behind a later spectrum's reconciliation
    // that no preview on screen ever came from.
    assert!(
        !service.holds_preview_state(&selected.handle),
        "a refused open records nothing"
    );
}

#[test]
fn replacing_the_selection_drops_what_the_session_derived_from_it() {
    // Revoking a dataset has to reach more than its row. Its request epoch and
    // its preview facts are what a late reply and a waiting request find, and a
    // revocation that left them would leave both answering for a dataset the
    // session no longer has.
    let file = TestFile::new("revoke-derived");
    let other = file.sibling("other.mzML");
    let mut responses = open_responses();
    responses.push(Response::File(selected_spectrum_output(
        0,
        &[(445.12, 9000.0)],
    )));
    let service = PreviewService::new(Box::new(FakeProvider::available(responses)));
    let first = service.accept_file(&file.path).expect("accepted");
    service
        .open_preview(&first.handle)
        .expect("the preview loads");
    service
        .load_spectrum(&first.handle, 0)
        .expect("the spectrum loads");
    assert!(service.holds_preview_state(&first.handle));
    assert_eq!(service.requests_made(&first.handle), 1);

    service.accept_file(&other).expect("accepted again");

    assert!(
        !service.holds_preview_state(&first.handle),
        "the preview facts go with the dataset"
    );
    assert_eq!(
        service.requests_made(&first.handle),
        0,
        "and so does the count of requests made against it"
    );
    assert_eq!(service.dataset_count(), 1);
}

#[test]
fn nothing_the_session_holds_prints_a_path() {
    // The registry types are opaque one by one; this is the structure that
    // actually holds them, and the one a `{:?}` in a log or a panic message
    // would reach. It carries a dataset's preview facts too -- the source
    // generation, the installation that read it and every table row -- so a
    // field added to any of those would show up here.
    let file = TestFile::new("opaque-session");
    let service = PreviewService::new(Box::new(FakeProvider::available(vec![
        Response::File(METADATA_OUTPUT.to_owned()),
        Response::Stdout(run_summary_output()),
        // A native spectrum identifier shaped like a path, which is a thing an
        // acquisition is free to contain. The rows are kept raw for
        // reconciliation, so this is the one value in the session that carries
        // a path and is never redacted.
        Response::File(PATH_SHAPED_SPECTRUM_TABLE_OUTPUT.to_owned()),
    ])));
    let selected = service.accept_file(&file.path).expect("accepted");
    service
        .open_preview(&selected.handle)
        .expect("the preview loads");

    let rendered = service.debug_workspace();

    for secret in [
        file.path.to_string_lossy().as_ref(),
        file.directory.to_string_lossy().as_ref(),
        "sample.mzML",
        "MSData",
        // The installation the preview was read by, which the session records
        // beside every dataset's preview facts.
        r"C:\fake",
        MSACCESS,
        // And the native identifier of a row.
        "private-run.raw",
    ] {
        assert!(
            !rendered.contains(secret),
            "the session must not print what it holds, and it printed {secret}"
        );
    }
    assert!(rendered.contains("<registry of 1 dataset>"));
    assert!(rendered.contains("<opaque-file-identity>"));
}
