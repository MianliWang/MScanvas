//! What copying a retained run summary into the project does, and what it
//! refuses to do.
//!
//! Every test here runs the real crossing: a real project store, a real
//! workspace service, a real reattachment of a file this test wrote, a real
//! layer, and a real preview open through a provider that answers the three
//! open operations with controlled formatter text and runs it through the
//! production interpreter. The provider counts every run and every look at the
//! backend, so "the capture starts no process and asks no backend" is proved
//! by the counters rather than by inspection.
//!
//! No VM, no installer and no ProteoWizard: the formatter text is a fixture,
//! and the build identities are ones this file names.

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use mscanvas_proteowizard::{
    PreviewOperation, PreviewOutputManifest, ProcessOutput, Sha256Digest, Termination,
    TreeOwnership, interpret_preview,
};

use crate::preview::backend::{OperationAttempt, PreviewProvider, interpretation_error};
use crate::preview::dto::{BackendAvailabilityDto, PreviewDto, PreviewErrorDto};
use crate::preview::{InstallationIdentity, PreviewAvailability, PreviewService};
use crate::project::record::{
    ArtifactPayload, InputId, LayerId, MsLevelCountRecord, ProducerTool, RecordedUnit,
    ReportedCount, RetentionTimeSummary, RunInput,
};
use crate::project::tests::Scratch;
use crate::project::{ProjectError, ProjectStore};
use crate::reattachment::{add_project_input_to_workspace, admitted_handle};

use super::capture_qc_summary;

/// Metadata carrying values that must never reach a project document.
const METADATA: &str = concat!(
    "sourceFile: D:\\MSData\\private\\before-any-section.mzML\n",
    "fileDescription:\n",
    "  sourceFile: D:\\MSData\\private\\metadata-secret-path.mzML\n",
    "sampleList:\n",
    "  sample: metadata-secret-sample-name\n",
    "instrumentConfigurationList:\n",
    "  analyzer: FTMS\n",
    "softwareList:\n",
    "  software: ProteoWizard\n",
    "dataProcessingList\n",
    "  processing: conversion\n",
);

/// A spectrum table whose native identifiers are distinctive, so a test can
/// say they did not travel.
const SPECTRUM_TABLE: &str = concat!(
    "# sample.mzML\n",
    "index\tid\tevent\tanalyzer\tmsLevel\trt\tmzLow\tmzHigh\tbasePeakMZ\tbasePeakInt\tTIC\t",
    "charge\tprecursorMZ\tthermo_monoMZ\tfilterStringMZ\tionInjectionTime\n",
    "0\tnative-secret-scan-19\t1\tFTMS\tms1\t0.10\t100\t1000\t445.12\t9000\t120000\t\t\t\t\t\n",
    "1\tnative-secret-scan-20\t2\tFTMS\tms2\t0.20\t100\t1000\t333.33\t5000\t60000\t2\t445.12\t\t\t\n",
);

/// The retention-time text the fixture summary reports, in its columns.
///
/// Not monotonic, and with more digits than a short float prints, so that a
/// value that moved by one unit in the last place, or a column that moved,
/// would show.
const RETENTION: [&str; 5] = [
    "0.1",
    "12.345678901234567",
    "0.30000000000000004",
    "7.7",
    "123.456",
];

/// A run summary whose buckets are deliberately out of numeric order, with
/// `MS(others)` between them, and whose leading columns carry values that must
/// never reach a project document.
fn run_summary() -> String {
    let mut headers: Vec<String> = ["Filename", "Timestamp", "Vendor", "Model", "Serial#"]
        .map(str::to_owned)
        .to_vec();
    let mut values: Vec<String> = [
        "summary-secret-filename.mzML",
        "2026-07-27",
        "summary-secret-vendor",
        "model",
        "serial-secret-0042",
    ]
    .map(str::to_owned)
    .to_vec();
    headers.extend(["MS2s", "MS(others)", "MS1s", "Zooms", "Charges"].map(str::to_owned));
    values.extend(["4", "1", "7", "0", "0"].map(str::to_owned));
    for level in ["MS1", "MS2"] {
        for statistic in ["Mean", "Min", "Q1", "Q2", "Q3", "Max"] {
            headers.push(format!("{level} Pts{statistic}"));
            values.push("15".to_owned());
        }
    }
    headers.extend(["MinRT", "RT@25%BPI", "RT@50%BPI", "RT@75%BPI", "MaxRT"].map(str::to_owned));
    values.extend(RETENTION.map(str::to_owned));
    format!("{}\n{}\n", headers.join("\t"), values.join("\t"))
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
        total_owned_processes: Some(1),
        tree_ownership: TreeOwnership::EstablishedBeforeExecution,
    }
}

