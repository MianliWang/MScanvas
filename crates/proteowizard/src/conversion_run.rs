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
//! entry, and it means a failed or rejected run leaves nothing next to the
//! user's own files unless the cleanup itself fails, which is reported.
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
use crate::command::{
    OpenFormat, PlanError, SourceIdentity, build_msconvert_command_with_capabilities,
};
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

/// Written inside a staging area as it is created, and required before one is
/// ever removed on the strength of its name alone. A name is not ownership: the
/// staging name is deterministic, so a user may hold a directory there too.
const STAGING_OWNER_MARKER: &str = ".mscanvas-staging-owner";

/// The marker's content. It is a constant rather than a token because it proves
/// which program made the directory, not which run: a run that ended without
/// cleaning up is exactly the case reclamation exists for, and it cannot leave
/// a live token behind.
const STAGING_OWNER_MAGIC: &[u8] = b"mscanvas-conversion-staging-area\n";

/// The staging area's own subdirectory, which the backend writes into.
///
/// The marker cannot sit beside the output: the integrity contract requires the
/// output directory to hold exactly one planned entry, and that requirement is
/// the point of a private staging area. So the marker owns the staging root and
/// the backend owns one level below it.
const STAGING_OUTPUT_DIRECTORY: &str = "output";

/// The per-component name limit every filesystem this project targets shares.
/// It bounds the staging name, which is the output name plus a suffix.
const MAX_COMPONENT_UNITS: usize = 255;

/// How many units of a name a filesystem counts: UTF-16 code units on Windows,
/// bytes elsewhere. Measuring in the wrong unit would refuse names that fit.
#[cfg(windows)]
fn component_units(name: &OsStr) -> usize {
    use std::os::windows::ffi::OsStrExt;

    name.encode_wide().count()
}

