//! Unstable, developer-only M0 ProteoWizard spike harness.
//!
//! This example is intentionally not a stable MSCanvas CLI contract.

use std::collections::BTreeMap;
use std::env;
use std::ffi::{OsStr, OsString};
use std::fs;
#[cfg(windows)]
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::mpsc::{self, Sender};
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime};

use mscanvas_proteowizard::{
    AvailabilityState, BackendTool, CancellationToken, CapturedHelpStream, CompleteHelpCapture,
    ConfiguredLocation, DiscoveredTool, DiscoveryRequest, FailureCondition,
    InstalledHelpCapabilities, OpenFormat, PreviewOperation, Redactor, ReportableProcessOutput,
    Retryability, Sha256Digest, build_msaccess_command_with_capabilities,
    build_msconvert_command_with_capabilities, classify_process_failure, discover,
    execute_cancellable,
};

const DIAGNOSTIC_PREVIEW_CHARS: usize = 4_096;
const SCIENTIFIC_STDOUT_PAYLOAD_MAX_BYTES: usize = 256 * 1_024;
const SCIENTIFIC_STDOUT_BASE64_CHUNK_CHARS: usize = 256;
const SPECTRUM_PRECISION: u8 = 8;

fn main() -> ExitCode {
    match parse_args(env::args_os().skip(1)).and_then(run) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) if error.exit_code == 0 => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("error: {}", error.message);
            ExitCode::from(error.exit_code)
        }
    }
}

#[derive(Debug)]
struct HarnessError {
    message: String,
    exit_code: u8,
}

impl HarnessError {
    fn usage(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            exit_code: 2,
        }
    }

    fn operation(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            exit_code: 1,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Mode {
    RuntimeProof,
    Probe,
    Metadata,
    RunSummary,
    SpectrumTable,
    Tic,
    Spectrum,
    Convert,
}

impl Mode {
    fn parse(value: &OsStr) -> Result<Self, HarnessError> {
        match value.to_str() {
            Some("runtime-proof") => Ok(Self::RuntimeProof),
            Some("probe") => Ok(Self::Probe),
            Some("metadata") => Ok(Self::Metadata),
            Some("run-summary") => Ok(Self::RunSummary),
            Some("spectrum-table") => Ok(Self::SpectrumTable),
            Some("tic") => Ok(Self::Tic),
            Some("spectrum") => Ok(Self::Spectrum),
            Some("convert") => Ok(Self::Convert),
            _ => Err(HarnessError::usage(
                "--mode must be runtime-proof, probe, metadata, run-summary, spectrum-table, tic, spectrum, or convert",
            )),
        }
    }

    const fn label(self) -> &'static str {
        match self {
            Self::RuntimeProof => "runtime-proof",
            Self::Probe => "probe",
            Self::Metadata => "metadata",
            Self::RunSummary => "run-summary",
            Self::SpectrumTable => "spectrum-table",
            Self::Tic => "tic",
            Self::Spectrum => "spectrum",
            Self::Convert => "convert",
        }
    }
}

#[derive(Debug)]
struct Cli {
    mode: Mode,
    runtime_root: Option<PathBuf>,
    proteowizard_home: Option<PathBuf>,
    proteowizard_executable: Option<PathBuf>,
    input: Option<PathBuf>,
    output_dir: Option<PathBuf>,
    spectrum_index: Option<u64>,
    ms_level: Option<u8>,
    format: Option<OpenFormat>,
    cancel_after_ms: Option<u64>,
}

#[derive(Default)]
struct RawArgs {
    mode: Option<Mode>,
    runtime_root: Option<PathBuf>,
    proteowizard_home: Option<PathBuf>,
    proteowizard_executable: Option<PathBuf>,
    input: Option<PathBuf>,
    output_dir: Option<PathBuf>,
    spectrum_index: Option<u64>,
    ms_level: Option<u8>,
    format: Option<OpenFormat>,
    cancel_after_ms: Option<u64>,
    help: bool,
    option_count: usize,
}

fn parse_args(args: impl IntoIterator<Item = OsString>) -> Result<Cli, HarnessError> {
    let mut args = args.into_iter();
    let mut raw = RawArgs::default();

    while let Some(option) = args.next() {
        let Some(option) = option.to_str() else {
            return Err(HarnessError::usage("option names must be valid Unicode"));
        };
        raw.option_count += 1;
        match option {
            "--help" => {
                if raw.help {
                    return Err(HarnessError::usage("duplicate option: --help"));
                }
                raw.help = true;
            }
            "--mode" => {
                let value = take_value(&mut args, option)?;
                set_once(&mut raw.mode, Mode::parse(&value)?, option)?;
            }
            "--runtime-root" => {
                let value = PathBuf::from(take_value(&mut args, option)?);
                set_once(&mut raw.runtime_root, value, option)?;
            }
            "--proteowizard-home" => {
                let value = PathBuf::from(take_value(&mut args, option)?);
                set_once(&mut raw.proteowizard_home, value, option)?;
            }
            "--proteowizard-executable" => {
                let value = PathBuf::from(take_value(&mut args, option)?);
                set_once(&mut raw.proteowizard_executable, value, option)?;
            }
            "--input" => {
                let value = PathBuf::from(take_value(&mut args, option)?);
                set_once(&mut raw.input, value, option)?;
            }
            "--output-dir" => {
                let value = PathBuf::from(take_value(&mut args, option)?);
                set_once(&mut raw.output_dir, value, option)?;
            }
            "--spectrum-index" => {
                let value = parse_u64(&take_value(&mut args, option)?, option)?;
                set_once(&mut raw.spectrum_index, value, option)?;
            }
            "--ms-level" => {
                let value = parse_nonzero_u8(&take_value(&mut args, option)?, option)?;
                set_once(&mut raw.ms_level, value, option)?;
            }
            "--format" => {
                let value = parse_format(&take_value(&mut args, option)?)?;
                set_once(&mut raw.format, value, option)?;
            }
            "--cancel-after-ms" => {
                let value = parse_u64(&take_value(&mut args, option)?, option)?;
                set_once(&mut raw.cancel_after_ms, value, option)?;
            }
            _ => return Err(HarnessError::usage("unknown option")),
        }
    }

    if raw.help {
        if raw.option_count != 1 {
            return Err(HarnessError::usage(
                "--help cannot be combined with other options",
            ));
        }
        print_usage();
        return Err(HarnessError {
            message: "help requested".to_owned(),
            exit_code: 0,
        });
    }

    if raw.proteowizard_home.is_some() && raw.proteowizard_executable.is_some() {
        return Err(HarnessError::usage(
            "choose only one of --proteowizard-home and --proteowizard-executable",
        ));
    }

    let mode = raw
        .mode
        .ok_or_else(|| HarnessError::usage("missing required option: --mode"))?;
    let cli = Cli {
        mode,
        runtime_root: raw.runtime_root,
        proteowizard_home: raw.proteowizard_home,
        proteowizard_executable: raw.proteowizard_executable,
        input: raw.input,
        output_dir: raw.output_dir,
        spectrum_index: raw.spectrum_index,
        ms_level: raw.ms_level,
        format: raw.format,
        cancel_after_ms: raw.cancel_after_ms,
    };
    validate_mode_arguments(cli)
}

fn take_value(
    args: &mut impl Iterator<Item = OsString>,
    option: &str,
) -> Result<OsString, HarnessError> {
    let value = args
        .next()
        .ok_or_else(|| HarnessError::usage(format!("missing value for {option}")))?;
    if value
        .to_str()
        .is_some_and(|candidate| candidate.starts_with("--"))
    {
        return Err(HarnessError::usage(format!("missing value for {option}")));
    }
    Ok(value)
}

fn set_once<T>(slot: &mut Option<T>, value: T, option: &str) -> Result<(), HarnessError> {
    if slot.is_some() {
        return Err(HarnessError::usage(format!("duplicate option: {option}")));
    }
    *slot = Some(value);
    Ok(())
}

fn parse_u64(value: &OsStr, option: &str) -> Result<u64, HarnessError> {
    value
        .to_str()
        .and_then(|value| value.parse().ok())
        .ok_or_else(|| HarnessError::usage(format!("{option} must be an unsigned integer")))
}

fn parse_nonzero_u8(value: &OsStr, option: &str) -> Result<u8, HarnessError> {
    value
        .to_str()
        .and_then(|value| value.parse::<u8>().ok())
        .filter(|value| *value > 0)
        .ok_or_else(|| HarnessError::usage(format!("{option} must be an integer from 1 to 255")))
}

fn parse_format(value: &OsStr) -> Result<OpenFormat, HarnessError> {
    match value.to_str() {
        Some("mzML") => Ok(OpenFormat::MzMl),
        Some("mzXML") => Ok(OpenFormat::MzXml),
        _ => Err(HarnessError::usage("--format must be mzML or mzXML")),
    }
}

