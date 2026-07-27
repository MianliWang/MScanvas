//! Deterministic discovery and `--help` probing for user-installed ProteoWizard tools.

use std::borrow::Borrow;
use std::cmp;
use std::env;
use std::ffi::{OsStr, OsString};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;

use crate::command::{BackendTool, CommandSpec};
use crate::process::{
    CancellationToken, LaunchFailureKind, ProcessError, ProcessOutput, Termination,
    execute_cancellable,
};
use crate::{InstalledHelpCapabilities, PreviewOperation, Sha256Digest};

const MSCONVERT_EXE: &str = "msconvert.exe";
const MSACCESS_EXE: &str = "msaccess.exe";
const HELP_ARGUMENT: &str = "--help";
const PROBE_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AvailabilityState {
    Available,
    Partial,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConfiguredLocation {
    Home(PathBuf),
    Executable(PathBuf),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiscoverySource {
    ConfiguredHome,
    ConfiguredExecutable,
    Path,
    CommonInstallRoot,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolProbe {
    /// Captured prefixes can contain sensitive backend paths and are not reportable without redaction.
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub stdout_total_bytes: u64,
    pub stderr_total_bytes: u64,
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
    pub exit_code: Option<i32>,
    pub elapsed: Duration,
    pub reported_release: Option<String>,
    pub release: Option<String>,
    pub source_revision: Option<String>,
    pub build_date: Option<String>,
    /// True when the probe emitted more than one distinct release or build-date value.
    pub identity_conflict: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BoundHelpProbe {
    pub(crate) tool: BackendTool,
    pub(crate) executable: PathBuf,
    pub(crate) executable_sha256: Sha256Digest,
    pub(crate) stdout: Vec<u8>,
    pub(crate) stderr: Vec<u8>,
    pub(crate) stdout_total_bytes: u64,
    pub(crate) stderr_total_bytes: u64,
    pub(crate) stdout_truncated: bool,
    pub(crate) stderr_truncated: bool,
}

impl BoundHelpProbe {
    fn capture(
        tool: BackendTool,
        executable: &Path,
        executable_sha256: Sha256Digest,
        probe: &ToolProbe,
    ) -> Self {
        Self {
            tool,
            executable: executable.to_path_buf(),
            executable_sha256,
            stdout: probe.stdout.clone(),
            stderr: probe.stderr.clone(),
            stdout_total_bytes: probe.stdout_total_bytes,
            stderr_total_bytes: probe.stderr_total_bytes,
            stdout_truncated: probe.stdout_truncated,
            stderr_truncated: probe.stderr_truncated,
        }
    }
}

impl ToolProbe {
    pub fn new(
        stdout: impl AsRef<[u8]>,
        stderr: impl AsRef<[u8]>,
        exit_code: Option<i32>,
        elapsed: Duration,
    ) -> Self {
        let mut probe = Self {
            stdout: stdout.as_ref().to_vec(),
            stderr: stderr.as_ref().to_vec(),
            stdout_total_bytes: stdout.as_ref().len() as u64,
            stderr_total_bytes: stderr.as_ref().len() as u64,
            stdout_truncated: false,
            stderr_truncated: false,
            exit_code,
            elapsed,
            reported_release: None,
            release: None,
            source_revision: None,
            build_date: None,
            identity_conflict: false,
        };
        probe.parse_build_metadata();
        probe
    }

    fn from_process(output: ProcessOutput) -> Self {
        let mut probe = Self {
            stdout: output.stdout,
            stderr: output.stderr,
            stdout_total_bytes: output.stdout_total_bytes,
            stderr_total_bytes: output.stderr_total_bytes,
            stdout_truncated: output.stdout_truncated,
            stderr_truncated: output.stderr_truncated,
            exit_code: output.exit_code,
            elapsed: output.elapsed,
            reported_release: None,
            release: None,
            source_revision: None,
            build_date: None,
            identity_conflict: false,
        };
        probe.parse_build_metadata();
        probe
    }

    pub fn succeeded(&self) -> bool {
        self.exit_code == Some(0)
    }

    #[must_use]
    pub fn help_contains(&self, fragment: &str) -> bool {
        let stdout = String::from_utf8_lossy(&self.stdout);
        let stderr = String::from_utf8_lossy(&self.stderr);
        stdout.contains(fragment) || stderr.contains(fragment)
    }

    fn parse_build_metadata(&mut self) {
        let (reported_release, release_conflict) = unique_label_value(
            [&self.stdout[..], &self.stderr[..]],
            "ProteoWizard release:",
        );
        let (build_date, build_date_conflict) =
            unique_label_value([&self.stdout[..], &self.stderr[..]], "Build date:");
        self.identity_conflict = release_conflict || build_date_conflict;
        if self.identity_conflict {
            self.reported_release = None;
            self.release = None;
            self.source_revision = None;
            self.build_date = None;
            return;
        }

        self.reported_release = reported_release;
        let (release, source_revision) = self
            .reported_release
            .as_deref()
            .map(split_release_revision)
            .unwrap_or((None, None));
        self.release = release;
        self.source_revision = source_revision;
        self.build_date = build_date;
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DiscoveryFailure {
    InvalidConfiguredLocation {
        path: PathBuf,
        reason: String,
    },
    BackendNotFound,
    MissingTool {
        executable: String,
        expected_path: PathBuf,
    },
    ToolsFromDifferentInstallations {
        msconvert_path: PathBuf,
        msaccess_path: PathBuf,
    },
    ProbeLaunchFailed {
        executable: String,
        path: PathBuf,
        detail: String,
    },
    ProbeExecutableInspectionFailed {
        executable: String,
        path: PathBuf,
        detail: String,
    },
    ProbeExecutableChanged {
        executable: String,
        path: PathBuf,
    },
    ProbeTimedOut {
        executable: String,
        path: PathBuf,
        timeout: Duration,
    },
    ProbeNonZero {
        executable: String,
        path: PathBuf,
        exit_code: Option<i32>,
        detail: String,
    },
    ProbeMetadataMissing {
        executable: String,
        path: PathBuf,
    },
    ProbeMetadataConflict {
        executable: String,
        path: PathBuf,
    },
    ProbeIdentityMismatch {
        msconvert_release: String,
        msconvert_build_date: String,
        msaccess_release: String,
        msaccess_build_date: String,
    },
}

impl DiscoveryFailure {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::InvalidConfiguredLocation { .. } => "invalid_configured_location",
            Self::BackendNotFound => "backend_not_found",
            Self::MissingTool { executable, .. }
                if executable.eq_ignore_ascii_case(MSCONVERT_EXE) =>
            {
                "msconvert_missing"
            }
            Self::MissingTool { executable, .. }
                if executable.eq_ignore_ascii_case(MSACCESS_EXE) =>
            {
                "msaccess_missing"
            }
            Self::MissingTool { .. } => "tool_missing",
            Self::ToolsFromDifferentInstallations { .. } => "different_installations",
            Self::ProbeLaunchFailed { .. }
            | Self::ProbeExecutableInspectionFailed { .. }
            | Self::ProbeExecutableChanged { .. }
            | Self::ProbeTimedOut { .. }
            | Self::ProbeNonZero { .. }
            | Self::ProbeMetadataMissing { .. }
            | Self::ProbeMetadataConflict { .. }
            | Self::ProbeIdentityMismatch { .. } => "version_probe_failed",
        }
    }

    pub fn summary(&self) -> &'static str {
        match self {
            Self::InvalidConfiguredLocation { .. } => {
                "The configured ProteoWizard location is not usable."
            }
            Self::BackendNotFound => "ProteoWizard was not found.",
            Self::MissingTool { .. } => "The ProteoWizard installation is incomplete.",
            Self::ToolsFromDifferentInstallations { .. } => {
                "The ProteoWizard tools resolve to different installations."
            }
            Self::ProbeLaunchFailed { .. } => "A ProteoWizard tool could not be started.",
            Self::ProbeExecutableInspectionFailed { .. } => {
                "A ProteoWizard executable could not be verified."
            }
            Self::ProbeExecutableChanged { .. } => {
                "A ProteoWizard executable changed during its self-test."
            }
            Self::ProbeTimedOut { .. } => "A ProteoWizard self-test timed out.",
            Self::ProbeNonZero { .. } => "A ProteoWizard self-test returned an error.",
            Self::ProbeMetadataMissing { .. } => "The ProteoWizard build could not be identified.",
            Self::ProbeMetadataConflict { .. } => {
                "A ProteoWizard tool reported conflicting build identities."
            }
            Self::ProbeIdentityMismatch { .. } => {
                "The ProteoWizard tools report different build identities."
            }
        }
    }

    pub fn corrective_action(&self) -> &'static str {
        match self {
            Self::InvalidConfiguredLocation { .. } => {
                "Choose the ProteoWizard installation folder or an exact msconvert.exe/msaccess.exe path."
            }
            Self::BackendNotFound => {
                "Install ProteoWizard separately or choose its installation folder in MSCanvas."
            }
            Self::MissingTool { .. } => {
                "Repair the ProteoWizard installation so msconvert.exe and msaccess.exe are together."
            }
            Self::ToolsFromDifferentInstallations { .. } | Self::ProbeIdentityMismatch { .. } => {
                "Choose one installation folder containing matching msconvert.exe and msaccess.exe tools."
            }
            Self::ProbeLaunchFailed { .. }
            | Self::ProbeExecutableInspectionFailed { .. }
            | Self::ProbeExecutableChanged { .. } => {
                "Check file permissions and repair or reinstall the selected ProteoWizard installation."
            }
            Self::ProbeTimedOut { .. }
            | Self::ProbeNonZero { .. }
            | Self::ProbeMetadataMissing { .. }
            | Self::ProbeMetadataConflict { .. } => {
                "Run the ProteoWizard installer repair, then repeat the backend self-test."
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveredTool {
    pub path: Option<PathBuf>,
    pub exists: bool,
    pub probe: Option<ToolProbe>,
    pub failure: Option<DiscoveryFailure>,
    bound_help_probe: Option<BoundHelpProbe>,
}

impl DiscoveredTool {
    fn at(path: PathBuf) -> Self {
        let (path, exists) = match fs::canonicalize(&path) {
            Ok(canonical_path) => {
                let exists = canonical_path.is_file();
                (canonical_path, exists)
            }
            Err(_) => (path, false),
        };
        Self {
            path: Some(path),
            exists,
            probe: None,
            failure: None,
            bound_help_probe: None,
        }
    }

    fn undiscovered() -> Self {
        Self {
            path: None,
            exists: false,
            probe: None,
            failure: None,
            bound_help_probe: None,
        }
    }

    pub(crate) fn validated_help_probe(&self) -> Option<&BoundHelpProbe> {
        (self.exists && self.failure.is_none())
            .then_some(self.bound_help_probe.as_ref())
            .flatten()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct DiscoveryRequest {
    pub configured: Option<ConfiguredLocation>,
}

impl DiscoveryRequest {
    pub fn automatic() -> Self {
        Self::default()
    }

    pub fn with_home(path: impl Into<PathBuf>) -> Self {
        Self {
            configured: Some(ConfiguredLocation::Home(path.into())),
        }
    }

    pub fn with_executable(path: impl Into<PathBuf>) -> Self {
        Self {
            configured: Some(ConfiguredLocation::Executable(path.into())),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct DiscoveryEnvironment {
    pub path_entries: Vec<PathBuf>,
    pub common_install_roots: Vec<PathBuf>,
}

impl DiscoveryEnvironment {
    pub fn new(path_entries: Vec<PathBuf>, common_install_roots: Vec<PathBuf>) -> Self {
        Self {
            path_entries,
            common_install_roots,
        }
    }

    pub fn from_process() -> Self {
        let path_entries = env::var_os("PATH")
            .map(|value| env::split_paths(&value).collect())
            .unwrap_or_default();

        Self {
            path_entries,
            common_install_roots: common_install_roots(
                env::var_os("ProgramFiles"),
                env::var_os("ProgramFiles(x86)"),
                env::var_os("LOCALAPPDATA"),
            ),
        }
    }
}

pub(crate) trait ProbeExecutor {
    fn execute(&self, executable: &Path, args: &[OsString]) -> io::Result<ToolProbe>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveryResult {
    pub availability: AvailabilityState,
    pub source: Option<DiscoverySource>,
    pub msconvert: DiscoveredTool,
    pub msaccess: DiscoveredTool,
    pub same_installation: bool,
    pub release: Option<String>,
    pub build_date: Option<String>,
    pub failure: Option<DiscoveryFailure>,
}

impl DiscoveryResult {
    fn unavailable(source: Option<DiscoverySource>, failure: DiscoveryFailure) -> Self {
        Self {
            availability: AvailabilityState::Unavailable,
            source,
            msconvert: DiscoveredTool::undiscovered(),
            msaccess: DiscoveredTool::undiscovered(),
            same_installation: false,
            release: None,
            build_date: None,
            failure: Some(failure),
        }
    }
}

#[derive(Debug, Default)]
struct SystemProbeExecutor;

impl ProbeExecutor for SystemProbeExecutor {
    fn execute(&self, executable: &Path, args: &[OsString]) -> io::Result<ToolProbe> {
        let tool = backend_tool(executable)?;
        let installation_directory = executable.parent().ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "the ProteoWizard executable has no installation directory",
            )
        })?;
        let spec = CommandSpec::new(
            tool,
            executable,
            args.iter().cloned(),
            installation_directory,
        );
        let cancellation = CancellationToken::new();
        let timed_cancellation = cancellation.clone();
        let (stop_sender, stop_receiver) = mpsc::channel();
        let timer = thread::spawn(move || {
            if stop_receiver.recv_timeout(PROBE_TIMEOUT).is_err() {
                timed_cancellation.cancel();
            }
        });
        let result = execute_cancellable(&spec, &cancellation);
        let _ = stop_sender.send(());
        timer
            .join()
            .map_err(|_| io::Error::other("the ProteoWizard probe timer thread panicked"))?;
        let output = result.map_err(process_error_as_io)?;
        if output.termination == Termination::Cancelled {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                format!("the ProteoWizard help probe exceeded {PROBE_TIMEOUT:?}"),
            ));
        }
        Ok(ToolProbe::from_process(output))
    }
}

fn backend_tool(executable: &Path) -> io::Result<BackendTool> {
    let file_name = executable.file_name().and_then(OsStr::to_str);
    match file_name {
        Some(name) if name.eq_ignore_ascii_case(MSCONVERT_EXE) => Ok(BackendTool::MsConvert),
        Some(name) if name.eq_ignore_ascii_case(MSACCESS_EXE) => Ok(BackendTool::MsAccess),
        _ => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "the probe executable is not msconvert.exe or msaccess.exe",
        )),
    }
}

fn process_error_as_io(error: ProcessError) -> io::Error {
    let kind = match &error {
        ProcessError::Launch {
            kind: LaunchFailureKind::NotFound,
            ..
        } => io::ErrorKind::NotFound,
        ProcessError::Launch {
            kind: LaunchFailureKind::PermissionDenied,
            ..
        } => io::ErrorKind::PermissionDenied,
        _ => io::ErrorKind::Other,
    };
    io::Error::new(kind, error)
}

pub fn discover(request: impl Borrow<DiscoveryRequest>) -> DiscoveryResult {
    discover_with(
        request,
        &DiscoveryEnvironment::from_process(),
        &SystemProbeExecutor,
    )
}

pub(crate) fn discover_with(
    request: impl Borrow<DiscoveryRequest>,
    environment: &DiscoveryEnvironment,
    executor: &dyn ProbeExecutor,
) -> DiscoveryResult {
    let request = request.borrow();

    let candidate = if let Some(configured) = &request.configured {
        match configured_candidate(configured) {
            Ok(candidate) => candidate,
            Err((source, path, reason)) => {
                return DiscoveryResult::unavailable(
                    Some(source),
                    DiscoveryFailure::InvalidConfiguredLocation { path, reason },
                );
            }
        }
    } else if let Some(candidate) = automatic_candidate(environment) {
        candidate
    } else {
        return DiscoveryResult::unavailable(None, DiscoveryFailure::BackendNotFound);
    };

    evaluate_candidate(candidate, executor)
}

#[derive(Debug)]
struct Candidate {
    source: DiscoverySource,
    msconvert_path: PathBuf,
    msaccess_path: PathBuf,
}

fn configured_candidate(
    configured: &ConfiguredLocation,
) -> Result<Candidate, (DiscoverySource, PathBuf, String)> {
    match configured {
        ConfiguredLocation::Home(home) => {
            if !home.is_dir() {
                return Err((
                    DiscoverySource::ConfiguredHome,
                    home.clone(),
                    "the configured installation folder does not exist".to_owned(),
                ));
            }
            let canonical_home = home.canonicalize().map_err(|_| {
                (
                    DiscoverySource::ConfiguredHome,
                    home.clone(),
                    "the configured installation folder could not be resolved".to_owned(),
                )
            })?;
            let candidate =
                candidate_from_directory(&canonical_home, DiscoverySource::ConfiguredHome);
            if !candidate.msconvert_path.is_file() && !candidate.msaccess_path.is_file() {
                return Err((
                    DiscoverySource::ConfiguredHome,
                    home.clone(),
                    "the folder contains neither msconvert.exe nor msaccess.exe".to_owned(),
                ));
            }
            Ok(candidate)
        }
        ConfiguredLocation::Executable(executable) => {
            if !executable.is_file() {
                return Err((
                    DiscoverySource::ConfiguredExecutable,
                    executable.clone(),
                    "the configured executable does not exist".to_owned(),
                ));
            }
            let Some(file_name) = executable.file_name().and_then(OsStr::to_str) else {
                return Err((
                    DiscoverySource::ConfiguredExecutable,
                    executable.clone(),
                    "the configured executable name is not valid Unicode".to_owned(),
                ));
            };
            if !file_name.eq_ignore_ascii_case(MSCONVERT_EXE)
                && !file_name.eq_ignore_ascii_case(MSACCESS_EXE)
            {
                return Err((
                    DiscoverySource::ConfiguredExecutable,
                    executable.clone(),
                    "the path must name msconvert.exe or msaccess.exe exactly".to_owned(),
                ));
            }
            let canonical_executable = executable.canonicalize().map_err(|_| {
                (
                    DiscoverySource::ConfiguredExecutable,
                    executable.clone(),
                    "the configured executable could not be resolved".to_owned(),
                )
            })?;
            let Some(home) = canonical_executable.parent() else {
                return Err((
                    DiscoverySource::ConfiguredExecutable,
                    executable.clone(),
                    "the resolved executable has no installation folder".to_owned(),
                ));
            };
            Ok(candidate_from_directory(
                home,
                DiscoverySource::ConfiguredExecutable,
            ))
        }
    }
}

fn automatic_candidate(environment: &DiscoveryEnvironment) -> Option<Candidate> {
    let (path_complete, path_partial) = path_candidates(&environment.path_entries);
    if path_complete.is_some() {
        return path_complete;
    }

    let (common_complete, common_partial) =
        common_root_candidates(&environment.common_install_roots);
    common_complete.or(path_partial).or(common_partial)
}

fn path_candidates(path_entries: &[PathBuf]) -> (Option<Candidate>, Option<Candidate>) {
    let mut first_partial = None;
    for directory in path_entries {
        let directory = directory
            .canonicalize()
            .unwrap_or_else(|_| directory.clone());
        let candidate = candidate_from_directory(&directory, DiscoverySource::Path);
        let has_msconvert = candidate.msconvert_path.is_file();
        let has_msaccess = candidate.msaccess_path.is_file();
        if has_msconvert && has_msaccess {
            return (Some(candidate), first_partial);
        }
        if first_partial.is_none() && (has_msconvert || has_msaccess) {
            first_partial = Some(candidate);
        }
    }
    (None, first_partial)
}

fn common_root_candidates(common_roots: &[PathBuf]) -> (Option<Candidate>, Option<Candidate>) {
    let mut first_partial = None;
    for root in common_roots {
        for directory in root_and_direct_children(root) {
            let directory = directory.canonicalize().unwrap_or(directory);
            let candidate =
                candidate_from_directory(&directory, DiscoverySource::CommonInstallRoot);
            let has_msconvert = candidate.msconvert_path.is_file();
            let has_msaccess = candidate.msaccess_path.is_file();
            if has_msconvert && has_msaccess {
                return (Some(candidate), first_partial);
            }
            if first_partial.is_none() && (has_msconvert || has_msaccess) {
                first_partial = Some(candidate);
            }
        }
    }
    (None, first_partial)
}

fn root_and_direct_children(root: &Path) -> Vec<PathBuf> {
    if !root.is_dir() {
        return Vec::new();
    }

    let mut directories = vec![root.to_path_buf()];
    let is_reviewed_container = root
        .file_name()
        .and_then(OsStr::to_str)
        .is_some_and(|name| name.eq_ignore_ascii_case("ProteoWizard"));
    if !is_reviewed_container {
        return directories;
    }
    let mut children = fs::read_dir(root)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|entry| {
            entry
                .file_type()
                .ok()
                .filter(|file_type| file_type.is_dir())
                .map(|_| entry.path())
        })
        .collect::<Vec<_>>();
    children.sort_by(|left, right| right.as_os_str().cmp(left.as_os_str()));
    directories.extend(children);
    directories
}

fn candidate_from_directory(directory: &Path, source: DiscoverySource) -> Candidate {
    Candidate {
        source,
        msconvert_path: directory.join(MSCONVERT_EXE),
        msaccess_path: directory.join(MSACCESS_EXE),
    }
}

fn evaluate_candidate(candidate: Candidate, executor: &dyn ProbeExecutor) -> DiscoveryResult {
    let mut msconvert = DiscoveredTool::at(candidate.msconvert_path);
    let mut msaccess = DiscoveredTool::at(candidate.msaccess_path);
    let same_installation =
        msconvert.exists && msaccess.exists && same_parent(&msconvert.path, &msaccess.path);

    if !msconvert.exists {
        msconvert.failure = Some(missing_tool_failure(MSCONVERT_EXE, &msconvert));
    } else {
        probe_tool(BackendTool::MsConvert, &mut msconvert, executor);
    }
    if !msaccess.exists {
        msaccess.failure = Some(missing_tool_failure(MSACCESS_EXE, &msaccess));
    } else {
        probe_tool(BackendTool::MsAccess, &mut msaccess, executor);
    }

    let release = preferred_metadata(&msconvert, &msaccess, |probe| &probe.release);
    let build_date = preferred_metadata(&msconvert, &msaccess, |probe| &probe.build_date);

    let mismatch_failure = identity_mismatch(&msconvert, &msaccess);
    let overall_failure = if !same_installation && msconvert.exists && msaccess.exists {
        Some(DiscoveryFailure::ToolsFromDifferentInstallations {
            msconvert_path: msconvert.path.clone().unwrap_or_default(),
            msaccess_path: msaccess.path.clone().unwrap_or_default(),
        })
    } else {
        msconvert
            .failure
            .clone()
            .or_else(|| msaccess.failure.clone())
            .or(mismatch_failure)
    };

    let availability =
        if msconvert.exists && msaccess.exists && same_installation && overall_failure.is_none() {
            AvailabilityState::Available
        } else if msconvert.exists || msaccess.exists {
            AvailabilityState::Partial
        } else {
            AvailabilityState::Unavailable
        };

    DiscoveryResult {
        availability,
        source: Some(candidate.source),
        msconvert,
        msaccess,
        same_installation,
        release,
        build_date,
        failure: overall_failure,
    }
}

fn probe_tool(backend_tool: BackendTool, tool: &mut DiscoveredTool, executor: &dyn ProbeExecutor) {
    tool.probe = None;
    tool.failure = None;
    tool.bound_help_probe = None;
    let path = tool
        .path
        .clone()
        .expect("a discovered tool always has a candidate path");
    let executable_name = match backend_tool {
        BackendTool::MsConvert => MSCONVERT_EXE,
        BackendTool::MsAccess => MSACCESS_EXE,
    };
    let pre_probe_sha256 = match Sha256Digest::calculate_file(&path) {
        Ok(digest) => digest,
        Err(error) => {
            tool.failure = Some(DiscoveryFailure::ProbeExecutableInspectionFailed {
                executable: executable_name.to_owned(),
                path,
                detail: error.to_string(),
            });
            return;
        }
    };
    let args = [OsString::from(HELP_ARGUMENT)];
    match executor.execute(&path, &args) {
        Ok(mut probe) => {
            probe.parse_build_metadata();
            let post_probe_sha256 = match Sha256Digest::calculate_file(&path) {
                Ok(digest) => digest,
                Err(error) => {
                    tool.failure = Some(DiscoveryFailure::ProbeExecutableInspectionFailed {
                        executable: executable_name.to_owned(),
                        path,
                        detail: error.to_string(),
                    });
                    tool.probe = Some(probe);
                    return;
                }
            };
            if pre_probe_sha256 != post_probe_sha256 {
                tool.failure = Some(DiscoveryFailure::ProbeExecutableChanged {
                    executable: executable_name.to_owned(),
                    path,
                });
                tool.probe = Some(probe);
                return;
            }
            let bound_help_probe =
                BoundHelpProbe::capture(backend_tool, &path, post_probe_sha256, &probe);
            if probe.identity_conflict {
                tool.failure = Some(DiscoveryFailure::ProbeMetadataConflict {
                    executable: executable_name.to_owned(),
                    path: path.clone(),
                });
            } else if !help_probe_exit_is_accepted(executable_name, &bound_help_probe, &probe) {
                tool.failure = Some(DiscoveryFailure::ProbeNonZero {
                    executable: executable_name.to_owned(),
                    path: path.clone(),
                    exit_code: probe.exit_code,
                    detail: concise_detail(&probe.stderr, &probe.stdout),
                });
            } else if probe.release.is_none() || probe.build_date.is_none() {
                tool.failure = Some(DiscoveryFailure::ProbeMetadataMissing {
                    executable: executable_name.to_owned(),
                    path: path.clone(),
                });
            }
            if tool.failure.is_none() {
                tool.bound_help_probe = Some(bound_help_probe);
            }
            tool.probe = Some(probe);
        }
        Err(error) => {
            tool.failure = Some(if error.kind() == io::ErrorKind::TimedOut {
                DiscoveryFailure::ProbeTimedOut {
                    executable: executable_name.to_owned(),
                    path: path.clone(),
                    timeout: PROBE_TIMEOUT,
                }
            } else {
                DiscoveryFailure::ProbeLaunchFailed {
                    executable: executable_name.to_owned(),
                    path: path.clone(),
                    detail: error.to_string(),
                }
            });
        }
    }
}

fn help_probe_exit_is_accepted(
    executable_name: &str,
    bound_help_probe: &BoundHelpProbe,
    probe: &ToolProbe,
) -> bool {
    if probe.identity_conflict {
        return false;
    }
    if probe.succeeded() {
        return true;
    }
    if !executable_name.eq_ignore_ascii_case(MSACCESS_EXE)
        || probe.exit_code != Some(1)
        || probe.release.is_none()
        || probe.build_date.is_none()
    {
        return false;
    }

    let Ok(capabilities) = InstalledHelpCapabilities::parse_bound_help(bound_help_probe) else {
        return false;
    };
    capabilities
        .require_preview_operation(&PreviewOperation::Metadata)
        .is_ok()
}

fn missing_tool_failure(executable_name: &str, tool: &DiscoveredTool) -> DiscoveryFailure {
    DiscoveryFailure::MissingTool {
        executable: executable_name.to_owned(),
        expected_path: tool.path.clone().unwrap_or_default(),
    }
}

fn same_parent(left: &Option<PathBuf>, right: &Option<PathBuf>) -> bool {
    let (Some(left), Some(right)) = (left.as_deref(), right.as_deref()) else {
        return false;
    };
    let (Some(left), Some(right)) = (left.parent(), right.parent()) else {
        return false;
    };
    let canonical_left = left.canonicalize().unwrap_or_else(|_| left.to_path_buf());
    let canonical_right = right.canonicalize().unwrap_or_else(|_| right.to_path_buf());
    paths_equal(&canonical_left, &canonical_right)
}

#[cfg(windows)]
fn paths_equal(left: &Path, right: &Path) -> bool {
    left.as_os_str()
        .encode_wide()
        .map(fold_ascii_wide)
        .eq(right.as_os_str().encode_wide().map(fold_ascii_wide))
}

#[cfg(windows)]
const fn fold_ascii_wide(value: u16) -> u16 {
    if value >= b'A' as u16 && value <= b'Z' as u16 {
        value + (b'a' - b'A') as u16
    } else {
        value
    }
}

#[cfg(not(windows))]
fn paths_equal(left: &Path, right: &Path) -> bool {
    left == right
}

fn preferred_metadata(
    msconvert: &DiscoveredTool,
    msaccess: &DiscoveredTool,
    select: impl Fn(&ToolProbe) -> &Option<String>,
) -> Option<String> {
    msconvert
        .probe
        .as_ref()
        .and_then(|probe| select(probe).as_ref())
        .cloned()
        .or_else(|| {
            msaccess
                .probe
                .as_ref()
                .and_then(|probe| select(probe).as_ref())
                .cloned()
        })
}

fn identity_mismatch(
    msconvert: &DiscoveredTool,
    msaccess: &DiscoveredTool,
) -> Option<DiscoveryFailure> {
    let msconvert_release = msconvert.probe.as_ref()?.release.as_ref()?;
    let msconvert_build_date = msconvert.probe.as_ref()?.build_date.as_ref()?;
    let msaccess_release = msaccess.probe.as_ref()?.release.as_ref()?;
    let msaccess_build_date = msaccess.probe.as_ref()?.build_date.as_ref()?;
    let msconvert_revision = msconvert.probe.as_ref()?.source_revision.as_deref();
    let msaccess_revision = msaccess.probe.as_ref()?.source_revision.as_deref();
    let revisions_compatible = match (msconvert_revision, msaccess_revision) {
        (Some(left), Some(right)) => left.eq_ignore_ascii_case(right),
        _ => true,
    };
    if msconvert_release == msaccess_release && revisions_compatible {
        None
    } else {
        Some(DiscoveryFailure::ProbeIdentityMismatch {
            msconvert_release: msconvert_release.clone(),
            msconvert_build_date: msconvert_build_date.clone(),
            msaccess_release: msaccess_release.clone(),
            msaccess_build_date: msaccess_build_date.clone(),
        })
    }
}

fn unique_label_value<'a>(
    streams: impl IntoIterator<Item = &'a [u8]>,
    label: &str,
) -> (Option<String>, bool) {
    let mut values = Vec::<String>::new();
    for stream in streams {
        let text = String::from_utf8_lossy(stream);
        for line in text.lines() {
            let line = line.trim();
            let Some(prefix) = line.get(..label.len()) else {
                continue;
            };
            if !prefix.eq_ignore_ascii_case(label) {
                continue;
            }
            let value = line[label.len()..].trim();
            if !values.iter().any(|existing| existing == value) {
                values.push(value.to_owned());
            }
        }
    }

    match values.as_slice() {
        [] => (None, false),
        [value] if value.is_empty() => (None, false),
        [value] => (Some(value.clone()), false),
        _ => (None, true),
    }
}

fn split_release_revision(value: &str) -> (Option<String>, Option<String>) {
    let value = value.trim();
    if let Some((release, suffix)) = value.rsplit_once(" (")
        && let Some(revision) = suffix.strip_suffix(')')
        && (7..=64).contains(&revision.len())
        && revision.bytes().all(|byte| byte.is_ascii_hexdigit())
        && !release.trim().is_empty()
    {
        return (
            Some(release.trim().to_owned()),
            Some(revision.to_ascii_lowercase()),
        );
    }
    ((!value.is_empty()).then(|| value.to_owned()), None)
}

fn concise_detail(primary: &[u8], fallback: &[u8]) -> String {
    let primary = String::from_utf8_lossy(primary);
    let fallback = String::from_utf8_lossy(fallback);
    primary
        .lines()
        .chain(fallback.lines())
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("the process exited without a diagnostic message")
        .to_owned()
}

/// Assembles the directories worth searching for an installed ProteoWizard.
///
/// Kept separate from the process environment so the assembly itself can be
/// tested. It could not be before, and that is exactly where the per-user
/// installation was being missed: the container rule below was written once and
/// then applied only to Program Files.
fn common_install_roots(
    program_files: Option<OsString>,
    program_files_x86: Option<OsString>,
    local_app_data: Option<OsString>,
) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    // Machine-wide installations first. A user who has both should get the one
    // that was installed deliberately for the machine.
    push_container_roots(&mut roots, program_files);
    push_container_roots(&mut roots, program_files_x86);

    if let Some(local_app_data) = local_app_data {
        let local_app_data = PathBuf::from(local_app_data);
        // A per-user install lands under one of these three. `Apps` is where
        // the per-user MSI actually puts it, which is the case this function
        // exists to stop missing.
        for container in [
            local_app_data.clone(),
            local_app_data.join("Programs"),
            local_app_data.join("Apps"),
        ] {
            push_container_roots(&mut roots, Some(container.into_os_string()));
        }
    }

    roots
}

/// Adds a container directory's own `ProteoWizard` subdirectory and any
/// versioned `ProteoWizard*` directories sitting directly inside it.
///
/// Installers use both shapes: a stable `ProteoWizard` folder holding versioned
/// children, and a versioned folder placed directly in a generic container such
/// as `Program Files` or `%LOCALAPPDATA%\Apps`. The stable folder is searched
/// first, then the versioned siblings newest first.
fn push_container_roots(roots: &mut Vec<PathBuf>, value: Option<OsString>) {
    let Some(value) = value else {
        return;
    };
    let container = PathBuf::from(value);
    push_unique(roots, container.join("ProteoWizard"));

    let mut direct_versioned_roots = fs::read_dir(&container)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .to_ascii_lowercase()
                .starts_with("proteowizard")
        })
        .filter_map(|entry| {
            entry
                .file_type()
                .ok()
                .filter(|file_type| file_type.is_dir())
                .map(|_| entry.path())
        })
        .collect::<Vec<_>>();
    direct_versioned_roots.sort_by_key(|root| cmp::Reverse(release_sort_key(root)));
    for root in direct_versioned_roots {
        push_unique(roots, root);
    }
}

