//! The private one-source / multi-output conversion lifecycle.
//!
//! Every source family this repository admits produces exactly one mzML, and
//! the whole conversion boundary is built on that: one planned name, one staged
//! entry, one judged object, one handle-bound rename. The measured SCIEX WIFF
//! topology does not fit it — one acquisition legitimately yields one mzML *per
//! sample*, named by the backend rather than by the plan — and ADR 0018
//! recorded that as a gate rather than forcing it through.
//!
//! This module is the answer to that gate, and only to that gate. It models
//!
//! ```text
//! one logical source → one backend run → a bounded set of mzML documents
//! ```
//!
//! and proves the lifecycle: backend-authoritative names discovered in private
//! staging after the run, every member validated before the first is published,
//! group-level conflict semantics, one-at-a-time handle-bound publication that
//! is honestly *not* atomic, and an explicit partial-finalization result when
//! the filesystem makes one true.
//!
//! **No source family is admitted here.** There is no WIFF variant, no
//! recognition, no provider-evidence row; the entry point takes a Rust-owned
//! path and exists for evidence collection and for the deterministic suite. A
//! later, separate admission decides whether MSCanvas *supports* a multi-output
//! family; this decides only that the crate could carry one safely.

use std::ffi::{OsStr, OsString};
use std::fs::File;
use std::io;
use std::path::{Path, PathBuf};

use crate::capability::{InstalledHelpCapabilities, Sha256Digest};
use crate::command::{
    CommandSpec, InputSpelling, PlanError, SourceIdentity, build_msconvert_set_command_for_source,
};
use crate::conversion::{
    ConversionIntegrityOutcome, ConversionPolicy, IntegrityProperty, SourceObjectFacts,
    ValidatedConversionOutput, ValidationMode, VerifiedConversion,
    verify_staged_member_retaining_output,
};
use crate::finalized_output::FinalizedOutput;
use crate::mzml::MzmlScanLimits;
use crate::process::{ProcessRunner, Termination};
use crate::{ConversionCancellation, fs_guard};

use super::{
    BackendExecutionFailure, BackendRunFacts, ConflictPolicy, OwnedStagingArea, StagingResidue,
    finalize,
};

/// The most mzML documents one backend run may hand this lifecycle.
///
/// A bound, not a claim about any vendor format. The one measured multi-output
/// acquisition — the lawful SCIEX fixture ADR 0018 records — produces exactly
/// ten documents, and ProteoWizard's own committed reference outputs agree. 24
/// is more than double that measured set, and it is deliberately not the queue
/// capacity (16) or any workspace bound: this limits how many objects one run
/// may open, validate and retain at once, which is a different resource with a
/// different owner. A run that produces more is refused whole rather than
/// truncated, because a truncated set would publish an acquisition minus some
/// of its samples and call that a conversion.
pub const MAX_CONVERSION_OUTPUTS_PER_SOURCE: usize = 24;

/// Why a staging directory's contents were refused as an output set.
///
/// Path-free, like every refusal this crate publishes. The one thing a variant
/// may carry beyond a count or an [`io::ErrorKind`] is a *basename* — the
/// display-grade name of a staged member, which is derived from the source's
/// own display name and is the least that can explain a refusal.
#[derive(Clone, PartialEq, Eq)]
pub enum OutputSetRejection {
    /// The backend exited cleanly and produced nothing at all.
    NoOutputs,
    /// More members than the lifecycle's bound. Nothing was retained.
    TooManyOutputs { observed: usize },
    /// The staging directory could not be read whole.
    DirectoryUnreadable { kind: io::ErrorKind },
    /// A member is not an ordinary regular file: a directory, link or reparse
    /// point has no business in a backend's private output directory.
    NonRegularMember { member: String },
    /// A member carries a suffix backends use for unfinished output.
    PartialOutputMember { member: String },
    /// A member is not named as an mzML document, or its name is not one safe
    /// path component. Whatever it is, it is not an output this run planned
    /// for, and admitting it as a sidecar would publish something no judgement
    /// covers.
    UnexpectedMember { member: String },
    /// Two members whose names collide under Windows filename folding. Both
    /// cannot be published into one destination, and choosing one would drop
    /// a document the backend produced.
    FoldedDuplicateMember { member: String },
}

impl OutputSetRejection {
    #[must_use]
    pub const fn stable_id(&self) -> &'static str {
        match self {
            Self::NoOutputs => "output_set_empty",
            Self::TooManyOutputs { .. } => "output_set_over_bound",
            Self::DirectoryUnreadable { .. } => "output_set_directory_unreadable",
            Self::NonRegularMember { .. } => "output_set_member_not_regular",
            Self::PartialOutputMember { .. } => "output_set_member_partial",
            Self::UnexpectedMember { .. } => "output_set_member_unexpected",
            Self::FoldedDuplicateMember { .. } => "output_set_member_folded_duplicate",
        }
    }
}

