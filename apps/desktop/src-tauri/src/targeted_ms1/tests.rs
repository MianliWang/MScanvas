//! Tests for the targeted MS1 recipe: the plan, the schema-4 records, the
//! result store, the supervisor, and the whole path through all of them.
//!
//! Two kinds, kept apart because they prove different things.
//!
//! The store's rules run against a fake executor that stages a real payload
//! the way the supervisor does, in a task-owned temporary directory. They need
//! no runtime and always run.
//!
//! The supervisor and the vertical path run the real pinned runtime and the
//! real adapter over mzML fixtures written here. They are `#[ignore]`d because
//! they need `.tmp/m91-runtime`, which `scripts/provision_targeted_ms1_runtime.py`
//! builds from M9.0's verified material; run them with
//! `cargo test -p mscanvas-desktop --lib targeted_ms1 -- --ignored`. Their
//! projects and fixtures live under `.tmp/m91-jobs/tests/`, on the work area's
//! own volume, except where a test is about another volume.

use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use mscanvas_core::ArtifactId;

use super::{Supervisor, Unavailable, validate_payload, verify_runtime};
use crate::project::observe::Cancellation;
use crate::project::payload::{self, Availability, RowOutcome};
use crate::project::recipe::{
    self, AttemptEnd, AttemptOrder, PlanDraft, RecipeExecutor, RunPhase, TargetDraft,
};
use crate::project::record::{
    self, AttemptFacts, FailureCode, FailureStage, InputId, LayerId, MemberRole, OutcomeSummary,
    RunFailure, SourceView, StopFacts, StopReason, TargetedMs1Plan, TargetedMs1ResultV1,
    TerminalOutcome,
};
use crate::project::tests::Scratch;
use crate::project::{ProjectError, ProjectStore, SaveAsSeams};

// ---------------------------------------------------------------------------
// mzML fixtures
// ---------------------------------------------------------------------------

/// One MS1 spectrum: its retention time in seconds and its centroided peaks.
#[derive(Debug, Clone)]
pub(crate) struct Scan {
    pub(crate) rt: f64,
    pub(crate) points: Vec<(f64, f64)>,
}

const PROTON_MASS_U: f64 = 1.007_276_466_771;
const C13C12_MASSDIFF_U: f64 = 1.003_354_837_8;

/// The [M+H]+ m/z of a C, H, N, O formula, in the engine's own operation order.
pub(crate) fn ion_mz(formula: &str) -> f64 {
    let mut mass = 0.0;
    let bytes = formula.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        let element = match bytes[index] {
            b'C' => 12.0,
            b'H' => 1.007_825_032_23,
            b'N' => 14.003_074_004_43,
            b'O' => 15.994_914_619_57,
            other => panic!("fixture formulas use C, H, N and O, not {}", other as char),
        };
        index += 1;
        let start = index;
        while index < bytes.len() && bytes[index].is_ascii_digit() {
            index += 1;
        }
        let count: f64 = if start == index {
            1.0
        } else {
            formula[start..index].parse().expect("a count")
        };
        mass += element * count;
    }
    mass + PROTON_MASS_U
}

pub(crate) fn trace_mz(mz: f64, trace: u8) -> f64 {
    mz + C13C12_MASSDIFF_U * f64::from(trace)
}

fn gauss(rt: f64, apex: f64, height: f64, sigma: f64) -> f64 {
    height * (-((rt - apex).powi(2)) / (2.0 * sigma * sigma)).exp()
}

/// A small deterministic generator, so a fixture is the same every run.
struct Seeded(u64);

impl Seeded {
    fn next(&mut self) -> f64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 >> 11) as f64 / (1_u64 << 53) as f64
    }

    fn uniform(&mut self, low: f64, high: f64) -> f64 {
        low + (high - low) * self.next()
    }
}

/// Twenty matrix peaks, none within 20 ppm of any fixture target's trace, and
/// one above them all so no target trace is ever a spectrum's last peak.
///
/// Kept away from the targets deliberately, as M9.0's fixtures were: a single
/// matrix spike inside a window is picked by the engine as a feature -- one
/// point on the M+1 trace alone came back `DETECTED` with an invalid model
/// while this fixture was being written -- and a fixture meant to hold no
/// signal for a target must not hold any.
fn matrix(rng: &mut Seeded, ceiling: bool) -> Vec<(f64, f64)> {
    let centres: Vec<f64> = [CAFFEINE, PARACETAMOL, ADENINE, TYROSINE, PHENYLALANINE]
        .iter()
        .flat_map(|formula| [0_u8, 1].map(|trace| trace_mz(ion_mz(formula), trace)))
        .collect();
    let mut points = Vec::with_capacity(21);
    while points.len() < 20 {
        let mz = rng.uniform(100.0, 180.0);
        let intensity = rng.uniform(1.0e3, 1.0e5);
        if centres
            .iter()
            .all(|centre| (mz - centre).abs() > centre * 20e-6)
        {
            points.push((mz, intensity));
        }
    }
    if ceiling {
        points.push((450.0 + rng.uniform(0.0, 1.0), rng.uniform(1.0e3, 1.0e4)));
    }
    points
}

/// A peak's M and M+1 points at one retention time.
fn peak(mz: f64, rt: f64, apex: f64, height: f64, m1_ppm: f64) -> Vec<(f64, f64)> {
    let mut out = Vec::new();
    for (trace, ratio, ppm) in [(0_u8, 1.0, 0.5), (1, 0.1, m1_ppm)] {
        let value = gauss(rt, apex, height * ratio, 2.5);
        if value >= 1.0 {
            out.push((trace_mz(mz, trace) * (1.0 + ppm * 1e-6), value));
        }
    }
    out
}

fn grid(end: f64) -> Vec<f64> {
    (0..)
        .map(|index| f64::from(index) * 0.5)
        .take_while(|rt| *rt <= end + 1e-9)
        .collect()
}

pub(crate) fn scans(rts: &[f64], mut points_at: impl FnMut(f64) -> Vec<(f64, f64)>) -> Vec<Scan> {
    rts.iter()
        .map(|rt| {
            let mut points = points_at(*rt);
            points.sort_by(|left, right| left.0.total_cmp(&right.0));
            Scan { rt: *rt, points }
        })
        .collect()
}

pub(crate) const CAFFEINE: &str = "C8H10N4O2";
pub(crate) const PARACETAMOL: &str = "C8H9NO2";
pub(crate) const ADENINE: &str = "C5H5N5";
pub(crate) const TYROSINE: &str = "C9H11NO3";
pub(crate) const PHENYLALANINE: &str = "C9H11NO2";

/// One clean caffeine peak at 60 s, a strong coeluting interferent 7.5 ppm
/// away, the same m/z again at 95 s outside every window, and matrix.
pub(crate) fn plain() -> Vec<Scan> {
    let mz = ion_mz(CAFFEINE);
    let mut rng = Seeded(0x9E37_79B9_7F4A_7C15);
    scans(&grid(120.0), |rt| {
        let mut points = matrix(&mut rng, true);
        points.extend(peak(mz, rt, 60.0, 1.0e6, 0.5));
        points.push((mz * (1.0 + 7.5e-6), gauss(rt, 60.0, 5.0e7, 2.5) + 1.0));
        let late = gauss(rt, 95.0, 5.0e7, 2.5);
        if late >= 1.0 {
            points.push((mz * (1.0 + 0.5e-6), late));
        }
        points
    })
}

/// A caffeine peak whose M+1 is the spectrum's last peak, just below its m/z,
/// wherever no ceiling peak sits above it: after 80 s, and there only an
/// M+1-only blip at 82-88 s. A window that reaches those spectra meets the
/// extractor's double-count defect; one that stops at 80 s does not.
pub(crate) fn edge() -> Vec<Scan> {
    let mz = ion_mz(CAFFEINE);
    let mut rng = Seeded(0x0123_4567_89AB_CDEF);
    scans(&grid(120.0), |rt| {
        let mut points = matrix(&mut rng, rt <= 80.0);
        points.extend(peak(mz, rt, 60.0, 1.0e6, 0.5));
        if (82.0..=88.0).contains(&rt) {
            points.push((trace_mz(mz, 1) * (1.0 - 1e-6), 500.0));
        }
        points
    })
}

/// One clean caffeine peak at 60 s and one phenylalanine peak at 100 s.
pub(crate) fn two_peaks() -> Vec<Scan> {
    let caffeine = ion_mz(CAFFEINE);
    let phenylalanine = ion_mz(PHENYLALANINE);
    let mut rng = Seeded(0x2545_F491_4F6C_DD1D);
    scans(&grid(120.0), |rt| {
        let mut points = matrix(&mut rng, true);
        points.extend(peak(caffeine, rt, 60.0, 1.0e6, 0.5));
        points.extend(peak(phenylalanine, rt, 100.0, 5.0e5, 0.5));
        points
    })
}

fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let triple = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        for (position, shift) in [18, 12, 6, 0].into_iter().enumerate() {
            if position <= chunk.len() {
                out.push(ALPHABET[((triple >> shift) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// A legal mzML 1.1 document of centroided, positive-mode MS1 spectra, with
/// uncompressed 64-bit arrays -- the shape M9.0's own fixture writer produced
/// and the engine read. `prefix` writes every element in a named namespace,
/// which is equally legal and which the engine's reader reads as empty.
pub(crate) fn mzml(scans: &[Scan], prefix: &str) -> Vec<u8> {
    let ns = "http://psi.hupo.org/ms/mzml";
    let p = if prefix.is_empty() {
        String::new()
    } else {
        format!("{prefix}:")
    };
    let xmlns = if prefix.is_empty() {
        format!("xmlns=\"{ns}\"")
    } else {
        format!("xmlns:{prefix}=\"{ns}\"")
    };
    let cv = |accession: &str, name: &str, value: &str, extra: &str| {
        let reference = accession.split(':').next().unwrap_or("MS");
        format!(
            "<{p}cvParam cvRef=\"{reference}\" accession=\"{accession}\" name=\"{name}\" value=\"{value}\"{extra}/>"
        )
    };
    let mut out = String::new();
    out.push_str("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n");
    let _ = writeln!(
        out,
        "<{p}mzML {xmlns} version=\"1.1.0\" id=\"m91_fixture\">"
    );
    let _ = writeln!(
        out,
        "<{p}cvList count=\"2\"><{p}cv id=\"MS\" fullName=\"Proteomics Standards Initiative Mass Spectrometry Ontology\" URI=\"https://raw.githubusercontent.com/HUPO-PSI/psi-ms-CV/master/psi-ms.obo\"/><{p}cv id=\"UO\" fullName=\"Unit Ontology\" URI=\"http://ontologies.berkeleybop.org/uo.obo\"/></{p}cvList>"
    );
    let _ = writeln!(
        out,
        "<{p}fileDescription><{p}fileContent>{}</{p}fileContent></{p}fileDescription>",
        cv("MS:1000579", "MS1 spectrum", "", "")
    );
    let _ = writeln!(
        out,
        "<{p}softwareList count=\"1\"><{p}software id=\"m91_fixture\" version=\"0\">{}</{p}software></{p}softwareList>",
        cv(
            "MS:1000799",
            "custom unreleased software tool",
            "mscanvas-m9.1-fixture",
            ""
        )
    );
    let _ = writeln!(
        out,
        "<{p}instrumentConfigurationList count=\"1\"><{p}instrumentConfiguration id=\"IC1\">{}</{p}instrumentConfiguration></{p}instrumentConfigurationList>",
        cv("MS:1000031", "instrument model", "", "")
    );
    let _ = writeln!(
        out,
        "<{p}dataProcessingList count=\"1\"><{p}dataProcessing id=\"DP1\"><{p}processingMethod order=\"0\" softwareRef=\"m91_fixture\">{}</{p}processingMethod></{p}dataProcessing></{p}dataProcessingList>",
        cv("MS:1000544", "Conversion to mzML", "", "")
    );
    let _ = writeln!(
        out,
        "<{p}run id=\"run1\" defaultInstrumentConfigurationRef=\"IC1\">"
    );
    let _ = writeln!(
        out,
        "<{p}spectrumList count=\"{}\" defaultDataProcessingRef=\"DP1\">",
        scans.len()
    );
    for (index, scan) in scans.iter().enumerate() {
        let encode = |values: Vec<f64>| {
            let bytes: Vec<u8> = values
                .iter()
                .flat_map(|value| value.to_le_bytes())
                .collect();
            base64(&bytes)
        };
        let mzs = encode(scan.points.iter().map(|point| point.0).collect());
        let intensities = encode(scan.points.iter().map(|point| point.1).collect());
        let _ = write!(
            out,
            "<{p}spectrum index=\"{index}\" id=\"scan={}\" defaultArrayLength=\"{}\">",
            index + 1,
            scan.points.len()
        );
        out.push_str(&cv("MS:1000511", "ms level", "1", ""));
        out.push_str(&cv("MS:1000579", "MS1 spectrum", "", ""));
        out.push_str(&cv("MS:1000130", "positive scan", "", ""));
        out.push_str(&cv("MS:1000127", "centroid spectrum", "", ""));
        let _ = write!(
            out,
            "<{p}scanList count=\"1\">{}<{p}scan>{}</{p}scan></{p}scanList>",
            cv("MS:1000795", "no combination", "", ""),
            cv(
                "MS:1000016",
                "scan start time",
                &format!("{:?}", scan.rt),
                " unitCvRef=\"UO\" unitAccession=\"UO:0000010\" unitName=\"second\""
            )
        );
        let _ = write!(out, "<{p}binaryDataArrayList count=\"2\">");
        for (payload, accession, name, unit) in [
            (
                &mzs,
                "MS:1000514",
                "m/z array",
                " unitCvRef=\"MS\" unitAccession=\"MS:1000040\" unitName=\"m/z\"",
            ),
            (
                &intensities,
                "MS:1000515",
                "intensity array",
                " unitCvRef=\"MS\" unitAccession=\"MS:1000131\" unitName=\"number of detector counts\"",
            ),
        ] {
            let _ = write!(
                out,
                "<{p}binaryDataArray encodedLength=\"{}\">{}{}{}<{p}binary>{payload}</{p}binary></{p}binaryDataArray>",
                payload.len(),
                cv("MS:1000523", "64-bit float", "", ""),
                cv("MS:1000576", "no compression", "", ""),
                cv(accession, name, "", unit)
            );
        }
        let _ = writeln!(out, "</{p}binaryDataArrayList></{p}spectrum>");
    }
    let _ = write!(out, "</{p}spectrumList>\n</{p}run>\n</{p}mzML>\n");
    out.into_bytes()
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

/// A directory under `.tmp/m91-jobs/tests/`, on the work area's own volume,
/// removed when the test ends.
pub(crate) struct WorkArea {
    path: PathBuf,
}

impl WorkArea {
    pub(crate) fn new(label: &str) -> Self {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .nth(3)
            .expect("the repository root")
            .join(".tmp")
            .join("m91-jobs")
            .join("tests");
        let path = root.join(format!(
            "{label}-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).expect("create the test work area");
        Self { path }
    }

    pub(crate) fn join(&self, name: &str) -> PathBuf {
        self.path.join(name)
    }

    pub(crate) fn write(&self, name: &str, bytes: &[u8]) -> PathBuf {
        let path = self.join(name);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create the parent");
        }
        fs::write(&path, bytes).expect("write the fixture");
        path
    }
}

impl Drop for WorkArea {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

/// Remembers a workspace row for a reference, the way reattachment does, so
/// a layer can be made from it.
fn admit(store: &ProjectStore, id: InputId) {
    let job = store.accept_job().expect("accept");
    let proof = store.prove_admissible(job, id).expect("proved");
    store
        .record_admission(&proof, "dataset-1", proof.identities())
        .expect("remembered");
}

/// A saved project at `document` with one layer over `source`.
pub(crate) fn project_over(document: &Path, source: &Path) -> (ProjectStore, InputId, LayerId) {
    let store = ProjectStore::new();
    store.create("Targeted".to_owned(), false).expect("new");
    let input = store.register_input(source).expect("register");
    let check = store.accept_job().expect("accept");
    store.check_linked_files(check).expect("check");
    admit(&store, input);
    let layer = store.create_layer(input, |_| true).expect("layer");
    store.save_as(document).expect("save as");
    (store, input, layer)
}

pub(crate) fn target(label: &str, formula: &str, rt: &str, half: &str) -> TargetDraft {
    TargetDraft {
        label: label.to_owned(),
        formula: formula.to_owned(),
        neutral_mass: None,
        rt_s: rt.to_owned(),
        rt_half_width_s: half.to_owned(),
    }
}

pub(crate) fn draft(targets: Vec<TargetDraft>) -> PlanDraft {
    PlanDraft {
        mz_half_width_ppm: "5".to_owned(),
        expected_peak_width_s: "6".to_owned(),
        targets,
    }
}

/// Resolves a plan and answers it, failing the test on any problem.
pub(crate) fn plan(
    store: &ProjectStore,
    layer: LayerId,
    targets: Vec<TargetDraft>,
    executor: &dyn RecipeExecutor,
) -> TargetedMs1Plan {
    let resolution = store
        .resolve_targeted_ms1_plan(layer, &draft(targets), executor)
        .expect("resolved");
    assert!(resolution.problems.is_empty(), "{:?}", resolution.problems);
    resolution.plan.expect("a plan")
}

fn run(
    store: &ProjectStore,
    plan: &TargetedMs1Plan,
    executor: &dyn RecipeExecutor,
) -> Result<crate::project::TargetedMs1RunEnd, ProjectError> {
    let job = store.accept_job()?;
    store.run_targeted_ms1(job, &plan.plan_sha256, executor)
}

fn document_json(path: &Path) -> serde_json::Value {
    serde_json::from_slice(&fs::read(path).expect("read the document")).expect("json")
}

// ---------------------------------------------------------------------------
// The whole path, with the real runtime
// ---------------------------------------------------------------------------

fn real() -> Supervisor {
    Supervisor::development().expect("a development build has the runtime location")
}

#[test]
#[ignore = "runs the pinned runtime under .tmp/m91-runtime"]
fn a_supported_source_travels_the_whole_path_and_survives_save_reopen_and_save_as() {
    let area = WorkArea::new("vertical");
    let source = area.write("data/plain.mzML", &mzml(&plain(), ""));
    let document = area.join("study.mscanvas");
    let (store, _, layer) = project_over(&document, &source);
    let supervisor = real();
    let plan = plan(
        &store,
        layer,
        vec![
            target("caffeine", CAFFEINE, "60", "20"),
            target("paracetamol", PARACETAMOL, "60", "20"),
        ],
        &supervisor,
    );

    let end = run(&store, &plan, &supervisor).expect("a recorded run");
    assert_eq!(
        end.outcome,
        TerminalOutcome::Completed,
        "{:?}",
        store.describe().runs
    );
    let artifact = end.artifact.expect("a result");

    // Rows, checked against the record, in the plan's order.
    let page = store.read_targeted_ms1_rows(artifact, 0).expect("rows");
    assert_eq!(page.total, 2);
    assert_eq!(page.rows[0].target_id, plan.targets[0].target_id);
    assert_eq!(page.rows[0].outcome, RowOutcome::Detected);
    assert_eq!(page.rows[1].outcome, RowOutcome::NotDetected);
    assert!(page.rows[1].candidates.is_empty());
    assert!(!page.rows[1].recovered_from_empty_selection);
    let feature = page.rows[0].feature.as_ref().expect("the feature");
    assert!(
        (feature.apex_rt_s - 60.0).abs() < 1.0,
        "apex {}",
        feature.apex_rt_s
    );
    assert!(feature.raw_area > 0.0);
    // The 7.5 ppm interferent never contributed: the window's maximum is the
    // clean peak's, not the interferent's 5e7.
    let signal = page.rows[0].signal.as_ref().expect("signal");
    assert!(signal.max[0] < 2.0e6, "window max {}", signal.max[0]);

    // One target's evidence, bounded to that target.
    let evidence = store
        .read_targeted_ms1_evidence(artifact, plan.targets[0].target_id)
        .expect("evidence");
    assert_eq!(evidence.len(), 2);
    assert!(
        evidence
            .iter()
            .all(|line| line.target_id == plan.targets[0].target_id)
    );
    assert_eq!(evidence[0].points.len(), signal.points as usize);

    // The run's record: the plan, what was measured, and the attempt's facts.
    let described = store.describe();
    let recorded = described.runs.last().expect("the run");
    let execution = recorded.targeted_ms1.as_ref().expect("the block");
    assert_eq!(execution.plan_sha256, plan.plan_sha256);
    assert_eq!(execution.consumed_content, plan.expected_content);
    let attempt = execution.attempt.as_ref().expect("attempt facts");
    assert_eq!(
        attempt.runtime_manifest_sha256,
        recipe::RUNTIME_MANIFEST_SHA256
    );
    assert_eq!(attempt.adapter_sha256, recipe::adapter_sha256());
    assert_eq!(attempt.source_view, SourceView::HardLinkInWorkArea);
    let report = attempt.engine_report.as_ref().expect("engine report");
    assert_eq!(report.pyopenms, "3.5.0");
    assert_eq!(report.openms_revision, "c1370fb");
    assert!(attempt.loaded_modules.iter().any(|module| {
        module
            .name
            .eq_ignore_ascii_case("site-packages/pyopenms/OpenMS.dll")
    }));

    // Published before referenced; referenced in the document only by Save.
    let store_dir = payload::store_of(&document).expect("a store");
    assert!(payload::is_plain_directory(
        &store_dir.join(artifact.to_string())
    ));
    assert!(
        document_json(&document)["artifacts"]
            .as_array()
            .expect("array")
            .is_empty()
    );
    store.save().expect("save");
    assert_eq!(
        document_json(&document)["artifacts"][0]["id"],
        artifact.to_string()
    );

    // Reopened by a new session: the record and a whole result.
    let reopened = ProjectStore::new();
    reopened.open_document(&document, false).expect("open");
    let described = reopened.describe();
    let result = described.artifacts[0]
        .targeted_ms1
        .as_ref()
        .expect("result");
    assert_eq!(result.availability, "available");
    assert_eq!(result.result.summary.detected, 1);
    assert_eq!(result.result.summary.not_detected, 1);
    assert_eq!(
        reopened
            .read_targeted_ms1_rows(artifact, 0)
            .expect("rows")
            .rows,
        page.rows
    );

    // Save As copies the result whole into a store beside the new document.
    let copy = area.join("copy/study-copy.mscanvas");
    fs::create_dir_all(copy.parent().expect("parent")).expect("dir");
    reopened.save_as(&copy).expect("save as");
    let copied = reopened.describe();
    assert_eq!(copied.artifacts[0].id, artifact.to_string());
    assert_eq!(
        copied.artifacts[0]
            .targeted_ms1
            .as_ref()
            .expect("result")
            .availability,
        "available"
    );
    let copy_store = payload::store_of(&copy).expect("store");
    assert!(payload::is_plain_directory(
        &copy_store.join(artifact.to_string())
    ));
    assert_eq!(
        reopened
            .read_targeted_ms1_rows(artifact, 0)
            .expect("rows from the copy")
            .rows,
        page.rows
    );
    // The original is untouched and still whole.
    let original = ProjectStore::new();
    original
        .open_document(&document, false)
        .expect("open the original");
    assert_eq!(
        original.describe().artifacts[0]
            .targeted_ms1
            .as_ref()
            .expect("result")
            .availability,
        "available"
    );
    // No residue: no attempt directory, no staging, no pending store.
    assert!(
        fs::read_dir(store_dir.join(".staging"))
            .expect("staging")
            .next()
            .is_none()
    );
}

// ---------------------------------------------------------------------------
// A fake executor: the store's rules without a runtime
// ---------------------------------------------------------------------------

/// Rows and evidence of the right shape for every target of a plan: each one
/// `NOT_DETECTED` over a window that was extracted and held nothing.
fn synthetic_payload(plan: &TargetedMs1Plan) -> (Vec<u8>, Vec<u8>) {
    let (mut rows, mut evidence) = (String::new(), String::new());
    for target in &plan.targets {
        let id = target.target_id.to_string();
        let _ = writeln!(
            rows,
            "{{\"targetId\":\"{id}\",\"outcome\":\"NOT_DETECTED\",\"failureReason\":null,\"edgeTraceCount\":0,\
\"ion\":{{\"adduct\":\"[M+H]+\",\"charge\":1,\"mzTheoretical\":[195.08,196.08],\"isotopeProbability\":[0.9,0.1]}},\
\"windows\":{{\"rtClosedS\":[40.0,80.0],\"mzOpen\":[[195.079,195.081],[196.079,196.081]]}},\
\"signal\":{{\"points\":2,\"sum\":[0.0,0.0],\"max\":[0.0,0.0],\"anyNonzeroPoint\":false}},\
\"feature\":null,\"candidates\":[],\"overlapWinner\":false,\
\"relations\":{{\"sharedWith\":[],\"suppressedBy\":null,\"overlapRemoved\":[]}},\"recoveredFromEmptySelection\":false}}"
        );
        for (trace, mz) in [(0, "195.08"), (1, "196.08")] {
            let _ = writeln!(
                evidence,
                "{{\"targetId\":\"{id}\",\"trace\":{trace},\"mzTheoretical\":{mz},\"points\":[[80,40.0,0.0],[81,40.5,0.0]]}}"
            );
        }
    }
    (rows.into_bytes(), evidence.into_bytes())
}

fn fake_facts() -> AttemptFacts {
    AttemptFacts {
        adapter_sha256: recipe::adapter_sha256().to_owned(),
        runtime_manifest_sha256: recipe::RUNTIME_MANIFEST_SHA256.to_owned(),
        interpreter_sha256: "C".repeat(64),
        source_view: SourceView::HardLinkInWorkArea,
        engine_report: None,
        loaded_modules: Vec::new(),
    }
}

/// Stages a real payload for the plan exactly where the supervisor would.
fn completed(order: &AttemptOrder<'_>) -> AttemptEnd {
    let (rows, evidence) = synthetic_payload(order.plan);
    let staging = payload::create_staging(order.store, order.artifact).expect("staging");
    let reference = payload::stage_payload(
        &staging,
        order.artifact,
        &order.plan.plan_sha256,
        &rows,
        &evidence,
    )
    .expect("staged");
    let targets = u32::try_from(order.plan.targets.len()).expect("fits");
    AttemptEnd::Completed {
        consumed: order.plan.expected_content.clone(),
        attempt: fake_facts(),
        result: TargetedMs1ResultV1 {
            summary: OutcomeSummary {
                targets,
                detected: 0,
                detected_ambiguous: 0,
                shared: 0,
                suppressed_by_overlap: 0,
                not_detected: targets,
                failed: 0,
            },
            no_candidate_recovery: false,
            payload: reference,
        },
    }
}

fn failed_with(
    code: FailureCode,
    stage: FailureStage,
) -> impl Fn(&AttemptOrder<'_>) -> AttemptEnd + Sync {
    move |order| AttemptEnd::Failed {
        consumed: order.plan.expected_content.clone(),
        attempt: Some(fake_facts()),
        failure: RunFailure { code, stage },
        stop: None,
    }
}

type Attempt<'a> =
    dyn Fn(&AttemptOrder<'_>, &Cancellation, &(dyn Fn(RunPhase) + Sync)) -> AttemptEnd + Sync + 'a;

/// An executor whose preflight passes and whose attempt is whatever the test
/// says.
struct Fake<'a> {
    attempt: Box<Attempt<'a>>,
}

impl<'a> Fake<'a> {
    fn new(attempt: impl Fn(&AttemptOrder<'_>) -> AttemptEnd + Sync + 'a) -> Self {
        Self {
            attempt: Box::new(move |order, _, _| attempt(order)),
        }
    }

    fn with(
        attempt: impl Fn(&AttemptOrder<'_>, &Cancellation, &(dyn Fn(RunPhase) + Sync)) -> AttemptEnd
        + Sync
        + 'a,
    ) -> Self {
        Self {
            attempt: Box::new(attempt),
        }
    }
}

impl RecipeExecutor for Fake<'_> {
    fn preflight(&self, _plan: &TargetedMs1Plan, _source: &Path) -> Result<(), ProjectError> {
        Ok(())
    }

    fn attempt(
        &self,
        order: &AttemptOrder<'_>,
        cancellation: &Cancellation,
        progress: &(dyn Fn(RunPhase) + Sync),
    ) -> AttemptEnd {
        (self.attempt)(order, cancellation, progress)
    }
}

/// A saved project over a small file named as mzML, in a system temporary
/// directory: the store's rules do not read it.
fn fake_project(scratch: &Scratch) -> (ProjectStore, LayerId, PathBuf) {
    let source = scratch.write("data/sample.mzML", b"<mzML/>");
    let document = scratch.join("study.mscanvas");
    let (store, _, layer) = project_over(&document, &source);
    (store, layer, document)
}

fn one_target() -> Vec<TargetDraft> {
    vec![target("caffeine", CAFFEINE, "60", "20")]
}

fn stored_result(store: &ProjectStore) -> ArtifactId {
    store.describe().artifacts[0]
        .id
        .parse()
        .expect("an artifact id")
}

// ---------------------------------------------------------------------------
// Recording a run
// ---------------------------------------------------------------------------

#[test]
fn a_completed_run_records_its_plan_its_result_and_its_lineage() {
    let scratch = Scratch::new("m91-completed");
    let (store, layer, _) = fake_project(&scratch);
    let executor = Fake::new(completed);
    let plan = plan(&store, layer, one_target(), &executor);
    let end = run(&store, &plan, &executor).expect("recorded");
    assert_eq!(end.outcome, TerminalOutcome::Completed);

    let described = store.describe();
    assert_eq!(described.plans, vec![plan.clone()]);
    let recorded = &described.runs[0];
    assert_eq!(recorded.operation, "targetedMs1V1");
    assert_eq!(recorded.outcome, "completed");
    assert_eq!(recorded.layer_ids, vec![layer.to_string()]);
    assert_eq!(
        recorded.output_artifact_ids,
        vec![end.artifact.expect("a result").to_string()]
    );
    let artifact = &described.artifacts[0];
    assert_eq!(artifact.kind, "targetedMs1ResultV1");
    assert_eq!(
        artifact.produced_by_run_id.as_deref(),
        Some(recorded.id.as_str())
    );
    assert_eq!(
        artifact.targeted_ms1.as_ref().expect("result").availability,
        "available"
    );
    assert_eq!(
        described.layers[0].consumed_by_run_ids,
        vec![recorded.id.clone()]
    );
    assert!(described.dirty);
    assert!(described.analysis_run.is_none(), "released when it ended");
    // The layer a run consumed is history now.
    assert_eq!(store.remove_layer(layer), Err(ProjectError::LayerUsedByRun));
}

#[test]
fn a_result_is_published_before_it_is_referenced_and_saved_only_by_save() {
    let scratch = Scratch::new("m91-order");
    let (store, layer, document) = fake_project(&scratch);
    let executor = Fake::new(completed);
    let plan = plan(&store, layer, one_target(), &executor);
    let artifact = run(&store, &plan, &executor)
        .expect("run")
        .artifact
        .expect("result");
    let store_dir = payload::store_of(&document).expect("store");
    assert!(payload::is_plain_directory(
        &store_dir.join(artifact.to_string())
    ));
    assert!(
        document_json(&document)["runs"]
            .as_array()
            .expect("runs")
            .is_empty()
    );
    store.save().expect("save");
    let saved = document_json(&document);
    assert_eq!(saved["schemaVersion"], 4);
    assert_eq!(saved["artifacts"][0]["id"], artifact.to_string());
    assert_eq!(saved["plans"][0]["planSha256"], plan.plan_sha256);
    // The record names the result by digest and never by path.
    let text = fs::read_to_string(&document).expect("read");
    assert!(!text.contains(".payloads"));
}

#[test]
fn a_failed_run_keeps_its_code_and_stage_and_publishes_nothing() {
    let scratch = Scratch::new("m91-failed");
    let (store, layer, document) = fake_project(&scratch);
    let executor = Fake::new(failed_with(
        FailureCode::SourceChanged,
        FailureStage::Source,
    ));
    let plan = plan(&store, layer, one_target(), &executor);
    let end = run(&store, &plan, &executor).expect("recorded");
    assert_eq!(end.outcome, TerminalOutcome::Failed);
    assert!(end.artifact.is_none());
    let described = store.describe();
    assert!(described.artifacts.is_empty());
    let execution = described.runs[0].targeted_ms1.as_ref().expect("block");
    assert_eq!(
        execution.failure,
        Some(RunFailure {
            code: FailureCode::SourceChanged,
            stage: FailureStage::Source
        })
    );
    let store_dir = payload::store_of(&document).expect("store");
    assert_eq!(payload::unreferenced(&store_dir, &[]), 0);
    // Saved and reopened, the failure is still history.
    store.save().expect("save");
    let reopened = ProjectStore::new();
    reopened.open_document(&document, false).expect("open");
    assert_eq!(reopened.describe().runs[0].outcome, "failed");
}

#[test]
fn a_cancel_that_reaches_the_commit_first_stops_the_publication() {
    let scratch = Scratch::new("m91-cancel-commit");
    let (store, layer, document) = fake_project(&scratch);
    // The attempt finishes whole, and the cancel lands before the commit.
    let executor = Fake::with(|order, cancellation, _| {
        let end = completed(order);
        cancellation.request();
        end
    });
    let plan = plan(&store, layer, one_target(), &executor);
    let end = run(&store, &plan, &executor).expect("recorded");
    assert_eq!(end.outcome, TerminalOutcome::Cancelled);
    let described = store.describe();
    assert!(described.artifacts.is_empty());
    let stop = described.runs[0]
        .targeted_ms1
        .as_ref()
        .expect("block")
        .stop
        .expect("stop");
    assert_eq!(stop.reason, StopReason::CancelRequested);
    let store_dir = payload::store_of(&document).expect("store");
    assert_eq!(
        payload::unreferenced(&store_dir, &[]),
        0,
        "nothing was published"
    );
    assert!(
        fs::read_dir(store_dir.join(".staging"))
            .expect("staging")
            .next()
            .is_none()
    );
}

#[test]
fn a_cancelled_attempt_records_its_stop_and_publishes_nothing() {
    let scratch = Scratch::new("m91-cancelled");
    let (store, layer, _) = fake_project(&scratch);
    let executor = Fake::new(|order| AttemptEnd::Cancelled {
        consumed: order.plan.expected_content.clone(),
        attempt: Some(fake_facts()),
        stop: StopFacts {
            reason: StopReason::CancelRequested,
            worker_terminated: true,
            exit_observed: true,
        },
    });
    let plan = plan(&store, layer, one_target(), &executor);
    assert_eq!(
        run(&store, &plan, &executor).expect("recorded").outcome,
        TerminalOutcome::Cancelled
    );
    assert!(store.describe().artifacts.is_empty());
}

#[test]
fn the_project_is_held_still_while_a_run_is_in_progress() {
    let scratch = Scratch::new("m91-held");
    let (store, layer, document) = fake_project(&scratch);
    let elsewhere = scratch.join("elsewhere.mscanvas");
    let input: InputId = store.describe().inputs[0].id.parse().expect("id");
    let seen = std::sync::Mutex::new(Vec::new());
    let executor = Fake::with(|order, _, progress| {
        progress(RunPhase::RunningEngine);
        let mut seen = seen.lock().expect("lock");
        seen.push((
            "phase",
            store.analysis_run().map(|(_, phase)| phase.stable_id()),
        ));
        seen.push((
            "describe",
            store.describe().analysis_run.map(|run| run.phase),
        ));
        for (name, refusal) in [
            ("create", store.create("Other".to_owned(), true).err()),
            ("close", store.close(true).err()),
            ("open", store.open_document(&document, true).err()),
            ("save as", store.save_as(&elsewhere).err()),
            ("remove layer", store.remove_layer(layer).err()),
            ("remove input", store.remove_input(input).err()),
            ("second job", store.accept_job().err()),
        ] {
            seen.push((name, refusal.map(ProjectError::stable_id)));
        }
        seen.push(("save", store.save().err().map(ProjectError::stable_id)));
        completed(order)
    });
    let plan = plan(&store, layer, one_target(), &executor);
    run(&store, &plan, &executor).expect("recorded");
    drop(executor);
    let seen = seen.into_inner().expect("lock");
    assert_eq!(seen[0], ("phase", Some("runningEngine")));
    assert_eq!(seen[1], ("describe", Some("runningEngine")));
    for (name, refusal) in &seen[2..8] {
        assert_eq!(*refusal, Some("analysisRunning"), "{name}");
    }
    assert_eq!(seen[8], ("second job", Some("alreadyRunning")));
    // Saving the document in place does not move anything the run names.
    assert_eq!(seen[9], ("save", None));
    assert!(!elsewhere.exists());
    assert!(store.analysis_run().is_none());
}

#[test]
fn a_run_is_refused_before_it_exists_in_an_unsaved_project() {
    let scratch = Scratch::new("m91-unsaved");
    let source = scratch.write("sample.mzML", b"<mzML/>");
    let store = ProjectStore::new();
    store.create("Unsaved".to_owned(), false).expect("new");
    let input = store.register_input(&source).expect("register");
    let check = store.accept_job().expect("accept");
    store.check_linked_files(check).expect("check");
    admit(&store, input);
    let layer = store.create_layer(input, |_| true).expect("layer");
    let executor = Fake::new(completed);
    let resolution = store
        .resolve_targeted_ms1_plan(layer, &draft(one_target()), &executor)
        .expect("resolved");
    assert_eq!(resolution.blocked, Some(ProjectError::NotYetPublished));
    let plan = resolution.plan.expect("a plan to review");
    assert_eq!(
        run(&store, &plan, &executor).err(),
        Some(ProjectError::NotYetPublished)
    );
    assert!(store.describe().runs.is_empty());
    assert!(store.describe().plans.is_empty());
}

#[test]
fn a_plan_that_is_neither_resolved_nor_recorded_is_refused_and_records_nothing() {
    let scratch = Scratch::new("m91-stale-plan");
    let (store, _, _) = fake_project(&scratch);
    let job = store.accept_job().expect("accept");
    assert_eq!(
        store
            .run_targeted_ms1(job, &"A".repeat(64), &Fake::new(completed))
            .err(),
        Some(ProjectError::PlanNotCurrent)
    );
    assert!(store.describe().runs.is_empty());
    // The refused run released its operation: the next one is accepted.
    assert!(store.accept_job().is_ok());
}

#[test]
fn a_new_store_is_placed_whole_and_leaves_no_pending_directory() {
    let scratch = Scratch::new("m91-store-placed");
    let (store, layer, document) = fake_project(&scratch);
    let executor = Fake::new(completed);
    let plan = plan(&store, layer, one_target(), &executor);
    run(&store, &plan, &executor).expect("run");
    let store_dir = payload::store_of(&document).expect("store");
    assert!(store_dir.join(".owner.json").is_file());
    let residue: Vec<String> = fs::read_dir(document.parent().expect("parent"))
        .expect("dir")
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.ends_with(".pending"))
        .collect();
    assert!(residue.is_empty(), "{residue:?}");
}

#[test]
fn a_worker_whose_end_was_not_observed_keeps_every_later_run_out() {
    let scratch = Scratch::new("m91-quarantine");
    let (store, layer, _) = fake_project(&scratch);
    let first = Fake::new(failed_with(
        FailureCode::WorkerNotAccountedFor,
        FailureStage::Runtime,
    ));
    let plan = plan(&store, layer, one_target(), &first);
    let end = run(&store, &plan, &first).expect("the run is recorded");
    assert_eq!(end.outcome, TerminalOutcome::Failed);

    // The next run is refused before it exists, and records nothing.
    let executor = Fake::new(completed);
    assert!(matches!(
        run(&store, &plan, &executor),
        Err(ProjectError::AnalysisQuarantined)
    ));
    assert_eq!(store.describe().runs.len(), 1);
    // A review says why a plan cannot run here.
    let resolution = store
        .resolve_targeted_ms1_plan(layer, &draft(one_target()), &executor)
        .expect("resolved");
    assert_eq!(resolution.blocked, Some(ProjectError::AnalysisQuarantined));
    // Anything else in the project goes on as before.
    store.save().expect("save");
}

#[test]
fn a_retry_is_a_new_run_of_the_same_recorded_plan() {
    let scratch = Scratch::new("m91-retry");
    let (store, layer, _) = fake_project(&scratch);
    let first = Fake::new(failed_with(FailureCode::EngineError, FailureStage::Engine));
    let plan = plan(&store, layer, one_target(), &first);
    run(&store, &plan, &first).expect("a failed first run");
    let executor = Fake::new(completed);
    run(&store, &plan, &executor).expect("a retry");
    let described = store.describe();
    assert_eq!(described.plans.len(), 1, "one plan, recorded once");
    assert_eq!(
        described
            .runs
            .iter()
            .map(|run| run.outcome)
            .collect::<Vec<_>>(),
        vec!["failed", "completed"]
    );
    assert!(described.runs.iter().all(|run| {
        run.targeted_ms1
            .as_ref()
            .is_some_and(|block| block.plan_sha256 == plan.plan_sha256)
    }));
}

#[test]
fn the_whole_ordered_target_batch_is_part_of_what_names_a_plan() {
    let scratch = Scratch::new("m91-batch");
    let (store, layer, _) = fake_project(&scratch);
    let executor = Fake::new(completed);
    let a = target("caffeine", CAFFEINE, "60", "20");
    let b = target("paracetamol", PARACETAMOL, "60", "20");
    let forward = plan(&store, layer, vec![a.clone(), b.clone()], &executor);
    let reversed = plan(&store, layer, vec![b.clone(), a.clone()], &executor);
    let alone = plan(&store, layer, vec![a.clone()], &executor);
    let mut wider = a.clone();
    wider.rt_half_width_s = "21".to_owned();
    let widened = plan(&store, layer, vec![wider, b], &executor);
    let digests = [&forward, &reversed, &alone, &widened]
        .map(|plan| (plan.plan_sha256.clone(), plan.target_list_sha256.clone()));
    for (index, left) in digests.iter().enumerate() {
        for right in &digests[index + 1..] {
            assert_ne!(left.0, right.0);
            assert_ne!(left.1, right.1);
        }
    }
    // The engine receives the targets in the order reviewed.
    assert_eq!(reversed.targets[0].label, "paracetamol");
    // The same text resolved again is a new plan: target identifiers are
    // minted per review, and a result names the identifiers it was given.
    let again = plan(&store, layer, vec![a], &executor);
    assert_ne!(again.plan_sha256, alone.plan_sha256);
}

#[test]
fn request_problems_are_reported_row_by_row_and_create_no_plan() {
    let scratch = Scratch::new("m91-problems");
    let (store, layer, _) = fake_project(&scratch);
    let executor = Fake::new(completed);
    let mut rows = vec![
        target("caffeine", CAFFEINE, "60", "20"),
        target("caffeine", "C8H10N4O2Xx", "", "0"),
        target("", "c8h10", "-1", "abc"),
    ];
    rows[1].neutral_mass = Some("6000".to_owned());
    let mut request = draft(rows);
    request.mz_half_width_ppm = "0.4".to_owned();
    request.expected_peak_width_s = "NaN".to_owned();
    let resolution = store
        .resolve_targeted_ms1_plan(layer, &request, &executor)
        .expect("resolved");
    assert!(resolution.plan.is_none());
    let found: Vec<(Option<usize>, &str, &str)> = resolution
        .problems
        .iter()
        .map(|problem| {
            (
                problem.row,
                problem.field.stable_id(),
                problem.problem.stable_id(),
            )
        })
        .collect();
    assert_eq!(
        found,
        vec![
            (Some(2), "label", "duplicate"),
            (Some(2), "formula", "invalid"),
            (Some(2), "neutralMass", "outOfRange"),
            (Some(2), "rtS", "required"),
            (Some(2), "rtHalfWidthS", "outOfRange"),
            (Some(3), "label", "required"),
            (Some(3), "formula", "invalid"),
            (Some(3), "rtS", "outOfRange"),
            (Some(3), "rtHalfWidthS", "invalid"),
            (None, "mzHalfWidthPpm", "outOfRange"),
            (None, "expectedPeakWidthS", "invalid"),
        ]
    );
    let too_many = draft(
        (0..=record::MAX_TARGETS)
            .map(|index| target(&format!("t{index}"), CAFFEINE, "60", "5"))
            .collect(),
    );
    let resolution = store
        .resolve_targeted_ms1_plan(layer, &too_many, &executor)
        .expect("resolved");
    assert!(
        resolution
            .problems
            .iter()
            .any(|problem| problem.problem.stable_id() == "tooMany")
    );
    assert!(store.describe().plans.is_empty());
}

#[test]
fn a_source_that_is_not_one_mzml_file_is_refused_before_a_plan() {
    let scratch = Scratch::new("m91-not-mzml");
    let source = scratch.write("data/sample.txt", b"text");
    let document = scratch.join("study.mscanvas");
    let (store, _, layer) = project_over(&document, &source);
    assert_eq!(
        store
            .resolve_targeted_ms1_plan(layer, &draft(one_target()), &Fake::new(completed))
            .err(),
        Some(ProjectError::RecipeSourceUnsupported)
    );
}

#[test]
fn a_foreign_store_at_the_result_name_blocks_a_run_rather_than_being_written_into() {
    let scratch = Scratch::new("m91-foreign-store");
    let (store, layer, document) = fake_project(&scratch);
    let store_dir = payload::store_of(&document).expect("store");
    fs::create_dir(&store_dir).expect("dir");
    fs::write(
        store_dir.join(".owner.json"),
        format!(
            "{{\"schema\":\"mscanvas.payloadStoreOwner/1\",\"projectId\":\"{}\"}}",
            record::ProjectId::new()
        ),
    )
    .expect("owner");
    let executor = Fake::new(completed);
    let plan = plan(&store, layer, one_target(), &executor);
    assert_eq!(
        run(&store, &plan, &executor).err(),
        Some(ProjectError::PayloadStoreUnusable)
    );
    assert!(store.describe().runs.is_empty());
    assert_eq!(
        fs::read_dir(&store_dir).expect("store").count(),
        1,
        "nothing written into it"
    );
}

// ---------------------------------------------------------------------------
// The result store on open
// ---------------------------------------------------------------------------

fn saved_with_result(scratch: &Scratch) -> (ProjectStore, PathBuf, ArtifactId) {
    let (store, layer, document) = fake_project(scratch);
    let executor = Fake::new(completed);
    let plan = plan(&store, layer, one_target(), &executor);
    run(&store, &plan, &executor).expect("run");
    store.save().expect("save");
    let artifact = stored_result(&store);
    (store, document, artifact)
}

fn availability_on_open(document: &Path) -> (&'static str, bool, usize) {
    let reopened = ProjectStore::new();
    reopened.open_document(document, false).expect("open");
    let described = reopened.describe();
    (
        described.artifacts[0]
            .targeted_ms1
            .as_ref()
            .expect("result")
            .availability,
        described.result_store.store_found,
        described.result_store.unreferenced_results,
    )
}

#[test]
fn a_missing_or_damaged_result_is_reported_on_open_and_never_repaired() {
    let scratch = Scratch::new("m91-integrity");
    let (store, document, artifact) = saved_with_result(&scratch);
    assert_eq!(availability_on_open(&document), ("available", true, 0));
    let directory = payload::store_of(&document)
        .expect("store")
        .join(artifact.to_string());
    let target = store.describe().plans[0].targets[0].target_id;

    let evidence = directory.join("evidence.jsonl");
    let original = fs::read(&evidence).expect("read");
    fs::write(&evidence, &original[..original.len() - 3]).expect("truncate");
    assert_eq!(availability_on_open(&document).0, "payloadCorrupt");
    assert_eq!(
        store.read_targeted_ms1_evidence(artifact, target).err(),
        Some(ProjectError::PayloadUnavailable(Availability::Corrupt))
    );
    // Nothing was repaired or recomputed: the damaged bytes are still there.
    assert_eq!(fs::read(&evidence).expect("read").len(), original.len() - 3);

    fs::remove_file(&evidence).expect("remove");
    assert_eq!(availability_on_open(&document).0, "payloadMissing");
    assert_eq!(
        store.read_targeted_ms1_evidence(artifact, target).err(),
        Some(ProjectError::PayloadUnavailable(Availability::Missing))
    );
    fs::remove_dir_all(&directory).expect("remove the result");
    assert_eq!(availability_on_open(&document).0, "payloadMissing");
    assert_eq!(
        store.read_targeted_ms1_rows(artifact, 0).err(),
        Some(ProjectError::PayloadUnavailable(Availability::Missing))
    );
    // The record stays in history either way.
    let reopened = ProjectStore::new();
    reopened.open_document(&document, false).expect("open");
    assert_eq!(reopened.describe().runs[0].outcome, "completed");
}

#[test]
fn a_result_under_another_records_name_is_corrupt_rather_than_borrowed() {
    let scratch = Scratch::new("m91-borrowed");
    let (store, document, artifact) = saved_with_result(&scratch);
    let executor = Fake::new(completed);
    let layer: LayerId = store.describe().layers[0].id.parse().expect("layer");
    let second = plan(&store, layer, one_target(), &executor);
    let other = run(&store, &second, &executor)
        .expect("run")
        .artifact
        .expect("second result");
    store.save().expect("save");
    // Swap the two directories: each still whole, each under the wrong name.
    let root = payload::store_of(&document).expect("store");
    let (first_dir, second_dir, parked) = (
        root.join(artifact.to_string()),
        root.join(other.to_string()),
        root.join("parked"),
    );
    fs::rename(&first_dir, &parked).expect("park");
    fs::rename(&second_dir, &first_dir).expect("swap");
    fs::rename(&parked, &second_dir).expect("swap back");
    let reopened = ProjectStore::new();
    reopened.open_document(&document, false).expect("open");
    assert!(reopened.describe().artifacts.iter().all(|record| {
        record.targeted_ms1.as_ref().expect("result").availability == "payloadCorrupt"
    }));
}

#[test]
fn a_document_moved_away_from_its_store_reports_every_result_missing() {
    let scratch = Scratch::new("m91-detached");
    let (_, document, _) = saved_with_result(&scratch);
    let moved = scratch.join("moved/study.mscanvas");
    fs::create_dir_all(moved.parent().expect("parent")).expect("dir");
    fs::copy(&document, &moved).expect("copy the document alone");
    assert_eq!(availability_on_open(&moved), ("payloadMissing", false, 0));
}

#[test]
fn a_result_published_without_a_save_is_counted_as_unreferenced_and_kept() {
    let scratch = Scratch::new("m91-orphan");
    let (store, document, _) = saved_with_result(&scratch);
    let executor = Fake::new(completed);
    let layer: LayerId = store.describe().layers[0].id.parse().expect("layer");
    let second = plan(&store, layer, one_target(), &executor);
    let orphan = run(&store, &second, &executor)
        .expect("run")
        .artifact
        .expect("result");
    // The session ends here without a Save.
    drop(store);
    assert_eq!(availability_on_open(&document), ("available", true, 1));
    let root = payload::store_of(&document).expect("store");
    assert!(
        payload::is_plain_directory(&root.join(orphan.to_string())),
        "never deleted"
    );
}

// ---------------------------------------------------------------------------
// Save As
// ---------------------------------------------------------------------------

#[test]
fn save_as_copies_every_whole_result_and_keeps_every_identifier() {
    let scratch = Scratch::new("m91-save-as");
    let (store, document, artifact) = saved_with_result(&scratch);
    let before = store.describe();
    let copy = scratch.join("copy/study-copy.mscanvas");
    fs::create_dir_all(copy.parent().expect("parent")).expect("dir");
    store.save_as(&copy).expect("save as");
    let after = store.describe();
    assert_eq!(after.project_id, before.project_id);
    assert_eq!(after.runs[0].id, before.runs[0].id);
    assert_eq!(after.plans, before.plans);
    assert_eq!(
        after.artifacts[0]
            .targeted_ms1
            .as_ref()
            .expect("result")
            .availability,
        "available"
    );
    let copied_store = payload::store_of(&copy).expect("store");
    assert!(payload::is_plain_directory(
        &copied_store.join(artifact.to_string())
    ));
    assert_eq!(
        store
            .read_targeted_ms1_rows(artifact, 0)
            .expect("rows")
            .total,
        1
    );
    // The new document never points into the old store.
    let text = fs::read_to_string(&copy).expect("read");
    assert!(!text.contains("study.mscanvas.payloads"));
    assert_eq!(availability_on_open(&copy), ("available", true, 0));
    assert_eq!(availability_on_open(&document), ("available", true, 0));
}

#[test]
fn save_as_carries_an_unavailable_result_forward_as_unavailable() {
    let scratch = Scratch::new("m91-save-as-missing");
    let (store, document, artifact) = saved_with_result(&scratch);
    let root = payload::store_of(&document).expect("store");
    fs::remove_dir_all(root.join(artifact.to_string())).expect("lose the result");
    let copy = scratch.join("copy/study-copy.mscanvas");
    fs::create_dir_all(copy.parent().expect("parent")).expect("dir");
    store.save_as(&copy).expect("save as");
    // The record is carried, the result is not invented.
    assert_eq!(
        store.describe().artifacts[0]
            .targeted_ms1
            .as_ref()
            .expect("result")
            .availability,
        "payloadMissing"
    );
    assert!(
        !payload::store_of(&copy)
            .expect("store")
            .join(artifact.to_string())
            .exists()
    );
    assert_eq!(availability_on_open(&copy).0, "payloadMissing");
}

#[test]
fn save_as_does_not_copy_a_corrupt_result_into_a_whole_looking_one() {
    let scratch = Scratch::new("m91-save-as-corrupt");
    let (store, document, artifact) = saved_with_result(&scratch);
    let rows = payload::store_of(&document)
        .expect("store")
        .join(artifact.to_string())
        .join("rows.jsonl");
    fs::write(&rows, b"{}\n").expect("damage");
    let copy = scratch.join("copy/study-copy.mscanvas");
    fs::create_dir_all(copy.parent().expect("parent")).expect("dir");
    store.save_as(&copy).expect("save as");
    assert!(
        !payload::store_of(&copy)
            .expect("store")
            .join(artifact.to_string())
            .exists()
    );
    assert_eq!(availability_on_open(&copy).0, "payloadMissing");
}

#[test]
fn a_hard_link_to_the_document_under_another_name_gets_a_store_of_its_own() {
    let scratch = Scratch::new("m91-save-as-hard-link");
    let (store, document, artifact) = saved_with_result(&scratch);
    let alias = scratch.join("alias.mscanvas");
    fs::hard_link(&document, &alias).expect("hard link");
    store.save_as(&alias).expect("save as");
    // The results were copied beside the new name, not assumed to be there.
    let alias_store = payload::store_of(&alias).expect("store");
    assert!(payload::is_plain_directory(
        &alias_store.join(artifact.to_string())
    ));
    assert!(store.read_targeted_ms1_rows(artifact, 0).is_ok());
    assert_eq!(availability_on_open(&alias), ("available", true, 0));
}

#[test]
fn a_copy_that_does_not_arrive_whole_publishes_nothing_and_leaves_nothing() {
    let scratch = Scratch::new("m91-save-as-copy-fails");
    let (store, document, _) = saved_with_result(&scratch);
    let destination_dir = scratch.join("copy");
    fs::create_dir_all(&destination_dir).expect("dir");
    let copy = destination_dir.join("study-copy.mscanvas");
    let damaging = |from: &Path, to: &Path| -> std::io::Result<()> {
        fs::copy(from, to)?;
        if to.ends_with("rows.jsonl") {
            fs::write(to, b"{}\n")?;
        }
        Ok(())
    };
    let seams = SaveAsSeams {
        copy_file: &damaging,
        before_document: &|| Ok(()),
    };
    assert_eq!(
        store.save_as_with(&copy, &seams),
        Err(ProjectError::PayloadNotCopied)
    );
    assert_eq!(
        fs::read_dir(&destination_dir).expect("dir").count(),
        0,
        "no document, store or pending directory"
    );
    // Still bound where it was, and the original is untouched.
    store
        .save()
        .expect("the original is still this session's document");
    assert_eq!(availability_on_open(&document), ("available", true, 0));
}

#[test]
fn a_document_publish_that_fails_after_the_store_leaves_a_whole_store_and_no_document() {
    let scratch = Scratch::new("m91-save-as-document-fails");
    let (store, document, artifact) = saved_with_result(&scratch);
    let copy = scratch.join("copy/study-copy.mscanvas");
    fs::create_dir_all(copy.parent().expect("parent")).expect("dir");
    let seams = SaveAsSeams {
        copy_file: &payload::plain_copy,
        before_document: &|| Err(ProjectError::NotPublished),
    };
    assert_eq!(
        store.save_as_with(&copy, &seams),
        Err(ProjectError::NotPublished)
    );
    assert!(!copy.exists(), "no document");
    let copied_store = payload::store_of(&copy).expect("store");
    // The store is whole and nobody references it: reported, not undone.
    let reference = store.describe().artifacts[0]
        .targeted_ms1
        .clone()
        .expect("result")
        .result
        .payload;
    assert_eq!(
        payload::observe(&copied_store, artifact, &reference),
        Availability::Available
    );
    // The session is still bound to the original, which is untouched.
    store.save().expect("save in place");
    assert_eq!(availability_on_open(&document), ("available", true, 0));
    // A second Save As to the same name is refused rather than merged.
    assert_eq!(
        store.save_as(&copy),
        Err(ProjectError::DestinationStoreExists)
    );
}

#[test]
fn an_existing_store_at_the_destination_is_refused_and_kept() {
    let scratch = Scratch::new("m91-save-as-existing-store");
    let (store, _, _) = saved_with_result(&scratch);
    let copy = scratch.join("copy/study-copy.mscanvas");
    let existing = payload::store_of(&copy).expect("store");
    fs::create_dir_all(&existing).expect("dir");
    fs::write(existing.join("keep.txt"), b"someone's").expect("write");
    assert_eq!(
        store.save_as(&copy),
        Err(ProjectError::DestinationStoreExists)
    );
    assert_eq!(
        fs::read(existing.join("keep.txt")).expect("kept"),
        b"someone's"
    );
    assert!(!copy.exists());
}

#[test]
fn save_as_over_the_bound_document_keeps_its_own_store() {
    let scratch = Scratch::new("m91-save-as-self");
    let (store, document, artifact) = saved_with_result(&scratch);
    store.save_as(&document).expect("save as the same document");
    assert_eq!(
        store
            .read_targeted_ms1_rows(artifact, 0)
            .expect("rows")
            .total,
        1
    );
    assert_eq!(availability_on_open(&document), ("available", true, 0));
}

// ---------------------------------------------------------------------------
// The schema
// ---------------------------------------------------------------------------

#[test]
fn every_targeted_record_survives_a_save_and_reopen_unchanged() {
    let scratch = Scratch::new("m91-roundtrip");
    let (store, layer, document) = fake_project(&scratch);
    let plan_completed = plan(&store, layer, one_target(), &Fake::new(completed));
    run(&store, &plan_completed, &Fake::new(completed)).expect("completed");
    let failing = Fake::new(failed_with(
        FailureCode::SourceReadIncomplete,
        FailureStage::Source,
    ));
    let plan_failed = plan(&store, layer, one_target(), &failing);
    run(&store, &plan_failed, &failing).expect("failed");
    store.save().expect("save");
    let before = store.describe();
    let reopened = ProjectStore::new();
    reopened.open_document(&document, false).expect("open");
    let after = reopened.describe();
    assert_eq!(after.plans, before.plans);
    assert_eq!(
        after
            .runs
            .iter()
            .map(|run| (&run.id, &run.targeted_ms1))
            .collect::<Vec<_>>(),
        before
            .runs
            .iter()
            .map(|run| (&run.id, &run.targeted_ms1))
            .collect::<Vec<_>>()
    );
    assert_eq!(after.artifacts[0].id, before.artifacts[0].id);
    assert_eq!(
        after.artifacts[0]
            .targeted_ms1
            .as_ref()
            .map(|result| &result.result),
        before.artifacts[0]
            .targeted_ms1
            .as_ref()
            .map(|result| &result.result)
    );
    // No session fact reaches the document.
    let lowered = fs::read_to_string(&document)
        .expect("read")
        .to_ascii_lowercase();
    for forbidden in ["dataset", "handle", "identity", "volume", "fileid"] {
        assert!(
            !lowered.contains(forbidden),
            "the document must not carry {forbidden:?}"
        );
    }
}

/// Edits the saved JSON of a project with one completed targeted run, and
/// answers what the reader makes of it.
fn reread_after(edit: impl FnOnce(&mut serde_json::Value)) -> Result<(), record::DocumentProblem> {
    let scratch = Scratch::new("m91-edit");
    let (store, layer, document) = fake_project(&scratch);
    let executor = Fake::new(completed);
    let plan = plan(&store, layer, one_target(), &executor);
    run(&store, &plan, &executor).expect("run");
    store.save().expect("save");
    let mut value = document_json(&document);
    edit(&mut value);
    record::parse(serde_json::to_vec(&value).expect("bytes").as_slice()).map(|_| ())
}

#[test]
fn a_schema_three_document_is_refused_as_unsupported_and_not_migrated() {
    // The shape M8.5 wrote: no plans, and runs without the targeted block.
    let schema_three = serde_json::json!({
        "schemaVersion": 3,
        "projectId": "3f6c2d9e-5b1a-4c8e-9f2d-7a1b0c4e5d6f",
        "revision": 2,
        "name": "An M8 project",
        "inputs": [],
        "artifacts": [],
        "runs": [],
        "layers": []
    });
    assert_eq!(
        record::parse(serde_json::to_vec(&schema_three).expect("bytes").as_slice()),
        Err(record::DocumentProblem::UnsupportedVersion)
    );
    let mut future = schema_three;
    future["schemaVersion"] = serde_json::json!(record::SCHEMA_VERSION + 1);
    assert_eq!(
        record::parse(serde_json::to_vec(&future).expect("bytes").as_slice()),
        Err(record::DocumentProblem::UnsupportedVersion)
    );
}

type Edit = Box<dyn FnOnce(&mut serde_json::Value)>;

#[test]
fn unknown_kinds_codes_and_fields_in_targeted_records_are_refused() {
    assert_eq!(
        reread_after(|_| {}),
        Ok(()),
        "the unedited document is accepted"
    );
    let refusals: Vec<(&str, Edit)> = vec![
        (
            "operation",
            Box::new(|value| value["runs"][0]["operation"] = "targetedMs2V1".into()),
        ),
        (
            "payload kind",
            Box::new(|value| {
                value["artifacts"][0]["payload"]["kind"] = "targetedMs1ResultV2".into();
            }),
        ),
        (
            "failure code",
            Box::new(|value| {
                value["runs"][0]["outcome"] = "failed".into();
                value["runs"][0]["outputArtifactIds"] = serde_json::json!([]);
                value["artifacts"] = serde_json::json!([]);
                value["runs"][0]["targetedMs1"]["failure"] =
                    serde_json::json!({"code": "somethingNew", "stage": "engine"});
            }),
        ),
        (
            "execution field",
            Box::new(|value| value["runs"][0]["targetedMs1"]["extra"] = true.into()),
        ),
        (
            "omitted block",
            Box::new(|value| {
                value["runs"][0]
                    .as_object_mut()
                    .expect("run")
                    .remove("targetedMs1");
            }),
        ),
        (
            "payload file name",
            Box::new(|value| {
                value["artifacts"][0]["payload"]["payload"]["files"][0]["name"] = "rows.csv".into();
            }),
        ),
    ];
    for (name, edit) in refusals {
        assert_eq!(
            reread_after(edit),
            Err(record::DocumentProblem::Malformed),
            "{name}"
        );
    }
}

#[test]
fn a_plan_that_no_longer_matches_its_name_or_its_run_is_refused() {
    use record::DocumentProblem::{DanglingReference, InconsistentRecord};
    let cases: Vec<(&str, Edit, record::DocumentProblem)> = vec![
        (
            "edited target",
            Box::new(|value| value["plans"][0]["targets"][0]["rtS"] = "61".into()),
            InconsistentRecord,
        ),
        (
            "edited parameter",
            Box::new(|value| {
                value["plans"][0]["parameters"]["mzHalfWidthPpm"] = "6".into();
            }),
            InconsistentRecord,
        ),
        (
            "unexecuted plan",
            Box::new(|value| {
                let mut extra = value["plans"][0].clone();
                extra["planSha256"] = "B".repeat(64).into();
                value["plans"].as_array_mut().expect("plans").push(extra);
            }),
            InconsistentRecord,
        ),
        (
            "missing plan",
            Box::new(|value| value["plans"] = serde_json::json!([])),
            DanglingReference,
        ),
        (
            "consumed differs",
            Box::new(|value| {
                value["runs"][0]["targetedMs1"]["consumedContent"][0]["sha256"] =
                    "D".repeat(64).into();
            }),
            InconsistentRecord,
        ),
        (
            "unclaimed result",
            Box::new(|value| {
                value["runs"][0]["outcome"] = "failed".into();
                value["runs"][0]["outputArtifactIds"] = serde_json::json!([]);
                value["runs"][0]["targetedMs1"]["failure"] =
                    serde_json::json!({"code": "engineError", "stage": "engine"});
            }),
            InconsistentRecord,
        ),
        (
            "summary that does not add up",
            Box::new(|value| {
                value["artifacts"][0]["payload"]["summary"]["notDetected"] = 5.into();
            }),
            InconsistentRecord,
        ),
        (
            "completed with a failure",
            Box::new(|value| {
                value["runs"][0]["targetedMs1"]["failure"] =
                    serde_json::json!({"code": "engineError", "stage": "engine"});
            }),
            InconsistentRecord,
        ),
    ];
    for (name, edit, expected) in cases {
        assert_eq!(reread_after(edit), Err(expected), "{name}");
    }
}

#[test]
fn a_saved_plan_bound_to_another_recipe_is_history_but_not_executed_by_this_build() {
    let scratch = Scratch::new("m91-other-recipe");
    let (store, layer, document) = fake_project(&scratch);
    let executor = Fake::new(completed);
    let plan = plan(&store, layer, one_target(), &executor);
    run(&store, &plan, &executor).expect("run");
    store.save().expect("save");
    // A document recorded by a build whose adapter differed.
    let mut value = document_json(&document);
    let mut edited = plan.clone();
    edited.recipe.adapter_sha256 = "E".repeat(64);
    edited.target_list_sha256 = record::target_list_digest(&edited.targets).expect("digest");
    edited.plan_sha256 = record::plan_digest(&edited).expect("digest");
    value["plans"][0] = serde_json::to_value(&edited).expect("plan");
    value["runs"][0]["targetedMs1"]["planSha256"] = edited.plan_sha256.clone().into();
    fs::write(&document, serde_json::to_vec_pretty(&value).expect("bytes")).expect("write");
    let reopened = ProjectStore::new();
    reopened
        .open_document(&document, false)
        .expect("a readable history");
    let job = reopened.accept_job().expect("accept");
    assert_eq!(
        reopened
            .run_targeted_ms1(job, &edited.plan_sha256, &executor)
            .err(),
        Some(ProjectError::PlanNotCurrent)
    );
}

// ---------------------------------------------------------------------------
// The supervisor's own checks, without a process
// ---------------------------------------------------------------------------

fn resolved_for_checks(scratch: &Scratch, targets: usize) -> TargetedMs1Plan {
    let (store, layer, _) = fake_project(scratch);
    plan(
        &store,
        layer,
        (0..targets)
            .map(|index| target(&format!("t{index}"), CAFFEINE, "60", "20"))
            .collect(),
        &Fake::new(completed),
    )
}

#[test]
fn a_payload_is_accepted_only_when_every_row_says_what_its_outcome_requires() {
    let scratch = Scratch::new("m91-checks");
    let plan = resolved_for_checks(&scratch, 2);
    let (rows, evidence) = synthetic_payload(&plan);
    assert!(
        validate_payload(&plan, &rows, &evidence, false).is_some(),
        "the control is valid"
    );
    let rows_text = String::from_utf8(rows.clone()).expect("utf-8");
    let first = rows_text.lines().next().expect("row");
    let second = rows_text.lines().nth(1).expect("row");
    let with = |row: &str| format!("{row}\n{second}\n").into_bytes();
    let refused = [
        // An absence with a candidate is not an absence.
        with(&first.replace(
            "\"candidates\":[]",
            "\"candidates\":[{\"apexRtS\":60.0,\"leftS\":55.0,\"rightS\":65.0,\"rawArea\":10.0}]",
        )),
        // A detection with no feature is not a detection.
        with(&first.replace("NOT_DETECTED", "DETECTED")),
        // A failure without a reason, and a reason without a failure.
        with(&first.replace("NOT_DETECTED", "FAILED")),
        with(&first.replace(
            "\"failureReason\":null",
            "\"failureReason\":\"TARGET_UNACCOUNTED\"",
        )),
        // A signal summary that contradicts itself.
        with(&first.replace("\"anyNonzeroPoint\":false", "\"anyNonzeroPoint\":true")),
        // Rows out of order, and one missing.
        format!("{second}\n{first}\n").into_bytes(),
        format!("{first}\n").into_bytes(),
        // A recovery flag the run did not report.
        with(&first.replace(
            "\"recoveredFromEmptySelection\":false",
            "\"recoveredFromEmptySelection\":true",
        )),
        // A field this build does not know -- the engine's mass error, which
        // M9.0 showed an out-of-window peak can move.
        with(&first.replace(
            "\"overlapWinner\":false",
            "\"overlapWinner\":false,\"massErrorPpm\":7.4",
        )),
    ];
    for (index, rows) in refused.iter().enumerate() {
        assert!(
            validate_payload(&plan, rows, &evidence, false).is_none(),
            "case {index}"
        );
    }
    // An absence over a window no spectrum fell into is a claim about
    // nothing. The same row is accepted only as the failure that says so, and
    // that failure is refused where spectra were visited.
    let first_id = plan.targets[0].target_id.to_string();
    let empty_evidence: String = String::from_utf8(evidence.clone())
        .expect("utf-8")
        .lines()
        .map(|line| {
            let line = if line.contains(&first_id) {
                line.replace("[[80,40.0,0.0],[81,40.5,0.0]]", "[]")
            } else {
                line.to_owned()
            };
            line + "\n"
        })
        .collect();
    let empty = first.replace("\"points\":2", "\"points\":0");
    assert!(validate_payload(&plan, &with(&empty), empty_evidence.as_bytes(), false).is_none());
    let as_failure = |row: &str| {
        row.replace(
            "\"outcome\":\"NOT_DETECTED\",\"failureReason\":null",
            "\"outcome\":\"FAILED\",\"failureReason\":\"WINDOW_WITHOUT_MS1_PEAKS\"",
        )
    };
    assert!(
        validate_payload(
            &plan,
            &with(&as_failure(&empty)),
            empty_evidence.as_bytes(),
            false
        )
        .is_some()
    );
    assert!(validate_payload(&plan, &with(&as_failure(first)), &evidence, false).is_none());

    // Evidence that does not match its row's signal.
    let short = String::from_utf8(evidence)
        .expect("utf-8")
        .replacen(",[81,40.5,0.0]", "", 1);
    assert!(validate_payload(&plan, &rows, short.as_bytes(), false).is_none());
}

#[test]
fn a_runtime_file_changed_added_or_missing_is_refused() {
    let scratch = Scratch::new("m91-runtime");
    let runtime = scratch.join("runtime");
    fs::create_dir_all(runtime.join("site-packages")).expect("dir");
    fs::write(runtime.join("python.exe"), b"interpreter").expect("write");
    fs::write(runtime.join("site-packages/module.py"), b"module").expect("write");
    let digest = |bytes: &[u8]| {
        mscanvas_proteowizard::Sha256Digest::calculate(bytes)
            .expect("digest")
            .to_string()
    };
    let manifest_bytes = format!(
        "{{\"schema\":\"mscanvas.analysisRuntimeManifest/1\",\"runtime\":\"test\",\"files\":[\
{{\"path\":\"python.exe\",\"bytes\":11,\"sha256\":\"{}\",\"provenance\":\"embedZip\"}},\
{{\"path\":\"site-packages/module.py\",\"bytes\":6,\"sha256\":\"{}\",\"provenance\":\"wheel\"}}]}}",
        digest(b"interpreter"),
        digest(b"module")
    );
    let manifest = scratch.write("manifest.json", manifest_bytes.as_bytes());
    let pinned = digest(manifest_bytes.as_bytes());
    let verified = verify_runtime(&runtime, &manifest, &pinned).expect("the control verifies");
    assert_eq!(verified.get("python.exe"), Some(&digest(b"interpreter")));
    assert!(
        verify_runtime(&runtime, &manifest, &"0".repeat(64)).is_err(),
        "another manifest"
    );
    fs::write(runtime.join("site-packages/planted.pyd"), b"x").expect("plant");
    assert!(
        verify_runtime(&runtime, &manifest, &pinned).is_err(),
        "a planted file"
    );
    fs::remove_file(runtime.join("site-packages/planted.pyd")).expect("remove");
    fs::create_dir(runtime.join("__pycache__")).expect("dir");
    fs::write(runtime.join("__pycache__/module.cpython-313.pyc"), b"x").expect("bytecode");
    assert!(
        verify_runtime(&runtime, &manifest, &pinned).is_err(),
        "written bytecode"
    );
    fs::remove_dir_all(runtime.join("__pycache__")).expect("remove");
    fs::write(runtime.join("site-packages/module.py"), b"modulE").expect("change");
    assert!(
        verify_runtime(&runtime, &manifest, &pinned).is_err(),
        "a changed file"
    );
    fs::remove_file(runtime.join("site-packages/module.py")).expect("remove");
    assert!(
        verify_runtime(&runtime, &manifest, &pinned).is_err(),
        "a missing file"
    );
}

#[test]
fn the_worker_vocabulary_maps_onto_closed_codes_and_nothing_else() {
    use super::worker_failure;
    assert_eq!(
        worker_failure("SOURCE_READ_INCOMPLETE"),
        (FailureCode::SourceReadIncomplete, FailureStage::Source)
    );
    assert_eq!(
        worker_failure("ENGINE_NO_CANDIDATES"),
        (FailureCode::EngineNoCandidates, FailureStage::Engine)
    );
    assert_eq!(
        worker_failure("SOURCE_RT_NOT_STRICTLY_INCREASING").0,
        FailureCode::SourceRtNotStrictlyIncreasing
    );
    // A code this build does not know is not repeated into the record.
    assert_eq!(
        worker_failure("SOMETHING_NEW"),
        (FailureCode::ResultInvalid, FailureStage::Result)
    );
}

#[test]
fn a_row_page_and_an_evidence_read_are_bounded_and_checked() {
    let scratch = Scratch::new("m91-bounded");
    let (store, layer, _) = fake_project(&scratch);
    let executor = Fake::new(completed);
    let targets: Vec<TargetDraft> = (0..200)
        .map(|index| target(&format!("t{index}"), CAFFEINE, "60", "20"))
        .collect();
    let plan = plan(&store, layer, targets, &executor);
    let artifact = run(&store, &plan, &executor)
        .expect("run")
        .artifact
        .expect("result");
    let page = store.read_targeted_ms1_rows(artifact, 150).expect("page");
    assert_eq!((page.total, page.offset, page.rows.len()), (200, 150, 50));
    assert_eq!(page.rows[0].target_id, plan.targets[150].target_id);
    let evidence = store
        .read_targeted_ms1_evidence(artifact, plan.targets[7].target_id)
        .expect("one target's evidence");
    assert_eq!(evidence.len(), 2);
    assert!(
        evidence
            .iter()
            .all(|line| line.target_id == plan.targets[7].target_id)
    );
    assert_eq!(
        store
            .read_targeted_ms1_evidence(artifact, record::TargetId::new())
            .err(),
        Some(ProjectError::UnknownRecord)
    );
}

// ---------------------------------------------------------------------------
// The real engine, through the store
// ---------------------------------------------------------------------------

/// A saved project in the work area over `scans` written as mzML.
fn real_project(area: &WorkArea, name: &str, bytes: &[u8]) -> (ProjectStore, LayerId, PathBuf) {
    let source = area.write(&format!("data/{name}"), bytes);
    let document = area.join("study.mscanvas");
    let (store, _, layer) = project_over(&document, &source);
    (store, layer, source)
}

fn rows_of(store: &ProjectStore, artifact: ArtifactId) -> Vec<payload::PayloadRow> {
    store
        .read_targeted_ms1_rows(artifact, 0)
        .expect("rows")
        .rows
}

fn failure_of(store: &ProjectStore) -> Option<RunFailure> {
    store
        .describe()
        .runs
        .last()
        .and_then(|run| run.targeted_ms1.as_ref())
        .and_then(|block| block.failure)
}

#[test]
#[ignore = "runs the pinned runtime under .tmp/m91-runtime"]
fn an_all_absent_batch_is_a_completed_run_of_absences_through_the_measured_recovery() {
    let area = WorkArea::new("all-absent");
    let (store, layer, _) = real_project(&area, "plain.mzML", &mzml(&plain(), ""));
    let supervisor = real();
    let plan = plan(
        &store,
        layer,
        vec![
            target("paracetamol", PARACETAMOL, "60", "20"),
            target("adenine", ADENINE, "40", "10"),
            target("tyrosine", TYROSINE, "80", "10"),
        ],
        &supervisor,
    );
    let end = run(&store, &plan, &supervisor).expect("recorded");
    assert_eq!(
        end.outcome,
        TerminalOutcome::Completed,
        "{:?}",
        failure_of(&store)
    );
    let artifact = end.artifact.expect("result");
    let described = store.describe();
    let result = &described.artifacts[0]
        .targeted_ms1
        .as_ref()
        .expect("result")
        .result;
    assert!(
        result.no_candidate_recovery,
        "the run says which path produced its absences"
    );
    assert_eq!(result.summary.not_detected, 3);
    for (row, target) in rows_of(&store, artifact).iter().zip(&plan.targets) {
        assert_eq!(row.outcome, RowOutcome::NotDetected);
        assert!(row.recovered_from_empty_selection);
        assert!(row.candidates.is_empty());
        // The window was really extracted, and held nothing.
        let signal = row.signal.as_ref().expect("signal");
        assert!(signal.points > 0);
        assert!(!signal.any_nonzero_point);
        let evidence = store
            .read_targeted_ms1_evidence(artifact, target.target_id)
            .expect("evidence");
        assert_eq!(evidence.len(), 2);
        assert!(
            evidence
                .iter()
                .all(|line| line.points.len() == signal.points as usize)
        );
    }
}

#[test]
#[ignore = "runs the pinned runtime under .tmp/m91-runtime"]
fn a_window_beyond_the_last_ms1_spectrum_fails_its_row_and_leaves_the_others() {
    // The source ends at 120 s. A retention time typed in the wrong unit puts
    // a window where nothing was measured, which is not an absence.
    let area = WorkArea::new("beyond-the-run");
    let (store, layer, _) = real_project(&area, "plain.mzML", &mzml(&plain(), ""));
    let supervisor = real();
    let plan = plan(
        &store,
        layer,
        vec![
            target("caffeine", CAFFEINE, "60", "20"),
            target("adenine", ADENINE, "500", "20"),
        ],
        &supervisor,
    );
    let end = run(&store, &plan, &supervisor).expect("recorded");
    assert_eq!(
        end.outcome,
        TerminalOutcome::Completed,
        "{:?}",
        failure_of(&store)
    );
    let artifact = end.artifact.expect("result");
    let rows = rows_of(&store, artifact);
    assert_eq!(rows[0].outcome, RowOutcome::Detected);
    assert_eq!(rows[1].outcome, RowOutcome::Failed);
    assert_eq!(
        rows[1].failure_reason,
        Some(payload::RowFailure::WindowWithoutMs1Peaks)
    );
    assert_eq!(rows[1].signal.as_ref().expect("signal").points, 0);
    // Its evidence reads back as two traces with nothing in them.
    let evidence = store
        .read_targeted_ms1_evidence(artifact, plan.targets[1].target_id)
        .expect("evidence");
    assert_eq!(evidence.len(), 2);
    assert!(evidence.iter().all(|line| line.points.is_empty()));
    let described = store.describe();
    let summary = &described.artifacts[0]
        .targeted_ms1
        .as_ref()
        .expect("result")
        .result
        .summary;
    assert_eq!((summary.not_detected, summary.failed), (0, 1));
}

#[test]
#[ignore = "runs the pinned runtime under .tmp/m91-runtime"]
fn a_batch_whose_every_window_is_beyond_the_run_reports_no_absence() {
    let area = WorkArea::new("all-beyond");
    let (store, layer, _) = real_project(&area, "plain.mzML", &mzml(&plain(), ""));
    let supervisor = real();
    let plan = plan(
        &store,
        layer,
        vec![
            target("paracetamol", PARACETAMOL, "500", "20"),
            target("adenine", ADENINE, "600", "20"),
        ],
        &supervisor,
    );
    let end = run(&store, &plan, &supervisor).expect("recorded");
    // Whatever the engine does with nothing to extract, no row may say absent.
    match end.outcome {
        TerminalOutcome::Completed => {
            for row in rows_of(&store, end.artifact.expect("result")) {
                assert_eq!(row.outcome, RowOutcome::Failed, "{row:?}");
                assert_eq!(
                    row.failure_reason,
                    Some(payload::RowFailure::WindowWithoutMs1Peaks)
                );
            }
        }
        TerminalOutcome::Failed => assert!(end.artifact.is_none()),
        TerminalOutcome::Cancelled => panic!("nothing cancelled this run"),
    }
    // Which of the two the engine took, for the evidence record.
    let recovery = store.describe().artifacts.first().and_then(|artifact| {
        artifact
            .targeted_ms1
            .as_ref()
            .map(|block| block.result.no_candidate_recovery)
    });
    eprintln!(
        "all-beyond: {:?} {:?} recovery={recovery:?}",
        end.outcome,
        failure_of(&store)
    );
}

#[test]
#[ignore = "runs the pinned runtime under .tmp/m91-runtime"]
fn a_namespace_prefixed_mzml_fails_closed_and_is_never_rewritten() {
    let area = WorkArea::new("prefixed");
    let bytes = mzml(&plain(), "ms");
    let (store, layer, source) = real_project(&area, "prefixed.mzML", &bytes);
    let supervisor = real();
    let plan = plan(
        &store,
        layer,
        vec![target("caffeine", CAFFEINE, "60", "20")],
        &supervisor,
    );
    let end = run(&store, &plan, &supervisor).expect("recorded");
    assert_eq!(end.outcome, TerminalOutcome::Failed);
    assert_eq!(
        failure_of(&store),
        Some(RunFailure {
            code: FailureCode::SourceReadIncomplete,
            stage: FailureStage::Source,
        })
    );
    // Never an absence, and the source is exactly what it was.
    assert!(store.describe().artifacts.is_empty());
    assert_eq!(fs::read(&source).expect("source"), bytes);
}

#[test]
#[ignore = "runs the pinned runtime under .tmp/m91-runtime"]
fn a_truncated_or_non_mzml_source_fails_and_publishes_nothing() {
    let supervisor = real();
    let whole = mzml(&plain(), "");
    for (name, bytes) in [
        ("truncated.mzML", whole[..whole.len() * 55 / 100].to_vec()),
        ("not.mzML", b"this is not an mzML document\n".to_vec()),
    ] {
        let area = WorkArea::new("unreadable");
        let (store, layer, _) = real_project(&area, name, &bytes);
        let plan = plan(
            &store,
            layer,
            vec![target("caffeine", CAFFEINE, "60", "20")],
            &supervisor,
        );
        let end = run(&store, &plan, &supervisor).expect("recorded");
        assert_eq!(end.outcome, TerminalOutcome::Failed, "{name}");
        assert_eq!(
            failure_of(&store).map(|failure| failure.code),
            Some(FailureCode::SourceUnreadable),
            "{name}"
        );
        assert!(store.describe().artifacts.is_empty(), "{name}");
    }
}

#[test]
#[ignore = "runs the pinned runtime under .tmp/m91-runtime"]
fn a_target_sharing_with_an_edge_flagged_partner_fails_rather_than_standing_as_shared() {
    let area = WorkArea::new("edge");
    let (store, layer, _) = real_project(&area, "edge.mzML", &mzml(&edge(), ""));
    let supervisor = real();
    // Both see the whole peak at 60 s; only `wide` reaches the defective
    // spectra at 82-88 s.
    let plan = plan(
        &store,
        layer,
        vec![
            target("narrow", CAFFEINE, "60", "20"),
            target("wide", CAFFEINE, "60", "30"),
        ],
        &supervisor,
    );
    let end = run(&store, &plan, &supervisor).expect("recorded");
    assert_eq!(
        end.outcome,
        TerminalOutcome::Completed,
        "{:?}",
        failure_of(&store)
    );
    let rows = rows_of(&store, end.artifact.expect("result"));
    assert_eq!(rows[1].outcome, RowOutcome::Failed);
    assert_eq!(
        rows[1].failure_reason,
        Some(payload::RowFailure::ExtractionAtSpectrumEdge)
    );
    assert!(rows[1].edge_trace_count > 0);
    // Without the rule `narrow` would be SHARED with `wide`.
    assert_eq!(rows[0].outcome, RowOutcome::Failed);
    assert_eq!(
        rows[0].failure_reason,
        Some(payload::RowFailure::RelatedTargetAtSpectrumEdge)
    );
    assert_eq!(
        rows[0].relations.shared_with,
        vec![plan.targets[1].target_id]
    );
    assert!(rows.iter().all(|row| row.feature.is_none()));
}

#[test]
#[ignore = "runs the pinned runtime under .tmp/m91-runtime"]
fn with_no_valid_fit_in_the_run_the_row_fails_and_a_valid_partner_changes_that() {
    let area = WorkArea::new("no-valid-fit");
    let (store, layer, _) = real_project(&area, "two.mzML", &mzml(&two_peaks(), ""));
    let supervisor = real();
    // The window ends 2 s after the caffeine apex: its fit is invalid.
    let cut = target("cut", CAFFEINE, "51", "11");
    let alone = plan(&store, layer, vec![cut.clone()], &supervisor);
    let end = run(&store, &alone, &supervisor).expect("recorded");
    assert_eq!(
        end.outcome,
        TerminalOutcome::Completed,
        "{:?}",
        failure_of(&store)
    );
    let rows = rows_of(&store, end.artifact.expect("result"));
    assert_eq!(rows[0].outcome, RowOutcome::Failed);
    assert_eq!(
        rows[0].failure_reason,
        Some(payload::RowFailure::EngineDiscardedNoValidFit)
    );
    assert_eq!(
        rows[0].candidates.len(),
        1,
        "a candidate existed; this is not an absence"
    );

    // The same peak beside a validly fitting partner survives, imputed.
    let with_partner = plan(
        &store,
        layer,
        vec![cut, target("partner", PHENYLALANINE, "100", "15")],
        &supervisor,
    );
    let end = run(&store, &with_partner, &supervisor).expect("recorded");
    let rows = rows_of(&store, end.artifact.expect("result"));
    assert_eq!(rows[0].outcome, RowOutcome::Detected);
    let feature = rows[0].feature.as_ref().expect("feature");
    assert!(
        !feature.model_status.starts_with('0'),
        "{}",
        feature.model_status
    );
    assert_eq!(
        feature.engine_intensity_source,
        payload::IntensitySource::ImputedFromRunRegression
    );
    assert_eq!(rows[1].outcome, RowOutcome::Detected);
    eprintln!(
        "no-valid-fit: alone -> FAILED ENGINE_DISCARDED_NO_VALID_FIT; with partner -> DETECTED, model status {:?}",
        feature.model_status
    );
}

/// The largest relative difference between two numbers, zero where both are
/// zero.
fn relative(left: f64, right: f64) -> f64 {
    if left == right {
        0.0
    } else {
        (left - right).abs() / left.abs().max(right.abs())
    }
}

#[test]
#[ignore = "runs the pinned runtime under .tmp/m91-runtime"]
fn a_repeated_run_is_categorically_identical_and_numerically_within_the_declared_tolerance() {
    let area = WorkArea::new("repeat");
    let (store, layer, _) = real_project(&area, "plain.mzML", &mzml(&plain(), ""));
    let supervisor = real();
    let plan = plan(
        &store,
        layer,
        vec![
            target("caffeine", CAFFEINE, "60", "20"),
            target("paracetamol", PARACETAMOL, "60", "20"),
        ],
        &supervisor,
    );
    let first = run(&store, &plan, &supervisor)
        .expect("first")
        .artifact
        .expect("result");
    let second = run(&store, &plan, &supervisor)
        .expect("second")
        .artifact
        .expect("result");
    let (left, right) = (rows_of(&store, first), rows_of(&store, second));
    let (mut raw_area, mut engine_intensity, mut evidence_worst, mut ion_worst) =
        (0.0_f64, 0.0_f64, 0.0_f64, 0.0_f64);
    for (a, b) in left.iter().zip(&right) {
        // Categorical: identical, or the run is not reproducible.
        assert_eq!(a.target_id, b.target_id);
        assert_eq!(a.outcome, b.outcome);
        assert_eq!(a.failure_reason, b.failure_reason);
        assert_eq!(a.candidates.len(), b.candidates.len());
        assert_eq!(a.relations, b.relations);
        assert_eq!(a.feature.is_some(), b.feature.is_some());
        if let (Some(fa), Some(fb)) = (&a.feature, &b.feature) {
            assert_eq!(
                (fa.apex_rt_s, fa.left_s, fa.right_s),
                (fb.apex_rt_s, fb.left_s, fb.right_s)
            );
            assert_eq!(fa.model_status, fb.model_status);
            raw_area = raw_area.max(relative(fa.raw_area, fb.raw_area));
            if let (Some(ia), Some(ib)) = (fa.engine_intensity, fb.engine_intensity) {
                engine_intensity = engine_intensity.max(relative(ia, ib));
            }
        }
        let (ia, ib) = (a.ion.as_ref().expect("ion"), b.ion.as_ref().expect("ion"));
        for (x, y) in ia.mz_theoretical.iter().zip(&ib.mz_theoretical) {
            ion_worst = ion_worst.max(relative(*x, *y));
        }
        for target in &plan.targets {
            let ea = store
                .read_targeted_ms1_evidence(first, target.target_id)
                .expect("evidence");
            let eb = store
                .read_targeted_ms1_evidence(second, target.target_id)
                .expect("evidence");
            for (la, lb) in ea.iter().zip(&eb) {
                assert_eq!(la.points.len(), lb.points.len());
                for (pa, pb) in la.points.iter().zip(&lb.points) {
                    assert_eq!(
                        (pa.0, pa.1),
                        (pb.0, pb.1),
                        "the same spectra at the same times"
                    );
                    evidence_worst = evidence_worst.max(relative(pa.2, pb.2));
                }
            }
        }
    }
    eprintln!(
        "repeat: raw area {raw_area:e}, engine intensity {engine_intensity:e} (no claim), evidence {evidence_worst:e}, theoretical m/z {ion_worst:e}"
    );
    // The declared numeric contract (see the M9.1 record).
    assert!(raw_area <= 1e-6, "raw area moved by {raw_area:e}");
    assert!(
        evidence_worst <= 1e-9,
        "evidence moved by {evidence_worst:e}"
    );
    assert!(ion_worst <= 1e-12, "theoretical m/z moved by {ion_worst:e}");
}

#[test]
#[ignore = "runs the pinned runtime under .tmp/m91-runtime"]
fn a_source_under_a_non_ascii_path_is_read_through_its_ascii_link() {
    let area = WorkArea::new("non-ascii");
    let (store, layer, source) =
        real_project(&area, "数据 目录/样品 plain.mzML", &mzml(&plain(), ""));
    assert!(!source.to_str().expect("utf-8").is_ascii());
    let supervisor = real();
    let plan = plan(
        &store,
        layer,
        vec![target("caffeine", CAFFEINE, "60", "20")],
        &supervisor,
    );
    let end = run(&store, &plan, &supervisor).expect("recorded");
    assert_eq!(
        end.outcome,
        TerminalOutcome::Completed,
        "{:?}",
        failure_of(&store)
    );
    assert_eq!(
        rows_of(&store, end.artifact.expect("result"))[0].outcome,
        RowOutcome::Detected
    );
    // The link is gone and the source is where it was.
    assert!(source.is_file());
}

#[test]
#[ignore = "runs the pinned runtime under .tmp/m91-runtime"]
fn a_project_under_a_non_ascii_path_stores_reopens_and_copies_its_result() {
    // The worker never sees the project's path: it writes into the ASCII job
    // root, and only Rust touches the store beside the document.
    let area = WorkArea::new("non-ascii-project");
    let source = area.write("data/plain.mzML", &mzml(&plain(), ""));
    let document = area.join("项目 目录/研究 study.mscanvas");
    fs::create_dir_all(document.parent().expect("parent")).expect("dir");
    let (store, _, layer) = project_over(&document, &source);
    let supervisor = real();
    let plan = plan(
        &store,
        layer,
        vec![target("caffeine", CAFFEINE, "60", "20")],
        &supervisor,
    );
    let end = run(&store, &plan, &supervisor).expect("recorded");
    assert_eq!(
        end.outcome,
        TerminalOutcome::Completed,
        "{:?}",
        failure_of(&store)
    );
    let artifact = end.artifact.expect("result");
    store.save().expect("save");
    let store_dir = payload::store_of(&document).expect("store");
    assert!(!store_dir.to_str().expect("utf-8").is_ascii());
    assert!(payload::is_plain_directory(
        &store_dir.join(artifact.to_string())
    ));

    let reopened = ProjectStore::new();
    reopened.open_document(&document, false).expect("reopen");
    assert_eq!(
        reopened.describe().artifacts[0]
            .targeted_ms1
            .as_ref()
            .expect("result")
            .availability,
        "available"
    );
    assert_eq!(
        rows_of(&reopened, artifact)[0].outcome,
        RowOutcome::Detected
    );

    let copy = area.join("副本 copy/研究 copy.mscanvas");
    fs::create_dir_all(copy.parent().expect("parent")).expect("dir");
    reopened.save_as(&copy).expect("save as");
    assert_eq!(
        reopened.describe().artifacts[0]
            .targeted_ms1
            .as_ref()
            .expect("result")
            .availability,
        "available"
    );
    assert_eq!(
        rows_of(&reopened, artifact)[0].outcome,
        RowOutcome::Detected
    );
}

#[test]
#[ignore = "runs the pinned runtime under .tmp/m91-runtime"]
fn a_source_on_another_volume_is_refused_before_a_run_exists() {
    let area = WorkArea::new("cross-volume");
    let elsewhere = Scratch::new("m91-cross-volume");
    let source = elsewhere.write("plain.mzML", &mzml(&plain(), ""));
    let work_volume = crate::local_document::directory_volume(&area.join(""));
    let source_volume = crate::local_document::object_identity(&source).map(|(volume, _)| volume);
    assert!(
        work_volume.is_some() && source_volume.is_some() && work_volume != source_volume,
        "this test needs the system temporary directory on another volume than the repository"
    );
    let document = area.join("study.mscanvas");
    let (store, _, layer) = project_over(&document, &source);
    let supervisor = real();
    let resolution = store
        .resolve_targeted_ms1_plan(
            layer,
            &draft(vec![target("caffeine", CAFFEINE, "60", "20")]),
            &supervisor,
        )
        .expect("resolved");
    assert_eq!(
        resolution.blocked,
        Some(ProjectError::SourceOnAnotherVolume)
    );
    let plan = resolution.plan.expect("a plan to review");
    assert_eq!(
        run(&store, &plan, &supervisor).err(),
        Some(ProjectError::SourceOnAnotherVolume)
    );
    assert!(
        store.describe().runs.is_empty(),
        "nothing recorded, nothing copied"
    );
    assert_eq!(fs::read(&source).expect("source"), mzml(&plain(), ""));
}

#[test]
#[ignore = "runs the pinned runtime under .tmp/m91-runtime"]
fn a_source_that_changed_since_the_plan_fails_as_changed_and_publishes_nothing() {
    let area = WorkArea::new("changed");
    let bytes = mzml(&plain(), "");
    let (store, layer, source) = real_project(&area, "plain.mzML", &bytes);
    let supervisor = real();
    let plan = plan(
        &store,
        layer,
        vec![target("caffeine", CAFFEINE, "60", "20")],
        &supervisor,
    );
    let mut changed = bytes.clone();
    let at = changed.len() / 2;
    changed[at] = if changed[at] == b'A' { b'B' } else { b'A' };
    fs::write(&source, &changed).expect("rewrite in place");
    let end = run(&store, &plan, &supervisor).expect("recorded");
    assert_eq!(end.outcome, TerminalOutcome::Failed);
    let described = store.describe();
    let block = described.runs[0].targeted_ms1.as_ref().expect("block");
    assert_eq!(
        block.failure,
        Some(RunFailure {
            code: FailureCode::SourceChanged,
            stage: FailureStage::Source,
        })
    );
    // What was measured is recorded, and it is not what the plan expected.
    assert_eq!(block.consumed_content.len(), 1);
    assert_ne!(block.consumed_content, plan.expected_content);
    assert!(block.attempt.is_none(), "no worker was prepared");
}

/// Enough spectra that loading them takes long enough to be interrupted.
fn large() -> Vec<Scan> {
    let mz = ion_mz(CAFFEINE);
    let mut rng = Seeded(0x5DEE_CE66_D1CE_4E5B);
    let rts: Vec<f64> = (0..6000).map(|index| f64::from(index) * 0.1).collect();
    scans(&rts, |rt| {
        let mut points: Vec<(f64, f64)> = (0..300)
            .map(|_| (rng.uniform(200.0, 400.0), rng.uniform(1.0e3, 1.0e5)))
            .collect();
        points.extend(peak(mz, rt, 60.0, 1.0e6, 0.5));
        points
    })
}

#[test]
#[ignore = "runs the pinned runtime under .tmp/m91-runtime"]
fn a_cancel_during_a_real_run_terminates_the_worker_and_publishes_nothing() {
    let area = WorkArea::new("cancel");
    let (store, layer, document) = real_project(&area, "large.mzML", &mzml(&large(), ""));
    let supervisor = real();
    let plan = plan(
        &store,
        layer,
        vec![target("caffeine", CAFFEINE, "60", "20")],
        &supervisor,
    );
    let job = store.accept_job().expect("accept");
    let end = std::thread::scope(|scope| {
        scope.spawn(|| {
            // Cancel once the worker is reading the source.
            for _ in 0..3000 {
                if store.analysis_run().is_some_and(|(_, phase)| {
                    matches!(phase, RunPhase::LoadingSource | RunPhase::CheckingSource)
                }) {
                    let _ = store.cancel_job(job);
                    return;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
        });
        store.run_targeted_ms1(job, &plan.plan_sha256, &supervisor)
    });
    let end = end.expect("recorded");
    assert_eq!(end.outcome, TerminalOutcome::Cancelled);
    let described = store.describe();
    assert!(described.artifacts.is_empty());
    let stop = described.runs[0]
        .targeted_ms1
        .as_ref()
        .expect("block")
        .stop
        .expect("stop");
    assert_eq!(stop.reason, StopReason::CancelRequested);
    assert!(
        stop.worker_terminated,
        "the cancel reached a running worker"
    );
    assert!(stop.exit_observed);
    let store_dir = payload::store_of(&document).expect("store");
    assert_eq!(payload::unreferenced(&store_dir, &[]), 0);
    // A stale identifier names nothing now; the next operation is not poisoned.
    assert_eq!(
        store.cancel_job(job),
        crate::project::CancelOutcome::NoActiveOperation
    );
    assert!(store.accept_job().is_ok());
}

// ---------------------------------------------------------------------------
// The supervisor with adapters that misbehave
// ---------------------------------------------------------------------------

/// A plan over a real fixture, bound to `adapter`, and an order for it.
fn order_parts(area: &WorkArea, adapter: &'static [u8]) -> (TargetedMs1Plan, PathBuf, PathBuf) {
    let source = area.write("data/plain.mzML", &mzml(&plain(), ""));
    let bytes = fs::read(&source).expect("source");
    let digest = mscanvas_proteowizard::Sha256Digest::calculate(&bytes)
        .expect("digest")
        .to_string();
    let input = record::InputRecord {
        id: InputId::new(),
        label: "plain.mzML".to_owned(),
        locator: record::Locator::LocalAbsolute {
            path: source.clone(),
        },
        members: vec![record::MemberRecord {
            role: MemberRole::Primary,
            relative_name: String::new(),
            baseline: record::ContentBaseline {
                byte_length: bytes.len() as u64,
                sha256: digest,
            },
        }],
    };
    let layer = record::LayerRecord {
        id: LayerId::new(),
        source: record::LayerSource::Input { input_id: input.id },
    };
    let mut binding = recipe::this_build();
    binding.adapter_sha256 = mscanvas_proteowizard::Sha256Digest::calculate(adapter)
        .expect("digest")
        .to_string();
    let plan = recipe::resolve(
        &layer,
        &input,
        &draft(vec![target("caffeine", CAFFEINE, "60", "20")]),
        binding,
    )
    .expect("a plan");
    let store = area.join("results");
    fs::create_dir_all(&store).expect("store");
    (plan, source, store)
}

fn attempt_with(adapter: &'static [u8], budget: Duration) -> (AttemptEnd, bool) {
    let area = WorkArea::new("adapter");
    let scratch = super::development_scratch().expect("a development build");
    let supervisor = Supervisor::at(&scratch, adapter, budget).expect("a supervisor");
    let (plan, source, store) = order_parts(&area, adapter);
    let artifact = ArtifactId::new();
    let order = AttemptOrder {
        plan: &plan,
        source: &source,
        store: &store,
        artifact,
    };
    let end = supervisor.attempt(&order, &Cancellation::default(), &|_| {});
    // Nothing staged for a result that did not complete.
    let staged = store.join(".staging").join(artifact.to_string()).exists();
    (end, staged)
}

const SLEEPER: &[u8] = b"import json, sys, time\n\
from pathlib import Path\n\
out = Path(sys.argv[2])\n\
(out / 'events.jsonl').write_text(json.dumps({'phase': 'load_source'}) + '\\n')\n\
time.sleep(120)\n";
const SILENT_EXIT: &[u8] = b"import sys\nsys.exit(0)\n";
const EXIT_SEVEN: &[u8] = b"import sys\nsys.exit(7)\n";
const GARBAGE_RESULT: &[u8] = b"import json, sys\n\
from pathlib import Path\n\
out = Path(sys.argv[2])\n\
(out / 'result.json').write_text('not json')\n\
(out / 'rows.jsonl').write_text('')\n\
(out / 'evidence.jsonl').write_text('')\n\
(out / 'outcome.json').write_text(json.dumps({'status': 'completed', 'code': 'OK', 'message': '', 'elapsedS': 0.0}))\n";
const REFUSES_PROFILE: &[u8] = b"import json, sys\n\
from pathlib import Path\n\
out = Path(sys.argv[2])\n\
(out / 'outcome.json').write_text(json.dumps({'status': 'refused', 'code': 'SOURCE_NOT_CENTROID', 'message': 'x', 'elapsedS': 0.0}))\n\
sys.exit(3)\n";
const UNKNOWN_CODE: &[u8] = b"import json, sys\n\
from pathlib import Path\n\
out = Path(sys.argv[2])\n\
(out / 'outcome.json').write_text(json.dumps({'status': 'failed', 'code': 'SOMETHING_NEW', 'message': 'x', 'elapsedS': 0.0}))\n\
sys.exit(4)\n";

#[test]
#[ignore = "runs the pinned runtime under .tmp/m91-runtime"]
fn the_time_budget_stops_the_worker_and_records_a_failure_not_a_cancel() {
    let (end, staged) = attempt_with(SLEEPER, Duration::from_secs(2));
    match end {
        AttemptEnd::Failed { failure, stop, .. } => {
            assert_eq!(failure.code, FailureCode::WorkerTimeout);
            let stop = stop.expect("stop");
            assert_eq!(stop.reason, StopReason::TimeBudgetExceeded);
            assert!(stop.worker_terminated && stop.exit_observed);
        }
        other => panic!("not a timeout: {other:?}"),
    }
    assert!(!staged);
}

#[test]
#[ignore = "runs the pinned runtime under .tmp/m91-runtime"]
fn a_worker_whose_output_is_missing_malformed_or_unknown_publishes_nothing() {
    let cases: [(&[u8], FailureCode); 5] = [
        (SILENT_EXIT, FailureCode::WorkerExitedAbnormally),
        (EXIT_SEVEN, FailureCode::WorkerExitedAbnormally),
        (GARBAGE_RESULT, FailureCode::ResultInvalid),
        (REFUSES_PROFILE, FailureCode::SourceNotCentroid),
        (UNKNOWN_CODE, FailureCode::ResultInvalid),
    ];
    for (index, (adapter, expected)) in cases.into_iter().enumerate() {
        let (end, staged) = attempt_with(adapter, Duration::from_secs(60));
        match end {
            AttemptEnd::Failed { failure, .. } => {
                assert_eq!(failure.code, expected, "case {index}")
            }
            other => panic!("case {index} was not a failure: {other:?}"),
        }
        assert!(!staged, "case {index}");
    }
}

#[test]
#[ignore = "runs the pinned runtime under .tmp/m91-runtime"]
fn the_workers_job_refuses_it_a_second_process() {
    use mscanvas_proteowizard::{
        CancellationToken, CommandSpec, WorkerLimits, execute_cancellable,
    };
    let area = WorkArea::new("child");
    let script = area.write(
        "spawn.py",
        b"import subprocess, sys\n\
try:\n    subprocess.run([sys.executable, '-I', '-c', 'pass'], check=True)\n    print('started')\n\
except OSError as error:\n    print('refused', getattr(error, 'winerror', None))\n",
    );
    let scratch = super::development_scratch().expect("a development build");
    let runtime = scratch.join("m91-runtime").join("cpython-3.13.15-embed");
    let python = runtime.join("python.exe");
    let digest = mscanvas_proteowizard::Sha256Digest::calculate_file(&python).expect("digest");
    let spec = CommandSpec::analysis_worker(
        python,
        digest,
        ["-I", "-B", "-X", "utf8"]
            .into_iter()
            .map(std::ffi::OsString::from)
            .chain([script.into_os_string()])
            .collect(),
        area.join(""),
        Vec::new(),
        WorkerLimits {
            job_memory_bytes: 4 * 1024 * 1024 * 1024,
        },
    );
    let output = execute_cancellable(&spec, &CancellationToken::new()).expect("ran");
    let stdout = String::from_utf8_lossy(&output.stdout);
    eprintln!(
        "child attempt: {stdout:?}, total owned processes {:?}",
        output.total_owned_processes
    );
    assert!(stdout.starts_with("refused"), "{stdout}");
    assert_eq!(output.total_owned_processes, Some(1));
}

// ---------------------------------------------------------------------------
// M9.2: a stored result is history, read without running anything
//
// What a result holds is read from its managed payload alone. Neither the
// analysis runtime nor the source is needed to open it, list its rows or read
// a target's evidence, and none of those reads records anything.
// ---------------------------------------------------------------------------

/// Moves a fixture this test owns out of the way, and back when dropped.
struct Aside {
    from: PathBuf,
    to: PathBuf,
}

impl Aside {
    fn new(path: &Path) -> Self {
        let to = path.with_extension("away");
        fs::rename(path, &to).expect("move the owned fixture aside");
        Self {
            from: path.to_path_buf(),
            to,
        }
    }
}

impl Drop for Aside {
    fn drop(&mut self) {
        let _ = fs::rename(&self.to, &self.from);
    }
}

/// Every row and every target's evidence, as a fresh store reads them.
fn everything(
    store: &ProjectStore,
    artifact: ArtifactId,
    plan: &TargetedMs1Plan,
) -> (Vec<payload::PayloadRow>, Vec<Vec<payload::EvidenceLine>>) {
    let rows = rows_of(store, artifact);
    let evidence = plan
        .targets
        .iter()
        .zip(&rows)
        .filter(|(_, row)| row.ion.is_some())
        .map(|(target, _)| {
            store
                .read_targeted_ms1_evidence(artifact, target.target_id)
                .expect("evidence")
        })
        .collect();
    (rows, evidence)
}

#[test]
fn a_saved_result_reopens_and_reads_with_neither_the_runtime_nor_the_source() {
    let scratch = Scratch::new("m92-history");
    let (store, layer, document) = fake_project(&scratch);
    let executor = Fake::new(completed);
    let plan = plan(&store, layer, one_target(), &executor);
    let end = run(&store, &plan, &executor).expect("run");
    let artifact = end.artifact.expect("result");
    store.save().expect("save");
    let before = everything(&store, artifact, &plan);
    let consumed_before = store.describe().runs[0].targeted_ms1.clone();

    // The source goes away, and the only executor on offer runs nothing.
    let _aside = Aside::new(&scratch.join("data/sample.mzML"));
    let reopened = ProjectStore::new();
    reopened.open_document(&document, false).expect("open");
    let opened = reopened.describe();
    assert_eq!((opened.runs.len(), opened.artifacts.len()), (1, 1));
    assert!(!opened.dirty);
    assert_eq!(opened.inputs[0].verification, "notChecked");
    assert_eq!(
        opened.artifacts[0]
            .targeted_ms1
            .as_ref()
            .expect("result")
            .availability,
        "available"
    );

    // A check the user asks for says where the source is now; the result is
    // untouched by it.
    let check = reopened.accept_job().expect("accept");
    reopened.check_linked_files(check).expect("check");
    let checked = reopened.describe();
    assert_eq!(checked.inputs[0].verification, "unavailable");
    assert_eq!(
        checked.inputs[0].unavailable_reason,
        Some("missingAtCheckedLocation")
    );
    assert_eq!(
        checked.artifacts[0]
            .targeted_ms1
            .as_ref()
            .expect("result")
            .availability,
        "available"
    );

    // Everything the result holds reads back unchanged.
    assert_eq!(everything(&reopened, artifact, &plan), before);

    // A new run is what the missing runtime blocks, and only that.
    let resolution = reopened
        .resolve_targeted_ms1_plan(layer, &draft(one_target()), &Unavailable)
        .expect("resolved");
    assert_eq!(resolution.blocked, Some(ProjectError::RecipeUnavailable));
    assert!(matches!(
        run(&reopened, &plan, &Unavailable),
        Err(ProjectError::RecipeUnavailable)
    ));

    // Nothing was recorded or changed by any of it.
    let after = reopened.describe();
    assert_eq!((after.runs.len(), after.artifacts.len()), (1, 1));
    assert!(!after.dirty);
    assert_eq!(after.runs[0].targeted_ms1, consumed_before);
    assert_eq!(everything(&reopened, artifact, &plan), before);
}

#[test]
#[ignore = "runs the pinned runtime under .tmp/m91-runtime"]
fn a_real_result_is_read_after_reopen_and_save_as_with_neither_the_runtime_nor_the_source() {
    let area = WorkArea::new("m92-real-history");
    let (store, layer, source) = real_project(&area, "plain.mzML", &mzml(&plain(), ""));
    let supervisor = real();
    let plan = plan(
        &store,
        layer,
        vec![
            target("caffeine", CAFFEINE, "60", "20"),
            target("adenine", ADENINE, "40", "10"),
        ],
        &supervisor,
    );
    let end = run(&store, &plan, &supervisor).expect("recorded");
    assert_eq!(
        end.outcome,
        TerminalOutcome::Completed,
        "{:?}",
        failure_of(&store)
    );
    let artifact = end.artifact.expect("result");
    store.save().expect("save");
    let document = area.join("study.mscanvas");
    let before = everything(&store, artifact, &plan);
    let execution_before = store.describe().runs[0].targeted_ms1.clone();
    drop(store);

    let _aside = Aside::new(&source);
    let reopened = ProjectStore::new();
    reopened.open_document(&document, false).expect("open");
    let check = reopened.accept_job().expect("accept");
    reopened.check_linked_files(check).expect("check");
    assert_eq!(reopened.describe().inputs[0].verification, "unavailable");
    assert_eq!(everything(&reopened, artifact, &plan), before);
    let resolution = reopened
        .resolve_targeted_ms1_plan(
            layer,
            &draft(vec![target("caffeine", CAFFEINE, "60", "20")]),
            &Unavailable,
        )
        .expect("resolved");
    assert_eq!(resolution.blocked, Some(ProjectError::RecipeUnavailable));

    // Save As carries the result whole, and the copy reads the same.
    let copy = area.join("copy/study-copy.mscanvas");
    fs::create_dir_all(copy.parent().expect("parent")).expect("dir");
    reopened.save_as(&copy).expect("save as");
    let copied = ProjectStore::new();
    copied.open_document(&copy, false).expect("open the copy");
    assert_eq!(everything(&copied, artifact, &plan), before);
    let described = copied.describe();
    assert_eq!((described.runs.len(), described.artifacts.len()), (1, 1));
    assert_eq!(described.runs[0].targeted_ms1, execution_before);
}
