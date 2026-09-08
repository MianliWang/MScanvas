use std::ffi::OsString;
use std::io::{self, Read};
use std::path::Path;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use thiserror::Error;

use crate::command::OutputSafety;
#[cfg(all(test, windows))]
use crate::command::SourceIdentity;
use crate::{CommandSpec, Sha256Digest, Sha256Error};

const POLL_INTERVAL: Duration = Duration::from_millis(20);
const JOB_EMPTY_TIMEOUT: Duration = Duration::from_secs(5);
const CAPTURE_LIMIT_BYTES: usize = 8 * 1024 * 1024;

// Capturing less than the preview module will interpret would refuse runs on
// the strength of this limit rather than that one: output between the two would
// arrive flagged as truncated, and be rejected, though it is within what
// `interpret_preview` accepts. This is a floor, not an equality -- capture is
// about how much output is held in memory, interpretation about how much is
// meaningful, and conversion captures output that preview never sees.
const _: () = assert!(CAPTURE_LIMIT_BYTES as u64 >= crate::MAX_PREVIEW_TEXT_BYTES);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Termination {
    /// A process was created and supervised until it left the owned job.
    Exited,
    /// A process was created and its owned process tree was terminated after a
    /// cancellation request.
    Cancelled,
    /// No process was ever created: cancellation had already been requested
    /// when the run was asked to start.
    ///
    /// Distinct from `Cancelled` because the two say different things about the
    /// user's machine. `Cancelled` is a claim that a tree that existed is gone;
    /// this is a statement that none existed. Collapsing them would let a
    /// result carry process facts for a process that never ran.
    NotStarted,
}

impl Termination {
    /// The stable identifier for how a run ended.
    ///
    /// Every outcome variant this crate publishes carries one, so a caller can
    /// record or render the distinction without depending on a Rust variant
    /// name or on `Debug`. It matters most here: "terminated" and "never
    /// started" are the two facts a cancellation diagnostic must not confuse,
    /// and a caller that has only a rendered enum name to go on has no
    /// contract to rely on.
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::Exited => "exited",
            Self::Cancelled => "cancelled",
            Self::NotStarted => "not_started",
        }
    }

    /// Whether the run ended because a cancellation request was honoured,
    /// whether or not a process had been created by the time it was.
    ///
    /// This is what a caller that only distinguishes "the request stopped it"
    /// from "it ran to an end of its own" should ask.
    #[must_use]
    pub const fn is_cancellation(self) -> bool {
        matches!(self, Self::Cancelled | Self::NotStarted)
    }

    /// Whether a process was created at all.
    #[must_use]
    pub const fn launched(self) -> bool {
        matches!(self, Self::Exited | Self::Cancelled)
    }
}

/// Whether ownership of the backend process tree existed before that tree could
/// grow.
///
/// This is the fact an emptiness observation cannot supply, and the reason it
/// is carried beside `final_active_processes` rather than folded into it. The
/// owned Job's active-process count answers a question about the processes the
/// Job holds. Whether it holds *every* process the backend created is a
/// question about when ownership was established, and only the launch path
/// knows the answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TreeOwnership {
    /// The root process was created suspended and assigned to the owned Job
    /// before it executed a single instruction, and the Job refuses breakaway.
    ///
    /// Every process the backend could create was therefore created while the
    /// Job already held its creator, so the Job's accounting covers the whole
    /// tree and an empty Job is an empty tree.
    ///
    /// The claim is about the backend's own process tree — the root and its
    /// descendants. Work a backend hands to a service or COM server that was
    /// already running is not a descendant, was never this Job's, and is not
    /// covered. That limit is stated rather than assumed away, and it is why
    /// this is not a sandbox.
    EstablishedBeforeExecution,
    /// No such guarantee: either ownership was never established, or the root
    /// process was already executing when it was.
    ///
    /// A descendant created before assignment belongs to no Job of this run's,
    /// so it is outside `TerminateJobObject` *and* outside the accounting that
    /// would otherwise report the tree gone. An empty Job is then an empty Job
    /// and nothing more.
    NotEstablishedBeforeExecution,
}