impl std::fmt::Debug for OutputSetRejection {
    /// The stable identifier plus the bounded shape, with the member name
    /// redacted. A backend-chosen basename embeds the vendor's own sample
    /// identifiers, and a debug projection is exactly where such a value would
    /// leak into a log or a panic message nobody meant to publish. Intentional
    /// reporting reads the fields by matching; this renders none of them.
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TooManyOutputs { observed } => formatter
                .debug_struct("TooManyOutputs")
                .field("observed", observed)
                .finish(),
            Self::DirectoryUnreadable { kind } => formatter
                .debug_struct("DirectoryUnreadable")
                .field("kind", kind)
                .finish(),
            _ => formatter.write_str(self.stable_id()),
        }
    }
}

/// One discovered staged member: its backend-chosen name and the length the
/// directory reported for it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DiscoveredMember {
    name: OsString,
    byte_length: u64,
}

impl DiscoveredMember {
    pub(crate) fn name(&self) -> &OsStr {
        &self.name
    }

    fn display_name(&self) -> String {
        self.name.to_string_lossy().into_owned()
    }
}

/// Reads the staged output directory as a bounded set of mzML members.
///
/// The directory is the sole authority for what the backend produced: nothing
/// here reads stdout, counts source samples or trusts a name prefix. The order
/// returned is the snapshot's — the repository's stable Windows filename order
/// — and it is *application* ordering: deterministic so reports and
/// publication are reproducible, and not a claim about vendor sample order.
pub(crate) fn discover_staged_output_set(
    output_directory: &Path,
) -> Result<Vec<DiscoveredMember>, OutputSetRejection> {
    let snapshot = fs_guard::snapshot_output_directory(output_directory).map_err(|error| {
        OutputSetRejection::DirectoryUnreadable {
            kind: match error {
                fs_guard::RegularFileError::Io { kind } => kind,
                _ => io::ErrorKind::Other,
            },
        }
    })?;
    if snapshot.is_empty() {
        return Err(OutputSetRejection::NoOutputs);
    }
    if snapshot.len() > MAX_CONVERSION_OUTPUTS_PER_SOURCE {
        return Err(OutputSetRejection::TooManyOutputs {
            observed: snapshot.len(),
        });
    }

    let mut members = Vec::with_capacity(snapshot.len());
    let mut folded: Vec<String> = Vec::with_capacity(snapshot.len());
    for entry in snapshot.entries() {
        let member = entry.file_name().to_string_lossy().into_owned();
        // Partial first: an in-progress name explains more than "unexpected".
        if entry.has_partial_suffix() {
            return Err(OutputSetRejection::PartialOutputMember { member });
        }
        if entry.kind() != fs_guard::OutputEntryKind::RegularFile {
            return Err(OutputSetRejection::NonRegularMember { member });
        }
        // An mzML name that is exactly one ordinary path component. The
        // component rule is the same lock finalization applies again later;
        // checked here as well so a crafted name refuses the whole set before
        // anything is opened.
        if !entry.has_extension("mzML")
            || finalize::single_component(entry.file_name()).is_err()
            || Path::new(entry.file_name())
                .file_stem()
                .is_none_or(|stem| stem.is_empty())
        {
            return Err(OutputSetRejection::UnexpectedMember { member });
        }
        // The same Windows folding the queue's collision rule uses. Two staged
        // names that fold together cannot both take a destination name.
        let fold = member.to_uppercase();
        if folded.contains(&fold) {
            return Err(OutputSetRejection::FoldedDuplicateMember { member });
        }
        folded.push(fold);
        members.push(DiscoveredMember {
            name: entry.file_name().to_owned(),
            byte_length: entry.byte_length(),
        });
    }
    Ok(members)
}

/// What one member of the set is, in the report.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputMemberState {
    /// Judged valid; no destination name was ever taken for it.
    ValidatedNotPublished,
    /// Judged valid and renamed to its final destination name.
    Finalized,
    /// Never validated, or its publication never began. Nothing exists for it
    /// at the destination.
    NotPublished,
}

impl OutputMemberState {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::ValidatedNotPublished => "validated_not_published",
            Self::Finalized => "finalized",
            Self::NotPublished => "not_published",
        }
    }
}

/// What was established about one member. Path-free: the name is the
/// backend-chosen basename, which is display-grade like every other output
/// name this crate reports.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutputMemberReport {
    file_name: String,
    state: OutputMemberState,
    validation: Option<OutputMemberValidation>,
}

impl OutputMemberReport {
    #[must_use]
    pub fn file_name(&self) -> &str {
        &self.file_name
    }

    #[must_use]
    pub const fn state(&self) -> OutputMemberState {
        self.state
    }

