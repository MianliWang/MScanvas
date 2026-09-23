/**
 * What the webview may ask about the session's project.
 *
 * Every operation addresses records by identifier and nothing else. None takes
 * a path, a file name, a directory or a filesystem capability -- where a
 * project lives and which files it references are decided in Rust, and there is
 * no argument here that could name one. Where a location has to be chosen, the
 * page asks for a native dialog and Rust shows it.
 *
 * A separate boundary from the preview API on purpose. A project references
 * files; the workspace roster *admits* them. Loading a project admits nothing,
 * and keeping the two boundaries apart is what makes that structural rather
 * than a convention someone has to remember.
 */

import { invoke } from "@tauri-apps/api/core";
import { createContext, useContext } from "react";

import type { WorkspaceAddResult } from "../mzml-preview/contracts";
import { documentAuthorityHeaders } from "../ipc/documentAuthority";

/** Whether a reference travels with the project or points outside it. */
export type LocatorKind = "insideProject" | "outsideProject";

/** What a check established, exactly as Rust reports it. */
export type VerificationId =
  | "notChecked"
  | "matchingRecordedContent"
  | "differentContent"
  | "unavailable";

/** Why a reference could not be established as present and readable. */
export type UnavailableReasonId =
  | "missingAtCheckedLocation"
  | "unreadable"
  | "unsafeReference"
  | "incompleteRequiredMembers"
  | "unstableRead";

export interface ProjectMember {
  readonly role: "primary" | "requiredCompanion";
  readonly name: string;
  readonly recordedByteLength: number;
}

export interface ProjectInput {
  readonly id: string;
  readonly label: string;
  readonly locatorKind: LocatorKind;
  readonly members: readonly ProjectMember[];
  readonly verification: VerificationId;
  readonly unavailableReason: UnavailableReasonId | null;
  readonly relinkProposed: boolean;
  readonly relinkCandidateMatches: boolean;
  /** The runs that consumed this reference, oldest first. Derived in Rust. */
  readonly consumedByRunIds: readonly string[];
  /**
   * The workspace row this session admitted for this reference, or `null`.
   *
   * A session handle, never written to the project file. It says which row
   * *was* admitted, not that the row still exists -- whether it does is the
   * roster's question, and the surface answers it against the roster it
   * already holds rather than asking Rust again.
   */
  readonly workbenchDatasetHandle: string | null;
}

/** A retention time exactly as the run summary reported it. */
export interface QcRetentionTime {
  /**
   * The shortest decimal text that reads back to the reported number, as the
   * document stores it. Shown as it is: formatting it again could round it.
   */
  readonly value: string;
  /** The formatter emitted no unit; none is inferred from the magnitude. */
  readonly unit: "notEmitted";
}

/** One MS-level bucket, in the order the run summary reported it. */
export type QcMsLevelCount =
  | { readonly kind: "level"; readonly msLevel: number; readonly spectrumCount: number }
  | { readonly kind: "other"; readonly spectrumCount: number };

/**
 * A QC summary snapshot, exactly as the project document stores it: facts one
 * preview's run summary had already established, copied and not judged.
 */
export interface QcSnapshot {
  readonly totalSpectrumCount: number;
  readonly msLevelCounts: readonly QcMsLevelCount[];
  /** Not reported is not zero. */
  readonly chromatogramCount:
    | { readonly kind: "reported"; readonly count: number }
    | { readonly kind: "notReported" };
  readonly retentionTime:
    | {
        readonly kind: "reported";
        readonly minimum: QcRetentionTime;
        readonly at25PercentBasePeakIntensity: QcRetentionTime;
        readonly at50PercentBasePeakIntensity: QcRetentionTime;
        readonly at75PercentBasePeakIntensity: QcRetentionTime;
        readonly maximum: QcRetentionTime;
      }
    | { readonly kind: "notReported" };
  /** The build that produced the preview. Never a path. */
  readonly producer: {
    readonly tool: "msaccess";
    readonly executableSha256: string;
    readonly release: string | null;
    readonly buildDate: string | null;
    readonly sourceRevision: string | null;
  };
}