/// One build, told apart from any other by its label and its digest.
fn build(label: &str, digest: u8) -> InstallationIdentity {
    InstallationIdentity::for_test_probed(
        &PathBuf::from(format!(r"C:\fake\{label}")),
        label,
        Some("Jul 23 2026"),
        Some("a09eea9"),
        Sha256Digest::from_bytes([digest; 32]),
    )
}

/// The part of the provider a test can still reach once the service owns it:
/// which build the machine resolves to, and how often anything asked.
#[derive(Clone)]
struct Machine {
    installed: Arc<Mutex<Option<InstallationIdentity>>>,
    runs: Arc<AtomicUsize>,
    looks: Arc<AtomicUsize>,
}

impl Machine {
    fn new(installed: Option<InstallationIdentity>) -> Self {
        Self {
            installed: Arc::new(Mutex::new(installed)),
            runs: Arc::new(AtomicUsize::new(0)),
            looks: Arc::new(AtomicUsize::new(0)),
        }
    }

    fn resolves_to(&self, installed: Option<InstallationIdentity>) {
        *self.installed.lock().expect("test lock") = installed;
    }

    fn installed(&self) -> Option<InstallationIdentity> {
        self.installed.lock().expect("test lock").clone()
    }

    fn runs(&self) -> usize {
        self.runs.load(Ordering::SeqCst)
    }

    fn looks(&self) -> usize {
        self.looks.load(Ordering::SeqCst)
    }
}

/// Answers the three open operations with controlled formatter text, through
/// the production interpreter, as whichever build the machine resolves to.
struct SummaryProvider {
    machine: Machine,
}

impl PreviewProvider for SummaryProvider {
    fn availability(&self) -> (BackendAvailabilityDto, Option<InstallationIdentity>) {
        self.machine.looks.fetch_add(1, Ordering::SeqCst);
        let installed = self.machine.installed();
        (
            BackendAvailabilityDto {
                state: if installed.is_some() {
                    "available"
                } else {
                    "unavailable"
                }
                .to_owned(),
                origin: "automatic".to_owned(),
                release: installed.as_ref().map(|_| "reported".to_owned()),
                build_date: None,
                same_installation: true,
                failure: None,
            },
            installed,
        )
    }

    fn run(
        &self,
        _source: &std::path::Path,
        operation: &PreviewOperation,
    ) -> Result<OperationAttempt, PreviewErrorDto> {
        self.machine.runs.fetch_add(1, Ordering::SeqCst);
        let (process, manifest) = match operation {
            PreviewOperation::Metadata => (
                completed_process(""),
                PreviewOutputManifest::single_complete_file(METADATA.as_bytes().to_vec()),
            ),
            PreviewOperation::RunSummary => (
                completed_process(&run_summary()),
                PreviewOutputManifest::empty(),
            ),
            PreviewOperation::SpectrumTable => (
                completed_process(""),
                PreviewOutputManifest::single_complete_file(SPECTRUM_TABLE.as_bytes().to_vec()),
            ),
            _ => {
                return Err(PreviewErrorDto::new(
                    "unexpected_preview_result",
                    "The preview returned a result MSCanvas did not request.",
                    false,
                ));
            }
        };
        let outcome =
            interpret_preview(operation, &process, &manifest).map_err(interpretation_error)?;
        let installation = self.machine.installed();
        Ok(OperationAttempt {
            preview_availability: if installation.is_some() {
                PreviewAvailability::Usable
            } else {
                PreviewAvailability::Unusable
            },
            installation,
            outcome: Ok(outcome),
            owned_process_unaccounted: false,
        })
    }

    fn use_installation(&self, _home: Option<PathBuf>) {}
}

/// Everything one test needs: a project with an attached layer, the workspace
/// its row is in, and the machine behind the provider.
struct World {
    scratch: Scratch,
    projects: ProjectStore,
    service: PreviewService,
    machine: Machine,
}

