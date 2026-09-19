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
pub mod observe;
pub mod record;

#[cfg(test)]
mod tests;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use mscanvas_core::ArtifactId;

use crate::local_document::{self, WriteRefusal};

use observe::{Cancelled, InputVerification, MemberObservation, UnavailableReason};
use record::{
    ArtifactRecord, DocumentProblem, InputId, InputRecord, MAX_DOCUMENT_BYTES, MAX_INPUTS,
    ProjectDocument, RecordedOperation, RunId, RunRecord, TerminalOutcome,
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
    /// The user cancelled.
    Cancelled,
    /// The operation was asked to act on nothing.
    NothingSelected,
    /// A capture or check is already running in this session.
    AlreadyRunning,
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
            Self::Cancelled => "cancelled",
            Self::NothingSelected => "nothingSelected",
            Self::AlreadyRunning => "alreadyRunning",
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
        }
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

/// The session's one project.
///
/// A mutex rather than a lock-free structure because every operation here is a
/// user action at human speed. What matters is the discipline around it: the
/// lock is never held across a filesystem read of a referenced file. A check
/// takes what it needs, drops the lock, hashes, and takes the lock again to
/// record what it found -- so a large acquisition being measured never blocks
/// the interface from describing the project.
pub struct ProjectStore {
    open: Mutex<Option<OpenProject>>,
    /// Bumped whenever the open project is replaced, so results from a check
    /// that was running at the time are recognised as stale and dropped.
    generation: Mutex<u64>,
    /// Set while a check or capture is running, so a second one is refused
    /// rather than interleaved. One job at a time is the bound.
    running: AtomicBool,
    cancelled: Cancelled,
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
            open: Mutex::new(None),
            generation: Mutex::new(0),
            running: AtomicBool::new(false),
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    fn locked(&self) -> std::sync::MutexGuard<'_, Option<OpenProject>> {
        self.open
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn bump_generation(&self) -> u64 {
        let mut generation = self
            .generation
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *generation += 1;
        *generation
    }