export type ArtifactKind = "fileFactsV1" | "acquisitionQcSnapshotV1" | "targetedMs1ResultV1";

// ---------------------------------------------------------------------------
// The targeted MS1 recipe, as Rust records and describes it
// ---------------------------------------------------------------------------

/** What one member held, as a plan expects it or an attempt measured it. */
export interface ObservedMember {
  readonly role: "primary" | "requiredCompanion";
  readonly relativeName: string;
  readonly byteLength: number;
  readonly sha256: string;
}

/**
 * One target exactly as the plan hands it to the engine. Numbers are the
 * canonical decimal text the plan is named by; the label never reaches the
 * engine.
 */
export interface TargetDefinition {
  readonly targetId: string;
  readonly label: string;
  readonly formula: string;
  readonly neutralMass: string | null;
  readonly rtS: string;
  readonly rtHalfWidthS: string;
}

/** One reviewed plan, named by the digest of its canonical form. */
export interface TargetedMs1Plan {
  readonly planSha256: string;
  readonly recipe: {
    readonly recipe: "targetedMs1";
    readonly recipeVersion: number;
    readonly adapterSha256: string;
    readonly engineProfileSha256: string;
    readonly runtimeManifestSha256: string;
  };
  readonly layerId: string;
  readonly inputId: string;
  readonly expectedContent: readonly ObservedMember[];
  readonly parameters: { readonly mzHalfWidthPpm: string; readonly expectedPeakWidthS: string };
  readonly targetListSha256: string;
  /** In the order the engine receives them. */
  readonly targets: readonly TargetDefinition[];
}

export type FailureStage = "source" | "runtime" | "request" | "engine" | "result" | "publish";

/** Why a run failed: a closed code and a stage, never a message or a path. */
export type FailureCode =
  | "sourceUnavailable"
  | "sourceChanged"
  | "sourceChangedDuringRead"
  | "sourceUnreadable"
  | "sourceReadIncomplete"
  | "sourceNoMs1"
  | "sourceNotCentroid"
  | "sourceMixedPolarity"
  | "sourcePolarityUnsupported"
  | "sourceRtUndeclaredOrNonmonotonic"
  | "sourceRtNotStrictlyIncreasing"
  | "sourceIonMobilityUnsupported"
  | "sourceUnsortedMz"
  | "sourceNonfinite"
  | "executionViewUnavailable"
  | "runtimeUnverified"
  | "runtimeModuleMismatch"
  | "workerLaunchFailed"
  | "workerNotAccountedFor"
  | "requestRefused"
  | "targetInvalid"
  | "engineError"
  | "engineNoCandidates"
  | "evidenceMappingMismatch"
  | "workerTimeout"
  | "workerExitedAbnormally"
  | "workerInternal"
  | "resultInvalid"
  | "payloadNotPublished";

/** What one attempt established, each fact at the strength of how it was learned. */
export interface AttemptFacts {
  readonly adapterSha256: string;
  readonly runtimeManifestSha256: string;
  readonly interpreterSha256: string;
  readonly sourceView: "hardLinkInWorkArea";
  readonly engineReport: {
    readonly python: string;
    readonly pyopenms: string;
    readonly openms: string;
    readonly openmsRevision: string;
    readonly openmsBuildTime: string;
  } | null;
  readonly loadedModules: readonly { readonly name: string; readonly sha256: string }[];
}

/** A targeted run's own block, exactly as the document stores it. */
export interface TargetedMs1Execution {
  readonly planSha256: string;
  readonly consumedContent: readonly ObservedMember[];
  readonly attempt: AttemptFacts | null;
  readonly failure: { readonly code: FailureCode; readonly stage: FailureStage } | null;
  readonly stop: {
    readonly reason: "cancelRequested" | "timeBudgetExceeded";
    readonly workerTerminated: boolean;
    readonly exitObserved: boolean;
  } | null;
}