    #[must_use]
    pub const fn validation(&self) -> Option<&OutputMemberValidation> {
        self.validation.as_ref()
    }
}

/// The safe facts of one validated member.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutputMemberValidation {
    byte_length: u64,
    sha256: String,
    spectra: u64,
    chromatograms: u64,
    mode: ValidationMode,
    verified: Vec<&'static str>,
    unverified: Vec<&'static str>,
    inapplicable: Vec<&'static str>,
}

impl OutputMemberValidation {
    fn of(valid: &crate::conversion::ValidConversion) -> Self {
        let ids = |properties: &std::collections::BTreeSet<IntegrityProperty>| {
            properties
                .iter()
                .map(|property| property.stable_id())
                .collect()
        };
        Self {
            byte_length: valid.output().byte_length(),
            sha256: valid.output().sha256().to_string(),
            spectra: valid.output().facts().observed_spectrum_count(),
            chromatograms: valid.output().facts().observed_chromatogram_count(),
            mode: valid.validation_mode(),
            verified: ids(valid.verified()),
            unverified: ids(valid.unverified()),
            inapplicable: ids(valid.inapplicable()),
        }
    }

    #[must_use]
    pub const fn byte_length(&self) -> u64 {
        self.byte_length
    }

    #[must_use]
    pub fn sha256(&self) -> &str {
        &self.sha256
    }

    #[must_use]
    pub const fn spectrum_count(&self) -> u64 {
        self.spectra
    }

    #[must_use]
    pub const fn chromatogram_count(&self) -> u64 {
        self.chromatograms
    }

    #[must_use]
    pub const fn validation_mode(&self) -> ValidationMode {
        self.mode
    }

    #[must_use]
    pub fn verified(&self) -> &[&'static str] {
        &self.verified
    }

    #[must_use]
    pub fn unverified(&self) -> &[&'static str] {
        &self.unverified
    }

    #[must_use]
    pub fn inapplicable(&self) -> &[&'static str] {
        &self.inapplicable
    }
}

/// Why a run published nothing.
///
/// Path-free. Where a variant names members it names bounded basenames, and
/// only the ones needed to explain the refusal.
#[derive(PartialEq)]
pub enum MultiOutputFailure {
    /// The command could not be planned against these capabilities.
    NotPlannable(PlanError),
    /// The source object could not be captured or pinned.
    SourceNotCaptured { kind: io::ErrorKind },
    /// The destination root could not be opened and pinned.
    DestinationRootNotOpened { kind: io::ErrorKind },
    /// The staging area could not be created exclusively.
    StagingNotCreated { kind: io::ErrorKind },
    /// A staging area already occupies the derived name.
    StagingTargetExists,
    /// The process boundary failed.
    Backend(BackendExecutionFailure),
    /// The backend ran and rejected the input.
    BackendRejected { exit_code: Option<i32> },
    /// The backend ended without an ordinary exit and nobody asked it to stop.
    BackendDidNotComplete,
    /// A stop was requested and the owned tree was confirmed gone.
    Cancelled { surviving_processes: Option<u32> },
    /// A stop was requested and this boundary cannot say the tree is gone.
    CancellationNotConfirmed(BackendExecutionFailure),
    /// The staged contents were not an acceptable output set.
    OutputSet(OutputSetRejection),
    /// A member failed validation. Per the all-before-any rule, nothing was
    /// published for any member.
    MemberRejected {
        member: String,
        rejection: ConversionIntegrityOutcome,
    },
    /// The destination could not be inspected for the set preflight.
    DestinationNotInspectable { kind: io::ErrorKind },
    /// Under [`ConflictPolicy::Fail`], at least one planned final name is
    /// already occupied.
    DestinationOccupied { occupied: Vec<String> },
    /// Under [`ConflictPolicy::Skip`], a strict subset of the planned names is
    /// occupied. Skipping some members of one acquisition and publishing the
    /// rest would present a partial acquisition as a converted one, so the set
    /// is refused whole.
    MixedDestinationConflict { occupied: Vec<String> },
    /// The first publication failed, so nothing was published. A failure after
    /// earlier members were already published is not this — it is
    /// [`MultiOutputOutcome::PartiallyFinalized`].
    MemberNotFinalized { member: String, kind: io::ErrorKind },
}

