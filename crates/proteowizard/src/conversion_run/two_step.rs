//! ADR 0055 decision 6: a format other than mzML, written from a private mzML
//! intermediate in two provider runs.
//!
//! Run 1 converts the source into the staging area's output directory exactly
//! as a direct mzML conversion would, at the intermediate's fixed encoding
//! (64/64, zlib, indexed), and the intermediate gets every mzML check. Before
//! run 2 it must hold something the requested format keeps. Run 2 converts it
//! into a second private directory inside the same staging area, carrying no
//! filter, and the final file gets the format's minimal checks before it takes
//! its planned name.
//!
//! The intermediate is never finalized. It is held, unwritable, from its
//! checks to the end of run 2, and it goes with the staging area's teardown
//! after the final file was checked and published, or refused.
//!
//! Not here: mzXML, which stays refused (its writer drops spectra at exit 0),
//! and a SCIEX output set's 1 + N runs, which no plan can express yet.

use std::io::{BufReader, SeekFrom};

use super::*;
use crate::command::{build_target_msconvert_command, target_staged_file_name};
use crate::conversion::{ConversionOutputRejection, OutputRetention, open_planned_output};
use crate::output_inspect::{
    FinalOutputVerdict, admit_intermediate, inspect_opened, scan_intermediate_reader,
};

/// Run 2's private directory, inside the staging area's output directory.
const TARGET_DIRECTORY: &str = "target";

/// A file written from the checked intermediate that passed its checks and
/// holds its planned name (ADR 0055 decision 6).
///
/// Not adoptable and not previewable: the viewer reads mzML only, and nothing
/// is retained to recognise the file by later. Always the advanced tier, so
/// always "not verified by MSCanvas": no verified row writes another format.
#[derive(Debug, Clone, PartialEq)]
pub struct FinalizedFile {
    format: NonMzmlFormat,
    byte_length: u64,
    sha256: Sha256Digest,
    verdict: FinalOutputVerdict,
    intermediate: ValidConversion,
}

impl FinalizedFile {
    #[must_use]
    pub const fn format(&self) -> NonMzmlFormat {
        self.format
    }

    #[must_use]
    pub const fn byte_length(&self) -> u64 {
        self.byte_length
    }

    /// The digest of the whole published file. The checks read only its
    /// signature and first record (see [`FinalizedFile::verdict`]).
    #[must_use]
    pub const fn sha256(&self) -> Sha256Digest {
        self.sha256
    }

    /// What the final file's checks established, and therefore what they did
    /// not: beyond the verdict, what the file holds is unverified.
    #[must_use]
    pub const fn verdict(&self) -> FinalOutputVerdict {
        self.verdict
    }

    /// How run 1's intermediate was judged: what was verified of the data the
    /// format was written from. The intermediate itself was discarded.
    ///
    /// Never a claim about the final file: an unfiltered intent can leave the
    /// intermediate fully verified while this file, written by run 2, is
    /// verified only as far as [`FinalizedFile::verdict`] says.
    #[must_use]
    pub const fn intermediate(&self) -> &ValidConversion {
        &self.intermediate
    }
}

/// What run 1 leaves for run 2.
struct Intermediate {
    /// Read sharing only, so the checked bytes cannot be rewritten, renamed or
    /// removed while run 2 reads them; held until run 2 has finished.
    pinned: File,
    path: PathBuf,
    valid: ValidConversion,
    output: ProcessOutput,
    identity: Option<OperationRunIdentity>,
}

/// Runs both steps and names the one the attempt settled in.
pub(super) fn run(
    context: RunContext<'_>,
    capabilities: &InstalledHelpCapabilities,
    staging: &Path,
    destination_directory: &finalize::DestinationDirectory,
    two_step: (NonMzmlFormat, &StructuredIntent),
    after_validation: impl FnOnce(),
) -> (StagedResult, ConversionStep) {
    match run_intermediate(context, capabilities, staging, two_step.0) {
        Err(settled) => (*settled, ConversionStep::Intermediate),
        Ok(intermediate) => (
            run_target(
                context,
                capabilities,
                staging,
                destination_directory,
                two_step,
                intermediate,
                after_validation,
            ),
            ConversionStep::Target,
        ),
    }
}

