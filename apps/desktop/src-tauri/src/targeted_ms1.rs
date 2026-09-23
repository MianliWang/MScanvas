//! The targeted MS1 supervisor: the one place the recipe's worker is started.
//!
//! ## Why this is its own module
//!
//! The project store decides whether a run may start, holds the project still
//! while it runs, and records how it ended. Everything in between -- the
//! runtime, the work area, the source, the process and what it wrote -- is here,
//! behind [`RecipeExecutor`], so neither side grows the other's authority.
//!
//! ## What one attempt does
//!
//! 1. Checks every file of the runtime against the manifest this build pins.
//! 2. Makes a fresh attempt directory in the ASCII work area.
//! 3. Opens the source for reading, sharing reads only, and keeps it open for
//!    the whole attempt; hashes it through that handle and refuses bytes that
//!    are not the ones the plan expects.
//! 4. Makes a hard link to it in the attempt directory and shows the link is
//!    the pinned object. The engine is given that ASCII name; the source's own
//!    name, whatever characters it has, is never handed to it.
//! 5. Writes the typed request and the adapter this build ships, and checks the
//!    adapter's digest as written.
//! 6. Starts the pinned interpreter through the process supervisor, with a
//!    fixed argv, an allow-listed environment, a Job that allows one process
//!    and caps its memory, and a wall-clock budget.
//! 7. Releases the source after the worker has exited, removes the link, and
//!    validates everything the worker wrote before any of it is staged.
//!
//! ## What it is not
//!
//! Not a sandbox. The worker is one fixed, reviewed adapter, not untrusted
//! code. Nothing confines what it reads, and nothing confines the network: the
//! adapter makes no network call and the engine class it uses never reaches
//! OpenMS's update check, and that is a statement about the code, not an
//! enforced limit.
//!
//! ## Where the runtime is
//!
//! In a development build, under the repository's own `.tmp/m91-runtime/`, with
//! attempts under `.tmp/m91-jobs/`. A release build has no runtime location and
//! reports the recipe unavailable: bundling and redistributing the runtime is a
//! decision this milestone does not make.

