//! The private path from an accepted workspace dataset to one converted mzML.
//!
//! No path reaches the webview from here. ADR 0011 landed this as a private
//! path with no surface; ADR 0012 gives it one, so the report below is now
//! projected into a closed transfer object as well as read from Rust. What
//! crosses is the projection, never the report: the report holds what the run
//! established, and the projection holds what the interface may show.
//!
//! What this module is for is the join. `mscanvas-proteowizard` owns admission,
//! planning, staging, execution and the integrity contract, and owns them for a
//! caller that hands it a path. The session owns the dataset roster, the
//! identity every dataset was accepted with, the hold that keeps it, and the one
//! gate every backend process goes through. Neither side can convert a dataset
//! alone, and the whole risk of connecting them lives in the order the two are
//! touched -- which is why the order is written out here once, rather than being
//! implied by where the code happens to sit.

use std::path::Path;

use mscanvas_proteowizard::FinalizedOutput;
#[cfg(test)]
use mscanvas_proteowizard::run_conversion;
use mscanvas_proteowizard::{
    BackendDiagnosticText, BackendExecutionFailure, BackendRunFacts, CancellationFailure,
    CancellationReport, ConflictPolicy, ConversionAttempt, ConversionCancellation, ConversionPlan,
    ConversionPlanError, ConversionPolicy, ConversionRunFailure, ConversionRunOutcome,
    ConversionRunReport, ConversionSource, ConversionSourceKind, InstalledHelpCapabilities,
    IntegrityProperty, OpenFormat, StagingResidue, ValidationMode, conversion_output_file_name,
    provider_build_is_evidenced, run_conversion_cancellable,
};
// The private multi-output report is built only by the private coordinator,
// which is itself compiled out of the shipped binary.
#[cfg(test)]
use mscanvas_proteowizard::{
    MultiOutputConversionReport, MultiOutputOutcome, OutputMemberReport, OutputMemberValidation,
    SciexSampleCompleteness,
};

use super::backend::ConversionBackend;
use super::dto::{
    ConversionBackendFactsDto, ConversionConflictPolicyDto, ConversionOutputDto,
    ConversionReportDto, ConversionValidationDto, PreviewErrorDto, ValidationModeDto,
};
use super::selection::{DatasetSourceKind, source_kind_dto};

/// What one private conversion did.
///
/// Path-free by construction, and not merely by omission. The caller chose the
/// destination root and already knows it; the output is named by the file name
/// the plan derived and by what was measured of it, which is everything a caller
/// can act on and nothing that would put the user's filesystem into a log, a
/// panic message or a future transfer object built from this type.
///
/// A report exists for a refused conversion as well as a finalized one. The
/// alternative -- an error for anything that did not produce a file -- would
/// collapse "the destination name was already taken", "this build has no
/// evidence for this family" and "the output failed the integrity contract"
/// into one indistinguishable failure, and those are three different answers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct WorkspaceConversionReport {
    /// The handle of the dataset that was converted. The opaque name the
    /// session already uses, not a location.
    dataset: String,
    /// The family the dataset was re-admitted as for this run.
    source_kind: DatasetSourceKind,
    /// What the run did, by the crate's own identifier.
    outcome: &'static str,
    /// The name a finalized output took in the destination root. A display
    /// name, not a location.
    output_file_name: Option<String>,
    /// What was measured of a finalized output.
    output: Option<OutputFacts>,
    /// How a finalized output was judged.
    validation: Option<ValidationFacts>,
    /// The precise failure, reaching into the plan or integrity error where one
    /// exists. Absent unless the run failed.
    detailed_outcome: Option<&'static str>,
    /// How this run ended, as the queue groups it.
    outcome_class: OutcomeClass,
    /// Whether another attempt against the same source, destination, policy and
    /// build could plausibly end differently.
    retryable: bool,
    /// Bounded facts about the backend process, when one ran.
    backend: Option<BackendRunFacts>,
    /// What the run could not reclaim of its own staging area.
    ///
    /// Carried rather than dropped because a conversion that left something
    /// behind is a conversion the caller has to know about, whether or not it
    /// also produced an output.
    residue: Option<StagingResidue>,
    /// The installation sequence this run was stamped with, read at the moment
    /// the backend gate was taken.
    installation_generation: u64,
}

/// What was measured of a finalized output.
///
/// The counts are the observed ones, not the declared ones. A declared count is
/// a claim the document makes about itself; the integrity contract has already
/// compared the two, and what a caller wants to know afterwards is how many
/// records are actually there.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct OutputFacts {
    byte_length: u64,
    sha256: String,
    spectra: u64,
    chromatograms: u64,
}

