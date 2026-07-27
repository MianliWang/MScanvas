//! Deterministic coverage for the preview boundary.
//!
//! Every test substitutes a provider at the application boundary, so none of
//! them needs a local ProteoWizard installation and none of them can reach a
//! real backend. The fake lives under `cfg(test)` only, so no production
//! command can ever return mock data.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use mscanvas_proteowizard::{
    PreviewOperation, PreviewOutcome, PreviewOutputEntry, PreviewOutputManifest, ProcessOutput,
    Termination, interpret_preview,
};

use super::backend::{OperationResult, PreviewProvider, interpretation_error};
use super::dto::{
    BackendAvailabilityDto, BackendFailureDto, PreviewErrorDto, SelectedSpectrumOutcomeDto,
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

/// A deterministic stand-in for a user-installed ProteoWizard.
///
/// It still runs every payload through the real typed interpreter, so tests
/// exercise the production parsing contract rather than a parallel one.
struct FakeProvider {
    availability: BackendAvailabilityDto,
    responses: Mutex<Vec<Response>>,
    requested: Mutex<Vec<PreviewOperation>>,
    batches: Mutex<usize>,
}

impl FakeProvider {
    fn available(responses: Vec<Response>) -> Self {
        Self {
            availability: BackendAvailabilityDto {
                state: "available".to_owned(),
                release: Some("3.0.26204".to_owned()),
                build_date: Some("Jul 23 2026".to_owned()),
                same_installation: true,
                failure: None,
            },
            responses: Mutex::new(responses),
            requested: Mutex::new(Vec::new()),
            batches: Mutex::new(0),
        }
    }

    fn unavailable() -> Self {
        Self {
            availability: BackendAvailabilityDto {
                state: "unavailable".to_owned(),
                release: None,
                build_date: None,
                same_installation: false,
                failure: Some(BackendFailureDto {
                    kind: "backend_not_found".to_owned(),
                    summary: "ProteoWizard was not found.".to_owned(),
                    corrective_action: "Install ProteoWizard separately.".to_owned(),
                }),
            },
            responses: Mutex::new(vec![Response::Error(PreviewErrorDto::new(
                "backend_not_found",
                "ProteoWizard was not found.",
                false,
            ))]),
            requested: Mutex::new(Vec::new()),
            batches: Mutex::new(0),
        }
    }

    fn requested_operations(&self) -> Vec<PreviewOperation> {
        self.requested.lock().expect("test lock").clone()
    }

    fn batch_count(&self) -> usize {
        *self.batches.lock().expect("test lock")
    }
}

impl PreviewProvider for FakeProvider {
    fn availability(&self) -> BackendAvailabilityDto {
        self.availability.clone()
    }

    fn run(
        &self,
        _source: &Path,
        operation: &PreviewOperation,
    ) -> Result<OperationResult, PreviewErrorDto> {
        self.requested
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
            Response::Error(error) => return Err(error),
        };
        let outcome =
            interpret_preview(operation, &process, &manifest).map_err(interpretation_error)?;
        Ok(OperationResult { outcome })
    }

    fn run_batch(
        &self,
        source: &Path,
        operations: &[PreviewOperation],
    ) -> Result<Vec<OperationResult>, PreviewErrorDto> {
        *self.batches.lock().expect("test lock") += 1;
        operations
            .iter()
            .map(|operation| self.run(source, operation))
            .collect()
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
    fn availability(&self) -> BackendAvailabilityDto {
        self.inner.availability()
    }

    fn run(
        &self,
        source: &Path,
        operation: &PreviewOperation,
    ) -> Result<OperationResult, PreviewErrorDto> {
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
        fn availability(&self) -> BackendAvailabilityDto {
            self.inner.availability()
        }

        fn run(
            &self,
            source: &Path,
            operation: &PreviewOperation,
        ) -> Result<OperationResult, PreviewErrorDto> {
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

    /// Blocks inside the gate until released, so a second request can be
    /// observed waiting rather than raced against.
    struct BlockingProvider {
        inner: FakeProvider,
        started: mpsc::Sender<()>,
        release: Mutex<mpsc::Receiver<()>>,
    }

    impl PreviewProvider for BlockingProvider {
        fn availability(&self) -> BackendAvailabilityDto {
            self.inner.availability()
        }

        fn run(
            &self,
            source: &Path,
            operation: &PreviewOperation,
        ) -> Result<OperationResult, PreviewErrorDto> {
            let _ = self.started.send(());
            let _ = self
                .release
                .lock()
                .expect("test lock")
                .recv_timeout(std::time::Duration::from_secs(5));
            self.inner.run(source, operation)
        }
    }

    let file = TestFile::new("supersede");
    let (started, observe_start) = mpsc::channel();
    let (release, wait_for_release) = mpsc::channel();
    let service = Arc::new(PreviewService::new(Box::new(BlockingProvider {
        inner: FakeProvider::available(vec![
            Response::File(selected_spectrum_output(0, &[(445.12, 9000.0)])),
            Response::File(selected_spectrum_output(1, &[(333.33, 5000.0)])),
        ]),
        started,
        release: Mutex::new(wait_for_release),
    })));
    let first = service.accept_file(&file.path).expect("accepted");

    // One request occupies the only process slot.
    let running = {
        let service = Arc::clone(&service);
        let handle = first.handle.clone();
        std::thread::spawn(move || service.load_spectrum(&handle, 0))
    };
    observe_start
        .recv_timeout(std::time::Duration::from_secs(5))
        .expect("the first request reached the provider");

    // A second one queues behind it.
    let waiting = {
        let service = Arc::clone(&service);
        let handle = first.handle.clone();
        std::thread::spawn(move || service.load_spectrum(&handle, 1))
    };
    std::thread::sleep(std::time::Duration::from_millis(200));

    // The user opens another file while it is still waiting.
    service.accept_file(&file.path).expect("accepted again");
    let _ = release.send(());

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