/** How many rows ended in each outcome. */
export interface OutcomeSummary {
  readonly targets: number;
  readonly detected: number;
  readonly detectedAmbiguous: number;
  readonly shared: number;
  readonly suppressedByOverlap: number;
  readonly notDetected: number;
  readonly failed: number;
}

/** A targeted result record: a summary and digests, never a path. */
export interface TargetedMs1Result {
  readonly summary: OutcomeSummary;
  /** The absences came from the measured empty-selection recovery. */
  readonly noCandidateRecovery: boolean;
  readonly payload: {
    readonly manifestSha256: string;
    readonly files: readonly {
      readonly name: "rows.jsonl" | "evidence.jsonl" | "evidence.index.json";
      readonly byteLength: number;
      readonly sha256: string;
    }[];
  };
}

/** Whether a stored result was whole when last looked at. Observed, never stored. */
export type PayloadAvailability = "available" | "payloadMissing" | "payloadCorrupt";

export type RowOutcome =
  | "DETECTED"
  | "DETECTED_AMBIGUOUS"
  | "SHARED"
  | "SUPPRESSED_BY_OVERLAP"
  | "NOT_DETECTED"
  | "FAILED";

export type RowFailure =
  | "EXTRACTION_AT_SPECTRUM_EDGE"
  | "RELATED_TARGET_AT_SPECTRUM_EDGE"
  | "CANDIDATES_WITHOUT_FEATURE"
  | "ENGINE_DISCARDED_NO_VALID_FIT"
  | "TARGET_ABSENT_FROM_ENGINE_LIBRARY"
  | "TARGET_UNACCOUNTED"
  | "WINDOW_WITHOUT_MS1_PEAKS";

/** One target's row, as the stored result holds it. */
export interface PayloadRow {
  readonly targetId: string;
  readonly outcome: RowOutcome;
  readonly failureReason: RowFailure | null;
  readonly edgeTraceCount: number;
  readonly ion: {
    readonly adduct: string;
    readonly charge: number;
    readonly mzTheoretical: readonly number[];
    readonly isotopeProbability: readonly number[];
  } | null;
  readonly windows: {
    readonly rtClosedS: readonly [number, number];
    readonly mzOpen: readonly (readonly [number, number])[];
  } | null;
  readonly signal: {
    readonly points: number;
    readonly sum: readonly number[];
    readonly max: readonly number[];
    readonly anyNonzeroPoint: boolean;
  } | null;
  readonly feature: {
    readonly apexRtS: number;
    readonly leftS: number;
    readonly rightS: number;
    readonly rawArea: number;
    readonly modelStatus: string;
    readonly modelArea: number | null;
    readonly modelFwhmS: number | null;
    readonly engineIntensity: number | null;
    readonly engineIntensitySource: "modelArea" | "imputedFromRunRegression";
  } | null;
  readonly candidates: readonly {
    readonly apexRtS: number;
    readonly leftS: number;
    readonly rightS: number;
    readonly rawArea: number;
  }[];
  readonly overlapWinner: boolean;
  readonly relations: {
    readonly sharedWith: readonly string[];
    readonly suppressedBy: string | null;
    readonly overlapRemoved: readonly string[];
  };
  readonly recoveredFromEmptySelection: boolean;
}

export interface RowsPage {
  readonly total: number;
  readonly offset: number;
  readonly rows: readonly PayloadRow[];
}

/** One trace of one target: `[spectrum index, retention time (s), intensity]`. */
export interface EvidenceTrace {
  readonly targetId: string;
  readonly trace: number;
  readonly mzTheoretical: number;
  readonly points: readonly (readonly [number, number, number])[];
}

export interface TargetEvidence {
  readonly targetId: string;
  readonly traces: readonly EvidenceTrace[];
}

