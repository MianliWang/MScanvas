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

use serde::{Deserialize, Serialize};

use super::recipe::RunPhase;
use super::record::{
    AcquisitionQcSnapshotV1, ArtifactPayload, Locator, MemberRole, ProjectDocument, RunInput,
    TargetedMs1Execution, TargetedMs1Plan, TargetedMs1ResultV1, TerminalOutcome,
};
use super::{OpenProject, ProjectJobId, lineage};

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
    /// The workspace row this session admitted for this reference, or `null`.
    ///
    /// A session handle, not a durable identity, and never written to the
    /// document. It is reported so the surface can offer to show a row that is
    /// already there instead of offering to add it again -- and it is reported
    /// without being re-checked, because whether that row still exists is the
    /// roster's question and the interface resolves it against the roster it
    /// already holds. A handle naming no live row therefore means "not
    /// currently in the workspace", which is the true answer.
    pub workbench_dataset_handle: Option<String>,
}

/// One recorded artifact.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactDto {
    pub id: String,
    pub label: String,
    /// `fileFactsV1` or `acquisitionQcSnapshotV1`, exactly as the document
    /// stores the payload's kind.
    pub kind: &'static str,
    /// How many references this artifact recorded facts for. Zero for a QC
    /// snapshot, which observed no reference.
    pub observed_input_count: usize,
    /// How many files in total.
    pub observed_member_count: usize,
    /// The snapshot, where this is one, in exactly the shape the document
    /// stores it. It carries no path, no dataset handle and no file identity
    /// -- the schema has no field for any of them -- so what is recorded and
    /// what the page is shown are one thing rather than two.
    pub qc_snapshot: Option<AcquisitionQcSnapshotV1>,
    /// The run that produced it, or `null` where no run in this project claims
    /// it -- which is a state to show, not a fault. Never two: a document in
    /// which two runs claimed one artifact is refused at the boundary.
    pub produced_by_run_id: Option<String>,
    /// The references this artifact actually recorded observations of.
    pub source_input_ids: Vec<String>,
    /// The targeted result, where this is one: the record as stored, and
    /// whether its stored rows and evidence were whole when last looked at.
    pub targeted_ms1: Option<TargetedMs1ArtifactDto>,
}

/// A targeted result record, and what the last look at its payload found.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetedMs1ArtifactDto {
    /// Exactly the record the document stores: a summary and digests, never
    /// a path.
    pub result: TargetedMs1ResultV1,
    /// `available`, `payloadMissing` or `payloadCorrupt`, as observed when
    /// the project was opened, saved elsewhere or produced it. Never stored.
    pub availability: &'static str,
}

// A file-facts or QC artifact carries no locator and no current file state,
// and there is deliberately no field here for one: both payloads live inside
// the document. A targeted result's rows and evidence live beside it, named by
// the record's own identifier and digests, and the one current fact reported
// about them is whether they are whole.

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
    /// The references it consumed directly.
    pub input_ids: Vec<String>,
    /// The layers it consumed.
    pub layer_ids: Vec<String>,
    pub output_artifact_ids: Vec<String>,
    pub application_version: String,
    pub started_at: String,
    pub finished_at: String,
    /// A targeted run's own block, exactly as stored: the plan it executed,
    /// what its attempt measured and established, and how it ended.
    pub targeted_ms1: Option<TargetedMs1Execution>,
}

/// The targeted run in progress, if one is. Session-only.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisRunDto {
    /// The accepted operation a cancel names.
    pub operation_id: String,
    pub phase: &'static str,
}

/// What the last look at the result store beside the document found.
#[derive(Debug, Clone, Copy, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultStoreDto {
    /// Whether a store was beside the published document at all. `false` for
    /// a project whose document was renamed or moved away from it.
    pub store_found: bool,
    /// Whole results in the store that no record of this project names --
    /// a run whose project was never saved afterwards. Counted, not deleted.
    pub unreferenced_results: usize,
}

/// One layer: its identity and the reference it is sourced from.
///
/// No availability field, on purpose. Whether the layer's source is in the
/// Workbench is the source reference's `verification` and
/// `workbench_dataset_handle` resolved against the roster the interface already
/// holds, exactly as the reference row itself answers it; a second copy of
/// that answer here would be one more thing to disagree.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerDto {
    pub id: String,
    pub source_input_id: String,
    /// The runs that consumed this layer, oldest first -- its own history, as
    /// distinct from its source's.
    pub consumed_by_run_ids: Vec<String>,
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
    pub layers: Vec<LayerDto>,
    /// Every plan a recorded run executed, exactly as stored.
    pub plans: Vec<TargetedMs1Plan>,
    pub analysis_run: Option<AnalysisRunDto>,
    pub result_store: ResultStoreDto,
}

