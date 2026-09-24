//! The project store: one open project, and the only new write authority in
//! this slice.
//!
//! ## What this owns
//!
//! One project document at a time, whether it has unsaved changes, where it was
//! last published, and what the last check established about each of its
//! references. Rust owns all of it. The webview names no path: it addresses
//! records by identifier and asks for native dialogs, exactly as every other
//! owned operation here works.
//!
//! ## What this is not
//!
//! Not a workspace. A project references files; the roster *admits* them. The
//! two are deliberately separate collections, and loading a project admits
//! nothing -- opening one of its references in the viewer is an existing
//! explicit action that obtains its own admission, from the file, at the time.
//!
//! Not a second preference store. This writes only where a user pointed a save
//! dialog, only when a user pressed save, and never on a timer.
//!
//! ## Privacy
//!
//! A project document is a private local working document. It contains file
//! names, file locations and content digests, so it can reveal what a user was
//! working on and correlate copies of the same file. That is disclosed to the
//! user rather than defended against with a scheme that would not work: the
//! document is not encrypted and is not anonymous. What this module does
//! guarantee is that none of it reaches a log, a debug line or an error
//! message -- every refusal below is an enumerated identifier, never a path.

pub mod dto;
pub mod lineage;
pub mod observe;
pub mod payload;
pub mod recipe;
pub mod record;
pub mod targeted_output;

/// This module's own suite. Reachable from the crate's other test modules so
/// that its temporary-directory fixture is written once rather than per suite.
#[cfg(test)]
pub(crate) mod tests;

use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use mscanvas_core::ArtifactId;

use crate::local_document::{self, WriteRefusal};

use observe::{
    Cancellation, InputVerification, MemberObservation, ObjectIdentity, UnavailableReason,
};
use payload::Availability;
use recipe::{AttemptEnd, AttemptOrder, PlanDraft, PlanProblem, RecipeExecutor, RunPhase};
use record::{
    AcquisitionQcSnapshotV1, ArtifactPayload, ArtifactRecord, DocumentProblem, FailureCode,
    FailureStage, InputId, InputRecord, LayerId, LayerRecord, LayerSource, MAX_ARTIFACTS,
    MAX_DOCUMENT_BYTES, MAX_INPUTS, MAX_LAYERS, MAX_RUNS, PayloadReference, ProjectDocument,
    RecordedOperation, RunFailure, RunId, RunInput, RunRecord, StopFacts, StopReason, TargetId,
    TargetedMs1Execution, TargetedMs1Plan, TerminalOutcome,
};

/// The extension a project document carries.
pub const PROJECT_EXTENSION: &str = "mscanvas";

/// The prefix every private sibling a project publish creates carries.
const TEMPORARY_PREFIX: &str = ".mscanvas-project-";

/// Why a project operation was refused.
///
/// Every variant is a stable identifier and nothing else. None of them carries
/// a path, a file name, a digest or an excerpt of a document: a refusal is not
/// a place to disclose where a user was working.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectError {
    /// The current project has unsaved changes and the caller did not say to
    /// discard them.
    UnsavedChanges,
    /// There is no open project to act on.
    NoOpenProject,
    /// This project has never been published, so there is nothing for Save to
    /// replace. Save As chooses where.
    NotYetPublished,
    /// The identifier named no record in the open project.
    UnknownRecord,
    /// The document on disk could not be used. Carries the structural reason.
    Document(DocumentProblem),
    /// The chosen destination is not named as a project document.
    DestinationNotNamed,
    /// The chosen destination holds something that is not one of this build's
    /// project documents. Nothing is replaced.
    DestinationNotAProject,
    /// The chosen destination is the same filesystem object as a file this
    /// project references. Nothing is replaced.
    DestinationAliasesInput,
    /// What is published at the bound name is no longer the document this
    /// session last published there. Nothing is replaced.
    StaleDocument,
    /// The bytes could not be written, or could not take the published name.
    /// Whatever was published before is untouched.
    NotPublished,
    /// The document is larger than this build publishes.
    Oversized,
    /// A file could not be observed. Carries the reason.
    Unavailable(UnavailableReason),
    /// No current check has established that this reference still holds the
    /// bytes the project recorded. Establishing that is the check action, and
    /// pressing something else is not a request to run one.
    NotChecked,
    /// The referenced file no longer holds the bytes the project recorded.
    /// Nothing was admitted and the recorded baseline is untouched.
    ContentChanged,
    /// The filesystem could not say which object one of these files is, so a
    /// measurement of it cannot be bound to what a later step opens. Reading
    /// the file, checking it and recording what it contains all still work;
    /// only handing it to the Workbench under a proof does not.
    ObjectNotIdentified,
    /// The user cancelled.
    Cancelled,
    /// The operation was asked to act on nothing.
    NothingSelected,
    /// A capture or check is already running in this session.
    AlreadyRunning,
    /// The operation identifier names no operation this session will run: it
    /// was never accepted, it already ran, it was superseded, or the project it
    /// was accepted against has been replaced since.
    StaleOperation,
    /// The reference has no current Workbench row, so no layer may be created
    /// from it. A layer stands for something the user can see, and the row is
    /// what makes that true; creating one for a reference that is not there
    /// would be a layer of nothing.
    NotInWorkbench,
    /// A layer is sourced from this reference. The layer is removed first, by
    /// the user, or the reference stays.
    LayerDependsOnInput,
    /// Recorded history depends on this reference: a run consumed it or its
    /// layer, or a record observed it. History is kept whole, and nothing in
    /// this build removes it, so the reference stays.
    InputUsedByRun,
    /// A recorded run consumed this layer, so removing it would leave that
    /// run's lineage pointing at nothing. History is not cascaded away to make
    /// room for a removal.
    LayerUsedByRun,
    /// The preview a QC capture named is not the one the session retains for
    /// this layer's source: another preview has been opened since, a newer
    /// read of the same source replaced it, or it was never this source's.
    PreviewNotCurrent,
    /// The retained preview cannot say which executable produced it, so its
    /// facts cannot be recorded with a producer -- and a guessed producer is
    /// not recorded instead.
    ProducerUnidentified,
    /// The run summary reports more MS-level buckets than a snapshot holds. It
    /// is refused rather than recorded in part.
    SummaryTooLarge,
    /// A targeted MS1 run is in progress, and this would change the project it
    /// is running for: its document, its location or a record it names.
    AnalysisRunning,
    /// An earlier targeted MS1 worker's end was not observed, so it may still
    /// hold its source and its work area. No other run starts until MSCanvas
    /// restarts.
    AnalysisQuarantined,
    /// Another export of a stored result is in progress.
    ExportInProgress,
    /// This build cannot run the recipe now: its pinned runtime is not there
    /// or is not the runtime it pins, or this is not a development build.
    RecipeUnavailable,
    /// The layer's source is not one file named as mzML. Nothing is converted.
    RecipeSourceUnsupported,
    /// The source is on another volume than the work area, so the attempt
    /// would copy it there, and the work area's volume has less free space
    /// than the source's length.
    InsufficientWorkAreaSpace,
    /// The plan named is not the one resolved for review and not one this
    /// project recorded, or its layer, reference or recipe is not what it was.
    PlanNotCurrent,
    /// Something at the result store's name is not this project's store.
    PayloadStoreUnusable,
    /// A result store already exists beside the chosen destination. It is
    /// never replaced or deleted.
    DestinationStoreExists,
    /// A result could not be copied whole for Save As. Nothing was published.
    PayloadNotCopied,
    /// A stored result is not whole, so it cannot be read.
    PayloadUnavailable(Availability),
}

impl ProjectError {
    /// The stable wire identifier. Owned, enumerated, and never a message.
    #[must_use]
    pub fn stable_id(self) -> &'static str {
        match self {
            Self::UnsavedChanges => "unsavedChanges",
            Self::NoOpenProject => "noOpenProject",
            Self::NotYetPublished => "notYetPublished",
            Self::UnknownRecord => "unknownRecord",
            Self::Document(problem) => problem.stable_id(),
            Self::DestinationNotNamed => "destinationNotNamed",
            Self::DestinationNotAProject => "destinationNotAProject",
            Self::DestinationAliasesInput => "destinationAliasesInput",
            Self::StaleDocument => "staleDocument",
            Self::NotPublished => "notPublished",
            Self::Oversized => "oversized",
            Self::Unavailable(reason) => reason.stable_id(),
            Self::NotChecked => "notChecked",
            Self::ContentChanged => "contentChanged",
            Self::ObjectNotIdentified => "objectNotIdentified",
            Self::Cancelled => "cancelled",
            Self::NothingSelected => "nothingSelected",
            Self::AlreadyRunning => "alreadyRunning",
            Self::StaleOperation => "staleOperation",
            Self::NotInWorkbench => "notInWorkbench",
            Self::LayerDependsOnInput => "layerDependsOnInput",
            Self::InputUsedByRun => "inputUsedByRun",
            Self::LayerUsedByRun => "layerUsedByRun",
            Self::PreviewNotCurrent => "previewNotCurrent",
            Self::ProducerUnidentified => "producerUnidentified",
            Self::SummaryTooLarge => "summaryTooLarge",
            Self::AnalysisRunning => "analysisRunning",
            Self::AnalysisQuarantined => "analysisQuarantined",
            Self::ExportInProgress => "exportInProgress",
            Self::RecipeUnavailable => "recipeUnavailable",
            Self::RecipeSourceUnsupported => "recipeSourceUnsupported",
            Self::InsufficientWorkAreaSpace => "insufficientWorkAreaSpace",
            Self::PlanNotCurrent => "planNotCurrent",
            Self::PayloadStoreUnusable => "payloadStoreUnusable",
            Self::DestinationStoreExists => "destinationStoreExists",
            Self::PayloadNotCopied => "payloadNotCopied",
            Self::PayloadUnavailable(availability) => availability.stable_id(),
        }
    }

    /// Whether trying the same thing again could reasonably succeed.
    #[must_use]
    pub const fn retryable(self) -> bool {
        matches!(
            self,
            Self::NotPublished
                | Self::StaleDocument
                | Self::Unavailable(_)
                | Self::AlreadyRunning
                | Self::AnalysisRunning
                | Self::ExportInProgress
                | Self::InsufficientWorkAreaSpace
        )
    }
}

/// The identifier of one accepted check or capture.
///
/// Correlation and nothing else: it names an operation so that a cancel request
/// can say which one it means, and it confers no authority over a file, a
/// path or a project. Minted from a counter this store never reuses, so a
/// request carrying an identifier from an operation that has finished names
/// nothing -- it cannot land on whatever is running now.
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct ProjectJobId(u64);

impl ProjectJobId {
    const PREFIX: &'static str = "project-job-";

    /// The wire form. An opaque handle, like every other reservation the
    /// interface holds.
    #[must_use]
    pub fn handle(self) -> String {
        format!("{}{}", Self::PREFIX, self.0)
    }

    /// Reads a wire handle back. Anything that is not exactly one this build
    /// minted is `None`, and `None` is a stale operation, never a guess.
    #[must_use]
    pub fn parse(handle: &str) -> Option<Self> {
        handle
            .strip_prefix(Self::PREFIX)
            .and_then(|digits| digits.parse().ok())
            .map(Self)
    }
}

impl fmt::Debug for ProjectJobId {
    /// Deliberately opaque, like the workspace's own reservation identifiers.
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("<project-job-id>")
    }
}

/// What a cancel request found when it arrived.
///
/// Not an error in any case. A cancel names an operation; where that operation
/// is the one accepted, its flag is set, and where it is not, nothing happens
/// and the caller is told which kind of nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CancelOutcome {
    /// The named operation is the accepted one, started or not, and has been
    /// asked to stop.
    Cancelled,
    /// No operation is accepted at all. An idle click, which changes nothing.
    NoActiveOperation,
    /// An operation is accepted and it is not the one named. The named one has
    /// finished or was superseded; the current one is untouched.
    Stale,
}

impl CancelOutcome {
    /// The stable wire identifier.
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::Cancelled => "cancelled",
            Self::NoActiveOperation => "noActiveOperation",
            Self::Stale => "stale",
        }
    }
}

/// One accepted check or capture, from acceptance to release.
///
/// Acceptance is what gives an operation an identity and a cancellation state
/// *before* its worker starts. That ordering is the point: a cancel that arrives
/// between the user pressing the button and the worker opening its first file
/// finds this record and stops that exact operation, rather than finding nothing
/// and letting the read run to completion.
struct AcceptedJob {
    id: ProjectJobId,
    /// The session generation it was accepted against. An operation runs only
    /// against the project it was accepted for; if the project is replaced or
    /// its records change first, the ticket is refused rather than run against
    /// something else.
    generation: u64,
    cancellation: Cancellation,
    /// Whether a worker has taken it. A started job is never superseded; an
    /// unstarted one at a stale generation is.
    started: bool,
    /// Whether it holds the project still while it runs: a targeted MS1 run,
    /// which publishes beside the document it started from and records its
    /// run against the layer it read.
    exclusive: bool,
    /// Where an exclusive run is, for the interface.
    phase: Option<RunPhase>,
}

/// Where this session last published the open project, and at which revision.
///
/// The revision is what a Save compares against. A document at the bound name
/// carrying a different project identifier or a different revision is somebody
/// else's state, and replacing it would discard whatever they did.
#[derive(Debug, Clone)]
struct PublishedBinding {
    path: PathBuf,
    revision: u64,
}

impl PublishedBinding {
    /// The directory every relative locator in the document is relative to.
    fn directory(&self) -> &Path {
        self.path.parent().unwrap_or_else(|| Path::new(""))
    }
}

