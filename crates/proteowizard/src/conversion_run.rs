//! The typed mzML conversion boundary: one immutable plan, one staged
//! execution, one atomic finalization.
//!
//! [`conversion`](crate::conversion) owns the judgement of whether a produced
//! document is a faithful conversion. This module owns everything around that
//! judgement: which sources may be converted at all, where the output is
//! allowed to land, and the rule that a name in the destination root is only
//! ever taken by a document that already passed the judgement.
//!
//! Three properties are load-bearing.
//!
//! A source is a validated object, never a path, a name or an extension. It is
//! opened, canonicalized, identity-bound, hashed and read as mzML before it can
//! become one, so nothing that merely looks like an acquisition can be planned.
//!
//! The backend writes into a private staging directory this module creates
//! inside the destination root, never into the destination root itself. That
//! keeps every output the run produced enclosed in a directory MSCanvas owns,
//! which is what lets the integrity contract insist on exactly one planned
//! entry, and it means a failed or rejected run leaves nothing behind next to
//! the user's own files.
//!
//! Finalization is a no-clobber move of the validated output onto its final
//! name. There is no overwrite policy to select: an existing destination fails
//! or is skipped, and a destination that appears while the run is in flight
//! fails the move rather than replacing what arrived.
//!
//! This boundary offers no cancellation. Real-backend cancellation and
//! partial-output behavior remain unmeasured, so nothing here claims them.

use std::ffi::{OsStr, OsString};
use std::fmt;
use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;

use thiserror::Error;

use crate::capability::{InstalledHelpCapabilities, Sha256Digest};
use crate::command::{OpenFormat, PlanError, build_msconvert_command_with_capabilities};
use crate::conversion::{
    ConversionIntegrityOutcome, ConversionPolicy, ConversionSourceError, ConversionSourceFacts,
    ValidConversion, capture_conversion_source, conversion_output_file_name,
    verify_mzml_conversion,
};
use crate::fs_guard::{self, RegularFileError};
use crate::mzml::{MzmlFacts, MzmlScanError, MzmlScanLimits};
use crate::process::{LaunchFailureKind, ProcessError, ProcessOutput, ProcessRunner, Termination};

/// Appended to the planned output file name to name the staging directory.
///
/// It is deliberately not one of the partial-output suffixes the output
/// snapshot recognizes, so a staging directory is never mistaken for an
/// interrupted write, and it is deterministic so an already-present staging
/// target is a defined, refusable state rather than a name collision.
const STAGING_SUFFIX: &str = ".mscanvas-staging";

/// Which source kinds this boundary is allowed to convert.
///
/// There is exactly one, and it is the one the repository has evidence for: a
/// regular file MSCanvas can already read as mzML. Directory-formatted and
/// vendor acquisitions are not expressible here, not even as an unconstructed
/// variant, until conversion evidence for them exists.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConversionSourceKind {
    /// A regular file that read as mzML before it became a source.
    MzmlFile,
}

impl ConversionSourceKind {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::MzmlFile => "mzml_file",
        }
    }
}

/// Why a candidate path did not become a conversion source. No variant carries
/// a path or backend text.
#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum ConversionSourceRejection {
    #[error("the conversion source could not be inspected: {kind}")]
    NotInspectable { kind: io::ErrorKind },
    #[error("the conversion source is not a regular file")]
    NotARegularFile,
    #[error("the conversion source could not be read as mzML")]
    NotReadableAsMzml(MzmlScanError),
    #[error("the conversion source could not be hashed")]
    NotHashed,
}

impl ConversionSourceRejection {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::NotInspectable { .. } => "source_not_inspectable",
            Self::NotARegularFile => "source_not_a_regular_file",
            Self::NotReadableAsMzml(_) => "source_not_readable_as_mzml",
            Self::NotHashed => "source_not_hashed",
        }
    }
}

impl From<ConversionSourceError> for ConversionSourceRejection {
    fn from(error: ConversionSourceError) -> Self {
        match error {
            ConversionSourceError::NotResolved { kind } => Self::NotInspectable { kind },
            ConversionSourceError::NotHashed => Self::NotHashed,
            ConversionSourceError::Scan(error) => Self::NotReadableAsMzml(error),
        }
    }
}

impl From<RegularFileError> for ConversionSourceRejection {
    fn from(error: RegularFileError) -> Self {
        match error {
            RegularFileError::NotRegularFile
            | RegularFileError::Symlink
            | RegularFileError::ReparsePoint => Self::NotARegularFile,
            RegularFileError::ChangedDuringOpen => Self::NotInspectable {
                kind: io::ErrorKind::Other,
            },
            RegularFileError::Io { kind } => Self::NotInspectable { kind },
        }
    }
}

