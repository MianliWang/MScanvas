use std::ffi::{OsStr, OsString};
use std::io;
use std::path::{Path, PathBuf};

use thiserror::Error;

use crate::capability::{CapabilityRequirementError, InstalledHelpCapabilities, Sha256Digest};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BackendTool {
    MsConvert,
    MsAccess,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpenFormat {
    MzMl,
    MzXml,
}

impl OpenFormat {
    fn argument(self) -> &'static str {
        match self {
            Self::MzMl => "--mzML",
            Self::MzXml => "--mzXML",
        }
    }

    /// The exact output file extension this format requires.
    #[must_use]
    pub const fn extension(self) -> &'static str {
        match self {
            Self::MzMl => "mzML",
            Self::MzXml => "mzXML",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PreviewOperation {
    Metadata,
    RunSummary,
    SpectrumTable,
    Tic { ms_level: Option<u8> },
    SpectrumByIndex { index: u64, precision: u8 },
}

impl PreviewOperation {
    fn analysis_command(&self) -> String {
        match self {
            Self::Metadata => "metadata".to_owned(),
            Self::RunSummary => "run_summary delimiter=tab".to_owned(),
            Self::SpectrumTable => "spectrum_table delimiter=tab".to_owned(),
            Self::Tic { .. } => "tic delimiter=tab".to_owned(),
            Self::SpectrumByIndex { index, precision } => {
                format!("binary index={index} precision={precision}")
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum OutputSafety {
    None,
    FreshDirectory {
        output_directory: PathBuf,
        source_directory_boundary: Option<PathBuf>,
    },
    AbsentDestination {
        destination: PathBuf,
        source_directory_boundary: Option<PathBuf>,
    },
}

/// A canonical source path bound to the filesystem identity observed for it.
///
/// Comparing a captured identity against the current one is what makes a source
/// replaced between planning and use observable. Capture and comparison stay
/// crate-internal so no caller can construct an identity that was never
/// observed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceIdentity {
    canonical_path: PathBuf,
    is_directory: bool,
    platform: PlatformSourceIdentity,
}

impl SourceIdentity {
    pub(crate) fn capture(path: &Path) -> io::Result<Self> {
        let canonical_path = std::fs::canonicalize(path)?;
        let (platform, is_directory) = platform_source_identity(&canonical_path)?;
        if std::fs::canonicalize(&canonical_path)? != canonical_path {
            return Err(io::Error::other(
                "the source changed during identity inspection",
            ));
        }
        Ok(Self {
            canonical_path,
            is_directory,
            platform,
        })
    }

    pub(crate) fn matches_current(&self) -> io::Result<bool> {
        Ok(Self::capture(&self.canonical_path)? == *self)
    }

    /// The canonical absolute path the identity was captured from.
    #[must_use]
    pub fn canonical_path(&self) -> &Path {
        &self.canonical_path
    }

    const fn is_directory(&self) -> bool {
        self.is_directory
    }
}

#[cfg(windows)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct PlatformSourceIdentity {
    volume_serial_number: u64,
    file_id: [u8; 16],
}

#[cfg(windows)]
fn validated_windows_source_identity(
    volume_serial_number: u64,
    file_id: [u8; 16],
) -> io::Result<PlatformSourceIdentity> {
    if file_id == [0; 16] {
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "the source filesystem does not expose a stable 128-bit file identity",
        ));
    }
    Ok(PlatformSourceIdentity {
        volume_serial_number,
        file_id,
    })
}

#[cfg(windows)]
fn platform_source_identity(path: &Path) -> io::Result<(PlatformSourceIdentity, bool)> {
    use std::ffi::c_void;
    use std::fs::OpenOptions;
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::AsRawHandle;

    const FILE_READ_ATTRIBUTES: u32 = 0x0080;
    const FILE_SHARE_READ: u32 = 0x0000_0001;
    const FILE_SHARE_WRITE: u32 = 0x0000_0002;
    const FILE_SHARE_DELETE: u32 = 0x0000_0004;
    const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x0000_0010;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const FILE_ID_INFO_CLASS: i32 = 0x12;

    #[repr(C)]
    #[derive(Default)]
    struct FileTime {
        low_date_time: u32,
        high_date_time: u32,
    }

    #[repr(C)]
    #[derive(Default)]
    struct ByHandleFileInformation {
        file_attributes: u32,
        creation_time: FileTime,
        last_access_time: FileTime,
        last_write_time: FileTime,
        volume_serial_number: u32,
        file_size_high: u32,
        file_size_low: u32,
        number_of_links: u32,
        file_index_high: u32,
        file_index_low: u32,
    }

    #[repr(C)]
    #[derive(Default)]
    struct FileId128 {
        identifier: [u8; 16],
    }

    #[repr(C)]
    #[derive(Default)]
    struct FileIdInformation {
        volume_serial_number: u64,
        file_id: FileId128,
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        #[link_name = "GetFileInformationByHandle"]
        fn get_file_information_by_handle(
            file: *mut c_void,
            information: *mut ByHandleFileInformation,
        ) -> i32;

        #[link_name = "GetFileInformationByHandleEx"]
        fn get_file_information_by_handle_ex(
            file: *mut c_void,
            information_class: i32,
            information: *mut c_void,
            information_size: u32,
        ) -> i32;
    }

    let file = OpenOptions::new()
        .read(true)
        .access_mode(FILE_READ_ATTRIBUTES)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .open(path)?;
    let mut information = ByHandleFileInformation::default();
    // SAFETY: `file` owns a live handle and `information` is the exact repr(C)
    // buffer required by GetFileInformationByHandle for the duration of the call.
    let inspected =
        unsafe { get_file_information_by_handle(file.as_raw_handle(), &raw mut information) };
    if inspected == 0 {
        return Err(io::Error::last_os_error());
    }

    let mut file_id_information = FileIdInformation::default();
    // SAFETY: `file` owns the same live handle inspected above and
    // `file_id_information` is the exact repr(C) FILE_ID_INFO buffer required
    // by GetFileInformationByHandleEx for the duration of the call.
    let identity_inspected = unsafe {
        get_file_information_by_handle_ex(
            file.as_raw_handle(),
            FILE_ID_INFO_CLASS,
            (&raw mut file_id_information).cast(),
            u32::try_from(std::mem::size_of::<FileIdInformation>())
                .expect("FILE_ID_INFO size fits in DWORD"),
        )
    };
    if identity_inspected == 0 {
        return Err(io::Error::last_os_error());
    }

    let platform = validated_windows_source_identity(
        file_id_information.volume_serial_number,
        file_id_information.file_id.identifier,
    )?;

    Ok((
        platform,
        information.file_attributes & FILE_ATTRIBUTE_DIRECTORY != 0,
    ))
}

#[cfg(unix)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct PlatformSourceIdentity {
    device: u64,
    inode: u64,
}

#[cfg(unix)]
fn platform_source_identity(path: &Path) -> io::Result<(PlatformSourceIdentity, bool)> {
    use std::os::unix::fs::MetadataExt;

    let metadata = std::fs::File::open(path)?.metadata()?;
    Ok((
        PlatformSourceIdentity {
            device: metadata.dev(),
            inode: metadata.ino(),
        },
        metadata.is_dir(),
    ))
}

#[cfg(not(any(windows, unix)))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct PlatformSourceIdentity;

#[cfg(not(any(windows, unix)))]
fn platform_source_identity(_path: &Path) -> io::Result<(PlatformSourceIdentity, bool)> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "the platform does not expose a stable source filesystem identity",
    ))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandSpec {
    pub(crate) tool: BackendTool,
    pub(crate) executable: PathBuf,
    pub(crate) args: Vec<OsString>,
    pub(crate) working_directory: PathBuf,
    pub(crate) executable_sha256: Option<Sha256Digest>,
    pub(crate) source_identity: Option<SourceIdentity>,
    pub(crate) output_safety: OutputSafety,
}

