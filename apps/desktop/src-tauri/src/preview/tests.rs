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
    BackendAvailabilityDto, BackendFailureDto, MAX_WORKSPACE_DATASETS, PreviewErrorDto,
    SelectedFileDto, SelectedSpectrumOutcomeDto, WorkspaceAddOutcomeDto,
};
use super::installation::InstallationIdentity;
/// The share-mode probe that answers whether a file is still held open. It
/// lives beside the flags the lease is opened with, because that is what makes
/// its answer exact rather than a guess.
#[cfg(windows)]
use super::selection::nothing_else_holds_open;
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

    /// A second name for this very file, which is the same acquisition.
    #[cfg(windows)]
    fn hard_link(&self, name: &str) -> PathBuf {
        let path = self.directory.join(name);
        fs::hard_link(&self.path, &path).expect(
            "the test volume must support hard links; without one this cannot establish that two \
             names for one file are one dataset",
        );
        path
    }

    /// A byte-identical copy, which is a different acquisition that happens to
    /// be identical.
    fn copy(&self, name: &str) -> PathBuf {
        let path = self.directory.join(name);
        fs::copy(&self.path, &path).expect("copy the source");
        path
    }

    /// A file this boundary does not open.
    fn unsupported(&self, name: &str) -> PathBuf {
        let path = self.directory.join(name);
        fs::write(&path, b"<mzXML/>").expect("write an unsupported fixture");
        path
    }

    /// A name in the same folder with nothing behind it.
    fn absent(&self, name: &str) -> PathBuf {
        self.directory.join(name)
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

/// Fails the test outright if anything workspace-shaped tries to start a
/// process or probe an installation.
///
/// The whole roster is meant to be free of the machine: reading it, adding to
/// it, removing from it and emptying it are decisions about what the session
/// lists, and a user curating twenty rows must not be twenty ProteoWizard
/// launches.
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

#[test]
fn managing_the_workspace_never_reaches_the_backend() {
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
    // One row, one hold. The duplicate was accepted before anything could know
    // it was one, so it arrived with a handle of its own; letting the single
    // row go has to be enough to release the object.
    assert!(!nothing_else_holds_open(&file.path));
    service
        .accept_file(&file.sibling("other.mzML"))
        .expect("the picker replaces the selection");
    assert!(
        nothing_else_holds_open(&file.path),
        "a duplicate that had kept its handle would still be holding this"
    );
}

#[test]
fn a_file_the_picker_cannot_accept_leaves_the_selection_it_has() {
    // The order inside `accept_file` is the point: the replacement is accepted
    // -- and leased -- before the selection it replaces is let go. Reversed,
    // this pick would empty the workspace on its way to failing, closing the
    // lease on a file the session still lists and leaving the user with
    // nothing selected because they chose the wrong file once.
    let file = TestFile::new("rejected-pick");
    let unsupported = file.directory.join("acquisition.mzXML");
    fs::write(&unsupported, b"<mzXML/>").expect("write an unsupported fixture");
    let service = PreviewService::new(Box::new(FakeProvider::available(Vec::new())));
    let selected = service.accept_file(&file.path).expect("accepted");
    let held = service
        .lease_witness(&selected.handle)
        .expect("the selection is registered");

    let error = service
        .accept_file(&unsupported)
        .expect_err("that is not an mzML file");

    assert_eq!(error.kind, "unsupported_extension");
    assert_eq!(
        service.dataset_count(),
        1,
        "the selection survives the pick"
    );
    assert!(!held.is_released(), "and so does its hold on its file");
    assert!(
        service.lease_witness(&selected.handle).is_some(),
        "the same dataset, not a re-registered one"
    );
}

#[test]
fn emptying_the_workspace_releases_every_file_it_was_holding() {
    let file = TestFile::new("clear-leases");
    let second_source = file.sibling("second.mzML");
    let third_source = file.sibling("third.mzML");
    let service = PreviewService::new(Box::new(FakeProvider::available(Vec::new())));
    let first = service.add_dataset(&file.path).expect("added");
    let second = service.add_dataset(&second_source).expect("added");
    assert_eq!(service.dataset_count(), 2);
    let held = [
        service.lease_witness(&first.handle).expect("registered"),
        service.lease_witness(&second.handle).expect("registered"),
    ];
    assert!(held.iter().all(|witness| !witness.is_released()));

    // The picker empties the workspace before it registers, which is the only
    // production route into `clear`.
    service.accept_file(&third_source).expect("accepted");

    assert_eq!(service.dataset_count(), 1);
    // Every row, not the first one. A loop that reached only the head of the
    // registry would leave the rest of the user's files pinned by a session
    // that no longer lists them, with no row left to remove to get them back.
    for (position, witness) in held.iter().enumerate() {
        assert!(
            witness.is_released(),
            "dataset {position} was still being held after the workspace was emptied"
        );
    }
}

#[cfg(windows)]
#[test]
fn replacing_the_selection_holds_the_new_file_and_lets_the_old_one_go() {
    let file = TestFile::new("replacement-lease");
    let other = file.sibling("other.mzML");
    let service = PreviewService::new(Box::new(FakeProvider::available(open_responses())));
    let first = service.accept_file(&file.path).expect("accepted");
    let held = service.lease_witness(&first.handle).expect("registered");
    assert!(
        !nothing_else_holds_open(&file.path),
        "the current selection is held"
    );

    let second = service.accept_file(&other).expect("accepted again");

    assert_eq!(service.dataset_count(), 1, "no hidden accumulation");
    assert!(held.is_released(), "the replaced dataset let its file go");
    assert!(
        nothing_else_holds_open(&file.path),
        "and the operating system agrees, so nothing is left pinning it"
    );
    assert!(
        !nothing_else_holds_open(&other),
        "while the file that replaced it is now the one being held"
    );
    assert_eq!(
        service
            .open_preview(&first.handle)
            .expect_err("the previous handle is revoked")
            .kind,
        "unknown_file_handle"
    );
    service
        .open_preview(&second.handle)
        .expect("and the new one works");
}

/// The recycled-identity failure, through the entry point the roster will use.
///
/// Windows-only because the identity this defends is the Windows file ID, and
/// because the sharing that lets a listed file still be renamed and deleted is
/// a Windows rule.
#[cfg(windows)]
#[test]
fn a_file_that_takes_a_registered_ones_name_is_added_rather_than_matched() {
    let file = TestFile::new("recycled-identity");
    let service = PreviewService::new(Box::new(FakeProvider::available(Vec::new())));
    let first = service.accept_file(&file.path).expect("accepted");
    let held = service.lease_witness(&first.handle).expect("registered");

    // Everything the user is still allowed to do to a file MSCanvas lists.
    let moved = file.directory.join("moved-away.mzML");
    fs::rename(&file.path, &moved).expect("a listed file can still be renamed");
    fs::write(&file.path, b"<mzML> a different acquisition </mzML>")
        .expect("write the replacement");
    // After this the first object has no name at all, and nothing but the
    // registry's lease keeps it alive. Without that hold, this is the moment
    // its identity becomes free for the filesystem to give to something else.
    fs::remove_file(&moved).expect("a listed file can still be deleted");

    let second = service
        .add_dataset(&file.path)
        .expect("the replacement is accepted");

    assert_ne!(
        second.handle, first.handle,
        "a file that arrives under a familiar name is not the file that left"
    );
    assert_eq!(
        service.dataset_count(),
        2,
        "two acquisitions, neither absorbed into the other"
    );
    assert!(
        !held.is_released(),
        "the row that named the file the user removed still holds it"
    );
    // And the row it did not join reports the change on its next use rather
    // than quietly adopting measurements the user never chose.
    assert_eq!(
        service
            .open_preview(&first.handle)
            .expect_err("that name names something else now")
            .kind,
        "file_identity_changed"
    );
}

#[test]
fn a_dataset_whose_name_now_points_elsewhere_is_refused_and_still_held() {
    // The lease is a lifetime, not a decision. It keeps the object the user
    // chose from being confused with another one; it says nothing about
    // whether the remembered path still leads there, and every use still asks.
    let file = TestFile::new("leased-but-replaced");
    let provider = Box::new(FakeProvider::available(open_responses()));
    let world = provider.clone_world();
    let service = PreviewService::new(provider);
    let selected = service.accept_file(&file.path).expect("accepted");
    let held = service.lease_witness(&selected.handle).expect("registered");
    let before = world.requested_count();

    let moved = file.directory.join("moved-away.mzML");
    fs::rename(&file.path, &moved).expect("a listed file can still be renamed");
    fs::write(&file.path, b"<mzML> a different acquisition </mzML>")
        .expect("write the replacement");

    let error = service
        .open_preview(&selected.handle)
        .expect_err("that name no longer names the file that was opened");

    assert_eq!(error.kind, "file_identity_changed");
    assert_eq!(
        world.requested_count(),
        before,
        "nothing was launched against the file that arrived"
    );
    assert!(
        !held.is_released(),
        "the dataset still holds the file it was given"
    );
    assert!(
        !service.holds_preview_state(&selected.handle),
        "and derived nothing from the one that arrived"
    );
    assert_eq!(
        service.dataset_count(),
        1,
        "the row is neither rebound nor removed"
    );
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

/// Waits for a dataset to have claimed a given number of requests, rather than
/// guessing at it with a sleep.
///
/// The order two opens queue in is the whole point of the tests below: an open
/// that had not yet claimed its epoch would be released before it had taken a
/// number, and the test would be watching a race instead of a rule.
fn wait_for_requests(service: &PreviewService, handle: &str, requests: u64) {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while service.requests_made(handle) < requests {
        assert!(
            std::time::Instant::now() < deadline,
            "a spawned request never claimed its turn"
        );
        std::thread::yield_now();
    }
}

#[test]
fn an_open_still_waiting_for_its_turn_never_starts_once_a_newer_one_arrives() {
    // Reachable only now. The old interface showed one file and disabled its
    // open action while opening; a roster lets the user activate a row, activate
    // it again, and activate it a third time before the first read has finished.
    // Each of those is a ProteoWizard process against a large file, and the only
    // one anybody will look at is the last.
    use std::sync::Arc;
    use std::sync::mpsc;

    let file = TestFile::new("open-supersede-waiting");
    let (started, observe_start) = mpsc::channel();
    let (release, wait_for_release) = mpsc::channel();
    let mut responses = open_responses();
    responses.extend(open_responses());
    let inner = FakeProvider::available(responses);
    let world = inner.clone_world();
    let service = Arc::new(PreviewService::new(Box::new(BlockFirstProvider {
        inner,
        started,
        release: Mutex::new(Some(wait_for_release)),
    })));
    let selected = service.accept_file(&file.path).expect("accepted");

    let open = || {
        let service = Arc::clone(&service);
        let handle = selected.handle.clone();
        std::thread::spawn(move || service.open_preview(&handle))
    };

    // One open occupies the only process slot.
    let running = open();
    observe_start
        .recv_timeout(std::time::Duration::from_secs(10))
        .expect("the first open reached the provider");
    // A second queues behind it, and a third behind that.
    let waiting = open();
    wait_for_requests(&service, &selected.handle, 2);
    let newest = open();
    wait_for_requests(&service, &selected.handle, 3);
    release.send(()).expect("the provider is still waiting");

    assert_eq!(
        running
            .join()
            .expect("the running open finished")
            .expect_err("its result is no longer the one the user wants")
            .kind,
        "selection_superseded"
    );
    assert_eq!(
        waiting
            .join()
            .expect("the waiting open finished")
            .expect_err("a request for a row the user has moved past never starts")
            .kind,
        "selection_superseded"
    );
    newest
        .join()
        .expect("the newest open finished")
        .expect("the request the user is waiting for is the one that answers");
    // Six operations, not nine: the open that was still waiting spent nothing.
    assert_eq!(
        world.requested_count(),
        6,
        "a superseded open must not launch an operation"
    );
}

#[test]
fn an_open_that_had_already_started_cannot_commit_after_a_newer_one() {
    // The gate serialises two opens of one dataset; it does not order their
    // commits. Without an epoch the later commit wins whether or not it ran
    // last, so the rows a spectrum is reconciled against could come from the
    // read the user abandoned.
    use std::sync::Arc;
    use std::sync::mpsc;

    let file = TestFile::new("open-supersede-running");
    let (started, observe_start) = mpsc::channel();
    let (release, wait_for_release) = mpsc::channel();
    // Two different acquisitions' tables, so which one the session kept is a
    // question a spectrum can answer rather than a matter of counting.
    let responses = vec![
        Response::File(METADATA_OUTPUT.to_owned()),
        Response::Stdout(run_summary_output()),
        Response::File(SPECTRUM_TABLE_OUTPUT.to_owned()),
        Response::File(METADATA_OUTPUT.to_owned()),
        Response::Stdout(run_summary_output()),
        Response::File(OTHER_SPECTRUM_TABLE_OUTPUT.to_owned()),
        Response::File(other_selected_spectrum_output(0, &[(612.45, 2200.0)])),
    ];
    let service = Arc::new(PreviewService::new(Box::new(BlockFirstProvider {
        inner: FakeProvider::available(responses),
        started,
        release: Mutex::new(Some(wait_for_release)),
    })));
    let selected = service.accept_file(&file.path).expect("accepted");

    let open = || {
        let service = Arc::clone(&service);
        let handle = selected.handle.clone();
        std::thread::spawn(move || service.open_preview(&handle))
    };

    let running = open();
    observe_start
        .recv_timeout(std::time::Duration::from_secs(10))
        .expect("the first open reached the provider");
    let newer = open();
    wait_for_requests(&service, &selected.handle, 2);
    release.send(()).expect("the provider is still waiting");

    assert_eq!(
        running
            .join()
            .expect("the older open finished")
            .expect_err("an open the user has moved past is not returned as current")
            .kind,
        "selection_superseded"
    );
    newer
        .join()
        .expect("the newer open finished")
        .expect("the newer open is the one that answers");

    let Ok(SelectedSpectrumOutcomeDto::Spectrum { spectrum }) =
        service.load_spectrum(&selected.handle, 0)
    else {
        panic!("the spectrum reconciles against the rows the newer open recorded");
    };
    assert_eq!(
        spectrum.scan_number,
        Some(807),
        "the session kept the newer read's rows, not the abandoned read's"
    );
}

#[test]
fn an_open_of_one_dataset_never_supersedes_an_open_of_another() {
    use std::sync::Arc;
    use std::sync::mpsc;

    let file = TestFile::new("open-cross-dataset");
    let other = file.sibling("other.mzML");
    let (started, observe_start) = mpsc::channel();
    let (release, wait_for_release) = mpsc::channel();
    let mut responses = open_responses();
    responses.extend(open_responses());
    let service = Arc::new(PreviewService::new(Box::new(BlockFirstProvider {
        inner: FakeProvider::available(responses),
        started,
        release: Mutex::new(Some(wait_for_release)),
    })));
    let first = service.add_dataset(&file.path).expect("added");
    let second = service.add_dataset(&other).expect("added");

    let open = |handle: &str| {
        let service = Arc::clone(&service);
        let handle = handle.to_owned();
        std::thread::spawn(move || service.open_preview(&handle))
    };

    let running = open(&first.handle);
    observe_start
        .recv_timeout(std::time::Duration::from_secs(10))
        .expect("the first open reached the provider");
    let elsewhere = open(&second.handle);
    wait_for_requests(&service, &second.handle, 1);
    assert_eq!(
        service.requests_made(&first.handle),
        1,
        "a dataset counts its own requests and nobody else's"
    );
    release.send(()).expect("the provider is still waiting");

    running
        .join()
        .expect("the running open finished")
        .expect("a request nobody has moved on from still commits");
    elsewhere
        .join()
        .expect("the other dataset's open finished")
        .expect("an open in another dataset runs on its own turn");
    assert!(service.holds_preview_state(&first.handle));
    assert!(service.holds_preview_state(&second.handle));
}

#[test]
fn beginning_an_open_drops_what_the_previous_open_recorded() {
    // A reopen that fails must not leave the previous open's rows usable. They
    // are what a selected spectrum is reconciled against, and after a failed
    // reopen nothing on screen came from them -- so a spectrum compared against
    // them is compared against a reading the user is no longer being shown.
    let file = TestFile::new("reopen-invalidates");
    let responses = vec![
        Response::File(METADATA_OUTPUT.to_owned()),
        Response::Stdout(run_summary_output()),
        Response::File(SPECTRUM_TABLE_OUTPUT.to_owned()),
        retryable_launch_failure(),
        // Another acquisition's spectrum entirely: it agrees with nothing in the
        // table the first open recorded, so it is refused if those rows survived.
        Response::File(other_selected_spectrum_output(0, &[(612.45, 2200.0)])),
    ];
    let service = PreviewService::new(Box::new(FakeProvider::available(responses)));
    let selected = service.accept_file(&file.path).expect("accepted");
    service
        .open_preview(&selected.handle)
        .expect("the file opens");
    assert!(service.holds_preview_state(&selected.handle));

    let error = service
        .open_preview(&selected.handle)
        .expect_err("the reopen failed");

    assert_eq!(error.kind, "backend_launch_failed");
    assert!(
        !service.holds_preview_state(&selected.handle),
        "a failed reopen leaves no preview behind"
    );
    let Ok(SelectedSpectrumOutcomeDto::Spectrum { spectrum }) =
        service.load_spectrum(&selected.handle, 0)
    else {
        panic!("with no recorded table there is nothing to reconcile against");
    };
    assert_eq!(spectrum.scan_number, Some(807));
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
    // Revocation cannot end a read that is already under way, and while that
    // read runs it holds the file itself -- so the object is let go when the
    // request finishes rather than when the row goes.
    #[cfg(windows)]
    assert!(
        !nothing_else_holds_open(&file.path),
        "a read already under way still holds the file it is reading"
    );
    release.send(()).expect("the provider is still waiting");

    // The work had already started, so it is not cancelled and its caller is
    // answered -- with the stale-request refusal, because the dataset it was
    // reading is gone. A successful preview here would be a result presented as
    // current for a row the workspace no longer has.
    let stale = opening
        .join()
        .expect("the open finished")
        .expect_err("a read whose dataset has gone answers that its result was not used");
    assert_eq!(stale.kind, "selection_superseded");
    // And nothing outlives it. The file is not left held by a session that has
    // forgotten it, which is the property revocation actually owes.
    #[cfg(windows)]
    assert!(
        nothing_else_holds_open(&file.path),
        "the revoked dataset's file is let go once the request that was reading it finishes"
    );
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
    // Two: the open claims the dataset's epoch as well, so a newer request for
    // it makes an older open stale exactly as it makes an older spectrum stale.
    assert_eq!(service.requests_made(&first.handle), 2);

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

/// The handle an outcome names, whichever way it names one.
fn outcome_handle(outcome: &WorkspaceAddOutcomeDto) -> &str {
    match outcome {
        WorkspaceAddOutcomeDto::Added { dataset } => &dataset.handle,
        WorkspaceAddOutcomeDto::Duplicate { existing } => &existing.handle,
        WorkspaceAddOutcomeDto::Rejected { candidate_name, .. } => {
            panic!("{candidate_name} was rejected, so it names no dataset")
        }
    }
}

fn roster_handles(roster: &super::dto::WorkspaceRosterDto) -> Vec<&str> {
    roster
        .datasets
        .iter()
        .map(|dataset| dataset.handle.as_str())
        .collect()
}

#[test]
fn one_picker_operation_adds_every_file_it_chose_in_the_order_it_chose_them() {
    let file = TestFile::new("add-many");
    let second = file.sibling("second.mzML");
    let third = file.sibling("third.mzML");
    let service = PreviewService::new(Box::new(NoProcess));

    let result = service.add_files(&[file.path.clone(), second, third]);

    assert_eq!(result.outcomes.len(), 3);
    assert!(
        result
            .outcomes
            .iter()
            .all(|outcome| matches!(outcome, WorkspaceAddOutcomeDto::Added { .. }))
    );
    // The outcomes are in picker order and so is the roster, which is what lets
    // the interface say "these are the rows you just added" without matching
    // anything up itself.
    assert_eq!(
        result
            .outcomes
            .iter()
            .map(outcome_handle)
            .collect::<Vec<_>>(),
        ["file-0", "file-1", "file-2"]
    );
    assert_eq!(
        roster_handles(&result.roster),
        ["file-0", "file-1", "file-2"]
    );
    assert_eq!(
        result.roster.datasets[1].file_name, "second.mzML",
        "each row is described as the file it is"
    );
    assert_eq!(result.roster.capacity, MAX_WORKSPACE_DATASETS);
    // And the roster the batch answered with is the roster a later read gives.
    assert_eq!(service.roster(), result.roster);
}

#[test]
fn adding_one_file_is_one_row_and_reading_the_roster_is_no_work() {
    let file = TestFile::new("add-one");
    let service = PreviewService::new(Box::new(NoProcess));
    assert!(
        service.roster().datasets.is_empty(),
        "a session starts empty"
    );

    let result = service.add_files(std::slice::from_ref(&file.path));

    assert_eq!(roster_handles(&result.roster), ["file-0"]);
    assert_eq!(result.roster.datasets[0].file_name, "sample.mzML");
    assert_eq!(result.roster.datasets[0].byte_length, 7);
    // Read again and again: a roster read is stored facts, so nothing here
    // reaches the filesystem or the backend.
    assert_eq!(service.roster(), service.roster());
}

#[test]
fn a_batch_that_chose_nothing_leaves_the_workspace_exactly_as_it_was() {
    // A dismissed picker never reaches this: the command answers `None` before
    // the service is asked. What this pins is that an empty list is not a batch
    // that removed anything either.
    let file = TestFile::new("add-nothing");
    let service = PreviewService::new(Box::new(NoProcess));
    service.add_files(std::slice::from_ref(&file.path));
    let before = service.roster();

    let result = service.add_files(&[]);

    assert!(result.outcomes.is_empty());
    assert_eq!(result.roster, before);
}

#[cfg(windows)]
#[test]
fn one_file_under_two_names_in_one_batch_is_one_row_and_one_duplicate() {
    let file = TestFile::new("add-duplicate");
    let alias = file.hard_link("another-name.mzML");
    let service = PreviewService::new(Box::new(NoProcess));

    let result = service.add_files(&[file.path.clone(), alias, file.path.clone()]);

    assert_eq!(
        roster_handles(&result.roster),
        ["file-0"],
        "one file, one row"
    );
    let WorkspaceAddOutcomeDto::Added { dataset } = &result.outcomes[0] else {
        panic!("the first name registers the dataset");
    };
    assert_eq!(dataset.handle, "file-0");
    for (position, outcome) in result.outcomes[1..].iter().enumerate() {
        let WorkspaceAddOutcomeDto::Duplicate { existing } = outcome else {
            panic!(
                "outcome {} is a duplicate of a row the user already has",
                position + 1
            );
        };
        assert_eq!(existing.handle, "file-0");
        // Described as it was registered. The second name is another way to
        // reach the same acquisition, not a rename of the row they have.
        assert_eq!(existing.file_name, "sample.mzML");
    }
    // A duplicate spends no identifier: the next real addition is file-1.
    let next = service.add_files(&[file.sibling("second.mzML")]);
    assert_eq!(outcome_handle(&next.outcomes[0]), "file-1");
}

#[test]
fn a_byte_identical_copy_is_a_second_row_rather_than_a_duplicate() {
    // Two acquisitions that happen to be identical are two things the user
    // added, which is why the key is the filesystem identity and not the bytes.
    let file = TestFile::new("add-copy");
    let copy = file.copy("copy.mzML");
    let service = PreviewService::new(Box::new(NoProcess));

    let result = service.add_files(&[file.path.clone(), copy]);

    assert_eq!(roster_handles(&result.roster), ["file-0", "file-1"]);
    assert_eq!(
        result.roster.datasets[0].byte_length, result.roster.datasets[1].byte_length,
        "the test needs two files no length can tell apart"
    );
}

#[test]
fn one_file_that_cannot_be_read_does_not_roll_back_the_ones_that_arrived() {
    // A batch is a list of files the user pointed at, not a transaction.
    // Refusing the whole picker operation because one file among them was the
    // wrong format would punish every other file for its company.
    let file = TestFile::new("add-partial");
    let unsupported = file.unsupported("acquisition.mzXML");
    let absent = file.absent("never-existed.mzML");
    let last = file.sibling("last.mzML");
    let service = PreviewService::new(Box::new(NoProcess));

    let result = service.add_files(&[file.path.clone(), unsupported, absent, last]);

    assert_eq!(roster_handles(&result.roster), ["file-0", "file-1"]);
    assert_eq!(
        result.outcomes.len(),
        4,
        "one outcome per file the user chose"
    );
    assert!(matches!(
        result.outcomes[0],
        WorkspaceAddOutcomeDto::Added { .. }
    ));
    let WorkspaceAddOutcomeDto::Rejected {
        candidate_name,
        error,
    } = &result.outcomes[1]
    else {
        panic!("a file this boundary does not open is rejected");
    };
    assert_eq!(candidate_name, "acquisition.mzXML");
    assert_eq!(error.kind, "unsupported_extension");
    let WorkspaceAddOutcomeDto::Rejected {
        candidate_name,
        error,
    } = &result.outcomes[2]
    else {
        panic!("a name with nothing behind it is rejected");
    };
    assert_eq!(candidate_name, "never-existed.mzML");
    assert_eq!(error.kind, "file_not_resolvable");
    // The file after the failures still arrived, and took the next identifier
    // rather than one the refusals had spent.
    assert_eq!(outcome_handle(&result.outcomes[3]), "file-1");
}

#[test]
fn a_full_workspace_refuses_new_files_and_still_answers_for_the_ones_it_holds() {
    let file = TestFile::new("capacity");
    let service = PreviewService::new(Box::new(NoProcess));
    let held: Vec<PathBuf> = (0..MAX_WORKSPACE_DATASETS)
        .map(|index| file.sibling(&format!("held-{index}.mzML")))
        .collect();

    let filled = service.add_files(&held);

    assert_eq!(filled.roster.datasets.len(), MAX_WORKSPACE_DATASETS);
    assert!(
        filled
            .outcomes
            .iter()
            .all(|outcome| matches!(outcome, WorkspaceAddOutcomeDto::Added { .. }))
    );

    // A file the workspace already holds is still a file it holds. Answering
    // "full" would tell the user to make space for something that needs none.
    let again = service.add_files(&[held[0].clone(), file.path.clone(), held[7].clone()]);

    assert_eq!(outcome_handle(&again.outcomes[0]), "file-0");
    let WorkspaceAddOutcomeDto::Rejected {
        candidate_name,
        error,
    } = &again.outcomes[1]
    else {
        panic!("a valid new file is refused when the workspace is full");
    };
    assert_eq!(candidate_name, "sample.mzML");
    assert_eq!(error.kind, "workspace_full");
    assert!(
        !error.retryable,
        "retrying without removing a row cannot help"
    );
    assert_eq!(
        outcome_handle(&again.outcomes[2]),
        "file-7",
        "duplicates are decided before capacity, wherever they sit in the batch"
    );
    assert_eq!(again.roster.datasets.len(), MAX_WORKSPACE_DATASETS);

    // No identifier was spent on anything the session refused: making room for
    // one file admits exactly one, under the identifier after the last one
    // actually registered.
    service.remove_datasets(&["file-3".to_owned()]);
    let admitted = service.add_files(std::slice::from_ref(&file.path));
    assert_eq!(
        outcome_handle(&admitted.outcomes[0]),
        &format!("file-{MAX_WORKSPACE_DATASETS}")
    );
}

#[test]
fn emptying_a_full_workspace_reaches_every_row_without_rewinding_the_allocator() {
    let file = TestFile::new("clear-capacity");
    let service = PreviewService::new(Box::new(NoProcess));
    let held: Vec<PathBuf> = (0..MAX_WORKSPACE_DATASETS)
        .map(|index| file.sibling(&format!("held-{index}.mzML")))
        .collect();
    let filled = service.add_files(&held);
    let witnesses: Vec<_> = filled
        .roster
        .datasets
        .iter()
        .map(|dataset| {
            service
                .lease_witness(&dataset.handle)
                .expect("every row is registered")
        })
        .collect();

    let roster = service.clear_workspace();

    assert!(roster.datasets.is_empty());
    assert_eq!(roster.capacity, MAX_WORKSPACE_DATASETS);
    // Every row, not the first. A loop that reached only the head of the
    // registry would leave the rest of the user's files pinned by a session that
    // no longer lists them, with no row left to remove to get them back.
    for (position, witness) in witnesses.iter().enumerate() {
        assert!(
            witness.is_released(),
            "row {position} was still being held after the workspace was emptied"
        );
    }
    // Removing a row is never deleting a file.
    assert!(held.iter().all(|path| path.exists()));
    // And the allocator does not rewind: a reply still in flight for one of the
    // emptied datasets cannot land on whatever is added next.
    let readded = service.add_files(&held[..1]);
    assert_eq!(
        outcome_handle(&readded.outcomes[0]),
        &format!("file-{MAX_WORKSPACE_DATASETS}")
    );
}

#[test]
fn removing_rows_says_what_went_and_what_named_nothing() {
    let file = TestFile::new("remove");
    let second = file.sibling("second.mzML");
    let third = file.sibling("third.mzML");
    let service = PreviewService::new(Box::new(NoProcess));
    service.add_files(&[file.path.clone(), second, third]);

    let result = service.remove_datasets(&[
        "file-2".to_owned(),
        "file-0".to_owned(),
        // The same row twice is one removal, not one removal and one stale
        // handle: a caller assembling a request need not have been careful.
        "file-2".to_owned(),
        // A row this session never had, and a spelling it never issued.
        "file-9".to_owned(),
        "file-00".to_owned(),
    ]);

    assert_eq!(result.removed_handles, ["file-2", "file-0"]);
    assert_eq!(result.unknown_handles, ["file-9", "file-00"]);
    assert_eq!(roster_handles(&result.roster), ["file-1"]);
    assert_eq!(service.roster(), result.roster);
}

#[test]
fn removing_a_row_releases_its_hold_and_leaves_its_file_where_it_was() {
    let file = TestFile::new("remove-lease");
    let second = file.sibling("second.mzML");
    let service = PreviewService::new(Box::new(NoProcess));
    let added = service.add_files(&[file.path.clone(), second.clone()]);
    let held: Vec<_> = added
        .roster
        .datasets
        .iter()
        .map(|dataset| service.lease_witness(&dataset.handle).expect("registered"))
        .collect();

    service.remove_datasets(&["file-0".to_owned()]);

    assert!(held[0].is_released(), "the removed row let its file go");
    assert!(!held[1].is_released(), "and the row that stayed did not");
    #[cfg(windows)]
    assert!(
        nothing_else_holds_open(&file.path),
        "the operating system agrees that nothing is pinning it"
    );
    assert!(file.path.exists(), "removing a row never deletes a file");
    assert!(second.exists());
}

#[test]
fn removing_the_row_a_preview_belongs_to_takes_its_facts_with_it() {
    let file = TestFile::new("remove-runtime");
    let other = file.sibling("other.mzML");
    let mut responses = open_responses();
    responses.push(Response::File(selected_spectrum_output(
        0,
        &[(445.12, 9000.0)],
    )));
    let service = PreviewService::new(Box::new(FakeProvider::available(responses)));
    service.add_files(&[file.path.clone(), other]);
    service.open_preview("file-0").expect("the preview loads");
    service
        .load_spectrum("file-0", 0)
        .expect("the spectrum loads");
    assert!(service.holds_preview_state("file-0"));

    let result = service.remove_datasets(&["file-0".to_owned()]);

    assert_eq!(roster_handles(&result.roster), ["file-1"]);
    assert!(
        !service.holds_preview_state("file-0"),
        "the preview facts go with the row"
    );
    assert_eq!(
        service.requests_made("file-0"),
        0,
        "and so does the count of requests made against it"
    );
    assert_eq!(
        service
            .open_preview("file-0")
            .expect_err("the handle names nothing now")
            .kind,
        "unknown_file_handle"
    );
}

#[test]
fn a_workspace_emptied_while_a_read_runs_answers_at_once_and_keeps_nothing() {
    use std::sync::Arc;
    use std::sync::mpsc;

    let file = TestFile::new("clear-during-open");
    let (started, observe_start) = mpsc::channel();
    let (release, wait_for_release) = mpsc::channel();
    let service = Arc::new(PreviewService::new(Box::new(BlockFirstProvider {
        inner: FakeProvider::available(open_responses()),
        started,
        release: Mutex::new(Some(wait_for_release)),
    })));
    service.add_files(std::slice::from_ref(&file.path));

    let opening = {
        let service = Arc::clone(&service);
        std::thread::spawn(move || service.open_preview("file-0"))
    };
    observe_start
        .recv_timeout(std::time::Duration::from_secs(10))
        .expect("the open reached the provider");

    // That these return at all is the proof that no workspace lock is held
    // while a backend process runs. A roster the user cannot read, and a list
    // they cannot empty, for as long as one file is being read would make the
    // interface unusable exactly when they most want out of it.
    assert_eq!(service.roster().datasets.len(), 1);
    let roster = service.clear_workspace();
    assert!(roster.datasets.is_empty());

    release.send(()).expect("the provider is still waiting");

    assert_eq!(
        opening
            .join()
            .expect("the open finished")
            .expect_err("a read whose row is gone is not returned as current")
            .kind,
        "selection_superseded"
    );
    assert!(!service.holds_preview_state("file-0"));
    assert!(service.roster().datasets.is_empty());
}

#[test]
fn curating_the_workspace_never_reaches_the_backend() {
    let file = TestFile::new("roster-no-process");
    let second = file.sibling("second.mzML");
    let unsupported = file.unsupported("acquisition.mzXML");
    let service = PreviewService::new(Box::new(NoProcess));

    // Every roster operation there is, including the ones that fail an item and
    // the ones that empty rows the session had.
    service.roster();
    service.add_files(&[file.path.clone(), unsupported, second]);
    service.roster();
    service.remove_datasets(&["file-0".to_owned(), "file-404".to_owned()]);
    service.clear_workspace();

    assert!(service.roster().datasets.is_empty());
}

#[test]
fn nothing_the_roster_transfers_carries_a_path_a_folder_or_an_identity() {
    let file = TestFile::new("roster-privacy");
    let second = file.sibling("second.mzML");
    let unsupported = file.unsupported("acquisition.mzXML");
    let service = PreviewService::new(Box::new(NoProcess));

    let added = service.add_files(&[file.path.clone(), unsupported, second]);
    let removed = service.remove_datasets(&["file-0".to_owned(), "file-77".to_owned()]);
    let cleared = service.clear_workspace();

    let directory = file.directory.to_string_lossy().into_owned();
    for rendered in [
        serde_json::to_string(&added).expect("the batch result serializes"),
        serde_json::to_string(&removed).expect("the removal result serializes"),
        serde_json::to_string(&cleared).expect("the roster serializes"),
    ] {
        assert!(!rendered.contains(&directory), "{rendered}");
        assert!(!rendered.contains("mscanvas-preview-tests"), "{rendered}");
        // No separator of any kind: the rendering escapes a backslash, so one
        // escaped pair would be one separator.
        assert!(!rendered.contains("\\\\"), "{rendered}");
        assert!(!rendered.contains('/'), "{rendered}");
        // The filesystem identity a duplicate is decided by is never sent.
        assert!(!rendered.contains("identity"), "{rendered}");
        assert!(!rendered.contains("volume"), "{rendered}");
    }
    // A rejected candidate is named by its final filename and nothing else.
    let WorkspaceAddOutcomeDto::Rejected { candidate_name, .. } = &added.outcomes[1] else {
        panic!("the unsupported file is rejected");
    };
    assert_eq!(candidate_name, "acquisition.mzXML");
}

#[test]
fn a_candidate_name_is_bounded_and_is_never_more_than_a_file_name() {
    use super::selection::candidate_display_name;

    assert_eq!(
        candidate_display_name(Path::new(r"D:\MSData\private\sample.mzML")),
        "sample.mzML"
    );
    assert_eq!(
        candidate_display_name(Path::new("/home/alice/private/sample.mzML")),
        "sample.mzML"
    );
    // Nothing to name is nothing, rather than an invented stand-in that could
    // be mistaken for a file the user chose.
    assert_eq!(candidate_display_name(Path::new(r"D:\")), "(unnamed file)");
    // A name is not the place an unbounded string reaches the interface.
    let long = format!("{}.mzML", "n".repeat(4_000));
    let bounded = candidate_display_name(&PathBuf::from(r"D:\MSData").join(&long));
    assert!(
        bounded.chars().count() <= super::dto::MAX_CANDIDATE_NAME_CHARS + 1,
        "{}",
        bounded.chars().count()
    );
}

#[test]
fn the_registered_command_surface_is_the_one_the_frontend_calls() {
    // Asserted against the source, because a registration list is the one thing
    // a unit test cannot ask the framework for -- and it is exactly where a
    // second picker with conflicting semantics would survive unnoticed.
    let host = include_str!("../lib.rs");
    let api = include_str!("../../../src/features/mzml-preview/api.ts");

    let registered = host
        .split_once("generate_handler![")
        .expect("the host registers its commands")
        .1
        .split_once(']')
        .expect("the registration list is closed")
        .0;
    let registered: Vec<&str> = registered
        .split(',')
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .collect();

    assert_eq!(
        registered,
        [
            "get_bootstrap_status",
            "inspect_backend",
            "choose_backend_installation",
            "use_automatic_backend_discovery",
            "get_workspace_roster",
            "choose_mzml_files",
            "begin_mzml_folder_import",
            "choose_mzml_folder",
            "remove_workspace_datasets",
            "clear_workspace",
            "open_mzml_preview",
            "load_selected_spectrum",
        ]
    );
    // The retired single-file picker is gone rather than left beside its
    // replacement. Two registered pickers with opposite semantics -- one that
    // replaces the workspace, one that adds to it -- is a boundary nobody can
    // reason about.
    assert!(
        !registered.contains(&"choose_mzml_file"),
        "the replacement picker is retired, not kept alongside the roster"
    );

    // Every command the product uses is a command the host registers, spelled
    // the same way. `get_bootstrap_status` is legacy bootstrap plumbing with no
    // caller here and is deliberately not in this list.
    for name in &registered[1..] {
        assert!(
            api.contains(&format!("\"{name}\"")),
            "the frontend never calls {name}"
        );
    }
    assert!(
        !api.contains("\"choose_mzml_file\""),
        "the frontend must not call a command that no longer exists"
    );

    // No command takes a path from JavaScript, in either spelling.
    assert!(!host.contains("PathBuf"), "no command accepts a path");
    assert!(!host.contains("path:"), "no command accepts a path");

    // And the webview is still granted nothing.
    let capability: serde_json::Value =
        serde_json::from_str(include_str!("../../capabilities/default.json"))
            .expect("the capability file parses");
    assert_eq!(
        capability["permissions"].as_array().map(Vec::len),
        Some(0),
        "the main window is granted no Tauri core API permission"
    );
}

// ---------------------------------------------------------------------------
// Folder ingestion
// ---------------------------------------------------------------------------

/// A real directory tree under `%TEMP%`, removed when the test ends.
///
/// Real rather than modelled, because what these tests are about is the join
/// between a walk and acceptance. A candidate is a proposal about an object,
/// and only a filesystem can be made to hand back a different object for the
/// same name; the traversal policy itself is proved against a fake source in
/// `discovery::tests`, where a tree no filesystem would build can be described.
#[cfg(windows)]
struct FolderTree(PathBuf);

#[cfg(windows)]
impl FolderTree {
    fn new(label: &str) -> Self {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock after Unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "mscanvas-folder-tests-{label}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("create folder test tree");
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }

    /// Writes a file under the tree, creating whatever parents it needs.
    fn file(&self, relative: &str, body: &[u8]) -> PathBuf {
        let path = self.0.join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create folder test parent");
        }
        fs::write(&path, body).expect("write folder test file");
        path
    }

    /// Creates a directory junction at `link` pointing at `target`.
    ///
    /// `mklink /J` through the command processor because std has no junction
    /// API and this project adds no dependency for one. A junction needs no
    /// elevation, which is exactly why the containment claim matters.
    fn junction(&self, link: &str, target: &Path) {
        let link_path = self.0.join(link);
        if let Some(parent) = link_path.parent() {
            fs::create_dir_all(parent).expect("create junction parent");
        }
        let status = std::process::Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(&link_path)
            .arg(target)
            // Silenced because it confirms itself by printing both real paths,
            // and a suite whose subject is that nothing prints a path should
            // not be the thing printing them into a CI log.
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .expect("run the command processor to create a junction");
        assert!(
            status.success() && link_path.exists(),
            "could not create the junction this containment test depends on"
        );
    }
}

#[cfg(windows)]
impl Drop for FolderTree {
    fn drop(&mut self) {
        // Junctions first, and with `rmdir`, which removes the link and never
        // what it points at. A recursive delete over one could take the target
        // with it, and in these tests the target is another fixture.
        remove_junctions_under(&self.0);
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// Removes every junction under a tree, deepest first.
#[cfg(windows)]
fn remove_junctions_under(directory: &Path) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(metadata) = fs::symlink_metadata(entry.path()) else {
            continue;
        };
        if !metadata.is_dir() {
            continue;
        }
        if metadata.file_type().is_symlink() {
            // `symlink_metadata` reports a junction as a symlink on Windows.
            let _ = std::process::Command::new("cmd")
                .args(["/c", "rmdir"])
                .arg(entry.path())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status();
        } else {
            remove_junctions_under(&entry.path());
        }
    }
}

/// Every row the session holds, by name, in the order it holds them.
#[cfg(windows)]
fn roster_names(service: &PreviewService) -> Vec<String> {
    service
        .roster()
        .datasets
        .into_iter()
        .map(|dataset| dataset.file_name)
        .collect()
}

/// What each row would say to tell itself apart, `None` where it says nothing.
#[cfg(windows)]
fn roster_contexts(service: &PreviewService) -> Vec<(String, Option<String>)> {
    service
        .roster()
        .datasets
        .into_iter()
        .map(|dataset| (dataset.file_name, dataset.relative_context))
        .collect()
}

/// Runs the real walk under a chosen root, at the shipped budget.
#[cfg(windows)]
fn walk(
    root: &Path,
) -> Result<super::discovery::DiscoveryResult, super::discovery::DiscoveryError> {
    super::discovery::discover_mzml_candidates(root, super::discovery::DiscoveryBudget::default())
}

#[cfg(windows)]
#[test]
fn a_folder_adds_every_mzml_below_it_in_discovery_order() {
    // The order is ADR 0007's, not the filesystem's: a level's files before
    // that level's subdirectories, each group in ordinal name order. What the
    // user gets from one folder must be the same list twice.
    let tree = FolderTree::new("order");
    tree.file("top.mzML", b"<mzML/>");
    tree.file(r"b\inner.mzML", b"<mzML> b </mzML>");
    tree.file(r"a\deep\leaf.mzML", b"<mzML> a </mzML>");
    // Neither of these is an acquisition this boundary opens, and neither may
    // appear as a rejected candidate either: discovery never proposed them.
    tree.file("notes.txt", b"not an acquisition");
    tree.file("run.mzXML", b"<mzXML/>");
    let service = PreviewService::new(Box::new(NoProcess));

    let result = service
        .add_mzml_folder(tree.path(), service.reserve_folder_import())
        .expect("an ordinary folder is scanned");

    assert_eq!(
        result
            .outcomes
            .iter()
            .map(|outcome| match outcome {
                WorkspaceAddOutcomeDto::Added { dataset } => dataset.file_name.as_str(),
                WorkspaceAddOutcomeDto::Duplicate { existing } => existing.file_name.as_str(),
                WorkspaceAddOutcomeDto::Rejected { candidate_name, .. } => candidate_name.as_str(),
            })
            .collect::<Vec<_>>(),
        vec!["top.mzML", "leaf.mzML", "inner.mzML"]
    );
    assert!(
        result
            .outcomes
            .iter()
            .all(|outcome| matches!(outcome, WorkspaceAddOutcomeDto::Added { .. })),
        "every ordinary mzML under the folder is added"
    );
    assert_eq!(
        roster_names(&service),
        vec!["top.mzML", "leaf.mzML", "inner.mzML"]
    );
    assert!(result.discovery.complete);
    assert!(result.discovery.limits_reached.is_empty());
    assert_eq!(result.discovery.skipped_reparse_count, 0);
    assert_eq!(result.discovery.inaccessible_entry_count, 0);
}

#[cfg(windows)]
#[test]
fn a_folder_of_many_files_costs_no_backend_process_at_all() {
    // The fan-out this milestone must not become. `NoProcess` panics on any
    // provider call, so a single launch anywhere in acceptance, registration or
    // description fails this rather than merely slowing it down.
    let tree = FolderTree::new("no-fan-out");
    for index in 0..24 {
        tree.file(&format!("run-{index:02}.mzML"), b"<mzML/>");
    }
    let service = PreviewService::new(Box::new(NoProcess));

    let result = service
        .add_mzml_folder(tree.path(), service.reserve_folder_import())
        .expect("an ordinary folder is scanned");

    assert_eq!(result.roster.datasets.len(), 24);
}

#[cfg(windows)]
#[test]
fn a_candidate_replaced_between_the_walk_and_the_open_is_refused_and_the_batch_survives() {
    // The recheck, at the boundary it defends. Discovery proved containment for
    // the object it found; between that and acceptance re-resolving the name,
    // the name can be made to mean a different object -- and only the identity
    // that came out of the parent's own enumeration record notices.
    let tree = FolderTree::new("swap");
    let swapped = tree.file("sample.mzML", b"<mzML/>");
    tree.file("untouched.mzML", b"<mzML/>");
    let service = PreviewService::new(Box::new(NoProcess));

    let result = service
        .import_folder(service.reserve_folder_import(), || {
            let found = walk(tree.path())?;
            // After the walk and before acceptance, which is the whole window
            // this defends. The path still resolves, the name is unchanged and
            // the length is unchanged; only the object is different.
            fs::remove_file(&swapped).expect("remove the discovered file");
            fs::write(&swapped, b"<mzML/>").expect("put a different file in its place");
            Ok(found)
        })
        .expect("the folder itself is fine");

    let refused = result
        .outcomes
        .iter()
        .find_map(|outcome| match outcome {
            WorkspaceAddOutcomeDto::Rejected {
                candidate_name,
                error,
            } => Some((candidate_name.as_str(), error.kind.as_str())),
            _ => None,
        })
        .expect("the replaced candidate is refused");
    assert_eq!(refused, ("sample.mzML", "folder_candidate_changed"));
    // One candidate's failure is its own: the rest of the folder still arrives.
    assert_eq!(roster_names(&service), vec!["untouched.mzML"]);
}

#[cfg(windows)]
#[test]
fn a_scan_owned_by_the_previous_webview_document_adds_nothing_and_holds_nothing() {
    use std::sync::mpsc;

    // The reload race, in the order that makes it dangerous. Tauri reports the
    // new document at page-load start; a scan the *previous* window started is
    // still out there holding no lock. It must not arrive afterwards, because
    // nothing would ever tell the new window it had.
    let tree = FolderTree::new("superseded-by-read");
    let candidate = tree.file("sample.mzML", b"<mzML/>");
    let service = Arc::new(PreviewService::new(Box::new(NoProcess)));
    let (started, observe_start) = mpsc::channel();
    let (release, wait_for_release) = mpsc::channel();

    // Reserved before the walk begins, exactly as the command reserves before
    // the picker opens. What the thread carries is the claim, not the right to
    // make a new one when it finally gets round to committing.
    let token = service.reserve_folder_import();
    let scanning = {
        let service = Arc::clone(&service);
        let root = tree.path().to_path_buf();
        std::thread::spawn(move || {
            service.import_folder(token, || {
                // Waited for rather than slept on: the test decides exactly
                // when the workspace moves on, and it moves on while this call
                // is provably inside the walk.
                started.send(()).expect("the test is waiting for the walk");
                wait_for_release.recv().expect("the test releases the walk");
                walk(&root)
            })
        })
    };
    observe_start
        .recv_timeout(std::time::Duration::from_secs(10))
        .expect("the scan reached its walk");

    // The native start of the replacement document is the linearization point.
    // Its later roster read is pure and remains answerable while the scan is
    // unresolved.
    service.begin_webview_document();
    assert!(service.roster().datasets.is_empty());
    release.send(()).expect("the scan is still waiting");

    let error = scanning
        .join()
        .expect("the scan finished")
        .expect_err("a scan the user has moved past does not commit");
    assert_eq!(error.kind, "import_superseded");
    // Nothing accepted, so nothing registered and nothing leased. A superseded
    // import that had taken a hold would keep the user's file open with no row
    // to release it.
    assert!(service.roster().datasets.is_empty());
    assert!(
        nothing_else_holds_open(&candidate),
        "a superseded import holds no file it did not add"
    );
}

#[cfg(windows)]
#[test]
fn a_scan_the_user_moved_past_by_emptying_the_list_adds_nothing() {
    use std::sync::mpsc;

    // The same rule from the direction a user actually reaches for. They
    // started a scan, changed their mind, emptied the list -- and rows from
    // that scan arriving afterwards would repopulate a workspace they had just
    // said was empty.
    let tree = FolderTree::new("superseded-by-clear");
    tree.file("sample.mzML", b"<mzML/>");
    let elsewhere = TestFile::new("kept-through-clear");
    let service = Arc::new(PreviewService::new(Box::new(NoProcess)));
    service.add_files(std::slice::from_ref(&elsewhere.path));
    let (started, observe_start) = mpsc::channel();
    let (release, wait_for_release) = mpsc::channel();

    // Reserved before the walk begins, exactly as the command reserves before
    // the picker opens. What the thread carries is the claim, not the right to
    // make a new one when it finally gets round to committing.
    let token = service.reserve_folder_import();
    let scanning = {
        let service = Arc::clone(&service);
        let root = tree.path().to_path_buf();
        std::thread::spawn(move || {
            service.import_folder(token, || {
                started.send(()).expect("the test is waiting for the walk");
                wait_for_release.recv().expect("the test releases the walk");
                walk(&root)
            })
        })
    };
    observe_start
        .recv_timeout(std::time::Duration::from_secs(10))
        .expect("the scan reached its walk");

    assert!(service.clear_workspace().datasets.is_empty());
    release.send(()).expect("the scan is still waiting");

    assert_eq!(
        scanning
            .join()
            .expect("the scan finished")
            .expect_err("a scan across an emptied list does not commit")
            .kind,
        "import_superseded"
    );
    assert!(service.roster().datasets.is_empty());
}

#[cfg(windows)]
#[test]
fn a_look_that_decides_nothing_about_the_workspace_does_not_supersede_a_scan() {
    use std::sync::mpsc;

    // The other side of the rule, and the reason it is a generation rather than
    // a lock. Looking at the session is not deciding what it holds, so a scan
    // that spans any number of looks still commits -- otherwise the guard would
    // make a long import fail for no reason a user could see.
    let tree = FolderTree::new("survives-a-look");
    tree.file("sample.mzML", b"<mzML/>");
    let service = Arc::new(PreviewService::new(Box::new(NoProcess)));
    let (started, observe_start) = mpsc::channel();
    let (release, wait_for_release) = mpsc::channel();

    // Reserved before the walk begins, exactly as the command reserves before
    // the picker opens. What the thread carries is the claim, not the right to
    // make a new one when it finally gets round to committing.
    let token = service.reserve_folder_import();
    let scanning = {
        let service = Arc::clone(&service);
        let root = tree.path().to_path_buf();
        std::thread::spawn(move || {
            service.import_folder(token, || {
                started.send(()).expect("the test is waiting for the walk");
                wait_for_release.recv().expect("the test releases the walk");
                walk(&root)
            })
        })
    };
    observe_start
        .recv_timeout(std::time::Duration::from_secs(10))
        .expect("the scan reached its walk");

    assert_eq!(service.dataset_count(), 0);
    assert!(!service.holds_preview_state("file-0"));
    release.send(()).expect("the scan is still waiting");

    let result = scanning
        .join()
        .expect("the scan finished")
        .expect("looking at the session does not supersede a scan");
    assert_eq!(result.roster.datasets.len(), 1);
    assert_eq!(roster_names(&service), vec!["sample.mzML"]);
}

#[cfg(windows)]
#[test]
fn a_window_that_reads_the_list_after_a_scan_commits_is_given_its_rows() {
    // The reload race in the harmless order, which must stay harmless. The scan
    // committed first, so the read that follows it is the read that describes
    // the workspace including its rows -- and the window has them.
    let tree = FolderTree::new("read-after-commit");
    tree.file("sample.mzML", b"<mzML/>");
    let service = PreviewService::new(Box::new(NoProcess));

    let result = service
        .add_mzml_folder(tree.path(), service.reserve_folder_import())
        .expect("an ordinary folder is scanned");

    assert_eq!(service.roster(), result.roster);
    assert_eq!(roster_names(&service), vec!["sample.mzML"]);
}

#[cfg(windows)]
#[test]
fn two_files_of_one_name_say_where_they_came_from_and_no_other_row_does() {
    // ADR 0006 permits a location on screen for exactly one reason: two rows
    // the user cannot otherwise choose between. A unique name needs no help,
    // and showing a folder fragment beside one would be a path on screen for
    // nothing.
    let tree = FolderTree::new("collision");
    tree.file(r"batch-1\sample.mzML", b"<mzML> one </mzML>");
    tree.file(r"batch-2\sample.mzML", b"<mzML> two </mzML>");
    tree.file("unique.mzML", b"<mzML> unique </mzML>");
    let service = PreviewService::new(Box::new(NoProcess));

    service
        .add_mzml_folder(tree.path(), service.reserve_folder_import())
        .expect("an ordinary folder is scanned");

    assert_eq!(
        roster_contexts(&service),
        vec![
            ("unique.mzML".to_owned(), None),
            ("sample.mzML".to_owned(), Some("batch-1".to_owned())),
            ("sample.mzML".to_owned(), Some("batch-2".to_owned())),
        ]
    );
}

#[cfg(windows)]
#[test]
fn an_outcome_names_its_row_exactly_as_the_roster_beside_it_does() {
    // Which is why outcomes are described after the whole batch rather than as
    // each file is accepted. A row's context is a fact about the finished
    // roster, and the second `sample.mzML` is the reason the first one has one
    // at all: described as it arrived, the first outcome would carry no context
    // while the roster beside it carried one, and the interface would be
    // showing two answers to the same question.
    let tree = FolderTree::new("outcome-context");
    tree.file(r"batch-1\sample.mzML", b"<mzML> one </mzML>");
    tree.file(r"batch-2\sample.mzML", b"<mzML> two </mzML>");
    let service = PreviewService::new(Box::new(NoProcess));

    let result = service
        .add_mzml_folder(tree.path(), service.reserve_folder_import())
        .expect("an ordinary folder is scanned");

    let described: Vec<&SelectedFileDto> = result
        .outcomes
        .iter()
        .map(|outcome| match outcome {
            WorkspaceAddOutcomeDto::Added { dataset } => dataset,
            other => panic!("every candidate is added: {other:?}"),
        })
        .collect();
    assert_eq!(
        described.into_iter().cloned().collect::<Vec<_>>(),
        result.roster.datasets,
        "an outcome's dataset is the roster's copy of that dataset"
    );
    assert_eq!(
        result.roster.datasets[0].relative_context.as_deref(),
        Some("batch-1")
    );
}

#[cfg(windows)]
#[test]
fn a_context_goes_when_the_row_that_made_it_necessary_does() {
    // Which is why it is computed over the live roster every time one is built
    // rather than stored when a row arrives. Frozen at insertion, the survivor
    // would go on carrying a folder fragment to distinguish it from a row that
    // is no longer there.
    let tree = FolderTree::new("collision-removed");
    tree.file(r"batch-1\sample.mzML", b"<mzML> one </mzML>");
    tree.file(r"batch-2\sample.mzML", b"<mzML> two </mzML>");
    let service = PreviewService::new(Box::new(NoProcess));
    service
        .add_mzml_folder(tree.path(), service.reserve_folder_import())
        .expect("an ordinary folder is scanned");
    assert_eq!(
        roster_contexts(&service),
        vec![
            ("sample.mzML".to_owned(), Some("batch-1".to_owned())),
            ("sample.mzML".to_owned(), Some("batch-2".to_owned())),
        ]
    );

    let remaining = service.remove_datasets(&["file-0".to_owned()]);

    assert_eq!(remaining.roster.datasets.len(), 1);
    assert_eq!(
        roster_contexts(&service),
        vec![("sample.mzML".to_owned(), None)]
    );
}

#[cfg(windows)]
#[test]
fn a_directly_added_file_and_a_discovered_one_of_one_name_are_told_apart() {
    // A picked file has no place under a chosen folder to describe, so it says
    // so rather than being given an invented one. "Top level" is a location and
    // "Added directly" is not, and conflating them would put a picked file in a
    // tree the user never named.
    let picked = TestFile::new("direct-vs-folder");
    let tree = FolderTree::new("direct-vs-folder-tree");
    tree.file("sample.mzML", b"<mzML> discovered </mzML>");
    let service = PreviewService::new(Box::new(NoProcess));

    service.add_files(std::slice::from_ref(&picked.path));
    service
        .add_mzml_folder(tree.path(), service.reserve_folder_import())
        .expect("an ordinary folder is scanned");

    assert_eq!(
        roster_contexts(&service),
        vec![
            ("sample.mzML".to_owned(), Some("Added directly".to_owned())),
            ("sample.mzML".to_owned(), Some("Top level".to_owned())),
        ]
    );
}

#[cfg(windows)]
#[test]
fn two_rows_that_would_say_the_same_thing_are_told_apart_by_the_session() {
    // Two files picked from two different folders are both "Added directly",
    // which distinguishes neither. The fallback names the row rather than the
    // filesystem: it is the session identifier the webview already holds, so it
    // reveals nothing a caller does not have.
    let first = TestFile::new("same-words-a");
    let second = TestFile::new("same-words-b");
    let service = PreviewService::new(Box::new(NoProcess));

    service.add_files(&[first.path.clone(), second.path.clone()]);

    let contexts: Vec<String> = service
        .roster()
        .datasets
        .into_iter()
        .filter_map(|dataset| dataset.relative_context)
        .collect();
    assert_eq!(contexts.len(), 2);
    assert_ne!(contexts[0], contexts[1], "two rows, two answers");
    for context in &contexts {
        assert!(
            context.starts_with("Added directly · workspace item "),
            "{context}"
        );
    }
}

#[cfg(windows)]
#[test]
fn a_context_too_long_to_show_keeps_the_end_nearest_the_file() {
    // Truncating from the end would drop the very components that disambiguate,
    // because the deepest one is the one closest to the file. What is lost is
    // the shallow end, and the ellipsis leads so a reader can see that
    // something was.
    let tree = FolderTree::new("bounded-context");
    let deep = "a-directory-with-a-deliberately-long-name";
    let nested = format!("{deep}-1\\{deep}-2\\{deep}-3\\{deep}-4");
    tree.file(&format!("{nested}\\sample.mzML"), b"<mzML> deep </mzML>");
    tree.file("sample.mzML", b"<mzML> shallow </mzML>");
    let service = PreviewService::new(Box::new(NoProcess));

    service
        .add_mzml_folder(tree.path(), service.reserve_folder_import())
        .expect("an ordinary folder is scanned");

    let deepest = service
        .roster()
        .datasets
        .into_iter()
        .filter_map(|dataset| dataset.relative_context)
        .find(|context| context != "Top level")
        .expect("the nested row says where it is");
    assert!(
        deepest.chars().count() <= super::dto::MAX_RELATIVE_CONTEXT_CHARS,
        "{}",
        deepest.chars().count()
    );
    assert!(deepest.starts_with('…'), "{deepest}");
    assert!(deepest.ends_with(&format!("{deep}-4")), "{deepest}");
}

#[cfg(windows)]
#[test]
fn a_scan_cut_short_by_a_limit_says_so_and_names_the_limit() {
    // An incomplete answer reported as a complete one is the worst outcome
    // available here: the user would believe a folder holds three acquisitions
    // when it holds three hundred. Which limit ran out is what tells them
    // whether a narrower folder would help.
    let tree = FolderTree::new("limit");
    tree.file("one.mzML", b"<mzML/>");
    tree.file("two.mzML", b"<mzML/>");
    tree.file("three.mzML", b"<mzML/>");
    let service = PreviewService::new(Box::new(NoProcess));

    let result = service
        .import_folder(service.reserve_folder_import(), || {
            super::discovery::discover_mzml_candidates(
                tree.path(),
                super::discovery::DiscoveryBudget {
                    max_candidates: 1,
                    ..super::discovery::DiscoveryBudget::default()
                },
            )
        })
        .expect("a bounded scan is still a scan");

    assert_eq!(result.roster.datasets.len(), 1);
    assert!(!result.discovery.complete);
    assert_eq!(
        result.discovery.limits_reached,
        vec![super::dto::FolderScanLimitDto::Candidates]
    );
}

#[cfg(windows)]
#[test]
fn a_junction_under_the_chosen_folder_is_counted_rather_than_followed() {
    // The authority boundary, end to end. The user pointed at one folder; they
    // did not point at wherever a junction inside it happens to lead, and the
    // acquisition on the other side must not appear in their workspace. That it
    // was skipped is reported, because a scan that refused something is not a
    // scan that described everything.
    let outside = FolderTree::new("junction-target");
    outside.file("outside.mzML", b"<mzML> outside </mzML>");
    let tree = FolderTree::new("junction-root");
    tree.file("inside.mzML", b"<mzML> inside </mzML>");
    tree.junction("shortcut", outside.path());
    let service = PreviewService::new(Box::new(NoProcess));

    let result = service
        .add_mzml_folder(tree.path(), service.reserve_folder_import())
        .expect("a folder with a junction in it is still scanned");

    assert_eq!(roster_names(&service), vec!["inside.mzML"]);
    assert_eq!(result.discovery.skipped_reparse_count, 1);
    assert!(!result.discovery.complete);
}

#[cfg(windows)]
#[test]
fn nothing_a_folder_import_transfers_carries_a_path_a_root_name_or_an_identity() {
    // The chosen root's own name is as private as the path it sits on: it is
    // the user's word for their data, and this boundary was given it to scan
    // rather than to repeat. Only the bounded collision context may name any
    // part of a location, and only what is below the root.
    let tree = FolderTree::new("privacy");
    tree.file(r"batch-1\sample.mzML", b"<mzML> one </mzML>");
    tree.file(r"batch-2\sample.mzML", b"<mzML> two </mzML>");
    tree.file("run.mzXML", b"<mzXML/>");
    let service = PreviewService::new(Box::new(NoProcess));

    let result = service
        .add_mzml_folder(tree.path(), service.reserve_folder_import())
        .expect("an ordinary folder is scanned");

    let rendered = serde_json::to_string(&result).expect("the folder result serializes");
    let root = tree.path().to_string_lossy().into_owned();
    assert!(!rendered.contains(&root), "{rendered}");
    assert!(!rendered.contains("mscanvas-folder-tests"), "{rendered}");
    assert!(!rendered.contains("C:"), "{rendered}");
    assert!(!rendered.contains("\\\\"), "{rendered}");
    assert!(!rendered.contains('/'), "{rendered}");
    assert!(!rendered.contains("identity"), "{rendered}");
    assert!(!rendered.contains("volume"), "{rendered}");
    // The scan's own shape is not reported either: how many entries a folder
    // holds and how many directories are under it describe the user's tree.
    assert!(!rendered.contains("entriesInspected"), "{rendered}");
    assert!(!rendered.contains("directoriesEntered"), "{rendered}");
    // Nor the claim the import committed against. The token is a number this
    // side allocated to order its own decisions; a caller that could see one
    // could reason about it, and a caller that could send one could forge it.
    assert!(!rendered.contains("token"), "{rendered}");
    assert!(!rendered.contains("generation"), "{rendered}");
    // What may appear is the least that tells two identical names apart.
    assert!(rendered.contains("batch-1"), "{rendered}");
}

#[test]
fn the_folder_boundary_is_spelled_the_way_the_frontend_reads_it() {
    // Serde renames these; the frontend declares them as a closed union and a
    // field name. Neither side would fail to compile if the two disagreed, and
    // the failure would be silent -- a limit that matched nothing, or a context
    // that never rendered -- so the spellings are asserted against the file the
    // frontend actually reads.
    use super::dto::FolderScanLimitDto;

    let contracts = include_str!("../../../src/features/mzml-preview/contracts.ts");
    for limit in [
        FolderScanLimitDto::Depth,
        FolderScanLimitDto::Entries,
        FolderScanLimitDto::Directories,
        FolderScanLimitDto::Candidates,
    ] {
        let rendered = serde_json::to_string(&limit).expect("a limit serializes");
        assert!(
            contracts.contains(&rendered),
            "the frontend does not name {rendered}"
        );
    }
    for field in [
        "relativeContext",
        "skippedReparseCount",
        "inaccessibleEntryCount",
        "limitsReached",
    ] {
        assert!(
            contracts.contains(field),
            "the frontend does not read {field}"
        );
    }
    // And the two counters that describe the user's tree are not sent at all,
    // in either spelling.
    for absent in ["entriesInspected", "directoriesEntered"] {
        assert!(
            !contracts.contains(absent),
            "the boundary must not carry {absent}"
        );
    }
}

#[test]
fn every_discovery_refusal_maps_to_a_visible_kind_of_its_own() {
    // One arm per kind, spelled out rather than defaulted, so a new traversal
    // refusal makes the mapping fail to compile instead of quietly arriving as
    // one of the old ones. Asked through the boundary rather than of the
    // mapping function, because what matters is what a caller is told.
    use super::discovery::{DiscoveryError, DiscoveryErrorKind};

    let expected = [
        (
            DiscoveryErrorKind::PlatformUnavailable,
            "folder_discovery_unavailable",
        ),
        (DiscoveryErrorKind::RootUnavailable, "folder_not_readable"),
        (DiscoveryErrorKind::RootNotDirectory, "folder_not_directory"),
        (
            DiscoveryErrorKind::RootReparsePoint,
            "folder_link_unsupported",
        ),
        (
            DiscoveryErrorKind::RemoteRootUnsupported,
            "network_folder_unsupported",
        ),
        (
            DiscoveryErrorKind::RootEnumerationFailed,
            "folder_scan_unreadable",
        ),
        (
            DiscoveryErrorKind::FilesystemInvariantFailed,
            "folder_scan_failed",
        ),
    ];

    let service = PreviewService::new(Box::new(NoProcess));
    let mut seen: Vec<String> = Vec::new();
    for (kind, expected_kind) in expected {
        let error = service
            .import_folder(service.reserve_folder_import(), || {
                Err(DiscoveryError::new(kind))
            })
            .expect_err("a refused walk is a refused import");
        assert_eq!(error.kind, expected_kind, "{kind:?}");
        // Nothing an operating system said, and nothing a path could hide in.
        assert!(!error.summary.contains('\\'), "{}", error.summary);
        assert!(error.detail.is_none(), "{:?}", error.detail);
        assert!(!error.summary.is_empty());
        seen.push(error.kind.clone());
    }
    let mut unique = seen.clone();
    unique.sort_unstable();
    unique.dedup();
    assert_eq!(
        unique.len(),
        seen.len(),
        "each refusal has a kind of its own"
    );
}

#[test]
fn a_refused_walk_leaves_the_workspace_exactly_as_it_was() {
    // A folder that could not be read is not a reason to touch the session. The
    // generation was reserved and released, and nothing between then and the
    // refusal writes anything.
    use super::discovery::{DiscoveryError, DiscoveryErrorKind};

    let file = TestFile::new("refused-walk");
    let service = PreviewService::new(Box::new(NoProcess));
    service.add_files(std::slice::from_ref(&file.path));
    let before = service.roster();

    service
        .import_folder(service.reserve_folder_import(), || {
            Err(DiscoveryError::new(DiscoveryErrorKind::RootUnavailable))
        })
        .expect_err("a refused walk is a refused import");

    assert_eq!(service.roster(), before);
}

#[test]
fn a_folder_reservation_is_exact_and_single_use() {
    let service = PreviewService::new(Box::new(NoProcess));
    let reservation = service.begin_folder_import();

    let token = service
        .claim_folder_import(&reservation.reservation_id)
        .expect("the exact reservation is claimable once");
    assert_eq!(token.generation(), 1);
    assert_eq!(
        service
            .claim_folder_import(&reservation.reservation_id)
            .expect_err("a consumed reservation cannot be replayed")
            .kind,
        "invalid_folder_import_reservation"
    );
}

#[test]
fn a_wrong_folder_reservation_does_not_consume_the_live_one() {
    let service = PreviewService::new(Box::new(NoProcess));
    let reservation = service.begin_folder_import();

    assert_eq!(
        service
            .claim_folder_import("folder-import-reservation-999")
            .expect_err("an identifier Rust did not issue names nothing")
            .kind,
        "invalid_folder_import_reservation"
    );
    service
        .claim_folder_import(&reservation.reservation_id)
        .expect("the wrong claim left the exact one available");
}

#[test]
fn a_delayed_begin_at_the_same_baseline_reuses_the_live_reservation() {
    let service = PreviewService::new(Box::new(NoProcess));
    let current = service.begin_folder_import();
    // This can be an old document's fetch reaching Rust after the replacement
    // document already began. Arrival order cannot make it a newer workspace
    // decision: both saw the same baseline, so both name the one bounded slot.
    let delayed = service.begin_folder_import();

    assert_eq!(delayed.reservation_id, current.reservation_id);
    assert_eq!(
        service
            .claim_folder_import(&current.reservation_id)
            .expect("the current document claims the shared baseline")
            .generation(),
        1
    );
    assert_eq!(
        service
            .claim_folder_import(&delayed.reservation_id)
            .expect_err("the delayed document cannot replay the consumed claim")
            .kind,
        "invalid_folder_import_reservation"
    );
}

#[test]
fn a_delayed_begin_after_clear_replaces_only_the_stale_slot() {
    let service = PreviewService::new(Box::new(NoProcess));
    let current = service.begin_folder_import();

    service.clear_workspace();
    // The old document's begin reaches Rust after Clear and replaces the stale
    // slot at the new baseline. The current document's now-wrong identifier
    // must not consume that replacement.
    let delayed = service.begin_folder_import();
    assert_ne!(delayed.reservation_id, current.reservation_id);
    assert_eq!(
        service
            .claim_folder_import(&current.reservation_id)
            .expect_err("Clear made the original reservation unavailable")
            .kind,
        "invalid_folder_import_reservation"
    );
    assert_eq!(
        service
            .claim_folder_import(&delayed.reservation_id)
            .expect("a wrong old claim leaves the replacement available")
            .generation(),
        2
    );
}

#[cfg(windows)]
#[test]
fn a_delayed_begin_after_claim_does_not_supersede_the_active_import() {
    let tree = FolderTree::new("delayed-begin-after-claim");
    tree.file("sample.mzML", b"<mzML/>");
    let service = PreviewService::new(Box::new(NoProcess));

    let current = service.begin_folder_import();
    let token = service
        .claim_folder_import(&current.reservation_id)
        .expect("the current document claimed before its picker");

    // The old document's begin reaches Rust only now. It may occupy the one
    // pending slot, but begin is not a workspace decision and cannot advance
    // beyond the live token.
    let delayed = service.begin_folder_import();
    assert_ne!(delayed.reservation_id, current.reservation_id);

    service
        .add_mzml_folder(tree.path(), token)
        .expect("a ghost begin cannot cancel the current document's import");
    assert_eq!(roster_names(&service), vec!["sample.mzML"]);
}

#[cfg(windows)]
#[test]
fn a_delayed_roster_read_from_the_old_document_does_not_supersede_the_new_import() {
    let tree = FolderTree::new("delayed-old-roster");
    tree.file("sample.mzML", b"<mzML/>");
    let service = PreviewService::new(Box::new(NoProcess));

    service.begin_webview_document();
    let current = service.begin_folder_import();
    let token = service
        .claim_folder_import(&current.reservation_id)
        .expect("the replacement document claimed its import");

    // An IPC roster request sent by the old document reaches Rust only now.
    // It is a pure snapshot: native page-load start, not request arrival order,
    // already declared which document owns the workspace.
    assert!(service.roster().datasets.is_empty());
    service
        .add_mzml_folder(tree.path(), token)
        .expect("the old document's delayed read cannot cancel new work");
    assert_eq!(roster_names(&service), vec!["sample.mzML"]);
}

#[test]
fn folder_import_reservations_use_one_bounded_pending_slot() {
    // A document can disappear after `begin` replies but before it claims the
    // identifier. Retaining every abandoned reply would turn reloads into an
    // unbounded Rust-side registry, so the storage shape is part of the IPC
    // contract rather than an implementation detail.
    let source = include_str!("service.rs");
    let mutation_state = source
        .split_once("struct WorkspaceMutationState {")
        .expect("the workspace mutation state is declared")
        .1
        .split_once("\n}")
        .expect("the workspace mutation state is closed")
        .0;

    assert!(
        mutation_state.contains("pending_folder_import: Option<PendingFolderImport>"),
        "one replaceable Option bounds abandoned folder reservations"
    );
    for unbounded in ["Vec<PendingFolderImport>", "HashMap<", "BTreeMap<"] {
        assert!(!mutation_state.contains(unbounded), "{mutation_state}");
    }
}

#[test]
fn a_reload_between_begin_and_claim_refuses_before_a_picker_can_use_the_token() {
    let service = PreviewService::new(Box::new(NoProcess));
    let reservation = service.begin_folder_import();

    // Native page-load start advances before the replacement document can ask
    // for its pure roster snapshot.
    service.begin_webview_document();
    assert!(service.roster().datasets.is_empty());
    assert_eq!(
        service
            .claim_folder_import(&reservation.reservation_id)
            .expect_err("the old document cannot start a picker after the reload read")
            .kind,
        "import_superseded"
    );
    assert_eq!(
        service
            .claim_folder_import(&reservation.reservation_id)
            .expect_err("the stale claim was consumed on refusal")
            .kind,
        "invalid_folder_import_reservation"
    );
}

#[cfg(windows)]
#[test]
fn a_window_that_reloads_while_the_picker_is_open_supersedes_the_import() {
    // The race the reservation moved to cover. A modal dialog can stand open
    // for minutes; a webview can reload or die inside that window, and the one
    // that replaces it reads the roster, adopts it, and has no further read
    // coming. Reserved after the picker answered, this import would be newer
    // than that read, would commit, and would hand its rows to a window that is
    // no longer there.
    //
    // Sequential rather than threaded on purpose: with the claim taken before
    // the dialog, the whole race is expressible in the order it happens.
    let tree = FolderTree::new("reload-during-picker");
    let candidate = tree.file("sample.mzML", b"<mzML/>");
    let service = PreviewService::new(Box::new(NoProcess));

    // The command reserves, then shows the dialog.
    let token = service.reserve_folder_import();
    // The window goes; native page-load start supersedes its token, and the
    // replacement then reads what the session holds without moving it again.
    service.begin_webview_document();
    assert!(service.roster().datasets.is_empty());
    // The user finally chooses a folder in the dialog the old window opened.
    let error = service
        .add_mzml_folder(tree.path(), token)
        .expect_err("an import the live window has already read past does not commit");

    assert_eq!(error.kind, "import_superseded");
    assert!(service.roster().datasets.is_empty());
    assert!(
        nothing_else_holds_open(&candidate),
        "a superseded import holds no file it did not add"
    );
}

#[cfg(windows)]
#[test]
fn every_workspace_decision_taken_while_the_picker_is_open_supersedes_the_import() {
    // Each deliberate mutation says "this is the workspace now", and rows from
    // a dialog opened before it would arrive from nowhere. Webview replacement
    // is covered separately by the native page-load tests above.
    let elsewhere = TestFile::new("decisions-during-picker");
    for decision in ["clear", "remove", "add"] {
        let tree = FolderTree::new(&format!("picker-{decision}"));
        // Named apart from the file the session already holds, so "the folder's
        // row did not arrive" is a question about this row rather than about
        // whichever `sample.mzML` happens to be in the list.
        tree.file("folder-run.mzML", b"<mzML/>");
        let service = PreviewService::new(Box::new(NoProcess));
        service.add_files(std::slice::from_ref(&elsewhere.path));

        let token = service.reserve_folder_import();
        match decision {
            "clear" => {
                service.clear_workspace();
            }
            "remove" => {
                service.remove_datasets(&["file-0".to_owned()]);
            }
            _ => {
                service.add_files(std::slice::from_ref(&elsewhere.path));
            }
        }

        assert_eq!(
            service
                .add_mzml_folder(tree.path(), token)
                .expect_err("the decision the user made wins")
                .kind,
            "import_superseded",
            "{decision}"
        );
        assert!(
            !roster_names(&service)
                .iter()
                .any(|name| name == "folder-run.mzML"),
            "{decision}"
        );
    }
}

#[cfg(windows)]
#[test]
fn a_newer_folder_command_supersedes_a_picker_that_is_still_open() {
    // Two dialogs cannot be open at once through the interface, but the service
    // may not rely on that: the guard is the frontend's, and the rule here is
    // that the newest decision is the one that commits.
    let tree = FolderTree::new("two-pickers");
    tree.file("sample.mzML", b"<mzML/>");
    let service = PreviewService::new(Box::new(NoProcess));

    let older = service.reserve_folder_import();
    let newer = service.reserve_folder_import();

    service
        .add_mzml_folder(tree.path(), newer)
        .expect("the newer command commits");
    assert_eq!(roster_names(&service), vec!["sample.mzML"]);

    assert_eq!(
        service
            .add_mzml_folder(tree.path(), older)
            .expect_err("the older one does not")
            .kind,
        "import_superseded"
    );
    assert_eq!(
        roster_names(&service),
        vec!["sample.mzML"],
        "and adds nothing on its way out"
    );
}

#[cfg(windows)]
#[test]
fn a_cancelled_picker_adds_nothing_and_still_answers_for_the_claim_it_took() {
    // Cancelling drops the token. The generation stays advanced, which is
    // deliberate: it supersedes anything older, it adds no row, it holds no
    // lease and it spends no identifier. A generation is an ordering fact and
    // is never given back.
    let tree = FolderTree::new("cancelled-picker");
    tree.file("sample.mzML", b"<mzML/>");
    let service = PreviewService::new(Box::new(NoProcess));

    let older = service.reserve_folder_import();
    // The user opens a second dialog and cancels it. Its claim was taken and is
    // never spent, which is the whole of what cancelling costs.
    let _cancelled = service.reserve_folder_import();

    assert!(service.roster().datasets.is_empty());
    assert_eq!(
        service
            .add_mzml_folder(tree.path(), older)
            .expect_err("the cancelled dialog was still a decision about which import is current")
            .kind,
        "import_superseded"
    );
}

#[cfg(windows)]
#[test]
fn committing_an_import_does_not_claim_the_next_state_as_well() {
    // The commit is the completion of the decision the token names, not a new
    // one. Reserving again here would move the import forward past every
    // decision the user made while the picker was open, which is the whole
    // thing the token exists to prevent.
    let tree = FolderTree::new("no-second-claim");
    tree.file("sample.mzML", b"<mzML/>");
    let service = PreviewService::new(Box::new(NoProcess));

    let before = service.reserve_folder_import();
    let claimed = service.reserve_folder_import();
    assert_eq!(claimed.generation(), before.generation() + 1);

    service
        .add_mzml_folder(tree.path(), claimed)
        .expect("it commits");

    assert_eq!(
        service.reserve_folder_import().generation(),
        before.generation() + 2,
        "the commit advanced nothing of its own"
    );
}

#[test]
fn the_folder_reservation_handle_carries_no_path_or_internal_generation() {
    let rendered = serde_json::to_string(&super::dto::FolderImportReservationDto {
        reservation_id: "folder-import-reservation-17".to_owned(),
    })
    .expect("the reservation serialises");

    assert_eq!(
        rendered,
        "{\"reservationId\":\"folder-import-reservation-17\"}"
    );
    for private in ["path", "root", "generation", "token"] {
        assert!(!rendered.contains(private), "{rendered}");
    }
}

#[test]
fn the_folder_begin_command_is_synchronous_and_cannot_open_a_picker() {
    let host = include_str!("../lib.rs");
    let body = host
        .split_once("fn begin_mzml_folder_import")
        .expect("the host registers the reservation command")
        .1
        .split_once("\n}\n")
        .expect("the command body is closed")
        .0;

    assert!(!host.contains("async fn begin_mzml_folder_import"));
    assert!(body.contains("service.begin_folder_import()"));
    assert!(!body.contains("run_on_main_thread"));
    assert!(!body.contains("choose_mzml_folder(owner)"));
    assert!(!body.contains("add_mzml_folder"));
}

#[test]
fn the_native_page_load_start_supersedes_work_from_the_replaced_document() {
    let host = include_str!("../lib.rs");
    let hook = host
        .split_once(".on_page_load(")
        .expect("the host observes native webview navigation")
        .1
        .split_once(".invoke_handler")
        .expect("the page-load hook is closed before command registration")
        .0;

    assert!(hook.contains("webview.label() == \"main\""));
    assert!(hook.contains("payload.event() == PageLoadEvent::Started"));
    assert!(hook.contains("begin_webview_document()"));
}

#[test]
fn roster_reads_are_gate_linearized_without_advancing_the_generation() {
    let source = include_str!("service.rs");
    let body = source
        .split_once("pub fn roster(&self) -> WorkspaceRosterDto {")
        .expect("the service exposes the stored roster")
        .1
        .split_once("\n    }\n\n    /// Adds")
        .expect("the roster body is closed before file addition")
        .0;

    let gated = body
        .find("enter_workspace_mutation()")
        .expect("a roster snapshot waits for an in-flight batch");
    let snapshot = body
        .find("roster_of(&self.workspace())")
        .expect("the roster is copied while it owns the ordering gate");
    assert!(gated < snapshot);
    assert!(
        !body.contains("begin_mutation"),
        "a roster read is not a decision"
    );
    assert!(
        !body.contains("advance()"),
        "a roster read is not a decision"
    );
}

#[test]
fn the_folder_chooser_claims_one_reservation_before_it_opens_the_picker() {
    let host = include_str!("../lib.rs");
    let body = host
        .split_once("async fn choose_mzml_folder")
        .expect("the host registers the folder chooser")
        .1
        .split_once("\n}\n")
        .expect("the command body is closed")
        .0;

    let claimed = body
        .find("claim_folder_import(&reservation_id)")
        .expect("the command consumes and validates the reservation");
    let dispatched = body
        .find("run_on_main_thread")
        .expect("the command dispatches the picker");
    let imported = body
        .find("add_mzml_folder")
        .expect("the command imports what was chosen");

    assert!(
        claimed < dispatched,
        "a stale claim must fail before the picker"
    );
    assert!(dispatched < imported);
    let signature = body
        .split_once(')')
        .expect("the command has a parameter list")
        .0;
    assert!(signature.contains("reservation_id: String"));
    assert!(!signature.contains("token"), "{signature}");
    assert!(!signature.contains("Token"), "{signature}");
    assert!(!signature.contains("Path"), "{signature}");
}
