//! Unstable, developer-only M0 ProteoWizard spike harness.
//!
//! This example is intentionally not a stable MSCanvas CLI contract.

use std::collections::BTreeMap;
use std::env;
use std::ffi::{OsStr, OsString};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::mpsc::{self, Sender};
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime};

use mscanvas_proteowizard::{
    AvailabilityState, BackendTool, CancellationToken, ConfiguredLocation, DiscoveredTool,
    DiscoveryRequest, FailureCondition, OpenFormat, PreviewOperation, Redactor,
    ReportableProcessOutput, Retryability, build_msaccess_command, build_msconvert_command,
    classify_process_failure, discover, execute_cancellable,
};

const DIAGNOSTIC_PREVIEW_CHARS: usize = 4_096;
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
            Some("probe") => Ok(Self::Probe),
            Some("metadata") => Ok(Self::Metadata),
            Some("run-summary") => Ok(Self::RunSummary),
            Some("spectrum-table") => Ok(Self::SpectrumTable),
            Some("tic") => Ok(Self::Tic),
            Some("spectrum") => Ok(Self::Spectrum),
            Some("convert") => Ok(Self::Convert),
            _ => Err(HarnessError::usage(
                "--mode must be probe, metadata, run-summary, spectrum-table, tic, spectrum, or convert",
            )),
        }
    }

    const fn label(self) -> &'static str {
        match self {
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
    proteowizard_home: Option<PathBuf>,
    proteowizard_executable: Option<PathBuf>,
    input: Option<PathBuf>,
    output_dir: Option<PathBuf>,
    spectrum_index: Option<u64>,
    format: Option<OpenFormat>,
    cancel_after_ms: Option<u64>,
}