impl CommandSpec {
    pub(crate) fn new(
        tool: BackendTool,
        executable: impl Into<PathBuf>,
        args: impl IntoIterator<Item = impl Into<OsString>>,
        working_directory: impl Into<PathBuf>,
    ) -> Self {
        Self {
            tool,
            executable: executable.into(),
            args: args.into_iter().map(Into::into).collect(),
            working_directory: working_directory.into(),
            executable_sha256: None,
            source_identity: None,
            output_safety: OutputSafety::None,
        }
    }

    pub(crate) fn with_executable_identity(mut self, sha256: Sha256Digest) -> Self {
        self.executable_sha256 = Some(sha256);
        self
    }

    pub(crate) fn with_source_identity(mut self, source_identity: SourceIdentity) -> Self {
        self.source_identity = Some(source_identity);
        self
    }

    pub(crate) fn with_output_destination(
        mut self,
        destination: impl Into<PathBuf>,
        source_directory_boundary: Option<PathBuf>,
    ) -> Self {
        self.output_safety = OutputSafety::AbsentDestination {
            destination: destination.into(),
            source_directory_boundary,
        };
        self
    }

    pub(crate) fn with_fresh_output_directory(
        mut self,
        output_directory: impl Into<PathBuf>,
        source_directory_boundary: Option<PathBuf>,
    ) -> Self {
        self.output_safety = OutputSafety::FreshDirectory {
            output_directory: output_directory.into(),
            source_directory_boundary,
        };
        self
    }