/// A relink the user has been shown and has not yet confirmed.
#[derive(Debug, Clone)]
struct RelinkProposal {
    input_id: InputId,
    candidate: PathBuf,
    matches_baseline: bool,
}

/// One open project and everything the session knows about it.
struct OpenProject {
    document: ProjectDocument,
    binding: Option<PublishedBinding>,
    dirty: bool,
    verification: Vec<(InputId, InputVerification)>,
    proposal: Option<RelinkProposal>,
    /// Which workspace row this session admitted for a reference, if any.
    ///
    /// Session-only, and deliberately not part of the document: a `DatasetId`
    /// belongs to one run of the application, and writing one into a project
    /// file would make a reopened project claim rows nothing admitted. It is
    /// kept only so the surface can offer "show me that row" instead of
    /// offering to add one that is already there.
    ///
    /// Dropped with the project it belongs to, because it lives here; dropped
    /// for one reference when that reference is removed or relinked, because
    /// the record then names something else. Nothing here notices a row
    /// *leaving* the workspace -- the roster is the only authority on which
    /// rows exist, and the interface resolves a remembered handle against it
    /// rather than trusting this list to be current.
    admitted: Vec<(InputId, String)>,
    /// The plan last resolved for review, which a run may execute. Session-
    /// only: a plan becomes history when a run executes it, not when it is
    /// reviewed.
    pending_plan: Option<TargetedMs1Plan>,
    /// What the last look at the result store found. Session-only, like
    /// `verification`: whether a result is whole is observed, never stored.
    payloads: PayloadState,
}

/// What one look at a project's result store found.
#[derive(Debug, Clone, Default)]
struct PayloadState {
    /// Whether a store was beside the published document at all.
    store_found: bool,
    availability: Vec<(ArtifactId, Availability)>,
    /// Whole results in the store that no record of this project names.
    unreferenced: usize,
}

impl OpenProject {
    fn fresh(document: ProjectDocument) -> Self {
        let verification = document
            .inputs
            .iter()
            .map(|input| (input.id, InputVerification::NotChecked))
            .collect();
        Self {
            document,
            binding: None,
            dirty: false,
            verification,
            proposal: None,
            admitted: Vec::new(),
            pending_plan: None,
            payloads: PayloadState::default(),
        }
    }

    /// Whether one referenced result was whole when last looked at.
    fn availability_of(&self, id: ArtifactId) -> Option<Availability> {
        self.payloads
            .availability
            .iter()
            .find(|(recorded, _)| *recorded == id)
            .map(|(_, availability)| *availability)
    }

    /// The workspace row this session admitted for a reference, if any.
    fn admitted_row(&self, id: InputId) -> Option<&str> {
        self.admitted
            .iter()
            .find(|(recorded, _)| *recorded == id)
            .map(|(_, handle)| handle.as_str())
    }

    /// The directory relative locators resolve against.
    ///
    /// `None` until the project has been published somewhere, which is also
    /// exactly when it cannot have a relative locator to resolve.
    fn base_directory(&self) -> Option<&Path> {
        self.binding.as_ref().map(PublishedBinding::directory)
    }

    fn verification_of(&self, id: InputId) -> InputVerification {
        self.verification
            .iter()
            .find(|(recorded, _)| *recorded == id)
            .map_or(InputVerification::NotChecked, |(_, outcome)| *outcome)
    }

    /// Marks every reference unchecked.
    ///
    /// Called whenever something happens that makes an earlier answer no longer
    /// about the current record -- a relink, a new reference, a Save As that
    /// moved the base directory.
    fn reset_verification(&mut self) {
        self.verification = self
            .document
            .inputs
            .iter()
            .map(|input| (input.id, InputVerification::NotChecked))
            .collect();
    }
}

/// What is open, and which version of "what is open" this is.
///
/// One mutex over both, deliberately. The generation exists so that work which
/// released the lock in order to read files can tell whether the project it was
/// reading for is still the project on screen -- and a generation kept in a
/// second lock could be read as unchanged after the first lock had already
/// handed out a different project. They change together or the guard does not
/// work at all.
struct Session {
    project: Option<OpenProject>,
    /// Advanced whenever the record set or the base directory changes, so an
    /// answer computed against the old one is recognised as stale and dropped.
    generation: u64,
    /// The one accepted check or capture, if any. Under the same lock as the
    /// project, because whether an operation may start, whether a cancel has a
    /// target, and whether a commit is still about the open project are one
    /// question asked of one state.
    job: Option<AcceptedJob>,
    /// The last identifier minted. Never reused within this store.
    last_job: u64,
    /// Set when a targeted worker's end was not observed. Never cleared: only
    /// a new process can say that worker is gone.
    analysis_quarantined: bool,
}

impl Session {
    /// Replaces the open project, and says so.
    ///
    /// The one way the project is replaced. Every caller goes through it, so
    /// no replacement can forget to advance the generation.
    fn replace(&mut self, project: Option<OpenProject>) {
        self.project = project;
        self.invalidate();
    }

    /// Says that what was true of this project's records no longer is.
    ///
    /// Called for a removal, a relink and a Save As as well as for a
    /// replacement: each of those makes an answer that is still being computed
    /// an answer about something else.
    fn invalidate(&mut self) {
        self.generation = self.generation.wrapping_add(1);
    }

    /// The open project, or the refusal that there is none.
    fn open(&self) -> Result<&OpenProject, ProjectError> {
        self.project.as_ref().ok_or(ProjectError::NoOpenProject)
    }

    /// The open project, mutably.
    fn open_mut(&mut self) -> Result<&mut OpenProject, ProjectError> {
        self.project.as_mut().ok_or(ProjectError::NoOpenProject)
    }

    /// Refuses a change to the open project while a targeted run holds it.
    ///
    /// Asked by everything that would replace the project, move its document,
    /// or remove or re-point a record a run names. A run publishes its result
    /// beside the document it started from and records itself against the
    /// layer it read; letting either move under it would leave a failure with
    /// nowhere to be recorded, or a result beside a document nobody opened.
    fn refuse_during_analysis(&self) -> Result<(), ProjectError> {
        match &self.job {
            Some(job) if job.started && job.exclusive => Err(ProjectError::AnalysisRunning),
            _ => Ok(()),
        }
    }
}

/// The session's one project.
///
/// A mutex rather than a lock-free structure because every operation here is a
/// user action at human speed. What matters is the discipline around it: the
/// lock is never held while a referenced file is read or hashed, and it is not
/// held across the identity probing a Save As does either. Work of that kind
/// takes what it needs, drops the lock, reads, and takes the lock again to
/// commit -- refusing if the generation moved while it was outside.
///
/// The publish itself does happen under the lock. It touches only the
/// destination, never a referenced file, and holding it is what stops two saves
/// interleaving between the check and the write.
pub struct ProjectStore {
    session: Mutex<Session>,
    /// One export of a stored result at a time. Apart from the session lock,
    /// because an export holds it across a modal dialog and a write, and
    /// nothing else about the project waits on either.
    output_lane: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

/// The one export of a stored result in progress. Released when dropped.
#[derive(Debug)]
pub struct OutputLane(std::sync::Arc<std::sync::atomic::AtomicBool>);

impl Drop for OutputLane {
    fn drop(&mut self) {
        self.0.store(false, std::sync::atomic::Ordering::Release);
    }
}

impl Default for ProjectStore {
    fn default() -> Self {
        Self::new()
    }
}

impl ProjectStore {
    #[must_use]
    pub fn new() -> Self {
        Self {
            session: Mutex::new(Session {
                project: None,
                generation: 0,
                job: None,
                last_job: 0,
                analysis_quarantined: false,
            }),
            output_lane: std::sync::Arc::default(),
        }
    }

    fn locked(&self) -> std::sync::MutexGuard<'_, Session> {
        self.session
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// What the interface renders.
    #[must_use]
    pub fn describe(&self) -> dto::ProjectStateDto {
        let session = self.locked();
        let run = session
            .job
            .as_ref()
            .filter(|job| job.started && job.exclusive)
            .map(|job| (job.id, job.phase.unwrap_or(RunPhase::Preparing)));
        dto::describe(session.project.as_ref(), run)
    }

    /// The targeted run in progress, and where it is.
    #[must_use]
    pub fn analysis_run(&self) -> Option<(ProjectJobId, RunPhase)> {
        let session = self.locked();
        session
            .job
            .as_ref()
            .filter(|job| job.started && job.exclusive)
            .map(|job| (job.id, job.phase.unwrap_or(RunPhase::Preparing)))
    }

    /// Starts a new empty project.
    ///
    /// # Errors
    ///
    /// [`ProjectError::UnsavedChanges`] unless the caller said to discard them.
    pub fn create(&self, name: String, discard_unsaved: bool) -> Result<(), ProjectError> {
        let mut session = self.locked();
        session.refuse_during_analysis()?;
        refuse_unsaved(session.project.as_ref(), discard_unsaved)?;
        let mut document = ProjectDocument::new(bounded_name(name));
        document.revision = 0;
        record::validate(&document).map_err(ProjectError::Document)?;
        session.replace(Some(OpenProject::fresh(document)));
        Ok(())
    }

    /// Closes the open project without publishing anything.
    ///
    /// # Errors
    ///
    /// [`ProjectError::UnsavedChanges`] unless the caller said to discard them.
    pub fn close(&self, discard_unsaved: bool) -> Result<(), ProjectError> {
        let mut session = self.locked();
        session.refuse_during_analysis()?;
        refuse_unsaved(session.project.as_ref(), discard_unsaved)?;
        session.replace(None);
        Ok(())
    }

    /// Opens a published project document.
    ///
    /// The document is read and validated *whole* before any live state is
    /// touched, so a refusal leaves the currently open project exactly as it
    /// was. Nothing embedded in the document is read, resolved or opened here:
    /// every reference starts `NotChecked` and stays that way until the user
    /// asks for a check.
    ///
    /// # Errors
    ///
    /// [`ProjectError::UnsavedChanges`], or a [`DocumentProblem`] wrapped in
    /// [`ProjectError::Document`].
    pub fn open_document(&self, path: &Path, discard_unsaved: bool) -> Result<(), ProjectError> {
        {
            let session = self.locked();
            session.refuse_during_analysis()?;
            refuse_unsaved(session.project.as_ref(), discard_unsaved)?;
        }
        let document = read_document(path)?;
        let revision = document.revision;
        // Outside the lock: this hashes every stored result, and says what it
        // found without repairing anything. A missing store is reported as
        // such; nothing looks for it elsewhere.
        let payloads = observe_payloads(&document, path);
        let mut project = OpenProject::fresh(document);
        project.binding = Some(PublishedBinding {
            path: path.to_path_buf(),
            revision,
        });
        project.payloads = payloads;
        let mut session = self.locked();
        // Re-checked under the lock this replacement happens under. The read
        // above released it, and a commit that arrived meanwhile is exactly
        // what the caller asked not to discard.
        session.refuse_during_analysis()?;
        refuse_unsaved(session.project.as_ref(), discard_unsaved)?;
        session.replace(Some(project));
        Ok(())
    }

    /// Publishes the open project to a destination the user chose.
    ///
    /// Locators are rebased deliberately: every one is resolved against the old
    /// base first, then re-derived against the new directory. A project saved
    /// beside its data therefore keeps referencing that data, and a project
    /// saved elsewhere keeps referencing the same external objects rather than
    /// silently re-pointing at whatever sits at the same relative name under
    /// the new directory.
    ///
    /// A project with stored results takes them along. Every result that is
    /// whole is copied into a store assembled beside the destination, checked
    /// byte for byte, and given the store's name by a rename that refuses an
    /// existing one -- and only then is the document published, so a new
    /// document never names results it does not have. A result already missing
    /// or damaged is carried forward as the record it is and stays unavailable;
    /// copying cannot make it whole. An existing store at the destination is
    /// refused and never deleted, whoever it seems to belong to.
    ///
    /// # Errors
    ///
    /// A destination this build will not write to, or a publish that did not
    /// happen. On every failing path whatever was at the destination is
    /// untouched, and the open project is still bound where it was.
    pub fn save_as(&self, destination: &Path) -> Result<(), ProjectError> {
        self.save_as_with(destination, &SaveAsSeams::PRODUCTION)
    }