/// An acquisition that may be converted, together with the baseline a later
/// integrity comparison is measured against.
///
/// The only way to obtain one is to open a real file and read it, so a file
/// name, an extension or a value that merely looks like a path never becomes
/// acquisition identity.
#[derive(Clone, PartialEq)]
pub struct ConversionSource {
    kind: ConversionSourceKind,
    limits: MzmlScanLimits,
    facts: ConversionSourceFacts,
}

impl ConversionSource {
    /// Opens a regular-file mzML acquisition as a conversion source.
    ///
    /// The file is inspected for posture, canonicalized, bound to its
    /// filesystem identity, hashed and scanned as mzML. The scan limits are
    /// retained so the same contract judges the source and the output it is
    /// later compared against.
    pub fn open_mzml_file(
        path: &Path,
        limits: MzmlScanLimits,
    ) -> Result<Self, ConversionSourceRejection> {
        let metadata = std::fs::symlink_metadata(path)
            .map_err(|error| ConversionSourceRejection::NotInspectable { kind: error.kind() })?;
        fs_guard::require_regular_file(&metadata)?;
        let facts = capture_conversion_source(path, limits)?;
        Ok(Self {
            kind: ConversionSourceKind::MzmlFile,
            limits,
            facts,
        })
    }

    #[must_use]
    pub const fn kind(&self) -> ConversionSourceKind {
        self.kind
    }

    #[must_use]
    pub const fn scan_limits(&self) -> MzmlScanLimits {
        self.limits
    }

    #[must_use]
    pub const fn byte_length(&self) -> u64 {
        self.facts.byte_length()
    }

    #[must_use]
    pub const fn sha256(&self) -> Sha256Digest {
        self.facts.sha256()
    }

    /// The typed mzML facts read from the source before any conversion ran.
    #[must_use]
    pub const fn mzml_facts(&self) -> &MzmlFacts {
        self.facts.facts()
    }

    fn canonical_path(&self) -> &Path {
        self.facts.identity().canonical_path()
    }
}

impl fmt::Debug for ConversionSource {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ConversionSource")
            .field("kind", &self.kind)
            .finish_non_exhaustive()
    }
}

/// What to do when the planned destination already exists.
///
/// There is deliberately no overwrite variant. Replacing a file the user
/// already has is not a policy this boundary can be asked for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ConflictPolicy {
    /// Report the existing destination as a failure.
    #[default]
    Fail,
    /// Report the existing destination as work that was not needed.
    Skip,
}

impl ConflictPolicy {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::Fail => "fail",
            Self::Skip => "skip",
        }
    }
}

/// Why a conversion plan could not be formed. No variant carries a path.
#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum ConversionPlanError {
    #[error("the conversion source has no name an output can be derived from")]
    SourceHasNoConvertibleName,
    #[error("the derived output file name is not one safe file name")]
    UnsafeOutputFileName,
    #[error("the destination root could not be inspected: {kind}")]
    DestinationRootNotInspectable { kind: io::ErrorKind },
    #[error("the destination root is not a directory")]
    DestinationRootNotADirectory,
}

impl ConversionPlanError {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::SourceHasNoConvertibleName => "source_has_no_convertible_name",
            Self::UnsafeOutputFileName => "unsafe_output_file_name",
            Self::DestinationRootNotInspectable { .. } => "destination_root_not_inspectable",
            Self::DestinationRootNotADirectory => "destination_root_not_a_directory",
        }
    }
}

/// One immutable decision about one conversion.
///
/// A plan states only what the first safe slice needs: a Rust-owned source, an
/// mzML output, the destination root that output may land in, the deterministic
/// name it will take there, what happens if that name is taken, and the
/// compression the integrity contract is entitled to assume. Every one of them
/// is fixed when the plan is formed.
#[derive(Clone, PartialEq)]
pub struct ConversionPlan {
    source: ConversionSource,
    destination_root: PathBuf,
    output_file_name: OsString,
    conflict: ConflictPolicy,
    compression: ConversionPolicy,
}