    #[must_use]
    pub const fn tool(&self) -> BackendTool {
        self.tool
    }

    #[must_use]
    pub fn executable(&self) -> &Path {
        &self.executable
    }

    #[must_use]
    pub fn args(&self) -> &[OsString] {
        &self.args
    }

    #[must_use]
    pub fn working_directory(&self) -> &Path {
        &self.working_directory
    }

    #[must_use]
    pub fn output_destination(&self) -> Option<&Path> {
        match &self.output_safety {
            OutputSafety::AbsentDestination { destination, .. } => Some(destination),
            OutputSafety::None | OutputSafety::FreshDirectory { .. } => None,
        }
    }

    #[must_use]
    pub fn fresh_output_directory(&self) -> Option<&Path> {
        match &self.output_safety {
            OutputSafety::FreshDirectory {
                output_directory, ..
            } => Some(output_directory),
            OutputSafety::None | OutputSafety::AbsentDestination { .. } => None,
        }
    }

    #[must_use]
    pub fn source_directory_boundary(&self) -> Option<&Path> {
        match &self.output_safety {
            OutputSafety::FreshDirectory {
                source_directory_boundary,
                ..
            }
            | OutputSafety::AbsentDestination {
                source_directory_boundary,
                ..
            } => source_directory_boundary.as_deref(),
            OutputSafety::None => None,
        }
    }

