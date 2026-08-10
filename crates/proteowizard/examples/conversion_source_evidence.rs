//! Unstable, developer-only conversion source evidence harness.
//!
//! It answers two questions the library cannot answer about itself, both of
//! which need a real backend and a real acquisition:
//!
//! 1. **What does `msconvert` actually write?** The conversion boundary insists
//!    that its private staging output directory holds exactly one entry. That
//!    rule is only correct if a faithful run writes exactly one file. This
//!    harness plans the same command the boundary plans, executes it through the
//!    same reviewed process boundary into a fresh directory, and reports the
//!    resulting layout before anything is cleaned up.
//! 2. **Does the whole sequence hold on a real acquisition?** The second stage
//!    runs `run_conversion` unchanged — private staging, output validation,
//!    handle-bound finalization, identity-bound cleanup — and reports what it
//!    established.
//!
//! Everything it prints is path-free. Names derived from an acquisition are
//! reported as a shape (extension, kind, byte length, whether the name is the
//! planned one), never as text. Raw backend streams are written only to an
//! explicitly requested local diagnostic file, and only when `--diagnostics` is
//! given; the caller is responsible for deleting it, and the harness says so.
//!
//! This example is intentionally not a stable MSCanvas CLI contract.

use std::cell::RefCell;
use std::env;
use std::ffi::{OsStr, OsString};
use std::fs;
use std::io::Write;
use std::marker::PhantomData;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::SystemTime;

use mscanvas_proteowizard::{
    AvailabilityState, CommandSpec, ConflictPolicy, ConversionPlan, ConversionRunOutcome,
    ConversionSource, ConversionSourceKind, ConversionSourceRejection, DiscoveryRequest,
    InstalledHelpCapabilities, MzmlScanLimits, OpenFormat, OutputEntryKind, ProcessError,
    ProcessOutput, ProcessRunner, Sha256Digest, SystemProcessRunner,
    build_msconvert_command_for_source, discover, execute, run_conversion,
    snapshot_output_directory,
};

fn main() -> ExitCode {
    match parse_args(env::args_os().skip(1)).and_then(run) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("error: {error}");
            ExitCode::FAILURE
        }
    }
}

/// Which evidence stages to run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Stage {
    /// Plan and execute one conversion into a fresh directory and report the
    /// exact layout the backend produced.
    Layout,
    /// Run the full conversion boundary and report what it established.
    Boundary,
    /// Both, layout first.
    Both,
}

impl Stage {
    fn parse(value: &OsStr) -> Result<Self, String> {
        match value.to_str() {
            Some("layout") => Ok(Self::Layout),
            Some("boundary") => Ok(Self::Boundary),
            Some("both") => Ok(Self::Both),
            _ => Err("--stage must be layout, boundary or both".to_owned()),
        }
    }

    const fn runs_layout(self) -> bool {
        matches!(self, Self::Layout | Self::Both)
    }

    const fn runs_boundary(self) -> bool {
        matches!(self, Self::Boundary | Self::Both)
    }
}

#[derive(Debug)]
struct Cli {
    stage: Stage,
    input: PathBuf,
    workspace: PathBuf,
    proteowizard_home: Option<PathBuf>,
    diagnostics: Option<PathBuf>,
}

fn parse_args(args: impl IntoIterator<Item = OsString>) -> Result<Cli, String> {
    let mut args = args.into_iter();
    let mut stage = Stage::Both;
    let mut input = None;
    let mut workspace = None;
    let mut proteowizard_home = None;
    let mut diagnostics = None;

    while let Some(option) = args.next() {
        let Some(name) = option.to_str() else {
            return Err("option names must be valid Unicode".to_owned());
        };
        let mut value = || {
            args.next()
                .map(PathBuf::from)
                .ok_or_else(|| format!("{name} requires a value"))
        };
        match name {
            "--help" => {
                for line in USAGE {
                    println!("{line}");
                }
                return Err(String::new());
            }
            "--stage" => {
                stage = Stage::parse(&args.next().ok_or("--stage requires a value")?)?;
            }
            "--input" => input = Some(value()?),
            "--workspace" => workspace = Some(value()?),
            "--proteowizard-home" => proteowizard_home = Some(value()?),
            "--diagnostics" => diagnostics = Some(value()?),
            other => return Err(format!("unknown option: {other}")),
        }
    }

    Ok(Cli {
        stage,
        input: input.ok_or("missing required option: --input")?,
        workspace: workspace.ok_or("missing required option: --workspace")?,
        proteowizard_home,
        diagnostics,
    })
}