impl ConversionPlan {
    /// Plans one mzML conversion of `source` into `destination_root`.
    ///
    /// The output name is derived from the source, never supplied: the stem is
    /// preserved and the extension always comes from the format. mzML is the
    /// only format this constructor can express, so no caller can select a
    /// format variant the repository has no integrity evidence for.
    pub fn to_mzml(
        source: ConversionSource,
        destination_root: &Path,
        conflict: ConflictPolicy,
    ) -> Result<Self, ConversionPlanError> {
        let output_file_name =
            conversion_output_file_name(source.canonical_path(), OpenFormat::MzMl)
                .ok_or(ConversionPlanError::SourceHasNoConvertibleName)?;
        crate::command::validate_output_file_name(&output_file_name, OpenFormat::MzMl)
            .map_err(|_| ConversionPlanError::UnsafeOutputFileName)?;

        let destination_root = std::fs::canonicalize(destination_root).map_err(|error| {
            ConversionPlanError::DestinationRootNotInspectable { kind: error.kind() }
        })?;
        let metadata = std::fs::metadata(&destination_root).map_err(|error| {
            ConversionPlanError::DestinationRootNotInspectable { kind: error.kind() }
        })?;
        if !metadata.is_dir() {
            return Err(ConversionPlanError::DestinationRootNotADirectory);
        }

        Ok(Self {
            source,
            destination_root,
            output_file_name,
            conflict,
            compression: ConversionPolicy::default(),
        })
    }

    #[must_use]
    pub const fn source(&self) -> &ConversionSource {
        &self.source
    }

    /// The only output format a plan can carry.
    #[must_use]
    pub const fn format(&self) -> OpenFormat {
        OpenFormat::MzMl
    }

    #[must_use]
    pub const fn conflict_policy(&self) -> ConflictPolicy {
        self.conflict
    }

    #[must_use]
    pub const fn compression_policy(&self) -> ConversionPolicy {
        self.compression
    }

    /// The scan limits that judge both the source baseline and the output.
    #[must_use]
    pub const fn scan_limits(&self) -> MzmlScanLimits {
        self.source.limits
    }

    /// The deterministic name the finalized output takes in the destination
    /// root. This is a display name, not a location.
    #[must_use]
    pub fn output_file_name(&self) -> &OsStr {
        &self.output_file_name
    }

    fn destination(&self) -> PathBuf {
        self.destination_root.join(&self.output_file_name)
    }

    fn staging_directory(&self) -> PathBuf {
        let mut name = self.output_file_name.clone();
        name.push(STAGING_SUFFIX);
        self.destination_root.join(name)
    }
}

impl fmt::Debug for ConversionPlan {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ConversionPlan")
            .field("source", &self.source)
            .field("format", &OpenFormat::MzMl)
            .field("conflict", &self.conflict)
            .field("compression", &self.compression)
            .finish_non_exhaustive()
    }
}

/// Why the backend could not be run to a verdict. This is the path-free
/// projection of [`ProcessError`], which retains the executable name and raw
/// operating-system detail for local diagnostics.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BackendExecutionFailure {
    EnvironmentInvalid,
    StagedDestinationExists,
    StagedDestinationNotInspectable { kind: io::ErrorKind },
    StagingDirectoryNotEmpty,
    StagingDirectoryNotInspectable { kind: io::ErrorKind },
    OutputInsideSource,
    ExecutableNotReverified { kind: io::ErrorKind },
    ExecutableChanged,
    SourceNotReverified { kind: io::ErrorKind },
    SourceChanged,
    NotLaunched { kind: LaunchFailureKind },
    NotSupervised,
    NotAwaited,
    OutputNotCaptured { stream: &'static str },
    NotTerminated,
}

impl BackendExecutionFailure {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::EnvironmentInvalid => "backend_environment_invalid",
            Self::StagedDestinationExists => "staged_destination_exists",
            Self::StagedDestinationNotInspectable { .. } => "staged_destination_not_inspectable",
            Self::StagingDirectoryNotEmpty => "staging_directory_not_empty",
            Self::StagingDirectoryNotInspectable { .. } => "staging_directory_not_inspectable",
            Self::OutputInsideSource => "output_inside_source",
            Self::ExecutableNotReverified { .. } => "backend_executable_not_reverified",
            Self::ExecutableChanged => "backend_executable_changed",
            Self::SourceNotReverified { .. } => "source_not_reverified",
            Self::SourceChanged => "source_changed",
            Self::NotLaunched { .. } => "backend_not_launched",
            Self::NotSupervised => "backend_not_supervised",
            Self::NotAwaited => "backend_not_awaited",
            Self::OutputNotCaptured { .. } => "backend_output_not_captured",
            Self::NotTerminated => "backend_not_terminated",
        }
    }
}