/// How a finalized output was judged, including what the judgement could not
/// reach.
///
/// `inapplicable` is not a softer `unverified`. A property that could not apply
/// is one this source posture has no reading of at all -- a vendor acquisition
/// is not mzML, so nothing about the output can be compared to a document that
/// was never read. Reporting those as merely unverified would suggest a check
/// that could have been made and was not.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ValidationFacts {
    pub(super) mode: ValidationMode,
    pub(super) verified: Vec<&'static str>,
    pub(super) unverified: Vec<&'static str>,
    pub(super) inapplicable: Vec<&'static str>,
    pub(super) fully_verified: bool,
}

impl WorkspaceConversionReport {
    /// Builds a report from the crate's own report, adding only what the
    /// session knows and the crate cannot: which dataset this was, what family
    /// it was admitted as, and which installation ran it.
    pub(super) fn of(
        dataset: String,
        source_kind: DatasetSourceKind,
        installation_generation: u64,
        plan: &ConversionPlan,
        run: &ConversionRunReport,
    ) -> Self {
        let finalized = run.finalized();
        Self {
            dataset,
            source_kind,
            outcome: run.outcome().stable_id(),
            // The two are not one answer. `outcome` groups -- a caller tells
            // finalized from skipped from failed by it -- and this one
            // explains, which is what a reader needs when the group is
            // "failed".
            detailed_outcome: match run.outcome() {
                ConversionRunOutcome::Failed(failure) => Some(failure.detailed_stable_id()),
                ConversionRunOutcome::Finalized(_)
                | ConversionRunOutcome::SkippedExistingDestination => None,
            },
            // From the plan, which is where the name was decided, and only when
            // a run finalized something. Reporting the planned name for a run
            // that produced nothing would name a file that does not exist -- or
            // worse, one that does and that this run deliberately did not touch.
            output_file_name: finalized
                .map(|_| plan.output_file_name().to_string_lossy().into_owned()),
            output: finalized.map(|valid| OutputFacts {
                byte_length: valid.output().byte_length(),
                sha256: valid.output().sha256().to_string(),
                spectra: valid.output().facts().observed_spectrum_count(),
                chromatograms: valid.output().facts().observed_chromatogram_count(),
            }),
            validation: finalized.map(|valid| ValidationFacts {
                mode: valid.validation_mode(),
                verified: property_ids(valid.verified()),
                unverified: property_ids(valid.unverified()),
                inapplicable: property_ids(valid.inapplicable()),
                fully_verified: valid.is_fully_verified(),
            }),
            outcome_class: outcome_class(run.outcome()),
            retryable: run_is_retryable(run.residue(), run.outcome()),
            backend: run.backend(),
            residue: run.residue(),
            installation_generation,
        }
    }

    /// How this run ended, as the queue groups it.
    pub(super) const fn outcome_class(&self) -> OutcomeClass {
        self.outcome_class
    }

    /// Whether another attempt could plausibly end differently.
    pub(super) const fn is_retryable(&self) -> bool {
        self.retryable
    }

    /// What this report contributes to a failure diagnostic.
    ///
    /// Read individually rather than projected into a second structure. These
    /// are the same safe values `to_dto` forwards -- stable identifiers, closed
    /// enumerations and measurements -- so a diagnostic built from them can
    /// carry no more than the panel already shows.
    pub(super) const fn outcome_id(&self) -> &'static str {
        self.outcome
    }

    pub(super) const fn detailed_outcome_id(&self) -> Option<&'static str> {
        self.detailed_outcome
    }

    pub(super) const fn backend_facts(&self) -> Option<BackendRunFacts> {
        self.backend
    }

    pub(super) const fn residue(&self) -> Option<StagingResidue> {
        self.residue
    }

    pub(super) const fn validation_facts(&self) -> Option<&ValidationFacts> {
        self.validation.as_ref()
    }
}