impl MultiOutputFailure {
    #[must_use]
    pub const fn stable_id(&self) -> &'static str {
        match self {
            Self::NotPlannable(_) => "multi_output_not_plannable",
            Self::SourceNotCaptured { .. } => "multi_output_source_not_captured",
            Self::DestinationRootNotOpened { .. } => "multi_output_destination_root_not_opened",
            Self::StagingNotCreated { .. } => "multi_output_staging_not_created",
            Self::StagingTargetExists => "multi_output_staging_target_exists",
            Self::Backend(_) => "multi_output_backend_failure",
            Self::BackendRejected { .. } => "multi_output_backend_rejected",
            Self::BackendDidNotComplete => "multi_output_backend_did_not_complete",
            Self::Cancelled { .. } => "multi_output_cancelled",
            Self::CancellationNotConfirmed(_) => "multi_output_cancellation_not_confirmed",
            Self::OutputSet(_) => "multi_output_set_rejected",
            Self::MemberRejected { .. } => "multi_output_member_rejected",
            Self::DestinationNotInspectable { .. } => "multi_output_destination_not_inspectable",
            Self::DestinationOccupied { .. } => "multi_output_destination_occupied",
            Self::MixedDestinationConflict { .. } => "multi_output_mixed_destination_conflict",
            Self::MemberNotFinalized { .. } => "multi_output_member_not_finalized",
        }
    }
}

impl std::fmt::Debug for MultiOutputFailure {
    /// The stable identifier plus bounded, name-free shape. Member basenames
    /// stay out of every debug projection for the reason the set rejection's
    /// does; the counts say how much was involved without saying what it was
    /// called. Reports carry names deliberately, through accessors -- a debug
    /// string is not a report.
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotPlannable(error) => {
                formatter.debug_tuple("NotPlannable").field(error).finish()
            }
            Self::SourceNotCaptured { kind } => formatter
                .debug_struct("SourceNotCaptured")
                .field("kind", kind)
                .finish(),
            Self::DestinationRootNotOpened { kind } => formatter
                .debug_struct("DestinationRootNotOpened")
                .field("kind", kind)
                .finish(),
            Self::StagingNotCreated { kind } => formatter
                .debug_struct("StagingNotCreated")
                .field("kind", kind)
                .finish(),
            Self::Backend(cause) => formatter.debug_tuple("Backend").field(cause).finish(),
            Self::BackendRejected { exit_code } => formatter
                .debug_struct("BackendRejected")
                .field("exit_code", exit_code)
                .finish(),
            Self::Cancelled {
                surviving_processes,
            } => formatter
                .debug_struct("Cancelled")
                .field("surviving_processes", surviving_processes)
                .finish(),
            Self::CancellationNotConfirmed(cause) => formatter
                .debug_tuple("CancellationNotConfirmed")
                .field(cause)
                .finish(),
            Self::OutputSet(rejection) => {
                formatter.debug_tuple("OutputSet").field(rejection).finish()
            }
            Self::MemberRejected { rejection, .. } => formatter
                .debug_struct("MemberRejected")
                .field("member", &"<redacted>")
                .field("rejection", rejection)
                .finish(),
            Self::DestinationNotInspectable { kind } => formatter
                .debug_struct("DestinationNotInspectable")
                .field("kind", kind)
                .finish(),
            Self::DestinationOccupied { occupied } => formatter
                .debug_struct("DestinationOccupied")
                .field("occupied_count", &occupied.len())
                .finish(),
            Self::MixedDestinationConflict { occupied } => formatter
                .debug_struct("MixedDestinationConflict")
                .field("occupied_count", &occupied.len())
                .finish(),
            Self::MemberNotFinalized { kind, .. } => formatter
                .debug_struct("MemberNotFinalized")
                .field("member", &"<redacted>")
                .field("kind", kind)
                .finish(),
            Self::StagingTargetExists | Self::BackendDidNotComplete => {
                formatter.write_str(self.stable_id())
            }
        }
    }
}

/// How one multi-output run ended, as a group.
#[derive(Debug, PartialEq)]
pub enum MultiOutputOutcome {
    /// Every member was validated and every member received its final name.
    FullyFinalized,
    /// Under [`ConflictPolicy::Skip`], every planned final name was already
    /// occupied, so the whole set was skipped and nothing was touched. The
    /// occupants were never inspected and are never called this run's outputs.
    SkippedExistingDestinations,
    /// Nothing was published, for the stated reason.
    RefusedBeforePublication(MultiOutputFailure),
    /// Publication stopped partway: the named members hold their final
    /// destination names, and the rest were never published.
    ///
    /// This is the honest name for what a sequence of single-file renames can
    /// leave behind. The published members are the user's files and are not
    /// rolled back; the staged remainder was cleaned with the staging area.
    PartiallyFinalized {
        /// Members that received their final names, in publication order.
        finalized: Vec<String>,
        /// The member whose publication failed.
        failed_member: String,
        /// Why it failed, as the filesystem reported it.
        kind: io::ErrorKind,
        /// Members never published: the failed one first, then every member
        /// that was still waiting.
        not_published: Vec<String>,
    },
}

impl MultiOutputOutcome {
    #[must_use]
    pub const fn stable_id(&self) -> &'static str {
        match self {
            Self::FullyFinalized => "fully_finalized",
            Self::SkippedExistingDestinations => "skipped_existing_destinations",
            Self::RefusedBeforePublication(_) => "refused_before_publication",
            Self::PartiallyFinalized { .. } => "partially_finalized",
        }
    }
}