/// Orders installation directories newest release first.
///
/// Comparing the names as text gets this wrong in the one way that matters:
/// `3.0.9134` sorts above `3.0.26013` because `'9'` is above `'2'`, so someone
/// who upgraded would keep being handed the installation they replaced. That is
/// not a cosmetic ordering question. `automatic_candidate` returns exactly one
/// candidate and never falls back to a later root, so whichever directory comes
/// first here is the one whose binaries run.
///
/// Only names that already begin with `proteowizard` reach this, so the first
/// three digit groups are the release. A directory carrying no digits sorts
/// last rather than first.
fn release_sort_key(path: &Path) -> (u64, u64, u64, String) {
    let name = path.file_name().map_or_else(String::new, |name| {
        name.to_string_lossy().to_ascii_lowercase()
    });

    let mut groups = [0_u64; 3];
    let mut filled = 0;
    let mut digits = String::new();
    // The trailing space flushes a group that runs to the end of the name.
    for character in name.chars().chain(std::iter::once(' ')) {
        if character.is_ascii_digit() {
            digits.push(character);
            continue;
        }
        if !digits.is_empty() {
            if filled < groups.len() {
                // A group too large to be a real release sorts last, not first.
                groups[filled] = digits.parse().unwrap_or(0);
                filled += 1;
            }
            digits.clear();
        }
    }

    (groups[0], groups[1], groups[2], name)
}