// ---------------------------------------------------------------------------
// The targeted MS1 recipe's own boundary
// ---------------------------------------------------------------------------

/// What a plan review sends: the layer, and the text the user typed. Every
/// number is text, because deciding what it means is Rust's job.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanRequestDto {
    pub layer_id: String,
    pub mz_half_width_ppm: String,
    pub expected_peak_width_s: String,
    pub targets: Vec<TargetRequestDto>,
}

/// One target row as typed.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TargetRequestDto {
    pub label: String,
    pub formula: String,
    pub neutral_mass: Option<String>,
    pub rt_s: String,
    pub rt_half_width_s: String,
}

impl PlanRequestDto {
    /// The request as the recipe reads it.
    #[must_use]
    pub fn draft(self) -> super::recipe::PlanDraft {
        super::recipe::PlanDraft {
            mz_half_width_ppm: self.mz_half_width_ppm,
            expected_peak_width_s: self.expected_peak_width_s,
            targets: self
                .targets
                .into_iter()
                .map(|target| super::recipe::TargetDraft {
                    label: target.label,
                    formula: target.formula,
                    neutral_mass: target.neutral_mass,
                    rt_s: target.rt_s,
                    rt_half_width_s: target.rt_half_width_s,
                })
                .collect(),
        }
    }
}

/// One problem with a request.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanProblemDto {
    /// The target row, counted from one, or `null` for a parameter.
    pub row: Option<usize>,
    pub field: &'static str,
    pub problem: &'static str,
}

/// The engine the recipe runs, as the review names it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineDto {
    pub package: &'static str,
    pub version: &'static str,
    pub algorithm: &'static str,
    pub revision: &'static str,
    /// Upstream's own label for the algorithm, repeated here.
    pub maturity: &'static str,
    /// The canonical fixed profile, exactly as its digest covers it.
    pub fixed_profile: &'static str,
}

/// What resolving a request answered.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanResolutionDto {
    pub plan: Option<TargetedMs1Plan>,
    pub problems: Vec<PlanProblemDto>,
    /// Why this plan cannot run now, as a refusal identifier, or `null`.
    pub blocked: Option<&'static str>,
    pub engine: EngineDto,
}

/// The engine, for a review and for Details.
#[must_use]
pub fn engine() -> EngineDto {
    use super::recipe::{
        ENGINE_ALGORITHM, ENGINE_PACKAGE, ENGINE_REVISION, ENGINE_VERSION, FIXED_ENGINE_PROFILE,
    };
    EngineDto {
        package: ENGINE_PACKAGE,
        version: ENGINE_VERSION,
        algorithm: ENGINE_ALGORITHM,
        revision: ENGINE_REVISION,
        maturity: "experimental",
        fixed_profile: FIXED_ENGINE_PROFILE,
    }
}

/// What one resolution becomes on the wire.
#[must_use]
pub fn plan_resolution(resolution: super::PlanResolution) -> PlanResolutionDto {
    PlanResolutionDto {
        plan: resolution.plan,
        problems: resolution
            .problems
            .iter()
            .map(|problem| PlanProblemDto {
                row: problem.row,
                field: problem.field.stable_id(),
                problem: problem.problem.stable_id(),
            })
            .collect(),
        blocked: resolution.blocked.map(super::ProjectError::stable_id),
        engine: engine(),
    }
}

/// What one recorded run answers with: the project as it now is, and the run.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetedMs1RunDto {
    pub project: ProjectStateDto,
    pub run_id: String,
    /// `completed`, `failed` or `cancelled`.
    pub outcome: &'static str,
    pub artifact_id: Option<String>,
}

/// What one run's end becomes on the wire.
#[must_use]
pub fn run_end(project: ProjectStateDto, end: super::TargetedMs1RunEnd) -> TargetedMs1RunDto {
    TargetedMs1RunDto {
        project,
        run_id: end.run.to_string(),
        outcome: outcome_id(end.outcome),
        artifact_id: end.artifact.map(|artifact| artifact.to_string()),
    }
}

/// One page of a stored result's rows.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RowsPageDto {
    pub total: usize,
    pub offset: usize,
    pub rows: Vec<super::payload::PayloadRow>,
}