impl TreeOwnership {
    /// The stable identifier for how ownership was established, so a record can
    /// carry the distinction without depending on a Rust variant name.
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::EstablishedBeforeExecution => "established_before_execution",
            Self::NotEstablishedBeforeExecution => "not_established_before_execution",
        }
    }

    /// Whether the owned Job's accounting covers every process the backend
    /// could have created.
    #[must_use]
    pub const fn covers_every_descendant(self) -> bool {
        matches!(self, Self::EstablishedBeforeExecution)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LaunchFailureKind {
    NotFound,
    PermissionDenied,
    Other,
}

impl LaunchFailureKind {
    #[must_use]
    pub const fn is_not_found(self) -> bool {
        matches!(self, Self::NotFound)
    }

    #[must_use]
    pub const fn is_permission_denied(self) -> bool {
        matches!(self, Self::PermissionDenied)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessOutput {
    /// Captured prefix of stdout. Raw backend output can contain sensitive paths.
    pub stdout: Vec<u8>,
    /// Captured prefix of stderr. Raw backend output can contain sensitive paths.
    pub stderr: Vec<u8>,
    pub stdout_total_bytes: u64,
    pub stderr_total_bytes: u64,
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
    pub exit_code: Option<i32>,
    pub elapsed: Duration,
    pub termination: Termination,
    /// Maximum active processes observed in the owned Windows Job Object.
    /// `None` means the platform did not expose an equivalent bounded query.
    pub max_active_processes: Option<u32>,
    /// Active processes observed after the root process and its owned tree were
    /// fully reaped. A successful supervised Windows execution reports `Some(0)`.
    pub final_active_processes: Option<u32>,
    /// Every process the owned Windows Job Object has ever held, counted by the
    /// kernel rather than sampled.
    ///
    /// The complement to `max_active_processes`, and a stronger measurement
    /// than it: polling can miss a process that started and exited between two
    /// observations, so the sampled peak is a floor. This is cumulative and has
    /// no such gap -- a run reporting `Some(1)` created exactly one process,
    /// whatever the sampling happened to catch. `None` means no bounded
    /// accounting was available, never that there were none.
    pub total_owned_processes: Option<u32>,
    /// Peak committed memory charged to the owned Windows Job Object across the
    /// whole supervised process tree. `None` means the platform exposed no
    /// equivalent bounded accounting or the query itself failed; this is an
    /// advisory observation, never a supervision result.
    pub peak_job_memory_bytes: Option<u64>,
    /// When ownership of the process tree was established, relative to the
    /// backend executing anything.
    ///
    /// Read together with `final_active_processes` and never apart from it:
    /// see [`ProcessOutput::owned_tree_confirmed_gone`].
    pub tree_ownership: TreeOwnership,
}

impl ProcessOutput {
    #[must_use]
    pub fn success(&self) -> bool {
        self.termination == Termination::Exited && self.exit_code == Some(0)
    }

    /// Whether this run establishes that every backend process it created is
    /// gone.
    ///
    /// **This is the single origin of that claim.** Nothing else in the
    /// repository may decide it, and no surface, wire field, diagnostic key or
    /// document may assert a confirmed process tree on any other basis. A
    /// repository check enforces that, because the claim is a semantic
    /// boundary and a hand-maintained list of sites is correct only until the
    /// next site is added.
    ///
    /// Two independent facts, and neither alone is the claim:
    ///
    /// - the owned Job reported itself empty — `Some(0)`, never `None`, which
    ///   means no bounded accounting was available rather than nothing left;
    /// - ownership covered the tree before it could grow, so the Job's
    ///   accounting is about every process the backend created rather than
    ///   only the ones it happened to hold.
    ///
    /// A run that never launched is not a terminated tree and is not asked
    /// this question: [`Termination::NotStarted`] carries no job accounting at
    /// all, and its caller distinguishes it by [`Termination::launched`].
    #[must_use]
    pub const fn owned_tree_confirmed_gone(&self) -> bool {
        self.tree_ownership.covers_every_descendant()
            && matches!(self.final_active_processes, Some(0))
    }

    /// The result of a run that never started, because cancellation had already
    /// been requested when it was asked to.
    ///
    /// `NotStarted` with no exit code, no elapsed time and no job accounting at
    /// all — not an empty job, because no job was ever created. Reporting
    /// `Some(0)` here would be literally true of a tree that does not exist and
    /// indistinguishable from the confirmation that a tree that did exist is
    /// gone, and those are the two facts this type must never conflate.
    pub(crate) fn cancelled_before_launch() -> Self {
        Self {
            stdout: Vec::new(),
            stderr: Vec::new(),
            stdout_total_bytes: 0,
            stderr_total_bytes: 0,
            stdout_truncated: false,
            stderr_truncated: false,
            exit_code: None,
            elapsed: Duration::ZERO,
            termination: Termination::NotStarted,
            max_active_processes: None,
            final_active_processes: None,
            total_owned_processes: None,
            peak_job_memory_bytes: None,
            // No process was created, so nothing was owned and there is no
            // ownership establishment to report. The launched-tree claim is
            // unreachable from here by construction, which is exactly the
            // separation `NotStarted` exists to keep.
            tree_ownership: TreeOwnership::NotEstablishedBeforeExecution,
        }
    }
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum ProcessError {
    #[error("backend child environment is invalid: {detail}")]
    InvalidEnvironment { detail: String },
    #[error("the requested output destination already exists")]
    OutputDestinationExists,
    #[error("the requested output destination could not be inspected: {kind}")]
    OutputDestinationInspectionFailed { kind: io::ErrorKind },
    #[error("the preview output directory is no longer empty")]
    OutputDirectoryNotEmpty,
    #[error("the preview output directory could not be inspected: {kind}")]
    OutputDirectoryInspectionFailed { kind: io::ErrorKind },
    #[error("the output directory now resolves inside a directory-formatted input")]
    OutputDirectoryInsideDirectoryInput,
    #[error("the validated backend executable could not be reverified: {kind}")]
    ExecutableIdentityInspectionFailed { kind: io::ErrorKind },
    #[error("the backend executable changed after its capability probe")]
    ExecutableIdentityChanged,
    #[error("the validated source could not be reverified: {kind}")]
    SourceIdentityInspectionFailed { kind: io::ErrorKind },
    #[error("the source changed after command planning")]
    SourceIdentityChanged,
    #[error("failed to launch {executable}: {detail}")]
    Launch {
        executable: String,
        kind: LaunchFailureKind,
        detail: String,
    },
    #[error("failed to assign the backend to an owned process job: {detail}")]
    AssignToOwnedJob {
        detail: String,
        /// Whether teardown observed the created root reclaimed.
        ///
        /// There is no Job on this path, so `KILL_ON_JOB_CLOSE` is not a
        /// backstop and dropping the handle does not kill anything. `false` is
        /// a suspended process this run created, still holding the pipes and
        /// working directory it was given, that nothing observed end.
        owned_root_reclaimed: bool,
    },
    /// The owned Job would not report itself empty within its bounded window.
    ///
    /// Distinct from an ordinary wait failure because of what is *not* known:
    /// processes the Job held were still there when the window closed, and
    /// terminating it afterwards is a request rather than an observation. A run
    /// that ends here has not established that its tree is gone.
    #[error("the owned backend process job did not empty: {detail}")]
    OwnedJobNotEmptied { detail: String },
    /// Ownership was established, and the owned root could not then be started.
    ///
    /// Its own variant rather than a `Launch` failure: the process exists and
    /// this run owns it, which is a different fact about the machine from one
    /// that never started. It has still executed nothing, so it has no
    /// descendants — but whether it is *gone* depends on whether teardown
    /// reclaimed it, and that is carried rather than assumed.
    #[error("failed to start the owned backend process: {detail}")]
    ResumeOwnedRoot {
        detail: String,
        /// Whether teardown observed the owned root reclaimed.
        ///
        /// `false` is not "probably fine": it is a process this run owns whose
        /// disappearance it cannot state, and callers classify it exactly as
        /// they classify a Job that would not terminate.
        owned_root_reclaimed: bool,
    },
    #[error("failed while waiting for the backend process: {detail}")]
    Wait { detail: String },
    #[error("failed to capture backend {stream}: {detail}")]
    Capture {
        stream: &'static str,
        detail: String,
    },
    #[error("failed to terminate the owned backend process job: {detail}")]
    Terminate { detail: String },
}

#[derive(Debug, Clone, Default)]
pub struct CancellationToken(Arc<AtomicBool>);

impl CancellationToken {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }

    #[must_use]
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}

pub trait ProcessRunner {
    fn run(&self, spec: &CommandSpec) -> Result<ProcessOutput, ProcessError>;

    /// Runs `spec` under a cancellation request.
    ///
    /// The default keeps the one guarantee a runner can keep without owning
    /// process supervision: a request already made launches nothing. It then
    /// delegates to [`ProcessRunner::run`], so a substituted runner reports the
    /// ordinary result it always did rather than a mid-run cancellation it did
    /// not perform. Reporting one it did not perform is the failure this
    /// default exists to make impossible by construction — a caller cannot tell
    /// the two apart from the outside, and a queue that believed it would stop
    /// a running conversion that it cannot stop is worse than one that admits
    /// it cannot.
    ///
    /// [`SystemProcessRunner`] overrides it, because it does own supervision.
    fn run_cancellable(
        &self,
        spec: &CommandSpec,
        cancellation: &CancellationToken,
    ) -> Result<ProcessOutput, ProcessError> {
        if cancellation.is_cancelled() {
            return Ok(ProcessOutput::cancelled_before_launch());
        }
        self.run(spec)
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct SystemProcessRunner;

impl ProcessRunner for SystemProcessRunner {
    fn run(&self, spec: &CommandSpec) -> Result<ProcessOutput, ProcessError> {
        execute(spec)
    }

    fn run_cancellable(
        &self,
        spec: &CommandSpec,
        cancellation: &CancellationToken,
    ) -> Result<ProcessOutput, ProcessError> {
        execute_cancellable(spec, cancellation)
    }
}

pub fn execute(spec: &CommandSpec) -> Result<ProcessOutput, ProcessError> {
    execute_cancellable(spec, &CancellationToken::new())
}

pub fn execute_cancellable(
    spec: &CommandSpec,
    cancellation: &CancellationToken,
) -> Result<ProcessOutput, ProcessError> {
    if cancellation.is_cancelled() {
        return Ok(ProcessOutput::cancelled_before_launch());
    }

    execute_command_after_assignment(process_command(spec)?, spec, cancellation, || {})
}

fn execute_command_after_assignment(
    mut command: Command,
    spec: &CommandSpec,
    cancellation: &CancellationToken,
    after_assignment: impl FnOnce(),
) -> Result<ProcessOutput, ProcessError> {
    // These are non-atomic snapshots. Hash the executable first, then verify the
    // source identity, so output safety remains the final check before spawn.
    require_executable_identity(spec)?;
    require_source_identity(spec)?;
    require_output_safety(spec)?;
    // Asked again here, not only at the entry above. The three checks include a
    // hash of the whole backend executable, so a request arriving inside them
    // is one that unambiguously preceded process creation, and launching for it
    // would report a terminated tree where none needed to exist. What remains
    // is the interval stable `std::process` leaves between deciding to spawn
    // and spawning, which is instructions rather than a file hash — and the
    // process it creates executes nothing until this function resumes it.
    if cancellation.is_cancelled() {
        return Ok(ProcessOutput::cancelled_before_launch());
    }
    let started = Instant::now();
    // Created suspended, so ownership is established before the backend runs.
    //
    // The published boundary spawned a running child and assigned it to the Job
    // afterwards. A descendant created in that interval belonged to no Job, so
    // it was outside termination *and* outside the accounting that reports the
    // tree gone — and no number of samples closes that, because the hole is in
    // what is being counted. Suspending the root removes the interval instead
    // of narrowing it: the process exists, holds its pipes, and has executed no
    // instruction of its own, so it cannot yet have created anything.
    suspend_root_creation(&mut command);
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| launch_error(spec, &error))?;

    let owned_job = match OwnedProcessJob::assign(&child) {
        Ok(job) => job,
        Err(error) => {
            // Ownership was never established — and the root has still executed
            // nothing, so there is no descendant this cannot reach. Terminating
            // the direct child is complete here rather than a degradation, and
            // it is complete because of how the child was created.
            let stdout_reader =
                capture_stream(child.stdout.take().expect("stdout was configured as piped"));
            let stderr_reader =
                capture_stream(child.stderr.take().expect("stderr was configured as piped"));
            let cleanup = force_unowned_cleanup(&mut child);
            let owned_root_reclaimed = cleanup.is_ok();
            let captures = join_captures(stdout_reader, stderr_reader);
            let detail = add_cleanup_context(error.to_string(), cleanup, captures.err());
            return Err(ProcessError::AssignToOwnedJob {
                detail,
                owned_root_reclaimed,
            });
        }
    };

    // Capture starts before the backend does, so no output can be produced
    // against an unattended pipe.
    let stdout_reader =
        capture_stream(child.stdout.take().expect("stdout was configured as piped"));
    let stderr_reader =
        capture_stream(child.stderr.take().expect("stderr was configured as piped"));

    // Ownership exists; only now may the backend execute.
    //
    // The Job is passed in rather than merely existing, so this ordering is a
    // compile-time fact. `OwnedProcessJob` is obtainable only from `assign`, so
    // a resume moved above it does not build — which matters because the two
    // tests that watch this interval construct their own suspended child, and a
    // swapped order here would have left them green while the root ran before
    // it was owned. `ROOT_TREE_OWNERSHIP` can therefore stay a constant: what
    // makes it true is the signature below, not a convention.
    let mut owned_job = Some(owned_job);
    if let Err(error) = resume_owned_root(&child, owned_job.as_ref().expect("just assigned")) {
        let cleanup = force_owned_cleanup(&mut child, &mut owned_job);
        let owned_root_reclaimed = cleanup.is_ok();
        let captures = join_captures(stdout_reader, stderr_reader);
        let detail = add_cleanup_context(error.to_string(), cleanup, captures.err());
        return Err(ProcessError::ResumeOwnedRoot {
            detail,
            owned_root_reclaimed,
        });
    }
    after_assignment();

    let mut max_active_processes = None;
    let execution = monitor_process(
        &mut child,
        owned_job.as_ref().expect("owned job is present"),
        cancellation,
        &mut max_active_processes,
    );

    let execution = match execution {
        Ok((status, termination)) => {
            match wait_for_job_empty(
                owned_job.as_ref().expect("owned job is present"),
                cancellation,
                termination == Termination::Cancelled,
                &mut max_active_processes,
            ) {
                Ok((final_active_processes, cancellation_observed)) => Ok((
                    status,
                    if cancellation_observed {
                        Termination::Cancelled
                    } else {
                        termination
                    },
                    final_active_processes,
                )),
                // Its own kind, because what it means is its own fact: the Job
                // still held processes when its window closed, and nothing
                // after this observes them leave.
                Err(error) => Err(ProcessError::OwnedJobNotEmptied {
                    detail: format!("failed to observe an empty owned process job: {error}"),
                }),
            }
        }
        Err(error) => Err(error),
    };

    // Read the owned Job's peak accounting while the Job still exists. A failed
    // query only removes an advisory number; it never changes the outcome.
    let peak_job_memory_bytes = owned_job
        .as_ref()
        .and_then(|job| ProcessJob::peak_memory_bytes(job).ok())
        .flatten();
    // The cumulative count, taken here for the same reason and answering a
    // different question from the sampled peak: how many processes this run
    // ever owned, with no interval it could have missed one in.
    let total_owned_processes = owned_job
        .as_ref()
        .and_then(|job| ProcessJob::total_process_count(job).ok())
        .flatten();
    let cleanup = if execution.is_err() {
        force_owned_cleanup(&mut child, &mut owned_job)
    } else {
        Ok(())
    };
    let captures = join_captures(stdout_reader, stderr_reader);
    drop(owned_job);

    let (status, termination, final_active_processes) = execution.map_err(|error| {
        add_process_cleanup_context(error, cleanup.as_ref().err(), captures.as_ref().err())
    })?;
    cleanup?;
    let (stdout, stderr) = captures?;

    Ok(ProcessOutput {
        stdout: stdout.bytes,
        stderr: stderr.bytes,
        stdout_total_bytes: stdout.total_bytes,
        stderr_total_bytes: stderr.total_bytes,
        stdout_truncated: stdout.truncated,
        stderr_truncated: stderr.truncated,
        exit_code: status.code(),
        elapsed: started.elapsed(),
        termination,
        max_active_processes,
        final_active_processes,
        total_owned_processes,
        peak_job_memory_bytes,
        tree_ownership: ROOT_TREE_OWNERSHIP,
    })
}

/// What a successful supervised launch establishes about ownership on this
/// platform.
///
/// One constant rather than a value threaded through the launch path, because
/// the answer is a property of how this function creates and owns a process,
/// not of how a particular run went. Every path that reaches the `ProcessOutput`
/// below has created the root suspended and assigned it before resuming it.
#[cfg(windows)]
const ROOT_TREE_OWNERSHIP: TreeOwnership = TreeOwnership::EstablishedBeforeExecution;

/// Off Windows there is no owned Job, no suspended creation and no process-tree
/// termination, so nothing here establishes ownership over a tree.
///
/// Nothing regresses: `OwnedProcessJob::terminate` is already unsupported off
/// Windows and its accounting already reports `None`, so a successful
/// `Cancelled` for a launched run was unreachable before this constant existed
/// and stays unreachable now.
#[cfg(not(windows))]
const ROOT_TREE_OWNERSHIP: TreeOwnership = TreeOwnership::NotEstablishedBeforeExecution;

/// Creates the root process suspended, so that ownership can be established
/// before it executes.
#[cfg(windows)]
fn suspend_root_creation(command: &mut Command) {
    use std::os::windows::process::CommandExt;

    // CREATE_SUSPENDED. The process and its primary thread are created, the
    // standard handles this command configured are inherited, and the thread is
    // left with a suspend count of one so no instruction of the image runs.
    const CREATE_SUSPENDED: u32 = 0x0000_0004;

    command.creation_flags(CREATE_SUSPENDED);
}

#[cfg(not(windows))]
fn suspend_root_creation(_command: &mut Command) {}

/// Starts the owned root process.
///
/// Called only after [`OwnedProcessJob::assign`] has succeeded, so what it
/// releases is a process this run already owns.
#[cfg(windows)]
fn resume_owned_root(child: &Child, _owned: &OwnedProcessJob) -> io::Result<()> {
    windows_job::resume_primary_thread(child)
}

#[cfg(not(windows))]
fn resume_owned_root(_child: &Child, _owned: &OwnedProcessJob) -> io::Result<()> {
    Ok(())
}

fn require_executable_identity(spec: &CommandSpec) -> Result<(), ProcessError> {
    let Some(expected_sha256) = spec.executable_sha256 else {
        return Ok(());
    };
    let actual_sha256 = Sha256Digest::calculate_file(&spec.executable).map_err(|error| {
        let kind = match error {
            Sha256Error::Io { source, .. } => source.kind(),
            _ => io::ErrorKind::Other,
        };
        ProcessError::ExecutableIdentityInspectionFailed { kind }
    })?;
    if actual_sha256 != expected_sha256 {
        return Err(ProcessError::ExecutableIdentityChanged);
    }
    Ok(())
}

fn require_source_identity(spec: &CommandSpec) -> Result<(), ProcessError> {
    let Some(source_identity) = &spec.source_identity else {
        return Ok(());
    };
    // Every member, not just the one the argv names. A bundle acquisition's
    // companion is opened by the vendor library without ever appearing on the
    // command line, so a companion swapped between admission and this moment
    // would be read by the backend and reported by nothing — the run would
    // succeed, and the document it produced would be of an acquisition the
    // caller never chose. The primary is checked first because it is the one
    // whose replacement is cheapest to arrange.
    let matches = source_identity
        .all_match_current()
        .map_err(|error| ProcessError::SourceIdentityInspectionFailed { kind: error.kind() })?;
    if !matches {
        return Err(ProcessError::SourceIdentityChanged);
    }
    Ok(())
}

fn require_output_safety(spec: &CommandSpec) -> Result<(), ProcessError> {
    // These checks close stale plans in the conservative sequential queue
    // immediately before spawn. They are deliberately not described as atomic
    // reservations: another process can still write after either snapshot.
    match &spec.output_safety {
        OutputSafety::None => Ok(()),
        OutputSafety::FreshDirectory {
            output_directory,
            source_directory_boundary,
        } => require_fresh_output_directory(output_directory, source_directory_boundary.as_deref()),
        OutputSafety::AbsentDestination {
            destination,
            source_directory_boundary,
        } => {
            require_output_destination_available(destination, source_directory_boundary.as_deref())
        }
    }
}

fn require_fresh_output_directory(
    output_directory: &Path,
    source_directory_boundary: Option<&Path>,
) -> Result<(), ProcessError> {
    let current_output_directory =
        if let Some(source_directory_boundary) = source_directory_boundary {
            let current_output_directory =
                std::fs::canonicalize(output_directory).map_err(|error| {
                    ProcessError::OutputDirectoryInspectionFailed { kind: error.kind() }
                })?;
            reject_output_inside_source(&current_output_directory, source_directory_boundary)?;
            current_output_directory
        } else {
            output_directory.to_path_buf()
        };
    let mut entries = std::fs::read_dir(&current_output_directory)
        .map_err(|error| ProcessError::OutputDirectoryInspectionFailed { kind: error.kind() })?;
    match entries.next() {
        Some(Ok(_)) => Err(ProcessError::OutputDirectoryNotEmpty),
        Some(Err(error)) => {
            Err(ProcessError::OutputDirectoryInspectionFailed { kind: error.kind() })
        }
        None => Ok(()),
    }
}

fn reject_output_inside_source(
    current_output_directory: &Path,
    source_directory_boundary: &Path,
) -> Result<(), ProcessError> {
    if current_output_directory.starts_with(source_directory_boundary) {
        return Err(ProcessError::OutputDirectoryInsideDirectoryInput);
    }
    Ok(())
}

fn require_output_destination_available(
    destination: &Path,
    source_directory_boundary: Option<&Path>,
) -> Result<(), ProcessError> {
    let parent = destination
        .parent()
        .ok_or(ProcessError::OutputDestinationInspectionFailed {
            kind: io::ErrorKind::InvalidInput,
        })?;
    let current_output_directory =
        if let Some(source_directory_boundary) = source_directory_boundary {
            let current_output_directory = std::fs::canonicalize(parent).map_err(|error| {
                ProcessError::OutputDestinationInspectionFailed { kind: error.kind() }
            })?;
            reject_output_inside_source(&current_output_directory, source_directory_boundary)?;
            current_output_directory
        } else {
            parent.to_path_buf()
        };
    let _entries = std::fs::read_dir(&current_output_directory)
        .map_err(|error| ProcessError::OutputDestinationInspectionFailed { kind: error.kind() })?;
    let file_name =
        destination
            .file_name()
            .ok_or(ProcessError::OutputDestinationInspectionFailed {
                kind: io::ErrorKind::InvalidInput,
            })?;
    match std::fs::symlink_metadata(current_output_directory.join(file_name)) {
        Ok(_) => Err(ProcessError::OutputDestinationExists),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(ProcessError::OutputDestinationInspectionFailed { kind: error.kind() }),
    }
}

fn monitor_process(
    child: &mut Child,
    owned_job: &OwnedProcessJob,
    cancellation: &CancellationToken,
    max_active_processes: &mut Option<u32>,
) -> Result<(ExitStatus, Termination), ProcessError> {
    loop {
        observe_active_processes(owned_job, max_active_processes).map_err(|error| {
            ProcessError::Wait {
                detail: format!("failed to query the owned process job: {error}"),
            }
        })?;

        // A process that completed before cancellation was observed remains an
        // ordinary exit. Once it is observed running and cancellation is set,
        // successful owned-job termination determines the Cancelled state.
        if let Some(status) = child.try_wait().map_err(wait_error)? {
            return Ok((status, Termination::Exited));
        }
        if cancellation.is_cancelled() {
            owned_job
                .terminate()
                .map_err(|error| ProcessError::Terminate {
                    detail: error.to_string(),
                })?;
            let status = child.wait().map_err(wait_error)?;
            return Ok((status, Termination::Cancelled));
        }
        thread::sleep(POLL_INTERVAL);
    }
}

fn observe_active_processes(
    owned_job: &impl ProcessJob,
    max_active_processes: &mut Option<u32>,
) -> io::Result<Option<u32>> {
    let active = owned_job.active_process_count()?;
    if let Some(active) = active {
        *max_active_processes = Some(max_active_processes.unwrap_or(0).max(active));
    }
    Ok(active)
}

fn wait_for_job_empty(
    owned_job: &OwnedProcessJob,
    cancellation: &CancellationToken,
    cancellation_observed: bool,
    max_active_processes: &mut Option<u32>,
) -> io::Result<(Option<u32>, bool)> {
    wait_for_job_empty_with_timeout(
        owned_job,
        cancellation,
        cancellation_observed,
        max_active_processes,
        JOB_EMPTY_TIMEOUT,
    )
}

fn wait_for_job_empty_with_timeout(
    owned_job: &impl ProcessJob,
    cancellation: &CancellationToken,
    mut cancellation_observed: bool,
    max_active_processes: &mut Option<u32>,
    empty_timeout: Duration,
) -> io::Result<(Option<u32>, bool)> {
    let mut deadline = Instant::now() + empty_timeout;
    loop {
        match observe_active_processes(owned_job, max_active_processes)? {
            None => return Ok((None, cancellation_observed)),
            Some(0) => return Ok((Some(0), cancellation_observed)),
            Some(_) if !cancellation_observed && cancellation.is_cancelled() => {
                owned_job.terminate()?;
                cancellation_observed = true;
                // Cancellation can first be observed as the original root-exit
                // deadline expires. Give successful Job termination its own
                // bounded window in which accounting can report an empty Job.
                deadline = Instant::now() + empty_timeout;
            }
            Some(active) if Instant::now() >= deadline => {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    format!("{active} process(es) remained active after {empty_timeout:?}"),
                ));
            }
            Some(_) => thread::sleep(POLL_INTERVAL),
        }
    }
}

fn force_owned_cleanup(
    child: &mut Child,
    owned_job: &mut Option<OwnedProcessJob>,
) -> Result<(), ProcessError> {
    let mut failures = Vec::new();
    if let Some(job) = owned_job.take() {
        if let Err(error) = job.terminate() {
            failures.push(format!("owned-job termination failed: {error}"));
        }
        // KILL_ON_JOB_CLOSE is a final process-tree safety net even when the
        // explicit TerminateJobObject call itself failed.
        drop(job);
    }
    collect_direct_child_cleanup(child, &mut failures);
    cleanup_result(failures)
}

fn force_unowned_cleanup(child: &mut Child) -> Result<(), ProcessError> {
    let mut failures = Vec::new();
    collect_direct_child_cleanup(child, &mut failures);
    cleanup_result(failures)
}

fn collect_direct_child_cleanup(child: &mut Child, failures: &mut Vec<String>) {
    if let Err(error) = child.kill() {
        failures.push(format!("direct-child termination failed: {error}"));
    }
    if let Err(error) = child.wait() {
        failures.push(format!("direct-child wait failed: {error}"));
    }
}

fn cleanup_result(failures: Vec<String>) -> Result<(), ProcessError> {
    if failures.is_empty() {
        Ok(())
    } else {
        Err(ProcessError::Wait {
            detail: failures.join("; "),
        })
    }
}

fn add_cleanup_context(
    primary: String,
    cleanup: Result<(), ProcessError>,
    capture: Option<ProcessError>,
) -> String {
    let mut detail = primary;
    if let Err(error) = cleanup {
        detail.push_str(&format!("; cleanup error: {error}"));
    }
    if let Some(error) = capture {
        detail.push_str(&format!("; capture cleanup error: {error}"));
    }
    detail
}

/// Folds what teardown and capture reported into the error a run returns.
///
/// **A failed owned teardown changes the kind, not only the text.** The
/// difference between "this run failed and its Job was terminated" and "this
/// run failed and its Job would not go" is the whole of what decides whether
/// anything of this session's may start next, and folding the second into a
/// detail string is how it stopped being decidable.
fn add_process_cleanup_context(
    primary: ProcessError,
    cleanup: Option<&ProcessError>,
    capture: Option<&ProcessError>,
) -> ProcessError {
    if cleanup.is_none() && capture.is_none() {
        return primary;
    }

    let mut detail = primary.to_string();
    if let Some(error) = cleanup {
        detail.push_str(&format!("; cleanup error: {error}"));
    }
    if let Some(error) = capture {
        detail.push_str(&format!("; capture cleanup error: {error}"));
    }
    if cleanup.is_some() {
        return ProcessError::OwnedJobNotEmptied { detail };
    }
    ProcessError::Wait { detail }
}

fn process_command(spec: &CommandSpec) -> Result<Command, ProcessError> {
    let mut command = Command::new(&spec.executable);
    command
        .env_clear()
        .args(&spec.args)
        .current_dir(&spec.working_directory)
        .stdin(Stdio::null());
    configure_minimal_environment(&mut command, spec)?;
    Ok(command)
}

#[cfg(windows)]
fn configure_minimal_environment(
    command: &mut Command,
    spec: &CommandSpec,
) -> Result<(), ProcessError> {
    let windows_root = std::env::var_os("SystemRoot")
        .or_else(|| std::env::var_os("WINDIR"))
        .map(std::path::PathBuf::from)
        .filter(|path| path.is_absolute())
        .ok_or_else(|| ProcessError::InvalidEnvironment {
            detail: "SystemRoot/WINDIR is missing or not absolute".to_owned(),
        })?;
    let temporary_directory = dedicated_temporary_directory()?;
    let executable_directory =
        spec.executable
            .parent()
            .ok_or_else(|| ProcessError::InvalidEnvironment {
                detail: "the backend executable has no parent directory".to_owned(),
            })?;
    let system32 = windows_root.join("System32");
    let path = join_unique_paths([
        executable_directory,
        system32.as_path(),
        windows_root.as_path(),
    ])?;

    command
        .env("SystemRoot", &windows_root)
        .env("WINDIR", &windows_root)
        .env("TEMP", &temporary_directory)
        .env("TMP", &temporary_directory)
        .env("PATH", path);
    Ok(())
}

#[cfg(windows)]
fn dedicated_temporary_directory() -> Result<std::path::PathBuf, ProcessError> {
    let temp = std::env::var_os("TEMP").or_else(|| std::env::var_os("TMP"));
    let temp = temp
        .map(std::path::PathBuf::from)
        .filter(|path| path.is_absolute() && path.is_dir())
        .ok_or_else(|| ProcessError::InvalidEnvironment {
            detail: "TEMP/TMP is missing, not absolute, or not an existing directory".to_owned(),
        })?;
    Ok(temp)
}

#[cfg(windows)]
fn join_unique_paths<'a>(
    paths: impl IntoIterator<Item = &'a Path>,
) -> Result<OsString, ProcessError> {
    let mut unique = Vec::new();
    for path in paths {
        if !unique
            .iter()
            .any(|existing: &&Path| existing.as_os_str().eq_ignore_ascii_case(path.as_os_str()))
        {
            unique.push(path);
        }
    }
    std::env::join_paths(unique).map_err(|error| ProcessError::InvalidEnvironment {
        detail: format!("minimal PATH could not be constructed: {error}"),
    })
}

#[cfg(not(windows))]
fn configure_minimal_environment(
    command: &mut Command,
    spec: &CommandSpec,
) -> Result<(), ProcessError> {
    let temporary_directory = std::env::var_os("TMPDIR")
        .or_else(|| std::env::var_os("TMP"))
        .or_else(|| std::env::var_os("TEMP"))
        .map(std::path::PathBuf::from)
        .filter(|path| path.is_absolute() && path.is_dir())
        .unwrap_or_else(std::env::temp_dir);
    let executable_directory = spec.executable.parent().unwrap_or_else(|| Path::new(""));
    command
        .env("TMPDIR", &temporary_directory)
        .env("TEMP", &temporary_directory)
        .env("TMP", &temporary_directory)
        .env("PATH", executable_directory);
    Ok(())
}

fn capture_stream(
    stream: impl Read + Send + 'static,
) -> thread::JoinHandle<io::Result<CapturedStream>> {
    capture_stream_with_limit(stream, CAPTURE_LIMIT_BYTES)
}

#[derive(Debug, PartialEq, Eq)]
struct CapturedStream {
    bytes: Vec<u8>,
    total_bytes: u64,
    truncated: bool,
}

fn capture_stream_with_limit(
    mut stream: impl Read + Send + 'static,
    limit: usize,
) -> thread::JoinHandle<io::Result<CapturedStream>> {
    thread::spawn(move || {
        let mut bytes = Vec::with_capacity(limit.min(64 * 1024));
        let mut total_bytes = 0_u64;
        let mut buffer = [0_u8; 8192];
        loop {
            let count = match stream.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => count,
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Err(error) => return Err(error),
            };
            total_bytes = total_bytes.saturating_add(count as u64);
            let remaining = limit.saturating_sub(bytes.len());
            bytes.extend_from_slice(&buffer[..count.min(remaining)]);
        }
        Ok(CapturedStream {
            truncated: total_bytes > bytes.len() as u64,
            bytes,
            total_bytes,
        })
    })
}