    /// [`Self::save_as`], with the moments a test needs to fail in.
    ///
    /// Production passes [`SaveAsSeams::PRODUCTION`] and goes through this
    /// same body, so there is one implementation rather than a tested one and
    /// a shipped one.
    pub(crate) fn save_as_with(
        &self,
        destination: &Path,
        seams: &SaveAsSeams<'_>,
    ) -> Result<(), ProjectError> {
        if !names_a_project(destination) {
            return Err(ProjectError::DestinationNotNamed);
        }
        let directory = destination
            .parent()
            .ok_or(ProjectError::DestinationNotNamed)?;

        // Resolve every reference against where the project is *now*, before
        // anything about the destination is decided. This is the list the
        // aliasing check needs and the list the rebase needs, and taking it
        // once means both see the same thing.
        let (generation, resolved, project_id, binding, managed) = {
            let session = self.locked();
            session.refuse_during_analysis()?;
            let project = session.open()?;
            let existing_base = project.base_directory().map(Path::to_path_buf);
            let mut resolved = Vec::with_capacity(project.document.inputs.len());
            for input in &project.document.inputs {
                let base = existing_base.as_deref().unwrap_or(directory);
                let path = record::resolve(&input.locator, base).map_err(ProjectError::Document)?;
                resolved.push(path);
            }
            // The document this would publish, checked before any stored
            // result is copied: a Save As that cannot publish copies nothing.
            // Checked again at publication, since the project may change.
            rebased_for(&project.document, &resolved, directory)?;
            (
                session.generation,
                resolved,
                project.document.project_id,
                project.binding.clone(),
                managed_results(&project.document),
            )
        };

        // Outside the lock: this opens one handle per referenced file to
        // compare identities, and on a slow volume with a full roster that is
        // seconds of work. Holding the session lock through it would stop the
        // interface describing the project for that whole time.
        refuse_unwritable_destination(
            destination,
            &resolved,
            project_id,
            binding.as_ref().map(|binding| binding.revision),
        )?;
        let destination_existed = std::fs::symlink_metadata(destination).is_ok();
        // The document this session is bound to, chosen again: its store is the
        // one it already has, and there is nothing to copy.
        let same_document = binding
            .as_ref()
            .is_some_and(|binding| same_published_document(&binding.path, destination));
        let pending = if managed.is_empty() || same_document {
            None
        } else {
            Some(assemble_store(
                destination,
                directory,
                project_id,
                binding.as_ref().map(|binding| binding.path.as_path()),
                &managed,
                seams,
            )?)
        };
        let abandon = |pending: &Option<PendingStore>| {
            if let Some(pending) = pending {
                // This operation's own directory, created fresh above.
                let _ = std::fs::remove_dir_all(&pending.path);
            }
        };

        let mut session = self.locked();
        // The project may have been replaced, closed, or had a reference
        // removed while the destination was being judged. Publishing the
        // document this operation cloned would then write something nobody is
        // looking at, over a destination that was approved for something else.
        if session.generation != generation {
            abandon(&pending);
            return Err(ProjectError::StaleDocument);
        }
        if let Err(refusal) = session.refuse_during_analysis() {
            abandon(&pending);
            return Err(refusal);
        }
        let Some(project) = session.project.as_mut() else {
            abandon(&pending);
            return Err(ProjectError::NoOpenProject);
        };
        // A result recorded after the copy was taken is not in the store being
        // assembled, and a document naming it there would name nothing.
        if managed_results(&project.document) != managed {
            abandon(&pending);
            return Err(ProjectError::StaleDocument);
        }

        let candidate = match rebased_for(&project.document, &resolved, directory) {
            Ok(candidate) => candidate,
            Err(refusal) => {
                abandon(&pending);
                return Err(refusal);
            }
        };
        if let Some(pending) = &pending
            && let Err(error) = payload::rename_without_replacing(&pending.path, &pending.store)
        {
            let _ = std::fs::remove_dir_all(&pending.path);
            return Err(if error.kind() == std::io::ErrorKind::AlreadyExists {
                ProjectError::DestinationStoreExists
            } else {
                ProjectError::NotPublished
            });
        }
        // From here a published store is whole whatever happens next. A document
        // publish that fails leaves it unreferenced beside a destination with no
        // document -- which is reported, not undone.
        (seams.before_document)()?;
        if destination_existed {
            publish(directory, destination, &candidate)?;
        } else {
            publish_new(directory, destination, &candidate)?;
        }

        project.document = candidate;
        project.binding = Some(PublishedBinding {
            path: destination.to_path_buf(),
            revision: project.document.revision,
        });
        project.dirty = false;
        if !same_document {
            // About the new store now: what was copied is there whole, and what
            // was not is not there at all, whatever state it was in before.
            let copied = pending
                .as_ref()
                .map_or(&[][..], |pending| pending.copied.as_slice());
            project.payloads = PayloadState {
                store_found: pending.is_some(),
                availability: managed
                    .iter()
                    .map(|(id, _)| {
                        let availability = if copied.contains(id) {
                            Availability::Available
                        } else {
                            Availability::Missing
                        };
                        (*id, availability)
                    })
                    .collect(),
                unreferenced: 0,
            };
        }
        // The base directory may have moved, so what an earlier check
        // established was about different files. Saying nothing is correct;
        // carrying the old answers forward would not be.
        project.reset_verification();
        project.proposal = None;
        session.invalidate();
        Ok(())
    }

    /// Republishes the open project over the document this session bound.
    ///
    /// Replaces that one name and nothing else, and only once what is published
    /// there is still the document this session last published: same project
    /// identifier, same revision. Anything else is another writer's state.
    ///
    /// # Errors
    ///
    /// [`ProjectError::NotYetPublished`] before a first Save As,
    /// [`ProjectError::StaleDocument`] where the bound name no longer holds
    /// this session's last publish, or a publish that did not happen.
    pub fn save(&self) -> Result<(), ProjectError> {
        let (generation, binding, project_id) = {
            let session = self.locked();
            let project = session.open()?;
            (
                session.generation,
                project
                    .binding
                    .clone()
                    .ok_or(ProjectError::NotYetPublished)?,
                project.document.project_id,
            )
        };

        // Outside the lock: this reads a whole published document from a
        // location the user chose, which may be a network share.
        let published = read_document(&binding.path).map_err(|_| ProjectError::StaleDocument)?;
        if published.project_id != project_id || published.revision != binding.revision {
            return Err(ProjectError::StaleDocument);
        }

        let mut session = self.locked();
        if session.generation != generation {
            return Err(ProjectError::StaleDocument);
        }
        let project = session.open_mut()?;
        // The binding is re-read rather than trusted: a Save As could have
        // rebound this project to somewhere else while the read above ran, and
        // publishing to the old name would overwrite a document this session no
        // longer claims.
        if project.binding.as_ref().map(|current| &current.path) != Some(&binding.path)
            || project.binding.as_ref().map(|current| current.revision) != Some(binding.revision)
        {
            return Err(ProjectError::StaleDocument);
        }

        let mut candidate = project.document.clone();
        candidate.revision = candidate.revision.saturating_add(1);
        record::validate(&candidate).map_err(ProjectError::Document)?;
        publish(binding.directory(), &binding.path, &candidate)?;

        project.document = candidate;
        project.binding = Some(PublishedBinding {
            path: binding.path,
            revision: project.document.revision,
        });
        project.dirty = false;
        Ok(())
    }

    /// Registers one local file, and the companions its family mandates, as a
    /// reference.
    ///
    /// The baseline recorded is whatever a stable read observed right now. That
    /// is the whole claim the record makes: these were the bytes when the
    /// reference was made. Nothing here asserts the file is a supported
    /// acquisition, and nothing admits it to the workspace.
    ///
    /// # Errors
    ///
    /// [`ProjectError::Unavailable`] where a member could not be observed.
    pub fn register_input(&self, primary: &Path) -> Result<InputId, ProjectError> {
        let (generation, base) = {
            let session = self.locked();
            let project = session.open()?;
            if project.document.inputs.len() >= MAX_INPUTS {
                return Err(ProjectError::Oversized);
            }
            (
                session.generation,
                project.base_directory().map(Path::to_path_buf),
            )
        };

        // The lock is deliberately not held here: registering a reference reads
        // and hashes the file, and a large one would otherwise block every
        // other description of the project for as long as it took.
        let companions = mandated_companions(primary);
        let members =
            observe::register_members(primary, &companions).map_err(ProjectError::Unavailable)?;
        let locator = observe::registered_locator(primary, base.as_deref());
        let label = display_label(primary);

        let input = InputRecord {
            id: InputId::new(),
            label,
            locator,
            members,
        };
        record::validate_locator(&input.locator).map_err(ProjectError::Document)?;

        let mut session = self.locked();
        // The locator above was derived from the base directory read before the
        // hash. A project replaced, closed or saved elsewhere while that ran has
        // a different base, so this record would name a different file -- and
        // pushing it into whatever is open now would put a reference with one
        // project\'s baseline into another project entirely.
        if session.generation != generation {
            return Err(ProjectError::StaleDocument);
        }
        let project = session.open_mut()?;
        if project.document.inputs.len() >= MAX_INPUTS {
            return Err(ProjectError::Oversized);
        }
        let id = input.id;
        project.document.inputs.push(input);
        // A reference that was just observed is known to match what was just
        // recorded from it. Saying so is not a check the user asked for, but it
        // is a fact this session established with the same mechanism a check
        // uses, and reporting it as unchecked would be the less true answer.
        project
            .verification
            .push((id, InputVerification::MatchingRecordedContent));
        project.dirty = true;
        Ok(id)
    }

    /// Removes one reference that nothing recorded depends on.
    ///
    /// Removing a reference never touches the file it referenced.
    ///
    /// Recorded history is append-only: an object its lineage needs is not
    /// removed independently of it, and this build has no operation that
    /// prunes history or cascades a removal through it. So a reference is
    /// refused while a run consumed it -- completed, failed or cancelled -- or
    /// consumed its layer, or while a record observed it. Deleting that
    /// history to satisfy a removal would remove something the user did not
    /// ask to remove, and silently.
    ///
    /// A reference with only a layer is refused too, and differently: the
    /// layer is an identity the user created and can remove, so they remove it
    /// first and then the reference goes. History is asked about first, so a
    /// reference whose layer a run consumed is not sent to remove a layer that
    /// cannot be removed.
    ///
    /// # Errors
    ///
    /// [`ProjectError::UnknownRecord`] for an identifier this project has no
    /// input for, [`ProjectError::InputUsedByRun`] where recorded history
    /// depends on it, or [`ProjectError::LayerDependsOnInput`] where a layer
    /// is sourced from it. Nothing changes on any of them.
    pub fn remove_input(&self, id: InputId) -> Result<(), ProjectError> {
        let mut session = self.locked();
        session.refuse_during_analysis()?;
        let project = session.open_mut()?;
        let document = &project.document;
        if document.input(id).is_none() {
            return Err(ProjectError::UnknownRecord);
        }
        let layer = document.layer_of_input(id).map(|layer| layer.id);
        let recorded = document.runs.iter().any(|run| {
            run.consumes_input(id) || layer.is_some_and(|layer| run.consumes_layer(layer))
        }) || document.artifacts.iter().any(|artifact| {
            // A record may observe a reference no run in this document names
            // -- one written by another build, or edited by hand -- and it is
            // history all the same.
            artifact.payload.file_facts().is_some_and(|facts| {
                facts
                    .observations
                    .iter()
                    .any(|observation| observation.input_id == id)
            })
        });
        if recorded {
            return Err(ProjectError::InputUsedByRun);
        }
        if layer.is_some() {
            return Err(ProjectError::LayerDependsOnInput);
        }
        project.document.inputs.retain(|input| input.id != id);
        project.verification.retain(|(recorded, _)| *recorded != id);
        // The reference is gone, so there is no longer anything for a
        // remembered row to be the row *of*. The row itself is untouched:
        // removing a project reference has never removed a workspace dataset
        // and does not start now.
        project.admitted.retain(|(recorded, _)| *recorded != id);
        if project
            .proposal
            .as_ref()
            .is_some_and(|proposal| proposal.input_id == id)
        {
            project.proposal = None;
        }
        project.dirty = true;
        // A record that is gone is one an in-flight check or capture must not
        // go on to name.
        session.invalidate();
        Ok(())
    }

    /// Accepts one check or capture, before any of its work starts.
    ///
    /// Answers the identifier the operation will run and be cancelled under.
    /// Idempotent for an accepted operation that has not started yet at the
    /// current generation, so a doubled activation yields one operation rather
    /// than two. Two accepted-but-unstarted operations are *not* handed back:
    /// one whose project has since moved cannot run, and one that has already
    /// been cancelled is finished as far as its user is concerned -- handing
    /// its identifier to the next activation would carry that cancel onto work
    /// nobody cancelled, which is the retargeting this whole design exists to
    /// prevent. Both are replaced. One operation at a time is the bound on
    /// concurrent reading, so an operation that has started refuses a second.
    ///
    /// # Errors
    ///
    /// [`ProjectError::NoOpenProject`], or [`ProjectError::AlreadyRunning`].
    pub fn accept_job(&self) -> Result<ProjectJobId, ProjectError> {
        self.accept_job_with(Cancellation::default())
    }

    /// [`Self::accept_job`], with the cancellation state supplied.
    ///
    /// Crate-internal. It exists so a test can accept an operation whose reads
    /// it can hold at a chunk boundary; production has exactly one way to make
    /// a cancellation state, which is a fresh one, and the only gated one a
    /// test can build is itself `cfg(test)`.
    pub(crate) fn accept_job_with(
        &self,
        cancellation: Cancellation,
    ) -> Result<ProjectJobId, ProjectError> {
        let mut session = self.locked();
        session.open()?;
        match &session.job {
            Some(job) if job.started => return Err(ProjectError::AlreadyRunning),
            Some(job) if job.generation == session.generation && !job.cancellation.requested() => {
                return Ok(job.id);
            }
            _ => {}
        }
        session.last_job = session.last_job.wrapping_add(1);
        let id = ProjectJobId(session.last_job);
        let generation = session.generation;
        session.job = Some(AcceptedJob {
            id,
            generation,
            cancellation,
            started: false,
            exclusive: false,
            phase: None,
        });
        Ok(id)
    }

    /// Asks one named operation to stop.
    ///
    /// Sets that operation's own flag and nothing else. An identifier that
    /// names no accepted operation -- because none is accepted, or because the
    /// accepted one is a different operation -- changes nothing: no flag is
    /// left set for whatever runs next, no run is recorded, and the project is
    /// untouched. That is what makes a cancel a request about one operation
    /// rather than a standing preference.
    ///
    /// An accepted operation that has not started is a valid target. Its
    /// worker will find the flag set before it opens a file.
    pub fn cancel_job(&self, id: ProjectJobId) -> CancelOutcome {
        let session = self.locked();
        match &session.job {
            Some(job) if job.id == id => {
                job.cancellation.request();
                CancelOutcome::Cancelled
            }
            Some(_) => CancelOutcome::Stale,
            None => CancelOutcome::NoActiveOperation,
        }
    }