fn validate_mode_arguments(mut cli: Cli) -> Result<Cli, HarnessError> {
    match cli.mode {
        Mode::RuntimeProof => {
            require_present(&cli.runtime_root, "--runtime-root", "runtime-proof")?;
            require_present(
                &cli.proteowizard_home,
                "--proteowizard-home",
                "runtime-proof",
            )?;
            reject_present(
                &cli.proteowizard_executable,
                "--proteowizard-executable",
                "runtime-proof",
            )?;
            reject_present(&cli.input, "--input", "runtime-proof")?;
            reject_present(&cli.output_dir, "--output-dir", "runtime-proof")?;
            reject_present(&cli.spectrum_index, "--spectrum-index", "runtime-proof")?;
            reject_present(&cli.ms_level, "--ms-level", "runtime-proof")?;
            reject_present(&cli.format, "--format", "runtime-proof")?;
            reject_present(&cli.cancel_after_ms, "--cancel-after-ms", "runtime-proof")?;
        }
        Mode::Probe => {
            reject_present(&cli.runtime_root, "--runtime-root", "probe")?;
            reject_present(&cli.input, "--input", "probe")?;
            reject_present(&cli.output_dir, "--output-dir", "probe")?;
            reject_present(&cli.spectrum_index, "--spectrum-index", "probe")?;
            reject_present(&cli.ms_level, "--ms-level", "probe")?;
            reject_present(&cli.format, "--format", "probe")?;
            reject_present(&cli.cancel_after_ms, "--cancel-after-ms", "probe")?;
        }
        Mode::Metadata | Mode::RunSummary | Mode::SpectrumTable => {
            reject_present(&cli.runtime_root, "--runtime-root", cli.mode.label())?;
            require_present(&cli.input, "--input", cli.mode.label())?;
            require_present(&cli.output_dir, "--output-dir", cli.mode.label())?;
            reject_present(&cli.spectrum_index, "--spectrum-index", cli.mode.label())?;
            reject_present(&cli.ms_level, "--ms-level", cli.mode.label())?;
            reject_present(&cli.format, "--format", cli.mode.label())?;
        }
        Mode::Tic => {
            reject_present(&cli.runtime_root, "--runtime-root", "tic")?;
            require_present(&cli.input, "--input", "tic")?;
            require_present(&cli.output_dir, "--output-dir", "tic")?;
            reject_present(&cli.spectrum_index, "--spectrum-index", "tic")?;
            reject_present(&cli.format, "--format", "tic")?;
        }
        Mode::Spectrum => {
            reject_present(&cli.runtime_root, "--runtime-root", "spectrum")?;
            require_present(&cli.input, "--input", "spectrum")?;
            require_present(&cli.output_dir, "--output-dir", "spectrum")?;
            require_present(&cli.spectrum_index, "--spectrum-index", "spectrum")?;
            reject_present(&cli.ms_level, "--ms-level", "spectrum")?;
            reject_present(&cli.format, "--format", "spectrum")?;
        }
        Mode::Convert => {
            reject_present(&cli.runtime_root, "--runtime-root", "convert")?;
            require_present(&cli.input, "--input", "convert")?;
            require_present(&cli.output_dir, "--output-dir", "convert")?;
            require_present(&cli.format, "--format", "convert")?;
            reject_present(&cli.spectrum_index, "--spectrum-index", "convert")?;
            reject_present(&cli.ms_level, "--ms-level", "convert")?;
        }
    }

    if let Some(runtime_root) = cli.runtime_root.take() {
        if !runtime_root.is_absolute() || !runtime_root.is_dir() {
            return Err(HarnessError::usage(
                "the runtime root must be an existing absolute directory",
            ));
        }
        cli.runtime_root = Some(canonicalize_cli_path(&runtime_root, "runtime root")?);
    }

    if let Some(home) = cli.proteowizard_home.take() {
        if !home.is_dir() {
            return Err(HarnessError::usage(
                "the explicit ProteoWizard home does not exist or is not a directory",
            ));
        }
        cli.proteowizard_home = Some(canonicalize_cli_path(&home, "ProteoWizard home")?);
    }
    if let Some(executable) = cli.proteowizard_executable.take() {
        if !executable.is_file() {
            return Err(HarnessError::usage(
                "the explicit ProteoWizard executable does not exist or is not a file",
            ));
        }
        cli.proteowizard_executable = Some(canonicalize_cli_path(
            &executable,
            "ProteoWizard executable",
        )?);
    }
    if let Some(input) = cli.input.take() {
        if !input.exists() {
            return Err(HarnessError::usage("the explicit input does not exist"));
        }
        cli.input = Some(canonicalize_cli_path(&input, "input")?);
    }
    if let Some(output_dir) = cli.output_dir.take() {
        if !output_dir.is_dir() {
            return Err(HarnessError::usage(
                "the explicit output directory does not exist or is not a directory",
            ));
        }
        cli.output_dir = Some(canonicalize_cli_path(&output_dir, "output directory")?);
    }
    if let (Some(input), Some(output_dir)) = (cli.input.as_deref(), cli.output_dir.as_deref()) {
        reject_output_inside_directory_input(input, output_dir, input.is_dir())?;
    }

    Ok(cli)
}

fn canonicalize_cli_path(path: &Path, label: &str) -> Result<PathBuf, HarnessError> {
    fs::canonicalize(path).map_err(|_| {
        HarnessError::usage(format!(
            "the explicit {label} could not be resolved to an absolute path"
        ))
    })
}

fn reject_output_inside_directory_input(
    input: &Path,
    output_dir: &Path,
    input_is_directory: bool,
) -> Result<(), HarnessError> {
    if input_is_directory && (output_dir == input || output_dir.starts_with(input)) {
        Err(HarnessError::usage(
            "the output directory must not equal or be nested inside a directory-formatted input acquisition",
        ))
    } else {
        Ok(())
    }
}

fn require_present<T>(value: &Option<T>, option: &str, mode: &str) -> Result<(), HarnessError> {
    if value.is_none() {
        return Err(HarnessError::usage(format!(
            "{option} is required for {mode} mode"
        )));
    }
    Ok(())
}

fn reject_present<T>(value: &Option<T>, option: &str, mode: &str) -> Result<(), HarnessError> {
    if value.is_some() {
        return Err(HarnessError::usage(format!(
            "{option} is not valid for {mode} mode"
        )));
    }
    Ok(())
}

fn run(cli: Cli) -> Result<(), HarnessError> {
    if cli.mode == Mode::RuntimeProof {
        return run_runtime_proof(&cli);
    }

    println!("warning=unstable developer-only M0 spike harness; no stable CLI contract");
    println!("mode={}", cli.mode.label());

    let request = discovery_request(&cli);
    let discovery = discover(&request);
    let mut redactor = build_redactor(&cli, &request, &discovery);
    print_discovery(&discovery, &redactor);

    if discovery.availability != AvailabilityState::Available {
        return Err(HarnessError::operation(
            "ProteoWizard discovery did not produce one verified matching tool pair",
        ));
    }
    if cli.mode == Mode::Probe {
        return Ok(());
    }
    let capabilities = validate_installed_command_surface(&cli, &discovery)?;

    let input = cli
        .input
        .as_deref()
        .ok_or_else(|| HarnessError::operation("validated input is unavailable"))?;
    let output_dir = cli
        .output_dir
        .as_deref()
        .ok_or_else(|| HarnessError::operation("validated output directory is unavailable"))?;
    let (tool, command) = build_command(&cli, &discovery, &capabilities, input, output_dir)?;
    print_command(&command, &redactor);

    let before = snapshot_directory(output_dir)?;
    require_fresh_output_directory(&before)?;
    let cancellation = CancellationToken::new();
    let scheduled = schedule_cancellation(&cancellation, cli.cancel_after_ms);
    let process_result = execute_cancellable(&command, &cancellation);
    finish_cancellation(scheduled)?;
    let after = snapshot_directory(output_dir)?;

    match process_result {
        Ok(output) => {
            let output_changed = before != after;
            let conversion_validation = if output.success() && cli.mode == Mode::Convert {
                Some(validate_conversion_output(
                    &after,
                    cli.format.ok_or_else(|| {
                        HarnessError::operation("validated conversion format is unavailable")
                    })?,
                    output_dir,
                    input,
                ))
            } else {
                None
            };
            if let Some(Ok(candidate)) = &conversion_validation {
                redactor.add_path(&candidate.path, "<conversion-output>");
            }
            let partial_output_present = (!output.success() && output_changed)
                || conversion_validation.as_ref().is_some_and(|validation| {
                    matches!(validation, Err(ConversionOutputIssue::Partial))
                });
            print_process_output(&output, output_changed, partial_output_present, &redactor)?;
            if let Some(validation) = conversion_validation {
                match validation {
                    Ok(candidate) => {
                        println!("conversion_output.filesystem_validation=candidate_valid");
                        println!("conversion_output.path=<conversion-output>");
                        println!("conversion_output.bytes={}", candidate.length);
                        println!(
                            "conversion_output.source_basename_preserved={}",
                            candidate.source_basename_preserved
                        );
                        let sha256 =
                            Sha256Digest::calculate_file(&candidate.path).map_err(|error| {
                                println!("conversion_output.hash_validation=failed");
                                HarnessError::operation(format!(
                                    "the conversion output could not be hashed: {error}"
                                ))
                            })?;
                        println!("conversion_output.sha256={sha256}");
                        println!(
                            "conversion_output.xml_validation=deferred_to_evidence_orchestrator"
                        );
                    }
                    Err(issue) => {
                        println!(
                            "conversion_output.filesystem_validation={}",
                            issue.stable_id()
                        );
                        return Err(HarnessError::operation(issue.message()));
                    }
                }
            }
            if let Some(failure) =
                classify_process_failure(tool, Ok(&output), partial_output_present)
            {
                print_normalized_failure(&failure, &redactor);
                return Err(HarnessError::operation(
                    "the backend operation did not complete successfully",
                ));
            }
            Ok(())
        }
        Err(error) => {
            let partial_output_present = before != after;
            println!(
                "process.launch_error={}",
                redactor.redact(&error.to_string())
            );
            if let Some(failure) =
                classify_process_failure(tool, Err(&error), partial_output_present)
            {
                print_normalized_failure(&failure, &redactor);
            }
            Err(HarnessError::operation(
                "the backend process could not be supervised",
            ))
        }
    }
}