impl World {
    fn new(label: &str, installed: Option<InstallationIdentity>) -> Self {
        let machine = Machine::new(installed);
        let service = PreviewService::new(Box::new(SummaryProvider {
            machine: machine.clone(),
        }));
        let projects = ProjectStore::new();
        projects
            .create("QC".to_owned(), false)
            .expect("a new project");
        Self {
            scratch: Scratch::new(label),
            projects,
            service,
            machine,
        }
    }

    /// A reference to a file this test wrote, admitted to the Workbench
    /// through the real bridge, and a layer made from it.
    fn attached(&self, name: &str) -> (InputId, LayerId, String) {
        let path = self
            .scratch
            .write(name, format!("<mzML>{name}</mzML>").as_bytes());
        let input = self.projects.register_input(&path).expect("registered");
        let job = self.projects.accept_job().expect("accepted");
        let result = add_project_input_to_workspace(&self.projects, &self.service, job, input)
            .unwrap_or_else(|_| panic!("admitted"));
        let handle = admitted_handle(&result).expect("a row").to_owned();
        let layer = self
            .projects
            .create_layer(input, |row| {
                self.service.dataset_object_identities(row).is_some()
            })
            .expect("a layer");
        (input, layer, handle)
    }

    fn open(&self, handle: &str) -> PreviewDto {
        self.service
            .open_preview(handle)
            .expect("the preview opens")
    }

    fn capture(
        &self,
        layer: LayerId,
        token: &str,
    ) -> Result<mscanvas_core::ArtifactId, ProjectError> {
        capture_qc_summary(&self.projects, &self.service, layer, token)
    }

    /// The one snapshot in the open project, as the document holds it.
    fn snapshots(&self) -> Vec<crate::project::record::AcquisitionQcSnapshotV1> {
        self.projects
            .describe()
            .artifacts
            .into_iter()
            .filter_map(|artifact| artifact.qc_snapshot)
            .collect()
    }
}

fn token(preview: &PreviewDto) -> String {
    preview
        .qc_snapshot_token
        .clone()
        .expect("the latest open retains its summary")
}

// ---------------------------------------------------------------------------
// What is recorded
// ---------------------------------------------------------------------------

#[test]
fn the_retained_summary_becomes_one_run_and_one_snapshot_exactly_as_reported() {
    let world = World::new("qc-exact", Some(build("3.0.26204", 0xA1)));
    let (input, layer, handle) = world.attached("sample.mzML");
    let preview = world.open(&handle);
    assert!(preview.qc_producer_identified);

    let artifact = world.capture(layer, &token(&preview)).expect("captured");

    let described = world.projects.describe();
    assert_eq!(described.runs.len(), 1);
    let run = &described.runs[0];
    assert_eq!(run.operation, "captureAcquisitionQcSnapshotV1");
    assert_eq!(run.outcome, "completed");
    // The run consumed the layer, and only the layer.
    assert_eq!(run.layer_ids, vec![layer.to_string()]);
    assert!(run.input_ids.is_empty());
    assert_eq!(run.output_artifact_ids, vec![artifact.to_string()]);
    let recorded = described
        .artifacts
        .iter()
        .find(|candidate| candidate.id == artifact.to_string())
        .expect("the snapshot");
    assert_eq!(recorded.kind, "acquisitionQcSnapshotV1");
    assert_eq!(
        recorded.produced_by_run_id.as_deref(),
        Some(run.id.as_str())
    );
    // Its lineage back to the reference is through the layer.
    let layer_row = &described.layers[0];
    assert_eq!(layer_row.source_input_id, input.to_string());
    assert_eq!(layer_row.consumed_by_run_ids, vec![run.id.clone()]);

    let snapshot = recorded.qc_snapshot.clone().expect("the payload");
    assert_eq!(snapshot.total_spectrum_count, 12);
    // In the reported order, with `Other` where it was: not sorted, not merged.
    assert_eq!(
        snapshot.ms_level_counts,
        vec![
            MsLevelCountRecord::Level {
                ms_level: 2,
                spectrum_count: 4
            },
            MsLevelCountRecord::Other { spectrum_count: 1 },
            MsLevelCountRecord::Level {
                ms_level: 1,
                spectrum_count: 7
            },
        ]
    );
    // The formatter reports no chromatogram count: absent, not zero.
    assert_eq!(snapshot.chromatogram_count, ReportedCount::NotReported {});
    let RetentionTimeSummary::Reported {
        minimum,
        at_25_percent_base_peak_intensity,
        at_50_percent_base_peak_intensity,
        at_75_percent_base_peak_intensity,
        maximum,
    } = &snapshot.retention_time
    else {
        panic!("the summary reported its retention times");
    };
    let recorded_values = [
        minimum,
        at_25_percent_base_peak_intensity,
        at_50_percent_base_peak_intensity,
        at_75_percent_base_peak_intensity,
        maximum,
    ];
    for (value, reported) in recorded_values.into_iter().zip(RETENTION) {
        let parsed: f64 = reported.parse().expect("fixture");
        assert_eq!(
            value.number().map(f64::to_bits),
            Some(parsed.to_bits()),
            "{reported}"
        );
        // No unit was emitted, and none is inferred from the magnitude.
        assert_eq!(value.unit, RecordedUnit::NotEmitted);
    }
    assert_eq!(snapshot.producer.tool, ProducerTool::Msaccess);
    assert_eq!(snapshot.producer.executable_sha256, "A1".repeat(32));
    assert_eq!(snapshot.producer.release.as_deref(), Some("3.0.26204"));
    assert_eq!(snapshot.producer.build_date.as_deref(), Some("Jul 23 2026"));
    assert_eq!(
        snapshot.producer.source_revision.as_deref(),
        Some("a09eea9")
    );
}