    /// Takes an accepted operation to run.
    ///
    /// The one place an operation goes from accepted to running. It must be the
    /// accepted operation, not yet started, and accepted against the project
    /// that is open now -- otherwise it is refused and, where its generation is
    /// stale, released, so a ticket for a project that no longer exists cannot
    /// hold the slot.
    fn start_job(
        &self,
        id: ProjectJobId,
        exclusive: bool,
    ) -> Result<(JobGuard<'_>, Cancellation, u64), ProjectError> {
        let mut session = self.locked();
        session.open()?;
        let generation = session.generation;
        let Some(job) = session.job.as_mut() else {
            return Err(ProjectError::StaleOperation);
        };
        if job.id != id {
            return Err(ProjectError::StaleOperation);
        }
        if job.started {
            return Err(ProjectError::AlreadyRunning);
        }
        if job.generation != generation {
            session.job = None;
            return Err(ProjectError::StaleOperation);
        }
        job.started = true;
        // Under the same lock that starts it, so no lifecycle change can land
        // between the start and the moment it is held still.
        job.exclusive = exclusive;
        job.phase = exclusive.then_some(RunPhase::Preparing);
        let cancellation = job.cancellation.clone();
        Ok((
            JobGuard {
                store: self,
                id,
                released: false,
            },
            cancellation,
            generation,
        ))
    }

    /// Checks every reference in the open project against its baseline.
    ///
    /// Runs the accepted operation `id`. The session lock is taken to copy what
    /// is needed, released for the whole of the reading and hashing, and taken
    /// again to record the answers. A project whose generation changed while
    /// this ran has its results discarded rather than applied to a different
    /// project, and a cancellation that took the lock first leaves every
    /// reference unchecked.
    ///
    /// # Errors
    ///
    /// [`ProjectError::NoOpenProject`], [`ProjectError::StaleOperation`] for an
    /// identifier that is not the accepted operation, or
    /// [`ProjectError::AlreadyRunning`] where it already is.
    pub fn check_linked_files(&self, id: ProjectJobId) -> Result<(), ProjectError> {
        let (mut guard, cancellation, generation) = self.start_job(id, false)?;
        let (inputs, base) = {
            let session = self.locked();
            let project = session.open()?;
            (
                project.document.inputs.clone(),
                project.base_directory().map(Path::to_path_buf),
            )
        };

        let mut outcomes = Vec::with_capacity(inputs.len());
        for input in &inputs {
            // A project that has never been published has no directory for a
            // relative locator to be relative to. It also cannot have one --
            // every locator it holds is absolute -- so this base is only ever
            // used by a resolve that does not consult it.
            let base = base.as_deref().unwrap_or_else(|| Path::new(""));
            outcomes.push((input.id, observe::verify_input(input, base, &cancellation)));
        }

        let mut session = self.locked();
        // Whichever of the commit and a cancel took this lock first wins. A
        // cancel that got here first leaves nothing established: every
        // reference this check covered goes back to unchecked, including the
        // ones whose reads had finished, because a check the user stopped is
        // not a check whose partial answers they asked to keep.
        if session.generation != generation {
            // A different project now. These answers are about files that
            // belonged to one nobody is looking at.
        } else if let Some(project) = session.project.as_mut() {
            let cancelled = cancellation.requested();
            for (id, outcome) in outcomes {
                if let Some(slot) = project
                    .verification
                    .iter_mut()
                    .find(|(recorded, _)| *recorded == id)
                {
                    slot.1 = if cancelled {
                        InputVerification::NotChecked
                    } else {
                        outcome
                    };
                }
            }
        }
        // Released under the same lock the answer was recorded under, so no
        // cancel can arrive for an operation that has committed and no next
        // operation can be accepted before this one is gone.
        guard.release(&mut session);
        Ok(())
    }

    /// Runs `CaptureFileFactsV1` over the selected references.
    ///
    /// Produces a file-facts artifact and a terminal run record, or produces
    /// neither. A capture that could not observe every selected reference, or
    /// that the user cancelled, records the run it attempted with its real
    /// outcome and no artifact at all.
    ///
    /// # Errors
    ///
    /// The reason the capture did not complete. A capture that reaches its
    /// commit records its run however it ended -- completed, failed or
    /// cancelled -- except where it cannot: a project replaced or closed while
    /// it read ([`ProjectError::StaleDocument`], [`ProjectError::NoOpenProject`]),
    /// or history at its count bound or a document a Save could no longer
    /// publish ([`ProjectError::Oversized`]), each of which records nothing. A
    /// capture refused before it reads -- nothing selected, an unknown
    /// reference, an operation that is not the accepted one -- records nothing
    /// either.
    pub fn capture_file_facts(
        &self,
        id: ProjectJobId,
        selected: &[InputId],
    ) -> Result<RunId, ProjectError> {
        let (mut guard, cancellation, generation) = self.start_job(id, false)?;
        let (inputs, base) = {
            let session = self.locked();
            let project = session.open()?;
            if selected.is_empty() {
                return Err(ProjectError::NothingSelected);
            }
            if project.document.runs.len() >= MAX_RUNS
                || project.document.artifacts.len() >= MAX_ARTIFACTS
            {
                return Err(ProjectError::Oversized);
            }
            let mut chosen: Vec<InputRecord> = Vec::with_capacity(selected.len());
            for id in selected {
                // Refused here rather than only at the next Save. A run that
                // consumed one input twice is a document `validate` will not
                // publish, and a capture that wrote one would leave a project
                // that cannot be saved and has no operation that repairs it.
                if chosen.iter().any(|input| input.id == *id) {
                    return Err(ProjectError::UnknownRecord);
                }
                chosen.push(
                    project
                        .document
                        .input(*id)
                        .ok_or(ProjectError::UnknownRecord)?
                        .clone(),
                );
            }
            (chosen, project.base_directory().map(Path::to_path_buf))
        };

        let started_at = now_rfc3339();
        let base = base.unwrap_or_default();
        let borrowed: Vec<&InputRecord> = inputs.iter().collect();
        let mut captured = observe::capture_file_facts(&borrowed, &base, &cancellation);
        let finished_at = now_rfc3339();

        let mut session = self.locked();
        // Whichever of the commit and a cancel took this lock first wins. A
        // cancel that arrived after the reads finished but before this point is
        // still a cancel that won: what it stops is the publication of an
        // artifact, and that has not happened yet.
        if cancellation.requested() {
            captured = Err(observe::CaptureFailure::Cancelled);
        }
        // A reference removed, relinked or replaced while this ran means the
        // run about to be written would name records the document no longer
        // has. `validate` refuses a document with a dangling reference, so
        // committing one here would make every later Save fail with no way for
        // the user to undo it. The observation is discarded instead, and the
        // refusal says the work did not reach the project rather than claiming
        // the user cancelled it.
        if session.generation != generation {
            guard.release(&mut session);
            return Err(ProjectError::StaleDocument);
        }
        let Some(project) = session.project.as_mut() else {
            guard.release(&mut session);
            return Err(ProjectError::NoOpenProject);
        };
        // Re-checked, because a QC capture adds a run and an artifact without
        // advancing the generation and may have landed while this read ran.
        // Pushing past either bound would write a document every later Save
        // refuses.
        if project.document.runs.len() >= MAX_RUNS
            || project.document.artifacts.len() >= MAX_ARTIFACTS
        {
            guard.release(&mut session);
            return Err(ProjectError::Oversized);
        }

        let run_id = RunId::new();
        let (outcome, outputs, error) = match captured {
            Ok(facts) => {
                let artifact = ArtifactRecord {
                    id: ArtifactId::new(),
                    label: capture_label(&inputs),
                    payload: ArtifactPayload::FileFactsV1(facts),
                };
                let artifact_id = artifact.id;
                project.document.artifacts.push(artifact);
                (TerminalOutcome::Completed, vec![artifact_id], None)
            }
            Err(observe::CaptureFailure::Cancelled) => (
                TerminalOutcome::Cancelled,
                Vec::new(),
                Some(ProjectError::Cancelled),
            ),
            Err(observe::CaptureFailure::NothingSelected) => (
                TerminalOutcome::Failed,
                Vec::new(),
                Some(ProjectError::NothingSelected),
            ),
            Err(observe::CaptureFailure::InputUnavailable(reason)) => (
                TerminalOutcome::Failed,
                Vec::new(),
                Some(ProjectError::Unavailable(reason)),
            ),
        };

        project.document.runs.push(RunRecord {
            id: run_id,
            operation: RecordedOperation::CaptureFileFactsV1,
            inputs: selected
                .iter()
                .map(|id| RunInput::Input { input_id: *id })
                .collect(),
            output_artifact_ids: outputs,
            outcome,
            application_version: env!("CARGO_PKG_VERSION").to_owned(),
            started_at,
            finished_at,
            targeted_ms1: None,
        });
        // The same measure a QC capture takes, for the same reason: this
        // history may be pinned by a QC run over the same reference. Nothing is
        // kept where a Save could not publish it -- not the run, and not the
        // record a completed capture pushed before it.
        if !fits_every_later_save(&project.document) {
            project.document.runs.pop();
            if outcome == TerminalOutcome::Completed {
                project.document.artifacts.pop();
            }
            guard.release(&mut session);
            return Err(ProjectError::Oversized);
        }
        project.dirty = true;
        guard.release(&mut session);

        match error {
            Some(error) => Err(error),
            None => Ok(run_id),
        }
    }

    /// Examines one user-selected candidate for a reference, without committing
    /// anything.
    ///
    /// Nothing is scanned and nothing is substituted. This looks at exactly the
    /// one file the user pointed at, says whether its bytes are the bytes the
    /// record claims, and remembers it as a proposal until the user confirms or
    /// abandons it.
    ///
    /// # Errors
    ///
    /// [`ProjectError::UnknownRecord`], or the reason the candidate could not
    /// be observed.
    pub fn propose_relink(&self, id: InputId, candidate: &Path) -> Result<bool, ProjectError> {
        let (generation, baseline) = {
            let session = self.locked();
            let project = session.open()?;
            let input = project
                .document
                .input(id)
                .ok_or(ProjectError::UnknownRecord)?;
            let baseline = input
                .members
                .iter()
                .find(|member| member.role == record::MemberRole::Primary)
                .ok_or(ProjectError::Document(DocumentProblem::InconsistentRecord))?
                .baseline
                .clone();
            (session.generation, baseline)
        };

        // Examining one candidate is one read the user just asked for through
        // a dialog, not an accepted operation, so it carries a flag nobody can
        // set.
        let matches_baseline = match observe::observe_member(candidate, &Cancellation::default()) {
            MemberObservation::Observed {
                byte_length,
                digest,
                // A proposal asks one question about one candidate's bytes.
                // Which object they came out of binds nothing here: the user
                // confirms or abandons it, and a confirmation moves a locator
                // rather than admitting anything.
                identity: _,
            } => baseline.matches(byte_length, digest),
            MemberObservation::Unavailable(reason) => {
                return Err(ProjectError::Unavailable(reason));
            }
        };

        let mut session = self.locked();
        // The comparison above was made against a baseline read from the
        // project that was open then. Reopening the same file keeps its
        // identifiers, so the input would still be found -- and the proposal
        // would carry a verdict computed from a different document.
        if session.generation != generation {
            return Err(ProjectError::StaleDocument);
        }
        let project = session.open_mut()?;
        if project.document.input(id).is_none() {
            return Err(ProjectError::UnknownRecord);
        }
        project.proposal = Some(RelinkProposal {
            input_id: id,
            candidate: candidate.to_path_buf(),
            matches_baseline,
        });
        Ok(matches_baseline)
    }

    /// Commits the proposal the user was shown.
    ///
    /// Changes the locator and nothing else. The logical `InputId` is reused,
    /// every run and artifact that named it still names it, and the recorded
    /// baseline is left exactly as it was -- including where the candidate's
    /// bytes differ, because "this record now points here" and "the bytes have
    /// changed" are two facts and committing one must not overwrite the other.
    ///
    /// # Errors
    ///
    /// [`ProjectError::UnknownRecord`] where no proposal for this reference is
    /// outstanding.
    pub fn commit_relink(&self, id: InputId) -> Result<(), ProjectError> {
        let mut session = self.locked();
        session.refuse_during_analysis()?;
        let project = session.open_mut()?;
        let proposal = project
            .proposal
            .clone()
            .filter(|proposal| proposal.input_id == id)
            .ok_or(ProjectError::UnknownRecord)?;
        let base = project.base_directory().map(Path::to_path_buf);
        let locator = observe::registered_locator(&proposal.candidate, base.as_deref());
        record::validate_locator(&locator).map_err(ProjectError::Document)?;

        let input = project
            .document
            .inputs
            .iter_mut()
            .find(|input| input.id == id)
            .ok_or(ProjectError::UnknownRecord)?;
        input.locator = locator;

        // The record now points somewhere else, so what the last check said is
        // about a file this reference no longer names. The one thing known is
        // what the proposal established about the candidate.
        let outcome = if proposal.matches_baseline {
            InputVerification::MatchingRecordedContent
        } else {
            InputVerification::DifferentContent
        };
        if let Some(slot) = project
            .verification
            .iter_mut()
            .find(|(recorded, _)| *recorded == id)
        {
            slot.1 = outcome;
        }
        // The record names a different object now, so a row this session
        // admitted for the old one is no longer this reference's row. The row
        // stays in the workspace, where the user put it.
        project.admitted.retain(|(recorded, _)| *recorded != id);
        project.proposal = None;
        project.dirty = true;
        // The reference points somewhere else now, so a check still running is
        // computing an answer about a file this record no longer names.
        session.invalidate();
        Ok(())
    }