/// What one private **multi-output** workspace conversion did.
///
/// A separate type rather than a widened [`WorkspaceConversionReport`], and
/// that is a decision rather than convenience. That report names one output:
/// `output_file_name`, `output`, `validation` are all singular, and the
/// planned name is knowable before the run. None of the three survives contact
/// with this topology -- the backend names its own outputs, there may be ten of
/// them, and each is judged on its own. Stretching the singular type until its
/// fields no longer mean what they say is how a report starts lying about the
/// run it describes.
///
/// Path-free by construction, exactly as the single-output report is. What may
/// appear here is what the multi-output lifecycle already treats as a bounded
/// display fact: the backend-chosen basename of each member.
///
/// ## What `fully_finalized` means here, and what it does not
///
/// It means: **every member that entered the admitted output set was validated
/// and successfully published.** It does not mean that every sample in the
/// source acquisition produced an output.
///
/// The distinction is not pedantry, it is a measured property of the reader.
/// ADR 0022 records it: `Reader_ABI` catches a per-sample failure, writes a
/// line to stderr and carries on with the next sample. An acquisition whose
/// samples partly fail to open therefore produces fewer documents, declares
/// exactly those fewer documents on the backend's own stdout, and exits zero.
/// The declaration and the staged set agree, and both are short. Nothing in
/// this boundary can currently tell that from a complete conversion, because
/// nothing here knows how many samples the acquisition holds.
///
/// So this report carries no completeness field. There is no
/// `all_samples_converted`, no `source_complete`, and deliberately no
/// positive variant that no evidence could produce -- a field whose only
/// honest value is "not established" is a field that invites somebody to make
/// it say something else. What this type reports is publication state, and the
/// name of every accessor says so.
#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct WorkspaceMultiOutputConversionReport {
    /// The handle of the dataset that was converted. The opaque name the
    /// session already uses, not a location.
    dataset: String,
    /// The family the dataset was re-admitted as for this run.
    source_kind: DatasetSourceKind,
    /// How many filesystem objects the acquisition was bound to for the run.
    /// Two for a measured SCIEX bundle; the number is what says the whole
    /// acquisition was held, without naming any of it.
    bound_source_objects: usize,
    /// What the run did to the set as a whole, by the crate's own identifier.
    group_outcome: &'static str,
    /// Every member the run discovered, in the lifecycle's deterministic order.
    members: Vec<MultiOutputMemberFacts>,
    /// Where publication stopped, when it stopped partway. Absent for every
    /// other outcome, and never collapsed into an ordinary failure.
    partial: Option<PartialFinalization>,
    /// The precise refusal, when the set was refused before anything published.
    refusal: Option<&'static str>,
    /// Bounded facts about the backend process, when one ran.
    backend: Option<BackendRunFacts>,
    /// What the run could not reclaim of its own staging area.
    residue: Option<StagingResidue>,
    /// The installation sequence this run was stamped with, read at the moment
    /// the backend gate was taken.
    installation_generation: u64,
    /// Whether every sample the reader identified became one of these members.
    ///
    /// A judgement carried beside the publication state, never folded into it.
    /// `None` means the question was not posed -- which for this report cannot
    /// happen, since it only ever describes a family that asks -- and a
    /// `NotEstablished` is a statement that the run did not support the claim
    /// rather than that the acquisition was incomplete.
    ///
    /// Nothing here is a boolean, deliberately. The positive state can only be
    /// minted by the audit that proved it and carries what it was proved from:
    /// the method, the count and the exact executable.
    completeness: Option<SciexSampleCompleteness>,
}

/// One published-or-not member of an output set.
#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct MultiOutputMemberFacts {
    /// The name the backend chose. A display fact, not a location -- the same
    /// one the lifecycle's own report carries.
    file_name: String,
    /// What happened to this member, by the crate's own identifier.
    state: &'static str,
    /// What was measured of it, present exactly where it was validated.
    validation: Option<ValidationFacts>,
    byte_length: Option<u64>,
    sha256: Option<String>,
    spectra: Option<u64>,
    chromatograms: Option<u64>,
}

/// Where a non-atomic publication stopped.
///
/// Carried whole and read through this type's `Debug`, which is deliberate: the
/// desktop layer's job here is not to lose what the lifecycle established, and
/// it has no surface that renders one field of a partial finalization without
/// the others. Accessors would be four ways to read a shape nothing yet
/// displays.
///
/// Kept as its own shape because the platform offers an object-bound single-file
/// rename and not a transaction: a set of ten publishes ten times, and a
/// failure at member six leaves five files that are the user's. Reporting that
/// as an ordinary failure would tell the user nothing was written when five
/// things were.
#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct PartialFinalization {
    /// Members that received their final names, in publication order.
    finalized: Vec<String>,
    /// The member whose publication failed.
    failed_member: String,
    /// Why it failed, as the filesystem reported it.
    kind: std::io::ErrorKind,
    /// Members never published: the failed one first, then the remainder.
    not_published: Vec<String>,
}

#[cfg(test)]
impl WorkspaceMultiOutputConversionReport {
    /// Builds a report from the lifecycle's own, adding only what the session
    /// knows and the crate cannot: which dataset this was, what family it was
    /// admitted as, how many objects that acquisition was bound to, and which
    /// installation ran it.
    pub(super) fn of(
        dataset: String,
        source_kind: DatasetSourceKind,
        bound_source_objects: usize,
        installation_generation: u64,
        run: &MultiOutputConversionReport,
        completeness: Option<SciexSampleCompleteness>,
    ) -> Self {
        let (partial, refusal) = match run.outcome() {
            MultiOutputOutcome::PartiallyFinalized {
                finalized,
                failed_member,
                kind,
                not_published,
            } => (
                Some(PartialFinalization {
                    finalized: finalized.clone(),
                    failed_member: failed_member.clone(),
                    kind: *kind,
                    not_published: not_published.clone(),
                }),
                None,
            ),
            MultiOutputOutcome::RefusedBeforePublication(failure) => {
                (None, Some(failure.stable_id()))
            }
            MultiOutputOutcome::FullyFinalized
            | MultiOutputOutcome::SkippedExistingDestinations => (None, None),
        };
        Self {
            dataset,
            source_kind,
            bound_source_objects,
            group_outcome: run.outcome().stable_id(),
            members: run
                .members()
                .iter()
                .map(MultiOutputMemberFacts::of)
                .collect(),
            partial,
            refusal,
            backend: run.backend(),
            residue: run.residue(),
            installation_generation,
            completeness,
        }
    }