fn push_unique(paths: &mut Vec<PathBuf>, path: PathBuf) {
    if !paths.iter().any(|existing| paths_equal(existing, &path)) {
        paths.push(path);
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Mutex;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;
    use crate::{HelpCapabilityError, Sha256Digest};

    struct TempTree {
        root: PathBuf,
    }

    impl TempTree {
        fn new(label: &str) -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should follow the Unix epoch")
                .as_nanos();
            let root = env::temp_dir().join(format!(
                "mscanvas-proteowizard-discovery-{label}-{}-{nonce}",
                std::process::id()
            ));
            fs::create_dir_all(&root).expect("temporary test root should be created");
            Self { root }
        }

        fn installation(&self, relative: impl AsRef<Path>, tools: &[&str]) -> PathBuf {
            let directory = self.root.join(relative);
            fs::create_dir_all(&directory).expect("fake installation should be created");
            for tool in tools {
                fs::write(directory.join(tool), b"fake executable")
                    .expect("fake executable should be created");
            }
            directory
                .canonicalize()
                .expect("fake installation should have an absolute canonical path")
        }
    }

    impl Drop for TempTree {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[derive(Default)]
    struct FakeProbeExecutor {
        responses: HashMap<PathBuf, ToolProbe>,
        launch_failures: HashMap<PathBuf, String>,
        calls: Mutex<Vec<(PathBuf, Vec<OsString>)>>,
    }

    impl FakeProbeExecutor {
        fn successful_for(paths: impl IntoIterator<Item = PathBuf>) -> Self {
            let response = ToolProbe::new(
                "ProteoWizard release: 3.0.26013\nBuild date: Jan 13 2026\n",
                "",
                Some(0),
                Duration::from_millis(17),
            );
            Self {
                responses: paths
                    .into_iter()
                    .map(|path| (path, response.clone()))
                    .collect(),
                ..Self::default()
            }
        }
    }

    impl ProbeExecutor for FakeProbeExecutor {
        fn execute(&self, executable: &Path, args: &[OsString]) -> io::Result<ToolProbe> {
            self.calls
                .lock()
                .expect("call list mutex should not be poisoned")
                .push((executable.to_path_buf(), args.to_vec()));
            if let Some(detail) = self.launch_failures.get(executable) {
                return Err(io::Error::other(detail.clone()));
            }
            self.responses
                .get(executable)
                .cloned()
                .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "no fake probe response"))
        }
    }

    struct ReplacingProbeExecutor {
        replacement: Vec<u8>,
        response: ToolProbe,
    }

    impl ProbeExecutor for ReplacingProbeExecutor {
        fn execute(&self, executable: &Path, _args: &[OsString]) -> io::Result<ToolProbe> {
            fs::write(executable, &self.replacement)?;
            Ok(self.response.clone())
        }
    }

    #[test]
    fn discovered_executable_is_canonicalized_before_probe() {
        let tree = TempTree::new("canonical-probe");
        let installation = tree.installation("pwiz", &[MSCONVERT_EXE]);
        let executable = installation.join("..").join("pwiz").join(MSCONVERT_EXE);
        let canonical_executable =
            fs::canonicalize(&executable).expect("canonical fake executable");
        let mut tool = DiscoveredTool::at(executable);
        let executor = FakeProbeExecutor::successful_for([canonical_executable.clone()]);

        probe_tool(BackendTool::MsConvert, &mut tool, &executor);

        assert_eq!(tool.path.as_deref(), Some(canonical_executable.as_path()));
        assert!(tool.probe.is_some());
        assert_eq!(
            executor.calls.lock().expect("call list mutex").as_slice(),
            &[(canonical_executable, vec![OsString::from(HELP_ARGUMENT)])]
        );
    }

    #[test]
    fn bound_help_receipt_cannot_be_rebound_to_another_installation() {
        const COMPLETE_MSCONVERT_HELP: &str = r#"ProteoWizard release: 3.0.26013
Build date: Jan 13 2026
Usage: msconvert [options] [filemasks]

Options:
  -o [ --outdir ] arg (=.)           : set output directory
  --outfile arg                      : Override the name of output file.
  --mzML                             : write mzML format [default]
  --mzXML                            : write mzXML format
  -z [ --zlib ] [=arg(=1)]           : use zlib compression for binary data
"#;
        const OTHER_INSTALLATION_HELP: &str = r#"ProteoWizard release: 3.0.26013
Build date: Jan 13 2026
Usage: msconvert [options] [filemasks]

Options:
  -o [ --outdir ] arg (=.)           : set output directory
  --outfile arg                      : Override the name of output file.
  --mzML                             : write mzML format [default]
  --mzXML                            : write mzXML format
  -z [ --zlib ] [=arg(=1)]           : use zlib compression for binary data

Examples:
  msconvert installation-b.raw --mzML
"#;
        let tree = TempTree::new("bound-help-receipt");
        let installation_a = tree.installation("installation-a", &[MSCONVERT_EXE]);
        let installation_b = tree.installation("installation-b", &[MSCONVERT_EXE]);
        let executable_alias = installation_a
            .join("..")
            .join("installation-a")
            .join(MSCONVERT_EXE);
        let canonical_a = fs::canonicalize(&executable_alias).expect("canonical executable A");
        let canonical_b =
            fs::canonicalize(installation_b.join(MSCONVERT_EXE)).expect("canonical executable B");
        let probe_a = ToolProbe::new(
            COMPLETE_MSCONVERT_HELP,
            "",
            Some(0),
            Duration::from_millis(17),
        );
        let mut executor = FakeProbeExecutor::default();
        executor.responses.insert(canonical_a.clone(), probe_a);
        let mut discovered = DiscoveredTool::at(executable_alias);

        probe_tool(BackendTool::MsConvert, &mut discovered, &executor);

        discovered.path = Some(canonical_b.clone());
        discovered.probe = Some(ToolProbe::new(
            OTHER_INSTALLATION_HELP,
            "",
            Some(0),
            Duration::from_millis(17),
        ));
        let capabilities = InstalledHelpCapabilities::from_discovered_tool(&discovered)
            .expect("the private receipt retains the original executable and capture");

        assert_eq!(capabilities.executable(), canonical_a);
        assert_ne!(capabilities.executable(), canonical_b);
        assert_eq!(
            capabilities.executable_sha256(),
            Sha256Digest::calculate_file(&canonical_a).expect("hash executable A")
        );
        assert_eq!(
            capabilities.raw_help_hashes().stdout,
            Sha256Digest::calculate(COMPLETE_MSCONVERT_HELP.as_bytes())
                .expect("hash installation A help")
        );
        assert_ne!(
            capabilities.raw_help_hashes().stdout,
            Sha256Digest::calculate(OTHER_INSTALLATION_HELP.as_bytes())
                .expect("hash installation B help")
        );
    }

    #[test]
    fn capabilities_require_a_validated_bound_help_receipt() {
        let tree = TempTree::new("unprobed-capability");
        let installation = tree.installation("pwiz", &[MSCONVERT_EXE]);
        let discovered = DiscoveredTool::at(installation.join(MSCONVERT_EXE));

        assert_eq!(
            InstalledHelpCapabilities::from_discovered_tool(&discovered),
            Err(HelpCapabilityError::ValidatedHelpProbeRequired)
        );
    }

    #[test]
    fn rejected_probe_cannot_be_promoted_by_mutating_public_status() {
        let tree = TempTree::new("rejected-probe-receipt");
        let installation = tree.installation("pwiz", &[MSCONVERT_EXE]);
        let executable =
            fs::canonicalize(installation.join(MSCONVERT_EXE)).expect("canonical fake executable");
        let mut executor = FakeProbeExecutor::default();
        executor.responses.insert(
            executable.clone(),
            ToolProbe::new(
                "ProteoWizard release: 3.0.26013\nBuild date: Jan 13 2026\nUsage: msconvert [options] [filemasks]\nOptions:\n  --mzML : write mzML\n",
                "probe failed",
                Some(1),
                Duration::from_millis(17),
            ),
        );
        let mut discovered = DiscoveredTool::at(executable);

        probe_tool(BackendTool::MsConvert, &mut discovered, &executor);
        assert!(matches!(
            discovered.failure,
            Some(DiscoveryFailure::ProbeNonZero { .. })
        ));

        discovered.failure = None;
        discovered.exists = true;
        assert_eq!(
            InstalledHelpCapabilities::from_discovered_tool(&discovered),
            Err(HelpCapabilityError::ValidatedHelpProbeRequired)
        );
    }

    #[test]
    fn executable_replacement_during_probe_fails_without_a_bound_receipt() {
        let tree = TempTree::new("probe-executable-replacement");
        let installation = tree.installation("pwiz", &[MSCONVERT_EXE]);
        let executable =
            fs::canonicalize(installation.join(MSCONVERT_EXE)).expect("canonical fake executable");
        let executor = ReplacingProbeExecutor {
            replacement: b"different executable".to_vec(),
            response: ToolProbe::new(
                "ProteoWizard release: 3.0.26013\nBuild date: Jan 13 2026\n",
                "",
                Some(0),
                Duration::from_millis(17),
            ),
        };
        let mut discovered = DiscoveredTool::at(executable);

        probe_tool(BackendTool::MsConvert, &mut discovered, &executor);

        assert!(matches!(
            discovered.failure,
            Some(DiscoveryFailure::ProbeExecutableChanged { .. })
        ));
        discovered.failure = None;
        assert_eq!(
            InstalledHelpCapabilities::from_discovered_tool(&discovered),
            Err(HelpCapabilityError::ValidatedHelpProbeRequired)
        );
    }

    #[test]
    fn source_revision_suffix_is_preserved_but_not_compared_as_semantic_release() {
        let msconvert_probe = ToolProbe::new(
            "ProteoWizard release: 3.0.26204 (a09eea9)\nBuild date: Jul 1 2026\n",
            "",
            Some(0),
            Duration::from_millis(1),
        );
        assert_eq!(
            msconvert_probe.reported_release.as_deref(),
            Some("3.0.26204 (a09eea9)")
        );
        assert_eq!(msconvert_probe.release.as_deref(), Some("3.0.26204"));
        assert_eq!(msconvert_probe.source_revision.as_deref(), Some("a09eea9"));

        let msaccess_probe = ToolProbe::new(
            "ProteoWizard release: 3.0.26204\nBuild date: Jul 1 2026\n",
            "",
            Some(1),
            Duration::from_millis(1),
        );
        let mut msconvert = DiscoveredTool::undiscovered();
        msconvert.probe = Some(msconvert_probe);
        let mut msaccess = DiscoveredTool::undiscovered();
        msaccess.probe = Some(msaccess_probe);
        assert!(identity_mismatch(&msconvert, &msaccess).is_none());
    }

    #[test]
    fn duplicate_equal_identity_lines_are_allowed_but_conflicts_are_not_selected() {
        let equal = ToolProbe::new(
            "ProteoWizard release: 3.0.26204 (a09eea9)\nBuild date: Jul 1 2026\n",
            "proteowizard release: 3.0.26204 (a09eea9)\nBuild date: Jul 1 2026\n",
            Some(0),
            Duration::from_millis(1),
        );
        assert!(!equal.identity_conflict);
        assert_eq!(equal.release.as_deref(), Some("3.0.26204"));
        assert_eq!(equal.build_date.as_deref(), Some("Jul 1 2026"));

        let conflicting = ToolProbe::new(
            "ProteoWizard release: 3.0.26204 (a09eea9)\nBuild date: Jul 1 2026\nBuild date: Jul 2 2026\n",
            "ProteoWizard release: 3.0.26205\n",
            Some(0),
            Duration::from_millis(1),
        );
        assert!(conflicting.identity_conflict);
        assert!(conflicting.reported_release.is_none());
        assert!(conflicting.release.is_none());
        assert!(conflicting.source_revision.is_none());
        assert!(conflicting.build_date.is_none());
    }

    #[test]
    fn a_conflicting_identity_probe_fails_discovery_before_metadata_is_used() {
        let tree = TempTree::new("conflicting-probe-identity");
        let home = tree.installation("tools", &[MSCONVERT_EXE]);
        let path = home.join(MSCONVERT_EXE);
        let mut executor = FakeProbeExecutor::default();
        executor.responses.insert(
            path.clone(),
            ToolProbe::new(
                "ProteoWizard release: 3.0.26204\nBuild date: Jul 1 2026\n",
                "ProteoWizard release: 3.0.26205\nBuild date: Jul 1 2026\n",
                Some(0),
                Duration::from_millis(1),
            ),
        );
        let mut tool = DiscoveredTool::at(path.clone());

        probe_tool(BackendTool::MsConvert, &mut tool, &executor);

        assert!(matches!(
            tool.failure,
            Some(DiscoveryFailure::ProbeMetadataConflict {
                ref executable,
                path: ref failure_path,
            }) if executable == MSCONVERT_EXE && failure_path == &path
        ));
    }

    #[test]
    fn semantic_release_or_dual_revision_mismatch_fails_closed() {
        for (msconvert_release, msaccess_release) in [
            ("3.0.26204 (a09eea9)", "3.0.26205"),
            ("3.0.26204 (a09eea9)", "3.0.26204 (bbbbbbb)"),
        ] {
            let mut msconvert = DiscoveredTool::undiscovered();
            msconvert.probe = Some(ToolProbe::new(
                format!("ProteoWizard release: {msconvert_release}\nBuild date: Jul 1 2026\n"),
                "",
                Some(0),
                Duration::from_millis(1),
            ));
            let mut msaccess = DiscoveredTool::undiscovered();
            msaccess.probe = Some(ToolProbe::new(
                format!("ProteoWizard release: {msaccess_release}\nBuild date: Jul 1 2026\n"),
                "",
                Some(0),
                Duration::from_millis(1),
            ));
            assert!(matches!(
                identity_mismatch(&msconvert, &msaccess),
                Some(DiscoveryFailure::ProbeIdentityMismatch { .. })
            ));
        }
    }

    struct TimedOutProbeExecutor;

    impl ProbeExecutor for TimedOutProbeExecutor {
        fn execute(&self, _executable: &Path, _args: &[OsString]) -> io::Result<ToolProbe> {
            Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "controlled probe timeout",
            ))
        }
    }

    #[test]
    fn explicit_unicode_home_probes_both_tools_with_direct_help_argv() {
        let tree = TempTree::new("configured-home");
        let home = tree.installation("质谱 工具/ProteoWizard 3.0", &[MSCONVERT_EXE, MSACCESS_EXE]);
        let msconvert_path = home.join(MSCONVERT_EXE);
        let msaccess_path = home.join(MSACCESS_EXE);
        let executor =
            FakeProbeExecutor::successful_for([msconvert_path.clone(), msaccess_path.clone()]);

        let result = discover_with(
            DiscoveryRequest::with_home(&home),
            &DiscoveryEnvironment::default(),
            &executor,
        );

        assert_eq!(result.availability, AvailabilityState::Available);
        assert_eq!(result.source, Some(DiscoverySource::ConfiguredHome));
        assert!(result.same_installation);
        assert_eq!(
            result.msconvert.path.as_deref(),
            Some(msconvert_path.as_path())
        );
        assert_eq!(
            result.msaccess.path.as_deref(),
            Some(msaccess_path.as_path())
        );
        assert_eq!(result.release.as_deref(), Some("3.0.26013"));
        assert_eq!(result.build_date.as_deref(), Some("Jan 13 2026"));
        assert_eq!(
            result
                .msconvert
                .probe
                .as_ref()
                .expect("msconvert probe should be captured")
                .elapsed,
            Duration::from_millis(17)
        );

        let calls = executor
            .calls
            .lock()
            .expect("call list mutex should not be poisoned");
        assert_eq!(calls.len(), 2);
        assert!(calls.iter().all(|(_, args)| args == &[HELP_ARGUMENT]));
    }

    #[test]
    fn invalid_explicit_location_fails_closed_before_path_fallback() {
        let tree = TempTree::new("fail-closed");
        let path_home = tree.installation("path install", &[MSCONVERT_EXE, MSACCESS_EXE]);
        let executor = FakeProbeExecutor::successful_for([
            path_home.join(MSCONVERT_EXE),
            path_home.join(MSACCESS_EXE),
        ]);
        let missing_explicit = tree.root.join("missing explicit home");

        let result = discover_with(
            DiscoveryRequest::with_home(&missing_explicit),
            &DiscoveryEnvironment::new(vec![path_home], Vec::new()),
            &executor,
        );

        assert_eq!(result.availability, AvailabilityState::Unavailable);
        assert_eq!(result.source, Some(DiscoverySource::ConfiguredHome));
        assert!(matches!(
            result.failure,
            Some(DiscoveryFailure::InvalidConfiguredLocation { path, .. })
                if path == missing_explicit
        ));
        assert!(
            executor
                .calls
                .lock()
                .expect("call list mutex should not be poisoned")
                .is_empty()
        );
    }

    #[test]
    fn exact_path_resolution_precedes_common_install_roots() {
        let tree = TempTree::new("path-precedence");
        let path_home = tree.installation("PATH tools", &[MSCONVERT_EXE, MSACCESS_EXE]);
        let common_root = tree.root.join("common");
        let common_home = tree.installation(
            "common/ProteoWizard 3.0.99999",
            &[MSCONVERT_EXE, MSACCESS_EXE],
        );
        let executor = FakeProbeExecutor::successful_for([
            path_home.join(MSCONVERT_EXE),
            path_home.join(MSACCESS_EXE),
            common_home.join(MSCONVERT_EXE),
            common_home.join(MSACCESS_EXE),
        ]);

        let result = discover_with(
            DiscoveryRequest::automatic(),
            &DiscoveryEnvironment::new(vec![path_home.clone()], vec![common_root]),
            &executor,
        );

        assert_eq!(result.source, Some(DiscoverySource::Path));
        assert_eq!(
            result.msconvert.path.as_deref(),
            Some(path_home.join(MSCONVERT_EXE).as_path())
        );
        let calls = executor
            .calls
            .lock()
            .expect("call list mutex should not be poisoned");
        assert!(calls.iter().all(|(path, _)| path.starts_with(&path_home)));
    }

    #[test]
    fn path_search_prefers_a_later_complete_pair_to_an_earlier_partial() {
        let tree = TempTree::new("path-later-complete");

        for (index, partial_tool) in [MSCONVERT_EXE, MSACCESS_EXE].into_iter().enumerate() {
            let earlier = tree.installation(format!("earlier partial {index}"), &[partial_tool]);
            let later = tree.installation(
                format!("later complete {index}"),
                &[MSCONVERT_EXE, MSACCESS_EXE],
            );
            let executor = FakeProbeExecutor::successful_for([
                earlier.join(partial_tool),
                later.join(MSCONVERT_EXE),
                later.join(MSACCESS_EXE),
            ]);

            let result = discover_with(
                DiscoveryRequest::automatic(),
                &DiscoveryEnvironment::new(vec![earlier, later.clone()], Vec::new()),
                &executor,
            );

            assert_eq!(result.availability, AvailabilityState::Available);
            assert_eq!(result.source, Some(DiscoverySource::Path));
            assert!(result.same_installation);
            assert_eq!(
                result.msconvert.path.as_deref(),
                Some(later.join(MSCONVERT_EXE).as_path())
            );
            assert_eq!(
                result.msaccess.path.as_deref(),
                Some(later.join(MSACCESS_EXE).as_path())
            );
            let calls = executor
                .calls
                .lock()
                .expect("call list mutex should not be poisoned");
            assert_eq!(calls.len(), 2);
            assert!(calls.iter().all(|(path, _)| path.starts_with(&later)));
        }
    }

    #[test]
    fn complete_common_root_pair_precedes_a_partial_path_candidate() {
        let tree = TempTree::new("common-complete-after-path-partial");
        let path_home = tree.installation("PATH partial", &[MSCONVERT_EXE]);
        let common_root = tree.root.join("ProteoWizard");
        let common_home = tree.installation(
            "ProteoWizard/ProteoWizard 3.0.99999",
            &[MSCONVERT_EXE, MSACCESS_EXE],
        );
        let executor = FakeProbeExecutor::successful_for([
            path_home.join(MSCONVERT_EXE),
            common_home.join(MSCONVERT_EXE),
            common_home.join(MSACCESS_EXE),
        ]);

        let result = discover_with(
            DiscoveryRequest::automatic(),
            &DiscoveryEnvironment::new(vec![path_home], vec![common_root]),
            &executor,
        );

        assert_eq!(result.availability, AvailabilityState::Available);
        assert_eq!(result.source, Some(DiscoverySource::CommonInstallRoot));
        assert!(result.same_installation);
        assert_eq!(
            result.msconvert.path.as_deref(),
            Some(common_home.join(MSCONVERT_EXE).as_path())
        );
        assert_eq!(
            result.msaccess.path.as_deref(),
            Some(common_home.join(MSACCESS_EXE).as_path())
        );
        let calls = executor
            .calls
            .lock()
            .expect("call list mutex should not be poisoned");
        assert_eq!(calls.len(), 2);
        assert!(calls.iter().all(|(path, _)| path.starts_with(&common_home)));
    }

    #[test]
    fn complementary_partial_path_entries_are_not_combined() {
        let tree = TempTree::new("path-complementary-partials");
        let first = tree.installation("first partial", &[MSCONVERT_EXE]);
        let second = tree.installation("second partial", &[MSACCESS_EXE]);
        let first_msconvert = first.join(MSCONVERT_EXE);
        let executor =
            FakeProbeExecutor::successful_for([first_msconvert.clone(), second.join(MSACCESS_EXE)]);

        let result = discover_with(
            DiscoveryRequest::automatic(),
            &DiscoveryEnvironment::new(vec![first.clone(), second], Vec::new()),
            &executor,
        );

        assert_eq!(result.availability, AvailabilityState::Partial);
        assert_eq!(result.source, Some(DiscoverySource::Path));
        assert!(!result.same_installation);
        assert_eq!(
            result.msconvert.path.as_deref(),
            Some(first_msconvert.as_path())
        );
        assert_eq!(
            result.msaccess.path.as_deref(),
            Some(first.join(MSACCESS_EXE).as_path())
        );
        assert!(result.msconvert.exists);
        assert!(!result.msaccess.exists);
        assert!(matches!(
            result.failure,
            Some(DiscoveryFailure::MissingTool { ref executable, .. })
                if executable == MSACCESS_EXE
        ));
        let calls = executor
            .calls
            .lock()
            .expect("call list mutex should not be poisoned");
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, first_msconvert);
    }

    #[test]
    fn exact_executable_does_not_fall_back_when_its_companion_is_missing() {
        let tree = TempTree::new("exact-executable");
        let configured_home = tree.installation("configured tools", &[MSCONVERT_EXE]);
        let fallback_home = tree.installation("fallback tools", &[MSCONVERT_EXE, MSACCESS_EXE]);
        let configured_msconvert = configured_home.join(MSCONVERT_EXE);
        let executor = FakeProbeExecutor::successful_for([
            configured_msconvert.clone(),
            fallback_home.join(MSCONVERT_EXE),
            fallback_home.join(MSACCESS_EXE),
        ]);

        let result = discover_with(
            DiscoveryRequest::with_executable(&configured_msconvert),
            &DiscoveryEnvironment::new(vec![fallback_home], Vec::new()),
            &executor,
        );

        assert_eq!(result.availability, AvailabilityState::Partial);
        assert_eq!(result.source, Some(DiscoverySource::ConfiguredExecutable));
        assert!(!result.same_installation);
        assert!(result.msconvert.exists);
        assert!(!result.msaccess.exists);
        assert!(matches!(
            result.failure,
            Some(DiscoveryFailure::MissingTool { ref executable, .. })
                if executable == MSACCESS_EXE
        ));
        let calls = executor
            .calls
            .lock()
            .expect("call list mutex should not be poisoned");
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, configured_msconvert);
    }

    #[test]
    fn common_root_search_is_one_level_only_and_deterministic() {
        let tree = TempTree::new("common-root");
        let root = tree.root.join("ProteoWizard");
        let deeper = tree.installation(
            "ProteoWizard/container/deeper install",
            &[MSCONVERT_EXE, MSACCESS_EXE],
        );
        let executor = FakeProbeExecutor::successful_for([
            deeper.join(MSCONVERT_EXE),
            deeper.join(MSACCESS_EXE),
        ]);

        let result = discover_with(
            DiscoveryRequest::automatic(),
            &DiscoveryEnvironment::new(Vec::new(), vec![root]),
            &executor,
        );

        assert_eq!(result.availability, AvailabilityState::Unavailable);
        assert_eq!(result.failure, Some(DiscoveryFailure::BackendNotFound));
        assert!(
            executor
                .calls
                .lock()
                .expect("call list mutex should not be poisoned")
                .is_empty()
        );
    }

    #[test]
    fn non_zero_probe_preserves_output_exit_code_and_timing() {
        let tree = TempTree::new("non-zero");
        let home = tree.installation("tools", &[MSCONVERT_EXE, MSACCESS_EXE]);
        let msconvert_path = home.join(MSCONVERT_EXE);
        let msaccess_path = home.join(MSACCESS_EXE);
        let mut executor = FakeProbeExecutor::successful_for([msaccess_path]);
        executor.responses.insert(
            msconvert_path.clone(),
            ToolProbe::new(
                "",
                "backend initialization failed\n",
                Some(9),
                Duration::from_millis(31),
            ),
        );

        let result = discover_with(
            DiscoveryRequest::with_home(home),
            &DiscoveryEnvironment::default(),
            &executor,
        );

        assert_eq!(result.availability, AvailabilityState::Partial);
        assert!(matches!(
            result.failure,
            Some(DiscoveryFailure::ProbeNonZero {
                exit_code: Some(9),
                ref detail,
                ..
            }) if detail == "backend initialization failed"
        ));
        let probe = result
            .msconvert
            .probe
            .expect("non-zero probe output should be retained");
        assert_eq!(probe.exit_code, Some(9));
        assert_eq!(probe.elapsed, Duration::from_millis(31));
        assert_eq!(probe.stderr, b"backend initialization failed\n".to_vec());
    }

    #[cfg(windows)]
    #[test]
    fn exact_msaccess_help_exit_one_is_accepted_only_with_complete_typed_grammar() {
        let tree = TempTree::new("msaccess-help-exit-one");
        let home = tree.installation("tools", &[MSCONVERT_EXE, MSACCESS_EXE]);
        let msconvert_path = home.join(MSCONVERT_EXE);
        let msaccess_path = home.join(MSACCESS_EXE);
        let mut executor =
            FakeProbeExecutor::successful_for([msconvert_path.clone(), msaccess_path.clone()]);
        executor.responses.insert(
            msaccess_path.clone(),
            ToolProbe::new(
                "",
                MSACCESS_HELP_EXIT_ONE,
                Some(1),
                Duration::from_millis(23),
            ),
        );

        let accepted = discover_with(
            DiscoveryRequest::with_home(&home),
            &DiscoveryEnvironment::default(),
            &executor,
        );
        assert_eq!(accepted.availability, AvailabilityState::Available);
        assert_eq!(accepted.msaccess.probe.unwrap().exit_code, Some(1));

        executor.responses.insert(
            msaccess_path,
            ToolProbe::new(
                "ProteoWizard release: 3.0.26013\nBuild date: Jan 13 2026\n",
                "usage unavailable",
                Some(1),
                Duration::from_millis(23),
            ),
        );
        let rejected = discover_with(
            DiscoveryRequest::with_home(home),
            &DiscoveryEnvironment::default(),
            &executor,
        );
        assert_eq!(rejected.availability, AvailabilityState::Partial);
        assert!(matches!(
            rejected.msaccess.failure,
            Some(DiscoveryFailure::ProbeNonZero {
                exit_code: Some(1),
                ..
            })
        ));
    }

    const MSACCESS_HELP_EXIT_ONE: &str = r#"ProteoWizard release: 3.0.26013