/// Run 1 and the intermediate's checks: the mzML judgement, then, through the
/// pinned object, that it holds something `target` keeps.
fn run_intermediate(
    context: RunContext<'_>,
    capabilities: &InstalledHelpCapabilities,
    staging: &Path,
    target: NonMzmlFormat,
) -> Result<Intermediate, Box<StagedResult>> {
    let plan = context.plan;
    let Some(name) = plan.intermediate_file_name.as_deref() else {
        return Err(Box::new(StagedResult::failed(
            ConversionRunFailure::NotPlannable(PlanError::IntentNotCheckable),
            staging,
            StagedObservationPhase::ProviderNotInvoked,
            None,
            ProcessAttemptOutcome::NotAttempted,
        )));
    };
    let command = build_source_run(plan, capabilities, staging, name)?;
    // One identity for the attempt, minted as run 1 is handed to the process
    // boundary, and carried into run 2.
    let identity = Some(OperationRunIdentity::mint());
    // `launch` settles a run whose own tree is not confirmed gone, so nothing
    // of run 1's output is judged and run 2 never launches after one.
    let output = launch(context, &command, staging, identity)?;
    let executable = command.executable.clone();
    let refuse = |failure| {
        Box::new(StagedResult::failed_after_run(
            failure,
            &output,
            plan,
            staging,
            &executable,
            StagedObservationPhase::OutputRefused,
            identity,
        ))
    };

    let validated = match judge(plan, staging, name) {
        VerifiedConversion::Valid(validated) => validated,
        VerifiedConversion::Rejected(rejected) => {
            return Err(refuse(ConversionRunFailure::OutputRejected(rejected)));
        }
    };
    // The judged handle has delete access, which a reader opening with less
    // sharing would collide with, so it is released and the object pinned
    // again: the same posture the source is held in, and the bytes rehashed
    // against the ones just judged.
    let (judged, valid) = (*validated).into_parts();
    drop(judged);
    let path = staging.join(name);
    let mut pinned =
        match hold_intermediate(&path, valid.output().byte_length(), valid.output().sha256()) {
            Ok(pinned) => pinned,
            Err(failure) => return Err(refuse(failure)),
        };
    let kept = pinned
        .seek(SeekFrom::Start(0))
        .map_err(|error| OutputCheckRefusal::from(MzmlScanError::Io { kind: error.kind() }))
        .and_then(|_| {
            scan_intermediate_reader(
                BufReader::with_capacity(64 * 1024, &pinned),
                plan.scan_limits(),
            )
        })
        .and_then(|facts| admit_intermediate(target, &facts));
    if let Err(refusal) = kept {
        return Err(refuse(ConversionRunFailure::FormatCheckRefused(refusal)));
    }
    Ok(Intermediate {
        pinned,
        path,
        valid,
        output,
        identity,
    })
}

/// Pins the judged intermediate as the source is pinned, rehashing it against
/// the bytes just judged. The pin's failures speak of the user's source; here
/// the object is run 1's intermediate, so they are restated as what they are:
/// an output that could not be held, rehashed or recognised as the one judged.
pub(super) fn hold_intermediate(
    path: &Path,
    byte_length: u64,
    sha256: Sha256Digest,
) -> Result<File, ConversionRunFailure> {
    SourceIdentity::capture(path)
        .map_err(|error| ConversionRunFailure::SourceNotRechecked { kind: error.kind() })
        .and_then(|identity| {
            pin_source_object(&SourceObjectFacts::from_parts(
                identity,
                byte_length,
                sha256,
            ))
        })
        .map_err(|failure| {
            let rejection = match failure {
                ConversionRunFailure::SourceNotRechecked { kind } => {
                    ConversionOutputRejection::DirectoryInspectionFailed { kind }
                }
                ConversionRunFailure::SourceNotRehashed => ConversionOutputRejection::NotHashed,
                _ => ConversionOutputRejection::ChangedDuringInspection,
            };
            ConversionRunFailure::OutputRejected(rejection.into())
        })
}

