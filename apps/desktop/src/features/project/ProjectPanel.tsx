/**
 * The project surface: references, what a check established about them, and
 * the runs and artifacts recorded over them.
 *
 * Usable with no ProteoWizard installation, because nothing here reads an
 * acquisition. It records where files are and what they contain; whether any of
 * them is a supported acquisition is a question the roster answers, separately,
 * when a user asks it to.
 *
 * Three things this surface owes a reader who cannot see it:
 *
 * The outcomes are words. A reference whose bytes match, one whose bytes
 * differ, and one that could not be read are three sentences, not three
 * colours, and the reason for the last is given because "not there" and
 * "another program has it open" need different actions.
 *
 * Every per-row control names its reference. Five references produce five
 * "Locate" buttons, and a button list that reads "Locate, Remove, Locate,
 * Remove" is one a reader can act on wrongly.
 *
 * What is happening is announced. A check reads every referenced file whole, so
 * the controls can be dim for a long time; the live region says which operation
 * is running rather than leaving silence to stand for it.
 */

import { useEffect, useRef, useState } from "react";

import type { PreviewError } from "../mzml-preview/contracts";
import { ownedErrorMessage } from "../mzml-preview/ownedErrorMessages";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import { attachedRow, qcUnavailable, type ViewedPreview } from "./lineage";
import type {
  OutcomeSummary,
  ProjectArtifact,
  ProjectInput,
  ProjectRun,
  RowOutcome,
} from "./projectApi";
import { QcReport } from "./QcReport";
import {
  FAILURE_KEYS,
  OUTCOME_KEYS,
  phaseKey,
  TargetedMs1Report,
  TargetedMs1Setup,
} from "./TargetedMs1";
import type { ProjectBusy, ProjectSession } from "./useProject";

/** The message key for one verification outcome. */
function verificationKey(input: ProjectInput) {
  if (input.verification !== "unavailable") {
    return (
      {
        notChecked: "projectStateNotChecked",
        matchingRecordedContent: "projectStateMatching",
        differentContent: "projectStateDifferent",
      } as const
    )[input.verification];
  }
  return (
    {
      missingAtCheckedLocation: "projectStateMissing",
      unreadable: "projectStateUnreadable",
      unsafeReference: "projectStateUnsafe",
      incompleteRequiredMembers: "projectStateIncomplete",
      unstableRead: "projectStateUnstable",
    } as const
  )[input.unavailableReason ?? "unreadable"];
}

/**
 * The sentence for one refusal identifier.
 *
 * Every identifier Rust can send, mapped to what it means for the person
 * reading it. The fallback exists for an identifier a future build adds, and is
 * the only case where the surface says something as vague as "that was
 * refused".
 */
const REFUSALS = {
  unsavedChanges: "projectRefusedUnsavedChanges",
  noOpenProject: "projectRefusedNoOpenProject",
  notYetPublished: "projectRefusedNotYetPublished",
  unknownRecord: "projectRefusedUnknownRecord",
  destinationNotNamed: "projectRefusedDestinationNotNamed",
  destinationNotAProject: "projectRefusedDestinationNotAProject",
  destinationAliasesInput: "projectRefusedDestinationAliasesInput",
  staleDocument: "projectRefusedStaleDocument",
  notPublished: "projectRefusedNotPublished",
  oversized: "projectRefusedOversized",
  notChecked: "projectRefusedNotChecked",
  contentChanged: "projectRefusedContentChanged",
  objectNotIdentified: "projectRefusedObjectNotIdentified",
  missingAtCheckedLocation: "projectRefusedMissing",
  unreadable: "projectRefusedUnreadable",
  unsafeReference: "projectRefusedUnsafe",
  incompleteRequiredMembers: "projectRefusedIncomplete",
  unstableRead: "projectRefusedUnstable",
  nothingSelected: "projectRefusedNothingSelected",
  alreadyRunning: "projectRefusedAlreadyRunning",
  staleOperation: "projectRefusedStaleOperation",
  // The workspace's own refusal, reaching this surface because the
  // reattachment enters the workspace's admission path. It keeps the
  // workspace's identifier and gets a sentence here rather than being
  // translated into a project fact it is not.
  conversion_busy: "projectRefusedConversionBusy",
  malformed: "projectRefusedMalformed",
  unsupportedVersion: "projectRefusedUnsupportedVersion",
  duplicateIdentifier: "projectRefusedDuplicate",
  danglingReference: "projectRefusedDangling",
  invalidLocator: "projectRefusedInvalidLocator",
  inconsistentRecord: "projectRefusedInconsistent",
  ambiguousProducer: "projectRefusedAmbiguousProducer",
  unsafeTarget: "projectRefusedUnsafe",
  notInWorkbench: "projectRefusedNotInWorkbench",
  layerDependsOnInput: "projectRefusedLayerDependsOnInput",
  inputUsedByRun: "projectRefusedInputUsedByRun",
  layerUsedByRun: "projectRefusedLayerUsedByRun",
  previewNotCurrent: "projectRefusedPreviewNotCurrent",
  producerUnidentified: "projectRefusedProducerUnidentified",
  summaryTooLarge: "projectRefusedSummaryTooLarge",
  // A capture's own names for two shared refusals; see `useProject`.
  qcProjectChanged: "projectRefusedQcProjectChanged",
  qcNotInWorkbench: "projectRefusedQcNotInWorkbench",
  // The targeted MS1 recipe and the results stored beside a project.
  analysisRunning: "projectRefusedAnalysisRunning",
  analysisQuarantined: "projectRefusedAnalysisQuarantined",
  recipeUnavailable: "projectRefusedRecipeUnavailable",
  recipeSourceUnsupported: "projectRefusedRecipeSourceUnsupported",
  sourceOnAnotherVolume: "projectRefusedSourceOnAnotherVolume",
  planNotCurrent: "projectRefusedPlanNotCurrent",
  payloadStoreUnusable: "projectRefusedPayloadStoreUnusable",
  destinationStoreExists: "projectRefusedDestinationStoreExists",
  payloadNotCopied: "projectRefusedPayloadNotCopied",
  payloadMissing: "targetedPayloadMissing",
  payloadCorrupt: "targetedPayloadCorrupt",
  exportInProgress: "projectRefusedExportInProgress",
} as const;

