//! Deterministic coverage for the preview boundary.
//!
//! Every test substitutes a provider at the application boundary, so none of
//! them needs a local ProteoWizard installation and none of them can reach a
//! real backend. The fake lives under `cfg(test)` only, so no production
//! command can ever return mock data.

use std::fs;
use std::path::{MAIN_SEPARATOR, Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::time::Duration;

use mscanvas_proteowizard::{
    BackendTool, CancellationToken, CapturedHelpStream, CommandSpec, CompleteHelpCapture,
    ConflictPolicy, ConversionCancellation, ConversionSourceKind, EstablishedSampleCompleteness,
    InstalledHelpCapabilities, MAX_CONVERSION_OUTPUTS_PER_SOURCE, PreviewOperation, PreviewOutcome,
    PreviewOutputEntry, PreviewOutputManifest, ProcessError, ProcessOutput, ProcessRunner,
    SciexSampleCompleteness, Sha256Digest, Termination, interpret_preview,
};

use super::backend::{ConversionBackend, OperationAttempt, PreviewProvider, interpretation_error};
use super::conversion::{conversion_source_kind, is_convertible};
#[cfg(windows)]
use super::discovery::inspect_drop_root;
use super::discovery::{
    DiscoveryBudget, DiscoveryError, DiscoveryErrorKind, DiscoveryUsage, DropRootInspection,
};
use super::drop_ingestion::{
    DropBatch, DropBudget, DropIngestionSummary, MAX_DROP_ROOTS, NativeDropDispatch,
    NativeDropSignal, NativeDropWork, expand_drop_paths, expand_drop_paths_with_budget,
    expand_drop_paths_with_budget_using, normalize_window_drop_event,
};
use super::dto::{
    BackendAvailabilityDto, BackendFailureDto, ChromatogramRangeDto, ChromatogramTracesDto,
    DropIngestionResultDto, DropScanLimitDto, FigureSettingsDto, LinkedFigureExportOutcomeDto,
    MAX_CONVERSION_QUEUE_ITEMS, MAX_WORKSPACE_DATASETS, PreviewErrorDto, SelectedFileDto,
    SelectedSpectrumOutcomeDto, SpectrumExportOutcomeDto, WorkspaceAddOutcomeDto,
    WorkspaceDropUpdateDto, WorkspaceOutputAdoptionOutcomeDto, WorkspaceOutputAdoptionResultDto,
};
use super::dto::{
    ConversionConflictPolicyDto, ConversionDiagnosticsExportDto, ConversionDiagnosticsStateDto,
    ConversionOutputFormatDto, ConversionQueueDto, ConversionQueueItemStateDto,
    ConversionQueueTerminalReasonDto, DatasetSourceKindDto, ValidationModeDto,
    WorkspaceConversionStateDto, WorkspaceConversionUpdateDto,
};
use super::installation::InstallationIdentity;
use super::operation::{
    AdmittedDestination, CancellationFacts, ClaimedOutputName, ConversionQueue, ConversionSlot,
    ItemOutcome, ItemState, QueueItem, StopAccepted, TerminalReason, folded_output_name,
};
/// The share-mode probe that answers whether a file is still held open. It
/// lives beside the flags the lease is opened with, because that is what makes
/// its answer exact rather than a guess.
#[cfg(windows)]
use super::selection::nothing_else_holds_open;
use super::selection::{DatasetId, DatasetSourceKind};
use super::selection::{
    FileIdentity, accept_mzml_file, accept_shimadzu_lcd_file, accept_thermo_raw_file,
    accept_workspace_file, open_conversion_source, revalidate,
};
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

    let result = service.add_files_now(&[file.path.clone(), second, third]);

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

    let result = service.add_files_now(std::slice::from_ref(&file.path));

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
    service.add_files_now(std::slice::from_ref(&file.path));
    let before = service.roster();

    let result = service.add_files_now(&[]);

    assert!(result.outcomes.is_empty());
    assert_eq!(result.roster, before);
}

#[cfg(windows)]
#[test]
fn one_file_under_two_names_in_one_batch_is_one_row_and_one_duplicate() {
    let file = TestFile::new("add-duplicate");
    let alias = file.hard_link("another-name.mzML");
    let service = PreviewService::new(Box::new(NoProcess));

    let result = service.add_files_now(&[file.path.clone(), alias, file.path.clone()]);

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
    let next = service.add_files_now(&[file.sibling("second.mzML")]);
    assert_eq!(outcome_handle(&next.outcomes[0]), "file-1");
}

#[test]
fn a_byte_identical_copy_is_a_second_row_rather_than_a_duplicate() {
    // Two acquisitions that happen to be identical are two things the user
    // added, which is why the key is the filesystem identity and not the bytes.
    let file = TestFile::new("add-copy");
    let copy = file.copy("copy.mzML");
    let service = PreviewService::new(Box::new(NoProcess));

    let result = service.add_files_now(&[file.path.clone(), copy]);

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

    let result = service.add_files_now(&[file.path.clone(), unsupported, absent, last]);

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

    let filled = service.add_files_now(&held);

    assert_eq!(filled.roster.datasets.len(), MAX_WORKSPACE_DATASETS);
    assert!(
        filled
            .outcomes
            .iter()
            .all(|outcome| matches!(outcome, WorkspaceAddOutcomeDto::Added { .. }))
    );

    // A file the workspace already holds is still a file it holds. Answering
    // "full" would tell the user to make space for something that needs none.
    let again = service.add_files_now(&[held[0].clone(), file.path.clone(), held[7].clone()]);

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
    service.remove_datasets_now(&["file-3".to_owned()]);
    let admitted = service.add_files_now(std::slice::from_ref(&file.path));
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
    let filled = service.add_files_now(&held);
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

    let roster = service.clear_workspace_now();

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
    let readded = service.add_files_now(&held[..1]);
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
    service.add_files_now(&[file.path.clone(), second, third]);

    let result = service.remove_datasets_now(&[
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
    let added = service.add_files_now(&[file.path.clone(), second.clone()]);
    let held: Vec<_> = added
        .roster
        .datasets
        .iter()
        .map(|dataset| service.lease_witness(&dataset.handle).expect("registered"))
        .collect();

    service.remove_datasets_now(&["file-0".to_owned()]);

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
    service.add_files_now(&[file.path.clone(), other]);
    service.open_preview("file-0").expect("the preview loads");
    service
        .load_spectrum("file-0", 0)
        .expect("the spectrum loads");
    assert!(service.holds_preview_state("file-0"));

    let result = service.remove_datasets_now(&["file-0".to_owned()]);

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
    service.add_files_now(std::slice::from_ref(&file.path));

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
    let roster = service.clear_workspace_now();
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
    service.add_files_now(&[file.path.clone(), unsupported, second]);
    service.roster();
    service.remove_datasets_now(&["file-0".to_owned(), "file-404".to_owned()]);
    service.clear_workspace_now();

    assert!(service.roster().datasets.is_empty());
}

#[test]
fn nothing_the_roster_transfers_carries_a_path_a_folder_or_an_identity() {
    let file = TestFile::new("roster-privacy");
    let second = file.sibling("second.mzML");
    let unsupported = file.unsupported("acquisition.mzXML");
    let service = PreviewService::new(Box::new(NoProcess));

    let added = service.add_files_now(&[file.path.clone(), unsupported, second]);
    let removed = service.remove_datasets_now(&["file-0".to_owned(), "file-77".to_owned()]);
    let cleared = service.clear_workspace_now();

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
    let drop_transport = include_str!("../../../src/features/mzml-preview/dropTransport.ts");

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
            "choose_workspace_files",
            "begin_mzml_folder_import",
            "choose_mzml_folder",
            "subscribe_workspace_drop_updates",
            "remove_workspace_datasets",
            "clear_workspace",
            "open_mzml_preview",
            "load_selected_spectrum",
            "describe_workspace_conversion_queue",
            "get_workspace_conversion_state",
            "begin_workspace_conversion_queue",
            "choose_workspace_conversion_destination",
            "retry_workspace_conversion_queue",
            "stop_workspace_conversion_queue",
            "adopt_workspace_conversion_outputs",
            // Two, and the same two-phase shape the destination picker uses:
            // the reservation is issued synchronously and the dialog is a
            // separate command, so a document that never received the
            // identifier can never open one.
            "begin_workspace_conversion_diagnostics_export",
            "save_workspace_conversion_diagnostics",
            // The selected-spectrum export, in the same two-phase shape and for
            // the same reason. The first command binds which spectrum -- by the
            // opaque token that spectrum's panel received -- and the second is
            // the dialog, so a document that never received the reservation can
            // never open one.
            "begin_selected_spectrum_export",
            "save_selected_spectrum_export",
            // The chromatogram export, in the same two-phase shape. The first
            // command binds which run, how much of it and which traces -- all of
            // them fixed at that moment, so a viewport that moves while the
            // dialog is open cannot change what is written -- and the second is
            // the dialog. They share the one scientific export lane with the
            // spectrum commands above, so two save dialogs cannot be open at
            // once whichever surface asked.
            "begin_chromatogram_export",
            // The linked two-panel figure: a third *surface* over the two
            // sources above, and not a third lane. It takes both tokens at
            // once, because what it draws is the pair, and it shares the same
            // one scientific export lane -- so while one of these is running
            // neither the spectrum nor the chromatogram may start an export of
            // its own. There is no linked data command: a combined table would
            // have to interleave two different measurements or drop the link.
            "begin_linked_figure_export",
            "copy_linked_plot",
            "save_linked_figure_export",
            "save_chromatogram_export",
            "copy_chromatogram_plot",
            // Copy plot needs neither phase: there is no destination to choose,
            // so there is no dialog to gate and nothing to come back from. It
            // takes the same token, shares the same one figure-operation lane,
            // and answers whether the clipboard was written.
            "copy_selected_spectrum_plot",
        ]
    );
    // The picker command is named for the workspace it fills rather than for
    // one format, because it now admits two families and `choose_mzml_files`
    // had become a name that said something false about what it does.
    assert!(
        !registered.contains(&"choose_mzml_files"),
        "the picker's old name is retired, not kept beside the truthful one"
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
            api.contains(&format!("\"{name}\"")) || drop_transport.contains(&format!("\"{name}\"")),
            "the frontend never calls {name}"
        );
    }
    assert!(
        !api.contains("\"choose_mzml_file\""),
        "the frontend must not call a command that no longer exists"
    );

    // No command takes a path from JavaScript. Native adapters may of course
    // own PathBuf internally, so inspect only the registered signatures.
    for name in &registered {
        let marker = format!("fn {name}(");
        let signature = host
            .split_once(&marker)
            .unwrap_or_else(|| panic!("the host defines {name}"))
            .1
            .split_once('{')
            .expect("the command signature is followed by a body")
            .0;
        assert!(!signature.contains("PathBuf"), "{name} accepts a PathBuf");
        assert!(!signature.contains("path:"), "{name} accepts a path");
        assert!(!signature.contains("paths:"), "{name} accepts paths");
    }

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

#[test]
fn drop_subscription_uses_only_tauris_typed_nested_channel_wire_shape() {
    let host = include_str!("../lib.rs");
    let request = host
        .split_once("enum WorkspaceDropSubscriptionRequest")
        .expect("the command has one typed phase request")
        .1
        .split_once("/// Begins or claims")
        .expect("the request ends before the command")
        .0;
    let command = host
        .split_once("fn subscribe_workspace_drop_updates(")
        .expect("the one production subscription command exists")
        .1
        .split_once("/// Removes the rows")
        .expect("the command ends before the next operation")
        .0;

    assert!(request.contains("Begin,"));
    assert_eq!(request.matches("channel: JavaScriptChannelId").count(), 1);
    assert!(!request.contains("channel: String"));
    assert!(command.contains("channel.channel_on(webview)"));
    assert!(command.contains("ipc_request: tauri::ipc::Request<'_>"));
    assert!(command.contains("DROP_DOCUMENT_AUTHORITY_HEADER"));
    assert!(command.contains("verify_drop_document_authority(&webview, &authority).await?"));
    assert!(command.contains("if webview.label() != \"main\""));
    assert!(!command.contains("JavaScriptChannelId::from_str"));
    assert!(!command.contains("event_name"));
    assert!(!command.contains("callback_id"));

    let label_guard = command
        .find("if webview.label() != \"main\"")
        .expect("non-main webviews fail before authority work");
    let header = command
        .find(".get(DROP_DOCUMENT_AUTHORITY_HEADER)")
        .expect("the document authority comes from the invoke header");
    let epoch = command
        .find("service.workspace_drop_document_epoch()")
        .expect("the command captures the native document epoch");
    let challenge = command
        .find("verify_drop_document_authority(&webview, &authority).await?")
        .expect("the current realm must prove the captured header");
    let phase = command
        .find("match request")
        .expect("only a verified request reaches either phase");
    assert!(label_guard < header && header < epoch && epoch < challenge && challenge < phase);

    assert!(
        "__CHANNEL__:7"
            .parse::<tauri::ipc::JavaScriptChannelId>()
            .is_ok(),
        "the accepted nested value is Tauri's exact Channel wire shape"
    );
    for arbitrary in ["7", "workspace-drop", "callback-7", "__CHANNEL__:not-a-u32"] {
        assert!(
            arbitrary
                .parse::<tauri::ipc::JavaScriptChannelId>()
                .is_err(),
            "an arbitrary string is not a typed Tauri Channel: {arbitrary}"
        );
    }

    let hub = include_str!("drop_ingestion.rs");
    let begin = hub
        .split_once("pub(super) fn begin_subscription")
        .expect("the begin phase exists")
        .1
        .split_once("/// Consumes one exact")
        .expect("begin ends before claim")
        .0;
    assert!(!begin.contains("Channel"));
    assert!(!begin.contains("subscriber ="));
}

#[test]
fn document_authority_is_per_document_bounded_and_checked_before_subscription() {
    let initialization = crate::DROP_DOCUMENT_AUTHORITY_INITIALIZATION_SCRIPT;
    assert!(
        initialization.trim_start().starts_with(';'),
        "the appended script must not call the preceding Tauri IIFE result"
    );
    assert!(initialization.contains("new Uint32Array(4)"));
    assert!(initialization.contains("globalThis.crypto.getRandomValues(words)"));
    assert!(initialization.contains("Object.defineProperty(globalThis"));
    for sealed in [
        "configurable: false",
        "enumerable: false",
        "writable: false",
    ] {
        assert!(initialization.contains(sealed));
    }
    for forbidden in ["path", "root", "identity", "position", "console."] {
        assert!(!initialization.contains(forbidden), "{forbidden}");
    }

    let authority = "0123456789abcdef0123456789abcdef";
    assert_eq!(
        crate::drop_document_authority_check_script(authority).as_deref(),
        Some("globalThis.__MSCANVAS_DOCUMENT_AUTHORITY__ === \"0123456789abcdef0123456789abcdef\"")
    );
    for malformed in [
        "",
        "0123456789abcdef0123456789abcde",
        "0123456789abcdef0123456789abcdef0",
        "0123456789abcdef0123456789abcdeg",
        "0123456789ABCDEF0123456789ABCDEF",
        "../../0123456789abcdef0123456789",
    ] {
        assert!(
            crate::drop_document_authority_check_script(malformed).is_none(),
            "malformed document authority was interpolated: {malformed}"
        );
    }

    let host = include_str!("../lib.rs");
    let builder = host
        .split_once("tauri::Builder::default()")
        .expect("the application builder exists")
        .1;
    let initialize = builder
        .find(".append_invoke_initialization_script(DROP_DOCUMENT_AUTHORITY_INITIALIZATION_SCRIPT)")
        .expect("every document receives the authority initializer");
    let managed = builder
        .find(".manage(SharedService::new")
        .expect("the service is installed after the initializer");
    assert!(initialize < managed);
}

// ---------------------------------------------------------------------------
// Native Explorer drop boundary
// ---------------------------------------------------------------------------

fn native_window_hook_source() -> &'static str {
    include_str!("../lib.rs")
        .split_once(".on_window_event(")
        .expect("the host installs a native window-event hook")
        .1
        .split_once(".on_page_load(")
        .expect("the native hook ends before page-load handling")
        .0
}

#[test]
fn native_drop_hook_ignores_non_main_windows() {
    let hook = native_window_hook_source();
    let label_guard = hook
        .find("if window.label() != \"main\"")
        .expect("the native hook rejects every non-main window");
    let normalization = hook
        .find("normalize_window_drop_event(event)")
        .expect("the guarded event enters the private adapter");
    assert!(label_guard < normalization);
    assert!(
        hook[label_guard..normalization].contains("return;"),
        "the non-main branch exits before reading drag data"
    );
}

#[test]
fn native_drop_hook_offloads_every_dispatch_before_service_processing() {
    let hook = native_window_hook_source();
    let spawn = hook
        .find("spawn_blocking(move ||")
        .expect("every owned dispatch crosses to a blocking worker");
    let reserve = hook
        .find("reserve_native_drop_signal(signal)")
        .expect("the callback performs only the atomic reservation");
    let process = hook
        .find("process_native_drop_dispatch(dispatch)")
        .expect("the worker processes the owned dispatch");
    assert!(reserve < spawn && spawn < process);
    let callback_prefix = &hook[..spawn];
    assert!(!callback_prefix.contains("process_native_drop_dispatch"));
    assert!(!callback_prefix.contains("process_native_drop_with"));
    assert!(!callback_prefix.contains("begin_delivery"));
    assert!(!callback_prefix.contains("enter_workspace_mutation"));
}

#[test]
fn native_drop_hook_never_formats_or_logs_the_native_event() {
    let hook = native_window_hook_source();
    for forbidden in [
        "format!(",
        "println!(",
        "eprintln!(",
        "dbg!(",
        "tracing::",
        "log::",
    ] {
        assert!(
            !hook.contains(forbidden),
            "native hook contains {forbidden}"
        );
    }
}

#[test]
fn locked_wry_runtime_routes_main_drag_drop_through_window_events() {
    let lock = include_str!("../../../../../Cargo.lock");
    let runtime_wry = lock
        .split("[[package]]")
        .find(|package| package.contains("name = \"tauri-runtime-wry\""))
        .expect("the lockfile includes tauri-runtime-wry");
    assert!(runtime_wry.contains("version = \"2.11.4\""));

    let host = include_str!("../lib.rs");
    assert!(host.contains(".on_window_event("));
    assert!(!host.contains(".on_webview_event("));
    assert!(native_window_hook_source().contains("normalize_window_drop_event(event)"));
}

#[test]
fn native_drag_drop_remains_enabled_for_the_main_window() {
    let config: serde_json::Value =
        serde_json::from_str(include_str!("../../tauri.conf.json")).expect("Tauri config parses");
    let main = config["app"]["windows"]
        .as_array()
        .and_then(|windows| windows.first())
        .expect("the configured main window exists");
    assert!(
        main.get("label").is_none() || main["label"] == "main",
        "the first configured window uses Tauri's default main label"
    );
    assert_ne!(
        main.get("dragDropEnabled")
            .and_then(serde_json::Value::as_bool),
        Some(false),
        "native Tauri drag-and-drop must not be disabled"
    );
}

#[test]
fn native_adapter_keeps_forward_compatible_non_exhaustive_wildcards() {
    let source = include_str!("drop_ingestion.rs");
    let adapter = source
        .split_once("pub(crate) fn normalize_window_drop_event")
        .expect("the private adapter is present")
        .1
        .split_once("/// Accepted native-drop work")
        .expect("the adapter ends before owned work")
        .0;
    assert_eq!(
        adapter.matches("_ => None").count(),
        2,
        "both non-exhaustive Tauri enums fail closed"
    );
}

type CapturedDropMessages = Arc<Mutex<Vec<serde_json::Value>>>;

fn recording_drop_channel() -> (
    tauri::ipc::Channel<WorkspaceDropUpdateDto>,
    CapturedDropMessages,
) {
    let messages = CapturedDropMessages::default();
    let captured = Arc::clone(&messages);
    let channel = tauri::ipc::Channel::new(move |body| {
        let message = body
            .deserialize::<serde_json::Value>()
            .expect("the typed Channel message is JSON");
        captured
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(message);
        Ok(())
    });
    (channel, messages)
}

fn begin_drop_subscription(service: &PreviewService) -> String {
    let document_epoch = service.workspace_drop_document_epoch();
    service
        .begin_workspace_drop_subscription(document_epoch)
        .expect("the current document begins its drop subscription")
        .reservation_id
}

fn claim_drop_subscription(
    service: &PreviewService,
    reservation_id: &str,
    channel: tauri::ipc::Channel<WorkspaceDropUpdateDto>,
) -> Result<(), PreviewErrorDto> {
    let document_epoch = service.workspace_drop_document_epoch();
    service.claim_workspace_drop_subscription(document_epoch, reservation_id, channel)
}

fn subscribe_drop(service: &PreviewService, channel: tauri::ipc::Channel<WorkspaceDropUpdateDto>) {
    let reservation_id = begin_drop_subscription(service);
    claim_drop_subscription(service, &reservation_id, channel)
        .expect("the current document claims its exact drop subscription");
}

fn captured(messages: &CapturedDropMessages) -> Vec<serde_json::Value> {
    messages
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone()
}

fn status(message: &serde_json::Value) -> &str {
    message["state"]["status"]
        .as_str()
        .expect("every drop state has a status")
}

fn process_drop_signal(service: &PreviewService, signal: NativeDropSignal<'_>) {
    if let Some(dispatch) = service.reserve_native_drop_signal(signal) {
        service.process_native_drop_dispatch(dispatch);
    }
}

fn reserve_drop_work(service: &PreviewService, paths: &[PathBuf]) -> NativeDropWork {
    match service
        .reserve_native_drop_signal(NativeDropSignal::Drop { paths })
        .expect("a native Drop always creates a dispatch")
    {
        NativeDropDispatch::Start(work) => work,
        NativeDropDispatch::Busy { .. } => panic!("the drop claim was unexpectedly busy"),
        NativeDropDispatch::ConversionBusy => panic!("no conversion is running in this test"),
        NativeDropDispatch::Enter { .. } | NativeDropDispatch::Leave { .. } => {
            panic!("a Drop cannot normalize to hover or leave")
        }
    }
}

fn spawn_blocked_drop(
    service: &Arc<PreviewService>,
    paths: &[PathBuf],
) -> (
    mpsc::Receiver<()>,
    mpsc::Sender<()>,
    std::thread::JoinHandle<Option<DropIngestionResultDto>>,
) {
    let work = reserve_drop_work(service, paths);
    let (started_tx, started_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let worker_service = Arc::clone(service);
    let worker = std::thread::spawn(move || {
        worker_service.process_native_drop_with(work, move |_| {
            started_tx.send(()).expect("report drop expansion start");
            release_rx.recv().expect("release drop expansion");
            Ok(DropBatch {
                candidates: Vec::new(),
                summary: DropIngestionSummary::default(),
            })
        })
    });
    (started_rx, release_tx, worker)
}

#[test]
fn native_drop_signals_never_debug_paths_or_positions() {
    let secret = PathBuf::from(r"C:\Users\private\sample.mzML");
    let rendered = format!(
        "{:?}",
        NativeDropSignal::Drop {
            paths: std::slice::from_ref(&secret)
        }
    );

    assert_eq!(rendered, "Drop { item_count: 1 }");
    assert!(!rendered.contains(&secret.to_string_lossy().to_string()));
    assert_eq!(format!("{:?}", NativeDropSignal::Over), "Over");
}

#[test]
fn native_window_adapter_normalizes_all_four_drag_states_without_copying_paths_or_positions() {
    let paths = vec![
        PathBuf::from(r"C:\private\one.mzML"),
        PathBuf::from(r"D:\two"),
    ];
    let enter = tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Enter {
        paths: paths.clone(),
        position: tauri::PhysicalPosition::new(17.25, 91.5),
    });
    assert!(matches!(
        normalize_window_drop_event(&enter),
        Some(NativeDropSignal::Enter { item_count: 2 })
    ));

    let over = tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Over {
        position: tauri::PhysicalPosition::new(-400.0, 8_000.0),
    });
    assert!(matches!(
        normalize_window_drop_event(&over),
        Some(NativeDropSignal::Over)
    ));

    let dropped = tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop {
        paths,
        position: tauri::PhysicalPosition::new(f64::MAX, f64::MIN),
    });
    let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop {
        paths: event_paths, ..
    }) = &dropped
    else {
        unreachable!("the fixture is a Drop")
    };
    let Some(NativeDropSignal::Drop {
        paths: normalized_paths,
    }) = normalize_window_drop_event(&dropped)
    else {
        panic!("Drop is normalized")
    };
    assert_eq!(normalized_paths.as_ptr(), event_paths.as_ptr());
    assert_eq!(normalized_paths.len(), event_paths.len());

    let leave = tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Leave);
    assert!(matches!(
        normalize_window_drop_event(&leave),
        Some(NativeDropSignal::Leave)
    ));
    assert!(normalize_window_drop_event(&tauri::WindowEvent::Focused(true)).is_none());
}

#[test]
fn native_drop_callback_reservation_does_not_wait_for_held_service_gates() {
    let service = Arc::new(PreviewService::new(Box::new(NoProcess)));
    let (gates_started_tx, gates_started_rx) = mpsc::channel();
    let (gates_release_tx, gates_release_rx) = mpsc::channel();
    let holder_service = Arc::clone(&service);
    let holder = std::thread::spawn(move || {
        holder_service.hold_drop_gates_for_test(gates_started_tx, gates_release_rx);
    });
    gates_started_rx
        .recv_timeout(Duration::from_secs(2))
        .expect("both formerly callback-blocking gates are held");

    let (callback_tx, callback_rx) = mpsc::channel();
    let callback_service = Arc::clone(&service);
    let callback = std::thread::spawn(move || {
        let private = vec![PathBuf::from(r"C:\private\accepted.mzML")];
        callback_tx
            .send(
                callback_service
                    .reserve_native_drop_signal(NativeDropSignal::Drop { paths: &private }),
            )
            .expect("return callback result");
    });
    let accepted = callback_rx
        .recv_timeout(Duration::from_millis(250))
        .expect("atomic callback reservation cannot wait for either held gate")
        .expect("Drop creates a dispatch");
    assert!(matches!(&accepted, NativeDropDispatch::Start(_)));

    let rejected = vec![PathBuf::from(r"C:\private\rejected.mzML")];
    let busy = service
        .reserve_native_drop_signal(NativeDropSignal::Drop { paths: &rejected })
        .expect("a concurrent Drop is represented by a path-free dispatch");
    assert_eq!(format!("{busy:?}"), "Busy");
    assert!(!format!("{busy:?}").contains("rejected.mzML"));

    drop(accepted);
    drop(busy);
    callback.join().expect("callback probe joins");
    gates_release_tx.send(()).expect("release held gates");
    holder.join().expect("gate holder joins");
    service.begin_webview_document();
}

#[test]
fn inverse_hover_leave_workers_cannot_resurrect_hovering() {
    let service = PreviewService::new(Box::new(NoProcess));
    let (channel, messages) = recording_drop_channel();
    subscribe_drop(&service, channel);

    let enter = service
        .reserve_native_drop_signal(NativeDropSignal::Enter { item_count: 2 })
        .expect("Enter creates a dispatch");
    let leave = service
        .reserve_native_drop_signal(NativeDropSignal::Leave)
        .expect("Leave creates a dispatch");
    service.process_native_drop_dispatch(leave);
    service.process_native_drop_dispatch(enter);

    let messages = captured(&messages);
    assert_eq!(
        messages.iter().map(status).collect::<Vec<_>>(),
        vec!["idle", "idle"]
    );
    assert!(messages.iter().all(|message| status(message) != "hovering"));
}

#[test]
fn native_over_is_silent_even_when_repeated() {
    let service = PreviewService::new(Box::new(NoProcess));
    let (channel, messages) = recording_drop_channel();
    subscribe_drop(&service, channel);
    process_drop_signal(&service, NativeDropSignal::Enter { item_count: 1 });
    let before_over = captured(&messages);

    for _ in 0..1_000 {
        assert!(
            service
                .reserve_native_drop_signal(NativeDropSignal::Over)
                .is_none()
        );
    }
    assert_eq!(captured(&messages), before_over);
}

#[test]
fn native_drop_callback_bounds_owned_roots_without_losing_true_batch_summary() {
    for top_level_item_count in [MAX_DROP_ROOTS - 1, MAX_DROP_ROOTS, MAX_DROP_ROOTS + 1] {
        let service = PreviewService::new(Box::new(NoProcess));
        let paths = (0..top_level_item_count)
            .map(|index| PathBuf::from(format!(r"C:\private\root-{index}")))
            .collect::<Vec<_>>();
        let work = reserve_drop_work(&service, &paths);
        assert_eq!(
            format!("{work:?}"),
            format!("NativeDropWork {{ item_count: {top_level_item_count} }}")
        );

        let mut owned_root_count = None;
        let result = service
            .process_native_drop_with(work, |owned| {
                owned_root_count = Some(owned.len());
                Ok(DropBatch {
                    candidates: Vec::new(),
                    summary: DropIngestionSummary::default(),
                })
            })
            .expect("the bounded synthetic expansion completes");
        assert_eq!(
            owned_root_count,
            Some(top_level_item_count.min(MAX_DROP_ROOTS))
        );
        assert_eq!(result.summary.top_level_item_count, top_level_item_count);
        if top_level_item_count > MAX_DROP_ROOTS {
            assert_eq!(result.summary.limits_reached, vec![DropScanLimitDto::Roots]);
            assert!(!result.summary.complete);
        } else {
            assert!(result.summary.limits_reached.is_empty());
            assert!(result.summary.complete);
        }
    }
}

#[test]
fn second_drop_is_reported_once_before_terminal_even_when_its_worker_runs_late() {
    let service = Arc::new(PreviewService::new(Box::new(NoProcess)));
    let (channel, messages) = recording_drop_channel();
    subscribe_drop(&service, channel);
    let (started, release, worker) = spawn_blocked_drop(&service, &[]);
    started
        .recv_timeout(Duration::from_secs(2))
        .expect("the first drop is importing");

    let private = vec![PathBuf::from(r"C:\private\second.mzML")];
    let late_busy_workers = (0..128)
        .map(|_| {
            service
                .reserve_native_drop_signal(NativeDropSignal::Drop { paths: &private })
                .expect("every extra Drop is explicitly handled")
        })
        .collect::<Vec<_>>();

    release.send(()).expect("finish the first drop");
    assert!(
        worker
            .join()
            .expect("the first drop worker joins")
            .is_some()
    );
    for dispatch in late_busy_workers {
        service.process_native_drop_dispatch(dispatch);
    }

    let messages = captured(&messages);
    let statuses = messages.iter().map(status).collect::<Vec<_>>();
    assert_eq!(statuses, vec!["idle", "importing", "rejected", "completed"]);
    assert_eq!(
        statuses
            .iter()
            .filter(|status| **status == "rejected")
            .count(),
        1,
        "a busy storm occupies one bounded bit and cannot flood the channel"
    );
    let serialized = serde_json::to_string(&messages).expect("messages serialize");
    assert!(!serialized.contains("second.mzML"));
}

#[test]
fn native_drop_expansion_holds_neither_workspace_nor_mutation_lock() {
    let service = PreviewService::new(Box::new(NoProcess));
    let work = reserve_drop_work(&service, &[]);
    let result = service.process_native_drop_with(work, |_| {
        service.assert_drop_scan_locks_available_for_test();
        Ok(DropBatch {
            candidates: Vec::new(),
            summary: DropIngestionSummary::default(),
        })
    });
    assert!(result.is_some());
}

#[test]
fn remove_supersedes_an_active_native_drop() {
    let service = Arc::new(PreviewService::new(Box::new(NoProcess)));
    let (started, release, worker) = spawn_blocked_drop(&service, &[]);
    started
        .recv_timeout(Duration::from_secs(2))
        .expect("the native drop reaches its unlocked scan");

    let removal = service.remove_datasets_now(&["file-does-not-exist".to_owned()]);
    assert!(removal.removed_handles.is_empty());
    assert_eq!(removal.unknown_handles, vec!["file-does-not-exist"]);
    release.send(()).expect("release the superseded scan");
    assert!(
        worker.join().expect("drop worker joins").is_none(),
        "Remove supersedes even when its handle names no current row"
    );
}

#[test]
fn add_folder_and_roster_operations_wait_for_an_active_native_drop() {
    let service = Arc::new(PreviewService::new(Box::new(NoProcess)));
    let (started, release, worker) = spawn_blocked_drop(&service, &[]);
    started
        .recv_timeout(Duration::from_secs(2))
        .expect("the native drop reaches its unlocked scan");

    let (add_tx, add_rx) = mpsc::channel();
    let add_service = Arc::clone(&service);
    let add = std::thread::spawn(move || {
        let result = add_service.add_files_now(&[]);
        add_tx.send(result).expect("return Add files result");
    });
    let (folder_tx, folder_rx) = mpsc::channel();
    let folder_service = Arc::clone(&service);
    let folder = std::thread::spawn(move || {
        let reservation = folder_service.begin_folder_import_now();
        folder_tx
            .send(reservation)
            .expect("return folder reservation");
    });
    let (roster_tx, roster_rx) = mpsc::channel();
    let roster_service = Arc::clone(&service);
    let roster = std::thread::spawn(move || {
        let result = roster_service.roster();
        roster_tx.send(result).expect("return roster");
    });

    assert!(add_rx.recv_timeout(Duration::from_millis(100)).is_err());
    assert!(folder_rx.recv_timeout(Duration::from_millis(100)).is_err());
    assert!(roster_rx.recv_timeout(Duration::from_millis(100)).is_err());

    release.send(()).expect("finish native drop");
    assert!(worker.join().expect("drop worker joins").is_some());
    assert!(
        add_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("Add files resumes")
            .outcomes
            .is_empty()
    );
    folder_rx
        .recv_timeout(Duration::from_secs(2))
        .expect("folder reservation resumes");
    assert!(
        roster_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("roster resumes")
            .datasets
            .is_empty()
    );
    add.join().expect("Add files probe joins");
    folder.join().expect("folder probe joins");
    roster.join().expect("roster probe joins");
}

#[test]
fn page_load_supersedes_an_active_native_drop_and_clears_subscriber() {
    let service = Arc::new(PreviewService::new(Box::new(NoProcess)));
    let (old_channel, old_messages) = recording_drop_channel();
    subscribe_drop(&service, old_channel);
    let (started, release, worker) = spawn_blocked_drop(&service, &[]);
    started
        .recv_timeout(Duration::from_secs(2))
        .expect("the old document owns an importing drop");
    let before_load = captured(&old_messages);

    service.begin_webview_document();
    release.send(()).expect("release the old worker");
    assert!(worker.join().expect("old worker joins").is_none());
    process_drop_signal(&service, NativeDropSignal::Enter { item_count: 1 });
    assert_eq!(captured(&old_messages), before_load);

    let (new_channel, new_messages) = recording_drop_channel();
    subscribe_drop(&service, new_channel);
    assert_eq!(status(&captured(&new_messages)[0]), "hovering");
}

#[test]
fn a_delayed_old_subscription_cannot_replace_the_new_document_channel() {
    let service = PreviewService::new(Box::new(NoProcess));
    let old_reservation = begin_drop_subscription(&service);
    service.begin_webview_document();

    let new_reservation = begin_drop_subscription(&service);
    let (new_channel, new_messages) = recording_drop_channel();
    claim_drop_subscription(&service, &new_reservation, new_channel)
        .expect("the replacement document claims its reservation");
    let (delayed_old_channel, delayed_old_messages) = recording_drop_channel();
    let error = claim_drop_subscription(&service, &old_reservation, delayed_old_channel)
        .expect_err("the old document cannot claim after page-load start");
    assert_eq!(error.kind, "invalid_workspace_drop_subscription");

    process_drop_signal(&service, NativeDropSignal::Enter { item_count: 1 });

    assert_eq!(
        captured(&new_messages)
            .iter()
            .map(status)
            .collect::<Vec<_>>(),
        vec!["idle", "hovering"]
    );
    assert!(captured(&delayed_old_messages).is_empty());
}

#[test]
fn page_load_rejects_a_verified_old_epoch_without_consuming_the_new_subscription() {
    let service = PreviewService::new(Box::new(NoProcess));
    let old_document_epoch = service.workspace_drop_document_epoch();
    service.begin_webview_document();
    let new_document_epoch = service.workspace_drop_document_epoch();
    let new_reservation = service
        .begin_workspace_drop_subscription(new_document_epoch)
        .expect("the replacement document begins its subscription")
        .reservation_id;

    let error = service
        .begin_workspace_drop_subscription(old_document_epoch)
        .expect_err("a Begin verified before page load cannot execute afterwards");
    assert_eq!(error.kind, "invalid_workspace_drop_subscription");

    let (old_channel, old_messages) = recording_drop_channel();
    let error = service
        .claim_workspace_drop_subscription(old_document_epoch, &new_reservation, old_channel)
        .expect_err("a Claim verified before page load cannot consume the new slot");
    assert_eq!(error.kind, "invalid_workspace_drop_subscription");
    assert!(captured(&old_messages).is_empty());

    let (new_channel, new_messages) = recording_drop_channel();
    service
        .claim_workspace_drop_subscription(new_document_epoch, &new_reservation, new_channel)
        .expect("the replacement document still owns its exact slot");
    assert_eq!(status(&captured(&new_messages)[0]), "idle");
}

#[test]
fn delayed_begin_reuses_pending_and_never_displaces_an_installed_subscriber() {
    let service = PreviewService::new(Box::new(NoProcess));
    service.begin_webview_document();

    let current_begin = begin_drop_subscription(&service);
    let delayed_begin = begin_drop_subscription(&service);
    assert_eq!(delayed_begin, current_begin);

    let (channel, messages) = recording_drop_channel();
    claim_drop_subscription(&service, &current_begin, channel)
        .expect("the shared same-epoch reservation is current");
    let after_claim_begin = begin_drop_subscription(&service);
    assert_ne!(after_claim_begin, current_begin);
    assert_eq!(begin_drop_subscription(&service), after_claim_begin);

    process_drop_signal(&service, NativeDropSignal::Enter { item_count: 2 });
    assert_eq!(
        captured(&messages).iter().map(status).collect::<Vec<_>>(),
        vec!["idle", "hovering"]
    );
}

#[test]
fn a_wrong_drop_subscription_handle_does_not_consume_the_current_slot() {
    let service = PreviewService::new(Box::new(NoProcess));
    let reservation = begin_drop_subscription(&service);
    let (wrong_channel, wrong_messages) = recording_drop_channel();

    let error = claim_drop_subscription(
        &service,
        "drop-subscription-reservation-18446744073709551615",
        wrong_channel,
    )
    .expect_err("an unknown reservation is refused");
    assert_eq!(error.kind, "invalid_workspace_drop_subscription");
    assert!(captured(&wrong_messages).is_empty());

    let (current_channel, current_messages) = recording_drop_channel();
    claim_drop_subscription(&service, &reservation, current_channel)
        .expect("the exact reservation remains claimable");
    assert_eq!(status(&captured(&current_messages)[0]), "idle");
}

#[test]
fn page_load_invalidates_an_enter_dispatch_queued_by_the_old_document() {
    let service = PreviewService::new(Box::new(NoProcess));
    let old_enter = service
        .reserve_native_drop_signal(NativeDropSignal::Enter { item_count: 1 })
        .expect("Enter produces one queued dispatch");

    service.begin_webview_document();
    let (new_channel, new_messages) = recording_drop_channel();
    subscribe_drop(&service, new_channel);
    service.process_native_drop_dispatch(old_enter);

    assert_eq!(
        captured(&new_messages)
            .iter()
            .map(status)
            .collect::<Vec<_>>(),
        vec!["idle"]
    );
}

#[test]
fn page_load_invalidates_a_leave_dispatch_queued_by_the_old_document() {
    let service = PreviewService::new(Box::new(NoProcess));
    process_drop_signal(&service, NativeDropSignal::Enter { item_count: 1 });
    let old_leave = service
        .reserve_native_drop_signal(NativeDropSignal::Leave)
        .expect("Leave produces one queued dispatch");

    service.begin_webview_document();
    let (new_channel, new_messages) = recording_drop_channel();
    subscribe_drop(&service, new_channel);
    service.process_native_drop_dispatch(old_leave);

    assert_eq!(
        captured(&new_messages)
            .iter()
            .map(status)
            .collect::<Vec<_>>(),
        vec!["idle"]
    );
}

#[test]
fn replacing_drop_subscriber_leaves_exactly_one_live_channel() {
    let service = PreviewService::new(Box::new(NoProcess));
    let (first_channel, first_messages) = recording_drop_channel();
    subscribe_drop(&service, first_channel);
    let first_before_replacement = captured(&first_messages);

    let (replacement_channel, replacement_messages) = recording_drop_channel();
    subscribe_drop(&service, replacement_channel);
    process_drop_signal(&service, NativeDropSignal::Enter { item_count: 4 });

    assert_eq!(captured(&first_messages), first_before_replacement);
    assert_eq!(
        captured(&replacement_messages)
            .iter()
            .map(status)
            .collect::<Vec<_>>(),
        vec!["idle", "hovering"]
    );
}

#[test]
fn actual_channel_orders_hover_busy_replacement_clear_and_reload() {
    let service = Arc::new(PreviewService::new(Box::new(NoProcess)));
    let (first_channel, first_messages) = recording_drop_channel();
    subscribe_drop(&service, first_channel);

    process_drop_signal(&service, NativeDropSignal::Enter { item_count: 3 });
    assert!(
        service
            .reserve_native_drop_signal(NativeDropSignal::Over)
            .is_none(),
        "Over is intentionally silent"
    );
    let work = reserve_drop_work(&service, &[]);
    let (scan_started_tx, scan_started_rx) = mpsc::channel();
    let (scan_release_tx, scan_release_rx) = mpsc::channel();
    let worker_service = Arc::clone(&service);
    let worker = std::thread::spawn(move || {
        worker_service.process_native_drop_with(work, move |_| {
            scan_started_tx.send(()).expect("report scan start");
            scan_release_rx.recv().expect("release scan");
            Ok(DropBatch {
                candidates: Vec::new(),
                summary: DropIngestionSummary::default(),
            })
        })
    });
    scan_started_rx
        .recv_timeout(Duration::from_secs(2))
        .expect("the first drop reaches its unlocked scan");

    let rejected_paths = vec![PathBuf::from(r"C:\private\must-not-cross.mzML")];
    let busy = service
        .reserve_native_drop_signal(NativeDropSignal::Drop {
            paths: &rejected_paths,
        })
        .expect("a second Drop produces an explicit rejection dispatch");
    assert!(matches!(&busy, NativeDropDispatch::Busy { .. }));
    assert_eq!(format!("{busy:?}"), "Busy");
    service.process_native_drop_dispatch(busy);

    let first = captured(&first_messages);
    assert_eq!(
        first.iter().map(status).collect::<Vec<_>>(),
        vec!["idle", "hovering", "importing", "rejected"]
    );
    assert_eq!(first[1]["state"]["itemCount"], 3);
    assert_eq!(first[2]["state"]["operationId"], "1");
    assert_eq!(first[3]["state"]["reason"], "drop_busy");
    assert_eq!(
        first
            .iter()
            .map(|message| message["sequence"].as_u64().expect("sequence"))
            .collect::<Vec<_>>(),
        vec![1, 2, 3, 4]
    );
    assert!(
        !serde_json::to_string(&first)
            .expect("messages serialize")
            .contains("must-not-cross"),
        "busy transport retains no path from the rejected drop"
    );
    for message in &first {
        assert_drop_json_is_path_free(message, &[Path::new(r"C:\private")]);
    }

    let (replacement_channel, replacement_messages) = recording_drop_channel();
    subscribe_drop(&service, replacement_channel);
    let replacement = captured(&replacement_messages);
    assert_eq!(replacement.len(), 1);
    assert_eq!(status(&replacement[0]), "importing");
    assert_eq!(replacement[0]["sequence"], 5);

    assert!(service.clear_workspace_now().datasets.is_empty());
    let after_clear = captured(&replacement_messages);
    assert_eq!(
        status(after_clear.last().expect("clear publishes idle")),
        "idle"
    );
    assert_eq!(after_clear.last().expect("clear update")["sequence"], 6);
    assert!(
        {
            scan_release_tx.send(()).expect("release superseded scan");
            worker.join().expect("drop worker joins").is_none()
        },
        "the superseded worker cannot publish completion"
    );
    assert_eq!(captured(&replacement_messages), after_clear);

    service.begin_webview_document();
    process_drop_signal(&service, NativeDropSignal::Enter { item_count: 1 });
    assert_eq!(
        captured(&replacement_messages),
        after_clear,
        "the previous document's subscriber is cleared before later events"
    );
    let (new_document_channel, new_document_messages) = recording_drop_channel();
    subscribe_drop(&service, new_document_channel);
    let new_document = captured(&new_document_messages);
    assert_eq!(status(&new_document[0]), "hovering");
    assert_eq!(new_document[0]["sequence"], 8);
}

#[test]
fn channel_send_failure_removes_only_that_subscriber_and_never_fails_ingestion() {
    use std::sync::atomic::{AtomicUsize, Ordering};

    let service = PreviewService::new(Box::new(NoProcess));
    let attempts = Arc::new(AtomicUsize::new(0));
    let observed = Arc::clone(&attempts);
    subscribe_drop(
        &service,
        tauri::ipc::Channel::new(move |_| {
            observed.fetch_add(1, Ordering::Relaxed);
            Err(tauri::Error::FailedToReceiveMessage)
        }),
    );
    assert_eq!(attempts.load(Ordering::Relaxed), 1);

    process_drop_signal(&service, NativeDropSignal::Enter { item_count: 2 });
    assert_eq!(
        attempts.load(Ordering::Relaxed),
        1,
        "a failed subscriber is removed immediately"
    );

    let (replacement, messages) = recording_drop_channel();
    subscribe_drop(&service, replacement);
    assert_eq!(status(&captured(&messages)[0]), "hovering");
    let work = reserve_drop_work(&service, &[]);
    let result = service
        .process_native_drop_with(work, |_| {
            Ok(DropBatch {
                candidates: Vec::new(),
                summary: DropIngestionSummary::default(),
            })
        })
        .expect("channel delivery is not the ingestion result");
    assert!(result.roster.datasets.is_empty());
    assert_eq!(
        status(captured(&messages).last().expect("terminal update")),
        "completed"
    );
    let terminal = captured(&messages)
        .into_iter()
        .last()
        .expect("completion is delivered");
    assert_eq!(terminal["state"]["operationId"], "1");
    assert_eq!(
        terminal["state"]["result"]["summary"]["workspaceWasEmpty"],
        true
    );
    assert_eq!(terminal["state"]["result"]["summary"]["complete"], true);
    assert_drop_json_is_path_free(&terminal, &[]);
}

#[test]
fn failed_drop_channel_state_keeps_operation_id_and_preview_error_required() {
    let service = PreviewService::new(Box::new(NoProcess));
    let (channel, messages) = recording_drop_channel();
    subscribe_drop(&service, channel);
    let work = reserve_drop_work(&service, &[]);
    assert!(
        service
            .process_native_drop_with(work, |_| {
                Err(PreviewErrorDto::new(
                    "synthetic_drop_failure",
                    "Synthetic drop failure.",
                    true,
                ))
            })
            .is_none()
    );

    let messages = captured(&messages);
    assert_eq!(
        messages.iter().map(status).collect::<Vec<_>>(),
        vec!["idle", "importing", "failed"]
    );
    let failed = &messages[2]["state"];
    assert_eq!(failed["operationId"], "1");
    assert_eq!(failed["error"]["kind"], "synthetic_drop_failure");
    assert_eq!(failed["error"]["retryable"], true);
    assert_drop_json_is_path_free(&messages[2], &[]);
}

fn assert_drop_json_is_path_free(value: &serde_json::Value, private_roots: &[&Path]) {
    match value {
        serde_json::Value::Object(fields) => {
            for (key, value) in fields {
                assert!(
                    !matches!(
                        key.as_str(),
                        "path"
                            | "paths"
                            | "root"
                            | "directoryName"
                            | "drive"
                            | "unc"
                            | "token"
                            | "position"
                            | "nativePosition"
                            | "identity"
                            | "generation"
                            | "entriesInspected"
                            | "directoriesEntered"
                    ),
                    "the drop wire must not expose the private field {key}"
                );
                assert_drop_json_is_path_free(value, private_roots);
            }
        }
        serde_json::Value::Array(values) => {
            for value in values {
                assert_drop_json_is_path_free(value, private_roots);
            }
        }
        serde_json::Value::String(text) => {
            for root in private_roots {
                assert!(
                    !text.contains(&root.to_string_lossy().to_string()),
                    "the drop wire must not contain an absolute fixture root"
                );
            }
        }
        _ => {}
    }
}

#[cfg(windows)]
#[test]
fn a_mixed_drop_preserves_root_order_origin_identity_deduplication_and_privacy() {
    let direct_tree = FolderTree::new("drop-direct");
    let direct = direct_tree.file("sample.mzML", b"<mzML>direct</mzML>");
    let alias = direct_tree.path().join("same-object.mzML");
    fs::hard_link(&direct, &alias).expect("make a second name for the direct file");
    let unsupported = direct_tree.file("notes.txt", b"not mzML");

    let folder = FolderTree::new("drop-folder");
    folder.file("top.mzML", b"<mzML>top</mzML>");
    folder.file(r"nested\sample.mzML", b"<mzML>nested</mzML>");

    let service = PreviewService::new(Box::new(NoProcess));
    let paths = vec![direct, folder.path().to_path_buf(), unsupported, alias];
    let work = reserve_drop_work(&service, &paths);
    let result = service
        .process_native_drop_with(work, expand_drop_paths)
        .expect("the mixed drop remains current");

    assert_eq!(
        result
            .outcomes
            .iter()
            .map(|outcome| match outcome {
                WorkspaceAddOutcomeDto::Added { dataset } => {
                    ("added", dataset.file_name.as_str())
                }
                WorkspaceAddOutcomeDto::Duplicate { existing } => {
                    ("duplicate", existing.file_name.as_str())
                }
                WorkspaceAddOutcomeDto::Rejected { candidate_name, .. } => {
                    ("rejected", candidate_name.as_str())
                }
            })
            .collect::<Vec<_>>(),
        vec![
            ("added", "sample.mzML"),
            ("added", "top.mzML"),
            ("added", "sample.mzML"),
            ("rejected", "notes.txt"),
            ("duplicate", "sample.mzML"),
        ]
    );
    assert_eq!(
        roster_contexts(&service),
        vec![
            ("sample.mzML".to_owned(), Some("Added directly".to_owned())),
            ("top.mzML".to_owned(), None),
            ("sample.mzML".to_owned(), Some("nested".to_owned())),
        ]
    );
    assert!(result.summary.workspace_was_empty);
    assert!(result.summary.complete);
    assert_eq!(result.summary.top_level_item_count, 4);
    assert!(result.summary.limits_reached.is_empty());

    let wire = serde_json::to_value(&result).expect("drop result serializes");
    assert_drop_json_is_path_free(&wire, &[direct_tree.path(), folder.path()]);
}

#[cfg(windows)]
#[test]
fn drop_root_and_entry_refusals_are_aggregate_only_and_never_follow_junctions() {
    let outside = FolderTree::new("drop-junction-outside");
    outside.file("private.mzML", b"<mzML>outside</mzML>");
    let roots = FolderTree::new("drop-junction-roots");
    roots.junction("as-root", outside.path());

    let chosen = FolderTree::new("drop-junction-entry");
    chosen.file("kept.mzML", b"<mzML>inside</mzML>");
    chosen.junction("escape", outside.path());
    let absent = roots.path().join("absent");
    let unc = PathBuf::from(r"\\unreachable.invalid\private-share");
    let device = PathBuf::from(r"\\.\NUL");

    let service = PreviewService::new(Box::new(NoProcess));
    let paths = vec![
        roots.path().join("as-root"),
        chosen.path().to_path_buf(),
        absent,
        unc,
        device,
    ];
    let work = reserve_drop_work(&service, &paths);
    let result = service
        .process_native_drop_with(work, expand_drop_paths)
        .expect("root refusals do not fail unrelated candidates");

    assert_eq!(roster_names(&service), vec!["kept.mzML"]);
    assert!(!result.summary.complete);
    assert_eq!(result.summary.top_level_item_count, 5);
    assert_eq!(result.summary.skipped_reparse_root_count, 1);
    assert_eq!(result.summary.skipped_reparse_entry_count, 1);
    assert_eq!(result.summary.inaccessible_root_count, 1);
    assert_eq!(result.summary.remote_root_count, 1);
    assert_eq!(result.summary.unsupported_root_count, 1);
    assert!(
        result.outcomes.iter().all(|outcome| !matches!(
            outcome,
            WorkspaceAddOutcomeDto::Rejected { candidate_name, .. }
                if candidate_name == "as-root" || candidate_name == "absent"
        )),
        "root refusals are aggregate-only"
    );

    let wire = serde_json::to_value(&result).expect("drop result serializes");
    assert_drop_json_is_path_free(&wire, &[outside.path(), roots.path(), chosen.path()]);
}

#[cfg(windows)]
#[test]
fn drop_root_inspection_classifies_a_junction_before_directory_dispatch() {
    let outside = FolderTree::new("drop-root-classifier-target");
    outside.file("private.mzML", b"private");
    let roots = FolderTree::new("drop-root-classifier");
    roots.junction("as-root", outside.path());

    assert!(matches!(
        inspect_drop_root(&roots.path().join("as-root")),
        DropRootInspection::Reparse
    ));
}

#[test]
fn a_failed_root_debits_the_shared_drop_budget_before_the_next_root() {
    let direct = PathBuf::from("direct.mzML");
    let root_a = PathBuf::from("root-a");
    let root_b = PathBuf::from("root-b");
    let mut budgets_seen = Vec::new();

    let batch = expand_drop_paths_with_budget_using(
        vec![direct.clone(), root_a, root_b],
        DropBudget {
            max_roots: 3,
            max_depth: 7,
            max_entries: 5,
            max_directories: 3,
            max_candidates: 5,
        },
        |path| {
            if path == direct {
                DropRootInspection::RegularFile {
                    identity: FileIdentity::new(7, [1; 16]),
                }
            } else {
                DropRootInspection::Directory
            }
        },
        |_, budget| {
            budgets_seen.push(budget);
            if budgets_seen.len() == 1 {
                Err(
                    DiscoveryError::new(DiscoveryErrorKind::RootEnumerationFailed).with_usage(
                        DiscoveryUsage {
                            entries_inspected: 2,
                            directories_entered: 1,
                            candidates_collected: 0,
                        },
                    ),
                )
            } else {
                Err(DiscoveryError::new(DiscoveryErrorKind::RootUnavailable))
            }
        },
    )
    .expect("a failed root is aggregate-only");

    assert_eq!(
        budgets_seen,
        vec![
            DiscoveryBudget {
                max_depth: 7,
                max_entries: 5,
                max_directories: 3,
                max_candidates: 4,
            },
            DiscoveryBudget {
                max_depth: 7,
                max_entries: 3,
                max_directories: 2,
                max_candidates: 4,
            },
        ]
    );
    assert_eq!(batch.candidates.len(), 1);
    assert_eq!(batch.candidates[0].path, direct);
    assert_eq!(batch.summary.inaccessible_root_count, 2);
}

#[cfg(windows)]
#[test]
fn every_folder_and_direct_file_spends_one_shared_drop_budget() {
    let first = FolderTree::new("drop-budget-first");
    first.file("a.mzML", b"a");
    first.file("b.mzML", b"b");
    let direct_tree = FolderTree::new("drop-budget-direct");
    let direct = direct_tree.file("direct.mzML", b"d");
    let last = FolderTree::new("drop-budget-last");
    last.file("never-scanned.mzML", b"n");

    let batch = expand_drop_paths_with_budget(
        vec![
            first.path().to_path_buf(),
            direct,
            last.path().to_path_buf(),
        ],
        DropBudget {
            max_roots: 3,
            max_depth: 32,
            max_entries: 20,
            max_directories: 20,
            max_candidates: 3,
        },
    )
    .expect("real local roots expand");
    assert_eq!(
        batch
            .candidates
            .iter()
            .map(|candidate| {
                candidate
                    .path
                    .file_name()
                    .expect("candidate name")
                    .to_string_lossy()
                    .into_owned()
            })
            .collect::<Vec<_>>(),
        vec!["a.mzML", "b.mzML", "direct.mzML"]
    );
    let summary = batch.summary.into_dto(false);
    assert_eq!(summary.limits_reached, vec![DropScanLimitDto::Candidates]);
    assert!(!summary.complete);

    let one = FolderTree::new("drop-budget-entry-one");
    one.file("one.mzML", b"1");
    let two = FolderTree::new("drop-budget-entry-two");
    two.file("two.mzML", b"2");
    let batch = expand_drop_paths_with_budget(
        vec![one.path().to_path_buf(), two.path().to_path_buf()],
        DropBudget {
            max_roots: 2,
            max_depth: 32,
            max_entries: 1,
            max_directories: 2,
            max_candidates: 10,
        },
    )
    .expect("the first folder consumes the shared entry allowance");
    assert_eq!(batch.candidates.len(), 1);
    assert_eq!(
        batch.summary.into_dto(false).limits_reached,
        vec![DropScanLimitDto::Entries]
    );

    let roots = expand_drop_paths_with_budget(
        vec![
            direct_tree.path().join("direct.mzML"),
            first.path().join("a.mzML"),
        ],
        DropBudget {
            max_roots: 1,
            max_depth: 32,
            max_entries: 20,
            max_directories: 20,
            max_candidates: 10,
        },
    )
    .expect("the allowed prefix is processed");
    assert_eq!(roots.candidates.len(), 1);
    assert_eq!(
        roots.summary.into_dto(false).limits_reached,
        vec![DropScanLimitDto::Roots]
    );
}

#[cfg(windows)]
#[test]
fn a_drop_candidate_replaced_after_classification_is_refused_without_spending_an_id() {
    let tree = FolderTree::new("drop-identity-recheck");
    let replaced = tree.file("replaced.mzML", b"old");
    let untouched = tree.file("untouched.mzML", b"kept");
    let service = PreviewService::new(Box::new(NoProcess));
    let paths = vec![replaced.clone(), untouched];
    let work = reserve_drop_work(&service, &paths);

    let result = service
        .process_native_drop_with(work, |paths| {
            let batch = expand_drop_paths(paths)?;
            fs::remove_file(&replaced).expect("remove the classified object");
            fs::write(&replaced, b"new").expect("replace it under the same name");
            Ok(batch)
        })
        .expect("one candidate's replacement does not fail the batch");

    assert_eq!(result.outcomes.len(), 2);
    assert!(matches!(
        &result.outcomes[0],
        WorkspaceAddOutcomeDto::Rejected {
            candidate_name,
            error,
        } if candidate_name == "replaced.mzML" && error.kind == "drop_candidate_changed"
    ));
    let WorkspaceAddOutcomeDto::Added { dataset } = &result.outcomes[1] else {
        panic!("the unrelated candidate is added");
    };
    assert_eq!(
        dataset.handle, "file-0",
        "the rejection spent no dataset ID"
    );
    assert_eq!(roster_names(&service), vec!["untouched.mzML"]);
}

#[cfg(windows)]
#[test]
fn a_discovered_drop_candidate_replaced_after_scan_is_refused_without_spending_an_id() {
    let tree = FolderTree::new("drop-folder-identity-recheck");
    let replaced = tree.file("replaced.mzML", b"old");
    tree.file("untouched.mzML", b"kept");
    let service = PreviewService::new(Box::new(NoProcess));
    let paths = vec![tree.path().to_path_buf()];
    let work = reserve_drop_work(&service, &paths);

    let result = service
        .process_native_drop_with(work, |paths| {
            let batch = expand_drop_paths(paths)?;
            fs::remove_file(&replaced).expect("remove the discovered object");
            fs::write(&replaced, b"new").expect("replace it under the discovered name");
            Ok(batch)
        })
        .expect("the unrelated discovered candidate still commits");

    assert_eq!(result.outcomes.len(), 2);
    assert!(matches!(
        &result.outcomes[0],
        WorkspaceAddOutcomeDto::Rejected {
            candidate_name,
            error,
        } if candidate_name == "replaced.mzML" && error.kind == "drop_candidate_changed"
    ));
    let WorkspaceAddOutcomeDto::Added { dataset } = &result.outcomes[1] else {
        panic!("the unchanged discovered candidate is added")
    };
    assert_eq!(dataset.file_name, "untouched.mzML");
    assert_eq!(dataset.handle, "file-0", "the refusal spends no dataset ID");
    assert_eq!(roster_names(&service), vec!["untouched.mzML"]);
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

#[test]
fn an_import_that_is_already_superseded_never_starts_its_scan() {
    use super::discovery::{DiscoveryError, DiscoveryErrorKind};

    let service = PreviewService::new(Box::new(NoProcess));
    let token = service.reserve_folder_import();
    service.begin_webview_document();
    let scan_started = std::cell::Cell::new(false);

    let error = service
        .import_folder(token, || {
            scan_started.set(true);
            Err(DiscoveryError::new(DiscoveryErrorKind::RootUnavailable))
        })
        .expect_err("known-stale work is refused before filesystem discovery");

    assert_eq!(error.kind, "import_superseded");
    assert!(
        !scan_started.get(),
        "an already-superseded token must not start a folder scan"
    );
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
    service.add_files_now(std::slice::from_ref(&elsewhere.path));
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

    assert!(service.clear_workspace_now().datasets.is_empty());
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

    let remaining = service.remove_datasets_now(&["file-0".to_owned()]);

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

    service.add_files_now(std::slice::from_ref(&picked.path));
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

    service.add_files_now(&[first.path.clone(), second.path.clone()]);

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
    service.add_files_now(std::slice::from_ref(&file.path));
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
    let reservation = service.begin_folder_import_now();

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
    let reservation = service.begin_folder_import_now();

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
    let current = service.begin_folder_import_now();
    // This can be an old document's fetch reaching Rust after the replacement
    // document already began. Arrival order cannot make it a newer workspace
    // decision: both saw the same baseline, so both name the one bounded slot.
    let delayed = service.begin_folder_import_now();

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
    let current = service.begin_folder_import_now();

    service.clear_workspace_now();
    // The old document's begin reaches Rust after Clear and replaces the stale
    // slot at the new baseline. The current document's now-wrong identifier
    // must not consume that replacement.
    let delayed = service.begin_folder_import_now();
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

    let current = service.begin_folder_import_now();
    let token = service
        .claim_folder_import(&current.reservation_id)
        .expect("the current document claimed before its picker");

    // The old document's begin reaches Rust only now. It may occupy the one
    // pending slot, but begin is not a workspace decision and cannot advance
    // beyond the live token.
    let delayed = service.begin_folder_import_now();
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
    let current = service.begin_folder_import_now();
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
    let reservation = service.begin_folder_import_now();

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
        service.add_files_now(std::slice::from_ref(&elsewhere.path));

        let token = service.reserve_folder_import();
        match decision {
            "clear" => {
                service.clear_workspace_now();
            }
            "remove" => {
                service.remove_datasets_now(&["file-0".to_owned()]);
            }
            _ => {
                service.add_files_now(std::slice::from_ref(&elsewhere.path));
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
fn the_drop_subscription_reservation_carries_no_path_or_callback_authority() {
    let rendered = serde_json::to_string(&super::dto::WorkspaceDropSubscriptionReservationDto {
        reservation_id: "drop-subscription-reservation-23".to_owned(),
    })
    .expect("the reservation serialises");

    assert_eq!(
        rendered,
        "{\"reservationId\":\"drop-subscription-reservation-23\"}"
    );
    for private in [
        "path",
        "root",
        "generation",
        "token",
        "callbackId",
        "eventName",
    ] {
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
        .find("enter_workspace_mutation_after_drop()")
        .expect("a roster snapshot waits for an in-flight batch");
    let snapshot = body
        .find("roster_of(&self.workspace())")
        .expect("the roster is copied while it owns the ordering gate");
    assert!(gated < snapshot);
    assert!(
        !body.contains("begin_waiting_mutation") && !body.contains("begin_superseding_mutation"),
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

// --- Private workspace conversion -------------------------------------------
//
// The path under test is `PreviewService::convert_workspace_dataset`. It has no
// command, no transfer object and no frontend, so every test here reaches it the
// way the implementation intends to be reached: through a dataset handle the
// session issued.
//
// No test needs a local ProteoWizard. Capability evidence comes from a help
// fixture through the crate's `test-support` feature, and the process is a
// substituted `ProcessRunner` that receives the real planned command -- so what
// is written, and where, is decided by the boundary under test rather than by
// the test.

/// The family a report names, as the wire spells it.
fn source_kind_id(report: &super::conversion::WorkspaceConversionReport) -> String {
    serde_json::to_value(report.to_dto().source_kind)
        .expect("the family serializes")
        .as_str()
        .expect("the family is a string")
        .to_owned()
}

/// The subset of installed `msaccess` help its own commands require.
///
/// A different executable with a different option grammar, so a conversion
/// planned against it cannot be expressed at all. It exists here so a test can
/// hand a run the capability evidence a provider bound from the wrong tool,
/// which is the substance of ADR 0011's open binding gate.
const MSACCESS_HELP: &str = r"Usage: msaccess [options] [file]
Inspect mass spec data files.

Options:
  -o [ --outdir ] arg (=.)           : set output directory
  -x [ --exec ] arg                  : execute a command
";

/// The subset of installed `msconvert` help a conversion plan requires.
const MSCONVERT_HELP: &str = r"Usage: msconvert [options] [filemasks]
Convert mass spec data file formats.

Options:
  -o [ --outdir ] arg (=.)           : set output directory
  --outfile arg                      : Override the name of output file.
  --mzML                             : write mzML format [default]
  --mzXML                            : write mzXML format
  -z [ --zlib ] [=arg(=1)]           : use zlib compression for binary data
";

/// The build the repository has recorded vendor conversion evidence for, and
/// the digest of the exact executable that evidence was produced on.
///
/// Spelled out here rather than imported. The crate keeps this list private on
/// purpose -- it is evidence, not configuration -- and a test that read it from
/// the crate would pass whatever the crate said, including after a change that
/// silently widened it.
const EVIDENCED_RELEASE: &str = "3.0.26013";
const EVIDENCED_REVISION: &str = "47b13cf";
const EVIDENCED_EXECUTABLE_SHA256: &str =
    "9BB6F5D5033BB8EAD925F67515538C1A5C246A71351C9F7C1830A3F190D590BD";

/// The same two help strings out of a different artifact.
const OTHER_EXECUTABLE_SHA256: &str =
    "0000000000000000000000000000000000000000000000000000000000000001";

const HELP_STDOUT_SHA256: Sha256Digest = Sha256Digest::from_bytes([0xAB; 32]);
const HELP_STDERR_SHA256: Sha256Digest = Sha256Digest::from_bytes([0xCD; 32]);

/// The first eighteen bytes of every Thermo RAW acquisition: `01 A1` followed by
/// `Finnigan` in UTF-16LE.
const THERMO_RAW_SIGNATURE: [u8; 18] = [
    0x01, 0xa1, 0x46, 0x00, 0x69, 0x00, 0x6e, 0x00, 0x6e, 0x00, 0x69, 0x00, 0x67, 0x00, 0x61, 0x00,
    0x6e, 0x00,
];

/// A stand-in acquisition: the real signature, then bytes no reader interprets.
///
/// Enough for admission, which is what this boundary decides. It is never
/// handed to a vendor reader -- the process is substituted -- so nothing here
/// depends on it being a readable acquisition, and nothing may be read into it
/// about one.
fn thermo_raw_bytes() -> Vec<u8> {
    let mut bytes = THERMO_RAW_SIGNATURE.to_vec();
    bytes.extend_from_slice(&[0x00; 512]);
    bytes
}

/// An mzML document, in the two serializations a faithful conversion produces.
///
/// A conversion legally adds the index wrapper and may re-encode numeric
/// precision. The fixtures differ in exactly those ways, so a comparison that
/// passes is passing on the real contract rather than on a byte copy.
fn mzml_document(spectra: u32, indexed: bool) -> String {
    let precision = if indexed { "MS:1000521" } else { "MS:1000523" };
    let mut body = String::new();
    for index in 0..spectra {
        body.push_str(&format!(
            r#"<spectrum index="{index}" id="scan={}" defaultArrayLength="4">"#,
            index + 1
        ));
        body.push_str(r#"<cvParam accession="MS:1000511" name="ms level" value="1"/>"#);
        body.push_str(r#"<cvParam accession="MS:1000128" name="profile spectrum"/>"#);
        body.push_str(r#"<binaryDataArrayList count="2">"#);
        for accession in ["MS:1000514", "MS:1000515"] {
            body.push_str(&format!(
                r#"<binaryDataArray encodedLength="8"><cvParam accession="{accession}"/><cvParam accession="MS:1000574"/><cvParam accession="{precision}"/><binary>AA==</binary></binaryDataArray>"#
            ));
        }
        body.push_str("</binaryDataArrayList></spectrum>");
    }
    let run = format!(
        r#"<run id="R1"><spectrumList count="{spectra}">{body}</spectrumList><chromatogramList count="0"></chromatogramList></run>"#
    );
    if indexed {
        format!(r#"<indexedmzML><mzML version="1.1.0">{run}</mzML></indexedmzML>"#)
    } else {
        format!(r#"<mzML version="1.1.0">{run}</mzML>"#)
    }
}

/// An mzML document with chromatograms and no spectra at all.
///
/// A real shape, not a contrived one: the second lawful LabSolutions fixture
/// converts to exactly this -- 0 spectra, 144 chromatograms -- and a contract
/// that treated an empty spectrum list as a defect would have refused a real
/// acquisition. Written here so the deterministic suite states that on its own,
/// without an installation or vendor data.
fn mzml_chromatogram_document(chromatograms: u32) -> String {
    let mut body = String::new();
    for index in 0..chromatograms {
        body.push_str(&format!(
            r#"<chromatogram index="{index}" id="TIC{index}" defaultArrayLength="4"><binaryDataArrayList count="2">"#
        ));
        // Both roles. A chromatogram that carries arrays and names only one of
        // them fails the integrity contract -- which is what the first draft of
        // this fixture did, and the contract was right: a real converted
        // chromatogram carries a time array and an intensity array.
        for accession in ["MS:1000595", "MS:1000515"] {
            body.push_str(&format!(
                r#"<binaryDataArray encodedLength="8"><cvParam accession="{accession}"/><cvParam accession="MS:1000574"/><cvParam accession="MS:1000521"/><binary>AA==</binary></binaryDataArray>"#
            ));
        }
        body.push_str("</binaryDataArrayList></chromatogram>");
    }
    let run = format!(
        r#"<run id="R1"><spectrumList count="0"></spectrumList><chromatogramList count="{chromatograms}">{body}</chromatogramList></run>"#
    );
    format!(r#"<indexedmzML><mzML version="1.1.0">{run}</mzML></indexedmzML>"#)
}

/// The eight bytes every Microsoft compound file begins with.
///
/// Spelled out rather than imported, like the Thermo signature beside it: a
/// test that read its expectation from the constant it checks would pass
/// because that constant had been changed to match a mistake. It is also the
/// point of this family -- these same eight bytes begin a SCIEX `.wiff`, so
/// they cannot be the recognition.
const COMPOUND_FILE_MAGIC: [u8; 8] = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];

/// The entries a LabSolutions acquisition carries, likewise spelled out.
const SHIMADZU_MARKERS: [&str; 3] = ["Method File Property", "GUMM_Information", "LSS Raw Data"];

/// A compound file whose first directory sector holds exactly these entries.
///
/// Built, never vendor data. Everything this boundary decides about an LCD --
/// posture, extension, container, entry names, identity, digest -- is real
/// here; what it cannot stand in for is the Shimadzu reader, which is measured
/// by the ignored evidence run and recorded in ADR 0018.
///
/// The header is written the way a real one is, because the crate's reader
/// refuses a container that contradicts itself: major version 3 belongs with
/// 512-byte sectors, the root storage comes first and is named, and every
/// declared name length ends in its terminator.
fn compound_file_bytes(entries: &[&str]) -> Vec<u8> {
    const SECTOR: usize = 512;
    let mut bytes = vec![0_u8; SECTOR * 2];
    bytes[..8].copy_from_slice(&COMPOUND_FILE_MAGIC);
    bytes[26..28].copy_from_slice(&3_u16.to_le_bytes());
    bytes[28..30].copy_from_slice(&[0xFE, 0xFF]);
    bytes[30..32].copy_from_slice(&9_u16.to_le_bytes());
    bytes[48..52].copy_from_slice(&0_u32.to_le_bytes());

    let named = std::iter::once("Root Entry").chain(entries.iter().copied());
    for (index, name) in named.enumerate() {
        let at = SECTOR + index * 128;
        let units: Vec<u16> = name.encode_utf16().collect();
        for (unit, slot) in units.iter().zip(bytes[at..].chunks_exact_mut(2)) {
            slot.copy_from_slice(&unit.to_le_bytes());
        }
        let declared = u16::try_from(units.len() * 2 + 2).expect("a short entry name");
        bytes[at + 64..at + 66].copy_from_slice(&declared.to_le_bytes());
        bytes[at + 66] = if index == 0 { 5 } else { 2 };
    }
    bytes
}

/// A stand-in LabSolutions acquisition.
fn shimadzu_lcd_bytes() -> Vec<u8> {
    compound_file_bytes(&SHIMADZU_MARKERS)
}

/// A compound file belonging to the other vendor whose container this is.
///
/// The entry names are the ones a real `.wiff` carries. Renaming one of these
/// to `.lcd` is the case a suffix-plus-signature rule would admit and a
/// launched backend would then refuse.
fn wiff_like_bytes() -> Vec<u8> {
    compound_file_bytes(&["SampleSubtree", "MethodSubtree", "AcqMethodConfigStm"])
}

/// Installed help that also declares which build produced it.
fn conversion_capabilities(
    release: &str,
    revision: Option<&str>,
    executable_sha256: &str,
) -> InstalledHelpCapabilities {
    conversion_capabilities_for(BackendTool::MsConvert, release, revision, executable_sha256)
}

/// The same, for a named tool.
///
/// Which tool the help belongs to is a parameter because that is the thing
/// under test in one place: capability evidence read from the wrong executable
/// describes an option grammar that cannot express a conversion.
fn conversion_capabilities_for(
    tool: BackendTool,
    release: &str,
    revision: Option<&str>,
    executable_sha256: &str,
) -> InstalledHelpCapabilities {
    let executable = fs::canonicalize(std::env::current_exe().expect("test executable"))
        .expect("canonical test executable");
    let reported = revision.map_or_else(
        || release.to_owned(),
        |revision| format!("{release} ({revision})"),
    );
    let body = if tool == BackendTool::MsConvert {
        MSCONVERT_HELP
    } else {
        MSACCESS_HELP
    };
    let help = format!("ProteoWizard release: {reported}\nBuild date: Jan 13 2026\n{body}");
    InstalledHelpCapabilities::parse_unbound_capture_for_tests(
        tool,
        executable,
        executable_sha256
            .parse()
            .expect("the evidenced executable digest is a digest"),
        CompleteHelpCapture::new(
            CapturedHelpStream::new(
                help.as_bytes(),
                help.len() as u64,
                false,
                HELP_STDOUT_SHA256,
            ),
            CapturedHelpStream::new(&[], 0, false, HELP_STDERR_SHA256),
        ),
    )
    .expect("parse the msconvert help fixture")
}

/// Capabilities for the exact build the vendor evidence was recorded on.
fn evidenced_capabilities() -> InstalledHelpCapabilities {
    conversion_capabilities(
        EVIDENCED_RELEASE,
        Some(EVIDENCED_REVISION),
        EVIDENCED_EXECUTABLE_SHA256,
    )
}

/// What a substituted backend process does when it is launched.
#[derive(Clone, Copy, PartialEq, Eq)]
enum BackendAct {
    /// Writes the document the plan asked for, where it asked for it.
    Convert,
    /// Exits cleanly having written nothing.
    WriteNothing,
    /// Writes a document with no spectra in it.
    ConvertEmpty,
    /// Writes a document that is all chromatograms and no spectra, which is the
    /// shape a real LabSolutions acquisition converts to.
    ConvertChromatogramsOnly,
    /// Fails, as a backend that could not read its input would.
    Fail,
}

/// A hook a test can run inside a provider's backend resolution, shared so it
/// can be armed after the provider has been moved into the service.
type BackendResolutionHook = Arc<Mutex<Option<Box<dyn Fn() + Send>>>>;

/// A `msconvert` stand-in.
///
/// It receives the real planned command, so the destination it writes to is the
/// staging path the boundary chose rather than one the test invented. A test
/// that picked its own path would pass while the boundary staged somewhere else
/// entirely.
struct FakeConversionRunner {
    act: BackendAct,
    /// Shared with the test, so a refusal can be shown to have launched
    /// nothing at all rather than merely to have produced no file.
    calls: Arc<AtomicUsize>,
    /// Signalled the moment a process starts, and parked until released, for the
    /// tests that need to observe a conversion while it is still holding the
    /// backend gate.
    started: Mutex<Option<mpsc::Sender<()>>>,
    release: Mutex<Option<mpsc::Receiver<()>>>,
}

impl FakeConversionRunner {
    fn new(act: BackendAct) -> Self {
        Self {
            act,
            calls: Arc::new(AtomicUsize::new(0)),
            started: Mutex::new(None),
            release: Mutex::new(None),
        }
    }

    /// The same runner, parked inside its process until it is released.
    fn blocking(self) -> (Self, mpsc::Receiver<()>, mpsc::Sender<()>) {
        let (started, observe_start) = mpsc::channel();
        let (release, parked) = mpsc::channel();
        *self.started.lock().expect("started channel") = Some(started);
        *self.release.lock().expect("release channel") = Some(parked);
        (self, observe_start, release)
    }

    /// How many processes this runner has launched, readable after the runner
    /// itself has been moved into the provider.
    fn launches(&self) -> Arc<AtomicUsize> {
        Arc::clone(&self.calls)
    }
}

impl ProcessRunner for FakeConversionRunner {
    fn run(&self, spec: &CommandSpec) -> Result<ProcessOutput, ProcessError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if let Some(started) = self.started.lock().expect("started channel").take() {
            started.send(()).expect("announce the started conversion");
            let parked = self
                .release
                .lock()
                .expect("release channel")
                .take()
                .expect("a blocking runner is released exactly once");
            // Deliberately not ignored. A test that timed out here would go on
            // to pass a little late, and the thing it is watching for -- a lock
            // held where it should not be -- looks exactly like that.
            parked
                .recv_timeout(Duration::from_secs(10))
                .expect("the parked conversion is released");
        }
        let destination = spec
            .output_destination()
            .expect("a conversion plan carries an output destination")
            .to_path_buf();
        let exit_code = match self.act {
            BackendAct::Convert => {
                fs::write(destination, mzml_document(2, true)).expect("write staged output");
                0
            }
            BackendAct::ConvertEmpty => {
                fs::write(destination, mzml_document(0, true)).expect("write staged output");
                0
            }
            BackendAct::ConvertChromatogramsOnly => {
                fs::write(destination, mzml_chromatogram_document(144))
                    .expect("write staged output");
                0
            }
            BackendAct::WriteNothing => 0,
            BackendAct::Fail => 1,
        };
        Ok(ProcessOutput {
            stdout: Vec::new(),
            stderr: Vec::new(),
            stdout_total_bytes: 0,
            stderr_total_bytes: 0,
            stdout_truncated: false,
            stderr_truncated: false,
            exit_code: Some(exit_code),
            elapsed: Duration::from_millis(3),
            termination: Termination::Exited,
            max_active_processes: Some(1),
            final_active_processes: Some(0),
            peak_job_memory_bytes: Some(2_048),
        })
    }
}

/// A provider that can also convert.
///
/// Preview answers come from the ordinary fake, so a test can drive an open and
/// a conversion through one service and watch them contend for the one gate.
struct ConvertingProvider<R = FakeConversionRunner> {
    inner: FakeProvider,
    capabilities: InstalledHelpCapabilities,
    runner: R,
    /// Parks the first preview operation, for the tests that need a preview to
    /// be holding the backend gate while a conversion asks for it. The
    /// conversion side has its own pair on the runner, so either can be made to
    /// hold the gate while the other waits.
    preview_started: Mutex<Option<mpsc::Sender<()>>>,
    preview_release: Mutex<Option<mpsc::Receiver<()>>>,
    /// Which installation this provider reports resolving to, shared with the
    /// test so it can be changed after the provider has been handed over. A
    /// fixed answer can never advance the service's installation sequence, and
    /// a queue that spans two installations is the thing being tested.
    installation_label: Arc<Mutex<String>>,
    /// How many times a backend has been resolved for a conversion. In
    /// production this runs the installed tools' help, so a test can say that a
    /// queue which will convert nothing spent nothing proving which build it
    /// was not going to use.
    bindings: Arc<AtomicUsize>,
    /// Runs inside `conversion_backend`, where production runs the installed
    /// tools' help. A test that needs something to happen *during* that window
    /// -- a row removed while the pre-picker preflight is resolving -- puts it
    /// here, because the window is real time in production and injected code
    /// in a deterministic test.
    on_conversion_backend: BackendResolutionHook,
}

impl<R: ProcessRunner + Send + Sync> ConvertingProvider<R> {
    fn new(capabilities: InstalledHelpCapabilities, runner: R) -> Self {
        Self {
            inner: FakeProvider::available(Vec::new()),
            capabilities,
            runner,
            preview_started: Mutex::new(None),
            preview_release: Mutex::new(None),
            installation_label: Arc::new(Mutex::new(String::from("msconvert"))),
            bindings: Arc::new(AtomicUsize::new(0)),
            on_conversion_backend: Arc::new(Mutex::new(None)),
        }
    }

    /// The hook slot, shared so a test can arm it after the provider has been
    /// moved into the service.
    fn on_conversion_backend(&self) -> BackendResolutionHook {
        Arc::clone(&self.on_conversion_backend)
    }

    /// How many backend resolutions this provider has been asked for.
    fn bindings(&self) -> Arc<AtomicUsize> {
        Arc::clone(&self.bindings)
    }

    /// The name this provider will answer with, changeable from the test.
    fn installation_label(&self) -> Arc<Mutex<String>> {
        Arc::clone(&self.installation_label)
    }

    /// The same provider, answering `previews` ordinary previews and parking in
    /// none of them.
    ///
    /// For the tests that need a run visible *before* a conversion takes the
    /// slot: the preview has to succeed first, and only then does the condition
    /// under test exist.
    fn answering_previews(mut self, previews: usize) -> Self {
        let mut responses = Vec::new();
        for _ in 0..previews {
            responses.extend(open_responses());
        }
        self.inner = FakeProvider::available(responses);
        self
    }

    /// The same provider, answering previews and parking inside the first one.
    fn parking_the_first_preview(mut self) -> (Self, mpsc::Receiver<()>, mpsc::Sender<()>) {
        let (started, observe_start) = mpsc::channel();
        let (release, parked) = mpsc::channel();
        self.inner = FakeProvider::available(open_responses());
        *self
            .preview_started
            .lock()
            .expect("preview started channel") = Some(started);
        *self
            .preview_release
            .lock()
            .expect("preview release channel") = Some(parked);
        (self, observe_start, release)
    }
}

impl ConvertingProvider<FakeConversionRunner> {
    /// The default: an evidenced build and a backend that converts faithfully.
    fn faithful() -> Self {
        Self::new(
            evidenced_capabilities(),
            FakeConversionRunner::new(BackendAct::Convert),
        )
    }
}

impl<R: ProcessRunner + Send + Sync> PreviewProvider for ConvertingProvider<R> {
    fn availability(&self) -> (BackendAvailabilityDto, Option<InstallationIdentity>) {
        self.inner.availability()
    }

    fn run(
        &self,
        source: &Path,
        operation: &PreviewOperation,
    ) -> Result<OperationAttempt, PreviewErrorDto> {
        if let Some(started) = self
            .preview_started
            .lock()
            .expect("preview started channel")
            .take()
        {
            started.send(()).expect("announce the started preview");
            let parked = self
                .preview_release
                .lock()
                .expect("preview release channel")
                .take()
                .expect("a parking preview is released exactly once");
            parked
                .recv_timeout(Duration::from_secs(10))
                .expect("the parked preview is released");
        }
        self.inner.run(source, operation)
    }

    fn use_installation(&self, home: Option<PathBuf>) {
        self.inner.use_installation(home);
    }

    fn conversion_backend(&self) -> Result<ConversionBackend<'_>, PreviewErrorDto> {
        self.bindings.fetch_add(1, Ordering::SeqCst);
        if let Some(hook) = self
            .on_conversion_backend
            .lock()
            .expect("the backend hook is never poisoned")
            .as_ref()
        {
            hook();
        }
        Ok(ConversionBackend {
            capabilities: self.capabilities.clone(),
            installation: Some(backend(
                &self
                    .installation_label
                    .lock()
                    .expect("the installation label is never poisoned"),
                EVIDENCED_RELEASE,
            )),
            runner: &self.runner,
        })
    }
}

impl TestFile {
    /// A Thermo RAW acquisition beside the mzML this fixture is named for.
    fn thermo_raw(&self, name: &str) -> PathBuf {
        let path = self.directory.join(name);
        fs::write(&path, thermo_raw_bytes()).expect("write a Thermo RAW fixture");
        path
    }

    /// A real mzML document, as opposed to the placeholder `TestFile` writes.
    ///
    /// Needed wherever a conversion actually reads its source: the placeholder
    /// is enough to be accepted by extension, and an mzML source is admitted by
    /// being read.
    fn readable_mzml(&self, name: &str) -> PathBuf {
        let path = self.directory.join(name);
        fs::write(&path, mzml_document(2, false)).expect("write an mzML source");
        path
    }

    /// A Shimadzu LabSolutions acquisition beside the mzML this fixture is
    /// named for.
    fn shimadzu_lcd(&self, name: &str) -> PathBuf {
        let path = self.directory.join(name);
        fs::write(&path, shimadzu_lcd_bytes()).expect("write a Shimadzu LCD fixture");
        path
    }

    /// A file of the caller's own bytes, under a name of the caller's choosing.
    ///
    /// For the decoys: a container of another vendor named `.lcd`, an archive
    /// named `.lcd`, an acquisition named something else.
    fn named_bytes(&self, name: &str, bytes: &[u8]) -> PathBuf {
        let path = self.directory.join(name);
        fs::write(&path, bytes).expect("write a named fixture");
        path
    }

    /// A folder beside the fixture, for outputs to land in.
    fn destination(&self, name: &str) -> PathBuf {
        let path = self.directory.join(name);
        fs::create_dir_all(&path).expect("create a destination root");
        path
    }
}

/// Names of the entries a directory holds, sorted.
fn entry_names(directory: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(directory)
        .expect("read directory")
        .map(|entry| {
            entry
                .expect("directory entry")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    names.sort();
    names
}

/// A conversion is judged on the output alone when its source was never read as
/// mzML -- and says so, rather than reporting a comparison it never made.
///
/// This is the whole vertical: a Thermo acquisition admitted by signature into
/// the workspace, carried to the conversion boundary by handle, converted, and
/// judged. Every property that needed the source document is reported
/// inapplicable, and the conversion is deliberately not fully verified.
#[test]
fn a_thermo_dataset_converts_through_its_handle_and_is_judged_on_the_output_alone() {
    let fixture = TestFile::new("thermo-conversion");
    let acquisition = fixture.thermo_raw("FT-HCD-MSX.raw");
    let destination = fixture.destination("out");
    let provider = Box::new(ConvertingProvider::faithful());
    let service = PreviewService::new(provider);
    let dataset = service
        .add_thermo_dataset(&acquisition)
        .expect("a Thermo acquisition is admitted for conversion");

    let report = service
        .convert_workspace_dataset(&dataset.handle, &destination, ConflictPolicy::Fail)
        .expect("the conversion reaches an outcome");

    assert_eq!(report.to_dto().outcome, "finalized");
    assert_eq!(report.to_dto().dataset_handle, dataset.handle);
    assert_eq!(source_kind_id(&report), "thermo_raw");
    assert_eq!(
        report.to_dto().output_file_name.as_deref(),
        Some("FT-HCD-MSX.mzML")
    );
    assert_eq!(entry_names(&destination), vec!["FT-HCD-MSX.mzML"]);

    let validation = report
        .to_dto()
        .validation
        .expect("a finalized run was judged");
    assert_eq!(validation.mode, ValidationModeDto::OutputOnly);
    assert!(
        !validation.fully_verified,
        "a conversion with no source reading is never fully verified, whatever passed"
    );
    assert!(
        validation
            .verified
            .iter()
            .any(|property| property == "source_unchanged"),
        "the acquisition itself is still bound and rechecked; got {:?}",
        validation.verified
    );
    for comparison in ["spectrum_count", "binary_array_lengths", "precursor_counts"] {
        assert!(
            validation
                .inapplicable
                .iter()
                .any(|property| property == comparison),
            "{comparison} compares the output to a source document that was never read; got {:?}",
            validation.inapplicable
        );
    }
    assert!(
        validation.unverified.is_empty(),
        "nothing here failed a check that could have been made; got {:?}",
        validation.unverified
    );

    let output = report
        .to_dto()
        .output
        .expect("a finalized run measured its output");
    assert_eq!(output.spectrum_count, 2);
    assert_eq!(output.chromatogram_count, 0);
    assert!(output.byte_length > 0);
    assert_eq!(output.sha256.len(), 64);
}

/// The same path over a source that *was* read as mzML compares the two
/// documents, because there is something to compare.
#[test]
fn an_mzml_dataset_converts_through_the_same_path_and_is_compared_to_its_source() {
    let fixture = TestFile::new("mzml-conversion");
    let source = fixture.readable_mzml("acquisition.mzML");
    let destination = fixture.destination("out");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let dataset = service.add_dataset(&source).expect("add an mzML dataset");

    let report = service
        .convert_workspace_dataset(&dataset.handle, &destination, ConflictPolicy::Fail)
        .expect("the conversion reaches an outcome");

    assert_eq!(report.to_dto().outcome, "finalized");
    assert_eq!(source_kind_id(&report), "mzml");
    let validation = report
        .to_dto()
        .validation
        .expect("a finalized run was judged");
    assert_eq!(validation.mode, ValidationModeDto::SourceComparison);
    assert!(
        validation.inapplicable.is_empty(),
        "an mzML source can be compared against, so nothing is inapplicable; got {:?}",
        validation.inapplicable
    );
    assert!(
        validation
            .verified
            .iter()
            .any(|property| property == "source_unchanged"),
        "the comparison the mode names has to have been made; got {:?}",
        validation.verified
    );
}

/// A dataset is named by a handle the session issued, and nothing else reaches
/// the conversion boundary.
#[test]
fn a_handle_the_session_never_issued_converts_nothing() {
    let fixture = TestFile::new("unknown-handle");
    let destination = fixture.destination("out");
    let provider = ConvertingProvider::faithful();
    let service = PreviewService::new(Box::new(provider));

    let error = service
        .convert_workspace_dataset("file-404", &destination, ConflictPolicy::Fail)
        .expect_err("an unknown handle is not a dataset");

    assert_eq!(error.kind, "unknown_file_handle");
    assert_eq!(entry_names(&destination), Vec::<String>::new());
}

/// A build the repository has no vendor evidence for is refused before anything
/// is created and before any process is launched.
///
/// The refusal is the point, and so is where it happens: an unevidenced build
/// must not reach the stage where a staging directory exists, because a caller
/// then has to be told about a directory as well as a refusal.
#[test]
fn an_unevidenced_build_refuses_a_vendor_conversion_before_it_stages_anything() {
    let fixture = TestFile::new("unevidenced-build");
    let acquisition = fixture.thermo_raw("acquisition.raw");
    let destination = fixture.destination("out");
    let runner = FakeConversionRunner::new(BackendAct::Convert);
    let launches = runner.launches();
    let provider = Box::new(ConvertingProvider::new(
        conversion_capabilities("3.0.99999", Some("deadbee"), EVIDENCED_EXECUTABLE_SHA256),
        runner,
    ));
    let service = PreviewService::new(provider);
    let dataset = service
        .add_thermo_dataset(&acquisition)
        .expect("admit the acquisition");

    let error = service
        .convert_workspace_dataset(&dataset.handle, &destination, ConflictPolicy::Fail)
        .expect_err("a build with no evidence for this family converts nothing");

    assert_eq!(error.kind, "provider_build_not_evidenced");
    assert_eq!(
        entry_names(&destination),
        Vec::<String>::new(),
        "nothing may be created under the destination before the build is accepted"
    );
    assert_eq!(
        launches.load(Ordering::SeqCst),
        0,
        "an unevidenced build never reaches a process"
    );
}

/// The same build, reporting the same release and revision, from a different
/// executable. Two strings out of a help banner say what a build calls itself,
/// not what it is.
#[test]
fn a_build_naming_the_evidenced_release_from_another_executable_is_still_refused() {
    let fixture = TestFile::new("substituted-executable");
    let acquisition = fixture.thermo_raw("acquisition.raw");
    let destination = fixture.destination("out");
    let provider = Box::new(ConvertingProvider::new(
        conversion_capabilities(
            EVIDENCED_RELEASE,
            Some(EVIDENCED_REVISION),
            "0000000000000000000000000000000000000000000000000000000000000000",
        ),
        FakeConversionRunner::new(BackendAct::Convert),
    ));
    let service = PreviewService::new(provider);
    let dataset = service
        .add_thermo_dataset(&acquisition)
        .expect("admit the acquisition");

    let error = service
        .convert_workspace_dataset(&dataset.handle, &destination, ConflictPolicy::Fail)
        .expect_err("evidence is about an artifact, not about what it calls itself");

    assert_eq!(error.kind, "provider_build_not_evidenced");
}

/// An mzML source needs no vendor evidence, because the repository's evidence
/// for reading mzML is not a statement about one build's vendor libraries.
#[test]
fn an_unevidenced_build_still_converts_an_open_format_source() {
    let fixture = TestFile::new("unevidenced-open-format");
    let source = fixture.readable_mzml("acquisition.mzML");
    let destination = fixture.destination("out");
    let provider = Box::new(ConvertingProvider::new(
        conversion_capabilities("3.0.99999", Some("deadbee"), EVIDENCED_EXECUTABLE_SHA256),
        FakeConversionRunner::new(BackendAct::Convert),
    ));
    let service = PreviewService::new(provider);
    let dataset = service.add_dataset(&source).expect("add an mzML dataset");

    let report = service
        .convert_workspace_dataset(&dataset.handle, &destination, ConflictPolicy::Fail)
        .expect("the conversion reaches an outcome");

    assert_eq!(report.to_dto().outcome, "finalized");
}

/// A provider that has not been taught to convert refuses, rather than
/// inheriting some other provider's backend.
#[test]
fn a_backend_that_cannot_convert_says_so_rather_than_launching_something_else() {
    let fixture = TestFile::new("no-conversion-backend");
    let acquisition = fixture.thermo_raw("acquisition.raw");
    let destination = fixture.destination("out");
    let service = PreviewService::new(Box::new(FakeProvider::available(Vec::new())));
    let dataset = service
        .add_thermo_dataset(&acquisition)
        .expect("admit the acquisition");

    let error = service
        .convert_workspace_dataset(&dataset.handle, &destination, ConflictPolicy::Fail)
        .expect_err("a provider with no conversion backend converts nothing");

    assert_eq!(error.kind, "conversion_unsupported");
}

/// An output with no records in it is not a conversion, whatever the backend
/// reported.
#[test]
fn an_output_with_no_records_is_refused_and_never_takes_the_destination_name() {
    let fixture = TestFile::new("empty-output");
    let acquisition = fixture.thermo_raw("acquisition.raw");
    let destination = fixture.destination("out");
    let provider = Box::new(ConvertingProvider::new(
        evidenced_capabilities(),
        FakeConversionRunner::new(BackendAct::ConvertEmpty),
    ));
    let service = PreviewService::new(provider);
    let dataset = service
        .add_thermo_dataset(&acquisition)
        .expect("admit the acquisition");

    let report = service
        .convert_workspace_dataset(&dataset.handle, &destination, ConflictPolicy::Fail)
        .expect("the conversion reaches an outcome");

    assert_ne!(report.to_dto().outcome, "finalized");
    assert!(report.to_dto().output.is_none());
    assert_eq!(
        report.to_dto().output_file_name.as_deref(),
        None,
        "a run that finalized nothing names no file, planned or otherwise"
    );
    assert_eq!(
        entry_names(&destination),
        Vec::<String>::new(),
        "a refused output never takes the name it was planned for"
    );
}

/// A backend that wrote nothing leaves nothing behind, including its staging
/// area.
#[test]
fn a_backend_that_produced_no_file_leaves_no_staging_directory() {
    let fixture = TestFile::new("no-output");
    let acquisition = fixture.thermo_raw("acquisition.raw");
    let destination = fixture.destination("out");
    let provider = Box::new(ConvertingProvider::new(
        evidenced_capabilities(),
        FakeConversionRunner::new(BackendAct::WriteNothing),
    ));
    let service = PreviewService::new(provider);
    let dataset = service
        .add_thermo_dataset(&acquisition)
        .expect("admit the acquisition");

    let report = service
        .convert_workspace_dataset(&dataset.handle, &destination, ConflictPolicy::Fail)
        .expect("the conversion reaches an outcome");

    assert_ne!(report.to_dto().outcome, "finalized");
    assert_eq!(report.to_dto().output_file_name.as_deref(), None);
    assert!(
        report.to_dto().staging_residue.is_none(),
        "the run reclaimed its own staging area; got {:?}",
        report.to_dto().staging_residue
    );
    assert_eq!(entry_names(&destination), Vec::<String>::new());
}

/// A backend that failed is reported as a backend failure, with bounded facts
/// about the process and no raw output.
#[test]
fn a_failed_backend_is_reported_with_bounded_process_facts() {
    let fixture = TestFile::new("failed-backend");
    let acquisition = fixture.thermo_raw("acquisition.raw");
    let destination = fixture.destination("out");
    let provider = Box::new(ConvertingProvider::new(
        evidenced_capabilities(),
        FakeConversionRunner::new(BackendAct::Fail),
    ));
    let service = PreviewService::new(provider);
    let dataset = service
        .add_thermo_dataset(&acquisition)
        .expect("admit the acquisition");

    let report = service
        .convert_workspace_dataset(&dataset.handle, &destination, ConflictPolicy::Fail)
        .expect("the conversion reaches an outcome");

    assert_ne!(report.to_dto().outcome, "finalized");
    let backend = report
        .to_dto()
        .backend
        .expect("a process ran, so it has facts");
    assert_eq!(backend.exit_code, Some(1));
    assert_eq!(entry_names(&destination), Vec::<String>::new());
}

/// A destination name that is already taken is never replaced. What is there is
/// deliberately not inspected: the guarantee is that this boundary does not
/// touch it.
#[test]
fn an_occupied_destination_name_is_skipped_or_refused_and_never_overwritten() {
    let fixture = TestFile::new("occupied-destination");
    let acquisition = fixture.thermo_raw("acquisition.raw");
    let destination = fixture.destination("out");
    let occupant = destination.join("acquisition.mzML");
    fs::write(&occupant, b"someone else's file").expect("write the occupant");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let dataset = service
        .add_thermo_dataset(&acquisition)
        .expect("admit the acquisition");

    let skipped = service
        .convert_workspace_dataset(&dataset.handle, &destination, ConflictPolicy::Skip)
        .expect("a skipped conversion is an outcome, not an error");
    assert_eq!(skipped.to_dto().outcome, "skipped_existing_destination");
    assert_eq!(
        skipped.to_dto().output_file_name.as_deref(),
        None,
        "the name is occupied by a file this run deliberately did not touch, so it is \
         not this run's output"
    );

    let refused = service
        .convert_workspace_dataset(&dataset.handle, &destination, ConflictPolicy::Fail)
        .expect("a refused conversion is an outcome, not an error");
    assert_eq!(refused.to_dto().outcome, "destination_exists");

    assert_eq!(
        fs::read(&occupant).expect("read the occupant"),
        b"someone else's file",
        "neither policy may replace what was already there"
    );
}

/// A destination that is not a folder this session can use is refused while the
/// plan is being formed, before a staging area or a process exists.
#[test]
fn a_destination_that_is_not_a_usable_folder_is_refused_while_planning() {
    let fixture = TestFile::new("unusable-destination");
    let acquisition = fixture.thermo_raw("acquisition.raw");
    let runner = FakeConversionRunner::new(BackendAct::Convert);
    let launches = runner.launches();
    let provider = Box::new(ConvertingProvider::new(evidenced_capabilities(), runner));
    let service = PreviewService::new(provider);
    let dataset = service
        .add_thermo_dataset(&acquisition)
        .expect("admit the acquisition");

    for destination in [fixture.absent("no-such-folder"), acquisition.clone()] {
        let error = service
            .convert_workspace_dataset(&dataset.handle, &destination, ConflictPolicy::Fail)
            .expect_err("neither a missing folder nor a file is a destination root");
        assert_eq!(error.kind, "conversion_not_plannable");
    }
    assert_eq!(
        launches.load(Ordering::SeqCst),
        0,
        "a plan that was never formed launches nothing"
    );
}

/// A dataset the session no longer holds converts nothing, even if the file is
/// still on disk.
#[test]
fn a_dataset_removed_before_the_conversion_starts_converts_nothing() {
    let fixture = TestFile::new("removed-dataset");
    let acquisition = fixture.thermo_raw("acquisition.raw");
    let destination = fixture.destination("out");
    let provider = Box::new(ConvertingProvider::faithful());
    let service = PreviewService::new(provider);
    let dataset = service
        .add_thermo_dataset(&acquisition)
        .expect("admit the acquisition");
    let removed = service.remove_datasets_now(std::slice::from_ref(&dataset.handle));
    assert_eq!(removed.removed_handles, vec![dataset.handle.clone()]);

    let error = service
        .convert_workspace_dataset(&dataset.handle, &destination, ConflictPolicy::Fail)
        .expect_err("a dataset that is gone is not convertible");

    assert_eq!(error.kind, "unknown_file_handle");
    assert_eq!(entry_names(&destination), Vec::<String>::new());
}

/// A source replaced by a different object under the same name is refused. The
/// dataset names an object, and a name that now resolves elsewhere is not it.
#[test]
fn a_source_replaced_under_its_own_name_is_never_converted() {
    let fixture = TestFile::new("replaced-source");
    let acquisition = fixture.thermo_raw("acquisition.raw");
    let destination = fixture.destination("out");
    let provider = Box::new(ConvertingProvider::faithful());
    let service = PreviewService::new(provider);
    let dataset = service
        .add_thermo_dataset(&acquisition)
        .expect("admit the acquisition");

    // A different object, under the name the dataset was accepted with. The
    // lease permits this; what it forbids is the object being replaced during a
    // read, which is a different window and a different test.
    fs::remove_file(&acquisition).expect("remove the accepted acquisition");
    fs::write(&acquisition, thermo_raw_bytes()).expect("write a different acquisition");

    let error = service
        .convert_workspace_dataset(&dataset.handle, &destination, ConflictPolicy::Fail)
        .expect_err("a replaced object is not the dataset that was accepted");

    assert_eq!(error.kind, "file_identity_changed");
    assert_eq!(entry_names(&destination), Vec::<String>::new());
}

/// The dataset and the conversion source must be proved to name one object.
///
/// The session admits an object and the crate admits one, and each is handed a
/// path to do it with. A path is not an object: without this comparison the
/// session would have leased one file while the conversion hashed, planned and
/// converted whatever that name resolved to at the moment the crate looked.
#[test]
fn a_conversion_source_that_is_not_the_dataset_object_is_refused() {
    let fixture = TestFile::new("handoff-identity");
    let acquisition = fixture.thermo_raw("acquisition.raw");
    let sibling = fixture.thermo_raw("other.raw");

    let accepted = accept_thermo_raw_file(&acquisition).expect("admit the acquisition");
    let elsewhere = accept_thermo_raw_file(&sibling).expect("admit the other acquisition");
    let confused = accepted.misremembering_its_object(elsewhere.identity());

    let error = open_conversion_source(&confused)
        .expect_err("an object that is not the one the dataset names is not convertible");

    assert_eq!(error.kind, "file_identity_changed");
}

/// A vendor acquisition is admitted by its signature, not by its extension. A
/// file named `.raw` that carries something else is not one.
#[test]
fn a_file_named_raw_that_is_not_a_thermo_acquisition_is_not_admitted() {
    let fixture = TestFile::new("misnamed-raw");
    let impostor = fixture.directory.join("impostor.raw");
    fs::write(&impostor, mzml_document(2, false)).expect("write an mzML file named .raw");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));

    let error = service
        .add_thermo_dataset(&impostor)
        .expect_err("an extension is not a recognition");

    assert_eq!(error.kind, "unrecognized_acquisition");
}

/// And the converse: the signature alone is not enough either, because the
/// installed vendor reader will not open the object without the extension.
#[test]
fn a_thermo_acquisition_under_another_extension_is_not_admitted() {
    let fixture = TestFile::new("misnamed-thermo");
    let disguised = fixture.directory.join("acquisition.dat");
    fs::write(&disguised, thermo_raw_bytes()).expect("write a Thermo acquisition named .dat");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));

    let error = service
        .add_thermo_dataset(&disguised)
        .expect_err("the reader needs the name as well as the bytes");

    assert_eq!(error.kind, "unsupported_extension");
}

/// The picker admits a vendor acquisition; the mzML-only doors do not.
///
/// ADR 0012 widens exactly one ingestion surface. The other two walk a tree the
/// user did not enumerate, and admitting a vendor family from a walk is a wider
/// claim than admitting one the user named -- so this states both halves
/// together, where a change to either is visible against the other.
#[test]
fn the_picker_admits_a_vendor_acquisition_and_the_mzml_only_doors_still_refuse_one() {
    let fixture = TestFile::new("ingestion-widened");
    let acquisition = fixture.thermo_raw("acquisition.raw");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));

    let batch = service.add_files_now(std::slice::from_ref(&acquisition));
    assert_eq!(batch.roster.datasets.len(), 1);
    assert_eq!(
        batch.roster.datasets[0].source_kind,
        DatasetSourceKindDto::ThermoRaw
    );
    assert_eq!(service.dataset_count(), 1);

    // The retired single-file picker path stays mzML-only, which is what its
    // one remaining caller -- a focused regression test -- is about.
    let picked = service
        .accept_file(&acquisition)
        .expect_err("the replaced picker opens mzML only");
    assert_eq!(picked.kind, "unsupported_extension");

    // And folder discovery proposes nothing for it, whatever the folder holds.
    let discovered =
        service.add_mzml_folder(fixture.directory.as_path(), service.reserve_folder_import());
    let discovered = discovered.expect("a folder scan is an outcome");
    assert!(
        discovered.outcomes.iter().all(
            |outcome| !matches!(outcome, WorkspaceAddOutcomeDto::Added { dataset } if dataset
                .source_kind
                == DatasetSourceKindDto::ThermoRaw)
        ),
        "folder discovery proposes no vendor acquisition; got {:?}",
        discovered.outcomes
    );
}

/// Every use of a dataset re-applies the rule it was accepted under. A vendor
/// dataset is never revalidated as mzML, so a file whose bytes stopped being an
/// acquisition is refused rather than accepted on its name.
#[test]
fn a_vendor_dataset_whose_bytes_changed_family_is_refused_at_revalidation() {
    let fixture = TestFile::new("family-changed");
    let acquisition = fixture.thermo_raw("acquisition.raw");
    let destination = fixture.destination("out");
    let provider = Box::new(ConvertingProvider::faithful());
    let service = PreviewService::new(provider);
    let dataset = service
        .add_thermo_dataset(&acquisition)
        .expect("admit the acquisition");

    // The same object -- the lease keeps it -- carrying content nothing
    // recognises. Revalidating this as mzML would accept it on its extension.
    fs::write(&acquisition, b"not an acquisition at all").expect("rewrite the acquisition");

    let error = service
        .convert_workspace_dataset(&dataset.handle, &destination, ConflictPolicy::Fail)
        .expect_err("the family a dataset was accepted as is the family it is rechecked as");

    assert_eq!(error.kind, "unrecognized_acquisition");
    assert_eq!(entry_names(&destination), Vec::<String>::new());
}

/// One backend process at a time, across preview and conversion alike. A
/// conversion waiting for the gate has not launched anything.
#[test]
fn a_conversion_waits_for_a_preview_holding_the_backend_gate() {
    let fixture = TestFile::new("gate-preview-first");
    let acquisition = fixture.thermo_raw("acquisition.raw");
    let destination = fixture.destination("out");
    let (provider, observe_start, release) =
        ConvertingProvider::faithful().parking_the_first_preview();
    let service = Arc::new(PreviewService::new(Box::new(provider)));
    let preview_source = service
        .add_dataset(&fixture.path)
        .expect("add the preview dataset");
    let converted = service
        .add_thermo_dataset(&acquisition)
        .expect("admit the acquisition");

    let opening = std::thread::spawn({
        let service = Arc::clone(&service);
        let handle = preview_source.handle.clone();
        move || service.open_preview(&handle)
    });
    observe_start
        .recv_timeout(Duration::from_secs(10))
        .expect("the preview reached the provider and holds the gate");

    let converting = std::thread::spawn({
        let service = Arc::clone(&service);
        let handle = converted.handle.clone();
        let destination = destination.clone();
        move || service.convert_workspace_dataset(&handle, &destination, ConflictPolicy::Fail)
    });

    // Nothing has been created, because the conversion has not started. A
    // conversion that ignored the gate would already have staged and run.
    std::thread::yield_now();
    assert_eq!(
        entry_names(&destination),
        Vec::<String>::new(),
        "a conversion waiting for the gate has launched nothing"
    );

    release.send(()).expect("release the preview");
    opening.join().expect("the preview thread").ok();
    let report = converting
        .join()
        .expect("the conversion thread")
        .expect("the conversion reaches an outcome once the gate is free");
    assert_eq!(report.to_dto().outcome, "finalized");
}

/// And the other way round: a preview queues behind a running conversion rather
/// than starting a second process beside it.
#[test]
fn a_preview_waits_for_a_conversion_holding_the_backend_gate() {
    let fixture = TestFile::new("gate-conversion-first");
    let acquisition = fixture.thermo_raw("acquisition.raw");
    let destination = fixture.destination("out");
    let (runner, observe_start, release) =
        FakeConversionRunner::new(BackendAct::Convert).blocking();
    let mut provider = ConvertingProvider::new(evidenced_capabilities(), runner);
    provider.inner = FakeProvider::available(open_responses());
    let service = Arc::new(PreviewService::new(Box::new(provider)));

    let preview_source = service
        .add_dataset(&fixture.path)
        .expect("add the preview dataset");
    let converted = service
        .add_thermo_dataset(&acquisition)
        .expect("admit the acquisition");

    let converting = std::thread::spawn({
        let service = Arc::clone(&service);
        let handle = converted.handle.clone();
        let destination = destination.clone();
        move || service.convert_workspace_dataset(&handle, &destination, ConflictPolicy::Fail)
    });
    observe_start
        .recv_timeout(Duration::from_secs(10))
        .expect("the conversion reached its process and holds the gate");

    let opening = std::thread::spawn({
        let service = Arc::clone(&service);
        let handle = preview_source.handle.clone();
        move || service.open_preview(&handle)
    });

    // Deliberately not a request count: claiming an epoch happens before the
    // wait and is not a process. What a preview parked on the gate has not done
    // is record anything, and that is observable without racing the thread that
    // is about to block.
    std::thread::yield_now();
    assert!(
        !service.holds_preview_state(&preview_source.handle),
        "a preview waiting for the gate has recorded nothing"
    );

    release.send(()).expect("release the conversion");
    let report = converting
        .join()
        .expect("the conversion thread")
        .expect("the conversion reaches an outcome");
    assert_eq!(report.to_dto().outcome, "finalized");
    opening
        .join()
        .expect("the preview thread")
        .expect("the preview runs once the gate is free");
}

/// The workspace stays answerable while a conversion runs. The gate is held for
/// as long as a process takes, and the roster may not be behind it.
#[test]
fn the_workspace_answers_while_a_conversion_is_running() {
    let fixture = TestFile::new("workspace-during-conversion");
    let acquisition = fixture.thermo_raw("acquisition.raw");
    let destination = fixture.destination("out");
    let (runner, observe_start, release) =
        FakeConversionRunner::new(BackendAct::Convert).blocking();
    let provider = Box::new(ConvertingProvider::new(evidenced_capabilities(), runner));
    let service = Arc::new(PreviewService::new(provider));
    let converted = service
        .add_thermo_dataset(&acquisition)
        .expect("admit the acquisition");

    let converting = std::thread::spawn({
        let service = Arc::clone(&service);
        let handle = converted.handle.clone();
        let destination = destination.clone();
        move || service.convert_workspace_dataset(&handle, &destination, ConflictPolicy::Fail)
    });
    observe_start
        .recv_timeout(Duration::from_secs(10))
        .expect("the conversion is inside its process");

    // Both answer immediately, or neither returns and this test hangs -- which
    // is the failure, stated as one.
    assert_eq!(service.roster().datasets.len(), 1);
    assert_eq!(service.clear_workspace_now().datasets.len(), 0);

    release.send(()).expect("release the conversion");
    let report = converting
        .join()
        .expect("the conversion thread")
        .expect("a conversion is not cancelled by the workspace moving on");
    assert_eq!(report.to_dto().outcome, "finalized");
}

/// A conversion still waiting for the gate when the user moves on never
/// launches a process.
#[test]
fn a_conversion_superseded_while_it_waits_never_starts() {
    let fixture = TestFile::new("superseded-conversion");
    let acquisition = fixture.thermo_raw("acquisition.raw");
    let destination = fixture.destination("out");
    let (provider, observe_start, release) =
        ConvertingProvider::faithful().parking_the_first_preview();
    let service = Arc::new(PreviewService::new(Box::new(provider)));
    let preview_source = service
        .add_dataset(&fixture.path)
        .expect("add the preview dataset");
    let converted = service
        .add_thermo_dataset(&acquisition)
        .expect("admit the acquisition");

    let opening = std::thread::spawn({
        let service = Arc::clone(&service);
        let handle = preview_source.handle.clone();
        move || service.open_preview(&handle)
    });
    observe_start
        .recv_timeout(Duration::from_secs(10))
        .expect("the preview holds the gate");

    let converting = std::thread::spawn({
        let service = Arc::clone(&service);
        let handle = converted.handle.clone();
        let destination = destination.clone();
        move || service.convert_workspace_dataset(&handle, &destination, ConflictPolicy::Fail)
    });
    // The conversion is now queued. A newer request for the same dataset makes
    // it the one the user is waiting for.
    while service.requests_made(&converted.handle) == 0 {
        std::thread::yield_now();
    }
    let superseding = std::thread::spawn({
        let service = Arc::clone(&service);
        let handle = converted.handle.clone();
        let destination = destination.clone();
        move || service.convert_workspace_dataset(&handle, &destination, ConflictPolicy::Fail)
    });
    while service.requests_made(&converted.handle) < 2 {
        std::thread::yield_now();
    }

    release.send(()).expect("release the preview");
    opening.join().expect("the preview thread").ok();
    let first = converting.join().expect("the superseded conversion thread");
    let second = superseding.join().expect("the newer conversion thread");

    assert!(
        matches!(&first, Err(error) if error.kind == "selection_superseded"),
        "a conversion the user moved past never starts; got {first:?}"
    );
    assert_eq!(
        second
            .expect("the newer conversion reaches an outcome")
            .to_dto()
            .outcome,
        "finalized"
    );
    assert_eq!(entry_names(&destination), vec!["acquisition.mzML"]);
}

/// The source is held against replacement for the whole run, not merely checked
/// before it.
///
/// A comparison either side of a conversion cannot see a file swapped away and
/// swapped back while the backend is reading it. The hold removes that window
/// outright, and this is what shows it is a real hold rather than an intention:
/// while the process is parked, the object cannot be deleted or renamed.
#[cfg(windows)]
#[test]
fn the_source_cannot_be_replaced_while_its_conversion_is_running() {
    let fixture = TestFile::new("held-during-conversion");
    let acquisition = fixture.thermo_raw("acquisition.raw");
    let destination = fixture.destination("out");
    let (runner, observe_start, release) =
        FakeConversionRunner::new(BackendAct::Convert).blocking();
    let provider = Box::new(ConvertingProvider::new(evidenced_capabilities(), runner));
    let service = Arc::new(PreviewService::new(provider));
    let dataset = service
        .add_thermo_dataset(&acquisition)
        .expect("admit the acquisition");

    let converting = std::thread::spawn({
        let service = Arc::clone(&service);
        let handle = dataset.handle.clone();
        let destination = destination.clone();
        move || service.convert_workspace_dataset(&handle, &destination, ConflictPolicy::Fail)
    });
    observe_start
        .recv_timeout(Duration::from_secs(10))
        .expect("the conversion is inside its process");

    assert!(
        fs::remove_file(&acquisition).is_err(),
        "the source of a running conversion may not be deleted out from under it"
    );
    assert!(
        fs::rename(&acquisition, fixture.directory.join("moved.raw")).is_err(),
        "nor renamed, which is the same window by another name"
    );

    release.send(()).expect("release the conversion");
    let report = converting
        .join()
        .expect("the conversion thread")
        .expect("the conversion reaches an outcome");
    assert_eq!(report.to_dto().outcome, "finalized");
}

/// A source another program is writing is not converted.
///
/// The hold this boundary takes permits other readers and refuses writers,
/// deletion and rename. Refusing here is the point: an acquisition somebody
/// else is still writing is not a finished acquisition, and converting it would
/// produce a document describing bytes that were only ever half there. The
/// refusal is retryable, because the answer changes as soon as they are done.
#[cfg(windows)]
#[test]
fn a_source_another_program_is_writing_is_refused_rather_than_read_anyway() {
    use std::os::windows::fs::OpenOptionsExt;

    /// Readers are welcome, which is what lets this get as far as the hold.
    const FILE_SHARE_READ: u32 = 0x0000_0001;

    let fixture = TestFile::new("source-in-use");
    let source = fixture.readable_mzml("acquisition.mzML");
    let destination = fixture.destination("out");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let dataset = service.add_dataset(&source).expect("add the dataset");

    let writer = std::fs::OpenOptions::new()
        .write(true)
        .share_mode(FILE_SHARE_READ)
        .open(&source)
        .expect("hold the source open for writing");

    let error = service
        .convert_workspace_dataset(&dataset.handle, &destination, ConflictPolicy::Fail)
        .expect_err("a file another program is writing is not converted");

    assert_eq!(error.kind, "source_in_use");
    assert!(
        error.retryable,
        "the answer changes once the writer is done"
    );
    assert_eq!(entry_names(&destination), Vec::<String>::new());

    drop(writer);
    let report = service
        .convert_workspace_dataset(&dataset.handle, &destination, ConflictPolicy::Fail)
        .expect("the same dataset converts once nothing else holds it");
    assert_eq!(report.to_dto().outcome, "finalized");
}

/// A conversion never records anything against the dataset it read. The preview
/// on screen still describes that dataset afterwards.
#[test]
fn a_conversion_leaves_the_preview_of_its_dataset_alone() {
    let fixture = TestFile::new("preview-preserved");
    let destination = fixture.destination("out");
    let mut provider = ConvertingProvider::new(
        evidenced_capabilities(),
        FakeConversionRunner::new(BackendAct::Convert),
    );
    provider.inner = FakeProvider::available(open_responses());
    let service = PreviewService::new(Box::new(provider));
    let source = fixture.readable_mzml("acquisition.mzML");
    let dataset = service.add_dataset(&source).expect("add the dataset");
    service
        .open_preview(&dataset.handle)
        .expect("open the dataset");
    assert!(service.holds_preview_state(&dataset.handle));

    service
        .convert_workspace_dataset(&dataset.handle, &destination, ConflictPolicy::Fail)
        .expect("the conversion reaches an outcome");

    assert!(
        service.holds_preview_state(&dataset.handle),
        "a conversion reads the dataset and writes elsewhere; it is not a reload"
    );
}

/// Nothing a conversion reports names a location. The report is what a future
/// surface would be built from, and a path in it is a path that leaves Rust.
#[test]
fn a_conversion_report_never_carries_a_path() {
    let fixture = TestFile::new("path-free-report");
    let acquisition = fixture.thermo_raw("acquisition.raw");
    let destination = fixture.destination("out");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let dataset = service
        .add_thermo_dataset(&acquisition)
        .expect("admit the acquisition");

    let report = service
        .convert_workspace_dataset(&dataset.handle, &destination, ConflictPolicy::Fail)
        .expect("the conversion reaches an outcome");

    let rendered = format!("{:?}", report);
    for fragment in [
        fixture.directory.to_string_lossy().into_owned(),
        destination.to_string_lossy().into_owned(),
        acquisition.to_string_lossy().into_owned(),
        String::from("\\\\?\\"),
    ] {
        assert!(
            !rendered.contains(&fragment),
            "the report names {fragment:?}, which is a location: {rendered}"
        );
    }
    assert!(
        rendered.contains("acquisition.mzML"),
        "the output's own name is a display name, not a location: {rendered}"
    );
}

/// The real vertical, end to end, against a local installation and a real
/// vendor acquisition.
///
/// Ignored by default and the only test here that is. Everything else runs
/// against a substituted backend so the suite is deterministic and needs no
/// installation; this one exists because a deterministic suite cannot tell you
/// that a vendor library on this machine reads this acquisition. It is evidence
/// collection, run deliberately, and what it produces is recorded in ADR 0011
/// rather than asserted here beyond the outcome.
///
/// Run with the acquisition and a destination folder named by environment, so
/// neither the repository nor this file learns a path:
///
/// ```text
/// set MSCANVAS_THERMO_FIXTURE=<path to the acquisition>
/// set MSCANVAS_CONVERSION_DESTINATION=<path to an empty folder>
/// cargo test -p mscanvas-desktop --lib -- --ignored --nocapture real_thermo
/// ```
#[test]
#[ignore = "needs a local ProteoWizard installation and a real vendor acquisition"]
fn a_real_thermo_acquisition_converts_through_a_workspace_handle() {
    let Ok(fixture) = std::env::var("MSCANVAS_THERMO_FIXTURE") else {
        panic!("set MSCANVAS_THERMO_FIXTURE to the acquisition to convert");
    };
    let Ok(destination) = std::env::var("MSCANVAS_CONVERSION_DESTINATION") else {
        panic!("set MSCANVAS_CONVERSION_DESTINATION to an empty folder");
    };
    let acquisition = PathBuf::from(fixture);
    let destination = PathBuf::from(destination);

    // The production provider. Nothing is substituted: this resolves a real
    // installation, reads its real help, and launches its real msconvert.
    let service = PreviewService::new(Box::new(super::backend::ProteoWizardProvider::new()));
    let dataset = service
        .add_thermo_dataset(&acquisition)
        .expect("the acquisition is admitted as a Thermo source");
    println!("dataset handle: {}", dataset.handle);
    println!("admitted bytes: {}", dataset.byte_length);

    let report = service
        .convert_workspace_dataset(&dataset.handle, &destination, ConflictPolicy::Fail)
        .expect("the conversion reaches an outcome");

    println!("report: {:?}", report);
    assert_eq!(
        report.to_dto().outcome,
        "finalized",
        "the evidenced build converts this family"
    );
    assert_eq!(report.to_dto().dataset_handle, dataset.handle);
    assert_eq!(source_kind_id(&report), "thermo_raw");
    let validation = report
        .to_dto()
        .validation
        .expect("a finalized run was judged");
    assert_eq!(validation.mode, ValidationModeDto::OutputOnly);
    assert!(!validation.fully_verified);
}

/// The conversion is stamped with the installation sequence as it stood when
/// the gate was taken, not one read afterwards.
#[test]
fn a_conversion_is_stamped_with_the_installation_it_ran_on() {
    let fixture = TestFile::new("installation-stamp");
    let acquisition = fixture.thermo_raw("acquisition.raw");
    let destination = fixture.destination("out");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let dataset = service
        .add_thermo_dataset(&acquisition)
        .expect("admit the acquisition");

    let first = service
        .convert_workspace_dataset(&dataset.handle, &destination, ConflictPolicy::Skip)
        .expect("the first conversion reaches an outcome");
    let second = service
        .convert_workspace_dataset(&dataset.handle, &destination, ConflictPolicy::Skip)
        .expect("the second conversion reaches an outcome");

    assert_eq!(
        first.to_dto().installation_generation,
        second.to_dto().installation_generation,
        "two runs on one unchanged installation belong to one point in the sequence"
    );
}

// --- The private Shimadzu LabSolutions path ---------------------------------
//
// ADR 0018 established that this repository can recognise and convert one
// LabSolutions acquisition. What is under test here is the other half: that a
// workspace can hold one, carry it whole into the conversion boundary, and
// describe what came back -- and that nothing a user can reach does any of it.
//
// Every test below runs against a substituted backend. The real acquisition is
// a separate ignored run.

/// Admission is the container's contents, and the extension is only a filter.
///
/// The decoys are the point. A LabSolutions `.lcd` and a SCIEX `.wiff` begin
/// with the same eight bytes, so a rule made of the suffix and the signature
/// would admit the wrong vendor's acquisition and leave a launched backend to
/// discover it. None of that logic is written here: this asserts that the
/// desktop crate asks the crate that owns the rule, and gets the crate's
/// answers.
#[test]
fn a_shimadzu_dataset_is_admitted_by_its_container_and_not_by_its_name() {
    let fixture = TestFile::new("shimadzu-admission");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));

    let admitted = fixture.shimadzu_lcd("acquisition.lcd");
    let dataset = service
        .add_shimadzu_dataset(&admitted)
        .expect("a LabSolutions acquisition is admitted");
    assert_eq!(dataset.source_kind, DatasetSourceKindDto::ShimadzuLcd);
    assert_eq!(dataset.file_name, "acquisition.lcd");
    assert_eq!(service.dataset_count(), 1);

    // Another vendor's container under this family's name.
    let other_vendor = fixture.named_bytes("renamed-wiff.lcd", &wiff_like_bytes());
    let refusal = service
        .add_shimadzu_dataset(&other_vendor)
        .expect_err("another vendor's container is not this family");
    assert_eq!(refusal.kind, "unrecognized_acquisition");

    // The magic and nothing else: a compound file holding none of the markers.
    let bare = fixture.named_bytes("bare.lcd", &compound_file_bytes(&[]));
    assert_eq!(
        service
            .add_shimadzu_dataset(&bare)
            .expect_err("the shared magic is not a family")
            .kind,
        "unrecognized_acquisition"
    );

    // Two markers of three. Not two-thirds of an acquisition.
    let partial = fixture.named_bytes("partial.lcd", &compound_file_bytes(&SHIMADZU_MARKERS[..2]));
    assert_eq!(
        service
            .add_shimadzu_dataset(&partial)
            .expect_err("every marker is required")
            .kind,
        "unrecognized_acquisition"
    );

    // A container whose header contradicts itself: version 3 with the sector
    // shift version 4 uses. Refused by the crate's reader, not by anything
    // spelled out in this crate.
    let mut contradictory = shimadzu_lcd_bytes();
    contradictory[30..32].copy_from_slice(&12_u16.to_le_bytes());
    let malformed = fixture.named_bytes("malformed.lcd", &contradictory);
    assert_eq!(
        service
            .add_shimadzu_dataset(&malformed)
            .expect_err("a self-contradicting container is not admitted")
            .kind,
        "unrecognized_acquisition"
    );

    // A directory whose root storage is demoted, so the marker names are there
    // and the thing carrying them is not a directory.
    let mut rootless = shimadzu_lcd_bytes();
    rootless[512 + 66] = 1;
    let no_root = fixture.named_bytes("rootless.lcd", &rootless);
    assert_eq!(
        service
            .add_shimadzu_dataset(&no_root)
            .expect_err("a directory without its root storage is not one")
            .kind,
        "unrecognized_acquisition"
    );

    // Not a compound file at all.
    let archive = fixture.named_bytes("archive.lcd", b"PK\x03\x04 this is a zip archive");
    assert_eq!(
        service
            .add_shimadzu_dataset(&archive)
            .expect_err("an archive is not an acquisition")
            .kind,
        "unrecognized_acquisition"
    );

    // The right container under the wrong name. The installed reader consults
    // the name, so this boundary refuses it here rather than letting a process
    // discover it.
    let misnamed = fixture.named_bytes("acquisition.dat", &shimadzu_lcd_bytes());
    assert_eq!(
        service
            .add_shimadzu_dataset(&misnamed)
            .expect_err("the reader requires the extension")
            .kind,
        "unsupported_extension"
    );

    // A directory named like an acquisition.
    let folder = fixture.directory.join("folder.lcd");
    fs::create_dir(&folder).expect("create a directory named like an acquisition");
    assert!(service.add_shimadzu_dataset(&folder).is_err());

    // Nothing at all behind the name.
    assert!(
        service
            .add_shimadzu_dataset(&fixture.absent("gone.lcd"))
            .is_err()
    );

    // Every refusal above consumed no identifier and left no row.
    assert_eq!(
        service.dataset_count(),
        1,
        "a refused candidate became a dataset"
    );
}

/// One filesystem object is one dataset, whatever it is admitted as and however
/// many times.
#[test]
fn admitting_one_shimadzu_acquisition_twice_keeps_the_row_it_already_has() {
    let fixture = TestFile::new("shimadzu-duplicate");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let acquisition = fixture.shimadzu_lcd("acquisition.lcd");

    let first = service
        .add_shimadzu_dataset(&acquisition)
        .expect("the acquisition is admitted");
    let again = service
        .add_shimadzu_dataset(&acquisition)
        .expect("the same acquisition is the same dataset");

    assert_eq!(first.handle, again.handle);
    assert_eq!(again.source_kind, DatasetSourceKindDto::ShimadzuLcd);
    assert_eq!(service.dataset_count(), 1);
}

/// The family recorded at admission is the family every later use re-applies.
///
/// The three admissions are not interchangeable and this is where that is
/// stated: an LCD is not admitted by the mzML rule or the Thermo rule, a Thermo
/// acquisition is not admitted by the LCD rule, and the family a row carries is
/// not something a later step can choose differently.
#[test]
fn the_family_recorded_at_admission_is_the_one_every_later_use_applies() {
    let fixture = TestFile::new("shimadzu-family");
    let acquisition = fixture.shimadzu_lcd("acquisition.lcd");
    let thermo = fixture.thermo_raw("acquisition.raw");

    // No family admits another's acquisition.
    assert!(accept_mzml_file(&acquisition).is_err());
    assert!(accept_thermo_raw_file(&acquisition).is_err());
    assert!(accept_shimadzu_lcd_file(&thermo).is_err());
    assert!(accept_shimadzu_lcd_file(&fixture.path).is_err());

    // The row keeps the family it was admitted under, and revalidating it
    // re-applies that family rather than whichever rule runs first.
    let accepted = accept_shimadzu_lcd_file(&acquisition).expect("admit the acquisition");
    assert_eq!(accepted.source_kind(), DatasetSourceKind::ShimadzuLcd);
    let again = revalidate(&accepted).expect("an unchanged acquisition revalidates");
    assert_eq!(again.source_kind(), DatasetSourceKind::ShimadzuLcd);

    // Same name, different bytes: the digest is not what catches this, the
    // family rule is -- the replacement is not a LabSolutions container.
    fs::write(&acquisition, wiff_like_bytes()).expect("replace the acquisition");
    let refusal = revalidate(&accepted).expect_err("a replaced acquisition is refused");
    assert_eq!(refusal.kind, "unrecognized_acquisition");

    // And a genuine acquisition of the same family at the same name is still a
    // different object than the one that was admitted.
    fs::remove_file(&acquisition).expect("remove the replacement");
    fs::write(&acquisition, shimadzu_lcd_bytes()).expect("write a second acquisition");
    let refusal = revalidate(&accepted).expect_err("a different object is not this dataset");
    assert_eq!(refusal.kind, "file_identity_changed");

    // The mapping into the conversion boundary's own vocabulary is exact. This
    // is what makes the provider-build gate below a question about *this*
    // family: the gate is asked with whatever this returns.
    assert_eq!(
        conversion_source_kind(DatasetSourceKind::ShimadzuLcd),
        ConversionSourceKind::ShimadzuLcdFile
    );
    assert_eq!(
        conversion_source_kind(DatasetSourceKind::ThermoRaw),
        ConversionSourceKind::ThermoRawFile
    );

    // The family is not previewable, and -- since M3.9 -- is queue-eligible.
    assert!(!DatasetSourceKind::ShimadzuLcd.is_previewable());
    assert!(is_convertible(DatasetSourceKind::ShimadzuLcd));
    assert!(is_convertible(DatasetSourceKind::ThermoRaw));
    assert!(!is_convertible(DatasetSourceKind::Mzml));
}

/// An acquisition another program is writing is not a finished acquisition.
#[cfg(windows)]
#[test]
fn a_shimadzu_acquisition_being_written_is_not_admitted() {
    use std::os::windows::fs::OpenOptionsExt;

    /// Share reads only: our read is still permitted, so the refusal is about
    /// write sharing rather than about the file being open at all.
    const FILE_SHARE_READ: u32 = 0x0000_0001;

    let fixture = TestFile::new("shimadzu-writer");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let acquisition = fixture.shimadzu_lcd("acquisition.lcd");

    let writer = fs::OpenOptions::new()
        .write(true)
        .share_mode(FILE_SHARE_READ)
        .open(&acquisition)
        .expect("hold the acquisition open for writing");

    assert!(
        service.add_shimadzu_dataset(&acquisition).is_err(),
        "an acquisition with a writer on it was admitted"
    );

    drop(writer);
    assert!(
        service.add_shimadzu_dataset(&acquisition).is_ok(),
        "the acquisition is admitted once the writer has gone"
    );
}

/// The whole private vertical: a workspace handle in, a judged output back.
#[test]
fn a_shimadzu_workspace_dataset_converts_through_the_private_path() {
    let fixture = TestFile::new("shimadzu-convert");
    let acquisition = fixture.shimadzu_lcd("acquisition.lcd");
    let destination = fixture.destination("out");
    let provider = ConvertingProvider::faithful();
    let launches = provider.runner.launches();
    let service = PreviewService::new(Box::new(provider));

    let dataset = service
        .add_shimadzu_dataset(&acquisition)
        .expect("admit the acquisition");
    let report = service
        .convert_workspace_dataset(&dataset.handle, &destination, ConflictPolicy::Fail)
        .expect("the conversion reaches an outcome");

    let dto = report.to_dto();
    assert_eq!(dto.outcome, "finalized");
    assert_eq!(dto.dataset_handle, dataset.handle);
    assert_eq!(dto.source_kind, DatasetSourceKindDto::ShimadzuLcd);
    assert_eq!(dto.output_file_name.as_deref(), Some("acquisition.mzML"));
    assert_eq!(entry_names(&destination), vec!["acquisition.mzML"]);
    assert_eq!(launches.load(Ordering::SeqCst), 1);
    assert!(dto.staging_residue.is_none());

    // Output-only, and never claiming to be more. A vendor acquisition is not
    // mzML, so nothing about the output can be compared against a document that
    // was never read -- which is why the source-side properties come back
    // inapplicable rather than merely unverified.
    let validation = dto.validation.expect("a finalized run was judged");
    assert_eq!(validation.mode, ValidationModeDto::OutputOnly);
    assert!(
        !validation.fully_verified,
        "an output-only judgement claimed full verification"
    );
    assert!(!validation.inapplicable.is_empty());
    let output = dto.output.expect("a finalized run measured its output");
    assert!(output.byte_length > 0);
    assert_eq!(output.spectrum_count, 2);
}

/// Zero spectra and some chromatograms is a real acquisition, not a defect.
///
/// The second lawful LabSolutions fixture converts to exactly this shape, so a
/// contract that rejected it would refuse a real acquisition. Asserted here
/// without an installation, and confirmed against the real one by the ignored
/// evidence run.
#[test]
fn a_chromatogram_only_shimadzu_output_is_finalized() {
    let fixture = TestFile::new("shimadzu-chromatograms");
    let acquisition = fixture.shimadzu_lcd("acquisition.lcd");
    let destination = fixture.destination("out");
    let service = PreviewService::new(Box::new(ConvertingProvider::new(
        evidenced_capabilities(),
        FakeConversionRunner::new(BackendAct::ConvertChromatogramsOnly),
    )));

    let dataset = service
        .add_shimadzu_dataset(&acquisition)
        .expect("admit the acquisition");
    let report = service
        .convert_workspace_dataset(&dataset.handle, &destination, ConflictPolicy::Fail)
        .expect("the conversion reaches an outcome");

    let dto = report.to_dto();
    assert_eq!(dto.outcome, "finalized");
    let output = dto.output.expect("a finalized run measured its output");
    assert_eq!(output.spectrum_count, 0);
    assert_eq!(output.chromatogram_count, 144);
    let validation = dto.validation.expect("a finalized run was judged");
    assert_eq!(validation.mode, ValidationModeDto::OutputOnly);
    assert!(!validation.fully_verified);
}

/// The gate is asked about this family, on this build, before anything exists.
#[test]
fn a_shimadzu_conversion_runs_only_on_a_build_evidenced_for_this_family() {
    let fixture = TestFile::new("shimadzu-evidence");
    let acquisition = fixture.shimadzu_lcd("acquisition.lcd");

    let attempt = |capabilities: InstalledHelpCapabilities, label: &str| {
        let destination = fixture.destination(label);
        let provider =
            ConvertingProvider::new(capabilities, FakeConversionRunner::new(BackendAct::Convert));
        let launches = provider.runner.launches();
        let service = PreviewService::new(Box::new(provider));
        let dataset = service
            .add_shimadzu_dataset(&acquisition)
            .expect("admit the acquisition");
        let outcome =
            service.convert_workspace_dataset(&dataset.handle, &destination, ConflictPolicy::Fail);
        (
            outcome.map(|report| report.to_dto().outcome),
            launches.load(Ordering::SeqCst),
            entry_names(&destination),
        )
    };

    let (outcome, launches, entries) = attempt(evidenced_capabilities(), "evidenced");
    assert_eq!(outcome.expect("the evidenced build converts"), "finalized");
    assert_eq!(launches, 1);
    assert_eq!(entries, vec!["acquisition.mzML"]);

    // A different release, a different revision, a build that will not say, and
    // the same two strings out of a different executable. Every one of them is
    // refused, nothing is launched, and the destination stays empty -- the
    // refusal happens before a staging directory could exist.
    for (capabilities, label) in [
        (
            conversion_capabilities("3.0.26204", Some("a09eea9"), EVIDENCED_EXECUTABLE_SHA256),
            "other-release",
        ),
        (
            conversion_capabilities(
                EVIDENCED_RELEASE,
                Some("deadbee"),
                EVIDENCED_EXECUTABLE_SHA256,
            ),
            "other-revision",
        ),
        (
            conversion_capabilities(EVIDENCED_RELEASE, None, EVIDENCED_EXECUTABLE_SHA256),
            "no-revision",
        ),
        (
            conversion_capabilities(
                EVIDENCED_RELEASE,
                Some(EVIDENCED_REVISION),
                OTHER_EXECUTABLE_SHA256,
            ),
            "other-executable",
        ),
    ] {
        let (outcome, launches, entries) = attempt(capabilities, label);
        assert_eq!(
            outcome.expect_err("an unevidenced build is refused").kind,
            "provider_build_not_evidenced",
            "{label}"
        );
        assert_eq!(
            launches, 0,
            "{label}: an unevidenced build launched a process"
        );
        assert!(
            entries.is_empty(),
            "{label}: an unevidenced build created {entries:?}"
        );
    }
}

/// Every handle that is not a live Shimadzu row, refused.
#[test]
fn only_a_live_shimadzu_handle_reaches_the_private_conversion() {
    let fixture = TestFile::new("shimadzu-handles");
    let acquisition = fixture.shimadzu_lcd("acquisition.lcd");
    let destination = fixture.destination("out");
    let provider = ConvertingProvider::faithful();
    let launches = provider.runner.launches();
    let service = PreviewService::new(Box::new(provider));

    // A handle the session never issued.
    assert_eq!(
        service
            .convert_workspace_dataset("file-404", &destination, ConflictPolicy::Fail)
            .expect_err("an unknown handle names no dataset")
            .kind,
        "unknown_file_handle"
    );

    // An mzML row is not a Shimadzu row, and the private path will not treat it
    // as one: its own family is not convertible at all.
    let mzml = service
        .add_dataset(&fixture.readable_mzml("sample.mzML"))
        .expect("admit an mzML dataset");
    let report = service
        .convert_workspace_dataset(&mzml.handle, &destination, ConflictPolicy::Fail)
        .expect("an mzML conversion reaches an outcome");
    assert_eq!(report.to_dto().source_kind, DatasetSourceKindDto::Mzml);

    // A revoked row's handle names nothing afterwards.
    let dataset = service
        .add_shimadzu_dataset(&acquisition)
        .expect("admit the acquisition");
    service
        .remove_datasets(std::slice::from_ref(&dataset.handle))
        .expect("the row is removed");
    assert_eq!(
        service
            .convert_workspace_dataset(&dataset.handle, &destination, ConflictPolicy::Fail)
            .expect_err("a revoked handle names no dataset")
            .kind,
        "unknown_file_handle"
    );
    assert_eq!(
        launches.load(Ordering::SeqCst),
        1,
        "only the one convertible row launched anything"
    );
}

/// The workspace and the conversion must name one filesystem object.
///
/// The window this closes is real: the row is revalidated, then the object is
/// pinned, then it is re-admitted as a conversion source. Comparing the two
/// identities is what makes those three steps about one file rather than three
/// resolutions of one name.
#[test]
fn a_shimadzu_conversion_refuses_a_source_that_is_not_the_admitted_object() {
    let fixture = TestFile::new("shimadzu-identity");
    let acquisition = fixture.shimadzu_lcd("acquisition.lcd");
    let elsewhere = fixture.shimadzu_lcd("second.lcd");

    let accepted = accept_shimadzu_lcd_file(&acquisition).expect("admit the acquisition");
    let other = accept_shimadzu_lcd_file(&elsewhere).expect("admit the other acquisition");

    // The same family, the same rule, a different object. Opening the source
    // for one row against the other's identity is refused.
    // And the honest pairing opens, so the refusal below is about the mismatch
    // rather than about either row.
    assert!(open_conversion_source(&accepted).is_ok());

    let confused = accepted.misremembering_its_object(other.identity());
    let refusal =
        open_conversion_source(&confused).expect_err("two objects are not one conversion");
    assert_eq!(refusal.kind, "file_identity_changed");
}

/// A refused or non-finalizing run names no output and leaks no location.
#[test]
fn a_shimadzu_report_names_no_output_it_did_not_produce_and_no_path_at_all() {
    let fixture = TestFile::new("shimadzu-report");
    let acquisition = fixture.shimadzu_lcd("acquisition.lcd");

    let attempt = |act: BackendAct, label: &str, conflict: ConflictPolicy| {
        let destination = fixture.destination(label);
        let service = PreviewService::new(Box::new(ConvertingProvider::new(
            evidenced_capabilities(),
            FakeConversionRunner::new(act),
        )));
        let dataset = service
            .add_shimadzu_dataset(&acquisition)
            .expect("admit the acquisition");
        let report = service
            .convert_workspace_dataset(&dataset.handle, &destination, conflict)
            .expect("the conversion reaches an outcome");
        (format!("{:?}", report), report.to_dto())
    };

    // The backend rejected its input. No output name, no measurements, no
    // judgement -- there is nothing to have judged.
    let (_, dto) = attempt(BackendAct::Fail, "failed", ConflictPolicy::Fail);
    assert_eq!(dto.outcome, "backend_rejected");
    assert!(dto.output_file_name.is_none());
    assert!(dto.output.is_none());
    assert!(dto.validation.is_none());
    assert!(
        dto.staging_residue.is_none(),
        "a refused run swept its staging"
    );

    // The backend exited cleanly having written nothing at all.
    let (_, dto) = attempt(BackendAct::WriteNothing, "nothing", ConflictPolicy::Fail);
    assert_eq!(dto.outcome, "output_rejected");
    assert_eq!(dto.detailed_outcome.as_deref(), Some("missing_output"));
    assert!(dto.output_file_name.is_none());

    // A document with no records at all is refused, and the contrast with the
    // chromatogram-only test above is the point: zero spectra is not what makes
    // an output unacceptable -- zero *records* is. A contract that keyed on the
    // spectrum count would have refused a real LabSolutions acquisition.
    let (_, dto) = attempt(BackendAct::ConvertEmpty, "empty", ConflictPolicy::Fail);
    assert_eq!(dto.outcome, "output_rejected");
    assert_eq!(
        dto.detailed_outcome.as_deref(),
        Some("output_contains_no_records")
    );

    // The whole report, printed. A roster of many rows is where a path would
    // leak the most, and a report is what a panic or a log would reach.
    let (rendered, _) = attempt(BackendAct::Convert, "printed", ConflictPolicy::Fail);
    for fragment in [
        fixture.directory.to_string_lossy().into_owned(),
        String::from("acquisition.lcd"),
        String::from(":\\"),
        String::from("\\\\?\\"),
    ] {
        assert!(
            !rendered.contains(&fragment),
            "the report names {fragment:?}, which is a location: {rendered}"
        );
    }
    assert!(
        rendered.contains("ShimadzuLcd"),
        "the report says which family it converted: {rendered}"
    );
    assert!(rendered.contains("acquisition.mzML"));
}

/// Nothing a user can reach admits, lists or converts this family.
///
/// The private path exists and the product does not have it. Asserted against
/// the surfaces themselves rather than by reading the code: the picker, the
/// folder import, the Explorer drop and the visible queue each get a real
/// LabSolutions acquisition and each refuses it.
#[test]
fn the_picker_admits_the_shimadzu_family_and_no_walking_surface_does() {
    let fixture = TestFile::new("shimadzu-reachable");
    let acquisition = fixture.shimadzu_lcd("acquisition.lcd");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));

    // The picker. `.lcd` now routes to the family's own admission -- and the
    // extension only routes. The bytes are what admit, so another vendor's
    // container and an archive under this name are refused by the container
    // rule, not silently taken on trust.
    let admitted =
        accept_workspace_file(&acquisition).expect("the picker admits a LabSolutions acquisition");
    assert_eq!(admitted.source_kind(), DatasetSourceKind::ShimadzuLcd);
    assert_eq!(
        accept_workspace_file(&fixture.named_bytes("renamed-wiff.lcd", &wiff_like_bytes()))
            .expect_err("another vendor's container is not this family")
            .kind,
        "unrecognized_acquisition"
    );
    assert_eq!(
        accept_workspace_file(&fixture.named_bytes("archive.lcd", b"PK this is a zip archive"))
            .expect_err("an archive is not an acquisition")
            .kind,
        "unrecognized_acquisition"
    );
    // LCD bytes under an unsupported name stay unidentified: the routing never
    // sniffs content, so they reach mzML admission and are refused by name.
    assert_eq!(
        accept_workspace_file(&fixture.named_bytes("acquisition.dat", &shimadzu_lcd_bytes()))
            .expect_err("no surface identifies a family the name did not propose")
            .kind,
        "unsupported_extension"
    );

    // The visible queue plans this family now, and the plan says which family
    // each row is.
    let dataset = service
        .add_files(std::slice::from_ref(&acquisition))
        .expect("the picker batch admits the acquisition")
        .outcomes
        .first()
        .and_then(|outcome| match outcome {
            WorkspaceAddOutcomeDto::Added { dataset } => Some(dataset.clone()),
            _ => None,
        })
        .expect("the acquisition became a row");
    assert_eq!(dataset.source_kind, DatasetSourceKindDto::ShimadzuLcd);
    let plan = service
        .conversion_plan_summary(&dataset.handle)
        .expect("the visible queue plans this family");
    assert_eq!(plan.items.len(), 1);
    assert_eq!(
        plan.items[0].source_kind,
        DatasetSourceKindDto::ShimadzuLcd,
        "the plan row says which family it is"
    );
    assert_eq!(plan_output_name(&plan.items[0]), "acquisition.mzML");

    // Folder discovery does not walk into this family. A scan of the fixture
    // folder proposes the mzML and never the acquisition beside it.
    let proposals = super::discovery::discover_mzml_candidates(
        &fixture.directory,
        super::discovery::DiscoveryBudget::default(),
    )
    .expect("the folder scan completes");
    assert!(
        proposals.candidates().iter().all(|candidate| {
            candidate
                .path()
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("mzml"))
        }),
        "a folder walk proposed a vendor acquisition"
    );

    // And it is still not previewable: converting is the way to read one.
    assert_eq!(
        service
            .open_preview(&dataset.handle)
            .expect_err("a vendor acquisition has no direct preview")
            .kind,
        "dataset_not_previewable"
    );
}

/// The real visible vertical for Shimadzu, and the real mixed queue.
///
/// Ignored by default, like the Thermo one beside it. Run with the two lawful
/// Shimadzu fixtures, the lawful Thermo fixture, and an empty destination
/// folder named by environment:
///
/// ```text
/// set MSCANVAS_SHIMADZU_LCD_FIXTURE=<path to 10nmol...lcd>
/// set MSCANVAS_SHIMADZU_LCD_FIXTURE_B=<path to the scheduled ...lcd>
/// set MSCANVAS_THERMO_FIXTURE=<path to FT-HCD-MSX.raw>
/// set MSCANVAS_CONVERSION_DESTINATION=<path to an empty folder>
/// cargo test -p mscanvas-desktop --lib -- --ignored --nocapture visible_shimadzu
/// ```
#[test]
#[ignore = "needs a local ProteoWizard installation and real vendor acquisitions"]
fn the_visible_workflow_converts_real_shimadzu_and_mixed_queues_end_to_end() {
    let fixture_a = PathBuf::from(
        std::env::var("MSCANVAS_SHIMADZU_LCD_FIXTURE").expect("set MSCANVAS_SHIMADZU_LCD_FIXTURE"),
    );
    let fixture_b = PathBuf::from(
        std::env::var("MSCANVAS_SHIMADZU_LCD_FIXTURE_B")
            .expect("set MSCANVAS_SHIMADZU_LCD_FIXTURE_B"),
    );
    let thermo = PathBuf::from(
        std::env::var("MSCANVAS_THERMO_FIXTURE").expect("set MSCANVAS_THERMO_FIXTURE"),
    );
    let destination = PathBuf::from(
        std::env::var("MSCANVAS_CONVERSION_DESTINATION")
            .expect("set MSCANVAS_CONVERSION_DESTINATION"),
    );

    // Scenario A: the production Add-files path admits both fixtures as their
    // family, launches nothing, and refuses a renamed compound-file control.
    let service = PreviewService::new(Box::new(super::backend::ProteoWizardProvider::new()));
    let batch = service.add_files_now(&[fixture_a.clone(), fixture_b.clone(), thermo.clone()]);
    let kinds: Vec<DatasetSourceKindDto> = batch
        .roster
        .datasets
        .iter()
        .map(|dataset| dataset.source_kind)
        .collect();
    assert_eq!(
        kinds,
        vec![
            DatasetSourceKindDto::ShimadzuLcd,
            DatasetSourceKindDto::ShimadzuLcd,
            DatasetSourceKindDto::ThermoRaw,
        ],
        "the picker admits both families in picker order"
    );
    let handles: Vec<String> = batch
        .roster
        .datasets
        .iter()
        .map(|dataset| dataset.handle.clone())
        .collect();
    let control =
        std::env::temp_dir().join(format!("mscanvas-renamed-wiff-{}.lcd", std::process::id()));
    fs::write(&control, wiff_like_bytes()).expect("write the negative control");
    let refused = service.add_files_now(std::slice::from_ref(&control));
    assert!(
        matches!(
            refused.outcomes.first(),
            Some(WorkspaceAddOutcomeDto::Rejected { error, .. })
                if error.kind == "unrecognized_acquisition"
        ),
        "a renamed compound file of another vendor is refused"
    );
    let _ = fs::remove_file(&control);

    // Scenario C (which subsumes B): a deliberately ordered mixed queue --
    // Shimadzu A, Thermo, Shimadzu B -- through the product queue on the real
    // evidenced build.
    let document = current_document(&service);
    let plan = service
        .conversion_queue_plan(&handles)
        .expect("the mixed queue has a plan");
    assert_eq!(plan.items.len(), 3);
    let reservation = service
        .begin_conversion_queue(&handles, ConversionConflictPolicyDto::Fail, document)
        .expect("the mixed queue is admitted");
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("claim it");
    let update = service.run_claimed_conversion(operation, &destination);
    assert_eq!(
        terminal_reason(&update),
        ConversionQueueTerminalReasonDto::Completed
    );
    let queue = terminal_queue(&update);
    println!("mixed queue: {queue:?}");
    for item in &queue.items {
        assert_eq!(item.state, ConversionQueueItemStateDto::Finalized);
        let report = item_report(item).expect("finalized items report");
        let validation = report.validation.as_ref().expect("judged");
        assert_eq!(validation.mode, ValidationModeDto::OutputOnly);
        assert!(!validation.fully_verified);
    }
    // The chromatogram-only shape survives the whole visible vertical.
    let scheduled = queue
        .items
        .iter()
        .find(|item| {
            item_report(item)
                .as_ref()
                .and_then(|report| report.output.as_ref())
                .is_some_and(|output| output.spectrum_count == 0)
        })
        .expect("the scheduled fixture converts to a chromatogram-only document");
    let output = item_report(scheduled)
        .and_then(|report| report.output.as_ref())
        .expect("measured");
    assert_eq!(output.chromatogram_count, 144);
    assert_eq!(
        entry_names(&destination).len(),
        3,
        "three mzML, no sidecars"
    );

    // Scenario B's adoption tail: the Shimadzu outputs enter the workspace as
    // ordinary mzML rows, and nothing auto-previews them.
    let before = service.roster().datasets.len();
    let adopted = service
        .adopt_conversion_outputs(&operation.to_string(), document)
        .expect("finalized outputs are adoptable");
    assert_eq!(service.roster().datasets.len(), before + 3);
    for outcome in &adopted.outcomes {
        let WorkspaceOutputAdoptionOutcomeDto::Added { dataset, .. } = outcome else {
            panic!("every output was added; got {outcome:?}");
        };
        assert_eq!(dataset.source_kind, DatasetSourceKindDto::Mzml);
    }
}

/// The real Stop against a running Shimadzu process, when timing permits.
///
/// Scenario E. The queue is one real Shimadzu conversion; the stop is issued
/// the moment the slot says the item is running. On this machine the real
/// conversion takes around two seconds, so the stop normally lands while the
/// process is alive -- but a natural completion is reported truthfully rather
/// than faked into a cancellation.
///
/// ```text
/// set MSCANVAS_SHIMADZU_LCD_FIXTURE=<path to the acquisition>
/// set MSCANVAS_CONVERSION_DESTINATION=<path to an empty folder>
/// cargo test -p mscanvas-desktop --lib -- --ignored --nocapture real_shimadzu_stop
/// ```
#[test]
#[ignore = "needs a local ProteoWizard installation and a real vendor acquisition"]
fn a_real_shimadzu_stop_terminates_the_owned_process_tree() {
    let acquisition = PathBuf::from(
        std::env::var("MSCANVAS_SHIMADZU_LCD_FIXTURE").expect("set MSCANVAS_SHIMADZU_LCD_FIXTURE"),
    );
    let destination = PathBuf::from(
        std::env::var("MSCANVAS_CONVERSION_DESTINATION")
            .expect("set MSCANVAS_CONVERSION_DESTINATION"),
    );
    let service = Arc::new(PreviewService::new(Box::new(
        super::backend::ProteoWizardProvider::new(),
    )));
    let handle = add_one_acquisition(&service, &acquisition);
    let document = current_document(&service);
    let reservation = service
        .begin_conversion(&handle, ConversionConflictPolicyDto::Fail, document)
        .expect("the row converts");
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("claim it");
    let worker = {
        let service = Arc::clone(&service);
        let destination = destination.clone();
        std::thread::spawn(move || service.run_claimed_conversion(operation, &destination))
    };
    // An observable milestone, not a sleep: the queue's *item* says when it is
    // running, which is after the backend was bound and the item started --
    // the whole-queue Running state arrives earlier, while the first item is
    // still pending, and a stop issued then would land before any process.
    loop {
        if let WorkspaceConversionStateDto::Running { queue, .. } = service.conversion_state().state
            && queue
                .items
                .first()
                .is_some_and(|item| item.state == ConversionQueueItemStateDto::Running)
        {
            break;
        }
        std::thread::yield_now();
    }
    let stopped = service
        .stop_conversion_queue(&operation.to_string(), document)
        .expect("the running queue is stoppable");
    println!("stop accepted from state: {:?}", stopped.state);
    let update = worker.join().expect("the worker finishes");
    let queue = terminal_queue(&update);
    println!("terminal: {queue:?}");

    match terminal_reason(&update) {
        ConversionQueueTerminalReasonDto::Stopped => {
            let item = &queue.items[0];
            match item.state {
                ConversionQueueItemStateDto::Cancelled => {
                    let facts = item.cancellation.as_ref().expect("a reached stop reports");
                    assert!(facts.termination_requested);
                    assert!(
                        facts.tree_termination_confirmed,
                        "no owned converter survives a confirmed stop"
                    );
                    assert!(
                        entry_names(&destination).is_empty(),
                        "a cancelled conversion finalizes nothing"
                    );
                    println!(
                        "real stop: cancelled, tree confirmed empty, staging residue {:?}",
                        facts.staging_residue
                    );
                }
                ConversionQueueItemStateDto::Finalized => {
                    // The process finished in the window between the running
                    // state and the stop reaching it. Reported truthfully.
                    println!("real stop: natural completion won the race");
                }
                ConversionQueueItemStateDto::NotRun => {
                    // The stop landed in the interval between the item being
                    // observed running and its process being bound. Truthful,
                    // and weaker than the run this test wants -- rerun it.
                    println!("real stop: landed before the process launched (notRun)");
                }
                other => {
                    panic!("a stopped queue's item is cancelled, finalized or notRun: {other:?}")
                }
            }
        }
        ConversionQueueTerminalReasonDto::Completed => {
            println!("real stop: the queue completed before the stop was accepted");
        }
        other => panic!("a real stop must not fail: {other:?}"),
    }
}

/// The real private vertical, from a workspace handle to a judged output.
///
/// Ignored by default, like the Thermo one it sits beside and for the same
/// reason: a deterministic suite cannot tell you that the Shimadzu library on
/// this machine reads this acquisition. This is evidence collection, run
/// deliberately, and what it produces is recorded in ADR 0018 and ADR 0019.
///
/// It deliberately starts from `add_shimadzu_dataset` rather than from a
/// directly constructed `ConversionSource`. Constructing one would prove the
/// crate can convert the file, which ADR 0018 already established; what is
/// under test here is the join -- that a workspace row carries the family, the
/// identity and the lease all the way into the boundary and back.
///
/// Run with the acquisition and a destination folder named by environment, so
/// neither the repository nor this file learns a path:
///
/// ```text
/// set MSCANVAS_SHIMADZU_LCD_FIXTURE=<path to the acquisition>
/// set MSCANVAS_CONVERSION_DESTINATION=<path to an empty folder>
/// cargo test -p mscanvas-desktop --lib -- --ignored --nocapture real_shimadzu
/// ```
#[test]
#[ignore = "needs a local ProteoWizard installation and a real vendor acquisition"]
fn a_real_shimadzu_acquisition_converts_through_a_workspace_handle() {
    let Ok(fixture) = std::env::var("MSCANVAS_SHIMADZU_LCD_FIXTURE") else {
        panic!("set MSCANVAS_SHIMADZU_LCD_FIXTURE to the acquisition to convert");
    };
    let Ok(destination) = std::env::var("MSCANVAS_CONVERSION_DESTINATION") else {
        panic!("set MSCANVAS_CONVERSION_DESTINATION to an empty folder");
    };
    let acquisition = PathBuf::from(fixture);
    let destination = PathBuf::from(destination);

    // The production provider. Nothing is substituted: this resolves a real
    // installation, reads its real help, and launches its real msconvert.
    let service = PreviewService::new(Box::new(super::backend::ProteoWizardProvider::new()));
    let dataset = service
        .add_shimadzu_dataset(&acquisition)
        .expect("the acquisition is admitted as a Shimadzu LCD source");
    println!("dataset handle: {}", dataset.handle);
    println!("admitted bytes: {}", dataset.byte_length);
    assert_eq!(dataset.source_kind, DatasetSourceKindDto::ShimadzuLcd);

    let report = service
        .convert_workspace_dataset(&dataset.handle, &destination, ConflictPolicy::Fail)
        .expect("the conversion reaches an outcome");

    println!("report: {:?}", report);
    let dto = report.to_dto();
    assert_eq!(
        dto.outcome, "finalized",
        "the evidenced build converts this family"
    );
    assert_eq!(dto.dataset_handle, dataset.handle);
    assert_eq!(source_kind_id(&report), "shimadzu_lcd");
    assert!(dto.staging_residue.is_none(), "the run swept its staging");

    let validation = dto.validation.expect("a finalized run was judged");
    assert_eq!(validation.mode, ValidationModeDto::OutputOnly);
    assert!(!validation.fully_verified);

    // One mzML and nothing beside it. The measured layout, asserted rather than
    // assumed -- a sidecar would mean the one-source/one-output plan does not
    // describe this family after all.
    let entries = entry_names(&destination);
    println!("destination entries: {entries:?}");
    assert_eq!(entries.len(), 1);

    // Printed rather than pinned. The output digest is not a portable fact
    // about this family: msconvert writes the source's own directory into the
    // document, so the same acquisition converted from another folder hashes
    // differently. See the M3.7 evidence record.
    let output = dto.output.expect("a finalized run measured its output");
    println!(
        "output bytes: {} spectra: {} chromatograms: {}",
        output.byte_length, output.spectrum_count, output.chromatogram_count
    );
}

/// The command surface is exactly what it was.
///
/// A private family is private only for as long as no command reaches it. This
/// reads the registration list out of the source and requires it to be
/// unchanged, so adding a Shimadzu command would fail here rather than in
/// review.
#[test]
fn the_command_surface_does_not_grow_for_the_private_family() {
    let source = include_str!("../lib.rs");
    let handler = source
        .split_once("generate_handler![")
        .expect("the command registration list is in lib.rs")
        .1
        .split_once(']')
        .expect("the registration list is closed")
        .0;
    assert!(
        !handler.to_ascii_lowercase().contains("shimadzu"),
        "a command names this family: {handler}"
    );
    assert!(
        !handler.to_ascii_lowercase().contains("lcd"),
        "a command names this family: {handler}"
    );
}

/// The single-output report of one item's latest attempt, if it had one.
///
/// The wire carries the attempt result in the cardinality it had, so reading a
/// single report is now asking for that arm rather than for a field. An item
/// that ran a backend-named set answers `None` here and carries its group
/// report under [`item_set_report`] instead.
fn item_report(
    item: &super::dto::ConversionQueueItemDto,
) -> Option<&super::dto::ConversionReportDto> {
    match item.result.as_ref()? {
        super::dto::ConversionAttemptResultDto::Single { report } => Some(report),
        super::dto::ConversionAttemptResultDto::OutputSet { .. } => None,
    }
}

/// The group report of one item's latest attempt, if it ran a set.
fn item_set_report(
    item: &super::dto::ConversionQueueItemDto,
) -> Option<&super::dto::ConversionOutputSetReportDto> {
    match item.result.as_ref()? {
        super::dto::ConversionAttemptResultDto::OutputSet { report } => Some(report),
        super::dto::ConversionAttemptResultDto::Single { .. } => None,
    }
}

/// The name a known-single queue item will produce.
///
/// Panics for a backend-named set, deliberately: a set has no such name, and a
/// test asking for one is asking the wrong question.
fn item_output_name(item: &super::dto::ConversionQueueItemDto) -> &str {
    match &item.output {
        super::dto::ConversionOutputPlanDto::KnownSingle { file_name } => file_name.as_str(),
        super::dto::ConversionOutputPlanDto::BackendNamedSet { .. } => {
            panic!("a backend-named set has no single output name")
        }
    }
}

/// The name a known-single plan row will produce.
fn plan_output_name(item: &super::dto::ConversionQueuePlanItemDto) -> &str {
    match &item.output {
        super::dto::ConversionOutputPlanDto::KnownSingle { file_name } => file_name.as_str(),
        super::dto::ConversionOutputPlanDto::BackendNamedSet { .. } => {
            panic!("a backend-named set has no single output name")
        }
    }
}

/// The one report of a queue of one, whatever terminal shape it took.
fn sole_report(state: &WorkspaceConversionStateDto) -> Option<super::dto::ConversionReportDto> {
    let WorkspaceConversionStateDto::Terminal { queue, .. } = state else {
        return None;
    };
    queue
        .items
        .first()
        .and_then(|item| item_report(item).cloned())
}

/// The queue-level refusal of a terminal queue, if it has one.
fn queue_error(state: &WorkspaceConversionStateDto) -> Option<super::dto::PreviewErrorDto> {
    let WorkspaceConversionStateDto::Terminal { queue, .. } = state else {
        return None;
    };
    queue
        .error
        .clone()
        .or_else(|| queue.items.first().and_then(|item| item.error.clone()))
}

// --- The visible conversion workflow ----------------------------------------
//
// One focused Thermo RAW row, one destination the user chooses, one conversion.
// Everything below drives the same service the commands adapt, so what is under
// test is the boundary rather than a stand-in for it.

/// Holds one acquisition open for writing, as another program would.
///
/// Readers are welcome, which is what lets the queue get as far as the hold it
/// then cannot take -- the one condition this repository has evidence for as
/// transient, and therefore the one a retry is offered for.
#[cfg(windows)]
fn hold_for_writing(path: &Path) -> std::fs::File {
    use std::os::windows::fs::OpenOptionsExt;

    const FILE_SHARE_READ: u32 = 0x0000_0001;

    std::fs::OpenOptions::new()
        .write(true)
        .share_mode(FILE_SHARE_READ)
        .open(path)
        .expect("hold the acquisition open for writing")
}

/// A destination folder beside the fixture, for outputs to land in.
fn destination_root(fixture: &TestFile, name: &str) -> PathBuf {
    let path = fixture.directory.join(name);
    fs::create_dir_all(&path).expect("create a destination root");
    path
}

/// The document epoch the current main document would prove.
fn current_document(service: &PreviewService) -> u64 {
    service.workspace_drop_document_epoch()
}

/// Adds one Thermo acquisition through the product's own picker path.
fn add_one_acquisition(service: &PreviewService, path: &Path) -> String {
    let batch = service.add_files_now(std::slice::from_ref(&path.to_path_buf()));
    match batch.outcomes.first() {
        Some(WorkspaceAddOutcomeDto::Added { dataset }) => dataset.handle.clone(),
        other => panic!("the picker admits an evidenced acquisition; got {other:?}"),
    }
}

/// The picker admits both families, in the order the dialog reported them, and
/// says which family each row is.
#[test]
fn one_picker_batch_admits_mzml_and_thermo_rows_in_picker_order() {
    let fixture = TestFile::new("mixed-batch");
    let acquisition = fixture.thermo_raw("acquisition.raw");
    let source = fixture.readable_mzml("second.mzML");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));

    let batch = service.add_files_now(&[acquisition, fixture.path.clone(), source]);

    let kinds: Vec<DatasetSourceKindDto> = batch
        .roster
        .datasets
        .iter()
        .map(|dataset| dataset.source_kind)
        .collect();
    assert_eq!(
        kinds,
        vec![
            DatasetSourceKindDto::ThermoRaw,
            DatasetSourceKindDto::Mzml,
            DatasetSourceKindDto::Mzml,
        ],
        "the roster is the order the picker reported, and every row says its family"
    );
    assert_eq!(batch.outcomes.len(), 3);
}

/// One picker batch across all three families, in the dialog's order, with no
/// process spent and no preview started for any of them.
#[test]
fn one_picker_batch_admits_all_three_families_in_picker_order() {
    let fixture = TestFile::new("three-family-batch");
    let first = fixture.shimadzu_lcd("first.lcd");
    let second = fixture.thermo_raw("second.raw");
    let third = fixture.readable_mzml("third.mzML");
    let fourth = fixture.shimadzu_lcd("fourth.lcd");
    let provider = ConvertingProvider::faithful();
    let launches = provider.runner.launches();
    let service = PreviewService::new(Box::new(provider));

    let batch = service.add_files_now(&[first, second, third, fourth]);

    let kinds: Vec<DatasetSourceKindDto> = batch
        .roster
        .datasets
        .iter()
        .map(|dataset| dataset.source_kind)
        .collect();
    assert_eq!(
        kinds,
        vec![
            DatasetSourceKindDto::ShimadzuLcd,
            DatasetSourceKindDto::ThermoRaw,
            DatasetSourceKindDto::Mzml,
            DatasetSourceKindDto::ShimadzuLcd,
        ],
        "the roster is the order the picker reported, and every row says its family"
    );
    assert_eq!(batch.outcomes.len(), 4);
    assert_eq!(
        launches.load(Ordering::SeqCst),
        0,
        "admitting a batch launches no backend process"
    );

    // A renamed compound file of the other vendor, refused in a batch exactly
    // as it is alone, and costing no identifier: the row after it still
    // arrives.
    let decoy = fixture.named_bytes("decoy.lcd", &wiff_like_bytes());
    let real = fixture.shimadzu_lcd("real.lcd");
    let followup = service.add_files_now(&[decoy, real]);
    assert!(
        matches!(
            followup.outcomes.first(),
            Some(WorkspaceAddOutcomeDto::Rejected { error, .. })
                if error.kind == "unrecognized_acquisition"
        ),
        "a name is not a recognition; got {:?}",
        followup.outcomes.first()
    );
    assert!(
        matches!(
            followup.outcomes.get(1),
            Some(WorkspaceAddOutcomeDto::Added { dataset }) if dataset.file_name == "real.lcd"
        ),
        "the refusal consumed nothing"
    );
}

/// A `.raw` name whose bytes are not an acquisition is refused, and consumes no
/// dataset identifier: the next real file is still the first row.
#[test]
fn a_misnamed_raw_candidate_is_refused_and_costs_no_dataset_identifier() {
    let fixture = TestFile::new("misnamed-in-batch");
    let impostor = fixture.directory.join("impostor.raw");
    fs::write(&impostor, b"not an acquisition").expect("write the impostor");
    let acquisition = fixture.thermo_raw("real.raw");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));

    let batch = service.add_files_now(&[impostor, acquisition]);

    assert!(
        matches!(
            batch.outcomes.first(),
            Some(WorkspaceAddOutcomeDto::Rejected { error, .. })
                if error.kind == "unrecognized_acquisition"
        ),
        "a name is not a recognition; got {:?}",
        batch.outcomes.first()
    );
    assert_eq!(batch.roster.datasets.len(), 1);
    assert_eq!(
        batch.roster.datasets[0].handle, "file-0",
        "a refused candidate never allocates an identifier"
    );
}

/// A vendor row is refused a preview by Rust, with the sentence the interface
/// shows beside the disabled action.
#[test]
fn a_vendor_row_is_refused_a_preview_by_rust_not_only_by_a_disabled_button() {
    let fixture = TestFile::new("preview-refused");
    let acquisition = fixture.thermo_raw("acquisition.raw");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let handle = add_one_acquisition(&service, &acquisition);

    let error = service
        .open_preview(&handle)
        .expect_err("nothing in this product reads a vendor acquisition");

    assert_eq!(error.kind, "dataset_not_previewable");
    assert_eq!(service.requests_made(&handle), 0, "no backend was asked");
}

/// The plan summary is derived from the run, and refuses a row that has nothing
/// to convert.
#[test]
fn the_plan_summary_describes_the_fixed_plan_and_refuses_an_mzml_row() {
    let fixture = TestFile::new("plan-summary");
    let acquisition = fixture.thermo_raw("acquisition.raw");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let handle = add_one_acquisition(&service, &acquisition);
    let mzml = service.add_dataset(&fixture.path).expect("add an mzML row");

    let summary = service
        .conversion_plan_summary(&handle)
        .expect("a vendor row has a plan");
    assert_eq!(summary.items.len(), 1);
    assert_eq!(summary.items[0].dataset_handle, handle);
    assert_eq!(plan_output_name(&summary.items[0]), "acquisition.mzML");
    assert_eq!(summary.capacity, 16);
    assert_eq!(summary.output_format, ConversionOutputFormatDto::MzMl);
    assert_eq!(summary.compression, "zlib");
    assert_eq!(summary.validation_mode, ValidationModeDto::OutputOnly);

    let refused = service
        .conversion_plan_summary(&mzml.handle)
        .expect_err("an mzML row is already the output format");
    assert_eq!(refused.kind, "dataset_not_convertible");
}

/// The whole visible vertical: begin, claim, choose a folder, convert, report.
#[test]
fn one_focused_thermo_row_converts_through_the_product_path_and_reports_path_free() {
    let fixture = TestFile::new("visible-vertical");
    let acquisition = fixture.thermo_raw("FT-HCD-MSX.raw");
    let destination = destination_root(&fixture, "out");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let handle = add_one_acquisition(&service, &acquisition);
    let document = current_document(&service);

    let reservation = service
        .begin_conversion(&handle, ConversionConflictPolicyDto::Fail, document)
        .expect("a vendor row can be converted");
    assert!(
        matches!(
            service.conversion_state().state,
            WorkspaceConversionStateDto::AwaitingDestination { .. }
        ),
        "the slot says a destination is being chosen"
    );

    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("the exact reservation is claimed once");
    let update = service.run_claimed_conversion(operation, &destination);

    let rendered = serde_json::to_string(&update).expect("the update serializes");
    let Some(report) = sole_report(&update.state) else {
        panic!("the conversion reaches an outcome; got {:?}", update.state);
    };
    assert_eq!(report.outcome, "finalized");
    assert_eq!(report.dataset_handle, handle);
    assert_eq!(report.source_kind, DatasetSourceKindDto::ThermoRaw);
    assert_eq!(report.output_file_name.as_deref(), Some("FT-HCD-MSX.mzML"));
    let validation = report
        .validation
        .as_ref()
        .expect("a finalized run was judged");
    assert_eq!(validation.mode, ValidationModeDto::OutputOnly);
    assert!(!validation.fully_verified);
    assert_eq!(entry_names(&destination), vec!["FT-HCD-MSX.mzML"]);

    for fragment in [
        fixture.directory.to_string_lossy().into_owned(),
        destination.to_string_lossy().into_owned(),
    ] {
        assert!(
            !rendered.contains(&fragment),
            "the update names {fragment:?}: {rendered}"
        );
    }
    // Display names, and only display names. The source's own filename is what
    // the roster already shows, and a queue that could not name its items would
    // be a list of anonymous rows; what must never appear is a folder.
    assert!(rendered.contains("FT-HCD-MSX.raw"), "{rendered}");
    assert!(rendered.contains("FT-HCD-MSX.mzML"), "{rendered}");
    for separator in ["\\\\", "/"] {
        assert!(
            !rendered.contains(separator),
            "the update carries a path separator: {rendered}"
        );
    }
}

/// A reservation is single use, document-bound and refused once replaced.
#[test]
fn a_conversion_reservation_is_single_use_and_bound_to_the_document_that_asked() {
    let fixture = TestFile::new("reservation-rules");
    let acquisition = fixture.thermo_raw("acquisition.raw");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let handle = add_one_acquisition(&service, &acquisition);
    let document = current_document(&service);

    let reservation = service
        .begin_conversion(&handle, ConversionConflictPolicyDto::Fail, document)
        .expect("one reservation");

    // Another document cannot claim it.
    assert_eq!(
        service
            .claim_conversion(&reservation.reservation_id, document + 1)
            .expect_err("a replaced document cannot claim what its predecessor reserved")
            .kind,
        "invalid_conversion_reservation"
    );
    // Nor can a value nobody issued.
    assert_eq!(
        service
            .claim_conversion("conversion-reservation-999", document)
            .expect_err("an unknown identifier claims nothing")
            .kind,
        "invalid_conversion_reservation"
    );

    service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("the exact reservation, once");
    assert_eq!(
        service
            .claim_conversion(&reservation.reservation_id, document)
            .expect_err("and only once")
            .kind,
        "invalid_conversion_reservation"
    );
}

/// A cancelled picker is an ordinary no-op: nothing is created and the slot is
/// idle again, with the operation identifier not reused.
#[test]
fn a_cancelled_destination_picker_creates_nothing_and_returns_to_idle() {
    let fixture = TestFile::new("cancelled-picker");
    let acquisition = fixture.thermo_raw("acquisition.raw");
    let destination = destination_root(&fixture, "out");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let handle = add_one_acquisition(&service, &acquisition);
    let document = current_document(&service);

    let reservation = service
        .begin_conversion(&handle, ConversionConflictPolicyDto::Fail, document)
        .expect("one reservation");
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("claim it");
    let cancelled = service.cancel_conversion(operation);

    assert!(matches!(cancelled.state, WorkspaceConversionStateDto::Idle));
    assert_eq!(entry_names(&destination), Vec::<String>::new());

    // The next conversion is a new operation, not the cancelled one resumed.
    let second = service
        .begin_conversion(&handle, ConversionConflictPolicyDto::Fail, document)
        .expect("a cancelled picker leaves the slot free");
    assert_ne!(
        second.reservation_id, reservation.reservation_id,
        "identifiers do not rewind"
    );
}

/// A second conversion is refused while one is under way.
#[test]
fn a_second_conversion_is_refused_rather_than_queued() {
    let fixture = TestFile::new("one-slot");
    let acquisition = fixture.thermo_raw("acquisition.raw");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let handle = add_one_acquisition(&service, &acquisition);
    let document = current_document(&service);

    service
        .begin_conversion(&handle, ConversionConflictPolicyDto::Fail, document)
        .expect("the first conversion");
    let refused = service
        .begin_conversion(&handle, ConversionConflictPolicyDto::Fail, document)
        .expect_err("one at a time, and not a queue");

    assert_eq!(refused.kind, "conversion_busy");
    assert!(refused.retryable, "the answer changes when the first ends");
}

/// Only a local folder is a destination, and a refused one costs no staging.
#[test]
fn a_destination_that_is_not_a_local_folder_is_refused_before_anything_is_created() {
    let fixture = TestFile::new("destination-posture");
    let acquisition = fixture.thermo_raw("acquisition.raw");
    let runner = FakeConversionRunner::new(BackendAct::Convert);
    let launches = runner.launches();
    let service = PreviewService::new(Box::new(ConvertingProvider::new(
        evidenced_capabilities(),
        runner,
    )));
    let handle = add_one_acquisition(&service, &acquisition);
    let document = current_document(&service);

    for (destination, expected) in [
        (fixture.absent("no-such-folder"), "destination_unusable"),
        (acquisition.clone(), "destination_not_a_folder"),
        (
            PathBuf::from(r"\\server\share\outputs"),
            "destination_unusable",
        ),
    ] {
        let reservation = service
            .begin_conversion(&handle, ConversionConflictPolicyDto::Fail, document)
            .expect("one reservation per attempt");
        let operation = service
            .claim_conversion(&reservation.reservation_id, document)
            .expect("claim it");
        let update = service.run_claimed_conversion(operation, &destination);
        let Some(error) = queue_error(&update.state) else {
            panic!("a refused destination is a refusal; got {:?}", update.state);
        };
        assert_eq!(error.kind, expected, "{destination:?}");
    }
    assert_eq!(
        launches.load(Ordering::SeqCst),
        0,
        "a destination this boundary will not write to costs no process"
    );
}

/// While a conversion holds the workspace, every mutation is refused by Rust
/// and every read still answers.
#[test]
fn a_running_conversion_refuses_workspace_mutations_and_still_answers_reads() {
    let fixture = TestFile::new("mutation-guards");
    let acquisition = fixture.thermo_raw("acquisition.raw");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let handle = add_one_acquisition(&service, &acquisition);
    let other = service
        .add_dataset(&fixture.path)
        .expect("a second, unrelated row");
    let document = current_document(&service);
    service
        .begin_conversion(&handle, ConversionConflictPolicyDto::Fail, document)
        .expect("the conversion holds the workspace from here");

    assert_eq!(
        service
            .add_files(std::slice::from_ref(&fixture.path))
            .expect_err("adding files is refused")
            .kind,
        "conversion_busy"
    );
    assert_eq!(
        service
            .begin_folder_import()
            .expect_err("adding a folder is refused")
            .kind,
        "conversion_busy"
    );
    assert_eq!(
        service
            .clear_workspace()
            .expect_err("clearing is refused")
            .kind,
        "conversion_busy"
    );
    assert_eq!(
        service
            .remove_datasets(std::slice::from_ref(&handle))
            .expect_err("removing the converting row is refused")
            .kind,
        "conversion_busy"
    );
    assert_eq!(
        service
            .open_preview(&other.handle)
            .expect_err("a new preview is refused rather than queued")
            .kind,
        "conversion_busy"
    );

    // An unrelated row is still the user's to prune, and reads still answer.
    let removed = service
        .remove_datasets(std::slice::from_ref(&other.handle))
        .expect("removing an unrelated row is allowed");
    assert_eq!(removed.removed_handles, vec![other.handle]);
    assert_eq!(service.roster().datasets.len(), 1);
}

/// A native drop that arrives while a conversion runs is refused at the
/// callback, with its own reason, and retains no path.
#[test]
fn a_native_drop_during_a_conversion_is_refused_with_its_own_reason() {
    let fixture = TestFile::new("drop-during-conversion");
    let acquisition = fixture.thermo_raw("acquisition.raw");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let handle = add_one_acquisition(&service, &acquisition);
    let document = current_document(&service);
    service
        .begin_conversion(&handle, ConversionConflictPolicyDto::Fail, document)
        .expect("the conversion holds the workspace");

    let paths = vec![fixture.path.clone()];
    let dispatch = service
        .reserve_native_drop_signal(NativeDropSignal::Drop { paths: &paths })
        .expect("a native Drop always creates a dispatch");

    assert!(
        matches!(dispatch, NativeDropDispatch::ConversionBusy),
        "the drop is refused before its paths are retained; got {dispatch:?}"
    );
}

/// Every route by which a bound row could move on is refused while a conversion
/// holds the slot.
///
/// This replaces a test that drove the bound-request recheck through a spectrum
/// load. That route is now closed -- a spectrum is refused like every other
/// backend request -- and so is every other one: adding, the folder picker,
/// clearing, removing the converting row, opening a preview and dropping files
/// all answer `conversion_busy`. The recheck inside the run is therefore
/// unreachable defence in depth rather than a live guard, and ADR 0012 records
/// it as such. What is worth asserting is the thing that made it unreachable.
#[test]
fn nothing_can_move_the_bound_row_on_while_a_conversion_holds_the_slot() {
    let fixture = TestFile::new("bound-row-protected");
    let acquisition = fixture.thermo_raw("acquisition.raw");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let handle = add_one_acquisition(&service, &acquisition);
    let document = current_document(&service);
    service
        .begin_conversion(&handle, ConversionConflictPolicyDto::Fail, document)
        .expect("the conversion holds the slot from here");

    // An open of this row answers about the row rather than about the
    // conversion: it is a vendor acquisition, and nothing in this product
    // previews one whether or not a conversion happens to be running. An open
    // has to establish what it names before it can supersede the preview on
    // screen, so the target is what it reports on. A conversion refusing a
    // *previewable* open -- and that open still revoking the chromatogram it
    // replaced -- is pinned by
    // `a_conversion_that_started_refuses_the_open_and_leaves_no_chromatogram`.
    assert_eq!(
        service
            .open_preview(&handle)
            .expect_err("a vendor row is not previewable")
            .kind,
        "dataset_not_previewable",
    );
    for refusal in [
        service
            .load_spectrum(&handle, 0)
            .expect_err("a spectrum is backend work like any other"),
        service
            .remove_datasets(std::slice::from_ref(&handle))
            .expect_err("the converting row cannot be removed"),
        service
            .clear_workspace()
            .expect_err("nor can the list be emptied"),
        service
            .add_files(std::slice::from_ref(&fixture.path))
            .expect_err("nor can rows be added beside it"),
        service
            .begin_folder_import()
            .expect_err("nor a folder import started"),
    ] {
        assert_eq!(refusal.kind, "conversion_busy");
    }
}

/// The terminal report survives the document that started the conversion, and
/// a later conversion replaces it rather than accumulating beside it.
#[test]
fn the_terminal_report_outlives_its_document_and_is_replaced_not_accumulated() {
    let fixture = TestFile::new("reload-recovery");
    let acquisition = fixture.thermo_raw("acquisition.raw");
    let destination = destination_root(&fixture, "out");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let handle = add_one_acquisition(&service, &acquisition);
    let document = current_document(&service);

    let reservation = service
        .begin_conversion(&handle, ConversionConflictPolicyDto::Fail, document)
        .expect("one reservation");
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("claim it");
    let first = service.run_claimed_conversion(operation, &destination);

    // The document is replaced. The slot is Rust's, so the answer is still here.
    service.begin_webview_document();
    let recovered = service.conversion_state();
    assert_eq!(recovered.state, first.state, "a reload recovers the report");
    assert_eq!(recovered.sequence, first.sequence);

    // A second conversion replaces it. There is no history to grow.
    let document = current_document(&service);
    let reservation = service
        .begin_conversion(&handle, ConversionConflictPolicyDto::Skip, document)
        .expect("the slot is free again");
    let after_begin = service.conversion_state();
    assert!(
        matches!(
            after_begin.state,
            WorkspaceConversionStateDto::AwaitingDestination { .. }
        ),
        "starting a conversion clears the previous report"
    );
    assert!(
        after_begin.sequence > recovered.sequence,
        "the key only advances"
    );
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("claim it");
    let second = service.run_claimed_conversion(operation, &destination);
    let Some(report) = sole_report(&second.state) else {
        panic!(
            "the second conversion reaches an outcome; got {:?}",
            second.state
        );
    };
    assert_eq!(
        report.outcome, "skipped_existing_destination",
        "the name is taken by the first output and Skip leaves it alone"
    );
    assert_eq!(report.output_file_name, None);
}

/// A reservation whose document is gone does not hold the workspace hostage.
///
/// A webview can reload between Rust issuing a reservation and the document
/// receiving it. The replacement never learns the identifier, so without this
/// the slot would stay busy -- and adding, clearing and previewing refused --
/// until the application restarted.
#[test]
fn a_reload_releases_a_reservation_no_document_can_claim() {
    let fixture = TestFile::new("orphaned-reservation");
    let acquisition = fixture.thermo_raw("acquisition.raw");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let handle = add_one_acquisition(&service, &acquisition);
    let document = current_document(&service);
    let reservation = service
        .begin_conversion(&handle, ConversionConflictPolicyDto::Fail, document)
        .expect("one reservation");

    // The document that asked is replaced before it could claim.
    service.begin_webview_document();

    assert!(matches!(
        service.conversion_state().state,
        WorkspaceConversionStateDto::Idle
    ));
    // The stale identifier claims nothing, and the workspace is usable again.
    assert_eq!(
        service
            .claim_conversion(&reservation.reservation_id, current_document(&service))
            .expect_err("a released reservation is not claimable")
            .kind,
        "invalid_conversion_reservation"
    );
    service
        .clear_workspace()
        .expect("the workspace is no longer held by a conversion nobody can finish");
}

/// A reload during destination admission does not let the released operation
/// convert anyway.
///
/// The slot lock is not held across admission and revalidation -- that is
/// filesystem work -- so a reload lands in the middle of it. Without an
/// operation-exact transition, this thread would mark a replacement operation
/// as running and then overwrite the slot with the old one's report.
#[test]
fn an_operation_released_mid_flight_converts_nothing_and_reports_nothing() {
    let fixture = TestFile::new("released-mid-flight");
    let acquisition = fixture.thermo_raw("acquisition.raw");
    let destination = destination_root(&fixture, "out");
    let runner = FakeConversionRunner::new(BackendAct::Convert);
    let launches = runner.launches();
    let service = PreviewService::new(Box::new(ConvertingProvider::new(
        evidenced_capabilities(),
        runner,
    )));
    let handle = add_one_acquisition(&service, &acquisition);
    let document = current_document(&service);
    let reservation = service
        .begin_conversion(&handle, ConversionConflictPolicyDto::Fail, document)
        .expect("one reservation");
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("claim it");

    // The document is replaced while the picker is open. The command that was
    // dispatched for it still returns, and must convert nothing.
    service.begin_webview_document();
    let update = service.run_claimed_conversion(operation, &destination);

    assert!(matches!(update.state, WorkspaceConversionStateDto::Idle));
    assert_eq!(launches.load(Ordering::SeqCst), 0);
    assert_eq!(entry_names(&destination), Vec::<String>::new());
}

/// A released operation cannot install its refusal into the slot that replaced
/// it either.
///
/// The operation number alone does not distinguish them: releasing the slot
/// returns it to idle without allocating a new number, so a refusal that
/// checked only the number would put an abandoned document's failure on the
/// replacement document's screen.
#[test]
fn a_released_operation_reports_no_refusal_into_the_slot_that_replaced_it() {
    let fixture = TestFile::new("released-refusal");
    let acquisition = fixture.thermo_raw("acquisition.raw");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let handle = add_one_acquisition(&service, &acquisition);
    let document = current_document(&service);
    let reservation = service
        .begin_conversion(&handle, ConversionConflictPolicyDto::Fail, document)
        .expect("one reservation");
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("claim it");

    service.begin_webview_document();
    // A destination this boundary refuses, from the operation that was released.
    let update = service.run_claimed_conversion(operation, &fixture.absent("no-such-folder"));

    assert!(
        matches!(update.state, WorkspaceConversionStateDto::Idle),
        "a released operation reports nothing at all; got {:?}",
        update.state
    );
}

/// A link is refused as a destination even when it points somewhere ordinary.
///
/// Canonicalization follows links, so the object has to be inspected before its
/// name is resolved: a junction to a perfectly usable local folder is still a
/// destination whose contents are decided somewhere this boundary never looked.
#[cfg(windows)]
#[test]
fn a_link_to_a_usable_folder_is_still_refused_as_a_destination() {
    let fixture = TestFile::new("linked-destination");
    let real = destination_root(&fixture, "real");
    let link = fixture.directory.join("link");
    if std::os::windows::fs::symlink_dir(&real, &link).is_err() {
        // Creating a directory symbolic link needs a privilege this machine may
        // not grant. Skipping is honest; asserting on a link that was never
        // created would be a test that passes for the wrong reason.
        return;
    }
    let acquisition = fixture.thermo_raw("acquisition.raw");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let handle = add_one_acquisition(&service, &acquisition);
    let document = current_document(&service);
    let reservation = service
        .begin_conversion(&handle, ConversionConflictPolicyDto::Fail, document)
        .expect("one reservation");
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("claim it");

    let update = service.run_claimed_conversion(operation, &link);

    let Some(error) = queue_error(&update.state) else {
        panic!("a link is refused; got {:?}", update.state);
    };
    assert_eq!(error.kind, "destination_is_a_link");
    assert_eq!(entry_names(&real), Vec::<String>::new());
}

/// A reservation is refused for a document that reloaded after its authority
/// was proved.
///
/// The proof is awaited, so a reload can land after it succeeds and before the
/// slot is taken -- at which point page-load has already looked at an idle slot
/// and found nothing to release. Without a recheck the slot would be taken for
/// a document that can never receive the identifier.
#[test]
fn a_reservation_is_refused_when_its_document_reloaded_during_the_authority_proof() {
    let fixture = TestFile::new("stale-epoch-begin");
    let acquisition = fixture.thermo_raw("acquisition.raw");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let handle = add_one_acquisition(&service, &acquisition);
    let stale = current_document(&service);

    service.begin_webview_document();

    let error = service
        .begin_conversion(&handle, ConversionConflictPolicyDto::Fail, stale)
        .expect_err("a reservation for a replaced document is never issued");
    assert_eq!(error.kind, "invalid_conversion_reservation");
    // And the slot is still free for the document that is actually here.
    assert!(matches!(
        service.conversion_state().state,
        WorkspaceConversionStateDto::Idle
    ));
    service
        .clear_workspace()
        .expect("nothing is holding the workspace");
}

/// A picker abandoned by a reloaded document cannot convert the operation that
/// replaced it, nor cancel it.
#[test]
fn an_abandoned_picker_neither_converts_nor_cancels_the_operation_that_replaced_it() {
    let fixture = TestFile::new("abandoned-picker");
    let acquisition = fixture.thermo_raw("acquisition.raw");
    let destination = destination_root(&fixture, "out");
    let runner = FakeConversionRunner::new(BackendAct::Convert);
    let launches = runner.launches();
    let service = PreviewService::new(Box::new(ConvertingProvider::new(
        evidenced_capabilities(),
        runner,
    )));
    let handle = add_one_acquisition(&service, &acquisition);
    let document = current_document(&service);
    let first = service
        .begin_conversion(&handle, ConversionConflictPolicyDto::Fail, document)
        .expect("the first reservation");
    let abandoned = service
        .claim_conversion(&first.reservation_id, document)
        .expect("claim it");

    // The document reloads and its replacement starts its own conversion.
    service.begin_webview_document();
    let document = current_document(&service);
    let second = service
        .begin_conversion(&handle, ConversionConflictPolicyDto::Fail, document)
        .expect("the replacement's reservation");
    let live = service
        .claim_conversion(&second.reservation_id, document)
        .expect("claim it");
    assert_ne!(abandoned, live, "operations do not repeat");

    // The old dialog now returns. It must touch neither the live operation nor
    // the destination it was never about.
    let update = service.run_claimed_conversion(abandoned, &destination);
    assert!(
        matches!(
            update.state,
            WorkspaceConversionStateDto::AwaitingDestination { .. }
        ),
        "the live operation is untouched; got {:?}",
        update.state
    );
    assert_eq!(launches.load(Ordering::SeqCst), 0);
    assert_eq!(entry_names(&destination), Vec::<String>::new());

    // And a cancel from the abandoned dialog does not clear the live one.
    let cancelled = service.cancel_conversion(abandoned);
    assert!(matches!(
        cancelled.state,
        WorkspaceConversionStateDto::AwaitingDestination { .. }
    ));
}

/// A running conversion is not released by a reload. Its process is under way,
/// and its result is what the replacement document will read.
#[test]
fn a_reload_does_not_release_a_conversion_that_is_already_running() {
    let fixture = TestFile::new("reload-during-run");
    let acquisition = fixture.thermo_raw("acquisition.raw");
    let destination = destination_root(&fixture, "out");
    let (runner, observe_start, release) =
        FakeConversionRunner::new(BackendAct::Convert).blocking();
    let service = Arc::new(PreviewService::new(Box::new(ConvertingProvider::new(
        evidenced_capabilities(),
        runner,
    ))));
    let handle = add_one_acquisition(&service, &acquisition);
    let document = current_document(&service);
    let reservation = service
        .begin_conversion(&handle, ConversionConflictPolicyDto::Fail, document)
        .expect("one reservation");
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("claim it");

    let converting = std::thread::spawn({
        let service = Arc::clone(&service);
        let destination = destination.clone();
        move || service.run_claimed_conversion(operation, &destination)
    });
    observe_start
        .recv_timeout(Duration::from_secs(10))
        .expect("the conversion is inside its process");

    service.begin_webview_document();
    assert!(
        matches!(
            service.conversion_state().state,
            WorkspaceConversionStateDto::Running { .. }
        ),
        "a reload cannot stop a process that is already running"
    );

    release.send(()).expect("release the conversion");
    let update = converting.join().expect("the conversion thread");
    assert!(matches!(
        update.state,
        WorkspaceConversionStateDto::Terminal { .. }
    ));
}

/// The wrong tool's help cannot convert, whatever else is right.
///
/// The deterministic half of ADR 0011's open binding gate: a provider that
/// bound `msaccess` help instead of `msconvert` gets capability evidence for a
/// tool whose option grammar cannot express a conversion, and the run refuses.
#[test]
fn capability_evidence_from_the_wrong_tool_cannot_convert() {
    let fixture = TestFile::new("wrong-tool-help");
    let acquisition = fixture.thermo_raw("acquisition.raw");
    let destination = destination_root(&fixture, "out");
    let provider = ConvertingProvider::new(
        conversion_capabilities_for(
            BackendTool::MsAccess,
            EVIDENCED_RELEASE,
            Some(EVIDENCED_REVISION),
            EVIDENCED_EXECUTABLE_SHA256,
        ),
        FakeConversionRunner::new(BackendAct::Convert),
    );
    let service = PreviewService::new(Box::new(provider));
    let handle = add_one_acquisition(&service, &acquisition);
    let document = current_document(&service);
    let reservation = service
        .begin_conversion(&handle, ConversionConflictPolicyDto::Fail, document)
        .expect("one reservation");
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("claim it");

    let update = service.run_claimed_conversion(operation, &destination);

    let Some(report) = sole_report(&update.state) else {
        panic!("the run reaches an outcome; got {:?}", update.state);
    };
    assert_ne!(report.outcome, "finalized");
    assert_eq!(entry_names(&destination), Vec::<String>::new());
}

/// The visible workflow, end to end, against a local installation and a real
/// vendor acquisition.
///
/// Ignored by default. Everything else here runs against a substituted backend
/// so the suite is deterministic and needs no installation; this one exists
/// because a deterministic suite cannot tell you that a vendor library on this
/// machine reads this acquisition through the path a user actually takes.
///
/// It enters through `add_files`, which is what `Add files…` calls, and it
/// converts through the reservation the destination picker claims — so what it
/// exercises is the product path and not the private coordinator beneath it.
///
/// ```text
/// set MSCANVAS_THERMO_FIXTURE=<path to the acquisition>
/// set MSCANVAS_CONVERSION_DESTINATION=<path to an empty folder>
/// cargo test -p mscanvas-desktop --lib -- --ignored --nocapture visible_thermo
/// ```
#[test]
#[ignore = "needs a local ProteoWizard installation and a real vendor acquisition"]
fn the_visible_workflow_converts_a_real_thermo_acquisition_end_to_end() {
    let Ok(fixture) = std::env::var("MSCANVAS_THERMO_FIXTURE") else {
        panic!("set MSCANVAS_THERMO_FIXTURE to the acquisition to convert");
    };
    let Ok(destination) = std::env::var("MSCANVAS_CONVERSION_DESTINATION") else {
        panic!("set MSCANVAS_CONVERSION_DESTINATION to an empty folder");
    };
    let acquisition = PathBuf::from(fixture);
    let destination = PathBuf::from(destination);

    // The production provider. Nothing is substituted: this resolves a real
    // installation, reads its real msconvert help, and launches it.
    let service = PreviewService::new(Box::new(super::backend::ProteoWizardProvider::new()));

    // Through Add files…, which is the only surface that admits this family.
    let batch = service
        .add_files(std::slice::from_ref(&acquisition))
        .expect("no conversion is running");
    let Some(WorkspaceAddOutcomeDto::Added { dataset }) = batch.outcomes.first() else {
        panic!(
            "the picker admits the acquisition; got {:?}",
            batch.outcomes
        );
    };
    println!("dataset handle: {}", dataset.handle);
    println!("admitted bytes: {}", dataset.byte_length);
    println!("source kind: {:?}", dataset.source_kind);
    assert_eq!(dataset.source_kind, DatasetSourceKindDto::ThermoRaw);

    let summary = service
        .conversion_plan_summary(&dataset.handle)
        .expect("a vendor row has a plan");
    println!("plan: {summary:?}");

    let document = service.workspace_drop_document_epoch();
    let reservation = service
        .begin_conversion(&dataset.handle, ConversionConflictPolicyDto::Fail, document)
        .expect("one reservation");
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("claim it");
    let update = service.run_claimed_conversion(operation, &destination);

    println!("state: {update:?}");
    let Some(report) = sole_report(&update.state) else {
        panic!("the conversion reaches an outcome; got {:?}", update.state);
    };
    assert_eq!(report.outcome, "finalized");
    assert_eq!(report.source_kind, DatasetSourceKindDto::ThermoRaw);
    let validation = report
        .validation
        .as_ref()
        .expect("a finalized run was judged");
    assert_eq!(validation.mode, ValidationModeDto::OutputOnly);
    assert!(!validation.fully_verified);

    // And nothing in what the webview would receive names a location.
    let rendered = serde_json::to_string(&update).expect("the update serializes");
    for fragment in [
        acquisition.to_string_lossy().into_owned(),
        destination.to_string_lossy().into_owned(),
    ] {
        assert!(
            !rendered.contains(&fragment),
            "the update names {fragment:?}"
        );
    }
    println!("wire: {rendered}");
}

/// And the production provider binds the tool each operation actually needs.
///
/// The other half, asserted against the source because a substituted provider
/// is exactly what a deterministic test replaces. Swapping either binding is a
/// one-word edit, and this is what makes it visible.
#[test]
fn the_production_provider_binds_msconvert_for_conversion_and_msaccess_for_preview() {
    let source = include_str!("backend.rs");

    assert!(
        source.contains("self.bind_help_of(BoundTool::Msconvert)"),
        "a conversion is planned against msconvert's own help"
    );
    assert!(
        source.contains("self.bind_help_of(BoundTool::Msaccess)"),
        "and preview questions are answered from msaccess'"
    );
    assert_eq!(
        source.matches("bind_help_of(BoundTool::").count(),
        2,
        "exactly two bindings, each naming its own tool"
    );

    // And each name reaches the tool it says it does.
    assert!(source.contains("BoundTool::Msaccess => &discovery.msaccess"));
    assert!(source.contains("BoundTool::Msconvert => &discovery.msconvert"));
}

// --- The serial conversion queue ---------------------------------------------

/// Queues several acquisitions and runs them, in the order they were given.
fn queue_and_run(
    service: &PreviewService,
    handles: &[String],
    destination: &Path,
) -> WorkspaceConversionUpdateDto {
    let document = current_document(service);
    let reservation = service
        .begin_conversion_queue(handles, ConversionConflictPolicyDto::Fail, document)
        .expect("the queue is admitted");
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("claim it");
    service.run_claimed_conversion(operation, destination)
}

fn terminal_queue(update: &WorkspaceConversionUpdateDto) -> &ConversionQueueDto {
    let WorkspaceConversionStateDto::Terminal { queue, .. } = &update.state else {
        panic!("the queue reaches a terminal state; got {:?}", update.state);
    };
    queue
}

/// Items run in the order the caller gave, one at a time, and every one of them
/// produces its own output.
#[test]
fn a_queue_runs_its_items_in_order_one_at_a_time() {
    let fixture = TestFile::new("queue-order");
    let destination = destination_root(&fixture, "out");
    let runner = FakeConversionRunner::new(BackendAct::Convert);
    let launches = runner.launches();
    let service = PreviewService::new(Box::new(ConvertingProvider::new(
        evidenced_capabilities(),
        runner,
    )));
    // Added in one order and named in another, so the order that comes out can
    // only have come from the caller's list: not from the registry's insertion
    // order, and not from the alphabet.
    let added: Vec<String> = ["a.raw", "b.raw", "c.raw"]
        .iter()
        .map(|name| add_one_acquisition(&service, &fixture.thermo_raw(name)))
        .collect();
    let handles = vec![added[2].clone(), added[0].clone(), added[1].clone()];

    let update = queue_and_run(&service, &handles, &destination);

    let queue = terminal_queue(&update);
    assert_eq!(queue.item_count, 3);
    assert_eq!(queue.finalized_count, 3);
    assert_eq!(queue.failed_count, 0);
    assert_eq!(
        queue
            .items
            .iter()
            .map(|item| item_output_name(item).to_owned())
            .collect::<Vec<_>>(),
        vec!["c.mzML", "a.mzML", "b.mzML"],
        "the queue runs the order it was given, not the registry's or the alphabet's"
    );
    assert_eq!(launches.load(Ordering::SeqCst), 3, "one process per item");
    assert_eq!(
        entry_names(&destination),
        vec!["a.mzML", "b.mzML", "c.mzML"],
        "one output per finalized item, and no sidecars"
    );
    for item in &queue.items {
        let report = item_report(item).expect("a finalized item reports");
        let validation = report.validation.as_ref().expect("and was judged");
        assert_eq!(validation.mode, ValidationModeDto::OutputOnly);
        assert!(!validation.fully_verified);
        assert_eq!(report.staging_residue, None);
    }
}

/// One item failing marks that item and nothing else, and the queue carries on.
#[test]
fn one_item_failing_neither_stops_the_queue_nor_rolls_back_what_came_before() {
    let fixture = TestFile::new("queue-isolation");
    let destination = destination_root(&fixture, "out");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let first = add_one_acquisition(&service, &fixture.thermo_raw("first.raw"));
    let broken = fixture.thermo_raw("broken.raw");
    let second = add_one_acquisition(&service, &broken);
    let third = add_one_acquisition(&service, &fixture.thermo_raw("third.raw"));
    // The middle acquisition stops being one after it was queued, so its own
    // revalidation refuses it while the rows either side are untouched.
    fs::write(&broken, b"not an acquisition at all").expect("rewrite the middle acquisition");

    let update = queue_and_run(&service, &[first, second, third], &destination);

    let queue = terminal_queue(&update);
    assert_eq!(queue.finalized_count, 2);
    assert_eq!(queue.failed_count, 1);
    assert_eq!(queue.items[0].state, ConversionQueueItemStateDto::Finalized);
    assert_eq!(queue.items[1].state, ConversionQueueItemStateDto::Failed);
    assert_eq!(
        queue.items[2].state,
        ConversionQueueItemStateDto::Finalized,
        "a later item runs after an earlier one failed"
    );
    assert_eq!(item_output_name(&queue.items[1]), "broken.mzML");
    assert!(
        item_report(&queue.items[1]).is_none(),
        "an item that never reached a conversion reports no run"
    );
    assert_eq!(
        entry_names(&destination),
        vec!["first.mzML", "third.mzML"],
        "the earlier output survives the later failure"
    );
}

/// Two items that would write one name are refused before a picker opens.
#[test]
fn a_queue_whose_items_would_share_an_output_name_is_refused_before_anything_runs() {
    let fixture = TestFile::new("queue-collision");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    // Different folders, same basename -- so the same planned output name.
    let nested = fixture.directory.join("nested");
    fs::create_dir_all(&nested).expect("create the nested folder");
    let one = add_one_acquisition(&service, &fixture.thermo_raw("run.raw"));
    let other = nested.join("run.raw");
    fs::write(&other, thermo_raw_bytes()).expect("write the twin");
    let two = add_one_acquisition(&service, &other);

    let error = service
        .conversion_queue_plan(&[one.clone(), two.clone()])
        .expect_err("two items cannot write one name");
    assert_eq!(error.kind, "queue_output_name_collision");
    assert_eq!(error.detail.as_deref(), Some("run.mzML"));

    // And no reservation exists to claim.
    let document = current_document(&service);
    assert_eq!(
        service
            .begin_conversion_queue(&[one, two], ConversionConflictPolicyDto::Fail, document)
            .expect_err("the queue is refused, not created")
            .kind,
        "queue_output_name_collision"
    );
    assert!(matches!(
        service.conversion_state().state,
        WorkspaceConversionStateDto::Idle
    ));
}

/// A queue larger than one session may run is refused, as is an empty one and
/// one naming a row twice or naming a row that cannot be converted.
#[test]
fn a_queue_is_bounded_deduplicated_and_convertible_or_it_is_refused() {
    let fixture = TestFile::new("queue-admission");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let handle = add_one_acquisition(&service, &fixture.thermo_raw("run.raw"));
    let mzml = service.add_dataset(&fixture.path).expect("an mzML row");

    assert_eq!(
        service.conversion_queue_plan(&[]).expect_err("empty").kind,
        "queue_is_empty"
    );
    let too_many: Vec<String> = (0..17).map(|_| handle.clone()).collect();
    assert_eq!(
        service
            .conversion_queue_plan(&too_many)
            .expect_err("seventeen is more than a session runs")
            .kind,
        "queue_too_large"
    );
    assert_eq!(
        service
            .conversion_queue_plan(&[handle.clone(), handle.clone()])
            .expect_err("one row twice is one row")
            .kind,
        "queue_output_name_collision",
        "the same row twice would also write one name, and that is refused first"
    );
    assert_eq!(
        service
            .conversion_queue_plan(&[handle.clone(), mzml.handle])
            .expect_err("an mzML row is not queued silently")
            .kind,
        "dataset_not_convertible"
    );
    assert_eq!(
        service
            .conversion_queue_plan(&[handle, String::from("file-404")])
            .expect_err("a handle naming nothing")
            .kind,
        "unknown_file_handle"
    );
}

/// Every row a live queue holds is protected, not only the one running.
#[test]
fn every_queued_row_is_protected_while_the_queue_is_live() {
    let fixture = TestFile::new("queue-protection");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let first = add_one_acquisition(&service, &fixture.thermo_raw("first.raw"));
    let second = add_one_acquisition(&service, &fixture.thermo_raw("second.raw"));
    let unrelated = service
        .add_dataset(&fixture.path)
        .expect("an unrelated row");
    let document = current_document(&service);
    service
        .begin_conversion_queue(
            &[first.clone(), second.clone()],
            ConversionConflictPolicyDto::Fail,
            document,
        )
        .expect("the queue holds the workspace from here");

    for handle in [&first, &second] {
        assert_eq!(
            service
                .remove_datasets(std::slice::from_ref(handle))
                .expect_err("a queued row cannot be removed")
                .kind,
            "conversion_busy"
        );
    }
    for refusal in [
        service.clear_workspace().expect_err("clearing is refused"),
        service
            .add_files(std::slice::from_ref(&fixture.path))
            .expect_err("adding is refused"),
        service
            .open_preview(&unrelated.handle)
            .expect_err("a new preview is refused"),
        service
            .load_spectrum(&unrelated.handle, 0)
            .expect_err("and so is a spectrum"),
        service
            .begin_conversion_queue(&[first], ConversionConflictPolicyDto::Fail, document)
            .expect_err("and a second queue"),
    ] {
        assert_eq!(refusal.kind, "conversion_busy");
    }

    // An unrelated row is still the user's to prune, and reads still answer.
    let removed = service
        .remove_datasets(std::slice::from_ref(&unrelated.handle))
        .expect("removing an unrelated row is allowed");
    assert_eq!(removed.removed_handles, vec![unrelated.handle]);
    assert_eq!(service.roster().datasets.len(), 2);
}

/// Retry reruns only what another attempt could change, keeps everything else,
/// and counts the attempt.
#[test]
fn retry_reruns_only_retryable_failures_and_leaves_the_rest_alone() {
    let fixture = TestFile::new("queue-retry");
    let destination = destination_root(&fixture, "out");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let done = add_one_acquisition(&service, &fixture.thermo_raw("done.raw"));
    let held = fixture.thermo_raw("held.raw");
    let blocked = add_one_acquisition(&service, &held);

    // Another program holds the second acquisition open for writing -- the one
    // condition this repository has measured as transient. Revalidating the row
    // is what meets it first, so the identifier is that open's, not the
    // replacement lock's.
    let writer = hold_for_writing(&held);
    let update = queue_and_run(&service, &[done, blocked], &destination);
    let queue = terminal_queue(&update);
    assert_eq!(queue.finalized_count, 1);
    assert_eq!(queue.failed_count, 1);
    assert_eq!(
        queue.items[1].error.as_ref().expect("a refusal").kind,
        "file_unreadable"
    );
    assert_eq!(queue.retryable_failed_count, 1);
    assert_eq!(queue.non_retryable_failed_count, 0);
    assert_eq!(queue.items[0].attempts, 1);
    assert_eq!(queue.items[1].attempts, 1);

    drop(writer);
    let retried = service
        .retry_conversion_queue(current_document(&service))
        .expect("a retryable failure can be retried");

    let queue = terminal_queue(&retried);
    assert_eq!(queue.retry_round, 1);
    assert_eq!(queue.finalized_count, 2);
    assert_eq!(queue.failed_count, 0);
    assert_eq!(
        queue.items[0].attempts, 1,
        "an item that already succeeded is not run again"
    );
    assert_eq!(
        queue.items[1].attempts, 2,
        "and the retried one counts its attempt"
    );
    assert_eq!(entry_names(&destination), vec!["done.mzML", "held.mzML"]);
}

/// Nothing retryable means nothing to retry.
#[test]
fn a_queue_with_no_retryable_failure_refuses_a_retry() {
    let fixture = TestFile::new("queue-no-retry");
    let destination = destination_root(&fixture, "out");
    let service = PreviewService::new(Box::new(ConvertingProvider::new(
        evidenced_capabilities(),
        FakeConversionRunner::new(BackendAct::ConvertEmpty),
    )));
    let handle = add_one_acquisition(&service, &fixture.thermo_raw("run.raw"));

    let update = queue_and_run(&service, &[handle], &destination);
    let queue = terminal_queue(&update);
    assert_eq!(queue.failed_count, 1);
    assert_eq!(
        queue.retryable_failed_count, 0,
        "a document that failed the integrity contract would fail it again"
    );
    assert_eq!(queue.non_retryable_failed_count, 1);

    assert_eq!(
        service
            .retry_conversion_queue(current_document(&service))
            .expect_err("there is nothing a retry could change")
            .kind,
        "invalid_conversion_reservation"
    );
}

/// A retry refuses when the folder is no longer the folder.
#[test]
fn a_retry_refuses_when_its_destination_is_no_longer_the_same_object() {
    let fixture = TestFile::new("queue-destination-changed");
    let destination = destination_root(&fixture, "out");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let held = fixture.thermo_raw("held.raw");
    let handle = add_one_acquisition(&service, &held);
    let writer = hold_for_writing(&held);
    let update = queue_and_run(&service, &[handle], &destination);
    assert_eq!(terminal_queue(&update).retryable_failed_count, 1);
    drop(writer);

    // The folder is replaced by a different directory of the same name.
    fs::remove_dir_all(&destination).expect("remove the admitted folder");
    fs::create_dir_all(&destination).expect("and put a different one in its place");

    let error = service
        .retry_conversion_queue(current_document(&service))
        .expect_err("a folder that is no longer the folder is not written into");
    assert_eq!(error.kind, "queue_destination_changed");
    // Existing results are untouched.
    let state = service.conversion_state();
    assert_eq!(terminal_queue(&state).failed_count, 1);
    assert_eq!(entry_names(&destination), Vec::<String>::new());
}

/// A reload recovers a terminal queue whole, and a new queue replaces it.
#[test]
fn a_reload_recovers_the_queue_and_a_new_queue_replaces_it() {
    let fixture = TestFile::new("queue-reload");
    let destination = destination_root(&fixture, "out");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let first = add_one_acquisition(&service, &fixture.thermo_raw("first.raw"));
    let second = add_one_acquisition(&service, &fixture.thermo_raw("second.raw"));

    let update = queue_and_run(&service, &[first.clone(), second], &destination);
    service.begin_webview_document();
    let recovered = service.conversion_state();
    assert_eq!(
        recovered.state, update.state,
        "a reload recovers the queue whole"
    );
    assert_eq!(recovered.sequence, update.sequence);

    // A new queue replaces it rather than accumulating beside it.
    let document = current_document(&service);
    service
        .begin_conversion_queue(&[first], ConversionConflictPolicyDto::Skip, document)
        .expect("the slot is free again");
    let WorkspaceConversionStateDto::AwaitingDestination { queue, .. } =
        service.conversion_state().state
    else {
        panic!("a new queue is awaiting a destination");
    };
    assert_eq!(
        queue.item_count, 1,
        "there is one queue, not a history of them"
    );
    assert_eq!(queue.conflict_policy, ConversionConflictPolicyDto::Skip);
}

/// Held open at the first item, the queue is observably serial: one process has
/// run, the later items have not started, and nothing else may take the lane.
#[test]
fn a_queue_parked_at_its_first_item_has_started_no_other() {
    let fixture = TestFile::new("queue-serial");
    let destination = destination_root(&fixture, "out");
    let (runner, observe_start, release) =
        FakeConversionRunner::new(BackendAct::Convert).blocking();
    let launches = runner.launches();
    let mut provider = ConvertingProvider::new(evidenced_capabilities(), runner);
    provider.inner = FakeProvider::available(open_responses());
    let service = Arc::new(PreviewService::new(Box::new(provider)));

    let preview_source = service.add_dataset(&fixture.path).expect("an mzML row");
    let handles: Vec<String> = ["first.raw", "second.raw", "third.raw"]
        .iter()
        .map(|name| add_one_acquisition(&service, &fixture.thermo_raw(name)))
        .collect();

    let document = current_document(&service);
    let reservation = service
        .begin_conversion_queue(&handles, ConversionConflictPolicyDto::Fail, document)
        .expect("the queue is admitted");
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("claim it");
    let draining = std::thread::spawn({
        let service = Arc::clone(&service);
        let destination = destination.clone();
        move || service.run_claimed_conversion(operation, &destination)
    });
    observe_start
        .recv_timeout(Duration::from_secs(10))
        .expect("the first item reached its process and holds the gate");

    // One process, not three. The lane is a lane.
    assert_eq!(launches.load(Ordering::SeqCst), 1);
    let WorkspaceConversionStateDto::Running { queue, .. } = service.conversion_state().state
    else {
        panic!("the queue is running while its first item is parked");
    };
    assert_eq!(
        queue
            .items
            .iter()
            .map(|item| item.state)
            .collect::<Vec<_>>(),
        vec![
            ConversionQueueItemStateDto::Running,
            ConversionQueueItemStateDto::Pending,
            ConversionQueueItemStateDto::Pending,
        ]
    );

    // Nothing may interleave between two items of a batch the user is watching:
    // not a preview, not a second queue, and not the removal of a row this
    // queue has not reached yet.
    for refusal in [
        service
            .open_preview(&preview_source.handle)
            .expect_err("a preview is refused"),
        service
            .begin_conversion_queue(&handles, ConversionConflictPolicyDto::Fail, document)
            .expect_err("a second queue is refused"),
        service
            .remove_datasets(std::slice::from_ref(&handles[2]))
            .expect_err("a row this queue has not reached is still its own"),
    ] {
        assert_eq!(refusal.kind, "conversion_busy");
    }
    // And the reads that do not touch the lane still answer.
    assert_eq!(service.roster().datasets.len(), 4);

    // A backend recheck is not refused by a busy queue -- it is not a workspace
    // mutation -- so the only thing keeping its process off the lane is the gate
    // this queue holds for its whole length rather than per item. A bounded
    // observation rather than a proof: off the gate this provider answers
    // immediately, so waiting and getting nothing is the evidence there is.
    let (probed, probe) = mpsc::channel();
    let probing = std::thread::spawn({
        let service = Arc::clone(&service);
        move || {
            let verdict = service.inspect_backend();
            probed.send(()).expect("announce the finished probe");
            verdict
        }
    });
    assert!(
        probe.recv_timeout(Duration::from_millis(250)).is_err(),
        "a backend probe waits for the queue's lane rather than running beside it"
    );

    // A reload finds the queue and reads it. It does not start a second worker
    // beside the one already draining it -- the launch count below is what says
    // so, because a second drain would convert every remaining item twice.
    service.begin_webview_document();
    assert!(matches!(
        service.conversion_state().state,
        WorkspaceConversionStateDto::Running { .. }
    ));

    release.send(()).expect("release the first item");
    let update = draining.join().expect("the draining thread");
    probing.join().expect("the probing thread");
    probe
        .recv_timeout(Duration::from_secs(10))
        .expect("and it answers once the queue has given the lane back");

    let queue = terminal_queue(&update);
    assert_eq!(queue.finalized_count, 3);
    assert_eq!(
        launches.load(Ordering::SeqCst),
        3,
        "one process per item, in turn"
    );
    assert_eq!(
        entry_names(&destination),
        vec!["first.mzML", "second.mzML", "third.mzML"]
    );
    // The lane is free again the moment the queue is terminal.
    service
        .open_preview(&preview_source.handle)
        .expect("a preview runs once the queue has finished");
}

/// The two halves of the retry rule, at the level they are written.
///
/// The residue half is unreachable through the product path -- nothing this
/// repository classifies as retryable happens after a staging directory
/// exists -- so it is exercised here rather than left looking load-bearing.
#[test]
fn residue_blocks_a_retry_that_would_otherwise_be_offered() {
    use mscanvas_proteowizard::{ConversionRunFailure, ConversionRunOutcome, StagingResidue};

    // The one run failure this repository has evidence for as transient.
    let transient = ConversionRunOutcome::Failed(ConversionRunFailure::DestinationRootNotOpened {
        kind: std::io::ErrorKind::PermissionDenied,
    });
    assert!(super::conversion::run_is_retryable(None, &transient));
    assert!(
        !super::conversion::run_is_retryable(
            Some(StagingResidue::NotRemoved {
                kind: std::io::ErrorKind::PermissionDenied,
            }),
            &transient,
        ),
        "the next attempt at this exact plan would find the staging name taken"
    );

    // And the same folder simply not being there is not transient: a retry
    // against a folder that no longer exists has nothing to succeed at.
    assert!(!super::conversion::run_is_retryable(
        None,
        &ConversionRunOutcome::Failed(ConversionRunFailure::DestinationRootNotOpened {
            kind: std::io::ErrorKind::NotFound,
        }),
    ));
    // A run that produced a file, and one that deliberately left one alone,
    // are not failures and are never rerun.
    assert!(!super::conversion::run_is_retryable(
        None,
        &ConversionRunOutcome::SkippedExistingDestination,
    ));
}

/// Only the refusals that mean "could not read it now" are offered again.
#[test]
fn a_refusal_is_retryable_only_when_another_attempt_could_read_the_file() {
    for kind in ["source_in_use", "file_unreadable"] {
        assert!(
            super::conversion::refusal_is_retryable(kind),
            "{kind} is the object being busy, not the object being wrong"
        );
    }
    for kind in [
        "unrecognized_acquisition",
        "not_a_regular_file",
        "file_identity_changed",
        "unknown_file_handle",
        "dataset_not_convertible",
        "conversion_superseded",
        "destination_is_remote",
        "",
    ] {
        assert!(
            !super::conversion::refusal_is_retryable(kind),
            "{kind} says what the row or the request is, and rerunning cannot change it"
        );
    }
}

/// The whole serialized queue, member by member.
///
/// Written as the exact key sets rather than as absences, so a member added
/// upstream has to be answered for here instead of arriving unnoticed -- and so
/// a list of past attempts, or the folder the queue writes into, cannot be
/// added to the wire without this failing.
#[test]
fn the_serialized_queue_carries_exactly_these_members_and_no_location() {
    let fixture = TestFile::new("queue-wire");
    let destination = destination_root(&fixture, "out");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let handle = add_one_acquisition(&service, &fixture.thermo_raw("FT-HCD-MSX.raw"));

    let update = queue_and_run(&service, &[handle], &destination);
    let wire: serde_json::Value =
        serde_json::from_str(&serde_json::to_string(&update).expect("the update serializes"))
            .expect("and parses back");

    let queue = &wire["state"]["queue"];
    assert_eq!(
        sorted_keys(queue),
        vec![
            "adoptableOutputCount",
            "cancellationFailedCount",
            "cancelledCount",
            "conflictPolicy",
            "currentIndex",
            "error",
            "failedCount",
            "finalizedCount",
            "installationGeneration",
            "itemCount",
            "items",
            "nonRetryableFailedCount",
            "notRunCount",
            "retryRound",
            "retryableFailedCount",
            "skippedCount",
        ]
    );
    let item = &queue["items"][0];
    assert_eq!(
        sorted_keys(item),
        vec![
            "attempts",
            "cancellation",
            "datasetHandle",
            "error",
            "fileName",
            "output",
            "result",
            "retryable",
            "sourceKind",
            "state",
        ],
        "one latest attempt per item, never a history of them"
    );
    // A known single output states its one name, under the arm that has one.
    assert_eq!(
        sorted_keys(&item["output"]),
        vec!["fileName", "kind"],
        "a known single output names its document"
    );
    assert_eq!(item["output"]["kind"], "knownSingle");

    // The latest attempt's result is discriminated by cardinality. A Thermo
    // item is `single`, and its report is byte-for-byte the shape it always
    // was -- the one thing this milestone must not disturb.
    assert_eq!(item["result"]["kind"], "single");
    let report = &item["result"]["report"];
    assert_eq!(
        sorted_keys(report),
        vec![
            "backend",
            "datasetHandle",
            "detailedOutcome",
            "installationGeneration",
            "outcome",
            "output",
            "outputFileName",
            "sourceKind",
            "stagingResidue",
            "validation",
        ]
    );
    assert_eq!(
        sorted_keys(&report["backend"]),
        vec!["elapsedMilliseconds", "exitCode"]
    );

    // And nothing anywhere in it can locate anything. Checked over the string
    // values, because the serialization's own punctuation would answer for
    // itself.
    let mut strings = Vec::new();
    collect_strings(&wire, &mut strings);
    for value in &strings {
        assert!(
            !value.contains('\\') && !value.contains('/'),
            "a queue names no path, and {value:?} carries a separator"
        );
    }
    assert!(
        strings.iter().any(|value| value == "FT-HCD-MSX.raw"),
        "the display name is there; only the way to find it is not"
    );
    let rendered = serde_json::to_string(&update).expect("the update serializes");
    for absent in [
        destination.to_string_lossy().as_ref(),
        fixture.directory.to_string_lossy().as_ref(),
        "mscanvas-staging",
    ] {
        assert!(
            !rendered.contains(absent),
            "the wire must not carry {absent:?}"
        );
    }
}

/// An adoption outcome names its item and its member, flat, on the wire.
///
/// Pinned because the identity is a nested value flattened into a tagged enum,
/// which is the one serde arrangement where the shape a reader sees and the
/// shape the type suggests can differ. The interface reads `itemIndex` and
/// `memberIndex` as members of the outcome itself, and a nested `candidate`
/// object would satisfy every Rust test here while giving the webview two
/// fields it does not know about.
#[test]
fn an_adoption_outcome_carries_its_identity_flat_on_the_wire() {
    let outcome = WorkspaceOutputAdoptionOutcomeDto::Refused {
        candidate: super::dto::AdoptionCandidateIdentityDto {
            item_index: 2,
            member_index: 7,
        },
        source_handle: String::from("file-3"),
        output_file_name: String::from("a-S8.mzML"),
        reason: String::from("output_changed"),
    };
    let wire: serde_json::Value =
        serde_json::from_str(&serde_json::to_string(&outcome).expect("an outcome serializes"))
            .expect("and parses back");

    assert_eq!(
        sorted_keys(&wire),
        vec![
            "itemIndex",
            "kind",
            "memberIndex",
            "outputFileName",
            "reason",
            "sourceHandle",
        ],
        "the identity is flattened into the outcome, not nested beside it"
    );
    assert_eq!(wire["kind"], "refused");
    assert_eq!(wire["itemIndex"], 2);
    assert_eq!(wire["memberIndex"], 7);
    assert!(
        wire.get("candidate").is_none(),
        "the identity has no wrapper of its own"
    );
}

/// One JSON object's member names, sorted.
fn sorted_keys(value: &serde_json::Value) -> Vec<&str> {
    let mut keys: Vec<&str> = value
        .as_object()
        .expect("a JSON object")
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    keys
}

/// Every string a JSON value carries, at any depth, member names included.
fn collect_strings(value: &serde_json::Value, into: &mut Vec<String>) {
    match value {
        serde_json::Value::String(text) => into.push(text.clone()),
        serde_json::Value::Array(items) => {
            for item in items {
                collect_strings(item, into);
            }
        }
        serde_json::Value::Object(members) => {
            for (key, member) in members {
                into.push(key.clone());
                collect_strings(member, into);
            }
        }
        _ => {}
    }
}

/// The real queue, on a real installation, against real copies of the ADR 0010
/// acquisition.
///
/// Ignored by default, for the reason the single-conversion evidence test gives:
/// a deterministic suite cannot tell you what a vendor library on this machine
/// does with these bytes through the path a user actually takes.
///
/// It enters through `add_files` and converts through the reservation the
/// destination picker claims, and it samples the running `msconvert.exe`
/// processes while the queue drains -- so "one at a time" is measured here
/// rather than merely designed.
///
/// ```text
/// set MSCANVAS_THERMO_FIXTURE=<path to the acquisition>
/// set MSCANVAS_CONVERSION_DESTINATION=<path to an empty folder>
/// set MSCANVAS_QUEUE_STAGE=<path to an empty folder for the copies>
/// cargo test -p mscanvas-desktop --lib -- --ignored --nocapture real_queue
/// ```
#[test]
#[ignore = "needs a local ProteoWizard installation and a real vendor acquisition"]
fn a_real_queue_converts_several_thermo_acquisitions_one_at_a_time() {
    let Ok(fixture) = std::env::var("MSCANVAS_THERMO_FIXTURE") else {
        panic!("set MSCANVAS_THERMO_FIXTURE to the acquisition to copy");
    };
    let Ok(destination) = std::env::var("MSCANVAS_CONVERSION_DESTINATION") else {
        panic!("set MSCANVAS_CONVERSION_DESTINATION to an empty folder");
    };
    let Ok(stage) = std::env::var("MSCANVAS_QUEUE_STAGE") else {
        panic!("set MSCANVAS_QUEUE_STAGE to an empty folder for the copies");
    };
    let acquisition = PathBuf::from(fixture);
    let destination = PathBuf::from(destination);
    let stage = PathBuf::from(stage);

    // Three distinct objects, not three names for one. Each copy is its own
    // file with its own filesystem identity, which is what makes the queue a
    // queue of three acquisitions rather than one acquisition three times.
    let names = ["alpha.raw", "bravo.raw", "charlie.raw"];
    let copies: Vec<PathBuf> = names
        .iter()
        .map(|name| {
            let target = stage.join(name);
            fs::copy(&acquisition, &target).expect("copy the acquisition");
            target
        })
        .collect();
    for copy in &copies {
        let identity = super::selection::file_identity(copy).expect("each copy has an identity");
        println!("copy {} identity {identity:?}", copy.display());
    }

    let service = PreviewService::new(Box::new(super::backend::ProteoWizardProvider::new()));
    let batch = service
        .add_files(&copies)
        .expect("no conversion is running");
    let handles: Vec<String> = batch
        .outcomes
        .iter()
        .map(|outcome| match outcome {
            WorkspaceAddOutcomeDto::Added { dataset } => {
                assert_eq!(dataset.source_kind, DatasetSourceKindDto::ThermoRaw);
                println!("admitted {} as {}", dataset.file_name, dataset.handle);
                dataset.handle.clone()
            }
            other => panic!("every copy is admitted; got {other:?}"),
        })
        .collect();
    assert_eq!(handles.len(), 3);

    // Queued in an order the workspace does not already hold, so the order the
    // outputs arrive in can only have come from the list this test gave.
    let queued = vec![handles[2].clone(), handles[0].clone(), handles[1].clone()];
    let expected_order = vec!["charlie.mzML", "alpha.mzML", "bravo.mzML"];

    let plan = service
        .conversion_queue_plan(&queued)
        .expect("three convertible rows are a plan");
    println!("plan: {plan:?}");
    assert_eq!(plan.capacity, super::dto::MAX_CONVERSION_QUEUE_ITEMS);
    assert_eq!(
        plan.items
            .iter()
            .map(|item| plan_output_name(item).to_owned())
            .collect::<Vec<_>>(),
        expected_order
    );

    // Sampled while the queue runs. `msconvert.exe` is what a conversion
    // launches, so counting the ones this machine is running is the direct
    // measurement of "one at a time".
    let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let peak = Arc::new(AtomicUsize::new(0));
    let samples = Arc::new(AtomicUsize::new(0));
    let watching = std::thread::spawn({
        let stop = Arc::clone(&stop);
        let peak = Arc::clone(&peak);
        let samples = Arc::clone(&samples);
        move || {
            while !stop.load(Ordering::SeqCst) {
                // Back to back. One `tasklist` costs a few hundred
                // milliseconds by itself, so sleeping between samples would buy
                // nothing and cost coverage.
                let running = running_msconvert_count();
                samples.fetch_add(1, Ordering::SeqCst);
                peak.fetch_max(running, Ordering::SeqCst);
            }
        }
    });

    let document = service.workspace_drop_document_epoch();
    let reservation = service
        .begin_conversion_queue(&queued, ConversionConflictPolicyDto::Fail, document)
        .expect("one reservation for the whole queue");
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("claim it");
    let started = std::time::Instant::now();
    let update = service.run_claimed_conversion(operation, &destination);
    let wall = started.elapsed();
    stop.store(true, Ordering::SeqCst);
    watching.join().expect("the watching thread");

    println!(
        "peak concurrent msconvert.exe: {} over {} samples",
        peak.load(Ordering::SeqCst),
        samples.load(Ordering::SeqCst)
    );
    assert!(
        peak.load(Ordering::SeqCst) <= 1,
        "the queue runs one process at a time"
    );

    let queue = terminal_queue(&update);
    println!("queue: {queue:?}");
    assert_eq!(queue.item_count, 3);
    assert_eq!(queue.finalized_count, 3);
    assert_eq!(queue.failed_count, 0);
    assert_eq!(queue.skipped_count, 0);
    assert_eq!(
        queue
            .items
            .iter()
            .map(|item| item_output_name(item).to_owned())
            .collect::<Vec<_>>(),
        expected_order,
        "the outputs are named in the order the queue was given"
    );
    for item in &queue.items {
        assert_eq!(item.attempts, 1);
        let report = item_report(item).expect("each item reports");
        assert_eq!(report.outcome, "finalized");
        assert_eq!(report.staging_residue, None);
        let output = report.output.as_ref().expect("and produced a file");
        let validation = report.validation.as_ref().expect("and was judged");
        assert_eq!(validation.mode, ValidationModeDto::OutputOnly);
        assert!(!validation.fully_verified);
        println!(
            "{} -> {} bytes {} sha256 {} spectra {} chromatograms {}, verified {:?}, unverified {:?}",
            item.file_name,
            item_output_name(item),
            output.byte_length,
            output.sha256,
            output.spectrum_count,
            output.chromatogram_count,
            validation.verified,
            validation.unverified
        );
    }

    // The independent half of the same measurement, and the stronger half: the
    // queue took at least as long as its processes did, added end to end. Three
    // processes running beside each other could not.
    let backend_total: u64 = queue
        .items
        .iter()
        .map(|item| {
            item_report(item)
                .as_ref()
                .and_then(|report| report.backend.as_ref())
                .map_or(0, |backend| backend.elapsed_milliseconds)
        })
        .sum();
    println!(
        "wall {} ms against {} ms of backend time",
        wall.as_millis(),
        backend_total
    );
    assert!(
        u128::from(backend_total) <= wall.as_millis(),
        "the queue's own wall time covers every process it ran, one after another"
    );

    // One file per finalized item, nothing else, and no staging left behind.
    let mut produced = entry_names(&destination);
    produced.sort();
    let mut wanted: Vec<String> = expected_order
        .iter()
        .map(|name| (*name).to_owned())
        .collect();
    wanted.sort();
    assert_eq!(produced, wanted, "one output per item and no sidecars");

    // And nothing the webview would receive names a location.
    let rendered = serde_json::to_string(&update).expect("the update serializes");
    for fragment in [
        destination.to_string_lossy().into_owned(),
        stage.to_string_lossy().into_owned(),
    ] {
        assert!(
            !rendered.contains(&fragment),
            "the update names {fragment:?}"
        );
    }
    println!("wire: {rendered}");
}

/// How many `msconvert.exe` processes this machine is running right now.
#[cfg(windows)]
fn running_msconvert_count() -> usize {
    let Ok(output) = std::process::Command::new("tasklist")
        .args(["/FI", "IMAGENAME eq msconvert.exe", "/NH", "/FO", "CSV"])
        .output()
    else {
        return 0;
    };
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|line| line.contains("msconvert.exe"))
        .count()
}

#[cfg(not(windows))]
const fn running_msconvert_count() -> usize {
    0
}

/// Real failure isolation, on the same installation and the same fixture.
///
/// The claim this milestone makes is that one file's failure does not stop the
/// files after it. A deterministic suite says so with a substituted backend;
/// this says so with the real one, by putting a file where the middle item's
/// output would go and watching the items either side of it convert anyway.
///
/// ```text
/// set MSCANVAS_THERMO_FIXTURE=<path to the acquisition>
/// set MSCANVAS_CONVERSION_DESTINATION=<path to an empty folder>
/// set MSCANVAS_QUEUE_STAGE=<path to an empty folder for the copies>
/// cargo test -p mscanvas-desktop --lib -- --ignored --nocapture real_queue_isolates
/// ```
#[test]
#[ignore = "needs a local ProteoWizard installation and a real vendor acquisition"]
fn a_real_queue_isolates_one_failure_and_converts_the_rest() {
    let Ok(fixture) = std::env::var("MSCANVAS_THERMO_FIXTURE") else {
        panic!("set MSCANVAS_THERMO_FIXTURE to the acquisition to copy");
    };
    let Ok(destination) = std::env::var("MSCANVAS_CONVERSION_DESTINATION") else {
        panic!("set MSCANVAS_CONVERSION_DESTINATION to an empty folder");
    };
    let Ok(stage) = std::env::var("MSCANVAS_QUEUE_STAGE") else {
        panic!("set MSCANVAS_QUEUE_STAGE to an empty folder for the copies");
    };
    let acquisition = PathBuf::from(fixture);
    let destination = PathBuf::from(destination);
    let stage = PathBuf::from(stage);

    let copies: Vec<PathBuf> = ["one.raw", "two.raw", "three.raw"]
        .iter()
        .map(|name| {
            let target = stage.join(name);
            fs::copy(&acquisition, &target).expect("copy the acquisition");
            target
        })
        .collect();

    // The middle item's name, already taken by something this queue did not
    // write and must not touch.
    let occupied = destination.join("two.mzML");
    let squatter = b"not an mzML document, and not this queue's to replace";
    fs::write(&occupied, squatter).expect("occupy the middle output name");

    let service = PreviewService::new(Box::new(super::backend::ProteoWizardProvider::new()));
    let batch = service
        .add_files(&copies)
        .expect("no conversion is running");
    let handles: Vec<String> = batch
        .outcomes
        .iter()
        .map(|outcome| match outcome {
            WorkspaceAddOutcomeDto::Added { dataset } => dataset.handle.clone(),
            other => panic!("every copy is admitted; got {other:?}"),
        })
        .collect();

    let document = service.workspace_drop_document_epoch();
    let reservation = service
        .begin_conversion_queue(&handles, ConversionConflictPolicyDto::Fail, document)
        .expect("one reservation for the whole queue");
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("claim it");
    let update = service.run_claimed_conversion(operation, &destination);

    let queue = terminal_queue(&update);
    println!("queue: {queue:?}");
    assert_eq!(queue.finalized_count, 2);
    assert_eq!(queue.failed_count, 1);
    assert_eq!(
        queue
            .items
            .iter()
            .map(|item| (item_output_name(item).to_owned(), item.state))
            .collect::<Vec<_>>(),
        vec![
            (
                String::from("one.mzML"),
                ConversionQueueItemStateDto::Finalized
            ),
            (
                String::from("two.mzML"),
                ConversionQueueItemStateDto::Failed
            ),
            (
                String::from("three.mzML"),
                ConversionQueueItemStateDto::Finalized
            ),
        ],
        "the item after the failure converted anyway"
    );

    let failed =
        item_report(&queue.items[1]).expect("the middle item reached a run and reported it");
    println!("failed item: {failed:?}");
    assert_eq!(
        failed.detailed_outcome.as_deref(),
        Some("destination_exists")
    );
    assert_eq!(
        failed.output_file_name, None,
        "a run that finalized nothing names no output file"
    );
    assert_eq!(failed.staging_residue, None);
    assert!(
        !queue.items[1].retryable,
        "the same name would be taken on the next attempt too"
    );

    // What was already there is exactly what is still there, byte for byte.
    assert_eq!(
        fs::read(&occupied).expect("the occupying file is still readable"),
        squatter,
        "a conflict leaves the existing file alone"
    );
    let mut produced = entry_names(&destination);
    produced.sort();
    assert_eq!(
        produced,
        vec!["one.mzML", "three.mzML", "two.mzML"],
        "two outputs, the occupying file, and no sidecars or staging"
    );
    println!(
        "wire: {}",
        serde_json::to_string(&update).expect("the update serializes")
    );
}

/// A retry writes files, so it proves the calling document like every other
/// command that does.
#[test]
fn a_retry_from_a_document_that_is_not_the_current_one_is_refused() {
    let fixture = TestFile::new("queue-retry-authority");
    let destination = destination_root(&fixture, "out");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let held = fixture.thermo_raw("held.raw");
    let handle = add_one_acquisition(&service, &held);

    let writer = hold_for_writing(&held);
    let update = queue_and_run(&service, &[handle], &destination);
    assert_eq!(terminal_queue(&update).retryable_failed_count, 1);
    drop(writer);

    let document = current_document(&service);
    assert_eq!(
        service
            .retry_conversion_queue(document.wrapping_add(1))
            .expect_err("a document that is not the current one cannot rerun a conversion")
            .kind,
        "invalid_conversion_reservation"
    );
    // Nothing moved: the queue is still terminal with its failure intact.
    let state = service.conversion_state();
    assert_eq!(terminal_queue(&state).retryable_failed_count, 1);
    assert_eq!(entry_names(&destination), Vec::<String>::new());

    // And a reload is entitled to retry what it recovered: the proof is that
    // the caller is the current document, not the one that built the queue.
    service.begin_webview_document();
    let retried = service
        .retry_conversion_queue(current_document(&service))
        .expect("the document that recovered the queue may rerun it");
    assert_eq!(terminal_queue(&retried).finalized_count, 1);
}

/// Two names a Windows folder answers with one file are one name here too.
#[test]
fn output_names_that_differ_only_in_case_are_a_collision() {
    let fixture = TestFile::new("queue-case-collision");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let nested = fixture.directory.join("nested");
    fs::create_dir_all(&nested).expect("create the nested folder");
    let one = add_one_acquisition(&service, &fixture.thermo_raw("Sample.raw"));
    let other = nested.join("sample.raw");
    fs::write(&other, thermo_raw_bytes()).expect("write the twin");
    let two = add_one_acquisition(&service, &other);

    // Distinct strings, and the same file on the volume this queue writes to.
    let error = service
        .conversion_queue_plan(&[one, two])
        .expect_err("an ordinary Windows folder resolves both of these to one file");
    assert_eq!(error.kind, "queue_output_name_collision");
    assert!(matches!(
        service.conversion_state().state,
        WorkspaceConversionStateDto::Idle
    ));

    // And the case that decides which direction the fold goes. A volume upcases
    // both Greek sigmas to the same letter; lowercasing leaves them apart, so a
    // rule written that way would call this pair distinct and discover the
    // conflict only after the picker.
    let sigma = add_one_acquisition(&service, &fixture.thermo_raw("\u{3a3}.raw"));
    let final_sigma = nested.join("\u{3c2}.raw");
    fs::write(&final_sigma, thermo_raw_bytes()).expect("write the final-sigma twin");
    let sigma_twin = add_one_acquisition(&service, &final_sigma);
    assert_eq!(
        service
            .conversion_queue_plan(&[sigma, sigma_twin])
            .expect_err("a Windows volume upcases both of these to one name")
            .kind,
        "queue_output_name_collision"
    );
}

/// One queue is one installation, and a retry after the installation changed is
/// refused rather than quietly mixing two builds into one result.
#[test]
fn a_retry_after_the_installation_changed_is_refused() {
    let fixture = TestFile::new("queue-installation-changed");
    let destination = destination_root(&fixture, "out");
    let provider = ConvertingProvider::faithful();
    let label = provider.installation_label();
    let service = PreviewService::new(Box::new(provider));
    let done = add_one_acquisition(&service, &fixture.thermo_raw("done.raw"));
    let held = fixture.thermo_raw("held.raw");
    let blocked = add_one_acquisition(&service, &held);

    let writer = hold_for_writing(&held);
    let update = queue_and_run(&service, &[done, blocked], &destination);
    assert_eq!(terminal_queue(&update).retryable_failed_count, 1);
    drop(writer);

    // A different ProteoWizard resolves between the run and the retry, which is
    // what advances the service's installation sequence.
    *label.lock().expect("the installation label") = String::from("other-msconvert");

    let update = service
        .retry_conversion_queue(current_document(&service))
        .expect("the retry answers, and says why it converted nothing");

    let queue = terminal_queue(&update);
    assert_eq!(
        queue.error.as_ref().expect("a queue-level refusal").kind,
        "queue_installation_changed"
    );
    // And the queue is left as it was, with its failure still there to retry
    // once the original installation is back -- not stranded as pending, which
    // would count nowhere and could never be retried again.
    assert_eq!(queue.finalized_count, 1);
    assert_eq!(queue.failed_count, 1);
    assert_eq!(queue.retryable_failed_count, 1);
    assert_eq!(queue.items[1].state, ConversionQueueItemStateDto::Failed);
    assert_eq!(queue.items[0].attempts, 1, "nothing was converted again");
    assert_eq!(queue.items[1].attempts, 1);
    assert_eq!(entry_names(&destination), vec!["done.mzML"]);
}

/// The comparison the per-item destination recheck is built on.
///
/// The recheck itself runs between two items of a live queue, and nothing in
/// these fakes can schedule a directory swap into that window: releasing a
/// parked item and racing the next one's recheck is a coin toss, and a test that
/// loses it fails for a reason the product is not wrong about. What is pinned
/// here is the rule the recheck applies -- and the two cases where it must say
/// no even though the name still resolves.
#[test]
fn a_folder_is_the_same_folder_only_when_it_is_the_same_object() {
    let root = PathBuf::from(r"C:\\fake\\out");
    let admitted = super::operation::AdmittedDestination::new(root.clone(), Some((7, [1_u8; 16])));

    assert!(
        admitted.is_still(&super::operation::AdmittedDestination::new(
            root.clone(),
            Some((7, [1_u8; 16]))
        )),
        "the same name reaching the same object is the same folder"
    );
    assert!(
        !admitted.is_still(&super::operation::AdmittedDestination::new(
            root.clone(),
            Some((7, [2_u8; 16]))
        )),
        "a different directory wearing the same name is not"
    );
    assert!(
        !admitted.is_still(&super::operation::AdmittedDestination::new(
            root.clone(),
            Some((9, [1_u8; 16]))
        )),
        "and neither is the same file id on another volume"
    );
    // A platform that will not answer is read as a refusal in both directions.
    // There is no weaker comparison to fall back on, and agreeing by default
    // would make the check say yes exactly where it knows least.
    assert!(
        !admitted.is_still(&super::operation::AdmittedDestination::new(
            root.clone(),
            None
        ))
    );
    assert!(!super::operation::AdmittedDestination::new(root.clone(), None).is_still(&admitted));
    assert!(
        !super::operation::AdmittedDestination::new(root, None).is_still(
            &super::operation::AdmittedDestination::new(PathBuf::from(r"C:\\fake\\out"), None)
        )
    );
}

/// Switching away from an installation and back again restores it, and the
/// queue is retryable again.
///
/// The counter that records *changes* can never come back to a previous value,
/// so a queue that compared generations would have been refused for ever after
/// any switch -- including a switch the user undid a moment later. The queue
/// compares the installation itself.
#[test]
fn restoring_the_original_installation_makes_the_queue_retryable_again() {
    let fixture = TestFile::new("queue-installation-restored");
    let destination = destination_root(&fixture, "out");
    let provider = ConvertingProvider::faithful();
    let label = provider.installation_label();
    let service = PreviewService::new(Box::new(provider));
    let held = fixture.thermo_raw("held.raw");
    let handle = add_one_acquisition(&service, &held);

    let writer = hold_for_writing(&held);
    let update = queue_and_run(&service, &[handle], &destination);
    assert_eq!(terminal_queue(&update).retryable_failed_count, 1);
    drop(writer);

    // Away...
    *label.lock().expect("the installation label") = String::from("other-msconvert");
    let refused = service
        .retry_conversion_queue(current_document(&service))
        .expect("the retry answers");
    assert_eq!(
        terminal_queue(&refused)
            .error
            .as_ref()
            .expect("a queue-level refusal")
            .kind,
        "queue_installation_changed"
    );

    // ...and back. The same build, whatever the change counter now reads.
    *label.lock().expect("the installation label") = String::from("msconvert");
    let retried = service
        .retry_conversion_queue(current_document(&service))
        .expect("the original installation is back, so the queue can run again");

    let queue = terminal_queue(&retried);
    assert_eq!(queue.error, None);
    assert_eq!(queue.finalized_count, 1);
    assert_eq!(queue.failed_count, 0);
    assert_eq!(queue.items[0].attempts, 2);
    assert_eq!(entry_names(&destination), vec!["held.mzML"]);
}

// --- Stopping a running queue -----------------------------------------------

/// How a stop-aware runner ends the attempt a stop reached.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StopEnding {
    /// The owned tree was terminated and confirmed empty.
    Confirmed,
    /// Termination was attempted and could not be confirmed: the owned job
    /// still reports processes.
    Survivors,
    /// The boundary could not complete the teardown at all.
    Unterminated,
    /// The process finished on its own before the request was observed.
    NaturalSuccess,
}

/// A `msconvert` stand-in that answers a cancellation request.
///
/// It parks inside the process until the test releases it, and only then reads
/// the token. That is what makes a mid-run stop deterministic rather than a
/// race: the request is made while the runner is provably inside the call, and
/// the answer is decided afterwards.
struct StopAwareRunner {
    ending: StopEnding,
    calls: Arc<AtomicUsize>,
    started: Mutex<Option<mpsc::Sender<()>>>,
    release: Mutex<Option<mpsc::Receiver<()>>>,
}

impl StopAwareRunner {
    fn parked(ending: StopEnding) -> (Self, mpsc::Receiver<()>, mpsc::Sender<()>) {
        let (started, observe_start) = mpsc::channel();
        let (release, parked) = mpsc::channel();
        (
            Self {
                ending,
                calls: Arc::new(AtomicUsize::new(0)),
                started: Mutex::new(Some(started)),
                release: Mutex::new(Some(parked)),
            },
            observe_start,
            release,
        )
    }

    fn launches(&self) -> Arc<AtomicUsize> {
        Arc::clone(&self.calls)
    }
}

impl ProcessRunner for StopAwareRunner {
    fn run(&self, spec: &CommandSpec) -> Result<ProcessOutput, ProcessError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let destination = spec
            .output_destination()
            .expect("a conversion plan carries an output destination")
            .to_path_buf();
        fs::write(destination, mzml_document(2, true)).expect("write staged output");
        Ok(ProcessOutput {
            stdout: Vec::new(),
            stderr: Vec::new(),
            stdout_total_bytes: 0,
            stderr_total_bytes: 0,
            stdout_truncated: false,
            stderr_truncated: false,
            exit_code: Some(0),
            elapsed: Duration::from_millis(3),
            termination: Termination::Exited,
            max_active_processes: Some(1),
            final_active_processes: Some(0),
            peak_job_memory_bytes: Some(2_048),
        })
    }

    fn run_cancellable(
        &self,
        spec: &CommandSpec,
        cancellation: &CancellationToken,
    ) -> Result<ProcessOutput, ProcessError> {
        // The default's own guarantee first, so a request made before the
        // launch is refused here exactly as the production runner refuses it.
        if cancellation.is_cancelled() {
            return Ok(ProcessOutput {
                exit_code: None,
                termination: Termination::NotStarted,
                max_active_processes: None,
                final_active_processes: None,
                elapsed: Duration::ZERO,
                stdout: Vec::new(),
                stderr: Vec::new(),
                stdout_total_bytes: 0,
                stderr_total_bytes: 0,
                stdout_truncated: false,
                stderr_truncated: false,
                peak_job_memory_bytes: None,
            });
        }
        self.calls.fetch_add(1, Ordering::SeqCst);
        // Announced and parked, so the request the test makes next provably
        // lands while this attempt is running.
        if let Some(started) = self.started.lock().expect("started channel").take() {
            started.send(()).expect("announce the started conversion");
            let parked = self
                .release
                .lock()
                .expect("release channel")
                .take()
                .expect("a parked runner is released exactly once");
            parked
                .recv_timeout(Duration::from_secs(10))
                .expect("the parked conversion is released");
        }
        // A partial document, as a terminated backend leaves behind. Written
        // whatever the ending, so the staging area a stop has to clean is real.
        let destination = spec
            .output_destination()
            .expect("a conversion plan carries an output destination")
            .to_path_buf();
        if !cancellation.is_cancelled() || self.ending == StopEnding::NaturalSuccess {
            fs::write(&destination, mzml_document(2, true)).expect("write staged output");
            return Ok(ProcessOutput {
                stdout: Vec::new(),
                stderr: Vec::new(),
                stdout_total_bytes: 0,
                stderr_total_bytes: 0,
                stdout_truncated: false,
                stderr_truncated: false,
                exit_code: Some(0),
                elapsed: Duration::from_millis(3),
                termination: Termination::Exited,
                max_active_processes: Some(1),
                final_active_processes: Some(0),
                peak_job_memory_bytes: Some(2_048),
            });
        }
        fs::write(&destination, b"<indexedmzML><mzML").expect("write a partial staged output");
        if self.ending == StopEnding::Unterminated {
            return Err(ProcessError::Terminate {
                detail: "the owned job refused termination".to_owned(),
            });
        }
        Ok(ProcessOutput {
            stdout: Vec::new(),
            stderr: Vec::new(),
            stdout_total_bytes: 0,
            stderr_total_bytes: 0,
            stdout_truncated: false,
            stderr_truncated: false,
            exit_code: Some(-1_073_741_510),
            elapsed: Duration::from_millis(4),
            termination: Termination::Cancelled,
            max_active_processes: Some(1),
            final_active_processes: if self.ending == StopEnding::Survivors {
                Some(2)
            } else {
                Some(0)
            },
            peak_job_memory_bytes: Some(2_048),
        })
    }
}

/// The queue as a terminal state, with the reason it is over.
fn terminal_reason(update: &WorkspaceConversionUpdateDto) -> ConversionQueueTerminalReasonDto {
    let WorkspaceConversionStateDto::Terminal { reason, .. } = &update.state else {
        panic!("the queue reaches a terminal state; got {:?}", update.state);
    };
    *reason
}

fn item_states(queue: &ConversionQueueDto) -> Vec<ConversionQueueItemStateDto> {
    queue.items.iter().map(|item| item.state).collect()
}

/// Runs a three-item queue against a parked stop-aware runner, stops it while
/// the first item is provably inside its process, and returns what settled.
fn stop_mid_item(
    ending: StopEnding,
) -> (
    TestFile,
    PathBuf,
    Arc<PreviewService>,
    WorkspaceConversionUpdateDto,
    Arc<AtomicUsize>,
) {
    let fixture = TestFile::new("queue-stop");
    let destination = destination_root(&fixture, "out");
    let (runner, started, release) = StopAwareRunner::parked(ending);
    let launches = runner.launches();
    let service = Arc::new(PreviewService::new(Box::new(ConvertingProvider::new(
        evidenced_capabilities(),
        runner,
    ))));
    let handles: Vec<String> = ["one.raw", "two.raw", "three.raw"]
        .iter()
        .map(|name| add_one_acquisition(&service, &fixture.thermo_raw(name)))
        .collect();

    let document = current_document(&service);
    let reservation = service
        .begin_conversion_queue(&handles, ConversionConflictPolicyDto::Fail, document)
        .expect("the queue is admitted");
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("claim it");

    let worker = {
        let service = Arc::clone(&service);
        let destination = destination.clone();
        std::thread::spawn(move || service.run_claimed_conversion(operation, &destination))
    };
    started
        .recv_timeout(Duration::from_secs(10))
        .expect("the first item reaches its process");

    let stopped = service
        .stop_conversion_queue(&operation.to_string(), document)
        .expect("the running queue of this document is stoppable");
    // Accepted immediately, and said so before anything has settled.
    assert!(matches!(
        stopped.state,
        WorkspaceConversionStateDto::Stopping { .. }
    ));

    release.send(()).expect("release the parked conversion");
    let update = worker.join().expect("the queue worker finishes");
    (fixture, destination, service, update, launches)
}

/// A stop reaching a running item cancels it, runs nothing after it, and keeps
/// everything already finished.
#[test]
fn a_confirmed_stop_cancels_the_running_item_and_runs_no_other() {
    let (_fixture, destination, service, update, launches) = stop_mid_item(StopEnding::Confirmed);

    assert_eq!(
        terminal_reason(&update),
        ConversionQueueTerminalReasonDto::Stopped
    );
    let queue = terminal_queue(&update);
    assert_eq!(
        item_states(queue),
        vec![
            ConversionQueueItemStateDto::Cancelled,
            ConversionQueueItemStateDto::NotRun,
            ConversionQueueItemStateDto::NotRun,
        ]
    );
    assert_eq!(queue.cancelled_count, 1);
    assert_eq!(queue.not_run_count, 2);
    assert_eq!(queue.finalized_count, 0);
    // Not failures. A cancelled item is what the user asked for and a not-run
    // item never ran, and calling either a failure would offer a retry over it.
    assert_eq!(queue.failed_count, 0);
    assert_eq!(queue.cancellation_failed_count, 0);
    // Exactly one process, for the item that was running.
    assert_eq!(launches.load(Ordering::SeqCst), 1);
    // Nothing was finalized, and the partial document is gone with its staging
    // area rather than left in the folder the user chose.
    assert!(
        fs::read_dir(&destination)
            .expect("read the destination")
            .next()
            .is_none(),
        "a stopped queue finalizes nothing and leaves no staging behind"
    );
    let cancelled = &queue.items[0];
    assert!(item_output_name(cancelled).ends_with(".mzML"));
    assert!(
        item_report(cancelled).is_none(),
        "a cancelled item produced nothing for a report to describe"
    );
    let facts = cancelled
        .cancellation
        .as_ref()
        .expect("a stop that reached an attempt says what it established");
    assert!(facts.process_launched);
    assert!(facts.termination_requested);
    assert!(facts.tree_termination_confirmed);
    assert!(facts.partial_output_observed);
    assert_eq!(facts.staging_residue, None);
    // A not-run item launched nothing, so there is nothing to have established.
    assert!(queue.items[1].cancellation.is_none());
    assert_eq!(queue.items[1].attempts, 0);
    // None of the three is offered again. A cancelled item has nothing to
    // correct and a not-run item never ran, so retryable on either would be a
    // claim the interface could act on.
    assert!(queue.items.iter().all(|item| !item.retryable));
    assert_eq!(queue.retryable_failed_count, 0);
    // And the session still trusts the backend.
    assert!(!service.backend_is_quarantined());
    assert!(!service.conversion_state().backend_quarantined);
}

/// The whole point of the copy: what finished stays finished.
#[test]
fn a_stop_between_items_keeps_every_finished_output_and_starts_no_more() {
    let fixture = TestFile::new("queue-stop-between");
    let destination = destination_root(&fixture, "out");
    let (runner, started, release) = StopAwareRunner::parked(StopEnding::NaturalSuccess);
    let launches = runner.launches();
    let service = Arc::new(PreviewService::new(Box::new(ConvertingProvider::new(
        evidenced_capabilities(),
        runner,
    ))));
    let handles: Vec<String> = ["one.raw", "two.raw", "three.raw"]
        .iter()
        .map(|name| add_one_acquisition(&service, &fixture.thermo_raw(name)))
        .collect();

    let document = current_document(&service);
    let reservation = service
        .begin_conversion_queue(&handles, ConversionConflictPolicyDto::Fail, document)
        .expect("the queue is admitted");
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("claim it");
    let worker = {
        let service = Arc::clone(&service);
        let destination = destination.clone();
        std::thread::spawn(move || service.run_claimed_conversion(operation, &destination))
    };
    // The first item is inside its process. The stop is requested now, and the
    // runner is told to finish naturally -- so completion is observed before
    // the request can be, which is the ordering rule ADR 0014 records.
    started
        .recv_timeout(Duration::from_secs(10))
        .expect("the first item reaches its process");
    service
        .stop_conversion_queue(&operation.to_string(), document)
        .expect("stoppable");
    release.send(()).expect("release the parked conversion");
    let update = worker.join().expect("the queue worker finishes");

    assert_eq!(
        terminal_reason(&update),
        ConversionQueueTerminalReasonDto::Stopped
    );
    let queue = terminal_queue(&update);
    // The item that finished keeps its ordinary result. It is not relabelled
    // as cancelled because the user pressed Stop near its end.
    assert_eq!(
        item_states(queue),
        vec![
            ConversionQueueItemStateDto::Finalized,
            ConversionQueueItemStateDto::NotRun,
            ConversionQueueItemStateDto::NotRun,
        ]
    );
    assert_eq!(queue.finalized_count, 1);
    assert_eq!(queue.cancelled_count, 0);
    assert_eq!(queue.not_run_count, 2);
    assert!(queue.items[0].cancellation.is_none());
    assert_eq!(
        item_report(&queue.items[0]).map(|report| report.outcome.as_str()),
        Some("finalized")
    );
    // One process for one item, and the output it produced is in the folder.
    assert_eq!(launches.load(Ordering::SeqCst), 1);
    let produced: Vec<_> = fs::read_dir(&destination)
        .expect("read the destination")
        .map(|entry| entry.expect("entry").file_name())
        .collect();
    assert_eq!(produced.len(), 1, "{produced:?}");
    // A stopped queue is terminal and is not rerun in place, whatever it holds.
    assert!(
        service
            .retry_conversion_queue(current_document(&service))
            .is_err(),
        "a stopped queue is not retried in place"
    );
}

/// An unconfirmed stop is neither cancelled nor an ordinary failure, and it
/// stops this session running anything else.
#[test]
fn an_unconfirmed_stop_quarantines_the_backend_and_refuses_every_operation() {
    for ending in [StopEnding::Unterminated, StopEnding::Survivors] {
        let (fixture, destination, service, update, launches) = stop_mid_item(ending);

        assert_eq!(
            terminal_reason(&update),
            ConversionQueueTerminalReasonDto::StopFailed,
            "{ending:?}"
        );
        let queue = terminal_queue(&update);
        assert_eq!(
            item_states(queue),
            vec![
                ConversionQueueItemStateDto::CancellationFailed,
                ConversionQueueItemStateDto::NotRun,
                ConversionQueueItemStateDto::NotRun,
            ],
            "{ending:?}"
        );
        assert_eq!(queue.cancellation_failed_count, 1);
        assert_eq!(queue.cancelled_count, 0, "never called cancelled");
        let facts = queue.items[0]
            .cancellation
            .as_ref()
            .expect("a stop that reached an attempt says what it established");
        assert!(facts.termination_requested);
        assert!(
            !facts.tree_termination_confirmed,
            "the whole reason this state exists"
        );
        // No later item ran.
        assert_eq!(launches.load(Ordering::SeqCst), 1);
        assert!(
            fs::read_dir(&destination)
                .expect("read the destination")
                .next()
                .is_none()
        );

        // The session has stopped trusting the backend, and says so.
        assert!(service.backend_is_quarantined(), "{ending:?}");
        assert!(service.conversion_state().backend_quarantined);
        // Every operation that would launch a process is refused.
        let handle = queue.items[0].dataset_handle.clone();
        assert_eq!(
            service.load_spectrum(&handle, 0).unwrap_err().kind,
            "backend_quarantined"
        );
        // Opening a preview of one of these rows is refused for what the row is
        // rather than for the state of the backend, and that order is on
        // purpose. An open decides whether the preview on screen is superseded,
        // so it has to establish what the request names before it can answer
        // anything about the moment -- a vendor acquisition is not previewable
        // whatever the backend is doing, and saying "backend quarantined" here
        // would imply that repairing one would make this row openable.
        //
        // That a quarantined backend refuses a genuinely previewable open, and
        // revokes the chromatogram while doing it, is pinned separately by
        // `a_backend_that_became_unusable_refuses_the_open_and_leaves_no_chromatogram`.
        assert_eq!(
            service.open_preview(&handle).unwrap_err().kind,
            "dataset_not_previewable"
        );
        let document = current_document(&service);
        assert_eq!(
            service
                .begin_conversion_queue(
                    std::slice::from_ref(&handle),
                    ConversionConflictPolicyDto::Fail,
                    document
                )
                .unwrap_err()
                .kind,
            "backend_quarantined"
        );
        assert_eq!(
            service.retry_conversion_queue(document).unwrap_err().kind,
            "backend_quarantined"
        );
        // And the roster is still the user's to read and curate.
        assert_eq!(service.roster().datasets.len(), 3);
        let _ = &fixture;
    }
}

/// A stop before the first item launches nothing at all.
#[test]
fn a_stop_before_the_first_item_launches_no_process() {
    let fixture = TestFile::new("queue-stop-early");
    let destination = destination_root(&fixture, "out");
    let runner = FakeConversionRunner::new(BackendAct::Convert);
    let launches = runner.launches();
    let service = PreviewService::new(Box::new(ConvertingProvider::new(
        evidenced_capabilities(),
        runner,
    )));
    let handles: Vec<String> = ["one.raw", "two.raw"]
        .iter()
        .map(|name| add_one_acquisition(&service, &fixture.thermo_raw(name)))
        .collect();

    let document = current_document(&service);
    let reservation = service
        .begin_conversion_queue(&handles, ConversionConflictPolicyDto::Fail, document)
        .expect("the queue is admitted");
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("claim it");
    // Marked running without starting the worker, which is the state a queue is
    // in while it waits behind another backend operation for the gate.
    let started = service.start_running_for_test(operation, &destination);
    assert!(started);
    service
        .stop_conversion_queue(&operation.to_string(), document)
        .expect("a running queue is stoppable before its first item");
    let update = service.drain_queue_for_test(operation);

    assert_eq!(
        terminal_reason(&update),
        ConversionQueueTerminalReasonDto::Stopped
    );
    let queue = terminal_queue(&update);
    assert_eq!(
        item_states(queue),
        vec![
            ConversionQueueItemStateDto::NotRun,
            ConversionQueueItemStateDto::NotRun,
        ]
    );
    assert_eq!(queue.not_run_count, 2);
    assert_eq!(
        launches.load(Ordering::SeqCst),
        0,
        "no process was launched"
    );
    assert!(queue.items.iter().all(|item| item.attempts == 0));
    assert!(
        fs::read_dir(&destination)
            .expect("read the destination")
            .next()
            .is_none()
    );
}

/// Who may stop what.
#[test]
fn only_the_current_document_may_stop_its_own_running_queue() {
    let fixture = TestFile::new("queue-stop-authority");
    let destination = destination_root(&fixture, "out");
    let runner = FakeConversionRunner::new(BackendAct::Convert);
    let service = PreviewService::new(Box::new(ConvertingProvider::new(
        evidenced_capabilities(),
        runner,
    )));
    let handle = add_one_acquisition(&service, &fixture.thermo_raw("one.raw"));
    let document = current_document(&service);

    // An idle slot has nothing of anybody's to stop.
    assert_eq!(
        service
            .stop_conversion_queue("1", document)
            .unwrap_err()
            .kind,
        "conversion_not_stoppable"
    );

    let reservation = service
        .begin_conversion_queue(
            std::slice::from_ref(&handle),
            ConversionConflictPolicyDto::Fail,
            document,
        )
        .expect("the queue is admitted");
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("claim it");
    // A picker still open is closed by cancelling it, not by stopping a queue
    // that has not begun.
    assert_eq!(
        service
            .stop_conversion_queue(&operation.to_string(), document)
            .unwrap_err()
            .kind,
        "conversion_not_stoppable"
    );

    assert!(service.start_running_for_test(operation, &destination));
    // A document that has been replaced cannot stop its replacement's work.
    assert_eq!(
        service
            .stop_conversion_queue(&operation.to_string(), document.wrapping_sub(1))
            .unwrap_err()
            .kind,
        "conversion_not_stoppable"
    );
    // Nor can an identifier that names another queue, or nothing at all.
    for wrong in [&(operation + 1).to_string()[..], "0", "not-a-number", ""] {
        assert_eq!(
            service
                .stop_conversion_queue(wrong, document)
                .unwrap_err()
                .kind,
            "conversion_not_stoppable",
            "{wrong:?}"
        );
    }

    // The right document and the right queue is accepted, and repeating it is
    // the same answer rather than an error.
    let first = service
        .stop_conversion_queue(&operation.to_string(), document)
        .expect("stoppable");
    let second = service
        .stop_conversion_queue(&operation.to_string(), document)
        .expect("a repeated stop is idempotent");
    assert!(matches!(
        first.state,
        WorkspaceConversionStateDto::Stopping { .. }
    ));
    assert!(matches!(
        second.state,
        WorkspaceConversionStateDto::Stopping { .. }
    ));
    // Idempotent, and not a second transition: nothing a reader can see moved.
    assert_eq!(first.sequence, second.sequence);
    let _ = service.drain_queue_for_test(operation);
}

/// A queue stopped and then replaced starts clean.
#[test]
fn a_new_queue_is_not_born_stopped() {
    let fixture = TestFile::new("queue-stop-reset");
    let destination = destination_root(&fixture, "out");
    let runner = FakeConversionRunner::new(BackendAct::Convert);
    let launches = runner.launches();
    let service = PreviewService::new(Box::new(ConvertingProvider::new(
        evidenced_capabilities(),
        runner,
    )));
    let handle = add_one_acquisition(&service, &fixture.thermo_raw("one.raw"));
    let document = current_document(&service);

    let reservation = service
        .begin_conversion_queue(
            std::slice::from_ref(&handle),
            ConversionConflictPolicyDto::Fail,
            document,
        )
        .expect("the queue is admitted");
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("claim it");
    assert!(service.start_running_for_test(operation, &destination));
    service
        .stop_conversion_queue(&operation.to_string(), document)
        .expect("stoppable");
    let stopped = service.drain_queue_for_test(operation);
    assert_eq!(
        terminal_reason(&stopped),
        ConversionQueueTerminalReasonDto::Stopped
    );
    assert_eq!(launches.load(Ordering::SeqCst), 0);

    // The next queue is a new operation, and the stop that ended the last one
    // does not reach it.
    let update = queue_and_run(&service, std::slice::from_ref(&handle), &destination);
    assert_eq!(
        terminal_reason(&update),
        ConversionQueueTerminalReasonDto::Completed
    );
    assert_eq!(
        item_states(terminal_queue(&update)),
        vec![ConversionQueueItemStateDto::Finalized]
    );
    assert_eq!(launches.load(Ordering::SeqCst), 1);
}

/// Real Stop queue, on the evidenced installation and the lawful fixture.
///
/// Scenario A of the M3.4 evidence. Three copies with distinct filesystem
/// identities, distinct names and distinct planned outputs, admitted through the
/// production Add-files path and queued through the production service. The stop
/// is issued through the same command boundary the interface uses, at the moment
/// the first item has provably created its staged output -- so it lands while a
/// real `msconvert` is running rather than at a guessed time.
///
/// ```text
/// set MSCANVAS_THERMO_FIXTURE=<path to the acquisition>
/// set MSCANVAS_CONVERSION_DESTINATION=<path to an empty folder>
/// set MSCANVAS_QUEUE_STAGE=<path to an empty folder for the copies>
/// cargo test -p mscanvas-desktop --lib -- --ignored --nocapture a_real_queue_stops
/// ```
#[test]
#[ignore = "needs a local ProteoWizard installation and a real vendor acquisition"]
fn a_real_queue_stops_the_running_item_and_starts_no_other() {
    let (acquisition, destination, stage) = real_evidence_paths();
    let copies = copy_acquisition(
        &acquisition,
        &stage,
        &["alpha.raw", "bravo.raw", "charlie.raw"],
    );

    let service = Arc::new(PreviewService::new(Box::new(
        super::backend::ProteoWizardProvider::new(),
    )));
    let handles = admit_all(&service, &copies);
    let document = service.workspace_drop_document_epoch();
    let reservation = service
        .begin_conversion_queue(&handles, ConversionConflictPolicyDto::Fail, document)
        .expect("one reservation for the whole queue");
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("claim it");

    let worker = {
        let service = Arc::clone(&service);
        let destination = destination.clone();
        std::thread::spawn(move || service.run_claimed_conversion(operation, &destination))
    };
    // The private staging tree is watched only to decide *when* to press Stop.
    // Nothing about the result depends on what it saw.
    let observed = wait_for_staged_output(&destination, Duration::from_secs(60));
    let requested_at = std::time::Instant::now();
    let accepted = service
        .stop_conversion_queue(&operation.to_string(), document)
        .expect("the running queue of this document is stoppable");
    assert!(matches!(
        accepted.state,
        WorkspaceConversionStateDto::Stopping { .. }
    ));
    let update = worker.join().expect("the queue worker finishes");
    let elapsed = requested_at.elapsed();

    println!("staged output observed: {observed}");
    println!("request to terminal: {} ms", elapsed.as_millis());
    println!("terminal reason: {:?}", terminal_reason(&update));
    let queue = terminal_queue(&update);
    println!("queue: {queue:?}");

    assert!(observed, "the first item created its staged output");
    assert_eq!(
        terminal_reason(&update),
        ConversionQueueTerminalReasonDto::Stopped
    );
    assert_eq!(
        item_states(queue),
        vec![
            ConversionQueueItemStateDto::Cancelled,
            ConversionQueueItemStateDto::NotRun,
            ConversionQueueItemStateDto::NotRun,
        ]
    );
    assert_eq!(queue.cancelled_count, 1);
    assert_eq!(queue.not_run_count, 2);
    assert_eq!(queue.finalized_count, 0);
    assert_eq!(queue.failed_count, 0);
    assert_eq!(queue.cancellation_failed_count, 0);
    let facts = queue.items[0]
        .cancellation
        .as_ref()
        .expect("a stop that reached a real attempt says what it established");
    println!("cancellation: {facts:?}");
    assert!(facts.process_launched);
    assert!(facts.tree_termination_confirmed);
    assert_eq!(facts.staging_residue, None, "no staging was left behind");
    // Nothing was finalized and nothing was left in the folder the user chose,
    // staging included.
    let left: Vec<_> = fs::read_dir(&destination)
        .expect("read the destination")
        .map(|entry| entry.expect("entry").file_name())
        .collect();
    println!("destination afterwards: {left:?}");
    assert!(left.is_empty(), "{left:?}");
    // The session still trusts the backend: the tree was confirmed gone.
    assert!(!service.backend_is_quarantined());
    // And a stopped queue is terminal rather than rerun in place.
    assert!(
        service
            .retry_conversion_queue(service.workspace_drop_document_epoch())
            .is_err()
    );
    // Nothing path-free about this crossed the wire.
    assert_wire_names_no_location(&update, &destination, &stage);
    cleanup_real_evidence(&copies, &destination);
}

/// Scenario B: a completed output survives a stop that follows it.
///
/// The stop is issued only once the first item has finalized, which is what
/// makes it a between-items stop rather than a race. Nothing here sleeps: the
/// queue's own authoritative state is polled until it says one item is done.
#[test]
#[ignore = "needs a local ProteoWizard installation and a real vendor acquisition"]
fn a_real_stop_after_one_item_keeps_that_output_and_runs_no_other() {
    let (acquisition, destination, stage) = real_evidence_paths();
    let copies = copy_acquisition(
        &acquisition,
        &stage,
        &["alpha.raw", "bravo.raw", "charlie.raw"],
    );

    let service = Arc::new(PreviewService::new(Box::new(
        super::backend::ProteoWizardProvider::new(),
    )));
    let handles = admit_all(&service, &copies);
    let document = service.workspace_drop_document_epoch();
    let reservation = service
        .begin_conversion_queue(&handles, ConversionConflictPolicyDto::Fail, document)
        .expect("one reservation for the whole queue");
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("claim it");

    let worker = {
        let service = Arc::clone(&service);
        let destination = destination.clone();
        std::thread::spawn(move || service.run_claimed_conversion(operation, &destination))
    };
    // Waits on the queue's own state, not on a clock.
    let finished = wait_for_finalized_item(&service, Duration::from_secs(120));
    service
        .stop_conversion_queue(&operation.to_string(), document)
        .expect("stoppable");
    let update = worker.join().expect("the queue worker finishes");

    println!("terminal reason: {:?}", terminal_reason(&update));
    let queue = terminal_queue(&update);
    println!("queue: {queue:?}");
    assert!(finished, "the first item finalized before the stop");
    assert_eq!(
        terminal_reason(&update),
        ConversionQueueTerminalReasonDto::Stopped
    );
    assert_eq!(queue.finalized_count, 1);
    assert_eq!(queue.items[0].state, ConversionQueueItemStateDto::Finalized);
    // The finished output is still there, and is the only thing there.
    let left: Vec<_> = fs::read_dir(&destination)
        .expect("read the destination")
        .map(|entry| entry.expect("entry").file_name())
        .collect();
    println!("destination afterwards: {left:?}");
    assert_eq!(left.len(), 1, "{left:?}");
    assert_eq!(left[0].to_string_lossy(), "alpha.mzML");
    // Whatever the last item was, nothing after it ran.
    assert!(
        queue
            .items
            .iter()
            .rev()
            .take(1)
            .all(|item| item.state == ConversionQueueItemStateDto::NotRun)
    );
    assert_wire_names_no_location(&update, &destination, &stage);
    cleanup_real_evidence(&copies, &destination);
}

/// The three paths every real-evidence run needs.
fn real_evidence_paths() -> (PathBuf, PathBuf, PathBuf) {
    let Ok(fixture) = std::env::var("MSCANVAS_THERMO_FIXTURE") else {
        panic!("set MSCANVAS_THERMO_FIXTURE to the acquisition to copy");
    };
    let Ok(destination) = std::env::var("MSCANVAS_CONVERSION_DESTINATION") else {
        panic!("set MSCANVAS_CONVERSION_DESTINATION to an empty folder");
    };
    let Ok(stage) = std::env::var("MSCANVAS_QUEUE_STAGE") else {
        panic!("set MSCANVAS_QUEUE_STAGE to an empty folder for the copies");
    };
    (
        PathBuf::from(fixture),
        PathBuf::from(destination),
        PathBuf::from(stage),
    )
}

/// Copies with distinct names, distinct filesystem identities and therefore
/// distinct planned outputs.
fn copy_acquisition(acquisition: &Path, stage: &Path, names: &[&str]) -> Vec<PathBuf> {
    names
        .iter()
        .map(|name| {
            let target = stage.join(name);
            fs::copy(acquisition, &target).expect("copy the acquisition");
            target
        })
        .collect()
}

/// Every copy, through the production Add-files path.
fn admit_all(service: &PreviewService, copies: &[PathBuf]) -> Vec<String> {
    let batch = service.add_files(copies).expect("no conversion is running");
    batch
        .outcomes
        .iter()
        .map(|outcome| match outcome {
            WorkspaceAddOutcomeDto::Added { dataset } => dataset.handle.clone(),
            other => panic!("every copy is admitted; got {other:?}"),
        })
        .collect()
}

/// Waits until the private staging tree holds an entry the backend wrote.
///
/// Evidence about *when* to press Stop, and nothing more. It resolves the
/// staging root by shape rather than by reconstructing a name, so it depends on
/// nothing the conversion boundary keeps private.
fn wait_for_staged_output(destination: &Path, bound: Duration) -> bool {
    let deadline = std::time::Instant::now() + bound;
    while std::time::Instant::now() < deadline {
        if let Ok(entries) = fs::read_dir(destination) {
            for entry in entries.flatten() {
                if entry.file_type().is_ok_and(|kind| kind.is_dir())
                    && fs::read_dir(entry.path().join("output"))
                        .is_ok_and(|mut staged| staged.next().is_some())
                {
                    return true;
                }
            }
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    false
}

/// Waits until the queue's own state says one item has finalized.
fn wait_for_finalized_item(service: &PreviewService, bound: Duration) -> bool {
    let deadline = std::time::Instant::now() + bound;
    while std::time::Instant::now() < deadline {
        let update = service.conversion_state();
        let queue = match &update.state {
            WorkspaceConversionStateDto::Running { queue, .. }
            | WorkspaceConversionStateDto::Stopping { queue, .. }
            | WorkspaceConversionStateDto::Terminal { queue, .. } => queue,
            _ => {
                std::thread::sleep(Duration::from_millis(10));
                continue;
            }
        };
        if queue.finalized_count > 0 {
            return true;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    false
}

/// Nothing the queue reports can locate anything.
fn assert_wire_names_no_location(
    update: &WorkspaceConversionUpdateDto,
    destination: &Path,
    stage: &Path,
) {
    let rendered = serde_json::to_string(update).expect("the update serializes");
    for absent in [
        destination.to_string_lossy().as_ref(),
        stage.to_string_lossy().as_ref(),
        "mscanvas-staging",
    ] {
        assert!(
            !rendered.contains(absent),
            "the wire must not carry {absent:?}"
        );
    }
    let wire: serde_json::Value = serde_json::from_str(&rendered).expect("and parses back");
    let mut strings = Vec::new();
    collect_strings(&wire, &mut strings);
    for value in &strings {
        assert!(
            !value.contains('\\') && !value.contains('/'),
            "a queue names no path, and {value:?} carries a separator"
        );
    }
}

/// Removes every copy and everything the run produced.
fn cleanup_real_evidence(copies: &[PathBuf], destination: &Path) {
    for copy in copies {
        let _ = fs::remove_file(copy);
    }
    if let Ok(entries) = fs::read_dir(destination) {
        for entry in entries.flatten() {
            let path = entry.path();
            let _ = if path.is_dir() {
                fs::remove_dir_all(&path)
            } else {
                fs::remove_file(&path)
            };
        }
    }
}

/// A stop that lands after an item was marked running and before its process
/// exists launches nothing, and says so.
///
/// The window is real -- the second item of the real-backend evidence run fell
/// into it -- and what it must never do is report a process that never ran. The
/// pair of facts is what carries the meaning: nothing was launched, and nothing
/// of this application''s survives.
#[test]
fn a_stop_between_starting_an_item_and_spawning_it_launches_nothing() {
    let fixture = TestFile::new("queue-stop-prelaunch");
    let destination = destination_root(&fixture, "out");
    // Never parked: the runner answers the token on entry, exactly as the
    // production runner refuses to launch after a request already made.
    let (runner, _started, _release) = StopAwareRunner::parked(StopEnding::Confirmed);
    let launches = runner.launches();
    let service = Arc::new(PreviewService::new(Box::new(ConvertingProvider::new(
        evidenced_capabilities(),
        runner,
    ))));
    let handles: Vec<String> = ["one.raw", "two.raw"]
        .iter()
        .map(|name| add_one_acquisition(&service, &fixture.thermo_raw(name)))
        .collect();
    let document = current_document(&service);
    let reservation = service
        .begin_conversion_queue(&handles, ConversionConflictPolicyDto::Fail, document)
        .expect("the queue is admitted");
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("claim it");
    assert!(service.start_running_for_test(operation, &destination));
    // Accepted before the worker begins, so the first item is started by the
    // worker and then refused by the runner rather than never started at all.
    service
        .stop_conversion_queue(&operation.to_string(), document)
        .expect("stoppable");
    let update = service.drain_queue_for_test(operation);

    assert_eq!(
        terminal_reason(&update),
        ConversionQueueTerminalReasonDto::Stopped
    );
    let queue = terminal_queue(&update);
    // Nothing began at all here: the worker asks before it starts an item.
    assert_eq!(
        item_states(queue),
        vec![
            ConversionQueueItemStateDto::NotRun,
            ConversionQueueItemStateDto::NotRun,
        ]
    );
    assert_eq!(launches.load(Ordering::SeqCst), 0);
    assert!(queue.items.iter().all(|item| item.cancellation.is_none()));
}

/// The whole serialized stopped queue, member by member.
///
/// The same shape assertion the completed queue already carries, over the
/// states only a stop can produce -- so a member added to a cancellation fact
/// has to be answered for here rather than arriving on the wire unnoticed.
#[test]
fn the_serialized_stopped_queue_carries_no_location_and_names_no_output() {
    let (fixture, destination, _service, update, _launches) = stop_mid_item(StopEnding::Confirmed);
    let wire: serde_json::Value =
        serde_json::from_str(&serde_json::to_string(&update).expect("the update serializes"))
            .expect("and parses back");

    assert_eq!(wire["state"]["status"], "terminal");
    assert_eq!(wire["state"]["reason"], "stopped");
    assert_eq!(wire["backendQuarantined"], false);
    let items = wire["state"]["queue"]["items"]
        .as_array()
        .expect("the queue carries items");
    assert_eq!(
        items
            .iter()
            .map(|item| item["state"].as_str().expect("a state"))
            .collect::<Vec<_>>(),
        vec!["cancelled", "notRun", "notRun"]
    );
    assert_eq!(
        sorted_keys(&items[0]["cancellation"]),
        vec![
            "elapsedMilliseconds",
            "partialOutputObserved",
            "processLaunched",
            "stagingResidue",
            "termination",
            "terminationRequested",
            "treeTerminationConfirmed",
        ]
    );
    // A cancelled item finalized nothing, so it carries no report to name an
    // output from -- and a not-run item carries no cancellation facts at all.
    assert!(items[0]["report"].is_null());
    assert!(items[1]["cancellation"].is_null());

    // No process identifier, no job handle, no path, at any depth.
    let rendered = serde_json::to_string(&update).expect("the update serializes");
    for absent in [
        destination.to_string_lossy().as_ref(),
        fixture.directory.to_string_lossy().as_ref(),
        "mscanvas-staging",
        "pid",
        "handle\":",
    ] {
        assert!(
            !rendered.contains(absent),
            "the wire must not carry {absent:?}"
        );
    }
    let mut strings = Vec::new();
    collect_strings(&wire, &mut strings);
    for value in &strings {
        assert!(
            !value.contains('\\') && !value.contains('/'),
            "a stopped queue names no path, and {value:?} carries a separator"
        );
    }
}

/// A stopped queue holding a genuinely retryable failure is still not retried.
///
/// The failure would be offered again in an ordinary queue -- that is what
/// `retryable` means -- and a stopped queue still refuses, because the user
/// asked for the whole batch to stop rather than for part of it to be rerun.
#[test]
fn a_stopped_queue_is_not_retried_even_when_it_holds_a_retryable_failure() {
    let fixture = TestFile::new("queue-stop-retry");
    let destination = destination_root(&fixture, "out");
    let (runner, started, release) = StopAwareRunner::parked(StopEnding::Confirmed);
    let service = Arc::new(PreviewService::new(Box::new(ConvertingProvider::new(
        evidenced_capabilities(),
        runner,
    ))));
    let blocked = fixture.thermo_raw("blocked.raw");
    let handles: Vec<String> = [
        blocked.clone(),
        fixture.thermo_raw("two.raw"),
        fixture.thermo_raw("three.raw"),
    ]
    .iter()
    .map(|path| add_one_acquisition(&service, path))
    .collect();

    let document = current_document(&service);
    let reservation = service
        .begin_conversion_queue(&handles, ConversionConflictPolicyDto::Fail, document)
        .expect("the queue is admitted");
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("claim it");
    // The first item's source is held with no sharing, which is the one
    // condition this workflow classifies as retryable: the object is there and
    // could not be read *now*. Held across the run, so the item genuinely fails
    // that way rather than converting.
    let _held = writer_hold(&blocked);

    let worker = {
        let service = Arc::clone(&service);
        let destination = destination.clone();
        std::thread::spawn(move || service.run_claimed_conversion(operation, &destination))
    };
    started
        .recv_timeout(Duration::from_secs(10))
        .expect("an item reaches its process");
    service
        .stop_conversion_queue(&operation.to_string(), document)
        .expect("stoppable");
    release.send(()).expect("release the parked conversion");
    let update = worker.join().expect("the queue worker finishes");

    assert_eq!(
        terminal_reason(&update),
        ConversionQueueTerminalReasonDto::Stopped
    );
    // Whatever this queue holds, the stopped one is terminal. Asserted through
    // the same command the interface calls rather than through the slot.
    assert!(
        service
            .retry_conversion_queue(current_document(&service))
            .is_err(),
        "a stopped queue is never rerun in place"
    );
}

/// Holds a file open for writing, which is the condition this workflow calls
/// retryable: the object is there and could not be read *now*.
///
/// Sharing is granted for exactly what the session's own lease already holds,
/// so this is a second program editing the acquisition rather than a test
/// fighting the registry for it. The conversion path withholds write sharing on
/// its own open, so it is that open which refuses.
fn writer_hold(path: &Path) -> fs::File {
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;

        const FILE_SHARE_READ: u32 = 0x0000_0001;
        const FILE_SHARE_WRITE: u32 = 0x0000_0002;
        const FILE_SHARE_DELETE: u32 = 0x0000_0004;

        fs::OpenOptions::new()
            .read(true)
            .write(true)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
            .open(path)
            .expect("hold the acquisition open for writing")
    }
    #[cfg(not(windows))]
    {
        fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(path)
            .expect("hold the acquisition open for writing")
    }
}

/// The stop handle belongs to one exact attempt.
///
/// Released by operation, item and attempt number, so a release that names any
/// other attempt leaves the live handle alone. The queue's own loop never
/// produces a mismatched release today -- one worker settles one attempt before
/// binding the next -- which is why this asks the slot directly: the identity is
/// what makes the binding provable rather than incidental, and a second worker
/// or a reordered loop would depend on it.
#[test]
fn releasing_another_attempt_leaves_the_live_stop_handle_alone() {
    let mut slot = ConversionSlot::default();
    let cancellation = ConversionCancellation::new();
    let request = cancellation.request_handle();

    // A queue of one, marked running, with one attempt bound to it.
    let queue = ConversionQueue::new(
        0,
        ConversionConflictPolicyDto::Fail,
        vec![test_queue_item()],
    )
    .expect("one item is a queue");
    let _ = slot
        .begin(queue)
        .expect("an idle slot issues a reservation");
    let operation = slot
        .claim(&reservation_handle(&slot), 0)
        .expect("claim the reservation");
    assert!(slot.start_running(operation, test_destination()));
    let attempt = slot.start_item(operation, 0).expect("the item starts");
    slot.bind_attempt(operation, 0, attempt, request);

    // Every way of naming a different attempt leaves it bound.
    slot.release_attempt(operation, 1, attempt);
    slot.release_attempt(operation, 0, attempt + 1);
    slot.release_attempt(operation + 1, 0, attempt);
    match slot.request_stop(operation).expect("stoppable") {
        StopAccepted::Requested(handle) => {
            handle
                .expect("the live attempt is still reachable")
                .request();
        }
        StopAccepted::AlreadyRequested => panic!("the first request is not a repeat"),
    }
    assert!(
        cancellation.request_handle().is_requested(),
        "the stop reached the attempt it was bound to"
    );

    // And the exact one clears it, so a later stop finds nothing stale.
    let mut slot = ConversionSlot::default();
    let cancellation = ConversionCancellation::new();
    let queue = ConversionQueue::new(
        0,
        ConversionConflictPolicyDto::Fail,
        vec![test_queue_item()],
    )
    .expect("one item is a queue");
    let _ = slot.begin(queue).expect("reservation");
    let operation = slot
        .claim(&reservation_handle(&slot), 0)
        .expect("claim the reservation");
    assert!(slot.start_running(operation, test_destination()));
    let attempt = slot.start_item(operation, 0).expect("the item starts");
    slot.bind_attempt(operation, 0, attempt, cancellation.request_handle());
    slot.release_attempt(operation, 0, attempt);
    match slot.request_stop(operation).expect("stoppable") {
        StopAccepted::Requested(handle) => assert!(
            handle.is_none(),
            "a settled attempt leaves no handle for a later stop to ask"
        ),
        StopAccepted::AlreadyRequested => panic!("the first request is not a repeat"),
    }
    assert!(!cancellation.request_handle().is_requested());
}

/// A stop that lands in the interval between an item being marked running and
/// its cancellation handle being bound still reaches that attempt.
///
/// The one window the worker cannot close by checking: `start_item` has already
/// returned, so the stop is not refused, and no handle exists yet, so
/// `request_stop` has nothing to ask. Left open, the queue would say it was
/// stopping while a conversion of unknown length ran to its own end. Asked
/// directly of the slot, because the interval is a lock ordering rather than
/// something a worker thread can be scheduled into on demand.
#[test]
fn a_stop_arriving_before_the_handle_is_bound_still_reaches_that_attempt() {
    let mut slot = ConversionSlot::default();
    let queue = ConversionQueue::new(
        0,
        ConversionConflictPolicyDto::Fail,
        vec![test_queue_item()],
    )
    .expect("one item is a queue");
    let _ = slot.begin(queue).expect("reservation");
    let operation = slot
        .claim(&reservation_handle(&slot), 0)
        .expect("claim the reservation");
    assert!(slot.start_running(operation, test_destination()));

    // The item is running, and the worker has not bound its handle yet.
    let attempt = slot.start_item(operation, 0).expect("the item starts");
    match slot.request_stop(operation).expect("stoppable") {
        StopAccepted::Requested(handle) => assert!(
            handle.is_none(),
            "there is no handle yet, which is the whole point of this window"
        ),
        StopAccepted::AlreadyRequested => panic!("the first request is not a repeat"),
    }

    // Binding carries the request the stop could not make.
    let cancellation = ConversionCancellation::new();
    slot.bind_attempt(operation, 0, attempt, cancellation.request_handle());
    assert!(
        cancellation.request_handle().is_requested(),
        "the attempt about to run has already been asked to stop"
    );
}

/// A session that lost track of a converter starts no probe, even for the
/// cheapest backend question there is.
///
/// A recheck runs the installed tools' help, so it is a process like any other.
/// Answered with the reading the session already had.
#[test]
fn a_quarantined_session_rechecks_without_launching_anything() {
    let (_fixture, _destination, service, update, _launches) =
        stop_mid_item(StopEnding::Unterminated);
    assert_eq!(
        terminal_reason(&update),
        ConversionQueueTerminalReasonDto::StopFailed
    );
    assert!(update.backend_quarantined);

    let before = service.inspect_backend();
    let after = service.inspect_backend();
    assert_eq!(
        before, after,
        "a quarantined session answers the same way twice"
    );
    // Not a stale "available". The banner renders this failure, so the one
    // thing the user must know is where they will look for it.
    assert_eq!(before.state, "unavailable");
    let failure = before
        .failure
        .clone()
        .expect("a quarantined session says why");
    assert_eq!(failure.kind, "backend_quarantined");
    assert_eq!(
        failure.corrective_action,
        "Restart MSCanvas before starting another preview or conversion."
    );
    assert_eq!(before.release, None, "no build is claimed by a refusal");
    // And pointing it somewhere else is refused rather than probed, so the
    // session never ends up describing an installation nothing has examined.
    let elsewhere = service.use_installation(Some(PathBuf::from("elsewhere")));
    assert_eq!(elsewhere, before);
    assert_eq!(
        elsewhere.installation_generation, before.installation_generation,
        "a refused change is not a change"
    );
}

/// A retry stopped partway through does not report the failures it had not got
/// to yet as never run.
///
/// A retry moves every retryable failure back to pending, so a stop landing in
/// the middle of one finds items that are pending now and did run in the pass
/// before. Calling those not run would delete a failure the user has already
/// seen, hide the reason for it, take it out of the failure count, and
/// contradict the attempt count sitting beside it.
#[test]
fn a_stopped_retry_keeps_the_failures_it_had_not_reached() {
    let mut slot = ConversionSlot::default();
    let queue = ConversionQueue::new(
        0,
        ConversionConflictPolicyDto::Fail,
        vec![test_queue_item(), test_queue_item_named(1, "two.raw")],
    )
    .expect("two items are a queue");
    let _ = slot.begin(queue).expect("reservation");
    let operation = slot
        .claim(&reservation_handle(&slot), 0)
        .expect("claim the reservation");
    assert!(slot.start_running(operation, test_destination()));

    // Both fail retryably, and the queue ends on its own.
    for index in 0..2 {
        let attempt = slot.start_item(operation, index).expect("the item starts");
        slot.bind_attempt(
            operation,
            index,
            attempt,
            ConversionCancellation::new().request_handle(),
        );
        assert!(slot.settle_item(
            operation,
            index,
            ItemOutcome::Refused {
                retryable: true,
                error: PreviewErrorDto::new("file_unreadable", "unreadable", true),
            },
        ));
        slot.release_attempt(operation, index, attempt);
    }
    slot.finish(operation, None, TerminalReason::Completed);

    // The user retries and stops it before either item is reached, which is
    // where both are pending again and one of them is a failure the earlier
    // pass already produced.
    let operation = slot.begin_retry().expect("a completed queue with failures");
    assert!(matches!(
        slot.request_stop(operation).expect("stoppable"),
        StopAccepted::Requested(_)
    ));
    slot.finish(operation, None, TerminalReason::Stopped);

    let update = slot.read(false, ConversionDiagnosticsStateDto::default());
    let WorkspaceConversionStateDto::Terminal { queue, .. } = &update.state else {
        panic!("the queue reaches a terminal state");
    };
    // Both ran, failed, and were never reached by the retry. They are still
    // those failures, not things that never happened.
    assert_eq!(
        item_states(queue),
        vec![
            ConversionQueueItemStateDto::Failed,
            ConversionQueueItemStateDto::Failed
        ]
    );
    assert_eq!(queue.not_run_count, 0);
    assert_eq!(queue.failed_count, 2);
    for item in &queue.items {
        assert!(item.attempts > 0, "an attempt count that agrees");
        assert!(
            item.error.is_some(),
            "the reason the user already saw is still there"
        );
    }
}

/// A queue stopped while it waited on the backend gate resolves no backend.
///
/// Resolving one runs the installed tools' help, which is two processes spent
/// proving which build a queue that will convert nothing was not going to use.
#[test]
fn a_queue_stopped_behind_the_gate_resolves_no_backend() {
    let fixture = TestFile::new("queue-stop-gate-first");
    let destination = destination_root(&fixture, "out");
    let (provider, observe_start, release_preview) =
        ConvertingProvider::faithful().parking_the_first_preview();
    let bindings = provider.bindings();
    let service = Arc::new(PreviewService::new(Box::new(provider)));
    let preview_source = service
        .add_dataset(&fixture.path)
        .expect("add the preview dataset");
    let handles: Vec<String> = ["one.raw", "two.raw"]
        .iter()
        .map(|name| add_one_acquisition(&service, &fixture.thermo_raw(name)))
        .collect();

    // A preview holds the one backend lane, which is what a queue waits behind.
    let opening = std::thread::spawn({
        let service = Arc::clone(&service);
        let handle = preview_source.handle.clone();
        move || service.open_preview(&handle)
    });
    observe_start
        .recv_timeout(Duration::from_secs(10))
        .expect("the preview reached the provider and holds the gate");

    let document = current_document(&service);
    let reservation = service
        .begin_conversion_queue(&handles, ConversionConflictPolicyDto::Fail, document)
        .expect("the queue is admitted");
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("claim it");
    let worker = {
        let service = Arc::clone(&service);
        let destination = destination.clone();
        std::thread::spawn(move || service.run_claimed_conversion(operation, &destination))
    };
    // Waited for rather than assumed: the worker marks the queue running and
    // then blocks on the gate, and the stop below is only the case under test
    // once it has.
    while !matches!(
        service.conversion_state().state,
        WorkspaceConversionStateDto::Running { .. }
    ) {
        std::thread::yield_now();
    }

    service
        .stop_conversion_queue(&operation.to_string(), document)
        .expect("the running queue of this document is stoppable");

    release_preview
        .send(())
        .expect("release the parked preview");
    let update = worker.join().expect("the queue worker finishes");
    opening.join().expect("the preview finishes").ok();
    assert_eq!(
        terminal_reason(&update),
        ConversionQueueTerminalReasonDto::Stopped
    );
    let WorkspaceConversionStateDto::Terminal { queue, .. } = &update.state else {
        panic!("the queue reaches a terminal state");
    };
    assert_eq!(
        item_states(queue),
        vec![
            ConversionQueueItemStateDto::NotRun,
            ConversionQueueItemStateDto::NotRun
        ],
        "nothing ran, so nothing is an attempt"
    );
    assert_eq!(
        bindings.load(Ordering::SeqCst),
        0,
        "no build was resolved for a queue that will convert nothing"
    );
    assert_eq!(
        entry_names(&destination),
        Vec::<String>::new(),
        "no output and no staging in the folder the user chose"
    );
}

/// A stop accepted while the worker was deciding is not overwritten by the
/// completion the worker was about to commit.
///
/// The worker reads the stop flag and then has to take the slot lock to commit
/// the terminal state. A stop landing in that interval moves the slot to
/// stopping and tells its caller the request was accepted -- so a completion
/// arriving afterwards would report a queue the user stopped as one that ran to
/// its own end, and offer a retry over it. Asked of the slot directly, because
/// the interval is a lock ordering rather than something a worker thread can be
/// scheduled into on demand.
#[test]
fn a_stop_accepted_while_a_queue_settles_is_not_overwritten_by_completion() {
    let mut slot = ConversionSlot::default();
    let queue = ConversionQueue::new(
        0,
        ConversionConflictPolicyDto::Fail,
        vec![test_queue_item()],
    )
    .expect("one item is a queue");
    let _ = slot.begin(queue).expect("reservation");
    let operation = slot
        .claim(&reservation_handle(&slot), 0)
        .expect("claim the reservation");
    assert!(slot.start_running(operation, test_destination()));

    // The worker has observed no stop and is about to commit a completion.
    assert!(!slot.stop_requested(operation));
    // The stop lands first, and its caller is told it was accepted.
    assert!(matches!(
        slot.request_stop(operation).expect("stoppable"),
        StopAccepted::Requested(_)
    ));
    slot.finish(operation, None, TerminalReason::Completed);

    let update = slot.read(false, ConversionDiagnosticsStateDto::default());
    assert_eq!(
        terminal_reason(&update),
        ConversionQueueTerminalReasonDto::Stopped,
        "a stop the user was told had been accepted is what the queue reports"
    );
    // And it is terminal in the way a stopped queue is: never rerun in place.
    assert!(slot.begin_retry().is_none());
}

/// No read ever reports a queue whose stop could not be confirmed beside a
/// session that still trusts the backend.
///
/// The two facts live behind different locks, and the worker sets the
/// quarantine before it moves the slot. A read that asked for the flag first
/// could carry the `stopFailed` sequence with `false` beside it -- and because a
/// document installs by sequence and stops polling at a terminal state, the true
/// answer arriving afterwards would be discarded and the session would go on
/// saying the backend was fine.
///
/// An interleaving probe rather than a proof: it reads continuously across the
/// whole stop and asserts the invariant on every observation, which is what the
/// ordering guarantees and what asking in the wrong order would eventually
/// violate.
#[test]
fn no_read_reports_an_unconfirmed_stop_beside_a_trusted_backend() {
    let fixture = TestFile::new("queue-stop-snapshot");
    let destination = destination_root(&fixture, "out");
    let (runner, started, release) = StopAwareRunner::parked(StopEnding::Unterminated);
    let service = Arc::new(PreviewService::new(Box::new(ConvertingProvider::new(
        evidenced_capabilities(),
        runner,
    ))));
    let handles: Vec<String> = ["one.raw", "two.raw"]
        .iter()
        .map(|name| add_one_acquisition(&service, &fixture.thermo_raw(name)))
        .collect();

    let document = current_document(&service);
    let reservation = service
        .begin_conversion_queue(&handles, ConversionConflictPolicyDto::Fail, document)
        .expect("the queue is admitted");
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("claim it");
    let worker = {
        let service = Arc::clone(&service);
        let destination = destination.clone();
        std::thread::spawn(move || service.run_claimed_conversion(operation, &destination))
    };
    started
        .recv_timeout(Duration::from_secs(10))
        .expect("the first item reaches its process");

    // Reads across the whole settling, exactly as a polling document does.
    let stop_reading = Arc::new(AtomicBool::new(false));
    let reader = {
        let service = Arc::clone(&service);
        let stop_reading = Arc::clone(&stop_reading);
        std::thread::spawn(move || {
            // Reads first and checks the flag afterwards, so this observes at
            // least once however the two threads are scheduled -- and the last
            // read always lands after the queue settled, which is the
            // observation the invariant is about.
            let mut settled_observations = 0_usize;
            loop {
                // Read before the read, break after it. A read already under way
                // when the flag is set describes the queue as it was *before*
                // the worker finished, so deciding to stop on the flag first is
                // what makes the last read land after the settling rather than
                // possibly across it.
                let last = stop_reading.load(Ordering::Relaxed);
                let update = service.conversion_state();
                if matches!(
                    update.state,
                    WorkspaceConversionStateDto::Terminal {
                        reason: ConversionQueueTerminalReasonDto::StopFailed,
                        ..
                    }
                ) {
                    assert!(
                        update.backend_quarantined,
                        "a stop that could not be confirmed is never reported beside a trusted backend"
                    );
                    settled_observations += 1;
                }
                if last {
                    break;
                }
            }
            settled_observations
        })
    };

    service
        .stop_conversion_queue(&operation.to_string(), document)
        .expect("the running queue of this document is stoppable");
    release.send(()).expect("release the parked conversion");
    let update = worker.join().expect("the queue worker finishes");
    assert_eq!(
        terminal_reason(&update),
        ConversionQueueTerminalReasonDto::StopFailed
    );
    stop_reading.store(true, Ordering::Relaxed);
    let settled_observations = reader.join().expect("the reader finishes");
    assert!(
        settled_observations > 0,
        "the reader saw the settled queue, which is what the invariant is about"
    );

    // And the settled answer carries both, which is what a reload recovers.
    let settled = service.conversion_state();
    assert!(settled.backend_quarantined);
}

/// A recheck already waiting on the backend gate does not probe once the queue
/// it was waiting behind ends by losing its converter.
///
/// The window the pre-gate check cannot cover: the caller passed it while the
/// session still trusted the backend, then waited for the length of a
/// conversion. Whichever of the two checks catches it, nothing is launched --
/// which is what this asserts, because the interval a thread is scheduled into
/// is not something a test can pin.
#[test]
fn a_recheck_waiting_on_the_gate_launches_nothing_after_a_lost_converter() {
    let fixture = TestFile::new("queue-stop-gate");
    let destination = destination_root(&fixture, "out");
    let (runner, started, release) = StopAwareRunner::parked(StopEnding::Unterminated);
    let provider = ConvertingProvider::new(evidenced_capabilities(), runner);
    let world = provider.inner.world.clone();
    let service = Arc::new(PreviewService::new(Box::new(provider)));
    let handles: Vec<String> = ["one.raw", "two.raw"]
        .iter()
        .map(|name| add_one_acquisition(&service, &fixture.thermo_raw(name)))
        .collect();

    let document = current_document(&service);
    let reservation = service
        .begin_conversion_queue(&handles, ConversionConflictPolicyDto::Fail, document)
        .expect("the queue is admitted");
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("claim it");
    let worker = {
        let service = Arc::clone(&service);
        let destination = destination.clone();
        std::thread::spawn(move || service.run_claimed_conversion(operation, &destination))
    };
    started
        .recv_timeout(Duration::from_secs(10))
        .expect("the first item reaches its process");

    // The worker holds the gate, so this recheck waits behind the whole
    // conversion. It is issued before the stop, so it passes the check in front
    // of the gate while the session still trusts the backend.
    let probes_before = world.availability_count();
    let recheck = {
        let service = Arc::clone(&service);
        std::thread::spawn(move || service.inspect_backend())
    };

    service
        .stop_conversion_queue(&operation.to_string(), document)
        .expect("the running queue of this document is stoppable");
    release.send(()).expect("release the parked conversion");
    let update = worker.join().expect("the queue worker finishes");
    assert_eq!(
        terminal_reason(&update),
        ConversionQueueTerminalReasonDto::StopFailed
    );

    let answered = recheck.join().expect("the recheck finishes");
    assert_eq!(
        world.availability_count(),
        probes_before,
        "no probe was spent beside a converter the session may have lost"
    );
    assert_eq!(answered.state, "unavailable");
    assert_eq!(
        answered
            .failure
            .expect("a quarantined session says why")
            .kind,
        "backend_quarantined"
    );
}

/// One queue item, for the slot tests that need a queue and not a filesystem.
fn test_queue_item() -> QueueItem {
    test_queue_item_named(0, "one.raw")
}

/// One queue item with a distinct identity, for the slot tests that need two.
fn test_queue_item_named(index: usize, file_name: &str) -> QueueItem {
    let handle = format!("file-{index}");
    QueueItem::new(
        DatasetId::parse(&handle).expect("a dataset handle"),
        0,
        DatasetSourceKind::ThermoRaw,
        SelectedFileDto {
            handle: handle.clone(),
            file_name: String::from(file_name),
            byte_length: 78_309,
            source_kind: DatasetSourceKindDto::ThermoRaw,
            relative_context: None,
        },
        super::operation::ItemOutputTopology::KnownSingle {
            basename: file_name.replace(".raw", ".mzML"),
        },
    )
}

/// A destination the slot can hold without one existing.
fn test_destination() -> AdmittedDestination {
    AdmittedDestination::new(PathBuf::from("destination"), None)
}

/// The reservation the slot currently holds, as the webview would return it.
fn reservation_handle(slot: &ConversionSlot) -> String {
    let update = slot.read(false, ConversionDiagnosticsStateDto::default());
    match update.state {
        WorkspaceConversionStateDto::AwaitingDestination { operation_id, .. } => {
            format!("conversion-reservation-{operation_id}")
        }
        other => panic!("the slot is awaiting a destination; got {other:?}"),
    }
}

/// A completed queue of `names`, run against a real destination, with the
/// service that ran it.
///
/// Everything goes through the production path -- picker admission, queue
/// admission, the destination command -- so what is adopted afterwards is what
/// a user would be adopting.
fn converted_queue(fixture: &TestFile, names: &[&str]) -> (Arc<PreviewService>, PathBuf, u64, u64) {
    let destination = destination_root(fixture, "out");
    let service = Arc::new(PreviewService::new(
        Box::new(ConvertingProvider::faithful()),
    ));
    let handles: Vec<String> = names
        .iter()
        .map(|name| {
            // The extension picks which fixture family to write, mirroring the
            // picker's own routing: this helper now drives mixed queues too.
            let path = if name.ends_with(".lcd") {
                fixture.shimadzu_lcd(name)
            } else {
                fixture.thermo_raw(name)
            };
            add_one_acquisition(&service, &path)
        })
        .collect();
    let document = current_document(&service);
    let reservation = service
        .begin_conversion_queue(&handles, ConversionConflictPolicyDto::Fail, document)
        .expect("the queue is admitted");
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("claim the reservation");
    let update = service.run_claimed_conversion(operation, &destination);
    assert_eq!(
        terminal_reason(&update),
        ConversionQueueTerminalReasonDto::Completed
    );
    (service, destination, operation, document)
}

fn adoption_kinds(result: &WorkspaceOutputAdoptionResultDto) -> Vec<&'static str> {
    result
        .outcomes
        .iter()
        .map(|outcome| match outcome {
            WorkspaceOutputAdoptionOutcomeDto::Added { .. } => "added",
            WorkspaceOutputAdoptionOutcomeDto::AlreadyInWorkspace { .. } => "already",
            WorkspaceOutputAdoptionOutcomeDto::Refused { .. } => "refused",
        })
        .collect()
}

/// Folder ingestion and the Explorer drop stay regular-mzML-only: the picker's
/// widened routing is deliberately not theirs.
///
/// The distinction ADR 0020 pins: `Add files\u2026` acts on files the user named
/// one by one, and the walking surfaces classify a broader filesystem surface.
/// Widening a walk is a wider claim than widening the picker, and it is not
/// made here -- no vendor-family recognition runs during traversal at all.
#[cfg(windows)]
#[test]
fn folder_and_drop_ingestion_remain_mzml_only_for_vendor_files() {
    let chosen = FolderTree::new("vendor-in-folder");
    chosen.file("kept.mzML", b"<mzML>inside</mzML>");
    chosen.file("acquisition.lcd", &shimadzu_lcd_bytes());
    chosen.file("acquisition.raw", &thermo_raw_bytes());
    // A complete SCIEX bundle, both halves, sitting in the walked folder. The
    // pairing a picker selection would do must not happen here: a traversal
    // that found a `.wiff` beside a `.wiff.scan` and admitted the two together
    // would be deciding they are one acquisition from adjacency alone.
    chosen.file("acquisition.wiff", &wiff_container_bytes(&SCIEX_MARKERS));
    chosen.file(
        "acquisition.wiff.scan",
        &scan_companion_bytes("opaque spectral payload"),
    );
    let service = PreviewService::new(Box::new(NoProcess));

    // A dropped folder discovers the mzML and never the acquisitions beside
    // it: they are not candidates, so they are not even rejections.
    let work = reserve_drop_work(&service, &[chosen.path().to_path_buf()]);
    let result = service
        .process_native_drop_with(work, expand_drop_paths)
        .expect("the drop completes");
    assert_eq!(roster_names(&service), vec!["kept.mzML"]);
    assert!(
        result.outcomes.iter().all(|outcome| !matches!(
            outcome,
            WorkspaceAddOutcomeDto::Rejected { candidate_name, .. }
                if candidate_name.ends_with(".lcd")
                    || candidate_name.ends_with(".raw")
                    || candidate_name.ends_with(".wiff")
                    || candidate_name.ends_with(".wiff.scan")
        )),
        "a walk neither admits nor names vendor files"
    );
    assert_eq!(
        service.dataset_count(),
        1,
        "no bundle was paired out of a folder's contents"
    );

    // A vendor file dropped directly is refused by name -- the drop admits
    // through mzML acceptance and never through the picker's routing. Both
    // halves of a bundle are refused, and by the same reason: the drop does not
    // know this family at all, which is the point.
    let direct = FolderTree::new("vendor-direct-drop");
    direct.file("direct.lcd", &shimadzu_lcd_bytes());
    direct.file("direct.wiff", &wiff_container_bytes(&SCIEX_MARKERS));
    direct.file(
        "direct.wiff.scan",
        &scan_companion_bytes("opaque spectral payload"),
    );
    for dropped in ["direct.lcd", "direct.wiff", "direct.wiff.scan"] {
        let work = reserve_drop_work(&service, &[direct.path().join(dropped)]);
        let result = service
            .process_native_drop_with(work, expand_drop_paths)
            .expect("the drop completes");
        assert!(
            matches!(
                result.outcomes.first(),
                Some(WorkspaceAddOutcomeDto::Rejected { error, .. })
                    if error.kind == "unsupported_extension"
            ),
            "a directly dropped {dropped} stays unsupported; got {:?}",
            result.outcomes.first()
        );
        assert_eq!(roster_names(&service), vec!["kept.mzML"]);
    }
}

/// No walking surface can reach the SCIEX admission at all.
///
/// The test above measures the behaviour; this one measures the *shape*, which
/// is what keeps the behaviour from being restored by a well-meaning edit. The
/// picker's routing function is the only caller of the bundle admission, and
/// neither walking surface calls the picker's routing.
#[test]
fn no_walking_surface_routes_a_candidate_through_sciex_admission() {
    for module in [
        include_str!("discovery.rs"),
        include_str!("drop_ingestion.rs"),
    ] {
        for forbidden in [
            "accept_sciex_wiff_bundle",
            "accept_workspace_file",
            "sciex_wiff_companion_path",
            "wiff",
        ] {
            assert!(
                !module.to_ascii_lowercase().contains(forbidden),
                "a walking surface names {forbidden}"
            );
        }
    }
}

/// Stop queue reaches a running Shimadzu item exactly as it reaches a Thermo
/// one, and later items of either family become notRun.
#[test]
fn a_stop_reaching_a_running_shimadzu_item_cancels_it_and_runs_no_other() {
    let fixture = TestFile::new("shimadzu-stop");
    let destination = destination_root(&fixture, "out");
    let (runner, started, release) = StopAwareRunner::parked(StopEnding::Confirmed);
    let launches = runner.launches();
    let service = Arc::new(PreviewService::new(Box::new(ConvertingProvider::new(
        evidenced_capabilities(),
        runner,
    ))));
    // Shimadzu first -- the running item a stop reaches -- then one of each
    // family behind it.
    let handles = vec![
        add_one_acquisition(&service, &fixture.shimadzu_lcd("one.lcd")),
        add_one_acquisition(&service, &fixture.thermo_raw("two.raw")),
        add_one_acquisition(&service, &fixture.shimadzu_lcd("three.lcd")),
    ];

    let document = current_document(&service);
    let reservation = service
        .begin_conversion_queue(&handles, ConversionConflictPolicyDto::Fail, document)
        .expect("the mixed queue is admitted");
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("claim it");
    let worker = {
        let service = Arc::clone(&service);
        let destination = destination.clone();
        std::thread::spawn(move || service.run_claimed_conversion(operation, &destination))
    };
    started
        .recv_timeout(Duration::from_secs(10))
        .expect("the Shimadzu item reaches its process");

    let stopped = service
        .stop_conversion_queue(&operation.to_string(), document)
        .expect("the running queue is stoppable");
    assert!(matches!(
        stopped.state,
        WorkspaceConversionStateDto::Stopping { .. }
    ));
    release.send(()).expect("release the parked conversion");
    let update = worker.join().expect("the queue worker finishes");

    assert_eq!(
        terminal_reason(&update),
        ConversionQueueTerminalReasonDto::Stopped
    );
    let queue = terminal_queue(&update);
    assert_eq!(
        item_states(queue),
        vec![
            ConversionQueueItemStateDto::Cancelled,
            ConversionQueueItemStateDto::NotRun,
            ConversionQueueItemStateDto::NotRun,
        ]
    );
    assert_eq!(
        queue.items[0].source_kind,
        DatasetSourceKindDto::ShimadzuLcd,
        "the cancelled item is the Shimadzu one"
    );
    let cancellation = queue.items[0]
        .cancellation
        .as_ref()
        .expect("a reached stop reports what it established");
    assert!(cancellation.termination_requested);
    assert!(cancellation.tree_termination_confirmed);
    // One process: the first item's. Nothing behind the stop launched.
    assert_eq!(launches.load(Ordering::SeqCst), 1);
    assert!(
        entry_names(&destination).is_empty(),
        "nothing was finalized"
    );
}

/// The visible vertical for the second vendor family: one focused Shimadzu row,
/// begin, claim, destination, convert, path-free report.
#[test]
fn one_focused_shimadzu_row_converts_through_the_product_path_and_reports_path_free() {
    let fixture = TestFile::new("visible-shimadzu");
    let acquisition = fixture.shimadzu_lcd("10nmol.lcd");
    let destination = destination_root(&fixture, "out");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let handle = add_one_acquisition(&service, &acquisition);
    let document = current_document(&service);

    // The plan the user reviews says which family the row is.
    let plan = service
        .conversion_plan_summary(&handle)
        .expect("a vendor row has a plan");
    assert_eq!(plan.items[0].source_kind, DatasetSourceKindDto::ShimadzuLcd);
    assert_eq!(plan_output_name(&plan.items[0]), "10nmol.mzML");
    assert_eq!(plan.validation_mode, ValidationModeDto::OutputOnly);

    let reservation = service
        .begin_conversion(&handle, ConversionConflictPolicyDto::Fail, document)
        .expect("a vendor row can be converted");
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("the exact reservation is claimed once");
    let update = service.run_claimed_conversion(operation, &destination);

    let rendered = serde_json::to_string(&update).expect("the update serializes");
    let Some(report) = sole_report(&update.state) else {
        panic!("the conversion reaches an outcome; got {:?}", update.state);
    };
    assert_eq!(report.outcome, "finalized");
    assert_eq!(report.source_kind, DatasetSourceKindDto::ShimadzuLcd);
    assert_eq!(report.output_file_name.as_deref(), Some("10nmol.mzML"));
    let validation = report
        .validation
        .as_ref()
        .expect("a finalized run was judged");
    assert_eq!(validation.mode, ValidationModeDto::OutputOnly);
    assert!(!validation.fully_verified);
    assert_eq!(entry_names(&destination), vec!["10nmol.mzML"]);
    for fragment in [
        fixture.directory.to_string_lossy().into_owned(),
        destination.to_string_lossy().into_owned(),
    ] {
        assert!(
            !rendered.contains(&fragment),
            "the update names {fragment:?}: {rendered}"
        );
    }
}

/// A mixed queue is one queue: visible order preserved, one serial lane, each
/// item under its own family, each with its own family in plan and report.
#[test]
fn a_mixed_family_queue_converts_serially_in_visible_order() {
    let fixture = TestFile::new("mixed-family-queue");
    let destination = destination_root(&fixture, "out");
    let provider = ConvertingProvider::faithful();
    let launches = provider.runner.launches();
    let service = PreviewService::new(Box::new(provider));
    // A deliberately interleaved order: Shimadzu first, Thermo second, Shimadzu
    // third, so neither family is "the queue's family".
    let handles = vec![
        add_one_acquisition(&service, &fixture.shimadzu_lcd("alpha.lcd")),
        add_one_acquisition(&service, &fixture.thermo_raw("beta.raw")),
        add_one_acquisition(&service, &fixture.shimadzu_lcd("gamma.lcd")),
    ];

    // The plan carries each row's family, in the caller's order.
    let plan = service
        .conversion_queue_plan(&handles)
        .expect("a mixed queue has a plan");
    let plan_kinds: Vec<DatasetSourceKindDto> =
        plan.items.iter().map(|item| item.source_kind).collect();
    assert_eq!(
        plan_kinds,
        vec![
            DatasetSourceKindDto::ShimadzuLcd,
            DatasetSourceKindDto::ThermoRaw,
            DatasetSourceKindDto::ShimadzuLcd,
        ]
    );

    let document = current_document(&service);
    let reservation = service
        .begin_conversion_queue(&handles, ConversionConflictPolicyDto::Fail, document)
        .expect("the mixed queue is admitted");
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("claim it");
    let update = service.run_claimed_conversion(operation, &destination);

    assert_eq!(
        terminal_reason(&update),
        ConversionQueueTerminalReasonDto::Completed
    );
    let queue = terminal_queue(&update);
    let kinds: Vec<DatasetSourceKindDto> =
        queue.items.iter().map(|item| item.source_kind).collect();
    assert_eq!(
        kinds, plan_kinds,
        "the queue ran the families the plan showed"
    );
    for item in &queue.items {
        assert_eq!(item.state, ConversionQueueItemStateDto::Finalized);
        let report = item_report(item).expect("a finalized item has a report");
        assert_eq!(report.source_kind, item.source_kind);
        let validation = report.validation.as_ref().expect("judged");
        assert_eq!(validation.mode, ValidationModeDto::OutputOnly);
        assert!(!validation.fully_verified);
    }
    // Three items, three processes, one lane: the runner is the lane, and it
    // was entered exactly once per item.
    assert_eq!(launches.load(Ordering::SeqCst), 3);
    let mut produced = entry_names(&destination);
    produced.sort();
    assert_eq!(produced, vec!["alpha.mzML", "beta.mzML", "gamma.mzML"]);
}

/// Two families, one output basename: the queue is invalid before a picker
/// could open, whatever the conflict policy would have said.
#[test]
fn a_cross_family_output_name_collision_refuses_the_queue_before_the_picker() {
    let fixture = TestFile::new("cross-family-collision");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let raw = add_one_acquisition(&service, &fixture.thermo_raw("sample.raw"));
    let lcd = add_one_acquisition(&service, &fixture.shimadzu_lcd("sample.lcd"));
    let handles = vec![raw, lcd];

    // The read-only plan already refuses it.
    assert_eq!(
        service
            .conversion_queue_plan(&handles)
            .expect_err("two planned items may not write one name")
            .kind,
        "queue_output_name_collision"
    );
    // And so does the reservation, for either policy: which file would win is
    // not a question Fail versus Skip may answer.
    let document = current_document(&service);
    for policy in [
        ConversionConflictPolicyDto::Fail,
        ConversionConflictPolicyDto::Skip,
    ] {
        assert_eq!(
            service
                .begin_conversion_queue(&handles, policy, document)
                .expect_err("the queue itself is invalid")
                .kind,
            "queue_output_name_collision"
        );
    }
    assert!(
        matches!(
            service.conversion_state().state,
            WorkspaceConversionStateDto::Idle
        ),
        "no reservation was taken for an invalid queue"
    );
}

/// A chromatogram-only Shimadzu result is a successful conversion through the
/// visible queue, with those exact facts on the report.
#[test]
fn a_chromatogram_only_shimadzu_result_completes_the_visible_queue() {
    let fixture = TestFile::new("visible-chromatograms");
    let acquisition = fixture.shimadzu_lcd("scheduled.lcd");
    let destination = destination_root(&fixture, "out");
    let service = PreviewService::new(Box::new(ConvertingProvider::new(
        evidenced_capabilities(),
        FakeConversionRunner::new(BackendAct::ConvertChromatogramsOnly),
    )));
    let handle = add_one_acquisition(&service, &acquisition);
    let document = current_document(&service);

    let reservation = service
        .begin_conversion(&handle, ConversionConflictPolicyDto::Fail, document)
        .expect("the row converts");
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("claim it");
    let update = service.run_claimed_conversion(operation, &destination);

    assert_eq!(
        terminal_reason(&update),
        ConversionQueueTerminalReasonDto::Completed
    );
    let report = sole_report(&update.state).expect("the item reports");
    assert_eq!(report.outcome, "finalized");
    let output = report.output.as_ref().expect("measured");
    assert_eq!(output.spectrum_count, 0);
    assert_eq!(output.chromatogram_count, 144);
}

/// A queue with an unevidenced build for any family in it is refused before
/// the destination picker opens -- and the refusal costs no reservation.
#[test]
fn an_unevidenced_build_refuses_a_queue_before_the_destination_picker() {
    let fixture = TestFile::new("preflight-evidence");
    let service = PreviewService::new(Box::new(ConvertingProvider::new(
        conversion_capabilities("3.0.26204", Some("a09eea9"), EVIDENCED_EXECUTABLE_SHA256),
        FakeConversionRunner::new(BackendAct::Convert),
    )));
    let document = current_document(&service);

    // A Shimadzu-only queue, a Thermo-only queue, and a mixed one: every
    // family present is asked, so every one of these is refused up front.
    let lcd = add_one_acquisition(&service, &fixture.shimadzu_lcd("one.lcd"));
    let raw = add_one_acquisition(&service, &fixture.thermo_raw("two.raw"));
    for handles in [
        vec![lcd.clone()],
        vec![raw.clone()],
        vec![lcd.clone(), raw.clone()],
    ] {
        assert_eq!(
            service
                .begin_conversion_queue(&handles, ConversionConflictPolicyDto::Fail, document)
                .expect_err("an unevidenced build is refused before the picker")
                .kind,
            "provider_build_not_evidenced"
        );
        assert!(
            matches!(
                service.conversion_state().state,
                WorkspaceConversionStateDto::Idle
            ),
            "no reservation was taken"
        );
    }
}

/// A row removed while the pre-picker preflight is resolving the backend is
/// refused before a reservation exists, because the queue is planned again
/// under the mutation gate from the workspace as it is then.
#[test]
fn a_row_removed_during_the_preflight_refuses_the_queue_before_a_reservation() {
    let fixture = TestFile::new("preflight-removal");
    let provider = ConvertingProvider::faithful();
    let hook = provider.on_conversion_backend();
    let service = Arc::new(PreviewService::new(Box::new(provider)));
    let handle = add_one_acquisition(&service, &fixture.shimadzu_lcd("one.lcd"));
    let document = current_document(&service);

    // Armed after admission: the next backend resolution -- which is exactly
    // the pre-picker preflight -- removes the row the queue was planned from.
    {
        let service = Arc::clone(&service);
        let handle = handle.clone();
        *hook.lock().expect("arm the hook") = Some(Box::new(move || {
            service
                .remove_datasets(std::slice::from_ref(&handle))
                .expect("the row is removable while the preflight runs");
        }));
    }

    assert_eq!(
        service
            .begin_conversion_queue(
                std::slice::from_ref(&handle),
                ConversionConflictPolicyDto::Fail,
                document,
            )
            .expect_err("a queue whose row is gone is refused before the picker")
            .kind,
        "unknown_file_handle"
    );
    assert!(
        matches!(
            service.conversion_state().state,
            WorkspaceConversionStateDto::Idle
        ),
        "no reservation was taken for a queue that could only end superseded"
    );
}

/// The distinct-family projection the evidence gate iterates: every family in
/// the queue, once, in first-appearance order.
///
/// This is the seam the "check only the first family" mistake would live in,
/// and it is tested directly because the evidence *outcomes* cannot show it
/// today: the one evidenced build carries a row for both families, so a gate
/// that asked about the wrong one would still be answered yes. The projection
/// itself is what has to be right.
#[test]
fn a_queue_reports_each_distinct_family_once_in_first_appearance_order() {
    let dto = |name: &str, kind: DatasetSourceKindDto| SelectedFileDto {
        handle: String::from("file-0"),
        file_name: name.to_owned(),
        byte_length: 1,
        source_kind: kind,
        relative_context: None,
    };
    let item = |index: u64, name: &str, kind: DatasetSourceKind, wire: DatasetSourceKindDto| {
        QueueItem::new(
            DatasetId::parse(&format!("file-{index}")).expect("a handle"),
            0,
            kind,
            dto(name, wire),
            super::operation::ItemOutputTopology::KnownSingle {
                basename: name.replace(".lcd", ".mzML").replace(".raw", ".mzML"),
            },
        )
    };
    let queue = ConversionQueue::new(
        0,
        ConversionConflictPolicyDto::Fail,
        vec![
            item(
                0,
                "one.lcd",
                DatasetSourceKind::ShimadzuLcd,
                DatasetSourceKindDto::ShimadzuLcd,
            ),
            item(
                1,
                "two.raw",
                DatasetSourceKind::ThermoRaw,
                DatasetSourceKindDto::ThermoRaw,
            ),
            item(
                2,
                "three.lcd",
                DatasetSourceKind::ShimadzuLcd,
                DatasetSourceKindDto::ShimadzuLcd,
            ),
        ],
    )
    .expect("a mixed queue is a queue");
    assert_eq!(
        queue.distinct_source_kinds(),
        vec![DatasetSourceKind::ShimadzuLcd, DatasetSourceKind::ThermoRaw],
        "each family once, in the order the queue first shows it"
    );
}

/// A Shimadzu failure is diagnosable, and the export names the family exactly.
#[test]
fn a_shimadzu_failure_is_diagnosable_and_names_its_family_exactly() {
    let fixture = TestFile::new("shimadzu-diagnostics");
    let acquisition = fixture.shimadzu_lcd("broken.lcd");
    let destination = destination_root(&fixture, "out");
    let service = PreviewService::new(Box::new(ConvertingProvider::new(
        evidenced_capabilities(),
        FakeConversionRunner::new(BackendAct::Fail),
    )));
    let handle = add_one_acquisition(&service, &acquisition);
    let document = current_document(&service);
    let reservation = service
        .begin_conversion(&handle, ConversionConflictPolicyDto::Fail, document)
        .expect("the row converts");
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("claim it");
    let update = service.run_claimed_conversion(operation, &destination);
    assert_eq!(
        terminal_reason(&update),
        ConversionQueueTerminalReasonDto::Completed
    );
    assert!(
        update.diagnostics.available,
        "a failed vendor conversion is diagnosable"
    );

    let reservation = service
        .begin_conversion_diagnostics_export(&operation.to_string(), document)
        .expect("the terminal queue is exportable");
    service
        .claim_conversion_diagnostics_export(&reservation.reservation_id, document)
        .expect("claim the export");
    let saved = fixture.directory.join("diagnostics.json");
    service
        .write_conversion_diagnostics(&reservation.reservation_id, &saved)
        .expect("the document is written");
    let exported = read_export(&saved);
    let item = &exported["items"][0];
    assert_eq!(
        item["sourceKind"], "shimadzu_lcd",
        "the export names the family exactly: {exported}"
    );
    assert_no_location(
        &saved,
        &[
            "shimadzu-diagnostics",
            &fixture.directory.to_string_lossy(),
            &destination.to_string_lossy(),
        ],
    );
}

/// The ordinary case: every finalized output enters the workspace as mzML, in
/// queue order.
#[test]
fn adopting_a_completed_queue_adds_its_outputs_in_queue_order() {
    let fixture = TestFile::new("adopt-completed");
    let (service, _destination, operation, document) =
        converted_queue(&fixture, &["one.raw", "two.raw"]);

    let before = service.roster().datasets.len();
    let result = service
        .adopt_conversion_outputs(&operation.to_string(), document)
        .expect("a terminal queue with finalized outputs is adoptable");

    assert_eq!(adoption_kinds(&result), vec!["added", "added"]);
    assert_eq!(result.roster.datasets.len(), before + 2);
    // The order is the queue's, not the registry's.
    let adopted: Vec<&str> = result
        .outcomes
        .iter()
        .filter_map(|outcome| match outcome {
            WorkspaceOutputAdoptionOutcomeDto::Added { dataset, .. } => {
                Some(dataset.file_name.as_str())
            }
            _ => None,
        })
        .collect();
    assert_eq!(adopted, vec!["one.mzML", "two.mzML"]);
    // Every adopted row is mzML, whatever it was converted from.
    for outcome in &result.outcomes {
        let WorkspaceOutputAdoptionOutcomeDto::Added { dataset, .. } = outcome else {
            panic!("every output was added");
        };
        assert_eq!(dataset.source_kind, DatasetSourceKindDto::Mzml);
    }
}

/// A Shimadzu conversion's output is ordinary mzML, adopted exactly as a
/// Thermo one is, with its converted origin naming the source row.
#[test]
fn adopting_a_shimadzu_output_yields_an_ordinary_mzml_row() {
    let fixture = TestFile::new("adopt-shimadzu");
    let (service, _destination, operation, document) =
        converted_queue(&fixture, &["acquisition.lcd"]);

    let result = service
        .adopt_conversion_outputs(&operation.to_string(), document)
        .expect("a finalized Shimadzu output is adoptable");

    assert_eq!(adoption_kinds(&result), vec!["added"]);
    let Some(WorkspaceOutputAdoptionOutcomeDto::Added { dataset, .. }) = result.outcomes.first()
    else {
        panic!("the output was added");
    };
    assert_eq!(dataset.file_name, "acquisition.mzML");
    assert_eq!(
        dataset.source_kind,
        DatasetSourceKindDto::Mzml,
        "an adopted output is mzML whatever it was converted from"
    );
    // The origin names the Shimadzu source row, exactly as it does for Thermo.
    let roster = service.roster();
    let source_row = roster
        .datasets
        .iter()
        .find(|row| row.file_name == "acquisition.lcd")
        .expect("the source row is still in the workspace");
    assert_eq!(source_row.source_kind, DatasetSourceKindDto::ShimadzuLcd);
}

/// An output the session already holds is reported as such, and consumes
/// nothing: no identifier, no row, and no change to the row it already had.
#[test]
fn adopting_an_output_the_workspace_already_holds_changes_nothing() {
    let fixture = TestFile::new("adopt-duplicate");
    let (service, destination, operation, document) = converted_queue(&fixture, &["one.raw"]);

    // Added by the ordinary route first, exactly as a user might.
    let existing = add_one_acquisition(&service, &destination.join("one.mzML"));
    let before = service.roster();

    let result = service
        .adopt_conversion_outputs(&operation.to_string(), document)
        .expect("the queue is still adoptable");

    assert_eq!(adoption_kinds(&result), vec!["already"]);
    let WorkspaceOutputAdoptionOutcomeDto::AlreadyInWorkspace { dataset, .. } = &result.outcomes[0]
    else {
        panic!("the output is already held");
    };
    // The existing row, returned as it stands -- not a second row, and not a
    // new identifier for the same object.
    assert_eq!(dataset.handle, existing);
    assert_eq!(result.roster.datasets.len(), before.datasets.len());
    assert_eq!(
        result
            .roster
            .datasets
            .iter()
            .map(|row| &row.handle)
            .collect::<Vec<_>>(),
        before
            .datasets
            .iter()
            .map(|row| &row.handle)
            .collect::<Vec<_>>()
    );
}

/// A different object at the final name is refused, however valid it looks.
#[test]
fn adopting_refuses_an_output_that_was_replaced() {
    let fixture = TestFile::new("adopt-replaced");
    let (service, destination, operation, document) = converted_queue(&fixture, &["one.raw"]);
    let output = destination.join("one.mzML");
    let original = fs::read(&output).expect("read the finalized output");

    // Moved aside and replaced by a byte-identical document, so only identity
    // can tell them apart.
    let aside = destination.join("moved-aside.mzML");
    fs::rename(&output, &aside).expect("move the output aside");
    fs::write(&output, &original).expect("write an impostor");

    let before = service.roster().datasets.len();
    let result = service
        .adopt_conversion_outputs(&operation.to_string(), document)
        .expect("the queue is still adoptable");

    assert_eq!(adoption_kinds(&result), vec!["refused"]);
    let WorkspaceOutputAdoptionOutcomeDto::Refused { reason, .. } = &result.outcomes[0] else {
        panic!("the output was replaced");
    };
    assert_eq!(reason, "output_changed");
    assert_eq!(service.roster().datasets.len(), before);
    // The impostor is left exactly as it was found.
    assert_eq!(fs::read(&output).expect("read the impostor"), original);
}

/// The same object with different bytes is refused. Reachable because the
/// retention permits writers, which is the posture this asserts alongside.
#[test]
fn adopting_refuses_an_output_that_was_rewritten_in_place() {
    let fixture = TestFile::new("adopt-rewritten");
    let (service, destination, operation, document) = converted_queue(&fixture, &["one.raw"]);
    let output = destination.join("one.mzML");

    let rewritten = fs::read_to_string(&output)
        .expect("read the finalized output")
        .replacen("scan=1", "scan=9", 1);
    fs::write(&output, &rewritten).expect("the retention permits the user to write their own file");

    let result = service
        .adopt_conversion_outputs(&operation.to_string(), document)
        .expect("the queue is still adoptable");

    assert_eq!(adoption_kinds(&result), vec!["refused"]);
    let WorkspaceOutputAdoptionOutcomeDto::Refused { reason, .. } = &result.outcomes[0] else {
        panic!("the output was rewritten");
    };
    assert_eq!(reason, "output_changed");
}

/// An output that is gone is refused, and does not stop the others.
#[test]
fn one_missing_output_does_not_stop_the_rest_being_adopted() {
    let fixture = TestFile::new("adopt-partial");
    let (service, destination, operation, document) =
        converted_queue(&fixture, &["one.raw", "two.raw"]);
    fs::remove_file(destination.join("one.mzML")).expect("the user removes their own output");

    let result = service
        .adopt_conversion_outputs(&operation.to_string(), document)
        .expect("the queue is still adoptable");

    assert_eq!(adoption_kinds(&result), vec!["refused", "added"]);
    let WorkspaceOutputAdoptionOutcomeDto::Refused { reason, .. } = &result.outcomes[0] else {
        panic!("the first output is gone");
    };
    assert_eq!(reason, "output_missing");
}

/// Only finalized items are adoptable. A queue that stopped before anything
/// finished has nothing to offer, and says so rather than answering with an
/// empty result.
#[test]
fn a_stopped_queue_that_finalized_nothing_is_not_adoptable() {
    let fixture = TestFile::new("adopt-stopped");
    let (_fixture, _destination, service, update, _launches) = stop_mid_item(StopEnding::Confirmed);
    drop(fixture);
    assert_eq!(
        terminal_reason(&update),
        ConversionQueueTerminalReasonDto::Stopped
    );
    let WorkspaceConversionStateDto::Terminal { operation_id, .. } = &update.state else {
        panic!("the queue is terminal");
    };
    let document = current_document(&service);

    assert_eq!(
        service
            .adopt_conversion_outputs(operation_id, document)
            .expect_err("a stopped queue that finalized nothing is not adoptable")
            .kind,
        "outputs_not_adoptable"
    );
}

/// Adoption names a queue, and only the current terminal one.
#[test]
fn adoption_refuses_a_stale_document_and_an_unknown_queue() {
    let fixture = TestFile::new("adopt-authority");
    let (service, _destination, operation, document) = converted_queue(&fixture, &["one.raw"]);

    assert_eq!(
        service
            .adopt_conversion_outputs(&(operation + 1).to_string(), document)
            .expect_err("a queue this session never ran is not adoptable")
            .kind,
        "outputs_not_adoptable"
    );
    assert_eq!(
        service
            .adopt_conversion_outputs("not-a-number", document)
            .expect_err("an identifier that was never issued is not adoptable")
            .kind,
        "outputs_not_adoptable"
    );
    // A document that has been replaced may not adopt its replacement's work.
    service.begin_webview_document();
    assert_eq!(
        service
            .adopt_conversion_outputs(&operation.to_string(), document)
            .expect_err("a replaced document is not the current one")
            .kind,
        "outputs_not_adoptable"
    );
}

/// Adopting does not touch the queue. Every item keeps the outcome it earned,
/// and the queue stays as retryable as it was.
#[test]
fn adopting_leaves_the_queue_result_exactly_as_it_was() {
    let fixture = TestFile::new("adopt-queue-untouched");
    let (service, _destination, operation, document) =
        converted_queue(&fixture, &["one.raw", "two.raw"]);
    let before = service.conversion_state();

    let _ = service
        .adopt_conversion_outputs(&operation.to_string(), document)
        .expect("the queue is adoptable");

    let after = service.conversion_state();
    let WorkspaceConversionStateDto::Terminal { queue: before, .. } = &before.state else {
        panic!("the queue is terminal");
    };
    let WorkspaceConversionStateDto::Terminal { queue: after, .. } = &after.state else {
        panic!("the queue is still terminal");
    };
    assert_eq!(item_states(before), item_states(after));
    assert_eq!(before.finalized_count, after.finalized_count);
    assert_eq!(before.retryable_failed_count, after.retryable_failed_count);
}

/// Replacing the queue drops what recognises its outputs, and leaves the files
/// exactly where they are.
#[test]
fn a_replaced_queue_releases_its_tickets_without_touching_the_files() {
    let fixture = TestFile::new("adopt-replaced-queue");
    let (service, destination, operation, document) = converted_queue(&fixture, &["one.raw"]);
    let output = destination.join("one.mzML");
    let before = fs::read(&output).expect("read the finalized output");

    // A second queue replaces the terminal one, tickets and all.
    let next = add_one_acquisition(&service, &fixture.thermo_raw("three.raw"));
    let _ = service
        .begin_conversion_queue(
            std::slice::from_ref(&next),
            ConversionConflictPolicyDto::Fail,
            document,
        )
        .expect("a terminal queue is replaced rather than refused");

    assert_eq!(
        service
            .adopt_conversion_outputs(&operation.to_string(), document)
            .expect_err("the queue that made those outputs is gone")
            .kind,
        "outputs_not_adoptable"
    );
    // Dropping a ticket closes a handle and nothing else.
    assert_eq!(
        fs::read(&output).expect("the output survives its queue"),
        before
    );
}

// --- Redacted conversion diagnostics ------------------------------------------

/// Exports a terminal queue's diagnostics to one chosen file, the way the
/// command does: reserve, claim, then write.
///
/// The native save dialog is the only part left out, exactly as the destination
/// picker is left out of `queue_and_run` above. Everything a refusal could come
/// from — the document proof, the queue proof, admission of the folder, the
/// size bound and the no-clobber write — is production code.
fn export_diagnostics(
    service: &PreviewService,
    operation: &str,
    destination: &Path,
) -> Result<ConversionDiagnosticsExportDto, PreviewErrorDto> {
    let document = current_document(service);
    let reservation = service.begin_conversion_diagnostics_export(operation, document)?;
    service.claim_conversion_diagnostics_export(&reservation.reservation_id, document)?;
    service.write_conversion_diagnostics(&reservation.reservation_id, destination)
}

/// The diagnostics document is named as what it holds, like every other export.
///
/// Not an export of science, and the rule is the same one: whatever opens this
/// file next reads its extension, and a JSON document called `.txt` misleads
/// exactly as a CSV called `.svg` does. The expected extension comes from
/// `DIAGNOSTICS_SAVE_DIALOG` -- the same facts the dialog was built from -- so
/// the filter a user saw and the name this boundary accepts cannot drift.
#[test]
fn a_diagnostics_export_is_refused_under_another_extension() {
    let fixture = TestFile::new("diagnostics-extension");
    let destination = destination_root(&fixture, "out");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let handle = add_one_acquisition(&service, &fixture.thermo_raw("one.raw"));
    // The planned output name is already taken, so the queue ends with
    // something to report and a diagnostics document exists to export.
    fs::write(destination.join("one.mzML"), b"taken").expect("occupy the output name");
    let update = queue_and_run(&service, &[handle], &destination);
    let operation = terminal_operation(&update);

    let wrong = destination.join("diagnostics.txt");
    let refusal = export_diagnostics(&service, &operation, &wrong)
        .expect_err("a name that says something else is refused");
    assert_eq!(refusal.kind, "diagnostics_destination_misnamed");
    assert_eq!(
        refusal.summary,
        "Choose a filename ending in .json for a JSON export.",
    );
    assert!(refusal.retryable, "another name is the way out of this");
    assert!(
        !wrong.exists(),
        "nothing was created under the name it refused",
    );

    // The right name is written, in either case, and the offer survived the
    // refusal -- so the slot was released rather than left holding a write.
    for name in ["diagnostics.json", "diagnostics-upper.JSON"] {
        let saved = destination.join(name);
        export_diagnostics(&service, &operation, &saved)
            .unwrap_or_else(|error| panic!("{name} names a JSON document: {error:?}"));
        assert!(saved.exists());
    }
}

/// The operation identifier of a terminal queue.
fn terminal_operation(update: &WorkspaceConversionUpdateDto) -> String {
    let WorkspaceConversionStateDto::Terminal { operation_id, .. } = &update.state else {
        panic!("the queue reaches a terminal state; got {:?}", update.state);
    };
    operation_id.clone()
}

/// The exported document, parsed.
fn read_export(path: &Path) -> serde_json::Value {
    let bytes = fs::read(path).expect("the diagnostics file is readable");
    assert_eq!(
        bytes.last().copied(),
        Some(b'\n'),
        "the document ends with a newline"
    );
    serde_json::from_slice(&bytes).expect("the diagnostics file is valid JSON")
}

/// Every string anywhere in the document, so a leak can be searched for without
/// knowing which field it would have reached.
fn all_strings(value: &serde_json::Value, into: &mut Vec<String>) {
    match value {
        serde_json::Value::String(text) => into.push(text.clone()),
        serde_json::Value::Array(items) => {
            for item in items {
                all_strings(item, into);
            }
        }
        serde_json::Value::Object(members) => {
            for (key, member) in members {
                into.push(key.clone());
                all_strings(member, into);
            }
        }
        _ => {}
    }
}

/// Refuses the whole document if any fragment of a location reached it.
///
/// Asked of the raw bytes as well as the parsed strings, because an escape
/// sequence is still a leak: `\\u0044:` is a drive letter to anything that
/// reads the file.
fn assert_no_location(path: &Path, fragments: &[&str]) {
    let raw = fs::read_to_string(path).expect("the diagnostics file is UTF-8");
    let document = read_export(path);
    let mut strings = Vec::new();
    all_strings(&document, &mut strings);
    for fragment in fragments {
        assert!(
            !raw.to_lowercase().contains(&fragment.to_lowercase()),
            "the export names {fragment}"
        );
    }
    for text in &strings {
        for line in scannable(text).lines() {
            assert!(
                mscanvas_proteowizard::absolute_path_start(line).is_none(),
                "an exported line looks like a path: {line}"
            );
        }
    }
}

/// The placeholders a diagnostics export can emit.
const PLACEHOLDERS: [&str; 5] = [
    "<source>",
    "<destination>",
    "<staging>",
    "<backend>",
    "<user-profile>",
];

/// One exported string with its redaction placeholders neutralised.
///
/// The same allowance the production shape test makes, restated here rather
/// than reused, so this helper agrees with the rule by argument instead of by
/// calling it: what follows a placeholder is the remainder of a path whose root
/// was already replaced, and a remainder begins with a separator. Replacing
/// each placeholder-and-separator with an ordinary word character is what makes
/// the rest of the line answerable without that exemption.
fn scannable(text: &str) -> String {
    let mut scanned = text.to_owned();
    for placeholder in PLACEHOLDERS {
        scanned = scanned
            .replace(&format!("{placeholder}\\"), "x")
            .replace(&format!("{placeholder}/"), "x");
    }
    scanned
}

/// A backend that fails and says a great deal about where everything is.
///
/// Every spelling this boundary claims to remove, plus bytes that are not
/// UTF-8, control characters, and more text than one excerpt may carry. It is
/// given the real planned command, so the staging directory and the executable
/// it names are the ones the boundary actually chose.
struct NoisyFailingRunner {
    source: PathBuf,
    destination: PathBuf,
    /// Whether to also print a location nothing handed this process.
    ///
    /// The two halves of the contract need different backends to show. With
    /// only known paths the excerpt survives with placeholders in it, which is
    /// what makes the feature useful; with one unknown path anywhere in it the
    /// whole excerpt is withheld, which is what makes it safe.
    unknown_share: bool,
}

impl NoisyFailingRunner {
    /// The spellings of one path a backend could print.
    ///
    /// Derived from the *canonical* form, because that is the one the
    /// conversion boundary registers and the one it hands the backend. A
    /// test that printed whatever spelling it happened to construct would be
    /// asserting the machine's temporary-directory naming rather than this
    /// boundary's redaction -- and on a profile with an 8.3 short name the two
    /// differ, which is a real limitation the suppression test covers instead.
    fn spellings(path: &Path) -> Vec<String> {
        let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        let plain = canonical
            .to_string_lossy()
            .trim_start_matches(r"\\?\")
            .to_owned();
        vec![
            plain.clone(),
            plain.replace('\\', "/"),
            plain.to_uppercase(),
            format!(r"\\?\{plain}"),
        ]
    }
}

impl ProcessRunner for NoisyFailingRunner {
    fn run(&self, spec: &CommandSpec) -> Result<ProcessOutput, ProcessError> {
        let staged = spec
            .output_destination()
            .expect("a conversion plan carries an output destination")
            .to_path_buf();
        let staging = staged
            .parent()
            .expect("the staged output has a directory")
            .to_path_buf();
        let mut stderr = Vec::new();
        let mut lines: Vec<String> = Self::spellings(&self.source)
            .into_iter()
            .map(|spelling| format!("error: could not read {spelling}"))
            .collect();
        lines.extend([
            format!(
                "error: destination {}",
                Self::spellings(&self.destination)
                    .first()
                    .cloned()
                    .unwrap_or_default()
            ),
            format!("error: staging {}", staging.display()),
            format!("error: staged output {}", staged.display()),
            format!("error: backend {}", spec.executable().display()),
            format!(
                "error: profile {}",
                std::env::var("USERPROFILE").unwrap_or_else(|_| String::from("C:\\Users\\nobody"))
            ),
            String::from("mz=101.007276 rt=1.0 intensity=1.25e+07"),
        ]);
        // A location nothing handed this process, printed only where the test
        // is about what happens to one.
        if self.unknown_share {
            lines.push(String::from(
                r"error: share \\reporting-server\lab-share\run.raw",
            ));
        }
        for line in lines {
            stderr.extend_from_slice(line.as_bytes());
            stderr.extend_from_slice(b"\r\n");
        }
        // Not UTF-8, and not printable either.
        stderr.extend_from_slice(b"trailer \xff\xfe\x00\x1b[2Jcleared\r\n");

        // More than one excerpt may carry, so the bound is exercised by a real
        // run rather than by a unit test alone.
        let mut stdout = Vec::new();
        while stdout.len() < 48 * 1024 {
            stdout.extend_from_slice(b"progress: reading spectra\r\n");
        }
        let stdout_total = stdout.len() as u64;
        let stderr_total = stderr.len() as u64;
        Ok(ProcessOutput {
            stdout,
            stderr,
            stdout_total_bytes: stdout_total,
            stderr_total_bytes: stderr_total,
            stdout_truncated: false,
            stderr_truncated: false,
            exit_code: Some(3),
            elapsed: Duration::from_millis(11),
            termination: Termination::Exited,
            max_active_processes: Some(1),
            final_active_processes: Some(0),
            peak_job_memory_bytes: Some(4_096),
        })
    }
}

/// Scenario B, first half: a backend that names every path this run knows, and
/// an export that keeps the text with placeholders where they were.
#[test]
fn every_spelling_of_a_known_path_is_replaced_and_the_rest_survives() {
    let fixture = TestFile::new("diagnostics-redaction");
    let destination = destination_root(&fixture, "out");
    let source = fixture.thermo_raw("secret-acquisition.raw");
    let service = PreviewService::new(Box::new(ConvertingProvider::new(
        evidenced_capabilities(),
        NoisyFailingRunner {
            source: source.clone(),
            destination: destination.clone(),
            unknown_share: false,
        },
    )));
    let handle = add_one_acquisition(&service, &source);

    let update = queue_and_run(&service, &[handle], &destination);
    let queue = terminal_queue(&update);
    assert_eq!(queue.failed_count, 1);
    assert_eq!(update.diagnostics.eligible_item_count, 1);

    let operation = terminal_operation(&update);
    let saved = destination.join("diagnostics.json");
    export_diagnostics(&service, &operation, &saved).expect("the export is written");

    let document = read_export(&saved);
    let item = &document["items"].as_array().expect("items")[0];
    let stderr = &item["stderr"];
    let stdout = &item["stdout"];

    // The truthful facts about the streams, whichever way they went.
    assert_eq!(stderr["lossy"], true, "invalid UTF-8 is reported as lossy");
    assert!(stderr["totalBytes"].as_u64().expect("a total") > 0);
    assert_eq!(stderr["captureTruncated"], false);
    assert_eq!(
        stdout["excerptTruncated"], true,
        "more was printed than one excerpt may carry"
    );
    assert_eq!(stdout["retained"], "prefix");

    // Every path this run knows was replaced, so the text survives. Printed on
    // failure, because "withheld" alone does not say which spelling escaped and
    // this is the assertion a machine with different path semantics trips.
    assert_eq!(
        stderr["retained"], "prefix",
        "stderr was withheld: {stderr}"
    );
    assert_eq!(stderr["suppressed"], serde_json::Value::Null);
    let text = stderr["text"].as_str().expect("exported text");
    for placeholder in ["<source>", "<destination>", "<staging>", "<backend>"] {
        assert!(
            text.contains(placeholder),
            "{placeholder} is missing: {text}"
        );
    }
    assert!(
        text.contains("mz=101.007276 rt=1.0 intensity=1.25e+07"),
        "ordinary backend text survives redaction: {text}"
    );
    assert!(!text.contains('\u{0}'), "NUL is removed: {text}");
    assert!(
        !text.contains('\u{1b}'),
        "escape sequences are removed: {text}"
    );
    assert!(
        stderr["redactionCount"].as_u64().expect("a count") >= 8,
        "every spelling was replaced, not merely the canonical one"
    );
    assert_eq!(document["redaction"]["suppressedExcerptCount"], 0);
    // Printed, because the whole claim of this feature is what the text looks
    // like afterwards, and a green assertion does not show that to a reader.
    println!("exported stderr: {stderr}");
    println!("exported redaction: {}", document["redaction"]);

    assert_no_location(
        &saved,
        &[
            "diagnostics-redaction",
            "reporting-server",
            "lab-share",
            "msconvert",
            "mscanvas-staging",
        ],
    );
    // The acquisition's own name is a bounded display fact and is allowed:
    // twice as the schema's own `sourceFileName` and `outputFileName`, and once
    // more as the remainder of a staging path whose root was replaced. That
    // third one carries nothing the first two do not -- the staged name is
    // derived from the source name, and both are already exported -- which is
    // the whole reason a remainder after a placeholder is kept rather than
    // suppressed. What must never appear is a directory, and nothing else in
    // this document does.
    let raw = fs::read_to_string(&saved).expect("the diagnostics file is UTF-8");
    assert_eq!(
        raw.matches("secret-acquisition").count(),
        3,
        "the display name appears only where a display name may"
    );
    assert_eq!(item["sourceFileName"], "secret-acquisition.raw");
    assert_eq!(item["outputFileName"], "secret-acquisition.mzML");

    // And nothing of the stream reaches the transfer object either.
    let wire = serde_json::to_string(&service.conversion_state()).expect("the state serializes");
    assert!(!wire.contains("could not read"), "{wire}");
    assert!(!wire.contains("progress: reading spectra"), "{wire}");

    fs::remove_file(&saved).expect("remove the exported diagnostics");
}

/// Scenario B, second half: one location nothing handed this process, and the
/// whole excerpt is withheld rather than exported around it.
///
/// Fail-closed, and closed on the excerpt rather than on the line. A backend
/// that names somewhere MSCanvas never registered is a backend this boundary
/// cannot promise anything about, and the honest answer is to say so and keep
/// quiet.
#[test]
fn one_unknown_absolute_path_withholds_the_whole_excerpt() {
    let fixture = TestFile::new("diagnostics-suppression");
    let destination = destination_root(&fixture, "out");
    let source = fixture.thermo_raw("secret-acquisition.raw");
    let service = PreviewService::new(Box::new(ConvertingProvider::new(
        evidenced_capabilities(),
        NoisyFailingRunner {
            source: source.clone(),
            destination: destination.clone(),
            unknown_share: true,
        },
    )));
    let handle = add_one_acquisition(&service, &source);

    let update = queue_and_run(&service, &[handle], &destination);
    let operation = terminal_operation(&update);
    let saved = destination.join("diagnostics.json");
    export_diagnostics(&service, &operation, &saved).expect("the export is written");

    let document = read_export(&saved);
    let stderr = &document["items"].as_array().expect("items")[0]["stderr"];

    assert_eq!(stderr["retained"], "withheld");
    assert_eq!(stderr["text"], serde_json::Value::Null);
    assert_eq!(stderr["suppressed"], "residual_absolute_path");
    // Withholding the text does not withhold the facts about it. A reader has
    // to be able to tell "the backend said nothing" from "the backend said
    // something this refused to repeat".
    assert!(stderr["totalBytes"].as_u64().expect("a total") > 0);
    assert!(stderr["redactionCount"].as_u64().expect("a count") > 0);
    assert_eq!(stderr["lossy"], true);
    assert_eq!(document["redaction"]["suppressedExcerptCount"], 1);

    assert_no_location(&saved, &["reporting-server", "lab-share"]);
    println!("withheld stderr: {stderr}");
    fs::remove_file(&saved).expect("remove the exported diagnostics");
}

/// Scenario C: the chosen name is taken, and the file that is there is exactly
/// the file that stays there.
#[test]
fn an_occupied_diagnostics_name_is_refused_and_leaves_no_residue() {
    let fixture = TestFile::new("diagnostics-clobber");
    let destination = destination_root(&fixture, "out");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let handle = add_one_acquisition(&service, &fixture.thermo_raw("one.raw"));
    let occupied = destination.join("one.mzML");
    fs::write(&occupied, b"taken").expect("occupy the planned output name");
    let update = queue_and_run(&service, &[handle], &destination);
    let operation = terminal_operation(&update);

    let saved = destination.join("diagnostics.json");
    let before = b"an earlier export nobody meant to lose".to_vec();
    fs::write(&saved, &before).expect("pre-create the diagnostics name");

    let refusal =
        export_diagnostics(&service, &operation, &saved).expect_err("an occupied name is refused");

    assert_eq!(refusal.kind, "diagnostics_destination_exists");
    assert_eq!(
        refusal.detail, None,
        "nothing was left behind, so nothing is reported as left behind"
    );
    assert_eq!(
        fs::read(&saved).expect("the existing file is readable"),
        before,
        "the file that was there is byte for byte the file that is there"
    );
    let mut produced = entry_names(&destination);
    produced.sort();
    assert_eq!(
        produced,
        vec!["diagnostics.json", "one.mzML"],
        "no temporary object survives a refused export"
    );

    // And the export is still on offer, because nothing about the queue changed.
    let after = service.conversion_state();
    assert!(after.diagnostics.available);
    assert!(!after.diagnostics.exporting);
    assert_eq!(after.diagnostics.last_export, None);
}

/// A write that failed and a write that failed *and* left something in the
/// user's folder are different things to be told.
///
/// The primary reason stays the reason; the residue rides beside it. Folding the
/// second into the first would drop the only part of the failure the user has to
/// act on, which is that there is now a file MSCanvas cannot remove.
#[test]
fn a_leftover_temporary_is_reported_beside_the_failure_rather_than_instead_of_it() {
    for (clean, residual) in [
        (
            super::dto::diagnostics_destination_exists(false),
            super::dto::diagnostics_destination_exists(true),
        ),
        (
            super::dto::diagnostics_not_written(false),
            super::dto::diagnostics_not_written(true),
        ),
        (
            super::dto::diagnostics_not_finalized(false),
            super::dto::diagnostics_not_finalized(true),
        ),
    ] {
        // The same primary reason either way, so a reader keys off one thing.
        assert_eq!(clean.kind, residual.kind);
        assert_eq!(clean.summary, residual.summary);
        // And the residue is said, once, in words, and never as a path.
        assert_eq!(clean.detail, None, "{}", clean.kind);
        let detail = residual
            .detail
            .as_deref()
            .unwrap_or_else(|| panic!("{} says what it left behind", residual.kind));
        assert!(detail.contains(".mscanvas-export-"), "{detail}");
        assert!(
            mscanvas_proteowizard::absolute_path_start(detail).is_none(),
            "{detail}"
        );
    }
}

/// Scenario D: a queue whose stop could not be confirmed exports, and does so
/// while the session has stopped trusting the backend.
#[test]
fn a_stop_failed_queue_exports_while_the_backend_is_quarantined() {
    let (fixture, destination, service, update, launches) = stop_mid_item(StopEnding::Survivors);
    let queue = terminal_queue(&update);
    assert_eq!(queue.cancellation_failed_count, 1);
    assert!(update.backend_quarantined, "the session is quarantined");
    assert!(
        update.diagnostics.available,
        "a stop that could not be confirmed is the case this exists for"
    );

    let operation = terminal_operation(&update);
    let saved = destination.join("diagnostics.json");
    let before = launches.load(Ordering::SeqCst);
    let result = export_diagnostics(&service, &operation, &saved).expect("the export is written");

    assert_eq!(
        launches.load(Ordering::SeqCst),
        before,
        "an export launches no process"
    );
    assert!(
        service.conversion_state().backend_quarantined,
        "and does not clear the quarantine"
    );
    assert!(result.diagnostic_item_count >= 1);

    let document = read_export(&saved);
    assert_eq!(document["queue"]["terminalReason"], "stop_failed");
    let items = document["items"].as_array().expect("items");
    let unconfirmed = items
        .iter()
        .find(|item| item["state"] == "cancellation_failed")
        .expect("the item whose stop could not be confirmed");
    assert_eq!(
        unconfirmed["cancellation"]["treeTerminationConfirmed"],
        false
    );
    assert_eq!(unconfirmed["cancellation"]["terminationRequested"], true);

    assert_no_location(&saved, &[fixture.directory.to_string_lossy().as_ref()]);
    fs::remove_file(&saved).expect("remove the exported diagnostics");
}

/// A queue that simply worked has nothing to diagnose and offers nothing.
#[test]
fn a_clean_queue_exposes_no_export_at_all() {
    let fixture = TestFile::new("diagnostics-clean");
    let destination = destination_root(&fixture, "out");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let handle = add_one_acquisition(&service, &fixture.thermo_raw("clean.raw"));

    let update = queue_and_run(&service, &[handle], &destination);
    assert_eq!(terminal_queue(&update).finalized_count, 1);
    assert_eq!(update.diagnostics.eligible_item_count, 0);
    assert!(!update.diagnostics.available);

    let refusal = export_diagnostics(
        &service,
        &terminal_operation(&update),
        &destination.join("diagnostics.json"),
    )
    .expect_err("there is nothing to export");
    assert_eq!(refusal.kind, "diagnostics_unavailable");
    assert_eq!(entry_names(&destination), vec!["clean.mzML"]);
}

/// Only the latest attempt. A rerun that worked takes the failure's diagnostic
/// with it, and an export afterwards describes the queue as it now is.
#[test]
fn a_successful_retry_removes_the_diagnostic_it_replaced() {
    let fixture = TestFile::new("diagnostics-retry");
    let destination = destination_root(&fixture, "out");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let done = add_one_acquisition(&service, &fixture.thermo_raw("done.raw"));
    let held = fixture.thermo_raw("held.raw");
    let blocked = add_one_acquisition(&service, &held);

    let writer = hold_for_writing(&held);
    let update = queue_and_run(&service, &[done, blocked], &destination);
    assert_eq!(terminal_queue(&update).retryable_failed_count, 1);
    assert_eq!(update.diagnostics.eligible_item_count, 1);
    assert!(update.diagnostics.available);

    drop(writer);
    let retried = service
        .retry_conversion_queue(current_document(&service))
        .expect("a retryable failure can be retried");

    assert_eq!(terminal_queue(&retried).failed_count, 0);
    assert_eq!(
        retried.diagnostics.eligible_item_count, 0,
        "the attempt that failed is not the latest attempt any more"
    );
    assert!(!retried.diagnostics.available);
    let refusal = export_diagnostics(
        &service,
        &terminal_operation(&retried),
        &destination.join("diagnostics.json"),
    )
    .expect_err("a queue whose failures were all fixed has nothing to export");
    assert_eq!(refusal.kind, "diagnostics_unavailable");
}

/// Every way of asking for an export that is not about the current terminal
/// queue of the current document, answered the same way and answered without
/// creating anything.
#[test]
fn an_export_answers_only_for_the_current_document_and_queue() {
    let fixture = TestFile::new("diagnostics-authority");
    let destination = destination_root(&fixture, "out");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let handle = add_one_acquisition(&service, &fixture.thermo_raw("one.raw"));
    fs::write(destination.join("one.mzML"), b"taken").expect("occupy the planned name");
    let update = queue_and_run(&service, &[handle], &destination);
    let operation = terminal_operation(&update);
    let document = current_document(&service);

    // A document that has been replaced.
    assert_eq!(
        service
            .begin_conversion_diagnostics_export(&operation, document.wrapping_add(1))
            .expect_err("a replaced document may not export")
            .kind,
        "diagnostics_unavailable"
    );
    // An operation that is not the one the slot holds, and one that is not a
    // number at all.
    for named in [
        format!("{}", operation.parse::<u64>().unwrap() + 1),
        String::from("not-a-queue"),
    ] {
        assert_eq!(
            service
                .begin_conversion_diagnostics_export(&named, document)
                .expect_err("only the current terminal queue is exportable")
                .kind,
            "diagnostics_unavailable"
        );
    }
    // A reservation nobody issued, and one issued to a document that is gone.
    assert_eq!(
        service
            .claim_conversion_diagnostics_export("diagnostics-reservation-99", document)
            .expect_err("an unknown reservation is refused")
            .kind,
        "invalid_diagnostics_reservation"
    );
    let reservation = service
        .begin_conversion_diagnostics_export(&operation, document)
        .expect("the current queue is exportable");
    assert_eq!(
        service
            .claim_conversion_diagnostics_export(
                &reservation.reservation_id,
                document.wrapping_add(1)
            )
            .expect_err("a reservation belongs to the document that asked")
            .kind,
        "invalid_diagnostics_reservation"
    );
    // A second export while that one is still awaiting a destination.
    assert_eq!(
        service
            .begin_conversion_diagnostics_export(&operation, document)
            .expect_err("one export at a time")
            .kind,
        "diagnostics_export_in_progress"
    );
    // And a write for a claim that was never made.
    assert_eq!(
        service
            .write_conversion_diagnostics(
                "diagnostics-reservation-99",
                &destination.join("diagnostics.json")
            )
            .expect_err("an unclaimed reservation writes nothing")
            .kind,
        "invalid_diagnostics_reservation"
    );

    // Cancelling the dialog is an ordinary no-op that returns the offer. Named
    // by the queue and settling the dialog was opened for, so a cancel from a
    // window a reload left behind cannot close somebody else's.
    let after = service.cancel_conversion_diagnostics_export(&reservation.reservation_id);
    assert!(!after.diagnostics.exporting);
    assert!(after.diagnostics.available);
    assert_eq!(after.diagnostics.last_export, None);
    assert_eq!(
        entry_names(&destination),
        vec!["one.mzML"],
        "nothing was created by any of that"
    );
}

/// A folder this boundary's guarantees do not hold in is refused before
/// anything is created, and the refusal names nothing.
#[test]
fn an_unusable_diagnostics_folder_is_refused_without_naming_it() {
    let fixture = TestFile::new("diagnostics-folder");
    let destination = destination_root(&fixture, "out");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let handle = add_one_acquisition(&service, &fixture.thermo_raw("one.raw"));
    fs::write(destination.join("one.mzML"), b"taken").expect("occupy the planned name");
    let update = queue_and_run(&service, &[handle], &destination);
    let operation = terminal_operation(&update);

    for chosen in [
        // A network name, whichever way it is spelled. Neither the no-clobber
        // rename nor the identity-bound cleanup this write depends on is a
        // guarantee across a redirector.
        PathBuf::from(r"\\reporting-server\lab-share\diagnostics.json"),
        PathBuf::from(r"\\?\UNC\reporting-server\lab-share\diagnostics.json"),
        // A folder with nothing behind it.
        fixture.directory.join("absent").join("diagnostics.json"),
        // A file where a folder should be.
        destination.join("one.mzML").join("diagnostics.json"),
    ] {
        let refusal = export_diagnostics(&service, &operation, &chosen)
            .expect_err("only a local folder is written into");
        assert_eq!(
            refusal.kind, "diagnostics_destination_unusable",
            "{chosen:?}"
        );
        let rendered = serde_json::to_string(&refusal).expect("the refusal serializes");
        assert!(!rendered.contains("reporting-server"), "{rendered}");
        assert!(!rendered.contains("lab-share"), "{rendered}");
    }
    assert_eq!(entry_names(&destination), vec!["one.mzML"]);
}

/// Two exports of one queue, and a second copy is an ordinary thing to want.
#[test]
fn an_export_may_be_repeated_under_another_name() {
    let fixture = TestFile::new("diagnostics-repeat");
    let destination = destination_root(&fixture, "out");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let handle = add_one_acquisition(&service, &fixture.thermo_raw("one.raw"));
    fs::write(destination.join("one.mzML"), b"taken").expect("occupy the planned name");
    let update = queue_and_run(&service, &[handle], &destination);
    let operation = terminal_operation(&update);

    let first = export_diagnostics(&service, &operation, &destination.join("first.json"))
        .expect("the first export is written");
    let second = export_diagnostics(&service, &operation, &destination.join("second.json"))
        .expect("and so is the second");

    assert_eq!(first.sha256, second.sha256, "field order is deterministic");
    assert_eq!(first.byte_length, second.byte_length);
    assert_eq!(
        fs::read(destination.join("first.json")).expect("readable"),
        fs::read(destination.join("second.json")).expect("readable"),
        "two exports of one unchanged queue are byte for byte the same document"
    );
    // The slot remembers the last one, and only the last one.
    let after = service.conversion_state();
    assert_eq!(
        after
            .diagnostics
            .last_export
            .as_ref()
            .map(|export| export.file_name.clone()),
        Some(String::from("second.json"))
    );
    assert!(
        after.diagnostics.available,
        "the action stays on offer after a successful export"
    );

    // A new queue drops this session's memory of having exported, and does not
    // touch either file.
    let other = add_one_acquisition(&service, &fixture.thermo_raw("other.raw"));
    let _ = queue_and_run(&service, &[other], &destination);
    let replaced = service.conversion_state();
    assert_eq!(replaced.diagnostics.last_export, None);
    assert!(destination.join("first.json").exists());
    assert!(destination.join("second.json").exists());
}

/// The digest is of the bytes that were written, so somebody about to send the
/// file on can check that the two agree.
#[test]
fn the_reported_digest_and_length_describe_the_file_that_was_written() {
    let fixture = TestFile::new("diagnostics-digest");
    let destination = destination_root(&fixture, "out");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let handle = add_one_acquisition(&service, &fixture.thermo_raw("one.raw"));
    fs::write(destination.join("one.mzML"), b"taken").expect("occupy the planned name");
    let update = queue_and_run(&service, &[handle], &destination);
    let saved = destination.join("diagnostics.json");

    let result = export_diagnostics(&service, &terminal_operation(&update), &saved)
        .expect("the export is written");

    let bytes = fs::read(&saved).expect("the file is readable");
    assert_eq!(result.byte_length, bytes.len() as u64);
    assert_eq!(
        result.sha256,
        Sha256Digest::calculate(&bytes)
            .expect("the digest is calculable")
            .to_string()
    );
    // And the result says nothing about where it went.
    let rendered = serde_json::to_string(&result).expect("the result serializes");
    assert!(!rendered.contains("diagnostics-digest"), "{rendered}");
    assert!(!rendered.contains(":\\\\"), "{rendered}");
    // Exactly these members and no others. A location could only reach the
    // webview through a member nobody meant to add, so the set is asserted
    // rather than the absence of any one name.
    let mut members = serde_json::from_str::<serde_json::Value>(&rendered)
        .expect("an object")
        .as_object()
        .expect("an object")
        .keys()
        .cloned()
        .collect::<Vec<_>>();
    members.sort();
    assert_eq!(
        members,
        vec![
            "byteLength",
            "diagnosticItemCount",
            "fileName",
            "operationId",
            "retryRound",
            "sha256"
        ]
    );
}

/// A ticket exists for exactly the attempts worth diagnosing, is replaced whole
/// when a later attempt settles, and is dropped with the queue that made it.
#[test]
fn a_diagnostic_is_kept_only_for_the_latest_attempt_worth_diagnosing() {
    let mut slot = ConversionSlot::default();
    let queue = ConversionQueue::new(
        0,
        ConversionConflictPolicyDto::Fail,
        vec![test_queue_item(), test_queue_item_named(1, "two.raw")],
    )
    .expect("two items are a queue");
    let _ = slot.begin(queue).expect("reservation");
    let operation = slot
        .claim(&reservation_handle(&slot), 0)
        .expect("claim the reservation");
    assert!(slot.start_running(operation, test_destination()));

    // One ordinary refusal, and one stop whose tree was confirmed gone with
    // nothing left behind.
    let first = slot.start_item(operation, 0).expect("the item starts");
    assert!(slot.settle_item(
        operation,
        0,
        ItemOutcome::Refused {
            retryable: true,
            error: PreviewErrorDto::new("file_unreadable", "unreadable", true),
        },
    ));
    slot.release_attempt(operation, 0, first);
    let second = slot.start_item(operation, 1).expect("the item starts");
    assert!(slot.settle_item(
        operation,
        1,
        ItemOutcome::Stopped {
            set: None,
            state: ItemState::Cancelled,
            facts: CancellationFacts {
                process_launched: true,
                tree_termination_confirmed: true,
                elapsed: Duration::from_millis(5),
                termination: None,
                partial_output_observed: false,
                staging_residue: None,
            },
            diagnostics: None,
        },
    ));
    slot.release_attempt(operation, 1, second);
    slot.finish(operation, None, TerminalReason::Completed);

    let (facts, _provider, round, tickets) = slot
        .terminal_diagnostics(operation)
        .expect("a terminal queue with a failure");
    assert_eq!(
        tickets.len(),
        1,
        "a confirmed cancellation is not a failure"
    );
    assert_eq!(round, 0);
    assert_eq!(facts.failed_count, 1);
    assert_eq!(facts.cancelled_count, 1);
    // A ticket never renders what it holds.
    let rendered = format!("{:?}", tickets[0]);
    assert!(
        rendered.contains("<opaque-diagnostic-ticket>"),
        "{rendered}"
    );
    assert!(!rendered.contains("one.raw"), "{rendered}");
    assert_eq!(
        slot.read(false, ConversionDiagnosticsStateDto::default())
            .diagnostics
            .eligible_item_count,
        1
    );

    // A retry moves the failure back to pending. While it is pending the ticket
    // is not the current answer about that item, and the slot is not terminal
    // either -- so nothing is exportable.
    let operation = slot
        .begin_retry()
        .expect("a completed queue with a failure");
    assert!(slot.terminal_diagnostics(operation).is_none());

    // The rerun settles as an unconfirmed stop, which replaces the ticket whole.
    let attempt = slot.start_item(operation, 0).expect("the item starts");
    assert!(slot.settle_item(
        operation,
        0,
        ItemOutcome::Stopped {
            set: None,
            state: ItemState::CancellationFailed,
            facts: CancellationFacts {
                process_launched: true,
                tree_termination_confirmed: false,
                elapsed: Duration::from_millis(7),
                termination: None,
                partial_output_observed: true,
                staging_residue: None,
            },
            diagnostics: None,
        },
    ));
    slot.release_attempt(operation, 0, attempt);
    slot.finish(operation, None, TerminalReason::StopFailed);

    let (facts, _provider, round, tickets) = slot
        .terminal_diagnostics(operation)
        .expect("a stop-failed queue is exportable");
    assert_eq!(facts.terminal_reason, "stop_failed");
    assert_eq!(round, 1, "the settling is named as well as the queue");
    assert_eq!(tickets.len(), 1);
    assert_eq!(tickets[0].describes(), ItemState::CancellationFailed);

    // And a new queue drops every one of them.
    let replacement = ConversionQueue::new(
        0,
        ConversionConflictPolicyDto::Fail,
        vec![test_queue_item()],
    )
    .expect("one item is a queue");
    let _ = slot.begin(replacement).expect("reservation");
    assert!(slot.terminal_diagnostics(operation).is_none());
    assert_eq!(
        slot.read(false, ConversionDiagnosticsStateDto::default())
            .diagnostics
            .eligible_item_count,
        0
    );
}

/// A backend that fails after printing a great deal of text that needs
/// escaping, so a full queue of them exceeds the export bound.
///
/// Quotation marks rather than backslashes: both double in length when escaped,
/// and only one of them looks like the start of a path.
struct VerboseFailingRunner;

impl ProcessRunner for VerboseFailingRunner {
    fn run(&self, _spec: &CommandSpec) -> Result<ProcessOutput, ProcessError> {
        let noise = vec![b'"'; mscanvas_proteowizard::MAX_DIAGNOSTIC_STREAM_EXCERPT_BYTES];
        let total = noise.len() as u64;
        Ok(ProcessOutput {
            stdout: noise.clone(),
            stderr: noise,
            stdout_total_bytes: total,
            stderr_total_bytes: total,
            stdout_truncated: false,
            stderr_truncated: false,
            exit_code: Some(2),
            elapsed: Duration::from_millis(1),
            termination: Termination::Exited,
            max_active_processes: Some(1),
            final_active_processes: Some(0),
            peak_job_memory_bytes: Some(1_024),
        })
    }
}

/// A document larger than one diagnostics file may be is refused, and refused
/// before anything is created.
///
/// Fails closed rather than truncating. Half a JSON document is not a smaller
/// diagnostics file; it is one no reader can open, offered in exchange for
/// hiding the fact that the bound was reached.
#[test]
fn a_diagnostics_document_over_the_bound_is_refused_and_writes_nothing() {
    let fixture = TestFile::new("diagnostics-bound");
    let destination = destination_root(&fixture, "out");
    let service = PreviewService::new(Box::new(ConvertingProvider::new(
        evidenced_capabilities(),
        VerboseFailingRunner,
    )));
    let handles: Vec<String> = (0..MAX_CONVERSION_QUEUE_ITEMS)
        .map(|index| {
            add_one_acquisition(&service, &fixture.thermo_raw(&format!("item-{index}.raw")))
        })
        .collect();

    let update = queue_and_run(&service, &handles, &destination);
    let queue = terminal_queue(&update);
    assert_eq!(queue.failed_count, MAX_CONVERSION_QUEUE_ITEMS);
    assert_eq!(
        update.diagnostics.eligible_item_count, MAX_CONVERSION_QUEUE_ITEMS,
        "the queue's own capacity is what bounds the item count"
    );

    let saved = destination.join("diagnostics.json");
    let refusal = export_diagnostics(&service, &terminal_operation(&update), &saved)
        .expect_err("a document over the bound is refused");

    assert_eq!(refusal.kind, "diagnostics_too_large");
    assert!(!refusal.retryable, "the same queue would be as large again");
    assert!(
        !saved.exists(),
        "nothing partial is written under the chosen name"
    );
    assert_eq!(
        entry_names(&destination),
        Vec::<String>::new(),
        "and no temporary object is left behind either"
    );

    // The queue is untouched and the offer stands, so a user who narrows the
    // problem by rerunning fewer items can still export.
    let after = service.conversion_state();
    assert!(after.diagnostics.available);
    assert!(!after.diagnostics.exporting);
}

/// While an export is choosing a destination, everything that would replace the
/// result it is about is refused, and everything that only reads it is not.
#[test]
fn an_export_in_flight_closes_the_actions_that_would_replace_its_queue() {
    let fixture = TestFile::new("diagnostics-exclusion");
    let destination = destination_root(&fixture, "out");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let done = add_one_acquisition(&service, &fixture.thermo_raw("done.raw"));
    let held = fixture.thermo_raw("held.raw");
    let blocked = add_one_acquisition(&service, &held);
    let spare = add_one_acquisition(&service, &fixture.thermo_raw("spare.raw"));

    let writer = hold_for_writing(&held);
    let update = queue_and_run(&service, &[done, blocked], &destination);
    drop(writer);
    let operation = terminal_operation(&update);
    let document = current_document(&service);
    assert_eq!(terminal_queue(&update).retryable_failed_count, 1);

    // The reservation is issued and the dialog is notionally open. Rust holds
    // the claim for the whole of that window, which is what these refusals are.
    let reservation = service
        .begin_conversion_diagnostics_export(&operation, document)
        .expect("the terminal queue is exportable");
    assert!(service.conversion_state().diagnostics.exporting);

    assert_eq!(
        service
            .retry_conversion_queue(document)
            .expect_err("a retry would replace the results being described")
            .kind,
        "conversion_busy"
    );
    assert_eq!(
        service
            .adopt_conversion_outputs(&operation, document)
            .expect_err("an adoption owns the same terminal queue")
            .kind,
        "adoption_in_progress"
    );
    assert_eq!(
        service
            .begin_conversion_queue(
                std::slice::from_ref(&spare),
                ConversionConflictPolicyDto::Fail,
                document
            )
            .expect_err("a new queue would replace the one being described")
            .kind,
        "conversion_busy"
    );
    assert_eq!(
        service
            .add_files(&[fixture.thermo_raw("late.raw")])
            .expect_err("a workspace mutation waits")
            .kind,
        "conversion_busy"
    );
    assert_eq!(
        service
            .remove_datasets(std::slice::from_ref(&spare))
            .expect_err("removing waits too")
            .kind,
        "conversion_busy"
    );
    assert_eq!(
        service.clear_workspace().expect_err("and clearing").kind,
        "conversion_busy"
    );

    // Reads are untouched. Nothing here launches anything or changes anything.
    assert_eq!(service.roster().datasets.len(), 3);
    assert!(service.conversion_state().diagnostics.exporting);

    // Claim, write, and everything comes back.
    service
        .claim_conversion_diagnostics_export(&reservation.reservation_id, document)
        .expect("claim the reservation");
    let saved = destination.join("diagnostics.json");
    service
        .write_conversion_diagnostics(&reservation.reservation_id, &saved)
        .expect("the export is written");

    let after = service.conversion_state();
    assert!(!after.diagnostics.exporting);
    assert!(after.diagnostics.last_export.is_some());
    service
        .retry_conversion_queue(document)
        .expect("the retry is available again once the export is over");
    fs::remove_file(&saved).expect("remove the exported diagnostics");
}

/// A reservation belongs to the document that asked for it, so a reload
/// releases one nobody can claim and leaves the offer standing.
#[test]
fn a_reload_releases_an_unclaimed_export_and_keeps_the_offer() {
    let fixture = TestFile::new("diagnostics-reload");
    let destination = destination_root(&fixture, "out");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let handle = add_one_acquisition(&service, &fixture.thermo_raw("one.raw"));
    fs::write(destination.join("one.mzML"), b"taken").expect("occupy the planned name");
    let update = queue_and_run(&service, &[handle], &destination);
    let operation = terminal_operation(&update);

    let reservation = service
        .begin_conversion_diagnostics_export(&operation, current_document(&service))
        .expect("the terminal queue is exportable");
    assert!(service.conversion_state().diagnostics.exporting);

    // The document is replaced. The replacement never learns the identifier, so
    // without releasing it the slot would stay busy for the rest of the session.
    service.begin_webview_document();

    let recovered = service.conversion_state();
    assert!(!recovered.diagnostics.exporting);
    assert!(
        recovered.diagnostics.available,
        "the replacement document is offered the same export"
    );
    assert_eq!(
        service
            .claim_conversion_diagnostics_export(
                &reservation.reservation_id,
                current_document(&service)
            )
            .expect_err("a released reservation cannot be claimed by anyone")
            .kind,
        "invalid_diagnostics_reservation"
    );

    // And the replacement can export for itself.
    let saved = destination.join("diagnostics.json");
    export_diagnostics(&service, &operation, &saved).expect("the replacement document exports");
    assert!(
        service.conversion_state().diagnostics.last_export.is_some(),
        "the result is recoverable by a read rather than only by a reply"
    );
    fs::remove_file(&saved).expect("remove the exported diagnostics");
}

/// A diagnostics transition is an observable transition.
///
/// The diagnostics state rides on the conversion read, and a document
/// installs a read only when its ordering key has moved. A transition that
/// left the key alone would be one no document ever applies: the export
/// would appear to run for ever, and every action it closes would stay
/// closed until a reload.
#[test]
fn every_diagnostics_transition_moves_the_ordering_key() {
    let fixture = TestFile::new("diagnostics-sequence");
    let destination = destination_root(&fixture, "out");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let handle = add_one_acquisition(&service, &fixture.thermo_raw("one.raw"));
    fs::write(destination.join("one.mzML"), b"taken").expect("occupy the planned name");
    let update = queue_and_run(&service, &[handle], &destination);
    let operation = terminal_operation(&update);
    let document = current_document(&service);

    let settled = service.conversion_state().sequence;

    let reservation = service
        .begin_conversion_diagnostics_export(&operation, document)
        .expect("the terminal queue is exportable");
    let reserved = service.conversion_state();
    assert!(
        reserved.sequence > settled,
        "asking for an export is something a reader can see"
    );
    assert!(reserved.diagnostics.exporting);

    service
        .claim_conversion_diagnostics_export(&reservation.reservation_id, document)
        .expect("claim the reservation");
    let saved = destination.join("diagnostics.json");
    service
        .write_conversion_diagnostics(&reservation.reservation_id, &saved)
        .expect("the export is written");

    let written = service.conversion_state();
    assert!(
        written.sequence > reserved.sequence,
        "and so is finishing one"
    );
    assert!(!written.diagnostics.exporting);
    assert!(written.diagnostics.last_export.is_some());

    // A cancelled dialog moves it too, because it is what returns the offer.
    let second = service
        .begin_conversion_diagnostics_export(&operation, document)
        .expect("a second export may be asked for");
    let asked = service.conversion_state().sequence;
    let cancelled = service.cancel_conversion_diagnostics_export(&second.reservation_id);
    assert!(cancelled.sequence > asked, "so is closing the dialog");
    assert!(!cancelled.diagnostics.exporting);

    fs::remove_file(&saved).expect("remove the exported diagnostics");
}

/// A result belongs to one settling of one queue.
///
/// A retry produces different attempts under the same operation, so an
/// export taken before it describes something that is no longer the latest
/// answer about anything. Showing its name, size and digest beside the new
/// round would attach a file to results it was not made from.
#[test]
fn a_retry_drops_the_export_that_described_the_settling_before_it() {
    let fixture = TestFile::new("diagnostics-retry-result");
    let destination = destination_root(&fixture, "out");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let done = add_one_acquisition(&service, &fixture.thermo_raw("done.raw"));
    let held = fixture.thermo_raw("held.raw");
    let blocked = add_one_acquisition(&service, &held);

    let writer = hold_for_writing(&held);
    let update = queue_and_run(&service, &[done, blocked], &destination);
    let operation = terminal_operation(&update);
    let saved = destination.join("diagnostics.json");
    export_diagnostics(&service, &operation, &saved).expect("the export is written");
    assert!(service.conversion_state().diagnostics.last_export.is_some());

    drop(writer);
    service
        .retry_conversion_queue(current_document(&service))
        .expect("a retryable failure can be retried");

    let after = service.conversion_state();
    assert_eq!(
        after.diagnostics.last_export, None,
        "the file described attempts this rerun replaced"
    );
    // And the file itself is untouched. Dropping the memory of an export is
    // not undoing one.
    assert!(saved.exists(), "the exported file is the user's");
    fs::remove_file(&saved).expect("remove the exported diagnostics");
}

/// A reload drops a save dialog's answer rather than letting it write.
///
/// The same rule a conversion destination reservation follows, and the same
/// reason: the document that would receive the answer is gone. What this
/// pins is the consequence -- the choice is dropped, nothing is written, and
/// the replacement document is offered the export again rather than
/// inheriting a half-finished one.
#[test]
fn a_reload_drops_the_answer_of_a_dialog_it_replaced() {
    let fixture = TestFile::new("diagnostics-reload-claimed");
    let destination = destination_root(&fixture, "out");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let handle = add_one_acquisition(&service, &fixture.thermo_raw("one.raw"));
    fs::write(destination.join("one.mzML"), b"taken").expect("occupy the planned name");
    let update = queue_and_run(&service, &[handle], &destination);
    let operation = terminal_operation(&update);
    let document = current_document(&service);

    // Reserved and claimed: the dialog is open.
    let reservation = service
        .begin_conversion_diagnostics_export(&operation, document)
        .expect("the terminal queue is exportable");
    service
        .claim_conversion_diagnostics_export(&reservation.reservation_id, document)
        .expect("claim the reservation");

    service.begin_webview_document();

    // The user chooses a file in a dialog nobody is waiting for.
    let saved = destination.join("diagnostics.json");
    let refusal = service
        .write_conversion_diagnostics(&reservation.reservation_id, &saved)
        .expect_err("a released reservation writes nothing");
    assert_eq!(refusal.kind, "invalid_diagnostics_reservation");
    assert!(!saved.exists(), "and no file exists under the chosen name");
    assert_eq!(
        entry_names(&destination),
        vec!["one.mzML"],
        "nor any temporary object beside it"
    );

    // The replacement document is offered the same export, and can take it.
    let recovered = service.conversion_state();
    assert!(recovered.diagnostics.available);
    assert!(!recovered.diagnostics.exporting);
    assert_eq!(recovered.diagnostics.last_export, None);
    export_diagnostics(&service, &operation, &saved).expect("the replacement exports");
    fs::remove_file(&saved).expect("remove the exported diagnostics");
}

/// A finished export does not take the next one's reservation with it.
///
/// A successful write returns the slot to idle before the guard that owned it
/// falls, and another export may reserve inside that interval. A guard that
/// released whatever it found would clear a reservation belonging to somebody
/// else, and the file that user was about to choose would be refused.
#[test]
fn a_finished_export_leaves_the_next_reservation_alone() {
    let fixture = TestFile::new("diagnostics-guard");
    let destination = destination_root(&fixture, "out");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let handle = add_one_acquisition(&service, &fixture.thermo_raw("one.raw"));
    fs::write(destination.join("one.mzML"), b"taken").expect("occupy the planned name");
    let update = queue_and_run(&service, &[handle], &destination);
    let operation = terminal_operation(&update);
    let document = current_document(&service);

    let first = service
        .begin_conversion_diagnostics_export(&operation, document)
        .expect("the terminal queue is exportable");
    service
        .claim_conversion_diagnostics_export(&first.reservation_id, document)
        .expect("claim the reservation");
    let saved = destination.join("first.json");

    // Reserved inside the interval the first export's guard falls in, which is
    // a window inside one function and unreachable from outside it.
    let second = std::cell::RefCell::new(None);
    service
        .write_conversion_diagnostics_seamed(&first.reservation_id, &saved, || {
            *second.borrow_mut() = Some(
                service
                    .begin_conversion_diagnostics_export(&operation, document)
                    .expect("a second export may be asked for"),
            );
        })
        .expect("the export is written");
    let second = second.into_inner().expect("the seam ran");
    assert!(service.conversion_state().diagnostics.exporting);

    // The second reservation is still the slot's, and still claimable.
    service
        .claim_conversion_diagnostics_export(&second.reservation_id, document)
        .expect("the second reservation survives the first export's guard");
    let again = destination.join("second.json");
    service
        .write_conversion_diagnostics(&second.reservation_id, &again)
        .expect("and writes the file it chose");

    assert!(saved.exists());
    assert!(again.exists());
    fs::remove_file(&saved).expect("remove the first export");
    fs::remove_file(&again).expect("remove the second export");
}

/// A dialog a reload left behind cannot close the next document's export.
///
/// A save dialog outlives the document that opened it. The reload releases the
/// reservation while the window is still up, the replacement begins an export
/// of its own, and only then does the old window close and report that it did.
/// An unnamed cancel would take the replacement's reservation with it, and the
/// file that user was in the middle of choosing would be refused.
#[test]
fn a_cancel_from_a_replaced_document_cannot_close_the_next_export() {
    let fixture = TestFile::new("diagnostics-cancel-race");
    let destination = destination_root(&fixture, "out");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let handle = add_one_acquisition(&service, &fixture.thermo_raw("one.raw"));
    fs::write(destination.join("one.mzML"), b"taken").expect("occupy the planned name");
    let update = queue_and_run(&service, &[handle], &destination);
    let operation = terminal_operation(&update);
    // The first document opens a dialog, then goes away.
    let first = service
        .begin_conversion_diagnostics_export(&operation, current_document(&service))
        .expect("the terminal queue is exportable");
    service
        .claim_conversion_diagnostics_export(&first.reservation_id, current_document(&service))
        .expect("claim the reservation");
    service.begin_webview_document();

    // The replacement asks for its own, and gets as far as an open dialog.
    let second = service
        .begin_conversion_diagnostics_export(&operation, current_document(&service))
        .expect("the replacement may export");
    service
        .claim_conversion_diagnostics_export(&second.reservation_id, current_document(&service))
        .expect("claim the replacement's reservation");

    // The abandoned window answers first, with a file of its own. It must not
    // consume the replacement's reservation, and above all must not write to
    // somewhere that user never chose.
    let elsewhere = destination.join("abandoned.json");
    assert_eq!(
        service
            .write_conversion_diagnostics(&first.reservation_id, &elsewhere)
            .expect_err("a released reservation writes nothing")
            .kind,
        "invalid_diagnostics_reservation"
    );
    assert!(!elsewhere.exists());

    // And then it closes and says so.
    service.cancel_conversion_diagnostics_export(&first.reservation_id);

    assert!(
        service.conversion_state().diagnostics.exporting,
        "the replacement's dialog is still open"
    );
    let saved = destination.join("diagnostics.json");
    service
        .write_conversion_diagnostics(&second.reservation_id, &saved)
        .expect("and the file it chose is still written");
    fs::remove_file(&saved).expect("remove the exported diagnostics");
}

/// Provider metadata is backend text, and is treated as backend text.
///
/// A release line is read out of the installed tool's own help output, so a
/// build that printed a path in it would put one into a file that promises
/// none. Asserted on the projection rather than through a run, because no
/// fake backend in this repository can be made to report a path as its
/// version and the rule should not depend on one that could.
#[test]
fn a_provider_label_that_names_a_path_is_scrubbed_before_it_is_written() {
    let identity = InstallationIdentity::for_test(
        Path::new(r"C:\Program Files\ProteoWizard\msconvert.exe"),
        Path::new(r"C:\Program Files\ProteoWizard\msaccess.exe"),
        r"3.0.0 built from C:\Users\alice\private-build",
    );

    let facts = identity.diagnostic_facts();

    let release = facts.release.as_deref().expect("a release label");
    assert!(
        mscanvas_proteowizard::absolute_path_start(release).is_none(),
        "{release}"
    );
    assert!(!release.contains("alice"), "{release}");
    assert!(release.starts_with("3.0.0 built from "), "{release}");
    // The path is gone and the version it was printed beside is not.
    assert!(release.contains("<path>"), "{release}");
}

// ---------------------------------------------------------------------------
// A workspace dataset that is a bundle, converting to a set. ADR 0023.
// ---------------------------------------------------------------------------

/// The entries a SCIEX acquisition carries, spelled out for the same reason the
/// LabSolutions ones are: a test that read its expectation from the constant it
/// checks would pass because that constant had been changed to match a mistake.
const SCIEX_MARKERS: [&str; 4] = [
    "SampleSubtree",
    "MethodSubtree",
    "SampleTable",
    "MassSpecMethod",
];

/// A compound file under the geometry a real `.wiff` declares.
///
/// Version 4 with 4096-byte sectors, because five entries do not fit in the
/// 512-byte directory sector the LabSolutions fixture uses -- and because that
/// is what all three lawful fixtures declare.
fn wiff_container_bytes(entries: &[&str]) -> Vec<u8> {
    const SECTOR: usize = 4096;
    let mut bytes = vec![0_u8; SECTOR * 2];
    bytes[..8].copy_from_slice(&COMPOUND_FILE_MAGIC);
    bytes[26..28].copy_from_slice(&4_u16.to_le_bytes());
    bytes[28..30].copy_from_slice(&[0xFE, 0xFF]);
    bytes[30..32].copy_from_slice(&12_u16.to_le_bytes());
    bytes[48..52].copy_from_slice(&0_u32.to_le_bytes());

    let named = std::iter::once("Root Entry").chain(entries.iter().copied());
    for (index, name) in named.enumerate() {
        let at = SECTOR + index * 128;
        let units: Vec<u16> = name.encode_utf16().collect();
        for (unit, slot) in units.iter().zip(bytes[at..].chunks_exact_mut(2)) {
            slot.copy_from_slice(&unit.to_le_bytes());
        }
        let declared = u16::try_from(units.len() * 2 + 2).expect("a short entry name");
        bytes[at + 64..at + 66].copy_from_slice(&declared.to_le_bytes());
        bytes[at + 66] = if index == 0 { 5 } else { 2 };
    }
    bytes
}

/// The 32 bytes every measured `.wiff.scan` begins with, then opaque payload.
///
/// Spelled out rather than imported, like every other signature here.
fn scan_companion_bytes(payload: &str) -> Vec<u8> {
    let mut bytes = vec![
        0x82, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x11, 0x11, 0x11, 0x11, 0x82, 0x05, 0x00, 0x00, 0x01, 0x00,
        0x00, 0x00,
    ];
    bytes.extend_from_slice(payload.as_bytes());
    bytes
}

impl TestFile {
    /// A whole SCIEX acquisition: the container and the companion beside it.
    ///
    /// Returns the primary, which is the only member anything is ever handed.
    fn sciex_bundle(&self, stem: &str) -> PathBuf {
        self.sciex_bundle_with_companion(stem, "opaque spectral payload")
    }

    /// The same, with the companion's content chosen by the caller, so a test
    /// can rewrite exactly one member.
    fn sciex_bundle_with_companion(&self, stem: &str, payload: &str) -> PathBuf {
        let primary = self.named_bytes(
            &format!("{stem}.wiff"),
            &wiff_container_bytes(&SCIEX_MARKERS),
        );
        self.named_bytes(&format!("{stem}.wiff.scan"), &scan_companion_bytes(payload));
        primary
    }

    /// The companion of a bundle this fixture wrote.
    fn companion_of(&self, stem: &str) -> PathBuf {
        self.directory.join(format!("{stem}.wiff.scan"))
    }
}

/// A substituted backend for a run whose outputs the backend names itself.
///
/// Different from [`FakeConversionRunner`] in the two ways that matter. It
/// writes into the command's `--outdir` rather than to one planned destination,
/// because a set command carries no destination -- the boundary measured that
/// the backend names its own outputs. And it announces each document on stdout
/// in the exact line shape the evidenced build prints, because the multi-output
/// lifecycle compares the staged set against what the backend said it wrote. A
/// stand-in that wrote files without announcing them would not be standing in
/// for the measured backend; it would be standing in for an injector.
struct FakeOutputSetRunner {
    /// The basenames this backend writes and declares.
    declared: Vec<String>,
    /// Whether a command with no `--outdir` -- a single-output plan -- should be
    /// converted rather than refused, so one stand-in can serve a mixed queue.
    converts_single_outputs: bool,
    /// How many of this runner's processes were alive at once, ever.
    ///
    /// One is the whole serial-queue claim. Counting it here rather than
    /// inferring it from timing is what makes the claim a measurement.
    live: Arc<AtomicUsize>,
    concurrent: Arc<AtomicUsize>,
    /// Announced when a run begins, then parked until released. For the stop
    /// tests, which have to get a request in while a process is "running".
    started: Mutex<Option<mpsc::Sender<()>>>,
    release: Mutex<Option<mpsc::Receiver<()>>>,
    /// Which call parks. One unless a test aims at a later item.
    park_on_call: usize,
    /// What a cancelled run reports, when a test asks for one.
    stop_ending: Option<StopEnding>,
    /// A source member to try to open for writing while the process is
    /// "running", so a test can ask whether the boundary really pinned it.
    probe: Option<PathBuf>,
    /// Whether that attempt was refused. `None` until the run happens.
    probe_refused: Arc<Mutex<Option<bool>>>,
    /// Basenames it writes without declaring: the injection ADR 0021 named.
    undeclared: Vec<String>,
    /// What this stand-in writes to its error stream.
    stderr: String,
    /// Whether that stream is reported as captured only in part.
    stderr_truncated: bool,
    /// Declared members written with no records, so validation refuses them.
    empty: Vec<String>,
    exit_code: i32,
    calls: Arc<AtomicUsize>,
}

impl FakeOutputSetRunner {
    fn writing(names: &[&str]) -> Self {
        Self {
            declared: names.iter().map(|name| (*name).to_owned()).collect(),
            converts_single_outputs: false,
            live: Arc::new(AtomicUsize::new(0)),
            concurrent: Arc::new(AtomicUsize::new(0)),
            started: Mutex::new(None),
            release: Mutex::new(None),
            park_on_call: 1,
            stop_ending: None,
            probe: None,
            probe_refused: Arc::new(Mutex::new(None)),
            undeclared: Vec::new(),
            stderr: String::new(),
            stderr_truncated: false,
            empty: Vec::new(),
            exit_code: 0,
            calls: Arc::new(AtomicUsize::new(0)),
        }
    }

    /// The same runner, which will try to open this object for writing from
    /// inside the process and remember whether it was refused.
    fn probing(mut self, member: &Path) -> Self {
        self.probe = Some(member.to_path_buf());
        self
    }

    /// Whether the probed member was pinned while the process ran. `None` if
    /// the process never ran.
    fn probe_refused(&self) -> Arc<Mutex<Option<bool>>> {
        Arc::clone(&self.probe_refused)
    }

    /// A backend that says something on its error stream.
    fn complaining(mut self, stderr: &str) -> Self {
        self.stderr = stderr.to_owned();
        self
    }

    fn also_injecting(mut self, name: &str) -> Self {
        self.undeclared.push(name.to_owned());
        self
    }

    fn failing(mut self) -> Self {
        self.exit_code = 1;
        self
    }

    /// A backend whose error stream was too long to capture whole, which is the
    /// one thing that makes the completeness audit unreadable rather than
    /// clean.
    fn truncating_stderr(mut self) -> Self {
        self.stderr_truncated = true;
        self
    }

    /// The same runner, writing one declared member with no records at all.
    fn with_empty_member(mut self, name: &str) -> Self {
        self.empty.push(name.to_owned());
        self
    }

    fn launches(&self) -> Arc<AtomicUsize> {
        Arc::clone(&self.calls)
    }

    /// The same runner, which also converts ordinary single-output plans.
    fn also_converting(mut self) -> Self {
        self.converts_single_outputs = true;
        self
    }

    /// The high-water mark of this runner's own concurrency.
    fn concurrent(&self) -> Arc<AtomicUsize> {
        Arc::clone(&self.concurrent)
    }

    /// The same runner, parked on its first run until released.
    fn parked(self, ending: StopEnding) -> (Self, mpsc::Receiver<()>, mpsc::Sender<()>) {
        self.parked_on_call(1, ending)
    }

    /// The same runner, parked on its `call`-th run until released.
    ///
    /// So a stop can be aimed at the second item of a queue, with the first
    /// already finished and holding whatever it earned.
    fn parked_on_call(
        mut self,
        call: usize,
        ending: StopEnding,
    ) -> (Self, mpsc::Receiver<()>, mpsc::Sender<()>) {
        let (started, observed) = mpsc::channel();
        let (release, parked) = mpsc::channel();
        self.started = Mutex::new(Some(started));
        self.release = Mutex::new(Some(parked));
        self.park_on_call = call;
        self.stop_ending = Some(ending);
        (self, observed, release)
    }
}

impl ProcessRunner for FakeOutputSetRunner {
    fn run(&self, spec: &CommandSpec) -> Result<ProcessOutput, ProcessError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let live = self.live.fetch_add(1, Ordering::SeqCst) + 1;
        self.concurrent.fetch_max(live, Ordering::SeqCst);
        let _lane = LiveProcess(Arc::clone(&self.live));
        // A single-output plan names the exact document it must produce; a set
        // plan names only a directory, because the backend chooses the names.
        // That difference is the discriminator, so one stand-in can serve a
        // mixed queue and the order and the concurrency of one queue can be
        // measured over both cardinalities at once.
        if let Some(destination) = spec.output_destination() {
            assert!(
                self.converts_single_outputs,
                "this runner was not asked to serve single-output plans"
            );
            let destination = destination.to_path_buf();
            fs::write(destination, mzml_document(2, true)).expect("write staged output");
            return Ok(ProcessOutput {
                stdout: Vec::new(),
                stderr: Vec::new(),
                stdout_total_bytes: 0,
                stderr_total_bytes: 0,
                stdout_truncated: false,
                stderr_truncated: false,
                exit_code: Some(0),
                elapsed: Duration::from_millis(3),
                termination: Termination::Exited,
                max_active_processes: Some(1),
                final_active_processes: Some(0),
                peak_job_memory_bytes: Some(2_048),
            });
        }
        let args = spec.args();
        let position = args
            .iter()
            .position(|argument| argument == "--outdir")
            .expect("a set command names an output directory");
        let outdir = PathBuf::from(&args[position + 1]);

        if let Some(probe) = &self.probe {
            // Write access, because that is what a pin withholds: the boundary
            // opens each member sharing reads only, so any request for write
            // access is refused for as long as it holds them. Asked from inside
            // the process, which is exactly the window that matters.
            let refused = fs::OpenOptions::new().write(true).open(probe).is_err();
            *self
                .probe_refused
                .lock()
                .expect("the probe result is never poisoned") = Some(refused);
        }

        let mut stdout = Vec::new();
        for name in &self.declared {
            let document = if self.empty.iter().any(|empty| empty == name) {
                mzml_document(0, true)
            } else {
                mzml_document(2, true)
            };
            fs::write(outdir.join(name), document).expect("write a backend output");
            stdout.extend_from_slice(b"writing output file: ");
            stdout.extend_from_slice(outdir.join(name).display().to_string().as_bytes());
            stdout.push(b'\n');
        }
        for name in &self.undeclared {
            fs::write(outdir.join(name), mzml_document(2, true)).expect("write an injected file");
        }

        Ok(ProcessOutput {
            stdout_total_bytes: stdout.len() as u64,
            stdout,
            stderr_total_bytes: self.stderr.len() as u64,
            stderr: self.stderr.clone().into_bytes(),
            stdout_truncated: false,
            stderr_truncated: self.stderr_truncated,
            exit_code: Some(self.exit_code),
            elapsed: Duration::from_millis(5),
            termination: Termination::Exited,
            max_active_processes: Some(1),
            final_active_processes: Some(0),
            peak_job_memory_bytes: Some(2_048),
        })
    }

    /// The same stand-in, under a cancellation request.
    ///
    /// Deliberately the same shape as `StopAwareRunner`'s: a request already
    /// made launches nothing; a request that lands while the process is parked
    /// leaves a partial staged document and reports the ending under test. A
    /// stand-in that reported a cancellation it had not performed would be
    /// standing in for a boundary MSCanvas does not have.
    fn run_cancellable(
        &self,
        spec: &CommandSpec,
        cancellation: &CancellationToken,
    ) -> Result<ProcessOutput, ProcessError> {
        if cancellation.is_cancelled() {
            return Ok(ProcessOutput {
                exit_code: None,
                termination: Termination::NotStarted,
                max_active_processes: None,
                final_active_processes: None,
                elapsed: Duration::ZERO,
                stdout: Vec::new(),
                stderr: Vec::new(),
                stdout_total_bytes: 0,
                stderr_total_bytes: 0,
                stdout_truncated: false,
                stderr_truncated: false,
                peak_job_memory_bytes: None,
            });
        }
        if self.calls.load(Ordering::SeqCst) + 1 < self.park_on_call {
            return self.run(spec);
        }
        let Some(started) = self.started.lock().expect("started channel").take() else {
            return self.run(spec);
        };
        self.calls.fetch_add(1, Ordering::SeqCst);
        let live = self.live.fetch_add(1, Ordering::SeqCst) + 1;
        self.concurrent.fetch_max(live, Ordering::SeqCst);
        let lane = LiveProcess(Arc::clone(&self.live));
        started.send(()).expect("announce the started conversion");
        let parked = self
            .release
            .lock()
            .expect("release channel")
            .take()
            .expect("a parked runner is released exactly once");
        parked
            .recv_timeout(Duration::from_secs(10))
            .expect("the parked conversion is released");
        let ending = self.stop_ending.expect("a parked runner has an ending");
        let args = spec.args();
        let position = args
            .iter()
            .position(|argument| argument == "--outdir")
            .expect("a set command names an output directory");
        let outdir = PathBuf::from(&args[position + 1]);
        if !cancellation.is_cancelled() || ending == StopEnding::NaturalSuccess {
            let mut stdout = Vec::new();
            for name in &self.declared {
                fs::write(outdir.join(name), mzml_document(2, true))
                    .expect("write a backend output");
                stdout.extend_from_slice(b"writing output file: ");
                stdout.extend_from_slice(outdir.join(name).display().to_string().as_bytes());
                stdout.push(b'\n');
            }
            return Ok(ProcessOutput {
                stdout_total_bytes: stdout.len() as u64,
                stdout,
                stderr: Vec::new(),
                stderr_total_bytes: 0,
                stdout_truncated: false,
                stderr_truncated: false,
                exit_code: Some(0),
                elapsed: Duration::from_millis(5),
                termination: Termination::Exited,
                max_active_processes: Some(1),
                final_active_processes: Some(0),
                peak_job_memory_bytes: Some(2_048),
            });
        }
        // A partial document, as a terminated backend leaves behind, so the
        // staging area a stop has to clean up is real.
        let partial = self.declared.first().map_or("partial.mzML", String::as_str);
        fs::write(outdir.join(partial), b"<indexedmzML><mzML")
            .expect("write a partial staged output");
        drop(lane);
        if ending == StopEnding::Unterminated {
            return Err(ProcessError::Terminate {
                detail: "the owned job refused termination".to_owned(),
            });
        }
        Ok(ProcessOutput {
            stdout: Vec::new(),
            stderr: b"the backend was mid-sentence when it was stopped\n".to_vec(),
            stdout_total_bytes: 0,
            stderr_total_bytes: 49,
            stdout_truncated: false,
            stderr_truncated: false,
            exit_code: Some(-1_073_741_510),
            elapsed: Duration::from_millis(4),
            termination: Termination::Cancelled,
            max_active_processes: Some(1),
            final_active_processes: if ending == StopEnding::Survivors {
                Some(2)
            } else {
                Some(0)
            },
            peak_job_memory_bytes: Some(2_048),
        })
    }
}

/// A service whose backend converts an acquisition to the named set.
fn output_set_service(runner: FakeOutputSetRunner) -> PreviewService {
    PreviewService::new(Box::new(ConvertingProvider::new(
        conversion_capabilities(
            EVIDENCED_RELEASE,
            Some(EVIDENCED_REVISION),
            EVIDENCED_EXECUTABLE_SHA256,
        ),
        runner,
    )))
}

/// One acquisition, two files, one row.
///
/// The claim ADR 0023 rests on. A bundle is not a `.wiff` with something nearby;
/// it is one dataset that owns both objects, holds both identities and keeps
/// both leases, and the roster describes it as one thing.
#[test]
fn a_sciex_bundle_becomes_one_dataset_that_owns_both_objects() {
    let fixture = TestFile::new("sciex-one-row");
    let acquisition = fixture.sciex_bundle("acquisition");
    let service = PreviewService::new(Box::new(FakeProvider::available(Vec::new())));

    let dataset = service
        .add_sciex_wiff_dataset(&acquisition)
        .expect("a whole bundle is admitted");

    assert_eq!(dataset.source_kind, DatasetSourceKindDto::SciexWiff);
    assert_eq!(dataset.file_name, "acquisition.wiff");
    // One row, not two. The companion is part of this dataset and is not a
    // dataset of its own.
    assert_eq!(service.dataset_count(), 1);
    assert_eq!(service.roster().datasets.len(), 1);

    // And the size the roster shows is the acquisition's, not the primary's.
    // A row that reported only the `.wiff` would understate a SCIEX dataset by
    // most of it.
    let primary_bytes = fs::metadata(&acquisition).expect("primary metadata").len();
    let companion_bytes = fs::metadata(fixture.companion_of("acquisition"))
        .expect("companion metadata")
        .len();
    assert_eq!(dataset.byte_length, primary_bytes + companion_bytes);
    assert!(companion_bytes > 0, "the companion contributes something");

    // Both holds are taken, and both are released with the row.
    let witnesses = service
        .lease_witnesses(&dataset.handle)
        .expect("a live dataset has its holds");
    assert_eq!(witnesses.len(), 2, "one hold per member");
    if cfg!(windows) {
        assert!(witnesses.iter().all(|witness| !witness.is_released()));
    }
}

/// Duplicate means the same acquisition, and an acquisition is all of it.
#[test]
fn bundle_duplicate_identity_is_the_whole_acquisition() {
    let fixture = TestFile::new("sciex-duplicate");
    let acquisition = fixture.sciex_bundle("acquisition");
    let service = PreviewService::new(Box::new(FakeProvider::available(Vec::new())));

    let first = service
        .add_sciex_wiff_dataset(&acquisition)
        .expect("the bundle is admitted");
    // The exact same bundle: the same two objects, unchanged.
    let again = service
        .add_sciex_wiff_dataset(&acquisition)
        .expect("the same bundle is admitted again");
    assert_eq!(again.handle, first.handle, "one acquisition, one row");
    assert_eq!(service.dataset_count(), 1);

    // The same `.wiff`, a *different object* under the companion's name. Not a
    // duplicate: handing back the first row would give the user a dataset bound
    // to a companion that is no longer there.
    //
    // Removed and recreated rather than rewritten in place, deliberately. A
    // rewrite keeps the file id, so the identity key cannot see it and should
    // not pretend to -- that is what the remembered digests are for, and
    // revalidation is where they are compared. Duplicate identity is a question
    // about which objects an acquisition is made of.
    let companion = fixture.companion_of("acquisition");
    fs::remove_file(&companion).expect("remove the companion");
    fs::write(&companion, scan_companion_bytes("a different acquisition"))
        .expect("put a different object under the companion name");
    let after = service
        .add_sciex_wiff_dataset(&acquisition)
        .expect("the changed bundle is admitted");
    assert_ne!(
        after.handle, first.handle,
        "a replaced companion is a different acquisition"
    );
    assert_eq!(service.dataset_count(), 2);
}

/// "Open it again to continue" has to actually continue.
///
/// A bundle member rewritten in place keeps its file id, so the identities that
/// decide duplicate do not change -- and the digests the row remembers do.
/// Revalidation refuses the row and says to open the acquisition again; opening
/// it again must rebind that row rather than hand back the stale one, or the
/// instruction is a loop the user cannot leave.
#[test]
fn reopening_a_rewritten_bundle_makes_its_row_usable_again() {
    let fixture = TestFile::new("sciex-reopen");
    let acquisition = fixture.sciex_bundle("acquisition");
    let companion = fixture.companion_of("acquisition");
    let service = PreviewService::new(Box::new(FakeProvider::available(Vec::new())));

    let first = service
        .add_sciex_wiff_dataset(&acquisition)
        .expect("the bundle is admitted");

    // Rewritten in place: same object, new bytes. The row is now stale.
    fs::write(&companion, scan_companion_bytes("rewritten in place"))
        .expect("rewrite the companion");
    let stale = super::selection::accept_sciex_wiff_bundle(&acquisition)
        .expect("the acquisition itself is still admissible");
    let _ = stale;

    // Opening it again returns the same handle -- one acquisition, one row --
    // and the row it returns is bound to what is on disk now.
    let again = service
        .add_sciex_wiff_dataset(&acquisition)
        .expect("the acquisition is admitted again");
    assert_eq!(again.handle, first.handle, "one acquisition, one row");
    assert_eq!(service.dataset_count(), 1);

    // The proof that it was rebound rather than handed back: it revalidates.
    let destination = fixture.destination("out");
    let error = service
        .convert_workspace_sciex_bundle(&again.handle, &destination, ConflictPolicy::Fail)
        .expect_err("this service has no conversion backend");
    assert_ne!(
        error.kind, "file_content_changed",
        "the reopened row is still stale: {error:?}"
    );
}

/// A refused bundle costs the session nothing, and every way it can be refused
/// is a refusal rather than a partial admission.
#[test]
fn a_refused_bundle_consumes_no_dataset_id() {
    let fixture = TestFile::new("sciex-refusals");
    let service = PreviewService::new(Box::new(FakeProvider::available(Vec::new())));

    // A `.wiff` with nothing beside it.
    let lonely = fixture.named_bytes("lonely.wiff", &wiff_container_bytes(&SCIEX_MARKERS));
    let error = service
        .add_sciex_wiff_dataset(&lonely)
        .expect_err("a bundle missing its companion is refused");
    // The family's own reason, not "that path could not be resolved" and not
    // the generic "not the structure its family requires". A `.wiff` with
    // nothing beside it is an incomplete acquisition, the user can fix it, and
    // now that this family has a surface the refusal says which file is
    // missing relative to the one they chose.
    assert_eq!(error.kind, "sciex_companion_missing");
    assert!(
        error.summary.contains(".wiff.scan"),
        "the refusal says what to put beside it: {}",
        error.summary
    );
    assert!(
        !error
            .summary
            .contains(fixture.directory.to_string_lossy().as_ref()),
        "and names no location: {}",
        error.summary
    );

    // The companion's name taken by something that is not one.
    let impostor = fixture.named_bytes("impostor.wiff", &wiff_container_bytes(&SCIEX_MARKERS));
    fixture.named_bytes(
        "impostor.wiff.scan",
        b"not a scan file, whatever it is called",
    );
    assert!(service.add_sciex_wiff_dataset(&impostor).is_err());

    // Another vendor's container under a `.wiff` name, with a genuine companion
    // beside it. Extension right, magic right, companion right, family wrong.
    let decoy = fixture.named_bytes("decoy.wiff", &shimadzu_lcd_bytes());
    fixture.named_bytes("decoy.wiff.scan", &scan_companion_bytes("payload"));
    assert!(service.add_sciex_wiff_dataset(&decoy).is_err());

    assert_eq!(service.dataset_count(), 0, "no refusal registered a row");
    assert!(service.roster().datasets.is_empty());
}

/// Revalidation re-admits the whole bundle, and refuses every way a member can
/// stop being the member that was admitted.
#[test]
fn bundle_revalidation_covers_every_member() {
    let fixture = TestFile::new("sciex-revalidation");
    let acquisition = fixture.sciex_bundle("acquisition");
    let companion = fixture.companion_of("acquisition");

    let admitted =
        super::selection::accept_sciex_wiff_bundle(&acquisition).expect("the bundle is admitted");
    assert_eq!(admitted.companions().len(), 1);
    revalidate(&admitted).expect("an untouched bundle revalidates");

    // The companion rewritten in place. The file id is unchanged -- this is the
    // same object -- so nothing about identity can see it, and the remembered
    // digest is the only thing that can. Nothing else in this boundary ever
    // looks at a companion, which is why the workspace remembers what it held.
    fs::write(&companion, scan_companion_bytes("rewritten")).expect("rewrite the companion");
    let error = revalidate(&admitted).expect_err("a rewritten companion is refused");
    assert_eq!(error.kind, "file_content_changed");

    // The companion removed entirely.
    fs::remove_file(&companion).expect("remove the companion");
    let error = revalidate(&admitted).expect_err("a missing companion is refused");
    assert_eq!(error.kind, "sciex_companion_missing");

    // Put back, and then the primary rewritten instead.
    fixture.named_bytes("acquisition.wiff.scan", &scan_companion_bytes("restored"));
    let restored = super::selection::accept_sciex_wiff_bundle(&acquisition)
        .expect("the bundle is admitted again");
    let mut rewritten = wiff_container_bytes(&SCIEX_MARKERS);
    rewritten.extend_from_slice(b"and a little more");
    fs::write(&acquisition, rewritten).expect("rewrite the primary");
    let error = revalidate(&restored).expect_err("a rewritten primary is refused");
    assert_eq!(error.kind, "file_content_changed");
}

/// The handoff proves every member, not just the one the argv names.
///
/// The companion never reaches a command line, so this comparison is the only
/// thing between a swapped `.wiff.scan` and a backend that reads it.
#[test]
fn the_bundle_handoff_refuses_a_companion_the_session_did_not_lease() {
    let fixture = TestFile::new("sciex-handoff");
    let acquisition = fixture.sciex_bundle("acquisition");
    let admitted =
        super::selection::accept_sciex_wiff_bundle(&acquisition).expect("the bundle is admitted");

    open_conversion_source(&admitted).expect("an untouched bundle opens as a source");

    // The primary is right and the companion this session remembers is not the
    // object behind its name.
    let forged = admitted.misremembering_its_companion(FileIdentity::new(7, [9; 16]));
    let error = open_conversion_source(&forged)
        .expect_err("a companion the session did not lease is refused");
    assert_eq!(error.kind, "file_identity_changed");
}

/// The whole private vertical: a bundle row converts to a set of documents.
#[test]
fn a_bundle_dataset_converts_to_a_published_output_set() {
    let fixture = TestFile::new("sciex-set");
    let acquisition = fixture.sciex_bundle("acquisition");
    let destination = fixture.destination("out");
    let runner = FakeOutputSetRunner::writing(&[
        "acquisition-Sample1.mzML",
        "acquisition-Sample2.mzML",
        "acquisition-Sample3.mzML",
    ]);
    let launches = runner.launches();
    let service = output_set_service(runner);
    let dataset = service
        .add_sciex_wiff_dataset(&acquisition)
        .expect("the bundle is admitted");

    let conversion = service
        .convert_workspace_sciex_bundle(&dataset.handle, &destination, ConflictPolicy::Fail)
        .expect("the conversion reaches an outcome");

    assert_eq!(launches.load(Ordering::SeqCst), 1);
    assert_eq!(conversion.report().group_outcome(), "fully_finalized");
    assert_eq!(conversion.report().dataset(), dataset.handle);
    assert_eq!(
        conversion.report().source_kind(),
        DatasetSourceKind::SciexWiff
    );
    assert_eq!(
        conversion.report().bound_source_objects(),
        2,
        "both members were bound"
    );
    assert_eq!(conversion.report().members().len(), 3);
    assert_eq!(conversion.report().published_count(), 3);
    assert!(conversion.report().partial_finalization().is_none());
    assert!(conversion.report().refusal_id().is_none());
    assert!(
        conversion.report().residue().is_none(),
        "the run swept its staging"
    );
    // Stamped with the generation the gate guard carried, and carrying what the
    // backend process did -- the same two facts the single-output report keeps.
    assert!(
        conversion.report().backend_facts().is_some(),
        "a run that ran has facts"
    );
    // The first resolution of a session is generation zero; what matters is
    // that the stamp comes from the gate guard rather than from a later look.
    assert_eq!(conversion.report().installation_generation(), 0);

    // The exact finalized objects survive the handoff, one per published
    // member. This is what a later adoption decision would rest on.
    assert_eq!(
        conversion.retained().len(),
        conversion.report().published_count()
    );

    // Every member judged on its output alone, and never fully verified.
    for member in conversion.report().members() {
        assert_eq!(member.state(), "finalized");
        let validation = member.validation().expect("a published member was judged");
        assert_eq!(
            validation.mode,
            mscanvas_proteowizard::ValidationMode::OutputOnly
        );
        assert!(
            !validation.fully_verified,
            "no source reading exists for this family, so nothing is fully verified"
        );
        assert!(member.byte_length().is_some());
        assert!(member.sha256().is_some());
    }

    let mut produced = entry_names(&destination);
    produced.sort();
    assert_eq!(
        produced,
        vec![
            "acquisition-Sample1.mzML",
            "acquisition-Sample2.mzML",
            "acquisition-Sample3.mzML"
        ]
    );
}

/// A full publication is a statement about the output set, and about nothing
/// else.
///
/// The gate this slice must not close by assertion. `Reader_ABI` can fail one
/// sample, log it, carry on, declare only what it wrote and exit zero -- so a
/// set that declared three and published three is indistinguishable here from
/// an acquisition of ten whose other seven failed to open. The report is
/// therefore allowed to say what it published and is not allowed to say the
/// acquisition converted.
#[test]
fn a_fully_finalized_set_makes_no_claim_about_the_source_acquisition() {
    let fixture = TestFile::new("sciex-completeness");
    let acquisition = fixture.sciex_bundle("acquisition");
    let destination = fixture.destination("out");
    let service = output_set_service(FakeOutputSetRunner::writing(&["acquisition-S1.mzML"]));
    let dataset = service
        .add_sciex_wiff_dataset(&acquisition)
        .expect("the bundle is admitted");

    let conversion = service
        .convert_workspace_sciex_bundle(&dataset.handle, &destination, ConflictPolicy::Fail)
        .expect("the conversion reaches an outcome");

    assert_eq!(conversion.report().group_outcome(), "fully_finalized");

    // Since ADR 0024 the report *may* say something about the acquisition's
    // samples -- but only as evidence, and never as a value some code path
    // could set because the run looked fine. What it must still never contain
    // is a bare claim: a boolean, or a field whose name asserts an outcome no
    // audit produced. Read as text so a field added later is caught here rather
    // than in review.
    let rendered = format!("{:?}", conversion.report()).to_ascii_lowercase();
    for forbidden in [
        "source_complete",
        "sourcecomplete",
        "all_samples",
        "allsamples",
        "fully_converted",
        "fullyconverted",
    ] {
        assert!(
            !rendered.contains(forbidden),
            "the report claims something about the source acquisition: {forbidden} in {rendered}"
        );
    }

    // The two answers stay two answers. The group outcome is about publication;
    // the completeness is about the acquisition, carries how it was proved, and
    // is bound to the executable that proved it.
    let completeness = conversion
        .report()
        .completeness()
        .expect("this family is asked the question");
    let evidence = completeness
        .established()
        .expect("a clean run establishes completeness");
    assert_eq!(evidence.sample_count(), 1);
    assert_eq!(evidence.method(), "reader_error_audit_v1");

    assert_eq!(conversion.report().published_count(), 1);
    assert_eq!(conversion.report().members().len(), 1);
}

/// A companion replaced by a *different object with identical content* is
/// still refused.
///
/// The case only the identity comparison can catch. Digests match, byte lengths
/// match, names match -- and the object under the companion's name is not the
/// object this session leased, so the acquisition is not the one it accepted.
#[test]
fn a_companion_swapped_for_an_identical_copy_is_still_refused() {
    let fixture = TestFile::new("sciex-identical-swap");
    let acquisition = fixture.sciex_bundle("acquisition");
    let companion = fixture.companion_of("acquisition");
    let admitted =
        super::selection::accept_sciex_wiff_bundle(&acquisition).expect("the bundle is admitted");
    revalidate(&admitted).expect("an untouched bundle revalidates");

    // Same bytes, different object: removed and written again rather than
    // rewritten in place, so the file id changes and nothing else does.
    let content = fs::read(&companion).expect("read the companion");
    fs::remove_file(&companion).expect("remove the companion");
    fs::write(&companion, &content).expect("write an identical copy");
    assert_eq!(
        fs::read(&companion).expect("read the copy"),
        content,
        "the copy really is identical"
    );

    let error = revalidate(&admitted).expect_err("an identical copy is a different object");
    assert_eq!(error.kind, "file_identity_changed");
}

/// Every member is pinned while the backend reads it, not just the one the argv
/// names.
///
/// A companion is never on a command line, so a swap during the run would be
/// read by the backend and reported by nothing: the outputs would validate
/// against themselves and the report would say the acquisition converted. The
/// probe asks the operating system, from inside the running process, whether
/// the boundary is holding it.
///
/// **Which layer is holding it, stated exactly.** Two guards cover this member
/// and they cover different intervals. `pin_source_bundle` inside
/// `mscanvas-proteowizard` holds every member from admission until the run
/// ends, and it is that one this probe observes -- the probe fires while the
/// process is running, which is inside its window. The coordinator's own
/// `lock_against_replacement` covers the earlier interval, between revalidation
/// and the crate's admission, and this test cannot reach it: there is no seam
/// in the middle of the coordinator, and the deterministic suite does not
/// invent one for a window a real replacement would have to win a race to use.
/// So removing the coordinator's companion locks leaves this test green, and
/// that is recorded as a surviving mutation rather than papered over.
#[cfg(windows)]
#[test]
fn every_bundle_member_is_pinned_while_the_backend_runs() {
    let fixture = TestFile::new("sciex-pinned");
    let acquisition = fixture.sciex_bundle("acquisition");
    let companion = fixture.companion_of("acquisition");
    let destination = fixture.destination("out");

    // A control first: with nothing holding it, the companion opens for writing.
    assert!(
        fs::OpenOptions::new().write(true).open(&companion).is_ok(),
        "the probe would pass for the wrong reason"
    );

    let runner = FakeOutputSetRunner::writing(&["acquisition-S1.mzML"]).probing(&companion);
    let refused = runner.probe_refused();
    let service = output_set_service(runner);
    let dataset = service
        .add_sciex_wiff_dataset(&acquisition)
        .expect("the bundle is admitted");

    let conversion = service
        .convert_workspace_sciex_bundle(&dataset.handle, &destination, ConflictPolicy::Fail)
        .expect("the conversion reaches an outcome");
    assert_eq!(conversion.report().group_outcome(), "fully_finalized");

    let refused = *refused.lock().expect("the probe result is never poisoned");
    assert_eq!(
        refused,
        Some(true),
        "the companion was writable while the backend was reading it"
    );
}

/// The shape the evidenced build writes to stderr when the reader loses one
/// sample and carries on.
const READER_LOST_A_SAMPLE: &str = "[Reader_ABI::read] Error opening run 3 in \"a.wiff\":\nboom\n";

/// An incomplete acquisition publishes nothing, through the workspace path.
///
/// The pre-slice behaviour was the false claim this gate exists for: nine of
/// ten samples converted, exit 0, declaration equal to discovery, every member
/// valid, and a report saying `fully_finalized`. Now the run is refused before
/// a single member reaches the destination.
#[test]
fn an_incomplete_acquisition_publishes_nothing_through_the_workspace() {
    let fixture = TestFile::new("sciex-incomplete");
    let acquisition = fixture.sciex_bundle("acquisition");
    let destination = fixture.destination("out");
    let service = output_set_service(
        FakeOutputSetRunner::writing(&["acquisition-S1.mzML", "acquisition-S2.mzML"])
            .complaining(READER_LOST_A_SAMPLE),
    );
    let dataset = service
        .add_sciex_wiff_dataset(&acquisition)
        .expect("the bundle is admitted");

    let conversion = service
        .convert_workspace_sciex_bundle(&dataset.handle, &destination, ConflictPolicy::Fail)
        .expect("the run reaches an outcome");

    assert_eq!(
        conversion.report().group_outcome(),
        "refused_before_publication"
    );
    assert_eq!(
        conversion.report().refusal_id(),
        Some("source_sample_failure_observed")
    );
    assert_eq!(conversion.report().published_count(), 0);
    assert!(conversion.retained().is_empty());
    assert!(
        entry_names(&destination).is_empty(),
        "an incomplete acquisition published something"
    );
    // And no positive evidence survives the refusal.
    assert!(
        conversion
            .report()
            .completeness()
            .is_none_or(|completeness| completeness.established().is_none())
    );
}

/// A member the backend never declared refuses the whole set, through the
/// workspace path as well as the lifecycle's own.
#[test]
fn an_injected_member_refuses_the_whole_workspace_set() {
    let fixture = TestFile::new("sciex-injected");
    let acquisition = fixture.sciex_bundle("acquisition");
    let destination = fixture.destination("out");
    let service = output_set_service(
        FakeOutputSetRunner::writing(&["acquisition-S1.mzML"])
            .also_injecting("acquisition-S2.mzML"),
    );
    let dataset = service
        .add_sciex_wiff_dataset(&acquisition)
        .expect("the bundle is admitted");

    let conversion = service
        .convert_workspace_sciex_bundle(&dataset.handle, &destination, ConflictPolicy::Fail)
        .expect("the run reaches an outcome");

    assert_eq!(
        conversion.report().group_outcome(),
        "refused_before_publication"
    );
    assert_eq!(
        conversion.report().refusal_id(),
        Some("multi_output_set_not_as_declared")
    );
    assert_eq!(conversion.report().published_count(), 0);
    assert!(conversion.retained().is_empty());
    assert!(
        entry_names(&destination).is_empty(),
        "nothing was published"
    );
}

/// A backend that fails publishes nothing and leaves no residue.
#[test]
fn a_failing_backend_publishes_no_workspace_output_set() {
    let fixture = TestFile::new("sciex-failure");
    let acquisition = fixture.sciex_bundle("acquisition");
    let destination = fixture.destination("out");
    let service =
        output_set_service(FakeOutputSetRunner::writing(&["acquisition-S1.mzML"]).failing());
    let dataset = service
        .add_sciex_wiff_dataset(&acquisition)
        .expect("the bundle is admitted");

    let conversion = service
        .convert_workspace_sciex_bundle(&dataset.handle, &destination, ConflictPolicy::Fail)
        .expect("the run reaches an outcome");

    assert_eq!(
        conversion.report().group_outcome(),
        "refused_before_publication"
    );
    assert_eq!(conversion.report().published_count(), 0);
    assert!(conversion.retained().is_empty());
    assert!(entry_names(&destination).is_empty());
    assert!(
        conversion.report().residue().is_none(),
        "the run swept its staging"
    );
}

/// The coordinator refuses a handle that is not a bundle, and one that is not a
/// dataset at all.
#[test]
fn the_bundle_coordinator_refuses_a_family_it_is_not_for() {
    let fixture = TestFile::new("sciex-wrong-family");
    let thermo = fixture.thermo_raw("acquisition.raw");
    let destination = fixture.destination("out");
    let runner = FakeOutputSetRunner::writing(&["anything.mzML"]);
    let launches = runner.launches();
    let service = output_set_service(runner);
    let dataset = service
        .add_thermo_dataset(&thermo)
        .expect("a Thermo acquisition is admitted");

    let error = service
        .convert_workspace_sciex_bundle(&dataset.handle, &destination, ConflictPolicy::Fail)
        .expect_err("a single-output family does not belong here");
    assert_eq!(error.kind, "dataset_not_multi_output");

    let error = service
        .convert_workspace_sciex_bundle("file-404", &destination, ConflictPolicy::Fail)
        .expect_err("an unknown handle is unknown");
    assert_eq!(error.kind, "unknown_file_handle");

    assert_eq!(launches.load(Ordering::SeqCst), 0, "nothing was launched");
}

/// A build with no recorded SCIEX evidence launches nothing.
#[test]
fn an_unevidenced_build_converts_no_bundle() {
    let fixture = TestFile::new("sciex-unevidenced");
    let acquisition = fixture.sciex_bundle("acquisition");
    let destination = fixture.destination("out");
    let runner = FakeOutputSetRunner::writing(&["acquisition-S1.mzML"]);
    let launches = runner.launches();
    let service = PreviewService::new(Box::new(ConvertingProvider::new(
        conversion_capabilities("3.0.26204", Some("a09eea9"), EVIDENCED_EXECUTABLE_SHA256),
        runner,
    )));
    let dataset = service
        .add_sciex_wiff_dataset(&acquisition)
        .expect("the bundle is admitted");

    let error = service
        .convert_workspace_sciex_bundle(&dataset.handle, &destination, ConflictPolicy::Fail)
        .expect_err("an unevidenced build is refused");
    assert_eq!(error.kind, "provider_build_not_evidenced");
    assert_eq!(launches.load(Ordering::SeqCst), 0);
    assert!(entry_names(&destination).is_empty());
}

/// `Add files…` admits a SCIEX acquisition, as exactly one row.
///
/// The claim ADR 0023 deliberately did not make, and the one this milestone
/// does. Asserted through the surfaces themselves rather than by reading the
/// code that implements them -- including the three that deliberately did
/// **not** change.
#[test]
fn add_files_admits_a_sciex_bundle_as_one_row() {
    let fixture = TestFile::new("sciex-add-files");
    let acquisition = fixture.sciex_bundle("acquisition");
    let service = PreviewService::new(Box::new(FakeProvider::available(Vec::new())));

    // The picker. A `.wiff` is routed to the bundle admission, and the
    // acquisition it admits is one dataset.
    let added = service.add_files_now(std::slice::from_ref(&acquisition));
    assert_eq!(service.dataset_count(), 1, "one acquisition is one row");
    let [WorkspaceAddOutcomeDto::Added { dataset }] = added.outcomes.as_slice() else {
        panic!("the picker admits a SCIEX bundle: {added:?}");
    };
    assert_eq!(dataset.source_kind, DatasetSourceKindDto::SciexWiff);
    assert_eq!(dataset.file_name, "acquisition.wiff");
    let handle = dataset.handle.clone();

    // The companion did not become a second row, and selecting it on its own is
    // refused by a reason that says what to select instead.
    let companion = fixture.companion_of("acquisition");
    let refused = service.add_files_now(std::slice::from_ref(&companion));
    assert_eq!(
        service.dataset_count(),
        1,
        "the companion is half of a row, never a row"
    );
    let [WorkspaceAddOutcomeDto::Rejected { error, .. }] = refused.outcomes.as_slice() else {
        panic!("a lone companion is rejected: {refused:?}");
    };
    assert_eq!(error.kind, "sciex_companion_selected_alone");
    assert!(
        error.summary.contains(".wiff"),
        "the refusal says what to select instead: {}",
        error.summary
    );

    // The row's stated size is the whole acquisition, not the object it is
    // named by. A row reporting only its `.wiff` would understate it by the
    // part that carries the spectra.
    let primary = fs::metadata(&acquisition).expect("the primary").len();
    let companion_bytes = fs::metadata(&companion).expect("the companion").len();
    assert_eq!(dataset.byte_length, primary + companion_bytes);

    // The visible queue takes it, and plans it as a backend-named set.
    assert!(is_convertible(DatasetSourceKind::SciexWiff));
    let plan = service
        .conversion_queue_plan(std::slice::from_ref(&handle))
        .expect("the visible queue takes a bundle");
    assert_eq!(
        plan.items[0].output,
        super::dto::ConversionOutputPlanDto::BackendNamedSet {
            max_members: MAX_CONVERSION_OUTPUTS_PER_SOURCE
        }
    );

    // And it is still not previewable: nothing in this product reads a vendor
    // container directly, and Rust refuses the read whatever asks for it.
    assert!(!DatasetSourceKind::SciexWiff.is_previewable());
    let refused = service
        .open_preview(&handle)
        .expect_err("a SCIEX row is not previewable");
    assert_eq!(refused.kind, "dataset_not_previewable");
    assert_eq!(
        refused.summary,
        "Convert to mzML before previewing this acquisition."
    );
}

/// Selecting both halves of one acquisition still yields one acquisition.
///
/// The failure this guards is the one that would look most like success: two
/// rows for one bundle, each holding half of it.
#[test]
fn selecting_both_bundle_members_adds_one_acquisition() {
    let fixture = TestFile::new("sciex-both-halves");
    let acquisition = fixture.sciex_bundle("acquisition");
    let companion = fixture.companion_of("acquisition");
    let service = PreviewService::new(Box::new(FakeProvider::available(Vec::new())));

    let added = service.add_files_now(&[acquisition, companion]);
    assert_eq!(service.dataset_count(), 1);
    let kinds: Vec<&str> = added
        .outcomes
        .iter()
        .map(|outcome| match outcome {
            WorkspaceAddOutcomeDto::Added { .. } => "added",
            WorkspaceAddOutcomeDto::Duplicate { .. } => "duplicate",
            WorkspaceAddOutcomeDto::Rejected { .. } => "rejected",
        })
        .collect();
    assert_eq!(
        kinds,
        vec!["added", "rejected"],
        "the primary is the acquisition; the companion is not a second one"
    );
}

/// A picker batch keeps its order and its per-item outcomes across families.
///
/// One rejected acquisition does not roll back the ones beside it, and the
/// outcomes come back in the order the user chose, not in an order this
/// boundary found convenient.
#[test]
fn a_mixed_picker_batch_stays_ordered_and_per_item() {
    let fixture = TestFile::new("sciex-mixed-batch");
    let service = PreviewService::new(Box::new(FakeProvider::available(Vec::new())));

    let mzml = fixture.readable_mzml("first.mzML");
    let thermo = fixture.thermo_raw("second.raw");
    // A `.wiff` with no companion beside it: admitted by name, refused by the
    // family, and refused on its own without touching anything else.
    let lonely = fixture.named_bytes("lonely.wiff", &wiff_container_bytes(&SCIEX_MARKERS));
    let sciex = fixture.sciex_bundle("fourth");
    let shimadzu = fixture.shimadzu_lcd("fifth.lcd");

    let added = service.add_files_now(&[mzml, thermo, lonely, sciex, shimadzu]);

    let kinds: Vec<&str> = added
        .outcomes
        .iter()
        .map(|outcome| match outcome {
            WorkspaceAddOutcomeDto::Added { .. } => "added",
            WorkspaceAddOutcomeDto::Duplicate { .. } => "duplicate",
            WorkspaceAddOutcomeDto::Rejected { .. } => "rejected",
        })
        .collect();
    assert_eq!(
        kinds,
        vec!["added", "added", "rejected", "added", "added"],
        "one refusal does not roll back the rows beside it"
    );
    let WorkspaceAddOutcomeDto::Rejected { error, .. } = &added.outcomes[2] else {
        panic!("the third candidate is the refusal");
    };
    assert_eq!(error.kind, "sciex_companion_missing");

    assert_eq!(
        roster_names(&service),
        vec!["first.mzML", "second.raw", "fourth.wiff", "fifth.lcd"],
        "the roster keeps the order the picker gave"
    );
    assert_eq!(
        service
            .roster()
            .datasets
            .iter()
            .map(|row| row.source_kind)
            .collect::<Vec<_>>(),
        vec![
            DatasetSourceKindDto::Mzml,
            DatasetSourceKindDto::ThermoRaw,
            DatasetSourceKindDto::SciexWiff,
            DatasetSourceKindDto::ShimadzuLcd,
        ]
    );
}

/// The extension routes; it never recognises.
///
/// Three decoys, each of which a suffix-only rule would admit and a launched
/// backend would then refuse. A name that proposed a family and failed it is a
/// refusal rather than a second guess at another family.
#[test]
fn a_wiff_name_over_the_wrong_bytes_is_refused_rather_than_rerouted() {
    let fixture = TestFile::new("sciex-decoys");
    let service = PreviewService::new(Box::new(FakeProvider::available(Vec::new())));

    // Another vendor's compound file under a `.wiff` name, with a genuine
    // companion beside it so only the container rule can refuse it.
    let impostor = fixture.named_bytes("impostor.wiff", &shimadzu_lcd_bytes());
    fixture.named_bytes(
        "impostor.wiff.scan",
        &scan_companion_bytes("a real companion"),
    );
    // Not a compound file at all.
    let archive = fixture.named_bytes("archive.wiff", b"PK this is a zip archive");
    fixture.named_bytes("archive.wiff.scan", &scan_companion_bytes("also real"));
    // A genuine SCIEX container under a name that proposes nothing.
    let renamed = fixture.named_bytes("renamed-wiff.dat", &wiff_container_bytes(&SCIEX_MARKERS));

    let added = service.add_files_now(&[impostor, archive, renamed]);
    assert_eq!(service.dataset_count(), 0, "no decoy was admitted");
    let reasons: Vec<&str> = added
        .outcomes
        .iter()
        .map(|outcome| match outcome {
            WorkspaceAddOutcomeDto::Rejected { error, .. } => error.kind.as_str(),
            other => panic!("a decoy was admitted: {other:?}"),
        })
        .collect();
    assert_eq!(
        reasons,
        vec![
            // Routed to SCIEX by name and refused by the container rule --
            // never handed on to the LabSolutions admission its bytes match.
            "unrecognized_acquisition",
            "unrecognized_acquisition",
            // Proposed nothing, so it went to mzML and was refused by name.
            "unsupported_extension",
        ]
    );
}

/// Adding one acquisition twice returns the row the user already has.
#[test]
fn adding_a_bundle_twice_returns_the_existing_row() {
    let fixture = TestFile::new("sciex-duplicate");
    let acquisition = fixture.sciex_bundle("acquisition");
    let service = PreviewService::new(Box::new(FakeProvider::available(Vec::new())));

    let first = service.add_files_now(std::slice::from_ref(&acquisition));
    let handle = outcome_handle(&first.outcomes[0]).to_owned();

    let again = service.add_files_now(std::slice::from_ref(&acquisition));
    let WorkspaceAddOutcomeDto::Duplicate { existing } = &again.outcomes[0] else {
        panic!("the second addition is a duplicate: {again:?}");
    };
    assert_eq!(existing.handle, handle);
    assert_eq!(service.dataset_count(), 1);

    // A duplicate spends no identifier: the next real addition is the next one.
    let next = service.add_files_now(&[fixture.readable_mzml("next.mzML")]);
    assert_eq!(outcome_handle(&next.outcomes[0]), "file-1");
}

/// A bundle rewritten in place rebinds its row through the picker itself.
///
/// The visible half of the rule ADR 0022 measured privately. "Open it again to
/// continue" has to actually continue when the user opens it again the only way
/// they can, which is `Add files`.
#[test]
fn reopening_a_rewritten_bundle_through_the_picker_rebinds_its_row() {
    let fixture = TestFile::new("sciex-picker-rebind");
    let acquisition = fixture.sciex_bundle("acquisition");
    let companion = fixture.companion_of("acquisition");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));

    let first = service.add_files_now(std::slice::from_ref(&acquisition));
    let handle = outcome_handle(&first.outcomes[0]).to_owned();

    // Rewritten in place: same object, new bytes.
    fs::write(&companion, scan_companion_bytes("rewritten in place"))
        .expect("rewrite the companion");

    let again = service.add_files_now(std::slice::from_ref(&acquisition));
    assert_eq!(
        outcome_handle(&again.outcomes[0]),
        handle,
        "one acquisition is one row, however many times it is opened"
    );
    assert_eq!(
        service.dataset_count(),
        1,
        "the stale-digest loop must not create a second row"
    );
    // Bound to what is on disk now, which is what makes the instruction usable.
    let planned = service.conversion_queue_plan(std::slice::from_ref(&handle));
    assert!(planned.is_ok(), "the rebound row plans: {planned:?}");
}

/// A queue may hold all three visible convertible families at once.
///
/// Item count stays a count of sources, and each row carries the cardinality of
/// its own family rather than the queue's first.
#[test]
fn a_mixed_family_queue_plans_every_visible_family() {
    let fixture = TestFile::new("mixed-family-plan");
    let service = PreviewService::new(Box::new(ConvertingProvider::faithful()));
    let handles = vec![
        add_one_acquisition(&service, &fixture.thermo_raw("one.raw")),
        add_one_acquisition(&service, &fixture.sciex_bundle("two")),
        add_one_acquisition(&service, &fixture.shimadzu_lcd("three.lcd")),
    ];

    let plan = service
        .conversion_queue_plan(&handles)
        .expect("every visible convertible family is planned together");
    assert_eq!(plan.items.len(), 3, "item count is source count");
    assert_eq!(
        plan.items
            .iter()
            .map(|item| item.source_kind)
            .collect::<Vec<_>>(),
        vec![
            DatasetSourceKindDto::ThermoRaw,
            DatasetSourceKindDto::SciexWiff,
            DatasetSourceKindDto::ShimadzuLcd,
        ]
    );
    assert_eq!(
        plan.items[0].output,
        super::dto::ConversionOutputPlanDto::KnownSingle {
            file_name: String::from("one.mzML")
        }
    );
    assert_eq!(
        plan.items[1].output,
        super::dto::ConversionOutputPlanDto::BackendNamedSet {
            max_members: MAX_CONVERSION_OUTPUTS_PER_SOURCE
        }
    );
    assert_eq!(
        plan.items[2].output,
        super::dto::ConversionOutputPlanDto::KnownSingle {
            file_name: String::from("three.mzML")
        }
    );
    // And the plan's own bound is the queue's, not the outputs'.
    assert_eq!(plan.capacity, MAX_CONVERSION_QUEUE_ITEMS);
}

/// Adding a SCIEX row creates no preview state of any kind.
///
/// Structural rather than checked: admission is filesystem work, and the one
/// thing that could make a row previewable is a provider call this path does
/// not make.
#[test]
fn adding_a_bundle_previews_nothing_and_disturbs_no_open_preview() {
    let fixture = TestFile::new("sciex-no-preview");
    // Two openings of one mzML row: the one before the bundle is added and the
    // one after, which is what proves the first survived.
    let mut responses = open_responses();
    responses.extend(open_responses());
    let service = PreviewService::new(Box::new(FakeProvider::available(responses)));

    let mzml = add_one_acquisition(&service, &fixture.readable_mzml("open.mzML"));
    let preview = service.open_preview(&mzml).expect("an mzML row previews");
    let opened = preview.file.handle.clone();

    let sciex = service.add_files_now(&[fixture.sciex_bundle("acquisition")]);
    let handle = outcome_handle(&sciex.outcomes[0]).to_owned();

    // The SCIEX row itself has nothing to show, and asking is refused.
    assert!(service.open_preview(&handle).is_err());
    // And the preview that was open is still the one that is open: adding a row
    // of a family that cannot be previewed does not close what can be.
    let still = service
        .open_preview(&opened)
        .expect("the mzML row still previews");
    assert_eq!(still.file.handle, opened);
}

/// The command surface is exactly what it was.
#[test]
fn the_command_surface_does_not_grow_for_the_bundle_family() {
    let source = include_str!("../lib.rs");
    let handler = source
        .split_once("generate_handler![")
        .expect("the command registration list is in lib.rs")
        .1
        .split_once(']')
        .expect("the registration list is closed")
        .0;
    for forbidden in ["sciex", "wiff"] {
        assert!(
            !handler.to_ascii_lowercase().contains(forbidden),
            "a command names this family: {handler}"
        );
    }
}

/// A real ten-sample SCIEX acquisition, through a workspace handle.
///
/// The evidence run for ADR 0023, kept out of ordinary CI: it needs a local
/// ProteoWizard installation and a lawful acquisition, neither of which a test
/// runner has. Drive it with the fixtures ADR 0022 pins.
#[cfg(windows)]
#[test]
#[ignore = "needs a local ProteoWizard installation and a real vendor acquisition"]
fn a_real_sciex_bundle_converts_through_a_workspace_handle() {
    let Ok(fixture) = std::env::var("MSCANVAS_SCIEX_WIFF_FIXTURE") else {
        panic!("set MSCANVAS_SCIEX_WIFF_FIXTURE to the .wiff to convert");
    };
    let Ok(destination) = std::env::var("MSCANVAS_CONVERSION_DESTINATION") else {
        panic!("set MSCANVAS_CONVERSION_DESTINATION to an empty folder");
    };
    let expected: usize = std::env::var("MSCANVAS_SCIEX_EXPECTED_OUTPUTS")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(1);
    let acquisition = PathBuf::from(fixture);
    let destination = PathBuf::from(destination);

    // The production provider. Nothing is substituted.
    let service = PreviewService::new(Box::new(super::backend::ProteoWizardProvider::new()));
    let dataset = service
        .add_sciex_wiff_dataset(&acquisition)
        .expect("the acquisition is admitted as a SCIEX bundle");
    println!("dataset handle: {}", dataset.handle);
    println!("acquisition bytes (both members): {}", dataset.byte_length);
    assert_eq!(dataset.source_kind, DatasetSourceKindDto::SciexWiff);
    assert_eq!(service.dataset_count(), 1, "one row for the whole bundle");

    let conversion = service
        .convert_workspace_sciex_bundle(&dataset.handle, &destination, ConflictPolicy::Fail)
        .expect("the conversion reaches an outcome");

    println!("report: {:?}", conversion.report());

    // Pointed at an acquisition with a deliberately broken sample, the whole
    // point is that this refuses. Driven by an environment variable so the same
    // test is both the success evidence and the discrimination evidence.
    if std::env::var("MSCANVAS_SCIEX_EXPECT_INCOMPLETE").is_ok() {
        assert_eq!(
            conversion.report().group_outcome(),
            "refused_before_publication",
            "an incomplete acquisition was published"
        );
        assert_eq!(
            conversion.report().refusal_id(),
            Some("source_sample_failure_observed"),
            "refused, but not for the reason this gate exists"
        );
        assert_eq!(conversion.report().published_count(), 0);
        assert!(conversion.retained().is_empty());
        assert!(
            entry_names(&destination).is_empty(),
            "an incomplete acquisition left files behind"
        );
        println!("incomplete acquisition refused before publication; nothing was written");
        return;
    }

    assert_eq!(conversion.report().group_outcome(), "fully_finalized");
    assert_eq!(conversion.report().bound_source_objects(), 2);
    assert_eq!(conversion.report().members().len(), expected);
    assert_eq!(conversion.report().published_count(), expected);
    assert_eq!(conversion.retained().len(), expected);
    assert!(
        conversion.report().residue().is_none(),
        "the run swept its staging"
    );

    for member in conversion.report().members() {
        let validation = member.validation().expect("a published member was judged");
        assert_eq!(
            validation.mode,
            mscanvas_proteowizard::ValidationMode::OutputOnly
        );
        assert!(!validation.fully_verified);
        // Printed rather than pinned: msconvert writes the source's own
        // directory into the document, so an output digest is not a portable
        // fact about this family. See the M3.11 evidence record.
        println!(
            "member {} bytes {:?} spectra {:?} chromatograms {:?}",
            member.file_name(),
            member.byte_length(),
            member.spectrum_count(),
            member.chromatogram_count()
        );
    }
    assert_eq!(entry_names(&destination).len(), expected);

    // The gate ADR 0022 opened, now closed and asserted rather than printed.
    let evidence = conversion
        .report()
        .completeness()
        .and_then(mscanvas_proteowizard::SciexSampleCompleteness::established)
        .expect("a complete acquisition establishes completeness");
    assert_eq!(evidence.sample_count(), expected);
    println!(
        "every one of the {} samples the reader identified produced its output ({})",
        evidence.sample_count(),
        evidence.method()
    );
}

// ---------------------------------------------------------------------------
// Private SCIEX output-set adoption. ADR 0025.
// ---------------------------------------------------------------------------

/// A converted SCIEX acquisition and the session that converted it.
struct ConvertedSet {
    service: PreviewService,
    source: String,
    destination: PathBuf,
    ticket: super::adoption::FinalizedOutputSetAdoptionTicket,
}

/// Converts one synthetic SCIEX bundle to `names` and mints its ticket.
fn converted_output_set(label: &str, names: &[&str]) -> (TestFile, ConvertedSet) {
    converted_output_set_with(label, FakeOutputSetRunner::writing(names))
}

fn converted_output_set_with(label: &str, runner: FakeOutputSetRunner) -> (TestFile, ConvertedSet) {
    let fixture = TestFile::new(label);
    let acquisition = fixture.sciex_bundle("acquisition");
    let destination = fixture.destination("out");
    let service = output_set_service(runner);
    let dataset = service
        .add_sciex_wiff_dataset(&acquisition)
        .expect("the bundle is admitted");
    let conversion = service
        .convert_workspace_sciex_bundle(&dataset.handle, &destination, ConflictPolicy::Fail)
        .expect("the conversion reaches an outcome");
    assert_eq!(conversion.report().group_outcome(), "fully_finalized");
    let ticket = service
        .output_set_adoption_ticket(conversion)
        .expect("a complete set mints a ticket");
    (
        fixture,
        ConvertedSet {
            service,
            source: dataset.handle,
            destination,
            ticket,
        },
    )
}

/// The kinds of every adoption outcome, in order.
fn set_adoption_kinds(outcomes: &[WorkspaceOutputAdoptionOutcomeDto]) -> Vec<&'static str> {
    outcomes
        .iter()
        .map(|outcome| match outcome {
            WorkspaceOutputAdoptionOutcomeDto::Added { .. } => "added",
            WorkspaceOutputAdoptionOutcomeDto::AlreadyInWorkspace { .. } => "already",
            WorkspaceOutputAdoptionOutcomeDto::Refused { .. } => "refused",
        })
        .collect()
}

fn set_refusal_reasons(outcomes: &[WorkspaceOutputAdoptionOutcomeDto]) -> Vec<String> {
    outcomes
        .iter()
        .filter_map(|outcome| match outcome {
            WorkspaceOutputAdoptionOutcomeDto::Refused { reason, .. } => Some(reason.clone()),
            _ => None,
        })
        .collect()
}

/// The names an adoption result reports, in order.
fn set_output_names(outcomes: &[WorkspaceOutputAdoptionOutcomeDto]) -> Vec<String> {
    outcomes
        .iter()
        .map(|outcome| match outcome {
            WorkspaceOutputAdoptionOutcomeDto::Added {
                output_file_name, ..
            }
            | WorkspaceOutputAdoptionOutcomeDto::AlreadyInWorkspace {
                output_file_name, ..
            }
            | WorkspaceOutputAdoptionOutcomeDto::Refused {
                output_file_name, ..
            } => output_file_name.clone(),
        })
        .collect()
}

/// The whole private vertical: one acquisition, ten outputs, ten mzML rows.
#[test]
fn a_complete_output_set_is_adopted_as_ordinary_mzml_rows() {
    let names: Vec<String> = (1..=10)
        .map(|index| format!("a-S{index:02}.mzML"))
        .collect();
    let borrowed: Vec<&str> = names.iter().map(String::as_str).collect();
    let (_fixture, converted) = converted_output_set("set-adopt", &borrowed);

    assert_eq!(converted.ticket.len(), 10);
    assert_eq!(converted.ticket.sample_count(), 10);
    assert_eq!(converted.ticket.source_kind(), DatasetSourceKind::SciexWiff);
    // The ticket names no location and no member, even under `{:?}`.
    let rendered = format!("{:?}", converted.ticket);
    for fragment in [":\\", "a-S01", "acquisition"] {
        assert!(
            !rendered.contains(fragment),
            "the ticket names {fragment:?}: {rendered}"
        );
    }

    // One row before: the acquisition itself.
    assert_eq!(converted.service.dataset_count(), 1);

    let result = converted
        .service
        .adopt_output_set(&converted.ticket)
        .expect("a complete set adopts");

    assert_eq!(result.members, 10);
    assert_eq!(result.source, converted.source);
    assert_eq!(result.source_kind, DatasetSourceKind::SciexWiff);
    assert_eq!(set_adoption_kinds(&result.outcomes), vec!["added"; 10]);
    // Publication order, preserved through the whole handoff.
    assert_eq!(set_output_names(&result.outcomes), names);

    // Eleven rows: the acquisition, still one logical bundle row, and its ten
    // outputs as independent mzML datasets.
    assert_eq!(converted.service.dataset_count(), 11);
    let roster = converted.service.roster();
    assert_eq!(roster.datasets.len(), 11);
    let adopted: Vec<&SelectedFileDto> = roster
        .datasets
        .iter()
        .filter(|dataset| dataset.handle != converted.source)
        .collect();
    assert_eq!(adopted.len(), 10);
    for dataset in adopted {
        assert_eq!(
            dataset.source_kind,
            DatasetSourceKindDto::Mzml,
            "an adopted output kept a vendor family"
        );
    }
    // The source row is untouched and still the bundle.
    let source_row = roster
        .datasets
        .iter()
        .find(|dataset| dataset.handle == converted.source)
        .expect("the acquisition is still listed");
    assert_eq!(source_row.source_kind, DatasetSourceKindDto::SciexWiff);

    // Nothing was previewed. Adoption reads no file for display and launches
    // no process; a session that has stopped trusting its backend could still
    // have done this.
    assert!(!converted.service.holds_preview_state(&converted.source));

    // The result names no location either.
    let rendered = format!("{result:?}");
    assert!(
        !rendered.contains(":\\"),
        "the result names a path: {rendered}"
    );
}

/// Adopting again adds nothing and reports every member as already present.
#[test]
fn adopting_a_set_twice_adds_nothing_the_second_time() {
    let (_fixture, converted) =
        converted_output_set("set-twice", &["a-S1.mzML", "a-S2.mzML", "a-S3.mzML"]);

    let first = converted
        .service
        .adopt_output_set(&converted.ticket)
        .expect("the first adoption succeeds");
    assert_eq!(set_adoption_kinds(&first.outcomes), vec!["added"; 3]);
    let after_first = converted.service.dataset_count();

    // The ticket is not consumed: it still holds the same objects, so the same
    // questions are asked of the same files.
    let second = converted
        .service
        .adopt_output_set(&converted.ticket)
        .expect("the second adoption reaches an outcome");
    assert_eq!(set_adoption_kinds(&second.outcomes), vec!["already"; 3]);
    assert_eq!(
        converted.service.dataset_count(),
        after_first,
        "a repeated adoption added a row"
    );
    // And the handles are the existing rows', not new ones.
    for (again, before) in second.outcomes.iter().zip(&first.outcomes) {
        let (
            WorkspaceOutputAdoptionOutcomeDto::AlreadyInWorkspace { dataset: again, .. },
            WorkspaceOutputAdoptionOutcomeDto::Added {
                dataset: before, ..
            },
        ) = (again, before)
        else {
            panic!("unexpected outcome shapes");
        };
        assert_eq!(again.handle, before.handle);
    }
}

/// One member that is no longer the exact object it was does not stop the rest.
#[test]
fn a_replaced_member_is_refused_and_the_others_are_adopted() {
    let (_fixture, converted) =
        converted_output_set("set-replaced", &["a-S1.mzML", "a-S2.mzML", "a-S3.mzML"]);

    // A byte-identical impostor at the second member's final name. Same bytes,
    // same length, different object -- which identity alone catches and a
    // digest alone would not.
    let victim = converted.destination.join("a-S2.mzML");
    let bytes = fs::read(&victim).expect("read the finalized output");
    fs::rename(&victim, converted.destination.join("moved-aside")).expect("move it aside");
    fs::write(&victim, &bytes).expect("write an identical copy");
    assert_eq!(
        fs::read(&victim).expect("read the impostor"),
        bytes,
        "the impostor really is byte-identical"
    );

    let result = converted
        .service
        .adopt_output_set(&converted.ticket)
        .expect("the adoption reaches an outcome");

    assert_eq!(
        set_adoption_kinds(&result.outcomes),
        vec!["added", "refused", "added"]
    );
    assert_eq!(
        set_refusal_reasons(&result.outcomes),
        vec!["output_changed"]
    );
    assert_eq!(
        converted.service.dataset_count(),
        3,
        "one source, two outputs"
    );
}

/// The same object with different bytes is refused too.
#[test]
fn a_rewritten_member_is_refused() {
    let (_fixture, converted) = converted_output_set("set-rewritten", &["a-S1.mzML", "a-S2.mzML"]);

    // Rewritten in place: the file id does not change, so only the digest can
    // see it. The retention deliberately permits this -- the output is the
    // user's file.
    fs::write(
        converted.destination.join("a-S1.mzML"),
        mzml_document(3, true),
    )
    .expect("rewrite the first output");

    let result = converted
        .service
        .adopt_output_set(&converted.ticket)
        .expect("the adoption reaches an outcome");
    assert_eq!(
        set_adoption_kinds(&result.outcomes),
        vec!["refused", "added"]
    );
    assert_eq!(
        set_refusal_reasons(&result.outcomes),
        vec!["output_changed"]
    );
}

/// A member whose final name is gone is refused; the rest are adopted.
#[test]
fn a_missing_member_is_refused() {
    let (_fixture, converted) = converted_output_set("set-missing", &["a-S1.mzML", "a-S2.mzML"]);
    fs::remove_file(converted.destination.join("a-S2.mzML")).expect("remove the second output");

    let result = converted
        .service
        .adopt_output_set(&converted.ticket)
        .expect("the adoption reaches an outcome");
    assert_eq!(
        set_adoption_kinds(&result.outcomes),
        vec!["added", "refused"]
    );
    assert_eq!(
        set_refusal_reasons(&result.outcomes),
        vec!["output_missing"]
    );
}

/// A member the workspace already holds is reported as such, not duplicated.
#[test]
fn a_member_already_in_the_workspace_is_reported_not_duplicated() {
    let (_fixture, converted) = converted_output_set("set-existing", &["a-S1.mzML", "a-S2.mzML"]);

    // Admitted the ordinary way, before the set is adopted.
    converted
        .service
        .add_files(&[converted.destination.join("a-S1.mzML")])
        .expect("an ordinary mzML is admitted");
    let before = converted.service.dataset_count();

    let result = converted
        .service
        .adopt_output_set(&converted.ticket)
        .expect("the adoption reaches an outcome");
    assert_eq!(
        set_adoption_kinds(&result.outcomes),
        vec!["already", "added"]
    );
    assert_eq!(
        converted.service.dataset_count(),
        before + 1,
        "the already-present member consumed a row"
    );
}

/// Capacity, measured on the output-set path itself.
///
/// Until now this rule was inherited: set adoption calls the same registry the
/// visible path does, and that registry's own tests prove duplicates are
/// decided before capacity. Inheritance is a good argument and it is not a
/// measurement -- it does not say what the *set* path does when the workspace
/// fills partway through one ordered adoption. It does now.
///
/// The shape: three members, member 0 already a row, exactly one slot free.
/// Member 0 must not spend the slot, member 1 must take it, and member 2 must
/// be refused -- with no rollback of anything already committed.
#[test]
fn an_output_set_fills_the_last_slot_and_refuses_the_rest() {
    let (fixture, converted) =
        converted_output_set("set-capacity", &["a-S1.mzML", "a-S2.mzML", "a-S3.mzML"]);
    let service = &converted.service;

    // Member 0 the ordinary way, before the set is adopted.
    service
        .add_files(&[converted.destination.join("a-S1.mzML")])
        .expect("an ordinary mzML is admitted");
    let existing = service.roster().datasets.last().expect("the row").clone();

    // Fill to exactly one free slot. The acquisition and member 0 are already
    // rows, so the filler is everything else the workspace can hold but one.
    let filler: Vec<PathBuf> = (0..MAX_WORKSPACE_DATASETS - 3)
        .map(|index| fixture.readable_mzml(&format!("filler-{index}.mzML")))
        .collect();
    service.add_files(&filler).expect("the filler is admitted");
    assert_eq!(
        service.dataset_count(),
        MAX_WORKSPACE_DATASETS - 1,
        "exactly one slot must remain"
    );
    let identifiers_before = service.next_dataset_identifier();

    let result = service
        .adopt_output_set(&converted.ticket)
        .expect("the adoption reaches an outcome");

    // Duplicate first, then the last slot, then the refusal -- in member order.
    assert_eq!(
        set_adoption_kinds(&result.outcomes),
        vec!["already", "added", "refused"]
    );
    assert_eq!(
        set_refusal_reasons(&result.outcomes),
        vec!["workspace_full"]
    );
    assert_eq!(
        set_output_names(&result.outcomes),
        vec!["a-S1.mzML", "a-S2.mzML", "a-S3.mzML"],
        "refusals keep their place in the deterministic member order"
    );

    // The duplicate returned its existing row rather than a new one.
    let WorkspaceOutputAdoptionOutcomeDto::AlreadyInWorkspace { dataset, .. } = &result.outcomes[0]
    else {
        panic!("member 0 is a duplicate: {:?}", result.outcomes[0]);
    };
    assert_eq!(dataset.handle, existing.handle);
    assert_eq!(dataset.source_kind, DatasetSourceKindDto::Mzml);

    // The workspace is full and the duplicate spent neither a slot nor an id:
    // one row was added, and exactly one identifier was allocated.
    assert_eq!(service.dataset_count(), MAX_WORKSPACE_DATASETS);
    assert_eq!(
        service.next_dataset_identifier(),
        identifiers_before + 1,
        "only the one accepted member may spend an identifier"
    );

    // No set-level rollback: the member that fitted is a row, and so is the
    // acquisition it came from.
    let handles: Vec<&str> = result
        .roster
        .datasets
        .iter()
        .map(|dataset| dataset.handle.as_str())
        .collect();
    let WorkspaceOutputAdoptionOutcomeDto::Added { dataset, .. } = &result.outcomes[1] else {
        panic!("member 1 took the last slot: {:?}", result.outcomes[1]);
    };
    assert!(handles.contains(&dataset.handle.as_str()));
    assert!(
        handles.contains(&converted.source.as_str()),
        "the acquisition is still a row of its own"
    );
    assert_eq!(
        result
            .roster
            .datasets
            .iter()
            .filter(|dataset| dataset.source_kind == DatasetSourceKindDto::SciexWiff)
            .count(),
        1
    );

    // Repeating it reports the two that are in and refuses the one that is not.
    let again = service
        .adopt_output_set(&converted.ticket)
        .expect("the ticket survives an attempt");
    assert_eq!(
        set_adoption_kinds(&again.outcomes),
        vec!["already", "already", "refused"]
    );
    assert_eq!(set_refusal_reasons(&again.outcomes), vec!["workspace_full"]);
    assert_eq!(service.dataset_count(), MAX_WORKSPACE_DATASETS);
    assert_eq!(service.next_dataset_identifier(), identifiers_before + 1);
}

/// A genuinely partially finalized conversion mints no ticket, and keeps every
/// file it published.
///
/// This is the outcome the whole `PartiallyFinalized` policy is about, and it
/// takes a seam to reach honestly. The lifecycle checks the complete
/// destination name set before it publishes anything, so the only way a rename
/// fails after an earlier one succeeded is for the name to be taken in between
/// -- a race against another process. Occupying it through the publication seam
/// is that race, made deterministic; the failure is still the real no-clobber
/// rename refusing a real occupied name.
///
/// Distinguish this from `a_whole_set_conflict_refuses_before_publication`,
/// which occupies a name *before* the run and is refused by the preflight with
/// nothing published at all. The two mean opposite things and only this one is
/// a partial result.
#[test]
fn a_truly_partially_finalized_conversion_mints_no_ticket() {
    let fixture = TestFile::new("set-truly-partial");
    let acquisition = fixture.sciex_bundle("acquisition");
    let destination = fixture.destination("out");
    let names = ["a-S1.mzML", "a-S2.mzML", "a-S3.mzML"];

    // A file the user already had, somewhere the conversion will not touch.
    let bystander = destination.join("notes.txt");
    fs::write(&bystander, b"the user's own file").expect("write a bystander");

    let service = output_set_service(FakeOutputSetRunner::writing(&names));
    let dataset = service
        .add_sciex_wiff_dataset(&acquisition)
        .expect("the bundle is admitted");
    let raced = destination.join("a-S2.mzML");
    let conversion = service
        .convert_workspace_sciex_bundle_seamed(
            &dataset.handle,
            &destination,
            ConflictPolicy::Fail,
            &mut |position| {
                if position == 1 {
                    fs::write(&raced, b"raced in after the preflight")
                        .expect("occupy the second name mid-set");
                }
            },
        )
        .expect("the conversion reaches an outcome");

    // 1. The typed outcome really is partial, not a refusal wearing its name.
    assert_eq!(conversion.report().group_outcome(), "partially_finalized");
    assert!(
        conversion.report().refusal_id().is_none(),
        "a partial publication is not a refusal"
    );
    let partial = conversion
        .report()
        .partial_finalization()
        .expect("a partial outcome carries its facts");
    assert_eq!(partial.finalized(), ["a-S1.mzML"]);
    assert_eq!(partial.failed_member(), "a-S2.mzML");
    assert_eq!(partial.kind(), std::io::ErrorKind::AlreadyExists);
    assert_eq!(partial.not_published(), ["a-S2.mzML", "a-S3.mzML"]);

    // 2. The prefix was published and retained; the rest was not.
    assert_eq!(conversion.retained().len(), 1, "exactly the prefix");
    let states: Vec<(&str, &str)> = conversion
        .report()
        .members()
        .iter()
        .map(|member| (member.file_name(), member.state()))
        .collect();
    assert_eq!(
        states,
        vec![
            ("a-S1.mzML", "finalized"),
            ("a-S2.mzML", "validated_not_published"),
            ("a-S3.mzML", "validated_not_published"),
        ],
        "every member was validated; only the first was published"
    );

    // 3. Completeness is explicitly withdrawn rather than left to look true.
    assert_eq!(
        conversion.report().completeness().map(|c| c.stable_id()),
        Some("source_sample_set_not_fully_published")
    );

    // 4. The published prefix is on disk, and nothing rolled it back.
    let published = destination.join("a-S1.mzML");
    let published_bytes = fs::read(&published).expect("the prefix is a real file");
    assert!(!published_bytes.is_empty());
    assert!(
        !destination.join("a-S3.mzML").exists(),
        "the unpublished remainder must not appear"
    );
    // The racer's file and the bystander are untouched.
    assert_eq!(
        fs::read(&raced).expect("read the racer's file"),
        b"raced in after the preflight"
    );
    assert_eq!(
        fs::read(&bystander).expect("read the bystander"),
        b"the user's own file"
    );

    // 5. No complete-set ticket exists for it.
    let refused = service
        .output_set_adoption_ticket(conversion)
        .expect_err("a set that did not publish whole is not adoptable");
    assert_eq!(refused.kind, "output_set_not_fully_finalized");
    assert_eq!(service.dataset_count(), 1, "only the acquisition");

    // 6. Dropping every report, ticket and service deletes no finalized file.
    drop(service);
    assert_eq!(
        fs::read(&published).expect("the prefix survives the session"),
        published_bytes
    );

    // 7. And it is an ordinary mzML the user can add the ordinary way, which is
    //    the whole reason nothing here rolls it back.
    let later = output_set_service(FakeOutputSetRunner::writing(&["unused.mzML"]));
    let added = later
        .add_files(std::slice::from_ref(&published))
        .expect("an ordinary mzML is admitted");
    assert_eq!(added.roster.datasets.len(), 1);
    assert_eq!(
        added.roster.datasets[0].source_kind,
        DatasetSourceKindDto::Mzml
    );
    assert_eq!(
        fs::read(&published).expect("still there after admission"),
        published_bytes
    );
}

/// A name occupied *before* the run refuses the whole set before publication,
/// and mints no ticket.
///
/// Named for what it measures. An earlier version of this test was called
/// partial finalization, and it is not: the lifecycle preflights the complete
/// destination name set before it publishes anything, so an already-occupied
/// name under `Fail` stops the run with **zero** members published. Real
/// partial finalization needs the name to be taken between that preflight and
/// a member's rename, which is
/// `a_truly_partially_finalized_conversion_mints_no_ticket`.
#[test]
fn a_whole_set_conflict_refuses_before_publication() {
    let fixture = TestFile::new("set-occupied");
    let acquisition = fixture.sciex_bundle("acquisition");
    let destination = fixture.destination("out");

    // The second member's destination name is already taken by something the
    // conversion did not write.
    let occupied = destination.join("a-S2.mzML");
    fs::write(&occupied, b"a file the user already had").expect("occupy the second name");
    let occupied_bytes = fs::read(&occupied).expect("read it");

    let service = output_set_service(FakeOutputSetRunner::writing(&["a-S1.mzML", "a-S2.mzML"]));
    let dataset = service
        .add_sciex_wiff_dataset(&acquisition)
        .expect("the bundle is admitted");
    let conversion = service
        .convert_workspace_sciex_bundle(&dataset.handle, &destination, ConflictPolicy::Fail)
        .expect("the conversion reaches an outcome");

    // Refused whole, with nothing published and nothing partial.
    assert_eq!(
        conversion.report().group_outcome(),
        "refused_before_publication"
    );
    assert_eq!(
        conversion.report().refusal_id(),
        Some("multi_output_destination_occupied")
    );
    assert!(
        conversion.report().partial_finalization().is_none(),
        "nothing was published, so nothing is partial"
    );
    assert!(conversion.retained().is_empty());
    assert!(
        !destination.join("a-S1.mzML").exists(),
        "the first member must not publish around the conflict"
    );

    let refused = service
        .output_set_adoption_ticket(conversion)
        .expect_err("an unpublished set is not an adoptable set");
    assert_eq!(refused.kind, "output_set_not_fully_finalized");

    // Nothing was added, and the file that was already there is untouched.
    assert_eq!(service.dataset_count(), 1, "only the acquisition");
    assert_eq!(fs::read(&occupied).expect("read it again"), occupied_bytes);
}

/// A run that never established sample completeness mints no ticket either.
#[test]
fn an_incomplete_acquisition_mints_no_ticket() {
    let fixture = TestFile::new("set-incomplete");
    let acquisition = fixture.sciex_bundle("acquisition");
    let destination = fixture.destination("out");
    let service = output_set_service(
        FakeOutputSetRunner::writing(&["a-S1.mzML"]).complaining(READER_LOST_A_SAMPLE),
    );
    let dataset = service
        .add_sciex_wiff_dataset(&acquisition)
        .expect("the bundle is admitted");
    let conversion = service
        .convert_workspace_sciex_bundle(&dataset.handle, &destination, ConflictPolicy::Fail)
        .expect("the run reaches an outcome");

    // M3.13 refuses this before publication, so there is nothing to adopt and
    // the ticket refuses for the outcome rather than for the completeness.
    assert_eq!(
        conversion.report().group_outcome(),
        "refused_before_publication"
    );
    assert!(conversion.retained().is_empty());
    let refused = service
        .output_set_adoption_ticket(conversion)
        .expect_err("a refused run is not an adoptable set");
    assert_eq!(refused.kind, "output_set_not_fully_finalized");
    assert_eq!(service.dataset_count(), 1);
    assert!(entry_names(&destination).is_empty());
}

/// A skipped set has no finalized objects of its own and is not adoptable.
#[test]
fn a_skipped_set_is_not_adoptable() {
    let (_fixture, converted) = converted_output_set("set-skipped", &["a-S1.mzML"]);
    // The first run published; a second run under Skip finds the name taken.
    let conversion = converted
        .service
        .convert_workspace_sciex_bundle(
            &converted.source,
            &converted.destination,
            ConflictPolicy::Skip,
        )
        .expect("the second run reaches an outcome");
    assert_eq!(
        conversion.report().group_outcome(),
        "skipped_existing_destinations"
    );
    assert!(
        conversion.retained().is_empty(),
        "a skipped run finalized nothing of its own"
    );

    let refused = converted
        .service
        .output_set_adoption_ticket(conversion)
        .expect_err("a skipped run is not an adoptable set");
    assert_eq!(refused.kind, "output_set_not_fully_finalized");
}

/// Adoption launches no process and takes no backend gate.
///
/// Structural in the implementation -- there is no provider call in it -- and
/// pinned here because it is the invariant that lets a session which has
/// stopped trusting its backend still take its outputs.
#[test]
fn adopting_a_set_launches_no_process() {
    let fixture = TestFile::new("set-no-process");
    let acquisition = fixture.sciex_bundle("acquisition");
    let destination = fixture.destination("out");
    let runner = FakeOutputSetRunner::writing(&["a-S1.mzML", "a-S2.mzML"]);
    let launches = runner.launches();
    let service = output_set_service(runner);
    let dataset = service
        .add_sciex_wiff_dataset(&acquisition)
        .expect("the bundle is admitted");
    let conversion = service
        .convert_workspace_sciex_bundle(&dataset.handle, &destination, ConflictPolicy::Fail)
        .expect("the conversion reaches an outcome");
    let ticket = service
        .output_set_adoption_ticket(conversion)
        .expect("a complete set mints a ticket");
    assert_eq!(
        launches.load(Ordering::SeqCst),
        1,
        "the conversion ran once"
    );

    service.adopt_output_set(&ticket).expect("the set adopts");
    service.adopt_output_set(&ticket).expect("and again");

    assert_eq!(
        launches.load(Ordering::SeqCst),
        1,
        "adoption launched a process"
    );
    // And no adopted row is holding preview state: reading a file stays a
    // separate action the user takes.
    for dataset in service.roster().datasets {
        assert!(
            !service.holds_preview_state(&dataset.handle),
            "adoption previewed a row"
        );
    }
}

/// A real ten-sample SCIEX acquisition, converted and then adopted whole.
///
/// The evidence run for ADR 0025, kept out of ordinary CI: it needs a local
/// ProteoWizard installation and a lawful acquisition, neither of which a test
/// runner has.
#[cfg(windows)]
#[test]
#[ignore = "needs a local ProteoWizard installation and a real vendor acquisition"]
fn a_real_sciex_output_set_is_adopted_into_the_workspace() {
    let Ok(fixture) = std::env::var("MSCANVAS_SCIEX_WIFF_FIXTURE") else {
        panic!("set MSCANVAS_SCIEX_WIFF_FIXTURE to the .wiff to convert");
    };
    let Ok(destination) = std::env::var("MSCANVAS_CONVERSION_DESTINATION") else {
        panic!("set MSCANVAS_CONVERSION_DESTINATION to an empty folder");
    };
    let expected: usize = std::env::var("MSCANVAS_SCIEX_EXPECTED_OUTPUTS")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(1);
    let acquisition = PathBuf::from(fixture);
    let destination = PathBuf::from(destination);

    // The production provider. Nothing is substituted.
    let service = PreviewService::new(Box::new(super::backend::ProteoWizardProvider::new()));
    let dataset = service
        .add_sciex_wiff_dataset(&acquisition)
        .expect("the acquisition is admitted as a SCIEX bundle");
    let conversion = service
        .convert_workspace_sciex_bundle(&dataset.handle, &destination, ConflictPolicy::Fail)
        .expect("the conversion reaches an outcome");

    assert_eq!(conversion.report().group_outcome(), "fully_finalized");
    assert_eq!(conversion.report().published_count(), expected);
    assert_eq!(
        conversion.retained().len(),
        expected,
        "one retained object per member"
    );
    let completeness = conversion
        .report()
        .completeness()
        .and_then(mscanvas_proteowizard::SciexSampleCompleteness::established)
        .expect("a complete acquisition establishes completeness");
    assert_eq!(completeness.sample_count(), expected);

    let ticket = service
        .output_set_adoption_ticket(conversion)
        .expect("a complete, sample-complete set mints a ticket");
    assert_eq!(ticket.len(), expected);
    println!("ticket: {ticket:?}");

    let result = service
        .adopt_output_set(&ticket)
        .expect("the set adopts into the workspace");
    println!(
        "adopted {} of {} members",
        result.outcomes.len(),
        result.members
    );
    assert_eq!(
        set_adoption_kinds(&result.outcomes),
        vec!["added"; expected]
    );
    assert_eq!(
        service.dataset_count(),
        expected + 1,
        "the acquisition plus one row per output"
    );

    // Every adopted row is an ordinary mzML, and the acquisition is still one
    // logical bundle row.
    for dataset_row in &service.roster().datasets {
        if dataset_row.handle == dataset.handle {
            assert_eq!(dataset_row.source_kind, DatasetSourceKindDto::SciexWiff);
        } else {
            assert_eq!(dataset_row.source_kind, DatasetSourceKindDto::Mzml);
        }
        assert!(
            !service.holds_preview_state(&dataset_row.handle),
            "adoption previewed a row"
        );
    }

    // Neither the ticket nor the result names a location.
    for rendered in [format!("{ticket:?}"), format!("{result:?}")] {
        assert!(!rendered.contains(":\\"), "a path escaped: {rendered}");
    }

    // Again: every member is already there, and nothing is added twice.
    let again = service
        .adopt_output_set(&ticket)
        .expect("a repeated adoption reaches an outcome");
    assert_eq!(
        set_adoption_kinds(&again.outcomes),
        vec!["already"; expected]
    );
    assert_eq!(service.dataset_count(), expected + 1);
    println!("repeat adoption reported every member as already in the workspace");
}

/// A fully finalized set whose completeness was never established mints no
/// ticket.
///
/// Unreachable through the SCIEX path, which refuses before publication, and
/// that is exactly why the gate is here: another family's multi-output run, or
/// the evidence entry point that is never asked, would arrive fully finalized
/// with nothing said about samples.
#[test]
fn a_set_without_established_completeness_mints_no_ticket() {
    let fixture = TestFile::new("set-no-completeness");
    let acquisition = fixture.sciex_bundle("acquisition");
    let destination = fixture.destination("out");
    let service = output_set_service(FakeOutputSetRunner::writing(&["a-S1.mzML", "a-S2.mzML"]));
    let dataset = service
        .add_sciex_wiff_dataset(&acquisition)
        .expect("the bundle is admitted");
    let conversion = service
        .convert_workspace_sciex_bundle(&dataset.handle, &destination, ConflictPolicy::Fail)
        .expect("the conversion reaches an outcome");
    assert_eq!(conversion.report().group_outcome(), "fully_finalized");

    let refused = service
        .output_set_adoption_ticket(conversion.without_completeness())
        .expect_err("a set with no completeness evidence is not adoptable");
    assert_eq!(refused.kind, "output_set_completeness_not_established");
    assert_eq!(service.dataset_count(), 1);
}

/// A report and its retained objects that do not pair mint no ticket.
#[test]
fn a_set_whose_members_do_not_pair_mints_no_ticket() {
    let fixture = TestFile::new("set-unpaired");
    let acquisition = fixture.sciex_bundle("acquisition");
    let destination = fixture.destination("out");
    let service = output_set_service(FakeOutputSetRunner::writing(&["a-S1.mzML", "a-S2.mzML"]));
    let dataset = service
        .add_sciex_wiff_dataset(&acquisition)
        .expect("the bundle is admitted");
    let conversion = service
        .convert_workspace_sciex_bundle(&dataset.handle, &destination, ConflictPolicy::Fail)
        .expect("the conversion reaches an outcome");
    assert_eq!(conversion.retained().len(), 2);

    // Two objects, one reported member: nothing here could be paired safely,
    // and guessing which object belongs to which name is the one thing worse
    // than refusing.
    let refused = service
        .output_set_adoption_ticket(conversion.without_last_member())
        .expect_err("a set that does not pair is not adoptable");
    assert_eq!(refused.kind, "output_set_members_do_not_pair");
    assert_eq!(service.dataset_count(), 1);
}

/// A conversion run by one session cannot be minted into a ticket by another.
///
/// The ticket's own issuer check cannot catch this: minting resolves the source
/// row out of the report by `DatasetId`, and ids are allocated per session from
/// zero, so a second session holding that number resolves its own unrelated row
/// and then stamps the ticket with itself. The result would be internally
/// consistent and wrong — a ticket naming one acquisition, carrying another's
/// files.
#[test]
fn a_conversion_from_another_session_mints_no_ticket() {
    let fixture = TestFile::new("set-foreign-conversion");
    let acquisition = fixture.sciex_bundle("acquisition");
    let destination = fixture.destination("out");
    let service = output_set_service(FakeOutputSetRunner::writing(&["a-S1.mzML"]));
    let dataset = service
        .add_sciex_wiff_dataset(&acquisition)
        .expect("the bundle is admitted");
    let conversion = service
        .convert_workspace_sciex_bundle(&dataset.handle, &destination, ConflictPolicy::Fail)
        .expect("the conversion reaches an outcome");

    // A second session that has allocated the same id for something else.
    let elsewhere = TestFile::new("set-foreign-conversion-b");
    let other = output_set_service(FakeOutputSetRunner::writing(&["unused.mzML"]));
    other
        .add_files(&[elsewhere.readable_mzml("unrelated.mzML")])
        .expect("an ordinary mzML is admitted");

    let refused = other
        .output_set_adoption_ticket(conversion)
        .expect_err("another session's conversion is not this one's to ticket");
    assert_eq!(refused.kind, "outputs_not_adoptable");
}

/// A ticket minted by one session cannot be adopted by another.
///
/// `DatasetId`s are allocated per service from zero, so the same number names
/// different rows in two of them. Adopting A's ticket in B would commit A's
/// outputs against whatever row happens to hold that number in B, carrying A's
/// display name and family with them.
#[test]
fn a_ticket_from_another_session_is_refused() {
    let (_fixture, converted) = converted_output_set("set-other-session", &["a-S1.mzML"]);

    // A second session that holds a row of its own, so the numbering collides.
    let elsewhere = TestFile::new("set-other-session-b");
    let other = output_set_service(FakeOutputSetRunner::writing(&["unused.mzML"]));
    other
        .add_files(&[elsewhere.readable_mzml("unrelated.mzML")])
        .expect("an ordinary mzML is admitted");
    let before = other.dataset_count();

    let refused = other
        .adopt_output_set(&converted.ticket)
        .expect_err("another session's ticket is not this workspace's to adopt");
    assert_eq!(refused.kind, "outputs_not_adoptable");
    assert_eq!(other.dataset_count(), before, "it added a row anyway");

    // And the ticket still works where it belongs.
    let result = converted
        .service
        .adopt_output_set(&converted.ticket)
        .expect("the minting session adopts it");
    assert_eq!(set_adoption_kinds(&result.outcomes), vec!["added"]);
}

/// Decrements the live count when one fake process ends.
struct LiveProcess(Arc<AtomicUsize>);

impl Drop for LiveProcess {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

/// The basenames directly inside `directory`.
fn entry_names_in(directory: &Path) -> Vec<String> {
    fs::read_dir(directory)
        .expect("read the destination")
        .map(|entry| {
            entry
                .expect("a destination entry")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Private SCIEX serial-queue integration (ADR 0026)
//
// One acquisition is one queue item even when the backend writes twenty-four
// documents for it. Everything below drives the *real* queue -- the same slot,
// the same worker, the same backend lane, the same stop and retry rules the
// visible workflow uses -- through a private admission that the shipped binary
// cannot reach.
// ---------------------------------------------------------------------------

/// Builds a session whose provider runs `runner`, and admits one SCIEX bundle.
fn private_sciex_queue(
    label: &str,
    runner: FakeOutputSetRunner,
) -> (TestFile, Arc<PreviewService>, String, PathBuf) {
    let fixture = TestFile::new(label);
    let acquisition = fixture.sciex_bundle("acquisition");
    let destination = fixture.destination("out");
    let service = Arc::new(output_set_service(runner));
    let dataset = service
        .add_sciex_wiff_dataset(&acquisition)
        .expect("the bundle is admitted");
    (fixture, service, dataset.handle, destination)
}

/// Runs one private queue of `handles` to its own end.
fn run_visible_queue(
    service: &PreviewService,
    handles: &[String],
    destination: &Path,
    conflict: ConversionConflictPolicyDto,
) -> WorkspaceConversionUpdateDto {
    let document = service.workspace_drop_document_epoch();
    let reservation = service
        .begin_conversion_queue(handles, conflict, document)
        .expect("the queue is admitted");
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("the reservation is claimed");
    service.run_claimed_conversion(operation, destination)
}

/// Which queue item each adoption outcome belongs to, in order.
fn adoption_item_indexes(outcomes: &[WorkspaceOutputAdoptionOutcomeDto]) -> Vec<usize> {
    outcomes
        .iter()
        .map(|outcome| match outcome {
            WorkspaceOutputAdoptionOutcomeDto::Added { candidate, .. }
            | WorkspaceOutputAdoptionOutcomeDto::AlreadyInWorkspace { candidate, .. }
            | WorkspaceOutputAdoptionOutcomeDto::Refused { candidate, .. } => candidate.item_index,
        })
        .collect()
}

/// The `(item, member)` identity of each adoption outcome, in order.
fn adoption_identities(outcomes: &[WorkspaceOutputAdoptionOutcomeDto]) -> Vec<(usize, usize)> {
    outcomes
        .iter()
        .map(|outcome| match outcome {
            WorkspaceOutputAdoptionOutcomeDto::Added { candidate, .. }
            | WorkspaceOutputAdoptionOutcomeDto::AlreadyInWorkspace { candidate, .. }
            | WorkspaceOutputAdoptionOutcomeDto::Refused { candidate, .. } => {
                (candidate.item_index, candidate.member_index)
            }
        })
        .collect()
}

/// How many outputs one terminal queue offers to adopt, as the wire states it.
fn adoptable_output_count(update: &WorkspaceConversionUpdateDto) -> usize {
    terminal_queue(update).adoptable_output_count
}

/// Adopts a terminal queue's outputs through the visible action.
///
/// The same command the interface calls, named here so a test reads as what a
/// user does. There is no queue-held private adoption any more: a set authority
/// is expanded into member candidates inside this one.
fn adopt_visible(
    service: &PreviewService,
    operation: u64,
) -> Result<super::dto::WorkspaceOutputAdoptionResultDto, super::dto::PreviewErrorDto> {
    let document = service.workspace_drop_document_epoch();
    service.adopt_conversion_outputs(&operation.to_string(), document)
}

/// The operation identifier of whatever the slot currently holds.
fn operation_of(update: &WorkspaceConversionUpdateDto) -> u64 {
    terminal_operation(update)
        .parse()
        .expect("a terminal queue names its operation")
}

/// A visible SCIEX item carries set topology and invents no output name.
///
/// The name is the thing this milestone must not produce. The acquisition's
/// stem, the sample count and the sample names are all within reach here, and
/// every one of them would be a filename MSCanvas made up for a document the
/// backend has not written. The wire has no field one could be put in.
#[test]
fn a_visible_sciex_item_carries_set_topology_and_no_output_name() {
    let (_fixture, service, handle, destination) = private_sciex_queue(
        "queue-topology",
        FakeOutputSetRunner::writing(&["a-S1.mzML"]),
    );
    let document = service.workspace_drop_document_epoch();

    // The visible planner takes the row, and says what it will produce.
    let plan = service
        .conversion_queue_plan(std::slice::from_ref(&handle))
        .expect("the visible planner takes a SCIEX row");
    assert_eq!(plan.items.len(), 1);
    assert_eq!(plan.items[0].source_kind, DatasetSourceKindDto::SciexWiff);
    assert_eq!(
        plan.items[0].output,
        super::dto::ConversionOutputPlanDto::BackendNamedSet {
            max_members: MAX_CONVERSION_OUTPUTS_PER_SOURCE
        },
        "the plan states the cardinality and names nothing"
    );
    assert_eq!(
        MAX_CONVERSION_OUTPUTS_PER_SOURCE, 24,
        "the stated bound is the lifecycle's own"
    );

    let reservation = service
        .begin_conversion_queue(
            std::slice::from_ref(&handle),
            ConversionConflictPolicyDto::Fail,
            document,
        )
        .expect("the visible queue is admitted");
    let update = service.conversion_state();
    let WorkspaceConversionStateDto::AwaitingDestination { queue, .. } = &update.state else {
        panic!("the queue is waiting for a folder: {:?}", update.state);
    };

    assert_eq!(queue.items.len(), 1, "one acquisition is one item");
    let item = &queue.items[0];
    assert_eq!(item.source_kind, DatasetSourceKindDto::SciexWiff);
    let super::dto::ConversionOutputPlanDto::BackendNamedSet { max_members } = &item.output else {
        panic!("a SCIEX item is a backend-named set: {:?}", item.output);
    };
    assert_eq!(*max_members, MAX_CONVERSION_OUTPUTS_PER_SOURCE);

    // Serialized, because a name absent from the type but present in the JSON
    // would be the same defect one layer down. The acquisition's stem must not
    // appear anywhere in the item's own output plan.
    let acquisition_stem = item
        .file_name
        .rsplit_once('.')
        .map_or(item.file_name.as_str(), |(stem, _)| stem);
    let wire = serde_json::to_string(&item.output).expect("the output plan serializes");
    assert!(
        !wire.contains(acquisition_stem),
        "no name may be derived from the acquisition: {wire}"
    );
    assert!(
        !wire.contains(".mzML"),
        "a set carries no filename at all: {wire}"
    );
    assert!(
        !wire.contains("fileName"),
        "and no field one could be put in: {wire}"
    );
    let _ = reservation;
    let _ = destination;
}

/// A settled set states its cardinality, its counts and its narrow claim.
///
/// The wire contract a surface renders from. What must be there is enough for
/// an honest sentence; what must not is any way to reach the acquisition, and
/// any claim wider than the one the audit supports.
#[test]
fn a_settled_set_carries_bounded_facts_and_the_narrow_completeness_claim() {
    let names: Vec<String> = (1..=3).map(|index| format!("a-S{index}.mzML")).collect();
    let borrowed: Vec<&str> = names.iter().map(String::as_str).collect();
    let (fixture, service, handle, destination) = private_sciex_queue(
        "queue-set-wire",
        FakeOutputSetRunner::writing(&borrowed).also_converting(),
    );
    let update = run_visible_queue(
        &service,
        std::slice::from_ref(&handle),
        &destination,
        ConversionConflictPolicyDto::Fail,
    );
    let queue = terminal_queue(&update);
    let item = &queue.items[0];

    assert_eq!(item.state, ConversionQueueItemStateDto::Finalized);
    assert!(
        item_report(item).is_none(),
        "a set item carries no single-output report"
    );
    let report = item_set_report(item).expect("a set item carries its group report");

    assert_eq!(report.group_outcome, "fully_finalized");
    assert_eq!(report.detailed_outcome, None);
    assert_eq!(report.max_members, MAX_CONVERSION_OUTPUTS_PER_SOURCE);
    assert_eq!(report.member_count, 3);
    assert_eq!(report.finalized_count, 3);
    assert_eq!(report.validated_not_published_count, 0);
    assert_eq!(report.not_published_count, 0);
    assert_eq!(
        report.bound_source_objects,
        Some(2),
        "primary and companion"
    );
    assert_eq!(report.member_file_names, names);
    assert_eq!(report.member_states, vec!["finalized"; 3]);
    assert_eq!(report.partial, None);
    assert!(report.complete_set_adoptable);
    assert_eq!(report.validation_mode, ValidationModeDto::OutputOnly);

    // The completeness claim is the narrow one, and it is not a boolean: it
    // names the audit that proved it and the count that audit concluded.
    let super::dto::ConversionSampleCompletenessDto::Established {
        method,
        sample_count,
    } = &report.completeness
    else {
        panic!(
            "a full run establishes completeness: {:?}",
            report.completeness
        );
    };
    assert_eq!(method, "reader_error_audit_v1");
    assert_eq!(*sample_count, 3);

    // The queue's own offer is a count of files, not of items.
    assert_eq!(adoptable_output_count(&update), 3);
    assert_eq!(queue.finalized_count, 1, "and its item counts stay sources");
    assert_eq!(queue.item_count, 1);

    // Serialized, the whole update names no location and no companion.
    let rendered = serde_json::to_string(&update).expect("the update serializes");
    for absent in [
        destination.to_string_lossy().as_ref(),
        fixture.directory.to_string_lossy().as_ref(),
        ".wiff.scan",
        "mscanvas-staging",
    ] {
        assert!(
            !rendered.contains(absent),
            "the wire must not carry {absent:?}"
        );
    }

    // And the ten member basenames the product deliberately shows are absent
    // from the debug rendering, which is the one that reaches a log.
    let debugged = format!("{report:?}");
    for name in &names {
        assert!(
            !debugged.contains(name.as_str()),
            "a member basename reached a debug string: {debugged}"
        );
    }
}

/// Ten outputs, one item, one process, one ticket, ten ordinary rows.
///
/// The whole vertical in one measurement.
#[test]
fn one_sciex_acquisition_is_one_queue_item_with_ten_outputs() {
    let names: Vec<String> = (1..=10).map(|index| format!("a-S{index}.mzML")).collect();
    let borrowed: Vec<&str> = names.iter().map(String::as_str).collect();
    let runner = FakeOutputSetRunner::writing(&borrowed);
    let launches = runner.launches();
    let (_fixture, service, handle, destination) = private_sciex_queue("queue-ten", runner);

    let update = run_visible_queue(
        &service,
        std::slice::from_ref(&handle),
        &destination,
        ConversionConflictPolicyDto::Fail,
    );
    let operation = operation_of(&update);
    let queue = terminal_queue(&update);

    // One item, one process, and the counts are item counts.
    assert_eq!(
        terminal_reason(&update),
        ConversionQueueTerminalReasonDto::Completed
    );
    assert_eq!(queue.items.len(), 1);
    assert_eq!(queue.item_count, 1, "ten documents are not ten items");
    assert_eq!(queue.finalized_count, 1);
    assert_eq!(queue.current_index, 1, "one item is done");
    assert_eq!(launches.load(Ordering::SeqCst), 1, "one msconvert run");
    assert_eq!(
        item_states(queue),
        vec![ConversionQueueItemStateDto::Finalized]
    );
    assert_eq!(queue.items[0].attempts, 1);

    // The set report the item kept, through the private accessor.
    let report = service
        .terminal_set_report(operation, 0)
        .expect("the item kept its group report");
    assert_eq!(report.group_outcome(), "fully_finalized");
    assert_eq!(report.published_count(), 10);
    assert_eq!(
        report
            .completeness()
            .and_then(SciexSampleCompleteness::established)
            .map(EstablishedSampleCompleteness::sample_count),
        Some(10)
    );

    // What the queue *offered* before anything was adopted, which is the number
    // the interface renders. Read here and compared with the outcomes below,
    // because these are two readings of one authority and an interface that
    // offered ten and received one would have promised the user work it could
    // not do. There is deliberately only one predicate behind both.
    let offered = adoptable_output_count(&update);
    assert_eq!(offered, 10, "the offer counts output files, not items");

    // One ticket over ten members, adopted through the visible action.
    let result =
        adopt_visible(&service, operation).expect("the terminal item holds a set to adopt");
    assert_eq!(set_adoption_kinds(&result.outcomes), vec!["added"; 10]);
    assert_eq!(
        result.outcomes.len(),
        offered,
        "the count the interface showed and the outcomes it received must agree"
    );
    // The lifecycle's own deterministic order, which is the staging
    // directory's and not the order the samples sit in the acquisition.
    // Deterministic is not scientific, and nothing here claims otherwise.
    let mut published = names.clone();
    published.sort();
    assert_eq!(set_output_names(&result.outcomes), published);
    assert_eq!(
        result
            .roster
            .datasets
            .iter()
            .filter(|dataset| dataset.source_kind == DatasetSourceKindDto::Mzml)
            .count(),
        10
    );
    assert_eq!(
        result
            .roster
            .datasets
            .iter()
            .filter(|dataset| dataset.source_kind == DatasetSourceKindDto::SciexWiff)
            .count(),
        1,
        "the acquisition is still one row"
    );
    assert_eq!(service.dataset_count(), 11);
    for dataset in &result.roster.datasets {
        assert!(
            !service.holds_preview_state(&dataset.handle),
            "adoption previews nothing"
        );
    }
    assert_eq!(
        launches.load(Ordering::SeqCst),
        1,
        "adoption launches nothing"
    );

    // Repeating it reports every member as already present.
    let again = adopt_visible(&service, operation).expect("the ticket survives an attempt");
    assert_eq!(set_adoption_kinds(&again.outcomes), vec!["already"; 10]);
    assert_eq!(service.dataset_count(), 11);

    // And the queue result is exactly what it was.
    let after = service.conversion_state();
    assert_eq!(terminal_queue(&after), queue);
}

/// A private mixed queue keeps its order and never runs two backends at once.
#[test]
fn a_mixed_private_queue_runs_serially_in_order() {
    let fixture = TestFile::new("queue-mixed");
    let destination = fixture.destination("out");
    let runner = FakeOutputSetRunner::writing(&["a-S1.mzML", "a-S2.mzML"]).also_converting();
    let launches = runner.launches();
    let concurrent = runner.concurrent();
    let service = Arc::new(output_set_service(runner));

    let thermo = service
        .add_thermo_dataset(&fixture.thermo_raw("one.raw"))
        .expect("a Thermo row");
    let sciex = service
        .add_sciex_wiff_dataset(&fixture.sciex_bundle("acquisition"))
        .expect("a SCIEX row");
    let shimadzu = service
        .add_shimadzu_dataset(&fixture.shimadzu_lcd("three.lcd"))
        .expect("a Shimadzu row");

    let update = run_visible_queue(
        &service,
        &[
            thermo.handle.clone(),
            sciex.handle.clone(),
            shimadzu.handle.clone(),
        ],
        &destination,
        ConversionConflictPolicyDto::Fail,
    );
    let queue = terminal_queue(&update);

    assert_eq!(
        terminal_reason(&update),
        ConversionQueueTerminalReasonDto::Completed
    );
    assert_eq!(queue.item_count, 3, "three sources, whatever they produced");
    assert_eq!(
        queue
            .items
            .iter()
            .map(|item| item.dataset_handle.as_str())
            .collect::<Vec<&str>>(),
        vec![
            thermo.handle.as_str(),
            sciex.handle.as_str(),
            shimadzu.handle.as_str()
        ],
        "visible order is run order"
    );
    assert_eq!(queue.finalized_count, 3);
    assert_eq!(launches.load(Ordering::SeqCst), 3, "one process per item");
    assert_eq!(
        concurrent.load(Ordering::SeqCst),
        1,
        "never two backends at once"
    );
    // Four documents in the folder, from three items.
    let mut written = entry_names_in(&destination);
    written.sort();
    assert_eq!(
        written,
        vec!["a-S1.mzML", "a-S2.mzML", "one.mzML", "three.mzML"]
    );
}

/// The queue's runtime output-name authority is bounded, and states its bound.
#[test]
fn the_queue_output_name_authority_is_bounded() {
    let fixture = TestFile::new("queue-bound");
    let destination = fixture.destination("out");
    let service = Arc::new(output_set_service(FakeOutputSetRunner::writing(&[
        "a-S1.mzML",
    ])));
    let mut handles = Vec::new();
    for index in 0..MAX_CONVERSION_QUEUE_ITEMS {
        let dataset = service
            .add_sciex_wiff_dataset(&fixture.sciex_bundle(&format!("acquisition-{index}")))
            .expect("a SCIEX row");
        handles.push(dataset.handle);
    }
    let document = service.workspace_drop_document_epoch();
    service
        .begin_conversion_queue(&handles, ConversionConflictPolicyDto::Fail, document)
        .expect("a full private queue is admitted");

    let (claimed, bound) = service
        .queue_output_name_authority()
        .expect("a bound queue has an authority");
    assert_eq!(
        bound,
        MAX_CONVERSION_QUEUE_ITEMS * MAX_CONVERSION_OUTPUTS_PER_SOURCE,
        "sixteen acquisitions of at most twenty-four documents each"
    );
    assert_eq!(bound, 384, "the bound is 384 with today's constants");
    assert!(
        claimed.is_empty(),
        "a set claims nothing before it has published"
    );
    let _ = destination;
}

/// The item's outcome, and whether the queue thinks another attempt could help.
fn item_outcome(queue: &ConversionQueueDto, index: usize) -> (ConversionQueueItemStateDto, bool) {
    let item = &queue.items[index];
    (item.state, item.retryable)
}

/// A queue whose SCIEX item fails is a failed item, not a failed queue.
///
/// Every refusal below produces one failed item with zero publication and no
/// authority to adopt anything, and lets the item behind it run.
fn a_failing_sciex_item_leaves_the_next_one_alone(
    label: &str,
    runner: FakeOutputSetRunner,
    expected_detail: &str,
) {
    let fixture = TestFile::new(label);
    let destination = fixture.destination("out");
    let service = Arc::new(output_set_service(runner.also_converting()));
    let sciex = service
        .add_sciex_wiff_dataset(&fixture.sciex_bundle("acquisition"))
        .expect("a SCIEX row");
    let thermo = service
        .add_thermo_dataset(&fixture.thermo_raw("after.raw"))
        .expect("a Thermo row");

    let update = run_visible_queue(
        &service,
        &[sciex.handle.clone(), thermo.handle.clone()],
        &destination,
        ConversionConflictPolicyDto::Fail,
    );
    let operation = operation_of(&update);
    let queue = terminal_queue(&update);

    assert_eq!(
        item_states(queue),
        vec![
            ConversionQueueItemStateDto::Failed,
            ConversionQueueItemStateDto::Finalized
        ],
        "{label}: the item behind a failure still runs"
    );
    let report = service
        .terminal_set_report(operation, 0)
        .expect("the failed item kept its group report");
    assert_eq!(
        report.published_count(),
        0,
        "{label}: nothing was published"
    );
    assert_eq!(report.refusal_id(), Some(expected_detail), "{label}");
    // The item behind it is adoptable; this one contributes nothing. An
    // adoption that refused outright would be the wrong assertion now, because
    // the queue has a finalized item and the action is the queue's.
    let adopted = adopt_visible(&service, operation).expect("the second item finalized");
    assert_eq!(
        adoption_item_indexes(&adopted.outcomes),
        vec![1],
        "{label}: a failed item has no set to adopt"
    );
    assert_eq!(
        entry_names_in(&destination),
        vec!["after.mzML"],
        "{label}: only the second item's output is in the folder"
    );
}

/// The staged set is not the set the backend said it wrote.
#[test]
fn a_declaration_mismatch_fails_one_item_and_runs_the_next() {
    a_failing_sciex_item_leaves_the_next_one_alone(
        "queue-undeclared",
        FakeOutputSetRunner::writing(&["a-S1.mzML"]).also_injecting("uninvited.mzML"),
        "multi_output_set_not_as_declared",
    );
}

/// The reader logged a per-sample failure, so nothing may be published.
#[test]
fn a_reader_sample_failure_refuses_the_item_before_publication() {
    a_failing_sciex_item_leaves_the_next_one_alone(
        "queue-sample-loss",
        FakeOutputSetRunner::writing(&["a-S1.mzML"]).complaining(READER_LOST_A_SAMPLE),
        "source_sample_failure_observed",
    );
}

/// The stream the audit needs was truncated, so completeness is not established.
#[test]
fn a_truncated_audit_stream_refuses_the_item() {
    let fixture = TestFile::new("queue-truncated");
    let destination = fixture.destination("out");
    let service = Arc::new(output_set_service(
        FakeOutputSetRunner::writing(&["a-S1.mzML"]).truncating_stderr(),
    ));
    let sciex = service
        .add_sciex_wiff_dataset(&fixture.sciex_bundle("acquisition"))
        .expect("a SCIEX row");

    let update = run_visible_queue(
        &service,
        std::slice::from_ref(&sciex.handle),
        &destination,
        ConversionConflictPolicyDto::Fail,
    );
    let operation = operation_of(&update);
    let queue = terminal_queue(&update);

    assert_eq!(
        item_states(queue),
        vec![ConversionQueueItemStateDto::Failed]
    );
    let report = service
        .terminal_set_report(operation, 0)
        .expect("the item kept its group report");
    assert_eq!(report.refusal_id(), Some("source_sample_audit_truncated"));
    assert_eq!(report.published_count(), 0);
    assert!(
        entry_names_in(&destination).is_empty(),
        "an unauditable run publishes nothing"
    );
    assert!(adopt_visible(&service, operation).is_err());
}

/// A member that is not a usable document refuses the whole set.
#[test]
fn an_invalid_member_publishes_nothing() {
    let fixture = TestFile::new("queue-invalid-member");
    let destination = fixture.destination("out");
    let service = Arc::new(output_set_service(
        FakeOutputSetRunner::writing(&["a-S1.mzML", "a-S2.mzML"]).with_empty_member("a-S2.mzML"),
    ));
    let sciex = service
        .add_sciex_wiff_dataset(&fixture.sciex_bundle("acquisition"))
        .expect("a SCIEX row");

    let update = run_visible_queue(
        &service,
        std::slice::from_ref(&sciex.handle),
        &destination,
        ConversionConflictPolicyDto::Fail,
    );
    let operation = operation_of(&update);

    let report = service
        .terminal_set_report(operation, 0)
        .expect("the item kept its group report");
    assert_eq!(report.refusal_id(), Some("multi_output_member_rejected"));
    assert_eq!(report.published_count(), 0, "all before any");
    assert!(
        entry_names_in(&destination).is_empty(),
        "the good member is not published around the bad one"
    );
    assert_eq!(
        item_outcome(terminal_queue(&update), 0),
        (ConversionQueueItemStateDto::Failed, false)
    );
}

/// Every destination name already occupied, under Skip, is a skipped item.
#[test]
fn a_set_whose_names_are_all_taken_is_skipped() {
    let fixture = TestFile::new("queue-all-taken");
    let destination = fixture.destination("out");
    for name in ["a-S1.mzML", "a-S2.mzML"] {
        fs::write(destination.join(name), b"the user converted this before")
            .expect("occupy a name");
    }
    let service = Arc::new(output_set_service(FakeOutputSetRunner::writing(&[
        "a-S1.mzML",
        "a-S2.mzML",
    ])));
    let sciex = service
        .add_sciex_wiff_dataset(&fixture.sciex_bundle("acquisition"))
        .expect("a SCIEX row");

    let update = run_visible_queue(
        &service,
        std::slice::from_ref(&sciex.handle),
        &destination,
        ConversionConflictPolicyDto::Skip,
    );
    let operation = operation_of(&update);
    let queue = terminal_queue(&update);

    assert_eq!(
        item_states(queue),
        vec![ConversionQueueItemStateDto::Skipped]
    );
    assert_eq!(queue.skipped_count, 1);
    let report = service
        .terminal_set_report(operation, 0)
        .expect("the item kept its group report");
    assert_eq!(report.group_outcome(), "skipped_existing_destinations");
    assert_eq!(report.published_count(), 0);
    // The files that were already there are not this run's outputs.
    assert!(
        adopt_visible(&service, operation).is_err(),
        "a skipped set offers nothing to adopt"
    );
    for name in ["a-S1.mzML", "a-S2.mzML"] {
        assert_eq!(
            fs::read(destination.join(name)).expect("read it again"),
            b"the user converted this before"
        );
    }
}

/// A strict subset occupied, under Skip, refuses the whole set.
#[test]
fn a_partly_occupied_set_is_refused_whole_under_skip() {
    let fixture = TestFile::new("queue-subset-taken");
    let destination = fixture.destination("out");
    fs::write(destination.join("a-S2.mzML"), b"one name was taken").expect("occupy one name");
    let service = Arc::new(output_set_service(FakeOutputSetRunner::writing(&[
        "a-S1.mzML",
        "a-S2.mzML",
    ])));
    let sciex = service
        .add_sciex_wiff_dataset(&fixture.sciex_bundle("acquisition"))
        .expect("a SCIEX row");

    let update = run_visible_queue(
        &service,
        std::slice::from_ref(&sciex.handle),
        &destination,
        ConversionConflictPolicyDto::Skip,
    );
    let operation = operation_of(&update);

    let report = service
        .terminal_set_report(operation, 0)
        .expect("the item kept its group report");
    assert_eq!(
        report.refusal_id(),
        Some("multi_output_mixed_destination_conflict")
    );
    assert_eq!(report.published_count(), 0);
    assert_eq!(
        entry_names_in(&destination),
        vec!["a-S2.mzML"],
        "the free name stays free"
    );
    assert_eq!(
        item_outcome(terminal_queue(&update), 0),
        (ConversionQueueItemStateDto::Failed, false)
    );
}

/// A discovered name another queue item owns is a queue collision, not a skip.
///
/// The distinction the conflict policy must never be allowed to settle. Under
/// `Skip`, calling this "already converted" would name somebody else's output
/// as this acquisition's own result.
#[test]
fn a_discovered_name_owned_by_another_item_is_a_queue_collision() {
    let fixture = TestFile::new("queue-name-claimed");
    let destination = fixture.destination("out");
    // The SCIEX backend will write exactly the name the Thermo row is planned
    // to produce.
    let service = Arc::new(output_set_service(
        FakeOutputSetRunner::writing(&["later.mzML"]).also_converting(),
    ));
    let sciex = service
        .add_sciex_wiff_dataset(&fixture.sciex_bundle("acquisition"))
        .expect("a SCIEX row");
    let thermo = service
        .add_thermo_dataset(&fixture.thermo_raw("later.raw"))
        .expect("a Thermo row");

    let update = run_visible_queue(
        &service,
        &[sciex.handle.clone(), thermo.handle.clone()],
        &destination,
        // Skip, deliberately: the policy that would otherwise call this a
        // successful skip of an acquisition that was already converted.
        ConversionConflictPolicyDto::Skip,
    );
    let operation = operation_of(&update);
    let queue = terminal_queue(&update);

    assert_eq!(
        item_states(queue),
        vec![
            ConversionQueueItemStateDto::Failed,
            ConversionQueueItemStateDto::Finalized
        ],
        "the set is refused and the item that owns the name runs"
    );
    assert_eq!(
        item_outcome(queue, 0),
        (ConversionQueueItemStateDto::Failed, false),
        "a queue collision is not retryable"
    );
    let report = service
        .terminal_set_report(operation, 0)
        .expect("the item kept its group report");
    assert_eq!(
        report.refusal_id(),
        Some("multi_output_output_name_claimed_elsewhere"),
        "named as a queue collision, not as a destination conflict"
    );
    assert_eq!(
        report.published_count(),
        0,
        "the set publishes none of its own"
    );
    assert_eq!(
        entry_names_in(&destination),
        vec!["later.mzML"],
        "the one document there is the Thermo item's"
    );
}

/// Two backend-named sets that discover one name: the second publishes nothing.
#[test]
fn a_second_set_discovering_the_same_name_publishes_nothing() {
    let fixture = TestFile::new("queue-two-sets");
    let destination = fixture.destination("out");
    let service = Arc::new(output_set_service(FakeOutputSetRunner::writing(&[
        "shared.mzML",
    ])));
    let first = service
        .add_sciex_wiff_dataset(&fixture.sciex_bundle("first"))
        .expect("the first SCIEX row");
    let second = service
        .add_sciex_wiff_dataset(&fixture.sciex_bundle("second"))
        .expect("the second SCIEX row");

    let update = run_visible_queue(
        &service,
        &[first.handle.clone(), second.handle.clone()],
        &destination,
        ConversionConflictPolicyDto::Skip,
    );
    let operation = operation_of(&update);
    let queue = terminal_queue(&update);

    assert_eq!(
        item_states(queue),
        vec![
            ConversionQueueItemStateDto::Finalized,
            ConversionQueueItemStateDto::Failed
        ]
    );
    assert_eq!(
        queue.skipped_count, 0,
        "the second set is not a successful skip of the first's output"
    );
    let second_report = service
        .terminal_set_report(operation, 1)
        .expect("the second item kept its group report");
    assert_eq!(
        second_report.refusal_id(),
        Some("multi_output_output_name_claimed_elsewhere")
    );
    assert_eq!(second_report.published_count(), 0);
    // The first item's document is a user file and is not rolled back.
    assert_eq!(entry_names_in(&destination), vec!["shared.mzML"]);
    let first_report = service
        .terminal_set_report(operation, 0)
        .expect("the first item kept its group report");
    assert_eq!(first_report.group_outcome(), "fully_finalized");
    // And only the first has anything to adopt: the colliding set published
    // none of its own members, so it offers none.
    let adopted = adopt_visible(&service, operation).expect("the first item finalized");
    assert_eq!(
        adoption_item_indexes(&adopted.outcomes),
        vec![0],
        "the colliding set contributes no adoption candidate"
    );
}

/// A known single output whose name an earlier set took refuses before running.
#[test]
fn a_single_output_item_refuses_a_name_an_earlier_set_took() {
    let fixture = TestFile::new("queue-set-took-it");
    let destination = fixture.destination("out");
    let runner = FakeOutputSetRunner::writing(&["later.mzML"]).also_converting();
    let launches = runner.launches();
    let service = Arc::new(output_set_service(runner));
    let sciex = service
        .add_sciex_wiff_dataset(&fixture.sciex_bundle("acquisition"))
        .expect("a SCIEX row");
    let thermo = service
        .add_thermo_dataset(&fixture.thermo_raw("later.raw"))
        .expect("a Thermo row");

    // The set runs first this time, so by the Thermo item's turn the name is
    // published rather than merely planned.
    let update = run_visible_queue(
        &service,
        &[sciex.handle.clone(), thermo.handle.clone()],
        &destination,
        ConversionConflictPolicyDto::Fail,
    );
    let queue = terminal_queue(&update);

    assert_eq!(
        item_states(queue),
        vec![
            ConversionQueueItemStateDto::Failed,
            ConversionQueueItemStateDto::Finalized
        ],
        "the set discovered the Thermo item's planned name and was refused"
    );
    assert_eq!(launches.load(Ordering::SeqCst), 2, "both items ran once");
    assert_eq!(entry_names_in(&destination), vec!["later.mzML"]);
}

/// Starts a private queue whose SCIEX item parks mid-run, then stops it.
///
/// Returns the terminal read, the service, and the launch counter, with the
/// worker joined. A SCIEX item, then a Thermo item behind it, so "no later item
/// launched" is a thing that can be observed rather than assumed.
fn stop_mid_sciex_item(
    label: &str,
    ending: StopEnding,
) -> (
    TestFile,
    PathBuf,
    Arc<PreviewService>,
    WorkspaceConversionUpdateDto,
    Arc<AtomicUsize>,
) {
    let fixture = TestFile::new(label);
    let destination = fixture.destination("out");
    let (runner, observed, release) = FakeOutputSetRunner::writing(&["a-S1.mzML", "a-S2.mzML"])
        .also_converting()
        .parked(ending);
    let launches = runner.launches();
    let service = Arc::new(output_set_service(runner));
    let sciex = service
        .add_sciex_wiff_dataset(&fixture.sciex_bundle("acquisition"))
        .expect("a SCIEX row");
    let thermo = service
        .add_thermo_dataset(&fixture.thermo_raw("after.raw"))
        .expect("a Thermo row");

    let document = service.workspace_drop_document_epoch();
    let reservation = service
        .begin_conversion_queue(
            &[sciex.handle.clone(), thermo.handle.clone()],
            ConversionConflictPolicyDto::Fail,
            document,
        )
        .expect("the private queue is admitted");
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("the reservation is claimed");

    let worker = {
        let service = Arc::clone(&service);
        let destination = destination.clone();
        std::thread::spawn(move || service.run_claimed_conversion(operation, &destination))
    };
    observed
        .recv_timeout(Duration::from_secs(10))
        .expect("the SCIEX backend started");
    let stopping = service
        .stop_conversion_queue(&operation.to_string(), document)
        .expect("the stop is accepted");
    assert!(
        matches!(stopping.state, WorkspaceConversionStateDto::Stopping { .. }),
        "{label}: the reply says stopping"
    );
    release.send(()).expect("release the parked backend");
    let update = worker.join().expect("the worker finishes");
    (fixture, destination, service, update, launches)
}

/// A confirmed stop cancels the running SCIEX item and starts no other.
#[test]
fn a_confirmed_stop_cancels_the_running_set_item() {
    let (_fixture, destination, service, update, launches) =
        stop_mid_sciex_item("queue-stop-confirmed", StopEnding::Confirmed);
    let operation = operation_of(&update);
    let queue = terminal_queue(&update);

    assert_eq!(
        terminal_reason(&update),
        ConversionQueueTerminalReasonDto::Stopped
    );
    assert_eq!(
        item_states(queue),
        vec![
            ConversionQueueItemStateDto::Cancelled,
            ConversionQueueItemStateDto::NotRun
        ]
    );
    assert_eq!(launches.load(Ordering::SeqCst), 1, "no later item launched");
    let cancellation = queue.items[0]
        .cancellation
        .as_ref()
        .expect("the cancelled item says what the stop established");
    assert!(cancellation.process_launched);
    assert!(cancellation.tree_termination_confirmed);
    assert!(
        cancellation.partial_output_observed,
        "the run says what it had staged when it was interrupted"
    );
    assert!(
        !service.backend_is_quarantined(),
        "a confirmed stop does not distrust the backend"
    );
    assert!(
        adopt_visible(&service, operation).is_err(),
        "a cancelled item has no set to adopt"
    );
    assert!(
        entry_names_in(&destination).is_empty(),
        "a stopped set published nothing"
    );
    // Not retryable, and the queue is not retryable in place.
    assert!(!queue.items[0].retryable);
    assert!(service.retry_conversion_queue(0).is_err());
}

/// An unconfirmed stop quarantines the backend and launches nothing else.
#[test]
fn an_unconfirmed_stop_of_a_set_quarantines_the_backend() {
    let (_fixture, _destination, service, update, launches) =
        stop_mid_sciex_item("queue-stop-unconfirmed", StopEnding::Unterminated);
    let operation = operation_of(&update);
    let queue = terminal_queue(&update);

    assert_eq!(
        terminal_reason(&update),
        ConversionQueueTerminalReasonDto::StopFailed
    );
    assert_eq!(
        item_states(queue),
        vec![
            ConversionQueueItemStateDto::CancellationFailed,
            ConversionQueueItemStateDto::NotRun
        ]
    );
    assert!(service.backend_is_quarantined());
    assert!(update.backend_quarantined);
    assert_eq!(launches.load(Ordering::SeqCst), 1);
    let cancellation = queue.items[0]
        .cancellation
        .as_ref()
        .expect("the item says what the stop could not establish");
    assert!(!cancellation.tree_termination_confirmed);
    assert!(adopt_visible(&service, operation).is_err());
    // Nothing further may run, at all.
    let document = service.workspace_drop_document_epoch();
    let refused = service
        .begin_conversion_queue(&[], ConversionConflictPolicyDto::Fail, document)
        .expect_err("a quarantined session admits no queue");
    assert_eq!(refused.kind, "backend_quarantined");
    assert_eq!(launches.load(Ordering::SeqCst), 1, "no probe, no process");
}

/// A stop after an earlier item finalized keeps that item's authority.
#[test]
fn a_stop_after_a_finalized_set_keeps_its_ticket() {
    let fixture = TestFile::new("queue-stop-after");
    let destination = fixture.destination("out");
    let (runner, observed, release) = FakeOutputSetRunner::writing(&["a-S1.mzML", "a-S2.mzML"])
        .also_converting()
        .parked_on_call(2, StopEnding::Confirmed);
    let service = Arc::new(output_set_service(runner));
    let sciex = service
        .add_sciex_wiff_dataset(&fixture.sciex_bundle("acquisition"))
        .expect("a SCIEX row");
    let thermo = service
        .add_thermo_dataset(&fixture.thermo_raw("after.raw"))
        .expect("a Thermo row");

    let document = service.workspace_drop_document_epoch();
    let reservation = service
        .begin_conversion_queue(
            &[sciex.handle.clone(), thermo.handle.clone()],
            ConversionConflictPolicyDto::Fail,
            document,
        )
        .expect("the private queue is admitted");
    let operation = service
        .claim_conversion(&reservation.reservation_id, document)
        .expect("the reservation is claimed");
    let worker = {
        let service = Arc::clone(&service);
        let destination = destination.clone();
        std::thread::spawn(move || service.run_claimed_conversion(operation, &destination))
    };
    observed
        .recv_timeout(Duration::from_secs(10))
        .expect("the second item started");
    service
        .stop_conversion_queue(&operation.to_string(), document)
        .expect("the stop is accepted");
    release.send(()).expect("release the parked backend");
    let update = worker.join().expect("the worker finishes");
    let queue = terminal_queue(&update);

    assert_eq!(
        terminal_reason(&update),
        ConversionQueueTerminalReasonDto::Stopped
    );
    assert_eq!(
        item_states(queue),
        vec![
            ConversionQueueItemStateDto::Finalized,
            ConversionQueueItemStateDto::Cancelled
        ]
    );
    // The finalized set keeps every bit of its authority.
    let result = adopt_visible(&service, operation)
        .expect("a stop later in the queue takes nothing from an earlier success");
    assert_eq!(set_adoption_kinds(&result.outcomes), vec!["added", "added"]);
}

/// A genuinely partially finalized SCIEX item, in the queue.
///
/// The one outcome the whole policy is about, and the only one that needs a
/// seam to reach: publication stops after a prefix because a name was taken
/// between the whole-set preflight and that member's rename.
#[test]
fn a_partially_finalized_set_item_fails_and_is_not_retryable() {
    let fixture = TestFile::new("queue-partial");
    let destination = fixture.destination("out");
    let raced = destination.join("a-S2.mzML");
    let runner =
        FakeOutputSetRunner::writing(&["a-S1.mzML", "a-S2.mzML", "a-S3.mzML"]).also_converting();
    let service = Arc::new(output_set_service(runner));
    // The race, made deterministic: the second member's destination name is
    // taken after the whole-set preflight found it free and before its rename.
    let occupied = raced.clone();
    service.race_next_publication(move |position| {
        if position == 1 {
            fs::write(&occupied, b"raced in after the preflight")
                .expect("occupy the second name mid-set");
        }
    });
    let sciex = service
        .add_sciex_wiff_dataset(&fixture.sciex_bundle("acquisition"))
        .expect("a SCIEX row");
    let thermo = service
        .add_thermo_dataset(&fixture.thermo_raw("after.raw"))
        .expect("a Thermo row");

    let update = run_visible_queue(
        &service,
        &[sciex.handle.clone(), thermo.handle.clone()],
        &destination,
        ConversionConflictPolicyDto::Fail,
    );
    let operation = operation_of(&update);
    let queue = terminal_queue(&update);

    // Failed, explicitly partial, and never retryable.
    assert_eq!(
        item_states(queue),
        vec![
            ConversionQueueItemStateDto::Failed,
            ConversionQueueItemStateDto::Finalized
        ],
        "a partial publication does not stop the item behind it"
    );
    assert_eq!(
        item_outcome(queue, 0),
        (ConversionQueueItemStateDto::Failed, false),
        "a published prefix must never be rerun"
    );
    assert!(
        !queue.error.is_some(),
        "one item failing is not a queue failure"
    );
    let report = service
        .terminal_set_report(operation, 0)
        .expect("the item kept its group report");
    assert_eq!(report.group_outcome(), "partially_finalized");
    let partial = report
        .partial_finalization()
        .expect("a partial outcome carries its facts");
    assert_eq!(partial.finalized(), ["a-S1.mzML"]);
    assert_eq!(partial.not_published(), ["a-S2.mzML", "a-S3.mzML"]);

    // The prefix is a real user file, kept.
    assert_eq!(
        fs::read(&raced).expect("the racer's file"),
        b"raced in after the preflight"
    );
    let published = destination.join("a-S1.mzML");
    let bytes = fs::read(&published).expect("the prefix is on disk");
    assert!(!bytes.is_empty());
    assert!(!destination.join("a-S3.mzML").exists());

    // No complete-set authority for the prefix, and a retry is not offered for
    // it. The Thermo item behind it is complete and stays adoptable: the
    // partial acquisition is excluded from the offer, not the queue.
    assert_eq!(
        adoptable_output_count(&update),
        1,
        "the finalized prefix contributes no complete-set candidate"
    );
    let adopted = adopt_visible(&service, operation).expect("the Thermo item is complete");
    assert_eq!(
        adoption_identities(&adopted.outcomes),
        vec![(1, 0)],
        "only the complete item offers an output"
    );
    assert_eq!(queue.retryable_failed_count, 0);
    assert!(service.retry_conversion_queue(0).is_err());

    // And dropping the whole session deletes nothing it published.
    drop(service);
    assert_eq!(fs::read(&published).expect("still there"), bytes);
}

/// A retryable pre-run failure reruns only that item, with a new attempt.
#[test]
fn a_retryable_set_failure_reruns_only_that_item() {
    let fixture = TestFile::new("queue-retry");
    let destination = fixture.destination("out");
    let runner = FakeOutputSetRunner::writing(&["a-S1.mzML"]).also_converting();
    let launches = runner.launches();
    let service = Arc::new(output_set_service(runner));
    let acquisition = fixture.sciex_bundle("acquisition");
    let sciex = service
        .add_sciex_wiff_dataset(&acquisition)
        .expect("a SCIEX row");
    let thermo = service
        .add_thermo_dataset(&fixture.thermo_raw("after.raw"))
        .expect("a Thermo row");

    // The acquisition is held open by somebody else for the first pass, which
    // is the one condition this repository has measured as transient.
    let held = hold_for_writing(&acquisition);

    let update = run_visible_queue(
        &service,
        &[sciex.handle.clone(), thermo.handle.clone()],
        &destination,
        ConversionConflictPolicyDto::Fail,
    );
    let queue = terminal_queue(&update);
    assert_eq!(
        item_outcome(queue, 0),
        (ConversionQueueItemStateDto::Failed, true),
        "a file somebody else holds is worth another attempt"
    );
    assert_eq!(queue.items[0].attempts, 1);
    assert_eq!(queue.items[1].state, ConversionQueueItemStateDto::Finalized);
    let after_first = launches.load(Ordering::SeqCst);

    drop(held);
    let retried = service
        .retry_conversion_queue(service.workspace_drop_document_epoch())
        .expect("an ordinary completed queue with a retryable failure is retryable");
    let queue = terminal_queue(&retried);
    assert_eq!(
        item_states(queue),
        vec![
            ConversionQueueItemStateDto::Finalized,
            ConversionQueueItemStateDto::Finalized
        ]
    );
    assert_eq!(queue.items[0].attempts, 2, "only the failure reran");
    assert_eq!(queue.items[1].attempts, 1, "a success is never rerun");
    assert_eq!(
        launches.load(Ordering::SeqCst),
        after_first + 1,
        "exactly one more process"
    );
}

/// A retried set attempt gets a new identity, and inherits nothing.
///
/// The old report, the old retained objects and the old authority all go with
/// the attempt that produced them. What proves it is the run identity: it is
/// allocated when a conversion finishes, so a second attempt that reused the
/// first's would be describing itself with the first's facts.
#[test]
fn a_retried_set_attempt_reuses_no_identity_or_ticket() {
    let fixture = TestFile::new("queue-retry-identity");
    let destination = fixture.destination("out");
    let service = Arc::new(output_set_service(FakeOutputSetRunner::writing(&[
        "a-S1.mzML",
    ])));
    let acquisition = fixture.sciex_bundle("acquisition");
    let sciex = service
        .add_sciex_wiff_dataset(&acquisition)
        .expect("a SCIEX row");

    let held = hold_for_writing(&acquisition);
    let update = run_visible_queue(
        &service,
        std::slice::from_ref(&sciex.handle),
        &destination,
        ConversionConflictPolicyDto::Fail,
    );
    let operation = operation_of(&update);
    assert_eq!(
        item_outcome(terminal_queue(&update), 0),
        (ConversionQueueItemStateDto::Failed, true)
    );
    // The refusal never reached a conversion, so there is no run to name and
    // nothing to adopt.
    assert_eq!(service.terminal_set_run(operation, 0), None);
    assert!(adopt_visible(&service, operation).is_err());

    drop(held);
    let retried = service
        .retry_conversion_queue(service.workspace_drop_document_epoch())
        .expect("a retryable failure is retryable");
    let queue = terminal_queue(&retried);
    assert_eq!(
        item_states(queue),
        vec![ConversionQueueItemStateDto::Finalized]
    );
    assert_eq!(queue.items[0].attempts, 2);
    // The second attempt names itself. The first never reached a conversion,
    // so there was no identity for this one to inherit -- which is the half of
    // the rule this arrangement can measure directly.
    let run = service
        .terminal_set_run(operation, 0)
        .expect("the second attempt names itself");

    let result = adopt_visible(&service, operation).expect("the finalized attempt holds a set");
    assert_eq!(
        result.retry_round, 1,
        "the result belongs to the settling that produced it"
    );
    assert_eq!(set_adoption_kinds(&result.outcomes), vec!["added"]);

    // And the other direction: an attempt that never reached a conversion
    // leaves nothing of the attempt before it. Held again, so the third pass of
    // this row refuses before the backend -- and must then name no run and hold
    // no report, rather than still wearing the successful attempt's.
    let held_again = hold_for_writing(&acquisition);
    let third = run_visible_queue(
        &service,
        std::slice::from_ref(&sciex.handle),
        &fixture.destination("third"),
        ConversionConflictPolicyDto::Fail,
    );
    let third_operation = operation_of(&third);
    assert_eq!(
        item_states(terminal_queue(&third)),
        vec![ConversionQueueItemStateDto::Failed]
    );
    assert_eq!(
        service.terminal_set_run(third_operation, 0),
        None,
        "a refusal is described by itself, not by the conversion before it"
    );
    assert!(service.terminal_set_report(third_operation, 0).is_none());
    assert!(adopt_visible(&service, third_operation).is_err());
    drop(held_again);

    // A fresh queue over the same row names a different run again -- the
    // identity is per conversion, never per row or per queue.
    let again = run_visible_queue(
        &service,
        std::slice::from_ref(&sciex.handle),
        &fixture.destination("second"),
        ConversionConflictPolicyDto::Fail,
    );
    let second_operation = operation_of(&again);
    let second_run = service
        .terminal_set_run(second_operation, 0)
        .expect("the later conversion names itself");
    assert_ne!(second_run, run, "two conversions are never the same run");
    // And the replaced queue's authority is gone with it.
    assert!(adopt_visible(&service, operation).is_err());
}

/// A stop landing mid-retry leaves a set failure as the failure it was.
///
/// The state this pins is narrow and easy to lose. A retry moves every
/// retryable failure back to pending; if a stop lands while an earlier one is
/// running, the item behind it never reruns — and the queue must restore what
/// that item earned rather than calling it never-run, because never-run would
/// delete a failure the user has already seen, take it out of the failed count
/// and drop the diagnostic ticket whose state has to match.
///
/// A *set* failure lives in neither `error` nor the single-output report; its
/// result is its group report. Both restoration paths had to learn to ask.
#[test]
fn a_stop_mid_retry_restores_a_set_failure_rather_than_stranding_it() {
    let fixture = TestFile::new("queue-retry-stranded");
    let destination = fixture.destination("out");
    // The second run of the session: the Thermo item, again, on the retry --
    // which is where the stop lands, leaving the set item behind it pending.
    let (runner, observed, release) = FakeOutputSetRunner::writing(&["a-S1.mzML"])
        .also_converting()
        .also_injecting("uninvited.mzML")
        .parked_on_call(2, StopEnding::Confirmed);
    let service = Arc::new(output_set_service(runner));
    let held_source = fixture.thermo_raw("first.raw");
    let thermo = service
        .add_thermo_dataset(&held_source)
        .expect("a Thermo row");
    let sciex = service
        .add_sciex_wiff_dataset(&fixture.sciex_bundle("acquisition"))
        .expect("a SCIEX row");

    // First pass: the Thermo row is held by somebody else, which is the one
    // condition measured as transient; the set fails on its undeclared member.
    let held = hold_for_writing(&held_source);
    let update = run_visible_queue(
        &service,
        &[thermo.handle.clone(), sciex.handle.clone()],
        &destination,
        ConversionConflictPolicyDto::Fail,
    );
    let operation = operation_of(&update);
    let queue = terminal_queue(&update);
    assert_eq!(
        item_states(queue),
        vec![
            ConversionQueueItemStateDto::Failed,
            ConversionQueueItemStateDto::Failed
        ]
    );
    assert!(queue.items[0].retryable, "a held file is worth retrying");
    assert!(
        service.terminal_set_report(operation, 1).is_some(),
        "the set failure lives in the group report and nowhere else"
    );
    assert!(
        item_report(&queue.items[1]).is_none() && queue.items[1].error.is_none(),
        "and in neither of the two places the restoration paths used to look"
    );
    assert_eq!(update.diagnostics.eligible_item_count, 2);
    drop(held);

    // Forged, because no deterministic test can produce a retryable set
    // failure -- see `mark_retryable_for_test`.
    assert!(service.mark_retryable_for_test(operation, 1));

    // Both go back to pending. The Thermo item runs and parks; the stop lands
    // while it runs, so the set item behind it never reruns.
    let document = service.workspace_drop_document_epoch();
    let worker = {
        let service = Arc::clone(&service);
        std::thread::spawn(move || service.retry_conversion_queue(document))
    };
    observed
        .recv_timeout(Duration::from_secs(10))
        .expect("the retried Thermo item started");
    service
        .stop_conversion_queue(&operation.to_string(), document)
        .expect("the stop is accepted");
    release.send(()).expect("release the parked backend");
    let retried = worker
        .join()
        .expect("the worker finishes")
        .expect("the retry ran");
    let queue = terminal_queue(&retried);

    assert_eq!(
        terminal_reason(&retried),
        ConversionQueueTerminalReasonDto::Stopped
    );
    assert_eq!(
        item_states(queue),
        vec![
            ConversionQueueItemStateDto::Cancelled,
            ConversionQueueItemStateDto::Failed
        ],
        "the set failure is the failure it was, not a thing that never ran"
    );
    assert_eq!(queue.not_run_count, 0);
    assert_eq!(queue.failed_count, 1);
    assert!(
        service.terminal_set_report(operation, 1).is_some(),
        "and it still holds the report that explains it"
    );
    // One, not two: the restored set failure keeps the ticket whose state has
    // to match, and the confirmed cancellation beside it has nothing to
    // diagnose -- the user asked for it to stop and the owned tree is gone.
    assert_eq!(
        retried.diagnostics.eligible_item_count, 1,
        "a restored failure keeps the ticket whose state has to match"
    );
}

/// The same restoration, when a queue-level refusal ends the pass instead.
#[test]
fn a_refused_retry_restores_a_set_failure_rather_than_losing_it() {
    let fixture = TestFile::new("queue-refused-retry");
    let destination = fixture.destination("out");
    let service = Arc::new(output_set_service(
        FakeOutputSetRunner::writing(&["a-S1.mzML"])
            .also_converting()
            .also_injecting("uninvited.mzML"),
    ));
    let sciex = service
        .add_sciex_wiff_dataset(&fixture.sciex_bundle("acquisition"))
        .expect("a SCIEX row");
    let thermo = service
        .add_thermo_dataset(&fixture.thermo_raw("after.raw"))
        .expect("a Thermo row");

    let update = run_visible_queue(
        &service,
        &[sciex.handle.clone(), thermo.handle.clone()],
        &destination,
        ConversionConflictPolicyDto::Fail,
    );
    let operation = operation_of(&update);
    assert_eq!(terminal_queue(&update).failed_count, 1);
    assert!(service.mark_retryable_for_test(operation, 0));

    // The destination stops being the object it was admitted as, so the retry
    // is refused before its first item runs.
    fs::remove_dir_all(&destination).expect("remove the destination");
    let refused = service
        .retry_conversion_queue(service.workspace_drop_document_epoch())
        .expect_err("a folder that is gone refuses the retry");
    assert_eq!(refused.kind, "queue_destination_changed");

    // The queue is untouched: the failure is still a failure and still counted.
    let after = service.conversion_state();
    let queue = terminal_queue(&after);
    assert_eq!(
        item_states(queue),
        vec![
            ConversionQueueItemStateDto::Failed,
            ConversionQueueItemStateDto::Finalized
        ]
    );
    assert_eq!(queue.failed_count, 1);
    assert_eq!(queue.not_run_count, 0);
    assert_eq!(after.diagnostics.eligible_item_count, 1);
}

/// Exports the diagnostics of whatever the slot holds, and reads them back.
fn export_private_diagnostics(
    service: &PreviewService,
    fixture: &TestFile,
    label: &str,
    update: &WorkspaceConversionUpdateDto,
) -> serde_json::Value {
    let saved = fixture.destination(label).join("diagnostics.json");
    export_diagnostics(service, &terminal_operation(update), &saved)
        .expect("a failed item is diagnosable");
    read_export(&saved)
}

/// Every SCIEX failure class exports bounded, path-free facts that tell it
/// apart from the others.
///
/// One test over the whole vocabulary, because the thing being proved is that
/// the classes are *distinguishable* — and a per-class test proves each one in
/// isolation without ever comparing them.
#[test]
fn every_private_sciex_failure_is_diagnosable_and_path_free() {
    struct Case {
        label: &'static str,
        runner: FakeOutputSetRunner,
        outcome: &'static str,
        detail: Option<&'static str>,
        /// Whether the backend said anything worth keeping. A run that was
        /// refused before it launched has no streams to excerpt; one that ran
        /// and failed must not have its account of itself thrown away.
        retains_text: bool,
        conflict: ConversionConflictPolicyDto,
        occupy: &'static [&'static str],
    }

    let cases = vec![
        Case {
            label: "declaration",
            runner: FakeOutputSetRunner::writing(&["a-S1.mzML"]).also_injecting("uninvited.mzML"),
            outcome: "refused_before_publication",
            detail: Some("multi_output_set_not_as_declared"),
            conflict: ConversionConflictPolicyDto::Fail,
            occupy: &[],
            retains_text: true,
        },
        Case {
            label: "reader-sample",
            runner: FakeOutputSetRunner::writing(&["a-S1.mzML"]).complaining(READER_LOST_A_SAMPLE),
            outcome: "refused_before_publication",
            detail: Some("source_sample_failure_observed"),
            conflict: ConversionConflictPolicyDto::Fail,
            occupy: &[],
            retains_text: true,
        },
        Case {
            label: "truncated-audit",
            runner: FakeOutputSetRunner::writing(&["a-S1.mzML"]).truncating_stderr(),
            outcome: "refused_before_publication",
            detail: Some("source_sample_audit_truncated"),
            conflict: ConversionConflictPolicyDto::Fail,
            occupy: &[],
            retains_text: true,
        },
        Case {
            label: "invalid-member",
            runner: FakeOutputSetRunner::writing(&["a-S1.mzML", "a-S2.mzML"])
                .with_empty_member("a-S2.mzML"),
            outcome: "refused_before_publication",
            detail: Some("multi_output_member_rejected"),
            conflict: ConversionConflictPolicyDto::Fail,
            occupy: &[],
            retains_text: true,
        },
        Case {
            label: "group-conflict",
            runner: FakeOutputSetRunner::writing(&["a-S1.mzML", "a-S2.mzML"]),
            outcome: "refused_before_publication",
            detail: Some("multi_output_destination_occupied"),
            conflict: ConversionConflictPolicyDto::Fail,
            occupy: &["a-S2.mzML"],
            retains_text: true,
        },
        Case {
            label: "backend-rejected",
            runner: FakeOutputSetRunner::writing(&["a-S1.mzML"]).failing(),
            outcome: "refused_before_publication",
            detail: Some("multi_output_backend_rejected"),
            conflict: ConversionConflictPolicyDto::Fail,
            occupy: &[],
            retains_text: true,
        },
    ];

    for case in cases {
        let fixture = TestFile::new(&format!("queue-diag-{}", case.label));
        let destination = fixture.destination("out");
        for name in case.occupy {
            fs::write(destination.join(name), b"already here").expect("occupy a name");
        }
        let service = Arc::new(output_set_service(case.runner));
        let sciex = service
            .add_sciex_wiff_dataset(&fixture.sciex_bundle("acquisition"))
            .expect("a SCIEX row");
        let update = run_visible_queue(
            &service,
            std::slice::from_ref(&sciex.handle),
            &destination,
            case.conflict,
        );
        assert_eq!(
            item_states(terminal_queue(&update)),
            vec![ConversionQueueItemStateDto::Failed],
            "{}: the item failed",
            case.label
        );

        let export = export_private_diagnostics(&service, &fixture, "diag", &update);
        let items = export["items"].as_array().expect("an items array");
        assert_eq!(
            items.len(),
            1,
            "{}: one source is one diagnostic item",
            case.label
        );
        let item = &items[0];
        assert_eq!(item["sourceKind"], "sciex_wiff", "{}", case.label);
        assert_eq!(item["state"], "failed", "{}", case.label);
        assert_eq!(item["outcome"], case.outcome, "{}", case.label);
        assert_eq!(
            item["detail"],
            serde_json::json!(case.detail),
            "{}",
            case.label
        );
        // No single output name is claimed for a set.
        assert!(
            item["outputFileName"].is_null(),
            "{}: a set has no one output name",
            case.label
        );
        let set = &item["outputSet"];
        assert!(set.is_object(), "{}: a set item says so", case.label);
        assert_eq!(set["maxMembers"], 24, "{}", case.label);
        assert_eq!(
            set["finalizedCount"], 0,
            "{}: nothing published",
            case.label
        );
        assert_eq!(
            set["boundSourceObjects"], 2,
            "{}: primary and companion",
            case.label
        );
        assert!(
            set["memberCount"].as_u64().expect("a member count") <= 24,
            "{}: bounded by the lifecycle's own bound",
            case.label
        );

        // The backend's own account of the failure survives, redacted and
        // bounded. Dropping it would leave a document that says which class of
        // failure this was and nothing about why.
        // The backend's own account of the failure reaches the document.
        // Dropping it would leave a report that says which class of failure
        // this was and nothing about why.
        if case.retains_text {
            for stream in ["stdout", "stderr"] {
                let excerpt = &item[stream];
                assert!(
                    excerpt["retained"] == "prefix" || excerpt["retained"] == "withheld",
                    "{}: the {stream} excerpt was never captured",
                    case.label
                );
                // Withheld says so, and says why. A suppressed excerpt costs a
                // diagnosis; a silent one would cost the reader the knowledge
                // that there was something to see.
                if excerpt["retained"] == "withheld" {
                    assert!(
                        excerpt["suppressed"].is_string(),
                        "{}: a withheld {stream} excerpt must name its reason",
                        case.label
                    );
                    assert!(
                        excerpt["totalBytes"].as_u64().expect("a byte count") > 0,
                        "{}: a withheld {stream} excerpt still reports its size",
                        case.label
                    );
                }
            }
        }
        // And the one case whose backend really said something says it.
        if case.label == "reader-sample" {
            assert_eq!(item["stderr"]["retained"], "prefix");
            assert!(
                item["stderr"]["text"]
                    .as_str()
                    .expect("the reader's own words")
                    .contains("Reader_ABI"),
                "the reader's account of the sample it lost is the diagnosis"
            );
        }

        // No path, no companion, and no backend-chosen member name. The
        // acquisition's own display name is deliberately here, as
        // `sourceFileName`, exactly as it has been for every other family since
        // this export existed: it is the row the user is looking at, and a
        // document that would not say which item it is about is not a
        // diagnosis. What this slice had to keep out are the *members'* names,
        // which the backend derives from sample identifiers inside the
        // acquisition.
        let rendered = serde_json::to_string(&export).expect("re-render the export");
        for forbidden in ["a-S1.mzML", "a-S2.mzML", "uninvited.mzML", ".wiff.scan"] {
            assert!(
                !rendered.contains(forbidden),
                "{}: {forbidden} reached the export",
                case.label
            );
        }
        assert!(
            !rendered.contains(&fixture.directory.display().to_string()),
            "{}: the fixture directory reached the export",
            case.label
        );
    }
}

/// A set refused before the lifecycle is still exported as a set.
///
/// The schema a reader gets must not depend on which layer said no. A
/// backend-named set whose row could not be revalidated never reaches the
/// multi-output lifecycle at all, so it has no members, no completeness and no
/// bound objects — and it is still a set item, of at most twenty-four members,
/// and says so.
#[test]
fn a_set_refused_before_the_run_keeps_its_shape_in_the_export() {
    let fixture = TestFile::new("queue-diag-prerun");
    let destination = fixture.destination("out");
    let runner = FakeOutputSetRunner::writing(&["a-S1.mzML"]);
    let launches = runner.launches();
    let service = Arc::new(output_set_service(runner));
    let acquisition = fixture.sciex_bundle("acquisition");
    let sciex = service
        .add_sciex_wiff_dataset(&acquisition)
        .expect("a SCIEX row");

    // Held by somebody else, so revalidation refuses before anything is opened
    // for the run.
    let held = hold_for_writing(&acquisition);
    let update = run_visible_queue(
        &service,
        std::slice::from_ref(&sciex.handle),
        &destination,
        ConversionConflictPolicyDto::Fail,
    );
    assert_eq!(
        item_states(terminal_queue(&update)),
        vec![ConversionQueueItemStateDto::Failed]
    );
    assert_eq!(launches.load(Ordering::SeqCst), 0, "nothing was launched");
    drop(held);

    let export = export_private_diagnostics(&service, &fixture, "diag", &update);
    let item = &export["items"][0];
    assert_eq!(item["sourceKind"], "sciex_wiff");
    assert_eq!(item["refusal"], "file_unreadable");
    assert!(item["outputFileName"].is_null());
    assert!(
        item["outcome"].is_null(),
        "no conversion reached an outcome"
    );

    let set = &item["outputSet"];
    assert!(
        set.is_object(),
        "a set refused early is still a set in the document"
    );
    assert_eq!(set["maxMembers"], 24);
    assert_eq!(set["memberCount"], 0);
    assert_eq!(set["finalizedCount"], 0);
    assert!(
        set["boundSourceObjects"].is_null(),
        "the acquisition was never bound, and zero would say it was bound to nothing"
    );
    assert!(set["sampleCompleteness"].is_null());
    assert!(set["partialFinalization"].is_null());
}

/// A retry between reading a queue-held set and committing it adopts nothing.
///
/// The authority a terminal queue item holds belongs to a *settling*, and a
/// retry settles the same operation again with different results. An adoption
/// that read the old ticket and committed against the new settling would attach
/// outputs to a queue pass that did not produce them — so the settling is read
/// under the gate that claims the action, and proved again before the commit.
#[test]
fn a_retry_between_the_halves_of_a_set_adoption_commits_nothing() {
    let fixture = TestFile::new("queue-adopt-superseded");
    let destination = fixture.destination("out");
    let service = Arc::new(output_set_service(
        FakeOutputSetRunner::writing(&["a-S1.mzML"]).also_converting(),
    ));
    let sciex = service
        .add_sciex_wiff_dataset(&fixture.sciex_bundle("acquisition"))
        .expect("a SCIEX row");
    let held_source = fixture.thermo_raw("second.raw");
    let thermo = service
        .add_thermo_dataset(&held_source)
        .expect("a Thermo row");

    // The set finalizes; the Thermo row behind it is held by somebody else, so
    // the queue completes with one retryable failure.
    let held = hold_for_writing(&held_source);
    let update = run_visible_queue(
        &service,
        &[sciex.handle.clone(), thermo.handle.clone()],
        &destination,
        ConversionConflictPolicyDto::Fail,
    );
    let operation = operation_of(&update);
    let queue = terminal_queue(&update);
    assert_eq!(
        item_states(queue),
        vec![
            ConversionQueueItemStateDto::Finalized,
            ConversionQueueItemStateDto::Failed
        ]
    );
    assert_eq!(queue.retry_round, 0);
    drop(held);

    // A retry settles the same operation again. The set item did not rerun --
    // a finalized item never does -- so its ticket is still there and still
    // valid, but it now belongs to the settling after the one that was read.
    let retried = service
        .retry_conversion_queue(service.workspace_drop_document_epoch())
        .expect("a retryable failure is retryable");
    assert_eq!(terminal_queue(&retried).retry_round, 1);

    // Adopting against the new settling is fine, because that is the settling
    // the ticket is read from now. The rerun item finalized too, so the offer
    // is both of them -- and the result names the round it belongs to.
    let result = adopt_visible(&service, operation).expect("the current settling holds the set");
    assert_eq!(set_adoption_kinds(&result.outcomes), vec!["added", "added"]);
    assert_eq!(adoption_identities(&result.outcomes), vec![(0, 0), (1, 0)]);
    assert_eq!(result.retry_round, 1);

    // And an operation that is not this one answers with nothing at all.
    assert!(adopt_visible(&service, operation + 1).is_err());
}

/// A stopped set item is still recognisably a set in the export.
///
/// An unconfirmed stop is the one cancellation worth diagnosing, and the ticket
/// it produces used to be built exactly as a single-output stop's — so the
/// document lost the set marker, the member bound and the acquisition's object
/// count, and a reader could not tell which kind of item had been stopped.
///
/// The counts are zero and that is a fact, not a gap: the two cancellation
/// refusals this is translated from publish nothing.
#[test]
fn a_stopped_set_item_keeps_its_shape_in_the_export() {
    let (fixture, _destination, service, update, _launches) =
        stop_mid_sciex_item("queue-diag-stopped", StopEnding::Unterminated);
    assert_eq!(
        terminal_reason(&update),
        ConversionQueueTerminalReasonDto::StopFailed
    );

    let export = export_private_diagnostics(&service, &fixture, "diag", &update);
    let item = &export["items"][0];
    assert_eq!(item["sourceKind"], "sciex_wiff");
    assert_eq!(item["state"], "cancellation_failed");
    assert!(item["outputFileName"].is_null());
    assert!(item["cancellation"].is_object());

    let set = &item["outputSet"];
    assert!(
        set.is_object(),
        "a stopped set item must not be described as a single output"
    );
    assert_eq!(set["maxMembers"], 24);
    assert_eq!(set["boundSourceObjects"], 2, "primary and companion");
    assert_eq!(set["memberCount"], 0);
    assert_eq!(set["finalizedCount"], 0);
    assert!(set["partialFinalization"].is_null());
    assert!(set["sampleCompleteness"].is_null());

    let rendered = serde_json::to_string(&export).expect("re-render");
    assert!(!rendered.contains("a-S1.mzML") && !rendered.contains(".wiff.scan"));
    assert!(!rendered.contains(&fixture.directory.display().to_string()));
}

/// A partially finalized item exports its partial facts as counts.
#[test]
fn a_partial_publication_is_diagnosed_by_counts() {
    let fixture = TestFile::new("queue-diag-partial");
    let destination = fixture.destination("out");
    let raced = destination.join("a-S2.mzML");
    let service = Arc::new(output_set_service(FakeOutputSetRunner::writing(&[
        "a-S1.mzML",
        "a-S2.mzML",
        "a-S3.mzML",
    ])));
    let occupied = raced.clone();
    service.race_next_publication(move |position| {
        if position == 1 {
            fs::write(&occupied, b"raced in").expect("occupy the second name mid-set");
        }
    });
    let sciex = service
        .add_sciex_wiff_dataset(&fixture.sciex_bundle("acquisition"))
        .expect("a SCIEX row");
    let update = run_visible_queue(
        &service,
        std::slice::from_ref(&sciex.handle),
        &destination,
        ConversionConflictPolicyDto::Fail,
    );

    let export = export_private_diagnostics(&service, &fixture, "diag", &update);
    let item = &export["items"][0];
    assert_eq!(item["outcome"], "partially_finalized");
    assert!(item["outputFileName"].is_null());
    let set = &item["outputSet"];
    assert_eq!(set["finalizedCount"], 1);
    assert_eq!(set["notPublishedCount"], 0);
    assert_eq!(
        set["sampleCompleteness"], "source_sample_set_not_fully_published",
        "a partial publication withdraws the completeness claim"
    );
    let partial = &set["partialFinalization"];
    assert_eq!(partial["finalizedCount"], 1);
    assert_eq!(partial["notPublishedCount"], 2);
    assert_eq!(partial["failureKind"], "already_exists");
    let rendered = serde_json::to_string(&export).expect("re-render");
    assert!(!rendered.contains("a-S1.mzML") && !rendered.contains("a-S2.mzML"));
}

/// An ordinary Thermo queue's export is exactly the document it always was.
#[test]
fn a_single_output_export_gains_no_member_and_keeps_its_name() {
    let fixture = TestFile::new("queue-diag-single");
    let destination = destination_root(&fixture, "out");
    let service = PreviewService::new(Box::new(ConvertingProvider::new(
        conversion_capabilities(
            EVIDENCED_RELEASE,
            Some(EVIDENCED_REVISION),
            EVIDENCED_EXECUTABLE_SHA256,
        ),
        FakeConversionRunner::new(BackendAct::Fail),
    )));
    let handle = add_one_acquisition(&service, &fixture.thermo_raw("one.raw"));
    let update = queue_and_run(&service, &[handle], &destination);

    let saved = destination_root(&fixture, "diag").join("diagnostics.json");
    export_diagnostics(&service, &terminal_operation(&update), &saved)
        .expect("a failed Thermo item is diagnosable");
    let export = read_export(&saved);
    let item = &export["items"][0];
    assert_eq!(
        item["outputFileName"], "one.mzML",
        "unchanged for a single output"
    );
    assert!(
        item.get("outputSet").is_none(),
        "an ordinary item gains no member it never had"
    );
}

/// No member basename reaches the diagnostics export, at any depth.
///
/// The boundary ADR 0026 drew and this milestone deliberately keeps: the
/// product *result* carries the backend's chosen basenames, because a user
/// looking at "ten outputs finalized" is owed which ten and the roster will
/// spell every one of them out the moment the set is adopted. The **export** is
/// a different document with a different reader — it is reviewed before being
/// sent somewhere — and those names are the backend's reading of sample
/// identifiers inside the acquisition, which is the user's data rather than
/// this application's vocabulary.
///
/// Asserted over the whole serialized document rather than over the members it
/// happens to know about, so a field added later cannot carry one in.
#[cfg(windows)]
#[test]
fn no_member_basename_reaches_the_diagnostics_export() {
    // Distinctive enough that a match cannot be coincidence, and shaped like
    // the sample identifiers a real acquisition carries.
    let names = ["Patient-042-S1.mzML", "Patient-042-S2.mzML"];
    let fixture = TestFile::new("diag-member-privacy");
    let destination = fixture.destination("out");
    let service = Arc::new(output_set_service(
        // Refused before publication, so the item is worth diagnosing at all:
        // a run that finalized everything has nothing to export.
        FakeOutputSetRunner::writing(&names).also_injecting("uninvited.mzML"),
    ));
    let sciex = service
        .add_sciex_wiff_dataset(&fixture.sciex_bundle("acquisition"))
        .expect("a SCIEX row");
    let update = run_visible_queue(
        &service,
        std::slice::from_ref(&sciex.handle),
        &destination,
        ConversionConflictPolicyDto::Fail,
    );
    assert_eq!(
        item_states(terminal_queue(&update)),
        vec![ConversionQueueItemStateDto::Failed],
        "the run must have something to diagnose"
    );

    let export = export_private_diagnostics(&service, &fixture, "diag", &update);
    let document = serde_json::to_string(&export).expect("the export serializes");
    // The set shape is there, so this is not passing by describing nothing.
    assert!(export["items"][0]["outputSet"].is_object());

    for forbidden in [
        names[0],
        names[1],
        "Patient-042",
        "uninvited.mzML",
        // And the companion, which is never named anywhere.
        ".wiff.scan",
    ] {
        assert!(
            !document.contains(forbidden),
            "{forbidden} reached the diagnostics export: {document}"
        );
    }

    // The acquisition's own display name is deliberately there: it is the row
    // the user chose, and a document that would not say which item it is about
    // is not a diagnosis.
    assert_eq!(export["items"][0]["sourceFileName"], "acquisition.wiff");
}

/// Nothing that carries a set as a *set* renders a member name or a location.
///
/// The boundary this pins is where a member stops being a member. Before
/// adoption a member basename is the backend's reading of a sample identifier
/// inside the acquisition, and no queue state, group report, ticket or export
/// may render one. After adoption it is the display name of an ordinary
/// workspace row, which the roster carries for every row the product holds --
/// redacting it in one rendering while the roster beside it spells it out would
/// be theatre rather than privacy.
#[test]
fn every_set_bearing_debug_is_opaque() {
    let names = ["Patient-042-S1.mzML", "Patient-042-S2.mzML"];
    let (fixture, service, handle, destination) =
        private_sciex_queue("queue-debug", FakeOutputSetRunner::writing(&names));
    let update = run_visible_queue(
        &service,
        std::slice::from_ref(&handle),
        &destination,
        ConversionConflictPolicyDto::Fail,
    );
    let operation = operation_of(&update);

    let before_adoption = vec![
        format!("{:?}", service.conversion_state()),
        format!("{update:?}"),
        format!(
            "{:?}",
            service
                .terminal_set_report(operation, 0)
                .expect("a group report")
        ),
    ];
    // The acquisition's own display name is a deliberate member of the queue's
    // transfer object and is not in this list: it is the row the user chose.
    // What must never appear is a location, a companion, or a member name.
    for text in &before_adoption {
        for forbidden in [
            fixture.directory.display().to_string().as_str(),
            "Patient-042",
            ".wiff.scan",
            "\\?\\",
        ] {
            assert!(
                !text.contains(forbidden),
                "{forbidden} appears in a debug rendering: {text}"
            );
        }
    }

    // The one thing that names claimed members is a test-only inspection
    // accessor, which is a decision to look rather than a rendering; the value
    // the queue holds them in renders itself opaque.
    let claimed = ClaimedOutputName {
        folded: folded_output_name(names[0]),
        display: names[0].to_owned(),
        item: 0,
        discovered_position: 0,
    };
    let rendered = format!("{claimed:?}");
    assert!(
        !rendered.contains("Patient-042"),
        "a claimed name renders its owner, not itself: {rendered}"
    );

    // The adoption result names rows, because that is what it is for. It still
    // renders no location and no handle.
    let adopted = format!(
        "{:?}",
        adopt_visible(&service, operation).expect("the set adopts")
    );
    assert!(
        adopted.contains("Patient-042-S1.mzML"),
        "an adoption result says which rows exist now"
    );
    for forbidden in [
        fixture.directory.display().to_string().as_str(),
        ".wiff.scan",
        "\\?\\",
    ] {
        assert!(
            !adopted.contains(forbidden),
            "{forbidden} appears in the adoption result"
        );
    }
}

/// Replacing the queue drops its authority and deletes no finalized output.
#[test]
fn replacing_a_private_queue_keeps_every_document_it_wrote() {
    let (fixture, service, handle, destination) = private_sciex_queue(
        "queue-replaced",
        FakeOutputSetRunner::writing(&["a-S1.mzML", "a-S2.mzML"]),
    );
    let update = run_visible_queue(
        &service,
        std::slice::from_ref(&handle),
        &destination,
        ConversionConflictPolicyDto::Fail,
    );
    let operation = operation_of(&update);
    let mut written = entry_names_in(&destination);
    written.sort();
    assert_eq!(written, vec!["a-S1.mzML", "a-S2.mzML"]);

    // A new queue replaces the terminal one, and with it the authority.
    let another = service
        .add_sciex_wiff_dataset(&fixture.sciex_bundle("second"))
        .expect("a second SCIEX row");
    let document = service.workspace_drop_document_epoch();
    service
        .begin_conversion_queue(
            std::slice::from_ref(&another.handle),
            ConversionConflictPolicyDto::Fail,
            document,
        )
        .expect("a replacement queue is admitted");

    assert!(
        adopt_visible(&service, operation).is_err(),
        "a replaced queue's authority is gone"
    );
    let mut still_there = entry_names_in(&destination);
    still_there.sort();
    assert_eq!(
        still_there,
        vec!["a-S1.mzML", "a-S2.mzML"],
        "dropping tickets deletes no finalized output"
    );
}

/// No command and no visible surface reaches the private queue.
#[test]
fn no_product_surface_reaches_the_private_sciex_queue() {
    let source = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/lib.rs"))
        .expect("read the command surface");
    for forbidden in [
        "begin_private_conversion_queue",
        "adopt_queue_output_set",
        "convert_workspace_sciex_bundle",
        "adopt_output_set",
        "terminal_set_report",
        "race_next_publication",
        "SciexWiff",
        "sciex",
    ] {
        assert!(
            !source.contains(forbidden),
            "{forbidden} is reachable from the command surface"
        );
    }
}

/// A real ten-sample SCIEX acquisition, through the whole *visible* workflow.
///
/// The evidence run for ADR 0027, and deliberately not the private helper ADR
/// 0026 measured: the point of this milestone is that a user can do this, so
/// every step is the one a user reaches. `Add files…` admits the acquisition,
/// the visible planner describes it, the visible queue runs it and the visible
/// adoption takes its outputs. Nothing private is called anywhere in it.
///
/// Kept out of ordinary CI because it needs a local ProteoWizard installation
/// and a lawful acquisition, neither of which a test runner has.
#[cfg(windows)]
#[test]
#[ignore = "needs a local ProteoWizard installation and a real vendor acquisition"]
fn a_real_sciex_acquisition_runs_through_the_visible_workflow() {
    let Ok(fixture) = std::env::var("MSCANVAS_SCIEX_WIFF_FIXTURE") else {
        panic!("set MSCANVAS_SCIEX_WIFF_FIXTURE to the .wiff to convert");
    };
    let Ok(destination) = std::env::var("MSCANVAS_CONVERSION_DESTINATION") else {
        panic!("set MSCANVAS_CONVERSION_DESTINATION to an empty folder");
    };
    let expected: usize = std::env::var("MSCANVAS_SCIEX_EXPECTED_OUTPUTS")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(1);
    let acquisition = PathBuf::from(fixture);
    let destination = PathBuf::from(destination);

    // The production provider. Nothing is substituted.
    let service = Arc::new(PreviewService::new(Box::new(
        super::backend::ProteoWizardProvider::new(),
    )));

    // 1. `Add files…`, the only route a user has. The picker hands Rust the
    //    `.wiff` it chose and nothing else; the companion is found, admitted
    //    and held by the boundary itself.
    let added = service.add_files_now(std::slice::from_ref(&acquisition));
    let [WorkspaceAddOutcomeDto::Added { dataset }] = added.outcomes.as_slice() else {
        panic!("the picker admits the acquisition: {added:?}");
    };
    println!("picker candidate: 1 .wiff");
    println!("workspace source rows: {}", service.dataset_count());
    println!("source row family: {:?}", dataset.source_kind);
    println!(
        "source row bytes (whole acquisition): {}",
        dataset.byte_length
    );
    assert_eq!(service.dataset_count(), 1, "one acquisition is one row");
    assert_eq!(dataset.source_kind, DatasetSourceKindDto::SciexWiff);
    let handle = dataset.handle.clone();

    // 2. The visible plan. It states the cardinality and names nothing.
    let plan = service
        .conversion_queue_plan(std::slice::from_ref(&handle))
        .expect("the visible planner takes the acquisition");
    println!("plan topology: {:?}", plan.items[0].output);
    assert_eq!(
        plan.items[0].output,
        super::dto::ConversionOutputPlanDto::BackendNamedSet {
            max_members: MAX_CONVERSION_OUTPUTS_PER_SOURCE
        }
    );

    // 3. The visible queue: reserve, admit the destination, run.
    let update = run_visible_queue(
        &service,
        std::slice::from_ref(&handle),
        &destination,
        ConversionConflictPolicyDto::Fail,
    );
    let operation = operation_of(&update);
    let queue = terminal_queue(&update);

    println!("terminal reason: {:?}", terminal_reason(&update));
    println!("queue items: {}", queue.item_count);
    println!("item states: {:?}", item_states(queue));
    println!("attempts: {}", queue.items[0].attempts);
    assert_eq!(
        terminal_reason(&update),
        ConversionQueueTerminalReasonDto::Completed
    );
    assert_eq!(queue.item_count, 1, "one acquisition is one queue item");
    assert_eq!(queue.finalized_count, 1);
    assert_eq!(queue.items[0].attempts, 1);
    assert!(
        matches!(
            queue.items[0].output,
            super::dto::ConversionOutputPlanDto::BackendNamedSet { .. }
        ),
        "no filename was invented for a backend-named set"
    );

    // The visible result, in the facts the interface renders from.
    let visible = item_set_report(&queue.items[0]).expect("the item carries its group report");
    println!("visible group outcome: {}", visible.group_outcome);
    println!("visible finalized members: {}", visible.finalized_count);
    println!(
        "visible bound source objects: {:?}",
        visible.bound_source_objects
    );
    println!("visible completeness: {:?}", visible.completeness);
    println!(
        "visible complete-set adoptable: {}",
        visible.complete_set_adoptable
    );
    println!("visible eligible outputs: {}", queue.adoptable_output_count);
    assert_eq!(visible.finalized_count, expected);
    assert_eq!(visible.bound_source_objects, Some(2));
    assert!(visible.complete_set_adoptable);
    assert_eq!(queue.adoptable_output_count, expected);

    let report = service
        .terminal_set_report(operation, 0)
        .expect("the item kept its group report");
    println!("group outcome: {}", report.group_outcome());
    println!("published members: {}", report.published_count());
    println!("bound source objects: {}", report.bound_source_objects());
    let completeness = report
        .completeness()
        .and_then(SciexSampleCompleteness::established)
        .expect("a complete acquisition establishes completeness");
    println!(
        "completeness: {} sample_count={}",
        completeness.method(),
        completeness.sample_count()
    );
    assert_eq!(report.group_outcome(), "fully_finalized");
    assert_eq!(report.published_count(), expected);
    assert_eq!(completeness.sample_count(), expected);
    assert_eq!(report.bound_source_objects(), 2);

    let result = adopt_visible(&service, operation)
        .expect("the terminal item holds a complete set to adopt");
    println!("adoption outcomes: {}", result.outcomes.len());
    println!("adoption kinds: {:?}", set_adoption_kinds(&result.outcomes));
    assert_eq!(result.outcomes.len(), expected);
    assert_eq!(
        set_adoption_kinds(&result.outcomes),
        vec!["added"; expected]
    );

    let roster = service.roster();
    let mzml = roster
        .datasets
        .iter()
        .filter(|row| row.source_kind == DatasetSourceKindDto::Mzml)
        .count();
    let wiff = roster
        .datasets
        .iter()
        .filter(|row| row.source_kind == DatasetSourceKindDto::SciexWiff)
        .count();
    println!(
        "workspace rows: {} (mzml {mzml}, sciex_wiff {wiff})",
        roster.datasets.len()
    );
    assert_eq!(mzml, expected);
    assert_eq!(wiff, 1, "the acquisition is still one bundle row");
    assert_eq!(roster.datasets.len(), expected + 1);
    for row in &roster.datasets {
        assert!(
            !service.holds_preview_state(&row.handle),
            "adoption previewed a row"
        );
    }
    println!("preview state on any row: none");

    let again = adopt_visible(&service, operation).expect("the ticket survives an attempt");
    println!("repeat adoption: {:?}", set_adoption_kinds(&again.outcomes));
    assert_eq!(
        set_adoption_kinds(&again.outcomes),
        vec!["already"; expected]
    );
    assert_eq!(service.dataset_count(), expected + 1);

    // Nothing rendered here names a location.
    for rendered in [
        format!("{update:?}"),
        format!("{report:?}"),
        format!("{result:?}"),
    ] {
        assert!(!rendered.contains(":\\"), "a path escaped: {rendered}");
        assert!(!rendered.contains("\\\\?\\"), "a path escaped: {rendered}");
    }
    println!("path-free debug: confirmed");

    // And nothing *serialized* names one either, which is the rendering that
    // actually crosses to the webview. The member basenames are deliberately
    // there -- the product displays them -- and the acquisition's directory,
    // the destination and the companion are deliberately not.
    let wire = serde_json::to_string(&update).expect("the queue serializes");
    let adoption_wire = serde_json::to_string(&result).expect("the adoption serializes");
    for rendered in [&wire, &adoption_wire] {
        assert!(!rendered.contains(":\\\\"), "a path reached the wire");
        assert!(
            !rendered.contains(".wiff.scan"),
            "the companion reached the wire"
        );
        for absent in [
            acquisition
                .parent()
                .expect("the fixture has a parent")
                .to_string_lossy()
                .as_ref(),
            destination.to_string_lossy().as_ref(),
        ] {
            assert!(!rendered.contains(absent), "a location reached the wire");
        }
    }
    println!("path-free serialized wire: confirmed");

    // What an export of this queue would describe: nothing. A run that
    // finalized everything has no failure to diagnose, and the count is Rust's
    // own rather than an interface's guess.
    println!(
        "diagnostic items: {}",
        update.diagnostics.eligible_item_count
    );
    assert_eq!(update.diagnostics.eligible_item_count, 0);
}

// ---------------------------------------------------------------------------
// The retained selected spectrum, and how long it is retained for.
//
// The slot's contract is one sentence -- it holds the spectrum the loaded panel
// names -- and M4.1 enforced only half of it. Installing a newer spectrum
// replaced the old one, but every *other* way a panel stops naming one left the
// complete arrays in memory with nothing on screen pointing at them. These are
// the other ways.
//
// Two things are asserted throughout, because they are different claims. That
// the old token is refused proves the slot stopped *naming* the spectrum. That a
// `Weak` fails to upgrade proves the arrays were *released*. Only the second is
// what the retention was about.
// ---------------------------------------------------------------------------

/// The figure settings a panel starts with, which is what these tests export at.
fn default_figure_settings() -> FigureSettingsDto {
    FigureSettingsDto {
        width_px: 1_200,
        height_px: 640,
        png_dpi: 300,
        theme: "light".to_owned(),
    }
}

/// Loads one spectrum and answers with the token the panel would hold.
fn loaded_export_token(service: &PreviewService, handle: &str, index: u64) -> String {
    let outcome = service
        .load_spectrum(handle, index)
        .expect("the spectrum loads");
    let SelectedSpectrumOutcomeDto::Spectrum { spectrum } = outcome else {
        panic!("a present spectrum is not the unavailable outcome");
    };
    spectrum.export_token.clone()
}

fn one_spectrum() -> Response {
    Response::File(selected_spectrum_output(
        0,
        &[(100.5, 10.0), (200.25, 40.0)],
    ))
}

/// The figure settings a panel would send with these fields in them.
fn figure_settings(width_px: u32, height_px: u32, png_dpi: u32) -> FigureSettingsDto {
    FigureSettingsDto {
        width_px,
        height_px,
        png_dpi,
        theme: "light".to_owned(),
    }
}

/// One loaded spectrum, and the token the panel would hold for it.
fn one_loaded_spectrum() -> (TestFile, PreviewService, String) {
    let file = TestFile::new("figure-settings");
    let service = PreviewService::new(Box::new(FakeProvider::available(vec![one_spectrum()])));
    let selected = service.accept_file(&file.path).expect("accepted");
    let token = loaded_export_token(&service, &selected.handle, 0);
    (file, service, token)
}

/// Begins one export and releases the lane again, so the next can be asked for.
///
/// The lane is single: a reservation left standing would make every later
/// begin in the same test refuse as "already exporting", which is a true
/// refusal about the wrong thing.
fn begin_and_release(
    service: &PreviewService,
    token: &str,
    format: &str,
    settings: &FigureSettingsDto,
) -> Result<(), PreviewErrorDto> {
    let reservation = service.begin_spectrum_export(token, format, settings)?;
    service.cancel_spectrum_export(&reservation);
    Ok(())
}

#[test]
fn a_resolution_no_png_could_record_stops_the_png_and_nothing_else() {
    // The Round-2 finding. DPI is written into one format's metadata and read
    // by nothing else: an SVG has no pixels to give a physical size to, and a
    // data document is not a drawing at all. Refusing them over this number
    // would refuse three working exports for a reason that could not have
    // affected any of them.
    let (_file, service, token) = one_loaded_spectrum();
    let unusable = figure_settings(1_200, 640, 50);

    for format in ["svg", "csv", "tsv"] {
        begin_and_release(&service, &token, format, &unusable)
            .unwrap_or_else(|refusal| panic!("{format} records no resolution: {refusal:?}"));
    }

    let refusal = service
        .begin_spectrum_export(&token, "png", &unusable)
        .expect_err("50 DPI is below what this boundary records");
    assert_eq!(refusal.kind, "figure_settings_refused");
    assert!(
        refusal.summary.contains("between 72 and 1200"),
        "the refusal names the number to change: {:?}",
        refusal.summary,
    );
}

#[test]
fn every_conventional_resolution_is_accepted_and_the_two_just_outside_are_not() {
    let (_file, service, token) = one_loaded_spectrum();

    for dpi in [72, 96, 150, 300, 600, 1_200] {
        begin_and_release(&service, &token, "png", &figure_settings(1_200, 640, dpi))
            .unwrap_or_else(|refusal| {
                panic!("{dpi} DPI is a resolution a PNG records: {refusal:?}")
            });
    }
    for dpi in [71, 1_201] {
        let refusal = service
            .begin_spectrum_export(&token, "png", &figure_settings(1_200, 640, dpi))
            .unwrap_err();
        assert_eq!(refusal.kind, "figure_settings_refused", "{dpi} DPI");
    }
}

#[test]
fn a_figure_too_large_to_hold_as_pixels_is_still_a_vector_document() {
    // A vector document can honestly describe a 20,000 x 20,000 figure, and
    // this application will write one. The raster budget is a question about
    // the output rather than about the figure, so it stops the outputs that
    // have to hold every pixel and leaves the one that does not.
    let (_file, service, token) = one_loaded_spectrum();
    let enormous = figure_settings(20_000, 20_000, 300);

    begin_and_release(&service, &token, "svg", &enormous)
        .expect("the largest vector figure is a vector document");

    let refusal = service
        .begin_spectrum_export(&token, "png", &enormous)
        .expect_err("400 megapixels is not an image this machine should attempt");
    assert_eq!(refusal.kind, "figure_settings_refused");
    assert!(
        refusal.summary.contains("32 million pixels"),
        "the refusal names the ceiling: {:?}",
        refusal.summary,
    );
    // And it says the export that *is* available, which is the one that was
    // just proven to work.
    assert!(refusal.summary.contains("SVG"), "{:?}", refusal.summary);
}

#[test]
fn the_raster_budget_boundary_is_the_stated_one() {
    // Exactly 32,000,000 pixels is inside. One row more is not. A ceiling
    // stated in a refusal and enforced a pixel away from it would be a
    // sentence a user could follow and still be refused.
    let (_file, service, token) = one_loaded_spectrum();

    begin_and_release(&service, &token, "png", &figure_settings(8_000, 4_000, 300))
        .expect("32,000,000 pixels exactly is inside the budget");

    let refusal = service
        .begin_spectrum_export(&token, "png", &figure_settings(8_000, 4_001, 300))
        .expect_err("one row past the ceiling is past it");
    assert_eq!(refusal.kind, "figure_settings_refused");
    assert!(refusal.summary.contains("32 million pixels"));
}

#[test]
fn a_png_wrong_in_both_ways_is_refused_over_the_resolution_first() {
    // Both refusals are true, so the order is a choice rather than an
    // accident, and it is asserted here because a user acting on the first
    // sentence and then being told a second one is a worse experience than
    // being told the smaller correction first. Fixing the resolution then
    // leaves the size refusal, which is still true.
    let (_file, service, token) = one_loaded_spectrum();

    let both_wrong = figure_settings(20_000, 20_000, 50);
    let refusal = service
        .begin_spectrum_export(&token, "png", &both_wrong)
        .expect_err("neither the resolution nor the size can be honoured");
    assert!(
        refusal.summary.contains("between 72 and 1200"),
        "the resolution is named first: {:?}",
        refusal.summary,
    );

    let size_still_wrong = figure_settings(20_000, 20_000, 300);
    let refusal = service
        .begin_spectrum_export(&token, "png", &size_still_wrong)
        .expect_err("the size was not fixed by fixing the resolution");
    assert!(
        refusal.summary.contains("32 million pixels"),
        "and then the size: {:?}",
        refusal.summary,
    );
}

#[test]
fn a_saved_png_reports_the_resolution_it_recorded_and_an_svg_reports_none() {
    // What the interface is told, checked against what was written. The
    // reservation carries the resolution the export began with, so the
    // confirmation describes the file rather than whatever the fields say by
    // the time it appears.
    let (file, service, token) = one_loaded_spectrum();
    let folder = file.path.parent().expect("a folder");

    let reservation = service
        .begin_spectrum_export(&token, "png", &figure_settings(400, 300, 600))
        .expect("the export begins");
    let claimed = service
        .claim_spectrum_export(&reservation)
        .expect("the reservation is claimable once");
    let outcome = service
        .write_spectrum_export(&claimed, &folder.join("figure-settings.png"))
        .expect("the file is written");
    let SpectrumExportOutcomeDto::Saved { figure, .. } = outcome else {
        panic!("a written export is saved");
    };
    let figure = figure.expect("a PNG is a figure");
    assert_eq!(figure.width, 400);
    assert_eq!(figure.height, 300);
    assert_eq!(figure.dpi, Some(600));

    let reservation = service
        .begin_spectrum_export(&token, "svg", &figure_settings(400, 300, 600))
        .expect("the export begins");
    let claimed = service
        .claim_spectrum_export(&reservation)
        .expect("claimable");
    let outcome = service
        .write_spectrum_export(&claimed, &folder.join("figure-settings.svg"))
        .expect("the file is written");
    let SpectrumExportOutcomeDto::Saved { figure, .. } = outcome else {
        panic!("a written export is saved");
    };
    let figure = figure.expect("an SVG is a figure");
    assert_eq!(
        figure.dpi, None,
        "a vector document records no physical resolution, whatever was asked for"
    );
}

#[test]
fn a_spectrum_that_turns_out_unavailable_revokes_the_retained_one() {
    let file = TestFile::new("lifecycle-unavailable");
    let service = PreviewService::new(Box::new(FakeProvider::available(vec![
        one_spectrum(),
        Response::NoOutput,
    ])));
    let selected = service.accept_file(&file.path).expect("accepted");
    let token = loaded_export_token(&service, &selected.handle, 0);
    let retained = service
        .retained_spectrum_weak()
        .expect("a loaded spectrum is retained");

    let outcome = service
        .load_spectrum(&selected.handle, 1)
        .expect("an absent index is an answer, not a failure");
    assert!(matches!(
        outcome,
        SelectedSpectrumOutcomeDto::Unavailable { .. }
    ));

    assert!(
        retained.upgrade().is_none(),
        "the arrays are released once nothing names them"
    );
    let refusal = service
        .begin_spectrum_export(&token, "svg", &default_figure_settings())
        .expect_err("the old token names a spectrum this session no longer has");
    assert_eq!(refusal.kind, "spectrum_export_stale");
}

#[test]
fn a_spectrum_whose_read_fails_revokes_the_retained_one() {
    let file = TestFile::new("lifecycle-failed");
    let service = PreviewService::new(Box::new(FakeProvider::available(vec![
        one_spectrum(),
        Response::Error(PreviewErrorDto::new(
            "spectrum_failed",
            "the read did not complete",
            true,
        )),
    ])));
    let selected = service.accept_file(&file.path).expect("accepted");
    let token = loaded_export_token(&service, &selected.handle, 0);
    let retained = service
        .retained_spectrum_weak()
        .expect("a loaded spectrum is retained");

    service
        .load_spectrum(&selected.handle, 1)
        .expect_err("the read fails");

    assert!(retained.upgrade().is_none());
    assert_eq!(
        service
            .begin_spectrum_export(&token, "csv", &default_figure_settings())
            .expect_err("stale")
            .kind,
        "spectrum_export_stale"
    );
}

#[test]
fn removing_the_previews_own_dataset_revokes_the_retained_spectrum() {
    let file = TestFile::new("lifecycle-remove-own");
    let service = PreviewService::new(Box::new(FakeProvider::available(vec![one_spectrum()])));
    let selected = service.accept_file(&file.path).expect("accepted");
    let token = loaded_export_token(&service, &selected.handle, 0);
    let retained = service
        .retained_spectrum_weak()
        .expect("a loaded spectrum is retained");

    service
        .remove_datasets(std::slice::from_ref(&selected.handle))
        .expect("the row is removed");

    assert!(retained.upgrade().is_none());
    assert_eq!(
        service
            .begin_spectrum_export(&token, "svg", &default_figure_settings())
            .expect_err("stale")
            .kind,
        "spectrum_export_stale"
    );
}

#[test]
fn removing_an_unrelated_dataset_leaves_the_retained_spectrum() {
    // The frontend keeps the preview open when a row *around* it goes, and this
    // is the half of the invariant that says so. A slot that forgot on any
    // removal would refuse the next export of a spectrum still on screen.
    let file = TestFile::new("lifecycle-remove-other");
    let sibling = file.sibling("other.mzML");
    let service = PreviewService::new(Box::new(FakeProvider::available(vec![one_spectrum()])));
    // Added as a batch, because accepting a file one at a time is the picker
    // path and that replaces the whole selection.
    service.add_files_now(&[file.path.clone(), sibling]);
    let roster = service.roster();
    let read = roster.datasets[0].handle.clone();
    let unrelated = roster.datasets[1].handle.clone();
    let token = loaded_export_token(&service, &read, 0);

    service
        .remove_datasets(std::slice::from_ref(&unrelated))
        .expect("the other row is removed");

    assert!(
        service.retained_spectrum_weak().is_some(),
        "the spectrum on screen is untouched by a removal elsewhere"
    );
    service
        .begin_spectrum_export(&token, "svg", &default_figure_settings())
        .expect("the spectrum on screen is still exportable");
}

#[test]
fn clearing_the_list_revokes_the_retained_spectrum() {
    let file = TestFile::new("lifecycle-clear");
    let service = PreviewService::new(Box::new(FakeProvider::available(vec![one_spectrum()])));
    let selected = service.accept_file(&file.path).expect("accepted");
    let token = loaded_export_token(&service, &selected.handle, 0);
    let retained = service
        .retained_spectrum_weak()
        .expect("a loaded spectrum is retained");

    service.clear_workspace().expect("the list clears");

    assert!(retained.upgrade().is_none());
    assert_eq!(
        service
            .begin_spectrum_export(&token, "tsv", &default_figure_settings())
            .expect_err("stale")
            .kind,
        "spectrum_export_stale"
    );
}

#[test]
fn opening_a_preview_revokes_whatever_the_last_one_left() {
    // Whatever happens next. An open takes the current preview off the screen
    // before it can succeed or fail, so the retained spectrum stops being named
    // at that moment -- which is why this asserts it against an open that does
    // not even complete.
    let file = TestFile::new("lifecycle-open");
    let service = PreviewService::new(Box::new(FakeProvider::available(vec![one_spectrum()])));
    let selected = service.accept_file(&file.path).expect("accepted");
    let token = loaded_export_token(&service, &selected.handle, 0);
    let retained = service
        .retained_spectrum_weak()
        .expect("a loaded spectrum is retained");

    service
        .open_preview(&selected.handle)
        .expect_err("this fake has no further response to give");

    assert!(retained.upgrade().is_none());
    assert_eq!(
        service
            .begin_spectrum_export(&token, "svg", &default_figure_settings())
            .expect_err("stale")
            .kind,
        "spectrum_export_stale"
    );
}

#[test]
fn reading_the_roster_does_not_revoke_the_retained_spectrum() {
    // The Rust-side shape of the M4.1 invariant that focus is not a revocation.
    // Moving the keyboard to a vendor row while the preview stays visible calls
    // no command that changes the selection; what it does reach is the roster,
    // and the spectrum has to survive that.
    let file = TestFile::new("lifecycle-focus");
    let sibling = file.sibling("beside.mzML");
    let service = PreviewService::new(Box::new(FakeProvider::available(vec![one_spectrum()])));
    service.add_files_now(&[file.path.clone(), sibling]);
    let read = service.roster().datasets[0].handle.clone();
    let token = loaded_export_token(&service, &read, 0);

    let roster = service.roster();
    assert_eq!(roster.datasets.len(), 2);

    assert!(service.retained_spectrum_weak().is_some());
    service
        .begin_spectrum_export(&token, "svg", &default_figure_settings())
        .expect("the spectrum a user is reading stays exportable");
}

#[test]
fn a_claimed_export_finishes_after_the_spectrum_it_names_is_revoked() {
    // The exception the whole design turns on. Revocation ends the ability to
    // start something new; it does not reach into an operation the user already
    // committed to, which holds its own handle and finishes from that.
    let file = TestFile::new("lifecycle-claimed");
    let service = PreviewService::new(Box::new(FakeProvider::available(vec![one_spectrum()])));
    let selected = service.accept_file(&file.path).expect("accepted");
    let token = loaded_export_token(&service, &selected.handle, 0);

    let reservation = service
        .begin_spectrum_export(&token, "svg", &default_figure_settings())
        .expect("the export begins");
    let claimed = service
        .claim_spectrum_export(&reservation)
        .expect("the reservation is claimed");

    // The user is standing in a save dialog when the list is cleared.
    service.clear_workspace().expect("the list clears");

    assert!(
        service.retained_spectrum_weak().is_none(),
        "the slot holds nothing current"
    );
    assert_eq!(
        service
            .begin_spectrum_export(&token, "svg", &default_figure_settings())
            .expect_err("a new export is refused")
            .kind,
        "spectrum_export_stale"
    );

    let destination = file.directory.join("claimed.svg");
    service
        .write_spectrum_export(&claimed, &destination)
        .expect("the claimed export still writes the spectrum it named");
    let written = fs::read_to_string(&destination).expect("the file exists");
    assert!(written.contains("<svg"), "{written:.60}");
}

#[test]
fn a_later_spectrum_installs_one_snapshot_and_keeps_no_history() {
    let file = TestFile::new("lifecycle-replace");
    let service = PreviewService::new(Box::new(FakeProvider::available(vec![
        one_spectrum(),
        Response::File(selected_spectrum_output(1, &[(300.5, 5.0)])),
    ])));
    let selected = service.accept_file(&file.path).expect("accepted");
    let first = loaded_export_token(&service, &selected.handle, 0);
    let retained = service
        .retained_spectrum_weak()
        .expect("a loaded spectrum is retained");

    let second = loaded_export_token(&service, &selected.handle, 1);

    assert_ne!(first, second, "each retained spectrum has its own name");
    assert!(
        retained.upgrade().is_none(),
        "the replaced spectrum is released rather than accumulated"
    );
    assert_eq!(
        service
            .begin_spectrum_export(&first, "svg", &default_figure_settings())
            .expect_err("stale")
            .kind,
        "spectrum_export_stale"
    );
    service
        .begin_spectrum_export(&second, "svg", &default_figure_settings())
        .expect("the spectrum now on screen is the exportable one");
}

#[test]
fn choosing_another_file_through_the_picker_revokes_the_retained_spectrum() {
    // The single-file picker replaces the whole selection rather than adding to
    // it, so the dataset the retained spectrum came from stops existing. This
    // path empties the workspace without going through `clear_workspace`, which
    // is exactly why it needs its own revocation and its own test.
    let file = TestFile::new("lifecycle-replace-selection");
    let another = file.sibling("another.mzML");
    let service = PreviewService::new(Box::new(FakeProvider::available(vec![one_spectrum()])));
    let selected = service.accept_file(&file.path).expect("accepted");
    let token = loaded_export_token(&service, &selected.handle, 0);
    let retained = service
        .retained_spectrum_weak()
        .expect("a loaded spectrum is retained");

    service
        .accept_file(&another)
        .expect("the new file is chosen");

    assert!(retained.upgrade().is_none());
    assert_eq!(
        service
            .begin_spectrum_export(&token, "svg", &default_figure_settings())
            .expect_err("stale")
            .kind,
        "spectrum_export_stale"
    );
}

// ------------------------------- a saved file is named as what it holds

/// Writes one selected-spectrum export to a chosen name, answering the refusal.
fn spectrum_saved_as(
    service: &PreviewService,
    token: &str,
    format: &str,
    destination: &Path,
) -> Option<PreviewErrorDto> {
    let reservation = service
        .begin_spectrum_export(token, format, &default_figure_settings())
        .expect("the export begins");
    let claimed = service
        .claim_spectrum_export(&reservation)
        .expect("its dialog");
    service.write_spectrum_export(&claimed, destination).err()
}

/// The same, for the chromatogram.
fn chromatogram_saved_as(
    service: &PreviewService,
    token: &str,
    format: &str,
    destination: &Path,
) -> Option<PreviewErrorDto> {
    let reservation = service
        .begin_chromatogram_export(
            token,
            format,
            &full_run_range(),
            both_traces(),
            &default_figure_settings(),
        )
        .expect("the export begins");
    let claimed = service
        .claim_chromatogram_export(&reservation)
        .expect("its dialog");
    service
        .write_chromatogram_export(&claimed, destination)
        .err()
}

/// A selected-spectrum file is named as the document it holds.
///
/// The cross-writer finding M4.3's review raised. The dialog's filter is
/// guidance -- it appends its own extension only where the typed name carries
/// none -- so a user who types one of their own gets it back unchanged, and the
/// writer used to publish whatever bytes the format decided under whatever name
/// came back. A CSV called `.svg` is read as an SVG by everything downstream.
#[test]
fn a_selected_spectrum_export_is_refused_under_another_format_s_extension() {
    let file = TestFile::new("spectrum-extension");
    let service = PreviewService::new(Box::new(FakeProvider::available(vec![
        one_spectrum(),
        one_spectrum(),
        one_spectrum(),
        one_spectrum(),
        one_spectrum(),
        one_spectrum(),
    ])));
    let selected = service.accept_file(&file.path).expect("accepted");
    let token = loaded_export_token(&service, &selected.handle, 0);
    let folder = file.path.parent().expect("a folder");

    // What matches is written, whatever case it was typed in.
    for (format, name) in [
        ("csv", "measured.csv"),
        ("csv", "measured-upper.CSV"),
        ("csv", "measured-mixed.CsV"),
        ("tsv", "measured.tsv"),
        ("png", "measured.png"),
    ] {
        assert_eq!(
            spectrum_saved_as(&service, &token, format, &folder.join(name)).map(|error| error.kind),
            None,
            "{name} names a {format} document",
        );
    }

    // And what does not is refused, in either direction.
    for (format, name) in [("csv", "measured-wrong.svg"), ("svg", "measured-wrong.csv")] {
        let refusal = spectrum_saved_as(&service, &token, format, &folder.join(name))
            .expect("a name that says something else is refused");
        assert_eq!(refusal.kind, "spectrum_destination_misnamed");
    }
}

/// The chromatogram answers to the same rule, from the same facts.
#[test]
fn a_chromatogram_export_is_refused_under_another_format_s_extension() {
    let file = TestFile::new("chromatogram-extension");
    let service = PreviewService::new(Box::new(FakeProvider::available(open_responses())));
    let token = chromatogram_ready(&file, &service);
    let folder = file.path.parent().expect("a folder");

    for (format, name) in [
        ("csv", "run.csv"),
        ("csv", "run-upper.CSV"),
        ("tsv", "run.tsv"),
        ("svg", "run.svg"),
    ] {
        assert_eq!(
            chromatogram_saved_as(&service, &token, format, &folder.join(name))
                .map(|error| error.kind),
            None,
            "{name} names a {format} document",
        );
    }

    for (format, name) in [("csv", "run-wrong.svg"), ("svg", "run-wrong.csv")] {
        let refusal = chromatogram_saved_as(&service, &token, format, &folder.join(name))
            .expect("a name that says something else is refused");
        assert_eq!(refusal.kind, "spectrum_destination_misnamed");
    }
}

/// Everything that is not an extension this document could have fails closed.
///
/// The final extension is what is compared, so a name that ends in something
/// else is refused however it got there -- a second suffix after the right one,
/// a trailing dot that names nothing, or no extension at all. The dialog
/// normally appends one; the writer checks rather than assuming it did.
#[test]
fn a_destination_with_no_usable_extension_is_refused() {
    let file = TestFile::new("extension-edges");
    let service = PreviewService::new(Box::new(FakeProvider::available(open_responses())));
    let token = chromatogram_ready(&file, &service);
    let folder = file.path.parent().expect("a folder");

    for name in ["run.csv.txt", "run.", "run"] {
        let refusal = chromatogram_saved_as(&service, &token, "csv", &folder.join(name))
            .expect("a name that is not a CSV's is refused");
        assert_eq!(refusal.kind, "spectrum_destination_misnamed", "{name}");
        // The correction names the extension and the document, and nothing
        // about where the user was working.
        assert_eq!(
            refusal.summary,
            "Choose a filename ending in .csv for a CSV export.",
        );
        assert!(
            !refusal
                .summary
                .contains(&folder.to_string_lossy().to_string())
        );
        assert!(refusal.retryable, "another name is the way out of this");
    }
}

/// A refusal writes nothing and leaves the lane ready for the next attempt.
#[test]
fn a_misnamed_destination_writes_nothing_and_frees_the_lane() {
    let file = TestFile::new("misnamed-frees-lane");
    let service = PreviewService::new(Box::new(FakeProvider::available(open_responses())));
    let token = chromatogram_ready(&file, &service);
    let folder = file.path.parent().expect("a folder");

    // A file already sitting at the wrong name is not touched either: the
    // refusal happens before anything is opened or created.
    let occupied = folder.join("taken.svg");
    fs::write(&occupied, b"someone else's file").expect("write the existing file");

    assert_eq!(
        chromatogram_saved_as(&service, &token, "csv", &occupied)
            .expect("refused")
            .kind,
        "spectrum_destination_misnamed",
    );
    assert_eq!(
        fs::read(&occupied).expect("the existing file is still there"),
        b"someone else's file",
        "nothing was written over a file this export was never going to name",
    );

    // And the next export begins normally, which is what "retryable" has to
    // mean: the lane was released rather than left holding a write.
    assert_eq!(
        chromatogram_saved_as(&service, &token, "csv", &folder.join("taken.csv")).map(|e| e.kind),
        None,
    );
}

/// A correctly named destination that exists is still the no-overwrite refusal.
///
/// Naming is an admission condition in front of the publication rule, not a
/// replacement for it. A name that says what it holds and is already taken
/// still fails where it always did, with the answer it always gave.
#[test]
fn a_correctly_named_destination_that_exists_still_refuses_as_before() {
    let file = TestFile::new("named-but-taken");
    let service = PreviewService::new(Box::new(FakeProvider::available(open_responses())));
    let token = chromatogram_ready(&file, &service);
    let folder = file.path.parent().expect("a folder");
    let taken = folder.join("already-here.csv");
    fs::write(&taken, b"an earlier export").expect("write the existing file");

    let refusal = chromatogram_saved_as(&service, &token, "csv", &taken)
        .expect("a name already taken is refused");
    assert_ne!(
        refusal.kind, "spectrum_destination_misnamed",
        "the name is right; what is wrong is that it is taken",
    );
    assert_eq!(
        fs::read(&taken).expect("still there"),
        b"an earlier export",
        "and the file that was there is untouched",
    );
}

// ------------------------------------ a data document has no figure settings

/// Figure settings that are a whole number and still outside what Rust draws.
///
/// The frontend accepts these: its rule is "a whole number of at least 1",
/// deliberately, because it is not the authority on the figure contract. So
/// this is the shape that actually reaches the boundary from a real interface,
/// not a value only a test could produce.
fn figure_settings_sized(width: u32, height: u32) -> FigureSettingsDto {
    FigureSettingsDto {
        width_px: width,
        height_px: height,
        ..default_figure_settings()
    }
}

/// One chromatogram to export, and the token that names it.
fn chromatogram_ready(file: &TestFile, service: &PreviewService) -> String {
    let selected = service.accept_file(&file.path).expect("accepted");
    service
        .open_preview(&selected.handle)
        .expect("the run opens")
        .chromatogram_export_token
        .expect("a run the viewer draws has a chromatogram export")
}

/// Begins one chromatogram export and returns it to idle, answering the refusal.
fn chromatogram_export_attempt(
    service: &PreviewService,
    token: &str,
    format: &str,
    settings: &FigureSettingsDto,
) -> Option<String> {
    match service.begin_chromatogram_export(
        token,
        format,
        &full_run_range(),
        both_traces(),
        settings,
    ) {
        Ok(reservation) => {
            service.cancel_chromatogram_export(&reservation);
            None
        }
        Err(error) => Some(error.kind),
    }
}

/// CSV and TSV are lists of numbers, and no figure setting reaches one.
///
/// The reachable case M4.3's final observation found. The panel leaves the data
/// actions available when a figure setting is unusable -- correctly, because a
/// width says nothing about a column of retention times -- and forwards the
/// draft it has. Rust was validating the whole `FigureSettingsDto` before it had
/// looked at the format, so `Export CSV…` came back refused for the shape of a
/// drawing nobody had asked for.
///
/// Every one of these sizes is a whole number the frontend accepts and the
/// figure contract refuses: too wide, too narrow, too short.
#[test]
fn a_chromatogram_data_export_ignores_figure_settings_it_has_no_use_for() {
    let file = TestFile::new("data-has-no-figure");
    let service = PreviewService::new(Box::new(FakeProvider::available(open_responses())));
    let token = chromatogram_ready(&file, &service);

    for settings in [
        default_figure_settings(),
        figure_settings_sized(20_001, 900),
        figure_settings_sized(5, 900),
        figure_settings_sized(1_200, 1),
        figure_settings_sized(20_001, 20_001),
    ] {
        for format in ["csv", "tsv"] {
            assert_eq!(
                chromatogram_export_attempt(&service, &token, format, &settings),
                None,
                "{format} at {}x{} is the same list of numbers",
                settings.width_px,
                settings.height_px,
            );
        }
    }
}

/// A theme no figure has is still not a property of a data document.
///
/// The size is the reachable case, but the rule is about the whole of the
/// figure settings rather than about two of its fields. A CSV is not drawn, so
/// nothing about how it would have been drawn can refuse it.
#[test]
fn a_chromatogram_data_export_ignores_an_unknown_theme_and_an_unusable_resolution() {
    let file = TestFile::new("data-has-no-theme");
    let service = PreviewService::new(Box::new(FakeProvider::available(open_responses())));
    let token = chromatogram_ready(&file, &service);
    let odd = FigureSettingsDto {
        theme: "chartreuse".to_owned(),
        png_dpi: 0,
        ..default_figure_settings()
    };

    assert_eq!(
        chromatogram_export_attempt(&service, &token, "csv", &odd),
        None,
    );
    assert_eq!(
        chromatogram_export_attempt(&service, &token, "tsv", &odd),
        None,
    );
    // And the figure formats still answer for both of them.
    assert_eq!(
        chromatogram_export_attempt(&service, &token, "svg", &odd),
        Some("figure_settings_refused".to_owned()),
    );
}

/// The figure formats keep every check they had.
///
/// The repair is about which outputs are asked, not about relaxing the contract
/// for the outputs that are drawn. The order inside this block is the accepted
/// one and is asserted rather than assumed: an unusable size is refused before
/// a resolution is even read, and a resolution before the pixel budget.
#[test]
fn a_chromatogram_figure_export_still_answers_for_every_figure_setting() {
    let file = TestFile::new("figure-still-checked");
    let service = PreviewService::new(Box::new(FakeProvider::available(open_responses())));
    let token = chromatogram_ready(&file, &service);
    let oversize = figure_settings_sized(20_001, 900);

    assert_eq!(
        chromatogram_export_attempt(&service, &token, "svg", &oversize),
        Some("figure_settings_refused".to_owned()),
    );
    assert_eq!(
        chromatogram_export_attempt(&service, &token, "png", &oversize),
        Some("figure_settings_refused".to_owned()),
    );
    // A resolution nothing records, at a size that is fine.
    let bad_dpi = FigureSettingsDto {
        png_dpi: 3,
        ..default_figure_settings()
    };
    assert_eq!(
        chromatogram_export_attempt(&service, &token, "png", &bad_dpi),
        Some("figure_settings_refused".to_owned()),
    );
    // And an SVG, which has no resolution to be wrong about, is untouched by it.
    assert_eq!(
        chromatogram_export_attempt(&service, &token, "svg", &bad_dpi),
        None,
    );
}

/// The selected spectrum's answers do not move.
///
/// It already had the right posture -- this repair brought the chromatogram to
/// it -- so the two now say the same thing about the same settings, and that is
/// what is pinned here rather than a second copy of the rule.
#[test]
fn the_selected_spectrum_export_answers_the_same_way_it_always_did() {
    let file = TestFile::new("spectrum-unmoved");
    let service = PreviewService::new(Box::new(FakeProvider::available(vec![one_spectrum()])));
    let selected = service.accept_file(&file.path).expect("accepted");
    let token = loaded_export_token(&service, &selected.handle, 0);
    let oversize = figure_settings_sized(20_001, 900);

    for format in ["csv", "tsv"] {
        let reservation = service
            .begin_spectrum_export(&token, format, &oversize)
            .expect("a data document has no figure settings here either");
        service.cancel_spectrum_export(&reservation);
    }
    assert_eq!(
        service
            .begin_spectrum_export(&token, "svg", &oversize)
            .expect_err("a figure still answers for its size")
            .kind,
        "figure_settings_refused",
    );
}

// -------------------------------------- which preview open owns the chromatogram

/// Holds every read of one named file until the test lets it go.
///
/// `BlockFirstProvider` blocks whichever read arrives first, which is the wrong
/// shape for a test that has to establish a preview *before* the one it means to
/// catch half-way. This one names its victim.
struct BlockOneSourceProvider {
    inner: FakeProvider,
    blocked: PathBuf,
    started: mpsc::Sender<()>,
    release: Mutex<Option<mpsc::Receiver<()>>>,
}

impl PreviewProvider for BlockOneSourceProvider {
    fn use_installation(&self, _home: Option<PathBuf>) {}

    fn availability(&self) -> (BackendAvailabilityDto, Option<InstallationIdentity>) {
        self.inner.availability()
    }

    fn run(
        &self,
        source: &Path,
        operation: &PreviewOperation,
    ) -> Result<OperationAttempt, PreviewErrorDto> {
        // By name rather than by whole path: the service revalidates what it
        // was given, so what reaches a provider is not byte-identical to the
        // path a test handed to `add_dataset`.
        if source.file_name() == self.blocked.file_name()
            && let Some(release) = self.release.lock().expect("test lock").take()
        {
            let _ = self.started.send(());
            release
                .recv_timeout(Duration::from_secs(10))
                .expect("the test released the gate rather than timing out");
        }
        self.inner.run(source, operation)
    }
}

fn full_run_range() -> ChromatogramRangeDto {
    ChromatogramRangeDto {
        scope: "full".to_owned(),
        low: None,
        high: None,
    }
}

const fn both_traces() -> ChromatogramTracesDto {
    ChromatogramTracesDto {
        tic: true,
        bpc: true,
    }
}

/// Whether this token still names a run this session would export.
fn chromatogram_export_refusal(service: &PreviewService, token: &str) -> Option<String> {
    match service.begin_chromatogram_export(
        token,
        "csv",
        &full_run_range(),
        both_traces(),
        &default_figure_settings(),
    ) {
        Ok(reservation) => {
            // Returned to idle, so one probe does not decide the next one's
            // answer by leaving the lane reserved.
            service.cancel_chromatogram_export(&reservation);
            None
        }
        Err(error) => Some(error.kind),
    }
}

/// Opening another run moves the one chromatogram export onto it.
#[test]
fn opening_another_run_moves_the_chromatogram_export_to_the_visible_one() {
    let file = TestFile::new("chromatogram-owner");
    let other = file.copy("other.mzML");
    let mut responses = open_responses();
    responses.extend(open_responses());
    let service = PreviewService::new(Box::new(FakeProvider::available(responses)));
    let first = service.add_dataset(&file.path).expect("added");
    let second = service.add_dataset(&other).expect("added");

    let opened = service
        .open_preview(&first.handle)
        .expect("the first opens");
    let replaced = opened
        .chromatogram_export_token
        .expect("a run the viewer draws has a chromatogram export");
    assert_eq!(chromatogram_export_refusal(&service, &replaced), None);

    let opened = service
        .open_preview(&second.handle)
        .expect("the second opens");
    let visible = opened
        .chromatogram_export_token
        .expect("and so does the run that replaced it");

    assert_ne!(visible, replaced, "a new run is named by a new token");
    assert_eq!(chromatogram_export_refusal(&service, &visible), None);
    assert_eq!(
        chromatogram_export_refusal(&service, &replaced),
        Some("chromatogram_export_stale".to_owned()),
        "a token naming a run nobody is looking at exports nothing",
    );
}

/// The chromatogram goes when the *next* open begins, not when it finishes.
///
/// The webview raises its own counter before it calls and takes the previous
/// preview off the screen there; a session that waited for the reply would go on
/// offering an export of a run nothing is showing, for as long as a large file
/// takes to read.
#[test]
fn beginning_another_open_revokes_the_chromatogram_before_the_read_returns() {
    let file = TestFile::new("chromatogram-begin-revokes");
    let other = file.copy("other.mzML");
    let mut responses = open_responses();
    responses.extend(open_responses());
    let (started, observe_start) = mpsc::channel();
    let (release, wait_for_release) = mpsc::channel();
    let service = Arc::new(PreviewService::new(Box::new(BlockOneSourceProvider {
        inner: FakeProvider::available(responses),
        blocked: other.clone(),
        started,
        release: Mutex::new(Some(wait_for_release)),
    })));
    let first = service.add_dataset(&file.path).expect("added");
    let second = service.add_dataset(&other).expect("added");

    let replaced = service
        .open_preview(&first.handle)
        .expect("the first opens")
        .chromatogram_export_token
        .expect("a run the viewer draws has a chromatogram export");
    assert_eq!(chromatogram_export_refusal(&service, &replaced), None);

    let opening = {
        let service = Arc::clone(&service);
        let handle = second.handle.clone();
        std::thread::spawn(move || service.open_preview(&handle))
    };
    observe_start
        .recv_timeout(Duration::from_secs(10))
        .expect("the second open reached the provider");

    assert_eq!(
        chromatogram_export_refusal(&service, &replaced),
        Some("chromatogram_export_stale".to_owned()),
        "the run being replaced stopped being exportable when the open began",
    );

    release.send(()).expect("the provider is still waiting");
    let visible = opening
        .join()
        .expect("the second open finished")
        .expect("the second opens")
        .chromatogram_export_token
        .expect("and it has a chromatogram of its own");
    assert_eq!(chromatogram_export_refusal(&service, &visible), None);
}

/// A row removed while its open was reading leaves no chromatogram behind.
///
/// The completion is refused by the per-dataset check before it reaches the
/// export slots -- the dataset it describes is gone -- so nothing installs, and
/// the run it replaced is not resurrected either.
#[test]
fn a_dataset_removed_while_it_was_opening_installs_no_chromatogram() {
    let file = TestFile::new("chromatogram-removed-while-opening");
    let other = file.copy("other.mzML");
    let mut responses = open_responses();
    responses.extend(open_responses());
    let (started, observe_start) = mpsc::channel();
    let (release, wait_for_release) = mpsc::channel();
    let service = Arc::new(PreviewService::new(Box::new(BlockOneSourceProvider {
        inner: FakeProvider::available(responses),
        blocked: other.clone(),
        started,
        release: Mutex::new(Some(wait_for_release)),
    })));
    let first = service.add_dataset(&file.path).expect("added");
    let second = service.add_dataset(&other).expect("added");

    let replaced = service
        .open_preview(&first.handle)
        .expect("the first opens")
        .chromatogram_export_token
        .expect("a run the viewer draws has a chromatogram export");

    let opening = {
        let service = Arc::clone(&service);
        let handle = second.handle.clone();
        std::thread::spawn(move || service.open_preview(&handle))
    };
    observe_start
        .recv_timeout(Duration::from_secs(10))
        .expect("the second open reached the provider");

    service
        .remove_datasets(std::slice::from_ref(&second.handle))
        .expect("a row not being converted is the user's to remove");
    release.send(()).expect("the provider is still waiting");
    assert!(
        opening.join().expect("the second open finished").is_err(),
        "an open of a row the session no longer has records nothing",
    );

    assert_eq!(
        chromatogram_export_refusal(&service, &replaced),
        Some("chromatogram_export_stale".to_owned()),
        "and the run it replaced is not restored",
    );
}

/// Holds the first read of each of two named files until the test lets it go.
///
/// Two independent gates rather than one, because the interleaving below needs
/// both opens parked at once: one released into its completion while the other
/// is held at the point where it has already taken its ticket.
struct GateTwoSourcesProvider {
    inner: FakeProvider,
    first: PathBuf,
    second: PathBuf,
    started: mpsc::Sender<&'static str>,
    first_release: Mutex<Option<mpsc::Receiver<()>>>,
    second_release: Mutex<Option<mpsc::Receiver<()>>>,
}

impl PreviewProvider for GateTwoSourcesProvider {
    fn use_installation(&self, _home: Option<PathBuf>) {}

    fn availability(&self) -> (BackendAvailabilityDto, Option<InstallationIdentity>) {
        self.inner.availability()
    }

    fn run(
        &self,
        source: &Path,
        operation: &PreviewOperation,
    ) -> Result<OperationAttempt, PreviewErrorDto> {
        let gate = if source.file_name() == self.first.file_name() {
            Some(("first", &self.first_release))
        } else if source.file_name() == self.second.file_name() {
            Some(("second", &self.second_release))
        } else {
            None
        };
        if let Some((name, gate)) = gate
            && let Some(release) = gate.lock().expect("test lock").take()
        {
            let _ = self.started.send(name);
            release
                .recv_timeout(Duration::from_secs(10))
                .expect("the test released the gate rather than timing out");
        }
        self.inner.run(source, operation)
    }
}

/// The ordering rule holds through the real command, not only the slot.
///
/// The slot's own tests drive [`ScientificExportSlots`] directly. This one goes
/// through `open_preview` twice, concurrently, so what is pinned is the wiring
/// as well as the rule: that an open takes its ticket before its read, that the
/// completion carries that same ticket to the reconcile, and that a run the
/// session has moved past is not the exportable one afterwards.
///
/// The older open is held in its read until the newer one has been started, and
/// the assertion is taken while the newer one is still reading -- the window in
/// which the session is between previews and has nothing to export at all. The
/// invariant does not depend on which thread wins anything: whatever order the
/// two completions arrive in, the replaced run is never what an export names.
/// Repeated, because a race only has to go one way once for the defect to be
/// real.
#[test]
fn an_open_completing_as_a_newer_one_begins_never_installs_over_it() {
    for _ in 0..40 {
        let file = TestFile::new("chromatogram-reconcile-seam");
        let other = file.copy("other.mzML");
        let mut responses = open_responses();
        responses.extend(open_responses());
        let (started, observe_start) = mpsc::channel();
        let (release_older, older_waits) = mpsc::channel();
        let (release_newer, newer_waits) = mpsc::channel();
        let service = Arc::new(PreviewService::new(Box::new(GateTwoSourcesProvider {
            inner: FakeProvider::available(responses),
            first: file.path.clone(),
            second: other.clone(),
            started,
            first_release: Mutex::new(Some(older_waits)),
            second_release: Mutex::new(Some(newer_waits)),
        })));
        let first = service.add_dataset(&file.path).expect("added");
        let second = service.add_dataset(&other).expect("added");

        // The older open takes its ticket and parks in its read.
        let older = {
            let service = Arc::clone(&service);
            let handle = first.handle.clone();
            std::thread::spawn(move || service.open_preview(&handle))
        };
        assert_eq!(
            observe_start
                .recv_timeout(Duration::from_secs(10))
                .expect("the older open reached the provider"),
            "first",
        );

        // The newer open is a live thread already waiting, so that releasing the
        // older one puts the two into the workspace lock together rather than
        // paying for a thread to be created first.
        let (start_newer, newer_may_start) = mpsc::channel();
        let newer = {
            let service = Arc::clone(&service);
            let handle = second.handle.clone();
            std::thread::spawn(move || {
                newer_may_start
                    .recv_timeout(Duration::from_secs(10))
                    .expect("the test started it");
                service.open_preview(&handle)
            })
        };
        release_older.send(()).expect("the older open is waiting");
        start_newer.send(()).expect("the newer open is waiting");

        let replaced = older
            .join()
            .expect("the older open finished")
            .expect("its own dataset is still the newest request for itself")
            .chromatogram_export_token;
        assert_eq!(
            observe_start
                .recv_timeout(Duration::from_secs(10))
                .expect("the newer open reached the provider"),
            "second",
        );

        // The newer open has its ticket and has not finished reading, so the
        // session is between previews and has nothing to export -- whether the
        // older completion was refused outright or installed and was revoked by
        // the newer beginning.
        if let Some(replaced) = replaced.as_deref() {
            assert_eq!(
                chromatogram_export_refusal(&service, replaced),
                Some("chromatogram_export_stale".to_owned()),
                "a run a newer open has already begun over is not the exportable one",
            );
        }

        release_newer.send(()).expect("the newer open is waiting");
        let visible = newer
            .join()
            .expect("the newer open finished")
            .expect("the newest open answers")
            .chromatogram_export_token
            .expect("and it names the run on screen");
        assert_eq!(chromatogram_export_refusal(&service, &visible), None);
    }
}

// ------------------------- a real preview attempt supersedes before it can fail

/// A backend that stopped being trusted still takes the preview off the screen.
///
/// The second reachable case M4.3's final observation found. `loadPreview`
/// raises its own counter, clears the preview and *then* calls; when the reply
/// is a refusal it shows the refusal rather than restoring what it replaced. So
/// by the time Rust decides it will not start a process, the run it was asked
/// to replace is already gone from the screen -- and a session that had not
/// revoked would still be naming it, ready to export science no viewer shows.
///
/// The race is real rather than contrived: the frontend refuses to call at all
/// while it knows the backend is unusable, so this is exactly the window where
/// quarantine begins after that check and before Rust answers.
#[test]
fn a_backend_that_became_unusable_refuses_the_open_and_leaves_no_chromatogram() {
    let file = TestFile::new("quarantine-replaces");
    let other = file.copy("other.mzML");
    let mut responses = open_responses();
    responses.extend(open_responses());
    let service = PreviewService::new(Box::new(FakeProvider::available(responses)));
    let visible = service.add_dataset(&file.path).expect("added");
    let replacement = service.add_dataset(&other).expect("added");

    let replaced = service
        .open_preview(&visible.handle)
        .expect("the first opens")
        .chromatogram_export_token
        .expect("a run the viewer draws has a chromatogram export");
    assert_eq!(chromatogram_export_refusal(&service, &replaced), None);

    // The session stops trusting the backend between the frontend's check and
    // this call.
    service.quarantine_backend_now();
    assert_eq!(
        service
            .open_preview(&replacement.handle)
            .expect_err("nothing launches a process while quarantined")
            .kind,
        "backend_quarantined",
    );

    assert_eq!(
        chromatogram_export_refusal(&service, &replaced),
        Some("chromatogram_export_stale".to_owned()),
        "the run the user navigated away from is not exportable afterwards",
    );
}

/// A conversion that took the slot does not leave the old chromatogram behind.
///
/// The same rule as quarantine and the same reason. A conversion starting is a
/// fact about the moment rather than about the row the user activated, and the
/// row they activated has already replaced what was on screen.
#[test]
fn a_conversion_that_started_refuses_the_open_and_leaves_no_chromatogram() {
    let fixture = TestFile::new("conversion-replaces");
    let other = fixture.copy("other.mzML");
    let acquisition = fixture.thermo_raw("acquisition.raw");
    let service = PreviewService::new(Box::new(
        ConvertingProvider::faithful().answering_previews(2),
    ));
    let visible = service.add_dataset(&fixture.path).expect("added");
    let replacement = service.add_dataset(&other).expect("added");
    let converting = add_one_acquisition(&service, &acquisition);

    let replaced = service
        .open_preview(&visible.handle)
        .expect("the first opens")
        .chromatogram_export_token
        .expect("a run the viewer draws has a chromatogram export");
    assert_eq!(chromatogram_export_refusal(&service, &replaced), None);

    let document = current_document(&service);
    service
        .begin_conversion(&converting, ConversionConflictPolicyDto::Fail, document)
        .expect("the conversion holds the slot from here");

    assert_eq!(
        service
            .open_preview(&replacement.handle)
            .expect_err("a preview is refused rather than queued behind a conversion")
            .kind,
        "conversion_busy",
    );
    assert_eq!(
        chromatogram_export_refusal(&service, &replaced),
        Some("chromatogram_export_stale".to_owned()),
        "the run the user navigated away from is not exportable afterwards",
    );
}

/// A handle the session does not have supersedes nothing.
///
/// The other half of the rule, and the half that keeps it from becoming "every
/// failed command revokes". Only a genuine mzML preview attempt replaces what is
/// on screen; a request naming nothing never opened anything, so the preview the
/// user is still looking at keeps its export.
#[test]
fn an_unknown_handle_leaves_the_visible_chromatogram_exportable() {
    let file = TestFile::new("unknown-handle-keeps");
    let service = PreviewService::new(Box::new(FakeProvider::available(open_responses())));
    let visible = chromatogram_ready(&file, &service);

    assert_eq!(
        service
            .open_preview("dataset-does-not-exist")
            .expect_err("a handle naming nothing is an unknown handle")
            .kind,
        "unknown_file_handle",
    );

    assert_eq!(
        chromatogram_export_refusal(&service, &visible),
        None,
        "the preview on screen never went away",
    );
}

/// A newer attempt that fails early does not let an older one resurrect a run.
///
/// The subtle sequence. Open A is still reading when a valid open of B arrives
/// and is refused at the conversion gate -- but B's *intent* was real, and it
/// took the ticket before it was refused. So when A finally completes it is an
/// open the session has passed, and it may neither install nor revoke. What the
/// user sees is B's failure over an empty viewer, and what Rust holds matches:
/// nothing.
#[test]
fn an_older_completion_cannot_install_after_a_newer_attempt_failed_early() {
    let file = TestFile::new("older-after-failed-newer");
    let slow = file.copy("slow.mzML");
    let third = file.copy("third.mzML");
    let mut responses = open_responses();
    responses.extend(open_responses());
    responses.extend(open_responses());
    let (started, observe_start) = mpsc::channel();
    let (release, wait_for_release) = mpsc::channel();
    let service = Arc::new(PreviewService::new(Box::new(BlockOneSourceProvider {
        inner: FakeProvider::available(responses),
        blocked: slow.clone(),
        started,
        release: Mutex::new(Some(wait_for_release)),
    })));
    let visible = service.add_dataset(&file.path).expect("added");
    let older = service.add_dataset(&slow).expect("added");
    let newer = service.add_dataset(&third).expect("added");

    // A run on screen, so there is something a wrong answer could resurrect --
    // and so this fixture is shown to produce chromatograms at all.
    let replaced = service
        .open_preview(&visible.handle)
        .expect("the first opens")
        .chromatogram_export_token
        .expect("a run the viewer draws has a chromatogram export");
    assert_eq!(chromatogram_export_refusal(&service, &replaced), None);

    // The user activates another row, and its read is slow.
    let opening = {
        let service = Arc::clone(&service);
        let handle = older.handle.clone();
        std::thread::spawn(move || service.open_preview(&handle))
    };
    observe_start
        .recv_timeout(Duration::from_secs(10))
        .expect("the older open reached the provider");
    assert_eq!(
        chromatogram_export_refusal(&service, &replaced),
        Some("chromatogram_export_stale".to_owned()),
        "beginning that open took the previous run away",
    );

    // Then a third activation, refused for a reason of the moment -- but its
    // intent was real and it took the ticket before it was refused.
    service.quarantine_backend_now();
    assert_eq!(
        service
            .open_preview(&newer.handle)
            .expect_err("nothing launches a process while quarantined")
            .kind,
        "backend_quarantined",
    );

    release.send(()).expect("the older open is still parked");
    let landed = opening
        .join()
        .expect("the older open finished")
        .expect("it is still the newest request for its own dataset");

    assert_eq!(
        landed.chromatogram_export_token, None,
        "an open a newer intent has already passed installs nothing",
    );
    assert_eq!(
        chromatogram_export_refusal(&service, &replaced),
        Some("chromatogram_export_stale".to_owned()),
        "and the run it replaced is not restored either",
    );
}

/// An export already claimed finishes, whatever the replacement does next.
///
/// ADR 0029's snapshot-at-begin semantics across a replacement that never
/// succeeded. Moving the viewer changes what a *new* export may name; it does
/// not cancel a file the user is in the middle of choosing a destination for,
/// and a preview attempt that was refused does not change that either way.
#[test]
fn a_claimed_export_survives_a_replacement_that_was_refused_early() {
    let file = TestFile::new("claimed-survives-refusal");
    let other = file.copy("other.mzML");
    let mut responses = open_responses();
    responses.extend(open_responses());
    let service = PreviewService::new(Box::new(FakeProvider::available(responses)));
    let visible = service.add_dataset(&file.path).expect("added");
    let replacement = service.add_dataset(&other).expect("added");

    let token = service
        .open_preview(&visible.handle)
        .expect("the first opens")
        .chromatogram_export_token
        .expect("a run the viewer draws has a chromatogram export");
    let reservation = service
        .begin_chromatogram_export(
            &token,
            "csv",
            &full_run_range(),
            both_traces(),
            &default_figure_settings(),
        )
        .expect("a reservation");
    let claimed = service
        .claim_chromatogram_export(&reservation)
        .expect("its dialog");

    // The user activates another row while that dialog is open, and the session
    // has stopped trusting the backend by the time Rust answers.
    service.quarantine_backend_now();
    assert_eq!(
        service
            .open_preview(&replacement.handle)
            .expect_err("nothing launches a process while quarantined")
            .kind,
        "backend_quarantined",
    );

    // What is being written is still the run it was begun from, and it is still
    // the lane's: a refused preview attempt neither cancelled the claim nor
    // rebound it onto whatever is loaded now.
    assert_eq!(
        claimed.snapshot.source().scan_count(),
        3,
        "the export writes the run it was begun on",
    );
    assert_eq!(
        claimed.suggested_file_name(),
        "mscanvas-chromatogram-full.csv",
    );
    assert_eq!(
        service
            .claim_chromatogram_export(&reservation)
            .expect_err("one reservation opens one dialog")
            .kind,
        "chromatogram_export_stale",
    );

    // And the token it was begun from names nothing new.
    assert_eq!(
        chromatogram_export_refusal(&service, &token),
        Some("chromatogram_export_stale".to_owned()),
    );
}

/// Emptying the list while an open was reading leaves no chromatogram behind.
///
/// The Remove case's sibling, and the one §20 of this milestone's lifecycle
/// rules asks for by name. Clearing revokes what the slots hold; what has to
/// hold as well is that the read still in flight cannot put one back afterwards.
/// It cannot, and the reason is the per-dataset check rather than the ticket:
/// the dataset the completion describes is no longer registered, so it is
/// refused before it reaches the export slots at all.
#[test]
fn clearing_the_list_while_a_run_was_opening_installs_no_chromatogram() {
    let file = TestFile::new("chromatogram-cleared-while-opening");
    let other = file.copy("other.mzML");
    let mut responses = open_responses();
    responses.extend(open_responses());
    let (started, observe_start) = mpsc::channel();
    let (release, wait_for_release) = mpsc::channel();
    let service = Arc::new(PreviewService::new(Box::new(BlockOneSourceProvider {
        inner: FakeProvider::available(responses),
        blocked: other.clone(),
        started,
        release: Mutex::new(Some(wait_for_release)),
    })));
    let first = service.add_dataset(&file.path).expect("added");
    let second = service.add_dataset(&other).expect("added");

    let replaced = service
        .open_preview(&first.handle)
        .expect("the first opens")
        .chromatogram_export_token
        .expect("a run the viewer draws has a chromatogram export");

    let opening = {
        let service = Arc::clone(&service);
        let handle = second.handle.clone();
        std::thread::spawn(move || service.open_preview(&handle))
    };
    observe_start
        .recv_timeout(Duration::from_secs(10))
        .expect("the second open reached the provider");

    service.clear_workspace().expect("the list clears");
    release.send(()).expect("the provider is still waiting");
    assert!(
        opening.join().expect("the second open finished").is_err(),
        "an open of a row the session no longer has records nothing",
    );

    assert_eq!(
        chromatogram_export_refusal(&service, &replaced),
        Some("chromatogram_export_stale".to_owned()),
        "and a completion from before the clear does not put one back",
    );
}

/// Focusing a vendor row is not a preview open.
///
/// Nothing is opened -- the frontend refuses the activation outright and Rust
/// refuses the call -- so the mzML preview stays on screen and its chromatogram
/// stays exportable. A ticket taken here would take an export away from a run
/// the user never navigated away from.
#[test]
fn refusing_a_vendor_row_leaves_the_visible_chromatogram_exportable() {
    let file = TestFile::new("chromatogram-vendor-focus");
    let acquisition = file.thermo_raw("acquisition.raw");
    let service = PreviewService::new(Box::new(FakeProvider::available(open_responses())));
    let selected = service.accept_file(&file.path).expect("accepted");
    let visible = service
        .open_preview(&selected.handle)
        .expect("the mzML row opens")
        .chromatogram_export_token
        .expect("a run the viewer draws has a chromatogram export");
    let vendor = add_one_acquisition(&service, &acquisition);

    assert_eq!(
        service
            .open_preview(&vendor)
            .expect_err("nothing in this product reads a vendor acquisition")
            .kind,
        "dataset_not_previewable",
    );

    assert_eq!(
        chromatogram_export_refusal(&service, &visible),
        None,
        "the preview on screen never went away",
    );
}

/// Two opens of one dataset are still ordered by the per-dataset request epoch.
///
/// The global preview-open ticket answers a different question and does not
/// replace this one: the epoch decides which read may commit facts for a
/// dataset, and the older of two reads of one file must still be refused there
/// rather than reconciled against by the spectrum that follows.
#[test]
fn two_opens_of_one_dataset_are_still_decided_by_the_request_epoch() {
    let file = TestFile::new("chromatogram-same-dataset-order");
    let mut responses = open_responses();
    responses.extend(open_responses());
    let (started, observe_start) = mpsc::channel();
    let (release, wait_for_release) = mpsc::channel();
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

    let older = open();
    observe_start
        .recv_timeout(Duration::from_secs(10))
        .expect("the first open reached the provider");
    let newer = open();
    wait_for_requests(&service, &selected.handle, 2);
    release.send(()).expect("the provider is still waiting");

    assert_eq!(
        older
            .join()
            .expect("the older open finished")
            .expect_err("its result is no longer the one the user wants")
            .kind,
        "selection_superseded",
    );
    let visible = newer
        .join()
        .expect("the newer open finished")
        .expect("the request the user is waiting for is the one that answers")
        .chromatogram_export_token
        .expect("and it names the run on screen");

    assert_eq!(chromatogram_export_refusal(&service, &visible), None);
}

// --------------------------------------- the linked two-panel figure boundary
//
// The typed answers the interface actually receives. The slot's own tests drive
// `ScientificExportSlots` directly; these go through the whole boundary, so what
// is asserted is the sentence a reader is shown and the file that reaches their
// folder.

/// The third scan of the canned table, as the backend would print it.
///
/// `selected_spectrum_output` always names the first row's measurements, so a
/// test that needs a *second* selection needs a second spectrum -- one that
/// agrees with the row it claims to be, or the loader refuses it as a
/// contradiction.
fn third_scan_output(points: &[(f64, f64)]) -> String {
    let mut text = String::from("# sample.mzML\n#\n");
    text.push_str("# index: 2\n");
    text.push_str("# id: scan=21\n");
    text.push_str("# scanNumber: 21\n");
    text.push_str("# massAnalyzerType: FTMS\n");
    text.push_str("# scanEvent: 1\n");
    text.push_str("# msLevel: 1\n");
    text.push_str("# retentionTime: 0.30\n");
    text.push_str("# filterString: synthetic\n");
    text.push_str("# mzLow: 100\n");
    text.push_str("# mzHigh: 1000\n");
    text.push_str("# basePeakMZ: 500.00000000\n");
    text.push_str("# basePeakIntensity: 7000.00000000\n");
    text.push_str("# totalIonCurrent: 80000.00000000\n");
    text.push_str("# precursorCount: 0\n");
    text.push_str(&format!("# binary ({}):\n", points.len()));
    for (mz, intensity) in points {
        text.push_str(&format!("{mz:.8} {intensity:.8}\n"));
    }
    text
}

/// One session showing a run and holding a spectrum of it.
///
/// The pair a linked figure is about, obtained the way the interface obtains it:
/// open a preview, then select a scan.
fn linked_ready(file: &TestFile, service: &PreviewService) -> LinkedSession {
    let selected = service.accept_file(&file.path).expect("accepted");
    let chromatogram = service
        .open_preview(&selected.handle)
        .expect("the run opens")
        .chromatogram_export_token
        .expect("a run the viewer draws has a chromatogram export");
    let spectrum = loaded_export_token(service, &selected.handle, 0);
    LinkedSession {
        handle: selected.handle,
        chromatogram,
        spectrum,
    }
}

/// What one session holds once a run is open and a scan is selected.
struct LinkedSession {
    /// The dataset row, for a test that selects a second scan of the same run.
    handle: String,
    chromatogram: String,
    spectrum: String,
}

/// The responses one open and one spectrum read consume.
fn linked_responses() -> Vec<Response> {
    let mut responses = open_responses();
    responses.push(Response::File(selected_spectrum_output(
        0,
        &[(445.12, 9000.0), (500.0, 1200.0)],
    )));
    responses
}

/// A current range, as the viewer would send one.
fn current_run_range(low: f64, high: f64) -> ChromatogramRangeDto {
    ChromatogramRangeDto {
        scope: "current".to_owned(),
        low: Some(low),
        high: Some(high),
    }
}

/// Begins one linked SVG export of the whole run, answering the refusal kind.
fn linked_refusal(
    service: &PreviewService,
    chromatogram: &str,
    spectrum: &str,
    range: &ChromatogramRangeDto,
    traces: ChromatogramTracesDto,
    settings: &FigureSettingsDto,
) -> Option<String> {
    match service.begin_linked_figure_export(chromatogram, spectrum, "svg", range, traces, settings)
    {
        Ok(reservation) => {
            // Returned to idle, so one probe does not decide the next one's
            // answer by leaving the lane reserved.
            service.cancel_linked_figure_export(&reservation);
            None
        }
        Err(error) => Some(error.kind),
    }
}

/// Every way a linked figure is refused reads as the thing the user can change.
///
/// One sentence each, and none of them says "the figure could not be drawn": a
/// reader sent to change a setting that was never the problem has been told
/// something worse than nothing.
#[test]
fn each_linked_refusal_names_what_the_reader_can_change() {
    let file = TestFile::new("linked-refusals");
    let service = PreviewService::new(Box::new(FakeProvider::available(linked_responses())));
    let LinkedSession {
        chromatogram,
        spectrum,
        ..
    } = linked_ready(&file, &service);

    // The run is 0.10, 0.20, 0.30 and the selected scan is the first of them.
    assert_eq!(
        linked_refusal(
            &service,
            &chromatogram,
            &spectrum,
            &full_run_range(),
            both_traces(),
            &default_figure_settings(),
        ),
        None,
        "the pair on screen is exportable",
    );

    for (range, traces, settings, expected, what) in [
        (
            current_run_range(0.20, 0.30),
            both_traces(),
            default_figure_settings(),
            "linked_selection_outside_range",
            "the selected scan is outside the current range",
        ),
        (
            current_run_range(0.0, 0.30),
            both_traces(),
            default_figure_settings(),
            "chromatogram_range_outside_source",
            "a range the run does not have",
        ),
        (
            full_run_range(),
            ChromatogramTracesDto {
                tic: false,
                bpc: false,
            },
            default_figure_settings(),
            "chromatogram_no_visible_trace",
            "nothing on screen to draw",
        ),
        (
            full_run_range(),
            both_traces(),
            figure_settings(1_200, 259, 300),
            "linked_figure_too_short",
            "one pixel short of two panels",
        ),
    ] {
        assert_eq!(
            linked_refusal(
                &service,
                &chromatogram,
                &spectrum,
                &range,
                traces,
                &settings,
            ),
            Some(expected.to_owned()),
            "{what}",
        );
    }

    // 260 is the height a two-panel figure is drawn at.
    assert_eq!(
        linked_refusal(
            &service,
            &chromatogram,
            &spectrum,
            &full_run_range(),
            both_traces(),
            &figure_settings(1_200, 260, 300),
        ),
        None,
        "the two-panel minimum height is accepted",
    );

    // A token this session no longer holds, either half.
    assert_eq!(
        linked_refusal(
            &service,
            "999999",
            &spectrum,
            &full_run_range(),
            both_traces(),
            &default_figure_settings(),
        ),
        Some("linked_figure_stale".to_owned()),
    );
    assert_eq!(
        linked_refusal(
            &service,
            &chromatogram,
            "999999",
            &full_run_range(),
            both_traces(),
            &default_figure_settings(),
        ),
        Some("linked_figure_stale".to_owned()),
    );

    // And every refusal above left the lane idle, so the next export begins.
    assert_eq!(
        linked_refusal(
            &service,
            &chromatogram,
            &spectrum,
            &full_run_range(),
            both_traces(),
            &default_figure_settings(),
        ),
        None,
    );
}

/// Two runs on screen at once do not make one linked figure.
///
/// Reachable without a race: open one run, open another, and select a scan of
/// the first -- the session still holds that spectrum, and both tokens are
/// current. Same session is not same scan, and this is the refusal that says so.
#[test]
fn a_spectrum_of_another_run_is_not_a_scan_of_this_chromatogram() {
    let file = TestFile::new("linked-owner");
    let other = file.sibling("other.mzML");
    let mut responses = open_responses();
    responses.push(Response::File(METADATA_OUTPUT.to_owned()));
    responses.push(Response::Stdout(run_summary_output()));
    responses.push(Response::File(OTHER_SPECTRUM_TABLE_OUTPUT.to_owned()));
    responses.push(Response::File(selected_spectrum_output(
        0,
        &[(445.12, 9000.0)],
    )));
    let service = PreviewService::new(Box::new(FakeProvider::available(responses)));
    let first = service.accept_file(&file.path).expect("accepted");
    let second = service.add_dataset(&other).expect("added");

    service
        .open_preview(&first.handle)
        .expect("the first opens");
    let visible = service
        .open_preview(&second.handle)
        .expect("the second opens")
        .chromatogram_export_token
        .expect("and it is the run on screen");
    // A scan of the *first* run, which this session still holds.
    let spectrum = loaded_export_token(&service, &first.handle, 0);

    assert_eq!(
        linked_refusal(
            &service,
            &visible,
            &spectrum,
            &full_run_range(),
            both_traces(),
            &default_figure_settings(),
        ),
        Some("linked_figure_source_mismatch".to_owned()),
    );
    // Neither half is stale, so this is a refusal about the pair rather than
    // about either token.
    assert_eq!(chromatogram_export_refusal(&service, &visible), None);
    let reservation = service
        .begin_spectrum_export(&spectrum, "svg", &default_figure_settings())
        .expect("the spectrum this session holds is still exportable");
    service.cancel_spectrum_export(&reservation);
}

/// A linked reservation opens the linked dialog and no other.
///
/// The three save commands share one reservation counter, so a linked
/// reservation is a perfectly well-formed identifier for the other two. Each
/// checks the kind before the lane is marked claimed, so a wrong-kind claim
/// refuses and leaves the reservation claimable by its own command.
#[test]
fn a_linked_reservation_is_claimable_only_by_the_linked_save() {
    let file = TestFile::new("linked-claim");
    let service = PreviewService::new(Box::new(FakeProvider::available(linked_responses())));
    let LinkedSession {
        chromatogram,
        spectrum,
        ..
    } = linked_ready(&file, &service);
    let reservation = service
        .begin_linked_figure_export(
            &chromatogram,
            &spectrum,
            "svg",
            &full_run_range(),
            both_traces(),
            &default_figure_settings(),
        )
        .expect("the export begins");

    assert_eq!(
        service
            .claim_spectrum_export(&reservation)
            .expect_err("a linked reservation is not a spectrum's")
            .kind,
        "spectrum_export_stale",
    );
    assert_eq!(
        service
            .claim_chromatogram_export(&reservation)
            .expect_err("nor a chromatogram's")
            .kind,
        "chromatogram_export_stale",
    );

    let claimed = service
        .claim_linked_figure_export(&reservation)
        .expect("its own dialog still opens");
    assert_eq!(
        claimed.suggested_file_name(),
        "mscanvas-linked-spectrum-0-full.svg",
    );
    assert_eq!(claimed.dialog().default_extension, "svg");
    assert_eq!(claimed.dialog().title, "Export linked figure");

    // One reservation opens one dialog.
    assert_eq!(
        service
            .claim_linked_figure_export(&reservation)
            .expect_err("and only one")
            .kind,
        "linked_figure_stale",
    );
    assert!(service.cancel_linked_figure_export(&reservation));
    // The lane is free again.
    assert_eq!(
        linked_refusal(
            &service,
            &chromatogram,
            &spectrum,
            &full_run_range(),
            both_traces(),
            &default_figure_settings(),
        ),
        None,
    );
}

/// The name a linked figure proposes says which scan and how much of the run.
///
/// The spectrum's index and the chromatogram's scope, and nothing else. No part
/// of a path, a workspace handle or a dataset's display name reaches a name this
/// boundary proposes -- ADR 0035's rule, asked of a surface that draws two
/// sources at once.
#[test]
fn a_linked_suggested_name_carries_the_scan_the_scope_and_nothing_else() {
    let file = TestFile::new("linked-name");
    let service = PreviewService::new(Box::new(FakeProvider::available(linked_responses())));
    let LinkedSession {
        chromatogram,
        spectrum,
        ..
    } = linked_ready(&file, &service);

    for (format, range, expected) in [
        (
            "svg",
            full_run_range(),
            "mscanvas-linked-spectrum-0-full.svg",
        ),
        (
            "png",
            full_run_range(),
            "mscanvas-linked-spectrum-0-full.png",
        ),
        (
            "svg",
            current_run_range(0.10, 0.30),
            "mscanvas-linked-spectrum-0-current.svg",
        ),
    ] {
        let reservation = service
            .begin_linked_figure_export(
                &chromatogram,
                &spectrum,
                format,
                &range,
                both_traces(),
                &default_figure_settings(),
            )
            .expect("the export begins");
        let claimed = service
            .claim_linked_figure_export(&reservation)
            .expect("its dialog");
        let suggested = claimed.suggested_file_name();

        assert_eq!(suggested, expected);
        assert!(
            !suggested.contains("sample"),
            "no dataset name: {suggested}"
        );
        assert!(!suggested.contains(MAIN_SEPARATOR), "no path: {suggested}");
        service.cancel_linked_figure_export(&reservation);
    }
}

/// Writes one linked figure to a chosen name, answering the refusal.
fn linked_saved_as(
    service: &PreviewService,
    chromatogram: &str,
    spectrum: &str,
    format: &str,
    destination: &Path,
) -> Result<LinkedFigureExportOutcomeDto, PreviewErrorDto> {
    let reservation = service
        .begin_linked_figure_export(
            chromatogram,
            spectrum,
            format,
            &full_run_range(),
            both_traces(),
            &default_figure_settings(),
        )
        .expect("the export begins");
    let claimed = service
        .claim_linked_figure_export(&reservation)
        .expect("its dialog");
    service.write_linked_figure_export(&claimed, destination)
}

/// A saved linked figure is a two-panel document named as what it holds.
///
/// The same publication rules every other export answers to: the extension has
/// to name the document, an existing file is never replaced, and what comes back
/// says which pair was drawn without saying where it went.
#[test]
fn a_saved_linked_figure_is_named_as_what_it_holds_and_replaces_nothing() {
    let file = TestFile::new("linked-write");
    let service = PreviewService::new(Box::new(FakeProvider::available(linked_responses())));
    let LinkedSession {
        chromatogram,
        spectrum,
        ..
    } = linked_ready(&file, &service);
    let folder = file.path.parent().expect("a folder");

    let written = linked_saved_as(
        &service,
        &chromatogram,
        &spectrum,
        "svg",
        &folder.join("linked.svg"),
    )
    .expect("a correctly named destination is written");
    let LinkedFigureExportOutcomeDto::Saved {
        format,
        file_name,
        figure,
        range_scope,
        source_scan_count,
        selected_index,
        selected_retention_time,
        ..
    } = written
    else {
        panic!("a written export is not the cancelled outcome");
    };
    assert_eq!(format, "svg");
    assert_eq!(file_name, "linked.svg");
    assert_eq!(figure.dpi, None, "a vector document has no resolution");
    assert_eq!(range_scope, "full");
    assert_eq!(source_scan_count, 3);
    assert_eq!(selected_index, 0);
    assert!(
        (selected_retention_time - 0.10).abs() < 1e-9,
        "the retained row's own time reaches the interface: {selected_retention_time}",
    );

    // A two-panel document, with both panels in it and no path anywhere.
    let document = fs::read_to_string(folder.join("linked.svg")).expect("the file is there");
    assert!(document.contains("Panel 1 of 2, counting from the top."));
    assert!(document.contains("Panel 2 of 2, counting from the top."));
    assert!(document.contains("Selected scan"));
    assert!(!document.contains("sample.mzML"), "no source name");

    // A name that does not describe the document is refused rather than
    // rewritten, and the file that was there is untouched.
    fs::write(folder.join("taken.png"), b"an earlier export").expect("seed");
    assert_eq!(
        linked_saved_as(
            &service,
            &chromatogram,
            &spectrum,
            "svg",
            &folder.join("linked.png"),
        )
        .expect_err("an SVG is not a PNG")
        .kind,
        "spectrum_destination_misnamed",
    );
    assert_eq!(
        linked_saved_as(
            &service,
            &chromatogram,
            &spectrum,
            "png",
            &folder.join("taken.png"),
        )
        .expect_err("a name already taken is a refusal")
        .kind,
        "spectrum_destination_exists",
    );
    assert_eq!(
        fs::read(folder.join("taken.png")).expect("still there"),
        b"an earlier export",
        "and the file that was there is untouched",
    );

    // A PNG is refused under a vector's name for the same reason, in the other
    // direction, and a name that differs only in case is the same name.
    assert_eq!(
        linked_saved_as(
            &service,
            &chromatogram,
            &spectrum,
            "png",
            &folder.join("raster.svg"),
        )
        .expect_err("a PNG is not an SVG")
        .kind,
        "spectrum_destination_misnamed",
    );
    linked_saved_as(
        &service,
        &chromatogram,
        &spectrum,
        "png",
        &folder.join("UPPER.PNG"),
    )
    .expect("Windows extensions do not distinguish case");

    // And every refusal above left the folder as it found it. The write is a
    // private sibling renamed by handle, so a refused one has nothing to clean
    // up -- and a residue would be a file the user never asked for, in a folder
    // this boundary is not allowed to name back to them.
    let residue: Vec<String> = fs::read_dir(folder)
        .expect("the folder is readable")
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.starts_with(".mscanvas-export"))
        .collect();
    assert!(
        residue.is_empty(),
        "no temporary file was left behind: {residue:?}"
    );

    // And the lane is free after every one of those, so the next export begins.
    linked_saved_as(
        &service,
        &chromatogram,
        &spectrum,
        "png",
        &folder.join("linked.png"),
    )
    .expect("a raster of the same pair");
}

/// A linked figure holds the one lane against both of the surfaces it draws.
#[test]
fn a_linked_export_in_progress_closes_every_other_scientific_export() {
    let file = TestFile::new("linked-lane");
    let service = PreviewService::new(Box::new(FakeProvider::available(linked_responses())));
    let LinkedSession {
        chromatogram,
        spectrum,
        ..
    } = linked_ready(&file, &service);
    let reservation = service
        .begin_linked_figure_export(
            &chromatogram,
            &spectrum,
            "svg",
            &full_run_range(),
            both_traces(),
            &default_figure_settings(),
        )
        .expect("the export begins");
    service
        .claim_linked_figure_export(&reservation)
        .expect("its dialog");

    assert_eq!(
        service
            .begin_spectrum_export(&spectrum, "csv", &default_figure_settings())
            .expect_err("one lane")
            .kind,
        "spectrum_export_in_progress",
    );
    assert_eq!(
        chromatogram_export_refusal(&service, &chromatogram),
        Some("scientific_export_in_progress".to_owned()),
    );
    assert_eq!(
        linked_refusal(
            &service,
            &chromatogram,
            &spectrum,
            &full_run_range(),
            both_traces(),
            &default_figure_settings(),
        ),
        Some("scientific_export_in_progress".to_owned()),
    );

    // And it is released when the dialog is dismissed.
    assert!(service.cancel_linked_figure_export(&reservation));
    assert_eq!(chromatogram_export_refusal(&service, &chromatogram), None);
}

/// The pair a claimed linked export holds is the pair it began on.
///
/// The user may select another scan while the save dialog is open. What is
/// written is the figure they asked for, and the reservation they left behind
/// still names it.
#[test]
fn a_claimed_linked_export_writes_the_pair_it_began_on() {
    let file = TestFile::new("linked-frozen");
    let mut responses = linked_responses();
    responses.push(Response::File(third_scan_output(&[(500.0, 7000.0)])));
    let service = PreviewService::new(Box::new(FakeProvider::available(responses)));
    let LinkedSession {
        handle,
        chromatogram,
        spectrum,
    } = linked_ready(&file, &service);

    let reservation = service
        .begin_linked_figure_export(
            &chromatogram,
            &spectrum,
            "svg",
            &full_run_range(),
            both_traces(),
            &default_figure_settings(),
        )
        .expect("the export begins");
    let claimed = service
        .claim_linked_figure_export(&reservation)
        .expect("its dialog");

    // The user selects another scan while the dialog is open.
    let newer = loaded_export_token(&service, &handle, 2);
    assert_ne!(newer, spectrum);

    let folder = file.path.parent().expect("a folder");
    let written = service
        .write_linked_figure_export(&claimed, &folder.join("frozen.svg"))
        .expect("the figure that was asked for");
    let LinkedFigureExportOutcomeDto::Saved { selected_index, .. } = written else {
        panic!("a written export is not the cancelled outcome");
    };
    assert_eq!(
        selected_index, 0,
        "the scan the export began on, not the one on screen now",
    );
}

/// A pair the contract refuses is refused as a *pair*.
///
/// Found in review. Both linked writers mapped every `SpecError` to the
/// chromatogram's refusal, which sends a reader to change a range or a trace
/// toggle that had nothing to do with it -- and in practice the reachable case
/// is the other panel's, because a chromatogram this session installed has
/// already been proved drawable.
///
/// Reachable without a race: mzML does not require an ordered m/z array and
/// nothing here sorts one, so a scan whose points descend is refused by the
/// contract when it is drawn. The same spectrum exported on its own still
/// answers with the spectrum's own refusal, which is the point -- each surface
/// names what it knows.
#[test]
fn a_linked_figure_the_contract_refuses_is_refused_as_a_pair() {
    let file = TestFile::new("linked-unspecifiable");
    let mut responses = open_responses();
    // Descending m/z, which the figure contract will not accept as a series.
    responses.push(Response::File(selected_spectrum_output(
        0,
        &[(500.0, 1_000.0), (100.0, 9_000.0)],
    )));
    let service = PreviewService::new(Box::new(FakeProvider::available(responses)));
    let LinkedSession {
        chromatogram,
        spectrum,
        ..
    } = linked_ready(&file, &service);
    let folder = file.path.parent().expect("a folder");

    // Nothing refuses it before a destination is chosen: the pair is sound, and
    // only drawing it is not.
    let reservation = service
        .begin_linked_figure_export(
            &chromatogram,
            &spectrum,
            "svg",
            &full_run_range(),
            both_traces(),
            &default_figure_settings(),
        )
        .expect("the pair is one scan of one run");
    let claimed = service
        .claim_linked_figure_export(&reservation)
        .expect("its dialog");

    assert_eq!(
        service
            .write_linked_figure_export(&claimed, &folder.join("linked.svg"))
            .expect_err("a spectrum the contract will not draw is not a figure")
            .kind,
        "linked_figure_not_drawable",
    );
    // Nothing was written under that name.
    assert!(!folder.join("linked.svg").exists());

    // The chromatogram on its own is still perfectly drawable, which is why
    // blaming it would have been wrong.
    assert_eq!(
        chromatogram_export_refusal(&service, &chromatogram),
        None,
        "the run this session holds is one it can draw",
    );
    // And the spectrum on its own names itself.
    assert_eq!(
        service
            .begin_spectrum_export(&spectrum, "svg", &default_figure_settings())
            .and_then(|reservation| service.claim_spectrum_export(&reservation))
            .and_then(|claimed| service.write_spectrum_export(&claimed, &folder.join("one.svg")))
            .expect_err("the same reading is refused the same way")
            .kind,
        "spectrum_export_refused",
    );
}