#[test]
fn a_saved_snapshot_reopens_with_every_value_and_no_session_or_raw_fact() {
    let world = World::new("qc-roundtrip", Some(build("3.0.26204", 0xA1)));
    let (_, layer, handle) = world.attached("sample.mzML");
    let preview = world.open(&handle);
    world.capture(layer, &token(&preview)).expect("captured");
    let before = world.projects.describe();

    let document = world.scratch.join("project.mscanvas");
    world.projects.save_as(&document).expect("saved");
    world.projects.close(false).expect("closed");
    world
        .projects
        .open_document(&document, false)
        .expect("reopened");
    let after = world.projects.describe();

    assert_eq!(
        serde_json::to_value(&after.artifacts).expect("json"),
        serde_json::to_value(&before.artifacts).expect("json"),
        "the snapshot and its values come back exactly"
    );
    assert_eq!(after.runs[0].id, before.runs[0].id);
    assert_eq!(after.runs[0].layer_ids, before.runs[0].layer_ids);
    // Opening restores no row: the reference is unchecked and remembers none.
    assert_eq!(after.inputs[0].verification, "notChecked");
    assert!(after.inputs[0].workbench_dataset_handle.is_none());

    let text = fs::read_to_string(&document).expect("the document");
    for absent in [
        // Raw metadata, and a path it carried.
        "metadata-secret-path",
        "metadata-secret-sample-name",
        "MSData",
        // Run-summary columns the snapshot does not admit.
        "summary-secret-filename",
        "summary-secret-vendor",
        "serial-secret-0042",
        // Native spectrum identifiers.
        "native-secret-scan",
        // Session and filesystem facts.
        handle.as_str(),
        "dataset",
        "volume",
        "fileId",
        "identity",
        // The provider's installation folder.
        "fake",
        r"C:\\",
    ] {
        assert!(!text.contains(absent), "the document holds {absent:?}");
    }
    // Saved beside its data, so its one locator is relative: no absolute path
    // of this machine appears anywhere in it.
    let root = world
        .scratch
        .directory()
        .to_string_lossy()
        .replace('\\', "\\\\");
    assert!(!text.contains(&root));

    // And the payload is exactly the closed shape, compared as a value.
    let value: serde_json::Value = serde_json::from_str(&text).expect("json");
    let payload = &value["artifacts"][0]["payload"];
    let expected = serde_json::json!({
        "kind": "acquisitionQcSnapshotV1",
        "totalSpectrumCount": 12,
        "msLevelCounts": [
            { "kind": "level", "msLevel": 2, "spectrumCount": 4 },
            { "kind": "other", "spectrumCount": 1 },
            { "kind": "level", "msLevel": 1, "spectrumCount": 7 },
        ],
        "chromatogramCount": { "kind": "notReported" },
        "retentionTime": {
            "kind": "reported",
            "minimum": { "value": "0.1", "unit": "notEmitted" },
            "at25PercentBasePeakIntensity": { "value": "12.345678901234567", "unit": "notEmitted" },
            "at50PercentBasePeakIntensity": { "value": "0.30000000000000004", "unit": "notEmitted" },
            "at75PercentBasePeakIntensity": { "value": "7.7", "unit": "notEmitted" },
            "maximum": { "value": "123.456", "unit": "notEmitted" },
        },
        "producer": {
            "tool": "msaccess",
            "executableSha256": "A1".repeat(32),
            "release": "3.0.26204",
            "buildDate": "Jul 23 2026",
            "sourceRevision": "a09eea9",
        },
    });
    assert_eq!(payload, &expected);
    assert_eq!(
        value["runs"][0]["inputs"],
        serde_json::json!([{ "kind": "layer", "layerId": layer.to_string() }])
    );
    assert_eq!(
        value["runs"][0]["operation"],
        "captureAcquisitionQcSnapshotV1"
    );
}