#[cfg(test)]
mod tests;

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use mscanvas_proteowizard::{
    CommandSpec, ProcessError, ProcessOutput, Sha256Digest, Termination, WorkerLimits,
    execute_cancellable,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::local_document;
use crate::project::ProjectError;
use crate::project::observe::{self, Cancellation};
use crate::project::payload::{self, EvidenceLine, PayloadRow, RowFailure, RowOutcome};
use crate::project::recipe::{
    self, AttemptEnd, AttemptOrder, RUNTIME_MANIFEST_SHA256, RecipeExecutor, RunPhase,
};
use crate::project::record::{
    AttemptFacts, EngineReport, FailureCode, FailureStage, LoadedModule, MemberRole,
    ObservedMember, OutcomeSummary, RunFailure, SourceView, StopFacts, StopReason, TargetId,
    TargetedMs1Plan, TargetedMs1ResultV1,
};

/// The wall-clock budget one attempt gets, from launch.
const BUDGET: Duration = Duration::from_secs(600);
/// The most memory the worker's Job may commit.
const JOB_MEMORY_BYTES: u64 = 4 * 1024 * 1024 * 1024;
/// How often the monitor looks at the clock and at the worker's progress.
const MONITOR_INTERVAL: Duration = Duration::from_millis(100);
const REQUEST_SCHEMA: &str = "mscanvas.targetedMs1.request/1";
const RESULT_SCHEMA: &str = "mscanvas.targetedMs1.result/1";
const MANIFEST_SCHEMA: &str = "mscanvas.analysisRuntimeManifest/1";
/// The largest runtime manifest this build reads.
const MAX_MANIFEST_BYTES: u64 = 8 * 1024 * 1024;
/// The largest `result.json` or `outcome.json` this build reads.
const MAX_REPORT_BYTES: u64 = 1024 * 1024;
/// The modules whose files must be among those the worker reports loaded.
const REQUIRED_MODULES: [&str; 4] = [
    "python313.dll",
    "site-packages/pyopenms/openms.dll",
    "site-packages/pyopenms/openswathalgo.dll",
    "site-packages/pyopenms/qt6core.dll",
];

/// The recipe's executor in a build that has a runtime location, and a refusal
/// in one that does not.
#[must_use]
pub fn executor() -> Box<dyn RecipeExecutor> {
    match Supervisor::development() {
        Some(supervisor) => Box::new(supervisor),
        None => Box::new(Unavailable),
    }
}

/// The executor of a build with no runtime: every run is refused before it
/// exists.
pub struct Unavailable;

impl RecipeExecutor for Unavailable {
    fn preflight(&self, _plan: &TargetedMs1Plan, _source: &Path) -> Result<(), ProjectError> {
        Err(ProjectError::RecipeUnavailable)
    }

    fn attempt(
        &self,
        _order: &AttemptOrder<'_>,
        _cancellation: &Cancellation,
        _progress: &(dyn Fn(RunPhase) + Sync),
    ) -> AttemptEnd {
        failed(
            Vec::new(),
            None,
            FailureCode::RuntimeUnverified,
            FailureStage::Runtime,
        )
    }
}

/// The supervisor of one runtime, one work area and one adapter.
pub struct Supervisor {
    runtime: PathBuf,
    manifest: PathBuf,
    attempts: PathBuf,
    adapter: &'static [u8],
    adapter_sha256: String,
    budget: Duration,
}

impl Supervisor {
    /// The development runtime and work area under this repository's `.tmp`.
    ///
    /// `None` in a release build, and where the repository's path is not
    /// ASCII: the engine fails on a non-ASCII runtime path, and the work area
    /// is where the ASCII name for the source is made.
    #[must_use]
    pub fn development() -> Option<Self> {
        let scratch = development_scratch()?;
        Self::at(&scratch, recipe::ADAPTER_SOURCE, BUDGET)
    }

    fn at(scratch: &Path, adapter: &'static [u8], budget: Duration) -> Option<Self> {
        if !scratch.to_str().is_some_and(str::is_ascii) {
            return None;
        }
        let adapter_sha256 = Sha256Digest::calculate(adapter).ok()?.to_string();
        Some(Self {
            runtime: scratch.join("m91-runtime").join("cpython-3.13.15-embed"),
            manifest: scratch.join("m91-runtime").join("runtime-manifest.json"),
            attempts: scratch.join("m91-jobs").join("attempts"),
            adapter,
            adapter_sha256,
            budget,
        })
    }
}

/// The repository's scratch directory, in a development build.
#[cfg(debug_assertions)]
fn development_scratch() -> Option<PathBuf> {
    // `CARGO_MANIFEST_DIR` is `apps/desktop/src-tauri`; the repository is three
    // levels up. A plain drive-letter path, never a `\\?\` one: the worker is
    // handed paths below it, and the interpreter and engine were measured
    // with plain paths only.
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .map(|root| root.join(".tmp"))
}

#[cfg(not(debug_assertions))]
fn development_scratch() -> Option<PathBuf> {
    None
}

impl RecipeExecutor for Supervisor {
    fn preflight(&self, plan: &TargetedMs1Plan, source: &Path) -> Result<(), ProjectError> {
        if plan.recipe.adapter_sha256 != self.adapter_sha256
            || plan.recipe.runtime_manifest_sha256 != RUNTIME_MANIFEST_SHA256
        {
            return Err(ProjectError::PlanNotCurrent);
        }
        if !pinned_manifest_is_present(&self.manifest) || !self.runtime.join("python.exe").is_file()
        {
            return Err(ProjectError::RecipeUnavailable);
        }
        fs::create_dir_all(&self.attempts).map_err(|_| ProjectError::RecipeUnavailable)?;
        // Refused only on a proven difference. Where either volume cannot be
        // established -- the source is missing, busy or unreadable -- the
        // attempt goes ahead and its pinned read records the real reason.
        if let (Some(work), Some((volume, _))) = (
            local_document::directory_volume(&self.attempts),
            local_document::object_identity(source),
        ) && work != volume
        {
            return Err(ProjectError::SourceOnAnotherVolume);
        }
        Ok(())
    }

    fn attempt(
        &self,
        order: &AttemptOrder<'_>,
        cancellation: &Cancellation,
        progress: &(dyn Fn(RunPhase) + Sync),
    ) -> AttemptEnd {
        progress(RunPhase::VerifyingRuntime);
        let Ok(manifest) = verify_runtime(&self.runtime, &self.manifest, RUNTIME_MANIFEST_SHA256)
        else {
            return failed(
                Vec::new(),
                None,
                FailureCode::RuntimeUnverified,
                FailureStage::Runtime,
            );
        };
        if cancellation.requested() {
            return cancelled_before_launch(Vec::new(), None);
        }
        let Some(directory) = AttemptDirectory::create(&self.attempts) else {
            return failed(
                Vec::new(),
                None,
                FailureCode::ExecutionViewUnavailable,
                FailureStage::Source,
            );
        };
        self.attempt_in(order, cancellation, progress, &manifest, &directory)
    }
}

impl Supervisor {
    fn attempt_in(
        &self,
        order: &AttemptOrder<'_>,
        cancellation: &Cancellation,
        progress: &(dyn Fn(RunPhase) + Sync),
        manifest: &BTreeMap<String, String>,
        directory: &AttemptDirectory,
    ) -> AttemptEnd {
        progress(RunPhase::PinningSource);
        // Held until the worker has exited: while it is, the source cannot be
        // opened for writing, renamed or deleted by its name, so the bytes the
        // worker reads are the bytes hashed here.
        let held = match observe::hold_member(order.source, cancellation) {
            Ok(held) => held,
            Err(_) if cancellation.requested() => return cancelled_before_launch(Vec::new(), None),
            Err(_) => {
                return failed(
                    Vec::new(),
                    None,
                    FailureCode::SourceUnavailable,
                    FailureStage::Source,
                );
            }
        };
        let consumed = vec![ObservedMember {
            role: MemberRole::Primary,
            relative_name: String::new(),
            byte_length: held.byte_length,
            sha256: held.digest.to_string(),
        }];
        if consumed != order.plan.expected_content {
            return failed(
                consumed,
                None,
                FailureCode::SourceChanged,
                FailureStage::Source,
            );
        }
        let link = directory.path.join("source.mzML");
        if fs::hard_link(order.source, &link).is_err()
            || held.identity.is_none()
            || local_document::object_identity(&link) != held.identity
        {
            return failed(
                consumed,
                None,
                FailureCode::ExecutionViewUnavailable,
                FailureStage::Source,
            );
        }
        let Some(interpreter) = manifest
            .get("python.exe")
            .and_then(|digest| digest.parse::<Sha256Digest>().ok())
        else {
            return failed(
                consumed,
                None,
                FailureCode::RuntimeUnverified,
                FailureStage::Runtime,
            );
        };
        let facts = AttemptFacts {
            adapter_sha256: self.adapter_sha256.clone(),
            runtime_manifest_sha256: RUNTIME_MANIFEST_SHA256.to_owned(),
            interpreter_sha256: interpreter.to_string(),
            source_view: SourceView::HardLinkInWorkArea,
            engine_report: None,
            loaded_modules: Vec::new(),
        };
        let adapter = directory.path.join("adapter_v1.py");
        let request = directory.path.join("request.json");
        let out = directory.path.join("out");
        let prepared = write_new(&adapter, self.adapter)
            .and_then(|()| write_new(&request, &request_bytes(order, &link, &held)?))
            .and_then(|()| fs::create_dir(&out))
            .and_then(|()| fs::create_dir(directory.path.join("home")))
            .and_then(|()| fs::create_dir(directory.path.join("tmp")));
        if prepared.is_err() {
            return failed(
                consumed,
                Some(facts),
                FailureCode::ExecutionViewUnavailable,
                FailureStage::Source,
            );
        }
        // The adapter as the interpreter will read it, not as this build holds it.
        if Sha256Digest::calculate_file(&adapter)
            .map(|digest| digest.to_string())
            .ok()
            != Some(self.adapter_sha256.clone())
        {
            return failed(
                consumed,
                Some(facts),
                FailureCode::RuntimeUnverified,
                FailureStage::Runtime,
            );
        }
        let spec = CommandSpec::analysis_worker(
            self.runtime.join("python.exe"),
            interpreter,
            ["-I", "-B", "-X", "utf8"]
                .into_iter()
                .map(OsString::from)
                .chain([
                    adapter.into_os_string(),
                    request.into_os_string(),
                    out.clone().into_os_string(),
                ])
                .collect(),
            directory.path.clone(),
            vec![
                (
                    OsString::from("TEMP"),
                    directory.path.join("tmp").into_os_string(),
                ),
                (
                    OsString::from("TMP"),
                    directory.path.join("tmp").into_os_string(),
                ),
                (
                    OsString::from("OPENMS_HOME_PATH"),
                    directory.path.join("home").into_os_string(),
                ),
                (OsString::from("OMP_NUM_THREADS"), OsString::from("1")),
            ],
            WorkerLimits {
                job_memory_bytes: JOB_MEMORY_BYTES,
            },
        );

        let timed_out = AtomicBool::new(false);
        let finished = AtomicBool::new(false);
        let events = out.join("events.jsonl");
        let output = std::thread::scope(|scope| {
            scope.spawn(|| {
                let started = Instant::now();
                let mut shown = None;
                while !finished.load(Ordering::Acquire) {
                    if started.elapsed() >= self.budget && !timed_out.swap(true, Ordering::AcqRel) {
                        cancellation.token().cancel();
                    }
                    if let Some(phase) = latest_phase(&events).filter(|phase| Some(*phase) != shown)
                    {
                        progress(phase);
                        shown = Some(phase);
                    }
                    std::thread::sleep(MONITOR_INTERVAL);
                }
            });
            let output = execute_cancellable(&spec, cancellation.token());
            finished.store(true, Ordering::Release);
            output
        });
        // The worker has exited, or never started: the source may go now.
        drop(held);
        let _ = fs::remove_file(&link);
        let timed_out = timed_out.load(Ordering::Acquire);

        let output = match output {
            Ok(output) => output,
            Err(error) => {
                let (code, stage) = process_failure(&error);
                return failed(consumed, Some(facts), code, stage);
            }
        };
        match ended(&output, timed_out) {
            Ended::NotStarted => cancelled_before_launch(consumed, Some(facts)),
            Ended::Stopped(stop) if stop.reason == StopReason::TimeBudgetExceeded => {
                AttemptEnd::Failed {
                    consumed,
                    attempt: Some(facts),
                    failure: RunFailure {
                        code: FailureCode::WorkerTimeout,
                        stage: FailureStage::Engine,
                    },
                    stop: Some(stop),
                }
            }
            Ended::Stopped(stop) => AttemptEnd::Cancelled {
                consumed,
                attempt: Some(facts),
                stop,
            },
            Ended::Unaccounted => failed(
                consumed,
                Some(facts),
                FailureCode::WorkerNotAccountedFor,
                FailureStage::Runtime,
            ),
            Ended::Exited => {
                progress(RunPhase::Validating);
                self.judge(order, &out, output.exit_code, consumed, facts, manifest)
            }
        }
    }

    /// Reads how the worker said its run ended, and validates a completed one
    /// completely before anything of it is staged.
    fn judge(
        &self,
        order: &AttemptOrder<'_>,
        out: &Path,
        exit_code: Option<i32>,
        consumed: Vec<ObservedMember>,
        facts: AttemptFacts,
        manifest: &BTreeMap<String, String>,
    ) -> AttemptEnd {
        let Some(outcome) = read_json::<WorkerOutcome>(&out.join("outcome.json")) else {
            return failed(
                consumed,
                Some(facts),
                FailureCode::WorkerExitedAbnormally,
                FailureStage::Engine,
            );
        };
        match (exit_code, outcome.status.as_str()) {
            (Some(0), "completed") if outcome.code == "OK" => {}
            (Some(3), "refused") | (Some(4), "failed") => {
                let (code, stage) = worker_failure(&outcome.code);
                return failed(consumed, Some(facts), code, stage);
            }
            _ => {
                return failed(
                    consumed,
                    Some(facts),
                    FailureCode::WorkerExitedAbnormally,
                    FailureStage::Engine,
                );
            }
        }
        let Some(result) = read_json::<WorkerResult>(&out.join("result.json")) else {
            return failed(
                consumed,
                Some(facts),
                FailureCode::ResultInvalid,
                FailureStage::Result,
            );
        };
        let mut facts = facts;
        if let Err(code) = check_report(&result, order, &consumed, manifest, &mut facts) {
            return failed(consumed, Some(facts), code, FailureStage::Result);
        }
        let bounded = |name: &str| {
            local_document::read_bounded(&out.join(name), payload::MAX_PAYLOAD_FILE_BYTES)
                .ok()
                .flatten()
        };
        let (Some(rows), Some(evidence)) = (bounded("rows.jsonl"), bounded("evidence.jsonl"))
        else {
            return failed(
                consumed,
                Some(facts),
                FailureCode::ResultInvalid,
                FailureStage::Result,
            );
        };
        let Some(summary) =
            validate_payload(order.plan, &rows, &evidence, result.no_candidate_recovery)
        else {
            return failed(
                consumed,
                Some(facts),
                FailureCode::ResultInvalid,
                FailureStage::Result,
            );
        };
        let staged = payload::create_staging(order.store, order.artifact).and_then(|staging| {
            payload::stage_payload(
                &staging,
                order.artifact,
                &order.plan.plan_sha256,
                &rows,
                &evidence,
            )
        });
        match staged {
            Ok(reference) => AttemptEnd::Completed {
                consumed,
                attempt: facts,
                result: TargetedMs1ResultV1 {
                    summary,
                    no_candidate_recovery: result.no_candidate_recovery,
                    payload: reference,
                },
            },
            Err(_) => {
                payload::discard_staging(order.store, order.artifact);
                failed(
                    consumed,
                    Some(facts),
                    FailureCode::PayloadNotPublished,
                    FailureStage::Publish,
                )
            }
        }
    }
}

// ---------------------------------------------------------------------------
// The attempt directory
// ---------------------------------------------------------------------------

/// One attempt's own directory in the work area, removed when the attempt
/// ends however it ends.
///
/// Created fresh under a new identifier, so what is removed is only ever what
/// this attempt made: the link to the source (a name, not the data), the
/// request, the adapter and whatever the worker wrote.
struct AttemptDirectory {
    path: PathBuf,
}

impl AttemptDirectory {
    fn create(root: &Path) -> Option<Self> {
        let path = root.join(uuid::Uuid::new_v4().to_string());
        fs::create_dir(&path).ok()?;
        Some(Self { path })
    }
}

impl Drop for AttemptDirectory {
    fn drop(&mut self) {
        // The link first and by name: removing it removes a name, never the
        // source's bytes.
        let _ = fs::remove_file(self.path.join("source.mzML"));
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn write_new(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write as _;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?;
    file.write_all(bytes)?;
    file.sync_data()
}

// ---------------------------------------------------------------------------
// The runtime
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RuntimeManifest {
    schema: String,
    #[allow(dead_code)]
    runtime: String,
    files: Vec<ManifestFile>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ManifestFile {
    path: String,
    bytes: u64,
    sha256: String,
    #[allow(dead_code)]
    provenance: String,
}

/// Whether the manifest this build pins is at its place, without checking the
/// files it lists. The quick question a plan review asks.
fn pinned_manifest_is_present(manifest: &Path) -> bool {
    local_document::read_bounded(manifest, MAX_MANIFEST_BYTES)
        .ok()
        .flatten()
        .and_then(|bytes| Sha256Digest::calculate(&bytes).ok())
        .is_some_and(|digest| digest.to_string() == RUNTIME_MANIFEST_SHA256)
}

/// Checks every file of the runtime against the pinned manifest, and answers
/// each file's digest by its path in lower case.
///
/// The whole tree, before every launch: every listed file present with its
/// length and digest, and no file the manifest does not list -- a module
/// planted beside the runtime's own is as much a different runtime as a
/// changed one.
fn verify_runtime(
    runtime: &Path,
    manifest: &Path,
    pinned: &str,
) -> Result<BTreeMap<String, String>, ()> {
    let bytes = local_document::read_bounded(manifest, MAX_MANIFEST_BYTES)
        .ok()
        .flatten()
        .ok_or(())?;
    if Sha256Digest::calculate(&bytes).map_err(|_| ())?.to_string() != pinned {
        return Err(());
    }
    let parsed: RuntimeManifest = serde_json::from_slice(&bytes).map_err(|_| ())?;
    if parsed.schema != MANIFEST_SCHEMA {
        return Err(());
    }
    let mut present = Vec::new();
    list_files(runtime, runtime, &mut present)?;
    if present.len() != parsed.files.len() {
        return Err(());
    }
    let mut digests = BTreeMap::new();
    for file in &parsed.files {
        if !present.iter().any(|found| found == &file.path) {
            return Err(());
        }
        let path = runtime.join(&file.path);
        let length = fs::metadata(&path).map_err(|_| ())?.len();
        let digest = Sha256Digest::calculate_file(&path)
            .map_err(|_| ())?
            .to_string();
        if length != file.bytes || !digest.eq_ignore_ascii_case(&file.sha256) {
            return Err(());
        }
        digests.insert(file.path.to_ascii_lowercase(), digest);
    }
    Ok(digests)
}

/// Every file below `directory`, relative to `root` with forward slashes.
/// A link or other reparse point anywhere is a refusal.
fn list_files(root: &Path, directory: &Path, into: &mut Vec<String>) -> Result<(), ()> {
    for entry in fs::read_dir(directory).map_err(|_| ())? {
        let entry = entry.map_err(|_| ())?;
        let metadata = fs::symlink_metadata(entry.path()).map_err(|_| ())?;
        if local_document::is_reparse_point(&metadata) {
            return Err(());
        }
        if metadata.is_dir() {
            list_files(root, &entry.path(), into)?;
        } else {
            let relative = entry.path();
            let relative = relative.strip_prefix(root).map_err(|_| ())?;
            let text = relative.to_str().ok_or(())?.replace('\\', "/");
            into.push(text);
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerRequest<'a> {
    schema: &'static str,
    attempt_id: String,
    source: WorkerSource<'a>,
    parameters: WorkerParameters,
    targets: Vec<WorkerTarget>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerSource<'a> {
    path: &'a str,
    byte_length: u64,
    sha256: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerParameters {
    mz_half_width_ppm: f64,
    expected_peak_width_s: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerTarget {
    target_id: String,
    formula: String,
    neutral_mass: Option<f64>,
    rt_s: f64,
    rt_half_width_s: f64,
}

/// The typed request: the plan's values, the link's ASCII name, and the bytes
/// it must hold. No label -- the engine sees target identifiers only.
fn request_bytes(
    order: &AttemptOrder<'_>,
    link: &Path,
    held: &observe::HeldMember,
) -> std::io::Result<Vec<u8>> {
    let invalid = || std::io::Error::other("a plan value is not a number");
    let path = link
        .to_str()
        .filter(|path| path.is_ascii())
        .ok_or_else(|| std::io::Error::other("the execution view is not ASCII"))?;
    let plan = order.plan;
    let mut targets = Vec::with_capacity(plan.targets.len());
    for target in &plan.targets {
        targets.push(WorkerTarget {
            target_id: target.target_id.to_string(),
            formula: target.formula.clone(),
            neutral_mass: match &target.neutral_mass {
                Some(mass) => Some(mass.number().ok_or_else(invalid)?),
                None => None,
            },
            rt_s: target.rt_s.number().ok_or_else(invalid)?,
            rt_half_width_s: target.rt_half_width_s.number().ok_or_else(invalid)?,
        });
    }
    let request = WorkerRequest {
        schema: REQUEST_SCHEMA,
        attempt_id: order.artifact.to_string(),
        source: WorkerSource {
            path,
            byte_length: held.byte_length,
            sha256: held.digest.to_string().to_ascii_lowercase(),
        },
        parameters: WorkerParameters {
            mz_half_width_ppm: plan
                .parameters
                .mz_half_width_ppm
                .number()
                .ok_or_else(invalid)?,
            expected_peak_width_s: plan
                .parameters
                .expected_peak_width_s
                .number()
                .ok_or_else(invalid)?,
        },
        targets,
    };
    serde_json::to_vec(&request).map_err(std::io::Error::other)
}

// ---------------------------------------------------------------------------
// How the process ended
// ---------------------------------------------------------------------------

enum Ended {
    /// Cancelled before any process was created.
    NotStarted,
    /// Stopped by the supervisor, and every process it owned is gone.
    Stopped(StopFacts),
    /// A process may still be running: nothing about the attempt can be
    /// relied on.
    Unaccounted,
    /// Exited by itself, and every process it owned is gone.
    Exited,
}

fn ended(output: &ProcessOutput, timed_out: bool) -> Ended {
    match output.termination {
        Termination::NotStarted => Ended::NotStarted,
        _ if !output.owned_tree_confirmed_gone() => Ended::Unaccounted,
        Termination::Cancelled => Ended::Stopped(StopFacts {
            reason: if timed_out {
                StopReason::TimeBudgetExceeded
            } else {
                StopReason::CancelRequested
            },
            worker_terminated: true,
            exit_observed: true,
        }),
        Termination::Exited => Ended::Exited,
    }
}

/// A failure the supervisor itself observed around the process.
fn process_failure(error: &ProcessError) -> (FailureCode, FailureStage) {
    match error {
        ProcessError::ExecutableIdentityInspectionFailed { .. }
        | ProcessError::ExecutableIdentityChanged => {
            (FailureCode::RuntimeUnverified, FailureStage::Runtime)
        }
        // Refused before a process existed.
        ProcessError::InvalidEnvironment { .. }
        | ProcessError::Launch { .. }
        | ProcessError::OutputDestinationExists
        | ProcessError::OutputDestinationInspectionFailed { .. }
        | ProcessError::OutputDirectoryNotEmpty
        | ProcessError::OutputDirectoryInspectionFailed { .. }
        | ProcessError::OutputDirectoryInsideDirectoryInput
        | ProcessError::SourceIdentityInspectionFailed { .. }
        | ProcessError::SourceIdentityChanged => {
            (FailureCode::WorkerLaunchFailed, FailureStage::Runtime)
        }
        // After a process existed: nothing establishes it is gone.
        _ => (FailureCode::WorkerNotAccountedFor, FailureStage::Runtime),
    }
}

/// The worker's own refusal or failure code, as the record's vocabulary.
fn worker_failure(code: &str) -> (FailureCode, FailureStage) {
    use FailureCode as C;
    use FailureStage as S;
    match code {
        "REQUEST_INVALID" | "PARAMETER_OUT_OF_DOMAIN" | "DUPLICATE_TARGET" => {
            (C::RequestRefused, S::Request)
        }
        "TARGET_INVALID" => (C::TargetInvalid, S::Request),
        "SOURCE_CHANGED" => (C::SourceChanged, S::Source),
        "SOURCE_CHANGED_DURING_READ" => (C::SourceChangedDuringRead, S::Source),
        "SOURCE_UNREADABLE" => (C::SourceUnreadable, S::Source),
        "SOURCE_READ_INCOMPLETE" => (C::SourceReadIncomplete, S::Source),
        "SOURCE_NO_MS1" => (C::SourceNoMs1, S::Source),
        "SOURCE_NOT_CENTROID" => (C::SourceNotCentroid, S::Source),
        "SOURCE_MIXED_POLARITY" => (C::SourceMixedPolarity, S::Source),
        "SOURCE_POLARITY_UNSUPPORTED" => (C::SourcePolarityUnsupported, S::Source),
        "SOURCE_RT_UNDECLARED_OR_NONMONOTONIC" => (C::SourceRtUndeclaredOrNonmonotonic, S::Source),
        "SOURCE_RT_NOT_STRICTLY_INCREASING" => (C::SourceRtNotStrictlyIncreasing, S::Source),
        "SOURCE_ION_MOBILITY_UNSUPPORTED" => (C::SourceIonMobilityUnsupported, S::Source),
        "SOURCE_UNSORTED_MZ" => (C::SourceUnsortedMz, S::Source),
        "SOURCE_NONFINITE" => (C::SourceNonfinite, S::Source),
        "ENGINE_NO_CANDIDATES" => (C::EngineNoCandidates, S::Engine),
        "ENGINE_ERROR" => (C::EngineError, S::Engine),
        "EVIDENCE_MAPPING_MISMATCH" => (C::EvidenceMappingMismatch, S::Engine),
        "INTERNAL" => (C::WorkerInternal, S::Engine),
        // A code this build does not know is not one it can repeat.
        _ => (C::ResultInvalid, S::Result),
    }
}

/// The last phase the worker reported, as the interface names it.
fn latest_phase(events: &Path) -> Option<RunPhase> {
    let text = fs::read_to_string(events).ok()?;
    text.lines().rev().find_map(|line| {
        let value: Value = serde_json::from_str(line).ok()?;
        match value.get("phase")?.as_str()? {
            "import_engine" | "load_source" => Some(RunPhase::LoadingSource),
            "check_source" => Some(RunPhase::CheckingSource),
            "engine_run" => Some(RunPhase::RunningEngine),
            "collect" | "write_result" => Some(RunPhase::Collecting),
            _ => None,
        }
    })
}

fn failed(
    consumed: Vec<ObservedMember>,
    attempt: Option<AttemptFacts>,
    code: FailureCode,
    stage: FailureStage,
) -> AttemptEnd {
    AttemptEnd::Failed {
        consumed,
        attempt,
        failure: RunFailure { code, stage },
        stop: None,
    }
}

fn cancelled_before_launch(
    consumed: Vec<ObservedMember>,
    attempt: Option<AttemptFacts>,
) -> AttemptEnd {
    AttemptEnd::Cancelled {
        consumed,
        attempt,
        stop: StopFacts {
            reason: StopReason::CancelRequested,
            worker_terminated: false,
            exit_observed: false,
        },
    }
}

// ---------------------------------------------------------------------------
// What the worker wrote
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WorkerOutcome {
    status: String,
    code: String,
    /// Session-only text; never recorded.
    #[allow(dead_code)]
    message: String,
    #[allow(dead_code)]
    elapsed_s: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WorkerResult {
    schema: String,
    attempt_id: String,
    source: WorkerSourceFacts,
    engine_profile: serde_json::Map<String, Value>,
    runtime: WorkerRuntime,
    no_candidate_recovery: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WorkerSourceFacts {
    byte_length: u64,
    sha256: String,
    spectra: u64,
    ms1_spectra: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WorkerRuntime {
    python: String,
    pyopenms: String,
    openms: String,
    openms_revision: String,
    openms_build_time: String,
    flags: WorkerFlags,
    sys_path_inside_runtime: bool,
    modules_outside_runtime_or_system: u32,
    loaded_modules: Vec<LoadedModule>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WorkerFlags {
    isolated: u8,
    ignore_environment: u8,
    no_user_site: u8,
    dont_write_bytecode: u8,
    utf8_mode: u8,
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Option<T> {
    let bytes = local_document::read_bounded(path, MAX_REPORT_BYTES)
        .ok()
        .flatten()?;
    serde_json::from_slice(&bytes).ok()
}

/// Whether two JSON values are the same engine parameter value: text exactly,
/// numbers to within a relative 1e-9 (the engine stores doubles and the report
/// crosses a text boundary twice).
fn same_value(reported: &Value, expected: &Value) -> bool {
    match (reported.as_f64(), expected.as_f64()) {
        (Some(left), Some(right)) => (left - right).abs() <= 1e-9 * right.abs().max(1.0),
        _ => reported == expected,
    }
}

/// Checks what the worker reported about the attempt, and completes the facts
/// the record keeps.
fn check_report(
    result: &WorkerResult,
    order: &AttemptOrder<'_>,
    consumed: &[ObservedMember],
    manifest: &BTreeMap<String, String>,
    facts: &mut AttemptFacts,
) -> Result<(), FailureCode> {
    let plan = order.plan;
    let [pinned] = consumed else {
        return Err(FailureCode::ResultInvalid);
    };
    let source_agrees = result.source.byte_length == pinned.byte_length
        && result.source.sha256.eq_ignore_ascii_case(&pinned.sha256)
        && result.source.ms1_spectra > 0
        && result.source.ms1_spectra <= result.source.spectra;
    if result.schema != RESULT_SCHEMA
        || result.attempt_id != order.artifact.to_string()
        || !source_agrees
    {
        return Err(FailureCode::ResultInvalid);
    }
    // The engine profile the engine holds, against the one this build fixes
    // and the three values the plan decides.
    let Ok(Value::Object(fixed)) = serde_json::from_str::<Value>(recipe::FIXED_ENGINE_PROFILE)
    else {
        return Err(FailureCode::ResultInvalid);
    };
    let number = |value: Option<f64>| {
        value.and_then(|value| serde_json::Number::from_f64(value).map(Value::Number))
    };
    let widest = plan
        .targets
        .iter()
        .filter_map(|target| target.rt_half_width_s.number())
        .fold(0.0_f64, f64::max);
    let mut expected = fixed;
    for (key, value) in [
        (
            "extract:mz_window",
            number(
                plan.parameters
                    .mz_half_width_ppm
                    .number()
                    .map(|ppm| 2.0 * ppm),
            ),
        ),
        ("extract:rt_window", number(Some(2.0 * widest))),
        (
            "detect:peak_width",
            number(plan.parameters.expected_peak_width_s.number()),
        ),
    ] {
        let Some(value) = value else {
            return Err(FailureCode::ResultInvalid);
        };
        expected.insert(key.to_owned(), value);
    }
    expected.insert("candidatesCaptured".to_owned(), Value::Bool(true));
    let profile_agrees = result.engine_profile.len() == expected.len()
        && expected.iter().all(|(key, value)| {
            result
                .engine_profile
                .get(key)
                .is_some_and(|reported| same_value(reported, value))
        });
    if !profile_agrees {
        return Err(FailureCode::ResultInvalid);
    }
    let runtime = &result.runtime;
    let flags = &runtime.flags;
    let isolated = flags.isolated == 1
        && flags.ignore_environment == 1
        && flags.no_user_site == 1
        && flags.dont_write_bytecode == 1
        && flags.utf8_mode == 1
        && runtime.sys_path_inside_runtime;
    let engine_is_pinned = runtime.pyopenms == recipe::ENGINE_VERSION
        && runtime.openms == recipe::ENGINE_VERSION
        && runtime.openms_revision == recipe::ENGINE_REVISION;
    if !isolated || !engine_is_pinned {
        return Err(FailureCode::ResultInvalid);
    }
    // Every module the worker hashed after loading must be the file the
    // pinned runtime lists, and nothing may have loaded from outside it and
    // the Windows directory.
    let modules_agree = runtime.modules_outside_runtime_or_system == 0
        && runtime.loaded_modules.len() <= crate::project::record::MAX_LOADED_MODULES
        && runtime.loaded_modules.iter().all(|module| {
            manifest
                .get(&module.name.to_ascii_lowercase())
                .is_some_and(|digest| digest.eq_ignore_ascii_case(&module.sha256))
        })
        && REQUIRED_MODULES.iter().all(|required| {
            runtime
                .loaded_modules
                .iter()
                .any(|module| module.name.eq_ignore_ascii_case(required))
        });
    if !modules_agree {
        return Err(FailureCode::RuntimeModuleMismatch);
    }
    facts.engine_report = Some(EngineReport {
        python: runtime.python.clone(),
        pyopenms: runtime.pyopenms.clone(),
        openms: runtime.openms.clone(),
        openms_revision: runtime.openms_revision.clone(),
        openms_build_time: runtime.openms_build_time.clone(),
    });
    facts.loaded_modules = runtime
        .loaded_modules
        .iter()
        .map(|module| LoadedModule {
            name: module.name.clone(),
            sha256: module.sha256.to_ascii_uppercase(),
        })
        .collect();
    Ok(())
}

/// Validates every row and evidence line against the plan, and counts the
/// outcomes. `None` for anything that does not validate: nothing of it is
/// staged, and the run fails as `resultInvalid`.
///
/// Beyond each line's own shape: one row per target, in the plan's order; every
/// relation names a target of this plan; every row with an ion has exactly one
/// evidence line per trace, of as many points as its signal visited; and the
/// recovery flag is on every row or on none, as the run reported.
fn validate_payload(
    plan: &TargetedMs1Plan,
    rows: &[u8],
    evidence: &[u8],
    recovered: bool,
) -> Option<OutcomeSummary> {
    let rows_text = std::str::from_utf8(rows).ok()?;
    let parsed: Vec<PayloadRow> = rows_text
        .lines()
        .map(|line| serde_json::from_str(line).ok())
        .collect::<Option<_>>()?;
    let ids: Vec<TargetId> = plan.targets.iter().map(|target| target.target_id).collect();
    if parsed.len() != ids.len()
        || parsed
            .iter()
            .zip(&ids)
            .any(|(row, id)| row.target_id != *id)
    {
        return None;
    }
    let lines: Vec<EvidenceLine> = std::str::from_utf8(evidence)
        .ok()?
        .lines()
        .map(|line| serde_json::from_str(line).ok())
        .collect::<Option<_>>()?;
    let mut summary = OutcomeSummary {
        targets: u32::try_from(parsed.len()).ok()?,
        detected: 0,
        detected_ambiguous: 0,
        shared: 0,
        suppressed_by_overlap: 0,
        not_detected: 0,
        failed: 0,
    };
    let mut accounted = 0_usize;
    for row in &parsed {
        let related_known = row
            .relations
            .shared_with
            .iter()
            .chain(&row.relations.overlap_removed)
            .chain(row.relations.suppressed_by.as_ref())
            .all(|id| ids.contains(id) && *id != row.target_id);
        let recovery_agrees = if recovered {
            row.recovered_from_empty_selection
        } else {
            !row.recovered_from_empty_selection
        };
        if !row.is_consistent() || !related_known || !recovery_agrees {
            return None;
        }
        let own: Vec<&EvidenceLine> = lines
            .iter()
            .filter(|line| line.target_id == row.target_id)
            .collect();
        match (&row.ion, &row.signal) {
            (Some(ion), Some(signal)) => {
                if own.len() != ion.mz_theoretical.len() {
                    return None;
                }
                for (trace, mz) in ion.mz_theoretical.iter().enumerate() {
                    let line = own.iter().find(|line| usize::from(line.trace) == trace)?;
                    if !line.is_consistent()
                        || line.points.len() != usize::try_from(signal.points).ok()?
                        || (line.mz_theoretical - mz).abs() > 1e-9 * mz.abs()
                    {
                        return None;
                    }
                }
            }
            (None, None)
                if row.failure_reason == Some(RowFailure::TargetAbsentFromEngineLibrary) =>
            {
                if !own.is_empty() {
                    return None;
                }
            }
            _ => return None,
        }
        accounted += own.len();
        let count = match row.outcome {
            RowOutcome::Detected => &mut summary.detected,
            RowOutcome::DetectedAmbiguous => &mut summary.detected_ambiguous,
            RowOutcome::Shared => &mut summary.shared,
            RowOutcome::SuppressedByOverlap => &mut summary.suppressed_by_overlap,
            RowOutcome::NotDetected => &mut summary.not_detected,
            RowOutcome::Failed => &mut summary.failed,
        };
        *count += 1;
    }
    // Every evidence line belongs to a row.
    (accounted == lines.len() && summary.is_whole()).then_some(summary)
}
