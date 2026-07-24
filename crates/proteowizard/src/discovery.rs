//! Deterministic discovery and `--help` probing for user-installed ProteoWizard tools.

use std::borrow::Borrow;
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
    pub release: Option<String>,
    pub build_date: Option<String>,
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
            release: None,
            build_date: None,
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
            release: None,
            build_date: None,
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
        self.release = find_label_value(&self.stdout, "ProteoWizard release:")
            .or_else(|| find_label_value(&self.stderr, "ProteoWizard release:"));
        self.build_date = find_label_value(&self.stdout, "Build date:")
            .or_else(|| find_label_value(&self.stderr, "Build date:"));
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
            | Self::ProbeTimedOut { .. }
            | Self::ProbeNonZero { .. }
            | Self::ProbeMetadataMissing { .. }
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
            Self::ProbeTimedOut { .. } => "A ProteoWizard self-test timed out.",
            Self::ProbeNonZero { .. } => "A ProteoWizard self-test returned an error.",
            Self::ProbeMetadataMissing { .. } => "The ProteoWizard build could not be identified.",
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
            Self::ProbeLaunchFailed { .. } => {
                "Check file permissions and repair or reinstall the selected ProteoWizard installation."
            }
            Self::ProbeTimedOut { .. }
            | Self::ProbeNonZero { .. }
            | Self::ProbeMetadataMissing { .. } => {
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
}

impl DiscoveredTool {
    fn at(path: PathBuf) -> Self {
        let exists = path.is_file();
        Self {
            path: Some(path),
            exists,
            probe: None,
            failure: None,
        }
    }

    fn undiscovered() -> Self {
        Self {
            path: None,
            exists: false,
            probe: None,
            failure: None,
        }
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

        let mut common_install_roots = Vec::new();
        push_program_files_roots(&mut common_install_roots, env::var_os("ProgramFiles"));
        push_program_files_roots(&mut common_install_roots, env::var_os("ProgramFiles(x86)"));
        if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
            let local_app_data = PathBuf::from(local_app_data);
            push_unique(
                &mut common_install_roots,
                local_app_data.join("Programs").join("ProteoWizard"),
            );
            push_unique(
                &mut common_install_roots,
                local_app_data.join("ProteoWizard"),
            );
        }

        Self {
            path_entries,
            common_install_roots,
        }
    }
}