fn join_captures(
    stdout_reader: thread::JoinHandle<io::Result<CapturedStream>>,
    stderr_reader: thread::JoinHandle<io::Result<CapturedStream>>,
) -> Result<(CapturedStream, CapturedStream), ProcessError> {
    // Evaluate both joins before returning so one failed reader never detaches
    // the other capture thread.
    let stdout = join_capture(stdout_reader, "stdout");
    let stderr = join_capture(stderr_reader, "stderr");
    match (stdout, stderr) {
        (Ok(stdout), Ok(stderr)) => Ok((stdout, stderr)),
        (Err(stdout), Ok(_)) => Err(stdout),
        (Ok(_), Err(stderr)) => Err(stderr),
        (Err(stdout), Err(stderr)) => Err(ProcessError::Capture {
            stream: "stdout and stderr",
            detail: format!("{stdout}; {stderr}"),
        }),
    }
}

fn join_capture(
    reader: thread::JoinHandle<io::Result<CapturedStream>>,
    stream: &'static str,
) -> Result<CapturedStream, ProcessError> {
    reader
        .join()
        .map_err(|_| ProcessError::Capture {
            stream,
            detail: "capture thread panicked".to_owned(),
        })?
        .map_err(|error| ProcessError::Capture {
            stream,
            detail: error.to_string(),
        })
}

fn launch_error(spec: &CommandSpec, error: &io::Error) -> ProcessError {
    let kind = match error.kind() {
        io::ErrorKind::NotFound => LaunchFailureKind::NotFound,
        io::ErrorKind::PermissionDenied => LaunchFailureKind::PermissionDenied,
        _ => LaunchFailureKind::Other,
    };
    ProcessError::Launch {
        executable: spec.executable.to_string_lossy().into_owned(),
        kind,
        detail: error.to_string(),
    }
}

fn wait_error(error: io::Error) -> ProcessError {
    ProcessError::Wait {
        detail: error.to_string(),
    }
}

#[cfg(windows)]
use windows_job::OwnedProcessJob;

trait ProcessJob {
    fn terminate(&self) -> io::Result<()>;
    fn active_process_count(&self) -> io::Result<Option<u32>>;
    fn total_process_count(&self) -> io::Result<Option<u32>>;
    fn peak_memory_bytes(&self) -> io::Result<Option<u64>>;
}

impl ProcessJob for OwnedProcessJob {
    fn terminate(&self) -> io::Result<()> {
        Self::terminate(self)
    }

    fn active_process_count(&self) -> io::Result<Option<u32>> {
        Self::active_process_count(self)
    }

    fn total_process_count(&self) -> io::Result<Option<u32>> {
        Self::total_process_count(self)
    }

    fn peak_memory_bytes(&self) -> io::Result<Option<u64>> {
        Self::peak_memory_bytes(self)
    }
}

#[cfg(not(windows))]
struct OwnedProcessJob;

#[cfg(not(windows))]
impl OwnedProcessJob {
    fn assign(_child: &Child) -> io::Result<Self> {
        Ok(Self)
    }

    fn terminate(&self) -> io::Result<()> {
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "owned process-tree termination is implemented only on Windows",
        ))
    }

    fn active_process_count(&self) -> io::Result<Option<u32>> {
        Ok(None)
    }

    fn total_process_count(&self) -> io::Result<Option<u32>> {
        Ok(None)
    }

    fn peak_memory_bytes(&self) -> io::Result<Option<u64>> {
        Ok(None)
    }
}

#[cfg(windows)]
mod windows_job {
    use std::ffi::c_void;
    use std::io;
    use std::mem::size_of;
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use std::process::Child;
    use std::ptr;

    type Handle = *mut c_void;
    type Bool = i32;

    const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x0000_2000;
    const TH32CS_SNAPTHREAD: u32 = 0x0000_0004;
    const THREAD_SUSPEND_RESUME: u32 = 0x0002;
    const INVALID_HANDLE_VALUE: isize = -1;
    /// `ResumeThread` returns the thread's previous suspend count, or this on
    /// failure. Zero is not a failure: a thread that was not suspended keeps
    /// the count it had, because the call will not take one below zero.
    const RESUME_THREAD_FAILED: u32 = u32::MAX;
    /// How many times a thread snapshot is taken before its failure is the
    /// answer. The suspended process cannot change under it, so a retry asks
    /// the same question of a system that has moved on.
    const SNAPSHOT_ATTEMPTS: usize = 4;
    const SNAPSHOT_RETRY_DELAY: std::time::Duration = std::time::Duration::from_millis(15);
    const JOB_OBJECT_BASIC_ACCOUNTING_INFORMATION_CLASS: i32 = 1;
    const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS: i32 = 9;
    const CANCELLED_EXIT_CODE: u32 = 0xC000_013A;

    #[repr(C)]
    #[derive(Debug, Default)]
    struct IoCounters {
        read_operation_count: u64,
        write_operation_count: u64,
        other_operation_count: u64,
        read_transfer_count: u64,
        write_transfer_count: u64,
        other_transfer_count: u64,
    }

    #[repr(C)]
    #[derive(Debug, Default)]
    struct BasicLimitInformation {
        per_process_user_time_limit: i64,
        per_job_user_time_limit: i64,
        limit_flags: u32,
        minimum_working_set_size: usize,
        maximum_working_set_size: usize,
        active_process_limit: u32,
        affinity: usize,
        priority_class: u32,
        scheduling_class: u32,
    }

    #[repr(C)]
    #[derive(Debug, Default)]
    struct ExtendedLimitInformation {
        basic_limit_information: BasicLimitInformation,
        io_info: IoCounters,
        process_memory_limit: usize,
        job_memory_limit: usize,
        peak_process_memory_used: usize,
        peak_job_memory_used: usize,
    }