const REQUIRED_RUNTIME_ENVIRONMENT: [&str; 5] = ["SYSTEMROOT", "WINDIR", "TEMP", "TMP", "PATH"];
const OPTIONAL_RUNTIME_ENVIRONMENT: [&str; 2] = ["HOMEDRIVE", "HOMEPATH"];

fn collect_reviewed_runtime_environment(
    entries: impl IntoIterator<Item = (OsString, OsString)>,
) -> Result<BTreeMap<String, OsString>, HarnessError> {
    let mut environment = BTreeMap::new();

    for (key, value) in entries {
        let Some(key) = key.to_str() else {
            return Err(HarnessError::operation(
                "runtime environment key validation failed",
            ));
        };
        let key = key.to_ascii_uppercase();
        if is_sensitive_runtime_environment_key(&key) {
            return Err(HarnessError::operation(
                "sensitive runtime environment state was present",
            ));
        }
        if !REQUIRED_RUNTIME_ENVIRONMENT.contains(&key.as_str())
            && !OPTIONAL_RUNTIME_ENVIRONMENT.contains(&key.as_str())
        {
            return Err(HarnessError::operation(
                "runtime environment allowlist validation failed",
            ));
        }
        if environment.insert(key, value).is_some() {
            return Err(HarnessError::operation(
                "runtime environment key validation failed",
            ));
        }
    }

    if REQUIRED_RUNTIME_ENVIRONMENT
        .iter()
        .any(|key| !environment.contains_key(*key))
    {
        return Err(HarnessError::operation(
            "required runtime environment state was absent",
        ));
    }

    let has_home_drive = environment.contains_key("HOMEDRIVE");
    let has_home_path = environment.contains_key("HOMEPATH");
    if has_home_drive != has_home_path {
        return Err(HarnessError::operation(
            "optional runtime home environment state was incomplete",
        ));
    }

    Ok(environment)
}

fn is_sensitive_runtime_environment_key(key: &str) -> bool {
    key.starts_with("GITHUB_")
        || key.starts_with("ACTIONS_")
        || key.contains("TOKEN")
        || key.contains("CREDENTIAL")
        || key.contains("PROFILE")
        || matches!(
            key,
            "HOME" | "HOMESHARE" | "APPDATA" | "LOCALAPPDATA" | "PASSWORD" | "SECRET"
        )
}

#[cfg(windows)]
#[derive(Debug, Clone, PartialEq, Eq)]
struct RuntimeLayout {
    root: PathBuf,
    tools: PathBuf,
    harness: PathBuf,
    fixture: PathBuf,
    output: PathBuf,
    evidence: PathBuf,
    temp: PathBuf,
}

#[cfg(windows)]
impl RuntimeLayout {
    fn from_root(root: &Path) -> Result<Self, HarnessError> {
        let root_metadata = fs::symlink_metadata(root)
            .map_err(|_| HarnessError::operation("runtime directory layout validation failed"))?;
        if !root_metadata.is_dir()
            || root_metadata.file_type().is_symlink()
            || is_reparse_point(&root_metadata)
        {
            return Err(HarnessError::operation(
                "runtime directory layout validation failed",
            ));
        }

        Ok(Self {
            root: root.to_path_buf(),
            tools: validate_fixed_runtime_directory(root, "tools")?,
            harness: validate_fixed_runtime_directory(root, "harness")?,
            fixture: validate_fixed_runtime_directory(root, "fixture")?,
            output: validate_fixed_runtime_directory(root, "output")?,
            evidence: validate_fixed_runtime_directory(root, "evidence")?,
            temp: validate_fixed_runtime_directory(root, "temp")?,
        })
    }
}

#[cfg(windows)]
fn validate_fixed_runtime_directory(root: &Path, name: &str) -> Result<PathBuf, HarnessError> {
    let expected = root.join(name);
    let metadata = fs::symlink_metadata(&expected)
        .map_err(|_| HarnessError::operation("runtime directory layout validation failed"))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err(HarnessError::operation(
            "runtime directory layout validation failed",
        ));
    }

    let canonical = fs::canonicalize(&expected)
        .map_err(|_| HarnessError::operation("runtime directory layout validation failed"))?;
    if !windows_paths_equal(&canonical, &expected) {
        return Err(HarnessError::operation(
            "runtime directory containment validation failed",
        ));
    }
    Ok(canonical)
}

#[cfg(windows)]
fn run_runtime_proof(cli: &Cli) -> Result<(), HarnessError> {
    let runtime_root = cli
        .runtime_root
        .as_deref()
        .ok_or_else(|| HarnessError::operation("validated runtime root state was unavailable"))?;
    let layout = RuntimeLayout::from_root(runtime_root)?;
    let portable_root = cli.proteowizard_home.as_deref().ok_or_else(|| {
        HarnessError::operation("validated portable backend root state was unavailable")
    })?;
    validate_runtime_portable_root(&layout, portable_root)?;
    validate_runtime_environment(env::vars_os(), &layout, portable_root)?;
    prove_runtime_directory_access(&layout)?;
    print_runtime_proof_success();
    Ok(())
}

#[cfg(not(windows))]
fn run_runtime_proof(_cli: &Cli) -> Result<(), HarnessError> {
    Err(HarnessError::operation(
        "runtime-proof mode is supported only on Windows",
    ))
}

#[cfg(windows)]
fn validate_runtime_environment(
    entries: impl IntoIterator<Item = (OsString, OsString)>,
    layout: &RuntimeLayout,
    portable_root: &Path,
) -> Result<(), HarnessError> {
    let environment = collect_reviewed_runtime_environment(entries)?;
    let system_root = canonical_environment_directory(
        environment
            .get("SYSTEMROOT")
            .expect("required environment was checked"),
    )?;
    let windir = canonical_environment_directory(
        environment
            .get("WINDIR")
            .expect("required environment was checked"),
    )?;
    if !windows_paths_equal(&system_root, &windir) {
        return Err(HarnessError::operation(
            "Windows root environment validation failed",
        ));
    }

    let temp = canonical_environment_directory(
        environment
            .get("TEMP")
            .expect("required environment was checked"),
    )?;
    let tmp = canonical_environment_directory(
        environment
            .get("TMP")
            .expect("required environment was checked"),
    )?;
    if !windows_paths_equal(&temp, &layout.temp) || !windows_paths_equal(&tmp, &layout.temp) {
        return Err(HarnessError::operation(
            "runtime temporary-directory environment validation failed",
        ));
    }

    let system32 = fs::canonicalize(system_root.join("System32"))
        .map_err(|_| HarnessError::operation("runtime PATH validation failed"))?;
    validate_runtime_path(
        environment
            .get("PATH")
            .expect("required environment was checked"),
        portable_root,
        &system32,
        &system_root,
    )
}

#[cfg(windows)]
fn validate_runtime_portable_root(
    layout: &RuntimeLayout,
    portable_root: &Path,
) -> Result<(), HarnessError> {
    let tools = layout
        .tools
        .to_string_lossy()
        .trim_end_matches(['\\', '/'])
        .to_owned();
    let portable = portable_root.to_string_lossy();
    let contained = portable.eq_ignore_ascii_case(&tools)
        || portable.get(tools.len()..).is_some_and(|suffix| {
            portable[..tools.len()].eq_ignore_ascii_case(&tools) && suffix.starts_with(['\\', '/'])
        });
    if !contained {
        return Err(HarnessError::operation(
            "portable backend root containment validation failed",
        ));
    }
    let metadata = fs::symlink_metadata(portable_root)
        .map_err(|_| HarnessError::operation("portable backend root validation failed"))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        return Err(HarnessError::operation(
            "portable backend root validation failed",
        ));
    }
    for executable in ["msconvert.exe", "msaccess.exe"] {
        let path = portable_root.join(executable);
        let metadata = fs::symlink_metadata(path)
            .map_err(|_| HarnessError::operation("portable backend root validation failed"))?;
        if !metadata.is_file() || metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
            return Err(HarnessError::operation(
                "portable backend root validation failed",
            ));
        }
    }
    Ok(())
}

#[cfg(windows)]
fn canonical_environment_directory(value: &OsStr) -> Result<PathBuf, HarnessError> {
    let path = Path::new(value);
    if !path.is_absolute() || !path.is_dir() {
        return Err(HarnessError::operation(
            "runtime environment path validation failed",
        ));
    }
    fs::canonicalize(path)
        .map_err(|_| HarnessError::operation("runtime environment path validation failed"))
}

#[cfg(windows)]
fn validate_runtime_path(
    value: &OsStr,
    tools: &Path,
    system32: &Path,
    windows_root: &Path,
) -> Result<(), HarnessError> {
    let mut tools_seen = false;
    let mut system32_seen = false;
    let mut windows_root_seen = false;
    let mut entry_count = 0_usize;

    for entry in env::split_paths(value) {
        entry_count += 1;
        let canonical = canonical_environment_directory(entry.as_os_str())?;
        if windows_paths_equal(&canonical, tools) && !tools_seen {
            tools_seen = true;
        } else if windows_paths_equal(&canonical, system32) && !system32_seen {
            system32_seen = true;
        } else if windows_paths_equal(&canonical, windows_root) && !windows_root_seen {
            windows_root_seen = true;
        } else {
            return Err(HarnessError::operation("runtime PATH validation failed"));
        }
    }

    let expected_count = 2 + usize::from(windows_root_seen);
    if !tools_seen || !system32_seen || entry_count != expected_count {
        return Err(HarnessError::operation("runtime PATH validation failed"));
    }
    Ok(())
}

#[cfg(windows)]
fn windows_paths_equal(left: &Path, right: &Path) -> bool {
    let left = left.to_string_lossy().replace('/', "\\");
    let right = right.to_string_lossy().replace('/', "\\");
    left.eq_ignore_ascii_case(&right)
}