// ---------------------------------------------------------------------------
// What the capture does not do
// ---------------------------------------------------------------------------

#[test]
fn a_capture_starts_no_process_asks_no_backend_and_reads_no_file() {
    let world = World::new("qc-no-io", Some(build("3.0.26204", 0xA1)));
    let (input, layer, handle) = world.attached("sample.mzML");
    let preview = world.open(&handle);
    let verification = world.projects.describe().inputs[0].verification;
    let runs = world.machine.runs();
    let looks = world.machine.looks();
    // The source is gone. A capture that opened, checked or hashed it would
    // fail here; one that copies what is retained does not notice.
    fs::remove_file(world.scratch.join("sample.mzML")).expect("the source is deleted");

    world
        .capture(layer, &token(&preview))
        .expect("captured from memory");

    assert_eq!(world.machine.runs(), runs, "no preview operation was run");
    assert_eq!(world.machine.looks(), looks, "the backend was not asked");
    let described = world.projects.describe();
    assert_eq!(
        described.inputs[0].verification, verification,
        "the reference's current state is exactly what it was"
    );
    assert_eq!(described.inputs[0].id, input.to_string());
    assert_eq!(world.snapshots().len(), 1);
}

#[test]
fn a_backend_changed_after_the_preview_does_not_become_its_producer() {
    let world = World::new("qc-backend-moved", Some(build("3.0.26204", 0xA1)));
    let (_, layer, handle) = world.attached("sample.mzML");
    let preview = world.open(&handle);

    // The machine now resolves to another build, and the session has looked
    // and moved its binding to it.
    world.machine.resolves_to(Some(build("3.0.26300", 0xB2)));
    let reading = world.service.inspect_backend();
    assert_eq!(reading.availability.state, "available");
    assert!(reading.authority.revision > preview.authority.revision);
    assert_ne!(
        reading.authority.receipt(),
        preview.authority.receipt(),
        "the session is bound to the second build now"
    );

    world.capture(layer, &token(&preview)).expect("captured");

    let producer = world.snapshots()[0].producer.clone();
    assert_eq!(producer.executable_sha256, "A1".repeat(32));
    assert_eq!(producer.release.as_deref(), Some("3.0.26204"));

    // Control: a preview the second build produces is attributed to it.
    let second = world.open(&handle);
    world
        .capture(layer, &token(&second))
        .expect("captured again");
    assert_eq!(
        world.snapshots()[1].producer.executable_sha256,
        "B2".repeat(32)
    );
}

#[test]
fn a_preview_whose_producer_cannot_be_identified_is_refused_not_guessed() {
    // A build whose `msaccess` help never probed: there is an installation,
    // and no digest of the executable that ran.
    let unprobed = InstallationIdentity::for_test(
        &PathBuf::from(r"C:\fake\unprobed\msconvert.exe"),
        &PathBuf::from(r"C:\fake\unprobed\msaccess.exe"),
        "3.0.26204",
    );
    let world = World::new("qc-unidentified", Some(unprobed));
    let (_, layer, handle) = world.attached("sample.mzML");
    let preview = world.open(&handle);
    assert!(
        !preview.qc_producer_identified,
        "the page is told before anyone presses"
    );
    let before = serde_json::to_value(world.projects.describe()).expect("json");

    assert_eq!(
        world.capture(layer, &token(&preview)),
        Err(ProjectError::ProducerUnidentified)
    );
    let described = world.projects.describe();
    assert!(described.runs.is_empty());
    assert!(described.artifacts.is_empty());
    assert_eq!(
        serde_json::to_value(described).expect("json"),
        before,
        "nothing was recorded"
    );

    // Control: the same row, once an identified build produced its preview.
    world.machine.resolves_to(Some(build("3.0.26204", 0xA1)));
    let identified = world.open(&handle);
    assert!(identified.qc_producer_identified);
    world.capture(layer, &token(&identified)).expect("captured");
}