    /// Proves that one reference may be handed to workspace admission, now.
    ///
    /// Runs the accepted operation `job`, like a check does, so it is
    /// cancellable, bounded to one at a time, and tied to the project it was
    /// accepted against.
    ///
    /// Two separate questions, in this order.
    ///
    /// The first is whether the reference is *eligible*: the user must already
    /// have established, through the ordinary check action, that its bytes are
    /// the recorded bytes. Pressing this is not a request to run a check, so a
    /// reference that has never been checked is refused rather than checked
    /// silently.
    ///
    /// The second is whether that is still true. A prior check is not standing
    /// admission authority -- between it and this press the file can have been
    /// edited in place, replaced, deleted or redirected -- so the content is
    /// re-established here, through the same stable read and the same digest
    /// the check itself uses. Path, length, modified time and file identity are
    /// none of them the proof; an in-place edit changes none of the first three
    /// and not the fourth either, and the digest is what sees it.
    ///
    /// Nothing in the document is written on any path through this. A
    /// revalidation that finds something else does update what the *session*
    /// says the last look established -- that is the same slot a check writes,
    /// and leaving it claiming "matches" beside a refusal saying "changed"
    /// would be the interface contradicting itself -- but no baseline is
    /// rewritten, no locator is moved and the project is not marked unsaved.
    ///
    /// # Errors
    ///
    /// [`ProjectError::NotChecked`], [`ProjectError::ContentChanged`] or
    /// [`ProjectError::Unavailable`] for a reference whose current state is not
    /// established as matching; [`ProjectError::Cancelled`];
    /// [`ProjectError::StaleDocument`] where the project moved under the read;
    /// [`ProjectError::UnknownRecord`]; [`ProjectError::StaleOperation`].
    pub fn prove_admissible(
        &self,
        job: ProjectJobId,
        id: InputId,
    ) -> Result<AdmissibleInput, ProjectError> {
        let (mut guard, cancellation, generation) = self.start_job(job, false)?;
        let (input, base) = {
            let session = self.locked();
            let project = session.open()?;
            let input = project
                .document
                .input(id)
                .ok_or(ProjectError::UnknownRecord)?
                .clone();
            refuse_unestablished(project.verification_of(id))?;
            (input, project.base_directory().map(Path::to_path_buf))
        };

        // Outside the lock, for the reason every read in this store is: this
        // hashes a whole acquisition, and holding the session across it would
        // stop the interface describing the project for as long as that took.
        //
        // One pass, answering both halves of one claim: whether the bytes are
        // the recorded bytes, and which objects those bytes came out of. Each
        // identity is read through the same handle its member was hashed
        // through, before that handle is released -- so the evidence is about
        // an object rather than about a name, and a replacement arriving the
        // moment the handle closes cannot present itself as the thing that was
        // measured.
        let base = base.unwrap_or_default();
        let proved = observe::verify_input_objects(&input, &base, &cancellation);
        let observed = proved.verification;
        let path = record::resolve(&input.locator, &base).map_err(ProjectError::Document)?;

        let mut session = self.locked();
        if cancellation.requested() {
            guard.release(&mut session);
            return Err(ProjectError::Cancelled);
        }
        // The project was replaced, closed, saved elsewhere, or had a record
        // removed or relinked while this read ran. What was just proved is
        // about a reference in a project nobody is looking at.
        if session.generation != generation {
            guard.release(&mut session);
            return Err(ProjectError::StaleDocument);
        }
        let Some(project) = session.project.as_mut() else {
            guard.release(&mut session);
            return Err(ProjectError::NoOpenProject);
        };
        if project.document.input(id).is_none() {
            guard.release(&mut session);
            return Err(ProjectError::UnknownRecord);
        }
        if let Some(slot) = project
            .verification
            .iter_mut()
            .find(|(recorded, _)| *recorded == id)
        {
            slot.1 = observed;
        }
        guard.release(&mut session);
        drop(session);

        refuse_unestablished(observed)?;
        // The content is the recorded content and there is still nothing to
        // bind it to. Refused here, before the workspace opens anything, so
        // this does not admit a row it would then decline to name. In practice
        // the workspace refuses such a volume on its own terms first; this is
        // the project saying the same thing in its own vocabulary rather than
        // borrowing "the file has changed", which would not be true.
        if proved.identities().is_empty() {
            return Err(ProjectError::ObjectNotIdentified);
        }
        Ok(AdmissibleInput {
            input: id,
            generation,
            path,
            identities: proved.identities().to_vec(),
        })
    }

    /// Remembers which workspace row one reference was admitted as.
    ///
    /// The last gate, and the one that decides whether the project may claim
    /// the row at all. `admitted` is the *workspace's own* answer about the
    /// objects the row it created is bound to, taken from that row's leased
    /// identities -- not a claim a caller composed, and not a fresh question
    /// put to a path here. It is compared against the objects this operation
    /// actually hashed. Both sides are observations of objects rather than of
    /// names, which is what makes the comparison mean anything once the
    /// proof's own handles are gone.
    ///
    /// A mismatch is refused, never reconciled. The workspace admitted
    /// whatever its own rules admitted and its row stays exactly where it is;
    /// what this declines is the project's claim that the row is its input.
    /// Re-hashing the replacement and carrying on would answer a question
    /// nobody asked.
    ///
    /// # Errors
    ///
    /// [`ProjectError::ContentChanged`] where the admitted objects are not the
    /// objects that were proved, [`ProjectError::StaleDocument`] where the
    /// project moved, or [`ProjectError::UnknownRecord`].
    pub fn record_admission(
        &self,
        proof: &AdmissibleInput,
        handle: &str,
        admitted: &[ObjectIdentity],
    ) -> Result<(), ProjectError> {
        if !same_objects(&proof.identities, admitted) {
            return Err(ProjectError::ContentChanged);
        }
        let mut session = self.locked();
        if session.generation != proof.generation {
            return Err(ProjectError::StaleDocument);
        }
        let project = session.open_mut()?;
        if project.document.input(proof.input).is_none() {
            return Err(ProjectError::UnknownRecord);
        }
        project
            .admitted
            .retain(|(recorded, _)| *recorded != proof.input);
        project.admitted.push((proof.input, handle.to_owned()));
        Ok(())
    }

    /// Abandons an outstanding proposal without committing it.
    pub fn abandon_relink(&self) {
        let mut session = self.locked();
        if let Some(project) = session.project.as_mut() {
            project.proposal = None;
        }
    }

    /// Creates the one layer a reference may have, or answers the one it has.
    ///
    /// A layer is an identity and a source, and creating one reads nothing: no
    /// file, no digest, no provider. What it does ask is whether the reference
    /// is *in the Workbench now*, because a layer stands for something the
    /// user can see. This store remembers which row it admitted for a
    /// reference but never notices that row leaving, so the answer comes from
    /// `row_is_live`, which is the roster's own in-memory answer about the
    /// remembered handle. It is asked with the session lock released: the
    /// roster has its own lock, and this store takes no other lock under its
    /// own.
    ///
    /// Idempotent for a reference that already has a layer, and without the
    /// liveness question: an existing layer is not conditional on the row that
    /// was there when it was made. That is the whole reason a layer exists
    /// rather than the row being the thing.
    ///
    /// # Errors
    ///
    /// [`ProjectError::UnknownRecord`]; [`ProjectError::NotInWorkbench`] where
    /// no row is remembered or the remembered one is gone;
    /// [`ProjectError::Oversized`]; [`ProjectError::StaleDocument`] where the
    /// project moved while the roster was being asked.
    pub fn create_layer(
        &self,
        input: InputId,
        row_is_live: impl FnOnce(&str) -> bool,
    ) -> Result<LayerId, ProjectError> {
        let (generation, handle) = {
            let session = self.locked();
            let project = session.open()?;
            if project.document.input(input).is_none() {
                return Err(ProjectError::UnknownRecord);
            }
            if let Some(existing) = project.document.layer_of_input(input) {
                return Ok(existing.id);
            }
            let handle = project
                .admitted_row(input)
                .ok_or(ProjectError::NotInWorkbench)?
                .to_owned();
            // Unreachable while the bounds are what they are: one layer per
            // input and no more inputs than the layer bound means every input
            // already has its layer by the time this could be true, and the
            // idempotent answer above has returned first. Kept, on both sides
            // of the roster question as `register_input` keeps its own bound,
            // so that a later change to either bound cannot let two creates
            // for two references mint a document `validate` would refuse on
            // every later Save.
            if project.document.layers.len() >= MAX_LAYERS {
                return Err(ProjectError::Oversized);
            }
            (session.generation, handle)
        };

        if !row_is_live(&handle) {
            return Err(ProjectError::NotInWorkbench);
        }

        let mut session = self.locked();
        // The project was replaced, closed, or had a record removed or relinked
        // while the roster was being asked. The row that was found live was
        // found for a reference in a project nobody is looking at.
        if session.generation != generation {
            return Err(ProjectError::StaleDocument);
        }
        let project = session.open_mut()?;
        if project.document.input(input).is_none() {
            return Err(ProjectError::UnknownRecord);
        }
        // A concurrent create that got here first is the same answer, once.
        if let Some(existing) = project.document.layer_of_input(input) {
            return Ok(existing.id);
        }
        // Re-checked, because a create for a different reference does not
        // advance the generation and may have landed while the lock was out.
        if project.document.layers.len() >= MAX_LAYERS {
            return Err(ProjectError::Oversized);
        }
        let id = LayerId::new();
        project.document.layers.push(LayerRecord {
            id,
            source: LayerSource::Input { input_id: input },
        });
        // Not invalidated: adding a layer makes no in-flight answer about the
        // references wrong, because no check or capture names a layer.
        project.dirty = true;
        Ok(id)
    }

    /// Removes one layer, and nothing else.
    ///
    /// The source reference, its verification, its remembered row, every run
    /// and artifact and any outstanding proposal are untouched. A layer a
    /// recorded run consumed is refused instead: that run's lineage is the
    /// layer, and removing it would leave a run that names nothing -- which is
    /// not cascaded away, because history is not deleted to make a removal
    /// possible.
    ///
    /// # Errors
    ///
    /// [`ProjectError::UnknownRecord`] for an identifier this project has no
    /// layer for; [`ProjectError::LayerUsedByRun`] for one a run consumed.
    /// Nothing changes on either.
    pub fn remove_layer(&self, id: LayerId) -> Result<(), ProjectError> {
        let mut session = self.locked();
        session.refuse_during_analysis()?;
        let project = session.open_mut()?;
        if project.document.layer(id).is_none() {
            return Err(ProjectError::UnknownRecord);
        }
        if project
            .document
            .runs
            .iter()
            .any(|run| run.consumes_layer(id))
        {
            return Err(ProjectError::LayerUsedByRun);
        }
        project.document.layers.retain(|layer| layer.id != id);
        project.dirty = true;
        Ok(())
    }