#[cfg(not(windows))]
fn component_units(name: &OsStr) -> usize {
    name.as_encoded_bytes().len()
}

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
    #[error("the derived output file name leaves no room for a staging name")]
    OutputFileNameTooLongToStage,
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
            Self::OutputFileNameTooLongToStage => "output_file_name_too_long_to_stage",
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
    /// The destination root is admitted as an object, not as a name. A plan can
    /// outlive the directory the caller chose — a queue makes that ordinary
    /// rather than exotic — and a path that now resolves somewhere else is not
    /// the root this plan accepted.
    destination_root_identity: SourceIdentity,
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
        // The staging area is named after the output, so a name the plan would
        // otherwise accept can still be one this boundary cannot stage. Deciding
        // that here makes it a stated refusal rather than an opaque failure from
        // the operating system once a run is already under way.
        if component_units(&output_file_name) + STAGING_SUFFIX.len() > MAX_COMPONENT_UNITS {
            return Err(ConversionPlanError::OutputFileNameTooLongToStage);
        }

        let destination_root = std::fs::canonicalize(destination_root).map_err(|error| {
            ConversionPlanError::DestinationRootNotInspectable { kind: error.kind() }
        })?;
        let metadata = std::fs::metadata(&destination_root).map_err(|error| {
            ConversionPlanError::DestinationRootNotInspectable { kind: error.kind() }
        })?;
        if !metadata.is_dir() {
            return Err(ConversionPlanError::DestinationRootNotADirectory);
        }
        let destination_root_identity =
            SourceIdentity::capture(&destination_root).map_err(|error| {
                ConversionPlanError::DestinationRootNotInspectable { kind: error.kind() }
            })?;

        Ok(Self {
            source,
            destination_root,
            destination_root_identity,
            output_file_name,
            conflict,
            compression: ConversionPolicy::default(),
        })
    }

    /// Whether the destination root is still the directory object this plan
    /// admitted, rather than whatever now answers to its name.
    fn destination_root_is_current(&self) -> io::Result<bool> {
        self.destination_root_identity.matches_current()
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

    /// The canonical directory a finalized output lands in. Rust-side only: a
    /// path never reaches a transfer boundary, but the caller that chose this
    /// root needs the canonical form to find what the run produced.
    #[must_use]
    pub fn destination_root(&self) -> &Path {
        &self.destination_root
    }

    /// Removes a staging area an earlier run of this exact plan left behind.
    ///
    /// A run refuses an existing staging area rather than adopting it, because
    /// another run may still own it. That is the right default and it is also a
    /// trap: one cleanup failure — a transient lock from a scanner or a backup
    /// agent is enough — leaves a directory whose deterministic name makes every
    /// later run of this plan refuse, and the path-free failure cannot say which
    /// name to remove. This is the deliberate way out.
    ///
    /// It removes only a directory MSCanvas created, proved by the ownership
    /// marker written when the staging area was made. A directory that carries
    /// no marker is refused untouched, whatever its name: the deterministic name
    /// is a name a user may also have chosen, and deleting a tree on the
    /// strength of a name is how unrelated data gets destroyed.
    ///
    /// Calling it asserts that no run of this plan is in flight. Nothing here
    /// can check that, which is why it is the caller's decision and not a
    /// silent step inside the run.
    pub fn reclaim_staging_area(&self) -> Result<(), StagingReclaimError> {
        // A staging area under a root this plan no longer admits is not this
        // plan's to remove, whatever it is called.
        match self.destination_root_is_current() {
            Ok(true) => {}
            Ok(false) => return Err(StagingReclaimError::NotOwned),
            Err(error) => {
                return Err(StagingReclaimError::NotInspectable { kind: error.kind() });
            }
        }
        let staging = self.staging_directory();
        match staging_ownership(&staging) {
            StagingOwnership::Absent => return Ok(()),
            StagingOwnership::Owned => {}
            StagingOwnership::NotOwned => return Err(StagingReclaimError::NotOwned),
            StagingOwnership::NotInspectable { kind } => {
                return Err(StagingReclaimError::NotInspectable { kind });
            }
        }
        std::fs::remove_dir_all(&staging)
            .map_err(|error| StagingReclaimError::NotRemoved { kind: error.kind() })
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

/// Which captured backend stream a capture failure describes.
///
/// The process boundary names its streams with a `&'static str`. That is fine
/// where it is produced, but a substituted runner may set it to anything, and
/// copying an arbitrary string verbatim into a type whose whole purpose is to
/// be safe to render would hand that guarantee to the caller. The projection is
/// closed instead.
#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum BackendStream {
    #[error("stdout")]
    Stdout,
    #[error("stderr")]
    Stderr,
    #[error("an unrecognized stream")]
    Unrecognized,
}

impl BackendStream {
    fn from_label(label: &str) -> Self {
        match label {
            "stdout" => Self::Stdout,
            "stderr" => Self::Stderr,
            _ => Self::Unrecognized,
        }
    }

    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::Stdout => "stdout",
            Self::Stderr => "stderr",
            Self::Unrecognized => "unrecognized_stream",
        }
    }
}