// ---------------------------------------------------------------------------
// Which preview may be captured, under which layer
// ---------------------------------------------------------------------------

#[test]
fn a_superseded_preview_of_the_same_source_is_refused() {
    let world = World::new("qc-superseded", Some(build("3.0.26204", 0xA1)));
    let (_, layer, handle) = world.attached("sample.mzML");
    let first = world.open(&handle);
    let second = world.open(&handle);
    assert_ne!(token(&first), token(&second));

    assert_eq!(
        world.capture(layer, &token(&first)),
        Err(ProjectError::PreviewNotCurrent)
    );
    assert!(world.snapshots().is_empty());
    world
        .capture(layer, &token(&second))
        .expect("the current one is captured");
    // A token that was never issued names nothing either.
    assert_eq!(
        world.capture(layer, "not-a-token"),
        Err(ProjectError::PreviewNotCurrent)
    );
}

#[test]
fn a_preview_left_for_another_source_is_refused_and_a_foreign_one_is_never_relabelled() {
    let world = World::new("qc-navigation", Some(build("3.0.26204", 0xA1)));
    let (_, first_layer, first_handle) = world.attached("first.mzML");
    let (_, second_layer, second_handle) = world.attached("second.mzML");
    let first = world.open(&first_handle);
    // The reader moves on to the other source.
    let second = world.open(&second_handle);

    // The first preview is no longer the one on screen.
    assert_eq!(
        world.capture(first_layer, &token(&first)),
        Err(ProjectError::PreviewNotCurrent)
    );
    // The preview on screen is the second source's, so it cannot be recorded
    // under the first layer whatever the page sends.
    assert_eq!(
        world.capture(first_layer, &token(&second)),
        Err(ProjectError::PreviewNotCurrent)
    );
    assert!(world.snapshots().is_empty());

    // Control: under its own layer it is recorded.
    world
        .capture(second_layer, &token(&second))
        .expect("captured under its own layer");
    let described = world.projects.describe();
    assert_eq!(described.runs[0].layer_ids, vec![second_layer.to_string()]);
}