/// Usage, one complete line per string so no message carries an indentation
/// that a lost line continuation would have produced.
const USAGE: [&str; 9] = [
    "Unstable developer-only conversion source evidence harness.",
    "",
    "cargo run --locked -p mscanvas-proteowizard --example conversion_source_evidence --",
    "    --input <acquisition> --workspace <empty-scratch-dir>",
    "    [--stage layout|boundary|both] [--proteowizard-home <dir>] [--diagnostics <file>]",
    "",
    "--input: an acquisition outside the repository. It is never committed.",
    "--workspace: a scratch directory this harness owns. It must be empty, and everything the harness creates inside it is removed before it returns.",
    "--diagnostics: a base path. Each stage writes its own file beside it, created no-clobber; an existing one is refused rather than overwritten, and so is the acquisition itself. The files can name the acquisition, so delete them after reading.",
];

fn run(cli: Cli) -> Result<(), String> {
    println!("warning=unstable developer-only evidence harness; no stable CLI contract");
    println!("stage={:?}", cli.stage);

    let source_facts = describe_input(&cli.input)?;
    println!("{source_facts}");

    if let Some(base) = cli.diagnostics.as_deref() {
        // The workspace may not exist yet; creating it first means the
        // containment question below has something to answer against.
        fs::create_dir_all(&cli.workspace)
            .map_err(|error| format!("the workspace could not be created: {:?}", error.kind()))?;
        require_safe_diagnostics_base(base, &cli.input, &cli.workspace)?;
    }

    let capabilities = installed_capabilities(cli.proteowizard_home.as_deref())?;

    // Which family this acquisition belongs to is decided once, by admission,
    // and both stages answer about that family.
    let source = open_source(&cli.input)?;
    // From the admitted object, so the fixture identity this evidence records is
    // the identity of the thing every stage below measures.
    println!("input.byte_length={}", source.byte_length());
    println!("input.sha256={}", source.sha256());
    println!("source.kind={}", source.kind().stable_id());
    println!(
        "source.supports_comparison={}",
        source.kind().supports_source_comparison()
    );
    println!(
        "source.requires_build_evidence={}",
        source.kind().requires_provider_build_evidence()
    );

    let workspace = prepare_workspace(&cli.workspace)?;
    let result = (|| -> Result<(), String> {
        if cli.stage.runs_layout() {
            report_layout(&cli, &capabilities, &workspace.path, &source)?;
        }
        if cli.stage.runs_boundary() {
            report_boundary(&cli, &capabilities, &workspace.path, source)?;
        }
        Ok(())
    })();
    // Everything this harness created goes, whichever way the stages ended. A
    // failure to remove it is reported rather than dropped, because the usage
    // promises it and what would be left behind is a converted document named
    // after the acquisition — and it is reported *alongside* a stage failure
    // rather than instead of it, because the two say different things and a
    // backend failure is exactly when residue is most likely.
    match (result, remove_workspace_contents(&workspace.path)) {
        (Ok(()), residue) => residue,
        (Err(failure), Ok(())) => Err(failure),
        (Err(failure), Err(residue)) => Err(format!("{failure}; additionally, {residue}")),
    }
}

/// What the acquisition is called, before anything has admitted it.
///
/// Deliberately only the extension. The length and the digest are reported
/// after admission, from the admitted object: reading them here would be a
/// third independent read of the file, and an acquisition replaced between that
/// read and the admission would leave this evidence describing one snapshot
/// while every measurement described another. A fixture identity in an evidence
/// record has to be the identity of the thing that was measured.
fn describe_input(input: &Path) -> Result<String, String> {
    let metadata = fs::symlink_metadata(input).map_err(|error| {
        format!(
            "the input could not be inspected: {kind:?}",
            kind = error.kind()
        )
    })?;
    if !metadata.is_file() {
        return Err("the input is not a regular file".to_owned());
    }
    let extension = input
        .extension()
        .and_then(OsStr::to_str)
        .unwrap_or("<none>")
        .to_owned();
    Ok(format!("input.extension={extension}"))
}

