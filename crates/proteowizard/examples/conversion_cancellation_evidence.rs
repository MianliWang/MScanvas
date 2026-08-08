//! Unstable, developer-only ProteoWizard cancellation evidence harness.
//!
//! It answers what the library cannot answer about itself: whether a *real*
//! `msconvert` process, launched through the reviewed process boundary and
//! owned by a Windows Job Object, can be stopped on request, and what it leaves
//! behind when it is.
//!
//! Every scenario runs the production path — the same
//! [`SystemProcessRunner`](mscanvas_proteowizard::SystemProcessRunner), the same
//! `run_conversion` sequence through its cancellable entry point, the same
//! private staging, the same identity-bound cleanup. The harness contributes a
//! cancellation request at a deterministic, observable milestone and a record of
//! what happened; it converts nothing itself.
//!
//! The private staging tree is polled while the backend runs. That is evidence
//! only: cleanup decides what to delete from objects it holds and identities it
//! proves, never from anything this harness observed. A poll that misses,
//! races, or reads a directory mid-write costs a line of the record and changes
//! no outcome.
//!
//! Everything it prints is path-free and name-free. Raw backend streams never
//! reach it, because the conversion boundary's result does not carry them.
//!
//! This example is intentionally not a stable MSCanvas CLI contract.

use std::env;
use std::ffi::OsString;
use std::fmt::Write as _;
use std::fs;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use mscanvas_proteowizard::{
    AvailabilityState, BackendRunFacts, CancellationRequest, CancellationToken, CommandSpec,
    ConflictPolicy, ConversionAttempt, ConversionCancellation, ConversionPlan,
    ConversionRunOutcome, ConversionSource, ConversionSourceKind, ConversionSourceRejection,
    DiscoveryRequest, InstalledHelpCapabilities, MzmlScanLimits, OpenFormat, OutputEntryKind,
    ProcessError, ProcessOutput, ProcessRunner, SystemProcessRunner, Termination, discover,
    provider_build_is_evidenced, run_conversion, run_conversion_cancellable,
    snapshot_output_directory,
};

/// How long any milestone may be waited for before the scenario gives up and
/// says so. A harness that waits without a bound turns a backend that never
/// writes into a hang rather than into evidence.
const MILESTONE_TIMEOUT: Duration = Duration::from_secs(120);

/// How often the private staging tree is sampled. Small enough that a growing
/// file is caught between two observations, large enough not to be the reason a
/// conversion is slow.
const POLL_INTERVAL: Duration = Duration::from_millis(10);

fn main() -> ExitCode {
    match parse_args(env::args_os().skip(1)).and_then(run) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            if !error.is_empty() {
                eprintln!("error: {error}");
            }
            ExitCode::FAILURE
        }
    }
}

/// Usage, one complete line per string so no message carries an indentation
/// that a lost line continuation would have produced.
const USAGE: [&str; 12] = [
    "Unstable developer-only ProteoWizard cancellation evidence harness.",
    "",
    "cargo run --locked -p mscanvas-proteowizard --example conversion_cancellation_evidence --",
    "    --workspace <empty-scratch-dir>",
    "    [--thermo-input <lawful-thermo-raw-acquisition>]",
    "    [--spectra <count>] [--peaks <count>] [--proteowizard-home <dir>]",
    "",
    "--workspace: a scratch directory this harness owns. It must be empty, and everything the harness creates inside it is removed before it returns.",
    "--thermo-input: an acquisition outside the repository. It is read, never written, never copied into the repository and never named in the record.",
    "--spectra, --peaks: bound the generated mzML workload. It is written inside the workspace and removed with it.",
    "",
    "The installed backend must be the exact build this repository has vendor evidence for. Any other installation is refused.",
];

#[derive(Debug)]
struct Cli {
    workspace: PathBuf,
    thermo_input: Option<PathBuf>,
    spectra: u32,
    peaks: u32,
    proteowizard_home: Option<PathBuf>,
}

fn parse_args(args: impl IntoIterator<Item = OsString>) -> Result<Cli, String> {
    let mut args = args.into_iter();
    let mut workspace = None;
    let mut thermo_input = None;
    let mut spectra = 3_000_u32;
    let mut peaks = 500_u32;
    let mut proteowizard_home = None;

    while let Some(option) = args.next() {
        let Some(name) = option.to_str() else {
            return Err("option names must be valid Unicode".to_owned());
        };
        let mut path_value = || {
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
            "--workspace" => workspace = Some(path_value()?),
            "--thermo-input" => thermo_input = Some(path_value()?),
            "--proteowizard-home" => proteowizard_home = Some(path_value()?),
            "--spectra" => spectra = count_value(args.next(), name)?,
            "--peaks" => peaks = count_value(args.next(), name)?,
            other => return Err(format!("unknown option: {other}")),
        }
    }

    if spectra == 0 || peaks == 0 {
        return Err("--spectra and --peaks must both be at least one".to_owned());
    }
    Ok(Cli {
        workspace: workspace.ok_or("missing required option: --workspace")?,
        thermo_input,
        spectra,
        peaks,
        proteowizard_home,
    })
}