    /// Records one QC summary snapshot of one layer's source: a new run that
    /// consumed the layer, and the snapshot artifact it produced.
    ///
    /// The facts come from `retained`, which is asked about the workspace row
    /// this session remembers for the layer's source and answers the run
    /// summary the preview of that row already established -- or the reason it
    /// cannot. Nothing here reads a file, hashes one or starts a process, and
    /// neither may `retained`: the capture copies what is retained, it does not
    /// establish anything new.
    ///
    /// Historical, every time. Each successful call records a new run and a new
    /// snapshot, even with values identical to an earlier one: two presses are
    /// two observations, and nothing earlier is overwritten.
    ///
    /// The session lock is released while `retained` is asked, and taken again
    /// to commit; the run and its snapshot are then pushed together under it,
    /// or neither is. A project replaced, closed, saved elsewhere or with a
    /// record removed or relinked meanwhile advances the generation. A layer
    /// removed, or its source admitted as a different row, does not, so both
    /// are checked again by value.
    ///
    /// # Errors
    ///
    /// [`ProjectError::UnknownRecord`]; [`ProjectError::NotInWorkbench`] where
    /// the source has no remembered row; [`ProjectError::Oversized`]; whatever
    /// `retained` refuses with; [`ProjectError::StaleDocument`] where the
    /// project moved while it was asked.
    pub fn capture_qc_snapshot(
        &self,
        layer: LayerId,
        retained: impl FnOnce(&str) -> Result<AcquisitionQcSnapshotV1, ProjectError>,
    ) -> Result<ArtifactId, ProjectError> {
        let (generation, source, handle) = {
            let session = self.locked();
            let project = session.open()?;
            let source = project
                .document
                .layer(layer)
                .ok_or(ProjectError::UnknownRecord)?
                .source
                .input_id();
            let handle = project
                .admitted_row(source)
                .ok_or(ProjectError::NotInWorkbench)?
                .to_owned();
            refuse_full_history(&project.document)?;
            (session.generation, source, handle)
        };

        let snapshot = retained(&handle)?;
        record::validate_qc_snapshot(&snapshot).map_err(ProjectError::Document)?;
        let recorded_at = now_rfc3339();

        let mut session = self.locked();
        if session.generation != generation {
            return Err(ProjectError::StaleDocument);
        }
        let project = session.open_mut()?;
        let same_layer = project
            .document
            .layer(layer)
            .is_some_and(|current| current.source.input_id() == source);
        if !same_layer || project.admitted_row(source) != Some(handle.as_str()) {
            return Err(ProjectError::StaleDocument);
        }
        refuse_full_history(&project.document)?;
        let label = project
            .document
            .input(source)
            .map_or_else(String::new, |input| input.label.clone());

        let artifact = ArtifactRecord {
            id: ArtifactId::new(),
            label: bounded_name(format!("QC summary: {label}")),
            payload: ArtifactPayload::AcquisitionQcSnapshotV1(Box::new(snapshot)),
        };
        let artifact_id = artifact.id;
        project.document.artifacts.push(artifact);
        project.document.runs.push(RunRecord {
            id: RunId::new(),
            operation: RecordedOperation::CaptureAcquisitionQcSnapshotV1,
            inputs: vec![RunInput::Layer { layer_id: layer }],
            output_artifact_ids: vec![artifact_id],
            outcome: TerminalOutcome::Completed,
            application_version: env!("CARGO_PKG_VERSION").to_owned(),
            // One instant, because the capture is one: it copies what was
            // already retained and waits on nothing.
            started_at: recorded_at.clone(),
            finished_at: recorded_at,
            targeted_ms1: None,
        });
        // Taken back out, both together, where a Save could not publish them.
        if !fits_every_later_save(&project.document) {
            project.document.runs.pop();
            project.document.artifacts.pop();
            return Err(ProjectError::Oversized);
        }
        // Not invalidated: a new run and artifact make no in-flight answer
        // about the references wrong, exactly as a file-facts capture does not.
        project.dirty = true;
        Ok(artifact_id)
    }
}

impl ProjectStore {
    /// Resolves a targeted MS1 request over one layer into a plan for review.
    ///
    /// Reads no source's content and starts nothing; the executor's preflight
    /// may remove crash-left attempt scratch where the source's copy would not
    /// otherwise fit (see `targeted_ms1::scratch`). The plan is held for this
    /// session so a run can execute exactly what was reviewed; it becomes
    /// history only when a run does. Problems with the request come back as
    /// data, row by row, rather than as a refusal, and so does anything that
    /// would stop the plan running now -- an unsaved project, a runtime that
    /// is not there, a work area with no room for the source's copy -- so the
    /// review can say why.
    ///
    /// # Errors
    ///
    /// [`ProjectError::UnknownRecord`] for a layer this project has no record
    /// of, [`ProjectError::RecipeSourceUnsupported`] for a source that is not
    /// one mzML file, or [`ProjectError::StaleDocument`] where the project
    /// moved while the plan was resolved.
    pub fn resolve_targeted_ms1_plan(
        &self,
        layer: LayerId,
        draft: &PlanDraft,
        executor: &dyn RecipeExecutor,
    ) -> Result<PlanResolution, ProjectError> {
        let (generation, layer_record, input, base) = {
            let session = self.locked();
            let project = session.open()?;
            let layer_record = project
                .document
                .layer(layer)
                .ok_or(ProjectError::UnknownRecord)?
                .clone();
            let input = project
                .document
                .input(layer_record.source.input_id())
                .ok_or(ProjectError::UnknownRecord)?
                .clone();
            (
                session.generation,
                layer_record,
                input,
                project.base_directory().map(Path::to_path_buf),
            )
        };
        if !recipe::source_is_supported(&input) {
            return Err(ProjectError::RecipeSourceUnsupported);
        }
        let plan = match recipe::resolve(&layer_record, &input, draft, recipe::this_build()) {
            Ok(plan) => plan,
            Err(problems) => {
                return Ok(PlanResolution {
                    plan: None,
                    problems,
                    blocked: None,
                });
            }
        };
        // Outside the lock: the placement question opens the source by name.
        let blocked = match base {
            None => Some(ProjectError::NotYetPublished),
            Some(base) => match record::resolve(&input.locator, &base) {
                Ok(source) => executor.preflight(&plan, &source).err(),
                Err(problem) => Some(ProjectError::Document(problem)),
            },
        };
        let mut session = self.locked();
        if session.generation != generation {
            return Err(ProjectError::StaleDocument);
        }
        let blocked = if session.analysis_quarantined {
            Some(ProjectError::AnalysisQuarantined)
        } else {
            blocked
        };
        session.open_mut()?.pending_plan = Some(plan.clone());
        Ok(PlanResolution {
            plan: Some(plan),
            problems: Vec::new(),
            blocked,
        })
    }

    /// Runs one targeted MS1 plan, as the accepted operation `job`.
    ///
    /// Executes the plan resolved for review, or a plan this project already
    /// recorded -- a retry is a new run of the same plan. The project is held
    /// still for the whole run: New, Open, Close and Save As, and removing or
    /// re-pointing what the run names, are refused until it ends.
    ///
    /// Anything refused before the attempt starts records nothing: no saved
    /// document, a plan that is not current, a source this recipe does not
    /// read, a runtime that is not there, a work area with no room for the
    /// source's copy, a store that is not this project's. Once the attempt starts, the run is
    /// recorded however it ends. A completed attempt's result is published
    /// beside the document first and referenced second; a failed or cancelled
    /// one publishes nothing and keeps its run, with its code and stage.
    ///
    /// # Errors
    ///
    /// A refusal before the attempt, or a run that could not be recorded: the
    /// project moved ([`ProjectError::StaleDocument`]) or its history is full
    /// ([`ProjectError::Oversized`]), each of which records nothing.
    pub fn run_targeted_ms1(
        &self,
        job: ProjectJobId,
        plan_sha256: &str,
        executor: &dyn RecipeExecutor,
    ) -> Result<TargetedMs1RunEnd, ProjectError> {
        let (mut guard, cancellation, generation) = self.start_job(job, true)?;
        let (plan, input, binding_path, project_id, plan_recorded) = {
            let session = self.locked();
            if session.analysis_quarantined {
                return Err(ProjectError::AnalysisQuarantined);
            }
            let project = session.open()?;
            let recorded = project.document.plan(plan_sha256).cloned();
            let plan = project
                .pending_plan
                .as_ref()
                .filter(|pending| pending.plan_sha256.eq_ignore_ascii_case(plan_sha256))
                .cloned()
                .or_else(|| recorded.clone())
                .ok_or(ProjectError::PlanNotCurrent)?;
            let layer = project
                .document
                .layer(plan.layer_id)
                .ok_or(ProjectError::PlanNotCurrent)?;
            let input = project
                .document
                .input(plan.input_id)
                .ok_or(ProjectError::PlanNotCurrent)?
                .clone();
            // A plan is executed only by the recipe it was reviewed against,
            // over the reference and the bytes it expects.
            if layer.source.input_id() != plan.input_id
                || record::expected_content_of(&input) != plan.expected_content
                || plan.recipe != recipe::this_build()
            {
                return Err(ProjectError::PlanNotCurrent);
            }
            let binding = project
                .binding
                .clone()
                .ok_or(ProjectError::NotYetPublished)?;
            refuse_full_history(&project.document)?;
            (
                plan,
                input,
                binding.path,
                project.document.project_id,
                recorded.is_some(),
            )
        };
        if !recipe::source_is_supported(&input) {
            return Err(ProjectError::RecipeSourceUnsupported);
        }
        let base = binding_path.parent().unwrap_or_else(|| Path::new(""));
        let source = record::resolve(&input.locator, base).map_err(ProjectError::Document)?;
        executor.preflight(&plan, &source)?;
        let store = payload::store_of(&binding_path).ok_or(ProjectError::NotYetPublished)?;
        payload::ensure_store(&store, project_id)
            .map_err(|_| ProjectError::PayloadStoreUnusable)?;

        let artifact = ArtifactId::new();
        let started_at = now_rfc3339();
        let order = AttemptOrder {
            plan: &plan,
            source: &source,
            store: &store,
            artifact,
        };
        let end = executor.attempt(&order, &cancellation, &|phase| self.set_phase(job, phase));
        let finished_at = now_rfc3339();

        let mut session = self.locked();
        // Before anything else can return: whatever becomes of this run's
        // record, a worker whose end was not observed keeps every other run out.
        if matches!(
            &end,
            AttemptEnd::Failed { failure, .. } if failure.code == FailureCode::WorkerNotAccountedFor
        ) {
            session.analysis_quarantined = true;
        }
        let staged = matches!(end, AttemptEnd::Completed { .. });
        let discard = || {
            if staged {
                payload::discard_staging(&store, artifact);
            }
        };
        // Unreachable while the run holds the project -- every change that
        // would move the generation, the binding or the layer is refused --
        // and checked anyway, because a run recorded against a project it did
        // not run for would be history nobody made.
        if session.generation != generation {
            discard();
            guard.release(&mut session);
            return Err(ProjectError::StaleDocument);
        }
        let Some(project) = session.project.as_mut() else {
            discard();
            guard.release(&mut session);
            return Err(ProjectError::NoOpenProject);
        };
        let still_there = project
            .document
            .layer(plan.layer_id)
            .is_some_and(|layer| layer.source.input_id() == plan.input_id)
            && project.binding.as_ref().map(|binding| &binding.path) == Some(&binding_path);
        if !still_there {
            discard();
            guard.release(&mut session);
            return Err(ProjectError::StaleDocument);
        }
        if refuse_full_history(&project.document).is_err() {
            discard();
            guard.release(&mut session);
            return Err(ProjectError::Oversized);
        }
        // A cancel that reached the commit before it is still a cancel that
        // won: what it stops is the publication of the result.
        let end = match end {
            AttemptEnd::Completed {
                consumed, attempt, ..
            } if cancellation.requested() => {
                discard();
                AttemptEnd::Cancelled {
                    consumed,
                    attempt: Some(attempt),
                    stop: StopFacts {
                        reason: StopReason::CancelRequested,
                        worker_terminated: false,
                        exit_observed: true,
                    },
                }
            }
            other => other,
        };

        let new_plan = !plan_recorded && project.document.plan(&plan.plan_sha256).is_none();
        if new_plan {
            project.document.plans.push(plan.clone());
        }
        let (outcome, execution, result) = match end {
            AttemptEnd::Completed {
                consumed,
                attempt,
                result,
            } => (
                TerminalOutcome::Completed,
                TargetedMs1Execution {
                    plan_sha256: plan.plan_sha256.clone(),
                    consumed_content: consumed,
                    attempt: Some(attempt),
                    failure: None,
                    stop: None,
                },
                Some(result),
            ),
            AttemptEnd::Failed {
                consumed,
                attempt,
                failure,
                stop,
            } => (
                TerminalOutcome::Failed,
                TargetedMs1Execution {
                    plan_sha256: plan.plan_sha256.clone(),
                    consumed_content: consumed,
                    attempt,
                    failure: Some(failure),
                    stop,
                },
                None,
            ),
            AttemptEnd::Cancelled {
                consumed,
                attempt,
                stop,
            } => (
                TerminalOutcome::Cancelled,
                TargetedMs1Execution {
                    plan_sha256: plan.plan_sha256.clone(),
                    consumed_content: consumed,
                    attempt,
                    failure: None,
                    stop: Some(stop),
                },
                None,
            ),
        };
        let run_id = RunId::new();
        let completed = result.is_some();
        if let Some(result) = result {
            project.document.artifacts.push(ArtifactRecord {
                id: artifact,
                label: bounded_name(format!(
                    "Targeted MS1: {}",
                    project
                        .document
                        .input(plan.input_id)
                        .map_or("", |input| input.label.as_str())
                )),
                payload: ArtifactPayload::TargetedMs1ResultV1(Box::new(result)),
            });
        }
        project.document.runs.push(RunRecord {
            id: run_id,
            operation: RecordedOperation::TargetedMs1V1,
            inputs: vec![RunInput::Layer {
                layer_id: plan.layer_id,
            }],
            output_artifact_ids: if completed {
                vec![artifact]
            } else {
                Vec::new()
            },
            outcome,
            application_version: env!("CARGO_PKG_VERSION").to_owned(),
            started_at,
            finished_at,
            targeted_ms1: Some(Box::new(execution)),
        });
        // Measured before anything is published: a result a Save could never
        // write into the document is not published beside it either.
        if !fits_every_later_save(&project.document) {
            project.document.runs.pop();
            if completed {
                project.document.artifacts.pop();
            }
            if new_plan {
                project.document.plans.pop();
            }
            discard();
            guard.release(&mut session);
            return Err(ProjectError::Oversized);
        }
        let mut outcome = outcome;
        if completed {
            if let Some(job) = session.job.as_mut() {
                job.phase = Some(RunPhase::Publishing);
            }
            let project = session
                .project
                .as_mut()
                .expect("the project checked above is still open under the same lock");
            match payload::publish(&store, artifact) {
                Ok(()) => {
                    project.payloads.store_found = true;
                    project
                        .payloads
                        .availability
                        .push((artifact, Availability::Available));
                }
                // A validated result that could not take its name publishes
                // nothing, and the run says so rather than disappearing.
                Err(_) => {
                    payload::discard_staging(&store, artifact);
                    project.document.artifacts.pop();
                    if let Some(run) = project.document.runs.last_mut() {
                        run.outcome = TerminalOutcome::Failed;
                        run.output_artifact_ids.clear();
                        if let Some(execution) = run.targeted_ms1.as_mut() {
                            execution.failure = Some(RunFailure {
                                code: FailureCode::PayloadNotPublished,
                                stage: FailureStage::Publish,
                            });
                        }
                    }
                    outcome = TerminalOutcome::Failed;
                }
            }
        }
        if let Some(project) = session.project.as_mut() {
            project.dirty = true;
        }
        guard.release(&mut session);
        Ok(TargetedMs1RunEnd {
            run: run_id,
            outcome,
            artifact: (outcome == TerminalOutcome::Completed).then_some(artifact),
        })
    }

    /// Records where the exclusive run `job` is, if it is still the one.
    fn set_phase(&self, job: ProjectJobId, phase: RunPhase) {
        let mut session = self.locked();
        if let Some(accepted) = session.job.as_mut().filter(|accepted| accepted.id == job) {
            accepted.phase = Some(phase);
        }
    }