export function refusalKey(code: string) {
  return code in REFUSALS
    ? REFUSALS[code as keyof typeof REFUSALS]
    : ("projectRefusedUnknown" as const);
}

const BUSY = {
  opening: "projectBusyOpening",
  saving: "projectBusySaving",
  checking: "projectBusyChecking",
  capturing: "projectBusyCapturing",
  linking: "projectBusyLinking",
  admitting: "projectBusyAdmitting",
  recording: "projectBusyRecordingQc",
  reviewing: "projectBusyReviewingPlan",
  analysing: "projectBusyAnalysing",
} as const;

/** The sentence for each reason a QC capture is unavailable. */
const QC_REASONS = {
  qcNeedsWorkbench: "projectQcNeedsWorkbench",
  qcNeedsPreview: "projectQcNeedsPreview",
  qcProducerUnidentified: "projectQcProducerUnidentified",
} as const;

/** What one recorded run is called. */
export function operationKey(run: ProjectRun) {
  return run.operation === "captureAcquisitionQcSnapshotV1"
    ? ("projectOperationCaptureQc" as const)
    : run.operation === "targetedMs1V1"
      ? ("projectOperationTargetedMs1" as const)
      : ("projectOperationCapture" as const);
}

/** What one recorded artifact is called. */
export function artifactKey(artifact: ProjectArtifact) {
  return artifact.kind === "acquisitionQcSnapshotV1"
    ? ("projectArtifactQcSummary" as const)
    : artifact.kind === "targetedMs1ResultV1"
      ? ("projectArtifactTargetedMs1" as const)
      : ("projectArtifactFileFacts" as const);
}

/**
 * The accessible names of a run and of the record it produced, as controls
 * that inspect them.
 *
 * A QC capture's names contain the words the control shows, so saying what is
 * on screen reaches it. The file-facts names predate that rule and are left as
 * they were.
 */
export function inspectRunName(run: ProjectRun) {
  return run.operation === "captureAcquisitionQcSnapshotV1"
    ? ("provenanceInspectQcRunAt" as const)
    : run.operation === "targetedMs1V1"
      ? ("provenanceInspectTargetedRunAt" as const)
      : ("provenanceInspectRunAt" as const);
}

export function inspectRecordName(artifact: ProjectArtifact) {
  return artifact.kind === "acquisitionQcSnapshotV1"
    ? ("provenanceInspectQcSnapshotOf" as const)
    : artifact.kind === "targetedMs1ResultV1"
      ? ("provenanceInspectTargetedResultOf" as const)
      : ("provenanceInspectArtifactOf" as const);
}

/** A result's non-zero outcome counts, in the report's order. */
function outcomeCounts(summary: OutcomeSummary): [RowOutcome, number][] {
  const counts: [RowOutcome, number][] = [
    ["DETECTED", summary.detected],
    ["DETECTED_AMBIGUOUS", summary.detectedAmbiguous],
    ["SHARED", summary.shared],
    ["SUPPRESSED_BY_OVERLAP", summary.suppressedByOverlap],
    ["NOT_DETECTED", summary.notDetected],
    ["FAILED", summary.failed],
  ];
  return counts.filter(([, count]) => count > 0);
}

function busyKey(busy: ProjectBusy) {
  return busy === "idle" ? null : BUSY[busy];
}

/**
 * Why this reference cannot be added to the Workbench, or `null` where it can.
 *
 * Keyed on the same current state the row already displays, because that is
 * what decides it: the Workbench takes the file the project recorded, and
 * "which file is that" is a question only a check answers. Every state gets
 * its own sentence, since "check it first", "it changed" and "it is not there"
 * need three different things from the reader.
 */
function unavailableToAddKey(input: ProjectInput, workspaceBusy: boolean) {
  if (input.verification !== "matchingRecordedContent") {
    // The reference's own state first, and it wins. A busy Workbench is a
    // reason to wait; a reference that is missing is a reason to go and find
    // it, and telling that reader to try again in a moment would be advice
    // that never comes true. It would also contradict the sentence the row
    // already shows, which this control points at.
    if (input.verification === "notChecked") return "projectAddNeedsCheck" as const;
    if (input.verification === "differentContent") return "projectAddChanged" as const;
    return input.unavailableReason === "missingAtCheckedLocation"
      ? ("projectAddMissing" as const)
      : ("projectAddUnavailable" as const);
  }
  // Otherwise addable, and the only thing in the way is the Workbench itself:
  // one change to it at a time, which is the rule every other mutation here
  // follows.
  return workspaceBusy ? ("projectAddWorkspaceBusy" as const) : null;
}

/**
 * The class that carries the outcome visually.
 *
 * Never the only cue: the label beside it says the same thing in words, and the
 * row carries `data-verification` for anything reading the state rather than
 * looking at it.
 */
function verificationTone(input: ProjectInput): string {
  if (input.verification === "matchingRecordedContent") return "is-matching";
  if (input.verification === "differentContent") return "is-different";
  if (input.verification === "unavailable") return "is-unavailable";
  return "is-unchecked";
}

/**
 * A recorded instant, in the reader's own locale.
 *
 * The document stores RFC 3339 in UTC, which is the right thing to store and
 * the wrong thing to show. An instant this cannot parse is shown as it was
 * stored rather than replaced with a guess.
 */
export function recordedAt(value: string, locale: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
    parsed,
  );
}

