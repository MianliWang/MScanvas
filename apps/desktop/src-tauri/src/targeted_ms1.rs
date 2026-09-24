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
//! 2. Removes what earlier sessions' attempts left in the work area, where
//!    their owner is provably gone (see [`scratch`]), and makes a fresh,
//!    marked attempt directory.
//! 3. Opens the source for reading, sharing reads only, so it cannot be
//!    written, renamed or deleted while it is held.
//! 4. Gives it to the engine under an ASCII name in the attempt directory --
//!    the source's own name, whatever characters it has, is never handed over
//!    -- in one of two ways, decided by the held handle's volume:
//!    - **on the work area's volume**, it hashes the source through the held
//!      handle, refuses bytes that are not the ones the plan expects, makes a
//!      hard link and shows the link is the held object. The source stays held
//!      until the worker has exited;
//!    - **anywhere else** (or where no link can be made), it copies the source
//!      through the held handle into the attempt directory, hashing each chunk
//!      as it is written, and refuses a copy whose bytes are not the plan's.
//!      The source is then released, and the copy is held read-only and hashed
//!      again through that hold; only a copy that is the plan's bytes is given
//!      to the worker.
//! 5. Writes the typed request and the adapter this build ships, and checks the
//!    adapter's digest as written.
//! 6. Starts the pinned interpreter through the process supervisor, with a
//!    fixed argv, an allow-listed environment, a Job that allows one process
//!    and caps its memory, and a wall-clock budget.
//! 7. After the worker has exited, removes the link's name while the source is
//!    still held -- so the link is never the last name of the source's bytes
//!    -- releases what it held, and validates everything the worker wrote
//!    before any of it is staged. The attempt directory goes when the attempt
//!    ends.
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