    /// The same report, remembering no completeness.
    ///
    /// There is no other way to reach the ticket's completeness gate from a
    /// test: the SCIEX path establishes completeness before publication, so a
    /// fully finalized run of that family always has it. The gate exists for
    /// the runs that would not -- another family's, or the evidence entry point
    /// that is never asked -- and this forges that state directly rather than
    /// waiting for one to exist.
    #[cfg(test)]
    pub(super) fn without_completeness(mut self) -> Self {
        self.completeness = None;
        self
    }

    /// The same report, one member short.
    ///
    /// Likewise the only way to reach the pairing gate. A report and its
    /// retained objects come from one publication and agree by construction;
    /// what the gate is for is the day they stop agreeing, and a ticket that
    /// paired an object with the wrong member's name would be worse than a
    /// refusal.
    #[cfg(test)]
    pub(super) fn without_last_member(mut self) -> Self {
        self.members.pop();
        self
    }

    /// What this run established about the acquisition's samples.
    ///
    /// Separate from [`Self::group_outcome`] and it must stay separate: that
    /// one says every admitted member was published, and this one says every
    /// identified sample was among them. A run can satisfy the first and not
    /// the second -- measured on the real backend, which is why this exists.
    pub(super) const fn completeness(&self) -> Option<&SciexSampleCompleteness> {
        self.completeness.as_ref()
    }

    pub(super) fn dataset(&self) -> &str {
        &self.dataset
    }

    pub(super) const fn source_kind(&self) -> DatasetSourceKind {
        self.source_kind
    }

    pub(super) const fn bound_source_objects(&self) -> usize {
        self.bound_source_objects
    }

    /// What happened to the set as a whole.
    ///
    /// Named `group_outcome` rather than `outcome` because it is a statement
    /// about the admitted output set and not about the acquisition. See this
    /// type's own documentation for what `fully_finalized` does and does not
    /// establish.
    pub(super) const fn group_outcome(&self) -> &'static str {
        self.group_outcome
    }

    pub(super) fn members(&self) -> &[MultiOutputMemberFacts] {
        &self.members
    }

    /// How many members this run published.
    ///
    /// Counted from the member states rather than from the group outcome, so a
    /// partially finalized run reports the prefix it really wrote.
    pub(super) fn published_count(&self) -> usize {
        self.members
            .iter()
            .filter(|member| member.state == "finalized")
            .count()
    }

    pub(super) const fn partial_finalization(&self) -> Option<&PartialFinalization> {
        self.partial.as_ref()
    }

    pub(super) const fn refusal_id(&self) -> Option<&'static str> {
        self.refusal
    }

    pub(super) const fn backend_facts(&self) -> Option<BackendRunFacts> {
        self.backend
    }

    pub(super) const fn residue(&self) -> Option<StagingResidue> {
        self.residue
    }

    pub(super) const fn installation_generation(&self) -> u64 {
        self.installation_generation
    }
}

#[cfg(test)]
impl MultiOutputMemberFacts {
    fn of(member: &OutputMemberReport) -> Self {
        let validation = member.validation();
        Self {
            file_name: member.file_name().to_owned(),
            state: member.state().stable_id(),
            validation: validation.map(|facts| ValidationFacts {
                mode: facts.validation_mode(),
                verified: owned_static(facts.verified()),
                unverified: owned_static(facts.unverified()),
                inapplicable: owned_static(facts.inapplicable()),
                // Never true for this family and not computed here: an output
                // judged without a source reading of the same kind cannot be
                // fully verified, and saying so is the contract's own answer
                // rather than this report's opinion.
                fully_verified: false,
            }),
            byte_length: validation.map(OutputMemberValidation::byte_length),
            sha256: validation.map(|facts| facts.sha256().to_owned()),
            spectra: validation.map(OutputMemberValidation::spectrum_count),
            chromatograms: validation.map(OutputMemberValidation::chromatogram_count),
        }
    }

    pub(super) fn file_name(&self) -> &str {
        &self.file_name
    }