/// What one multi-output run established. Path-free by construction.
#[derive(Debug, PartialEq)]
pub struct MultiOutputConversionReport {
    outcome: MultiOutputOutcome,
    members: Vec<OutputMemberReport>,
    backend: Option<BackendRunFacts>,
    residue: Option<StagingResidue>,
}

impl MultiOutputConversionReport {
    #[must_use]
    pub const fn outcome(&self) -> &MultiOutputOutcome {
        &self.outcome
    }

    /// Every member the run discovered, in the deterministic application
    /// order, with what happened to each.
    #[must_use]
    pub fn members(&self) -> &[OutputMemberReport] {
        &self.members
    }

    #[must_use]
    pub const fn backend(&self) -> Option<BackendRunFacts> {
        self.backend
    }

    #[must_use]
    pub const fn residue(&self) -> Option<StagingResidue> {
        self.residue
    }
}

/// The finalized objects a run retained, beside the report rather than in it.
///
/// One [`FinalizedOutput`] per member that really received its final name — a
/// fully finalized run retains all of them, a partially finalized run retains
/// exactly the published prefix. Dropping this closes the retained handles and
/// deletes nothing: the outputs are the user's files.
pub struct FinalizedOutputSet {
    outputs: Vec<FinalizedOutput>,
}

impl FinalizedOutputSet {
    #[must_use]
    pub fn len(&self) -> usize {
        self.outputs.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.outputs.is_empty()
    }

    #[must_use]
    pub fn outputs(&self) -> &[FinalizedOutput] {
        &self.outputs
    }
}

impl std::fmt::Debug for FinalizedOutputSet {
    /// A count, deliberately. The retained objects hold open handles, and the
    /// report beside this set already carries every safe fact about them.
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("FinalizedOutputSet")
            .field("outputs", &self.outputs.len())
            .finish()
    }
}

/// One multi-output run: the path-free report, and the retained objects.
#[derive(Debug)]
pub struct MultiOutputConversionRun {
    pub report: MultiOutputConversionReport,
    pub retained: FinalizedOutputSet,
}

/// Runs one acquisition through the multi-output lifecycle, for evidence.
///
/// **This is not a production conversion.** It takes a Rust-owned path rather
/// than an admitted source, applies no source-family recognition and consults
/// no provider-evidence row, because no source family is admitted to this
/// lifecycle yet. What it shares with production is everything that matters
/// for the evidence: the reviewed process boundary, the private staging
/// ownership, the fail-closed scanner, the handle-bound finalization and the
/// identity-bound cleanup.
///
/// The input spelling is the plain verified one both measured vendor readers
/// require; the harness confirms it against the real backend.
pub fn run_multi_output_conversion_evidence(
    source: &Path,
    destination_root: &Path,
    conflict: ConflictPolicy,
    capabilities: &InstalledHelpCapabilities,
    runner: &dyn ProcessRunner,
    limits: MzmlScanLimits,
    cancellation: Option<&ConversionCancellation>,
) -> MultiOutputConversionRun {
    let policy = ConversionPolicy::default();

    // Before anything is opened, inspected or created, so a request that was
    // already made costs the user no staging directory and no reads.
    if let Some(cancellation) = cancellation
        && cancellation.is_requested()
    {
        return refused(
            MultiOutputFailure::Cancelled {
                surviving_processes: None,
            },
            None,
            None,
        );
    }

    // The source object, captured through one pinned no-follow handle and held
    // for the whole run — the same posture and the same reason as production:
    // the backend must convert the bytes that were measured.
    let (pinned_source, facts, canonical_source) = match capture_source_object(source) {
        Ok(captured) => captured,
        Err(kind) => return refused(MultiOutputFailure::SourceNotCaptured { kind }, None, None),
    };

    let canonical_destination = match std::fs::canonicalize(destination_root) {
        Ok(canonical) => canonical,
        Err(error) => {
            return refused(
                MultiOutputFailure::DestinationRootNotOpened { kind: error.kind() },
                None,
                None,
            );
        }
    };
    let destination = match finalize::DestinationDirectory::open(&canonical_destination) {
        Ok(directory) => directory,
        Err(error) => {
            return refused(
                MultiOutputFailure::DestinationRootNotOpened { kind: error.kind() },
                None,
                None,
            );
        }
    };

    let staging = match OwnedStagingArea::create(staging_directory(
        &canonical_destination,
        &canonical_source,
    )) {
        Ok(staging) => staging,
        Err(failure) => {
            return refused(staging_failure(&failure), None, None);
        }
    };

    let command = match build_msconvert_set_command_for_source(
        capabilities,
        &canonical_source,
        &staging.output_directory(),
        InputSpelling::PlainVerified,
    ) {
        Ok(command) => command,
        Err(error) => {
            let residue = staging.discard();
            return refused(MultiOutputFailure::NotPlannable(error), None, residue);
        }
    };

    let (backend, process_failure) = run_set_backend(&command, runner, cancellation);
    if let Some(failure) = process_failure {
        let residue = staging.discard();
        return refused(failure, backend, residue);
    }

    let settled = settle_staged_output_set(
        &facts,
        &staging.output_directory(),
        &destination,
        conflict,
        policy,
        limits,
    );
    drop(pinned_source);
    let residue = staging.discard();
    MultiOutputConversionRun {
        report: MultiOutputConversionReport {
            outcome: settled.outcome,
            members: settled.members,
            backend,
            residue,
        },
        retained: FinalizedOutputSet {
            outputs: settled.retained,
        },
    }
}