mod scratch;
#[cfg(test)]
mod tests;

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use mscanvas_proteowizard::{
    CancellationToken, CommandSpec, ProcessError, ProcessOutput, Sha256Digest, Termination,
    WorkerLimits, execute_cancellable,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::local_document;
use crate::project::ProjectError;
use crate::project::observe::{self, Cancellation, CopyFailure};
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
/// The hard link's name in an attempt directory.
const LINK_NAME: &str = "source.mzML";
/// The verified copy's name in an attempt directory. Not the link's: a sweep
/// tells a copy, which is only ever the attempt's, from a link, which may be
/// the last name of a user's bytes, by it.
const SNAPSHOT_NAME: &str = "snapshot.mzML";
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
        // A source on another volume is copied into the work area for the
        // attempt. Refused only where that copy provably cannot fit, even once
        // what earlier sessions' attempts left there is reclaimed: where either
        // volume or the free space cannot be established -- the source is
        // missing, busy or unreadable -- the attempt goes ahead, and its pinned
        // read or its own write records the real reason.
        let another_volume = matches!(
            (
                local_document::directory_volume(&self.attempts),
                local_document::object_identity(source),
            ),
            (Some(work), Some((volume, _))) if work != volume
        );
        if another_volume
            && !room_after_reclaiming(
                plan,
                || local_document::available_bytes(&self.attempts),
                || {
                    scratch::sweep(&self.attempts);
                },
            )
        {
            return Err(ProjectError::InsufficientWorkAreaSpace);
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
        scratch::sweep(&self.attempts);
        let Some(directory) = scratch::AttemptDirectory::create(&self.attempts) else {
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
        directory: &scratch::AttemptDirectory,
    ) -> AttemptEnd {
        progress(RunPhase::PinningSource);
        let Ok(source) = observe::open_member(order.source) else {
            return failed(
                Vec::new(),
                None,
                FailureCode::SourceUnavailable,
                FailureStage::Source,
            );
        };
        // Held until the worker has exited: while it is, what the view names
        // cannot be opened for writing, renamed or deleted by its name, so the
        // bytes the worker reads are the bytes hashed here.
        let view = match execution_view(order, source, &directory.path, cancellation, progress) {
            Ok(view) => view,
            Err(end) => return *end,
        };
        let consumed = view.consumed.clone();
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
            source_view: view.kind,
            engine_report: None,
            loaded_modules: Vec::new(),
        };
        let adapter = directory.path.join("adapter_v1.py");
        let request = directory.path.join("request.json");
        let out = directory.path.join("out");
        let prepared = write_new(&adapter, self.adapter)
            .and_then(|()| write_new(&request, &request_bytes(order, &view.path, &view.held)?))
            .and_then(|()| fs::create_dir(&out))
            .and_then(|()| fs::create_dir(directory.path.join("home")))
            .and_then(|()| fs::create_dir(directory.path.join("tmp")));
        if let Err(error) = prepared {
            // Out of room here is out of room, whichever file met it.
            let code = if out_of_room(error.kind()) {
                FailureCode::InsufficientWorkAreaSpace
            } else {
                FailureCode::ExecutionViewUnavailable
            };
            return failed(consumed, Some(facts), code, FailureStage::Source);
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

        // The process's own stop. A user's cancel is forwarded into it, and the
        // time budget stops it without ever reading as the user's cancel: the
        // store decides a cancel from the user's flag alone, and a budget that
        // runs out while a cancel is already pending stays that cancel.
        let process = CancellationToken::new();
        if cancellation.requested() {
            process.cancel();
        }
        let timed_out = AtomicBool::new(false);
        let finished = AtomicBool::new(false);
        let events = out.join("events.jsonl");
        let output = std::thread::scope(|scope| {
            scope.spawn(|| {
                let started = Instant::now();
                let mut shown = None;
                while !finished.load(Ordering::Acquire) {
                    // A pending cancel is forwarded and keeps the budget from
                    // being recorded as what stopped the run.
                    let stop = cancellation.requested()
                        || (started.elapsed() >= self.budget
                            && !timed_out.swap(true, Ordering::AcqRel));
                    if stop {
                        process.cancel();
                    }
                    if let Some(phase) = latest_phase(&events).filter(|phase| Some(*phase) != shown)
                    {
                        progress(phase);
                        shown = Some(phase);
                    }
                    std::thread::sleep(MONITOR_INTERVAL);
                }
            });
            let output = execute_cancellable(&spec, &process);
            finished.store(true, Ordering::Release);
            output
        });
        // A worker whose end was not observed may still be reading. What the
        // view holds stays held and the work area stays where it is until this
        // process exits, and the store refuses another run meanwhile.
        let unaccounted = match &output {
            Err(error) => error.leaves_an_owned_process_unaccounted(),
            Ok(output) => {
                output.termination != Termination::NotStarted && !output.owned_tree_confirmed_gone()
            }
        };
        if unaccounted {
            std::mem::forget(view);
            directory.keep();
            return failed(
                consumed,
                Some(facts),
                FailureCode::WorkerNotAccountedFor,
                FailureStage::Runtime,
            );
        }
        // Every process of the attempt is gone: the view may go now.
        drop(view);
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
// The execution view
// ---------------------------------------------------------------------------

/// The bytes the worker is given under an ASCII name, and the read-only hold
/// that keeps them so until it has exited.
struct ExecutionView {
    /// The source itself for a link; the copy for a snapshot.
    held: observe::HeldMember,
    path: PathBuf,
    kind: SourceView,
    /// What the source held when the view was made: the plan's content.
    consumed: Vec<ObservedMember>,
}

impl Drop for ExecutionView {
    fn drop(&mut self) {
        // A link's name goes before the source is released -- `held` is
        // dropped after this body -- so it is never the last name of the
        // source's bytes. A copy is the attempt's own and goes with its
        // directory.
        if self.kind == SourceView::HardLinkInWorkArea {
            let _ = fs::remove_file(&self.path);
        }
    }
}

/// Whether a write failed because its volume, or this user's quota on it, had
/// no room left.
fn out_of_room(kind: std::io::ErrorKind) -> bool {
    matches!(
        kind,
        std::io::ErrorKind::StorageFull | std::io::ErrorKind::QuotaExceeded
    )
}

/// Whether the copy fits: on what is free now, and where it does not, on what
/// is free once `reclaim` has removed what earlier sessions' attempts left.
/// Free space that cannot be established refuses nothing.
fn room_after_reclaiming(
    plan: &TargetedMs1Plan,
    available: impl Fn() -> Option<u64>,
    reclaim: impl FnOnce(),
) -> bool {
    let fits = |free: Option<u64>| free.is_none_or(|free| room_for_snapshot(free, plan));
    fits(available()) || {
        reclaim();
        fits(available())
    }
}

/// Whether `available` bytes hold a copy of what the plan reads: its length,
/// and nothing added for what the worker writes, which is not the copy's.
fn room_for_snapshot(available: u64, plan: &TargetedMs1Plan) -> bool {
    plan.expected_content
        .iter()
        .try_fold(0_u64, |needed, member| {
            needed.checked_add(member.byte_length)
        })
        .is_some_and(|needed| needed <= available)
}

fn consumed_of(byte_length: u64, digest: Sha256Digest) -> Vec<ObservedMember> {
    vec![ObservedMember {
        role: MemberRole::Primary,
        relative_name: String::new(),
        byte_length,
        sha256: digest.to_string(),
    }]
}

/// Gives the held source to the worker under an ASCII name in `directory`: a
/// hard link where the held object is on the work area's volume, a verified
/// copy of its bytes where it is not or no link can be made there.
///
/// Decided from the held handle, not from the name: which object is read is
/// the one this attempt holds.
fn execution_view(
    order: &AttemptOrder<'_>,
    source: observe::OpenedMember,
    directory: &Path,
    cancellation: &Cancellation,
    progress: &(dyn Fn(RunPhase) + Sync),
) -> Result<ExecutionView, Box<AttemptEnd>> {
    let same_volume = source
        .identity()
        .zip(local_document::directory_volume(directory))
        .is_some_and(|((volume, _), work)| volume == work);
    if !same_volume {
        return snapshot(order, source, Vec::new(), directory, cancellation, progress);
    }
    let held = match source.measure(cancellation) {
        Ok(held) => held,
        Err(_) if cancellation.requested() => {
            return Err(Box::new(cancelled_before_launch(Vec::new(), None)));
        }
        Err(_) => {
            return Err(Box::new(failed(
                Vec::new(),
                None,
                FailureCode::SourceUnavailable,
                FailureStage::Source,
            )));
        }
    };
    let consumed = consumed_of(held.byte_length, held.digest);
    if consumed != order.plan.expected_content {
        return Err(Box::new(failed(
            consumed,
            None,
            FailureCode::SourceChanged,
            FailureStage::Source,
        )));
    }
    let link = directory.join(LINK_NAME);
    if fs::hard_link(order.source, &link).is_err() {
        // No link on this volume -- a filesystem without them, or a volume
        // serial two volumes happen to share. The bytes are copied instead,
        // read again through the same held handle.
        return snapshot(
            order,
            held.into_opened(),
            consumed,
            directory,
            cancellation,
            progress,
        );
    }
    let identity = held.identity;
    let view = ExecutionView {
        held,
        path: link,
        kind: SourceView::HardLinkInWorkArea,
        consumed,
    };
    // A link that is not the held object is refused, and never replaced by a
    // copy: something other than this attempt put it there.
    if identity.is_none() || local_document::object_identity(&view.path) != identity {
        return Err(Box::new(failed(
            view.consumed.clone(),
            None,
            FailureCode::ExecutionViewUnavailable,
            FailureStage::Source,
        )));
    }
    Ok(view)
}

/// Copies the held source into `directory` and holds the copy, refusing any
/// copy that is not the plan's bytes.
///
/// The source is read once, through the handle this attempt already holds,
/// and each chunk is hashed as it is written: the digest compared with the
/// plan is of exactly the bytes the copy was given, and they came out of the
/// held object. Only then is the source released, and the copy -- its write
/// handle closed, since the engine's reader shares reads only -- is held
/// read-only and hashed again through that hold, so what the worker reads is
/// shown to be the plan's bytes and cannot be changed while it reads them.
///
/// `measured` is what this attempt already established the source holds --
/// nothing, unless a link was tried first -- and is what an attempt that ends
/// before the copy is read whole records as consumed.
fn snapshot(
    order: &AttemptOrder<'_>,
    source: observe::OpenedMember,
    measured: Vec<ObservedMember>,
    directory: &Path,
    cancellation: &Cancellation,
    progress: &(dyn Fn(RunPhase) + Sync),
) -> Result<ExecutionView, Box<AttemptEnd>> {
    let unavailable =
        |consumed, code| Err(Box::new(failed(consumed, None, code, FailureStage::Source)));
    progress(RunPhase::PreparingInput);
    let path = directory.join(SNAPSHOT_NAME);
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    // Shared with nobody while it is written: no other program can write,
    // rename or remove the copy under the bytes being hashed into it.
    #[cfg(windows)]
    std::os::windows::fs::OpenOptionsExt::share_mode(&mut options, 0);
    let Ok(mut file) = options.open(&path) else {
        return unavailable(measured, FailureCode::ExecutionViewUnavailable);
    };
    let copied = source.copy_into(&mut file, cancellation);
    drop(file);
    let copied = match copied {
        Ok(copied) => copied,
        Err(CopyFailure::Cancelled) => {
            return Err(Box::new(cancelled_before_launch(measured, None)));
        }
        Err(CopyFailure::SourceUnstable) => {
            return unavailable(measured, FailureCode::SourceUnavailable);
        }
        Err(CopyFailure::DestinationFull) => {
            return unavailable(measured, FailureCode::InsufficientWorkAreaSpace);
        }
        Err(CopyFailure::DestinationUnwritable) => {
            return unavailable(measured, FailureCode::ExecutionViewUnavailable);
        }
    };
    let consumed = consumed_of(copied.byte_length, copied.digest);
    if consumed != order.plan.expected_content {
        return unavailable(consumed, FailureCode::SourceChanged);
    }
    // The source's part is over. What the worker reads is this copy, so the
    // source may be moved or removed from here on without changing what this
    // attempt consumed.
    drop(source);
    let held = match observe::hold_member(&path, cancellation) {
        Ok(held) => held,
        Err(_) if cancellation.requested() => {
            return Err(Box::new(cancelled_before_launch(consumed, None)));
        }
        Err(_) => return unavailable(consumed, FailureCode::ExecutionViewUnavailable),
    };
    if (held.byte_length, held.digest) != (copied.byte_length, copied.digest) {
        return unavailable(consumed, FailureCode::ExecutionViewUnavailable);
    }
    Ok(ExecutionView {
        held,
        path,
        kind: SourceView::VerifiedSnapshotInWorkArea,
        consumed,
    })
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
/// Whether this build could start a new run: its runtime is where it pins
/// it, with the manifest it pins. Read-only -- it creates nothing, launches
/// nothing and reads no source -- so the interface may ask it whenever it
/// shows a stored result beside the question of running a new one.
///
/// Not a verification of the runtime's files, which every attempt still does
/// in full before it launches anything.
#[must_use]
pub fn runtime_present() -> bool {
    Supervisor::development().is_some_and(|supervisor| {
        pinned_manifest_is_present(&supervisor.manifest)
            && supervisor.runtime.join("python.exe").is_file()
    })
}

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

/// A failure the supervisor itself observed around the process, classified
/// the way every other backend lane classifies it.
fn process_failure(error: &ProcessError) -> (FailureCode, FailureStage) {
    match error {
        _ if error.leaves_an_owned_process_unaccounted() => {
            (FailureCode::WorkerNotAccountedFor, FailureStage::Runtime)
        }
        ProcessError::ExecutableIdentityInspectionFailed { .. }
        | ProcessError::ExecutableIdentityChanged => {
            (FailureCode::RuntimeUnverified, FailureStage::Runtime)
        }
        // Refused before a process existed, or ended with every process of
        // the attempt observed gone: it could not be started or supervised.
        _ => (FailureCode::WorkerLaunchFailed, FailureStage::Runtime),
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