pub trait ProbeExecutor {
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

pub fn discover_with(
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
    } else if let Some(candidate) = path_candidate(&environment.path_entries) {
        candidate
    } else if let Some(candidate) = common_root_candidate(&environment.common_install_roots) {
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

fn path_candidate(path_entries: &[PathBuf]) -> Option<Candidate> {
    let msconvert_path = find_on_path(path_entries, MSCONVERT_EXE);
    let msaccess_path = find_on_path(path_entries, MSACCESS_EXE);
    if msconvert_path.is_none() && msaccess_path.is_none() {
        return None;
    }

    let fallback_directory = msconvert_path
        .as_deref()
        .or(msaccess_path.as_deref())
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .unwrap_or_default();
    Some(Candidate {
        source: DiscoverySource::Path,
        msconvert_path: msconvert_path.unwrap_or_else(|| fallback_directory.join(MSCONVERT_EXE)),
        msaccess_path: msaccess_path.unwrap_or_else(|| fallback_directory.join(MSACCESS_EXE)),
    })
}

fn find_on_path(path_entries: &[PathBuf], executable: &str) -> Option<PathBuf> {
    path_entries
        .iter()
        .map(|directory| directory.join(executable))
        .find(|candidate| candidate.is_file())
        .map(|candidate| candidate.canonicalize().unwrap_or(candidate))
}

fn common_root_candidate(common_roots: &[PathBuf]) -> Option<Candidate> {
    let mut first_partial = None;
    for root in common_roots {
        for directory in root_and_direct_children(root) {
            let directory = directory.canonicalize().unwrap_or(directory);
            let candidate =
                candidate_from_directory(&directory, DiscoverySource::CommonInstallRoot);
            let has_msconvert = candidate.msconvert_path.is_file();
            let has_msaccess = candidate.msaccess_path.is_file();
            if has_msconvert && has_msaccess {
                return Some(candidate);
            }
            if first_partial.is_none() && (has_msconvert || has_msaccess) {
                first_partial = Some(candidate);
            }
        }
    }
    first_partial
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
        probe_tool(MSCONVERT_EXE, &mut msconvert, executor);
    }
    if !msaccess.exists {
        msaccess.failure = Some(missing_tool_failure(MSACCESS_EXE, &msaccess));
    } else {
        probe_tool(MSACCESS_EXE, &mut msaccess, executor);
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

fn probe_tool(executable_name: &str, tool: &mut DiscoveredTool, executor: &dyn ProbeExecutor) {
    let path = tool
        .path
        .as_deref()
        .expect("a discovered tool always has a candidate path");
    let args = [OsString::from(HELP_ARGUMENT)];
    match executor.execute(path, &args) {
        Ok(mut probe) => {
            probe.parse_build_metadata();
            if !probe.succeeded() {
                tool.failure = Some(DiscoveryFailure::ProbeNonZero {
                    executable: executable_name.to_owned(),
                    path: path.to_path_buf(),
                    exit_code: probe.exit_code,
                    detail: concise_detail(&probe.stderr, &probe.stdout),
                });
            } else if probe.release.is_none() || probe.build_date.is_none() {
                tool.failure = Some(DiscoveryFailure::ProbeMetadataMissing {
                    executable: executable_name.to_owned(),
                    path: path.to_path_buf(),
                });
            }
            tool.probe = Some(probe);
        }
        Err(error) => {
            tool.failure = Some(if error.kind() == io::ErrorKind::TimedOut {
                DiscoveryFailure::ProbeTimedOut {
                    executable: executable_name.to_owned(),
                    path: path.to_path_buf(),
                    timeout: PROBE_TIMEOUT,
                }
            } else {
                DiscoveryFailure::ProbeLaunchFailed {
                    executable: executable_name.to_owned(),
                    path: path.to_path_buf(),
                    detail: error.to_string(),
                }
            });
        }
    }
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
    if msconvert_release == msaccess_release && msconvert_build_date == msaccess_build_date {
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

fn find_label_value(text: &[u8], label: &str) -> Option<String> {
    let text = String::from_utf8_lossy(text);
    text.lines().find_map(|line| {
        let line = line.trim();
        let prefix = line.get(..label.len())?;
        if !prefix.eq_ignore_ascii_case(label) {
            return None;
        }
        let value = line[label.len()..].trim();
        (!value.is_empty()).then(|| value.to_owned())
    })
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

fn push_program_files_roots(roots: &mut Vec<PathBuf>, value: Option<OsString>) {
    let Some(value) = value else {
        return;
    };
    let program_files = PathBuf::from(value);
    push_unique(roots, program_files.join("ProteoWizard"));

    let mut direct_versioned_roots = fs::read_dir(&program_files)
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
    direct_versioned_roots.sort_by(|left, right| {
        right
            .as_os_str()
            .to_string_lossy()
            .to_ascii_lowercase()
            .cmp(&left.as_os_str().to_string_lossy().to_ascii_lowercase())
    });
    for root in direct_versioned_roots {
        push_unique(roots, root);
    }
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
    fn same_release_with_different_build_dates_is_not_an_available_pair() {
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

        assert_eq!(result.availability, AvailabilityState::Partial);
        assert!(matches!(
            result.failure,
            Some(DiscoveryFailure::ProbeIdentityMismatch {
                ref msconvert_release,
                ref msconvert_build_date,
                ref msaccess_release,
                ref msaccess_build_date,
            }) if msconvert_release == "3.0.26013"
                && msconvert_build_date == "Jan 13 2026"
                && msaccess_release == "3.0.26013"
                && msaccess_build_date == "Jan 14 2026"
        ));
    }

    #[test]
    fn reviewed_program_files_roots_cover_nested_and_direct_versioned_layouts_only() {
        let tree = TempTree::new("program-files-layouts");
        fs::create_dir_all(tree.root.join("ProteoWizard"))
            .expect("nested ProteoWizard root should be created");
        fs::create_dir_all(tree.root.join("ProteoWizard 3.0.26013.abcdef"))
            .expect("direct versioned root should be created");
        fs::create_dir_all(tree.root.join("Unrelated Application"))
            .expect("unrelated directory should be created");

        let mut roots = Vec::new();
        push_program_files_roots(&mut roots, Some(tree.root.as_os_str().to_owned()));

        assert!(roots.contains(&tree.root.join("ProteoWizard")));
        assert!(roots.contains(&tree.root.join("ProteoWizard 3.0.26013.abcdef")));
        assert!(!roots.contains(&tree.root.join("Unrelated Application")));
    }
}