/// A refusal that produced no members.
fn refused(
    failure: MultiOutputFailure,
    backend: Option<BackendRunFacts>,
    residue: Option<StagingResidue>,
) -> MultiOutputConversionRun {
    MultiOutputConversionRun {
        report: MultiOutputConversionReport {
            outcome: MultiOutputOutcome::RefusedBeforePublication(failure),
            members: Vec::new(),
            backend,
            residue,
        },
        retained: FinalizedOutputSet {
            outputs: Vec::new(),
        },
    }
}

/// Where a multi-output run stages, beside the destination like every other
/// staging area, and named so no single-output run of the same source could
/// derive the same directory.
fn staging_directory(destination_root: &Path, source: &Path) -> PathBuf {
    let stem = source
        .file_stem()
        .map_or_else(|| OsString::from("acquisition"), OsStr::to_os_string);
    let mut name = stem;
    name.push(".mzML-set");
    name.push(super::STAGING_SUFFIX);
    destination_root.join(name)
}

/// The staging-creation failures translated into this lifecycle's vocabulary.
fn staging_failure(failure: &super::ConversionRunFailure) -> MultiOutputFailure {
    match failure {
        super::ConversionRunFailure::StagingTargetExists => MultiOutputFailure::StagingTargetExists,
        super::ConversionRunFailure::StagingNotCreated { kind } => {
            MultiOutputFailure::StagingNotCreated { kind: *kind }
        }
        // `OwnedStagingArea::create` produces only the two staging failures.
        _ => MultiOutputFailure::StagingNotCreated {
            kind: io::ErrorKind::Other,
        },
    }
}

/// Captures the source object for the run: pinned handle, facts, canonical
/// path. The handle is the pin; the caller holds it until the set settles.
fn capture_source_object(
    source: &Path,
) -> Result<(File, SourceObjectFacts, PathBuf), io::ErrorKind> {
    use std::io::Seek;

    let canonical = std::fs::canonicalize(source).map_err(|error| error.kind())?;
    let mut file = super::open_admission_candidate(&canonical).map_err(|error| error.kind())?;
    let metadata = file.metadata().map_err(|error| error.kind())?;
    fs_guard::require_regular_file(&metadata).map_err(|_| io::ErrorKind::InvalidInput)?;
    let identity = SourceIdentity::capture(&canonical).map_err(|error| error.kind())?;
    file.rewind().map_err(|error| error.kind())?;
    let sha256 =
        Sha256Digest::calculate_reader(&mut file).map_err(|_| io::ErrorKind::InvalidData)?;
    let facts = SourceObjectFacts::from_parts(identity, metadata.len(), sha256);
    Ok((file, facts, canonical))
}

/// Runs the backend and classifies everything that is not a clean exit.
///
/// The same classification the single-output run applies, expressed in this
/// lifecycle's vocabulary. Process supervision itself is untouched: the one
/// production runner remains the authority for the child, the job object, the
/// capture and the teardown.
fn run_set_backend(
    command: &CommandSpec,
    runner: &dyn ProcessRunner,
    cancellation: Option<&ConversionCancellation>,
) -> (Option<BackendRunFacts>, Option<MultiOutputFailure>) {
    if let Some(cancellation) = cancellation
        && cancellation.is_requested()
    {
        return (
            None,
            Some(MultiOutputFailure::Cancelled {
                surviving_processes: None,
            }),
        );
    }
    let result = match cancellation {
        Some(cancellation) => runner.run_cancellable(command, cancellation.token()),
        None => runner.run(command),
    };
    let requested = cancellation.is_some_and(ConversionCancellation::is_requested);
    let output = match result {
        Ok(output) => output,
        Err(error) => {
            let cause = BackendExecutionFailure::from(&error);
            let failure = if requested
                && matches!(
                    cause,
                    BackendExecutionFailure::NotTerminated | BackendExecutionFailure::NotAwaited
                ) {
                MultiOutputFailure::CancellationNotConfirmed(cause)
            } else {
                MultiOutputFailure::Backend(cause)
            };
            return (None, Some(failure));
        }
    };
    let backend = Some(BackendRunFacts::from(&output));
    if output.termination != Termination::Exited {
        let failure = if !requested {
            MultiOutputFailure::BackendDidNotComplete
        } else {
            match output.termination {
                Termination::NotStarted => MultiOutputFailure::Cancelled {
                    surviving_processes: None,
                },
                Termination::Cancelled if output.final_active_processes == Some(0) => {
                    MultiOutputFailure::Cancelled {
                        surviving_processes: Some(0),
                    }
                }
                _ => MultiOutputFailure::CancellationNotConfirmed(
                    BackendExecutionFailure::NotTerminated,
                ),
            }
        };
        return (backend, Some(failure));
    }
    if !output.success() {
        return (
            backend,
            Some(MultiOutputFailure::BackendRejected {
                exit_code: output.exit_code,
            }),
        );
    }
    (backend, None)
}