    #[must_use]
    pub fn contains_argument(&self, argument: impl AsRef<OsStr>) -> bool {
        self.args.iter().any(|value| value == argument.as_ref())
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum PlanError {
    #[error("executable path must be absolute")]
    NonAbsoluteExecutable,
    #[error("input path must be absolute")]
    NonAbsoluteInput,
    #[error("output directory path must be absolute")]
    NonAbsoluteOutputDirectory,
    #[error("input path has no file name")]
    MissingInputName,
    #[error("input path could not be inspected: {kind}")]
    InputPathInspectionFailed { kind: io::ErrorKind },
    #[error("output directory must not be empty")]
    MissingOutputDirectory,
    #[error("output directory could not be inspected: {kind}")]
    OutputDirectoryInspectionFailed { kind: io::ErrorKind },
    #[error("output directory must be empty to prevent implicit overwrite")]
    OutputDirectoryNotEmpty,
    #[error("output directory must not equal or be nested inside a directory input")]
    OutputDirectoryInsideDirectoryInput,
    #[error("output file name must be one safe file name")]
    InvalidOutputFileName,
    #[error("output file extension must match the selected conversion format")]
    OutputFileExtensionMismatch,
    #[error("the requested output destination already exists")]
    OutputDestinationExists,
    #[error("the requested output destination could not be inspected: {kind}")]
    OutputDestinationInspectionFailed { kind: io::ErrorKind },
    #[error("spectrum precision must be between 0 and 15 decimal places")]
    InvalidSpectrumPrecision,
    #[error("MS-level TIC filter must be between 1 and 255")]
    InvalidMsLevelFilter,
    #[error("filtered TIC planning requires exact installed-help capability evidence")]
    FilteredTicCapabilityEvidenceRequired,
    #[error(
        "mzXML conversion is unavailable until source/output integrity validation is implemented"
    )]
    MzXmlIntegrityGateRequired,
    /// The source could not be named in a spelling the reader for its family
    /// accepts without also naming a different object.
    #[error("no verified backend spelling exists for the conversion source")]
    SourceSpellingNotEquivalent,
    #[error(transparent)]
    InstalledHelpCapability(#[from] CapabilityRequirementError),
}

impl PlanError {
    /// A stable structural identifier, so a caller that must not render backend
    /// prose can still say which planning rule refused.
    #[must_use]
    pub const fn stable_id(&self) -> &'static str {
        match self {
            Self::NonAbsoluteExecutable => "non_absolute_executable",
            Self::NonAbsoluteInput => "non_absolute_input",
            Self::NonAbsoluteOutputDirectory => "non_absolute_output_directory",
            Self::MissingInputName => "missing_input_name",
            Self::InputPathInspectionFailed { .. } => "input_path_inspection_failed",
            Self::MissingOutputDirectory => "missing_output_directory",
            Self::OutputDirectoryInspectionFailed { .. } => "output_directory_inspection_failed",
            Self::OutputDirectoryNotEmpty => "output_directory_not_empty",
            Self::OutputDirectoryInsideDirectoryInput => "output_directory_inside_directory_input",
            Self::InvalidOutputFileName => "invalid_output_file_name",
            Self::OutputFileExtensionMismatch => "output_file_extension_mismatch",
            Self::OutputDestinationExists => "output_destination_exists",
            Self::OutputDestinationInspectionFailed { .. } => {
                "output_destination_inspection_failed"
            }
            Self::InvalidSpectrumPrecision => "invalid_spectrum_precision",
            Self::InvalidMsLevelFilter => "invalid_ms_level_filter",
            Self::FilteredTicCapabilityEvidenceRequired => {
                "filtered_tic_capability_evidence_required"
            }
            Self::MzXmlIntegrityGateRequired => "mzxml_integrity_gate_required",
            Self::SourceSpellingNotEquivalent => "source_spelling_not_equivalent",
            Self::InstalledHelpCapability(_) => "installed_help_capability_missing",
        }
    }
}

fn build_msconvert_command(
    executable: impl Into<PathBuf>,
    input: &Path,
    output_directory: &Path,
    output_file_name: &OsStr,
    format: OpenFormat,
    source_directory_boundary: Option<PathBuf>,
) -> Result<CommandSpec, PlanError> {
    let executable = executable.into();
    validate_paths(&executable, input, output_directory)?;
    validate_output_file_name(output_file_name, format)?;

    Ok(CommandSpec::new(
        BackendTool::MsConvert,
        executable,
        [
            input.as_os_str().to_owned(),
            OsString::from(format.argument()),
            OsString::from("--zlib"),
            OsString::from("--outdir"),
            output_directory.as_os_str().to_owned(),
            OsString::from("--outfile"),
            output_file_name.to_owned(),
        ],
        output_directory,
    )
    .with_output_destination(
        output_directory.join(output_file_name),
        source_directory_boundary,
    ))
}

/// Builds an mzML conversion command only after the complete installed help has
/// confirmed every option used by the typed plan and the exact output
/// destination is absent in an inspectable output root outside a directory
/// input. The plan retains the probed executable's SHA-256 and the source
/// filesystem identity for non-atomic pre-spawn rechecks. mzXML remains
/// unavailable until source/output integrity validation is implemented.
pub fn build_msconvert_command_with_capabilities(
    capabilities: &InstalledHelpCapabilities,
    input: &Path,
    output_directory: &Path,
    output_file_name: &OsStr,
    format: OpenFormat,
) -> Result<CommandSpec, PlanError> {
    build_msconvert_command_for_source(
        capabilities,
        input,
        output_directory,
        output_file_name,
        format,
        InputSpelling::Canonical,
    )
}

/// How the source path is spelled in the argv the backend receives.
///
/// The canonical path this crate binds identity to is a Windows extended-length
/// path, and which readers accept one is a measured fact rather than a matter of
/// taste. It is therefore a per-source-family decision, not a global one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputSpelling {
    /// Exactly the canonical path. What every measurement in this repository so
    /// far was recorded against.
    Canonical,
    /// The same object named without the `\\?\` prefix, and only when that
    /// spelling is proved to reach the same object. Required by readers that
    /// cannot open an extended-length path.
    PlainVerified,
}