    /// Where one stored result is, and what its record says it holds.
    fn result_location(
        &self,
        artifact: ArtifactId,
    ) -> Result<(std::path::PathBuf, PayloadReference), ProjectError> {
        let session = self.locked();
        let project = session.open()?;
        let reference = project
            .document
            .artifact(artifact)
            .and_then(|record| record.payload.targeted_ms1())
            .ok_or(ProjectError::UnknownRecord)?
            .payload
            .clone();
        let store = project
            .binding
            .as_ref()
            .and_then(|binding| payload::store_of(&binding.path))
            .ok_or(ProjectError::PayloadUnavailable(Availability::Missing))?;
        Ok((store, reference))
    }

    /// One page of a stored result's rows, checked against its record.
    ///
    /// # Errors
    ///
    /// [`ProjectError::UnknownRecord`], or [`ProjectError::PayloadUnavailable`]
    /// where the result is missing or does not match its record.
    pub fn read_targeted_ms1_rows(
        &self,
        artifact: ArtifactId,
        offset: usize,
    ) -> Result<payload::RowsPage, ProjectError> {
        let (store, reference) = self.result_location(artifact)?;
        payload::read_rows(&store, artifact, &reference, offset, payload::MAX_PAGE_ROWS)
            .map_err(read_refusal)
    }

    /// One target's evidence from a stored result, checked line by line.
    ///
    /// # Errors
    ///
    /// As [`Self::read_targeted_ms1_rows`], and [`ProjectError::UnknownRecord`]
    /// for a target the result does not have.
    pub fn read_targeted_ms1_evidence(
        &self,
        artifact: ArtifactId,
        target: TargetId,
    ) -> Result<Vec<payload::EvidenceLine>, ProjectError> {
        let (store, reference) = self.result_location(artifact)?;
        payload::read_evidence(&store, artifact, &reference, target).map_err(read_refusal)
    }

    /// One target's stored evidence as its canonical figure, and the target's
    /// position in the plan.
    ///
    /// Read from the stored result alone, as [`Self::stored_targeted_result`]
    /// is. The screen and every export draw this same figure.
    ///
    /// # Errors
    ///
    /// [`TargetedFigureRefusal`].
    pub fn targeted_evidence_figure(
        &self,
        artifact: ArtifactId,
        target: TargetId,
        size: mscanvas_plot_spec::spec::FigureSize,
        theme: mscanvas_plot_spec::spec::FigureTheme,
    ) -> Result<(mscanvas_plot_spec::spec::FigureSpec, usize), TargetedFigureRefusal> {
        use targeted_output::EvidenceRefusal;
        let stored = self
            .stored_targeted_result(artifact)
            .map_err(TargetedFigureRefusal::Project)?;
        let (position, _, row) = stored
            .target(target)
            .ok_or(TargetedFigureRefusal::Project(ProjectError::UnknownRecord))?;
        if row.ion.is_none() {
            return Err(TargetedFigureRefusal::NotExtracted);
        }
        let evidence = self
            .read_targeted_ms1_evidence(artifact, target)
            .map_err(TargetedFigureRefusal::Project)?;
        let figure = targeted_output::evidence_figure(&stored, target, &evidence, size, theme)
            .map_err(|refusal| match refusal {
                EvidenceRefusal::NotExtracted => TargetedFigureRefusal::NotExtracted,
                EvidenceRefusal::Mismatch => TargetedFigureRefusal::Project(
                    ProjectError::PayloadUnavailable(Availability::Corrupt),
                ),
                EvidenceRefusal::NotDrawable => TargetedFigureRefusal::NotDrawable,
            })?;
        Ok((figure, position))
    }

    /// Takes the one export lane for stored results.
    ///
    /// # Errors
    ///
    /// [`ProjectError::ExportInProgress`] while another holds it.
    pub fn begin_output(&self) -> Result<OutputLane, ProjectError> {
        self.output_lane
            .compare_exchange(
                false,
                true,
                std::sync::atomic::Ordering::AcqRel,
                std::sync::atomic::Ordering::Acquire,
            )
            .map_err(|_| ProjectError::ExportInProgress)?;
        Ok(OutputLane(std::sync::Arc::clone(&self.output_lane)))
    }

    /// Whether a worker's unobserved end keeps new runs out of this session.
    #[must_use]
    pub fn analysis_quarantined(&self) -> bool {
        self.locked().analysis_quarantined
    }

    /// One stored result, whole: its plan, its run's block and every row,
    /// checked the way they were checked before the result was published.
    ///
    /// What a figure or a table of the result is made from. It reads the
    /// managed payload and the document, and nothing else: no source, no
    /// runtime, no executor. Reading it records nothing.
    ///
    /// # Errors
    ///
    /// [`ProjectError::UnknownRecord`] for a record that is not a targeted
    /// result of this project, and [`ProjectError::PayloadUnavailable`] where
    /// the stored rows are missing, damaged, or not the rows the plan names.
    pub fn stored_targeted_result(
        &self,
        artifact: ArtifactId,
    ) -> Result<targeted_output::StoredResult, ProjectError> {
        let (plan, run, execution, result) = {
            let session = self.locked();
            let project = session.open()?;
            let document = &project.document;
            let result = document
                .artifact(artifact)
                .and_then(|record| record.payload.targeted_ms1())
                .ok_or(ProjectError::UnknownRecord)?
                .clone();
            let run = lineage::producing_run(document, artifact)
                .and_then(|id| document.runs.iter().find(|run| run.id == id))
                .ok_or(ProjectError::UnknownRecord)?;
            let execution = run
                .targeted_ms1
                .as_deref()
                .ok_or(ProjectError::UnknownRecord)?
                .clone();
            let plan = document
                .plan(&execution.plan_sha256)
                .ok_or(ProjectError::UnknownRecord)?
                .clone();
            (plan, run.id, execution, result)
        };
        let page = self.read_targeted_ms1_rows(artifact, 0)?;
        if !targeted_output::rows_fit_plan(&plan, page.total, &page.rows) {
            return Err(ProjectError::PayloadUnavailable(Availability::Corrupt));
        }
        Ok(targeted_output::StoredResult {
            artifact,
            run,
            plan,
            execution,
            result,
            rows: page.rows,
        })
    }
}

/// Why one target's stored evidence could not be drawn.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TargetedFigureRefusal {
    /// The project refused: the record is not this project's, or the stored
    /// result is missing or damaged.
    Project(ProjectError),
    /// The target never reached extraction, so it has no evidence.
    NotExtracted,
    /// The plot contract refused the figure.
    NotDrawable,
}

/// What resolving a request produced.
#[derive(Debug)]
pub struct PlanResolution {
    /// The plan, where the request had no problem.
    pub plan: Option<TargetedMs1Plan>,
    /// Every problem with the request, row by row.
    pub problems: Vec<PlanProblem>,
    /// What would stop this plan running now, if anything.
    pub blocked: Option<ProjectError>,
}

/// How one recorded targeted run ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TargetedMs1RunEnd {
    pub run: RunId,
    pub outcome: TerminalOutcome,
    /// The result, where the run completed.
    pub artifact: Option<ArtifactId>,
}

fn read_refusal(refusal: payload::ReadRefusal) -> ProjectError {
    match refusal {
        payload::ReadRefusal::Unavailable(availability) => {
            ProjectError::PayloadUnavailable(availability)
        }
        payload::ReadRefusal::UnknownTarget => ProjectError::UnknownRecord,
    }
}

/// Every stored result a document references, in document order.
fn managed_results(document: &ProjectDocument) -> Vec<(ArtifactId, PayloadReference)> {
    document
        .artifacts
        .iter()
        .filter_map(|artifact| {
            artifact
                .payload
                .targeted_ms1()
                .map(|result| (artifact.id, result.payload.clone()))
        })
        .collect()
}

/// What the store beside a published document holds of what it references.
fn observe_payloads(document: &ProjectDocument, published_at: &Path) -> PayloadState {
    let managed = managed_results(document);
    let Some(store) = payload::store_of(published_at) else {
        return PayloadState {
            store_found: false,
            availability: managed
                .iter()
                .map(|(id, _)| (*id, Availability::Missing))
                .collect(),
            unreferenced: 0,
        };
    };
    let store_found = payload::is_plain_directory(&store);
    let availability = managed
        .iter()
        .map(|(id, reference)| {
            let availability = if store_found {
                payload::observe(&store, *id, reference)
            } else {
                Availability::Missing
            };
            (*id, availability)
        })
        .collect();
    let ids: Vec<ArtifactId> = managed.iter().map(|(id, _)| *id).collect();
    PayloadState {
        store_found,
        availability,
        unreferenced: if store_found {
            payload::unreferenced(&store, &ids)
        } else {
            0
        },
    }
}

/// Whether two names are the same published document: one object, under one
/// name, in one directory.
///
/// The same object is not enough: a result store is found by the document's
/// name, so a hard link to the bound document under another name or in another
/// directory has a store of its own, and results have to be copied into it.
fn same_published_document(bound: &Path, destination: &Path) -> bool {
    let same_object = match (
        local_document::object_identity(bound),
        local_document::object_identity(destination),
    ) {
        (Some(left), Some(right)) => left == right,
        _ => false,
    };
    let same_directory = match (bound.parent(), destination.parent()) {
        (Some(left), Some(right)) => {
            match (std::fs::canonicalize(left), std::fs::canonicalize(right)) {
                (Ok(left), Ok(right)) => left == right,
                _ => false,
            }
        }
        _ => false,
    };
    let same_name = match (bound.file_name(), destination.file_name()) {
        (Some(left), Some(right)) => left.eq_ignore_ascii_case(right),
        _ => false,
    };
    same_object && same_directory && same_name
}

/// The document a Save As into `directory` would publish, with every
/// reference rebased there, or why it cannot be published.
fn rebased_for(
    document: &ProjectDocument,
    resolved: &[PathBuf],
    directory: &Path,
) -> Result<ProjectDocument, ProjectError> {
    let mut candidate = document.clone();
    for (input, path) in candidate.inputs.iter_mut().zip(resolved) {
        input.locator = record::locator_for(path, directory);
    }
    candidate.revision = candidate.revision.saturating_add(1);
    record::validate(&candidate).map_err(ProjectError::Document)?;
    if record::serialize(&candidate).is_none_or(|bytes| bytes.len() as u64 > MAX_DOCUMENT_BYTES) {
        return Err(ProjectError::Oversized);
    }
    Ok(candidate)
}

/// The moments a Save As test needs to act in.
pub(crate) struct SaveAsSeams<'a> {
    /// Copies one file of one stored result.
    pub(crate) copy_file: &'a (dyn Fn(&Path, &Path) -> std::io::Result<()> + Sync),
    /// Runs after the destination store was published and before the
    /// document is.
    pub(crate) before_document: &'a (dyn Fn() -> Result<(), ProjectError> + Sync),
}

impl SaveAsSeams<'static> {
    const PRODUCTION: Self = Self {
        copy_file: &payload::plain_copy,
        before_document: &|| Ok(()),
    };
}

/// A store assembled for Save As and not yet published.
struct PendingStore {
    /// This operation's own directory beside the destination.
    path: std::path::PathBuf,
    /// The name it will be published under.
    store: std::path::PathBuf,
    /// The results copied into it, whole.
    copied: Vec<ArtifactId>,
}

/// Copies every whole result into a new store beside the destination.
///
/// Refuses an existing store at the destination's store name before anything
/// is written. The pending directory is this operation's own; on any failure
/// it is removed and nothing else is touched.
fn assemble_store(
    destination: &Path,
    directory: &Path,
    project: record::ProjectId,
    bound: Option<&Path>,
    managed: &[(ArtifactId, PayloadReference)],
    seams: &SaveAsSeams<'_>,
) -> Result<PendingStore, ProjectError> {
    let store = payload::store_of(destination).ok_or(ProjectError::DestinationNotNamed)?;
    if std::fs::symlink_metadata(&store).is_ok() {
        return Err(ProjectError::DestinationStoreExists);
    }
    let name = store
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or(ProjectError::DestinationNotNamed)?;
    let path = directory.join(format!(".{name}.{}.pending", uuid::Uuid::new_v4()));
    std::fs::create_dir(&path).map_err(|_| ProjectError::NotPublished)?;
    let source_store = bound.and_then(payload::store_of);
    let mut copied = Vec::new();
    for (id, reference) in managed {
        // Asked of the source now, not taken from the last open: only a result
        // that is whole at the moment of copying is copied.
        let whole = source_store.as_deref().is_some_and(|source| {
            payload::observe(source, *id, reference) == Availability::Available
        });
        if !whole {
            continue;
        }
        let source = source_store
            .as_deref()
            .expect("a whole result was observed in the source store");
        if payload::copy_result(source, &path, *id, reference, seams.copy_file).is_err() {
            let _ = std::fs::remove_dir_all(&path);
            return Err(ProjectError::PayloadNotCopied);
        }
        copied.push(*id);
    }
    if payload::write_owner(&path, project).is_err() {
        let _ = std::fs::remove_dir_all(&path);
        return Err(ProjectError::NotPublished);
    }
    Ok(PendingStore {
        path,
        store,
        copied,
    })
}

/// Refuses a capture that would take the history past its bounds.
fn refuse_full_history(document: &ProjectDocument) -> Result<(), ProjectError> {
    if document.runs.len() >= MAX_RUNS || document.artifacts.len() >= MAX_ARTIFACTS {
        return Err(ProjectError::Oversized);
    }
    Ok(())
}

