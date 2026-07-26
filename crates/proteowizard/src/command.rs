use std::ffi::{OsStr, OsString};
use std::io;
use std::path::{Path, PathBuf};

use thiserror::Error;

use crate::capability::{CapabilityRequirementError, InstalledHelpCapabilities};

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

    const fn extension(self) -> &'static str {
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
    FreshDirectory(PathBuf),
    AbsentDestination(PathBuf),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandSpec {
    pub(crate) tool: BackendTool,
    pub(crate) executable: PathBuf,
    pub(crate) args: Vec<OsString>,
    pub(crate) working_directory: PathBuf,
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
            output_safety: OutputSafety::None,
        }
    }

    pub(crate) fn with_output_destination(mut self, destination: impl Into<PathBuf>) -> Self {
        self.output_safety = OutputSafety::AbsentDestination(destination.into());
        self
    }

    pub(crate) fn with_fresh_output_directory(
        mut self,
        output_directory: impl Into<PathBuf>,
    ) -> Self {
        self.output_safety = OutputSafety::FreshDirectory(output_directory.into());
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
            OutputSafety::AbsentDestination(destination) => Some(destination),
            OutputSafety::None | OutputSafety::FreshDirectory(_) => None,
        }
    }

    #[must_use]
    pub fn fresh_output_directory(&self) -> Option<&Path> {
        match &self.output_safety {
            OutputSafety::FreshDirectory(output_directory) => Some(output_directory),
            OutputSafety::None | OutputSafety::AbsentDestination(_) => None,
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
    #[error(transparent)]
    InstalledHelpCapability(#[from] CapabilityRequirementError),
}

fn build_msconvert_command(
    executable: impl Into<PathBuf>,
    input: &Path,
    output_directory: &Path,
    output_file_name: &OsStr,
    format: OpenFormat,
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
    .with_output_destination(output_directory.join(output_file_name)))
}

/// Builds an mzML conversion command only after the complete installed help has
/// confirmed every option used by the typed plan and the exact output
/// destination is absent in an inspectable output root outside a directory
/// input. mzXML remains unavailable until source/output integrity validation is
/// implemented.
pub fn build_msconvert_command_with_capabilities(
    capabilities: &InstalledHelpCapabilities,
    executable: impl Into<PathBuf>,
    input: &Path,
    output_directory: &Path,
    output_file_name: &OsStr,
    format: OpenFormat,
) -> Result<CommandSpec, PlanError> {
    match format {
        OpenFormat::MzMl => {
            capabilities.require_conversion(format)?;
            let executable = executable.into();
            validate_paths(&executable, input, output_directory)?;
            validate_output_file_name(output_file_name, format)?;
            let canonical_output = require_safe_output_directory(input, output_directory)?;
            let command = build_msconvert_command(
                executable,
                input,
                &canonical_output,
                output_file_name,
                format,
            )?;
            require_output_destination_available(
                command
                    .output_destination()
                    .expect("conversion commands have an output destination"),
            )?;
            Ok(command)
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
/// outside a directory input.
pub fn build_msaccess_command_with_capabilities(
    capabilities: &InstalledHelpCapabilities,
    executable: impl Into<PathBuf>,
    input: &Path,
    output_directory: &Path,
    operation: PreviewOperation,
) -> Result<CommandSpec, PlanError> {
    if matches!(&operation, PreviewOperation::Tic { ms_level: Some(0) }) {
        return Err(PlanError::InvalidMsLevelFilter);
    }
    capabilities.require_preview_operation(&operation)?;
    let executable = executable.into();
    validate_msaccess_request(&executable, input, output_directory, &operation)?;
    let canonical_output = require_fresh_output_directory(input, output_directory)?;
    Ok(
        build_msaccess_command_spec(executable, input, &canonical_output, operation)
            .with_fresh_output_directory(canonical_output),
    )
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

fn validate_output_file_name(
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

fn reject_output_inside_directory_input(
    input: &Path,
    canonical_output: &Path,
) -> Result<(), PlanError> {
    let canonical_input = std::fs::canonicalize(input)
        .map_err(|error| PlanError::InputPathInspectionFailed { kind: error.kind() })?;
    let input_metadata = std::fs::metadata(&canonical_input)
        .map_err(|error| PlanError::InputPathInspectionFailed { kind: error.kind() })?;
    if input_metadata.is_dir() && canonical_output.starts_with(&canonical_input) {
        return Err(PlanError::OutputDirectoryInsideDirectoryInput);
    }
    Ok(())
}

fn require_safe_output_directory(
    input: &Path,
    output_directory: &Path,
) -> Result<PathBuf, PlanError> {
    let canonical_output = inspect_output_directory(output_directory)?;
    reject_output_inside_directory_input(input, &canonical_output)?;
    Ok(canonical_output)
}

fn require_fresh_output_directory(
    input: &Path,
    output_directory: &Path,
) -> Result<PathBuf, PlanError> {
    let canonical_output = inspect_output_directory(output_directory)?;
    let mut entries = std::fs::read_dir(&canonical_output)
        .map_err(|error| PlanError::OutputDirectoryInspectionFailed { kind: error.kind() })?;
    match entries.next() {
        Some(Ok(_)) => Err(PlanError::OutputDirectoryNotEmpty),
        Some(Err(error)) => Err(PlanError::OutputDirectoryInspectionFailed { kind: error.kind() }),
        None => {
            reject_output_inside_directory_input(input, &canonical_output)?;
            Ok(canonical_output)
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
            ),
            Err(PlanError::NonAbsoluteExecutable)
        );
        assert_eq!(
            build_msconvert_command(
                &executable,
                Path::new("sample.raw"),
                &output,
                OsStr::new("sample.mzML"),
                OpenFormat::MzMl
            ),
            Err(PlanError::NonAbsoluteInput)
        );
        assert_eq!(
            build_msconvert_command(
                &executable,
                &input,
                Path::new("converted"),
                OsStr::new("sample.mzML"),
                OpenFormat::MzMl
            ),
            Err(PlanError::NonAbsoluteOutputDirectory)
        );
    }
}