/// Builds an mzML conversion command with an explicit source-path spelling.
pub fn build_msconvert_command_for_source(
    capabilities: &InstalledHelpCapabilities,
    input: &Path,
    output_directory: &Path,
    output_file_name: &OsStr,
    format: OpenFormat,
    spelling: InputSpelling,
) -> Result<CommandSpec, PlanError> {
    match format {
        OpenFormat::MzMl => {
            capabilities.require_conversion(format)?;
            let executable = capabilities.executable().to_path_buf();
            validate_paths(&executable, input, output_directory)?;
            validate_output_file_name(output_file_name, format)?;
            let safe_output = require_safe_output_directory(input, output_directory)?;
            let canonical_input = backend_input_spelling(&safe_output.source_identity, spelling)?;
            let command = build_msconvert_command(
                executable,
                &canonical_input,
                &safe_output.output_directory,
                output_file_name,
                format,
                safe_output.source_directory_boundary,
            )?;
            require_output_destination_available(
                command
                    .output_destination()
                    .expect("conversion commands have an output destination"),
            )?;
            Ok(command
                .with_executable_identity(capabilities.executable_sha256())
                .with_source_identity(safe_output.source_identity))
        }
        OpenFormat::MzXml => Err(PlanError::MzXmlIntegrityGateRequired),
    }
}

#[cfg(test)]
fn build_msaccess_command(
    executable: impl Into<PathBuf>,
    input: &Path,
    output_directory: &Path,
    operation: PreviewOperation,
) -> Result<CommandSpec, PlanError> {
    if matches!(operation, PreviewOperation::Tic { ms_level: Some(_) }) {
        return Err(PlanError::FilteredTicCapabilityEvidenceRequired);
    }
    build_msaccess_command_inner(executable, input, output_directory, operation)
}

/// Builds an msaccess command only after the complete installed help has
/// confirmed the exact option, query, parameter, and filter grammar used by
/// the typed plan and the output directory is a fresh, inspectable location
/// outside a directory input. The plan retains the probed executable's SHA-256
/// and the source filesystem identity for non-atomic pre-spawn rechecks.
pub fn build_msaccess_command_with_capabilities(
    capabilities: &InstalledHelpCapabilities,
    input: &Path,
    output_directory: &Path,
    operation: PreviewOperation,
) -> Result<CommandSpec, PlanError> {
    if matches!(&operation, PreviewOperation::Tic { ms_level: Some(0) }) {
        return Err(PlanError::InvalidMsLevelFilter);
    }
    capabilities.require_preview_operation(&operation)?;
    let executable = capabilities.executable().to_path_buf();
    validate_msaccess_request(&executable, input, output_directory, &operation)?;
    let safe_output = require_fresh_output_directory(input, output_directory)?;
    let canonical_input = safe_output.source_identity.canonical_path().to_path_buf();
    Ok(build_msaccess_command_spec(
        executable,
        &canonical_input,
        &safe_output.output_directory,
        operation,
    )
    .with_fresh_output_directory(
        &safe_output.output_directory,
        safe_output.source_directory_boundary,
    )
    .with_executable_identity(capabilities.executable_sha256())
    .with_source_identity(safe_output.source_identity))
}

#[cfg(test)]
fn build_msaccess_command_inner(
    executable: impl Into<PathBuf>,
    input: &Path,
    output_directory: &Path,
    operation: PreviewOperation,
) -> Result<CommandSpec, PlanError> {
    let executable = executable.into();
    validate_msaccess_request(&executable, input, output_directory, &operation)?;

    Ok(build_msaccess_command_spec(
        executable,
        input,
        output_directory,
        operation,
    ))
}

fn validate_msaccess_request(
    executable: &Path,
    input: &Path,
    output_directory: &Path,
    operation: &PreviewOperation,
) -> Result<(), PlanError> {
    validate_paths(executable, input, output_directory)?;
    if matches!(
        operation,
        PreviewOperation::SpectrumByIndex { precision, .. } if *precision > 15
    ) {
        return Err(PlanError::InvalidSpectrumPrecision);
    }
    Ok(())
}