    fn generation(&self) -> u64 {
        *self
            .generation
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// What the interface renders.
    #[must_use]
    pub fn describe(&self) -> dto::ProjectStateDto {
        let open = self.locked();
        dto::describe(open.as_ref())
    }

    /// Starts a new empty project.
    ///
    /// # Errors
    ///
    /// [`ProjectError::UnsavedChanges`] unless the caller said to discard them.
    pub fn create(&self, name: String, discard_unsaved: bool) -> Result<(), ProjectError> {
        let mut open = self.locked();
        refuse_unsaved(open.as_ref(), discard_unsaved)?;
        let mut document = ProjectDocument::new(bounded_name(name));
        document.revision = 0;
        record::validate(&document).map_err(ProjectError::Document)?;
        *open = Some(OpenProject::fresh(document));
        drop(open);
        self.bump_generation();
        Ok(())
    }

    /// Closes the open project without publishing anything.
    ///
    /// # Errors
    ///
    /// [`ProjectError::UnsavedChanges`] unless the caller said to discard them.
    pub fn close(&self, discard_unsaved: bool) -> Result<(), ProjectError> {
        let mut open = self.locked();
        refuse_unsaved(open.as_ref(), discard_unsaved)?;
        *open = None;
        drop(open);
        self.bump_generation();
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
            let open = self.locked();
            refuse_unsaved(open.as_ref(), discard_unsaved)?;
        }
        let document = read_document(path)?;
        let revision = document.revision;
        let mut project = OpenProject::fresh(document);
        project.binding = Some(PublishedBinding {
            path: path.to_path_buf(),
            revision,
        });
        let mut open = self.locked();
        // Re-checked under the lock this replacement happens under. The read
        // above released it, and a commit that arrived meanwhile is exactly
        // what the caller asked not to discard.
        refuse_unsaved(open.as_ref(), discard_unsaved)?;
        *open = Some(project);
        drop(open);
        self.bump_generation();
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
        let mut open = self.locked();
        let project = open.as_mut().ok_or(ProjectError::NoOpenProject)?;
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
        let existing_base = project.base_directory().map(Path::to_path_buf);
        let mut resolved = Vec::with_capacity(project.document.inputs.len());
        for input in &project.document.inputs {
            let base = existing_base.as_deref().unwrap_or(directory);
            let path = record::resolve(&input.locator, base).map_err(ProjectError::Document)?;
            resolved.push(path);
        }

        refuse_unwritable_destination(destination, &resolved)?;

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
        let mut open = self.locked();
        let project = open.as_mut().ok_or(ProjectError::NoOpenProject)?;
        let binding = project
            .binding
            .clone()
            .ok_or(ProjectError::NotYetPublished)?;

        let published = read_document(&binding.path).map_err(|_| ProjectError::StaleDocument)?;
        if published.project_id != project.document.project_id
            || published.revision != binding.revision
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
        let base = {
            let open = self.locked();
            let project = open.as_ref().ok_or(ProjectError::NoOpenProject)?;
            if project.document.inputs.len() >= MAX_INPUTS {
                return Err(ProjectError::Oversized);
            }
            project.base_directory().map(Path::to_path_buf)
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

        let mut open = self.locked();
        let project = open.as_mut().ok_or(ProjectError::NoOpenProject)?;
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
    /// # Errors
    ///
    /// [`ProjectError::UnknownRecord`] for an identifier this project has no
    /// input for.
    pub fn remove_input(&self, id: InputId) -> Result<(), ProjectError> {
        let mut open = self.locked();
        let project = open.as_mut().ok_or(ProjectError::NoOpenProject)?;
        if project.document.input(id).is_none() {
            return Err(ProjectError::UnknownRecord);
        }
        project.document.inputs.retain(|input| input.id != id);
        let orphaned: Vec<ArtifactId> = project
            .document
            .runs
            .iter()
            .filter(|run| run.input_ids.contains(&id))
            .flat_map(|run| run.output_artifact_ids.iter().copied())
            .collect();
        project
            .document
            .runs
            .retain(|run| !run.input_ids.contains(&id));
        project
            .document
            .artifacts
            .retain(|artifact| !orphaned.contains(&artifact.id));
        project.verification.retain(|(recorded, _)| *recorded != id);
        if project
            .proposal
            .as_ref()
            .is_some_and(|proposal| proposal.input_id == id)
        {
            project.proposal = None;
        }
        project.dirty = true;
        Ok(())
    }

    /// Requests that a running check or capture stop.
    ///
    /// A cancelled check leaves its references `NotChecked`, and a cancelled
    /// capture produces no artifact. Neither leaves a partial answer.
    ///
    /// Deliberately unconditional, and deliberately not cleared when the next
    /// job starts -- only when one ends. So a cancel pressed in the instant
    /// between the press and the worker actually starting still stops that
    /// work, and the cost is that a cancel pressed when nothing is running
    /// stops the next thing instead. That direction is the right one: the
    /// failure it avoids is a long read the user asked to stop and could not,
    /// and the failure it accepts is a check the user can simply run again.
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Relaxed);
    }