    #[repr(C)]
    #[derive(Debug, Default)]
    struct BasicAccountingInformation {
        total_user_time: i64,
        total_kernel_time: i64,
        this_period_total_user_time: i64,
        this_period_total_kernel_time: i64,
        total_page_fault_count: u32,
        total_processes: u32,
        active_processes: u32,
        total_terminated_processes: u32,
    }

    #[cfg(all(target_env = "msvc", target_pointer_width = "64"))]
    const _: [(); 144] = [(); size_of::<ExtendedLimitInformation>()];
    #[cfg(all(target_env = "msvc", target_pointer_width = "64"))]
    const _: [(); 48] = [(); size_of::<BasicAccountingInformation>()];

    #[link(name = "kernel32")]
    unsafe extern "system" {
        #[link_name = "CreateJobObjectW"]
        fn create_job_object_w(attributes: *const c_void, name: *const u16) -> Handle;
        #[link_name = "SetInformationJobObject"]
        fn set_information_job_object(
            job: Handle,
            information_class: i32,
            information: *const c_void,
            information_length: u32,
        ) -> Bool;
        #[link_name = "AssignProcessToJobObject"]
        fn assign_process_to_job_object(job: Handle, process: Handle) -> Bool;
        #[link_name = "TerminateJobObject"]
        fn terminate_job_object(job: Handle, exit_code: u32) -> Bool;
        #[link_name = "QueryInformationJobObject"]
        fn query_information_job_object(
            job: Handle,
            information_class: i32,
            information: *mut c_void,
            information_length: u32,
            return_length: *mut u32,
        ) -> Bool;
        #[link_name = "CreateToolhelp32Snapshot"]
        fn create_toolhelp32_snapshot(flags: u32, process_id: u32) -> Handle;
        #[link_name = "Thread32First"]
        fn thread32_first(snapshot: Handle, entry: *mut ThreadEntry32) -> Bool;
        #[link_name = "Thread32Next"]
        fn thread32_next(snapshot: Handle, entry: *mut ThreadEntry32) -> Bool;
        #[link_name = "OpenThread"]
        fn open_thread(access: u32, inherit_handle: Bool, thread_id: u32) -> Handle;
        #[link_name = "ResumeThread"]
        fn resume_thread(thread: Handle) -> u32;
    }

    #[repr(C)]
    #[derive(Debug, Default)]
    struct ThreadEntry32 {
        size: u32,
        usage: u32,
        thread_id: u32,
        owner_process_id: u32,
        base_priority: i32,
        delta_priority: i32,
        flags: u32,
    }

    /// Starts the suspended root process this run already owns.
    ///
    /// Stable `std::process` creates the process but hands back no handle to
    /// its primary thread, so the threads are found by asking the system which
    /// ones belong to the child's process id. That identification is sound
    /// rather than a lookup that could hit a stranger because the caller still
    /// holds the child's process handle: the process cannot have exited and its
    /// id cannot have been reused, so every thread reported for that id belongs
    /// to the process this run created.
    ///
    /// **Every one of them is resumed, and a count other than one is not an
    /// error.** An earlier version took "a process created suspended has one
    /// thread" as an identity check and refused anything else. A process
    /// created suspended does have one thread of its own — but a second thread
    /// in it need not be a stranger's process, it can be one another product
    /// injected, which endpoint security software does routinely. This boundary
    /// is the one every lane uses, so that refusal would have failed conversion,
    /// discovery and preview alike on such a machine, over something that was
    /// never about ownership in the first place. Ownership comes from
    /// `CREATE_SUSPENDED` and the Job assignment that both precede this call,
    /// and no thread count changes what they established.
    ///
    /// What the count was standing in for is still required, and is checked
    /// directly: some thread must report a previous suspend count of one, which
    /// is the primary thread exactly as it was created and before it ran.
    /// Resuming a thread that was not suspended does nothing at all, so the
    /// others cost only the call.
    ///
    /// **And every thread must have been reachable.** A thread this run cannot
    /// open or resume is one it cannot say anything about, and "some thread
    /// reported one" would then be satisfied by a thread another product
    /// created suspended while the primary stayed exactly as it was — a root
    /// that never runs and a wait that never ends. Failing closed with the
    /// operating system's own reason is worse for nobody and better than a
    /// launch that hangs.
    pub(super) fn resume_primary_thread(child: &Child) -> io::Result<()> {
        let process_id = child.id();
        let threads = threads_of_owned_root(process_id)?;
        let mut resumed_one_created_suspended = false;
        // A thread this run cannot open or resume is remembered rather than
        // fatal. Whether the root will run is decided by the primary thread
        // alone, and that is what the loop is looking for.
        let mut refusal: Option<io::Error> = None;
        for thread_id in threads {
            // SAFETY: A thread id the system just reported for a live process,
            // asked for with the one access right this needs. The returned
            // handle is checked before use and owned exactly once.
            let raw_thread = unsafe { open_thread(THREAD_SUSPEND_RESUME, 0, thread_id) };
            if raw_thread.is_null() {
                refusal.get_or_insert_with(io::Error::last_os_error);
                continue;
            }
            // SAFETY: OpenThread returned a new, non-null owned HANDLE whose
            // ownership is transferred exactly once to OwnedHandle.
            let thread = unsafe { OwnedHandle::from_raw_handle(raw_thread) };
            // SAFETY: The handle remains owned by `thread` and is valid for the call.
            let previous_suspend_count = unsafe { resume_thread(thread.as_raw_handle()) };
            if previous_suspend_count == RESUME_THREAD_FAILED {
                refusal.get_or_insert_with(io::Error::last_os_error);
                continue;
            }
            if previous_suspend_count == 1 {
                resumed_one_created_suspended = true;
            }
        }
        match refusal {
            Some(error) => Err(error),
            None if resumed_one_created_suspended => Ok(()),
            None => Err(io::Error::other(
                "no thread of the owned root was still suspended as it was created, so \
                 this run cannot say the image had executed nothing when it took ownership",
            )),
        }
    }

    /// Every thread the system reports for a process.
    ///
    /// An empty answer is an error: the caller holds the process handle, so a
    /// process with no thread is a snapshot that has not caught up rather than
    /// a fact about the process.
    pub(super) fn threads_of_owned_root(process_id: u32) -> io::Result<Vec<u32>> {
        // The snapshot is documented to fail transiently while the system's
        // thread list is changing, so a single attempt would turn ordinary load
        // into a launch that refuses. Bounded, and short: the process being
        // asked about is suspended and cannot go anywhere in the meantime.
        let mut last = None;
        for attempt in 0..SNAPSHOT_ATTEMPTS {
            match threads_in_one_snapshot(process_id) {
                Ok(threads) => return Ok(threads),
                Err(error) => {
                    last = Some(error);
                    if attempt + 1 < SNAPSHOT_ATTEMPTS {
                        std::thread::sleep(SNAPSHOT_RETRY_DELAY);
                    }
                }
            }
        }
        Err(last.expect("at least one attempt was made"))
    }

    /// One snapshot, and every thread it reports for the process.
    fn threads_in_one_snapshot(process_id: u32) -> io::Result<Vec<u32>> {
        // SAFETY: A thread snapshot over every process, which is what the
        // documented call takes a zero process id to mean. The returned handle
        // is checked against both failure spellings before use.
        let raw_snapshot = unsafe { create_toolhelp32_snapshot(TH32CS_SNAPTHREAD, 0) };
        if raw_snapshot.is_null() || raw_snapshot as isize == INVALID_HANDLE_VALUE {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: CreateToolhelp32Snapshot returned a new, non-null owned HANDLE
        // whose ownership is transferred exactly once to OwnedHandle.
        let snapshot = unsafe { OwnedHandle::from_raw_handle(raw_snapshot) };
        let entry_size = structure_size::<ThreadEntry32>()?;
        let mut entry = ThreadEntry32 {
            size: entry_size,
            ..ThreadEntry32::default()
        };
        let mut found = Vec::new();
        // SAFETY: The snapshot is live and the entry is a correctly sized,
        // writable THREADENTRY32 for the duration of each call.
        let mut more = unsafe { thread32_first(snapshot.as_raw_handle(), &mut entry) };
        while more != 0 {
            if entry.owner_process_id == process_id {
                found.push(entry.thread_id);
            }
            // Reset on every iteration: the enumeration is documented to require
            // the size field, and a call that overwrote it would walk off.
            entry.size = entry_size;
            // SAFETY: As above.
            more = unsafe { thread32_next(snapshot.as_raw_handle(), &mut entry) };
        }
        if found.is_empty() {
            return Err(io::Error::other(
                "the owned root process reported no thread before it ran",
            ));
        }
        Ok(found)
    }

    #[derive(Debug)]
    pub(super) struct OwnedProcessJob {
        handle: OwnedHandle,
    }

    impl OwnedProcessJob {
        /// Creates the owned Job and puts `child` in it.
        ///
        /// The caller creates `child` suspended, so this runs before the image
        /// has executed anything and the Job therefore holds the creator of
        /// every process the backend can go on to create.
        ///
        /// The limit flags deliberately do **not** include
        /// `JOB_OBJECT_LIMIT_BREAKAWAY_OK` or its silent variant. Without them
        /// a descendant asking for `CREATE_BREAKAWAY_FROM_JOB` is refused by
        /// the kernel, so ownership established here cannot be given up later.
        /// Nested Jobs are what makes this safe to do inside another Job — the
        /// child joins both, and terminating this one still terminates it.
        pub(super) fn assign(child: &Child) -> io::Result<Self> {
            // SAFETY: Both optional pointers are null, requesting an unnamed job with
            // default security attributes. The returned handle is checked before use.
            let raw_job = unsafe { create_job_object_w(ptr::null(), ptr::null()) };
            if raw_job.is_null() {
                return Err(io::Error::last_os_error());
            }
            // SAFETY: CreateJobObjectW returned a new, non-null owned HANDLE whose
            // ownership is transferred exactly once to OwnedHandle.
            let handle = unsafe { OwnedHandle::from_raw_handle(raw_job) };
            let mut information = ExtendedLimitInformation::default();
            information.basic_limit_information.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let information_length = structure_size::<ExtendedLimitInformation>()?;
            // SAFETY: The job HANDLE is live, the information pointer references the
            // correct repr(C) structure for the supplied class, and its byte size is
            // exact for the duration of the call.
            let configured = unsafe {
                set_information_job_object(
                    handle.as_raw_handle(),
                    JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS,
                    ptr::from_ref(&information).cast(),
                    information_length,
                )
            };
            if configured == 0 {
                return Err(io::Error::last_os_error());
            }
            // SAFETY: Both handles are live. Child retains ownership of its process
            // handle, while this call only associates that process with the job.
            let assigned = unsafe {
                assign_process_to_job_object(handle.as_raw_handle(), child.as_raw_handle())
            };
            if assigned == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(Self { handle })
        }

        pub(super) fn terminate(&self) -> io::Result<()> {
            // SAFETY: The handle remains owned by self and is valid for this call.
            let terminated =
                unsafe { terminate_job_object(self.handle.as_raw_handle(), CANCELLED_EXIT_CODE) };
            if terminated == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        }

        pub(super) fn active_process_count(&self) -> io::Result<Option<u32>> {
            Ok(Some(self.accounting()?.active_processes))
        }

        /// One bounded accounting query, read by both counts.
        fn accounting(&self) -> io::Result<BasicAccountingInformation> {
            let mut information = BasicAccountingInformation::default();
            let information_length = structure_size::<BasicAccountingInformation>()?;
            // SAFETY: The handle is live and the mutable repr(C) buffer and byte size
            // match JobObjectBasicAccountingInformation for the duration of the call.
            let queried = unsafe {
                query_information_job_object(
                    self.handle.as_raw_handle(),
                    JOB_OBJECT_BASIC_ACCOUNTING_INFORMATION_CLASS,
                    ptr::from_mut(&mut information).cast(),
                    information_length,
                    ptr::null_mut(),
                )
            };
            if queried == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(information)
        }

        /// Every process this Job has ever held, cumulative and kernel-counted.
        ///
        /// The same bounded query as the active count, reading the other field
        /// of it. Sampling the active count can miss a process that lived
        /// entirely between two observations; this cannot.
        pub(super) fn total_process_count(&self) -> io::Result<Option<u32>> {
            Ok(Some(self.accounting()?.total_processes))
        }

        /// Peak committed memory charged to every process this Job has owned.
        ///
        /// The Job is the only bounded accounting scope that covers descendants
        /// the root process created, so a per-process working-set query would
        /// under-report a backend that spawns children.
        pub(super) fn peak_memory_bytes(&self) -> io::Result<Option<u64>> {
            let mut information = ExtendedLimitInformation::default();
            let information_length = structure_size::<ExtendedLimitInformation>()?;
            // SAFETY: The handle is live and the mutable repr(C) buffer and byte
            // size match JobObjectExtendedLimitInformation for this call.
            let queried = unsafe {
                query_information_job_object(
                    self.handle.as_raw_handle(),
                    JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS,
                    ptr::from_mut(&mut information).cast(),
                    information_length,
                    ptr::null_mut(),
                )
            };
            if queried == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(Some(information.peak_job_memory_used as u64))
        }
    }

    fn structure_size<T>() -> io::Result<u32> {
        u32::try_from(size_of::<T>()).map_err(|_| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                "Windows Job Object information structure exceeds u32",
            )
        })
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;
    use std::ffi::OsString;
    #[cfg(windows)]
    use std::fs;
    #[cfg(windows)]
    use std::io::Write;
    #[cfg(windows)]
    use std::path::{Path, PathBuf};
    #[cfg(windows)]
    use std::sync::atomic::AtomicUsize;
    #[cfg(windows)]
    use std::sync::mpsc;
    #[cfg(windows)]
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;
    use crate::BackendTool;

    /// Every way a run can end has its own identifier, and the two that a
    /// cancellation diagnostic must not confuse are not the same string.
    #[test]
    fn every_termination_has_its_own_stable_identifier() {
        let terminations = [
            Termination::Exited,
            Termination::Cancelled,
            Termination::NotStarted,
        ];
        let ids = terminations.map(Termination::stable_id);
        let unique = ids.iter().collect::<std::collections::BTreeSet<_>>();
        assert_eq!(unique.len(), ids.len(), "{ids:?}");
        assert_ne!(
            Termination::Cancelled.stable_id(),
            Termination::NotStarted.stable_id()
        );

        for termination in terminations {
            assert_eq!(
                termination.is_cancellation(),
                termination != Termination::Exited,
                "{termination:?}"
            );
            assert_eq!(
                termination.launched(),
                termination != Termination::NotStarted,
                "{termination:?}"
            );
        }
    }