fn installed_capabilities(home: Option<&Path>) -> Result<InstalledHelpCapabilities, String> {
    let request = home.map_or_else(DiscoveryRequest::automatic, DiscoveryRequest::with_home);
    let discovery = discover(&request);
    println!("provider.availability={:?}", discovery.availability);
    println!(
        "provider.release={}",
        discovery.release.as_deref().unwrap_or("unavailable")
    );
    println!(
        "provider.source_revision={}",
        discovery
            .msconvert
            .probe
            .as_ref()
            .and_then(|probe| probe.source_revision.as_deref())
            .unwrap_or("unavailable")
    );
    println!(
        "provider.build_date={}",
        discovery.build_date.as_deref().unwrap_or("unavailable")
    );
    println!(
        "provider.executable_sha256={}",
        discovery
            .msconvert
            .executable_sha256()
            .map_or_else(|| "unavailable".to_owned(), |digest| digest.to_string())
    );
    println!("provider.same_installation={}", discovery.same_installation);

    if discovery.availability != AvailabilityState::Available {
        return Err("no usable ProteoWizard installation was discovered".to_owned());
    }
    InstalledHelpCapabilities::from_discovered_tool(&discovery.msconvert)
        .map_err(|error| format!("installed help could not be parsed: {error}"))
}

/// A scratch root the harness owns outright, held for as long as it owns it.
///
/// The handle is the point. This harness deletes the workspace's contents
/// recursively at the end, and it decides what to delete by resolving a path —
/// so a workspace renamed away and replaced between the stages and the cleanup
/// would have it recursively deleting somebody else's directory. Holding the
/// directory without delete sharing means the name cannot be made to mean a
/// different object while the harness is using it.
struct Workspace {
    path: PathBuf,
    /// Dropped after the cleanup, never before.
    _held: fs::File,
}

fn prepare_workspace(root: &Path) -> Result<Workspace, String> {
    fs::create_dir_all(root)
        .map_err(|error| format!("the workspace could not be created: {:?}", error.kind()))?;
    // Held before it is judged, not after. Checking a directory is empty and
    // then opening it leaves the interval between the two, and everything that
    // follows — the stages, the recursive cleanup — would be bound to whatever
    // the name meant at the end of it rather than to the thing that was
    // verified. Once this handle exists the name cannot be repointed, so the
    // emptiness check below reaches the object this run will actually use.
    let held = hold_directory(root)?;
    let entries = fs::read_dir(root)
        .map_err(|error| format!("the workspace could not be read: {:?}", error.kind()))?
        .count();
    if entries != 0 {
        return Err("the workspace must be empty".to_owned());
    }
    Ok(Workspace {
        path: root.to_path_buf(),
        _held: held,
    })
}

/// Opens a directory so it cannot be renamed or removed while it is held.
#[cfg(windows)]
fn hold_directory(path: &Path) -> Result<fs::File, String> {
    use std::os::windows::fs::OpenOptionsExt;

    use std::os::windows::fs::MetadataExt;

    const FILE_SHARE_READ: u32 = 0x0000_0001;
    const FILE_SHARE_WRITE: u32 = 0x0000_0002;
    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0000_0400;

    let opened = fs::OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(|error| format!("the workspace could not be held: {:?}", error.kind()))?;
    let metadata = opened
        .metadata()
        .map_err(|error| format!("the workspace could not be inspected: {:?}", error.kind()))?;
    // The open refuses to traverse a link; this refuses to act on one. Holding
    // a junction pins the link, not its target, so every path-based read and
    // the recursive cleanup would follow a target that can still be redirected
    // — which is the whole thing the hold exists to prevent.
    if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err("the workspace is a reparse point".to_owned());
    }
    if !metadata.is_dir() {
        return Err("the workspace is not a directory".to_owned());
    }
    Ok(opened)
}

/// Opens a directory. No platform outside Windows offers a mandatory share mode
/// through the standard library, so the guarantee here is narrower and is not
/// described as equivalent.
#[cfg(not(windows))]
fn hold_directory(path: &Path) -> Result<fs::File, String> {
    fs::File::open(path)
        .map_err(|error| format!("the workspace could not be held: {:?}", error.kind()))
}