/// Why the backend could not be run to a verdict. This is the path-free
/// projection of [`ProcessError`], which retains the executable name and raw
/// operating-system detail for local diagnostics.
///
/// The projection is total rather than trimmed to what an mzML conversion can
/// currently reach, so a new [`ProcessError`] variant fails the build here
/// instead of being folded into an existing meaning. Three variants are
/// therefore unreachable today: the two staging-directory ones describe the
/// fresh-directory obligation only a preview plan carries, and
/// `OutputInsideSource` needs a directory-formatted source this boundary cannot
/// express.
#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum BackendExecutionFailure {
    #[error("the backend child environment is invalid")]
    EnvironmentInvalid,
    #[error("the staged output destination already exists")]
    StagedDestinationExists,
    #[error("the staged output destination could not be inspected: {kind}")]
    StagedDestinationNotInspectable { kind: io::ErrorKind },
    #[error("the staging directory is no longer empty")]
    StagingDirectoryNotEmpty,
    #[error("the staging directory could not be inspected: {kind}")]
    StagingDirectoryNotInspectable { kind: io::ErrorKind },
    #[error("the staging directory now resolves inside the conversion source")]
    OutputInsideSource,
    #[error("the backend executable could not be reverified: {kind}")]
    ExecutableNotReverified { kind: io::ErrorKind },
    #[error("the backend executable changed after its capability probe")]
    ExecutableChanged,
    #[error("the conversion source could not be reverified: {kind}")]
    SourceNotReverified { kind: io::ErrorKind },
    #[error("the conversion source changed after the command was planned")]
    SourceChanged,
    #[error("the backend could not be launched")]
    NotLaunched { kind: LaunchFailureKind },
    #[error("the backend could not be assigned to an owned process job")]
    NotSupervised,
    #[error("the backend process could not be awaited")]
    NotAwaited,
    #[error("backend {stream} could not be captured")]
    OutputNotCaptured { stream: BackendStream },
    #[error("the owned backend process job could not be terminated")]
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
            ProcessError::Capture { stream, .. } => Self::OutputNotCaptured {
                stream: BackendStream::from_label(stream),
            },
            ProcessError::Terminate { .. } => Self::NotTerminated,
        }
    }
}

/// Why one planned conversion produced no finalized output. No variant carries
/// a path or backend text.
///
/// Each variant's identifier names the failure this boundary owns; the embedded
/// plan and integrity errors carry their own, so a caller that must not render
/// `Debug` can still say precisely what went wrong.
#[derive(Debug, Error, PartialEq)]
pub enum ConversionRunFailure {
    /// The planned destination already exists and the plan refuses to replace it.
    #[error("the planned destination already exists")]
    DestinationExists,
    /// The planned destination could not be inspected before the run started.
    #[error("the planned destination could not be inspected: {kind}")]
    DestinationNotInspectable { kind: io::ErrorKind },
    /// A staging area for this exact output already exists. It is left alone.
    #[error("a staging area for this output already exists")]
    StagingTargetExists,
    /// The staging area could not be created.
    #[error("the staging area could not be created: {kind}")]
    StagingNotCreated { kind: io::ErrorKind },
    /// The plan could no longer be turned into a backend command.
    #[error("the conversion could not be planned: {0}")]
    NotPlannable(PlanError),
    /// The backend could not be run to a verdict.
    #[error("the backend could not be run: {0}")]
    Backend(BackendExecutionFailure),
    /// The backend exited without reporting success.
    #[error("the backend exited without reporting success")]
    BackendRejected { exit_code: Option<i32> },
    /// The backend did not run to completion. This boundary requests no
    /// cancellation, so only a substituted runner can report one.
    #[error("the backend did not run to completion")]
    BackendDidNotComplete,
    /// The produced document failed the mzML conversion-integrity contract and
    /// was discarded rather than finalized.
    #[error("the produced document failed the conversion-integrity contract")]
    OutputRejected(ConversionIntegrityOutcome),
    /// The destination was taken between validation and finalization. What
    /// arrived there was left exactly as it was.
    #[error("the destination was taken while the conversion was running")]
    DestinationAppearedDuringRun,
    /// The validated output could not be moved onto its final name.
    #[error("the validated output could not be finalized: {kind}")]
    NotFinalized { kind: io::ErrorKind },
    /// The source is no longer the acquisition the plan accepted, so nothing was
    /// converted.
    #[error("the source is not the acquisition this plan accepted")]
    SourceChangedBeforeRun,
    /// The source could not be rechecked against the plan, so nothing was
    /// converted.
    #[error("the source could not be rechecked against the plan: {kind}")]
    SourceNotRechecked { kind: io::ErrorKind },
    /// The source could not be rehashed, so nothing was converted.
    #[error("the source could not be rehashed")]
    SourceNotRehashed,
    /// The destination root is no longer the directory the plan accepted, so
    /// nothing was created there.
    #[error("the destination root is not the directory this plan accepted")]
    DestinationRootChanged,
    /// The destination root could not be rechecked against the plan, so nothing
    /// was created there.
    #[error("the destination root could not be rechecked: {kind}")]
    DestinationRootNotRechecked { kind: io::ErrorKind },
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
            Self::SourceChangedBeforeRun => "source_changed_before_run",
            Self::SourceNotRechecked { .. } => "source_not_rechecked",
            Self::SourceNotRehashed => "source_not_rehashed",
            Self::DestinationRootChanged => "destination_root_changed",
            Self::DestinationRootNotRechecked { .. } => "destination_root_not_rechecked",
        }
    }

    /// The precise identifier for this failure, reaching into the embedded plan
    /// or integrity error where one exists.
    #[must_use]
    pub const fn detailed_stable_id(&self) -> &'static str {
        match self {
            Self::NotPlannable(error) => error.stable_id(),
            Self::Backend(failure) => failure.stable_id(),
            Self::OutputRejected(outcome) => outcome.stable_id(),
            other => other.stable_id(),
        }
    }
}