export interface ProjectPanelProps {
  readonly session: ProjectSession;
  /** Whether the contextual Details region is currently on screen. */
  readonly detailsPresent?: boolean;
  /** Asks the shell to show it, through the same control the header uses. */
  readonly onRevealDetails?: () => void;
  /**
   * Every row the workspace currently holds.
   *
   * The roster is the only authority on which rows exist, so a remembered
   * handle is resolved against this rather than trusted. A row the user
   * removed, or a workspace they cleared, therefore turns "show it" back into
   * "add it" with no extra bookkeeping anywhere.
   */
  readonly liveDatasetHandles?: ReadonlySet<string>;
  /**
   * Takes the reader to one row that is already in the Workbench.
   *
   * Navigation and nothing else: no request is sent, no file is read and no
   * backend is touched, which is why it is a shell callback rather than an
   * operation on the session.
   */
  readonly onShowInWorkbench?: (handle: string) => void;
  /**
   * Whether another change to the workspace is already out.
   *
   * One workspace change at a time, which is the rule every other mutation
   * here follows: two in flight together let the older reply's roster
   * overwrite the newer one's. Rust serialises them regardless, so this waits
   * for a moment rather than for anything -- and says so, rather than leaving
   * a press that quietly does nothing.
   */
  readonly workspaceBusy?: boolean;
  /**
   * The preview the Workbench is showing, or `null`.
   *
   * What a QC capture copies, and the only one it may: its token names the
   * run summary Rust retained for it, and its row is what decides which layer
   * it may be recorded under.
   */
  readonly viewedPreview?: ViewedPreview | null;
}