fn count_value(value: Option<OsString>, name: &str) -> Result<u32, String> {
    value
        .and_then(|value| value.to_str().and_then(|text| text.parse().ok()))
        .ok_or_else(|| format!("{name} requires a whole number"))
}

fn run(cli: Cli) -> Result<(), String> {
    println!("warning=unstable developer-only evidence harness; no stable CLI contract");

    let capabilities = installed_capabilities(cli.proteowizard_home.as_deref())?;
    let workspace = prepare_workspace(&cli.workspace)?;
    let result = run_scenarios(&cli, &capabilities, &workspace.path);
    // Everything this harness created goes, whichever way the scenarios ended.
    // A failure to remove it is reported alongside a scenario failure rather
    // than instead of it: the two say different things, and a cancelled backend
    // is exactly when residue is most likely.
    match (result, remove_workspace_contents(&workspace.path)) {
        (Ok(()), residue) => residue,
        (Err(failure), Ok(())) => Err(failure),
        (Err(failure), Err(residue)) => Err(format!("{failure}; additionally, {residue}")),
    }
}

fn run_scenarios(
    cli: &Cli,
    capabilities: &InstalledHelpCapabilities,
    workspace: &Path,
) -> Result<(), String> {
    let generated = generate_mzml_workload(workspace, cli.spectra, cli.peaks)?;
    println!("workload.generated.spectra={}", cli.spectra);
    println!("workload.generated.peaks_per_spectrum={}", cli.peaks);
    println!("workload.generated.byte_length={}", generated.byte_length);

    // One uncancelled run of the same workload, into its own destination. It
    // establishes that this workload converts at all on this build, and it is
    // the measured duration the natural-exit race is timed against — a race
    // timed against a guess is not evidence about an ordering rule.
    let baseline = measure_natural_run(capabilities, workspace, &generated.path)?;

    scenario(
        "before_run",
        capabilities,
        workspace,
        &generated.path,
        Milestone::BeforeRun,
    )?;
    scenario(
        "early",
        capabilities,
        workspace,
        &generated.path,
        Milestone::StagedOutputAppeared,
    )?;
    scenario(
        "mid_write",
        capabilities,
        workspace,
        &generated.path,
        Milestone::StagedOutputGrew,
    )?;
    scenario(
        "natural_exit_race",
        capabilities,
        workspace,
        &generated.path,
        Milestone::Elapsed(baseline),
    )?;
    scenario_after_process_exit(capabilities, workspace, &generated.path)?;

    match cli.thermo_input.as_deref() {
        Some(input) => {
            // The point of this one is that the evidenced *vendor reader* can
            // be terminated, so the milestone has to be one only a launched
            // process can reach. The staging area is not: it exists before the
            // command is planned, and the executor's pre-spawn checks are long
            // enough that a request made then is refused before any process
            // exists — correct behaviour, and no evidence at all about the
            // reader. A staged entry is written by the reader itself.
            scenario(
                "thermo_early",
                capabilities,
                workspace,
                input,
                Milestone::StagedOutputAppeared,
            )?;
        }
        None => println!("thermo_early.skipped=no_thermo_input_supplied"),
    }
    Ok(())
}

// --- The provider gate ------------------------------------------------------

/// Refuses anything but the exact installation this repository has evidence
/// for.
///
/// The gate is the library's own predicate rather than a second copy of the
/// release, revision and digest strings. A harness that re-implemented the rule
/// would be a second rule the moment either changed, and the whole value of the
/// gate is that it is one.
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
        "provider.executable_sha256={}",
        discovery
            .msconvert
            .executable_sha256()
            .map_or_else(|| "unavailable".to_owned(), |digest| digest.to_string())
    );

    if discovery.availability != AvailabilityState::Available {
        return Err("no usable ProteoWizard installation was discovered".to_owned());
    }
    let capabilities = InstalledHelpCapabilities::from_discovered_tool(&discovery.msconvert)
        .map_err(|error| format!("installed help could not be parsed: {error}"))?;
    let evidenced = provider_build_is_evidenced(&capabilities, ConversionSourceKind::ThermoRawFile);
    println!("provider.is_evidenced_build={evidenced}");
    if !evidenced {
        return Err(
            "the installed build is not the one this repository has vendor evidence for".to_owned(),
        );
    }
    Ok(capabilities)
}

// --- The generated workload -------------------------------------------------

struct GeneratedWorkload {
    path: PathBuf,
    byte_length: u64,
}