    pub(super) const fn state(&self) -> &'static str {
        self.state
    }

    pub(super) const fn validation(&self) -> Option<&ValidationFacts> {
        self.validation.as_ref()
    }

    pub(super) const fn byte_length(&self) -> Option<u64> {
        self.byte_length
    }

    pub(super) fn sha256(&self) -> Option<&str> {
        self.sha256.as_deref()
    }

    pub(super) const fn spectrum_count(&self) -> Option<u64> {
        self.spectra
    }

    pub(super) const fn chromatogram_count(&self) -> Option<u64> {
        self.chromatograms
    }
}

/// The stable identifiers of a set of integrity properties.
#[cfg(test)]
fn owned_static(properties: &[&'static str]) -> Vec<&'static str> {
    properties.to_vec()
}

/// The three answers a run can give, as a queue groups them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum OutcomeClass {
    Finalized,
    /// The planned name was taken and the policy asked for it to be left alone.
    /// Not a failure, and deliberately not a success.
    Skipped,
    Failed,
}

const fn outcome_class(outcome: &ConversionRunOutcome) -> OutcomeClass {
    match outcome {
        ConversionRunOutcome::Finalized(_) => OutcomeClass::Finalized,
        ConversionRunOutcome::SkippedExistingDestination => OutcomeClass::Skipped,
        ConversionRunOutcome::Failed(_) => OutcomeClass::Failed,
    }
}

/// Whether another attempt at the *same* plan could plausibly end differently.
///
/// Total over the conversion boundary's own failure vocabulary, with no
/// wildcard arm anywhere: a failure added to the crate later stops this
/// compiling until somebody decides what it means for a retry. That is the
/// whole point of writing it this way -- a default of "retryable" would offer
/// the user a button that reruns a process which cannot succeed, and a default
/// of "not retryable" would quietly hide failures that a second attempt would
/// have fixed.
///
/// "Same plan" is exact: the same source dataset, the same destination folder,
/// the same conflict policy and the same provider build. Nothing here is
/// retryable because the *user* could change something; only because the same
/// request could genuinely go differently.
fn outcome_is_retryable(outcome: &ConversionRunOutcome) -> bool {
    match outcome {
        // Nothing to retry. A skipped item deliberately left a file alone, and
        // rerunning it would leave the same file alone again.
        ConversionRunOutcome::Finalized(_) | ConversionRunOutcome::SkippedExistingDestination => {
            false
        }
        ConversionRunOutcome::Failed(failure) => match failure {
            // The one failure this repository has evidence for as transient.
            // The run could not pin the destination directory, and the crate's
            // own test holds that directory with no sharing, gets exactly this,
            // and then releases it -- so a second attempt against an unlocked
            // folder is a different attempt, not the same one repeated.
            //
            // `NotFound` is the same identifier for the opposite condition: the
            // folder is gone, and it will still be gone next time. Reading the
            // kind is what tells them apart, and is the reason this matches on
            // the variant rather than on its stable identifier.
            ConversionRunFailure::DestinationRootNotOpened { kind } => {
                *kind != std::io::ErrorKind::NotFound
            }

            // Everything below would answer the same way again, and the
            // repository has no measurement suggesting otherwise.
            //
            // The name is taken, and the policy already said what to do about
            // it. Choosing differently is a different queue.
            ConversionRunFailure::DestinationExists
            | ConversionRunFailure::DestinationAppearedDuringRun
            // The destination could not be described, or is no longer the
            // directory this queue was admitted against.
            | ConversionRunFailure::DestinationNotInspectable { .. }
            | ConversionRunFailure::DestinationRootChanged
            | ConversionRunFailure::DestinationRootNotRechecked { .. }
            // A staging area is in the way, or could not be made. The staging
            // name is a deterministic function of the plan, so the next attempt
            // at this plan finds the same obstruction; reclaiming it is not
            // something this workflow offers. `StagingNotCreated` is worse than
            // the others: it is the one failure that can leave a directory
            // behind *without* reporting residue, so a retry could not even be
            // told it was blocked.
            | ConversionRunFailure::StagingTargetExists
            | ConversionRunFailure::StagingNotCreated { .. }
            // The plan itself cannot be expressed against these capabilities.
            | ConversionRunFailure::NotPlannable(_)
            // The acquisition changed under the run, could not be rechecked, or
            // could not be read through to a digest. The plan's baseline is
            // immutable, so a second attempt compares against the same values;
            // the crate's own test runs the same plan three times over a
            // changing source and fails every time.
            | ConversionRunFailure::SourceChangedBeforeRun
            | ConversionRunFailure::SourceNotRechecked { .. }
            | ConversionRunFailure::SourceNotRehashed
            // This build has no recorded evidence for this family. A pure
            // function of the family and the capabilities.
            | ConversionRunFailure::SourceFamilyNotEvidenced => false,
            // The document was produced and judged, and the rename to its final
            // name failed. Nothing here measures whether that is transient, and
            // an unmeasured retry of a rename is a retry that can succeed into
            // a name something else has since taken.
            ConversionRunFailure::NotFinalized { .. } => false,
            // The backend ran and reached a verdict: it rejected the input, or
            // ended without completing. The crate deliberately refuses to
            // interpret backend text, so there is nothing here that says a
            // second identical run would be judged differently.
            ConversionRunFailure::BackendRejected { .. }
            | ConversionRunFailure::BackendDidNotComplete => false,
            // The document that came out failed the integrity contract and was
            // discarded. The contract already tolerates every legal
            // re-serialization, so a rerun that differed only legally would be
            // judged the same way -- which argues against a retry, not for one.
            ConversionRunFailure::OutputRejected(_) => false,
            // Every execution failure. The crate's own failure contract reaches
            // `AfterCorrection` for the launch, executable and source cases --
            // never `Retryable` -- and the three its catch-all calls retryable
            // (`NotSupervised`, `NotAwaited`, `OutputNotCaptured`) get there
            // through an unmeasured default arm belonging to a spike that does
            // not classify conversions at all. Three more are unreachable from
            // a conversion by construction.
            ConversionRunFailure::Backend(
                BackendExecutionFailure::ExecutableNotReverified { .. }
                | BackendExecutionFailure::ExecutableChanged
                | BackendExecutionFailure::SourceNotReverified { .. }
                | BackendExecutionFailure::SourceChanged
                | BackendExecutionFailure::StagedDestinationExists
                | BackendExecutionFailure::StagedDestinationNotInspectable { .. }
                | BackendExecutionFailure::StagingDirectoryNotEmpty
                | BackendExecutionFailure::StagingDirectoryNotInspectable { .. }
                | BackendExecutionFailure::OutputInsideSource
                | BackendExecutionFailure::EnvironmentInvalid
                | BackendExecutionFailure::NotLaunched { .. }
                | BackendExecutionFailure::NotSupervised
                | BackendExecutionFailure::NotAwaited
                | BackendExecutionFailure::OutputNotCaptured { .. }
                | BackendExecutionFailure::NotTerminated,
            ) => false,
        },
    }
}

/// Whether another attempt at this exact plan could plausibly end differently.
///
/// Residue blocks a retry whatever else was wrong. A staging directory is named
/// deterministically from the plan, so the next attempt at this exact plan
/// would find it there and refuse with `staging_target_exists` -- and
/// reclaiming someone else's directory is not something this workflow offers.
///
/// Written as its own function because the two halves answer different
/// questions and only one of them is reachable today: nothing that this
/// repository classifies as retryable happens after a staging directory exists.
/// The guard is kept because a later classification would need it, and it is
/// tested directly rather than left to look load-bearing.
pub(super) fn run_is_retryable(
    residue: Option<StagingResidue>,
    outcome: &ConversionRunOutcome,
) -> bool {
    residue.is_none() && outcome_is_retryable(outcome)
}

/// Whether an attempt that never reached a conversion could plausibly go
/// differently.
///
/// These are the session's own refusals rather than the conversion boundary's,
/// so they are matched by the stable identifier this boundary itself issues.
/// The default is deliberately "no": a refusal this side did not enumerate is
/// one nobody has decided is transient.
pub(super) fn refusal_is_retryable(kind: &str) -> bool {
    // Two identifiers, and they are one condition seen through two opens.
    //
    // Measured on this path: when another program holds the acquisition open
    // for writing, the crate's source admission refuses first, and it refuses
    // with `file_unreadable`. The replacement lock -- which reports the same
    // condition as `source_in_use` -- is never reached, because revalidating
    // the row is what runs first. Both are listed anyway: which of the two
    // opens loses the race is an ordering detail inside this file, not a
    // different thing happening to the user's acquisition.
    //
    // Both mean the object is there and could not be read *now*. Everything
    // else the session can refuse with is a statement about what the row or
    // the request *is* -- the bytes are not an acquisition, the name refers
    // elsewhere, the handle names nothing -- and rerunning the same plan
    // against the same object would reach the same verdict.
    matches!(kind, "source_in_use" | "file_unreadable")
}

/// Property sets as their stable identifiers, in the crate's own order.
fn property_ids<'a>(
    properties: impl IntoIterator<Item = &'a IntegrityProperty>,
) -> Vec<&'static str> {
    properties
        .into_iter()
        .map(|property| property.stable_id())
        .collect()
}