export function ProjectPanel({
  session,
  detailsPresent = false,
  onRevealDetails,
  liveDatasetHandles,
  onShowInWorkbench,
  workspaceBusy = false,
  viewedPreview = null,
}: ProjectPanelProps) {
  const t = useUiMessages();
  const { state, busy, problem, cancelled, pending, selected, inspecting } = session;
  const working = busy !== "idle";
  const locale = document.documentElement.lang || "en";

  /**
   * Keeps the keyboard where the user put it across a relink proposal.
   *
   * Pressing Locate unmounts that button and mounts the confirmation in its
   * place, which drops focus to `<body>` -- so a keyboard user would have to
   * tab in from the top of the page to reach the control the flow just created
   * for them. Focus follows to that control instead.
   */
  const proposed = state.inputs.find((input) => input.relinkProposed)?.id ?? null;
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const lastProposed = useRef<string | null>(null);
  useEffect(() => {
    if (proposed !== null && proposed !== lastProposed.current) {
      confirmRef.current?.focus();
    }
    lastProposed.current = proposed;
  }, [proposed]);

  /**
   * Keeps the keyboard on the surface across a layer removal.
   *
   * Removing a layer unmounts the row whose Remove control was pressed, which
   * drops focus to `<body>` for the same reason Locate does. Focus goes to the
   * control the removal just changed -- the source reference's own layer
   * control, which now offers to create one again -- or to the Layers heading
   * where that reference is not on screen.
   *
   * Armed only by the press itself and spent on the first settled answer, so
   * nothing else that re-reads the project -- an Open, a Close, a refusal --
   * can move the keyboard. A refused removal leaves the row, and the control
   * the user pressed, exactly where they were. And it recovers only focus the
   * removal actually dropped: a reader who moved on while the request was out
   * keeps the place they moved to.
   */
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const layersHeading = useRef<HTMLHeadingElement | null>(null);
  const removing = useRef<{ readonly layerId: string; readonly sourceInputId: string } | null>(
    null,
  );
  useEffect(() => {
    const armed = removing.current;
    if (armed === null || busy !== "idle") return;
    removing.current = null;
    if (state.layers.some((layer) => layer.id === armed.layerId)) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body && active.isConnected) return;
    const control = [
      ...(surfaceRef.current?.querySelectorAll<HTMLElement>("[data-project-create-layer]") ?? []),
    ].find((candidate) => candidate.getAttribute("data-project-create-layer") === armed.sourceInputId);
    (control ?? layersHeading.current)?.focus();
  }, [busy, state.layers]);

  /**
   * The one live region, carrying whatever the surface most recently has to
   * say: what is running, what a proposal found, or why something was refused.
   *
   * One region and one voice. The visible notices below deliberately carry no
   * role of their own, so nothing is announced twice.
   */
  /** The live workspace row for one reference, or `null`. */
  const inWorkbench = (input: ProjectInput) => attachedRow(input, liveDatasetHandles);
  /** The layer sourced from one reference, or `null` where none has been created. */
  const layerOf = (input: ProjectInput) =>
    state.layers.find((layer) => layer.sourceInputId === input.id) ?? null;

  /** The QC snapshot being inspected, with what the report needs beside it. */
  const provenance = session.provenance;
  const report =
    provenance?.kind === "artifact" && provenance.artifact.qcSnapshot !== null
      ? {
          artifact: provenance.artifact,
          snapshot: provenance.artifact.qcSnapshot,
          sourceName: provenance.layerSources[0]?.record?.label ?? null,
          recordedAt: provenance.producedBy?.record?.finishedAt ?? null,
        }
      : null;

  /**
   * Takes the keyboard to the report a capture produced.
   *
   * The report arrives above the lists, so the control that was pressed is
   * pushed down by its whole height -- at 1366x768, out of view -- and leaving
   * the keyboard there would leave it somewhere nobody can see. It goes to the
   * report's heading instead, which is the thing the press made and which the
   * report has already brought into view.
   *
   * Armed only by the press and spent on the first settled answer, and it acts
   * only on a report that this answer made current and only if the keyboard is
   * still on the control that was pressed: a refusal, an answer that arrived
   * after the reader moved on, and a reader who moved focus all leave it where
   * it is.
   */
  const capturing = useRef<{ readonly layerId: string; readonly shown: string | null } | null>(
    null,
  );
  const shownReport = report?.artifact.id ?? null;
  useEffect(() => {
    const armed = capturing.current;
    if (armed === null) return;
    // While the request is out, a report the reader opens is theirs, not the
    // capture's: it becomes the baseline, so only a report the settling answer
    // makes current counts as the one this press produced.
    if (busy !== "idle") {
      capturing.current = { ...armed, shown: shownReport };
      return;
    }
    capturing.current = null;
    if (shownReport === null || shownReport === armed.shown) return;
    if (document.activeElement?.getAttribute("data-project-capture-qc") !== armed.layerId) return;
    surfaceRef.current
      ?.querySelector<HTMLElement>("#qc-report-title")
      ?.focus({ preventScroll: true });
  }, [busy, shownReport]);

  /**
   * The layer whose targeted MS1 setup is open, in the project it was opened
   * in. Local to this surface: nothing is sent until the user asks for a
   * review, and a project replaced under it closes it.
   */
  const [targeted, setTargeted] = useState<{
    readonly projectId: string | null;
    readonly layerId: string;
  } | null>(null);
  const targetedLayer =
    targeted !== null && targeted.projectId === state.projectId
      ? (state.layers.find((layer) => layer.id === targeted.layerId) ?? null)
      : null;
  const targetedSource =
    targetedLayer === null
      ? undefined
      : state.inputs.find((input) => input.id === targetedLayer.sourceInputId);

  /** The targeted result being inspected, with what its report needs. */
  const targetedReport =
    provenance?.kind === "artifact" && provenance.artifact.kind === "targetedMs1ResultV1"
      ? {
          artifact: provenance.artifact,
          plan: provenance.targeted?.plan ?? null,
          sourceName: provenance.layerSources[0]?.record?.label ?? null,
          source: provenance.layerSources[0]?.record ?? null,
          recordedAt: provenance.producedBy?.record?.finishedAt ?? null,
        }
      : null;
  const phase = phaseKey(session.analysisPhase);

  const proposalInput = state.inputs.find((input) => input.id === proposed);
  // How the last targeted run ended, while that run is in this project.
  // Announced once: a later operation that settles clears it.
  const lastTargeted =
    session.lastTargetedRun === null || !session.targetedRunJustEnded
      ? undefined
      : state.runs.find((run) => run.id === session.lastTargetedRun?.runId);
  const lastTargetedFailure = lastTargeted?.targetedMs1?.failure ?? null;
  const announcement =
    busyKey(busy) !== null
      ? t(busyKey(busy) as "projectBusySaving")
      : pending !== null
        ? t("projectUnsavedQuestion")
        : problem !== null
          ? t(refusalKey(problem))
          : cancelled
            ? t(session.cancelledRunRecorded ? "projectCancelledRunRecorded" : "projectCancelled")
            : proposalInput !== undefined
              ? t(
                  proposalInput.relinkCandidateMatches
                    ? "projectRelinkMatches"
                    : "projectRelinkDiffers",
                )
              : lastTargeted?.outcome === "completed"
                ? t("targetedLastCompleted")
                : lastTargeted?.outcome === "failed"
                  ? lastTargetedFailure === null
                    ? t("targetedLastFailed")
                    : `${t("targetedLastFailed")} ${t(FAILURE_KEYS[lastTargetedFailure.code])}`
                  : "";

  return (
    <div
      ref={surfaceRef}
      className="project-surface"
      data-project-surface=""
      aria-busy={working || undefined}
    >
      <header className="project-header">
        <div>
          <h2>{state.open ? state.name : t("projectNone")}</h2>
          {/* The one disclosure this document needs, and it is not hidden in a
              tooltip: a project records file names, locations and content
              digests, so it can reveal what someone was working on. */}
          <p className="project-privacy">{t("projectPrivacy")}</p>
        </div>
        <div className="project-actions">
          <button
            type="button"
            className="secondary-button"
            aria-disabled={working || undefined}
            onClick={() => {
              if (!working) void session.createProject(t("projectDefaultName"));
            }}
          >
            {t("projectNew")}
          </button>
          <button
            type="button"
            className="secondary-button"
            aria-disabled={working || undefined}
            onClick={() => {
              if (!working) void session.openProject();
            }}
          >
            {t("projectOpen")}
          </button>
          {/* `aria-disabled` rather than `disabled`, for the reason the
              workbench header gives: a disabled button leaves the tab order, so
              the sentence explaining why Save is unavailable could only be read
              with a pointer. Never having been saved is a passing refusal --
              Save As fixes it. */}
          <button
            type="button"
            className="secondary-button"
            aria-disabled={working || !state.open || !state.published || undefined}
            title={state.open && !state.published ? t("projectSaveNeedsLocation") : undefined}
            onClick={() => {
              if (!working && state.open && state.published) void session.saveProject();
            }}
          >
            {t("projectSave")}
          </button>
          <button
            type="button"
            className="secondary-button"
            aria-disabled={working || !state.open || undefined}
            onClick={() => {
              if (!working && state.open) void session.saveProjectAs();
            }}
          >
            {t("projectSaveAs")}
          </button>
          <button
            type="button"
            className="secondary-button"
            aria-disabled={working || !state.open || undefined}
            onClick={() => {
              if (!working && state.open) void session.closeProject();
            }}
          >
            {t("projectClose")}
          </button>
        </div>
      </header>

      {/* Mounted from the first render and empty until there is something to
          say, so what arrives is announced rather than appearing silently. */}
      <p aria-live="polite" className="visually-hidden" data-live-region="project">
        {announcement}
      </p>

      {busyKey(busy) === null ? null : (
        <p className="project-busy" data-project-busy={busy}>
          {t(busyKey(busy) as "projectBusySaving")}
          {busy === "analysing" && phase !== null ? (
            <span data-project-busy-phase={session.analysisPhase ?? ""}>{t(phase)}</span>
          ) : null}
          {/* Offered only for an operation this session accepted and is still
              waiting on. A save or a dialog is busy too, but it is not a thing
              a cancel can name -- and once the answer is in, the control is
              gone rather than left to send a late request. Rust enforces the
              same rule; this is the affordance agreeing with it rather than
              the fix. */}
          {session.activeOperation === null ? null : (
            <button
              type="button"
              className="link-button"
              data-project-cancel={session.activeOperation}
              onClick={() => void session.cancelJob()}
            >
              {t("projectCancel")}
            </button>
          )}
        </p>
      )}

      {/* Unsaved changes are a question, not a failure, and the answer is the
          user's. Without this the refusal is a loop: the action is refused and
          nothing on screen offers a way through it. */}
      {pending === null ? null : (
        <p className="project-unsaved" data-project-pending={pending.kind}>
          <span>{t("projectUnsavedQuestion")}</span>
          {/* Answered only while nothing else is out: a save or a discard
              started under a running operation would settle over it. */}
          <button
            type="button"
            className="secondary-button"
            aria-disabled={working || undefined}
            onClick={() => {
              if (!working) void (state.published ? session.saveProject() : session.saveProjectAs());
            }}
          >
            {t("projectUnsavedSaveFirst")}
          </button>
          <button
            type="button"
            className="secondary-button"
            aria-disabled={working || undefined}
            data-project-discard=""
            onClick={() => {
              if (!working) void session.discardAndContinue();
            }}
          >
            {t("projectUnsavedDiscard")}
          </button>
          <button
            type="button"
            className="link-button"
            aria-disabled={working || undefined}
            onClick={() => {
              if (!working) session.keepEditing();
            }}
          >
            {t("projectUnsavedKeepEditing")}
          </button>
        </p>
      )}

      {state.dirty && pending === null ? (
        <p className="project-unsaved" data-project-unsaved="">
          {t("projectUnsaved")}
        </p>
      ) : null}

      {/* Below 1700px the contextual region is closed unless the user asked
          for it, and a narrow window folds it away entirely. Inspecting an
          object would then appear to do nothing, so this says where the answer
          went and offers the one control that brings it back -- the same
          toggle the header owns, not a second mechanism. */}
      {inspecting !== null && !detailsPresent && onRevealDetails !== undefined ? (
        <p className="project-inspect-hint" data-project-inspect-hint="">
          <span>{t("provenanceInDetails")}</span>
          <button type="button" className="link-button" onClick={onRevealDetails}>
            {t("provenanceShowDetails")}
          </button>
        </p>
      ) : null}

      {problem === null ? null : (
        <p className="project-problem" data-project-problem={problem}>
          <span>{t(refusalKey(problem))}</span>
          <button type="button" className="link-button" onClick={session.dismissProblem}>
            {t("projectDismiss")}
          </button>
        </p>
      )}

      {cancelled ? (
        <p className="project-note" data-project-cancelled="">
          {t(session.cancelledRunRecorded ? "projectCancelledRunRecorded" : "projectCancelled")}
        </p>
      ) : null}

      {state.open ? (
        <>
          {/* The report surface, while a QC summary snapshot is the object
              being inspected. In the main region, above the lists, because it
              is the evidence; Details beside it keeps the lineage and the
              build. */}
          {targetedLayer === null ? null : (
            <TargetedMs1Setup
              key={targetedLayer.id}
              session={session}
              layerId={targetedLayer.id}
              sourceName={targetedSource?.label ?? t("provenanceRelatedGone")}
              refusalText={(code) => t(refusalKey(code))}
              onClose={() => {
                const layerId = targetedLayer.id;
                setTargeted(null);
                // Back to the control that opened it, which stays mounted.
                surfaceRef.current
                  ?.querySelector<HTMLElement>(`[data-project-targeted="${layerId}"]`)
                  ?.focus();
              }}
            />
          )}

          {targetedReport === null ? null : (
            <TargetedMs1Report
              key={targetedReport.artifact.id}
              artifact={targetedReport.artifact}
              plan={targetedReport.plan}
              sourceName={targetedReport.sourceName}
              sourceState={
                targetedReport.source === null
                  ? null
                  : {
                      id: targetedReport.source.verification,
                      text: t(verificationKey(targetedReport.source)),
                    }
              }
              recordedWhen={
                targetedReport.recordedAt === null
                  ? null
                  : recordedAt(targetedReport.recordedAt, locale)
              }
              refusalText={(code) => t(refusalKey(code))}
              // An output refusal is the project's own or the shared figure
              // boundary's; each has its own sentences.
              errorText={(error: PreviewError) =>
                error.kind in REFUSALS ? t(refusalKey(error.kind)) : ownedErrorMessage(error, t)
              }
              runsRecorded={state.runs.length}
            />
          )}

          {report === null ? null : (
            <QcReport
              artifactId={report.artifact.id}
              snapshot={report.snapshot}
              sourceName={report.sourceName}
              recordedWhen={
                report.recordedAt === null ? null : recordedAt(report.recordedAt, locale)
              }
            />
          )}

          <section className="project-section" aria-label={t("projectReferences")}>
            <div className="project-section-head">
              <h3>{t("projectReferences")}</h3>
              <div className="project-actions">
                <button
                  type="button"
                  className="secondary-button"
                  aria-disabled={working || undefined}
                  onClick={() => {
                    if (!working) void session.addInput();
                  }}
                >
                  {t("projectAddReference")}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  aria-disabled={working || state.inputs.length === 0 || undefined}
                  data-project-check=""
                  onClick={() => {
                    if (!working && state.inputs.length > 0) void session.checkLinks();
                  }}
                >
                  {t("projectCheckLinks")}
                </button>
                {/* The primary action, and the one whose unavailability needed
                    explaining most: without a reason a reader finds it dim and
                    nothing anywhere says a reference has to be ticked. */}
                <button
                  type="button"
                  className="primary-button"
                  aria-disabled={working || selected.length === 0 || undefined}
                  title={selected.length === 0 ? t("projectCaptureNeedsSelection") : undefined}
                  data-project-capture=""
                  onClick={() => {
                    if (!working && selected.length > 0) void session.capture();
                  }}
                >
                  {t("projectCapture")}
                </button>
              </div>
            </div>

            {state.inputs.length === 0 ? (
              <p className="project-empty">{t("projectNoReferences")}</p>
            ) : (
              <ul className="project-list">
                {state.inputs.map((input) => {
                  const layer = layerOf(input);
                  const attached = inWorkbench(input) !== null;
                  const reasonId = `project-layer-reason-${input.id}`;
                  return (
                    <li
                      key={input.id}
                      className={`project-row ${verificationTone(input)}`}
                      data-project-input={input.id}
                      data-verification={input.verification}
                      data-unavailable-reason={input.unavailableReason ?? undefined}
                    >
                      <div className="project-row-select">
                        {/* Two independent choices on one row, as the roster
                            already distinguishes them: the box chooses what the
                            next capture covers, the name chooses what Details
                            describes. The box carries its own name, so nothing
                            is lost by no longer wrapping the label in it. */}
                        <input
                          type="checkbox"
                          checked={selected.includes(input.id)}
                          aria-label={t("projectSelectNamed", { name: input.label })}
                          onChange={() => session.toggleSelected(input.id)}
                        />
                        <button
                          type="button"
                          className="project-row-label"
                          aria-current={
                            inspecting?.kind === "input" && inspecting.id === input.id
                              ? "true"
                              : undefined
                          }
                          aria-controls="workbench-inspector"
                          aria-label={t("provenanceInspectInput", { name: input.label })}
                          data-project-inspect={input.id}
                          onClick={() => session.inspect({ kind: "input", id: input.id })}
                        >
                          {input.label}
                        </button>
                      </div>
                      <p className="project-row-facts">
                        <span className="project-verification" id={`project-state-${input.id}`}>
                          {t(verificationKey(input))}
                        </span>
                        <span className="project-locator">
                          {t(
                            input.locatorKind === "insideProject"
                              ? "projectLocatorInside"
                              : "projectLocatorOutside",
                          )}
                        </span>
                        {input.members.length > 1 ? (
                          <span className="project-members">
                            {t("projectMemberCount", { count: input.members.length })}
                          </span>
                        ) : null}
                      </p>
                      <div className="project-row-actions">
                        {/* The bridge to the session workspace, and the only
                            control here that touches it. A reference already
                            represented by a live row offers to show that row
                            instead of offering to add a second one -- and
                            showing it sends nothing at all. */}
                        {inWorkbench(input) !== null ? (
                          <button
                            type="button"
                            className="secondary-button"
                            aria-label={t("projectShowInWorkbenchNamed", { name: input.label })}
                            data-project-show-in-workbench={input.id}
                            onClick={() => {
                              const handle = inWorkbench(input);
                              if (handle !== null) onShowInWorkbench?.(handle);
                            }}
                          >
                            {t("projectShowInWorkbench")}
                          </button>
                        ) : (
                          // `aria-disabled` rather than `disabled`, for the
                          // reason every other inert control on this surface
                          // gives: a disabled button leaves the tab order, and
                          // the sentence saying why would then be readable only
                          // with a pointer. The state that decides it is
                          // already on the row in words, and the control points
                          // at that text rather than restating it silently.
                          <button
                            type="button"
                            className="secondary-button"
                            aria-disabled={
                              working || unavailableToAddKey(input, workspaceBusy) !== null || undefined
                            }
                            aria-describedby={
                              unavailableToAddKey(input, workspaceBusy) === null
                                ? undefined
                                : `project-state-${input.id}`
                            }
                            title={
                              unavailableToAddKey(input, workspaceBusy) === null
                                ? undefined
                                : t(unavailableToAddKey(input, workspaceBusy) as "projectAddNeedsCheck")
                            }
                            aria-label={t("projectAddToWorkbenchNamed", { name: input.label })}
                            data-project-add-to-workbench={input.id}
                            data-project-add-unavailable={
                              unavailableToAddKey(input, workspaceBusy) ?? undefined
                            }
                            onClick={() => {
                              if (!working && unavailableToAddKey(input, workspaceBusy) === null) {
                                void session.addToWorkbench(input.id);
                              }
                            }}
                          >
                            {t("projectAddToWorkbench")}
                          </button>
                        )}
                        {/* One element for both states, so the keyboard stays
                            on it when the answer to a press turns "create" into
                            "show". A layer can only be created from a reference
                            whose row is live right now; with none, the control
                            stays reachable and points at the reason. Showing
                            the layer sends nothing. */}
                        <button
                          type="button"
                          className="secondary-button"
                          aria-disabled={
                            layer === null ? working || !attached || undefined : undefined
                          }
                          aria-describedby={layer === null && !attached ? reasonId : undefined}
                          title={
                            layer === null && !attached
                              ? t("projectLayerNeedsWorkbench")
                              : undefined
                          }
                          aria-label={t(
                            layer === null ? "projectCreateLayerNamed" : "projectShowLayerNamed",
                            { name: input.label },
                          )}
                          data-project-create-layer={layer === null ? input.id : undefined}
                          data-project-show-layer={layer === null ? undefined : layer.id}
                          data-project-layer-unavailable={
                            layer === null && !attached ? "notInWorkbench" : undefined
                          }
                          onClick={() => {
                            if (layer !== null) {
                              session.inspect({ kind: "layer", id: layer.id });
                            } else if (!working && attached) {
                              void session.createLayer(input.id);
                            }
                          }}
                        >
                          {t(layer === null ? "projectCreateLayer" : "projectShowLayer")}
                        </button>
                        {layer === null && !attached ? (
                          <span id={reasonId} className="visually-hidden">
                            {t("projectLayerNeedsWorkbench")}
                          </span>
                        ) : null}
                        {input.relinkProposed ? (
                          <>
                            <span className="project-proposal" data-project-proposal={input.id}>
                              {t(
                                input.relinkCandidateMatches
                                  ? "projectRelinkMatches"
                                  : "projectRelinkDiffers",
                              )}
                            </span>
                            <button
                              type="button"
                              ref={confirmRef}
                              className="secondary-button"
                              aria-disabled={working || undefined}
                              data-project-relink-commit={input.id}
                              onClick={() => {
                                if (!working) void session.commitRelink(input.id);
                              }}
                            >
                              {t("projectRelinkConfirm")}
                            </button>
                            <button
                              type="button"
                              className="link-button"
                              aria-disabled={working || undefined}
                              onClick={() => {
                                if (!working) void session.abandonRelink();
                              }}
                            >
                              {t("projectRelinkAbandon")}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="secondary-button"
                            aria-disabled={working || undefined}
                            aria-label={t("projectRelinkNamed", { name: input.label })}
                            data-project-relink={input.id}
                            onClick={() => {
                              if (!working) void session.proposeRelink(input.id);
                            }}
                          >
                            {t("projectRelink")}
                          </button>
                        )}
                        <button
                          type="button"
                          className="link-button"
                          aria-disabled={working || undefined}
                          aria-label={t("projectRemoveNamed", { name: input.label })}
                          onClick={() => {
                            if (!working) void session.removeInput(input.id);
                          }}
                        >
                          {t("projectRemoveReference")}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Layers: identities, not files. Each row is named by its source
              and carries two facts about it -- whether the source's row is in
              the Workbench right now, and what the last check established --
              because a layer whose file has changed or gone is still the
              same layer, and the row has to say both things. */}
          <section className="project-section" aria-label={t("projectLayers")}>
            <h3 ref={layersHeading} tabIndex={-1}>
              {t("projectLayers")}
            </h3>
            {state.layers.length === 0 ? (
              <p className="project-empty">{t("projectNoLayers")}</p>
            ) : (
              <ul className="project-list">
                {state.layers.map((layer) => {
                  // A valid document cannot hold a layer without its source.
                  // Should one arrive anyway, the row says so rather than
                  // throwing the whole surface away.
                  const source = state.inputs.find((input) => input.id === layer.sourceInputId);
                  const handle = source === undefined ? null : inWorkbench(source);
                  const availability = handle === null ? "detached" : "attached";
                  const name = source?.label ?? t("provenanceRelatedGone");
                  const qcReason = qcUnavailable(source, liveDatasetHandles, viewedPreview);
                  const qcReasonId = `project-qc-reason-${layer.id}`;
                  return (
                    <li
                      key={layer.id}
                      className={`project-row project-layer ${
                        source === undefined ? "" : verificationTone(source)
                      }`}
                      data-project-layer={layer.id}
                      data-layer-availability={availability}
                      data-layer-source={layer.sourceInputId}
                    >
                      <div className="project-row-select">
                        <button
                          type="button"
                          className="project-row-label"
                          aria-current={
                            inspecting?.kind === "layer" && inspecting.id === layer.id
                              ? "true"
                              : undefined
                          }
                          aria-controls="workbench-inspector"
                          aria-label={t("provenanceInspectLayer", { name })}
                          data-project-inspect-layer={layer.id}
                          onClick={() => session.inspect({ kind: "layer", id: layer.id })}
                        >
                          {name}
                        </button>
                      </div>
                      <p className="project-row-facts">
                        <span className={`project-availability is-${availability}`}>
                          {t(
                            availability === "attached"
                              ? "projectLayerAttached"
                              : "projectLayerDetached",
                          )}
                        </span>
                        {source === undefined ? null : (
                          <span className="project-verification">
                            <span className="visually-hidden">{t("provenanceCurrentFile")}: </span>
                            {t(verificationKey(source))}
                          </span>
                        )}
                      </p>
                      <div className="project-row-actions">
                        {handle === null ? null : (
                          <button
                            type="button"
                            className="secondary-button"
                            aria-label={t("projectShowInWorkbenchNamed", { name })}
                            data-project-layer-show-in-workbench={layer.id}
                            onClick={() => onShowInWorkbench?.(handle)}
                          >
                            {t("projectShowInWorkbench")}
                          </button>
                        )}
                        {/* Copies the run summary of the preview on screen, and
                            only when that preview is this layer's source. It
                            never starts a preview and never attaches a source:
                            where it cannot run it stays reachable and points at
                            the one step that would let it. */}
                        <button
                          type="button"
                          className="secondary-button"
                          aria-disabled={working || qcReason !== null || undefined}
                          aria-describedby={qcReason === null ? undefined : qcReasonId}
                          title={qcReason === null ? undefined : t(QC_REASONS[qcReason])}
                          aria-label={t("projectCaptureQcNamed", { name })}
                          data-project-capture-qc={layer.id}
                          data-project-qc-unavailable={qcReason ?? undefined}
                          onClick={() => {
                            const token = viewedPreview?.token ?? null;
                            if (working || qcReason !== null || token === null) return;
                            capturing.current = { layerId: layer.id, shown: shownReport };
                            void session.captureQc(layer.id, token);
                          }}
                        >
                          {t("projectCaptureQc")}
                        </button>
                        {/* Opens the setup and sends nothing. Whether a plan
                            can run here -- a saved project, one mzML source --
                            is Rust's answer to a review, shown there. */}
                        <button
                          type="button"
                          className="secondary-button"
                          aria-disabled={working || undefined}
                          aria-expanded={targetedLayer?.id === layer.id}
                          aria-label={t("projectTargetedNamed", { name })}
                          data-project-targeted={layer.id}
                          onClick={() => {
                            if (!working) {
                              setTargeted({ projectId: state.projectId, layerId: layer.id });
                            }
                          }}
                        >
                          {t("projectTargeted")}
                        </button>
                        <button
                          type="button"
                          className="link-button"
                          aria-disabled={working || undefined}
                          aria-label={t("projectRemoveLayerNamed", { name })}
                          data-project-remove-layer={layer.id}
                          onClick={() => {
                            if (working) return;
                            removing.current = {
                              layerId: layer.id,
                              sourceInputId: layer.sourceInputId,
                            };
                            void session.removeLayer(layer.id);
                          }}
                        >
                          {t("projectRemoveLayer")}
                        </button>
                      </div>
                      {/* The reason is read out with the control, and shown
                          where the row does not already say it: a detached row
                          says "Not in the Workbench" in its facts above. */}
                      {qcReason === null ? null : (
                        <p
                          id={qcReasonId}
                          className={
                            qcReason === "qcNeedsWorkbench"
                              ? "visually-hidden"
                              : "project-qc-reason"
                          }
                          data-project-qc-reason={qcReason}
                        >
                          {t(QC_REASONS[qcReason])}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="project-section" aria-label={t("projectHistory")}>
            <h3>{t("projectHistory")}</h3>
            {/* What a successful capture is, said where it is displayed rather
                than in a document nobody reading this screen will open. */}
            <p className="project-note">{t("projectCaptureMeaning")}</p>
            {state.runs.length === 0 ? (
              <p className="project-empty">{t("projectNoRuns")}</p>
            ) : (
              <ul className="project-list">
                {state.runs.map((run) => {
                  const artifacts = state.artifacts.filter((artifact) =>
                    run.outputArtifactIds.includes(artifact.id),
                  );
                  return (
                    <li
                      key={run.id}
                      className="project-run"
                      data-project-run={run.id}
                      data-outcome={run.outcome}
                    >
                      <p className="project-run-head">
                        <button
                          type="button"
                          className="project-run-operation"
                          aria-current={
                            inspecting?.kind === "run" && inspecting.id === run.id
                              ? "true"
                              : undefined
                          }
                          aria-controls="workbench-inspector"
                          aria-label={t(inspectRunName(run), {
                            when: recordedAt(run.finishedAt, locale),
                          })}
                          data-project-inspect-run={run.id}
                          data-operation={run.operation}
                          onClick={() => session.inspect({ kind: "run", id: run.id })}
                        >
                          {t(operationKey(run))}
                        </button>
                        <span className="project-run-outcome">
                          {t(
                            run.outcome === "completed"
                              ? "projectRunCompleted"
                              : run.outcome === "failed"
                                ? "projectRunFailed"
                                : "projectRunCancelled",
                          )}
                        </span>
                        {/* Formatted for the reader. The document stores
                            RFC 3339 in UTC, which is what a record should hold
                            and not what a person should be shown. */}
                        <span className="project-run-when">
                          <time dateTime={run.finishedAt}>{recordedAt(run.finishedAt, locale)}</time>
                        </span>
                      </p>
                      <p className="project-run-relationship">
                        {run.layerIds.length > 0
                          ? // A QC capture consumed a layer, and says which by
                            // its source's name, as a layer row does.
                            run.layerIds.map((layerId) => {
                              const layer = state.layers.find((each) => each.id === layerId);
                              const source = state.inputs.find(
                                (input) => input.id === layer?.sourceInputId,
                              );
                              return (
                                <span key={layerId} data-project-run-layer={layerId}>
                                  {t("projectRunLayer", {
                                    name: source?.label ?? t("provenanceRelatedGone"),
                                  })}
                                </span>
                              );
                            })
                          : t("projectRunInputs", { count: run.inputIds.length })}
                        {artifacts.length === 0 ? (
                          <span data-project-no-artifact="">{t("projectRunNoArtifact")}</span>
                        ) : (
                          // Described from the counts rather than from the
                          // label the document stores: that label is written in
                          // English by the backend, and echoing it would put
                          // English into a Chinese session.
                          artifacts.map((artifact) => (
                            <span key={artifact.id} data-project-artifact={artifact.id}>
                              <button
                                type="button"
                                className="link-button"
                                aria-current={
                                  inspecting?.kind === "artifact" && inspecting.id === artifact.id
                                    ? "true"
                                    : undefined
                                }
                                aria-controls="workbench-inspector"
                                aria-label={t(inspectRecordName(artifact), {
                                  when: recordedAt(run.finishedAt, locale),
                                })}
                                data-project-inspect-artifact={artifact.id}
                                data-artifact-kind={artifact.kind}
                                onClick={() => session.inspect({ kind: "artifact", id: artifact.id })}
                              >
                                {t(artifactKey(artifact))}
                              </button>
                              {artifact.kind === "fileFactsV1" ? (
                                <>
                                  {" — "}
                                  {t("projectArtifactMembers", {
                                    count: artifact.observedMemberCount,
                                  })}
                                </>
                              ) : artifact.targetedMs1 ? (
                                <>
                                  {" — "}
                                  {/* In the report's own outcome words, and
                                      only those that occurred: a count that
                                      left the rest unnamed would read a
                                      failure as an absence. */}
                                  {outcomeCounts(artifact.targetedMs1.result.summary)
                                    .map(([outcome, count]) =>
                                      t("projectArtifactTargetedOutcome", {
                                        count,
                                        outcome: t(OUTCOME_KEYS[outcome]),
                                      }),
                                    )
                                    .join(" · ")}
                                </>
                              ) : null}
                            </span>
                          ))
                        )}
                      </p>
                      <p className="project-run-version">
                        {t("projectRunVersion", { version: run.applicationVersion })}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      ) : (
        <p className="project-empty">{t("projectNoneHint")}</p>
      )}
    </div>
  );
}