/// Writes a bounded, valid mzML document outside the repository.
///
/// It exists because the one lawful vendor fixture converts in about half a
/// second, which is below any milestone a cancellation can be requested at. It
/// carries no personal, clinical or proprietary content: the peaks are a
/// deterministic arithmetic ramp, and every identifier in the document is one
/// this function wrote.
fn generate_mzml_workload(
    workspace: &Path,
    spectra: u32,
    peaks: u32,
) -> Result<GeneratedWorkload, String> {
    let directory = workspace.join("workload");
    fs::create_dir(&directory).map_err(|error| format!("workload: {:?}", error.kind()))?;
    let path = directory.join("cancellation-workload.mzML");
    let mut file = fs::File::create_new(&path)
        .map_err(|error| format!("workload document: {:?}", error.kind()))?;

    let mut document = String::with_capacity(1 << 20);
    document.push_str(MZML_PROLOGUE);
    let _ = write!(
        document,
        r#"<run id="R1" defaultInstrumentConfigurationRef="IC1"><spectrumList count="{spectra}" defaultDataProcessingRef="DP1">"#
    );
    let mut mz = Vec::with_capacity(peaks as usize * 8);
    let mut intensity = Vec::with_capacity(peaks as usize * 8);
    let mut encoded = String::new();
    for index in 0..spectra {
        mz.clear();
        intensity.clear();
        for peak in 0..peaks {
            let position = 100.0_f64 + f64::from(peak) * 0.01 + f64::from(index % 7) * 0.001;
            let height = 1_000.0_f64 + f64::from((peak + index) % 4_096);
            mz.extend_from_slice(&position.to_le_bytes());
            intensity.extend_from_slice(&height.to_le_bytes());
        }
        let _ = write!(
            document,
            r#"<spectrum index="{index}" id="scan={scan}" defaultArrayLength="{peaks}"><cvParam cvRef="MS" accession="MS:1000511" name="ms level" value="1"/><cvParam cvRef="MS" accession="MS:1000128" name="profile spectrum" value=""/><cvParam cvRef="MS" accession="MS:1000579" name="MS1 spectrum" value=""/><scanList count="1"><cvParam cvRef="MS" accession="MS:1000795" name="no combination" value=""/><scan><cvParam cvRef="MS" accession="MS:1000016" name="scan start time" value="{start_time:.4}" unitCvRef="UO" unitAccession="UO:0000010" unitName="second"/></scan></scanList><binaryDataArrayList count="2">"#,
            scan = index + 1,
            start_time = f64::from(index) * 0.05,
        );
        for (accession, name, unit, payload) in [
            (
                "MS:1000514",
                "m/z array",
                r#" unitCvRef="MS" unitAccession="MS:1000040" unitName="m/z""#,
                &mz,
            ),
            (
                "MS:1000515",
                "intensity array",
                r#" unitCvRef="MS" unitAccession="MS:1000131" unitName="number of detector counts""#,
                &intensity,
            ),
        ] {
            encoded.clear();
            encode_base64(payload, &mut encoded);
            let _ = write!(
                document,
                r#"<binaryDataArray encodedLength="{length}"><cvParam cvRef="MS" accession="MS:1000523" name="64-bit float" value=""/><cvParam cvRef="MS" accession="MS:1000576" name="no compression" value=""/><cvParam cvRef="MS" accession="{accession}" name="{name}" value=""{unit}/><binary>{encoded}</binary></binaryDataArray>"#,
                length = encoded.len(),
            );
        }
        document.push_str("</binaryDataArrayList></spectrum>");

        // Flushed periodically so a large workload is not held whole in memory
        // twice over.
        if document.len() > (1 << 22) {
            file.write_all(document.as_bytes())
                .map_err(|error| format!("workload document: {:?}", error.kind()))?;
            document.clear();
        }
    }
    document.push_str("</spectrumList></run></mzML>");
    file.write_all(document.as_bytes())
        .map_err(|error| format!("workload document: {:?}", error.kind()))?;
    file.sync_all()
        .map_err(|error| format!("workload document: {:?}", error.kind()))?;
    let byte_length = file
        .metadata()
        .map_err(|error| format!("workload document: {:?}", error.kind()))?
        .len();
    Ok(GeneratedWorkload { path, byte_length })
}

/// Everything above the run element. A raw string, so no escape in it can be
/// misread and nothing here is a user-facing message.
const MZML_PROLOGUE: &str = r#"<?xml version="1.0" encoding="utf-8"?><mzML xmlns="http://psi.hupo.org/ms/mzml" version="1.1.0" id="mscanvas_cancellation_workload"><cvList count="2"><cv id="MS" fullName="PSI-MS" version="4.1.0" URI="https://raw.githubusercontent.com/HUPO-PSI/psi-ms-CV/master/psi-ms.obo"/><cv id="UO" fullName="Unit Ontology" version="09:04:2014" URI="https://raw.githubusercontent.com/bio-ontology-research-group/unit-ontology/master/unit.obo"/></cvList><fileDescription><fileContent><cvParam cvRef="MS" accession="MS:1000579" name="MS1 spectrum" value=""/></fileContent></fileDescription><softwareList count="1"><software id="mscanvas" version="0"><cvParam cvRef="MS" accession="MS:1000799" name="custom unreleased software tool" value=""/></software></softwareList><instrumentConfigurationList count="1"><instrumentConfiguration id="IC1"><cvParam cvRef="MS" accession="MS:1000031" name="instrument model" value=""/></instrumentConfiguration></instrumentConfigurationList><dataProcessingList count="1"><dataProcessing id="DP1"><processingMethod order="0" softwareRef="mscanvas"><cvParam cvRef="MS" accession="MS:1000544" name="Conversion to mzML" value=""/></processingMethod></dataProcessing></dataProcessingList>"#;