#[derive(Default)]
struct RawArgs {
    mode: Option<Mode>,
    proteowizard_home: Option<PathBuf>,
    proteowizard_executable: Option<PathBuf>,
    input: Option<PathBuf>,
    output_dir: Option<PathBuf>,
    spectrum_index: Option<u64>,
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
        proteowizard_home: raw.proteowizard_home,
        proteowizard_executable: raw.proteowizard_executable,
        input: raw.input,
        output_dir: raw.output_dir,
        spectrum_index: raw.spectrum_index,
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

fn parse_format(value: &OsStr) -> Result<OpenFormat, HarnessError> {
    match value.to_str() {
        Some("mzML") => Ok(OpenFormat::MzMl),
        Some("mzXML") => Ok(OpenFormat::MzXml),
        _ => Err(HarnessError::usage("--format must be mzML or mzXML")),
    }
}

fn validate_mode_arguments(mut cli: Cli) -> Result<Cli, HarnessError> {
    match cli.mode {
        Mode::Probe => {
            reject_present(&cli.input, "--input", "probe")?;
            reject_present(&cli.output_dir, "--output-dir", "probe")?;
            reject_present(&cli.spectrum_index, "--spectrum-index", "probe")?;
            reject_present(&cli.format, "--format", "probe")?;
            reject_present(&cli.cancel_after_ms, "--cancel-after-ms", "probe")?;
        }
        Mode::Metadata | Mode::RunSummary | Mode::SpectrumTable | Mode::Tic => {
            require_present(&cli.input, "--input", cli.mode.label())?;
            require_present(&cli.output_dir, "--output-dir", cli.mode.label())?;
            reject_present(&cli.spectrum_index, "--spectrum-index", cli.mode.label())?;
            reject_present(&cli.format, "--format", cli.mode.label())?;
        }
        Mode::Spectrum => {
            require_present(&cli.input, "--input", "spectrum")?;
            require_present(&cli.output_dir, "--output-dir", "spectrum")?;
            require_present(&cli.spectrum_index, "--spectrum-index", "spectrum")?;
            reject_present(&cli.format, "--format", "spectrum")?;
        }
        Mode::Convert => {
            require_present(&cli.input, "--input", "convert")?;
            require_present(&cli.output_dir, "--output-dir", "convert")?;
            require_present(&cli.format, "--format", "convert")?;
            reject_present(&cli.spectrum_index, "--spectrum-index", "convert")?;
        }
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
    println!("warning=unstable developer-only M0 spike harness; no stable CLI contract");
    println!("mode={}", cli.mode.label());

    let request = discovery_request(&cli);
    let discovery = discover(&request);
    let redactor = build_redactor(&cli, &request, &discovery);
    print_discovery(&discovery, &redactor);

    if discovery.availability != AvailabilityState::Available {
        return Err(HarnessError::operation(
            "ProteoWizard discovery did not produce one verified matching tool pair",
        ));
    }
    if cli.mode == Mode::Probe {
        return Ok(());
    }
    validate_installed_command_surface(&cli, &discovery)?;

    let input = cli
        .input
        .as_deref()
        .ok_or_else(|| HarnessError::operation("validated input is unavailable"))?;
    let output_dir = cli
        .output_dir
        .as_deref()
        .ok_or_else(|| HarnessError::operation("validated output directory is unavailable"))?;
    let (tool, command) = build_command(&cli, &discovery, input, output_dir)?;
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
            let partial_output_present = !output.success() && output_changed;
            print_process_output(&output, output_changed, partial_output_present, &redactor);
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
    }
    if let Some(path) = discovery.msaccess.path.as_deref() {
        redactor.add_path(path, "<msaccess>");
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
        if let Some(file_name) = input.file_name() {
            redactor.add_literal(&file_name.to_string_lossy(), "<input-name>");
        }
        if let Some(file_stem) = input.file_stem() {
            redactor.add_literal(&file_stem.to_string_lossy(), "<input-stem>");
        }
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
    input: &Path,
    output_dir: &Path,
) -> Result<(BackendTool, mscanvas_proteowizard::CommandSpec), HarnessError> {
    let planned = match cli.mode {
        Mode::Probe => {
            return Err(HarnessError::operation(
                "probe mode does not create an operation command",
            ));
        }
        Mode::Metadata => build_msaccess_command(
            required_tool_path(&discovery.msaccess, "msaccess")?,
            input,
            output_dir,
            PreviewOperation::Metadata,
        )
        .map(|command| (BackendTool::MsAccess, command)),
        Mode::RunSummary => build_msaccess_command(
            required_tool_path(&discovery.msaccess, "msaccess")?,
            input,
            output_dir,
            PreviewOperation::RunSummary,
        )
        .map(|command| (BackendTool::MsAccess, command)),
        Mode::SpectrumTable => build_msaccess_command(
            required_tool_path(&discovery.msaccess, "msaccess")?,
            input,
            output_dir,
            PreviewOperation::SpectrumTable,
        )
        .map(|command| (BackendTool::MsAccess, command)),
        Mode::Tic => build_msaccess_command(
            required_tool_path(&discovery.msaccess, "msaccess")?,
            input,
            output_dir,
            PreviewOperation::Tic { ms_level: None },
        )
        .map(|command| (BackendTool::MsAccess, command)),
        Mode::Spectrum => build_msaccess_command(
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
        Mode::Convert => build_msconvert_command(
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
) -> Result<(), HarnessError> {
    let (label, tool, markers): (&str, &DiscoveredTool, Vec<&str>) = match cli.mode {
        Mode::Probe => return Ok(()),
        Mode::Metadata => (
            "msaccess",
            &discovery.msaccess,
            vec!["--outdir", "--exec", "metadata"],
        ),
        Mode::RunSummary => (
            "msaccess",
            &discovery.msaccess,
            vec!["--outdir", "--exec", "run_summary", "delimiter="],
        ),
        Mode::SpectrumTable => (
            "msaccess",
            &discovery.msaccess,
            vec!["--outdir", "--exec", "spectrum_table", "delimiter="],
        ),
        Mode::Tic => (
            "msaccess",
            &discovery.msaccess,
            vec!["--outdir", "--exec", "tic", "delimiter="],
        ),
        Mode::Spectrum => (
            "msaccess",
            &discovery.msaccess,
            vec!["--outdir", "--exec", "binary", "index=", "precision="],
        ),
        Mode::Convert => {
            let format = match cli.format {
                Some(OpenFormat::MzMl) => "--mzML",
                Some(OpenFormat::MzXml) => "--mzXML",
                None => {
                    return Err(HarnessError::operation(
                        "validated conversion format is unavailable",
                    ));
                }
            };
            (
                "msconvert",
                &discovery.msconvert,
                vec!["--outdir", "--zlib", format],
            )
        }
    };

    let probe = tool.probe.as_ref().ok_or_else(|| {
        HarnessError::operation("installed help output was not captured for the required tool")
    })?;
    if probe.stdout_truncated || probe.stderr_truncated {
        let truncated_streams = match (probe.stdout_truncated, probe.stderr_truncated) {
            (true, true) => "stdout and stderr",
            (true, false) => "stdout",
            (false, true) => "stderr",
            (false, false) => unreachable!("truncation guard requires a truncated stream"),
        };
        return Err(HarnessError::operation(format!(
            "installed {label} help capture is incomplete (truncated streams: {truncated_streams})"
        )));
    }
    let missing = markers
        .iter()
        .copied()
        .filter(|marker| !probe.help_contains(marker))
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return Err(HarnessError::operation(format!(
            "installed {label} help does not confirm the typed mapping (missing markers: {})",
            missing.join(", ")
        )));
    }

    println!("command_surface.tool={label}");
    println!("command_surface.validated_from_installed_help=true");
    for marker in markers {
        println!("command_surface.confirmed_marker={marker}");
    }
    Ok(())
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
    is_directory: bool,
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
        let metadata = entry
            .metadata()
            .map_err(|_| HarnessError::operation("output entry metadata could not be read"))?;
        snapshot.insert(
            entry.file_name(),
            EntryFingerprint {
                length: metadata.len(),
                modified: metadata.modified().ok(),
                is_directory: metadata.is_dir(),
            },
        );
    }
    Ok(snapshot)
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
) {
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
    print_diagnostic_preview("process.stdout_preview", &reportable.stdout);
    print_diagnostic_preview("process.stderr_preview", &reportable.stderr);
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
  --mode probe|metadata|run-summary|spectrum-table|tic|spectrum|convert \
  [--proteowizard-home PATH | --proteowizard-executable EXE] \
  [--input PATH --output-dir PATH] [--spectrum-index N] \
  [--format mzML|mzXML] [--cancel-after-ms N]"#
    );
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;
    use mscanvas_proteowizard::{DiscoveryResult, DiscoverySource, ToolProbe};

    #[test]
    fn conversion_fails_closed_until_installed_help_confirms_every_planned_flag() {
        let cli = convert_cli();
        let incomplete = discovery_with_help("--outdir --mzML", "--exec metadata");
        let error = validate_installed_command_surface(&cli, &incomplete)
            .expect_err("missing zlib marker must fail closed");
        assert!(error.message.contains("missing markers: --zlib"));

        let complete = discovery_with_help("--outdir --mzML --zlib", "--exec metadata");
        validate_installed_command_surface(&cli, &complete)
            .expect("installed help confirms every conversion flag");
    }

    #[test]
    fn installed_help_with_truncated_stdout_fails_closed_even_when_markers_exist() {
        let cli = convert_cli();
        let mut discovery = discovery_with_help("--outdir --mzML --zlib", "--exec metadata");
        let probe = discovery.msconvert.probe.as_mut().expect("msconvert probe");
        probe.stdout_total_bytes += 1;
        probe.stdout_truncated = true;

        let error = validate_installed_command_surface(&cli, &discovery)
            .expect_err("truncated stdout must invalidate installed help");
        assert!(error.message.contains("truncated streams: stdout"));
    }

    #[test]
    fn installed_help_with_truncated_stderr_fails_closed_even_when_markers_exist() {
        let cli = convert_cli();
        let mut discovery = discovery_with_help("", "--exec metadata");
        let probe = discovery.msconvert.probe.as_mut().expect("msconvert probe");
        probe.stderr = b"--outdir --mzML --zlib".to_vec();
        probe.stderr_total_bytes = probe.stderr.len() as u64 + 1;
        probe.stderr_truncated = true;

        let error = validate_installed_command_surface(&cli, &discovery)
            .expect_err("truncated stderr must invalidate installed help");
        assert!(error.message.contains("truncated streams: stderr"));
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
                is_directory: false,
            },
        )]);
        let error = require_fresh_output_directory(&populated)
            .expect_err("nonempty spike directory must fail closed");
        assert!(error.message.contains("must be empty"));
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
            proteowizard_home: None,
            proteowizard_executable: None,
            input: Some(PathBuf::from("input.mzML")),
            output_dir: Some(PathBuf::from("output")),
            spectrum_index: None,
            format: Some(OpenFormat::MzMl),
            cancel_after_ms: None,
        }
    }

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