#[test]
fn a_source_no_longer_in_the_workbench_is_refused() {
    let world = World::new("qc-row-gone", Some(build("3.0.26204", 0xA1)));
    let (_, layer, handle) = world.attached("sample.mzML");
    let preview = world.open(&handle);

    world
        .service
        .remove_datasets(std::slice::from_ref(&handle))
        .expect("the row is removed");

    assert_eq!(
        world.capture(layer, &token(&preview)),
        Err(ProjectError::NotInWorkbench)
    );
    assert!(world.snapshots().is_empty());
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

#[test]
fn two_presses_are_two_observations_even_with_identical_values() {
    let world = World::new("qc-twice", Some(build("3.0.26204", 0xA1)));
    let (_, layer, handle) = world.attached("sample.mzML");
    let preview = world.open(&handle);

    let first = world.capture(layer, &token(&preview)).expect("first");
    let second = world.capture(layer, &token(&preview)).expect("second");

    assert_ne!(first, second);
    let described = world.projects.describe();
    assert_eq!(described.runs.len(), 2);
    assert_ne!(described.runs[0].id, described.runs[1].id);
    let snapshots = world.snapshots();
    assert_eq!(snapshots.len(), 2);
    assert_eq!(snapshots[0], snapshots[1], "the same facts, recorded twice");
    assert_eq!(described.layers[0].consumed_by_run_ids.len(), 2);
}

#[test]
fn a_snapshot_is_unchanged_by_the_row_the_source_and_the_workspace_going() {
    let world = World::new("qc-history", Some(build("3.0.26204", 0xA1)));
    let (input, layer, handle) = world.attached("sample.mzML");
    let preview = world.open(&handle);
    world.capture(layer, &token(&preview)).expect("captured");
    let before = serde_json::to_value(world.projects.describe().artifacts).expect("json");

    world
        .service
        .remove_datasets(std::slice::from_ref(&handle))
        .expect("the row is removed");
    world
        .service
        .clear_workspace()
        .expect("the workspace is cleared");
    fs::remove_file(world.scratch.join("sample.mzML")).expect("the source is deleted");
    let job = world.projects.accept_job().expect("accepted");
    world.projects.check_linked_files(job).expect("checked");
    assert_eq!(
        world.projects.describe().inputs[0].verification,
        "unavailable",
        "the source is now missing"
    );

    assert_eq!(
        serde_json::to_value(world.projects.describe().artifacts).expect("json"),
        before,
        "the historical snapshot is untouched"
    );
    // And the layer it consumed cannot be removed out from under it.
    assert_eq!(
        world.projects.remove_layer(layer),
        Err(ProjectError::LayerUsedByRun)
    );
    assert_eq!(
        world.projects.remove_input(input),
        Err(ProjectError::LayerDependsOnInput)
    );
    assert!(world.projects.describe().artifacts[0].qc_snapshot.is_some());
}

#[test]
fn a_snapshot_run_consumes_exactly_its_layer_in_the_document() {
    // The run-input vocabulary as the document states it, read back from the
    // store's own document rather than the projection.
    let world = World::new("qc-run-input", Some(build("3.0.26204", 0xA1)));
    let (_, layer, handle) = world.attached("sample.mzML");
    let preview = world.open(&handle);
    let artifact = world.capture(layer, &token(&preview)).expect("captured");
    let document = world.scratch.join("run-input.mscanvas");
    world.projects.save_as(&document).expect("saved");
    let parsed = crate::project::record::parse(&fs::read(&document).expect("bytes"))
        .expect("the saved document parses");

    assert_eq!(
        parsed.runs[0].inputs,
        vec![RunInput::Layer { layer_id: layer }]
    );
    assert_eq!(parsed.runs[0].output_artifact_ids, vec![artifact]);
    assert!(matches!(
        parsed.artifacts[0].payload,
        ArtifactPayload::AcquisitionQcSnapshotV1(_)
    ));
}

#[test]
fn a_summary_with_more_buckets_than_a_snapshot_holds_is_refused_in_its_own_words() {
    // Well-formed by the formatter's rules -- each level with its six point
    // statistics -- and more levels than a snapshot records. Refused whole,
    // with a reason that is about the summary, not about the project's size.
    let summary_with = |levels: u32| {
        let mut headers: Vec<String> = ["Filename", "Timestamp", "Vendor", "Model", "Serial#"]
            .map(str::to_owned)
            .to_vec();
        let mut values: Vec<String> = ["x", "t", "v", "m", "s"].map(str::to_owned).to_vec();
        for level in 1..=levels {
            headers.push(format!("MS{level}s"));
            values.push("1".to_owned());
        }
        headers.extend(["Zooms", "Charges"].map(str::to_owned));
        values.extend(["0", "0"].map(str::to_owned));
        for level in 1..=levels {
            for statistic in ["Mean", "Min", "Q1", "Q2", "Q3", "Max"] {
                headers.push(format!("MS{level} Pts{statistic}"));
                values.push("1".to_owned());
            }
        }
        headers
            .extend(["MinRT", "RT@25%BPI", "RT@50%BPI", "RT@75%BPI", "MaxRT"].map(str::to_owned));
        values.extend(["0.1", "0.2", "0.3", "0.4", "0.5"].map(str::to_owned));
        let text = format!("{}\n{}\n", headers.join("\t"), values.join("\t"));
        match interpret_preview(
            &PreviewOperation::RunSummary,
            &completed_process(&text),
            &PreviewOutputManifest::empty(),
        ) {
            Ok(mscanvas_proteowizard::PreviewOutcome::Value(value)) => match *value {
                mscanvas_proteowizard::PreviewValue::RunSummary(summary) => summary,
                _ => panic!("not a run summary"),
            },
            _ => panic!("the fixture interprets"),
        }
    };
    let producer = || {
        build("3.0.26204", 0xA1)
            .producer_facts()
            .expect("an identified build")
    };

    assert_eq!(
        super::snapshot_of(&summary_with(65), producer()),
        Err(ProjectError::SummaryTooLarge)
    );
    // Control: exactly as many as a snapshot holds is recorded, every bucket.
    let recorded = super::snapshot_of(&summary_with(64), producer()).expect("recorded");
    assert_eq!(recorded.ms_level_counts.len(), 64);
    assert_eq!(recorded.total_spectrum_count, 64);
}