    #[test]
    fn missing_executable_is_distinct_from_non_zero_exit() {
        let spec = CommandSpec::new(
            BackendTool::MsConvert,
            std::env::current_dir()
                .expect("current directory")
                .join("definitely-not-an-mscanvas-test-executable"),
            std::iter::empty::<OsString>(),
            std::env::current_dir().expect("current directory"),
        );
        let error = execute(&spec).expect_err("missing executable");
        assert!(matches!(
            error,
            ProcessError::Launch {
                kind: LaunchFailureKind::NotFound,
                ..
            }
        ));
    }

    #[cfg(windows)]
    #[test]
    fn missing_validated_executable_fails_during_identity_recheck() {
        let spec = CommandSpec::new(
            BackendTool::MsConvert,
            std::env::current_dir()
                .expect("current directory")
                .join("definitely-not-an-mscanvas-validated-executable"),
            std::iter::empty::<OsString>(),
            std::env::current_dir().expect("current directory"),
        )
        .with_executable_identity(Sha256Digest::from_bytes([0; 32]));

        assert_eq!(
            execute(&spec),
            Err(ProcessError::ExecutableIdentityInspectionFailed {
                kind: io::ErrorKind::NotFound,
            })
        );
    }

    #[cfg(windows)]
    #[test]
    fn validated_executable_identity_allows_the_controlled_child_to_launch() {
        let test_directory = TestDirectory::new();
        let marker = test_directory.path().join("child-launched");
        let executable = test_directory.path().join("controlled-child.exe");
        fs::copy(
            std::env::current_exe().expect("test executable"),
            &executable,
        )
        .expect("copy controlled child executable");
        let executable_sha256 =
            Sha256Digest::calculate_file(&executable).expect("hash controlled child executable");
        let spec = CommandSpec::new(
            BackendTool::MsConvert,
            &executable,
            [
                "--ignored",
                "--exact",
                "process::tests::controlled_output_marker",
                "--nocapture",
                "--test-threads=1",
            ],
            test_directory.path(),
        )
        .with_executable_identity(executable_sha256);

        let output = execute(&spec).expect("unchanged executable identity permits launch");

        assert!(output.success());
        assert!(
            marker.is_file(),
            "the validated controlled child did not launch"
        );
    }

    #[cfg(windows)]
    #[test]
    fn peak_job_memory_is_reported_for_a_supervised_controlled_child() {
        let test_directory = TestDirectory::new();
        let spec = CommandSpec::new(
            BackendTool::MsConvert,
            std::env::current_exe().expect("test executable"),
            [
                "--ignored",
                "--exact",
                "process::tests::controlled_output_marker",
                "--nocapture",
                "--test-threads=1",
            ],
            test_directory.path(),
        );

        let output = execute(&spec).expect("the controlled child is supervised");

        assert!(output.success());
        // The owned Job is the only accounting scope that also covers
        // descendants, so a real supervised run must expose a nonzero peak.
        let peak = output
            .peak_job_memory_bytes
            .expect("Windows exposes owned-job peak memory accounting");
        assert!(peak > 0, "peak job memory was {peak}");
    }

    #[cfg(not(windows))]
    #[test]
    fn peak_job_memory_is_explicitly_unavailable_without_an_owned_job() {
        let job = OwnedProcessJob;

        assert_eq!(ProcessJob::peak_memory_bytes(&job).expect("query"), None);
    }

    #[cfg(windows)]
    #[test]
    fn replaced_executable_is_rejected_before_the_child_launches() {
        let test_directory = TestDirectory::new();
        let marker = test_directory.path().join("child-launched");
        let executable = test_directory.path().join("controlled-child.exe");
        fs::copy(
            std::env::current_exe().expect("test executable"),
            &executable,
        )
        .expect("copy controlled child executable");
        let executable_sha256 =
            Sha256Digest::calculate_file(&executable).expect("hash controlled child executable");
        let spec = CommandSpec::new(
            BackendTool::MsConvert,
            &executable,
            [
                "--ignored",
                "--exact",
                "process::tests::controlled_output_marker",
                "--nocapture",
                "--test-threads=1",
            ],
            test_directory.path(),
        )
        .with_executable_identity(executable_sha256);
        fs::write(&executable, b"replacement executable")
            .expect("replace controlled child executable after planning");

        let error = execute(&spec).expect_err("changed executable identity must fail closed");

        assert_eq!(error, ProcessError::ExecutableIdentityChanged);
        assert!(!marker.exists(), "the replaced executable was launched");
    }

    #[cfg(windows)]
    #[test]
    fn unchanged_source_identity_allows_the_controlled_child_to_launch() {
        let test_directory = TestDirectory::new();
        let marker = test_directory.path().join("child-launched");
        let source = test_directory.path().join("sample.mzML");
        fs::write(&source, b"source sentinel").expect("write source sentinel");
        let source_identity = SourceIdentity::capture(&source).expect("capture source identity");
        let spec = CommandSpec::new(
            BackendTool::MsConvert,
            std::env::current_exe().expect("test executable"),
            [
                "--ignored",
                "--exact",
                "process::tests::controlled_output_marker",
                "--nocapture",
                "--test-threads=1",
            ],
            test_directory.path(),
        )
        .with_source_identity(source_identity);

        let output = execute(&spec).expect("unchanged source identity permits launch");

        assert!(output.success());
        assert!(marker.is_file(), "the controlled child did not launch");
    }

    #[cfg(windows)]
    #[test]
    fn replaced_file_or_directory_source_is_rejected_before_child_launch() {
        for is_directory in [false, true] {
            let test_directory = TestDirectory::new();
            let marker = test_directory.path().join("child-launched");
            let source = test_directory.path().join("sample.raw");
            if is_directory {
                fs::create_dir(&source).expect("create directory source");
            } else {
                fs::write(&source, b"source sentinel").expect("write file source");
            }
            let source_identity =
                SourceIdentity::capture(&source).expect("capture source identity");
            let spec = CommandSpec::new(
                BackendTool::MsConvert,
                std::env::current_exe().expect("test executable"),
                [
                    "--ignored",
                    "--exact",
                    "process::tests::controlled_output_marker",
                    "--nocapture",
                    "--test-threads=1",
                ],
                test_directory.path(),
            )
            .with_source_identity(source_identity);
            fs::rename(&source, test_directory.path().join("original-source"))
                .expect("rename planned source");
            if is_directory {
                fs::create_dir(&source).expect("create replacement directory source");
            } else {
                fs::write(&source, b"replacement source").expect("write replacement file source");
            }

            let error = execute(&spec).expect_err("a replaced source must fail closed");

            assert_eq!(error, ProcessError::SourceIdentityChanged);
            assert!(
                !marker.exists(),
                "the replaced-source plan launched its child"
            );
        }
    }

    /// A companion never appears in the argv, so the pre-spawn recheck is the
    /// only thing standing between a replaced one and a backend that reads it.
    ///
    /// Aimed at this boundary rather than at a conversion, deliberately. The
    /// admitted run pins every member before it builds a command, so a
    /// conversion-level test proves the *admission* recheck and would stay
    /// green with this one gone. What is checked here is that a spec carrying
    /// more than one bound object has all of them confirmed, by the boundary
    /// that owns the moment before a process starts.
    #[cfg(windows)]
    #[test]
    fn a_replaced_companion_fails_closed_even_though_the_primary_is_intact() {
        let test_directory = TestDirectory::new();
        let marker = test_directory.path().join("child-launched");

        let primary = test_directory.path().join("acquisition.wiff");
        let companion = test_directory.path().join("acquisition.wiff.scan");
        fs::write(&primary, b"primary sentinel").expect("write the primary");
        fs::write(&companion, b"companion sentinel").expect("write the companion");
        let spec = CommandSpec::new(
            BackendTool::MsConvert,
            std::env::current_exe().expect("test executable"),
            [
                "--ignored",
                "--exact",
                "process::tests::controlled_output_marker",
                "--nocapture",
                "--test-threads=1",
            ],
            test_directory.path(),
        )
        .with_source_identity(SourceIdentity::capture(&primary).expect("capture the primary"))
        .with_source_companion_identities(vec![
            SourceIdentity::capture(&companion).expect("capture the companion"),
        ])
        .expect("bind a two-member acquisition");

        // The primary is untouched; only the companion is swapped for another
        // object. Nothing on the command line changed.
        fs::rename(&companion, test_directory.path().join("original-companion"))
            .expect("move the companion aside");
        fs::write(&companion, b"a different acquisition's companion")
            .expect("write a replacement companion");

        let error = execute(&spec).expect_err("a replaced companion must fail closed");
        assert_eq!(error, ProcessError::SourceIdentityChanged);
        assert!(
            !marker.exists(),
            "the replaced-companion plan launched its child"
        );
    }

    #[cfg(windows)]
    #[test]
    fn missing_source_fails_during_identity_recheck() {
        let test_directory = TestDirectory::new();
        let marker = test_directory.path().join("child-launched");
        let source = test_directory.path().join("sample.mzML");
        fs::write(&source, b"source sentinel").expect("write source sentinel");
        let source_identity = SourceIdentity::capture(&source).expect("capture source identity");
        let spec = CommandSpec::new(
            BackendTool::MsConvert,
            std::env::current_exe().expect("test executable"),
            [
                "--ignored",
                "--exact",
                "process::tests::controlled_output_marker",
                "--nocapture",
                "--test-threads=1",
            ],
            test_directory.path(),
        )
        .with_source_identity(source_identity);
        fs::remove_file(&source).expect("remove planned source");

        let error = execute(&spec).expect_err("a missing source must fail closed");

        assert_eq!(
            error,
            ProcessError::SourceIdentityInspectionFailed {
                kind: io::ErrorKind::NotFound,
            }
        );
        assert!(
            !marker.exists(),
            "the missing-source plan launched its child"
        );
    }

    #[cfg(windows)]
    #[test]
    fn unrelated_output_entry_does_not_block_an_absent_conversion_destination() {
        let test_directory = TestDirectory::new();
        let marker = test_directory.path().join("child-launched");
        let destination = test_directory.path().join("planned.mzML");
        let source = test_directory.path().join("source.mzML");
        fs::write(&source, b"source sentinel").expect("write source sentinel");
        fs::write(
            test_directory.path().join("unrelated.mzML"),
            b"earlier queue item",
        )
        .expect("write unrelated output");
        let spec = CommandSpec::new(
            BackendTool::MsConvert,
            std::env::current_exe().expect("test executable"),
            [
                "--ignored",
                "--exact",
                "process::tests::controlled_output_marker",
                "--nocapture",
                "--test-threads=1",
            ],
            test_directory.path(),
        )
        .with_output_destination(&destination, None);

        let output = execute(&spec).expect("an absent exact destination permits launch");

        assert!(output.success());
        assert!(marker.is_file(), "the controlled child did not launch");
        assert!(!destination.exists());
        assert_eq!(
            fs::read(source).expect("read source sentinel"),
            b"source sentinel"
        );
    }

    #[cfg(windows)]
    #[test]
    fn stale_conversion_plan_is_rejected_before_the_child_launches() {
        let test_directory = TestDirectory::new();
        let marker = test_directory.path().join("child-launched");
        let destination = test_directory.path().join("planned.mzML");
        let spec = CommandSpec::new(
            BackendTool::MsConvert,
            std::env::current_exe().expect("test executable"),
            [
                "--ignored",
                "--exact",
                "process::tests::controlled_output_marker",
                "--nocapture",
                "--test-threads=1",
            ],
            test_directory.path(),
        )
        .with_output_destination(&destination, None);
        fs::write(&destination, b"completed earlier queue item")
            .expect("create a conflict after planning");

        let error = execute(&spec).expect_err("the spawn-time recheck must reject a stale plan");

        assert_eq!(error, ProcessError::OutputDestinationExists);
        assert!(!marker.exists(), "the conflicting plan launched its child");
    }

    #[cfg(windows)]
    #[test]
    fn missing_destination_parent_is_rejected_before_the_child_launches() {
        let test_directory = TestDirectory::new();
        let marker = test_directory.path().join("child-launched");
        let output_directory = test_directory.path().join("removed-output-root");
        fs::create_dir(&output_directory).expect("create planned output root");
        let destination = output_directory.join("planned.mzML");
        let spec = CommandSpec::new(
            BackendTool::MsConvert,
            std::env::current_exe().expect("test executable"),
            [
                "--ignored",
                "--exact",
                "process::tests::controlled_output_marker",
                "--nocapture",
                "--test-threads=1",
            ],
            test_directory.path(),
        )
        .with_output_destination(&destination, None);
        fs::remove_dir(&output_directory).expect("remove output root after planning");

        let error = execute(&spec).expect_err("a missing output root must fail closed");

        assert_eq!(
            error,
            ProcessError::OutputDestinationInspectionFailed {
                kind: io::ErrorKind::NotFound,
            }
        );
        assert!(
            !marker.exists(),
            "the uninspectable plan launched its child"
        );
    }

    #[cfg(windows)]
    #[test]
    fn destination_directory_is_also_an_output_conflict() {
        let test_directory = TestDirectory::new();
        let destination = test_directory.path().join("planned.mzML");
        fs::create_dir(&destination).expect("create destination directory");
        let spec = CommandSpec::new(
            BackendTool::MsConvert,
            std::env::current_exe().expect("test executable"),
            std::iter::empty::<OsString>(),
            test_directory.path(),
        )
        .with_output_destination(&destination, None);

        assert_eq!(
            require_output_safety(&spec),
            Err(ProcessError::OutputDestinationExists)
        );
    }

    #[cfg(windows)]
    #[test]
    fn fresh_preview_output_directory_allows_the_controlled_child_to_launch() {
        let test_directory = TestDirectory::new();
        let marker = test_directory.path().join("child-launched");
        let spec = CommandSpec::new(
            BackendTool::MsAccess,
            std::env::current_exe().expect("test executable"),
            [
                "--ignored",
                "--exact",
                "process::tests::controlled_output_marker",
                "--nocapture",
                "--test-threads=1",
            ],
            test_directory.path(),
        )
        .with_fresh_output_directory(test_directory.path(), None);

        let output = execute(&spec).expect("a fresh preview output root permits launch");

        assert!(output.success());
        assert!(marker.is_file(), "the controlled child did not launch");
    }

