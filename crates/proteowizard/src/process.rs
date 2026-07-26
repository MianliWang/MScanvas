use std::ffi::OsString;
use std::io::{self, Read};
use std::path::Path;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use thiserror::Error;

use crate::CommandSpec;
use crate::command::OutputSafety;

const POLL_INTERVAL: Duration = Duration::from_millis(20);
const JOB_EMPTY_TIMEOUT: Duration = Duration::from_secs(5);
const CAPTURE_LIMIT_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Termination {
    Exited,
    Cancelled,
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
}

impl ProcessOutput {
    #[must_use]
    pub fn success(&self) -> bool {
        self.termination == Termination::Exited && self.exit_code == Some(0)
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
}

#[derive(Debug, Clone, Copy, Default)]
pub struct SystemProcessRunner;

impl ProcessRunner for SystemProcessRunner {
    fn run(&self, spec: &CommandSpec) -> Result<ProcessOutput, ProcessError> {
        execute(spec)
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
        let empty_count = cfg!(windows).then_some(0);
        return Ok(ProcessOutput {
            stdout: Vec::new(),
            stderr: Vec::new(),
            stdout_total_bytes: 0,
            stderr_total_bytes: 0,
            stdout_truncated: false,
            stderr_truncated: false,
            exit_code: None,
            elapsed: Duration::ZERO,
            termination: Termination::Cancelled,
            max_active_processes: empty_count,
            final_active_processes: empty_count,
        });
    }

    execute_command_after_assignment(process_command(spec)?, spec, cancellation, || {})
}

fn execute_command_after_assignment(
    mut command: Command,
    spec: &CommandSpec,
    cancellation: &CancellationToken,
    after_assignment: impl FnOnce(),
) -> Result<ProcessOutput, ProcessError> {
    require_output_safety(spec)?;
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
    })
}

fn require_output_safety(spec: &CommandSpec) -> Result<(), ProcessError> {
    // These checks close stale plans in the conservative sequential queue
    // immediately before spawn. They are deliberately not described as atomic
    // reservations: another process can still write after either snapshot.
    match &spec.output_safety {
        OutputSafety::None => Ok(()),
        OutputSafety::FreshDirectory(output_directory) => {
            require_fresh_output_directory(output_directory)
        }
        OutputSafety::AbsentDestination(destination) => {
            require_output_destination_available(destination)
        }
    }
}

fn require_fresh_output_directory(output_directory: &Path) -> Result<(), ProcessError> {
    let mut entries = std::fs::read_dir(output_directory)
        .map_err(|error| ProcessError::OutputDirectoryInspectionFailed { kind: error.kind() })?;
    match entries.next() {
        Some(Ok(_)) => Err(ProcessError::OutputDirectoryNotEmpty),
        Some(Err(error)) => {
            Err(ProcessError::OutputDirectoryInspectionFailed { kind: error.kind() })
        }
        None => Ok(()),
    }
}

fn require_output_destination_available(destination: &Path) -> Result<(), ProcessError> {
    let parent = destination
        .parent()
        .ok_or(ProcessError::OutputDestinationInspectionFailed {
            kind: io::ErrorKind::InvalidInput,
        })?;
    let _entries = std::fs::read_dir(parent)
        .map_err(|error| ProcessError::OutputDestinationInspectionFailed { kind: error.kind() })?;
    match std::fs::symlink_metadata(destination) {
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
}

impl ProcessJob for OwnedProcessJob {
    fn terminate(&self) -> io::Result<()> {
        Self::terminate(self)
    }

    fn active_process_count(&self) -> io::Result<Option<u32>> {
        Self::active_process_count(self)
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
    fn unrelated_output_entry_does_not_block_an_absent_conversion_destination() {
        let test_directory = TestDirectory::new();
        let marker = test_directory.path().join("child-launched");
        let destination = test_directory.path().join("planned.mzML");
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
        .with_output_destination(&destination);

        let output = execute(&spec).expect("an absent exact destination permits launch");

        assert!(output.success());
        assert!(marker.is_file(), "the controlled child did not launch");
        assert!(!destination.exists());
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
        .with_output_destination(&destination);
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
        .with_output_destination(&destination);
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
        .with_output_destination(&destination);

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
        .with_fresh_output_directory(test_directory.path());

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
        .with_fresh_output_directory(test_directory.path());
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
        .with_fresh_output_directory(&preview_output);
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