fn build_msaccess_command_spec(
    executable: PathBuf,
    input: &Path,
    output_directory: &Path,
    operation: PreviewOperation,
) -> CommandSpec {
    let mut args = vec![
        input.as_os_str().to_owned(),
        OsString::from("--outdir"),
        output_directory.as_os_str().to_owned(),
        OsString::from("--exec"),
        OsString::from(operation.analysis_command()),
    ];
    if let PreviewOperation::Tic {
        ms_level: Some(ms_level),
    } = operation
    {
        args.push(OsString::from("--filter"));
        args.push(OsString::from(format!("msLevel {ms_level}")));
    }

    CommandSpec::new(BackendTool::MsAccess, executable, args, output_directory)
}

/// The Windows extended-length prefix `std::fs::canonicalize` produces.
const VERBATIM_PREFIX: &str = r"\\?\";

/// Decides how the admitted source object is named in the backend's argv.
///
/// A plain spelling is never assumed to reach the same file. It is derived,
/// resolved again, and required to have the identity that was admitted — the
/// same comparison this crate uses everywhere else a name has to be trusted. A
/// spelling that cannot be proved is refused rather than tried, because the
/// consequence of being wrong is a backend reading an object nobody verified.
fn backend_input_spelling(
    admitted: &SourceIdentity,
    spelling: InputSpelling,
) -> Result<PathBuf, PlanError> {
    let canonical = admitted.canonical_path();
    if spelling == InputSpelling::Canonical {
        return Ok(canonical.to_path_buf());
    }

    let Some(plain) = canonical
        .to_str()
        .and_then(|text| text.strip_prefix(VERBATIM_PREFIX))
        .filter(|plain| !plain.starts_with("UNC\\"))
    else {
        // Nothing to strip, or a form this rule does not know how to shorten
        // safely. The canonical spelling is the one that was verified.
        return Ok(canonical.to_path_buf());
    };
    let plain = PathBuf::from(plain);
    let resolved = SourceIdentity::capture(&plain)
        .map_err(|error| PlanError::InputPathInspectionFailed { kind: error.kind() })?;
    if &resolved != admitted {
        return Err(PlanError::SourceSpellingNotEquivalent);
    }
    Ok(plain)
}

fn validate_paths(
    executable: &Path,
    input: &Path,
    output_directory: &Path,
) -> Result<(), PlanError> {
    if !executable.is_absolute() {
        return Err(PlanError::NonAbsoluteExecutable);
    }
    if !input.is_absolute() {
        return Err(PlanError::NonAbsoluteInput);
    }
    if !output_directory.is_absolute() {
        return Err(PlanError::NonAbsoluteOutputDirectory);
    }
    if input.file_name().is_none() {
        return Err(PlanError::MissingInputName);
    }
    if output_directory.as_os_str().is_empty() {
        return Err(PlanError::MissingOutputDirectory);
    }
    Ok(())
}

pub(crate) fn validate_output_file_name(
    output_file_name: &OsStr,
    format: OpenFormat,
) -> Result<(), PlanError> {
    let path = Path::new(output_file_name);
    let mut components = path.components();
    let is_single_normal_component = matches!(
        components.next(),
        Some(std::path::Component::Normal(component)) if component == output_file_name
    ) && components.next().is_none();
    let contains_backend_normalized_character = output_file_name
        .as_encoded_bytes()
        .iter()
        .any(|byte| *byte < 0x20 || *byte == 0x7f || b"\\/*:?<>|\"".contains(byte));
    if !is_single_normal_component || contains_backend_normalized_character {
        return Err(PlanError::InvalidOutputFileName);
    }
    if is_windows_device_name(path) {
        return Err(PlanError::InvalidOutputFileName);
    }
    if !path.extension().is_some_and(|extension| {
        extension
            .as_encoded_bytes()
            .eq_ignore_ascii_case(format.extension().as_bytes())
    }) {
        return Err(PlanError::OutputFileExtensionMismatch);
    }
    Ok(())
}