    #[cfg(windows)]
    #[test]
    fn stale_preview_plan_is_rejected_before_the_child_launches() {
        let test_directory = TestDirectory::new();
        let marker = test_directory.path().join("child-launched");
        let spec = CommandSpec::new(
            BackendTool::MsAccess,
            std::env::current_exe().expect("test executable"),
            [
                "--ignored",
                "--exact",
                "process::tests::controlled_output_marker",
                "--nocapture",
                "--test-threads=1",
            ],
            test_directory.path(),
        )
        .with_fresh_output_directory(test_directory.path(), None);
        fs::write(
            test_directory.path().join("previous-preview.txt"),
            b"completed earlier preview",
        )
        .expect("populate preview output root after planning");

        let error = execute(&spec).expect_err("the stale preview plan must fail closed");

        assert_eq!(error, ProcessError::OutputDirectoryNotEmpty);
        assert!(
            !marker.exists(),
            "the stale preview plan launched its child"
        );
    }

    #[cfg(windows)]
    #[test]
    fn missing_preview_output_root_is_rejected_before_the_child_launches() {
        let test_directory = TestDirectory::new();
        let marker = test_directory.path().join("child-launched");
        let preview_output = test_directory.path().join("removed-preview-root");
        fs::create_dir(&preview_output).expect("create preview output root");
        let spec = CommandSpec::new(
            BackendTool::MsAccess,
            std::env::current_exe().expect("test executable"),
            [
                "--ignored",
                "--exact",
                "process::tests::controlled_output_marker",
                "--nocapture",
                "--test-threads=1",
            ],
            test_directory.path(),
        )
        .with_fresh_output_directory(&preview_output, None);
        fs::remove_dir(&preview_output).expect("remove preview output root after planning");

        let error = execute(&spec).expect_err("a missing preview output root must fail closed");

        assert_eq!(
            error,
            ProcessError::OutputDirectoryInspectionFailed {
                kind: io::ErrorKind::NotFound,
            }
        );
        assert!(
            !marker.exists(),
            "the uninspectable preview plan launched its child"
        );
    }

    #[cfg(windows)]
    #[test]
    fn output_inside_a_retained_source_boundary_is_rejected_before_child_launch() {
        let test_directory = TestDirectory::new();
        let marker = test_directory.path().join("child-launched");
        let source_directory = test_directory.path().join("dataset.raw");
        let output_directory = source_directory.join("retargeted-output");
        fs::create_dir_all(&output_directory).expect("create output inside source boundary");
        let source_directory =
            fs::canonicalize(source_directory).expect("canonical source directory");
        let output_directory =
            fs::canonicalize(output_directory).expect("canonical output directory");
        let destination = output_directory.join("planned.mzML");
        let spec = CommandSpec::new(
            BackendTool::MsConvert,
            std::env::current_exe().expect("test executable"),
            [
                "--ignored",
                "--exact",
                "process::tests::controlled_output_marker",
                "--nocapture",
                "--test-threads=1",
            ],
            test_directory.path(),
        )
        .with_output_destination(destination, Some(source_directory));

        let error = execute(&spec).expect_err("output inside the source boundary must fail closed");

        assert_eq!(error, ProcessError::OutputDirectoryInsideDirectoryInput);
        assert!(
            !marker.exists(),
            "the source-boundary violation launched its child"
        );
    }

    #[cfg(windows)]
    #[test]
    fn preview_inside_a_retained_source_boundary_is_rejected_before_child_launch() {
        let test_directory = TestDirectory::new();
        let marker = test_directory.path().join("child-launched");
        let source_directory = test_directory.path().join("dataset.raw");
        let output_directory = source_directory.join("retargeted-preview");
        fs::create_dir_all(&output_directory).expect("create preview inside source boundary");
        let source_directory =
            fs::canonicalize(source_directory).expect("canonical source directory");
        let output_directory =
            fs::canonicalize(output_directory).expect("canonical preview directory");
        let spec = CommandSpec::new(
            BackendTool::MsAccess,
            std::env::current_exe().expect("test executable"),
            [
                "--ignored",
                "--exact",
                "process::tests::controlled_output_marker",
                "--nocapture",
                "--test-threads=1",
            ],
            test_directory.path(),
        )
        .with_fresh_output_directory(output_directory, Some(source_directory));

        let error =
            execute(&spec).expect_err("preview inside the source boundary must fail closed");

        assert_eq!(error, ProcessError::OutputDirectoryInsideDirectoryInput);
        assert!(
            !marker.exists(),
            "the preview source-boundary violation launched its child"
        );
    }

    #[cfg(windows)]
    #[test]
    fn output_in_a_sibling_directory_of_the_retained_source_boundary_allows_launch() {
        let test_directory = TestDirectory::new();
        let source_directory = test_directory.path().join("dataset.raw");
        let output_directory = test_directory.path().join("converted");
        fs::create_dir(&source_directory).expect("create source boundary");
        fs::create_dir(&output_directory).expect("create sibling output directory");
        let source_directory =
            fs::canonicalize(source_directory).expect("canonical source directory");
        let output_directory =
            fs::canonicalize(output_directory).expect("canonical output directory");
        let marker = output_directory.join("child-launched");
        let destination = output_directory.join("planned.mzML");
        let spec = CommandSpec::new(
            BackendTool::MsConvert,
            std::env::current_exe().expect("test executable"),
            [
                "--ignored",
                "--exact",
                "process::tests::controlled_output_marker",
                "--nocapture",
                "--test-threads=1",
            ],
            &output_directory,
        )
        .with_output_destination(destination, Some(source_directory));

        let output = execute(&spec).expect("a safe sibling output permits launch");

        assert!(output.success());
        assert!(marker.is_file(), "the controlled child did not launch");
    }

    #[test]
    fn diagnostic_capture_is_bounded_while_the_stream_is_fully_drained() {
        let payload = vec![b'x'; 129];
        let capture = capture_stream_with_limit(io::Cursor::new(payload), 32)
            .join()
            .expect("capture thread")
            .expect("capture stream");

        assert_eq!(capture.bytes, vec![b'x'; 32]);
        assert_eq!(capture.total_bytes, 129);
        assert!(capture.truncated);
    }

    #[cfg(windows)]
    #[test]
    fn backend_child_environment_is_allowlisted_and_drops_sensitive_sentinels() {
        let test_directory = TestDirectory::new();
        let marker = test_directory.path().join("minimal-environment-verified");
        let status = Command::new(std::env::current_exe().expect("test executable"))
            .args([
                "--ignored",
                "--exact",
                "process::tests::controlled_environment_parent",
                "--nocapture",
                "--test-threads=1",
            ])
            .current_dir(test_directory.path())
            .env("TEMP", test_directory.path())
            .env("TMP", test_directory.path())
            .env("GITHUB_TOKEN", "must-not-reach-backend")
            .env("ACTIONS_RUNTIME_TOKEN", "must-not-reach-backend")
            .env("MSCANVAS_CREDENTIAL_SENTINEL", "must-not-reach-backend")
            .env("USERPROFILE", r"C:\sensitive-profile")
            .status()
            .expect("launch controlled environment parent");

        assert!(status.success(), "controlled environment parent failed");
        assert!(
            marker.is_file(),
            "backend child did not verify its environment"
        );
    }

    #[cfg(windows)]
    #[test]
    fn cancellation_terminates_an_owned_mock_process_tree() {
        let test_directory = TestDirectory::new();
        let release = test_directory.path().join("release");
        let parent_ready = test_directory.path().join("parent-ready");
        let grandchild_ready = test_directory.path().join("grandchild-ready");
        let executable = std::env::current_exe().expect("test executable");
        let spec = CommandSpec::new(
            BackendTool::MsConvert,
            &executable,
            [
                "--ignored",
                "--exact",
                "process::tests::controlled_mock_parent",
                "--nocapture",
                "--test-threads=1",
            ],
            std::env::current_dir().expect("current directory"),
        );
        let mut command = process_command(&spec).expect("construct controlled parent command");
        command.env("MSCANVAS_PROCESS_TEST_DIRECTORY", test_directory.path());

        let cancellation = CancellationToken::new();
        let run_cancellation = cancellation.clone();
        let (assigned_sender, assigned_receiver) = mpsc::channel();
        let run = thread::spawn(move || {
            execute_command_after_assignment(command, &spec, &run_cancellation, || {
                let _ = assigned_sender.send(());
            })
        });

        let assigned = assigned_receiver.recv_timeout(Duration::from_secs(3));
        if assigned.is_ok() {
            fs::write(&release, b"release").expect("release controlled parent");
        }
        let ready = assigned.is_ok()
            && wait_for_paths(&[&parent_ready, &grandchild_ready], Duration::from_secs(3));
        cancellation.cancel();
        let output = run
            .join()
            .expect("executor thread")
            .expect("cancel mock tree");

        assert!(assigned.is_ok(), "executor did not establish job ownership");
        assert!(ready, "controlled process tree did not become ready");
        assert_eq!(output.termination, Termination::Cancelled);
        assert!(output.max_active_processes.unwrap_or(0) >= 2);
        assert_eq!(output.final_active_processes, Some(0));
        assert!(String::from_utf8_lossy(&output.stdout).contains("mock child started"));
    }

    /// The claim is a conjunction, and neither half alone is it.
    ///
    /// An empty owned Job under an open ownership window is an observation
    /// about the processes ownership happened to hold. Ownership established
    /// before execution, over a Job that will not report itself empty, is not a
    /// terminated tree either.
    #[test]
    fn an_empty_job_is_an_empty_tree_only_where_ownership_preceded_execution() {
        let owned_and_empty = supervised_output(
            TreeOwnership::EstablishedBeforeExecution,
            Some(0),
            Termination::Cancelled,
        );
        assert!(owned_and_empty.owned_tree_confirmed_gone());

        for unconfirmed in [
            // Ownership after the fact: a descendant created before assignment
            // was never in the Job the count is about.
            supervised_output(
                TreeOwnership::NotEstablishedBeforeExecution,
                Some(0),
                Termination::Cancelled,
            ),
            // Owned from the start, and the Job still holds something.
            supervised_output(
                TreeOwnership::EstablishedBeforeExecution,
                Some(1),
                Termination::Cancelled,
            ),
            // No bounded accounting at all. `None` is not zero, and a run that
            // cannot count is not a run that counted nothing.
            supervised_output(
                TreeOwnership::EstablishedBeforeExecution,
                None,
                Termination::Cancelled,
            ),
        ] {
            assert!(
                !unconfirmed.owned_tree_confirmed_gone(),
                "{:?}/{:?} must not confirm a terminated tree",
                unconfirmed.tree_ownership,
                unconfirmed.final_active_processes
            );
        }
    }

    /// A run that never launched makes no claim about a tree in either
    /// direction, and carries no accounting to make one from.
    #[test]
    fn a_run_that_never_launched_claims_no_terminated_tree() {
        let refused = ProcessOutput::cancelled_before_launch();

        assert_eq!(refused.termination, Termination::NotStarted);
        assert!(!refused.termination.launched());
        assert!(!refused.owned_tree_confirmed_gone());
        assert_eq!(refused.final_active_processes, None);
        assert_eq!(refused.max_active_processes, None);
        assert_eq!(refused.exit_code, None);
    }

    /// A root that was created and could not be started is two different facts,
    /// and which one it is depends on teardown rather than on the failure.
    ///
    /// Reclaimed, it ran nothing and is gone. Unreclaimed, it is an owned
    /// process whose disappearance this boundary cannot state — which is what
    /// `NotTerminated` already means, and the state a stop must never be
    /// allowed to call clean.
    #[test]
    fn a_root_that_could_not_be_started_says_whether_it_was_reclaimed() {
        let reclaimed = ProcessError::ResumeOwnedRoot {
            detail: "the owned root thread had a suspend count of 0".to_owned(),
            owned_root_reclaimed: true,
        };
        let stranded = ProcessError::ResumeOwnedRoot {
            detail: "the owned root thread had a suspend count of 0".to_owned(),
            owned_root_reclaimed: false,
        };

        assert_ne!(reclaimed, stranded);
        // The detail is identical, so nothing but the reclamation tells them
        // apart -- which is the point of carrying it.
        assert_eq!(reclaimed.to_string(), stranded.to_string());
    }

