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
pub mod record;

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
use record::{
    AcquisitionQcSnapshotV1, ArtifactPayload, ArtifactRecord, DocumentProblem, InputId,
    InputRecord, LayerId, LayerRecord, LayerSource, MAX_ARTIFACTS, MAX_DOCUMENT_BYTES, MAX_INPUTS,
    MAX_LAYERS, MAX_RUNS, ProjectDocument, RecordedOperation, RunId, RunInput, RunRecord,
    TerminalOutcome,
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
            Self::LayerUsedByRun => "layerUsedByRun",
            Self::PreviewNotCurrent => "previewNotCurrent",
            Self::ProducerUnidentified => "producerUnidentified",
            Self::SummaryTooLarge => "summaryTooLarge",
        }
    }

    /// Whether trying the same thing again could reasonably succeed.
    #[must_use]
    pub const fn retryable(self) -> bool {
        matches!(
            self,
            Self::NotPublished | Self::StaleDocument | Self::Unavailable(_) | Self::AlreadyRunning
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
        }
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
            }),
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
        dto::describe(session.project.as_ref())
    }

    /// Starts a new empty project.
    ///
    /// # Errors
    ///
    /// [`ProjectError::UnsavedChanges`] unless the caller said to discard them.
    pub fn create(&self, name: String, discard_unsaved: bool) -> Result<(), ProjectError> {
        let mut session = self.locked();
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
            refuse_unsaved(session.project.as_ref(), discard_unsaved)?;
        }
        let document = read_document(path)?;
        let revision = document.revision;
        let mut project = OpenProject::fresh(document);
        project.binding = Some(PublishedBinding {
            path: path.to_path_buf(),
            revision,
        });
        let mut session = self.locked();
        // Re-checked under the lock this replacement happens under. The read
        // above released it, and a commit that arrived meanwhile is exactly
        // what the caller asked not to discard.
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
    /// # Errors
    ///
    /// A destination this build will not write to, or a publish that did not
    /// happen. On every failing path whatever was at the destination is
    /// untouched.
    pub fn save_as(&self, destination: &Path) -> Result<(), ProjectError> {
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
        let (generation, resolved, project_id, binding_revision) = {
            let session = self.locked();
            let project = session.open()?;
            let existing_base = project.base_directory().map(Path::to_path_buf);
            let mut resolved = Vec::with_capacity(project.document.inputs.len());
            for input in &project.document.inputs {
                let base = existing_base.as_deref().unwrap_or(directory);
                let path = record::resolve(&input.locator, base).map_err(ProjectError::Document)?;
                resolved.push(path);
            }
            (
                session.generation,
                resolved,
                project.document.project_id,
                project.binding.as_ref().map(|binding| binding.revision),
            )
        };

        // Outside the lock: this opens one handle per referenced file to
        // compare identities, and on a slow volume with a full roster that is
        // seconds of work. Holding the session lock through it would stop the
        // interface describing the project for that whole time.
        refuse_unwritable_destination(destination, &resolved, project_id, binding_revision)?;

        let mut session = self.locked();
        // The project may have been replaced, closed, or had a reference
        // removed while the destination was being judged. Publishing the
        // document this operation cloned would then write something nobody is
        // looking at, over a destination that was approved for something else.
        if session.generation != generation {
            return Err(ProjectError::StaleDocument);
        }
        let project = session.open_mut()?;

        let mut candidate = project.document.clone();
        for (input, path) in candidate.inputs.iter_mut().zip(&resolved) {
            input.locator = record::locator_for(path, directory);
        }
        candidate.revision = candidate.revision.saturating_add(1);
        record::validate(&candidate).map_err(ProjectError::Document)?;
        publish(directory, destination, &candidate)?;

        project.document = candidate;
        project.binding = Some(PublishedBinding {
            path: destination.to_path_buf(),
            revision: project.document.revision,
        });
        project.dirty = false;
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

    /// Removes one reference, and any run and artifact that named it.
    ///
    /// Removing a reference never touches the file it referenced. The history
    /// that named it goes with it, because a run whose inputs are gone is a
    /// dangling record and this schema does not hold one.
    ///
    /// A reference with a layer is refused rather than cascaded. History is
    /// something this application wrote; a layer is an identity the user
    /// created, and deleting one silently to satisfy a removal would remove
    /// something the user did not ask to remove. They remove the layer first,
    /// and then the reference goes.
    ///
    /// # Errors
    ///
    /// [`ProjectError::UnknownRecord`] for an identifier this project has no
    /// input for, or [`ProjectError::LayerDependsOnInput`] where a layer is
    /// sourced from it. Nothing changes on either.
    pub fn remove_input(&self, id: InputId) -> Result<(), ProjectError> {
        let mut session = self.locked();
        let project = session.open_mut()?;
        if project.document.input(id).is_none() {
            return Err(ProjectError::UnknownRecord);
        }
        if project.document.layer_of_input(id).is_some() {
            return Err(ProjectError::LayerDependsOnInput);
        }
        project.document.inputs.retain(|input| input.id != id);
        // Every run that named it, and every artifact that observed it.
        //
        // Both, and not just the artifacts reachable through those runs: an
        // artifact may observe an input without any run in this document naming
        // it -- a document written by another build, or one a user edited --
        // and leaving that one behind would make the document permanently
        // unsaveable, because the same dangling reference this removal exists
        // to avoid is what `validate` refuses on every later Save.
        //
        // A run that consumed the reference's layer is never among them: the
        // layer would have refused this removal above, and its own removal is
        // refused while such a run exists.
        let orphaned: Vec<ArtifactId> = project
            .document
            .runs
            .iter()
            .filter(|run| run.consumes_input(id))
            .flat_map(|run| run.output_artifact_ids.iter().copied())
            .collect();
        project.document.runs.retain(|run| !run.consumes_input(id));
        project.document.artifacts.retain(|artifact| {
            !orphaned.contains(&artifact.id)
                && !artifact.payload.file_facts().is_some_and(|facts| {
                    facts
                        .observations
                        .iter()
                        .any(|observation| observation.input_id == id)
                })
        });
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
        let (mut guard, cancellation, generation) = self.start_job(id)?;
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
    /// The reason the capture did not complete. The run is recorded either way,
    /// with one exception: where the history is at its bound -- before the
    /// read, or by the time it commits, because a QC capture can add a run
    /// while this one reads -- there is no room for even a failed or cancelled
    /// run, so nothing is recorded and the answer is
    /// [`ProjectError::Oversized`].
    pub fn capture_file_facts(
        &self,
        id: ProjectJobId,
        selected: &[InputId],
    ) -> Result<RunId, ProjectError> {
        let (mut guard, cancellation, generation) = self.start_job(id)?;
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
        });
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
        let (mut guard, cancellation, generation) = self.start_job(job)?;
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
        });
        // A snapshot cannot be removed -- its layer and reference are pinned by
        // it -- so one that took the document past the size this build saves
        // would leave a project no Save could ever publish again. Measured on
        // the bytes a Save would write, and taken back out, both together,
        // where it would.
        let fits = record::serialize(&project.document)
            .is_some_and(|bytes| bytes.len() as u64 <= MAX_DOCUMENT_BYTES);
        if !fits {
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

/// Refuses a capture that would take the history past its bounds.
fn refuse_full_history(document: &ProjectDocument) -> Result<(), ProjectError> {
    if document.runs.len() >= MAX_RUNS || document.artifacts.len() >= MAX_ARTIFACTS {
        return Err(ProjectError::Oversized);
    }
    Ok(())
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
