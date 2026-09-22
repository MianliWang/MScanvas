//! What the interface is told about a project.
//!
//! One shape, sent whole after every operation, because a project is small and
//! bounded and a stream of deltas would be more machinery than the thing it
//! describes. Every identifier is a UUID string, which is what the webview
//! addresses records by.
//!
//! No absolute path crosses this boundary, in any field, in any state. A
//! reference is described by the label it was registered under and by whether
//! its locator is inside the project or outside it -- which is the fact a user
//! needs in order to understand whether copying the project takes its data
//! along. Where the interface has to say something about location it says that,
//! never a path.

use serde::Serialize;

use super::record::{Locator, MemberRole, ProjectDocument, TerminalOutcome};
use super::{OpenProject, lineage};

/// Whether a reference travels with the project or points outside it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LocatorKind {
    /// Below the project document's own directory. Copying the two together
    /// keeps the reference working.
    InsideProject,
    /// An external object the user explicitly selected. Copying the project
    /// alone leaves this pointing at the original machine's location.
    OutsideProject,
}

/// One member of one reference.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberDto {
    /// `primary` or `requiredCompanion`.
    pub role: &'static str,
    /// The companion's file name, or the empty string for the primary.
    pub name: String,
    pub recorded_byte_length: u64,
}

/// One reference, and what the last check established about it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputDto {
    pub id: String,
    pub label: String,
    pub locator_kind: LocatorKind,
    pub members: Vec<MemberDto>,
    /// `notChecked`, `matchingRecordedContent`, `differentContent` or
    /// `unavailable`.
    pub verification: &'static str,
    /// Set only where `verification` is `unavailable`.
    pub unavailable_reason: Option<&'static str>,
    /// Whether a relink proposal for this reference is waiting to be confirmed.
    pub relink_proposed: bool,
    /// Whether that proposal's candidate holds the recorded bytes. Meaningless
    /// unless `relink_proposed`.
    pub relink_candidate_matches: bool,
    /// The runs that consumed this reference, oldest first.
    ///
    /// Derived in Rust rather than left for the page to work out. The reverse
    /// of an edge is still the edge, and computing it in one place is what
    /// stops two consumers disagreeing about who used what.
    pub consumed_by_run_ids: Vec<String>,
}

/// One recorded artifact.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactDto {
    pub id: String,
    pub label: String,
    /// How many references this artifact recorded facts for.
    pub observed_input_count: usize,
    /// How many files in total.
    pub observed_member_count: usize,
    /// The run that produced it, or `null` where no run in this project claims
    /// it -- which is a state to show, not a fault. Never two: a document in
    /// which two runs claimed one artifact is refused at the boundary.
    pub produced_by_run_id: Option<String>,
    /// The references this artifact actually recorded observations of.
    pub source_input_ids: Vec<String>,
}

// An artifact carries no locator and no current file state, and there is
// deliberately no field here for one. `FileFactsV1` is a payload inside the
// document; a "current file" line beside an artifact would be describing a
// file that does not exist.

/// One recorded run.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunDto {
    pub id: String,
    /// The operation identifier, exactly as the document stores it.
    pub operation: &'static str,
    /// `completed`, `failed` or `cancelled`. Always terminal: a recorded run is
    /// history, and opening a project never schedules one.
    pub outcome: &'static str,
    pub input_ids: Vec<String>,
    pub output_artifact_ids: Vec<String>,
    pub application_version: String,
    pub started_at: String,
    pub finished_at: String,
}

/// One accepted operation, as the interface holds it.
///
/// The handle is correlation: it says which operation a later cancel means and
/// nothing else. No path, no authority, no file.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectJobDto {
    pub operation_id: String,
}

/// What a cancel request found.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelOutcomeDto {
    /// `cancelled`, `noActiveOperation` or `stale`. None of them is an error.
    pub outcome: &'static str,
}