impl WorkspaceConversionReport {
    /// The projection this surface may show.
    ///
    /// Narrower than the report on purpose. Everything here is either a display
    /// name, a measurement or a stable identifier; nothing is a location, and
    /// there is no field a path could reach even if one were added upstream.
    pub(super) fn to_dto(&self) -> ConversionReportDto {
        ConversionReportDto {
            dataset_handle: self.dataset.clone(),
            source_kind: source_kind_dto(self.source_kind),
            outcome: self.outcome.to_owned(),
            detailed_outcome: self.detailed_outcome.map(str::to_owned),
            output_file_name: self.output_file_name.clone(),
            output: self.output.as_ref().map(|output| ConversionOutputDto {
                byte_length: output.byte_length,
                sha256: output.sha256.clone(),
                spectrum_count: output.spectra,
                chromatogram_count: output.chromatograms,
            }),
            validation: self
                .validation
                .as_ref()
                .map(|validation| ConversionValidationDto {
                    mode: validation_mode_dto(validation.mode),
                    fully_verified: validation.fully_verified,
                    verified: owned(&validation.verified),
                    unverified: owned(&validation.unverified),
                    inapplicable: owned(&validation.inapplicable),
                }),
            backend: self.backend.map(|backend| ConversionBackendFactsDto {
                exit_code: backend.exit_code(),
                // Milliseconds, not the Duration itself: a struct with two
                // fields would be a second time format on the wire for no
                // reader that needs one.
                elapsed_milliseconds: u64::try_from(backend.elapsed().as_millis())
                    .unwrap_or(u64::MAX),
            }),
            staging_residue: self.residue.map(|residue| residue.stable_id().to_owned()),
            installation_generation: self.installation_generation,
        }
    }
}