/// Run 2 and the final file's checks, then its finalization under the planned
/// name. A stop requested since run 1 is answered before run 2 launches.
fn run_target(
    context: RunContext<'_>,
    capabilities: &InstalledHelpCapabilities,
    staging: &Path,
    destination_directory: &finalize::DestinationDirectory,
    (target, intent): (NonMzmlFormat, &StructuredIntent),
    intermediate: Intermediate,
    after_validation: impl FnOnce(),
) -> StagedResult {
    let plan = context.plan;
    let Intermediate {
        pinned,
        path,
        valid,
        output: first,
        identity,
    } = intermediate;
    if context
        .cancellation
        .is_some_and(ConversionCancellation::is_requested)
    {
        return stopped_before_target(&first, staging, identity);
    }
    let _directory = match context
        .recovery
        .create_output_subdirectory(OsStr::new(TARGET_DIRECTORY))
    {
        Ok(held) => held,
        Err(error) => {
            return failed_before_target(
                ConversionRunFailure::StagingNotCreated { kind: error.kind() },
                &first,
                staging,
                StagedObservationPhase::ProviderReturned,
                identity,
            );
        }
    };
    let target_staging = staging.join(TARGET_DIRECTORY);
    let command = match build_target_msconvert_command(
        capabilities,
        &path,
        &target_staging,
        target,
        intent,
    ) {
        Ok(command) => command,
        Err(error) => {
            return failed_before_target(
                ConversionRunFailure::NotPlannable(error),
                &first,
                &target_staging,
                StagedObservationPhase::ProviderNotInvoked,
                identity,
            );
        }
    };
    let output = match launch(context, &command, &target_staging, identity) {
        Ok(output) => output,
        // A stop that beat run 2's launch: run 2 created nothing, and the
        // attempt's process tree is run 1's, which did launch.
        Err(settled)
            if matches!(
                *settled,
                StagedResult::Cancelled {
                    owned_tree: OwnedTreeDisposition::NoneLaunched,
                    ..
                }
            ) =>
        {
            return stopped_before_target(&first, staging, identity);
        }
        Err(settled) => return *settled,
    };
    // Run 2 has finished with the intermediate.
    drop(pinned);
    let executable = command.executable.clone();
    let refuse = |failure, phase| {
        StagedResult::failed_after_run(
            failure,
            &output,
            plan,
            &target_staging,
            &executable,
            phase,
            identity,
        )
    };
    let staged_name = target_staged_file_name(target);
    let (file, byte_length, sha256, verdict) = match inspect_target(
        &target_staging,
        &staged_name,
        target,
        valid.output().facts(),
        plan.scan_limits(),
    ) {
        Ok(checked) => checked,
        Err(failure) => return refuse(failure, StagedObservationPhase::OutputRefused),
    };

    after_validation();

    #[cfg(not(windows))]
    let published = finalize::publish(
        file,
        destination_directory,
        &target_staging.join(&staged_name),
        plan.output_file_name(),
    );
    #[cfg(windows)]
    let published = finalize::publish(file, destination_directory, plan.output_file_name());
    match published {
        Ok(()) => {
            let backend = Some(BackendRunFacts::from(&output));
            StagedResult::Settled {
                outcome: ConversionRunOutcome::FinalizedFile(Box::new(FinalizedFile {
                    format: target,
                    byte_length,
                    sha256,
                    verdict,
                    intermediate: valid,
                })),
                backend,
                diagnostics: None,
                staged: StagedOutputEvidence::Published,
                identity,
                process: backend.map_or(
                    ProcessAttemptOutcome::Indeterminate,
                    ProcessAttemptOutcome::of,
                ),
            }
        }
        Err(error) => refuse(
            not_published(&error),
            StagedObservationPhase::PublicationSettled,
        ),
    }
}