impl From<&ProcessError> for BackendExecutionFailure {
    fn from(error: &ProcessError) -> Self {
        match error {
            ProcessError::InvalidEnvironment { .. } => Self::EnvironmentInvalid,
            ProcessError::OutputDestinationExists => Self::StagedDestinationExists,
            ProcessError::OutputDestinationInspectionFailed { kind } => {
                Self::StagedDestinationNotInspectable { kind: *kind }
            }
            ProcessError::OutputDirectoryNotEmpty => Self::StagingDirectoryNotEmpty,
            ProcessError::OutputDirectoryInspectionFailed { kind } => {
                Self::StagingDirectoryNotInspectable { kind: *kind }
            }
            ProcessError::OutputDirectoryInsideDirectoryInput => Self::OutputInsideSource,
            ProcessError::ExecutableIdentityInspectionFailed { kind } => {
                Self::ExecutableNotReverified { kind: *kind }
            }
            ProcessError::ExecutableIdentityChanged => Self::ExecutableChanged,
            ProcessError::SourceIdentityInspectionFailed { kind } => {
                Self::SourceNotReverified { kind: *kind }
            }
            ProcessError::SourceIdentityChanged => Self::SourceChanged,
            ProcessError::Launch { kind, .. } => Self::NotLaunched { kind: *kind },
            ProcessError::AssignToOwnedJob { .. } => Self::NotSupervised,
            ProcessError::Wait { .. } => Self::NotAwaited,
            ProcessError::Capture { stream, .. } => Self::OutputNotCaptured { stream },
            ProcessError::Terminate { .. } => Self::NotTerminated,
        }
    }
}

/// Why one planned conversion produced no finalized output. No variant carries
/// a path or backend text.
#[derive(Debug, PartialEq)]
pub enum ConversionRunFailure {
    /// The planned destination already exists and the plan refuses to replace it.
    DestinationExists,
    /// The planned destination could not be inspected before the run started.
    DestinationNotInspectable { kind: io::ErrorKind },
    /// A staging area for this exact output already exists. It is left alone.
    StagingTargetExists,
    /// The staging area could not be created.
    StagingNotCreated { kind: io::ErrorKind },
    /// The plan could no longer be turned into a backend command.
    NotPlannable(PlanError),
    /// The backend could not be run to a verdict.
    Backend(BackendExecutionFailure),
    /// The backend exited without reporting success.
    BackendRejected { exit_code: Option<i32> },
    /// The backend did not run to completion. This boundary requests no
    /// cancellation, so only a substituted runner can report one.
    BackendDidNotComplete,
    /// The produced document failed the mzML conversion-integrity contract and
    /// was discarded rather than finalized.
    OutputRejected(ConversionIntegrityOutcome),
    /// The destination was taken between validation and finalization. What
    /// arrived there was left exactly as it was.
    DestinationAppearedDuringRun,
    /// The validated output could not be moved onto its final name.
    NotFinalized { kind: io::ErrorKind },
}

impl ConversionRunFailure {
    #[must_use]
    pub const fn stable_id(&self) -> &'static str {
        match self {
            Self::DestinationExists => "destination_exists",
            Self::DestinationNotInspectable { .. } => "destination_not_inspectable",
            Self::StagingTargetExists => "staging_target_exists",
            Self::StagingNotCreated { .. } => "staging_not_created",
            Self::NotPlannable(_) => "conversion_not_plannable",
            Self::Backend(_) => "backend_execution_failed",
            Self::BackendRejected { .. } => "backend_rejected",
            Self::BackendDidNotComplete => "backend_did_not_complete",
            Self::OutputRejected(_) => "output_rejected",
            Self::DestinationAppearedDuringRun => "destination_appeared_during_run",
            Self::NotFinalized { .. } => "output_not_finalized",
        }
    }
}

/// What one planned conversion did.
#[derive(Debug, PartialEq)]
pub enum ConversionRunOutcome {
    /// The output passed the integrity contract and now holds its planned name.
    Finalized(Box<ValidConversion>),
    /// The destination already existed and the plan asked for it to be skipped.
    SkippedExistingDestination,
    /// No output was finalized.
    Failed(ConversionRunFailure),
}

impl ConversionRunOutcome {
    #[must_use]
    pub const fn stable_id(&self) -> &'static str {
        match self {
            Self::Finalized(_) => "finalized",
            Self::SkippedExistingDestination => "skipped_existing_destination",
            Self::Failed(failure) => failure.stable_id(),
        }
    }
}