    /// Takes the one job slot, or reports that it is taken.
    ///
    /// One job at a time is the bound on concurrent reading: a check and a
    /// capture both open and hash every file they are given, and two of them
    /// interleaved would double that with no user asking for it.
    fn begin_job(&self) -> Result<JobSlot<'_>, ProjectError> {
        if self
            .running
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Err(ProjectError::AlreadyRunning);
        }
        Ok(JobSlot { store: self })
    }

    /// Checks every reference in the open project against its baseline.
    ///
    /// The session lock is taken to copy what is needed, released for the whole
    /// of the reading and hashing, and taken again to record the answers. A
    /// project whose identity or generation changed while this ran has its
    /// results discarded rather than applied to a different project.
    ///
    /// # Errors
    ///
    /// [`ProjectError::NoOpenProject`], or [`ProjectError::AlreadyRunning`]
    /// where a job is already using the one slot.
    pub fn check_linked_files(&self) -> Result<(), ProjectError> {
        let _slot = self.begin_job()?;
        let generation = self.generation();
        let (inputs, base) = {
            let open = self.locked();
            let project = open.as_ref().ok_or(ProjectError::NoOpenProject)?;
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
            outcomes.push((
                input.id,
                observe::verify_input(input, base, &self.cancelled),
            ));
        }

        let mut open = self.locked();
        if self.generation() != generation {
            // The project was replaced while this was reading. These answers
            // are about files that belonged to a project nobody is looking at.
            return Ok(());
        }
        let Some(project) = open.as_mut() else {
            return Ok(());
        };
        for (id, outcome) in outcomes {
            if let Some(slot) = project
                .verification
                .iter_mut()
                .find(|(recorded, _)| *recorded == id)
            {
                slot.1 = outcome;
            }
        }
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
    /// The reason the capture did not complete. The run is recorded either way.
    pub fn capture_file_facts(&self, selected: &[InputId]) -> Result<RunId, ProjectError> {
        let _slot = self.begin_job()?;
        let generation = self.generation();
        let (inputs, base) = {
            let open = self.locked();
            let project = open.as_ref().ok_or(ProjectError::NoOpenProject)?;
            if selected.is_empty() {
                return Err(ProjectError::NothingSelected);
            }
            let mut chosen = Vec::with_capacity(selected.len());
            for id in selected {
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
        let captured = observe::capture_file_facts(&borrowed, &base, &self.cancelled);
        let finished_at = now_rfc3339();

        let mut open = self.locked();
        if self.generation() != generation {
            return Err(ProjectError::Cancelled);
        }
        let project = open.as_mut().ok_or(ProjectError::NoOpenProject)?;

        let run_id = RunId::new();
        let (outcome, outputs, error) = match captured {
            Ok(facts) => {
                let artifact = ArtifactRecord {
                    id: ArtifactId::new(),
                    label: capture_label(&inputs),
                    file_facts: facts,
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
            input_ids: selected.to_vec(),
            output_artifact_ids: outputs,
            outcome,
            application_version: env!("CARGO_PKG_VERSION").to_owned(),
            started_at,
            finished_at,
        });
        project.dirty = true;

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
        let baseline = {
            let open = self.locked();
            let project = open.as_ref().ok_or(ProjectError::NoOpenProject)?;
            let input = project
                .document
                .input(id)
                .ok_or(ProjectError::UnknownRecord)?;
            input
                .members
                .iter()
                .find(|member| member.role == record::MemberRole::Primary)
                .ok_or(ProjectError::Document(DocumentProblem::InconsistentRecord))?
                .baseline
                .clone()
        };

        let matches_baseline = match observe::observe_member(candidate) {
            MemberObservation::Observed {
                byte_length,
                digest,
            } => baseline.matches(byte_length, digest),
            MemberObservation::Unavailable(reason) => {
                return Err(ProjectError::Unavailable(reason));
            }
        };

        let mut open = self.locked();
        let project = open.as_mut().ok_or(ProjectError::NoOpenProject)?;
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
        let mut open = self.locked();
        let project = open.as_mut().ok_or(ProjectError::NoOpenProject)?;
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
        project.proposal = None;
        project.dirty = true;
        Ok(())
    }

    /// Abandons an outstanding proposal without committing it.
    pub fn abandon_relink(&self) {
        let mut open = self.locked();
        if let Some(project) = open.as_mut() {
            project.proposal = None;
        }
    }
}

/// Releases the one job slot when a check or capture ends, however it ends.
struct JobSlot<'store> {
    store: &'store ProjectStore,
}

impl Drop for JobSlot<'_> {
    fn drop(&mut self) {
        self.store.cancelled.store(false, Ordering::Relaxed);
        self.store.running.store(false, Ordering::Release);
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
            if record::parse(&bytes).is_err() {
                return Err(ProjectError::DestinationNotAProject);
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
