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

use super::{LINK_NAME, SNAPSHOT_NAME, Supervisor, Unavailable, validate_payload, verify_runtime};
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

/// A batch of independent plans (M9.4).
mod batch;

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
    let plan_sha256 = store
        .stored_targeted_result(artifact)
        .expect("the result where it was")
        .plan
        .plan_sha256;
    assert_eq!(
        payload::observe(
            &copied_store,
            artifact,
            payload::Expected {
                reference: &reference,
                plan_sha256: &plan_sha256,
            },
        ),
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

#[test]
fn a_save_as_at_the_last_revision_copies_no_result_and_writes_nothing() {
    let scratch = Scratch::new("m91-save-as-exhausted");
    let (_, document, artifact) = saved_with_result(&scratch);
    let mut value = document_json(&document);
    value["revision"] = serde_json::Value::from(u64::MAX);
    fs::write(
        &document,
        serde_json::to_vec_pretty(&value).expect("serializable"),
    )
    .expect("write");
    let reopened = ProjectStore::new();
    reopened.open_document(&document, false).expect("open");
    let copy = scratch.join("copy/study-copy.mscanvas");
    let beside = copy.parent().expect("parent").to_path_buf();
    fs::create_dir_all(&beside).expect("dir");

    assert_eq!(
        reopened.save_as(&copy),
        Err(ProjectError::RevisionExhausted)
    );

    assert_eq!(
        fs::read_dir(&beside).expect("list").count(),
        0,
        "no document, no store and no pending copy"
    );
    assert_eq!(
        reopened
            .read_targeted_ms1_rows(artifact, 0)
            .expect("the result where it was")
            .total,
        1
    );
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

/// M9.3 adds two words to schema 4 without advancing it: a copied view and a
/// work area that had no room for the copy. Both read; a view this build does
/// not know is refused like every other unknown word.
#[test]
fn a_copied_view_and_a_full_work_area_are_schema_four_words_and_no_other_view_is() {
    assert_eq!(
        reread_after(|value| {
            value["runs"][0]["targetedMs1"]["attempt"]["sourceView"] =
                "verifiedSnapshotInWorkArea".into();
        }),
        Ok(())
    );
    assert_eq!(
        reread_after(|value| {
            value["runs"][0]["targetedMs1"]["attempt"]["sourceView"] = "copiedToTemp".into();
        }),
        Err(record::DocumentProblem::Malformed)
    );
    assert_eq!(
        reread_after(|value| {
            value["runs"][0]["outcome"] = "failed".into();
            value["runs"][0]["outputArtifactIds"] = serde_json::json!([]);
            value["artifacts"] = serde_json::json!([]);
            value["runs"][0]["targetedMs1"]["attempt"] = serde_json::Value::Null;
            value["runs"][0]["targetedMs1"]["consumedContent"] = serde_json::json!([]);
            value["runs"][0]["targetedMs1"]["failure"] =
                serde_json::json!({"code": "insufficientWorkAreaSpace", "stage": "source"});
        }),
        Ok(())
    );
}

#[test]
fn a_run_given_a_verified_copy_says_so_after_a_save_and_reopen() {
    let scratch = Scratch::new("m93-roundtrip");
    let (store, layer, document) = fake_project(&scratch);
    let copied = Fake::new(|order| match completed(order) {
        AttemptEnd::Completed {
            consumed,
            mut attempt,
            result,
        } => {
            attempt.source_view = SourceView::VerifiedSnapshotInWorkArea;
            AttemptEnd::Completed {
                consumed,
                attempt,
                result,
            }
        }
        other => other,
    });
    let plan = plan(&store, layer, one_target(), &copied);
    run(&store, &plan, &copied).expect("completed");
    store.save().expect("save");
    let reopened = ProjectStore::new();
    reopened.open_document(&document, false).expect("open");
    assert_eq!(
        execution_of(&reopened)
            .attempt
            .map(|attempt| attempt.source_view),
        Some(SourceView::VerifiedSnapshotInWorkArea)
    );
}

/// An executor whose preflight finds no room for the copy.
struct NoRoom;

impl RecipeExecutor for NoRoom {
    fn preflight(&self, _plan: &TargetedMs1Plan, _source: &Path) -> Result<(), ProjectError> {
        Err(ProjectError::InsufficientWorkAreaSpace)
    }

    fn attempt(
        &self,
        _order: &AttemptOrder<'_>,
        _cancellation: &Cancellation,
        _progress: &(dyn Fn(RunPhase) + Sync),
    ) -> AttemptEnd {
        panic!("a refused run has no attempt")
    }
}

#[test]
fn a_work_area_without_room_for_the_copy_is_said_at_review_and_the_run_records_nothing() {
    let scratch = Scratch::new("m93-no-room");
    let (store, layer, _) = fake_project(&scratch);
    let resolution = store
        .resolve_targeted_ms1_plan(layer, &draft(one_target()), &NoRoom)
        .expect("resolved");
    assert_eq!(
        resolution.blocked,
        Some(ProjectError::InsufficientWorkAreaSpace)
    );
    let plan = resolution.plan.expect("a plan to review");
    assert_eq!(
        run(&store, &plan, &NoRoom).err(),
        Some(ProjectError::InsufficientWorkAreaSpace)
    );
    assert!(store.describe().runs.is_empty());
    assert!(ProjectError::InsufficientWorkAreaSpace.retryable());
    assert!(store.accept_job().is_ok(), "nothing is left running");
}

#[test]
fn a_copy_needs_room_for_exactly_the_bytes_the_plan_reads() {
    let scratch = Scratch::new("m93-room");
    let plan = plan_over(
        &scratch.write("plain.mzML", b"<mzML/>"),
        recipe::ADAPTER_SOURCE,
    );
    let length = plan.expected_content[0].byte_length;
    assert!(super::room_for_snapshot(length, &plan));
    assert!(super::room_for_snapshot(u64::MAX, &plan));
    assert!(!super::room_for_snapshot(length - 1, &plan));
    assert!(!super::room_for_snapshot(0, &plan));
    let mut overflowing = plan;
    overflowing.expected_content[0].byte_length = u64::MAX;
    overflowing
        .expected_content
        .push(overflowing.expected_content[0].clone());
    assert!(!super::room_for_snapshot(u64::MAX, &overflowing));
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
    let before = attempt_entries(&supervisor);
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
    // On the work area's volume the source is linked, never copied.
    assert_eq!(
        execution_of(&store)
            .attempt
            .map(|attempt| attempt.source_view),
        Some(SourceView::HardLinkInWorkArea)
    );
    // The link is gone -- with its whole attempt directory, which nothing
    // but the attempt itself would remove -- and the source is where it was.
    assert_eq!(attempt_entries(&supervisor), before);
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

// ---------------------------------------------------------------------------
// M9.3: a source on another volume, through a verified copy
//
// The system temporary directory is on another volume than this repository on
// the machine these ran on, and each test asserts that rather than assuming
// it: the copies below are real copies between two physical NTFS volumes.
// ---------------------------------------------------------------------------

/// Fails the test unless `source` is on another volume than the work area.
fn assert_another_volume(area: &WorkArea, source: &Path) {
    let work_volume = crate::local_document::directory_volume(&area.join(""));
    let source_volume = crate::local_document::object_identity(source).map(|(volume, _)| volume);
    assert!(
        work_volume.is_some() && source_volume.is_some() && work_volume != source_volume,
        "this test needs the system temporary directory on another volume than the repository"
    );
}

/// A saved project in the work area over a source in `elsewhere`.
fn cross_volume_project(
    area: &WorkArea,
    elsewhere: &Scratch,
    name: &str,
    bytes: &[u8],
) -> (ProjectStore, LayerId, PathBuf) {
    let source = elsewhere.write(name, bytes);
    assert_another_volume(area, &source);
    let (store, _, layer) = project_over(&area.join("study.mscanvas"), &source);
    (store, layer, source)
}

/// Every name below the attempts root, to show an attempt left none behind.
fn attempt_entries(supervisor: &Supervisor) -> std::collections::BTreeSet<std::ffi::OsString> {
    fs::read_dir(&supervisor.attempts)
        .map(|entries| entries.flatten().map(|entry| entry.file_name()).collect())
        .unwrap_or_default()
}

fn execution_of(store: &ProjectStore) -> record::TargetedMs1Execution {
    store
        .describe()
        .runs
        .last()
        .expect("a run")
        .targeted_ms1
        .clone()
        .expect("a targeted run")
}

#[test]
#[ignore = "runs the pinned runtime under .tmp/m91-runtime"]
fn a_source_on_another_volume_runs_through_a_verified_copy_that_does_not_outlive_it() {
    let area = WorkArea::new("cross-volume");
    let elsewhere = Scratch::new("m93-cross-volume");
    let bytes = mzml(&plain(), "");
    let (store, layer, source) = cross_volume_project(&area, &elsewhere, "plain.mzML", &bytes);
    let supervisor = real();
    let before = attempt_entries(&supervisor);
    let targets = vec![
        target("caffeine", CAFFEINE, "60", "20"),
        target("adenine", ADENINE, "40", "10"),
    ];
    let resolution = store
        .resolve_targeted_ms1_plan(layer, &draft(targets), &supervisor)
        .expect("resolved");
    assert_eq!(resolution.blocked, None, "another volume no longer blocks");
    let plan = resolution.plan.expect("a plan");
    let end = run(&store, &plan, &supervisor).expect("recorded");
    assert_eq!(
        end.outcome,
        TerminalOutcome::Completed,
        "{:?}",
        failure_of(&store)
    );
    let artifact = end.artifact.expect("result");
    assert_eq!(rows_of(&store, artifact)[0].outcome, RowOutcome::Detected);
    let execution = execution_of(&store);
    assert_eq!(execution.consumed_content, plan.expected_content);
    assert_eq!(
        execution
            .attempt
            .as_ref()
            .map(|attempt| attempt.source_view),
        Some(SourceView::VerifiedSnapshotInWorkArea)
    );
    assert_eq!(fs::read(&source).expect("source"), bytes, "untouched");
    assert_eq!(
        attempt_entries(&supervisor),
        before,
        "the copy and its attempt directory are gone"
    );

    // The document says how the engine was given the source, never where.
    store.save().expect("save");
    let document = area.join("study.mscanvas");
    let text = fs::read_to_string(&document).expect("document");
    assert!(text.contains("\"verifiedSnapshotInWorkArea\""));
    for private in ["m91-jobs", "attempts", SNAPSHOT_NAME, LINK_NAME, ".tmp"] {
        assert!(!text.contains(private), "the document names {private:?}");
    }

    // M9.2 still holds with every trace of the execution gone: the result is
    // read, drawn and tabulated from the store alone, with the source away.
    let before_read = everything(&store, artifact, &plan);
    drop(store);
    let _aside = Aside::new(&source);
    let reopened = ProjectStore::new();
    reopened.open_document(&document, false).expect("open");
    assert_eq!(
        reopened.describe().artifacts[0]
            .targeted_ms1
            .as_ref()
            .expect("result")
            .availability,
        "available"
    );
    assert_eq!(everything(&reopened, artifact, &plan), before_read);
    let (figure, _) = reopened
        .targeted_evidence_figure(
            artifact,
            plan.targets[0].target_id,
            size(),
            FigureTheme::Light,
        )
        .expect("drawn");
    assert!(mscanvas_plot_spec::svg::render(&figure).contains("Targeted MS1 lookup"));
    let stored = reopened.stored_targeted_result(artifact).expect("stored");
    assert_eq!(
        result_table(&stored, TableFormat::Csv).expect("a table").1,
        plan.targets.len()
    );
    assert!(!reopened.describe().dirty, "reading recorded nothing");
}

#[test]
#[ignore = "runs the pinned runtime under .tmp/m91-runtime"]
fn a_source_under_a_non_ascii_path_on_another_volume_is_read_through_its_ascii_copy() {
    let area = WorkArea::new("cross-volume-non-ascii");
    let elsewhere = Scratch::new("m93-非ascii");
    let (store, layer, source) = cross_volume_project(
        &area,
        &elsewhere,
        "数据 目录/样品 plain.mzML",
        &mzml(&plain(), ""),
    );
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
    assert_eq!(
        execution_of(&store)
            .attempt
            .map(|attempt| attempt.source_view),
        Some(SourceView::VerifiedSnapshotInWorkArea)
    );
}

#[test]
#[ignore = "runs the pinned runtime under .tmp/m91-runtime"]
fn a_source_on_another_volume_changed_since_the_plan_is_not_copied_into_a_run() {
    let area = WorkArea::new("cross-volume-changed");
    let elsewhere = Scratch::new("m93-changed");
    let bytes = mzml(&plain(), "");
    let (store, layer, source) = cross_volume_project(&area, &elsewhere, "plain.mzML", &bytes);
    let supervisor = real();
    let plan = plan(
        &store,
        layer,
        vec![target("caffeine", CAFFEINE, "60", "20")],
        &supervisor,
    );
    let before = attempt_entries(&supervisor);
    let mut changed = bytes;
    let at = changed.len() / 2;
    changed[at] = if changed[at] == b'A' { b'B' } else { b'A' };
    fs::write(&source, &changed).expect("rewrite in place");
    let end = run(&store, &plan, &supervisor).expect("recorded");
    assert_eq!(end.outcome, TerminalOutcome::Failed);
    let execution = execution_of(&store);
    assert_eq!(
        execution.failure,
        Some(RunFailure {
            code: FailureCode::SourceChanged,
            stage: FailureStage::Source,
        })
    );
    // What the copy read is recorded, and it is not what the plan expected.
    assert_eq!(execution.consumed_content.len(), 1);
    assert_ne!(execution.consumed_content, plan.expected_content);
    assert!(execution.attempt.is_none(), "no worker was prepared");
    assert!(store.describe().artifacts.is_empty());
    assert_eq!(attempt_entries(&supervisor), before, "no copy left behind");
}

#[test]
#[ignore = "runs the pinned runtime under .tmp/m91-runtime"]
fn a_source_on_another_volume_that_is_gone_fails_unavailable_and_copies_nothing() {
    let area = WorkArea::new("cross-volume-gone");
    let elsewhere = Scratch::new("m93-gone");
    let (store, layer, source) =
        cross_volume_project(&area, &elsewhere, "plain.mzML", &mzml(&plain(), ""));
    let supervisor = real();
    let plan = plan(
        &store,
        layer,
        vec![target("caffeine", CAFFEINE, "60", "20")],
        &supervisor,
    );
    let before = attempt_entries(&supervisor);
    fs::remove_file(&source).expect("the source goes");
    let end = run(&store, &plan, &supervisor).expect("recorded");
    assert_eq!(end.outcome, TerminalOutcome::Failed);
    let execution = execution_of(&store);
    assert_eq!(
        execution.failure,
        Some(RunFailure {
            code: FailureCode::SourceUnavailable,
            stage: FailureStage::Source,
        })
    );
    assert!(execution.consumed_content.is_empty());
    assert_eq!(attempt_entries(&supervisor), before);
}

/// An order over a source in `elsewhere`, for a supervisor bound to `adapter`.
fn cross_volume_order_parts(
    area: &WorkArea,
    elsewhere: &Scratch,
    scans: &[Scan],
    adapter: &'static [u8],
) -> (TargetedMs1Plan, PathBuf, PathBuf) {
    let source = elsewhere.write("data/plain.mzML", &mzml(scans, ""));
    assert_another_volume(area, &source);
    let store = area.join("results");
    fs::create_dir_all(&store).expect("store");
    (plan_over(&source, adapter), source, store)
}

/// A cancellation that requests itself as the `at`th chunk is about to be read.
fn cancelling_at(
    at: usize,
) -> (
    Cancellation,
    std::sync::Arc<std::sync::Mutex<Option<Cancellation>>>,
) {
    let slot = std::sync::Arc::new(std::sync::Mutex::new(None::<Cancellation>));
    let seen = std::sync::Arc::new(AtomicU64::new(0));
    let cancellation = {
        let slot = std::sync::Arc::clone(&slot);
        Cancellation::with_gate(std::sync::Arc::new(move || {
            if seen.fetch_add(1, Ordering::SeqCst) + 1 == at as u64
                && let Some(own) = slot.lock().expect("slot").as_ref()
            {
                own.request();
            }
        }))
    };
    *slot.lock().expect("slot") = Some(cancellation.clone());
    (cancellation, slot)
}

#[test]
#[ignore = "runs the pinned runtime under .tmp/m91-runtime"]
fn a_cancel_while_the_copy_is_made_stops_before_any_worker_and_leaves_nothing() {
    let area = WorkArea::new("cancel-copy");
    let elsewhere = Scratch::new("m93-cancel-copy");
    let (plan, source, store) =
        cross_volume_order_parts(&area, &elsewhere, &plain(), recipe::ADAPTER_SOURCE);
    assert!(
        fs::metadata(&source).expect("source").len() > 3 * 64 * 1024,
        "the fixture spans more chunks than the cancel waits for"
    );
    let supervisor = real();
    let before = attempt_entries(&supervisor);
    let (cancellation, slot) = cancelling_at(3);
    let phases = std::sync::Mutex::new(Vec::new());
    let order = AttemptOrder {
        plan: &plan,
        source: &source,
        store: &store,
        artifact: ArtifactId::new(),
    };
    let end = supervisor.attempt(&order, &cancellation, &|phase| {
        phases.lock().expect("phases").push(phase);
    });
    slot.lock().expect("slot").take();
    assert_eq!(
        end,
        AttemptEnd::Cancelled {
            consumed: Vec::new(),
            attempt: None,
            stop: StopFacts {
                reason: StopReason::CancelRequested,
                worker_terminated: false,
                exit_observed: false,
            },
        }
    );
    let phases = phases.into_inner().expect("phases");
    assert!(phases.contains(&RunPhase::PreparingInput), "{phases:?}");
    assert!(
        !phases.contains(&RunPhase::LoadingSource),
        "no worker ran: {phases:?}"
    );
    assert_eq!(
        attempt_entries(&supervisor),
        before,
        "the partial copy is gone"
    );
    assert!(!store.join(".staging").exists());
    assert_eq!(fs::read(&source).expect("source"), mzml(&plain(), ""));
}

#[test]
#[ignore = "runs the pinned runtime under .tmp/m91-runtime"]
fn a_worker_that_fails_after_the_copy_records_its_view_and_leaves_no_copy() {
    let area = WorkArea::new("copy-then-fail");
    let elsewhere = Scratch::new("m93-copy-then-fail");
    let (plan, source, store) = cross_volume_order_parts(&area, &elsewhere, &plain(), EXIT_SEVEN);
    let scratch = super::development_scratch().expect("a development build");
    let supervisor =
        Supervisor::at(&scratch, EXIT_SEVEN, Duration::from_secs(60)).expect("a supervisor");
    let before = attempt_entries(&supervisor);
    let order = AttemptOrder {
        plan: &plan,
        source: &source,
        store: &store,
        artifact: ArtifactId::new(),
    };
    match supervisor.attempt(&order, &Cancellation::default(), &|_| {}) {
        AttemptEnd::Failed {
            consumed,
            attempt,
            failure,
            ..
        } => {
            assert_eq!(failure.code, FailureCode::WorkerExitedAbnormally);
            assert_eq!(consumed, plan.expected_content);
            assert_eq!(
                attempt.map(|attempt| attempt.source_view),
                Some(SourceView::VerifiedSnapshotInWorkArea)
            );
        }
        other => panic!("not a failure: {other:?}"),
    }
    assert_eq!(attempt_entries(&supervisor), before);
}

/// Once the copy is verified the source's part is over: removing it, and
/// putting other bytes at its name, while the worker reads does not change
/// what the attempt consumed.
#[test]
#[ignore = "runs the pinned runtime under .tmp/m91-runtime"]
fn a_source_removed_and_replaced_while_the_worker_reads_its_copy_changes_nothing() {
    let area = WorkArea::new("copy-then-source-gone");
    let elsewhere = Scratch::new("m93-copy-then-source-gone");
    let (plan, source, store) =
        cross_volume_order_parts(&area, &elsewhere, &plain(), recipe::ADAPTER_SOURCE);
    let supervisor = real();
    let replaced = std::sync::atomic::AtomicBool::new(false);
    let order = AttemptOrder {
        plan: &plan,
        source: &source,
        store: &store,
        artifact: ArtifactId::new(),
    };
    let end = supervisor.attempt(&order, &Cancellation::default(), &|phase| {
        if phase == RunPhase::LoadingSource && !replaced.swap(true, Ordering::SeqCst) {
            fs::remove_file(&source).expect("the source is no longer held");
            fs::write(&source, b"other bytes under the same name").expect("replaced");
        }
    });
    assert!(replaced.load(Ordering::SeqCst), "the worker was reading");
    match end {
        AttemptEnd::Completed {
            consumed, attempt, ..
        } => {
            assert_eq!(consumed, plan.expected_content);
            assert_eq!(attempt.source_view, SourceView::VerifiedSnapshotInWorkArea);
        }
        other => panic!("not completed: {other:?}"),
    }
    assert_eq!(
        fs::read(&source).expect("the replacement"),
        b"other bytes under the same name"
    );
}

#[test]
#[ignore = "runs the pinned runtime under .tmp/m91-runtime"]
fn a_result_that_cannot_be_staged_after_the_copy_publishes_nothing_and_leaves_no_copy() {
    let area = WorkArea::new("copy-then-unpublished");
    let elsewhere = Scratch::new("m93-copy-then-unpublished");
    let (plan, source, store) =
        cross_volume_order_parts(&area, &elsewhere, &plain(), recipe::ADAPTER_SOURCE);
    // Something that is not a directory where the staging area goes.
    fs::write(store.join(".staging"), b"in the way").expect("blocker");
    let supervisor = real();
    let before = attempt_entries(&supervisor);
    let artifact = ArtifactId::new();
    let order = AttemptOrder {
        plan: &plan,
        source: &source,
        store: &store,
        artifact,
    };
    match supervisor.attempt(&order, &Cancellation::default(), &|_| {}) {
        AttemptEnd::Failed {
            consumed,
            attempt,
            failure,
            ..
        } => {
            assert_eq!(
                failure,
                RunFailure {
                    code: FailureCode::PayloadNotPublished,
                    stage: FailureStage::Publish,
                }
            );
            assert_eq!(consumed, plan.expected_content);
            assert_eq!(
                attempt.map(|attempt| attempt.source_view),
                Some(SourceView::VerifiedSnapshotInWorkArea),
                "the worker ran over the copy and completed"
            );
        }
        other => panic!("not a failure: {other:?}"),
    }
    assert!(!store.join(artifact.to_string()).exists());
    assert_eq!(
        fs::read(store.join(".staging")).expect("kept"),
        b"in the way"
    );
    assert_eq!(attempt_entries(&supervisor), before);
}

#[test]
#[ignore = "runs the pinned runtime under .tmp/m91-runtime"]
fn a_copy_the_work_area_cannot_hold_is_refused_before_a_run_exists() {
    let area = WorkArea::new("copy-too-large");
    let elsewhere = Scratch::new("m93-too-large");
    let (plan, source, _) =
        cross_volume_order_parts(&area, &elsewhere, &plain(), recipe::ADAPTER_SOURCE);
    let supervisor = real();
    assert_eq!(supervisor.preflight(&plan, &source), Ok(()));
    // The same plan, expecting more bytes than any volume here has free.
    let mut larger = plan.clone();
    larger.expected_content[0].byte_length = u64::MAX / 2;
    assert_eq!(
        supervisor.preflight(&larger, &source),
        Err(ProjectError::InsufficientWorkAreaSpace)
    );
    // On the work area's own volume nothing is copied, so nothing is asked.
    let (same_plan, same_source, _) = order_parts(&area, recipe::ADAPTER_SOURCE);
    let mut same_larger = same_plan;
    same_larger.expected_content[0].byte_length = u64::MAX / 2;
    assert_eq!(supervisor.preflight(&same_larger, &same_source), Ok(()));
}

/// This process's peak working set and peak private commit, in bytes.
#[cfg(windows)]
fn peak_memory() -> (usize, usize) {
    #[repr(C)]
    #[derive(Default)]
    struct Counters {
        size: u32,
        page_faults: u32,
        peak_working_set: usize,
        working_set: usize,
        quota_peak_paged_pool: usize,
        quota_paged_pool: usize,
        quota_peak_non_paged_pool: usize,
        quota_non_paged_pool: usize,
        pagefile: usize,
        peak_pagefile: usize,
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        #[link_name = "GetCurrentProcess"]
        fn current_process() -> *mut std::ffi::c_void;
        #[link_name = "K32GetProcessMemoryInfo"]
        fn process_memory_info(
            process: *mut std::ffi::c_void,
            counters: *mut Counters,
            size: u32,
        ) -> i32;
    }
    let mut counters = Counters {
        size: u32::try_from(std::mem::size_of::<Counters>()).expect("fits"),
        ..Counters::default()
    };
    // SAFETY: a pseudo handle for this process and a correctly sized,
    // initialized PROCESS_MEMORY_COUNTERS.
    let answered =
        unsafe { process_memory_info(current_process(), &raw mut counters, counters.size) };
    assert_ne!(answered, 0, "memory counters");
    (counters.peak_working_set, counters.peak_pagefile)
}

/// Measures the verified copy of a large fixture between two volumes, whole
/// and cancelled halfway. Opt-in: `MSCANVAS_M93_MEASURE` names the fixture,
/// which is only read, to make this test's own copy on the other volume.
/// Writes what it saw to `test-results/m9.3/measure/`.
#[cfg(windows)]
#[test]
#[ignore = "measures a copy of the large owned fixture MSCANVAS_M93_MEASURE names"]
fn measure_a_verified_copy_between_volumes() {
    use std::time::Instant;

    let Some(fixture) = std::env::var_os("MSCANVAS_M93_MEASURE").map(PathBuf::from) else {
        eprintln!("MSCANVAS_M93_MEASURE is not set; nothing measured");
        return;
    };
    let area = WorkArea::new("m93-measure");
    let elsewhere = Scratch::new("m93-measure");
    let source = elsewhere.join("large.mzML");
    fs::copy(&fixture, &source).expect("this test's own copy on the other volume");
    assert_another_volume(&area, &source);
    let plan = plan_over(&source, recipe::ADAPTER_SOURCE);
    let byte_length = plan.expected_content[0].byte_length;
    let store = area.join("results");
    fs::create_dir_all(&store).expect("store");
    let order = AttemptOrder {
        plan: &plan,
        source: &source,
        store: &store,
        artifact: ArtifactId::new(),
    };
    let before = peak_memory();

    let whole = area.join("whole");
    fs::create_dir_all(&whole).expect("directory");
    let started = Instant::now();
    let view = super::snapshot(
        &order,
        crate::project::observe::open_member(&source).expect("opened"),
        Vec::new(),
        &whole,
        &Cancellation::default(),
        &|_| {},
    )
    .map_err(|end| format!("{end:?}"))
    .expect("a verified copy");
    let prepared = started.elapsed();
    assert_eq!(view.consumed, plan.expected_content);
    let copy_bytes = fs::metadata(&view.path).expect("copy").len();
    drop(view);
    let after = peak_memory();

    // Cancelled as the middle chunk is about to be read.
    let halfway = byte_length.div_ceil(64 * 1024) / 2;
    let requested = std::sync::Arc::new(std::sync::Mutex::new(None::<Instant>));
    let slot = std::sync::Arc::new(std::sync::Mutex::new(None::<Cancellation>));
    let seen = std::sync::Arc::new(AtomicU64::new(0));
    let cancellation = {
        let (requested, slot, seen) = (
            std::sync::Arc::clone(&requested),
            std::sync::Arc::clone(&slot),
            std::sync::Arc::clone(&seen),
        );
        Cancellation::with_gate(std::sync::Arc::new(move || {
            if seen.fetch_add(1, Ordering::SeqCst) + 1 == halfway
                && let Some(own) = slot.lock().expect("slot").as_ref()
            {
                *requested.lock().expect("requested") = Some(Instant::now());
                own.request();
            }
        }))
    };
    *slot.lock().expect("slot") = Some(cancellation.clone());
    let cancelled_at = area.join("cancelled");
    fs::create_dir_all(&cancelled_at).expect("directory");
    let end = super::snapshot(
        &order,
        crate::project::observe::open_member(&source).expect("opened"),
        Vec::new(),
        &cancelled_at,
        &cancellation,
        &|_| {},
    );
    let returned = Instant::now();
    slot.lock().expect("slot").take();
    assert!(matches!(
        end.as_ref().map_err(|end| end.as_ref()),
        Err(AttemptEnd::Cancelled { .. })
    ));
    drop(end);
    let partial = fs::metadata(cancelled_at.join(SNAPSHOT_NAME))
        .expect("the partial copy, for its directory to remove")
        .len();
    let latency = returned.duration_since(requested.lock().expect("requested").expect("requested"));

    let record = serde_json::json!({
        "sourceBytes": byte_length,
        "copyBytes": copy_bytes,
        "preparedSeconds": prepared.as_secs_f64(),
        "peakWorkingSetBytesBefore": before.0,
        "peakWorkingSetBytesAfter": after.0,
        "peakPrivateBytesBefore": before.1,
        "peakPrivateBytesAfter": after.1,
        "cancelledAtChunk": halfway,
        "partialCopyBytes": partial,
        "cancelToReturnSeconds": latency.as_secs_f64(),
    });
    eprintln!("{record}");
    let evidence = Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .expect("the repository root")
        .join("test-results")
        .join("m9.3")
        .join("measure");
    fs::create_dir_all(&evidence).expect("evidence folder");
    let name = fixture
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("fixture")
        .to_owned();
    fs::write(
        evidence.join(format!("{name}.json")),
        serde_json::to_vec_pretty(&record).expect("json"),
    )
    .expect("record");
    assert_eq!(copy_bytes, byte_length);
    assert!(partial < byte_length);
}

/// How many reads a whole pass over `path` hands the digest: one per 64 KiB
/// chunk, and the read that finds its end.
fn reads_of(path: &Path) -> usize {
    usize::try_from(fs::metadata(path).expect("file").len().div_ceil(64 * 1024) + 1).expect("fits")
}

/// An order over a source in `area`, and the store it names.
fn order_in(area: &WorkArea) -> (TargetedMs1Plan, PathBuf, PathBuf) {
    let source = area.write("data/plain.mzML", &mzml(&plain(), ""));
    let store = area.join("results");
    fs::create_dir_all(&store).expect("store");
    (plan_over(&source, recipe::ADAPTER_SOURCE), source, store)
}

fn cancelled_having_read(consumed: Vec<record::ObservedMember>) -> AttemptEnd {
    AttemptEnd::Cancelled {
        consumed,
        attempt: None,
        stop: StopFacts {
            reason: StopReason::CancelRequested,
            worker_terminated: false,
            exit_observed: false,
        },
    }
}

#[test]
fn a_copy_that_does_not_fit_is_judged_again_once_crash_left_scratch_is_reclaimed() {
    let scratch = Scratch::new("m93-reclaim");
    let plan = plan_over(
        &scratch.write("plain.mzML", b"<mzML/>"),
        recipe::ADAPTER_SOURCE,
    );
    let needed = plan.expected_content[0].byte_length;
    let reclaimed = std::cell::Cell::new(0);
    let reclaim = || reclaimed.set(reclaimed.get() + 1);

    assert!(super::room_after_reclaiming(
        &plan,
        || Some(needed),
        reclaim
    ));
    assert_eq!(reclaimed.get(), 0, "a copy that fits reclaims nothing");

    let free = std::cell::Cell::new(needed - 1);
    assert!(super::room_after_reclaiming(
        &plan,
        || Some(free.get()),
        || {
            reclaim();
            free.set(needed);
        }
    ));
    assert_eq!(reclaimed.get(), 1, "judged again after one reclaim");

    assert!(!super::room_after_reclaiming(&plan, || Some(0), reclaim));
    assert_eq!(reclaimed.get(), 2);

    assert!(super::room_after_reclaiming(&plan, || None, reclaim));
    assert_eq!(
        reclaimed.get(),
        2,
        "space that cannot be told refuses nothing"
    );
}

#[test]
fn a_link_that_cannot_be_made_falls_back_to_a_verified_copy_through_the_held_handle() {
    let area = WorkArea::new("link-refused");
    let (plan, source, store) = order_in(&area);
    let order = AttemptOrder {
        plan: &plan,
        source: &source,
        store: &store,
        artifact: ArtifactId::new(),
    };
    // Something already at the link's name: `CreateHardLink` refuses, as it
    // does on a volume that has no links.
    let blocked = |name: &str| {
        let attempt = area.join(name);
        fs::create_dir_all(&attempt).expect("attempt");
        fs::write(attempt.join(LINK_NAME), b"in the way").expect("blocker");
        attempt
    };

    let attempt = blocked("attempt");
    // The link path is the one taken only where both volumes are known and
    // the same; otherwise this would test the direct copy instead.
    let source_volume = crate::local_document::object_identity(&source).map(|(volume, _)| volume);
    assert!(
        source_volume.is_some()
            && source_volume == crate::local_document::directory_volume(&attempt),
        "this test needs the source and the attempt on one identifying volume"
    );
    let view = super::execution_view(
        &order,
        crate::project::observe::open_member(&source).expect("opened"),
        &attempt,
        &Cancellation::default(),
        &|_| {},
    )
    .map_err(|end| format!("{end:?}"))
    .expect("a view");
    assert_eq!(view.kind, SourceView::VerifiedSnapshotInWorkArea);
    assert_eq!(view.path, attempt.join(SNAPSHOT_NAME));
    assert_eq!(view.consumed, plan.expected_content);
    drop(view);
    assert_eq!(
        fs::read(attempt.join(SNAPSHOT_NAME)).expect("copy"),
        fs::read(&source).expect("source")
    );
    assert_eq!(
        fs::read(attempt.join(LINK_NAME)).expect("kept"),
        b"in the way"
    );

    // Cancelled during that copy, the attempt keeps what its first read of
    // the source established.
    let attempt = blocked("attempt-cancelled");
    let (cancellation, slot) = cancelling_at(reads_of(&source) + 2);
    let end = super::execution_view(
        &order,
        crate::project::observe::open_member(&source).expect("opened"),
        &attempt,
        &cancellation,
        &|_| {},
    );
    slot.lock().expect("slot").take();
    assert_eq!(
        end.err().map(|end| *end),
        Some(cancelled_having_read(plan.expected_content.clone()))
    );
}

#[test]
fn a_cancel_while_the_copy_is_hashed_again_records_what_the_copy_read() {
    let area = WorkArea::new("cancel-recheck");
    let (plan, source, store) = order_in(&area);
    let order = AttemptOrder {
        plan: &plan,
        source: &source,
        store: &store,
        artifact: ArtifactId::new(),
    };
    let attempt = area.join("attempt");
    fs::create_dir_all(&attempt).expect("attempt");
    // Past the copy's own reads, into the second chunk of hashing it again.
    let (cancellation, slot) = cancelling_at(reads_of(&source) + 2);
    let end = super::snapshot(
        &order,
        crate::project::observe::open_member(&source).expect("opened"),
        Vec::new(),
        &attempt,
        &cancellation,
        &|_| {},
    );
    slot.lock().expect("slot").take();
    assert_eq!(
        end.err().map(|end| *end),
        Some(cancelled_having_read(plan.expected_content.clone())),
        "the source's bytes were read whole and were the plan's"
    );

    // Cancelled during the copy itself, nothing was read whole.
    let early = area.join("attempt-early");
    fs::create_dir_all(&early).expect("attempt");
    let (cancellation, slot) = cancelling_at(2);
    let end = super::snapshot(
        &order,
        crate::project::observe::open_member(&source).expect("opened"),
        Vec::new(),
        &early,
        &cancellation,
        &|_| {},
    );
    slot.lock().expect("slot").take();
    assert_eq!(
        end.err().map(|end| *end),
        Some(cancelled_having_read(Vec::new()))
    );
}

// ---------------------------------------------------------------------------
// M9.3.C1: a sweep never unlinks a link; the attempt that made it does
// ---------------------------------------------------------------------------

/// Windows-specific. The one place a link is unlinked is the attempt's own
/// view, while it holds the source: the source's name cannot be deleted or
/// renamed while the link beside it exists, so the link is never its last
/// name, and dropping the view removes the link and leaves the source whole.
#[cfg(windows)]
#[test]
fn a_link_view_removes_its_link_while_the_source_name_cannot_go_first() {
    let area = WorkArea::new("link-view-drop");
    let (plan, source, store) = order_in(&area);
    let order = AttemptOrder {
        plan: &plan,
        source: &source,
        store: &store,
        artifact: ArtifactId::new(),
    };
    let attempt = area.join("attempt");
    fs::create_dir_all(&attempt).expect("attempt");
    let bytes = fs::read(&source).expect("source");
    let view = super::execution_view(
        &order,
        crate::project::observe::open_member(&source).expect("opened"),
        &attempt,
        &Cancellation::default(),
        &|_| {},
    )
    .map_err(|end| format!("{end:?}"))
    .expect("a view");
    assert_eq!(view.kind, SourceView::HardLinkInWorkArea);
    let link = attempt.join(LINK_NAME);
    assert_eq!(
        crate::local_document::object_identity(&link),
        crate::local_document::object_identity(&source),
        "the link is a second name of the source"
    );
    assert!(
        fs::remove_file(&source).is_err(),
        "the source's own name cannot be deleted while it is held, link or no link"
    );
    assert!(fs::rename(&source, area.join("moved.mzML")).is_err());

    drop(view);
    assert!(!link.exists(), "the attempt removed its own link");
    assert_eq!(
        fs::read(&source).expect("source"),
        bytes,
        "and the source is whole"
    );
    fs::remove_file(&source).expect("and released");
}

/// A marked attempt of a gone owner holding a hard link to `original`.
#[cfg(windows)]
fn dead_link_attempt(root: &Path, original: &Path) -> PathBuf {
    let attempt = crash_left(root, 0xFFFF_FFFD);
    fs::remove_file(attempt.join(SNAPSHOT_NAME)).expect("a link attempt has no copy");
    fs::hard_link(original, attempt.join(LINK_NAME)).expect("link");
    attempt
}

#[cfg(windows)]
#[test]
fn a_link_left_by_a_crash_is_not_given_up_to_make_room_for_a_copy() {
    let scratch = Scratch::new("m93c1-room");
    let root = scratch.join("attempts");
    fs::create_dir_all(&root).expect("attempts root");
    let original = scratch.write("user/run.mzML", &vec![b'x'; 256 * 1024]);
    let linked = dead_link_attempt(&root, &original);
    let copied = crash_left(&root, 0xFFFF_FFFD);
    let plan = plan_over(
        &scratch.write("plain.mzML", b"<mzML/>"),
        recipe::ADAPTER_SOURCE,
    );

    // No room, before or after: the sweep reclaims the dead copy and leaves
    // the link, and the refusal stands.
    let swept = std::cell::Cell::new(super::scratch::Sweep::default());
    assert!(!super::room_after_reclaiming(
        &plan,
        || Some(0),
        || swept.set(super::scratch::sweep(&root))
    ));
    let swept = swept.get();
    assert_eq!((swept.removed, swept.linked), (1, 1), "{swept:?}");
    assert!(!copied.exists());
    assert!(linked.join(LINK_NAME).is_file(), "the link is kept");
    assert_eq!(
        fs::read(&original).expect("user bytes"),
        vec![b'x'; 256 * 1024]
    );
}

#[cfg(windows)]
#[test]
fn a_sweep_over_a_project_and_its_result_store_removes_none_of_it() {
    let scratch = Scratch::new("m93c1-store");
    let (store, document, artifact) = saved_with_result(&scratch);
    let expected_rows = rows_of(&store, artifact);
    drop(store);
    let store_dir = payload::store_of(&document).expect("store");
    let result_dir = store_dir.join(artifact.to_string());
    assert!(payload::is_plain_directory(&result_dir));
    // A dead copy attempt beside them is the only thing a sweep may remove.
    let dead = crash_left(scratch.directory(), 0xFFFF_FFFD);

    assert_eq!(super::scratch::sweep(scratch.directory()).removed, 1);
    assert!(!dead.exists());
    for root in [store_dir.as_path(), result_dir.as_path()] {
        assert_eq!(super::scratch::sweep(root).removed, 0, "{}", root.display());
    }
    assert!(document.is_file());
    assert_eq!(availability_on_open(&document).0, "available");
    let reopened = ProjectStore::new();
    reopened.open_document(&document, false).expect("open");
    assert_eq!(rows_of(&reopened, artifact), expected_rows);
}

#[test]
#[ignore = "runs the pinned runtime under .tmp/m91-runtime"]
fn a_copy_that_fits_once_crash_left_scratch_is_reclaimed_is_not_refused() {
    let area = WorkArea::new("reclaim-real");
    let elsewhere = Scratch::new("m93-reclaim-real");
    let (plan, source, _) =
        cross_volume_order_parts(&area, &elsewhere, &plain(), recipe::ADAPTER_SOURCE);
    let supervisor = real();
    fs::create_dir_all(&supervisor.attempts).expect("attempts root");
    // A crash-left copy holding 256 MiB of the work area's volume.
    let crashed = crash_left(&supervisor.attempts, 0xFFFF_FFFD);
    let held_back: u64 = 256 * 1024 * 1024;
    fs::OpenOptions::new()
        .write(true)
        .open(crashed.join(SNAPSHOT_NAME))
        .expect("the crash-left copy")
        .set_len(held_back)
        .expect("allocated");
    let free = crate::local_document::available_bytes(&supervisor.attempts).expect("free space");

    // A plan that fits only once that space is back, with room for the
    // volume's other writers meanwhile; and one that fits in neither case.
    let mut fits_after = plan.clone();
    // Half the held-back space either way, for other writers on the volume.
    fits_after.expected_content[0].byte_length = free + held_back / 2;
    assert_eq!(supervisor.preflight(&fits_after, &source), Ok(()));
    assert!(!crashed.exists(), "the crash-left copy was reclaimed first");

    let mut never = plan;
    never.expected_content[0].byte_length = u64::MAX / 2;
    assert_eq!(
        supervisor.preflight(&never, &source),
        Err(ProjectError::InsufficientWorkAreaSpace)
    );
}

/// A crash-left attempt directory, as a session that died mid-attempt leaves
/// it: marked, its owner long gone, holding a copy.
fn crash_left(root: &Path, owner_process_id: u32) -> PathBuf {
    let name = uuid::Uuid::new_v4().to_string();
    let directory = root.join(&name);
    fs::create_dir_all(directory.join("out")).expect("directory");
    fs::write(
        directory.join("owner.json"),
        format!(
            "{{\"schema\":\"mscanvas.targetedMs1.attemptScratch/1\",\"attemptId\":\"{name}\",\
\"ownerProcessId\":{owner_process_id},\"ownerProcessCreated\":1}}"
        ),
    )
    .expect("marker");
    fs::write(directory.join(SNAPSHOT_NAME), vec![b'x'; 1024 * 1024]).expect("copy");
    fs::write(directory.join("out").join("events.jsonl"), b"{}\n").expect("output");
    directory
}

#[test]
#[ignore = "runs the pinned runtime under .tmp/m91-runtime"]
fn an_attempt_removes_crash_left_scratch_and_nothing_it_cannot_prove_is_its_own() {
    let area = WorkArea::new("crash-left");
    let (store, layer, _) = real_project(&area, "plain.mzML", &mzml(&plain(), ""));
    let supervisor = real();
    fs::create_dir_all(&supervisor.attempts).expect("attempts root");
    let before = attempt_entries(&supervisor);
    // Process ids are multiples of four; no process has this one.
    let crashed = crash_left(&supervisor.attempts, 0xFFFF_FFFD);
    // Beside it, what looks like an attempt and is not provably one.
    let unmarked = supervisor.attempts.join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&unmarked).expect("unmarked");
    fs::write(unmarked.join(SNAPSHOT_NAME), b"not ours to remove").expect("file");
    // This process's id with another creation time: a reused id, owner gone.
    let reused = crash_left(&supervisor.attempts, std::process::id());

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
        execution_of(&store)
            .attempt
            .map(|attempt| attempt.source_view),
        Some(SourceView::HardLinkInWorkArea),
        "a source on the work area's volume is still linked, not copied"
    );
    assert!(
        !crashed.exists(),
        "crash-left scratch whose owner is gone is removed"
    );
    assert!(!reused.exists(), "and so is one whose id was reused");
    assert_eq!(
        fs::read(unmarked.join(SNAPSHOT_NAME)).expect("kept"),
        b"not ours to remove"
    );
    fs::remove_dir_all(&unmarked).expect("the test's own fixture");
    assert_eq!(
        attempt_entries(&supervisor),
        before,
        "the run's own link attempt left nothing"
    );
    // The published result is outside the work area and untouched by it.
    assert_eq!(
        store.describe().artifacts[0]
            .targeted_ms1
            .as_ref()
            .expect("result")
            .availability,
        "available"
    );
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
    let store = area.join("results");
    fs::create_dir_all(&store).expect("store");
    (plan_over(&source, adapter), source, store)
}

/// A plan over the file at `source` as it is now, bound to `adapter`.
fn plan_over(source: &Path, adapter: &'static [u8]) -> TargetedMs1Plan {
    // Streamed, so a measurement over a large fixture is not a measurement of
    // this helper reading it whole.
    let digest = mscanvas_proteowizard::Sha256Digest::calculate_file(source)
        .expect("digest")
        .to_string();
    let byte_length = fs::metadata(source).expect("source").len();
    let input = record::InputRecord {
        id: InputId::new(),
        label: "plain.mzML".to_owned(),
        locator: record::Locator::LocalAbsolute {
            path: source.to_path_buf(),
        },
        members: vec![record::MemberRecord {
            role: MemberRole::Primary,
            relative_name: String::new(),
            baseline: record::ContentBaseline {
                byte_length,
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
    recipe::resolve(
        &layer,
        &input,
        &draft(vec![target("caffeine", CAFFEINE, "60", "20")]),
        binding,
    )
    .expect("a plan")
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

    // M9.2: the copy is drawn and tabulated with the source still away and no
    // runtime asked for, through the same settings, renderer, rasterizer and
    // table builder the commands use. Each output is written under
    // `test-results/m92-real/` for inspection; none names a path.
    let settings = crate::preview::dto::FigureSettingsDto {
        width_px: 1_200,
        height_px: 640,
        png_dpi: 300,
        theme: "light".to_owned(),
    };
    let figure_output =
        crate::preview::scientific_output::FigureOutput::from_wire(&settings).expect("settings");
    let resolution = figure_output
        .png_resolution(&settings)
        .expect("a PNG resolution");
    let evidence_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .expect("the repository root")
        .join("test-results")
        .join("m92-real");
    fs::create_dir_all(&evidence_dir).expect("the evidence folder");
    let private = [
        document
            .parent()
            .expect("the work area")
            .to_string_lossy()
            .into_owned(),
        source.to_string_lossy().into_owned(),
        ".tmp".to_owned(),
        "m91-".to_owned(),
    ];
    let leaks = |text: &str| {
        private
            .iter()
            .any(|fragment| text.contains(fragment.as_str()))
    };
    let (rows, _) = &before;
    let mut drawn = 0;
    for (position, (target, row)) in plan.targets.iter().zip(rows).enumerate() {
        let answer = copied.targeted_evidence_figure(
            artifact,
            target.target_id,
            figure_output.size(),
            figure_output.theme(),
        );
        if row.ion.is_none() {
            assert!(matches!(
                answer,
                Err(crate::project::TargetedFigureRefusal::NotExtracted)
            ));
            continue;
        }
        let (figure, index) = answer.expect("a stored target draws");
        assert_eq!(index, position);
        let svg = mscanvas_plot_spec::svg::render(&figure);
        let (again, _) = copied
            .targeted_evidence_figure(
                artifact,
                target.target_id,
                figure_output.size(),
                figure_output.theme(),
            )
            .expect("drawn again");
        assert_eq!(
            mscanvas_plot_spec::svg::render(&again),
            svg,
            "deterministic"
        );
        assert!(svg.contains("Targeted MS1 lookup (experimental)"));
        assert!(!leaks(&svg), "the figure names no private path");
        let png = figure_output.png(&figure, resolution).expect("a PNG");
        assert!(png.starts_with(b"\x89PNG\r\n\x1a\n"));
        fs::write(
            evidence_dir.join(format!("target-{}.svg", position + 1)),
            &svg,
        )
        .expect("svg");
        fs::write(
            evidence_dir.join(format!("target-{}.png", position + 1)),
            &png,
        )
        .expect("png");
        drawn += 1;
    }
    assert!(drawn > 0, "at least one real target reached extraction");
    let stored = copied.stored_targeted_result(artifact).expect("stored");
    for format in [TableFormat::Csv, TableFormat::Tsv] {
        let (table, count) = result_table(&stored, format).expect("a table");
        assert_eq!(count, plan.targets.len());
        assert_eq!(result_table(&stored, format).expect("again").0, table);
        assert!(!leaks(&table), "the table names no private path");
        assert!(table.contains(&format!("{artifact}")));
        let name = match format {
            TableFormat::Csv => "results.csv",
            TableFormat::Tsv => "results.tsv",
        };
        fs::write(evidence_dir.join(name), &table).expect("table");
    }
    // Reading, drawing and tabulating recorded nothing and changed nothing.
    let after = copied.describe();
    assert_eq!((after.runs.len(), after.artifacts.len()), (1, 1));
    assert_eq!(after.runs[0].targeted_ms1, execution_before);
    assert!(!after.dirty);
    assert_eq!(everything(&copied, artifact, &plan), before);
}

// ---------------------------------------------------------------------------
// M9.2: a stored result as a figure and as a table
//
// The builders are pure functions of the stored result, so each outcome's
// figure and row is checked against a row this file writes: what the payload
// holds is exactly what comes out, and nothing else does.
// ---------------------------------------------------------------------------

use crate::project::payload::{
    IntensitySource, RowCandidate, RowFeature, RowIon, RowRelations, RowSignal, RowWindows,
};
use crate::project::record::TargetId;
use crate::project::targeted_output::{
    self as output, EvidenceRefusal, StoredResult, TABLE_COLUMNS, TableFormat, TableRefusal,
    evidence_figure, figure_text, result_table,
};
use mscanvas_plot_spec::spec::{FigureSize, FigureTheme, IntervalRole};

/// A saved result of three targets, as a fresh store reads it back.
fn stored_three(scratch: &Scratch) -> (ProjectStore, StoredResult) {
    let (store, layer, _) = fake_project(scratch);
    let executor = Fake::new(completed);
    let plan = plan(
        &store,
        layer,
        vec![
            target("Caffeine, the \"one\"", CAFFEINE, "60", "20"),
            target("咖啡因 · 标准品", ADENINE, "40.5", "10"),
            target("#hash first", TYROSINE, "80", "10"),
        ],
        &executor,
    );
    let end = run(&store, &plan, &executor).expect("run");
    store.save().expect("save");
    let stored = store
        .stored_targeted_result(end.artifact.expect("result"))
        .expect("stored");
    (store, stored)
}

fn size() -> FigureSize {
    FigureSize::new(1_200.0, 640.0).expect("a size")
}

const RTS: [f64; 5] = [100.0, 110.0, 120.0, 130.0, 140.0];
const M0: [f64; 5] = [0.0, 500.0, 2_000.0, 400.0, 0.0];

fn extracted_row(target: TargetId, outcome: RowOutcome) -> payload::PayloadRow {
    payload::PayloadRow {
        target_id: target,
        outcome,
        failure_reason: None,
        edge_trace_count: 0,
        ion: Some(RowIon {
            adduct: "[M+H]+".to_owned(),
            charge: 1,
            mz_theoretical: vec![195.087_7, 196.091_1],
            isotope_probability: vec![0.9, 0.1],
        }),
        windows: Some(RowWindows {
            rt_closed_s: [90.0, 150.0],
            mz_open: vec![[195.086_7, 195.088_7], [196.090_1, 196.092_1]],
        }),
        signal: Some(RowSignal {
            points: 5,
            sum: vec![2_900.0, 290.0],
            max: vec![2_000.0, 200.0],
            any_nonzero_point: true,
        }),
        feature: None,
        candidates: Vec::new(),
        overlap_winner: false,
        relations: RowRelations {
            shared_with: Vec::new(),
            suppressed_by: None,
            overlap_removed: Vec::new(),
        },
        recovered_from_empty_selection: false,
    }
}

fn feature(left: f64, right: f64, source: IntensitySource) -> RowFeature {
    RowFeature {
        apex_rt_s: 120.0,
        left_s: left,
        right_s: right,
        raw_area: 21_000.5,
        model_status: "0 (converged)".to_owned(),
        model_area: Some(20_500.25),
        model_fwhm_s: None,
        engine_intensity: Some(20_500.25),
        engine_intensity_source: source,
    }
}

fn candidate(left: f64, right: f64) -> RowCandidate {
    RowCandidate {
        apex_rt_s: f64::midpoint(left, right),
        left_s: left,
        right_s: right,
        raw_area: 10.0,
    }
}

fn evidence_of(target: TargetId) -> Vec<payload::EvidenceLine> {
    [(0_u8, 195.087_7, 1.0), (1, 196.091_1, 0.1)]
        .into_iter()
        .map(|(trace, mz, scale)| payload::EvidenceLine {
            target_id: target,
            trace,
            mz_theoretical: mz,
            points: RTS
                .iter()
                .zip(M0)
                .enumerate()
                .map(|(index, (rt, value))| (10 + index as u32, *rt, value * scale))
                .collect(),
        })
        .collect()
}

#[test]
fn the_figure_draws_exactly_the_stored_points_window_feature_and_candidates() {
    let scratch = Scratch::new("m92-figure");
    let (_store, mut stored) = stored_three(&scratch);
    let target = stored.plan.targets[0].target_id;
    let mut row = extracted_row(target, RowOutcome::DetectedAmbiguous);
    row.feature = Some(feature(114.0, 126.0, IntensitySource::ModelArea));
    row.candidates = vec![candidate(114.0, 126.0), candidate(95.0, 99.0)];
    stored.rows[0] = row;

    let figure = evidence_figure(
        &stored,
        target,
        &evidence_of(target),
        size(),
        FigureTheme::Light,
    )
    .expect("a figure");
    let panel = &figure.panels()[0];
    let m = &panel.series()[0];
    let m1 = &panel.series()[1];
    assert_eq!(m.x(), RTS.as_slice());
    assert_eq!(m.y(), M0.as_slice());
    assert_eq!(m1.y(), M0.map(|value| value * 0.1).as_slice());
    assert!(m.marks_samples() && m1.marks_samples());
    assert_eq!(m.id().as_str(), "M (m/z 195.0877)");
    let intervals: Vec<(IntervalRole, f64, f64)> = panel
        .intervals()
        .iter()
        .map(|interval| (interval.role(), interval.low(), interval.high()))
        .collect();
    // The window, the selected feature, and only the candidate that is not it.
    assert_eq!(
        intervals,
        vec![
            (IntervalRole::Window, 90.0, 150.0),
            (IntervalRole::Selected, 114.0, 126.0),
            (IntervalRole::Considered, 95.0, 99.0),
        ]
    );
    assert_eq!(panel.markers()[0].at(), 120.0);
    // The domain is the hull of everything drawn, the window included.
    assert_eq!(
        (panel.full_domain().low(), panel.full_domain().high()),
        (90.0, 150.0)
    );
    assert_eq!(
        figure.title().expect("a title").as_str(),
        "Caffeine, the \"one\" \u{2014} Detected (ambiguous)"
    );
    let caption = figure.caption().expect("a caption").as_str().to_owned();
    assert!(caption.contains("from 2 candidates"));
    assert!(caption.contains(&stored.artifact.to_string()));
    assert!(caption.contains(&stored.plan.plan_sha256));
    assert!(caption.contains("nothing was re-extracted"));
    // And it renders, the same bytes twice.
    let document = mscanvas_plot_spec::svg::render(&figure);
    assert_eq!(document, mscanvas_plot_spec::svg::render(&figure));
    assert!(document.contains(">Retention time (s)</text>"));
}

#[test]
fn each_outcome_keeps_its_meaning_in_the_figure() {
    let scratch = Scratch::new("m92-outcomes");
    let (_store, mut stored) = stored_three(&scratch);
    let target = stored.plan.targets[0].target_id;
    let partner = stored.plan.targets[1].target_id;
    let draw = |stored: &StoredResult| {
        evidence_figure(
            stored,
            target,
            &evidence_of(target),
            size(),
            FigureTheme::Light,
        )
        .expect("a figure")
    };
    let roles = |figure: &mscanvas_plot_spec::spec::FigureSpec| {
        figure.panels()[0]
            .intervals()
            .iter()
            .map(|interval| interval.role())
            .collect::<Vec<_>>()
    };

    // Not detected: the window only, and the words say it is not an absence.
    stored.rows[0] = extracted_row(target, RowOutcome::NotDetected);
    let figure = draw(&stored);
    assert_eq!(roles(&figure), vec![IntervalRole::Window]);
    assert!(figure.panels()[0].markers().is_empty());
    assert!(
        figure
            .caption()
            .expect("a caption")
            .as_str()
            .contains("not proof of absence")
    );

    // Failed with candidates: considered intervals, no selection, no outcome.
    let mut failed = extracted_row(target, RowOutcome::Failed);
    failed.failure_reason = Some(payload::RowFailure::EngineDiscardedNoValidFit);
    failed.candidates = vec![candidate(114.0, 126.0)];
    stored.rows[0] = failed;
    let figure = draw(&stored);
    assert_eq!(
        roles(&figure),
        vec![IntervalRole::Window, IntervalRole::Considered]
    );
    assert!(
        figure
            .title()
            .expect("a title")
            .as_str()
            .ends_with("Failed")
    );
    let caption = figure.caption().expect("a caption").as_str().to_owned();
    assert!(caption.contains("no valid fit"));
    assert!(caption.contains("claims no outcome"));

    // Suppressed: no feature of its own, so nothing is selected.
    let mut suppressed = extracted_row(target, RowOutcome::SuppressedByOverlap);
    suppressed.relations.suppressed_by = Some(partner);
    stored.rows[0] = suppressed;
    let figure = draw(&stored);
    assert_eq!(roles(&figure), vec![IntervalRole::Window]);
    assert!(
        figure
            .title()
            .expect("a title")
            .as_str()
            .ends_with("Suppressed by overlap")
    );

    // Shared: the shared feature is drawn and named as shared.
    let mut shared = extracted_row(target, RowOutcome::Shared);
    shared.feature = Some(feature(
        114.0,
        126.0,
        IntensitySource::ImputedFromRunRegression,
    ));
    shared.candidates = vec![candidate(114.0, 126.0)];
    shared.relations.shared_with = vec![partner];
    stored.rows[0] = shared;
    let figure = draw(&stored);
    assert_eq!(
        roles(&figure),
        vec![IntervalRole::Window, IntervalRole::Selected]
    );
    assert_eq!(
        figure.panels()[0].intervals()[1]
            .label()
            .expect("a label")
            .as_str(),
        "Shared feature"
    );
    assert!(
        figure
            .caption()
            .expect("a caption")
            .as_str()
            .contains("1 other target of this plan")
    );
}

#[test]
fn a_target_with_nothing_extracted_or_evidence_that_disagrees_is_refused() {
    let scratch = Scratch::new("m92-refused");
    let (_store, mut stored) = stored_three(&scratch);
    let target = stored.plan.targets[0].target_id;
    let mut absent = extracted_row(target, RowOutcome::Failed);
    absent.failure_reason = Some(payload::RowFailure::TargetAbsentFromEngineLibrary);
    absent.ion = None;
    absent.windows = None;
    absent.signal = None;
    stored.rows[0] = absent;
    assert_eq!(
        evidence_figure(&stored, target, &[], size(), FigureTheme::Light).unwrap_err(),
        EvidenceRefusal::NotExtracted
    );

    stored.rows[0] = extracted_row(target, RowOutcome::NotDetected);
    let mut short = evidence_of(target);
    short[1].points.pop();
    assert_eq!(
        evidence_figure(&stored, target, &short, size(), FigureTheme::Light).unwrap_err(),
        EvidenceRefusal::Mismatch
    );
    assert_eq!(
        evidence_figure(
            &stored,
            target,
            &evidence_of(target)[..1],
            size(),
            FigureTheme::Light
        )
        .unwrap_err(),
        EvidenceRefusal::Mismatch
    );
}

#[test]
fn a_window_that_held_no_spectrum_is_drawn_empty_and_said_to_be() {
    let scratch = Scratch::new("m92-empty-window");
    let (_store, mut stored) = stored_three(&scratch);
    let target = stored.plan.targets[0].target_id;
    let mut empty = extracted_row(target, RowOutcome::Failed);
    empty.failure_reason = Some(payload::RowFailure::WindowWithoutMs1Peaks);
    empty.signal = Some(RowSignal {
        points: 0,
        sum: vec![0.0, 0.0],
        max: vec![0.0, 0.0],
        any_nonzero_point: false,
    });
    stored.rows[0] = empty;
    let lines: Vec<payload::EvidenceLine> = evidence_of(target)
        .into_iter()
        .map(|mut line| {
            line.points.clear();
            line
        })
        .collect();
    let figure =
        evidence_figure(&stored, target, &lines, size(), FigureTheme::Light).expect("a figure");
    let document = mscanvas_plot_spec::svg::render(&figure);
    assert!(document.contains("carries no points, so nothing is drawn for it"));
    assert!(document.contains("no MS1 spectrum with peaks lies in the window"));
}

#[test]
fn user_text_reaches_a_figure_bounded_and_carryable() {
    let scratch = Scratch::new("m92-text");
    let (_store, mut stored) = stored_three(&scratch);
    let target = stored.plan.targets[0].target_id;
    // The longest label a plan stores, with a character XML cannot carry.
    stored.plan.targets[0].label = format!("{}\u{FFFE}{}", "a".repeat(100), "b".repeat(99));
    stored.plan.targets[0].formula = "C".repeat(100);
    let mut failed = extracted_row(target, RowOutcome::Failed);
    failed.failure_reason = Some(payload::RowFailure::TargetUnaccounted);
    stored.rows[0] = failed;
    let figure = evidence_figure(
        &stored,
        target,
        &evidence_of(target),
        size(),
        FigureTheme::Light,
    )
    .expect("a long label still draws");
    let title = figure.title().expect("a title").as_str();
    assert!(title.chars().count() <= mscanvas_plot_spec::spec::MAX_LABEL_CHARS);
    assert!(title.contains('\u{FFFD}') && title.contains('\u{2026}'));
    assert!(title.ends_with("Failed"));
    let caption = figure.caption().expect("a caption").as_str();
    assert!(caption.chars().count() <= mscanvas_plot_spec::spec::MAX_CAPTION_CHARS);
    assert!(caption.contains(&stored.plan.plan_sha256));
    assert_eq!(figure_text("  x\u{7}y ", 10), "x\u{FFFD}y");
}

/// The rows of a table, split on the delimiter, preamble dropped.
fn records(table: &str, delimiter: char) -> Vec<Vec<String>> {
    table
        .lines()
        .filter(|line| !line.starts_with('#'))
        .map(|line| line.split(delimiter).map(str::to_owned).collect())
        .collect()
}

#[test]
fn the_table_keeps_its_column_contract_provenance_and_plan_order() {
    let scratch = Scratch::new("m92-table");
    let (_store, stored) = stored_three(&scratch);
    let (tsv, count) = result_table(&stored, TableFormat::Tsv).expect("a table");
    assert_eq!(count, 3);
    assert!(tsv.ends_with('\n') && !tsv.contains('\r') && !tsv.starts_with('\u{FEFF}'));
    let preamble: Vec<&str> = tsv
        .lines()
        .take_while(|line| line.starts_with('#'))
        .collect();
    let keys: Vec<&str> = preamble
        .iter()
        .map(|line| line[1..].split('\t').next().unwrap_or_default())
        .collect();
    assert_eq!(
        keys,
        [
            "format",
            "schema_version",
            "recipe",
            "recipe_version",
            "artifact_id",
            "run_id",
            "plan_sha256",
            "target_list_sha256",
            "mz_half_width_ppm",
            "expected_peak_width_s",
            "source_byte_length",
            "source_sha256",
            "adapter_sha256",
            "engine_profile_sha256",
            "runtime_manifest_sha256",
            "engine_pyopenms",
            "engine_openms",
            "engine_openms_revision",
            "payload_manifest_sha256",
            "target_count",
            "row_order",
            "retention_time_unit",
            "intensity_unit",
        ]
    );
    assert!(preamble.contains(&"#format\tmscanvas_targeted_ms1_results"));
    assert!(preamble.contains(&"#schema_version\t1"));
    assert!(preamble.contains(&format!("#artifact_id\t{}", stored.artifact).as_str()));
    assert!(preamble.contains(&format!("#plan_sha256\t{}", stored.plan.plan_sha256).as_str()));
    // The plan's text exactly as recorded, not a number printed again.
    assert!(preamble.contains(&"#mz_half_width_ppm\t5"));
    // No location of anything: no drive, no separator, no project name.
    assert!(!tsv.contains(":\\") && !tsv.contains("study"));

    let rows = records(&tsv, '\t');
    assert_eq!(rows[0], TABLE_COLUMNS.map(str::to_owned).to_vec());
    for (index, (row, target)) in rows[1..].iter().zip(&stored.plan.targets).enumerate() {
        assert_eq!(row.len(), TABLE_COLUMNS.len());
        assert_eq!(row[0], target.target_id.to_string());
        assert_eq!(row[1], (index + 1).to_string());
        assert_eq!(row[2], target.label);
    }
    // The leading-# label is not a comment: its line starts with an identifier.
    assert_eq!(rows[3][2], "#hash first");
    assert_eq!(rows[2][2], "咖啡因 · 标准品");
    assert_eq!(rows[2][5], "40.5");
}

#[test]
fn a_failed_or_absent_value_is_an_empty_cell_never_a_zero() {
    let scratch = Scratch::new("m92-empty-cells");
    let (_store, mut stored) = stored_three(&scratch);
    let first = stored.plan.targets[0].target_id;
    let second = stored.plan.targets[1].target_id;
    let third = stored.plan.targets[2].target_id;
    let mut detected = extracted_row(first, RowOutcome::Detected);
    detected.feature = Some(feature(
        114.0,
        126.0,
        IntensitySource::ImputedFromRunRegression,
    ));
    detected.candidates = vec![candidate(114.0, 126.0)];
    stored.rows[0] = detected;
    let mut absent = extracted_row(second, RowOutcome::Failed);
    absent.failure_reason = Some(payload::RowFailure::TargetAbsentFromEngineLibrary);
    absent.ion = None;
    absent.windows = None;
    absent.signal = None;
    stored.rows[1] = absent;
    let mut failed = extracted_row(third, RowOutcome::Failed);
    failed.failure_reason = Some(payload::RowFailure::EngineDiscardedNoValidFit);
    failed.candidates = vec![candidate(100.0, 104.0)];
    stored.rows[2] = failed;

    let (csv, _) = result_table(&stored, TableFormat::Csv).expect("a table");
    let column = |name: &str| {
        TABLE_COLUMNS
            .iter()
            .position(|column| *column == name)
            .expect("a column")
    };
    let lines: Vec<&str> = csv.lines().filter(|line| !line.starts_with('#')).collect();
    // The first label holds a comma and quotes, so its line is quoted; split
    // the other two, which hold neither.
    assert!(lines[1].contains("\"Caffeine, the \"\"one\"\"\""));
    let second_row: Vec<&str> = lines[2].split(',').collect();
    let third_row: Vec<&str> = lines[3].split(',').collect();
    for name in [
        "extracted_points",
        "candidate_count",
        "edge_trace_count",
        "mz_theoretical_m",
        "rt_window_low_s",
        "raw_area",
        "engine_intensity",
    ] {
        assert_eq!(
            second_row[column(name)],
            "",
            "{name} of a target never extracted"
        );
    }
    assert_eq!(second_row[column("outcome")], "FAILED");
    assert_eq!(
        second_row[column("failure_reason")],
        "TARGET_ABSENT_FROM_ENGINE_LIBRARY"
    );
    for name in [
        "raw_area",
        "engine_intensity",
        "feature_apex_rt_s",
        "model_status",
    ] {
        assert_eq!(third_row[column(name)], "", "{name} of a failed target");
    }
    assert_eq!(third_row[column("candidate_count")], "1");
    assert_eq!(third_row[column("extracted_points")], "5");
    // The first row, once its quoted label is past: imputed stays imputed.
    let after_label = lines[1].split("\"\"\",").nth(1).expect("the rest");
    let first_row: Vec<&str> = after_label.split(',').collect();
    let offset = column("label") + 1;
    assert_eq!(
        first_row[column("engine_intensity_source") - offset],
        "imputedFromRunRegression"
    );
    assert_eq!(first_row[column("raw_area") - offset], "21000.5");
    assert_eq!(first_row[column("model_fwhm_s") - offset], "");
    assert_eq!(first_row[column("outcome") - offset], "DETECTED");
}

#[test]
fn a_window_that_held_no_spectrum_writes_no_signal_values() {
    let scratch = Scratch::new("m92-no-spectrum-cells");
    let (_store, mut stored) = stored_three(&scratch);
    let target = stored.plan.targets[1].target_id;
    let mut empty = extracted_row(target, RowOutcome::Failed);
    empty.failure_reason = Some(payload::RowFailure::WindowWithoutMs1Peaks);
    // What the adapter stores for a window no spectrum fell into: zero
    // points, and sums and maxima that are its empty defaults.
    empty.signal = Some(RowSignal {
        points: 0,
        sum: vec![0.0, 0.0],
        max: vec![0.0, 0.0],
        any_nonzero_point: false,
    });
    empty.feature = None;
    empty.candidates = Vec::new();
    assert!(empty.is_consistent(), "the shape M9.1 publishes for it");
    stored.rows[1] = empty;

    let (tsv, _) = result_table(&stored, TableFormat::Tsv).expect("a table");
    let column = |name: &str| {
        TABLE_COLUMNS
            .iter()
            .position(|column| *column == name)
            .expect("a column")
    };
    let lines: Vec<&str> = tsv.lines().filter(|line| !line.starts_with('#')).collect();
    let row: Vec<&str> = lines[2].split('\t').collect();
    assert_eq!(row[column("failure_reason")], "WINDOW_WITHOUT_MS1_PEAKS");
    assert_eq!(row[column("extracted_points")], "0", "a count, and zero");
    for name in [
        "signal_sum_m",
        "signal_sum_m1",
        "signal_max_m",
        "signal_max_m1",
    ] {
        assert_eq!(
            row[column(name)],
            "",
            "{name} of a window that held nothing"
        );
    }
    // The first target's window held spectra, so its values are written.
    let first: Vec<&str> = lines[1].split('\t').collect();
    assert_ne!(first[column("signal_max_m")], "");
}

#[test]
fn rows_that_no_longer_fit_their_plan_are_not_its_result() {
    let scratch = Scratch::new("m92-rows-fit");
    let (_store, stored) = stored_three(&scratch);
    let plan = &stored.plan;
    let rows = stored.rows.clone();
    assert!(output::rows_fit_plan(plan, rows.len(), &rows));

    let mut reordered = rows.clone();
    reordered.swap(0, 1);
    assert!(!output::rows_fit_plan(plan, reordered.len(), &reordered));
    assert!(!output::rows_fit_plan(plan, 2, &rows[..2]), "a row missing");
    assert!(
        !output::rows_fit_plan(plan, 3, &rows[..2]),
        "fewer read than reported"
    );
    let mut extra = rows.clone();
    extra.push(rows[0].clone());
    assert!(!output::rows_fit_plan(plan, extra.len(), &extra));
    let mut broken = rows.clone();
    broken[2].outcome = RowOutcome::Detected;
    broken[2].feature = None;
    assert!(!broken[2].is_consistent(), "a detection with no feature");
    assert!(!output::rows_fit_plan(plan, broken.len(), &broken));
}

#[test]
fn a_tsv_refuses_a_field_it_cannot_carry_and_a_csv_quotes_it() {
    let scratch = Scratch::new("m92-tsv");
    let (_store, mut stored) = stored_three(&scratch);
    let target = stored.plan.targets[0].target_id;
    let mut odd = extracted_row(target, RowOutcome::Detected);
    let mut kept = feature(114.0, 126.0, IntensitySource::ModelArea);
    kept.model_status = "4 (right side\tout of bounds)".to_owned();
    odd.feature = Some(kept);
    odd.candidates = vec![candidate(114.0, 126.0)];
    stored.rows[0] = odd;
    assert_eq!(
        result_table(&stored, TableFormat::Tsv).unwrap_err(),
        TableRefusal::FieldNotRepresentable
    );
    assert!(result_table(&stored, TableFormat::Csv).is_ok());

    let mut three = extracted_row(target, RowOutcome::NotDetected);
    if let Some(ion) = three.ion.as_mut() {
        ion.mz_theoretical.push(197.0);
    }
    stored.rows[0] = three;
    assert_eq!(
        result_table(&stored, TableFormat::Csv).unwrap_err(),
        TableRefusal::UnexpectedTraceCount
    );
}

#[test]
fn the_tables_outcome_words_are_the_payloads_own() {
    let scratch = Scratch::new("m92-words");
    let (_store, mut stored) = stored_three(&scratch);
    let target = stored.plan.targets[0].target_id;
    for outcome in [
        RowOutcome::Detected,
        RowOutcome::DetectedAmbiguous,
        RowOutcome::Shared,
        RowOutcome::SuppressedByOverlap,
        RowOutcome::NotDetected,
        RowOutcome::Failed,
    ] {
        let mut row = extracted_row(target, outcome);
        if outcome == RowOutcome::Failed {
            row.failure_reason = Some(payload::RowFailure::TargetUnaccounted);
        }
        stored.rows[0] = row;
        let (tsv, _) = result_table(&stored, TableFormat::Tsv).expect("a table");
        let word = serde_json::to_string(&outcome).expect("a word");
        assert!(
            tsv.contains(&format!("\t{}\t", word.trim_matches('"'))),
            "{word}"
        );
    }
    // And the failure words, likewise.
    let reason = serde_json::to_string(&payload::RowFailure::TargetUnaccounted).expect("a word");
    let (tsv, _) = result_table(&stored, TableFormat::Tsv).expect("a table");
    assert!(tsv.contains(reason.trim_matches('"')));
    let _ = output::outcome_words(RowOutcome::Shared);
}

#[test]
fn a_stored_result_changed_on_disk_after_reopen_is_neither_drawn_nor_tabulated() {
    let scratch = Scratch::new("m92-changed-on-disk");
    let (store, document, artifact) = saved_with_result(&scratch);
    drop(store);
    let reopened = ProjectStore::new();
    reopened.open_document(&document, false).expect("open");
    let target = reopened
        .stored_targeted_result(artifact)
        .expect("whole")
        .plan
        .targets[0]
        .target_id;
    let directory = payload::store_of(&document)
        .expect("store")
        .join(artifact.to_string());
    let figure = |store: &ProjectStore| {
        store
            .targeted_evidence_figure(artifact, target, size(), FigureTheme::Light)
            .map(|_| ())
    };
    let refused_as = |availability: payload::Availability| {
        Err(crate::project::TargetedFigureRefusal::Project(
            ProjectError::PayloadUnavailable(availability),
        ))
    };
    // One digit, at the same length, so only the digest can tell.
    let one_digit_changed = |path: &Path| -> Vec<u8> {
        let original = fs::read(path).expect("read");
        let mut changed = original.clone();
        let at = changed.len() / 2
            + changed[changed.len() / 2..]
                .iter()
                .position(u8::is_ascii_digit)
                .expect("a digit");
        changed[at] = if changed[at] == b'9' {
            b'8'
        } else {
            changed[at] + 1
        };
        fs::write(path, &changed).expect("change");
        original
    };

    // The rows: neither the table nor the figure is built from them.
    let rows = directory.join("rows.jsonl");
    let original = one_digit_changed(&rows);
    assert_eq!(
        reopened.stored_targeted_result(artifact).err(),
        Some(ProjectError::PayloadUnavailable(
            payload::Availability::Corrupt
        ))
    );
    assert_eq!(
        figure(&reopened),
        refused_as(payload::Availability::Corrupt)
    );
    fs::write(&rows, &original).expect("restore");

    // The evidence: the figure is refused; the table, which is the rows
    // alone, is not.
    let evidence = directory.join("evidence.jsonl");
    let original = one_digit_changed(&evidence);
    assert_eq!(
        figure(&reopened),
        refused_as(payload::Availability::Corrupt)
    );
    let stored = reopened
        .stored_targeted_result(artifact)
        .expect("rows whole");
    assert!(result_table(&stored, TableFormat::Csv).is_ok());
    fs::write(&evidence, &original).expect("restore");
    assert_eq!(figure(&reopened), Ok(()));

    // Gone altogether: missing, not corrupt, and nothing regenerated.
    let away = directory.with_extension("away");
    fs::rename(&directory, &away).expect("move the result away");
    assert_eq!(
        reopened.stored_targeted_result(artifact).err(),
        Some(ProjectError::PayloadUnavailable(
            payload::Availability::Missing
        ))
    );
    assert_eq!(
        figure(&reopened),
        refused_as(payload::Availability::Missing)
    );
    assert!(!directory.exists());
    fs::rename(&away, &directory).expect("put it back");

    let described = reopened.describe();
    assert_eq!((described.runs.len(), described.artifacts.len()), (1, 1));
    assert!(!described.dirty);
}

#[test]
fn a_stored_result_whose_rows_no_longer_match_its_plan_is_corrupt() {
    let scratch = Scratch::new("m92-tampered");
    let (store, stored) = stored_three(&scratch);
    let rows = payload::store_of(&scratch.join("study.mscanvas"))
        .expect("store")
        .join(stored.artifact.to_string())
        .join("rows.jsonl");
    let bytes = fs::read(&rows).expect("rows");
    fs::write(&rows, &bytes[..bytes.len() - 2]).expect("tamper");
    assert!(matches!(
        store.stored_targeted_result(stored.artifact),
        Err(ProjectError::PayloadUnavailable(Availability::Corrupt))
    ));
    let target = stored.plan.targets[0].target_id;
    assert!(matches!(
        store.targeted_evidence_figure(stored.artifact, target, size(), FigureTheme::Light),
        Err(crate::project::TargetedFigureRefusal::Project(
            ProjectError::PayloadUnavailable(Availability::Corrupt)
        ))
    ));
    // Nothing regenerated anything, and nothing was recorded.
    assert_eq!(store.describe().runs.len(), 1);
}

#[test]
fn the_figure_a_screen_shows_is_the_figure_an_export_writes() {
    let scratch = Scratch::new("m92-same-figure");
    let (store, stored) = stored_three(&scratch);
    let target = stored.plan.targets[0].target_id;
    let draw = || {
        store
            .targeted_evidence_figure(stored.artifact, target, size(), FigureTheme::Light)
            .expect("a figure")
    };
    let (screen, position) = draw();
    let (export, _) = draw();
    assert_eq!(position, 0);
    assert_eq!(
        mscanvas_plot_spec::svg::render(&screen),
        mscanvas_plot_spec::svg::render(&export)
    );
    assert!(!store.describe().dirty);
}

#[test]
fn a_chosen_destination_is_written_new_named_as_its_format_and_never_over_a_file() {
    use crate::preview::dialog::SaveDialogFacts;
    use crate::preview::scientific_output::write_named;
    let scratch = Scratch::new("m92-write");
    let facts = SaveDialogFacts {
        title: "Export targeted MS1 results",
        filter_label: "Comma-separated values (*.csv)",
        filter_pattern: "*.csv",
        default_extension: "csv",
    };
    let destination = scratch.join("results.csv");
    assert_eq!(
        write_named(&destination, facts, b"a,b\n").expect("written"),
        "results.csv"
    );
    assert_eq!(fs::read(&destination).expect("bytes"), b"a,b\n");
    let taken = write_named(&destination, facts, b"other\n").unwrap_err();
    assert_eq!(taken.kind, "spectrum_destination_exists");
    assert_eq!(fs::read(&destination).expect("bytes"), b"a,b\n");
    let misnamed = write_named(&scratch.join("results.txt"), facts, b"x\n").unwrap_err();
    assert_eq!(misnamed.kind, "spectrum_destination_misnamed");
    assert!(!scratch.join("results.txt").exists());
}