/// Bounded, path-free facts about the backend process that ran. Raw stdout and
/// stderr are deliberately absent: they can name the acquisition.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BackendRunFacts {
    exit_code: Option<i32>,
    elapsed: Duration,
    stdout_truncated: bool,
    stderr_truncated: bool,
    peak_job_memory_bytes: Option<u64>,
}

impl BackendRunFacts {
    #[must_use]
    pub const fn exit_code(self) -> Option<i32> {
        self.exit_code
    }

    #[must_use]
    pub const fn elapsed(self) -> Duration {
        self.elapsed
    }

    #[must_use]
    pub const fn stdout_truncated(self) -> bool {
        self.stdout_truncated
    }

    #[must_use]
    pub const fn stderr_truncated(self) -> bool {
        self.stderr_truncated
    }

    #[must_use]
    pub const fn peak_job_memory_bytes(self) -> Option<u64> {
        self.peak_job_memory_bytes
    }
}

impl From<&ProcessOutput> for BackendRunFacts {
    fn from(output: &ProcessOutput) -> Self {
        Self {
            exit_code: output.exit_code,
            elapsed: output.elapsed,
            stdout_truncated: output.stdout_truncated,
            stderr_truncated: output.stderr_truncated,
            peak_job_memory_bytes: output.peak_job_memory_bytes,
        }
    }
}

/// What the run could not clean up after itself. This never changes the
/// outcome: a finalized conversion stays finalized and a failure keeps its
/// primary cause.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StagingResidue {
    /// The staging directory MSCanvas created could not be removed.
    NotRemoved { kind: io::ErrorKind },
}

impl StagingResidue {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::NotRemoved { .. } => "staging_not_removed",
        }
    }
}

/// The typed result of one planned conversion.
#[derive(Debug, PartialEq)]
pub struct ConversionRunReport {
    outcome: ConversionRunOutcome,
    backend: Option<BackendRunFacts>,
    residue: Option<StagingResidue>,
}

impl ConversionRunReport {
    #[must_use]
    pub const fn outcome(&self) -> &ConversionRunOutcome {
        &self.outcome
    }

    /// The backend process facts, when a process ran at all.
    #[must_use]
    pub const fn backend(&self) -> Option<BackendRunFacts> {
        self.backend
    }

    #[must_use]
    pub const fn residue(&self) -> Option<StagingResidue> {
        self.residue
    }

    #[must_use]
    pub const fn finalized(&self) -> Option<&ValidConversion> {
        match &self.outcome {
            ConversionRunOutcome::Finalized(valid) => Some(valid),
            ConversionRunOutcome::SkippedExistingDestination | ConversionRunOutcome::Failed(_) => {
                None
            }
        }
    }

    const fn settled(outcome: ConversionRunOutcome) -> Self {
        Self {
            outcome,
            backend: None,
            residue: None,
        }
    }
}