/// Everything the filesystem half of a settled run produced.
pub(crate) struct SettledOutputSet {
    pub(crate) outcome: MultiOutputOutcome,
    pub(crate) members: Vec<OutputMemberReport>,
    pub(crate) retained: Vec<FinalizedOutput>,
}

/// Discovers, validates, preflights and publishes one staged output set.
///
/// This is the lifecycle itself, separable from the backend so the
/// deterministic suite can drive every branch of it over synthetic staging
/// content. The order is the contract:
///
/// 1. the staging directory is read as a bounded set of ordinary mzML members;
/// 2. **every** member is validated — opened no-follow with writers denied,
///    scanned fail-closed, hashed through the held object — before any member
///    is published;
/// 3. the destination is inspected for the complete planned name set;
/// 4. only then are members published, one at a time, in the deterministic
///    order, each through the handle-bound no-clobber rename.
pub(crate) fn settle_staged_output_set(
    source: &SourceObjectFacts,
    staged_output_directory: &Path,
    destination: &finalize::DestinationDirectory,
    conflict: ConflictPolicy,
    policy: ConversionPolicy,
    limits: MzmlScanLimits,
) -> SettledOutputSet {
    settle_staged_output_set_seamed(
        source,
        staged_output_directory,
        destination,
        conflict,
        policy,
        limits,
        |_| {},
    )
}

