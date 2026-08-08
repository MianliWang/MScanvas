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
    /// Peak committed memory charged to the owned Windows Job Object across the
    /// whole supervised process tree. `None` means the platform exposed no
    /// equivalent bounded accounting or the query itself failed; this is an
    /// advisory observation, never a supervision result.
    pub peak_job_memory_bytes: Option<u64>,
}

impl ProcessOutput {
    #[must_use]
    pub fn success(&self) -> bool {
        self.termination == Termination::Exited && self.exit_code == Some(0)
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
            peak_job_memory_bytes: None,
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
    AssignToOwnedJob { detail: String },
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
    // and spawning — the same one the documented spawn-to-assignment race lives
    // in — which is instructions rather than a file hash.
    if cancellation.is_cancelled() {
        return Ok(ProcessOutput::cancelled_before_launch());
    }
    let started = Instant::now();
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| launch_error(spec, &error))?;

    // Assign before starting capture threads to keep the documented, unavoidable
    // spawn-to-assignment window as narrow as stable std::process permits.
    let owned_job = match OwnedProcessJob::assign(&child) {
        Ok(job) => job,
        Err(error) => {
            let stdout_reader =
                capture_stream(child.stdout.take().expect("stdout was configured as piped"));
            let stderr_reader =
                capture_stream(child.stderr.take().expect("stderr was configured as piped"));
            let cleanup = force_unowned_cleanup(&mut child);
            let captures = join_captures(stdout_reader, stderr_reader);
            let detail = add_cleanup_context(error.to_string(), cleanup, captures.err());
            return Err(ProcessError::AssignToOwnedJob { detail });
        }
    };

    let stdout_reader =
        capture_stream(child.stdout.take().expect("stdout was configured as piped"));
    let stderr_reader =
        capture_stream(child.stderr.take().expect("stderr was configured as piped"));
    after_assignment();

    let mut owned_job = Some(owned_job);
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
                Err(error) => Err(ProcessError::Wait {
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
        peak_job_memory_bytes,
    })
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
    let matches = source_identity
        .matches_current()
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
    fn peak_memory_bytes(&self) -> io::Result<Option<u64>>;
}

impl ProcessJob for OwnedProcessJob {
    fn terminate(&self) -> io::Result<()> {
        Self::terminate(self)
    }

    fn active_process_count(&self) -> io::Result<Option<u32>> {
        Self::active_process_count(self)
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
    }

    #[derive(Debug)]
    pub(super) struct OwnedProcessJob {
        handle: OwnedHandle,
    }

    impl OwnedProcessJob {
        pub(super) fn assign(child: &Child) -> io::Result<Self> {
            // Stable std does not expose suspended CreateProcess/job-list attributes.
            // The M0 spike therefore assigns immediately after spawn and records this
            // narrow spawn-to-assignment race as a production follow-up.
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
            Ok(Some(information.active_processes))
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
        assert!(output.stdout_total_bytes > FLOOD_BYTES as u64);
        assert!(output.stderr_total_bytes > 0);
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

        let payload = vec![b'o'; 8192];
        let mut written = 0;
        while written < FLOOD_BYTES {
            io::stdout().write_all(&payload).expect("flood stdout");
            io::stderr().write_all(b"e").expect("flood stderr");
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