/// Runs one planned conversion and reports what it did.
///
/// The sequence is fixed: refuse or skip an existing destination, create a
/// private staging directory, plan the backend command into it, run it through
/// the reviewed execution boundary, judge the produced document against the
/// source baseline, and only then take the final name. Every exit after the
/// staging directory exists discards it, including the successful one.
#[must_use]
pub fn run_conversion(
    plan: &ConversionPlan,
    capabilities: &InstalledHelpCapabilities,
    runner: &dyn ProcessRunner,
) -> ConversionRunReport {
    let destination = plan.destination();
    match std::fs::symlink_metadata(&destination) {
        Ok(_) => {
            return ConversionRunReport::settled(match plan.conflict {
                ConflictPolicy::Fail => {
                    ConversionRunOutcome::Failed(ConversionRunFailure::DestinationExists)
                }
                ConflictPolicy::Skip => ConversionRunOutcome::SkippedExistingDestination,
            });
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => {
            return ConversionRunReport::settled(ConversionRunOutcome::Failed(
                ConversionRunFailure::DestinationNotInspectable { kind: error.kind() },
            ));
        }
    }

    let staging = plan.staging_directory();
    // `create_dir` fails rather than adopting an existing directory, so a
    // staging area another run may still be using is never written into and
    // never removed by this one.
    if let Err(error) = std::fs::create_dir(&staging) {
        return ConversionRunReport::settled(ConversionRunOutcome::Failed(match error.kind() {
            io::ErrorKind::AlreadyExists => ConversionRunFailure::StagingTargetExists,
            kind => ConversionRunFailure::StagingNotCreated { kind },
        }));
    }

    let (outcome, backend) = run_staged(plan, capabilities, runner, &staging, &destination);
    let residue = discard_staging(&staging);
    ConversionRunReport {
        outcome,
        backend,
        residue,
    }
}

fn run_staged(
    plan: &ConversionPlan,
    capabilities: &InstalledHelpCapabilities,
    runner: &dyn ProcessRunner,
    staging: &Path,
    destination: &Path,
) -> (ConversionRunOutcome, Option<BackendRunFacts>) {
    let command = match build_msconvert_command_with_capabilities(
        capabilities,
        plan.source.canonical_path(),
        staging,
        plan.output_file_name(),
        OpenFormat::MzMl,
    ) {
        Ok(command) => command,
        Err(error) => {
            return (
                ConversionRunOutcome::Failed(ConversionRunFailure::NotPlannable(error)),
                None,
            );
        }
    };

    let output = match runner.run(&command) {
        Ok(output) => output,
        Err(error) => {
            return (
                ConversionRunOutcome::Failed(ConversionRunFailure::Backend((&error).into())),
                None,
            );
        }
    };
    let backend = Some(BackendRunFacts::from(&output));

    if output.termination != Termination::Exited {
        return (
            ConversionRunOutcome::Failed(ConversionRunFailure::BackendDidNotComplete),
            backend,
        );
    }
    if !output.success() {
        return (
            ConversionRunOutcome::Failed(ConversionRunFailure::BackendRejected {
                exit_code: output.exit_code,
            }),
            backend,
        );
    }

    // Exit status is not evidence of a usable document. The judgement below is
    // the only thing that may unlock the final name.
    let verified = verify_mzml_conversion(
        &plan.source.facts,
        staging,
        plan.output_file_name(),
        plan.compression,
        plan.scan_limits(),
    );
    let valid = match verified {
        ConversionIntegrityOutcome::Valid(valid) => valid,
        rejected => {
            return (
                ConversionRunOutcome::Failed(ConversionRunFailure::OutputRejected(rejected)),
                backend,
            );
        }
    };

    let staged_output = staging.join(plan.output_file_name());
    if let Err(error) = finalize_output(&staged_output, destination) {
        return (
            ConversionRunOutcome::Failed(match error.kind() {
                io::ErrorKind::AlreadyExists => ConversionRunFailure::DestinationAppearedDuringRun,
                kind => ConversionRunFailure::NotFinalized { kind },
            }),
            backend,
        );
    }

    (ConversionRunOutcome::Finalized(valid), backend)
}

/// Removes the staging directory MSCanvas created, with whatever the backend
/// left in it. Nothing outside that directory is touched, and a rejected or
/// partial document is discarded here rather than being left where a user could
/// mistake it for a result.
fn discard_staging(staging: &Path) -> Option<StagingResidue> {
    match std::fs::remove_dir_all(staging) {
        Ok(()) => None,
        Err(error) => Some(StagingResidue::NotRemoved { kind: error.kind() }),
    }
}

#[cfg(windows)]
fn finalize_output(staged: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        #[link_name = "MoveFileExW"]
        fn move_file_ex_w(existing: *const u16, new: *const u16, flags: u32) -> i32;
    }

    fn wide(value: &OsStr) -> io::Result<Vec<u16>> {
        let mut wide: Vec<u16> = value.encode_wide().collect();
        if wide.contains(&0) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "a path may not contain an interior null",
            ));
        }
        wide.push(0);
        Ok(wide)
    }

    let staged = wide(staged.as_os_str())?;
    let destination = wide(destination.as_os_str())?;
    // No MOVEFILE_REPLACE_EXISTING. An existing destination fails the move with
    // ERROR_ALREADY_EXISTS instead of being replaced, so this call cannot
    // overwrite whatever holds that name.
    // SAFETY: both buffers are null-terminated wide strings that outlive the
    // call, which is the exact argument form MoveFileExW requires.
    let moved = unsafe { move_file_ex_w(staged.as_ptr(), destination.as_ptr(), 0) };
    if moved == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(not(windows))]
fn finalize_output(staged: &Path, destination: &Path) -> io::Result<()> {
    // The standard library offers no no-clobber rename. A hard link fails when
    // the destination exists, so the final name is never taken from a file that
    // is already there. Removing the staged name afterwards is cleanup: the
    // destination is already finalized, and the staging directory is discarded
    // either way.
    std::fs::hard_link(staged, destination)?;
    let _ = std::fs::remove_file(staged);
    Ok(())
}

#[cfg(test)]
mod tests;