/** What a plan review sends: the layer and the text the user typed. */
export interface PlanRequest {
  readonly layerId: string;
  readonly mzHalfWidthPpm: string;
  readonly expectedPeakWidthS: string;
  readonly targets: readonly {
    readonly label: string;
    readonly formula: string;
    readonly neutralMass: string | null;
    readonly rtS: string;
    readonly rtHalfWidthS: string;
  }[];
}

export interface PlanProblem {
  /** The target row, counted from one, or `null` for a parameter. */
  readonly row: number | null;
  readonly field: string;
  readonly problem: string;
}

export interface EngineIdentity {
  readonly package: string;
  readonly version: string;
  readonly algorithm: string;
  readonly revision: string;
  readonly maturity: "experimental";
  readonly fixedProfile: string;
}

export interface PlanResolution {
  readonly plan: TargetedMs1Plan | null;
  readonly problems: readonly PlanProblem[];
  /** Why this plan cannot run now, as a refusal identifier, or `null`. */
  readonly blocked: string | null;
  readonly engine: EngineIdentity;
}

export interface TargetedMs1RunEnd {
  readonly project: ProjectState;
  readonly runId: string;
  readonly outcome: "completed" | "failed" | "cancelled";
  readonly artifactId: string | null;
}

/** The targeted run in progress. Session-only. */
export interface AnalysisRun {
  readonly operationId: string;
  readonly phase: string;
}

export interface ProjectArtifact {
  readonly id: string;
  readonly label: string;
  readonly kind: ArtifactKind;
  readonly observedInputCount: number;
  readonly observedMemberCount: number;
  /** The snapshot, where this is one. */
  readonly qcSnapshot: QcSnapshot | null;
  /**
   * The run that produced it, or `null` where no run in this project claims
   * it. Never two: a document in which two runs claimed one artifact is
   * refused when it is opened.
   */
  readonly producedByRunId: string | null;
  /** The references this artifact actually recorded observations of. */
  readonly sourceInputIds: readonly string[];
  /**
   * The targeted result, where this is one, and whether its stored rows and
   * evidence were whole when last looked at. Absent from a build before M9.1.
   */
  readonly targetedMs1?: {
    readonly result: TargetedMs1Result;
    readonly availability: PayloadAvailability;
  } | null;
}

/** The operations a project can have recorded, exactly as Rust names them. */
export type RecordedOperation =
  | "captureFileFactsV1"
  | "captureAcquisitionQcSnapshotV1"
  | "targetedMs1V1";

export interface ProjectRun {
  readonly id: string;
  readonly operation: RecordedOperation;
  readonly outcome: "completed" | "failed" | "cancelled";
  /** The references it consumed directly. */
  readonly inputIds: readonly string[];
  /** The layers it consumed. */
  readonly layerIds: readonly string[];
  readonly outputArtifactIds: readonly string[];
  readonly applicationVersion: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  /** A targeted run's own block, or `null`. Absent from a build before M9.1. */
  readonly targetedMs1?: TargetedMs1Execution | null;
}

/**
 * One layer: a durable identity sourced from one reference, and nothing else.
 *
 * It carries no label of its own -- its visible name is its source's label --
 * and no availability: whether the source is in the Workbench right now is
 * resolved from the source's remembered handle against the roster the page
 * already holds, exactly as the reference's own Show control resolves it.
 */
export interface ProjectLayer {
  readonly id: string;
  readonly sourceInputId: string;
  /** The runs that consumed this layer, oldest first. Derived in Rust. */
  readonly consumedByRunIds: readonly string[];
}

export interface ProjectState {
  readonly open: boolean;
  /**
   * The open project's durable identifier, or `null` when none is open.
   *
   * A random UUID that correlates nothing about the machine or the files. It
   * is here so the page can tell "a different project is open now" from "this
   * project changed", which are different events with different consequences.
   */
  readonly projectId: string | null;
  readonly name: string;
  readonly dirty: boolean;
  readonly published: boolean;
  readonly inputs: readonly ProjectInput[];
  readonly artifacts: readonly ProjectArtifact[];
  readonly runs: readonly ProjectRun[];
  readonly layers: readonly ProjectLayer[];
  /** Every plan a recorded run executed. Absent from a build before M9.1. */
  readonly plans?: readonly TargetedMs1Plan[];
  /** The targeted run in progress, if one is. */
  readonly analysisRun?: AnalysisRun | null;
  /** What the last look at the result store beside the document found. */
  readonly resultStore?: { readonly storeFound: boolean; readonly unreferencedResults: number };
}