fn is_windows_device_name(path: &Path) -> bool {
    let Some(stem) = path.file_stem() else {
        return false;
    };
    let first_segment = stem
        .as_encoded_bytes()
        .split(|byte| *byte == b'.')
        .next()
        .unwrap_or_default();
    let trimmed_length = first_segment
        .iter()
        .rposition(|byte| !matches!(*byte, b' ' | b'.'))
        .map_or(0, |index| index + 1);
    let name = &first_segment[..trimmed_length];

    let suffix = name.get(3..).unwrap_or_default();
    let reserved_port = name.len() > 3
        && (name[..3].eq_ignore_ascii_case(b"COM") || name[..3].eq_ignore_ascii_case(b"LPT"))
        && (matches!(suffix, [b'1'..=b'9'])
            || suffix == "¹".as_bytes()
            || suffix == "²".as_bytes()
            || suffix == "³".as_bytes());

    [b"CON".as_slice(), b"PRN", b"AUX", b"NUL"]
        .iter()
        .any(|reserved| name.eq_ignore_ascii_case(reserved))
        || reserved_port
}

fn inspect_output_directory(output_directory: &Path) -> Result<PathBuf, PlanError> {
    let canonical_output = std::fs::canonicalize(output_directory)
        .map_err(|error| PlanError::OutputDirectoryInspectionFailed { kind: error.kind() })?;
    let _entries = std::fs::read_dir(&canonical_output)
        .map_err(|error| PlanError::OutputDirectoryInspectionFailed { kind: error.kind() })?;
    Ok(canonical_output)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SafeOutputDirectory {
    output_directory: PathBuf,
    source_identity: SourceIdentity,
    source_directory_boundary: Option<PathBuf>,
}

fn canonical_input_and_directory_boundary(
    input: &Path,
    canonical_output: &Path,
) -> Result<(SourceIdentity, Option<PathBuf>), PlanError> {
    let source_identity = SourceIdentity::capture(input)
        .map_err(|error| PlanError::InputPathInspectionFailed { kind: error.kind() })?;
    if source_identity.is_directory()
        && canonical_output.starts_with(source_identity.canonical_path())
    {
        return Err(PlanError::OutputDirectoryInsideDirectoryInput);
    }
    let source_directory_boundary = source_identity
        .is_directory()
        .then(|| source_identity.canonical_path().to_path_buf());
    Ok((source_identity, source_directory_boundary))
}

fn require_safe_output_directory(
    input: &Path,
    output_directory: &Path,
) -> Result<SafeOutputDirectory, PlanError> {
    let canonical_output = inspect_output_directory(output_directory)?;
    let (source_identity, source_directory_boundary) =
        canonical_input_and_directory_boundary(input, &canonical_output)?;
    Ok(SafeOutputDirectory {
        output_directory: canonical_output,
        source_identity,
        source_directory_boundary,
    })
}

fn require_fresh_output_directory(
    input: &Path,
    output_directory: &Path,
) -> Result<SafeOutputDirectory, PlanError> {
    let canonical_output = inspect_output_directory(output_directory)?;
    let mut entries = std::fs::read_dir(&canonical_output)
        .map_err(|error| PlanError::OutputDirectoryInspectionFailed { kind: error.kind() })?;
    match entries.next() {
        Some(Ok(_)) => Err(PlanError::OutputDirectoryNotEmpty),
        Some(Err(error)) => Err(PlanError::OutputDirectoryInspectionFailed { kind: error.kind() }),
        None => {
            let (source_identity, source_directory_boundary) =
                canonical_input_and_directory_boundary(input, &canonical_output)?;
            Ok(SafeOutputDirectory {
                output_directory: canonical_output,
                source_identity,
                source_directory_boundary,
            })
        }
    }
}

fn require_output_destination_available(destination: &Path) -> Result<(), PlanError> {
    match std::fs::symlink_metadata(destination) {
        Ok(_) => Err(PlanError::OutputDestinationExists),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(PlanError::OutputDestinationInspectionFailed { kind: error.kind() }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_path(relative: impl AsRef<Path>) -> PathBuf {
        std::env::current_dir()
            .expect("test current directory")
            .join(relative)
    }

    #[cfg(windows)]
    #[test]
    fn an_unsupported_zero_128_bit_source_identity_fails_closed() {
        let error = validated_windows_source_identity(42, [0; 16])
            .expect_err("an unavailable 128-bit file identity must not be accepted");

        assert_eq!(error.kind(), io::ErrorKind::Unsupported);
    }

    #[test]
    fn paths_with_spaces_and_unicode_are_single_argv_values() {
        let executable = test_path("Program Files/ProteoWizard/msconvert.exe");
        let input = test_path("Mass Spec Data/样本 01.raw");
        let output = test_path("Mass Spec Data/converted");
        let command = build_msconvert_command(
            &executable,
            &input,
            &output,
            OsStr::new("样本 01.mzML"),
            OpenFormat::MzMl,
            None,
        )
        .expect("valid command");

        assert_eq!(command.args[0], input.as_os_str());
        assert_eq!(command.args[1], OsString::from("--mzML"));
        assert_eq!(command.args[3], OsString::from("--outdir"));
        assert_eq!(command.args[5], OsString::from("--outfile"));
        assert_eq!(command.args[6], OsString::from("样本 01.mzML"));
        assert_eq!(command.args.len(), 7);
        assert_eq!(
            command.output_destination(),
            Some(output.join("样本 01.mzML").as_path())
        );
    }

    #[test]
    fn mzxml_is_an_explicit_legacy_format_argument() {
        let command = build_msconvert_command(
            test_path("msconvert.exe"),
            &test_path("sample.raw"),
            &test_path("converted"),
            OsStr::new("sample.mzXML"),
            OpenFormat::MzXml,
            None,
        )
        .expect("valid command");

        assert!(command.contains_argument("--mzXML"));
        assert!(!command.contains_argument("--mzML"));
    }

    #[test]
    fn no_additional_centroiding_never_adds_a_peak_picking_filter() {
        let command = build_msconvert_command(
            test_path("msconvert.exe"),
            &test_path("sample.raw"),
            &test_path("converted"),
            OsStr::new("sample.mzML"),
            OpenFormat::MzMl,
            None,
        )
        .expect("valid command");

        assert!(!command.contains_argument("--filter"));
        assert!(
            command
                .args
                .iter()
                .all(|argument| !argument.to_string_lossy().contains("peakPicking"))
        );
    }

    #[test]
    fn filtered_tic_fails_closed_without_installed_help_evidence() {
        let error = build_msaccess_command(
            test_path("msaccess.exe"),
            &test_path("sample.mzML"),
            &test_path("preview"),
            PreviewOperation::Tic { ms_level: Some(2) },
        )
        .expect_err("generic planning cannot establish installed filter grammar");

        assert_eq!(error, PlanError::FilteredTicCapabilityEvidenceRequired);
    }

    #[test]
    fn spectrum_index_and_precision_are_validated_and_typed() {
        let command = build_msaccess_command(
            test_path("msaccess.exe"),
            &test_path("sample.mzML"),
            &test_path("preview"),
            PreviewOperation::SpectrumByIndex {
                index: 7,
                precision: 8,
            },
        )
        .expect("valid command");
        assert_eq!(
            command.args[4],
            OsString::from("binary index=7 precision=8")
        );

        let error = build_msaccess_command(
            test_path("msaccess.exe"),
            &test_path("sample.mzML"),
            &test_path("preview"),
            PreviewOperation::SpectrumByIndex {
                index: 0,
                precision: 16,
            },
        )
        .expect_err("invalid precision");
        assert_eq!(error, PlanError::InvalidSpectrumPrecision);
    }

    #[test]
    fn relative_paths_are_rejected_before_working_directory_changes() {
        let executable = test_path("msconvert.exe");
        let input = test_path("sample.raw");
        let output = test_path("converted");

        assert_eq!(
            build_msconvert_command(
                "msconvert.exe",
                &input,
                &output,
                OsStr::new("sample.mzML"),
                OpenFormat::MzMl,
                None,
            ),
            Err(PlanError::NonAbsoluteExecutable)
        );
        assert_eq!(
            build_msconvert_command(
                &executable,
                Path::new("sample.raw"),
                &output,
                OsStr::new("sample.mzML"),
                OpenFormat::MzMl,
                None,
            ),
            Err(PlanError::NonAbsoluteInput)
        );
        assert_eq!(
            build_msconvert_command(
                &executable,
                &input,
                Path::new("converted"),
                OsStr::new("sample.mzML"),
                OpenFormat::MzMl,
                None,
            ),
            Err(PlanError::NonAbsoluteOutputDirectory)
        );
    }
}