fn remove_workspace_contents(root: &Path) -> Result<(), String> {
    let entries = fs::read_dir(root)
        .map_err(|error| format!("the workspace could not be re-read: {:?}", error.kind()))?;
    let mut left = 0_usize;
    for entry in entries {
        // An entry that cannot even be enumerated is residue too, and dropping
        // the error would let the harness report an empty workspace it never
        // looked at.
        let Ok(entry) = entry else {
            left += 1;
            continue;
        };
        let path = entry.path();
        let removed = if path.is_dir() {
            fs::remove_dir_all(&path)
        } else {
            fs::remove_file(&path)
        };
        if removed.is_err() {
            left += 1;
        }
    }
    if left > 0 {
        return Err(format!(
            "the harness could not remove {left} workspace entries; they may name the acquisition"
        ));
    }
    Ok(())
}

// --- Stage one: what does the backend write? --------------------------------

/// Executes the planned conversion into a fresh directory and reports the exact
/// layout it produced, before anything removes it.
///
/// This is the measurement the conversion boundary's exactly-one-entry rule
/// depends on. It is not a second conversion engine: it plans with the same
/// capability-gated planner and executes through the same reviewed process
/// boundary; it simply declines to clean up before it has looked.
fn report_layout(
    cli: &Cli,
    capabilities: &InstalledHelpCapabilities,
    workspace: &Path,
    source: &ConversionSource,
) -> Result<(), String> {
    let kind = source.kind();
    let output_directory = workspace.join("layout");
    fs::create_dir(&output_directory)
        .map_err(|error| format!("layout directory: {:?}", error.kind()))?;
    let output_file_name = planned_output_name(&cli.input)?;

    // The same planner and the same per-family source spelling the boundary
    // uses. A layout measured with a different command is a measurement of a
    // different command.
    let command = build_msconvert_command_for_source(
        capabilities,
        &cli.input,
        &output_directory,
        &output_file_name,
        OpenFormat::MzMl,
        kind.input_spelling(),
    )
    .map_err(|error| format!("the conversion could not be planned: {error}"))?;

    println!("layout.source_kind={}", kind.stable_id());
    println!("layout.input_spelling={:?}", kind.input_spelling());
    println!("layout.argv_shape={}", argv_shape(&command));

    // This stage runs the command itself rather than going through
    // `run_conversion`, so it does not inherit the boundary's hold on the
    // acquisition. It takes its own: an acquisition rewritten under this
    // measurement would make the layout evidence describe a run over bytes the
    // admitted source never had.
    let pinned = pin_acquisition(&cli.input)?;
    require_admitted_bytes(&cli.input, source, "before")?;

    let started = SystemTime::now();
    let output = execute(&command).map_err(|error| format!("the backend did not run: {error}"))?;
    let elapsed = started.elapsed().unwrap_or_default();
    require_admitted_bytes(&cli.input, source, "after")?;
    drop(pinned);

    println!("layout.termination={:?}", output.termination);
    println!("layout.exit_code={:?}", output.exit_code);
    println!("layout.backend_elapsed_ms={}", output.elapsed.as_millis());
    println!("layout.harness_elapsed_ms={}", elapsed.as_millis());
    println!("layout.stdout_total_bytes={}", output.stdout_total_bytes);
    println!("layout.stderr_total_bytes={}", output.stderr_total_bytes);
    println!("layout.stdout_truncated={}", output.stdout_truncated);
    println!("layout.stderr_truncated={}", output.stderr_truncated);
    println!(
        "layout.peak_job_memory_bytes={:?}",
        output.peak_job_memory_bytes
    );

    if let Some(base) = cli.diagnostics.as_deref() {
        write_diagnostics(&diagnostics_path(base, "layout"), &output)?;
    }

    let snapshot = snapshot_output_directory(&output_directory)
        .map_err(|error| format!("the output directory could not be read: {error}"))?;
    println!("layout.entry_count={}", snapshot.len());
    println!(
        "layout.contains_partial_output={}",
        snapshot.contains_partial_output()
    );
    for (position, entry) in snapshot.entries().iter().enumerate() {
        println!(
            "layout.entry[{position}].kind={} .is_planned_name={} .extension_is_mzml={} .byte_length={}",
            entry.kind().stable_id(),
            entry.has_name(&output_file_name),
            entry.has_extension(OpenFormat::MzMl.extension()),
            entry.byte_length()
        );
    }
    println!(
        "layout.exactly_one_planned_entry={}",
        snapshot.len() == 1
            && snapshot
                .entries()
                .first()
                .is_some_and(|entry| entry.has_name(&output_file_name)
                    && entry.kind() == OutputEntryKind::RegularFile)
    );
    Ok(())
}