/** The state of a session with no project open. */
export const NO_PROJECT: ProjectState = {
  open: false,
  projectId: null,
  name: "",
  dirty: false,
  published: false,
  inputs: [],
  artifacts: [],
  runs: [],
  layers: [],
};

/**
 * One accepted check or capture.
 *
 * The identifier is correlation: it says which operation a later cancel means.
 * It names no path and confers nothing. It exists *before* the operation's work
 * does, which is the point -- a cancel pressed in the instant after the button
 * has something to name even if the run request has not reached Rust yet.
 */
export interface AcceptedOperation {
  readonly operationId: string;
}

/**
 * What a cancel request found. None of these is an error: "nothing to cancel"
 * is an answer.
 */
export type CancelOutcome = "cancelled" | "noActiveOperation" | "stale";

/**
 * What one reattachment answers with: both collections, as they now are.
 *
 * Both together, because the crossing changes both. Applying the roster
 * without the project would leave the surface offering to add a row it has
 * just added.
 */
export interface ProjectAdmission {
  readonly project: ProjectState;
  readonly workspace: WorkspaceAddResult;
}

/**
 * Operations that show a dialog answer `null` when the user cancelled.
 *
 * Cancelling is an ordinary outcome and not an error: nothing was chosen, so
 * nothing changed.
 */
export type Chosen = ProjectState | null;

/** What one QC capture answers with: the project, and the record it made. */
export interface QcCapture {
  readonly project: ProjectState;
  readonly artifactId: string;
}

export interface ProjectApi {
  getProjectState(): Promise<ProjectState>;
  createProject(name: string, discardUnsaved: boolean): Promise<ProjectState>;
  closeProject(discardUnsaved: boolean): Promise<ProjectState>;
  openProject(discardUnsaved: boolean): Promise<Chosen>;
  saveProject(): Promise<ProjectState>;
  saveProjectAs(): Promise<Chosen>;
  addProjectInput(): Promise<Chosen>;
  removeProjectInput(inputId: string): Promise<ProjectState>;
  /** Accepts one check or capture and answers the identifier it runs under. */
  beginProjectJob(): Promise<AcceptedOperation>;
  checkProjectLinks(operationId: string): Promise<ProjectState>;
  /** Asks one named operation to stop. Never rejects for a late or idle press. */
  cancelProjectJob(operationId: string): Promise<{ readonly outcome: CancelOutcome }>;
  captureProjectFileFacts(
    operationId: string,
    inputIds: readonly string[],
  ): Promise<ProjectState>;
  /**
   * Adds the file one reference names to the session workspace.
   *
   * Names the reference and the accepted operation, and nothing else. Which
   * file that is, whether it is still the recorded file and whether the
   * Workbench opens that kind of file are all decided in Rust.
   */
  addProjectInputToWorkspace(
    operationId: string,
    inputId: string,
  ): Promise<ProjectAdmission>;
  proposeProjectRelink(inputId: string): Promise<Chosen>;
  commitProjectRelink(inputId: string): Promise<ProjectState>;
  abandonProjectRelink(): Promise<ProjectState>;
  /**
   * Creates the layer sourced from one reference, or answers the one it
   * already has. Reads no file and starts nothing: Rust asks the roster it
   * holds whether the reference's row is live, and that is the whole check.
   */
  createProjectLayer(inputId: string): Promise<ProjectState>;
  removeProjectLayer(layerId: string): Promise<ProjectState>;
  /**
   * Records a QC summary snapshot of one layer's source, from the preview the
   * page is showing. Names the layer and that preview's opaque token, sends no
   * value, and starts nothing: Rust copies what the preview already retained.
   */
  captureProjectQcSummary(layerId: string, previewToken: string): Promise<QcCapture>;
  /**
   * Resolves a targeted MS1 request over one layer into a plan for review.
   * Sends the typed text; Rust decides what every value means, mints the
   * target identifiers, and answers the plan or every problem it has.
   */
  resolveTargetedMs1Plan(request: PlanRequest): Promise<PlanResolution>;
  /**
   * Runs one reviewed plan as an accepted operation, named by its digest. A
   * run that started is recorded however it ends, and answers with it --
   * unless recording it would make the document larger than a save can
   * publish, when it is refused (`oversized`) and nothing is recorded.
   */
  runTargetedMs1(operationId: string, planSha256: string): Promise<TargetedMs1RunEnd>;
  /** Where the targeted run in progress is, or `null`. */
  getTargetedMs1Progress(): Promise<AnalysisRun | null>;
  /** One bounded page of a stored result's rows. */
  readTargetedMs1Rows(artifactId: string, offset: number): Promise<RowsPage>;
  /** One target's evidence from a stored result. */
  readTargetedMs1Evidence(artifactId: string, targetId: string): Promise<TargetEvidence>;
}