Build date: Jan 13 2026
Usage: msaccess [options] [filenames]

Options:
  -o [ --outdir ] arg (=.) : output directory
  -x [ --exec ] arg        : execute command

Analysis commands (used with -x/--exec):

  metadata
"#;

    #[test]
    fn timed_out_probe_has_a_distinct_version_probe_failure() {
        let tree = TempTree::new("probe-timeout");
        let home = tree.installation("tools", &[MSCONVERT_EXE, MSACCESS_EXE]);

        let result = discover_with(
            DiscoveryRequest::with_home(home),
            &DiscoveryEnvironment::default(),
            &TimedOutProbeExecutor,
        );

        assert_eq!(result.availability, AvailabilityState::Partial);
        assert!(matches!(
            result.failure,
            Some(DiscoveryFailure::ProbeTimedOut {
                ref executable,
                timeout,
                ..
            }) if executable == MSCONVERT_EXE && timeout == PROBE_TIMEOUT
        ));
    }

    #[test]
    fn same_release_with_distinct_translation_unit_build_dates_is_compatible() {
        let tree = TempTree::new("different-build-dates");
        let home = tree.installation("tools", &[MSCONVERT_EXE, MSACCESS_EXE]);
        let msconvert_path = home.join(MSCONVERT_EXE);
        let msaccess_path = home.join(MSACCESS_EXE);
        let mut executor =
            FakeProbeExecutor::successful_for([msconvert_path.clone(), msaccess_path.clone()]);
        executor.responses.insert(
            msaccess_path,
            ToolProbe::new(
                "ProteoWizard release: 3.0.26013\nBuild date: Jan 14 2026\n",
                "",
                Some(0),
                Duration::from_millis(17),
            ),
        );

        let result = discover_with(
            DiscoveryRequest::with_home(home),
            &DiscoveryEnvironment::default(),
            &executor,
        );

        assert_eq!(result.availability, AvailabilityState::Available);
        assert!(result.failure.is_none());
        assert_eq!(
            result.msconvert.probe.unwrap().build_date.as_deref(),
            Some("Jan 13 2026")
        );
        assert_eq!(
            result.msaccess.probe.unwrap().build_date.as_deref(),
            Some("Jan 14 2026")
        );
    }

    #[test]
    fn reviewed_container_roots_cover_nested_and_direct_versioned_layouts_only() {
        let tree = TempTree::new("program-files-layouts");
        fs::create_dir_all(tree.root.join("ProteoWizard"))
            .expect("nested ProteoWizard root should be created");
        fs::create_dir_all(tree.root.join("ProteoWizard 3.0.26013.abcdef"))
            .expect("direct versioned root should be created");
        fs::create_dir_all(tree.root.join("Unrelated Application"))
            .expect("unrelated directory should be created");

        let mut roots = Vec::new();
        push_container_roots(&mut roots, Some(tree.root.as_os_str().to_owned()));

        assert!(roots.contains(&tree.root.join("ProteoWizard")));
        assert!(roots.contains(&tree.root.join("ProteoWizard 3.0.26013.abcdef")));
        assert!(!roots.contains(&tree.root.join("Unrelated Application")));
    }

    #[test]
    fn a_per_user_installation_under_local_app_data_apps_is_searched() {
        // The layout a per-user ProteoWizard MSI actually produces. Before this
        // was searched, MSCanvas reported backend_not_found on a machine with a
        // working installation, and told the user to install it or to choose an
        // installation folder the product does not offer.
        let tree = TempTree::new("per-user-apps");
        let apps = tree.root.join("Apps");
        fs::create_dir_all(apps.join("ProteoWizard 3.0.26013.47b13cf 64-bit"))
            .expect("per-user installation should be created");
        fs::create_dir_all(apps.join("Unrelated Vendor Tool"))
            .expect("unrelated neighbour should be created");

        let roots = common_install_roots(None, None, Some(tree.root.as_os_str().to_owned()));

        assert!(roots.contains(&apps.join("ProteoWizard 3.0.26013.47b13cf 64-bit")));
        assert!(!roots.contains(&apps.join("Unrelated Vendor Tool")));
    }

    #[test]
    fn the_previously_searched_local_app_data_shapes_are_still_searched() {
        // The fix must be a superset: nothing that resolved before may stop
        // resolving now.
        let tree = TempTree::new("local-app-data-shapes");
        fs::create_dir_all(tree.root.join("ProteoWizard"))
            .expect("direct container should be created");
        fs::create_dir_all(tree.root.join("Programs").join("ProteoWizard"))
            .expect("Programs container should be created");

        let roots = common_install_roots(None, None, Some(tree.root.as_os_str().to_owned()));

        assert!(roots.contains(&tree.root.join("ProteoWizard")));
        assert!(roots.contains(&tree.root.join("Programs").join("ProteoWizard")));
    }

    #[test]
    fn a_machine_wide_installation_is_searched_before_a_per_user_one() {
        // Someone with both installed gets the one installed for the machine.
        let tree = TempTree::new("install-precedence");
        let program_files = tree.root.join("Program Files");
        let local_app_data = tree.root.join("Local");
        let machine_wide = program_files.join("ProteoWizard 3.0.26013 64-bit");
        let per_user = local_app_data
            .join("Apps")
            .join("ProteoWizard 3.0.26013 64-bit");
        fs::create_dir_all(&machine_wide).expect("machine-wide install should be created");
        fs::create_dir_all(&per_user).expect("per-user install should be created");

        let roots = common_install_roots(
            Some(program_files.as_os_str().to_owned()),
            None,
            Some(local_app_data.as_os_str().to_owned()),
        );

        let machine_position = roots.iter().position(|root| root == &machine_wide);
        let per_user_position = roots.iter().position(|root| root == &per_user);
        assert!(machine_position.is_some() && per_user_position.is_some());
        assert!(machine_position < per_user_position);
    }

    #[test]
    fn a_newer_release_is_searched_before_an_older_one() {
        // Discovery has no fallback: `automatic_candidate` returns one
        // candidate and a later root is never tried, so this order decides
        // which binaries run. Lexicographic order gets it wrong in the way
        // that matters, because '9' sorts above '2' and 3.0.9134 is older
        // than 3.0.26013.
        let tree = TempTree::new("release-order");
        let older = tree.root.join("ProteoWizard 3.0.9134");
        let newer = tree.root.join("ProteoWizard 3.0.26013.47b13cf 64-bit");
        fs::create_dir_all(&older).expect("older install should be created");
        fs::create_dir_all(&newer).expect("newer install should be created");

        let mut roots = Vec::new();
        push_container_roots(&mut roots, Some(tree.root.as_os_str().to_owned()));

        let newer_position = roots.iter().position(|root| root == &newer);
        let older_position = roots.iter().position(|root| root == &older);
        assert!(newer_position.is_some() && older_position.is_some());
        assert!(
            newer_position < older_position,
            "3.0.26013 must be searched before 3.0.9134, got {roots:?}"
        );
    }

    #[test]
    fn absent_environment_variables_contribute_no_roots() {
        assert!(common_install_roots(None, None, None).is_empty());
    }
}