const BASE64_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Standard base64 with padding. Written here rather than taken as a
/// dependency: this is a developer harness, and a production dependency added
/// for an example would be a dependency the product carries.
fn encode_base64(bytes: &[u8], out: &mut String) {
    out.reserve(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let triple = chunk
            .iter()
            .enumerate()
            .fold(0_u32, |packed, (index, byte)| {
                packed | (u32::from(*byte) << (16 - 8 * index))
            });
        for position in 0..4_usize {
            if position <= chunk.len() {
                let shift = 18 - 6 * position;
                out.push(char::from(
                    BASE64_ALPHABET[((triple >> shift) & 0x3F) as usize],
                ));
            } else {
                out.push('=');
            }
        }
    }
}

// --- Scenarios --------------------------------------------------------------

/// When the request is made.
#[derive(Debug, Clone, Copy)]
enum Milestone {
    /// Before the attempt begins.
    BeforeRun,
    /// The staging area holds an entry the backend put there, which means the
    /// process launched, was assigned to the owned job before the capture
    /// threads started, and has begun writing.
    StagedOutputAppeared,
    /// A staged entry holds bytes and was observed to grow between two
    /// observations, which means the backend is actively writing.
    StagedOutputGrew,
    /// A fixed interval measured from an uncancelled run of the same workload.
    Elapsed(Duration),
}

impl Milestone {
    const fn stable_id(self) -> &'static str {
        match self {
            Self::BeforeRun => "before_run",
            Self::StagedOutputAppeared => "staged_output_appeared",
            Self::StagedOutputGrew => "staged_output_grew",
            Self::Elapsed(_) => "measured_natural_duration",
        }
    }
}

/// Runs one uncancelled conversion and reports how long the backend process
/// itself took.
///
/// The backend interval is what the natural-exit race is timed against. Timing
/// it against the whole run would put the request after the process had already
/// exited, which proves nothing about an ordering rule; timing it against a
/// guess would prove nothing at all.
fn measure_natural_run(
    capabilities: &InstalledHelpCapabilities,
    workspace: &Path,
    input: &Path,
) -> Result<Duration, String> {
    let destination = fresh_destination(workspace, "baseline")?;
    let plan = plan_for(input, &destination)?;
    let started = Instant::now();
    let report = run_conversion(&plan, capabilities, &SystemProcessRunner);
    let elapsed = started.elapsed();

    println!("baseline.outcome={}", report.outcome().stable_id());
    println!("baseline.detail={}", report.outcome().detailed_stable_id());
    // A baseline that never launched has no natural backend duration to be a
    // baseline of. Folding that into zero would time the race at nothing, turn
    // it into an immediate cancellation, and still record it under a label
    // that claims it raced a natural exit. Refusing is the only honest answer:
    // there is no ordering evidence to be had from a run that did not happen.
    let backend_elapsed = report
        .backend()
        .map(BackendRunFacts::elapsed)
        .ok_or("the baseline never ran a backend, so there is no natural duration to race")?;
    println!(
        "baseline.backend_elapsed_ms={}",
        backend_elapsed.as_millis()
    );
    println!("baseline.harness_elapsed_ms={}", elapsed.as_millis());
    println!(
        "baseline.residue={}",
        report
            .residue()
            .map_or("none", |residue| residue.stable_id())
    );
    let destination_entries = snapshot_output_directory(&destination)
        .map_err(|error| format!("the baseline destination could not be read: {error}"))?;
    println!(
        "baseline.destination_entry_count={}",
        destination_entries.len()
    );
    if !matches!(report.outcome(), ConversionRunOutcome::Finalized(_)) {
        // Not fatal. The cancellation evidence does not depend on this workload
        // passing the integrity contract, and saying so is better than a
        // harness that refuses to measure anything because one control failed.
        println!("baseline.note=the generated workload did not finalize on this build");
    }
    remove_directory(&destination)?;
    Ok(backend_elapsed)
}