export const tauriProjectApi: ProjectApi = {
  getProjectState: () => invoke<ProjectState>("get_project_state", {}, documentAuthorityHeaders()),
  createProject: (name, discardUnsaved) =>
    invoke<ProjectState>("create_project", { name, discardUnsaved }, documentAuthorityHeaders()),
  closeProject: (discardUnsaved) =>
    invoke<ProjectState>("close_project", { discardUnsaved }, documentAuthorityHeaders()),
  openProject: (discardUnsaved) =>
    invoke<Chosen>("open_project", { discardUnsaved }, documentAuthorityHeaders()),
  saveProject: () => invoke<ProjectState>("save_project", {}, documentAuthorityHeaders()),
  saveProjectAs: () => invoke<Chosen>("save_project_as", {}, documentAuthorityHeaders()),
  addProjectInput: () => invoke<Chosen>("add_project_input", {}, documentAuthorityHeaders()),
  removeProjectInput: (inputId) =>
    invoke<ProjectState>("remove_project_input", { inputId }, documentAuthorityHeaders()),
  beginProjectJob: () =>
    invoke<AcceptedOperation>("begin_project_job", {}, documentAuthorityHeaders()),
  checkProjectLinks: (operationId) =>
    invoke<ProjectState>("check_project_links", { operationId }, documentAuthorityHeaders()),
  cancelProjectJob: (operationId) =>
    invoke<{ readonly outcome: CancelOutcome }>(
      "cancel_project_job",
      { operationId },
      documentAuthorityHeaders(),
    ),
  captureProjectFileFacts: (operationId, inputIds) =>
    invoke<ProjectState>(
      "capture_project_file_facts",
      { operationId, inputIds: [...inputIds] },
      documentAuthorityHeaders(),
    ),
  addProjectInputToWorkspace: (operationId, inputId) =>
    invoke<ProjectAdmission>(
      "add_project_input_to_workspace",
      { operationId, inputId },
      documentAuthorityHeaders(),
    ),
  proposeProjectRelink: (inputId) =>
    invoke<Chosen>("propose_project_relink", { inputId }, documentAuthorityHeaders()),
  commitProjectRelink: (inputId) =>
    invoke<ProjectState>("commit_project_relink", { inputId }, documentAuthorityHeaders()),
  abandonProjectRelink: () =>
    invoke<ProjectState>("abandon_project_relink", {}, documentAuthorityHeaders()),
  createProjectLayer: (inputId) =>
    invoke<ProjectState>("create_project_layer", { inputId }, documentAuthorityHeaders()),
  removeProjectLayer: (layerId) =>
    invoke<ProjectState>("remove_project_layer", { layerId }, documentAuthorityHeaders()),
  captureProjectQcSummary: (layerId, previewToken) =>
    invoke<QcCapture>(
      "capture_project_qc_summary",
      { layerId, previewToken },
      documentAuthorityHeaders(),
    ),
  resolveTargetedMs1Plan: (request) =>
    invoke<PlanResolution>(
      "resolve_targeted_ms1_plan",
      { request: { ...request, targets: [...request.targets] } },
      documentAuthorityHeaders(),
    ),
  runTargetedMs1: (operationId, planSha256) =>
    invoke<TargetedMs1RunEnd>(
      "run_targeted_ms1",
      { operationId, planSha256 },
      documentAuthorityHeaders(),
    ),
  getTargetedMs1Progress: () =>
    invoke<AnalysisRun | null>("get_targeted_ms1_progress", {}, documentAuthorityHeaders()),
  readTargetedMs1Rows: (artifactId, offset) =>
    invoke<RowsPage>("read_targeted_ms1_rows", { artifactId, offset }, documentAuthorityHeaders()),
  readTargetedMs1Evidence: (artifactId, targetId) =>
    invoke<TargetEvidence>(
      "read_targeted_ms1_evidence",
      { artifactId, targetId },
      documentAuthorityHeaders(),
    ),
};