fn owned(properties: &[&'static str]) -> Vec<String> {
    properties
        .iter()
        .map(|property| (*property).to_owned())
        .collect()
}

/// The wire name for how an output was judged.
pub(super) const fn validation_mode_dto(mode: ValidationMode) -> ValidationModeDto {
    match mode {
        ValidationMode::SourceComparison => ValidationModeDto::SourceComparison,
        ValidationMode::OutputOnly => ValidationModeDto::OutputOnly,
    }
}

/// The conversion boundary's name for a conflict policy the webview chose.
///
/// Total, and the only crossing point. There is no overwrite member on either
/// side, so no policy the webview can name replaces a file this boundary did
/// not create.
pub(super) const fn conflict_policy(policy: ConversionConflictPolicyDto) -> ConflictPolicy {
    match policy {
        ConversionConflictPolicyDto::Fail => ConflictPolicy::Fail,
        ConversionConflictPolicyDto::Skip => ConflictPolicy::Skip,
    }
}

/// The compression every output of this workflow must carry.
///
/// Read from the policy a plan is actually fixed with rather than restated, so
/// a summary shown before a conversion and the contract applied after it cannot
/// describe different things.
pub(super) fn fixed_compression() -> &'static str {
    ConversionPolicy::default().compression().stable_id()
}

/// Which family this workflow can convert.
///
/// mzML is already the format the product reads, so converting one to another
/// is work with no product purpose; the private path supports it because the
/// crate does, and the visible workflow declines it because a user asking for
/// it has misunderstood what it does.
pub(super) const fn is_convertible(kind: DatasetSourceKind) -> bool {
    match kind {
        DatasetSourceKind::Mzml => false,
        DatasetSourceKind::ThermoRaw => true,
        // The word ADR 0019 said would be the whole product decision, now
        // deliberately said. ADR 0020 gives this family an ingestion surface
        // and the same queue Thermo uses; the queue reads this predicate to
        // decide which selected rows it accepts, and each item still
        // revalidates under its own family and is gated on its own family's
        // provider evidence.
        DatasetSourceKind::ShimadzuLcd => true,
        // Not convertible *by the visible queue*, which is the only question
        // this predicate answers. The family converts -- ADR 0022 measured it
        // on three real acquisitions -- but through the private multi-output
        // path, and admitting it to a queue built around one planned output per
        // item would plan a name the backend never writes.
        //
        // It is also the honest answer for a second reason that outlives the
        // first: a full multi-output run establishes that every *admitted
        // output member* was published, and not that every sample in the source
        // acquisition converted. Until that gate is closed with evidence, this
        // family has no business in a surface that tells a user their
        // acquisition was converted.
        DatasetSourceKind::SciexWiff => false,
    }
}

/// The name one item's output will take, from the name of its source.
///
/// Derived from the display name the roster already carries, through the very
/// function the plan uses, so a queue can tell the user what it will produce --
/// and refuse two items that would produce one name -- before a folder is
/// chosen and before anything is created.
///
/// Nothing here touches a path. What an output is called is decided by what its
/// source is called.
pub(super) fn planned_output_name(file_name: &str) -> Option<String> {
    conversion_output_file_name(Path::new(file_name), OpenFormat::MzMl)
        .map(|name| name.to_string_lossy().into_owned())
}