fn scenario(
    label: &str,
    capabilities: &InstalledHelpCapabilities,
    workspace: &Path,
    input: &Path,
    milestone: Milestone,
) -> Result<(), String> {
    let destination = fresh_destination(workspace, label)?;
    let plan = plan_for(input, &destination)?;
    println!("{label}.milestone={}", milestone.stable_id());

    let cancellation = ConversionCancellation::new();
    let request = cancellation.request_handle();
    if matches!(milestone, Milestone::BeforeRun) {
        request.request();
    }

    let plan = &plan;
    let started = Instant::now();
    // The watcher waits for something the backend may never do. Without this it
    // would be waiting on a process that has already gone, and a run whose
    // milestone is unreachable — a workload too small to be caught mid-write,
    // say — would cost the full timeout per scenario to learn nothing.
    let settled = AtomicBool::new(false);
    let settled_watch = &settled;
    // The moment the run hands its command to the process boundary. A duration
    // measured from the scenario's own start would include opening and holding
    // the destination root, rehashing the whole acquisition and creating the
    // staging area — none of which the backend's own elapsed time covers — so
    // an interval timed against a backend duration would land the request
    // proportionally earlier the larger the acquisition is.
    let (launch_sender, launch) = mpsc::sync_channel(1);
    let runner = LaunchSignallingRunner {
        inner: SystemProcessRunner,
        launched: launch_sender,
    };
    let runner = &runner;
    let (attempt, observation, request_to_return, run_elapsed) = thread::scope(|scope| {
        let worker = scope.spawn(move || {
            let attempt = run_conversion_cancellable(plan, capabilities, runner, cancellation);
            settled_watch.store(true, Ordering::Release);
            (attempt, started.elapsed())
        });

        let observation = match milestone {
            Milestone::BeforeRun => StagingObservation::not_watched(),
            Milestone::Elapsed(interval) => {
                wait_for_interval(&launch, interval, &destination, &settled)
            }
            other => watch_staging(&destination, other, &settled),
        };
        let requested_at = Instant::now();
        request.request();
        let (attempt, run_elapsed) = worker
            .join()
            .map_err(|_| "the conversion thread panicked".to_owned())?;
        Ok::<_, String>((attempt, observation, requested_at.elapsed(), run_elapsed))
    })?;

    println!("{label}.request_reached_milestone={}", observation.reached);
    println!(
        "{label}.attempt_settled_before_milestone={}",
        observation.settled_first
    );
    println!(
        "{label}.milestone_wait_ms={}",
        observation.waited.as_millis()
    );
    println!(
        "{label}.observed_staged_entries={}",
        observation.entry_count
    );
    println!(
        "{label}.observed_staged_directories={}",
        observation.directory_count
    );
    println!(
        "{label}.observed_staged_bytes_first={}",
        observation.first_bytes.map_or(-1, cast_bytes)
    );
    println!(
        "{label}.observed_staged_bytes_last={}",
        observation.last_bytes.map_or(-1, cast_bytes)
    );
    println!("{label}.observed_growth={}", observation.growth_observed);
    println!(
        "{label}.observed_partial_suffix={}",
        observation.partial_suffix_observed
    );
    println!(
        "{label}.request_to_return_ms={}",
        request_to_return.as_millis()
    );
    println!("{label}.run_elapsed_ms={}", run_elapsed.as_millis());
    println!("{label}.attempt={}", attempt.stable_id());
    println!("{label}.attempt_detail={}", attempt.detailed_stable_id());

    match &attempt {
        ConversionAttempt::Completed(report) => {
            println!("{label}.completed_outcome={}", report.outcome().stable_id());
            println!(
                "{label}.completed_detail={}",
                report.outcome().detailed_stable_id()
            );
            print_backend(label, report.backend());
            println!(
                "{label}.residue={}",
                report
                    .residue()
                    .map_or("none", |residue| residue.stable_id())
            );
        }
        ConversionAttempt::Cancelled(report) => {
            println!("{label}.observation={}", report.observation().stable_id());
            println!("{label}.backend_was_run={}", report.backend_was_run());
            print_backend(label, report.backend());
            println!(
                "{label}.surviving_processes={}",
                report.surviving_processes().map_or(-1, i64::from)
            );
            match report.staged_content() {
                Some(staged) => {
                    println!("{label}.staged_entry_count={}", staged.entry_count());
                    println!(
                        "{label}.staged_directory_count={}",
                        staged.directory_count()
                    );
                    println!(
                        "{label}.staged_non_empty_file={}",
                        staged.non_empty_file_observed()
                    );
                }
                None => println!("{label}.staged_entry_count=unobserved"),
            }
            println!(
                "{label}.residue={}",
                report
                    .residue()
                    .map_or("none", |residue| residue.stable_id())
            );
        }
        ConversionAttempt::CancellationFailed(failure) => {
            println!(
                "{label}.cancellation_failure={}",
                failure.cause().stable_id()
            );
            println!(
                "{label}.residue={}",
                failure
                    .residue()
                    .map_or("none", |residue| residue.stable_id())
            );
        }
    }

    // What is actually in the user's destination root afterwards, read from the
    // filesystem rather than from the report that describes it.
    let destination_entries = snapshot_output_directory(&destination)
        .map_err(|error| format!("the destination root could not be read: {error}"))?;
    println!(
        "{label}.destination_entry_count={}",
        destination_entries.len()
    );
    for entry in destination_entries.entries() {
        println!(
            "{label}.destination_entry.kind={} .extension_is_mzml={} .byte_length={}",
            entry.kind().stable_id(),
            entry.has_extension(OpenFormat::MzMl.extension()),
            entry.byte_length()
        );
    }
    println!(
        "{label}.staging_removed={}",
        destination_entries
            .entries()
            .iter()
            .all(|entry| entry.kind() != OutputEntryKind::Directory)
    );
    println!("{label}.finalized_output={}", attempt.finalized().is_some());

    remove_directory(&destination)?;
    Ok(())
}