/// Holds the acquisition against writers for the duration of a measurement.
///
/// The same posture the conversion boundary takes, for the same reason. Outside
/// Windows the standard library offers no mandatory share mode, so this holds
/// the object without that guarantee and the digest checks around it are what
/// remain.
fn pin_acquisition(input: &Path) -> Result<fs::File, String> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;

        const FILE_SHARE_READ: u32 = 0x0000_0001;

        fs::OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ)
            .open(input)
            .map_err(|error| format!("the acquisition could not be held: {:?}", error.kind()))
    }
    #[cfg(not(windows))]
    {
        fs::File::open(input)
            .map_err(|error| format!("the acquisition could not be held: {:?}", error.kind()))
    }
}

/// Refuses to report a measurement over bytes the admitted source did not have.
fn require_admitted_bytes(
    input: &Path,
    source: &ConversionSource,
    when: &str,
) -> Result<(), String> {
    let observed = Sha256Digest::calculate_file(input)
        .map_err(|_| format!("the acquisition could not be rehashed {when} the measurement"))?;
    if observed != source.sha256() {
        return Err(format!(
            "the acquisition is not the admitted one {when} the measurement"
        ));
    }
    Ok(())
}

/// The name the conversion plan would derive, without forming a plan.
fn planned_output_name(input: &Path) -> Result<OsString, String> {
    let stem = input
        .file_stem()
        .filter(|stem| !stem.is_empty())
        .ok_or("the input has no convertible name")?;
    let mut name = stem.to_os_string();
    name.push(".");
    name.push(OpenFormat::MzMl.extension());
    Ok(name)
}