/// What one planned conversion did.
#[derive(Debug, PartialEq)]
pub enum ConversionRunOutcome {
    /// The output passed the integrity contract and now holds its planned name.
    Finalized(Box<ValidConversion>),
    /// The planned destination name was already taken and the plan asked for it
    /// to be skipped. This says the name is occupied, not that a valid
    /// conversion holds it: what is there is deliberately not inspected, because
    /// this boundary's guarantee is that it never replaces it.
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
#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum StagingResidue {
    /// The staging directory MSCanvas created could not be removed.
    #[error("the staging directory could not be removed: {kind}")]
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

/// Why a staging area left behind by an earlier run could not be reclaimed.
#[derive(Debug, Error, Clone, Copy, PartialEq, Eq)]
pub enum StagingReclaimError {
    /// Something holds the staging name that MSCanvas did not create. It is left
    /// exactly as it is.
    #[error("the staging name is held by something MSCanvas did not create")]
    NotOwned,
    /// Ownership could not be established either way, so nothing was removed.
    #[error("the staging area could not be inspected: {kind}")]
    NotInspectable { kind: io::ErrorKind },
    /// Ownership was established and the removal still failed.
    #[error("the staging area could not be removed: {kind}")]
    NotRemoved { kind: io::ErrorKind },
}

impl StagingReclaimError {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::NotOwned => "staging_not_owned",
            Self::NotInspectable { .. } => "staging_not_inspectable",
            Self::NotRemoved { .. } => "staging_not_removed",
        }
    }
}

/// Writes the ownership marker, creating it exclusively and following nothing.
///
/// A plain write would follow a link. The staging directory is new, but it sits
/// in a root another process may write to, so an entry can appear at the marker's
/// name between the directory being created and the marker being written — and a
/// followed link would truncate whatever it pointed at, which could be an output
/// the user already had or the acquisition itself. Neither the guard nor
/// reclamation could put that back.
fn create_owner_marker(marker: &Path) -> io::Result<()> {
    use std::io::Write;

    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;

        /// Refuse a reparse point rather than traverse it.
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;

        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    options.open(marker)?.write_all(STAGING_OWNER_MAGIC)
}

enum StagingOwnership {
    Absent,
    Owned,
    NotOwned,
    NotInspectable { kind: io::ErrorKind },
}