/// The deterministic half of the ordering rule, against the real backend.
///
/// The empirical race above lands the request near natural completion and
/// reports whichever side won, which is honest but is not a proof. This makes
/// the ordering certain: the request is issued by a runner that has already
/// seen the real process exit normally, so completion is observed strictly
/// before the request can be. The attempt must therefore be an ordinary
/// completed conversion, and the output it produced must take its final name.
fn scenario_after_process_exit(
    capabilities: &InstalledHelpCapabilities,
    workspace: &Path,
    input: &Path,
) -> Result<(), String> {
    const LABEL: &str = "request_after_process_exit";
    let destination = fresh_destination(workspace, LABEL)?;
    let plan = plan_for(input, &destination)?;

    let cancellation = ConversionCancellation::new();
    let runner = LateRequestRunner {
        inner: SystemProcessRunner,
        request: cancellation.request_handle(),
    };
    let attempt = run_conversion_cancellable(&plan, capabilities, &runner, cancellation);

    println!("{LABEL}.milestone=request_issued_after_the_process_was_observed_to_exit");
    println!("{LABEL}.attempt={}", attempt.stable_id());
    println!("{LABEL}.attempt_detail={}", attempt.detailed_stable_id());
    println!("{LABEL}.finalized_output={}", attempt.finalized().is_some());
    if let ConversionAttempt::Completed(report) = &attempt {
        print_backend(LABEL, report.backend());
        println!(
            "{LABEL}.residue={}",
            report
                .residue()
                .map_or("none", |residue| residue.stable_id())
        );
    }
    let entries = snapshot_output_directory(&destination)
        .map_err(|error| format!("the destination root could not be read: {error}"))?;
    println!("{LABEL}.destination_entry_count={}", entries.len());
    for entry in entries.entries() {
        println!(
            "{LABEL}.destination_entry.kind={} .extension_is_mzml={} .byte_length={}",
            entry.kind().stable_id(),
            entry.has_extension(OpenFormat::MzMl.extension()),
            entry.byte_length()
        );
    }
    remove_directory(&destination)?;
    Ok(())
}

/// Delegates to the production runner and records when it was entered.
///
/// It owns no child, no job, no capture and no wait. It sends one timestamp, so
/// an interval expressed in backend time can be timed from something close to
/// the launch rather than from the scenario's own beginning.
struct LaunchSignallingRunner {
    inner: SystemProcessRunner,
    launched: mpsc::SyncSender<Instant>,
}

impl ProcessRunner for LaunchSignallingRunner {
    fn run(&self, spec: &CommandSpec) -> Result<ProcessOutput, ProcessError> {
        let _ = self.launched.try_send(Instant::now());
        self.inner.run(spec)
    }

    fn run_cancellable(
        &self,
        spec: &CommandSpec,
        cancellation: &CancellationToken,
    ) -> Result<ProcessOutput, ProcessError> {
        // Sent before delegating, and never allowed to block: a scenario that
        // is not watching for it must not be able to wedge the conversion.
        let _ = self.launched.try_send(Instant::now());
        self.inner.run_cancellable(spec, cancellation)
    }
}

/// Delegates every decision to the production runner and issues the request the
/// instant that runner reports an ordinary exit.
///
/// It is not a second subprocess implementation and cannot become one: it owns
/// no child, no job, no capture and no wait. It observes one boolean of the
/// result the real runner produced.
struct LateRequestRunner {
    inner: SystemProcessRunner,
    request: CancellationRequest,
}

impl ProcessRunner for LateRequestRunner {
    fn run(&self, spec: &CommandSpec) -> Result<ProcessOutput, ProcessError> {
        self.inner.run(spec)
    }

    fn run_cancellable(
        &self,
        spec: &CommandSpec,
        cancellation: &CancellationToken,
    ) -> Result<ProcessOutput, ProcessError> {
        let output = self.inner.run_cancellable(spec, cancellation)?;
        if output.termination == Termination::Exited {
            self.request.request();
        }
        Ok(output)
    }
}

fn print_backend(label: &str, backend: Option<BackendRunFacts>) {
    let Some(facts) = backend else {
        println!("{label}.backend=absent");
        return;
    };
    println!("{label}.backend_exit_code={:?}", facts.exit_code());
    println!("{label}.backend_elapsed_ms={}", facts.elapsed().as_millis());
    println!(
        "{label}.backend_stdout_truncated={}",
        facts.stdout_truncated()
    );
    println!(
        "{label}.backend_stderr_truncated={}",
        facts.stderr_truncated()
    );
    println!(
        "{label}.backend_peak_job_memory_bytes={}",
        facts.peak_job_memory_bytes().map_or(-1, cast_bytes)
    );
}