#[cfg(windows)]
fn prove_runtime_directory_access(layout: &RuntimeLayout) -> Result<(), HarnessError> {
    let marker = runtime_proof_marker_name();
    prove_write_denied(&layout.root, &marker)?;
    prove_readonly_tree(&layout.tools, &marker)?;
    prove_write_denied(&layout.harness, &marker)?;
    prove_readonly_tree(&layout.fixture, &marker)?;
    for directory in [&layout.output, &layout.evidence, &layout.temp] {
        prove_write_and_cleanup(directory, &marker)?;
    }
    Ok(())
}

#[cfg(windows)]
fn prove_readonly_tree(root: &Path, marker: &OsStr) -> Result<(), HarnessError> {
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        prove_write_denied(&directory, marker)?;
        let entries = fs::read_dir(&directory)
            .map_err(|_| HarnessError::operation("read-only runtime tree proof failed"))?;
        for entry in entries {
            let entry = entry
                .map_err(|_| HarnessError::operation("read-only runtime tree proof failed"))?;
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path)
                .map_err(|_| HarnessError::operation("read-only runtime tree proof failed"))?;
            if metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
                return Err(HarnessError::operation(
                    "read-only runtime tree contained a link or reparse point",
                ));
            }
            if metadata.is_dir() {
                pending.push(path);
            } else if metadata.is_file() {
                prove_file_write_denied(&path)?;
            } else {
                return Err(HarnessError::operation(
                    "read-only runtime tree contained an unsupported entry",
                ));
            }
        }
    }
    Ok(())
}

#[cfg(windows)]
fn prove_file_write_denied(path: &Path) -> Result<(), HarnessError> {
    match fs::OpenOptions::new().write(true).open(path) {
        Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => Ok(()),
        Err(_) => Err(HarnessError::operation(
            "read-only runtime file proof was inconclusive",
        )),
        Ok(file) => {
            drop(file);
            Err(HarnessError::operation(
                "read-only runtime file accepted write access",
            ))
        }
    }
}

#[cfg(windows)]
fn runtime_proof_marker_name() -> OsString {
    let nonce = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_or(0, |duration| duration.as_nanos());
    OsString::from(format!(
        ".mscanvas-runtime-proof-{}-{nonce}.tmp",
        std::process::id()
    ))
}

#[cfg(windows)]
fn prove_write_denied(directory: &Path, marker: &OsStr) -> Result<(), HarnessError> {
    let marker_path = directory.join(marker);
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&marker_path)
    {
        Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => Ok(()),
        Err(_) => Err(HarnessError::operation(
            "read-only runtime directory proof was inconclusive",
        )),
        Ok(mut file) => {
            let _ = file.write_all(b"runtime-proof");
            drop(file);
            fs::remove_file(&marker_path)
                .map_err(|_| HarnessError::operation("runtime proof cleanup validation failed"))?;
            Err(HarnessError::operation(
                "read-only runtime directory accepted a write",
            ))
        }
    }
}

#[cfg(windows)]
fn prove_write_and_cleanup(directory: &Path, marker: &OsStr) -> Result<(), HarnessError> {
    let marker_path = directory.join(marker);
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&marker_path)
        .map_err(|_| HarnessError::operation("writable runtime directory proof failed"))?;
    let write_result = file
        .write_all(b"runtime-proof")
        .and_then(|()| file.flush())
        .and_then(|()| file.sync_data());
    drop(file);
    let cleanup_result = fs::remove_file(&marker_path);
    if write_result.is_err() || cleanup_result.is_err() || marker_path.exists() {
        return Err(HarnessError::operation(
            "runtime proof cleanup validation failed",
        ));
    }
    Ok(())
}

const RUNTIME_PROOF_SUCCESS_LINES: [&str; 8] = [
    "runtime_proof.layout=true",
    "runtime_proof.environment_keys_exact=true",
    "runtime_proof.sensitive_environment_absent=true",
    "runtime_proof.temp_tmp_scoped=true",
    "runtime_proof.path_scoped=true",
    "runtime_proof.readonly_directories_enforced=true",
    "runtime_proof.writable_directories_enforced=true",
    "runtime_proof.cleanup_complete=true",
];

#[cfg(windows)]
fn print_runtime_proof_success() {
    for line in RUNTIME_PROOF_SUCCESS_LINES {
        println!("{line}");
    }
}

fn discovery_request(cli: &Cli) -> DiscoveryRequest {
    let configured = cli
        .proteowizard_home
        .as_ref()
        .map(|path| ConfiguredLocation::Home(path.clone()))
        .or_else(|| {
            cli.proteowizard_executable
                .as_ref()
                .map(|path| ConfiguredLocation::Executable(path.clone()))
        });
    DiscoveryRequest { configured }
}

fn build_redactor(
    cli: &Cli,
    request: &DiscoveryRequest,
    discovery: &mscanvas_proteowizard::DiscoveryResult,
) -> Redactor {
    let mut redactor = Redactor::new();
    if let Some(path) = discovery.msconvert.path.as_deref() {
        redactor.add_path(path, "<msconvert>");
        if let Some(parent) = path.parent() {
            redactor.add_path(parent, "<portable-root>");
        }
    }
    if let Some(path) = discovery.msaccess.path.as_deref() {
        redactor.add_path(path, "<msaccess>");
        if let Some(parent) = path.parent() {
            redactor.add_path(parent, "<portable-root>");
        }
    }
    if let Some(configured) = &request.configured {
        match configured {
            ConfiguredLocation::Home(path) => {
                redactor.add_path(path, "<proteowizard-home>");
            }
            ConfiguredLocation::Executable(path) => {
                redactor.add_path(path, "<proteowizard-executable>");
            }
        }
    }
    if let Some(input) = cli.input.as_deref() {
        redactor.add_path(input, "<input>");
    }
    if let Some(output_dir) = cli.output_dir.as_deref() {
        redactor.add_path(output_dir, "<output-dir>");
    }
    redactor
}

fn print_discovery(discovery: &mscanvas_proteowizard::DiscoveryResult, redactor: &Redactor) {
    println!("discovery.availability={:?}", discovery.availability);
    println!(
        "discovery.source={}",
        discovery
            .source
            .map(|source| format!("{source:?}"))
            .unwrap_or_else(|| "none".to_owned())
    );
    println!(
        "discovery.same_installation={}",
        discovery.same_installation
    );
    println!(
        "discovery.release={}",
        discovery.release.as_deref().unwrap_or("unavailable")
    );
    println!(
        "discovery.build_date={}",
        discovery.build_date.as_deref().unwrap_or("unavailable")
    );
    print_discovered_tool("msconvert", &discovery.msconvert, redactor);
    print_discovered_tool("msaccess", &discovery.msaccess, redactor);
    if let Some(failure) = &discovery.failure {
        println!("discovery.failure.kind={}", failure.kind());
        println!("discovery.failure.summary={}", failure.summary());
        println!(
            "discovery.failure.corrective_action={}",
            failure.corrective_action()
        );
    }
}

fn print_discovered_tool(label: &str, tool: &DiscoveredTool, redactor: &Redactor) {
    println!("discovery.{label}.exists={}", tool.exists);
    println!(
        "discovery.{label}.path={}",
        tool.path
            .as_deref()
            .map(|path| redactor.redact(&path.to_string_lossy()))
            .unwrap_or_else(|| "unavailable".to_owned())
    );
    if let Some(probe) = &tool.probe {
        println!(
            "discovery.{label}.reported_release={}",
            probe.reported_release.as_deref().unwrap_or("unavailable")
        );
        println!(
            "discovery.{label}.release={}",
            probe.release.as_deref().unwrap_or("unavailable")
        );
        println!(
            "discovery.{label}.source_revision={}",
            probe.source_revision.as_deref().unwrap_or("unavailable")
        );
        println!(
            "discovery.{label}.build_date={}",
            probe.build_date.as_deref().unwrap_or("unavailable")
        );
        println!("discovery.{label}.probe.exit_code={:?}", probe.exit_code);
        println!(
            "discovery.{label}.probe.elapsed_ms={}",
            probe.elapsed.as_millis()
        );
        println!(
            "discovery.{label}.probe.stdout_captured_bytes={}",
            probe.stdout.len()
        );
        println!(
            "discovery.{label}.probe.stderr_captured_bytes={}",
            probe.stderr.len()
        );
        println!(
            "discovery.{label}.probe.stdout_total_bytes={}",
            probe.stdout_total_bytes
        );
        println!(
            "discovery.{label}.probe.stderr_total_bytes={}",
            probe.stderr_total_bytes
        );
        println!(
            "discovery.{label}.probe.stdout_truncated={}",
            probe.stdout_truncated
        );
        println!(
            "discovery.{label}.probe.stderr_truncated={}",
            probe.stderr_truncated
        );
    }
    if let Some(failure) = &tool.failure {
        println!("discovery.{label}.failure.kind={}", failure.kind());
        println!("discovery.{label}.failure.summary={}", failure.summary());
    }
}