/// Decides whether the entry at a staging name may be removed.
///
/// Two things say yes. The marker, which proves MSCanvas made the directory; a
/// directory that merely carries the expected name, or whose marker is a link, a
/// directory or the wrong content, proves nothing, because the consequence of
/// being wrong is deleting a tree of someone's data. And emptiness, which is not
/// proof of ownership but makes ownership irrelevant: removing an empty
/// directory destroys nothing.
///
/// Emptiness is not a convenience. Teardown removes the marker before it removes
/// the root, so a root removal that fails leaves exactly an empty directory —
/// and without this, that residue would be the permanent obstruction the marker
/// exists to prevent.
fn staging_ownership(staging: &Path) -> StagingOwnership {
    match std::fs::symlink_metadata(staging) {
        Ok(metadata) if !metadata.is_dir() => return StagingOwnership::NotOwned,
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return StagingOwnership::Absent;
        }
        Err(error) => return StagingOwnership::NotInspectable { kind: error.kind() },
    }

    match std::fs::read_dir(staging) {
        Ok(mut entries) => match entries.next() {
            None => return StagingOwnership::Owned,
            Some(Err(error)) => {
                return StagingOwnership::NotInspectable { kind: error.kind() };
            }
            Some(Ok(_)) => {}
        },
        Err(error) => return StagingOwnership::NotInspectable { kind: error.kind() },
    }

    let marker = staging.join(STAGING_OWNER_MARKER);
    let metadata = match std::fs::symlink_metadata(&marker) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return StagingOwnership::NotOwned;
        }
        Err(error) => return StagingOwnership::NotInspectable { kind: error.kind() },
    };
    if fs_guard::require_regular_file(&metadata).is_err() {
        return StagingOwnership::NotOwned;
    }
    match std::fs::read(&marker) {
        Ok(content) if content == STAGING_OWNER_MAGIC => StagingOwnership::Owned,
        Ok(_) => StagingOwnership::NotOwned,
        Err(error) => StagingOwnership::NotInspectable { kind: error.kind() },
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

/// Owns the staging directory for one run.
///
/// The guarantee is a lifetime rather than a call: the run executes
/// caller-supplied code, and an unwind through it must not leave the backend's
/// output sitting in the user's destination root under a name every later run
/// would then refuse.
struct StagingArea {
    path: PathBuf,
    discarded: bool,
}

impl StagingArea {
    /// Creates the staging area exclusively, marks it as MSCanvas's, and makes
    /// the subdirectory the backend will write into.
    ///
    /// `create_dir` fails rather than adopting an existing directory, so this
    /// type never owns — and never removes — a directory it did not create. A
    /// partially built area is torn down rather than left for a later run to
    /// find.
    fn create(path: PathBuf) -> Result<Self, ConversionRunFailure> {
        if let Err(error) = std::fs::create_dir(&path) {
            return Err(match error.kind() {
                io::ErrorKind::AlreadyExists => ConversionRunFailure::StagingTargetExists,
                kind => ConversionRunFailure::StagingNotCreated { kind },
            });
        }
        let area = Self {
            path,
            discarded: false,
        };
        create_owner_marker(&area.path.join(STAGING_OWNER_MARKER))
            .and_then(|()| std::fs::create_dir(area.output_directory()))
            .map_err(|error| ConversionRunFailure::StagingNotCreated { kind: error.kind() })?;
        Ok(area)
    }

    /// Where the backend writes. Validation inspects this directory, so the
    /// ownership marker one level above never counts as an unexpected output.
    fn output_directory(&self) -> PathBuf {
        self.path.join(STAGING_OUTPUT_DIRECTORY)
    }

    /// Removes the staging area with whatever the backend left in it. Nothing
    /// outside it is touched, and a rejected or partial document is discarded
    /// here rather than left where it could be mistaken for a result.
    ///
    /// The order matters. The backend's output goes first and the ownership
    /// marker last, so a cleanup that fails part-way leaves the proof that this
    /// area is MSCanvas's — which is the only thing that makes the residue
    /// reclaimable rather than a permanent obstruction.
    fn discard(mut self) -> Option<StagingResidue> {
        self.discarded = true;
        Self::tear_down(&self.path)
    }

    fn tear_down(path: &Path) -> Option<StagingResidue> {
        // Sequential and short-circuiting: each step must be given up on before
        // the next one is attempted, or a failed output removal would still take
        // the marker with it.
        if let Some(residue) =
            Self::residue(std::fs::remove_dir_all(path.join(STAGING_OUTPUT_DIRECTORY)))
        {
            return Some(residue);
        }
        if let Some(residue) = Self::residue(std::fs::remove_file(path.join(STAGING_OWNER_MARKER)))
        {
            return Some(residue);
        }
        Self::residue(std::fs::remove_dir(path))
    }

    fn residue(removal: io::Result<()>) -> Option<StagingResidue> {
        match removal {
            Ok(()) => None,
            Err(error) if error.kind() == io::ErrorKind::NotFound => None,
            Err(error) => Some(StagingResidue::NotRemoved { kind: error.kind() }),
        }
    }
}

impl Drop for StagingArea {
    fn drop(&mut self) {
        if !self.discarded {
            let _ = Self::tear_down(&self.path);
        }
    }
}

/// Runs one planned conversion and reports what it did.
///
/// The sequence is fixed: refuse or skip an existing destination, create a
/// private staging directory, plan the backend command into it, run it through
/// the reviewed execution boundary, judge the produced document against the
/// source baseline, and only then take the final name. The staging directory is
/// discarded on every exit, including the successful one and an unwind.
#[must_use]
pub fn run_conversion(
    plan: &ConversionPlan,
    capabilities: &InstalledHelpCapabilities,
    runner: &dyn ProcessRunner,
) -> ConversionRunReport {
    // Nothing is inspected, created or launched under a root that is no longer
    // the directory this plan admitted.
    match plan.destination_root_is_current() {
        Ok(true) => {}
        Ok(false) => {
            return ConversionRunReport::settled(ConversionRunOutcome::Failed(
                ConversionRunFailure::DestinationRootChanged,
            ));
        }
        Err(error) => {
            return ConversionRunReport::settled(ConversionRunOutcome::Failed(
                ConversionRunFailure::DestinationRootNotRechecked { kind: error.kind() },
            ));
        }
    }

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

    if let Err(failure) = require_planned_source(&plan.source) {
        return ConversionRunReport::settled(ConversionRunOutcome::Failed(failure));
    }

    let staging = match StagingArea::create(plan.staging_directory()) {
        Ok(staging) => staging,
        Err(failure) => {
            return ConversionRunReport::settled(ConversionRunOutcome::Failed(failure));
        }
    };

    let (outcome, backend) = run_staged(
        plan,
        capabilities,
        runner,
        &staging.output_directory(),
        &destination,
    );
    let residue = staging.discard();
    ConversionRunReport {
        outcome,
        backend,
        residue,
    }
}

/// Refuses a source that is no longer the acquisition the plan accepted.
///
/// The command builder captures the source's identity again from its path, so
/// without this the backend would be bound to whatever now holds that name
/// rather than to what was measured and admitted. The post-run comparison would
/// usually notice — but only by rejecting a conversion that should never have
/// been run, and only if the original is still displaced when it looks. Restore
/// the original first and the comparison agrees with itself while the backend
/// read something else entirely, which the integrity scanner cannot detect
/// because it never decodes an array payload.
///
/// This costs one full read of the source. A conversion already reads it twice;
/// binding the run to the bytes that were admitted is worth the third.
fn require_planned_source(source: &ConversionSource) -> Result<(), ConversionRunFailure> {
    match source.facts.identity().matches_current() {
        Ok(true) => {}
        Ok(false) => return Err(ConversionRunFailure::SourceChangedBeforeRun),
        Err(error) => {
            return Err(ConversionRunFailure::SourceNotRechecked { kind: error.kind() });
        }
    }

    let path = source.canonical_path();
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|error| ConversionRunFailure::SourceNotRechecked { kind: error.kind() })?;
    if metadata.len() != source.facts.byte_length() {
        return Err(ConversionRunFailure::SourceChangedBeforeRun);
    }
    let sha256 =
        Sha256Digest::calculate_file(path).map_err(|_| ConversionRunFailure::SourceNotRehashed)?;
    if sha256 != source.facts.sha256() {
        return Err(ConversionRunFailure::SourceChangedBeforeRun);
    }
    Ok(())
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