/// The conversion boundary's name for a family the session accepted.
///
/// A total function over the session's families, so a family added to the
/// session without a conversion boundary that knows it is a compile error
/// rather than a run-time surprise. There is deliberately no fallback: a family
/// the crate cannot name is a family it cannot convert, and guessing one would
/// admit an acquisition under another family's rules.
///
/// Production since M3.9: the queue's provider-evidence gate asks it for every
/// distinct family a queue holds, before the picker and again before any item
/// stages.
pub(super) const fn conversion_source_kind(kind: DatasetSourceKind) -> ConversionSourceKind {
    match kind {
        DatasetSourceKind::Mzml => ConversionSourceKind::MzmlFile,
        DatasetSourceKind::ThermoRaw => ConversionSourceKind::ThermoRawFile,
        DatasetSourceKind::ShimadzuLcd => ConversionSourceKind::ShimadzuLcdFile,
        DatasetSourceKind::SciexWiff => ConversionSourceKind::SciexWiffBundle,
    }
}

/// Runs a planned conversion through one bound backend.
///
/// Takes the binding whole rather than its parts, so the capabilities a run is
/// gated and planned on and the process it launches cannot come from two
/// different resolutions of the installation.
/// Kept for the one-item path the private orchestration tests drive. Every
/// production conversion now goes through the cancellable entry point, because
/// every production conversion belongs to a queue the user may stop.
#[cfg(test)]
pub(super) fn run_planned_conversion(
    plan: &ConversionPlan,
    backend: &ConversionBackend<'_>,
) -> ConversionRunReport {
    run_conversion(plan, &backend.capabilities, backend.runner)
}

/// Runs a planned conversion the queue may ask to stop.
///
/// The cancellation object is consumed here, which is what binds it to this one
/// attempt: there is no way to hand the same object to a second run, and the
/// caller keeps only the request-only handle it took beforehand.
pub(super) fn run_planned_conversion_cancellable(
    plan: &ConversionPlan,
    backend: &ConversionBackend<'_>,
    cancellation: ConversionCancellation,
) -> ConversionAttempt {
    run_conversion_cancellable(plan, &backend.capabilities, backend.runner, cancellation)
}

/// What one queue item's attempt produced, before the queue classifies it.
///
/// Three answers rather than two, because a stopped attempt is neither a
/// conversion that reached an outcome nor a refusal that never reached one. It
/// carries no report by construction: a stopped attempt finalized nothing, so
/// there is nothing for a report to be about.
pub(super) enum ConvertedItem {
    /// A conversion reached an outcome. The retained output is `Some` exactly
    /// when that outcome finalized one, and it is what a later adoption
    /// recognises the file by. The redacted backend text is `Some` exactly
    /// where the run kept any, which is where it failed.
    Reported(
        WorkspaceConversionReport,
        Option<Box<FinalizedOutput>>,
        Option<Box<BackendDiagnosticText>>,
    ),
    Cancelled(CancellationReport),
    CancellationFailed(CancellationFailure),
}

/// Refuses a family this installation has no recorded evidence for.
///
/// The predicate is the crate's, not a copy of it. `run_conversion` applies the
/// same one regardless, so this is not the gate -- it is the same gate asked
/// early, before a destination has been opened or a staging directory created.
pub(super) fn refuse_unevidenced_build(
    capabilities: &InstalledHelpCapabilities,
    kind: ConversionSourceKind,
) -> Result<(), PreviewErrorDto> {
    if provider_build_is_evidenced(capabilities, kind) {
        return Ok(());
    }
    Err(PreviewErrorDto::new(
        "provider_build_not_evidenced",
        "MSCanvas has no conversion evidence for that acquisition format on the installed \
         ProteoWizard build.",
        false,
    ))
}

/// Plans one conversion, reporting a refusal by the plan error's own name.
pub(super) fn plan_conversion(
    source: ConversionSource,
    destination_root: &Path,
    conflict: ConflictPolicy,
) -> Result<ConversionPlan, PreviewErrorDto> {
    ConversionPlan::to_mzml(source, destination_root, conflict).map_err(not_plannable)
}

/// How a refused plan is reported.
///
/// Matched by name rather than through a catch-all for the same reason a
/// refused admission is: a plan error added later has to be answered here.
fn not_plannable(error: ConversionPlanError) -> PreviewErrorDto {
    let message = match error {
        // The last one is answered with the others because it is the same
        // sentence about a different cause: for a family whose backend names
        // its own outputs, there is no name for a plan to derive. No workspace
        // path can produce it -- that family is private to the conversion crate
        // and reaches a different lifecycle -- so this adds a compiled arm, an
        // existing message and no surface.
        ConversionPlanError::SourceHasNoConvertibleName
        | ConversionPlanError::UnsafeOutputFileName
        | ConversionPlanError::OutputFileNameTooLongToStage
        | ConversionPlanError::SourceProducesAnOutputSet => {
            "MSCanvas could not derive a safe output name for that acquisition."
        }
        ConversionPlanError::DestinationRootNotInspectable { .. }
        | ConversionPlanError::DestinationRootNotADirectory => {
            "MSCanvas could not use that destination folder."
        }
    };
    PreviewErrorDto::new("conversion_not_plannable", message, false)
}