/// Everything the interface knows about the session's project.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStateDto {
    /// `false` when no project is open. Every other field is then empty.
    pub open: bool,
    /// The open project's durable identifier, or `null`.
    ///
    /// A random UUID. It correlates nothing about the machine or the files,
    /// and it is sent so the interface can tell one project being replaced by
    /// another from the open one changing -- which decide different things.
    pub project_id: Option<String>,
    pub name: String,
    /// Whether there are changes no save has published.
    pub dirty: bool,
    /// Whether this project has ever been published anywhere. `false` means
    /// Save has nowhere to go and Save As is the only route.
    pub published: bool,
    pub inputs: Vec<InputDto>,
    pub artifacts: Vec<ArtifactDto>,
    pub runs: Vec<RunDto>,
}

const fn role_id(role: MemberRole) -> &'static str {
    match role {
        MemberRole::Primary => "primary",
        MemberRole::RequiredCompanion => "requiredCompanion",
    }
}

const fn outcome_id(outcome: TerminalOutcome) -> &'static str {
    match outcome {
        TerminalOutcome::Completed => "completed",
        TerminalOutcome::Failed => "failed",
        TerminalOutcome::Cancelled => "cancelled",
    }
}

const fn locator_kind(locator: &Locator) -> LocatorKind {
    match locator {
        Locator::ProjectRelative { .. } => LocatorKind::InsideProject,
        Locator::LocalAbsolute { .. } => LocatorKind::OutsideProject,
    }
}

/// Describes the open project, or the absence of one.
pub(super) fn describe(open: Option<&OpenProject>) -> ProjectStateDto {
    let Some(project) = open else {
        return ProjectStateDto::default();
    };
    let document: &ProjectDocument = &project.document;
    let proposal = project.proposal.as_ref();

    let inputs = document
        .inputs
        .iter()
        .map(|input| {
            let verification = project.verification_of(input.id);
            let proposed = proposal.is_some_and(|pending| pending.input_id == input.id);
            InputDto {
                id: input.id.to_string(),
                label: input.label.clone(),
                locator_kind: locator_kind(&input.locator),
                members: input
                    .members
                    .iter()
                    .map(|member| MemberDto {
                        role: role_id(member.role),
                        name: member.relative_name.clone(),
                        recorded_byte_length: member.baseline.byte_length,
                    })
                    .collect(),
                verification: verification.stable_id(),
                unavailable_reason: verification
                    .reason()
                    .map(super::observe::UnavailableReason::stable_id),
                relink_proposed: proposed,
                relink_candidate_matches: proposed
                    && proposal.is_some_and(|pending| pending.matches_baseline),
                consumed_by_run_ids: lineage::consuming_runs(document, input.id)
                    .iter()
                    .map(ToString::to_string)
                    .collect(),
            }
        })
        .collect();

    let artifacts = document
        .artifacts
        .iter()
        .map(|artifact| ArtifactDto {
            id: artifact.id.to_string(),
            label: artifact.label.clone(),
            observed_input_count: artifact.file_facts.observations.len(),
            observed_member_count: artifact
                .file_facts
                .observations
                .iter()
                .map(|observation| observation.members.len())
                .sum(),
            produced_by_run_id: lineage::producing_run(document, artifact.id)
                .map(|run| run.to_string()),
            source_input_ids: lineage::source_inputs(document, artifact.id)
                .iter()
                .map(ToString::to_string)
                .collect(),
        })
        .collect();

    let runs = document
        .runs
        .iter()
        .map(|run| RunDto {
            id: run.id.to_string(),
            operation: match run.operation {
                super::record::RecordedOperation::CaptureFileFactsV1 => "captureFileFactsV1",
            },
            outcome: outcome_id(run.outcome),
            input_ids: run.input_ids.iter().map(ToString::to_string).collect(),
            // The same spelling `ArtifactDto::id` carries, so the interface can
            // match a run to the artifact it produced. A `Debug` form here
            // would render `ArtifactId(...)` and never match.
            output_artifact_ids: run
                .output_artifact_ids
                .iter()
                .map(ToString::to_string)
                .collect(),
            application_version: run.application_version.clone(),
            started_at: run.started_at.clone(),
            finished_at: run.finished_at.clone(),
        })
        .collect();

    ProjectStateDto {
        open: true,
        project_id: Some(document.project_id.to_string()),
        name: document.name.clone(),
        dirty: project.dirty,
        published: project.binding.is_some(),
        inputs,
        artifacts,
        runs,
    }
}