fn build_command(
    cli: &Cli,
    discovery: &mscanvas_proteowizard::DiscoveryResult,
    capabilities: &InstalledHelpCapabilities,
    input: &Path,
    output_dir: &Path,
) -> Result<(BackendTool, mscanvas_proteowizard::CommandSpec), HarnessError> {
    let planned = match cli.mode {
        Mode::RuntimeProof => {
            return Err(HarnessError::operation(
                "runtime-proof mode does not create an operation command",
            ));
        }
        Mode::Probe => {
            return Err(HarnessError::operation(
                "probe mode does not create an operation command",
            ));
        }
        Mode::Metadata => build_msaccess_command_with_capabilities(
            capabilities,
            required_tool_path(&discovery.msaccess, "msaccess")?,
            input,
            output_dir,
            PreviewOperation::Metadata,
        )
        .map(|command| (BackendTool::MsAccess, command)),
        Mode::RunSummary => build_msaccess_command_with_capabilities(
            capabilities,
            required_tool_path(&discovery.msaccess, "msaccess")?,
            input,
            output_dir,
            PreviewOperation::RunSummary,
        )
        .map(|command| (BackendTool::MsAccess, command)),
        Mode::SpectrumTable => build_msaccess_command_with_capabilities(
            capabilities,
            required_tool_path(&discovery.msaccess, "msaccess")?,
            input,
            output_dir,
            PreviewOperation::SpectrumTable,
        )
        .map(|command| (BackendTool::MsAccess, command)),
        Mode::Tic => build_msaccess_command_with_capabilities(
            capabilities,
            required_tool_path(&discovery.msaccess, "msaccess")?,
            input,
            output_dir,
            PreviewOperation::Tic {
                ms_level: cli.ms_level,
            },
        )
        .map(|command| (BackendTool::MsAccess, command)),
        Mode::Spectrum => build_msaccess_command_with_capabilities(
            capabilities,
            required_tool_path(&discovery.msaccess, "msaccess")?,
            input,
            output_dir,
            PreviewOperation::SpectrumByIndex {
                index: cli.spectrum_index.ok_or_else(|| {
                    HarnessError::operation("validated spectrum index is unavailable")
                })?,
                precision: SPECTRUM_PRECISION,
            },
        )
        .map(|command| (BackendTool::MsAccess, command)),
        Mode::Convert => build_msconvert_command_with_capabilities(
            capabilities,
            required_tool_path(&discovery.msconvert, "msconvert")?,
            input,
            output_dir,
            cli.format
                .ok_or_else(|| HarnessError::operation("validated format is unavailable"))?,
        )
        .map(|command| (BackendTool::MsConvert, command)),
    };
    planned.map_err(|error| HarnessError::operation(format!("command planning failed: {error}")))
}

fn validate_installed_command_surface(
    cli: &Cli,
    discovery: &mscanvas_proteowizard::DiscoveryResult,
) -> Result<InstalledHelpCapabilities, HarnessError> {
    let (label, backend_tool, tool) = match cli.mode {
        Mode::RuntimeProof | Mode::Probe => {
            return Err(HarnessError::operation(
                "this mode does not create an operation capability model",
            ));
        }
        Mode::Metadata | Mode::RunSummary | Mode::SpectrumTable | Mode::Tic | Mode::Spectrum => {
            ("msaccess", BackendTool::MsAccess, &discovery.msaccess)
        }
        Mode::Convert => ("msconvert", BackendTool::MsConvert, &discovery.msconvert),
    };

    let probe = tool.probe.as_ref().ok_or_else(|| {
        HarnessError::operation("installed help output was not captured for the required tool")
    })?;
    let stdout_sha256 = Sha256Digest::calculate(&probe.stdout).map_err(|error| {
        HarnessError::operation(format!(
            "installed {label} stdout could not be hashed: {error}"
        ))
    })?;
    let stderr_sha256 = Sha256Digest::calculate(&probe.stderr).map_err(|error| {
        HarnessError::operation(format!(
            "installed {label} stderr could not be hashed: {error}"
        ))
    })?;
    let capture = CompleteHelpCapture::new(
        CapturedHelpStream::new(
            &probe.stdout,
            probe.stdout_total_bytes,
            probe.stdout_truncated,
            stdout_sha256,
        ),
        CapturedHelpStream::new(
            &probe.stderr,
            probe.stderr_total_bytes,
            probe.stderr_truncated,
            stderr_sha256,
        ),
    );
    let capabilities =
        InstalledHelpCapabilities::parse(backend_tool, capture).map_err(|error| {
            HarnessError::operation(format!(
                "installed {label} help did not establish an unambiguous command grammar: {error}"
            ))
        })?;

    match cli.mode {
        Mode::RuntimeProof | Mode::Probe => unreachable!("non-operation modes returned above"),
        Mode::Metadata => capabilities.require_preview_operation(&PreviewOperation::Metadata),
        Mode::RunSummary => capabilities.require_preview_operation(&PreviewOperation::RunSummary),
        Mode::SpectrumTable => {
            capabilities.require_preview_operation(&PreviewOperation::SpectrumTable)
        }
        Mode::Tic => capabilities.require_preview_operation(&PreviewOperation::Tic {
            ms_level: cli.ms_level,
        }),
        Mode::Spectrum => {
            capabilities.require_preview_operation(&PreviewOperation::SpectrumByIndex {
                index: cli.spectrum_index.ok_or_else(|| {
                    HarnessError::operation("validated spectrum index is unavailable")
                })?,
                precision: SPECTRUM_PRECISION,
            })
        }
        Mode::Convert => capabilities.require_conversion(
            cli.format
                .ok_or_else(|| HarnessError::operation("validated format is unavailable"))?,
        ),
    }
    .map_err(|error| {
        HarnessError::operation(format!(
            "installed {label} help does not confirm the complete typed operation: {error}"
        ))
    })?;

    println!("command_surface.tool={label}");
    println!("command_surface.validated_from_installed_help=true");
    println!("command_surface.help.stdout_sha256={stdout_sha256}");
    println!("command_surface.help.stderr_sha256={stderr_sha256}");
    if backend_tool == BackendTool::MsAccess {
        println!(
            "command_surface.tic_capability={:?}",
            capabilities.tic_capability()
        );
    }
    Ok(capabilities)
}

fn required_tool_path(tool: &DiscoveredTool, label: &str) -> Result<PathBuf, HarnessError> {
    if !tool.exists {
        return Err(HarnessError::operation(format!(
            "the required {label} tool is unavailable"
        )));
    }
    tool.path
        .clone()
        .ok_or_else(|| HarnessError::operation(format!("the required {label} path is unavailable")))
}

fn print_command(command: &mscanvas_proteowizard::CommandSpec, redactor: &Redactor) {
    println!("command.tool={:?}", command.tool());
    println!(
        "command.executable={}",
        redactor.redact(&command.executable().to_string_lossy())
    );
    println!(
        "command.working_directory={}",
        redactor.redact(&command.working_directory().to_string_lossy())
    );
    println!("command.argv_count={}", command.args().len());
    for (index, argument) in command.args().iter().enumerate() {
        println!(
            "command.argv[{index}]={}",
            redactor.redact(&argument.to_string_lossy())
        );
    }
}

struct ScheduledCancellation {
    stop: Sender<()>,
    thread: JoinHandle<()>,
}

fn schedule_cancellation(
    cancellation: &CancellationToken,
    cancel_after_ms: Option<u64>,
) -> Option<ScheduledCancellation> {
    let cancel_after_ms = cancel_after_ms?;
    if cancel_after_ms == 0 {
        cancellation.cancel();
        return None;
    }

    let (stop, receiver) = mpsc::channel();
    let trigger = cancellation.clone();
    let thread = thread::spawn(move || {
        if receiver
            .recv_timeout(Duration::from_millis(cancel_after_ms))
            .is_err()
        {
            trigger.cancel();
        }
    });
    Some(ScheduledCancellation { stop, thread })
}

fn finish_cancellation(scheduled: Option<ScheduledCancellation>) -> Result<(), HarnessError> {
    let Some(scheduled) = scheduled else {
        return Ok(());
    };
    let _ = scheduled.stop.send(());
    scheduled
        .thread
        .join()
        .map_err(|_| HarnessError::operation("the cancellation timer thread panicked"))
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct EntryFingerprint {
    length: u64,
    modified: Option<SystemTime>,
    is_file: bool,
    is_directory: bool,
    is_symlink: bool,
    is_reparse_point: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ConversionOutputCandidate {
    path: PathBuf,
    length: u64,
    source_basename_preserved: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ConversionOutputIssue {
    Missing,
    Partial,
    Unexpected,
    NonRegular,
    Empty,
}

impl ConversionOutputIssue {
    const fn stable_id(self) -> &'static str {
        match self {
            Self::Missing => "missing_output",
            Self::Partial => "partial_output",
            Self::Unexpected => "unexpected_output",
            Self::NonRegular => "non_regular_output",
            Self::Empty => "zero_byte_output",
        }
    }

    const fn message(self) -> &'static str {
        match self {
            Self::Missing => "msconvert exited successfully without producing an output file",
            Self::Partial => "msconvert exited successfully but left partial output",
            Self::Unexpected => {
                "msconvert exited successfully but produced an unexpected output set"
            }
            Self::NonRegular => {
                "msconvert exited successfully but the output is not a regular non-reparse file"
            }
            Self::Empty => "msconvert exited successfully but produced an empty output file",
        }
    }
}

fn snapshot_directory(
    output_dir: &Path,
) -> Result<BTreeMap<OsString, EntryFingerprint>, HarnessError> {
    let entries = fs::read_dir(output_dir)
        .map_err(|_| HarnessError::operation("the output directory could not be inspected"))?;
    let mut snapshot = BTreeMap::new();
    for entry in entries {
        let entry = entry
            .map_err(|_| HarnessError::operation("an output directory entry could not be read"))?;
        let metadata = fs::symlink_metadata(entry.path())
            .map_err(|_| HarnessError::operation("output entry metadata could not be read"))?;
        snapshot.insert(
            entry.file_name(),
            EntryFingerprint {
                length: metadata.len(),
                modified: metadata.modified().ok(),
                is_file: metadata.is_file(),
                is_directory: metadata.is_dir(),
                is_symlink: metadata.file_type().is_symlink(),
                is_reparse_point: is_reparse_point(&metadata),
            },
        );
    }
    Ok(snapshot)
}

#[cfg(windows)]
fn is_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;

    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
const fn is_reparse_point(_metadata: &fs::Metadata) -> bool {
    false
}

fn validate_conversion_output(
    snapshot: &BTreeMap<OsString, EntryFingerprint>,
    format: OpenFormat,
    output_directory: &Path,
    input: &Path,
) -> Result<ConversionOutputCandidate, ConversionOutputIssue> {
    if snapshot.is_empty() {
        return Err(ConversionOutputIssue::Missing);
    }
    if snapshot.keys().any(|name| {
        let normalized = name.to_string_lossy().to_ascii_lowercase();
        normalized.ends_with(".partial")
            || normalized.ends_with(".part")
            || normalized.ends_with(".tmp")
    }) {
        return Err(ConversionOutputIssue::Partial);
    }
    if snapshot.len() != 1 {
        return Err(ConversionOutputIssue::Unexpected);
    }

    let (file_name, fingerprint) = snapshot.iter().next().expect("one snapshot entry");
    if !fingerprint.is_file
        || fingerprint.is_directory
        || fingerprint.is_symlink
        || fingerprint.is_reparse_point
    {
        return Err(ConversionOutputIssue::NonRegular);
    }
    let expected_extension = match format {
        OpenFormat::MzMl => "mzML",
        OpenFormat::MzXml => "mzXML",
    };
    let output_path = Path::new(file_name);
    if !output_path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case(expected_extension))
    {
        return Err(ConversionOutputIssue::Unexpected);
    }
    if fingerprint.length == 0 {
        return Err(ConversionOutputIssue::Empty);
    }

    let source_basename_preserved = output_path
        .file_stem()
        .zip(input.file_stem())
        .is_some_and(|(output_stem, input_stem)| output_stem.eq_ignore_ascii_case(input_stem));
    Ok(ConversionOutputCandidate {
        path: output_directory.join(file_name),
        length: fingerprint.length,
        source_basename_preserved,
    })
}