/// Whether every later Save could still publish this document.
///
/// Recorded history can be permanent: a QC run pins its layer, the layer pins
/// its reference, and so every run and record over that reference -- a
/// snapshot or file facts alike -- can no longer be removed. A capture that
/// took the document past what a Save publishes would leave a project nothing
/// could ever save again, so both captures measure before they keep what they
/// wrote. Measured on the bytes a Save writes, with room for the revision to
/// grow to its widest: every Save increments it, and a document one digit
/// short of the bound would otherwise fail the first Save that adds one.
fn fits_every_later_save(document: &ProjectDocument) -> bool {
    /// The most a revision's decimal spelling can grow by: `u64::MAX` has
    /// twenty digits, and the shortest has one.
    const REVISION_GROWTH: u64 = 19;
    record::serialize(document)
        .is_some_and(|bytes| bytes.len() as u64 + REVISION_GROWTH <= MAX_DOCUMENT_BYTES)
}

/// Releases one accepted operation when its work ends, however it ends.
///
/// Released explicitly at the commit site, under the lock the commit happens
/// under, so that no cancel can find an operation that has already committed
/// and no successor can be accepted before it is gone. The `Drop` is the safety
/// net for every path that never reached a commit -- a refusal, a panic -- and
/// releases only if the accepted operation is still this one.
struct JobGuard<'store> {
    store: &'store ProjectStore,
    id: ProjectJobId,
    released: bool,
}

impl JobGuard<'_> {
    /// Releases the operation under a lock the caller already holds.
    fn release(&mut self, session: &mut Session) {
        if session.job.as_ref().is_some_and(|job| job.id == self.id) {
            session.job = None;
        }
        self.released = true;
    }
}

impl Drop for JobGuard<'_> {
    fn drop(&mut self) {
        if self.released {
            return;
        }
        // Taken here rather than assumed: every path that holds the session
        // lock releases explicitly above, and a `MutexGuard` declared after this
        // guard drops before it, so this never runs while the same thread holds
        // the lock.
        let mut session = self.store.locked();
        self.release(&mut session);
    }
}

/// One reference, proved admissible at the moment it was asked for.
///
/// Not a capability and not a reservation: it is the evidence of one proof,
/// consumed by the one admission it was produced for. It carries a resolved
/// path because the workspace admission boundary takes a path -- that path
/// never leaves Rust, and the webview neither supplied it nor receives it.
pub struct AdmissibleInput {
    input: InputId,
    /// The project generation the proof was made against. A commit at any
    /// other generation is a commit into a project this was not proved for.
    generation: u64,
    path: PathBuf,
    /// The objects the content proof was taken from, primary first, each read
    /// through the very handle its bytes were hashed through.
    ///
    /// Every member the record names, not only the primary: a bundle whose
    /// companion was replaced after the proof is not the acquisition that was
    /// proved, and a proof covering the primary alone would say it was.
    identities: Vec<ObjectIdentity>,
}

impl AdmissibleInput {
    /// The object to hand to the existing workspace admission boundary.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// The objects this proof is bound to.
    ///
    /// Test-only, and only so a test about something *else* -- a project that
    /// moved, a record that went -- can hand back the objects that really were
    /// proved instead of tripping the binding check on its way to the thing it
    /// is about.
    #[cfg(test)]
    pub(crate) fn identities(&self) -> &[ObjectIdentity] {
        &self.identities
    }
}

impl fmt::Debug for AdmissibleInput {
    /// Deliberately opaque: this holds a resolved absolute path, and a
    /// `Debug` line is exactly the place one would escape into a log.
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("<admissible-input>")
    }
}

/// Whether two sets of filesystem objects are the same set.
///
/// Compared as sets rather than pairwise, because each side orders its members
/// by its own rules -- the project by record role, the workspace by its
/// family's own membership -- and "the same acquisition" is a claim about which
/// objects, not about which order. A differing count is a differing set, which
/// is the case where one side proved a bundle and the other admitted something
/// else. An empty set never matches: nothing proved is not the same as
/// anything.
fn same_objects(proved: &[ObjectIdentity], admitted: &[ObjectIdentity]) -> bool {
    if proved.is_empty() || proved.len() != admitted.len() {
        return false;
    }
    let mut proved: Vec<ObjectIdentity> = proved.to_vec();
    let mut admitted: Vec<ObjectIdentity> = admitted.to_vec();
    proved.sort_unstable();
    admitted.sort_unstable();
    proved == admitted
}

/// Whether a reference's current state permits handing it to admission.
///
/// The one place the eligibility rule is written. Every state stays distinct
/// in the refusal, because "check it first", "it changed" and "it is not
/// there" need different actions from the user.
fn refuse_unestablished(outcome: InputVerification) -> Result<(), ProjectError> {
    match outcome {
        InputVerification::MatchingRecordedContent => Ok(()),
        InputVerification::NotChecked => Err(ProjectError::NotChecked),
        InputVerification::DifferentContent => Err(ProjectError::ContentChanged),
        InputVerification::Unavailable(reason) => Err(ProjectError::Unavailable(reason)),
    }
}

fn refuse_unsaved(open: Option<&OpenProject>, discard: bool) -> Result<(), ProjectError> {
    match open {
        Some(project) if project.dirty && !discard => Err(ProjectError::UnsavedChanges),
        _ => Ok(()),
    }
}

/// Whether a destination is named as a project document.
///
/// The final extension, case-insensitively: these identifiers are ASCII and
/// Windows file extensions do not distinguish case. `project.mscanvas.txt` is a
/// `txt` and is refused, which is the same rule the export boundary applies.
fn names_a_project(destination: &Path) -> bool {
    destination
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case(PROJECT_EXTENSION))
}

/// Refuses a destination this build will not write a project over.
///
/// Two independent rules, because each catches what the other can miss.
///
/// The first is that what is already published at the destination must be one
/// of this build's project documents. An acquisition, a conversion output, a
/// figure or an unrelated file is not something a project save may replace, and
/// this refuses every one of them without needing to know what they are.
///
/// The second is identity. A destination that is the same filesystem object as
/// a file this project references is refused even if it somehow parses as a
/// project document -- which is the case the first rule cannot see, and the
/// case a hard link creates. Identity is compared through open handles, so it
/// is the objects being compared and not the names that reached them.
fn refuse_unwritable_destination(
    destination: &Path,
    referenced: &[PathBuf],
    project_id: record::ProjectId,
    binding_revision: Option<u64>,
) -> Result<(), ProjectError> {
    if local_document::unsafe_published_name(destination) {
        return Err(ProjectError::Document(DocumentProblem::UnsafeTarget));
    }
    // Identity first. Both rules refuse the same writes, but this one names the
    // reason that matters: "that is a file this project references" is what a
    // user needs to hear, and a hard-linked alias of an acquisition would
    // otherwise be refused for the less useful reason that it is not a project.
    if let Some(target) = local_document::object_identity(destination) {
        for path in referenced {
            if local_document::object_identity(path) == Some(target) {
                return Err(ProjectError::DestinationAliasesInput);
            }
        }
    }
    match local_document::read_bounded(destination, MAX_DOCUMENT_BYTES) {
        // Nothing published there. An ordinary first save.
        Ok(None) => {}
        Ok(Some(bytes)) => {
            let Ok(published) = record::parse(&bytes) else {
                return Err(ProjectError::DestinationNotAProject);
            };
            // Something is published there and it is one of this build\'s
            // projects. Two cases, and only one of them is a save.
            //
            // A *different* project is somebody else\'s work. The save dialog
            // deliberately carries no overwrite prompt, because this boundary
            // does not replace files it did not write, so there is no
            // confirmation behind which replacing it could be the right answer.
            //
            // The *same* project at a revision this session did not publish is
            // the concurrent-writer case, and it matters more than it looks:
            // publishing over it would leave two documents claiming the same
            // project at the same revision, after which neither writer\'s
            // staleness check can tell them apart again.
            if published.project_id != project_id {
                return Err(ProjectError::DestinationNotAProject);
            }
            if binding_revision != Some(published.revision) {
                return Err(ProjectError::StaleDocument);
            }
        }
        Err(local_document::ReadRefusal::Oversized) => {
            return Err(ProjectError::DestinationNotAProject);
        }
        Err(local_document::ReadRefusal::UnsafeTarget) => {
            return Err(ProjectError::Document(DocumentProblem::UnsafeTarget));
        }
        // Something is there and cannot be inspected. Replacing what cannot be
        // identified is exactly what this refuses to do.
        Err(local_document::ReadRefusal::Unreadable) => {
            return Err(ProjectError::DestinationNotAProject);
        }
    }
    Ok(())
}

/// Reads and validates one published project document.
fn read_document(path: &Path) -> Result<ProjectDocument, ProjectError> {
    let bytes = match local_document::read_bounded(path, MAX_DOCUMENT_BYTES) {
        Ok(Some(bytes)) => bytes,
        Ok(None) => {
            return Err(ProjectError::Document(DocumentProblem::Unreadable));
        }
        Err(local_document::ReadRefusal::Oversized) => {
            return Err(ProjectError::Document(DocumentProblem::Oversized));
        }
        Err(local_document::ReadRefusal::UnsafeTarget) => {
            return Err(ProjectError::Document(DocumentProblem::UnsafeTarget));
        }
        Err(local_document::ReadRefusal::Unreadable) => {
            return Err(ProjectError::Document(DocumentProblem::Unreadable));
        }
    };
    record::parse(&bytes).map_err(ProjectError::Document)
}

/// Serializes and publishes a validated document.
fn publish(
    directory: &Path,
    destination: &Path,
    document: &ProjectDocument,
) -> Result<(), ProjectError> {
    let bytes = record::serialize(document).ok_or(ProjectError::NotPublished)?;
    if bytes.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err(ProjectError::Oversized);
    }
    local_document::publish_through_temporary(directory, destination, &bytes, TEMPORARY_PREFIX)
        .map_err(|failure| match failure.refusal {
            WriteRefusal::UnsafeTarget => ProjectError::Document(DocumentProblem::UnsafeTarget),
            WriteRefusal::NotWritten | WriteRefusal::NotPublished => ProjectError::NotPublished,
        })
}

/// Serializes and publishes a validated document under a name that must not
/// exist yet: a Save As to a new name, where replacing anything that appeared
/// meanwhile would be replacing something nobody approved.
fn publish_new(
    directory: &Path,
    destination: &Path,
    document: &ProjectDocument,
) -> Result<(), ProjectError> {
    let bytes = record::serialize(document).ok_or(ProjectError::NotPublished)?;
    if bytes.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err(ProjectError::Oversized);
    }
    local_document::publish_new_through_temporary(directory, destination, &bytes, TEMPORARY_PREFIX)
        .map_err(|failure| match failure.refusal {
            WriteRefusal::UnsafeTarget => ProjectError::Document(DocumentProblem::UnsafeTarget),
            WriteRefusal::NotWritten | WriteRefusal::NotPublished => ProjectError::NotPublished,
        })
}

/// The companions a primary's family mandates, where the file is there.
///
/// The existing SCIEX rule and nothing more. This slice admits no new source
/// family and enumerates no directory: it asks one existing function for one
/// name beside one file.
fn mandated_companions(primary: &Path) -> Vec<PathBuf> {
    // Routed by the existing extension rule, which is the question "is this a
    // family with a mandated companion". Asking the naming function without it
    // would derive a `.scan` name for every file in existence and then report
    // every ordinary file as an incomplete bundle.
    if !crate::preview::selection::has_sciex_wiff_extension(primary) {
        return Vec::new();
    }
    mscanvas_proteowizard::sciex_wiff_companion_path(primary)
        .into_iter()
        .collect()
}

/// What the interface calls a reference: its file name, never its path.
fn display_label(primary: &Path) -> String {
    let name = primary
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("reference");
    bounded_name(name.to_owned())
}

/// What one capture's artifact is called.
fn capture_label(inputs: &[InputRecord]) -> String {
    match inputs {
        [only] => bounded_name(format!("File facts: {}", only.label)),
        many => bounded_name(format!("File facts: {} references", many.len())),
    }
}

/// Clamps a name to the stored bound and refuses to store an empty one.
fn bounded_name(value: String) -> String {
    let cleaned: String = value
        .chars()
        .filter(|character| !character.is_control())
        .take(record::MAX_LABEL_CHARS)
        .collect();
    if cleaned.trim().is_empty() {
        return "Untitled project".to_owned();
    }
    cleaned
}

/// The current time, as the document stores it.
///
/// A bound on when a run happened, not a measurement of anything. Derived from
/// the system clock, which a user can change, so it is presented as what was
/// recorded rather than as evidence.
fn now_rfc3339() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format_rfc3339(now.as_secs())
}

/// Formats a Unix second count as an RFC 3339 instant in UTC.
///
/// Hand-rolled because the alternative is a date dependency for one timestamp
/// in one document. The civil-date conversion is the standard days-from-epoch
/// algorithm and is exercised by its own test.
fn format_rfc3339(seconds: u64) -> String {
    let days = (seconds / 86_400) as i64;
    let time_of_day = seconds % 86_400;
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        time_of_day / 3600,
        (time_of_day % 3600) / 60,
        time_of_day % 60,
    )
}

/// Howard Hinnant's `civil_from_days`, for days since 1970-01-01.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * day_of_year + 2) / 153;
    let day = u32::try_from(day_of_year - (153 * shifted_month + 2) / 5 + 1).unwrap_or(1);
    let month = u32::try_from(if shifted_month < 10 {
        shifted_month + 3
    } else {
        shifted_month - 9
    })
    .unwrap_or(1);
    (if month <= 2 { year + 1 } else { year }, month, day)
}