/// One target's evidence from a stored result.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceDto {
    pub target_id: String,
    pub traces: Vec<super::payload::EvidenceLine>,
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
pub(super) fn describe(
    open: Option<&OpenProject>,
    run: Option<(ProjectJobId, RunPhase)>,
) -> ProjectStateDto {
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
                workbench_dataset_handle: project.admitted_row(input.id).map(ToOwned::to_owned),
            }
        })
        .collect();

    let artifacts = document
        .artifacts
        .iter()
        .map(|artifact| ArtifactDto {
            id: artifact.id.to_string(),
            label: artifact.label.clone(),
            kind: match &artifact.payload {
                ArtifactPayload::FileFactsV1(_) => "fileFactsV1",
                ArtifactPayload::AcquisitionQcSnapshotV1(_) => "acquisitionQcSnapshotV1",
                ArtifactPayload::TargetedMs1ResultV1(_) => "targetedMs1ResultV1",
            },
            observed_input_count: artifact
                .payload
                .file_facts()
                .map_or(0, |facts| facts.observations.len()),
            observed_member_count: artifact.payload.file_facts().map_or(0, |facts| {
                facts
                    .observations
                    .iter()
                    .map(|observation| observation.members.len())
                    .sum()
            }),
            qc_snapshot: match &artifact.payload {
                ArtifactPayload::AcquisitionQcSnapshotV1(snapshot) => Some((**snapshot).clone()),
                ArtifactPayload::FileFactsV1(_) | ArtifactPayload::TargetedMs1ResultV1(_) => None,
            },
            produced_by_run_id: lineage::producing_run(document, artifact.id)
                .map(|run| run.to_string()),
            source_input_ids: lineage::source_inputs(document, artifact.id)
                .iter()
                .map(ToString::to_string)
                .collect(),
            targeted_ms1: artifact
                .payload
                .targeted_ms1()
                .map(|result| TargetedMs1ArtifactDto {
                    result: result.clone(),
                    availability: project
                        .availability_of(artifact.id)
                        .unwrap_or(super::payload::Availability::Missing)
                        .stable_id(),
                }),
        })
        .collect();

    let runs = document
        .runs
        .iter()
        .map(|run| RunDto {
            id: run.id.to_string(),
            operation: run.operation.stable_id(),
            outcome: outcome_id(run.outcome),
            input_ids: run
                .inputs
                .iter()
                .filter_map(|consumed| match consumed {
                    RunInput::Input { input_id } => Some(input_id.to_string()),
                    RunInput::Layer { .. } => None,
                })
                .collect(),
            layer_ids: run
                .inputs
                .iter()
                .filter_map(|consumed| match consumed {
                    RunInput::Layer { layer_id } => Some(layer_id.to_string()),
                    RunInput::Input { .. } => None,
                })
                .collect(),
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
            targeted_ms1: run.targeted_ms1.as_deref().cloned(),
        })
        .collect();

    let layers = document
        .layers
        .iter()
        .map(|layer| LayerDto {
            id: layer.id.to_string(),
            source_input_id: layer.source.input_id().to_string(),
            consumed_by_run_ids: lineage::layer_consuming_runs(document, layer.id)
                .iter()
                .map(ToString::to_string)
                .collect(),
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
        layers,
        plans: document.plans.clone(),
        analysis_run: run.map(|(id, phase)| AnalysisRunDto {
            operation_id: id.handle(),
            phase: phase.stable_id(),
        }),
        result_store: ResultStoreDto {
            store_found: project.payloads.store_found,
            unreferenced_results: project.payloads.unreferenced,
        },
    }
}

// ---------------------------------------------------------------------------
// A stored targeted result as output (M9.2)
// ---------------------------------------------------------------------------

/// One target's evidence figure, rendered for the screen by the same renderer
/// every export uses. The SVG text is shown as an inert image, never parsed
/// into the page.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TargetedFigureDto {
    pub svg: String,
    /// SHA-256 of the SVG bytes, so a reader can tell two renderings apart.
    pub spec_id: String,
    pub width: u32,
    pub height: u32,
}

/// How an export of a stored result's figure ended.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum TargetedFigureExportDto {
    #[serde(rename_all = "camelCase")]
    Cancelled,
    #[serde(rename_all = "camelCase")]
    Saved {
        /// `svg` or `png`.
        format: String,
        /// The name the file was given, and nothing about where it went.
        file_name: String,
        figure: crate::preview::dto::ExportedFigureDto,
    },
}

/// A copy of a stored result's figure that reached the clipboard.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum TargetedFigureCopyDto {
    #[serde(rename_all = "camelCase")]
    Copied {
        figure: crate::preview::dto::CopiedFigureDto,
    },
}

/// How an export of a stored result's table ended.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum TargetedTableExportDto {
    #[serde(rename_all = "camelCase")]
    Cancelled,
    #[serde(rename_all = "camelCase")]
    Saved {
        /// `csv` or `tsv`.
        format: String,
        file_name: String,
        /// How many target rows the table holds.
        row_count: usize,
    },
}

/// Whether this session could start a new targeted run: `available`,
/// `runtimeUnavailable` or `quarantined`. About new runs only; a stored
/// result never needs any of it.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TargetedRuntimeDto {
    pub new_runs: &'static str,
}