fn require_fresh_output_directory(
    snapshot: &BTreeMap<OsString, EntryFingerprint>,
) -> Result<(), HarnessError> {
    if snapshot.is_empty() {
        Ok(())
    } else {
        Err(HarnessError::operation(
            "the explicit output directory must be empty to prevent implicit overwrite during this spike",
        ))
    }
}

fn print_process_output(
    output: &mscanvas_proteowizard::ProcessOutput,
    output_changed: bool,
    partial_output_present: bool,
    redactor: &Redactor,
) -> Result<(), HarnessError> {
    let reportable = ReportableProcessOutput::from_process(output, redactor);
    println!("process.exit_code={:?}", reportable.exit_code);
    println!("process.termination={:?}", reportable.termination);
    println!("process.elapsed_ms={}", reportable.elapsed_millis);
    println!("process.stdout_captured_bytes={}", output.stdout.len());
    println!("process.stderr_captured_bytes={}", output.stderr.len());
    println!("process.stdout_total_bytes={}", output.stdout_total_bytes);
    println!("process.stderr_total_bytes={}", output.stderr_total_bytes);
    println!("process.stdout_truncated={}", output.stdout_truncated);
    println!("process.stderr_truncated={}", output.stderr_truncated);
    println!(
        "process.max_active_processes={}",
        output
            .max_active_processes
            .map(|count| count.to_string())
            .unwrap_or_else(|| "unavailable".to_owned())
    );
    println!(
        "process.final_active_processes={}",
        output
            .final_active_processes
            .map(|count| count.to_string())
            .unwrap_or_else(|| "unavailable".to_owned())
    );
    println!("process.output_directory_changed={output_changed}");
    println!("process.partial_output_present={partial_output_present}");
    print_scientific_stdout_payload(output)?;
    print_diagnostic_preview("process.stdout_preview", &reportable.stdout);
    print_diagnostic_preview("process.stderr_preview", &reportable.stderr);
    Ok(())
}

fn print_scientific_stdout_payload(
    output: &mscanvas_proteowizard::ProcessOutput,
) -> Result<(), HarnessError> {
    println!("scientific.stdout_bytes={}", output.stdout_total_bytes);
    if output.stdout_truncated || output.stdout_total_bytes != output.stdout.len() as u64 {
        println!("scientific.stdout_payload_status=incomplete_capture");
        println!("scientific.stdout_sha256=unavailable");
        println!("scientific.stdout_base64_chunk_count=0");
        return Ok(());
    }

    let sha256 = Sha256Digest::calculate(&output.stdout).map_err(|error| {
        HarnessError::operation(format!(
            "the complete scientific stdout could not be hashed: {error}"
        ))
    })?;
    println!("scientific.stdout_sha256={sha256}");
    if std::str::from_utf8(&output.stdout).is_err() {
        println!("scientific.stdout_payload_status=invalid_utf8");
        println!("scientific.stdout_base64_chunk_count=0");
        return Ok(());
    }
    if output.stdout.len() > SCIENTIFIC_STDOUT_PAYLOAD_MAX_BYTES {
        println!("scientific.stdout_payload_status=omitted_size_limit");
        println!("scientific.stdout_base64_chunk_count=0");
        return Ok(());
    }

    let encoded = encode_base64(&output.stdout);
    let chunks = encoded
        .as_bytes()
        .chunks(SCIENTIFIC_STDOUT_BASE64_CHUNK_CHARS)
        .collect::<Vec<_>>();
    println!("scientific.stdout_payload_status=complete");
    println!("scientific.stdout_base64_chunk_count={}", chunks.len());
    for (index, chunk) in chunks.iter().enumerate() {
        let chunk =
            std::str::from_utf8(chunk).expect("base64 output contains only ASCII characters");
        println!("scientific.stdout_base64[{index}]={chunk}");
    }
    Ok(())
}

fn encode_base64(input: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut encoded = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let first = chunk[0];
        let second = chunk.get(1).copied().unwrap_or(0);
        let third = chunk.get(2).copied().unwrap_or(0);
        encoded.push(char::from(ALPHABET[usize::from(first >> 2)]));
        encoded.push(char::from(
            ALPHABET[usize::from(((first & 0x03) << 4) | (second >> 4))],
        ));
        if chunk.len() > 1 {
            encoded.push(char::from(
                ALPHABET[usize::from(((second & 0x0f) << 2) | (third >> 6))],
            ));
        } else {
            encoded.push('=');
        }
        if chunk.len() > 2 {
            encoded.push(char::from(ALPHABET[usize::from(third & 0x3f)]));
        } else {
            encoded.push('=');
        }
    }
    encoded
}

fn print_normalized_failure(
    failure: &mscanvas_proteowizard::NormalizedFailure,
    redactor: &Redactor,
) {
    println!("failure.kind={}", failure.kind.stable_id());
    println!("failure.summary={}", failure.summary);
    println!(
        "failure.retryability={}",
        match failure.retryability {
            Retryability::Retryable => "retryable",
            Retryability::AfterCorrection => "after_correction",
            Retryability::NotRetryable => "not_retryable",
        }
    );
    println!("failure.suggested_action={}", failure.suggested_action);
    println!(
        "failure.partial_output_present={}",
        failure
            .conditions
            .contains(&FailureCondition::PartialOutputPresent)
    );
    let technical_detail = redactor.redact(&failure.technical_detail);
    print_diagnostic_preview("failure.technical_detail", &technical_detail);
}

fn print_diagnostic_preview(label: &str, text: &str) {
    if text.is_empty() {
        println!("{label}=<empty>");
        return;
    }
    let mut preview = text
        .chars()
        .take(DIAGNOSTIC_PREVIEW_CHARS)
        .collect::<String>();
    if text.chars().count() > DIAGNOSTIC_PREVIEW_CHARS {
        preview.push_str("…<truncated>");
    }
    println!("{label}={preview:?}");
}