/// The argv shape, with every path replaced by its role. Argument order and the
/// option spellings are the evidence; the paths are not reportable.
fn argv_shape(command: &CommandSpec) -> String {
    command
        .args()
        .iter()
        .map(|argument| match argument.to_str() {
            Some(text) if text.starts_with("--") => text.to_owned(),
            _ => "<path-or-name>".to_owned(),
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Where a stage's raw backend streams go.
///
/// Each stage gets its own file so a second stage cannot overwrite the first
/// one's evidence, which is exactly what a single shared destination did.
fn diagnostics_path(base: &Path, stage: &str) -> PathBuf {
    let mut name = base.as_os_str().to_owned();
    name.push(".");
    name.push(stage);
    name.push(".txt");
    PathBuf::from(name)
}

/// Refuses a diagnostics destination that would destroy something.
///
/// `--diagnostics` takes a path from a caller who is one slip away from typing
/// the acquisition's. Creation below is no-clobber, which is the guarantee;
/// this exists so the refusal says which mistake was made instead of reporting
/// that a file happened to exist.
fn require_safe_diagnostics_base(
    base: &Path,
    input: &Path,
    workspace: &Path,
) -> Result<(), String> {
    // The workspace is emptied when the harness returns, so diagnostics written
    // inside it would be created, announced as the caller's to keep, and then
    // deleted by this same run. Refusing is the honest answer: the alternative
    // is a cleanup with an exception in it, and an exception in a cleanup is how
    // the thing it was supposed to remove survives.
    if let (Ok(base_parent), Ok(workspace)) = (
        fs::canonicalize(base.parent().unwrap_or(Path::new("."))),
        fs::canonicalize(workspace),
    ) && base_parent.starts_with(&workspace)
    {
        return Err(
            "the diagnostics destination is inside the workspace, which this harness empties"
                .to_owned(),
        );
    }

    for stage in ["layout", "boundary"] {
        let path = diagnostics_path(base, stage);
        if path.exists() {
            return Err(
                "a diagnostics file already exists; this harness never overwrites one".to_owned(),
            );
        }
        if same_object(&path, input) {
            return Err("the diagnostics destination is the acquisition itself".to_owned());
        }
    }
    if same_object(base, input) {
        return Err("the diagnostics destination is the acquisition itself".to_owned());
    }
    Ok(())
}

/// Whether two paths name the same existing object.
fn same_object(left: &Path, right: &Path) -> bool {
    match (fs::canonicalize(left), fs::canonicalize(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

/// Writes the raw backend streams to a local file the caller must delete.
///
/// Raw backend output can name the acquisition, so it never enters the printed
/// evidence and never leaves this file. The file is created no-clobber: this
/// harness will not truncate anything, least of all an acquisition somebody
/// pointed it at by mistake.
fn write_diagnostics(path: &Path, output: &ProcessOutput) -> Result<(), String> {
    let mut file = fs::File::create_new(path).map_err(|error| {
        format!(
            "the diagnostics file could not be created: {:?}",
            error.kind()
        )
    })?;
    let write = |file: &mut fs::File, label: &str, bytes: &[u8]| -> std::io::Result<()> {
        writeln!(
            file,
            "--- {label} ({len} captured bytes) ---",
            len = bytes.len()
        )?;
        file.write_all(bytes)?;
        writeln!(file)
    };
    write(&mut file, "stdout", &output.stdout)
        .and_then(|()| write(&mut file, "stderr", &output.stderr))
        .map_err(|error| {
            format!(
                "the diagnostics file could not be written: {:?}",
                error.kind()
            )
        })?;
    println!("diagnostics.written=true");
    println!("diagnostics.retention=caller_must_delete");
    Ok(())
}

// --- Stage two: the whole boundary ------------------------------------------

/// A runner that keeps the streams the boundary deliberately drops.
///
/// The conversion boundary's result is path-free by construction, so raw stdout
/// and stderr never reach it. A harness that wants them takes them at the
/// `ProcessRunner` seam, which is where the ADR records that a diagnostic sink
/// belongs.
struct CapturingRunner<'a> {
    inner: SystemProcessRunner,
    diagnostics: Option<PathBuf>,
    /// A diagnostics failure cannot be returned through `ProcessRunner`, whose
    /// error type belongs to the process boundary. It is kept and raised by the
    /// caller instead of being dropped, because a run that reports `finalized`
    /// while silently failing to save the evidence the caller explicitly asked
    /// for is the harness lying about what it did.
    diagnostics_failure: RefCell<Option<String>>,
    _lifetime: PhantomData<&'a ()>,
}

impl ProcessRunner for CapturingRunner<'_> {
    fn run(&self, spec: &CommandSpec) -> Result<ProcessOutput, ProcessError> {
        let output = self.inner.run(spec)?;
        if let Some(path) = self.diagnostics.as_deref()
            && let Err(error) = write_diagnostics(path, &output)
        {
            *self.diagnostics_failure.borrow_mut() = Some(error);
        }
        Ok(output)
    }
}

fn report_boundary(
    cli: &Cli,
    capabilities: &InstalledHelpCapabilities,
    workspace: &Path,
    source: ConversionSource,
) -> Result<(), String> {
    let destination_root = workspace.join("destination");
    fs::create_dir(&destination_root)
        .map_err(|error| format!("destination root: {:?}", error.kind()))?;

    println!("boundary.source_kind={}", source.kind().stable_id());
    println!("boundary.source_byte_length={}", source.byte_length());
    println!("boundary.source_sha256={}", source.sha256());

    let plan = ConversionPlan::to_mzml(source, &destination_root, ConflictPolicy::Fail)
        .map_err(|error| format!("the conversion could not be planned: {error}"))?;

    let runner = CapturingRunner {
        inner: SystemProcessRunner,
        diagnostics: cli
            .diagnostics
            .as_deref()
            .map(|base| diagnostics_path(base, "boundary")),
        diagnostics_failure: RefCell::new(None),
        _lifetime: PhantomData,
    };
    let started = SystemTime::now();
    let report = run_conversion(&plan, capabilities, &runner);
    let elapsed = started.elapsed().unwrap_or_default();
    // Raised before anything is reported: a run that says `finalized` while
    // silently failing to save the evidence the caller asked for is the harness
    // lying about what it did.
    if let Some(failure) = runner.diagnostics_failure.borrow_mut().take() {
        return Err(failure);
    }

    println!("boundary.harness_elapsed_ms={}", elapsed.as_millis());
    if let Some(backend) = report.backend() {
        println!("boundary.backend.exit_code={:?}", backend.exit_code());
        println!(
            "boundary.backend.elapsed_ms={}",
            backend.elapsed().as_millis()
        );
        println!(
            "boundary.backend.stdout_truncated={}",
            backend.stdout_truncated()
        );
        println!(
            "boundary.backend.stderr_truncated={}",
            backend.stderr_truncated()
        );
        println!(
            "boundary.backend.peak_job_memory_bytes={:?}",
            backend.peak_job_memory_bytes()
        );
    }
    println!(
        "boundary.residue={}",
        report
            .residue()
            .map_or("none", |residue| residue.stable_id())
    );

    match report.outcome() {
        ConversionRunOutcome::Finalized(finalized) => {
            let valid = finalized.valid();
            println!("boundary.outcome=finalized");
            println!(
                "boundary.validation_mode={}",
                valid.validation_mode().stable_id()
            );
            println!(
                "boundary.output_byte_length={}",
                valid.output().byte_length()
            );
            println!("boundary.output_sha256={}", valid.output().sha256());
            let facts = valid.output().facts();
            println!("boundary.output_root={}", facts.root().stable_id());
            println!(
                "boundary.output_spectra={}",
                facts.observed_spectrum_count()
            );
            println!(
                "boundary.output_chromatograms={}",
                facts.observed_chromatogram_count()
            );
            print_property_set("verified", valid.verified().iter().map(|p| p.stable_id()));
            print_property_set(
                "unverified",
                valid.unverified().iter().map(|p| p.stable_id()),
            );
            print_property_set(
                "inapplicable",
                valid.inapplicable().iter().map(|p| p.stable_id()),
            );
            print_property_set("advisory", valid.advisory().iter().map(|o| o.stable_id()));
            println!("boundary.fully_verified={}", valid.is_fully_verified());
        }
        ConversionRunOutcome::SkippedExistingDestination => {
            println!("boundary.outcome=skipped_existing_destination");
        }
        ConversionRunOutcome::Failed(failure) => {
            println!("boundary.outcome=failed");
            println!("boundary.failure={}", failure.stable_id());
            println!("boundary.failure_detail={}", failure.detailed_stable_id());
        }
    }

    let destination = snapshot_output_directory(&destination_root)
        .map_err(|error| format!("the destination root could not be read: {error}"))?;
    println!("boundary.destination_entry_count={}", destination.len());
    for (position, entry) in destination.entries().iter().enumerate() {
        println!(
            "boundary.destination[{position}].kind={} .extension_is_mzml={} .byte_length={}",
            entry.kind().stable_id(),
            entry.has_extension(OpenFormat::MzMl.extension()),
            entry.byte_length()
        );
    }
    Ok(())
}

fn print_property_set<'a>(label: &str, ids: impl Iterator<Item = &'a str>) {
    let joined = ids.collect::<Vec<_>>().join(",");
    println!(
        "boundary.{label}={}",
        if joined.is_empty() { "none" } else { &joined }
    );
}

/// Opens the acquisition under whichever source posture admits it.
///
/// There is no guessing and no fallback chain that could launder a refusal into
/// an acceptance: each posture has its own constructor with its own recognition,
/// they are tried in a fixed order, and the reason each one refused is reported.
/// An acquisition no posture admits is simply not one this boundary converts.
fn open_source(input: &Path) -> Result<ConversionSource, String> {
    let limits = MzmlScanLimits::default();
    let mut refusals = Vec::new();
    for (kind, open) in SOURCE_POSTURES {
        match open(input, limits) {
            Ok(source) => return Ok(source),
            Err(rejection) => {
                refusals.push(format!("{}:{}", kind.stable_id(), rejection.stable_id()))
            }
        }
    }
    Err(format!(
        "the acquisition was not admitted by any source posture: {}",
        refusals.join(" ")
    ))
}

type SourcePosture =
    fn(&Path, MzmlScanLimits) -> Result<ConversionSource, ConversionSourceRejection>;

/// Every posture this repository has evidence for, with the family each admits.
const SOURCE_POSTURES: [(ConversionSourceKind, SourcePosture); 3] = [
    (
        ConversionSourceKind::MzmlFile,
        ConversionSource::open_mzml_file,
    ),
    (
        ConversionSourceKind::ThermoRawFile,
        ConversionSource::open_thermo_raw_file,
    ),
    (
        ConversionSourceKind::ShimadzuLcdFile,
        ConversionSource::open_shimadzu_lcd_file,
    ),
];