fn cast_bytes(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

// --- Watching the private staging tree --------------------------------------

/// Bounded shape facts about the private staging tree, gathered while the
/// backend ran. Evidence only.
#[derive(Debug, Default)]
struct StagingObservation {
    reached: bool,
    waited: Duration,
    entry_count: usize,
    directory_count: usize,
    first_bytes: Option<u64>,
    last_bytes: Option<u64>,
    growth_observed: bool,
    partial_suffix_observed: bool,
    /// The attempt returned before the milestone was reached. The record says
    /// so, because "the milestone was missed" and "the conversion was over" are
    /// different reasons for the same missing observation.
    settled_first: bool,
}

impl StagingObservation {
    fn not_watched() -> Self {
        Self {
            reached: true,
            ..Self::default()
        }
    }

    /// Whether the wait should stop because the attempt is over.
    ///
    /// Checked after an observation rather than before one, so a milestone the
    /// backend reached in its last moments is still recorded.
    fn stop_on(&mut self, settled: &AtomicBool) -> bool {
        if settled.load(Ordering::Acquire) {
            self.settled_first = true;
            return true;
        }
        false
    }
}

/// Polls the destination root for the staging tree MSCanvas creates inside it,
/// until `milestone` is reached, the attempt settles, or the bound expires.
///
/// It resolves the staging root by shape — the one directory a run puts in the
/// destination root — rather than by reconstructing its name, so it depends on
/// nothing the boundary keeps private and cannot be made to watch a path the
/// run never used.
fn watch_staging(
    destination: &Path,
    milestone: Milestone,
    settled: &AtomicBool,
) -> StagingObservation {
    let started = Instant::now();
    let mut observation = StagingObservation::default();
    while started.elapsed() < MILESTONE_TIMEOUT {
        let Some(staging_output) = staging_output_directory(destination) else {
            if observation.stop_on(settled) {
                break;
            }
            thread::sleep(POLL_INTERVAL);
            continue;
        };
        let Ok(snapshot) = snapshot_output_directory(&staging_output) else {
            if observation.stop_on(settled) {
                break;
            }
            thread::sleep(POLL_INTERVAL);
            continue;
        };
        observation.entry_count = observation.entry_count.max(snapshot.len());
        observation.directory_count = observation.directory_count.max(
            snapshot
                .entries()
                .iter()
                .filter(|entry| entry.kind() == OutputEntryKind::Directory)
                .count(),
        );
        observation.partial_suffix_observed |= snapshot.contains_partial_output();
        let largest = snapshot
            .entries()
            .iter()
            .filter(|entry| entry.kind() != OutputEntryKind::Directory)
            .map(|entry| entry.byte_length())
            .max();

        if let Some(bytes) = largest {
            if observation.first_bytes.is_none() {
                observation.first_bytes = Some(bytes);
            }
            if observation.last_bytes.is_some_and(|last| bytes > last) {
                observation.growth_observed = true;
            }
            observation.last_bytes = Some(bytes);
        }

        let reached = match milestone {
            Milestone::StagedOutputAppeared => !snapshot.is_empty(),
            Milestone::StagedOutputGrew => {
                observation.growth_observed && observation.last_bytes.is_some_and(|bytes| bytes > 0)
            }
            Milestone::BeforeRun | Milestone::Elapsed(_) => true,
        };
        if reached {
            observation.reached = true;
            observation.waited = started.elapsed();
            return observation;
        }
        if observation.stop_on(settled) {
            break;
        }
        thread::sleep(POLL_INTERVAL);
    }
    observation.waited = started.elapsed();
    observation
}

/// Waits a fixed interval from the moment the run handed its command to the
/// process boundary, sampling the staging tree on the way so the record still
/// says what was there.
///
/// Timed from the launch rather than from the scenario's start, because the
/// interval it is given is a *backend* duration: everything the run does before
/// the launch — holding the destination root, rehashing the acquisition,
/// creating the staging area — is outside that measurement, and counting it
/// would land the request earlier the larger the acquisition is, until a
/// near-completion race quietly became an ordinary early cancellation.
///
/// A residual remains and is not claimed away: the signal is sent as the runner
/// is entered, and the runner reverifies the executable's digest before it
/// spawns. That is one bounded hash of the backend executable, not of the
/// acquisition, so it does not grow with the workload.
///
/// An attempt that settles inside the interval ends the wait: the race it was
/// timed for has already resolved to natural completion, and continuing to wait
/// would only delay recording that.
fn wait_for_interval(
    launch: &mpsc::Receiver<Instant>,
    interval: Duration,
    destination: &Path,
    settled: &AtomicBool,
) -> StagingObservation {
    let mut observation = StagingObservation::default();
    // A run that never reaches the process boundary never sends this. Falling
    // back to now rather than waiting out the bound keeps the scenario a
    // scenario; whatever it then observes is reported as what it is.
    let started = launch
        .recv_timeout(MILESTONE_TIMEOUT)
        .unwrap_or_else(|_| Instant::now());
    while started.elapsed() < interval {
        if let Some(staging_output) = staging_output_directory(destination)
            && let Ok(snapshot) = snapshot_output_directory(&staging_output)
        {
            observation.entry_count = observation.entry_count.max(snapshot.len());
            observation.partial_suffix_observed |= snapshot.contains_partial_output();
            if let Some(bytes) = snapshot
                .entries()
                .iter()
                .filter(|entry| entry.kind() != OutputEntryKind::Directory)
                .map(|entry| entry.byte_length())
                .max()
            {
                if observation.first_bytes.is_none() {
                    observation.first_bytes = Some(bytes);
                }
                if observation.last_bytes.is_some_and(|last| bytes > last) {
                    observation.growth_observed = true;
                }
                observation.last_bytes = Some(bytes);
            }
        }
        if observation.stop_on(settled) {
            break;
        }
        thread::sleep(POLL_INTERVAL);
    }
    observation.reached = !observation.settled_first;
    observation.waited = started.elapsed();
    observation
}

/// The directory the backend writes into, found by shape.
fn staging_output_directory(destination: &Path) -> Option<PathBuf> {
    let entries = fs::read_dir(destination).ok()?;
    for entry in entries.flatten() {
        if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            let output = entry.path().join("output");
            if output.is_dir() {
                return Some(output);
            }
        }
    }
    None
}