fn print_usage() {
    println!(
        r#"unstable developer-only usage:
cargo run -p mscanvas-proteowizard --example m0_proteowizard_spike -- \
  --mode runtime-proof --runtime-root PATH --proteowizard-home PATH

cargo run -p mscanvas-proteowizard --example m0_proteowizard_spike -- \
  --mode probe|metadata|run-summary|spectrum-table|tic|spectrum|convert \
  [--proteowizard-home PATH | --proteowizard-executable EXE] \
  [--input PATH --output-dir PATH] [--spectrum-index N] [--ms-level N] \
  [--format mzML|mzXML] [--cancel-after-ms N]"#
    );
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;
    use mscanvas_proteowizard::{DiscoveryResult, DiscoverySource, ToolProbe};

    #[test]
    fn scientific_stdout_base64_encoding_matches_standard_vectors() {
        for (plain, encoded) in [
            (b"".as_slice(), ""),
            (b"f".as_slice(), "Zg=="),
            (b"fo".as_slice(), "Zm8="),
            (b"foo".as_slice(), "Zm9v"),
            (b"foobar".as_slice(), "Zm9vYmFy"),
        ] {
            assert_eq!(encode_base64(plain), encoded);
        }
    }

    #[test]
    fn runtime_proof_parser_accepts_only_one_absolute_runtime_root() {
        let current = std::env::current_dir().expect("test current directory");
        let expected = fs::canonicalize(&current).expect("test current directory canonicalizes");
        let cli = parse_args([
            OsString::from("--mode"),
            OsString::from("runtime-proof"),
            OsString::from("--runtime-root"),
            current.clone().into_os_string(),
            OsString::from("--proteowizard-home"),
            current.clone().into_os_string(),
        ])
        .expect("runtime-proof arguments should parse");

        assert_eq!(cli.mode, Mode::RuntimeProof);
        assert_eq!(cli.runtime_root.as_deref(), Some(expected.as_path()));
        assert_eq!(cli.proteowizard_home.as_deref(), Some(expected.as_path()));
        assert!(cli.input.is_none());

        let missing = parse_args([OsString::from("--mode"), OsString::from("runtime-proof")])
            .expect_err("runtime-proof requires its root");
        assert!(missing.message.contains("--runtime-root is required"));

        let relative = parse_args([
            OsString::from("--mode"),
            OsString::from("runtime-proof"),
            OsString::from("--runtime-root"),
            OsString::from("relative-runtime-root"),
            OsString::from("--proteowizard-home"),
            current.clone().into_os_string(),
        ])
        .expect_err("runtime-proof rejects a relative root");
        assert!(relative.message.contains("existing absolute directory"));

        let extra = parse_args([
            OsString::from("--mode"),
            OsString::from("runtime-proof"),
            OsString::from("--runtime-root"),
            expected.clone().into_os_string(),
            OsString::from("--proteowizard-home"),
            expected.into_os_string(),
            OsString::from("--input"),
            OsString::from("never-inspected"),
        ])
        .expect_err("runtime-proof rejects backend arguments before inspecting them");
        assert!(extra.message.contains("--input is not valid"));
    }

    #[test]
    fn runtime_environment_key_contract_is_exact_and_case_insensitive() {
        let required = reviewed_environment_entries();
        let environment = collect_reviewed_runtime_environment(required.clone())
            .expect("the exact required environment is allowed");
        assert_eq!(environment.len(), REQUIRED_RUNTIME_ENVIRONMENT.len());

        let mut with_optional_home = required.clone();
        with_optional_home.push((OsString::from("homedrive"), OsString::from("X:")));
        with_optional_home.push((OsString::from("HomePath"), OsString::from(r"\Users\proof")));
        collect_reviewed_runtime_environment(with_optional_home)
            .expect("the reviewed optional home pair is allowed");

        let mut partial_home = required.clone();
        partial_home.push((OsString::from("HOMEDRIVE"), OsString::from("X:")));
        let error = collect_reviewed_runtime_environment(partial_home)
            .expect_err("an incomplete optional home pair must fail closed");
        assert!(
            error
                .message
                .contains("home environment state was incomplete")
        );

        let mut unknown = required;
        unknown.push((OsString::from("NUMBER_OF_PROCESSORS"), OsString::from("8")));
        let error = collect_reviewed_runtime_environment(unknown)
            .expect_err("a normal but unreviewed key must fail closed");
        assert!(error.message.contains("allowlist validation failed"));
    }

    #[test]
    fn sensitive_runtime_environment_is_rejected_without_echoing_values() {
        for sensitive_key in [
            "GITHUB_TOKEN",
            "ACTIONS_RUNTIME_TOKEN",
            "REPOSITORY_CREDENTIAL",
            "USERPROFILE",
            "HOME",
        ] {
            let mut entries = reviewed_environment_entries();
            entries.push((
                OsString::from(sensitive_key),
                OsString::from("do-not-echo-this-value"),
            ));
            let error = collect_reviewed_runtime_environment(entries)
                .expect_err("sensitive environment must fail closed");
            assert_eq!(
                error.message,
                "sensitive runtime environment state was present"
            );
            assert!(!error.message.contains("do-not-echo-this-value"));
        }
    }

    #[test]
    fn runtime_proof_success_output_is_fixed_boolean_only() {
        assert_eq!(RUNTIME_PROOF_SUCCESS_LINES.len(), 8);
        for line in RUNTIME_PROOF_SUCCESS_LINES {
            let (key, value) = line.split_once('=').expect("proof line has one value");
            assert!(key.starts_with("runtime_proof."));
            assert_eq!(value, "true");
            assert!(!line.contains(':'));
            assert!(!line.contains('\\'));
            assert!(!line.contains('/'));
        }
    }

    fn reviewed_environment_entries() -> Vec<(OsString, OsString)> {
        REQUIRED_RUNTIME_ENVIRONMENT
            .into_iter()
            .map(|key| (OsString::from(key), OsString::from("reviewed-value")))
            .collect()
    }

    #[cfg(windows)]
    #[test]
    fn runtime_layout_and_scoped_environment_are_validated_without_global_env_changes() {
        let controlled = ControlledRuntimeRoot::new();
        let canonical_root =
            fs::canonicalize(&controlled.root).expect("runtime root canonicalizes");
        let layout = RuntimeLayout::from_root(&canonical_root).expect("fixed layout is valid");
        assert_eq!(layout.root, canonical_root);
        assert_eq!(layout.tools.file_name(), Some(OsStr::new("tools")));
        assert_eq!(layout.harness.file_name(), Some(OsStr::new("harness")));
        assert_eq!(layout.fixture.file_name(), Some(OsStr::new("fixture")));
        assert_eq!(layout.output.file_name(), Some(OsStr::new("output")));
        assert_eq!(layout.evidence.file_name(), Some(OsStr::new("evidence")));
        assert_eq!(layout.temp.file_name(), Some(OsStr::new("temp")));

        let portable_root = layout.tools.join("pwiz portable");
        fs::create_dir(&portable_root).expect("nested portable root is created");
        for executable in ["msconvert.exe", "msaccess.exe"] {
            fs::write(
                portable_root.join(executable),
                b"controlled fake executable",
            )
            .expect("controlled fake executable is created");
        }
        let portable_root =
            fs::canonicalize(portable_root).expect("nested portable root canonicalizes");
        validate_runtime_portable_root(&layout, &portable_root)
            .expect("a direct regular executable pair below tools is valid");

        let system_root = std::env::var_os("SystemRoot").expect("Windows has SystemRoot");
        let system32 = Path::new(&system_root).join("System32");
        let reviewed_path = env::join_paths([portable_root.as_path(), system32.as_path()])
            .expect("reviewed PATH joins");
        let entries = scoped_environment_entries(
            &system_root,
            layout.temp.as_os_str(),
            reviewed_path.as_os_str(),
        );
        validate_runtime_environment(entries, &layout, &portable_root)
            .expect("the exact scoped environment is valid");

        let extra_path = env::join_paths([
            portable_root.as_path(),
            system32.as_path(),
            layout.output.as_path(),
        ])
        .expect("PATH with extra entry joins");
        let entries = scoped_environment_entries(
            &system_root,
            layout.temp.as_os_str(),
            extra_path.as_os_str(),
        );
        let error = validate_runtime_environment(entries, &layout, &portable_root)
            .expect_err("an extra PATH entry must fail closed");
        assert!(error.message.contains("runtime PATH validation failed"));
    }

    #[cfg(windows)]
    #[test]
    fn access_probes_fail_closed_and_remove_every_created_marker() {
        let controlled = ControlledRuntimeRoot::new();
        let canonical_root =
            fs::canonicalize(&controlled.root).expect("runtime root canonicalizes");
        let layout = RuntimeLayout::from_root(&canonical_root).expect("fixed layout is valid");
        let marker = OsString::from("controlled-runtime-proof-marker.tmp");

        let error = prove_write_denied(&layout.tools, &marker)
            .expect_err("a writable directory cannot pass the read-only proof");
        assert!(error.message.contains("accepted a write"));
        assert!(!layout.tools.join(&marker).exists());

        let nested = layout.fixture.join("controlled-readonly-candidate.mzML");
        fs::write(&nested, b"unchanged").expect("controlled file is created");
        let error = prove_file_write_denied(&nested)
            .expect_err("a writable file cannot pass the read-only proof");
        assert!(error.message.contains("accepted write access"));
        assert_eq!(
            fs::read(&nested).expect("controlled file remains readable"),
            b"unchanged"
        );

        prove_write_and_cleanup(&layout.output, &marker)
            .expect("writable proof creates, writes, and removes its marker");
        assert!(!layout.output.join(&marker).exists());
    }

    #[cfg(windows)]
    fn scoped_environment_entries(
        system_root: &OsStr,
        temp: &OsStr,
        path: &OsStr,
    ) -> Vec<(OsString, OsString)> {
        vec![
            (OsString::from("SystemRoot"), system_root.to_os_string()),
            (OsString::from("WINDIR"), system_root.to_os_string()),
            (OsString::from("TEMP"), temp.to_os_string()),
            (OsString::from("TMP"), temp.to_os_string()),
            (OsString::from("PATH"), path.to_os_string()),
        ]
    }

    #[cfg(windows)]
    struct ControlledRuntimeRoot {
        root: PathBuf,
    }

    #[cfg(windows)]
    impl ControlledRuntimeRoot {
        fn new() -> Self {
            let nonce = SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock is after Unix epoch")
                .as_nanos();
            let root = std::env::temp_dir().join(format!(
                "mscanvas-runtime-proof-test-{}-{nonce}",
                std::process::id()
            ));
            for child in ["tools", "harness", "fixture", "output", "evidence", "temp"] {
                fs::create_dir_all(root.join(child)).expect("controlled runtime directory created");
            }
            Self { root }
        }
    }

    #[cfg(windows)]
    impl Drop for ControlledRuntimeRoot {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.root).expect("controlled runtime directory removed");
        }
    }

    #[cfg(windows)]
    #[test]
    fn conversion_fails_closed_until_installed_help_confirms_every_planned_flag() {
        let cli = convert_cli();
        let incomplete = discovery_with_help(
            &MSCONVERT_HELP.replace(
                "  -z [ --zlib ] [=arg(=1)]           : use zlib compression for binary data\n",
                "",
            ),
            "",
        );
        let error = validate_installed_command_surface(&cli, &incomplete)
            .expect_err("missing zlib declaration must fail closed");
        assert!(error.message.contains("complete typed operation"));
        assert!(error.message.contains("zlib"));

        let complete = discovery_with_help(MSCONVERT_HELP, "");
        validate_installed_command_surface(&cli, &complete)
            .expect("installed grammar confirms every conversion flag");
    }

    #[cfg(windows)]
    #[test]
    fn mzxml_conversion_reaches_the_public_integrity_gate_after_grammar_validation() {
        let mut cli = convert_cli();
        cli.format = Some(OpenFormat::MzXml);
        let mut discovery = discovery_with_help(MSCONVERT_HELP, "");
        let current_directory = std::env::current_dir().expect("test current directory");
        discovery.msconvert.path = Some(current_directory.join("msconvert.exe"));
        let capabilities = validate_installed_command_surface(&cli, &discovery)
            .expect("installed help recognizes the complete mzXML grammar");

        let error = build_command(
            &cli,
            &discovery,
            &capabilities,
            &current_directory.join("sample.raw"),
            &current_directory.join("converted"),
        )
        .expect_err("the public planner must not return an mzXML command");

        assert_eq!(error.exit_code, 1);
        assert_eq!(
            error.message,
            "command planning failed: mzXML conversion is unavailable until source/output integrity validation is implemented"
        );
    }

    #[cfg(windows)]
    #[test]
    fn installed_help_with_truncated_stdout_fails_closed_even_when_grammar_exists() {
        let cli = convert_cli();
        let mut discovery = discovery_with_help(MSCONVERT_HELP, "");
        let probe = discovery.msconvert.probe.as_mut().expect("msconvert probe");
        probe.stdout_total_bytes += 1;
        probe.stdout_truncated = true;

        let error = validate_installed_command_surface(&cli, &discovery)
            .expect_err("truncated stdout must invalidate installed help");
        assert!(error.message.contains("stdout help capture is truncated"));
    }

    #[cfg(windows)]
    #[test]
    fn installed_help_with_truncated_stderr_fails_closed_even_when_grammar_exists() {
        let cli = convert_cli();
        let mut discovery = discovery_with_help(MSCONVERT_HELP, "");
        let probe = discovery.msconvert.probe.as_mut().expect("msconvert probe");
        probe.stderr = b"diagnostic".to_vec();
        probe.stderr_total_bytes = probe.stderr.len() as u64 + 1;
        probe.stderr_truncated = true;

        let error = validate_installed_command_surface(&cli, &discovery)
            .expect_err("truncated stderr must invalidate installed help");
        assert!(error.message.contains("stderr help capture is truncated"));
    }

    #[test]
    fn ms_level_parser_rejects_zero_and_out_of_range_values() {
        assert_eq!(parse_nonzero_u8(OsStr::new("2"), "--ms-level").unwrap(), 2);
        assert!(parse_nonzero_u8(OsStr::new("0"), "--ms-level").is_err());
        assert!(parse_nonzero_u8(OsStr::new("256"), "--ms-level").is_err());
    }

    #[test]
    fn nonempty_output_directory_fails_closed_before_backend_execution() {
        let empty = BTreeMap::new();
        require_fresh_output_directory(&empty).expect("empty spike directory is safe");

        let populated = BTreeMap::from([(
            OsString::from("existing-output.mzML"),
            EntryFingerprint {
                length: 17,
                modified: None,
                is_file: true,
                is_directory: false,
                is_symlink: false,
                is_reparse_point: false,
            },
        )]);
        let error = require_fresh_output_directory(&populated)
            .expect_err("nonempty spike directory must fail closed");
        assert!(error.message.contains("must be empty"));
    }

    #[test]
    fn conversion_output_accepts_one_nonempty_expected_format_with_run_id_name() {
        let output = BTreeMap::from([(
            OsString::from("Experiment_x0020_1.mzML"),
            regular_output(4096),
        )]);
        let candidate = validate_conversion_output(
            &output,
            OpenFormat::MzMl,
            Path::new("output"),
            Path::new("tiny.pwiz.1.1.mzML"),
        )
        .expect("one valid mzML output");

        assert_eq!(candidate.length, 4096);
        assert_eq!(candidate.path, Path::new("output/Experiment_x0020_1.mzML"));
        assert!(!candidate.source_basename_preserved);
    }

    #[test]
    fn conversion_output_reports_source_basename_preservation_as_observation() {
        let output =
            BTreeMap::from([(OsString::from("tiny.pwiz.1.1.mzXML"), regular_output(2048))]);
        let candidate = validate_conversion_output(
            &output,
            OpenFormat::MzXml,
            Path::new("output"),
            Path::new("tiny.pwiz.1.1.mzML"),
        )
        .expect("one valid mzXML output");

        assert!(candidate.source_basename_preserved);
    }

    #[test]
    fn conversion_output_fails_closed_for_missing_empty_partial_and_extra_entries() {
        assert_eq!(
            validate_conversion_output(
                &BTreeMap::new(),
                OpenFormat::MzMl,
                Path::new("output"),
                Path::new("input.mzML")
            ),
            Err(ConversionOutputIssue::Missing)
        );

        let empty = BTreeMap::from([(OsString::from("output.mzML"), regular_output(0))]);
        assert_eq!(
            validate_conversion_output(
                &empty,
                OpenFormat::MzMl,
                Path::new("output"),
                Path::new("input.mzML")
            ),
            Err(ConversionOutputIssue::Empty)
        );

        let partial = BTreeMap::from([(OsString::from("output.mzML.partial"), regular_output(17))]);
        assert_eq!(
            validate_conversion_output(
                &partial,
                OpenFormat::MzMl,
                Path::new("output"),
                Path::new("input.mzML")
            ),
            Err(ConversionOutputIssue::Partial)
        );

        let extra = BTreeMap::from([
            (OsString::from("output.mzML"), regular_output(17)),
            (OsString::from("unexpected.txt"), regular_output(9)),
        ]);
        assert_eq!(
            validate_conversion_output(
                &extra,
                OpenFormat::MzMl,
                Path::new("output"),
                Path::new("input.mzML")
            ),
            Err(ConversionOutputIssue::Unexpected)
        );
    }

    #[test]
    fn conversion_output_rejects_wrong_format_and_nonregular_entries() {
        let wrong_format = BTreeMap::from([(OsString::from("output.mzXML"), regular_output(17))]);
        assert_eq!(
            validate_conversion_output(
                &wrong_format,
                OpenFormat::MzMl,
                Path::new("output"),
                Path::new("input.mzML")
            ),
            Err(ConversionOutputIssue::Unexpected)
        );

        for fingerprint in [
            EntryFingerprint {
                is_file: false,
                is_directory: true,
                ..regular_output(17)
            },
            EntryFingerprint {
                is_file: false,
                is_symlink: true,
                ..regular_output(17)
            },
            EntryFingerprint {
                is_reparse_point: true,
                ..regular_output(17)
            },
        ] {
            let output = BTreeMap::from([(OsString::from("output.mzML"), fingerprint)]);
            assert_eq!(
                validate_conversion_output(
                    &output,
                    OpenFormat::MzMl,
                    Path::new("output"),
                    Path::new("input.mzML")
                ),
                Err(ConversionOutputIssue::NonRegular)
            );
        }
    }

    fn regular_output(length: u64) -> EntryFingerprint {
        EntryFingerprint {
            length,
            modified: None,
            is_file: true,
            is_directory: false,
            is_symlink: false,
            is_reparse_point: false,
        }
    }

    #[test]
    fn output_inside_directory_input_is_rejected_before_discovery_or_execution() {
        let input = std::env::current_dir()
            .expect("test current directory")
            .join("local-data/proteowizard/directory-acquisition.raw");
        let nested_output = input.join("converted");
        let sibling_output = input
            .parent()
            .expect("input has a parent")
            .join("converted");

        reject_output_inside_directory_input(&input, &input, true)
            .expect_err("the acquisition itself cannot be an output directory");
        reject_output_inside_directory_input(&input, &nested_output, true)
            .expect_err("nested output cannot modify a directory acquisition");
        reject_output_inside_directory_input(&input, &sibling_output, true)
            .expect("a sibling output directory is outside the acquisition");
        reject_output_inside_directory_input(&input, &nested_output, false)
            .expect("file inputs do not contain output directories");
    }

    fn convert_cli() -> Cli {
        Cli {
            mode: Mode::Convert,
            runtime_root: None,
            proteowizard_home: None,
            proteowizard_executable: None,
            input: Some(PathBuf::from("input.mzML")),
            output_dir: Some(PathBuf::from("output")),
            spectrum_index: None,
            ms_level: None,
            format: Some(OpenFormat::MzMl),
            cancel_after_ms: None,
        }
    }

    const MSCONVERT_HELP: &str = r#"Usage: msconvert [options] [filemasks]
Convert mass spec data file formats.

Options:
  -o [ --outdir ] arg (=.)           : set output directory
  --mzML                             : write mzML format [default]
  --mzXML                            : write mzXML format
  -z [ --zlib ] [=arg(=1)]           : use zlib compression for binary data
"#;

    fn discovery_with_help(msconvert_help: &str, msaccess_help: &str) -> DiscoveryResult {
        DiscoveryResult {
            availability: AvailabilityState::Available,
            source: Some(DiscoverySource::ConfiguredHome),
            msconvert: discovered_tool("msconvert.exe", msconvert_help),
            msaccess: discovered_tool("msaccess.exe", msaccess_help),
            same_installation: true,
            release: Some("test-release".to_owned()),
            build_date: Some("test-build".to_owned()),
            failure: None,
        }
    }

    fn discovered_tool(path: &str, help: &str) -> DiscoveredTool {
        DiscoveredTool {
            path: Some(PathBuf::from(path)),
            exists: true,
            probe: Some(ToolProbe::new(help, "", Some(0), Duration::from_millis(1))),
            failure: None,
        }
    }
}