/// The same lifecycle, with a seam at the one interval its central claims are
/// about: after the whole-set destination preflight and before each member's
/// publication. Production passes an empty hook; the deterministic suite uses
/// it to occupy a destination name mid-set — the race a real filesystem can
/// produce and a test must not have to win probabilistically.
///
/// The hook receives the zero-based index of the member about to be published.
pub(crate) fn settle_staged_output_set_seamed(
    source: &SourceObjectFacts,
    staged_output_directory: &Path,
    destination: &finalize::DestinationDirectory,
    conflict: ConflictPolicy,
    policy: ConversionPolicy,
    limits: MzmlScanLimits,
    mut before_member_publication: impl FnMut(usize),
) -> SettledOutputSet {
    // 1. Discovery. The staging directory is the authority.
    let discovered = match discover_staged_output_set(staged_output_directory) {
        Ok(discovered) => discovered,
        Err(rejection) => {
            return SettledOutputSet {
                outcome: MultiOutputOutcome::RefusedBeforePublication(
                    MultiOutputFailure::OutputSet(rejection),
                ),
                members: Vec::new(),
                retained: Vec::new(),
            };
        }
    };

    // 2. Validation, all before any. Every validated member's exact object is
    // held; a failure publishes nothing whatever the other members looked like.
    // The safe facts are copied out beside each held object, so a member's row
    // in the report keeps them whatever finalization later consumes.
    let mut validated: Vec<(DiscoveredMember, ValidatedConversionOutput)> =
        Vec::with_capacity(discovered.len());
    let mut facts: Vec<(String, OutputMemberValidation)> = Vec::with_capacity(discovered.len());
    for member in &discovered {
        match verify_staged_member_retaining_output(
            source,
            staged_output_directory,
            member.name(),
            member.byte_length,
            policy,
            limits,
        ) {
            VerifiedConversion::Valid(output) => {
                facts.push((
                    member.display_name(),
                    OutputMemberValidation::of(output.valid_ref()),
                ));
                validated.push((member.clone(), *output));
            }
            VerifiedConversion::Rejected(rejection) => {
                let failed = member.display_name();
                return SettledOutputSet {
                    outcome: MultiOutputOutcome::RefusedBeforePublication(
                        MultiOutputFailure::MemberRejected {
                            member: failed,
                            rejection,
                        },
                    ),
                    members: build_member_reports(&discovered, &facts, &[]),
                    retained: Vec::new(),
                };
            }
        }
    }

    // 3. The destination preflight, over the complete name set, only now that
    // every document is known good. The names were unknowable before the
    // backend ran, so this is the earliest a conflict could be seen — recorded
    // as a property of the topology, not a weakness of the check.
    let mut occupied = Vec::new();
    for (member, _) in &validated {
        let target = destination.path().join(member.name());
        match std::fs::symlink_metadata(&target) {
            Ok(_) => occupied.push(member.display_name()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => {
                return SettledOutputSet {
                    outcome: MultiOutputOutcome::RefusedBeforePublication(
                        MultiOutputFailure::DestinationNotInspectable { kind: error.kind() },
                    ),
                    members: build_member_reports(&discovered, &facts, &[]),
                    retained: Vec::new(),
                };
            }
        }
    }
    if !occupied.is_empty() {
        let outcome = match conflict {
            // Any occupation refuses the whole set: which member would have
            // been dropped is not a question Fail answers.
            ConflictPolicy::Fail => MultiOutputOutcome::RefusedBeforePublication(
                MultiOutputFailure::DestinationOccupied { occupied },
            ),
            ConflictPolicy::Skip if occupied.len() == validated.len() => {
                // Every name is taken: the acquisition reads as already
                // converted, and the whole set steps aside. Nothing existing
                // was inspected and nothing is called this run's output.
                MultiOutputOutcome::SkippedExistingDestinations
            }
            // A strict subset is taken. Publishing around it would present a
            // partial acquisition as a converted one, and skipping the whole
            // set would present it as already converted when part of it is
            // not. Neither is true, so the set is refused with the conflict
            // named.
            ConflictPolicy::Skip => MultiOutputOutcome::RefusedBeforePublication(
                MultiOutputFailure::MixedDestinationConflict { occupied },
            ),
        };
        return SettledOutputSet {
            outcome,
            members: build_member_reports(&discovered, &facts, &[]),
            retained: Vec::new(),
        };
    }

    // 4. Publication, one member at a time, in the deterministic order. Not
    // atomic, and not pretended to be: each rename is individually
    // object-bound and no-clobber, and a failure between renames leaves the
    // published prefix exactly where the user asked for it.
    let mut retained: Vec<FinalizedOutput> = Vec::new();
    let mut finalized_names: Vec<String> = Vec::new();
    let mut waiting = validated.into_iter();
    let mut position = 0_usize;
    while let Some((member, output)) = waiting.next() {
        before_member_publication(position);
        position += 1;
        #[cfg(windows)]
        let result = finalize::finalize_validated(output, destination, member.name());
        #[cfg(not(windows))]
        let result = finalize::finalize_validated(
            output,
            destination,
            &staged_output_directory.join(member.name()),
            member.name(),
        );
        match result {
            Ok(finalized) => {
                finalized_names.push(member.display_name());
                retained.push(finalized);
            }
            Err(error) => {
                let failed_member = member.display_name();
                let mut not_published = vec![failed_member.clone()];
                not_published.extend(waiting.map(|(member, _)| member.display_name()));
                let outcome = if finalized_names.is_empty() {
                    // Nothing was published, so this is an ordinary refusal
                    // rather than a partial state.
                    MultiOutputOutcome::RefusedBeforePublication(
                        MultiOutputFailure::MemberNotFinalized {
                            member: failed_member,
                            kind: error.kind(),
                        },
                    )
                } else {
                    MultiOutputOutcome::PartiallyFinalized {
                        finalized: finalized_names.clone(),
                        failed_member,
                        kind: error.kind(),
                        not_published,
                    }
                };
                return SettledOutputSet {
                    members: build_member_reports(&discovered, &facts, &finalized_names),
                    outcome,
                    retained,
                };
            }
        }
    }

    SettledOutputSet {
        outcome: MultiOutputOutcome::FullyFinalized,
        members: build_member_reports(&discovered, &facts, &finalized_names),
        retained,
    }
}

/// One report row per discovered member: finalized members say so, validated
/// ones that never published say that, and a member that was never judged is
/// simply not published. Facts stay on every validated member's row, whether
/// or not finalization later consumed its object.
fn build_member_reports(
    discovered: &[DiscoveredMember],
    facts: &[(String, OutputMemberValidation)],
    finalized: &[String],
) -> Vec<OutputMemberReport> {
    discovered
        .iter()
        .map(|member| {
            let display = member.display_name();
            let validation = facts
                .iter()
                .find(|(name, _)| *name == display)
                .map(|(_, validation)| validation.clone());
            let state = if finalized.contains(&display) {
                OutputMemberState::Finalized
            } else if validation.is_some() {
                OutputMemberState::ValidatedNotPublished
            } else {
                OutputMemberState::NotPublished
            };
            OutputMemberReport {
                file_name: display,
                state,
                validation,
            }
        })
        .collect()
}
