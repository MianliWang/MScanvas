//! The one place a project reference is handed to workspace admission.
//!
//! ## Why this is its own module
//!
//! A project references files; the roster *admits* them. Those are two
//! collections with two authorities, and M8.1 kept them apart deliberately --
//! the project store cannot admit anything and the workspace knows nothing
//! about documents. This slice adds one explicit bridge between them and puts
//! it here rather than inside either, so that the crossing is a thing with a
//! name instead of a dependency one of them grew.
//!
//! ## What each side decides
//!
//! The project decides whether the reference may be handed over at all: that
//! the request names a record in the project that is open *now*, that the last
//! check established its content, and that its content is still what was
//! recorded at the moment of handing over. It answers with one object.
//!
//! The workspace decides everything about admission: logical acquisition,
//! source family, canonical duplicates, bundle completeness, directory and
//! reparse restrictions, capacity, added order, conversion membership and
//! read-only posture. None of that is reimplemented here and none of it is
//! widened. A checked reference naming an ordinary file the Workbench does not
//! open is refused by the rule that always refused it.
//!
//! ## What this is not
//!
//! Not a second importer, not a restore, and not a preview. It calls the
//! existing `add_files` once with one path, and `add_files` starts no process:
//! nothing here reads an acquisition, resolves an installation or launches
//! ProteoWizard. Opening a project still admits nothing; this runs only when a
//! user presses the control for one reference.

#[cfg(test)]
mod tests;

use serde::Serialize;

use crate::preview::PreviewService;
use crate::preview::dto::{PreviewErrorDto, WorkspaceAddOutcomeDto, WorkspaceAddResultDto};
use crate::project::dto::ProjectStateDto;
use crate::project::record::InputId;
use crate::project::{ProjectError, ProjectJobId, ProjectStore};

/// What one reattachment answers with: both collections, as they now are.
///
/// Both, and in one reply, because the crossing changes both and the
/// interface has to apply them together. Two replies would leave a window in
/// which the roster held the row and the project did not yet say so -- and the
/// surface would offer to add it a second time.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAdmissionDto {
    pub project: ProjectStateDto,
    /// The ordinary add result, with the ordinary per-file outcome in it: the
    /// row that arrived, the row that was already there, or the refusal the
    /// workspace has always given that file.
    pub workspace: WorkspaceAddResultDto,
}

/// Why one reattachment did not happen, from whichever side refused it.
///
/// Two channels rather than one flattened error, because they are different
/// kinds of answer: a project refusal is about the document and is mapped to
/// the project's own vocabulary, and a workspace refusal is the workspace's own
/// existing refusal, unchanged. Collapsing them would mean inventing a project
/// sentence for "a conversion is running", which is not a project fact.
#[derive(Debug)]
pub enum AdmissionRefusal {
    /// The project would not hand the reference over.
    Project(ProjectError),
    /// The workspace would not accept the request at all. Distinct from a
    /// per-file rejection, which arrives inside a successful result.
    Workspace(PreviewErrorDto),
}

impl From<ProjectError> for AdmissionRefusal {
    fn from(error: ProjectError) -> Self {
        Self::Project(error)
    }
}

impl From<PreviewErrorDto> for AdmissionRefusal {
    fn from(error: PreviewErrorDto) -> Self {
        Self::Workspace(error)
    }
}

/// Adds the file one project reference names to the session workspace.
///
/// The whole sequence: prove, admit, remember. The proof and the admission are
/// deliberately not one step -- the project must be able to refuse *before* the
/// workspace opens anything, and the workspace must be able to refuse on its
/// own terms afterwards.
///
/// A reference whose object is already a row comes back as the existing row
/// through the workspace's own duplicate rule, never as a second one. That is
/// also what makes a race converge: a normal `Add files…` that admitted the
/// same object first is found by identity, and this answers with the row that
/// import created.
///
/// # Errors
///
/// An [`AdmissionRefusal`] from whichever side refused. A per-file rejection --
/// an unsupported file, a full workspace -- is *not* an error here: it is an
/// outcome inside the returned result, exactly as it is for every other add.
pub fn add_project_input_to_workspace(
    projects: &ProjectStore,
    service: &PreviewService,
    job: ProjectJobId,
    input: InputId,
) -> Result<WorkspaceAddResultDto, AdmissionRefusal> {
    let proof = projects.prove_admissible(job, input)?;
    let result = service.add_files(std::slice::from_ref(&proof.path().to_path_buf()))?;
    // Only where a row actually names this object. A rejected candidate has no
    // row to remember, and remembering one for it would make the surface offer
    // to show something that does not exist.
    if let Some(handle) = admitted_handle(&result) {
        // A refusal here leaves the row where it is. The workspace admitted
        // what it admitted; what is refused is this project's claim on it, and
        // ripping a row out of a collection this module does not own would be
        // a worse answer than declining to name it.
        projects.record_admission(&proof, handle)?;
    }
    Ok(result)
}

/// The row one single-file add ended at, whether it arrived or was already
/// there.
///
/// Both are the same answer to the user's question -- "that reference is this
/// row" -- and the difference between them is what the workspace notice says,
/// not what the project remembers.
#[must_use]
pub fn admitted_handle(result: &WorkspaceAddResultDto) -> Option<&str> {
    result.outcomes.iter().find_map(|outcome| match outcome {
        WorkspaceAddOutcomeDto::Added { dataset } => Some(dataset.handle.as_str()),
        WorkspaceAddOutcomeDto::Duplicate { existing } => Some(existing.handle.as_str()),
        WorkspaceAddOutcomeDto::Rejected { .. } => None,
    })
}