/**
 * The default for a render with no provider.
 *
 * It answers honestly rather than pretending: there is no project store here,
 * so there is no project, and every operation says so rather than inventing a
 * result a component could go on to display as real. A project surface with no
 * backend must look empty, not populated.
 */
export const unavailableProjectApi: ProjectApi = {
  getProjectState: () => Promise.resolve(NO_PROJECT),
  createProject: () => Promise.reject(new Error("noProjectStore")),
  closeProject: () => Promise.resolve(NO_PROJECT),
  openProject: () => Promise.reject(new Error("noProjectStore")),
  saveProject: () => Promise.reject(new Error("noProjectStore")),
  saveProjectAs: () => Promise.reject(new Error("noProjectStore")),
  addProjectInput: () => Promise.reject(new Error("noProjectStore")),
  removeProjectInput: () => Promise.reject(new Error("noProjectStore")),
  beginProjectJob: () => Promise.reject(new Error("noProjectStore")),
  checkProjectLinks: () => Promise.reject(new Error("noProjectStore")),
  cancelProjectJob: () => Promise.resolve({ outcome: "noActiveOperation" }),
  captureProjectFileFacts: () => Promise.reject(new Error("noProjectStore")),
  addProjectInputToWorkspace: () => Promise.reject(new Error("noProjectStore")),
  proposeProjectRelink: () => Promise.reject(new Error("noProjectStore")),
  commitProjectRelink: () => Promise.reject(new Error("noProjectStore")),
  abandonProjectRelink: () => Promise.resolve(NO_PROJECT),
  createProjectLayer: () => Promise.reject(new Error("noProjectStore")),
  removeProjectLayer: () => Promise.reject(new Error("noProjectStore")),
  captureProjectQcSummary: () => Promise.reject(new Error("noProjectStore")),
  resolveTargetedMs1Plan: () => Promise.reject(new Error("noProjectStore")),
  runTargetedMs1: () => Promise.reject(new Error("noProjectStore")),
  getTargetedMs1Progress: () => Promise.resolve(null),
  readTargetedMs1Rows: () => Promise.reject(new Error("noProjectStore")),
  readTargetedMs1Evidence: () => Promise.reject(new Error("noProjectStore")),
};

/**
 * The default is the honest one, not the real one.
 *
 * The application's own entry point installs [`tauriProjectApi`], for the same
 * reason the preference store is installed there: a production bundle that
 * silently stopped reaching the project store would look exactly like one that
 * has no project open.
 */
const ProjectApiContext = createContext<ProjectApi>(unavailableProjectApi);

export const ProjectApiProvider = ProjectApiContext.Provider;

export function useProjectApi(): ProjectApi {
  return useContext(ProjectApiContext);
}
