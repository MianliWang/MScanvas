//! Unstable, developer-only multi-output conversion evidence harness.
//!
//! It answers the one question the deterministic suite cannot: does the
//! private one-source/multi-output lifecycle fit what the real backend does
//! with a real multi-sample acquisition? It runs the actual `msconvert`
//! through the reviewed process boundary into a private staging area, then
//! passes whatever the backend produced through the output-set lifecycle:
//! bounded discovery, all-before-any validation, the group conflict preflight,
//! and one-at-a-time handle-bound publication into a scratch destination.
//!
//! **No source family is admitted here.** The acquisition is named on the
//! command line, is never recognized into a production source kind, and its
//! path never appears in what this prints: every reported fact is a bounded
//! shape or a backend-chosen output basename.
//!
//! This example is intentionally not a stable MSCanvas CLI contract.

use std::env;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use mscanvas_proteowizard::{
    AvailabilityState, ConflictPolicy, DiscoveryRequest, MultiOutputOutcome, MzmlScanLimits,
    SystemProcessRunner, discover, run_multi_output_conversion_evidence,
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

struct Cli {
    source: PathBuf,
    workspace: PathBuf,
    proteowizard_home: Option<PathBuf>,
    /// How many times to run the conversion. Two runs answer whether the
    /// backend names the same output set twice.
    runs: u32,
    conflict: ConflictPolicy,
}

fn parse_args(args: impl IntoIterator<Item = OsString>) -> Result<Cli, String> {
    let mut args = args.into_iter();
    let mut source = None;
    let mut workspace = None;
    let mut proteowizard_home = None;
    let mut runs = 1_u32;
    let mut conflict = ConflictPolicy::Fail;
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
            "--source" => source = Some(value()?),
            "--workspace" => workspace = Some(value()?),
            "--proteowizard-home" => proteowizard_home = Some(value()?),
            "--runs" => {
                runs = args
                    .next()
                    .and_then(|value| value.to_str().and_then(|text| text.parse().ok()))
                    .ok_or("--runs requires a small number")?;
            }
            "--skip" => conflict = ConflictPolicy::Skip,
            other => return Err(format!("unknown option: {other}")),
        }
    }
    Ok(Cli {
        source: source.ok_or("missing required option: --source")?,
        workspace: workspace.ok_or("missing required option: --workspace")?,
        proteowizard_home,
        runs: runs.clamp(1, 4),
        conflict,
    })
}

fn run(cli: Cli) -> Result<(), String> {
    println!("warning=unstable developer-only evidence harness; no stable CLI contract");
    println!(
        "source.extension={}",
        cli.source.extension().map_or_else(
            || String::from("<none>"),
            |e| e.to_string_lossy().into_owned()
        )
    );

    let request = cli
        .proteowizard_home
        .as_deref()
        .map_or_else(DiscoveryRequest::automatic, DiscoveryRequest::with_home);
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
    let capabilities = mscanvas_proteowizard::InstalledHelpCapabilities::from_discovered_tool(
        &discovery.msconvert,
    )
    .map_err(|error| format!("installed help could not be parsed: {error}"))?;

    fs::create_dir_all(&cli.workspace)
        .map_err(|error| format!("the workspace could not be created: {:?}", error.kind()))?;
    // Owned exclusively, or not used. The cleanup below removes the
    // workspace's *contents*, so a workspace that already holds anything --
    // least of all the acquisition, if the caller pointed this at its folder
    // -- must be refused before a single artifact is created. This refusal
    // deliberately returns before the cleanup path exists.
    let preexisting = fs::read_dir(&cli.workspace)
        .map_err(|error| format!("the workspace could not be read: {:?}", error.kind()))?
        .count();
    if preexisting != 0 {
        return Err(String::from(
            "the workspace must be an empty scratch directory this harness may own; \
             it holds entries that are not this run's to remove",
        ));
    }
    let mut previous_names: Option<Vec<String>> = None;
    let result = (|| -> Result<(), String> {
        for round in 1..=cli.runs {
            let destination = cli.workspace.join(format!("destination-{round}"));
            fs::create_dir_all(&destination).map_err(|error| {
                format!("the destination could not be created: {:?}", error.kind())
            })?;
            println!("run[{round}].begin=true");
            let run = run_multi_output_conversion_evidence(
                &cli.source,
                &destination,
                cli.conflict,
                &capabilities,
                &SystemProcessRunner,
                MzmlScanLimits::default(),
                None,
            );
            println!("run[{round}].outcome={}", run.report.outcome().stable_id());
            if let MultiOutputOutcome::RefusedBeforePublication(failure) = run.report.outcome() {
                // The stable identifier only. The failure debug projection is
                // redacted anyway, and this prints nothing finer than it.
                println!("run[{round}].failure={}", failure.stable_id());
            }
            if let Some(backend) = run.report.backend() {
                println!("run[{round}].backend.exit_code={:?}", backend.exit_code());
                println!(
                    "run[{round}].backend.elapsed_ms={}",
                    backend.elapsed().as_millis()
                );
            }
            println!(
                "run[{round}].residue={}",
                run.report
                    .residue()
                    .map_or("none", |residue| residue.stable_id())
            );
            println!("run[{round}].member_count={}", run.report.members().len());
            println!("run[{round}].retained_count={}", run.retained.len());
            for (position, member) in run.report.members().iter().enumerate() {
                let facts = member.validation().map_or_else(
                    || String::from("unvalidated"),
                    |validation| {
                        format!(
                            "bytes={} spectra={} chromatograms={} mode={:?} verified={} inapplicable={}",
                            validation.byte_length(),
                            validation.spectrum_count(),
                            validation.chromatogram_count(),
                            validation.validation_mode(),
                            validation.verified().len(),
                            validation.inapplicable().len(),
                        )
                    },
                );
                println!(
                    "run[{round}].member[{position}] name={} state={} {facts}",
                    member.file_name(),
                    member.state().stable_id(),
                );
            }
            let names: Vec<String> = run
                .report
                .members()
                .iter()
                .map(|member| member.file_name().to_owned())
                .collect();
            if let Some(previous) = &previous_names {
                println!(
                    "run[{round}].same_basename_set_as_previous={}",
                    *previous == names
                );
            }
            previous_names = Some(names);
            let produced = count_entries(&destination)?;
            println!("run[{round}].destination_entry_count={produced}");
        }
        Ok(())
    })();

    // Everything the harness created goes, whichever way the runs ended.
    let cleanup = remove_workspace_contents(&cli.workspace);
    match (result, cleanup) {
        (Ok(()), residue) => residue,
        (Err(failure), Ok(())) => Err(failure),
        (Err(failure), Err(residue)) => Err(format!("{failure}; additionally, {residue}")),
    }
}

fn count_entries(directory: &Path) -> Result<usize, String> {
    Ok(fs::read_dir(directory)
        .map_err(|error| format!("the destination could not be read: {:?}", error.kind()))?
        .count())
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
            "the harness could not remove {left} workspace entries; they may derive from the acquisition"
        ));
    }
    Ok(())
}