// --- Workspace ownership ----------------------------------------------------

/// A scratch root the harness owns outright, held for as long as it owns it.
///
/// The handle is the point: the harness removes this directory's contents by
/// resolving a path, so a workspace renamed away and replaced between the
/// scenarios and the cleanup would have it deleting somebody else's directory.
struct Workspace {
    path: PathBuf,
    /// Dropped after the cleanup, never before.
    _held: fs::File,
}

fn prepare_workspace(root: &Path) -> Result<Workspace, String> {
    fs::create_dir_all(root)
        .map_err(|error| format!("the workspace could not be created: {:?}", error.kind()))?;
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
    use std::os::windows::fs::MetadataExt;
    use std::os::windows::fs::OpenOptionsExt;

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

fn fresh_destination(workspace: &Path, label: &str) -> Result<PathBuf, String> {
    let destination = workspace.join(label);
    fs::create_dir(&destination)
        .map_err(|error| format!("{label} destination: {:?}", error.kind()))?;
    Ok(destination)
}

fn plan_for(input: &Path, destination: &Path) -> Result<ConversionPlan, String> {
    let source = open_source(input)?;
    ConversionPlan::to_mzml(source, destination, ConflictPolicy::Fail)
        .map_err(|error| format!("the conversion could not be planned: {error}"))
}

type SourcePosture =
    fn(&Path, MzmlScanLimits) -> Result<ConversionSource, ConversionSourceRejection>;

/// Every posture this repository has evidence for, with the family each admits.
const SOURCE_POSTURES: [(ConversionSourceKind, SourcePosture); 2] = [
    (
        ConversionSourceKind::MzmlFile,
        ConversionSource::open_mzml_file,
    ),
    (
        ConversionSourceKind::ThermoRawFile,
        ConversionSource::open_thermo_raw_file,
    ),
];

/// Opens the acquisition under whichever source posture admits it, in a fixed
/// order, reporting every refusal rather than guessing.
fn open_source(input: &Path) -> Result<ConversionSource, String> {
    let limits = MzmlScanLimits::default();
    let mut refusals = Vec::new();
    for (kind, open) in SOURCE_POSTURES {
        match open(input, limits) {
            Ok(source) => {
                println!("source.kind={}", source.kind().stable_id());
                println!("source.byte_length={}", source.byte_length());
                println!("source.sha256={}", source.sha256());
                return Ok(source);
            }
            Err(rejection) => {
                refusals.push(format!("{}:{}", kind.stable_id(), rejection.stable_id()));
            }
        }
    }
    Err(format!(
        "the acquisition was not admitted by any source posture: {}",
        refusals.join(" ")
    ))
}

fn remove_directory(path: &Path) -> Result<(), String> {
    fs::remove_dir_all(path).map_err(|error| {
        format!(
            "a scenario directory could not be removed: {:?}",
            error.kind()
        )
    })
}

fn remove_workspace_contents(root: &Path) -> Result<(), String> {
    let entries = fs::read_dir(root)
        .map_err(|error| format!("the workspace could not be re-read: {:?}", error.kind()))?;
    let mut left = 0_usize;
    for entry in entries {
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
            "the harness could not remove {left} workspace entries"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, Ordering};

    use super::{StagingObservation, encode_base64};

    /// A milestone the backend never reaches must not cost the full timeout.
    ///
    /// The watcher waits for something a conversion may simply not do — a
    /// workload too small to be caught mid-write, say — so the attempt settling
    /// is the other way out. It is recorded rather than silent, because "the
    /// milestone was missed" and "the conversion was over" are different
    /// reasons for the same missing observation.
    #[test]
    fn a_settled_attempt_ends_the_wait_and_says_it_did() {
        let settled = AtomicBool::new(false);
        let mut observation = StagingObservation::default();

        assert!(!observation.stop_on(&settled));
        assert!(!observation.settled_first);

        settled.store(true, Ordering::Release);
        assert!(observation.stop_on(&settled));
        assert!(observation.settled_first);
    }

    /// The generated workload is only a workload if the arrays in it decode to
    /// what the declared lengths and precisions say they are. RFC 4648 vectors,
    /// including every padding case, because a silently wrong encoder would
    /// still produce a document `msconvert` accepts and this harness would
    /// still call it evidence.
    #[test]
    fn the_generator_encodes_base64_exactly() {
        for (input, expected) in [
            ("", ""),
            ("f", "Zg=="),
            ("fo", "Zm8="),
            ("foo", "Zm9v"),
            ("foob", "Zm9vYg=="),
            ("fooba", "Zm9vYmE="),
            ("foobar", "Zm9vYmFy"),
            ("Man", "TWFu"),
            ("Ma", "TWE="),
        ] {
            let mut encoded = String::new();
            encode_base64(input.as_bytes(), &mut encoded);
            assert_eq!(encoded, expected, "encoding {input:?}");
        }

        // The payloads this harness writes are 64-bit floats, so the byte count
        // is always a multiple of eight and never a multiple of three.
        let mut encoded = String::new();
        encode_base64(&1.0_f64.to_le_bytes(), &mut encoded);
        assert_eq!(encoded.len(), 12);
        assert!(encoded.ends_with('='));
    }
}