/// The final file's checks, through the handle that will rename it: exactly
/// the expected entry, non-empty and regular, then the format's signature and
/// first record, then the digest of the whole file.
fn inspect_target(
    directory: &Path,
    name: &OsStr,
    format: NonMzmlFormat,
    intermediate: &MzmlFacts,
    limits: MzmlScanLimits,
) -> Result<(File, u64, Sha256Digest, FinalOutputVerdict), ConversionRunFailure> {
    let rejected = |rejection: ConversionOutputRejection| {
        ConversionRunFailure::OutputRejected(rejection.into())
    };
    let (mut file, length) =
        open_planned_output(directory, name, format.extension(), OutputRetention::Retain)
            .map_err(rejected)?;
    let verdict = inspect_opened(
        BufReader::with_capacity(64 * 1024, &mut file),
        length,
        format,
        intermediate,
        &limits,
    )
    .map_err(ConversionRunFailure::FormatCheckRefused)?;
    file.seek(SeekFrom::Start(0))
        .map_err(|_| rejected(ConversionOutputRejection::NotHashed))?;
    let sha256 = Sha256Digest::calculate_reader(&mut file)
        .map_err(|_| rejected(ConversionOutputRejection::NotHashed))?;
    Ok((file, length, sha256, verdict))
}

/// A failure after run 1 and before run 2 launched. The facts are run 1's,
/// the last run that launched; no backend text is kept, because nothing the
/// backend did is the reason. `observed` is read at `phase`: run 1's directory
/// at `ProviderReturned`, run 2's, which no provider saw, at
/// `ProviderNotInvoked`.
fn failed_before_target(
    failure: ConversionRunFailure,
    first: &ProcessOutput,
    observed: &Path,
    phase: StagedObservationPhase,
    identity: Option<OperationRunIdentity>,
) -> StagedResult {
    let backend = Some(BackendRunFacts::from(first));
    StagedResult::Settled {
        outcome: ConversionRunOutcome::Failed(failure),
        backend,
        diagnostics: None,
        staged: StagedOutputEvidence::of(phase, observe_staged_content(observed)),
        identity,
        process: backend.map_or(
            ProcessAttemptOutcome::Indeterminate,
            ProcessAttemptOutcome::of,
        ),
    }
}

/// A stop answered after run 1 and before run 2 created anything.
///
/// Never `NoneLaunched`: run 1 launched. What the stop can say about the
/// attempt's processes is what run 1's own ending established, decided by the
/// one origin; where that does not establish that none survives, the stop is
/// unconfirmed. The staged reading is run 1's directory, `staging`, at
/// `ProviderReturned`.
fn stopped_before_target(
    first: &ProcessOutput,
    staging: &Path,
    identity: Option<OperationRunIdentity>,
) -> StagedResult {
    let backend = Some(BackendRunFacts::from(first));
    let owned_tree = OwnedTreeDisposition::of(first);
    let staged = StagedOutputEvidence::of(
        StagedObservationPhase::ProviderReturned,
        observe_staged_content(staging),
    );
    let process = backend.map_or(
        ProcessAttemptOutcome::Indeterminate,
        ProcessAttemptOutcome::of,
    );
    if owned_tree.no_owned_process_survives() {
        StagedResult::Cancelled {
            backend,
            surviving_processes: first.final_active_processes,
            owned_tree,
            staged,
            identity,
            process,
        }
    } else {
        StagedResult::CancellationFailed {
            cause: BackendExecutionFailure::NotTerminated,
            backend,
            staged,
            diagnostics: None,
            identity,
            process,
        }
    }
}