    /// A process with several threads is enumerated, not refused.
    ///
    /// This is the property the launch path lost when it read "a process
    /// created suspended has one thread" as an identity check: on a machine
    /// where anything injects a thread, every lane that starts a backend would
    /// have failed. The test process is made to have several threads on
    /// purpose and the count is asserted, because a harness that happened to
    /// have one would make the assertion below say nothing.
    #[cfg(windows)]
    #[test]
    fn every_thread_of_a_process_is_reported_rather_than_only_a_lone_one() {
        let running = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));
        let spares = (0..3)
            .map(|_| {
                let running = std::sync::Arc::clone(&running);
                std::thread::spawn(move || {
                    while running.load(std::sync::atomic::Ordering::SeqCst) {
                        std::thread::sleep(Duration::from_millis(5));
                    }
                })
            })
            .collect::<Vec<_>>();

        let threads = windows_job::threads_of_owned_root(std::process::id())
            .expect("enumerate the threads of this process");

        running.store(false, std::sync::atomic::Ordering::SeqCst);
        for spare in spares {
            spare.join().expect("join a spare thread");
        }

        assert!(
            threads.len() > 1,
            "a process with several threads reported {} of them, so this test cannot \
             say whether more than one is refused",
            threads.len()
        );
        let unique = threads.iter().collect::<std::collections::BTreeSet<_>>();
        assert_eq!(
            unique.len(),
            threads.len(),
            "the same thread was reported twice: {threads:?}"
        );
    }

    #[test]
    fn every_tree_ownership_has_its_own_stable_identifier() {
        let ownerships = [
            TreeOwnership::EstablishedBeforeExecution,
            TreeOwnership::NotEstablishedBeforeExecution,
        ];
        let ids = ownerships.map(TreeOwnership::stable_id);
        assert_ne!(ids[0], ids[1]);
        assert!(TreeOwnership::EstablishedBeforeExecution.covers_every_descendant());
        assert!(!TreeOwnership::NotEstablishedBeforeExecution.covers_every_descendant());
    }

    /// The root has executed nothing at the moment ownership is taken.
    ///
    /// **This is the test that discriminates**, and it is the only one that
    /// can. The interval the published boundary left between `spawn()` and
    /// `AssignProcessToJobObject` is instructions wide; no child can be made to
    /// create a descendant reliably inside it, so no behavioural test of a
    /// descendant proves the interval is gone. What proves it is that the
    /// process exists, is owned, and has run none of its own image — which is
    /// observable directly.
    ///
    /// The marker's absence is the assertion, and resuming afterwards is what
    /// makes that absence mean suspension rather than a fixture that never
    /// worked. Against a boundary that did not create the root suspended, the
    /// child writes its marker immediately and the first assertion fails.
    #[cfg(windows)]
    #[test]
    fn the_root_has_executed_nothing_when_ownership_is_taken() {
        let test_directory = TestDirectory::new();
        let marker = test_directory.path().join("child-launched");
        let spec = CommandSpec::new(
            BackendTool::MsConvert,
            std::env::current_exe().expect("test executable"),
            [
                "--ignored",
                "--exact",
                "process::tests::controlled_output_marker",
                "--nocapture",
                "--test-threads=1",
            ],
            test_directory.path(),
        );
        // The production command, built the production way, suspended the
        // production way. Nothing here is a parallel launch path.
        let mut command = process_command(&spec).expect("construct the controlled command");
        command.stdout(Stdio::piped()).stderr(Stdio::piped());
        suspend_root_creation(&mut command);
        let mut child = command.spawn().expect("spawn the suspended root");

        // Ownership, taken exactly where the production path takes it.
        let owned_job = OwnedProcessJob::assign(&child).expect("assign the suspended root");

        // It has run nothing of its own: no marker, and it has not exited. A
        // running child writes the marker in milliseconds, so this window is
        // far longer than the one it would need.
        assert!(
            !wait_for_paths(&[&marker], Duration::from_millis(750)),
            "the root executed before ownership was established"
        );
        assert!(
            child.try_wait().expect("poll the suspended root").is_none(),
            "the root ran to an end before it was resumed"
        );
        // And the Job already holds it, which is what makes the absence above a
        // statement about an owned process rather than about any process.
        assert_eq!(
            ProcessJob::active_process_count(&owned_job).expect("query the owned job"),
            Some(1)
        );

        // Released, and only then does it run — which is what proves the
        // absence above was suspension.
        resume_owned_root(&child, &owned_job).expect("resume the owned root");
        assert!(
            wait_for_paths(&[&marker], Duration::from_secs(10)),
            "the resumed root never executed"
        );
        child.wait().expect("reap the controlled child");
        drop(owned_job);
    }

    /// A descendant created as early as the operating system allows is owned.
    ///
    /// **What this does not prove**, and the previous test does: that the
    /// escape interval is gone. This child starts a descendant as its first
    /// action, but "first action" is still an image load, a harness start and
    /// an argument filter later — tens of milliseconds, against an interval of
    /// instructions. A boundary that assigned a *running* child to its Job
    /// would own this descendant too.
    ///
    /// What it does prove is the other half, which the structural test does not
    /// reach: that ownership taken before execution actually holds a descendant
    /// the backend goes on to create, that the Job's accounting sees it, and
    /// that terminating the Job takes it with the root.
    #[cfg(windows)]
    #[test]
    fn a_descendant_created_at_startup_is_owned_and_terminated_with_the_root() {
        let test_directory = TestDirectory::new();
        let grandchild_ready = test_directory.path().join("grandchild-ready");
        let spec = CommandSpec::new(
            BackendTool::MsConvert,
            std::env::current_exe().expect("test executable"),
            [
                "--ignored",
                "--exact",
                "process::tests::controlled_racing_parent",
                "--nocapture",
                "--test-threads=1",
            ],
            std::env::current_dir().expect("current directory"),
        );
        let mut command = process_command(&spec).expect("construct the racing parent command");
        command.env("MSCANVAS_PROCESS_TEST_DIRECTORY", test_directory.path());

        let cancellation = CancellationToken::new();
        let run_cancellation = cancellation.clone();
        let run = thread::spawn(move || {
            execute_command_after_assignment(command, &spec, &run_cancellation, || {})
        });

        let ready = wait_for_paths(&[&grandchild_ready], Duration::from_secs(10));
        cancellation.cancel();
        let output = run
            .join()
            .expect("executor thread")
            .expect("cancel the racing tree");

        assert!(ready, "the racing descendant never signalled readiness");
        assert_eq!(output.termination, Termination::Cancelled);
        assert_eq!(
            output.tree_ownership,
            TreeOwnership::EstablishedBeforeExecution
        );
        assert!(
            output.max_active_processes.unwrap_or(0) >= 2,
            "the descendant created at startup was outside the owned job"
        );
        assert_eq!(output.final_active_processes, Some(0));
        assert!(output.owned_tree_confirmed_gone());
    }

    /// A root that exits the instant it has spawned leaves the run waiting on
    /// the Job rather than on the handle it happens to hold.
    ///
    /// The claim is about the *tree*, so the run cannot settle when the root
    /// goes: its descendant is still in the Job, and the emptiness the claim
    /// rests on is the Job's. This asserts the run reaches `Some(0)` only after
    /// that descendant is gone too, and that the disposition it publishes is
    /// the confirmed one rather than an admission.
    #[cfg(windows)]
    #[test]
    fn an_immediate_root_exit_still_waits_for_the_owned_job_to_empty() {
        let test_directory = TestDirectory::new();
        let release = test_directory.path().join("release");
        let grandchild_ready = test_directory.path().join("grandchild-ready");
        let spec = CommandSpec::new(
            BackendTool::MsConvert,
            std::env::current_exe().expect("test executable"),
            [
                "--ignored",
                "--exact",
                "process::tests::controlled_mock_parent",
                "--nocapture",
                "--test-threads=1",
            ],
            std::env::current_dir().expect("current directory"),
        );
        let mut command = process_command(&spec).expect("construct the exiting parent command");
        command
            .env("MSCANVAS_PROCESS_TEST_DIRECTORY", test_directory.path())
            .env("MSCANVAS_PROCESS_TEST_PARENT_EXITS_AFTER_SPAWN", "1");

        let cancellation = CancellationToken::new();
        let run_cancellation = cancellation.clone();
        let (assigned_sender, assigned_receiver) = mpsc::channel();
        let run = thread::spawn(move || {
            execute_command_after_assignment(command, &spec, &run_cancellation, || {
                let _ = assigned_sender.send(());
            })
        });

        let assigned = assigned_receiver.recv_timeout(Duration::from_secs(5));
        if assigned.is_ok() {
            fs::write(&release, b"release").expect("release the exiting parent");
        }
        let ready = wait_for_paths(&[&grandchild_ready], Duration::from_secs(10));
        cancellation.cancel();
        let output = run
            .join()
            .expect("executor thread")
            .expect("the surviving descendant is terminated through the owned job");

        assert!(assigned.is_ok(), "executor did not establish job ownership");
        assert!(ready, "the descendant of the exiting root never started");
        // The root left, the descendant did not, and the run kept waiting on
        // the Job rather than on the process it happened to have a handle for.
        // Two processes were owned across the run, and the root's own exit did
        // not settle it.
        assert!(
            output.max_active_processes.unwrap_or(0) >= 1,
            "the run never observed the owned job holding anything"
        );
        assert_eq!(output.termination, Termination::Cancelled);
        assert_eq!(output.final_active_processes, Some(0));
        assert!(output.owned_tree_confirmed_gone());
        assert!(
            output.termination.launched(),
            "a tree existed, so this is not the no-launch sense of the claim"
        );
    }

    /// Builds a supervised result for the conjunction tests above. Deliberately
    /// not a `Default`: a fixture that could omit the ownership field would let
    /// a later one claim a confirmed tree by forgetting to say otherwise.
    fn supervised_output(
        tree_ownership: TreeOwnership,
        final_active_processes: Option<u32>,
        termination: Termination,
    ) -> ProcessOutput {
        ProcessOutput {
            stdout: Vec::new(),
            stderr: Vec::new(),
            stdout_total_bytes: 0,
            stderr_total_bytes: 0,
            stdout_truncated: false,
            stderr_truncated: false,
            exit_code: Some(0),
            elapsed: Duration::from_millis(1),
            termination,
            max_active_processes: Some(1),
            final_active_processes,
            total_owned_processes: Some(1),
            peak_job_memory_bytes: None,
            tree_ownership,
        }
    }

    #[cfg(windows)]
    #[test]
    fn a_request_made_before_the_run_launches_no_process_at_all() {
        let test_directory = TestDirectory::new();
        let marker = test_directory.path().join("child-launched");
        let spec = CommandSpec::new(
            BackendTool::MsConvert,
            std::env::current_exe().expect("test executable"),
            [
                "--ignored",
                "--exact",
                "process::tests::controlled_output_marker",
                "--nocapture",
                "--test-threads=1",
            ],
            test_directory.path(),
        );
        let cancellation = CancellationToken::new();
        cancellation.cancel();

        let output = execute_cancellable(&spec, &cancellation).expect("a refusal is not a failure");

        assert!(!marker.exists(), "a refused run launched the child anyway");
        assert_eq!(output.termination, Termination::NotStarted);
        assert!(output.termination.is_cancellation());
        assert!(!output.termination.launched());
        assert_eq!(output.exit_code, None);
        assert_eq!(output.elapsed, Duration::ZERO);
        // No job was ever created, so there is no accounting to report. An
        // empty count here would be indistinguishable from the confirmation
        // that a tree which did exist is gone.
        assert_eq!(output.final_active_processes, None);
        assert_eq!(output.max_active_processes, None);
        assert!(output.stdout.is_empty() && output.stderr.is_empty());
        assert!(!output.success());
    }

    /// A request arriving during the pre-spawn checks still launches nothing.
    ///
    /// Entered past the executor's own entry check with the request already
    /// made, which is exactly the window the identity, source and output-safety
    /// checks occupy — and the first of those hashes the whole backend
    /// executable, so it is not a window that can be waved away as
    /// instantaneous.
    #[cfg(windows)]
    #[test]
    fn a_request_that_lands_during_the_pre_spawn_checks_launches_nothing() {
        let test_directory = TestDirectory::new();
        let marker = test_directory.path().join("child-launched");
        let executable = std::env::current_exe().expect("test executable");
        let spec = CommandSpec::new(
            BackendTool::MsConvert,
            &executable,
            [
                "--ignored",
                "--exact",
                "process::tests::controlled_output_marker",
                "--nocapture",
                "--test-threads=1",
            ],
            test_directory.path(),
        )
        .with_executable_identity(
            Sha256Digest::calculate_file(&executable).expect("hash the test executable"),
        );
        let command = process_command(&spec).expect("construct the controlled child command");
        let cancellation = CancellationToken::new();
        cancellation.cancel();

        let output = execute_command_after_assignment(command, &spec, &cancellation, || {})
            .expect("a refusal is not a failure");

        assert!(
            !marker.exists(),
            "a request made during the pre-spawn checks still launched the child"
        );
        assert_eq!(output.termination, Termination::NotStarted);
        assert_eq!(output.final_active_processes, None);
    }

    /// A substituted runner keeps the one guarantee it can keep without owning
    /// supervision, and claims nothing beyond it.
    #[test]
    fn the_default_runner_refuses_to_launch_after_a_request_and_delegates_otherwise() {
        struct CountingRunner(Cell<usize>);

        impl ProcessRunner for CountingRunner {
            fn run(&self, _spec: &CommandSpec) -> Result<ProcessOutput, ProcessError> {
                self.0.set(self.0.get() + 1);
                Ok(ProcessOutput {
                    exit_code: Some(0),
                    ..ProcessOutput::cancelled_before_launch()
                })
            }
        }

        let spec = CommandSpec::new(
            BackendTool::MsConvert,
            std::env::current_dir().expect("current directory"),
            std::iter::empty::<OsString>(),
            std::env::current_dir().expect("current directory"),
        );
        let runner = CountingRunner(Cell::new(0));
        let cancellation = CancellationToken::new();

        let delegated = runner
            .run_cancellable(&spec, &cancellation)
            .expect("an unrequested run delegates");
        assert_eq!(runner.0.get(), 1);
        assert_eq!(delegated.exit_code, Some(0));

        cancellation.cancel();
        let refused = runner
            .run_cancellable(&spec, &cancellation)
            .expect("a requested run is refused rather than failing");
        assert_eq!(runner.0.get(), 1, "the refused run reached the runner");
        assert_eq!(refused.termination, Termination::NotStarted);
        assert_eq!(refused.exit_code, None);
    }

    #[cfg(windows)]
    #[test]
    fn the_system_runner_cancels_the_owned_tree_through_its_cancellable_entry_point() {
        let test_directory = TestDirectory::new();
        let marker = test_directory.path().join("child-launched");
        let spec = CommandSpec::new(
            BackendTool::MsConvert,
            std::env::current_exe().expect("test executable"),
            [
                "--ignored",
                "--exact",
                "process::tests::controlled_output_marker",
                "--nocapture",
                "--test-threads=1",
            ],
            test_directory.path(),
        );
        let cancellation = CancellationToken::new();

        let ran = SystemProcessRunner
            .run_cancellable(&spec, &cancellation)
            .expect("an unrequested run executes");
        assert!(ran.success());
        assert!(marker.is_file());

        fs::remove_file(&marker).expect("clear the launch marker");
        cancellation.cancel();
        let refused = SystemProcessRunner
            .run_cancellable(&spec, &cancellation)
            .expect("a requested run is refused rather than failing");

        assert_eq!(refused.termination, Termination::NotStarted);
        assert!(
            !marker.exists(),
            "the system runner launched a child after a request"
        );
    }

    /// A backend that has written more than a pipe holds must not be able to
    /// wedge the supervisor. The capture threads start before the wait, so the
    /// child never blocks on a full pipe and cancellation still completes.
    #[cfg(windows)]
    #[test]
    fn cancellation_completes_while_a_child_is_filling_its_output_pipes() {
        let test_directory = TestDirectory::new();
        let release = test_directory.path().join("release");
        let flooded = test_directory.path().join("flooded");
        let spec = CommandSpec::new(
            BackendTool::MsConvert,
            std::env::current_exe().expect("test executable"),
            [
                "--ignored",
                "--exact",
                "process::tests::controlled_flooding_child",
                "--nocapture",
                "--test-threads=1",
            ],
            std::env::current_dir().expect("current directory"),
        );
        let mut command = process_command(&spec).expect("construct the flooding child command");
        command.env("MSCANVAS_PROCESS_TEST_DIRECTORY", test_directory.path());

        let cancellation = CancellationToken::new();
        let run_cancellation = cancellation.clone();
        let (assigned_sender, assigned_receiver) = mpsc::channel();
        let run = thread::spawn(move || {
            execute_command_after_assignment(command, &spec, &run_cancellation, || {
                let _ = assigned_sender.send(());
            })
        });

        let assigned = assigned_receiver.recv_timeout(Duration::from_secs(5));
        if assigned.is_ok() {
            fs::write(&release, b"release").expect("release the flooding child");
        }
        // The marker is written only after the child has pushed far more than a
        // pipe buffer through stdout and stderr, so reaching it proves the
        // capture threads were draining rather than that the child was small.
        let ready = assigned.is_ok() && wait_for_paths(&[&flooded], Duration::from_secs(10));
        cancellation.cancel();
        let output = run
            .join()
            .expect("executor thread")
            .expect("cancel the flooding child");

        assert!(assigned.is_ok(), "executor did not establish job ownership");
        assert!(ready, "the flooding child never filled its pipes");
        assert_eq!(output.termination, Termination::Cancelled);
        assert_eq!(output.final_active_processes, Some(0));
        // Asserted per stream. A combined total would pass on a run that
        // drained one pipe and abandoned the other, which is exactly the
        // regression this is here to catch.
        assert!(
            output.stdout_total_bytes >= FLOOD_BYTES as u64,
            "stdout: {}",
            output.stdout_total_bytes
        );
        assert!(
            output.stderr_total_bytes >= FLOOD_BYTES as u64,
            "stderr: {}",
            output.stderr_total_bytes
        );
    }

    /// A job that refuses to terminate is a wait failure, never a cancellation.
    #[test]
    fn a_job_that_cannot_be_terminated_fails_rather_than_reporting_cancellation() {
        struct UnterminableJob;

        impl ProcessJob for UnterminableJob {
            fn terminate(&self) -> io::Result<()> {
                Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "the owned job refused termination",
                ))
            }

            fn active_process_count(&self) -> io::Result<Option<u32>> {
                Ok(Some(1))
            }

            fn total_process_count(&self) -> io::Result<Option<u32>> {
                Ok(Some(1))
            }

            fn peak_memory_bytes(&self) -> io::Result<Option<u64>> {
                Ok(None)
            }
        }

        let cancellation = CancellationToken::new();
        cancellation.cancel();
        let mut max_active_processes = None;

        let error = wait_for_job_empty_with_timeout(
            &UnterminableJob,
            &cancellation,
            false,
            &mut max_active_processes,
            Duration::from_millis(50),
        )
        .expect_err("a job that refuses termination cannot report an empty tree");

        assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
        assert_eq!(max_active_processes, Some(1));
    }

    #[cfg(windows)]
    #[test]
    fn cancellation_after_root_exit_terminates_a_surviving_owned_descendant() {
        let (_test_directory, owned_job) = owned_job_with_surviving_descendant();

        let cancellation = CancellationToken::new();
        cancellation.cancel();
        let mut max_active_processes = None;
        let (final_active_processes, cancellation_observed) =
            wait_for_job_empty(&owned_job, &cancellation, false, &mut max_active_processes)
                .expect("cancel surviving owned descendant");

        assert!(cancellation_observed);
        assert!(max_active_processes.unwrap_or(0) >= 1);
        assert_eq!(final_active_processes, Some(0));
    }

    #[cfg(windows)]
    #[test]
    fn uncancelled_lingering_descendant_still_times_out() {
        const EMPTY_TIMEOUT: Duration = Duration::from_millis(100);

        let (_test_directory, owned_job) = owned_job_with_surviving_descendant();
        let cancellation = CancellationToken::new();
        let mut max_active_processes = None;

        let error = wait_for_job_empty_with_timeout(
            &owned_job,
            &cancellation,
            false,
            &mut max_active_processes,
            EMPTY_TIMEOUT,
        )
        .expect_err("an uncancelled surviving descendant should retain the original deadline");

        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        assert!(!cancellation.is_cancelled());
        assert!(max_active_processes.unwrap_or(0) >= 1);

        owned_job
            .terminate()
            .expect("terminate controlled descendant after timeout assertion");
    }

    #[cfg(windows)]
    #[test]
    fn late_cancellation_gets_a_fresh_empty_job_deadline() {
        const EMPTY_TIMEOUT: Duration = Duration::from_millis(250);

        let cancellation = CancellationToken::new();
        let owned_job = LateCancellationJob {
            cancellation: cancellation.clone(),
            first_observation_delay: EMPTY_TIMEOUT + POLL_INTERVAL,
            observations: AtomicUsize::new(0),
            terminations: AtomicUsize::new(0),
        };
        let mut max_active_processes = None;

        let (final_active_processes, cancellation_observed) = wait_for_job_empty_with_timeout(
            &owned_job,
            &cancellation,
            false,
            &mut max_active_processes,
            EMPTY_TIMEOUT,
        )
        .expect("late cancellation should get a bounded drain window");

        assert!(cancellation_observed);
        assert_eq!(owned_job.terminations.load(Ordering::Acquire), 1);
        assert_eq!(max_active_processes, Some(1));
        assert_eq!(final_active_processes, Some(0));
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "controlled subprocess entry point"]
    fn controlled_mock_parent() {
        let test_directory = controlled_test_directory();
        let release = test_directory.join("release");
        assert!(
            wait_for_paths(&[&release], Duration::from_secs(3)),
            "controlled parent was not released after job assignment"
        );

        let mut child = Command::new(std::env::current_exe().expect("test executable"))
            .args([
                "--ignored",
                "--exact",
                "process::tests::controlled_mock_grandchild",
                "--nocapture",
                "--test-threads=1",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn controlled grandchild");
        fs::write(test_directory.join("parent-ready"), b"ready").expect("write parent readiness");
        println!("mock child started pid={}", child.id());
        io::stdout().flush().expect("flush mock status");
        if std::env::var_os("MSCANVAS_PROCESS_TEST_PARENT_EXITS_AFTER_SPAWN").is_some() {
            drop(child);
            return;
        }
        thread::sleep(Duration::from_secs(8));
        child.wait().expect("wait for controlled grandchild");
    }

    /// Creates a descendant as its very first action.
    ///
    /// No readiness handshake and no release file: the point is to give a
    /// descendant the earliest start the operating system allows, so that a run
    /// which only owned its child *after* the child was running would have the
    /// interval this needs. Under suspended creation there is no such interval.
    #[cfg(windows)]
    #[test]
    #[ignore = "controlled subprocess entry point"]
    fn controlled_racing_parent() {
        let test_directory = controlled_test_directory();
        let mut child = Command::new(std::env::current_exe().expect("test executable"))
            .args([
                "--ignored",
                "--exact",
                "process::tests::controlled_mock_grandchild",
                "--nocapture",
                "--test-threads=1",
            ])
            .env("MSCANVAS_PROCESS_TEST_DIRECTORY", &test_directory)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn racing descendant");
        println!("racing descendant started pid={}", child.id());
        io::stdout().flush().expect("flush racing status");
        thread::sleep(Duration::from_secs(8));
        child.wait().expect("wait for racing descendant");
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "controlled subprocess entry point"]
    fn controlled_mock_grandchild() {
        let test_directory = controlled_test_directory();
        fs::write(test_directory.join("grandchild-ready"), b"ready")
            .expect("write grandchild readiness");
        thread::sleep(Duration::from_secs(8));
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "controlled subprocess entry point"]
    fn controlled_environment_parent() {
        let working_directory = std::env::current_dir().expect("controlled working directory");
        let executable = std::env::current_exe().expect("test executable");
        let spec = CommandSpec::new(
            BackendTool::MsConvert,
            executable,
            [
                "--ignored",
                "--exact",
                "process::tests::controlled_environment_child",
                "--nocapture",
                "--test-threads=1",
            ],
            &working_directory,
        );
        let output = execute(&spec).expect("execute controlled environment child");
        assert!(
            output.success(),
            "controlled environment child failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(
            working_directory
                .join("minimal-environment-verified")
                .is_file(),
            "controlled environment child did not write its marker"
        );
    }

    /// Comfortably more than a Windows anonymous pipe buffer, per stream.
    #[cfg(windows)]
    const FLOOD_BYTES: usize = 512 * 1024;

    #[cfg(windows)]
    #[test]
    #[ignore = "controlled subprocess entry point"]
    fn controlled_flooding_child() {
        let test_directory = controlled_test_directory();
        let release = test_directory.join("release");
        assert!(
            wait_for_paths(&[&release], Duration::from_secs(5)),
            "controlled flooding child was not released after job assignment"
        );

        // Both streams, and the same volume through each. A token byte on
        // stderr would leave that pipe far short of its buffer, so a capture
        // thread that stopped draining it would never block the child and this
        // would quietly stop being a test about pipes at all.
        let payload = vec![b'o'; 8192];
        let mut written = 0;
        while written < FLOOD_BYTES {
            io::stdout().write_all(&payload).expect("flood stdout");
            io::stderr().write_all(&payload).expect("flood stderr");
            written += payload.len();
        }
        io::stdout().flush().expect("flush flooded stdout");
        io::stderr().flush().expect("flush flooded stderr");
        fs::write(test_directory.join("flooded"), b"flooded").expect("write flood marker");
        thread::sleep(Duration::from_secs(8));
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "controlled subprocess entry point"]
    fn controlled_output_marker() {
        fs::write(
            std::env::current_dir()
                .expect("controlled working directory")
                .join("child-launched"),
            b"launched",
        )
        .expect("write launch marker");
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "controlled subprocess entry point"]
    fn controlled_environment_child() {
        let working_directory = std::env::current_dir().expect("controlled working directory");
        let allowed = ["PATH", "SYSTEMROOT", "TEMP", "TMP", "WINDIR"];
        for (name, _) in std::env::vars_os() {
            let normalized = name.to_string_lossy().to_ascii_uppercase();
            assert!(
                allowed.contains(&normalized.as_str()),
                "unexpected inherited backend environment variable: {normalized}"
            );
            assert!(!normalized.starts_with("GITHUB_"));
            assert!(!normalized.starts_with("ACTIONS_"));
            assert!(!normalized.contains("TOKEN"));
            assert!(!normalized.contains("CREDENTIAL"));
            assert_ne!(normalized, "USERPROFILE");
        }

        assert_eq!(
            std::env::var_os("TEMP").map(PathBuf::from).as_deref(),
            Some(working_directory.as_path())
        );
        assert_eq!(
            std::env::var_os("TMP").map(PathBuf::from).as_deref(),
            Some(working_directory.as_path())
        );
        assert!(std::env::var_os("SystemRoot").is_some());
        assert!(std::env::var_os("WINDIR").is_some());
        let windows_root = PathBuf::from(std::env::var_os("SystemRoot").expect("SystemRoot"));
        let executable_directory = std::env::current_exe()
            .expect("test executable")
            .parent()
            .expect("test executable parent")
            .to_path_buf();
        let actual_path =
            std::env::split_paths(&std::env::var_os("PATH").expect("backend child receives PATH"))
                .collect::<Vec<_>>();
        assert_eq!(
            actual_path,
            [
                executable_directory,
                windows_root.join("System32"),
                windows_root,
            ]
        );
        fs::write(
            working_directory.join("minimal-environment-verified"),
            b"verified",
        )
        .expect("write minimal environment marker");
    }

    #[cfg(windows)]
    fn controlled_test_directory() -> PathBuf {
        std::env::var_os("MSCANVAS_PROCESS_TEST_DIRECTORY")
            .map(PathBuf::from)
            .expect("controlled test directory environment")
    }

    #[cfg(windows)]
    fn wait_for_paths(paths: &[&Path], timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        loop {
            if paths.iter().all(|path| path.exists()) {
                return true;
            }
            if Instant::now() >= deadline {
                return false;
            }
            thread::sleep(POLL_INTERVAL);
        }
    }

    #[cfg(windows)]
    fn owned_job_with_surviving_descendant() -> (TestDirectory, OwnedProcessJob) {
        let test_directory = TestDirectory::new();
        let release = test_directory.path().join("release");
        let parent_ready = test_directory.path().join("parent-ready");
        let grandchild_ready = test_directory.path().join("grandchild-ready");
        let executable = std::env::current_exe().expect("test executable");
        let spec = CommandSpec::new(
            BackendTool::MsConvert,
            &executable,
            [
                "--ignored",
                "--exact",
                "process::tests::controlled_mock_parent",
                "--nocapture",
                "--test-threads=1",
            ],
            std::env::current_dir().expect("current directory"),
        );
        let mut command = process_command(&spec).expect("construct controlled parent command");
        command
            .env("MSCANVAS_PROCESS_TEST_DIRECTORY", test_directory.path())
            .env("MSCANVAS_PROCESS_TEST_PARENT_EXITS_AFTER_SPAWN", "1")
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let mut child = command.spawn().expect("spawn controlled parent");
        let owned_job = OwnedProcessJob::assign(&child).expect("assign controlled parent to job");
        fs::write(&release, b"release").expect("release controlled parent");
        assert!(
            wait_for_paths(&[&parent_ready, &grandchild_ready], Duration::from_secs(3)),
            "controlled process tree did not become ready"
        );
        child.wait().expect("wait for controlled parent exit");

        (test_directory, owned_job)
    }

    #[cfg(windows)]
    struct LateCancellationJob {
        cancellation: CancellationToken,
        first_observation_delay: Duration,
        observations: AtomicUsize,
        terminations: AtomicUsize,
    }

    #[cfg(windows)]
    impl ProcessJob for LateCancellationJob {
        fn terminate(&self) -> io::Result<()> {
            self.terminations.fetch_add(1, Ordering::AcqRel);
            Ok(())
        }

        fn active_process_count(&self) -> io::Result<Option<u32>> {
            let observation = self.observations.fetch_add(1, Ordering::AcqRel);
            match observation {
                0 => {
                    thread::sleep(self.first_observation_delay);
                    self.cancellation.cancel();
                    Ok(Some(1))
                }
                1 => Ok(Some(1)),
                _ => Ok(Some(0)),
            }
        }

        fn total_process_count(&self) -> io::Result<Option<u32>> {
            Ok(Some(1))
        }

        fn peak_memory_bytes(&self) -> io::Result<Option<u64>> {
            Ok(None)
        }
    }

    #[cfg(windows)]
    struct TestDirectory(PathBuf);

    #[cfg(windows)]
    impl TestDirectory {
        fn new() -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock after Unix epoch")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "mscanvas-process-tree-{}-{nonce}",
                std::process::id()
            ));
            fs::create_dir(&path).expect("create controlled test directory");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    #[cfg(windows)]
    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
}
