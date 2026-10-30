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

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Button, Icon, IconButton } from "../../components/ui";
import type { PreviewError } from "../mzml-preview/contracts";
import { formatCount } from "../mzml-preview/format";
import { ownedErrorMessage } from "../mzml-preview/ownedErrorMessages";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import { attachedRow, provenanceOf, qcUnavailable, type ViewedPreview } from "./lineage";
import type {
  OutcomeSummary,
  ProjectArtifact,
  ProjectInput,
  ProjectRun,
  RowOutcome,
} from "./projectApi";
import { QcReport } from "./QcReport";
import {
  EMPTY_TARGETED_DRAFT,
  FAILURE_KEYS,
  OUTCOME_KEYS,
  PAYLOAD_STATE_KEYS,
  phaseKey,
  TargetedMs1Report,
  TargetedMs1Setup,
  batchSummary,
  type TargetedDraft,
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
  revisionExhausted: "projectRefusedRevisionExhausted",
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
  insufficientWorkAreaSpace: "projectRefusedInsufficientWorkAreaSpace",
  planNotCurrent: "projectRefusedPlanNotCurrent",
  payloadStoreUnusable: "projectRefusedPayloadStoreUnusable",
  destinationStoreExists: "projectRefusedDestinationStoreExists",
  payloadNotCopied: "projectRefusedPayloadNotCopied",
  payloadMissing: "targetedPayloadMissing",
  payloadCorrupt: "targetedPayloadCorrupt",
  exportInProgress: "projectRefusedExportInProgress",
  batchSizeOutOfRange: "projectRefusedBatchSize",
  batchDuplicateInput: "projectRefusedBatchDuplicate",
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
 * What one row of recorded work is called: the record the run left, by its
 * kind. A run that left none is named by what it would have left -- or, for
 * a targeted run, by the recipe -- never by the action that starts one, so
 * "Capture file facts" stays the name of the button alone.
 */
function recordTitleKey(run: ProjectRun, record: ProjectArtifact | null) {
  if (record !== null) return artifactKey(record);
  return run.operation === "captureAcquisitionQcSnapshotV1"
    ? ("projectArtifactQcSummary" as const)
    : run.operation === "targetedMs1V1"
      ? ("projectOperationTargetedMs1" as const)
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

/** The sentence this surface uses for what the project is doing, or `null`. */
export function busyKey(busy: ProjectBusy) {
  return busy === "idle" ? null : BUSY[busy];
}

/**
 * Why this reference cannot be added to the Workbench, or `null` where it can.
 *
 * Keyed on the same current state the row already displays, because that is
 * what decides it: the Workbench takes the file the project recorded, and
 * "which file is that" is a question only a check answers. "It changed" and
 * "it is not there" are said by the row's own state text; only "check it
 * first" and "the Workbench is busy" have a sentence of their own here.
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

/** The busy line, which is why every control waits while something is out. */
const BUSY_ID = "project-busy-line";
/** Why Save waits for a project that has never been saved: Save As first. */
const SAVE_LOCATION_ID = "project-save-location";
/** Why Check linked files and Capture file facts wait: nothing is referenced. */
const NO_REFERENCES_ID = "project-no-references";

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
   *
   * A layout effect, so it runs in the commit it belongs to. As a passive
   * effect, one left over from a commit made before the press -- the one that
   * first showed the project, or any that settled an earlier operation -- could
   * still run after the press armed it, see that commit's idle state with the
   * layer still listed, and spend the arm the answer needed.
   */
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const layersHeading = useRef<HTMLHeadingElement | null>(null);
  const removing = useRef<{ readonly layerId: string; readonly sourceInputId: string } | null>(
    null,
  );
  useLayoutEffect(() => {
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

  /**
   * The record whose report the main region shows: the QC snapshot or
   * targeted result being inspected -- or, while the run that produced the
   * report on screen is inspected, that same report. So walking from a report
   * to its run in Details and back keeps the report, the target chosen in it
   * and whatever was open. Any other selection replaces or removes it, and
   * inspecting a run never opens a report that was not already shown.
   *
   * Kept while rendering, as the replacement reset below is: an effect would
   * leave one frame showing no report between the two inspections.
   */
  const provenance = session.provenance;
  const [shownRecord, setShownRecord] = useState<string | null>(null);
  const inspectedRecord =
    provenance?.kind === "artifact" &&
    (provenance.artifact.qcSnapshot !== null || provenance.artifact.kind === "targetedMs1ResultV1")
      ? provenance.artifact.id
      : null;
  const recordShown =
    inspectedRecord ??
    (provenance?.kind === "run" &&
    shownRecord !== null &&
    provenance.run.outputArtifactIds.includes(shownRecord)
      ? shownRecord
      : null);
  if (recordShown !== shownRecord) setShownRecord(recordShown);
  const shown =
    recordShown === null
      ? null
      : provenance?.kind === "artifact"
        ? provenance
        : provenanceOf(state, { kind: "artifact", id: recordShown });

  /** The QC snapshot on screen, with what the report needs beside it. */
  const report =
    shown?.kind === "artifact" && shown.artifact.qcSnapshot !== null
      ? {
          artifact: shown.artifact,
          snapshot: shown.artifact.qcSnapshot,
          sourceName: shown.layerSources[0]?.record?.label ?? null,
          recordedAt: shown.producedBy?.record?.finishedAt ?? null,
        }
      : null;

  /**
   * Takes the keyboard to the report a capture produced.
   *
   * The report arrives above the lists, so the control that was pressed is
   * pushed down by its whole height -- at 1366x768, out of view -- and leaving
   * the keyboard there would leave it somewhere nobody can see. It goes to the
   * report's heading instead, which is the thing the press made and which the
   * report brings into view once it has rendered (the focus itself does not
   * scroll).
   *
   * Armed only by the press and spent on the first settled answer, and it acts
   * only on a report that this answer made current and only if the keyboard is
   * still on the control that was pressed: a refusal, an answer that arrived
   * after the reader moved on, and a reader who moved focus all leave it where
   * it is.
   *
   * A layout effect for the removal effect's reason: a passive run left over
   * from a commit before the press -- one that settled an earlier operation --
   * would see that commit's idle state and spend the arm.
   */
  const capturing = useRef<{ readonly layerId: string; readonly shown: string | null } | null>(
    null,
  );
  const shownReport = report?.artifact.id ?? null;
  useLayoutEffect(() => {
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
  /**
   * What the user typed into the setup, kept for the open project so closing
   * the setup or opening it from another row does not throw it away. Never
   * persisted, and never carried into another project.
   */
  const [targetedDraft, setTargetedDraft] = useState<TargetedDraft>(EMPTY_TARGETED_DRAFT);
  // A project replaced under the setup -- a New, Open or Close, also of
  // another copy with the same identifiers -- closes it and takes the draft
  // with it. Reset while rendering the replacement, not in an effect after
  // it: an effect could land after the reader's first press in the new
  // project and undo it.
  const [shownReplacement, setShownReplacement] = useState(session.replacements);
  if (shownReplacement !== session.replacements) {
    setShownReplacement(session.replacements);
    setTargeted(null);
    setTargetedDraft(EMPTY_TARGETED_DRAFT);
  }
  const targetedLayer =
    targeted !== null && targeted.projectId === state.projectId
      ? (state.layers.find((layer) => layer.id === targeted.layerId) ?? null)
      : null;
  const targetedSource =
    targetedLayer === null
      ? undefined
      : state.inputs.find((input) => input.id === targetedLayer.sourceInputId);

  /** The targeted result on screen, with what its report needs. */
  const targetedReport =
    shown?.kind === "artifact" && shown.artifact.kind === "targetedMs1ResultV1"
      ? {
          artifact: shown.artifact,
          plan: shown.targeted?.plan ?? null,
          sourceName: shown.layerSources[0]?.record?.label ?? null,
          source: shown.layerSources[0]?.record ?? null,
          recordedAt: shown.producedBy?.record?.finishedAt ?? null,
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
  // A batch in progress: which member is running, counted from one. Between
  // members, the next one to start.
  const batch = session.analysisBatch;
  const batchPosition =
    batch === null
      ? 0
      : Math.min(
          batch.length,
          batch.findIndex((member) => member.state === "running") + 1 ||
            batch.filter((member) => member.state !== "queued").length + 1,
        );
  const endedBatch =
    session.targetedBatchJustEnded && session.lastTargetedBatch !== null
      ? session.lastTargetedBatch
      : null;
  /** What the surface is doing, in the busy line's words; also the setup's reason to hold. */
  const busyText =
    busyKey(busy) === null
      ? null
      : batch !== null
        ? t("projectBusyBatch", { position: batchPosition, total: batch.length })
        : t(busyKey(busy) as "projectBusySaving");
  // A cancel of any accepted operation -- a targeted run, a links check, a
  // capture or an admission -- is a request until that operation's answer is
  // in and shown: every control that could send it says so, and none sends it
  // twice. A targeted run's controls say "stop", the rest keep their own
  // "cancel".
  const stopping = session.stopRequested;
  const requestedKey = busy === "analysing" ? "targetedStopRequested" : "projectCancelRequested";
  const announcement =
    busyKey(busy) !== null
      ? stopping
        ? t(requestedKey)
        : t(busyKey(busy) as "projectBusySaving")
      : pending !== null
        ? t("projectUnsavedQuestion")
        : problem !== null
          ? t(refusalKey(problem))
          : cancelled
            ? t(session.cancelledRunRecorded ? "projectCancelledRunRecorded" : "projectCancelled")
            : endedBatch !== null
              ? t("targetedBatchEndedAnnouncement", { summary: batchSummary(endedBatch, t) })
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
                    : t("sentencePair", { first: t("targetedLastFailed"), second: t(FAILURE_KEYS[lastTargetedFailure.code]) })
                  : "";

  // One filled primary per state: the open targeted setup's own Run; else the
  // head's next step -- New project with nothing open, Save As… before the
  // first save, Save while a saved project has changes; else Capture file
  // facts.
  const taskOpen = targetedLayer !== null;
  const headPrimary = taskOpen
    ? null
    : !state.open
      ? "new"
      : !state.published
        ? "saveAs"
        : state.dirty
          ? "save"
          : null;
  const capturePrimary = state.open && headPrimary === null && !taskOpen;

  /**
   * Keeps the keyboard on the head across a Close.
   *
   * A Close that is answered takes Save, Save As… and Close away -- with
   * nothing open they are not offered -- so the control that was pressed is
   * gone and focus would drop to `<body>`. It goes to New project instead,
   * the head's next step. Only focus the change actually dropped is moved.
   */
  const newRef = useRef<HTMLButtonElement | null>(null);
  const wasOpen = useRef(state.open);
  useLayoutEffect(() => {
    const closed = wasOpen.current && !state.open;
    wasOpen.current = state.open;
    if (!closed) return;
    const active = document.activeElement;
    if (active === null || active === document.body || !active.isConnected) newRef.current?.focus();
  }, [state.open]);

  /**
   * Opens Details on one object, and the region with it when it is closed.
   *
   * `detailsPresent` only says whether the region is on screen, and with
   * nothing inspected it is never on screen -- even where the reader asked
   * for it to be -- so before the first inspection it cannot say whether the
   * shell's toggle would open the region or close it. The answer is then read
   * in the commit the inspection lands in, before it is painted.
   */
  const revealOnInspect = useRef(false);
  const showDetails = (selection: Parameters<ProjectSession["inspect"]>[0]) => {
    if (inspecting === null) revealOnInspect.current = true;
    else if (!detailsPresent) onRevealDetails?.();
    session.inspect(selection);
  };
  useLayoutEffect(() => {
    if (!revealOnInspect.current || inspecting === null) return;
    revealOnInspect.current = false;
    if (!detailsPresent) onRevealDetails?.();
  }, [inspecting, detailsPresent, onRevealDetails]);

  return (
    <div
      ref={surfaceRef}
      className="project-surface"
      data-project-surface=""
      aria-busy={working || undefined}
    >
      {/* The page head: the project's name and its state on one line, and
          the project's file actions beside it. Save, Save As… and Close only
          exist while a project is open. */}
      <header className="project-header">
        <div className="project-title">
          <h2>{state.open ? state.name : t("projectNone")}</h2>
          {state.dirty && pending === null ? (
            <span className="project-tag is-warning" data-project-unsaved="">
              {t("projectUnsaved")}
            </span>
          ) : null}
          {/* Why Save waits, said rather than only hovered: never having been
              saved is a passing refusal, and Save As… is the way through it. */}
          {state.open && !state.published ? (
            <span id={SAVE_LOCATION_ID} className="project-head-state">
              {t("projectSaveNeedsLocation")}
            </span>
          ) : null}
        </div>
        <div className="project-actions">
          {/* Refused controls stay in the tab order and point at why. */}
          <Button
            ref={newRef}
            variant={headPrimary === "new" ? "primary" : "secondary"}
            size="sm"
            refused={working}
            reasonId={BUSY_ID}
            onClick={() => void session.createProject(t("projectDefaultName"))}
          >
            {t("projectNew")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            refused={working}
            reasonId={BUSY_ID}
            onClick={() => void session.openProject()}
          >
            {t("projectOpen")}
          </Button>
          {state.open ? (
            <>
              <Button
                variant={headPrimary === "save" ? "primary" : "secondary"}
                size="sm"
                refused={working || !state.published}
                reasonId={working ? BUSY_ID : SAVE_LOCATION_ID}
                onClick={() => void session.saveProject()}
              >
                {t("projectSave")}
              </Button>
              <Button
                variant={headPrimary === "saveAs" ? "primary" : "secondary"}
                size="sm"
                refused={working}
                reasonId={BUSY_ID}
                onClick={() => void session.saveProjectAs()}
              >
                {t("projectSaveAs")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                refused={working}
                reasonId={BUSY_ID}
                onClick={() => void session.closeProject()}
              >
                {t("projectClose")}
              </Button>
            </>
          ) : null}
        </div>
      </header>

      {/* Mounted from the first render and empty until there is something to
          say, so what arrives is announced rather than appearing silently. */}
      <p aria-live="polite" className="visually-hidden" data-live-region="project">
        {announcement}
      </p>

      {busyKey(busy) === null ? null : (
        <div className="project-busy" data-project-busy={busy}>
          <p id={BUSY_ID}>
            {busyText}
            {busy === "analysing" && phase !== null ? (
              <span data-project-busy-phase={session.analysisPhase ?? ""}>{t(phase)}</span>
            ) : null}
          </p>
          {/* Offered only for an operation this session accepted and is still
              waiting on. A save or a dialog is busy too, but it is not a thing
              a cancel can name -- and once the answer is in, the control is
              gone rather than left to send a late request. Rust enforces the
              same rule; this is the affordance agreeing with it rather than
              the fix. */}
          {session.activeOperation === null ? null : (
            <Button
              variant="secondary"
              size="sm"
              refused={stopping}
              data-project-cancel={session.activeOperation}
              onClick={() => void session.cancelJob()}
            >
              {/* A batch's one operation is the whole batch: cancelling it is
                  the batch's Stop, so it is named that. */}
              {t(stopping ? requestedKey : batch === null ? "projectCancel" : "targetedBatchStop")}
            </Button>
          )}
        </div>
      )}

      {/* Unsaved changes are a question, not a failure, and the answer is the
          user's. Without this the refusal is a loop: the action is refused and
          nothing on screen offers a way through it. */}
      {pending === null ? null : (
        <div className="project-unsaved" data-project-pending={pending.kind}>
          <p>{t("projectUnsavedQuestion")}</p>
          {/* Answered only while nothing else is out: a save or a discard
              started under a running operation would settle over it. */}
          <Button
            variant="secondary"
            size="sm"
            refused={working}
            reasonId={BUSY_ID}
            onClick={() => void (state.published ? session.saveProject() : session.saveProjectAs())}
          >
            {t("projectUnsavedSaveFirst")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            refused={working}
            reasonId={BUSY_ID}
            data-project-discard=""
            onClick={() => void session.discardAndContinue()}
          >
            {t("projectUnsavedDiscard")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            refused={working}
            reasonId={BUSY_ID}
            onClick={() => session.keepEditing()}
          >
            {t("projectUnsavedKeepEditing")}
          </Button>
        </div>
      )}

      {/* Below 1700px the contextual region is closed unless the user asked
          for it, and a narrow window folds it away entirely. Inspecting an
          object would then appear to do nothing, so this offers the one control
          that brings the answer back -- the same toggle the header owns, not a
          second mechanism. */}
      {inspecting !== null && !detailsPresent && onRevealDetails !== undefined ? (
        <div className="project-inspect-hint" data-project-inspect-hint="">
          <Button
            variant="secondary"
            size="sm"
            icon={<Icon name="panelRight" />}
            onClick={onRevealDetails}
          >
            {t("provenanceShowDetails")}
          </Button>
        </div>
      ) : null}

      {problem === null ? null : (
        <div className="project-problem" data-project-problem={problem}>
          <p>{t(refusalKey(problem))}</p>
          <IconButton
            size="sm"
            label={t("projectDismiss")}
            icon={<Icon name="close" />}
            onClick={session.dismissProblem}
          />
        </div>
      )}

      {cancelled ? (
        <p className="project-notice" data-project-cancelled="">
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
              draft={targetedDraft}
              onDraft={setTargetedDraft}
              busyText={busyText}
              refusalText={(code) => t(refusalKey(code))}
              onRevealDetails={detailsPresent ? undefined : onRevealDetails}
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
              <div className="project-section-title">
                <h3>{t("projectReferences")}</h3>
                {state.inputs.length === 0 ? null : (
                  <span className="project-count">{formatCount(state.inputs.length)}</span>
                )}
              </div>
              <div className="project-actions">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Icon name="plus" />}
                  refused={working}
                  reasonId={BUSY_ID}
                  onClick={() => void session.addInput()}
                >
                  {t("projectAddReference")}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Icon name="refresh" />}
                  refused={working || state.inputs.length === 0}
                  reasonId={working ? BUSY_ID : state.inputs.length === 0 ? NO_REFERENCES_ID : undefined}
                  data-project-check=""
                  onClick={() => void session.checkLinks()}
                >
                  {t("projectCheckLinks")}
                </Button>
                <Button
                  variant={capturePrimary ? "primary" : "secondary"}
                  size="sm"
                  refused={working || selected.length === 0}
                  reasonId={working ? BUSY_ID : state.inputs.length === 0 ? NO_REFERENCES_ID : undefined}
                  aria-describedby={state.inputs.length > 0 && selected.length === 0 ? "project-capture-reason" : undefined}
                  title={selected.length === 0 ? t("projectCaptureNeedsSelection") : undefined}
                  data-project-capture=""
                  onClick={() => void session.capture()}
                >
                  {t("projectCapture")}
                </Button>
              </div>
              {/* Said, not only hovered, directly under the refused capture:
                  it is still a Tab stop, and its reason has to reach a reader
                  who arrives there (PM9 UI-24). With no reference at all, the
                  empty list says so. */}
              {state.inputs.length > 0 && selected.length === 0 ? (
                <p className="project-action-reason project-head-reason" id="project-capture-reason">
                  {t("projectCaptureNeedsSelection")}
                </p>
              ) : null}
            </div>

            {state.inputs.length === 0 ? (
              <p id={NO_REFERENCES_ID} className="project-empty">{t("projectNoReferences")}</p>
            ) : (
              <ul className="project-list">
                {state.inputs.map((input) => {
                  const layer = layerOf(input);
                  const attached = inWorkbench(input) !== null;
                  const reasonId = `project-layer-reason-${input.id}`;
                  const addRefused = unavailableToAddKey(input, workspaceBusy);
                  return (
                    <li
                      key={input.id}
                      className={`project-row ${verificationTone(input)}`}
                      data-project-input={input.id}
                      data-verification={input.verification}
                      data-unavailable-reason={input.unavailableReason ?? undefined}
                    >
                      <div className="project-row-main">
                        {/* Two independent choices on one row, as the roster
                            already distinguishes them: the box chooses what the
                            next capture covers, Details chooses what the
                            Details region describes. The name is text. */}
                        <span className="project-row-label">
                          <input
                            type="checkbox"
                            checked={selected.includes(input.id)}
                            aria-label={t("projectSelectNamed", { name: input.label })}
                            onChange={() => session.toggleSelected(input.id)}
                          />
                          <span className="project-row-name" title={input.label}>
                            {input.label}
                          </span>
                        </span>
                        <p className="project-row-facts">
                          <span
                            className={`project-tag project-verification ${verificationTone(input)}`}
                            id={`project-state-${input.id}`}
                          >
                            {t(verificationKey(input))}
                          </span>
                          <span className="project-tag project-locator">
                            {t(
                              input.locatorKind === "insideProject"
                                ? "projectLocatorInside"
                                : "projectLocatorOutside",
                            )}
                          </span>
                          {input.members.length > 1 ? (
                            <span className="project-tag project-members">
                              {t("projectMemberCount", { count: input.members.length })}
                            </span>
                          ) : null}
                        </p>
                      </div>
                      <div className="project-row-actions">
                        {/* What can be done now first, in a fixed order so no
                            control moves under the keyboard: Locate… and
                            Remove, then the Workbench bridge and the layer,
                            whose refusal is said right beside it. */}
                        {input.relinkProposed ? (
                          <>
                            <span className="project-proposal" data-project-proposal={input.id}>
                              {t(
                                input.relinkCandidateMatches
                                  ? "projectRelinkMatches"
                                  : "projectRelinkDiffers",
                              )}
                            </span>
                            <Button
                              ref={confirmRef}
                              variant="secondary"
                              size="sm"
                              refused={working}
                              reasonId={BUSY_ID}
                              data-project-relink-commit={input.id}
                              onClick={() => void session.commitRelink(input.id)}
                            >
                              {t("projectRelinkConfirm")}
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              refused={working}
                              reasonId={BUSY_ID}
                              onClick={() => void session.abandonRelink()}
                            >
                              {t("projectRelinkAbandon")}
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="secondary"
                            size="sm"
                            refused={working}
                            reasonId={BUSY_ID}
                            aria-label={t("projectRelinkNamed", { name: input.label })}
                            data-project-relink={input.id}
                            onClick={() => void session.proposeRelink(input.id)}
                          >
                            {t("projectRelink")}
                          </Button>
                        )}
                        <Button
                          variant="danger"
                          size="sm"
                          refused={working}
                          reasonId={BUSY_ID}
                          aria-label={t("projectRemoveNamed", { name: input.label })}
                          onClick={() => void session.removeInput(input.id)}
                        >
                          {t("projectRemoveReference")}
                        </Button>
                        {/* The bridge to the session workspace, and the only
                            control here that touches it. A reference already
                            represented by a live row offers to show that row
                            instead of offering to add a second one -- and
                            showing it sends nothing at all. */}
                        {inWorkbench(input) !== null ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            aria-label={t("projectShowInWorkbenchNamed", { name: input.label })}
                            data-project-show-in-workbench={input.id}
                            onClick={() => {
                              const handle = inWorkbench(input);
                              if (handle !== null) onShowInWorkbench?.(handle);
                            }}
                          >
                            {t("projectShowInWorkbench")}
                          </Button>
                        ) : (
                          // Refused, not disabled: it stays in the tab order
                          // and points at the row's own state text, which
                          // already says in words what decides it.
                          <Button
                            variant="secondary"
                            size="sm"
                            refused={working || addRefused !== null}
                            reasonId={addRefused === null && working ? BUSY_ID : undefined}
                            aria-describedby={
                              addRefused === null ? undefined : `project-state-${input.id}`
                            }
                            title={
                              addRefused === "projectAddNeedsCheck" ||
                              addRefused === "projectAddWorkspaceBusy"
                                ? t(addRefused)
                                : undefined
                            }
                            aria-label={t("projectAddToWorkbenchNamed", { name: input.label })}
                            data-project-add-to-workbench={input.id}
                            data-project-add-unavailable={addRefused ?? undefined}
                            onClick={() => void session.addToWorkbench(input.id)}
                          >
                            {t("projectAddToWorkbench")}
                          </Button>
                        )}
                        {/* One element for both states, so the keyboard stays
                            on it when the answer to a press turns "create" into
                            "show". A layer can only be created from a reference
                            whose row is live right now; with none, the control
                            stays reachable and points at the reason. Showing
                            the layer sends nothing. */}
                        <Button
                          variant="secondary"
                          size="sm"
                          refused={layer === null && (working || !attached)}
                          reasonId={layer === null && attached && working ? BUSY_ID : undefined}
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
                            } else {
                              void session.createLayer(input.id);
                            }
                          }}
                        >
                          {t(layer === null ? "projectCreateLayer" : "projectShowLayer")}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          aria-current={
                            inspecting?.kind === "input" && inspecting.id === input.id
                              ? "true"
                              : undefined
                          }
                          aria-controls="workbench-inspector"
                          aria-label={t("projectDetailsFor", { name: input.label })}
                          data-project-inspect={input.id}
                          onClick={() => showDetails({ kind: "input", id: input.id })}
                        >
                          {t("projectDetails")}
                        </Button>
                      </div>
                      {/* Why Create layer waits, directly under it: nothing
                          else on the row says the reference is not in the
                          Workbench. */}
                      {layer === null && !attached ? (
                        <p id={reasonId} className="project-action-reason project-row-reason">
                          {t("projectLayerNeedsWorkbench")}
                        </p>
                      ) : null}
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
            <div className="project-section-head">
              <div className="project-section-title">
                <h3 ref={layersHeading} tabIndex={-1}>
                  {t("projectLayers")}
                </h3>
                {state.layers.length === 0 ? null : (
                  <span className="project-count">{formatCount(state.layers.length)}</span>
                )}
              </div>
            </div>
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
                      <div className="project-row-main">
                        <span className="project-row-name" title={name}>
                          {name}
                        </span>
                        <p className="project-row-facts">
                          <span className={`project-tag project-availability is-${availability}`}>
                            {t(
                              availability === "attached"
                                ? "projectLayerAttached"
                                : "projectLayerDetached",
                            )}
                          </span>
                          {source === undefined ? null : (
                            <span className={`project-tag project-verification ${verificationTone(source)}`}>
                              <span className="visually-hidden">{t("provenanceCurrentFile")}: </span>
                              {t(verificationKey(source))}
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="project-row-actions">
                        {handle === null ? null : (
                          <Button
                            variant="secondary"
                            size="sm"
                            aria-label={t("projectShowInWorkbenchNamed", { name })}
                            data-project-layer-show-in-workbench={layer.id}
                            onClick={() => onShowInWorkbench?.(handle)}
                          >
                            {t("projectShowInWorkbench")}
                          </Button>
                        )}
                        {/* Copies the run summary of the preview on screen, and
                            only when that preview is this layer's source. It
                            never starts a preview and never attaches a source:
                            where it cannot run it stays reachable and points at
                            the one step that would let it. */}
                        <Button
                          variant="secondary"
                          size="sm"
                          refused={working || qcReason !== null}
                          reasonId={qcReason === null && working ? BUSY_ID : undefined}
                          aria-describedby={qcReason === null ? undefined : qcReasonId}
                          title={qcReason === null ? undefined : t(QC_REASONS[qcReason])}
                          aria-label={t("projectCaptureQcNamed", { name })}
                          data-project-capture-qc={layer.id}
                          data-project-qc-unavailable={qcReason ?? undefined}
                          onClick={() => {
                            const token = viewedPreview?.token ?? null;
                            if (token === null) return;
                            capturing.current = { layerId: layer.id, shown: shownReport };
                            void session.captureQc(layer.id, token);
                          }}
                        >
                          {t("projectCaptureQc")}
                        </Button>
                        {/* Opens the setup and sends nothing. Whether a plan
                            can run here -- a saved project, one mzML source --
                            is Rust's answer to a review, shown there. */}
                        <Button
                          variant="secondary"
                          size="sm"
                          refused={working}
                          reasonId={BUSY_ID}
                          aria-expanded={targetedLayer?.id === layer.id}
                          aria-label={t("projectTargetedNamed", { name })}
                          data-project-targeted={layer.id}
                          onClick={() => setTargeted({ projectId: state.projectId, layerId: layer.id })}
                        >
                          {t("projectTargeted")}
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          refused={working}
                          reasonId={BUSY_ID}
                          aria-label={t("projectRemoveLayerNamed", { name })}
                          data-project-remove-layer={layer.id}
                          onClick={() => {
                            removing.current = {
                              layerId: layer.id,
                              sourceInputId: layer.sourceInputId,
                            };
                            void session.removeLayer(layer.id);
                          }}
                        >
                          {t("projectRemoveLayer")}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          aria-current={
                            inspecting?.kind === "layer" && inspecting.id === layer.id
                              ? "true"
                              : undefined
                          }
                          aria-controls="workbench-inspector"
                          aria-label={t("projectLayerDetailsFor", { name })}
                          data-project-inspect-layer={layer.id}
                          onClick={() => showDetails({ kind: "layer", id: layer.id })}
                        >
                          {t("projectDetails")}
                        </Button>
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
            <div className="project-section-head">
              <div className="project-section-title">
                <h3>{t("projectHistory")}</h3>
                {state.runs.length === 0 ? null : (
                  <span className="project-count">{formatCount(state.runs.length)}</span>
                )}
              </div>
            </div>
            {state.runs.length === 0 ? (
              <p className="project-empty">{t("projectNoRuns")}</p>
            ) : (
              <ul className="project-list">
                {state.runs.map((run) => {
                  const artifacts = state.artifacts.filter((artifact) =>
                    run.outputArtifactIds.includes(artifact.id),
                  );
                  // The row is the record a run left, and Details opens on
                  // it; the run itself is one step on, as "Produced by". A
                  // run that left nothing opens on itself.
                  const record = artifacts[0] ?? null;
                  const title = t(recordTitleKey(run, record));
                  const when = recordedAt(run.finishedAt, locale);
                  return (
                    <li
                      key={run.id}
                      className="project-row project-run"
                      data-project-run={run.id}
                      data-outcome={run.outcome}
                      data-operation={run.operation}
                    >
                      <div className="project-row-main">
                        <span className="project-row-name">{title}</span>
                        <p className="project-row-facts">
                          <span className={`project-tag project-run-outcome is-${run.outcome}`}>
                            {t(
                              run.outcome === "completed"
                                ? "projectRunCompleted"
                                : run.outcome === "failed"
                                  ? "projectRunFailed"
                                  : "projectRunCancelled",
                            )}
                          </span>
                          {/* Formatted for the reader. The document stores
                              RFC 3339 in UTC, which is what a record should
                              hold and not what a person should be shown. */}
                          <span className="project-run-when">
                            <time dateTime={run.finishedAt}>{when}</time>
                          </span>
                        </p>
                      </div>
                      <div className="project-row-actions">
                        <Button
                          variant="secondary"
                          size="sm"
                          aria-current={
                            (inspecting?.kind === "run" && inspecting.id === run.id) ||
                            (inspecting?.kind === "artifact" &&
                              artifacts.some((artifact) => artifact.id === inspecting.id))
                              ? "true"
                              : undefined
                          }
                          aria-controls="workbench-inspector"
                          aria-label={t("projectRecordDetailsFor", { name: title, when })}
                          data-project-inspect-artifact={record?.id}
                          data-artifact-kind={record?.kind}
                          data-project-inspect-run={record === null ? run.id : undefined}
                          onClick={() => {
                            if (record === null) showDetails({ kind: "run", id: run.id });
                            // A report is shown in this region, above the
                            // lists, and is the answer the press asked for:
                            // the lineage beside it is not opened over it.
                            else if (record.qcSnapshot !== null || record.kind === "targetedMs1ResultV1")
                              session.inspect({ kind: "artifact", id: record.id });
                            else showDetails({ kind: "artifact", id: record.id });
                          }}
                        >
                          {t("projectDetails")}
                        </Button>
                      </div>
                      {/* Why a targeted run failed, where the failure is
                          listed: the run's own sentence, never an absence. */}
                      {run.outcome === "failed" && run.targetedMs1?.failure != null ? (
                        <p
                          className="project-run-failure"
                          data-project-run-failure={run.targetedMs1.failure.code}
                        >
                          {t(FAILURE_KEYS[run.targetedMs1.failure.code])}
                        </p>
                      ) : null}
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
                          : <span>{t("projectRunInputs", { count: run.inputIds.length })}</span>}
                        {artifacts.length === 0 ? (
                          <span data-project-no-artifact="">
                            {t(run.operation === "targetedMs1V1" ? "projectRunNoResult" : "projectRunNoArtifact")}
                          </span>
                        ) : (
                          // Described from the counts rather than from the
                          // label the document stores: that label is written in
                          // English by the backend, and echoing it would put
                          // English into a Chinese session. Each count is an
                          // item of its own, never a dot-joined string.
                          artifacts.map((artifact) => (
                            <span key={artifact.id} className="project-artifact" data-project-artifact={artifact.id}>
                              {artifact.kind === "fileFactsV1" ? (
                                <span>
                                  {t("projectArtifactMembers", { count: artifact.observedMemberCount })}
                                </span>
                              ) : artifact.targetedMs1 ? (
                                <>
                                  {/* In the report's own outcome words, and
                                      only those that occurred: a count that
                                      left the rest unnamed would read a
                                      failure as an absence. */}
                                  {outcomeCounts(artifact.targetedMs1.result.summary).map(
                                    ([outcome, count]) => (
                                      <span key={outcome}>
                                        {t("projectArtifactTargetedOutcome", {
                                          count,
                                          outcome: t(OUTCOME_KEYS[outcome]),
                                        })}
                                      </span>
                                    ),
                                  )}
                                  {/* A stored result the project found missing
                                      or damaged says so before it is opened,
                                      in the report's own words. What the
                                      project last looked at, not a later read. */}
                                  {artifact.targetedMs1.availability === "available" ? null : (
                                    <span
                                      className="project-artifact-unavailable"
                                      data-project-artifact-availability={artifact.targetedMs1.availability}
                                    >
                                      {t(PAYLOAD_STATE_KEYS[artifact.targetedMs1.availability])}
                                    </span>
                                  )}
                                </>
                              ) : null}
                            </span>
                          ))
                        )}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      ) : (
        // The one disclosure a project needs, said before one is created: it
        // records file names, locations and content digests.
        <p className="project-empty">{t("projectNoneHint")}</p>
      )}
    </div>
  );
}
