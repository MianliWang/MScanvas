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
//! Two modes, and the difference is what had to be true before the backend
//! started. By default the acquisition is named on the command line and is
//! never recognized into a source kind — the mode the lifecycle was measured
//! under before any family was admitted to it. With `--admitted` the same path
//! goes through the real admission chain first: extension filter, container
//! recognition, companion derivation and recognition, every member bound and
//! hashed, then the family gate, the provider-evidence row and a recheck of
//! each member before the spawn.
//!
//! Either way its path never appears in what this prints: every reported fact
//! is a bounded shape, a stable identifier, or a backend-chosen output
//! basename.
//!
//! This example is intentionally not a stable MSCanvas CLI contract.

use std::env;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use mscanvas_proteowizard::{
    AvailabilityState, ConflictPolicy, ConversionSource, DiscoveryRequest, MultiOutputOutcome,
    MzmlScanLimits, SystemProcessRunner, discover, run_admitted_multi_output_conversion,
    run_multi_output_conversion_evidence,
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
    /// Admit the source as a SCIEX bundle and run the admitted lifecycle, with
    /// the family gate, the provider-evidence gate and the per-member recheck,
    /// rather than the path-only evidence entry.
    admitted: bool,
}

fn parse_args(args: impl IntoIterator<Item = OsString>) -> Result<Cli, String> {
    let mut args = args.into_iter();
    let mut source = None;
    let mut workspace = None;
    let mut proteowizard_home = None;
    let mut runs = 1_u32;
    let mut conflict = ConflictPolicy::Fail;
    let mut admitted = false;
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
            "--admitted" => admitted = true,
            other => return Err(format!("unknown option: {other}")),
        }
    }
    Ok(Cli {
        source: source.ok_or("missing required option: --source")?,
        workspace: workspace.ok_or("missing required option: --workspace")?,
        proteowizard_home,
        runs: runs.clamp(1, 4),
        conflict,
        admitted,
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
    // Held for as long as the harness owns it. A pinned directory cannot be
    // renamed or removed, so the workspace this cleans up at the end is the
    // one the emptiness check above judged.
    let _workspace = hold_directory(&cli.workspace)?;

    let mut previous_names: Option<Vec<String>> = None;
    // Exactly the directories this invocation created, in creation order, each
    // held open. The emptiness check above says the workspace was ours when we
    // started; it cannot say what appeared during a conversion that takes as
    // long as it takes -- so cleanup removes these and nothing else, and the
    // hold is what makes "these" mean the objects that were created rather
    // than whatever now answers to their names.
    let mut created: Vec<(PathBuf, Option<fs::File>)> = Vec::new();
    let result = (|| -> Result<(), String> {
        for round in 1..=cli.runs {
            let destination = cli.workspace.join(format!("destination-{round}"));
            // Exclusively, so this can never adopt -- and later delete -- a
            // directory something else made.
            fs::create_dir(&destination).map_err(|error| {
                format!("the destination could not be created: {:?}", error.kind())
            })?;
            // Recorded before the hold is attempted, not after. A hold that
            // fails still leaves a directory this invocation created, and a
            // `?` between the creation and the record would leave it behind --
            // where it becomes residue and fails the next run's emptiness
            // check.
            created.push((destination.clone(), None));
            let hold = hold_directory(&destination)?;
            if let Some(last) = created.last_mut() {
                last.1 = Some(hold);
            }
            println!("run[{round}].begin=true");
            let run = if cli.admitted {
                // The whole admission chain, on the real object: extension
                // filter, container recognition, companion derivation and
                // recognition, both members bound and hashed -- then the
                // family gate, the provider-evidence row and a recheck of
                // every member before the process starts.
                let source = ConversionSource::open_sciex_wiff_bundle(
                    &cli.source,
                    MzmlScanLimits::default(),
                )
                .map_err(|rejection| {
                    format!(
                        "the acquisition was not admitted: {}",
                        rejection.stable_id()
                    )
                })?;
                println!("run[{round}].source.kind={}", source.kind().stable_id());
                println!(
                    "run[{round}].source.bound_members={}",
                    source.bound_object_count()
                );
                run_admitted_multi_output_conversion(
                    &source,
                    &destination,
                    cli.conflict,
                    &capabilities,
                    &SystemProcessRunner,
                    None,
                )
            } else {
                run_multi_output_conversion_evidence(
                    &cli.source,
                    &destination,
                    cli.conflict,
                    &capabilities,
                    &SystemProcessRunner,
                    MzmlScanLimits::default(),
                    None,
                )
            };
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
            // Only two observed sets can agree. Two runs that were refused
            // before discovery have no basenames between them, and reporting
            // `true` there would record a positive repeatability conclusion
            // from a failed experiment -- in the one harness whose output is
            // the evidence for that very claim.
            match (&previous_names, names.is_empty()) {
                (Some(previous), false) if !previous.is_empty() => {
                    println!(
                        "run[{round}].same_basename_set_as_previous={}",
                        *previous == names
                    );
                }
                (Some(_), _) => {
                    println!("run[{round}].same_basename_set_as_previous=unavailable");
                }
                (None, _) => {}
            }
            if !names.is_empty() {
                previous_names = Some(names);
            }
            let produced = count_entries(&destination)?;
            println!("run[{round}].destination_entry_count={produced}");
        }
        Ok(())
    })();

    // Everything the harness created goes -- and only that, whichever way the
    // runs ended.
    let cleanup = remove_created(created);
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

/// Opens a directory so it cannot be renamed or removed while it is held.
///
/// The same posture the older evidence harness takes, for the same reason and
/// with one more: this one recursively deletes what it created, and it decides
/// what to delete by resolving a path. A created directory renamed away and
/// replaced between the run and the cleanup would have this deleting somebody
/// else's tree. Holding it without delete sharing means the name cannot come
/// to mean a different object while the harness is using it.
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
        .map_err(|error| format!("the directory could not be held: {:?}", error.kind()))?;
    let metadata = opened
        .metadata()
        .map_err(|error| format!("the directory could not be inspected: {:?}", error.kind()))?;
    // The open refuses to traverse a link; this refuses to act on one. Holding
    // a junction pins the link, not its target, so a path-based recursive
    // delete would follow a target that can still be redirected.
    if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err("the directory is a reparse point".to_owned());
    }
    if !metadata.is_dir() {
        return Err("the path is not a directory".to_owned());
    }
    Ok(opened)
}

/// Opens a directory. No platform outside Windows offers a mandatory share
/// mode through the standard library, so the guarantee here is narrower and is
/// not described as equivalent.
#[cfg(not(windows))]
fn hold_directory(path: &Path) -> Result<fs::File, String> {
    fs::File::open(path)
        .map_err(|error| format!("the directory could not be held: {:?}", error.kind()))
}

/// Removes exactly the directories this invocation created.
///
/// Not the workspace's contents. A conversion can run for as long as it runs,
/// and anything that appeared in the workspace meanwhile is not this run's to
/// delete -- the acquisition least of all, if the caller's scratch directory
/// turns out to be somewhere they also work.
///
/// Each hold is released immediately before its own removal, so the object
/// stayed pinned for the whole run and no other directory can have taken its
/// name in the meantime.
fn remove_created(created: Vec<(PathBuf, Option<fs::File>)>) -> Result<(), String> {
    let mut left = 0_usize;
    for (path, hold) in created {
        drop(hold);
        if fs::remove_dir_all(&path).is_err() {
            left += 1;
        }
    }
    if left > 0 {
        return Err(format!(
            "{left} of the harness' own destination directories survived cleanup"
        ));
    }
    Ok(())
}
