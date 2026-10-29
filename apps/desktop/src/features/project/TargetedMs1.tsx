/**
 * The targeted MS1 recipe on the Project surface.
 *
 * Three pieces, each a thin reader of what Rust decides:
 *
 * The setup sends the text the user typed and nothing else. Rust parses every
 * value, mints the target identifiers and answers a plan to review or every
 * problem it found; the page never decides whether a formula or a window is
 * valid, so it cannot disagree with the plan that runs.
 *
 * The report reads one stored result through bounded reads -- a page of rows,
 * then one target's evidence when a row is chosen. The plot draws the points
 * the engine extracted and the bounds it reported, and nothing it did not:
 * no smoothing, no fitted curve, no interpolated line between gaps.
 *
 * The facts say what an attempt established, each at the strength it was
 * learned: digests MSCanvas measured, versions the engine reported about
 * itself, and a stop's facts separately from why it was asked for.
 *
 * Outcomes are words. A symbol travels with each one, never alone, and an
 * absence is only ever the engine's positive report of one -- a failure is its
 * own word and is never drawn as an absence.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";

import { Button, Disclosure, Icon } from "../../components/ui";
import {
  toPreviewError,
  type ExportedFigure,
  type FigureSettings,
  type PreviewError,
} from "../mzml-preview/contracts";
import { dpiProblemId, FigureSettingsFields, renderProblemId } from "../mzml-preview/FigureSettingsFields";
import { validateFigureDraft, wholeCount } from "../mzml-preview/figureSettingsValidation";
import { formatCount, formatIntensity, formatMz } from "../mzml-preview/format";
import { ownedErrorDetail } from "../mzml-preview/ownedErrorMessages";
import type { FigureSettingsDraft } from "../mzml-preview/usePreviewWorkspace";
import type { UiMessage } from "../preferences/i18n";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import {
  useProjectApi,
  type BatchMemberProgress,
  type BatchMemberState,
  type BatchResolution,
  type EngineIdentity,
  type EvidenceTrace,
  type FailureCode,
  type FailureStage,
  type PayloadAvailability,
  type PayloadRow,
  type PlanProblem,
  type PlanRequest,
  type PlanResolution,
  type TargetDefinition,
  type ProjectArtifact,
  type RowFailure,
  type RowOutcome,
  type TargetEvidence,
  type TargetedFigure,
  type TargetedMs1Plan,
  type TargetedNewRuns,
  type TargetedTableFormat,
} from "./projectApi";
import type { TargetedLineage } from "./lineage";
import type { ProjectSession } from "./useProject";

export const OUTCOME_KEYS = {
  DETECTED: "targetedOutcomeDetected",
  DETECTED_AMBIGUOUS: "targetedOutcomeDetectedAmbiguous",
  SHARED: "targetedOutcomeShared",
  SUPPRESSED_BY_OVERLAP: "targetedOutcomeSuppressed",
  NOT_DETECTED: "targetedOutcomeNotDetected",
  FAILED: "targetedOutcomeFailed",
} as const satisfies Record<RowOutcome, string>;

/** A shape per outcome, beside its word and never instead of it. */
const OUTCOME_SYMBOLS: Record<RowOutcome, string> = {
  DETECTED: "●",
  DETECTED_AMBIGUOUS: "◐",
  SHARED: "◑",
  SUPPRESSED_BY_OVERLAP: "◌",
  NOT_DETECTED: "○",
  FAILED: "✕",
};

const ROW_FAILURE_KEYS = {
  EXTRACTION_AT_SPECTRUM_EDGE: "targetedRowFailureEdge",
  RELATED_TARGET_AT_SPECTRUM_EDGE: "targetedRowFailureRelatedEdge",
  CANDIDATES_WITHOUT_FEATURE: "targetedRowFailureCandidatesWithoutFeature",
  ENGINE_DISCARDED_NO_VALID_FIT: "targetedRowFailureNoValidFit",
  TARGET_ABSENT_FROM_ENGINE_LIBRARY: "targetedRowFailureAbsentFromLibrary",
  TARGET_UNACCOUNTED: "targetedRowFailureUnaccounted",
  WINDOW_WITHOUT_MS1_PEAKS: "targetedRowFailureWindowWithoutMs1",
} as const satisfies Record<RowFailure, string>;

export const FAILURE_KEYS = {
  sourceUnavailable: "targetedFailureSourceUnavailable",
  sourceChanged: "targetedFailureSourceChanged",
  sourceChangedDuringRead: "targetedFailureSourceChangedDuringRead",
  sourceUnreadable: "targetedFailureSourceUnreadable",
  sourceReadIncomplete: "targetedFailureSourceReadIncomplete",
  sourceNoMs1: "targetedFailureSourceNoMs1",
  sourceNotCentroid: "targetedFailureSourceNotCentroid",
  sourceMixedPolarity: "targetedFailureSourceMixedPolarity",
  sourcePolarityUnsupported: "targetedFailureSourcePolarityUnsupported",
  sourceRtUndeclaredOrNonmonotonic: "targetedFailureSourceRtNonmonotonic",
  sourceRtNotStrictlyIncreasing: "targetedFailureSourceRtRepeated",
  sourceIonMobilityUnsupported: "targetedFailureSourceIonMobility",
  sourceUnsortedMz: "targetedFailureSourceUnsortedMz",
  sourceNonfinite: "targetedFailureSourceNonfinite",
  executionViewUnavailable: "targetedFailureExecutionView",
  insufficientWorkAreaSpace: "targetedFailureInsufficientWorkAreaSpace",
  runtimeUnverified: "targetedFailureRuntimeUnverified",
  runtimeModuleMismatch: "targetedFailureRuntimeModuleMismatch",
  workerLaunchFailed: "targetedFailureWorkerLaunch",
  workerNotAccountedFor: "targetedFailureWorkerNotAccountedFor",
  requestRefused: "targetedFailureRequestRefused",
  targetInvalid: "targetedFailureTargetInvalid",
  engineError: "targetedFailureEngineError",
  engineNoCandidates: "targetedFailureEngineNoCandidates",
  evidenceMappingMismatch: "targetedFailureEvidenceMapping",
  workerTimeout: "targetedFailureWorkerTimeout",
  workerExitedAbnormally: "targetedFailureWorkerExited",
  workerInternal: "targetedFailureWorkerInternal",
  resultInvalid: "targetedFailureResultInvalid",
  payloadNotPublished: "targetedFailurePayloadNotPublished",
} as const satisfies Record<FailureCode, string>;

export const STAGE_KEYS = {
  source: "targetedStageSource",
  runtime: "targetedStageRuntime",
  request: "targetedStageRequest",
  engine: "targetedStageEngine",
  result: "targetedStageResult",
  publish: "targetedStagePublish",
} as const satisfies Record<FailureStage, string>;

const PHASE_KEYS = {
  preparing: "targetedPhasePreparing",
  verifyingRuntime: "targetedPhaseVerifyingRuntime",
  pinningSource: "targetedPhasePinningSource",
  preparingInput: "targetedPhasePreparingInput",
  loadingSource: "targetedPhaseLoadingSource",
  checkingSource: "targetedPhaseCheckingSource",
  runningEngine: "targetedPhaseRunningEngine",
  collecting: "targetedPhaseCollecting",
  validating: "targetedPhaseValidating",
  publishing: "targetedPhasePublishing",
} as const;

const FIELD_KEYS = {
  targets: "targetedFieldTargets",
  label: "targetedFieldLabel",
  formula: "targetedFieldFormula",
  neutralMass: "targetedFieldNeutralMass",
  rtS: "targetedFieldRt",
  rtHalfWidthS: "targetedFieldRtHalfWidth",
  mzHalfWidthPpm: "targetedFieldMzHalfWidth",
  expectedPeakWidthS: "targetedFieldPeakWidth",
} as const;

const PROBLEM_KEYS = {
  required: "targetedProblemRequired",
  invalid: "targetedProblemInvalid",
  outOfRange: "targetedProblemOutOfRange",
  duplicate: "targetedProblemDuplicate",
  tooMany: "targetedProblemTooMany",
} as const;

export const AVAILABILITY_KEYS = {
  available: "targetedAvailable",
  payloadMissing: "targetedPayloadMissing",
  payloadCorrupt: "targetedPayloadCorrupt",
} as const satisfies Record<PayloadAvailability, string>;

function keyed<T extends Record<string, string>>(keys: T, id: string, fallback: T[keyof T]) {
  return id in keys ? keys[id as keyof T] : fallback;
}

/** The phase sentence for a stable phase identifier, or `null` for none yet. */
export function phaseKey(phase: string | null) {
  return phase === null ? null : keyed(PHASE_KEYS, phase, PHASE_KEYS.preparing);
}

/**
 * Brings a section that appeared at the top of the project surface into view,
 * moving only that surface's own scroll position -- the rule `QcReport` gives
 * for why `scrollIntoView` is not used.
 */
function bringIntoView(element: HTMLElement | null) {
  const container = element?.closest<HTMLElement>(".workbench-project") ?? null;
  if (element === null || container === null) return;
  const top = element.getBoundingClientRect().top;
  const bounds = container.getBoundingClientRect();
  if (top < bounds.top || top > bounds.bottom - 48) {
    container.scrollTop += top - bounds.top;
  }
}

/**
 * Brings a chosen row and the evidence drawn for it on screen together: the
 * row always, and `evidence` as far as the row allows. Only the project
 * surface's own position moves -- never the row table's -- and nothing moves
 * when both are already in view. Instant, as every scroll here is.
 */
function revealBeside(row: HTMLElement, evidence: HTMLElement) {
  const container = row.closest<HTMLElement>(".workbench-project");
  if (container === null) return;
  const bounds = container.getBoundingClientRect();
  const top = Math.max(bounds.top, 0);
  const bottom = Math.min(bounds.bottom, window.innerHeight);
  const rowTop = row.getBoundingClientRect().top;
  const end = evidence.getBoundingClientRect().bottom;
  // Measured against what the reader actually sees: both in view, nothing moves.
  if (rowTop >= top && end <= bottom) return;
  // The row first, up to the top edge; then the evidence, as far as the row
  // allows, with a little air beneath it.
  const move = rowTop < top ? rowTop - top : Math.min(end - (bottom - 8), rowTop - top);
  if (Math.abs(move) >= 1) container.scrollTop += move;
}

/** Seconds as recorded, without inventing precision. */
function seconds(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/**
 * The typed target text, split into what Rust is asked about.
 *
 * One target per line, cells separated by tabs where the line has any and by
 * commas otherwise: label, formula, retention time (s), half-width (s), and an
 * optional neutral mass. Blank lines and lines starting with `#` are skipped.
 * No value is judged here. `lines` keeps each target's line number so a
 * problem Rust reports by row is shown where the user typed it, and a line
 * with more cells than there are columns is named rather than truncated.
 */
export function parseTargets(text: string): {
  readonly targets: PlanRequest["targets"];
  readonly lines: readonly number[];
  readonly overfull: number | null;
} {
  const targets: PlanRequest["targets"][number][] = [];
  const lines: number[] = [];
  let overfull: number | null = null;
  text.split(/\r?\n/u).forEach((raw, index) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) return;
    const cells = (line.includes("\t") ? line.split("\t") : line.split(",")).map((cell) =>
      cell.trim(),
    );
    if (cells.length > 5 && overfull === null) overfull = index + 1;
    const mass = cells[4] ?? "";
    targets.push({
      label: cells[0] ?? "",
      formula: cells[1] ?? "",
      rtS: cells[2] ?? "",
      rtHalfWidthS: cells[3] ?? "",
      neutralMass: mass === "" ? null : mass,
    });
    lines.push(index + 1);
  });
  return { targets, lines, overfull };
}

/** The most acquisitions one batch names. Rust enforces it; this only says it. */
export const MAX_BATCH_MEMBERS = 16;

/** The request as typed. Held by the surface, so it outlives the setup that shows it. */
export interface TargetedDraft {
  readonly ppm: string;
  readonly width: string;
  readonly text: string;
}

/** A request with nothing typed yet, at the recipe's documented defaults. */
export const EMPTY_TARGETED_DRAFT: TargetedDraft = { ppm: "5", width: "6", text: "" };

export interface TargetedMs1SetupProps {
  readonly session: ProjectSession;
  readonly layerId: string;
  readonly sourceName: string;
  /**
   * What the user has typed, held by the surface for the open project: closing
   * the setup or opening it from another row keeps it, and a project replaced
   * under it discards it.
   */
  readonly draft: TargetedDraft;
  readonly onDraft: (draft: TargetedDraft) => void;
  /** What the project is doing, in the surface's busy line's words, or `null` while idle. */
  readonly busyText: string | null;
  readonly onClose: () => void;
  /** The sentence for one refusal identifier, as the surface words it. */
  readonly refusalText: (code: string) => string;
  /**
   * Shows the folded Details region through the header's own control; absent
   * while Details is on screen.
   */
  readonly onRevealDetails?: () => void;
}

/** What the last review answered: one plan, or one plan per chosen acquisition. */
type Review =
  | {
      readonly kind: "single";
      readonly resolution: PlanResolution;
      readonly lines: readonly number[];
    }
  | {
      readonly kind: "batch";
      readonly resolution: BatchResolution;
      readonly lines: readonly number[];
    };

export function TargetedMs1Setup({
  session,
  layerId,
  sourceName,
  draft,
  onDraft,
  busyText,
  onClose,
  refusalText,
  onRevealDetails,
}: TargetedMs1SetupProps) {
  const t = useUiMessages();
  const ids = useId();
  // Which acquisitions the request is for. The layer whose control opened the
  // setup is the one the user asked about; every other is theirs to add.
  const [chosen, setChosen] = useState<readonly string[]>([layerId]);
  const [review, setReview] = useState<Review | null>(null);
  const [overfull, setOverfull] = useState<number | null>(null);
  // Whether the request changed after a review was on screen, so Run can say
  // why it waits rather than only that it does.
  const [changed, setChanged] = useState(false);
  // How many reviews have answered here; each answer is brought into view.
  const [answered, setAnswered] = useState(0);
  // The run this setup started, and how many it has started. Its progress and
  // its ending stay beside the review they came from until another run starts
  // or the setup closes: an edit withdraws a review, never an ending, and a
  // member that never started exists nowhere else.
  const [started, setStarted] = useState<"single" | "batch" | null>(null);
  const [runs, setRuns] = useState(0);
  // A result asked for by Open result, given the keyboard once it is on screen.
  const [opening, setOpening] = useState<string | null>(null);
  const working = session.busy !== "idle";
  const analysing = session.busy === "analysing";
  // The run this setup started is what holds its controls while it is out.
  const following = analysing && started !== null;
  const heading = useRef<HTMLHeadingElement | null>(null);
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const reviewArea = useRef<HTMLElement | null>(null);
  const reviewHeading = useRef<HTMLHeadingElement | null>(null);

  // A refusal of a review or a run. Only this setup asks for either, so one is
  // always its own to say beside what was refused.
  const refusal =
    session.problem !== null &&
    (session.problemDuring === "reviewing" || session.problemDuring === "analysing")
      ? { code: session.problem, during: session.problemDuring }
      : null;
  const refusedAtOpen = useRef(refusal !== null);

  // Opened by a control in a layer row, and it appears above the lists: the
  // keyboard follows to what the press made, and the surface scrolls to it. A
  // refusal still on screen answered an earlier setup, not this one.
  useEffect(() => {
    bringIntoView(heading.current);
    heading.current?.focus({ preventScroll: true });
    if (refusedAtOpen.current) session.dismissProblem();
  }, []);

  // A review answers below Review plan: the surface scrolls to it, and the
  // keyboard follows from the press to the answer's heading.
  useEffect(() => {
    if (answered === 0) return;
    bringIntoView(reviewArea.current);
    if (document.activeElement?.hasAttribute("data-targeted-review") === true) {
      reviewHeading.current?.focus({ preventScroll: true });
    }
  }, [answered]);

  // A run refused before it existed takes away the block its press made, with
  // the keyboard on it: the refusal, said beside Run, has it instead. Looked
  // at once the operation has settled, since the block goes only then -- the
  // refusal arrives before the project is read again.
  const runRefused =
    !analysing && session.problem !== null && session.problemDuring === "analysing";
  useEffect(() => {
    if (!runRefused) return;
    const active = document.activeElement;
    if (active === null || active === document.body) {
      document.getElementById(`${ids}-run-refused`)?.focus({ preventScroll: true });
    }
  }, [runRefused, ids]);

  // Open result: the result's report takes the keyboard once it is on screen,
  // and is brought into view even where it was already shown.
  useEffect(() => {
    if (opening === null) return;
    const report = document.querySelector<HTMLElement>(`[data-targeted-report="${opening}"]`);
    if (report === null) return;
    setOpening(null);
    bringIntoView(report);
    report.querySelector<HTMLElement>("h3")?.focus({ preventScroll: true });
  }, [opening, session.inspecting]);

  const layers = session.state.layers.map((layer) => ({
    id: layer.id,
    name:
      session.state.inputs.find((input) => input.id === layer.sourceInputId)?.label ??
      t("provenanceRelatedGone"),
  }));
  const nameOf = (id: string) =>
    layers.find((layer) => layer.id === id)?.name ?? t("provenanceRelatedGone");
  // In the project's own layer order, whatever order they were ticked in: the
  // order a batch runs in is one the user can read off the list.
  const members = layers.filter((layer) => chosen.includes(layer.id)).map((layer) => layer.id);

  // Any edit makes the plan on screen a plan for other text or other
  // acquisitions, so it goes, with the refusal of the request before it. The
  // inputs are held while anything is out, so a review cannot answer for a
  // request that changed while it was being asked.
  const forget = () => {
    if (review !== null) setChanged(true);
    setReview(null);
    setOverfull(null);
    if (refusal !== null) session.dismissProblem();
  };
  const edit = (field: keyof TargetedDraft) => (value: string) => {
    onDraft({ ...draft, [field]: value });
    forget();
  };
  const toggle = (id: string) => {
    setChosen((current) =>
      current.includes(id) ? current.filter((each) => each !== id) : [...current, id],
    );
    forget();
  };

  // Why Review plan cannot be pressed: nothing to review, or (said by the
  // status line) something already out.
  const reviewReason = working
    ? null
    : members.length === 0
      ? ("targetedReviewNeedsAcquisition" as const)
      : draft.text.trim() === ""
        ? ("targetedReviewNeedsTargets" as const)
        : null;
  const reviewRefused = working || reviewReason !== null;

  const onReview = async () => {
    const [only] = members;
    if (reviewRefused || only === undefined) return;
    setChanged(false);
    const parsed = parseTargets(draft.text);
    if (parsed.overfull !== null) {
      setOverfull(parsed.overfull);
      setReview(null);
      setAnswered((count) => count + 1);
      return;
    }
    setOverfull(null);
    const request = {
      mzHalfWidthPpm: draft.ppm,
      expectedPeakWidthS: draft.width,
      targets: parsed.targets,
    };
    if (members.length === 1) {
      const resolution = await session.reviewTargetedMs1({ layerId: only, ...request });
      setReview(resolution === null ? null : { kind: "single", resolution, lines: parsed.lines });
    } else {
      const resolution = await session.reviewTargetedMs1Batch({ layerIds: members, ...request });
      setReview(resolution === null ? null : { kind: "batch", resolution, lines: parsed.lines });
    }
    setAnswered((count) => count + 1);
  };

  const plan = review?.kind === "single" ? review.resolution.plan : null;
  const blocked = review?.kind === "single" ? review.resolution.blocked : null;
  const batch = review?.kind === "batch" ? review.resolution : null;
  const runnable = batch !== null ? batchRunnable(batch) : plan !== null && blocked === null;

  // What the last run this setup started left, as the session answered it.
  const lastEnd = started === "single" && !analysing ? session.lastTargetedRun : null;
  const lastRecord =
    lastEnd === null ? undefined : session.state.runs.find((run) => run.id === lastEnd.runId);
  const endedBatch = started === "batch" && !analysing ? session.lastTargetedBatch : null;
  // Whether Run would run again what already ran from here: a new run of the
  // same reviewed plans, never a continuation of the last.
  const again =
    (plan !== null && lastRecord?.targetedMs1?.planSha256 === plan.planSha256) ||
    (batch !== null &&
      endedBatch !== null &&
      endedBatch.length === batch.members.length &&
      endedBatch.every((member, index) => member.planSha256 === batch.members[index]?.planSha256));

  const count = members.length;
  const runLabel = again
    ? count >= 2
      ? t("targetedRunBatchAgain", { count })
      : t("targetedRunAgain")
    : count >= 2
      ? t("targetedRunBatch", { count })
      : t("targetedRun");
  // Why Run cannot act on the request on screen. A blocked plan says why in
  // its own sentence, just above Run.
  const runReason =
    working || runnable
      ? null
      : review === null
        ? changed
          ? ("targetedRunChanged" as const)
          : ("targetedRunNeedsReview" as const)
        : batch !== null
          ? batch.problems.length > 0 || batch.members.length === 0
            ? ("targetedRunFixProblems" as const)
            : ("targetedBatchNotReady" as const)
          : plan === null
            ? ("targetedRunFixProblems" as const)
            : null;
  const statusId = `${ids}-status`;
  const runTitleId = `${ids}-run-title`;
  const blockedId = `${ids}-blocked`;
  // While something is out, what holds a control is what is out.
  const heldBy = following ? runTitleId : statusId;

  const onRun = () => {
    if (working || !runnable) return;
    setRuns((each) => each + 1);
    if (batch !== null) {
      setStarted("batch");
      void session.runTargetedMs1Batch(batch.members.map((member) => member.planSha256 ?? ""));
    } else if (plan !== null) {
      setStarted("single");
      void session.runTargetedMs1(plan.planSha256);
    }
  };

  // The batch this setup ran: as Rust reports it while it runs -- every member
  // queued until the first report arrives -- and as it ended.
  const queued: readonly BatchMemberProgress[] | null =
    batch === null
      ? null
      : batch.members.map((member) => ({
          layerId: member.layerId,
          planSha256: member.planSha256 ?? "",
          state: "queued",
          runId: null,
          artifactId: null,
          reason: null,
        }));
  const progress =
    started !== "batch"
      ? null
      : analysing
        ? (session.analysisBatch ?? queued)
        : session.lastTargetedBatch;

  // A problem's line leads back to it: the keyboard goes into the targets,
  // with that line selected.
  const goToLine = (line: number) => {
    const element = textarea.current;
    if (element === null) return;
    const typed = element.value.split("\n");
    const start = typed.slice(0, line - 1).reduce((sum, each) => sum + each.length + 1, 0);
    element.focus();
    element.setSelectionRange(start, start + (typed[line - 1]?.length ?? 0));
  };
  const openResult = (artifactId: string) => {
    session.inspect({ kind: "artifact", id: artifactId });
    setOpening(artifactId);
  };
  const showRun = (runId: string) => session.inspect({ kind: "run", id: runId });
  const inspectedRun = session.inspecting?.kind === "run" ? session.inspecting.id : null;

  const [only] = members;
  const reviewRefusal = refusal?.during === "reviewing" ? refusal.code : null;
  const runRefusal = refusal?.during === "analysing" ? refusal.code : null;
  const runRefusalId = `${ids}-run-refused`;

  return (
    <section
      className="project-section targeted-setup"
      aria-labelledby={`${ids}-title`}
      data-targeted-setup={layerId}
    >
      <div className="project-section-head">
        <h3 ref={heading} id={`${ids}-title`} tabIndex={-1}>
          {t("targetedSetupTitle")}
        </h3>
        <Button
          variant="secondary"
          size="sm"
          refused={analysing}
          aria-describedby={analysing ? heldBy : undefined}
          data-targeted-close=""
          onClick={onClose}
        >
          {t("targetedSetupClose")}
        </Button>
      </div>
      <p className="qc-report-of" data-targeted-chosen={members.length}>
        {members.length === 1 && only !== undefined
          ? only === layerId
            ? sourceName
            : nameOf(only)
          : t("targetedAcquisitionsCount", { count: members.length, max: MAX_BATCH_MEMBERS })}
      </p>
      <p className="targeted-experimental" data-targeted-experimental="">
        {t("targetedExperimental")}
      </p>
      <p className="project-note">{t("targetedDomain")}</p>

      <fieldset className="targeted-members" data-targeted-members="">
        <legend>{t("targetedAcquisitions")}</legend>
        <p className="project-note">{t("targetedAcquisitionsHelp")}</p>
        <ul className="targeted-member-list">
          {layers.map((layer) => (
            <li key={layer.id}>
              <label>
                <input
                  type="checkbox"
                  checked={chosen.includes(layer.id)}
                  disabled={working}
                  data-targeted-member={layer.id}
                  onChange={() => toggle(layer.id)}
                />
                <span>{layer.name}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      <div className="targeted-parameters">
        <label>
          <span>{t("targetedFieldMzHalfWidth")}</span>
          <input
            type="text"
            inputMode="decimal"
            value={draft.ppm}
            disabled={working}
            data-targeted-ppm=""
            onChange={(event) => edit("ppm")(event.target.value)}
          />
        </label>
        <label>
          <span>{t("targetedFieldPeakWidth")}</span>
          <input
            type="text"
            inputMode="decimal"
            value={draft.width}
            disabled={working}
            data-targeted-width=""
            onChange={(event) => edit("width")(event.target.value)}
          />
        </label>
      </div>
      <label className="targeted-targets">
        <span>{t("targetedFieldTargets")}</span>
        <textarea
          ref={textarea}
          rows={6}
          value={draft.text}
          disabled={working}
          spellCheck={false}
          aria-describedby={`${ids}-format`}
          placeholder={t("targetedTargetsPlaceholder")}
          data-targeted-text=""
          onChange={(event) => edit("text")(event.target.value)}
        />
      </label>
      <p id={`${ids}-format`} className="project-note">
        {t("targetedTargetsFormat")}
      </p>

      <div className="project-actions">
        <Button
          variant="secondary"
          size="sm"
          refused={reviewRefused}
          aria-describedby={
            working ? heldBy : reviewReason === null ? undefined : `${ids}-review-reason`
          }
          data-targeted-review=""
          onClick={() => void onReview()}
        >
          {t("targetedReview")}
        </Button>
      </div>
      {/* Beside the controls it holds: the surface's own busy line may be
          scrolled out of sight. While this setup's run is out, its block
          below says so instead. */}
      {working && !following ? (
        <p id={statusId} className="project-note" data-targeted-status={session.busy}>
          {busyText}
        </p>
      ) : reviewReason === null ? null : (
        <p
          id={`${ids}-review-reason`}
          className="project-note"
          data-targeted-review-reason={reviewReason}
        >
          {t(reviewReason)}
        </p>
      )}

      {/* The review leads to Run: what will run, or what stops it, is read
          before the control that runs it. */}
      {overfull === null && reviewRefusal === null && review === null ? null : (
        <section
          ref={reviewArea}
          className="targeted-review-area"
          aria-labelledby={`${ids}-review-title`}
          data-targeted-review-area=""
        >
          <h4 ref={reviewHeading} id={`${ids}-review-title`} tabIndex={-1}>
            {t("targetedReviewTitle")}
          </h4>
          {overfull === null ? null : (
            <p className="project-problem" data-targeted-overfull={overfull}>
              {t("targetedLineOverfull", { line: String(overfull) })}
            </p>
          )}
          {reviewRefusal === null ? null : (
            <p className="project-problem" data-targeted-review-refused={reviewRefusal}>
              {refusalText(reviewRefusal)}
            </p>
          )}
          {review === null ? null : review.kind === "single" ? (
            <PlanReview
              resolution={review.resolution}
              lines={review.lines}
              nameOf={nameOf}
              blockedId={blockedId}
              onLine={goToLine}
              refusalText={refusalText}
            />
          ) : (
            <BatchReview
              resolution={review.resolution}
              lines={review.lines}
              nameOf={nameOf}
              onLine={goToLine}
              refusalText={refusalText}
            />
          )}
        </section>
      )}

      <div className="project-actions">
        <Button
          variant={again ? "secondary" : "primary"}
          size="sm"
          icon={<Icon name="play" />}
          refused={working || !runnable}
          aria-describedby={
            working
              ? heldBy
              : runRefusal !== null
                ? runRefusalId
                : runReason !== null
                  ? `${ids}-run-reason`
                  : !runnable && blocked !== null
                    ? blockedId
                    : again
                      ? `${ids}-run-again`
                      : undefined
          }
          data-targeted-run={batch === null ? "" : "batch"}
          onClick={onRun}
        >
          {runLabel}
        </Button>
      </div>
      {/* Said, not only hovered: a refused primary is still a Tab stop, and its
          reason has to reach a reader who arrives there (PM9 UI-24). */}
      {runReason === null ? null : (
        <p id={`${ids}-run-reason`} className="project-note" data-targeted-run-reason={runReason}>
          {t(runReason)}
        </p>
      )}
      {again && !working ? (
        <p id={`${ids}-run-again`} className="project-note" data-targeted-run-again="">
          {t(count >= 2 ? "targetedRunBatchAgainNote" : "targetedRunAgainNote")}
        </p>
      ) : null}
      {runRefusal === null ? null : (
        <p
          id={runRefusalId}
          className="project-problem"
          tabIndex={-1}
          data-targeted-run-refused={runRefusal}
        >
          {refusalText(runRefusal)}
        </p>
      )}

      {/* An ending only while its run is in the project: what it says is
          about that record. */}
      {started === "single" && (analysing || (lastEnd !== null && lastRecord !== undefined)) ? (
        <RunBlock
          key={runs}
          headingId={runTitleId}
          running={analysing}
          phase={session.analysisPhase}
          end={lastEnd}
          // One filled primary: a new request ready to run takes it from the
          // last run's result.
          openPrimary={working || !runnable || again}
          failure={lastRecord?.targetedMs1?.failure ?? null}
          canStop={session.activeOperation !== null}
          stopRequested={session.stopRequested}
          onStop={() => void session.cancelJob()}
          onOpen={openResult}
          onShowRun={showRun}
          inspectedRun={inspectedRun}
          onRevealDetails={onRevealDetails}
        />
      ) : null}

      {progress === null ? null : (
        <BatchProgress
          key={runs}
          headingId={runTitleId}
          members={progress}
          running={analysing}
          canStop={session.activeOperation !== null}
          stopRequested={session.stopRequested}
          phase={session.analysisPhase}
          runs={session.state.runs}
          nameOf={nameOf}
          refusalText={refusalText}
          onStop={() => void session.cancelJob()}
          onOpen={openResult}
          onShowRun={showRun}
          inspectedRun={inspectedRun}
          onRevealDetails={onRevealDetails}
        />
      )}
    </section>
  );
}

/**
 * Where Show run's answer went while Details is folded: beside the press, the
 * header's own toggle. Nothing unfolds and the keyboard stays on the press
 * until the reader asks.
 */
function DetailsHint({ onReveal }: { readonly onReveal: () => void }) {
  const t = useUiMessages();
  return (
    <div className="project-inspect-hint" data-targeted-details-hint="">
      <Button variant="secondary" size="sm" icon={<Icon name="panelRight" />} onClick={onReveal}>
        {t("provenanceShowDetails")}
      </Button>
    </div>
  );
}

/**
 * Hands the keyboard to a block's heading when the control it was on leaves
 * with the work that offered it: never to the page.
 */
function useFocusKeptOnEnd(
  running: boolean,
  section: RefObject<HTMLElement | null>,
  heading: RefObject<HTMLHeadingElement | null>,
) {
  useEffect(() => {
    if (running) return;
    const active = document.activeElement;
    if (active === null || active === document.body || section.current?.contains(active) === true) {
      heading.current?.focus({ preventScroll: true });
    }
  }, [running]);
}

/**
 * One run this setup started: where it is while it runs, and how it ended,
 * with the run or result it left. Its phase is the engine's own; nothing here
 * is a percentage or a time.
 */
function RunBlock({
  headingId,
  running,
  phase,
  end,
  openPrimary,
  failure,
  canStop,
  stopRequested,
  onStop,
  onOpen,
  onShowRun,
  inspectedRun,
  onRevealDetails,
}: {
  readonly headingId: string;
  readonly running: boolean;
  readonly phase: string | null;
  readonly end: ProjectSession["lastTargetedRun"];
  /** Whether Open result is the state's one filled primary. */
  readonly openPrimary: boolean;
  readonly failure: { readonly code: FailureCode } | null;
  /** Whether there is an accepted operation to name, so a cancel can send something. */
  readonly canStop: boolean;
  readonly stopRequested: boolean;
  readonly onStop: () => void;
  readonly onOpen: (artifactId: string) => void;
  readonly onShowRun: (runId: string) => void;
  /** The run Details is inspecting, if it is one. */
  readonly inspectedRun: string | null;
  /** Shows the folded Details region; absent while Details is on screen. */
  readonly onRevealDetails: (() => void) | undefined;
}) {
  const t = useUiMessages();
  const section = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  // Appears when Run is pressed, below it: the surface scrolls to it, and the
  // keyboard follows from Run -- now inert -- to what the press made.
  useEffect(() => {
    bringIntoView(section.current);
    if (document.activeElement?.hasAttribute("data-targeted-run") === true) {
      heading.current?.focus({ preventScroll: true });
    }
  }, []);
  useFocusKeptOnEnd(running, section, heading);
  const artifactId = end?.outcome === "completed" ? end.artifactId : null;
  return (
    <section
      ref={section}
      className="targeted-run"
      aria-labelledby={headingId}
      data-targeted-run-block={running ? "running" : (end?.outcome ?? "")}
    >
      <h4 ref={heading} id={headingId} tabIndex={-1}>
        {t(running ? "targetedRunInProgressTitle" : "targetedRunEndedTitle")}
      </h4>
      {running ? (
        <>
          <p className="project-note" data-targeted-phase={phase ?? ""}>
            {t(phaseKey(phase) ?? "targetedPhasePreparing")}
          </p>
          {canStop ? (
            <div className="project-actions">
              <Button
                variant="secondary"
                size="sm"
                refused={stopRequested}
                data-targeted-cancel-run=""
                onClick={onStop}
              >
                {t(stopRequested ? "targetedStopRequested" : "targetedCancelRun")}
              </Button>
              <span className="project-note">{t("targetedCancelRunHelp")}</span>
            </div>
          ) : null}
        </>
      ) : end === null ? null : (
        <>
          <p className="project-note" data-targeted-last={end.outcome}>
            {end.outcome === "completed"
              ? t("targetedLastCompleted")
              : end.outcome === "cancelled"
                ? t("targetedLastCancelled")
                : failure === null
                  ? t("targetedLastFailed")
                  : t("sentencePair", { first: t("targetedLastFailed"), second: t(FAILURE_KEYS[failure.code]) })}
          </p>
          <div className="project-actions">
            {artifactId !== null ? (
              <Button
                variant={openPrimary ? "primary" : "secondary"}
                size="sm"
                data-targeted-open-result={artifactId}
                onClick={() => onOpen(artifactId)}
              >
                {t("targetedBatchOpenResult")}
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                data-targeted-show-run={end.runId}
                onClick={() => onShowRun(end.runId)}
              >
                {t("targetedBatchShowRun")}
              </Button>
            )}
          </div>
          {artifactId === null && inspectedRun === end.runId && onRevealDetails !== undefined ? (
            <DetailsHint onReveal={onRevealDetails} />
          ) : null}
        </>
      )}
    </section>
  );
}

/** The engine and its whole fixed profile, as the build fixes them. */
function EngineFacts({ engine }: { readonly engine: EngineIdentity }) {
  const t = useUiMessages();
  return (
    <>
      <p className="project-note" data-targeted-engine="">
        {t("targetedEngine", {
          engine: `${engine.package} ${engine.version} · ${engine.algorithm} · ${engine.revision}`,
        })}
      </p>
      {/* The whole profile the engine runs with, as the build fixes it: no
          value in it is the user's to change in this recipe. Only the review
          has it -- a stored plan keeps its digest -- so it stays here. */}
      <div className="targeted-disclosure">
        <Disclosure
          label={t("targetedEngineProfile")}
          regionProps={{ "data-targeted-profile": "" }}
        >
          <pre className="targeted-profile">{engine.fixedProfile}</pre>
        </Disclosure>
      </div>
    </>
  );
}

/**
 * Every problem with the typed request, where it was typed. A target's line
 * leads back to it; the list scrolls inside the review however long it is.
 */
function ProblemsTable({
  problems,
  lines,
  onLine,
}: {
  readonly problems: readonly PlanProblem[];
  readonly lines: readonly number[];
  readonly onLine: (line: number) => void;
}) {
  const t = useUiMessages();
  return (
    <div className="targeted-review-scroll">
      <table className="qc-report-table" data-targeted-problems="">
        <caption>{t("targetedProblems")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("targetedProblemWhere")}</th>
            <th scope="col">{t("targetedProblemField")}</th>
            <th scope="col">{t("targetedProblemWhat")}</th>
          </tr>
        </thead>
        <tbody>
          {problems.map((problem, index) => {
            const line = problem.row === null ? null : (lines[problem.row - 1] ?? problem.row);
            return (
              <tr key={index} data-targeted-problem={problem.problem}>
                <th scope="row">
                  {line === null ? (
                    t("targetedWhereParameters")
                  ) : (
                    <Button
                      variant="quiet"
                      size="sm"
                      aria-label={t("targetedGoToLine", { line: String(line) })}
                      data-targeted-problem-line={line}
                      onClick={() => onLine(line)}
                    >
                      {t("targetedWhereLine", { line: String(line) })}
                    </Button>
                  )}
                </th>
                <td>{t(keyed(FIELD_KEYS, problem.field, FIELD_KEYS.targets))}</td>
                <td>{t(keyed(PROBLEM_KEYS, problem.problem, PROBLEM_KEYS.invalid))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The ordered targets and the two parameters, as Rust resolved them. Two
 * hundred targets scroll inside the review, never pushing Run out of reach.
 */
function TargetsTable({
  parameters,
  targets,
  tableProps,
}: {
  readonly parameters: TargetedMs1Plan["parameters"];
  readonly targets: readonly TargetDefinition[];
  /** The table's own data attributes. */
  readonly tableProps: Readonly<Record<`data-${string}`, string>>;
}) {
  const t = useUiMessages();
  return (
    <div className="targeted-review-scroll">
      <table className="qc-report-table" {...tableProps}>
        <caption>
          {t("targetedPlanCaption", {
            count: targets.length,
            ppm: parameters.mzHalfWidthPpm,
            width: parameters.expectedPeakWidthS,
          })}
        </caption>
        <thead>
          <tr>
            <th scope="col">{t("targetedFieldLabel")}</th>
            <th scope="col">{t("targetedFieldFormula")}</th>
            <th scope="col">{t("targetedFieldRt")}</th>
            <th scope="col">{t("targetedFieldRtHalfWidth")}</th>
            <th scope="col">{t("targetedFieldNeutralMass")}</th>
          </tr>
        </thead>
        <tbody>
          {targets.map((target) => (
            <tr key={target.targetId} data-targeted-plan-target={target.targetId}>
              <th scope="row">{target.label}</th>
              <td>{target.formula}</td>
              <td>{target.rtS}</td>
              <td>{target.rtHalfWidthS}</td>
              <td>{target.neutralMass ?? t("targetedMassFromFormula")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One acquisition's review: what needs fixing first; then what would run --
 * the acquisition, the ordered targets and the parameters; then the engine
 * and the plan's digest; last, what stops the plan running now, just above
 * Run.
 */
function PlanReview({
  resolution,
  lines,
  nameOf,
  blockedId,
  onLine,
  refusalText,
}: {
  readonly resolution: PlanResolution;
  readonly lines: readonly number[];
  readonly nameOf: (layerId: string) => string;
  readonly blockedId: string;
  readonly onLine: (line: number) => void;
  readonly refusalText: (code: string) => string;
}) {
  const t = useUiMessages();
  const { plan, problems, blocked, engine } = resolution;
  return (
    <div className="targeted-review" data-targeted-review-result={plan === null ? "problems" : "plan"}>
      {problems.length > 0 ? <ProblemsTable problems={problems} lines={lines} onLine={onLine} /> : null}
      {plan === null ? null : (
        <>
          <p className="project-note" data-targeted-plan-for="">
            {t("targetedPlanFor", { name: nameOf(plan.layerId) })}
          </p>
          <TargetsTable
            parameters={plan.parameters}
            targets={plan.targets}
            tableProps={{ "data-targeted-plan": plan.planSha256 }}
          />
        </>
      )}
      <EngineFacts engine={engine} />
      {plan === null ? null : (
        <p className="project-note targeted-digest">
          {t("targetedPlanDigest", { digest: plan.planSha256 })}
        </p>
      )}
      {blocked === null ? null : (
        <p id={blockedId} className="project-problem" data-targeted-blocked={blocked}>
          {refusalText(blocked)}
        </p>
      )}
    </div>
  );
}

/** Whether every member of a batch review has a plan that could run now. */
export function batchRunnable(resolution: BatchResolution) {
  return (
    resolution.problems.length === 0 &&
    resolution.members.length >= 2 &&
    resolution.members.every(
      (member) => member.planSha256 !== null && member.refused === null && member.blocked === null,
    )
  );
}

/**
 * A batch review: what needs fixing first; then the one request every member
 * shares, and every member in the order it will run, each ready or saying
 * what stops it; then the technical provenance. Nothing is pooled: each
 * member is its own plan over its own source.
 */
function BatchReview({
  resolution,
  lines,
  nameOf,
  onLine,
  refusalText,
}: {
  readonly resolution: BatchResolution;
  readonly lines: readonly number[];
  readonly nameOf: (layerId: string) => string;
  readonly onLine: (line: number) => void;
  readonly refusalText: (code: string) => string;
}) {
  const t = useUiMessages();
  const { problems, common, members, engine } = resolution;
  return (
    <div
      className="targeted-review"
      data-targeted-review-result={problems.length > 0 ? "problems" : "batch"}
    >
      {problems.length > 0 ? <ProblemsTable problems={problems} lines={lines} onLine={onLine} /> : null}
      {common === null ? null : (
        <TargetsTable
          parameters={common.parameters}
          targets={common.targets}
          tableProps={{ "data-targeted-batch-targets": common.targetListSha256 }}
        />
      )}
      {members.length === 0 ? null : (
        <>
          <p className="targeted-independent" data-targeted-batch-independent="">
            {t("targetedBatchIndependent", { count: members.length })}
          </p>
          <div className="targeted-review-scroll">
            <table className="qc-report-table" data-targeted-batch-members={members.length}>
              <caption>{t("targetedBatchMembersCaption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("targetedBatchColumnOrder")}</th>
                  <th scope="col">{t("targetedBatchColumnAcquisition")}</th>
                  <th scope="col">{t("targetedBatchColumnReadiness")}</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member, index) => {
                  const stop = member.refused ?? member.blocked;
                  return (
                    <tr
                      key={member.layerId}
                      data-targeted-batch-plan={member.layerId}
                      data-ready={stop === null ? "ready" : stop}
                    >
                      <td>{index + 1}</td>
                      <th scope="row">{nameOf(member.layerId)}</th>
                      <td className={stop === null ? undefined : "targeted-not-ready"}>
                        {stop === null ? t("targetedBatchReady") : refusalText(stop)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      <EngineFacts engine={engine} />
      {common === null ? null : (
        <p className="project-note targeted-digest">
          {t("targetedTargetListDigestLine", { digest: common.targetListSha256 })}
        </p>
      )}
      {members.length === 0 ? null : (
        // Technical provenance, on request: what each member's own plan binds
        // and is named by.
        <div className="targeted-disclosure">
          <Disclosure
            label={t("targetedBatchPlanDetails")}
            regionProps={{ "data-targeted-batch-details": "" }}
          >
            <dl className="provenance-facts">
              {members.map((member) => (
                <div key={member.layerId} className="targeted-member">
                  <dt>{nameOf(member.layerId)}</dt>
                  <dd>
                    {member.planSha256 === null ? (
                      t("targetedBatchNoPlan")
                    ) : (
                      <>
                        {member.expectedContent.map((content) => (
                          <span key={content.relativeName} className="targeted-batch-fact">
                            {t("targetedSourceBytes")} {formatCount(content.byteLength)} · SHA-256{" "}
                            <span className="provenance-digest" title={content.sha256}>{content.sha256}</span>
                          </span>
                        ))}
                        <span className="targeted-batch-fact">
                          {t("targetedPlanDigestLabel")}{" "}
                          <span className="provenance-digest" title={member.planSha256}>{member.planSha256}</span>
                        </span>
                      </>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </Disclosure>
        </div>
      )}
    </div>
  );
}

const MEMBER_STATE_KEYS = {
  queued: "targetedBatchStateQueued",
  running: "targetedBatchStateRunning",
  completed: "targetedBatchStateCompleted",
  failed: "targetedBatchStateFailed",
  cancelled: "targetedBatchStateCancelled",
  refused: "targetedBatchStateRefused",
  notStarted: "targetedBatchStateNotStarted",
} as const satisfies Record<BatchMemberState, string>;

/** A shape per execution state, beside its word and never instead of it. */
const MEMBER_STATE_SYMBOLS: Record<BatchMemberState, string> = {
  queued: "○",
  running: "◔",
  completed: "✓",
  failed: "✕",
  cancelled: "■",
  refused: "–",
  notStarted: "–",
};

/**
 * How a batch's members ended, counted by execution state. Operational only:
 * no count here says anything about what any member's targets were found to be.
 */
export function batchSummary(members: readonly BatchMemberProgress[], t: UiMessage): string {
  const count = (states: readonly BatchMemberState[]) =>
    members.filter((member) => states.includes(member.state)).length;
  const failed = count(["failed"]);
  const cancelled = count(["cancelled"]);
  const notRun = count(["refused", "notStarted"]);
  return [
    t("targetedBatchCountCompleted", { count: count(["completed"]), total: members.length }),
    failed === 0 ? null : t("targetedBatchCountFailed", { count: failed }),
    cancelled === 0 ? null : t("targetedBatchCountCancelled", { count: cancelled }),
    notRun === 0 ? null : t("targetedBatchCountNotRun", { count: notRun }),
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

/**
 * A batch's members as they run and as they ended, in order.
 *
 * Execution states only. A completed member opens its own result in the
 * existing report; nothing here shows two members' results together.
 */
function BatchProgress({
  headingId,
  members,
  running,
  canStop,
  stopRequested,
  phase,
  runs,
  nameOf,
  refusalText,
  onStop,
  onOpen,
  onShowRun,
  inspectedRun,
  onRevealDetails,
}: {
  readonly headingId: string;
  readonly members: readonly BatchMemberProgress[];
  readonly running: boolean;
  /**
   * Whether there is an accepted operation to name, so a Stop can send
   * something. Not for the instant before the batch's operation is accepted.
   */
  readonly canStop: boolean;
  /** Whether a stop was asked for: said until the batch answers how it ended. */
  readonly stopRequested: boolean;
  readonly phase: string | null;
  readonly runs: ProjectSession["state"]["runs"];
  readonly nameOf: (layerId: string) => string;
  readonly refusalText: (code: string) => string;
  readonly onStop: () => void;
  readonly onOpen: (artifactId: string) => void;
  readonly onShowRun: (runId: string) => void;
  /** The run Details is inspecting, if it is one. */
  readonly inspectedRun: string | null;
  /** Shows the folded Details region; absent while Details is on screen. */
  readonly onRevealDetails: (() => void) | undefined;
}) {
  const t = useUiMessages();
  const section = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  // Appears when Run is pressed, below it: the surface scrolls to it, and the
  // keyboard follows from Run -- now inert -- to what the press made.
  useEffect(() => {
    bringIntoView(section.current);
    if (document.activeElement?.hasAttribute("data-targeted-run") === true) {
      heading.current?.focus({ preventScroll: true });
    }
  }, []);
  useFocusKeptOnEnd(running, section, heading);
  // Whether the run Details is inspecting is one a member's Show run offers.
  const shownHere =
    !running &&
    members.some(
      (member) =>
        member.runId !== null &&
        member.runId === inspectedRun &&
        !(member.state === "completed" && member.artifactId !== null),
    );
  return (
    <section
      ref={section}
      className="targeted-batch"
      aria-labelledby={headingId}
      data-targeted-batch={running ? "running" : "ended"}
    >
      <h4 ref={heading} id={headingId} tabIndex={-1}>
        {t(running ? "targetedBatchRunningTitle" : "targetedBatchEndedTitle")}
      </h4>
      <p className="project-note" data-targeted-batch-summary="">
        {batchSummary(members, t)}
      </p>
      <div className="targeted-batch-scroll">
        <table className="qc-report-table" data-targeted-batch-progress={members.length}>
          <caption>{t("targetedBatchMembersCaption")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("targetedBatchColumnOrder")}</th>
              <th scope="col">{t("targetedBatchColumnAcquisition")}</th>
              <th scope="col">{t("targetedBatchColumnStatus")}</th>
              <th scope="col">{t("targetedBatchColumnActions")}</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member, index) => {
              const name = nameOf(member.layerId);
              const failure =
                member.runId === null
                  ? null
                  : (runs.find((run) => run.id === member.runId)?.targetedMs1?.failure ?? null);
              const detail =
                member.state === "running"
                  ? t(phaseKey(phase) ?? "targetedPhasePreparing")
                  : member.state === "failed" && failure !== null
                    ? t(FAILURE_KEYS[failure.code])
                    : member.state === "refused" && member.reason !== null
                      ? refusalText(member.reason)
                      : member.state === "notStarted"
                        ? member.reason === null
                          ? t("targetedBatchStoppedBefore")
                          : refusalText(member.reason)
                        : null;
              return (
                <tr
                  key={member.layerId}
                  data-targeted-batch-member={member.layerId}
                  data-state={member.state}
                  aria-current={member.state === "running" ? "step" : undefined}
                >
                  <td>{index + 1}</td>
                  <th scope="row">{name}</th>
                  <td>
                    <span aria-hidden="true" className="targeted-symbol">
                      {MEMBER_STATE_SYMBOLS[member.state]}
                    </span>{" "}
                    {t(MEMBER_STATE_KEYS[member.state])}
                    {detail === null ? null : <span className="targeted-reason"> — {detail}</span>}
                  </td>
                  <td>
                    {/* Once the batch has ended: while it runs, the project
                        on screen is the one it started from, and holds no
                        member's run yet -- as every control but Stop waits
                        while a run is out. */}
                    {running ? null : member.state === "completed" && member.artifactId !== null ? (
                      <Button
                        variant="quiet"
                        size="sm"
                        aria-label={t("targetedBatchOpenResultNamed", { name })}
                        data-targeted-batch-open={member.artifactId}
                        onClick={() => {
                          if (member.artifactId !== null) onOpen(member.artifactId);
                        }}
                      >
                        {t("targetedBatchOpenResult")}
                      </Button>
                    ) : member.runId !== null ? (
                      <Button
                        variant="quiet"
                        size="sm"
                        aria-label={t("targetedBatchShowRunNamed", { name })}
                        data-targeted-batch-run={member.runId}
                        onClick={() => {
                          if (member.runId !== null) onShowRun(member.runId);
                        }}
                      >
                        {t("targetedBatchShowRun")}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {shownHere && onRevealDetails !== undefined ? <DetailsHint onReveal={onRevealDetails} /> : null}
      <p className="project-note">{t("targetedBatchOperationalNote")}</p>
      {running && canStop ? (
        <div className="project-actions">
          <Button
            variant="secondary"
            size="sm"
            refused={stopRequested}
            data-targeted-batch-stop=""
            onClick={onStop}
          >
            {t(stopRequested ? "targetedStopRequested" : "targetedBatchStop")}
          </Button>
          <span className="project-note">{t("targetedBatchStopHelp")}</span>
        </div>
      ) : null}
    </section>
  );
}

export interface TargetedMs1ReportProps {
  readonly artifact: ProjectArtifact;
  readonly plan: TargetedMs1Plan | null;
  readonly sourceName: string | null;
  /**
   * The original source's state as the last check left it, or `null` where the
   * project no longer references it. Said, never needed: nothing on this
   * surface reads the source.
   */
  readonly sourceState: { readonly id: string; readonly text: string } | null;
  readonly recordedWhen: string | null;
  readonly refusalText: (code: string) => string;
  /** The sentence for an output refusal: the project's own, or the shared figure boundary's. */
  readonly errorText: (error: PreviewError) => string;
  /**
   * How many runs the project records. A run that ends can change whether a
   * new one could start (a worker not confirmed ended quarantines the
   * session), so the answer is asked again when this changes.
   */
  readonly runsRecorded: number;
}

type Loaded<T> =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly value: T }
  | { readonly status: "refused"; readonly code: string };

function refusalOf(error: unknown): string {
  if (typeof error === "object" && error !== null && "kind" in error) {
    const { kind } = error as { kind?: unknown };
    if (typeof kind === "string" && kind.length > 0) return kind;
  }
  return "projectOperationFailed";
}

type NewRuns = TargetedNewRuns | "checking" | "unknown";

const NEW_RUNS_KEYS = {
  checking: "targetedNewRunsChecking",
  available: "targetedNewRunsAvailable",
  runtimeUnavailable: "targetedNewRunsRuntimeUnavailable",
  quarantined: "targetedNewRunsQuarantined",
  unknown: "targetedNewRunsUnknown",
} as const satisfies Record<NewRuns, string>;

export const PAYLOAD_STATE_KEYS = {
  available: "targetedStatePayloadWhole",
  payloadMissing: "targetedStatePayloadMissing",
  payloadCorrupt: "targetedStatePayloadCorrupt",
} as const satisfies Record<PayloadAvailability, string>;

/** A figure a reader can drop into a document as it is. */
const DEFAULT_FIGURE: FigureSettingsDraft = {
  widthPx: "1200",
  heightPx: "640",
  pngDpi: "300",
  theme: "light",
};

type Operation = "svg" | "png" | "csv" | "tsv";

/** What the figure's text alternative says is drawn, by what the row holds. */
const DRAWN_KEYS = {
  featureAndCandidates: "targetedFigureDrawnFeatureCandidates",
  feature: "targetedFigureDrawnFeature",
  candidates: "targetedFigureDrawnCandidates",
  points: "targetedFigureDrawnPoints",
} as const;

/**
 * The candidates drawn as outlines: every one but the feature itself, by the
 * rule Rust draws with (bounds equal to the feature's).
 */
function otherCandidates(row: PayloadRow) {
  const feature = row.feature;
  return row.candidates.filter(
    (candidate) =>
      feature === null || candidate.leftS !== feature.leftS || candidate.rightS !== feature.rightS,
  );
}

/** How the last output this report asked for ended, described when shown. */
type OutputState =
  | { readonly status: "idle" }
  | { readonly status: "running"; readonly operation: Operation }
  | { readonly status: "cancelled" }
  | { readonly status: "savedFigure"; readonly fileName: string; readonly figure: ExportedFigure }
  | { readonly status: "savedTable"; readonly fileName: string; readonly rowCount: number }
  | { readonly status: "failed"; readonly error: PreviewError };

function describeFigure(figure: ExportedFigure, t: UiMessage): string {
  return (
    t("viewerFigureSize", {
      width: formatCount(figure.width),
      height: formatCount(figure.height),
      theme: t(figure.theme),
    }) + (figure.dpi !== null ? `, ${formatCount(figure.dpi)} DPI` : "")
  );
}

function describeOutput(state: OutputState, t: UiMessage, errorText: (error: PreviewError) => string) {
  switch (state.status) {
    case "idle":
      return "";
    case "running":
      return t("viewerExportChoose", { name: state.operation.toUpperCase() });
    case "cancelled":
      return t("viewerExportCancelled");
    case "savedFigure":
      return t("viewerExportSaved", { name: state.fileName, details: describeFigure(state.figure, t) });
    case "savedTable":
      return t("targetedTableSaved", { name: state.fileName, count: state.rowCount });
    case "failed":
      return errorText(state.error);
  }
}

/** The settings a figure is drawn with, or `null` while the size is not a whole count. */
function figureSettings(draft: FigureSettingsDraft): FigureSettings | null {
  const widthPx = wholeCount(draft.widthPx);
  const heightPx = wholeCount(draft.heightPx);
  if (widthPx === null || heightPx === null) return null;
  // A drawing records no resolution, so an unfinished DPI does not hold the
  // figure back; only a PNG export needs a valid one, and asks with it.
  const pngDpi = wholeCount(draft.pngDpi) ?? Number(DEFAULT_FIGURE.pngDpi);
  return { widthPx, heightPx, pngDpi, theme: draft.theme };
}

export function TargetedMs1Report({
  artifact,
  plan,
  sourceName,
  sourceState,
  recordedWhen,
  refusalText,
  errorText,
  runsRecorded,
}: TargetedMs1ReportProps) {
  const t = useUiMessages();
  const api = useProjectApi();
  const ids = useId();
  const section = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => bringIntoView(section.current), [artifact.id]);
  const result = artifact.targetedMs1?.result ?? null;
  // What a later read found. The project says whether the stored rows were
  // whole when it last looked; a read, drawing or export that finds them
  // missing or damaged since is newer, so from then on the rows already on
  // screen are not shown as the result and nothing more is offered from them.
  const [found, setFound] = useState<PayloadAvailability | null>(null);
  const availability = found ?? artifact.targetedMs1?.availability ?? "payloadMissing";
  const noteRefusal = useCallback((code: string) => {
    if (code === "payloadMissing" || code === "payloadCorrupt") setFound(code);
  }, []);
  const [rows, setRows] = useState<{ readonly id: string; readonly page: Loaded<{
    readonly total: number;
    readonly rows: readonly PayloadRow[];
  }> } | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<{
    readonly key: string;
    readonly value: Loaded<TargetEvidence>;
  } | null>(null);
  const [newRuns, setNewRuns] = useState<NewRuns>("checking");
  const [draft, setDraft] = useState<FigureSettingsDraft>(DEFAULT_FIGURE);
  // What the figure is drawn at: the last settings that were a size. While a
  // size is being typed the drawing stays at the last one, rather than
  // waiting on text that is not yet a size.
  const [drawn, setDrawn] = useState<FigureSettings>(
    () => figureSettings(DEFAULT_FIGURE) ?? { widthPx: 1200, heightPx: 640, pngDpi: 300, theme: "light" },
  );
  const [figureExportOpen, setFigureExportOpen] = useState(false);
  const [output, setOutput] = useState<{
    readonly region: "figure" | "table";
    /** The target a figure output was for; `null` for the table. */
    readonly target: string | null;
    readonly state: OutputState;
  }>({ region: "table", target: null, state: { status: "idle" } });
  const outputBusy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Whether a *new* run could start. Only said: nothing below depends on it,
  // because a stored result needs no runtime to be read. Asked again when a
  // run is recorded, since its ending can change the answer.
  useEffect(() => {
    let live = true;
    api
      .getTargetedMs1Runtime()
      .then((answer) => {
        if (live) setNewRuns(answer.newRuns);
      })
      .catch(() => {
        if (live) setNewRuns("unknown");
      });
    return () => {
      live = false;
    };
  }, [api, runsRecorded]);

  // A result found missing or damaged takes away what was on screen, the
  // control the user pressed among it. Focus goes to the report's heading
  // rather than to nothing, and the new sentence is announced.
  useEffect(() => {
    if (found === null) return;
    const active = document.activeElement;
    if (active === null || active === document.body) heading.current?.focus();
  }, [found]);

  // One bounded page, read once per result. Where the result was not whole
  // when last looked at, nothing is read: Rust would refuse, and the reason is
  // already on screen.
  useEffect(() => {
    if (availability !== "available") return;
    let live = true;
    api
      .readTargetedMs1Rows(artifact.id, 0)
      .then((page) => {
        if (live) setRows({ id: artifact.id, page: { status: "ready", value: page } });
      })
      .catch((error: unknown) => {
        if (!live) return;
        const code = refusalOf(error);
        setRows({ id: artifact.id, page: { status: "refused", code } });
        noteRefusal(code);
      });
    return () => {
      live = false;
    };
  }, [api, artifact.id, availability]);

  const evidenceKey = chosen === null ? null : `${artifact.id}/${chosen}`;
  // A row that never reached extraction has no evidence to ask for; its
  // absence of points is said from the row itself.
  const chosenRow =
    rows !== null && rows.id === artifact.id && rows.page.status === "ready"
      ? rows.page.value.rows.find((row) => row.targetId === chosen)
      : undefined;
  const chosenExtracted = chosenRow !== undefined && chosenRow.ion !== null;
  useEffect(() => {
    if (chosen === null || evidenceKey === null || !chosenExtracted) return;
    let live = true;
    api
      .readTargetedMs1Evidence(artifact.id, chosen)
      .then((value) => {
        if (live) setEvidence({ key: evidenceKey, value: { status: "ready", value } });
      })
      .catch((error: unknown) => {
        if (!live) return;
        const code = refusalOf(error);
        setEvidence({ key: evidenceKey, value: { status: "refused", code } });
        noteRefusal(code);
      });
    return () => {
      live = false;
    };
  }, [api, artifact.id, chosen, chosenExtracted, evidenceKey]);

  /**
   * Shows a chosen target's evidence beside its row, once it is there.
   *
   * Armed by the press on a row and spent when that target's panel reaches
   * its end: the drawing in place, a refusal said, or a row that has no
   * points. It acts only while the keyboard is still on the control that was
   * pressed -- a reader who moved on keeps the place they moved to -- and it
   * moves the surface alone, so the row table stays where the reader left it.
   */
  const revealing = useRef<string | null>(null);
  const settle = useCallback(() => {
    const target = revealing.current;
    if (target === null) return;
    const panel = section.current?.querySelector<HTMLElement>("[data-targeted-selected]") ?? null;
    if (panel === null || panel.getAttribute("data-targeted-selected") !== target) return;
    const end = panel.querySelector<HTMLElement>(
      "[data-targeted-plot] img, [data-targeted-figure-refused], [data-targeted-evidence-refused], :scope > [data-targeted-no-points]",
    );
    if (end === null) return;
    revealing.current = null;
    const row = section.current?.querySelector<HTMLElement>(`[data-targeted-row="${target}"]`) ?? null;
    const control = row?.querySelector("[data-targeted-choose]") ?? null;
    if (row !== null && control !== null && document.activeElement === control) revealBeside(row, end);
  }, []);
  // Every render of the report may be the one that ended the panel: a row
  // with no points, or a refused read. A drawing arriving tells it directly.
  useLayoutEffect(() => {
    settle();
  });

  const page: Loaded<{ readonly total: number; readonly rows: readonly PayloadRow[] }> =
    rows !== null && rows.id === artifact.id ? rows.page : { status: "loading" };
  const labels = new Map(plan?.targets.map((target) => [target.targetId, target.label]) ?? []);
  const nameOf = (targetId: string) => labels.get(targetId) ?? targetId;
  const formulaOf = (targetId: string) =>
    plan?.targets.find((target) => target.targetId === targetId)?.formula ?? "";
  const selectedRow =
    page.status === "ready" ? page.value.rows.find((row) => row.targetId === chosen) ?? null : null;
  const shown: Loaded<TargetEvidence> =
    evidence !== null && evidence.key === evidenceKey ? evidence.value : { status: "loading" };
  const settings = figureSettings(draft);
  const validation = validateFigureDraft(draft);
  const figurePrefix = `targeted-${ids}`;
  const running = output.state.status === "running";
  /** Whether this control started the output that is running. */
  const initiated = (operation: Operation, target: string | null) =>
    output.state.status === "running" && output.state.operation === operation && output.target === target;

  function editFigure(next: FigureSettingsDraft) {
    setDraft(next);
    const valid = figureSettings(next);
    if (valid !== null) setDrawn(valid);
  }

  // This surface's own sentences for two shared refusals whose shared words
  // name controls it does not have: a copy, and a range to preview instead.
  const outputError = (error: PreviewError) =>
    error.kind === "figure_settings_refused" && error.context?.kind === "pngDpi"
      ? t("m92ErrorDpi", { min: error.context.min, max: error.context.max })
      : error.kind === "figure_preview_too_large"
        ? t("m92ErrorPreviewSize")
        : errorText(error);

  /** One output at a time from this report, as Rust's own lane allows. */
  function start(
    region: "figure" | "table",
    target: string | null,
    operation: Operation,
    request: () => Promise<OutputState>,
  ) {
    if (outputBusy.current) return;
    outputBusy.current = true;
    setOutput({ region, target, state: { status: "running", operation } });
    request()
      .catch((error: unknown): OutputState => ({ status: "failed", error: toPreviewError(error) }))
      .then((state) => {
        outputBusy.current = false;
        if (!mounted.current) return;
        setOutput({ region, target, state });
        if (state.status === "failed") noteRefusal(state.error.kind);
      });
  }

  function exportTable(format: TargetedTableFormat) {
    start("table", null, format, async () => {
      const answer = await api.exportTargetedMs1Table(artifact.id, format);
      return answer.status === "cancelled"
        ? { status: "cancelled" }
        : { status: "savedTable", fileName: answer.fileName, rowCount: answer.rowCount };
    });
  }

  function exportFigure(targetId: string, operation: "svg" | "png") {
    // PNG is only offered while the typed resolution is one, so `settings`
    // carries it whenever a PNG is asked for.
    if (settings === null) return;
    const asked = settings;
    start("figure", targetId, operation, async () => {
      const answer = await api.exportTargetedMs1Figure(artifact.id, targetId, operation, asked);
      return answer.status === "cancelled"
        ? { status: "cancelled" }
        : { status: "savedFigure", fileName: answer.fileName, figure: answer.figure };
    });
  }

  // Each output is said where it was asked for: a figure's only under the
  // target it was for.
  const status = (region: "figure" | "table", target: string | null) => {
    const state =
      output.region === region && output.target === target ? output.state : ({ status: "idle" } as const);
    const detail = state.status === "failed" ? ownedErrorDetail(state.error, t) : null;
    return (
      <p className="targeted-output" role="status" data-targeted-output={state.status}>
        {describeOutput(state, t, outputError)}
        {detail === null ? null : <span className="notice-detail">{detail}</span>}
      </p>
    );
  };

  return (
    <section
      ref={section}
      className="project-section qc-report targeted-report"
      aria-labelledby={`${ids}-title`}
      data-targeted-report={artifact.id}
      data-availability={availability}
    >
      <div className="project-section-head">
        <h3 ref={heading} id={`${ids}-title`} tabIndex={-1}>
          {t("targetedReportTitle")}
        </h3>
      </div>
      <p className="qc-report-of">
        {sourceName ?? t("provenanceRelatedGone")}
        {recordedWhen === null ? null : (
          <span className="qc-report-when"> · {t("qcReportRecorded", { when: recordedWhen })}</span>
        )}
      </p>
      <p className="targeted-experimental">{t("targetedExperimental")}</p>

      <dl
        className="provenance-facts targeted-state"
        aria-label={t("targetedStateLabel")}
        data-targeted-state=""
      >
        <dt>{t("targetedStatePayload")}</dt>
        <dd data-targeted-payload={availability}>{t(PAYLOAD_STATE_KEYS[availability])}</dd>
        <dt>{t("targetedStateSource")}</dt>
        <dd data-targeted-source={sourceState?.id ?? "gone"}>
          {sourceState?.text ?? t("targetedStateSourceGone")}
        </dd>
        <dt>{t("targetedStateNewRuns")}</dt>
        <dd data-targeted-runtime={newRuns}>{t(NEW_RUNS_KEYS[newRuns])}</dd>
      </dl>
      {/* Only where there is something to show: a result that is not whole
          offers no reading and no output, so the sentence would be false. */}
      {availability === "available" ? <p className="project-note">{t("targetedReuseNote")}</p> : null}

      {/* Every count the project recorded, zeros included, as one line of
          label and value: the rows are the substance and come next. */}
      {result === null ? null : (
        <div className="targeted-summary" data-targeted-summary="">
          <span id={`${ids}-summary`} className="targeted-summary-label">
            {t("targetedSummary")}
          </span>
          <dl aria-labelledby={`${ids}-summary`}>
            {(
              [
                ["targets", "targetedSummaryTargets", result.summary.targets],
                ["detected", "targetedOutcomeDetected", result.summary.detected],
                ["detectedAmbiguous", "targetedOutcomeDetectedAmbiguous", result.summary.detectedAmbiguous],
                ["shared", "targetedOutcomeShared", result.summary.shared],
                ["suppressedByOverlap", "targetedOutcomeSuppressed", result.summary.suppressedByOverlap],
                ["notDetected", "targetedOutcomeNotDetected", result.summary.notDetected],
                ["failed", "targetedOutcomeFailed", result.summary.failed],
              ] as const
            ).map(([name, label, count]) => (
              <div key={name} data-targeted-count={name}>
                <dt>{t(label)}</dt>
                <dd>{formatCount(count)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {/* About the absences the recovery recorded, so only where there are
          some: a batch whose every window held nothing records none. */}
      {result?.noCandidateRecovery === true && result.summary.notDetected > 0 ? (
        <p className="project-note" data-targeted-recovery="">
          {t("targetedRecoveryNote")}
        </p>
      ) : null}

      {availability !== "available" ? (
        // An alert only when a read in this session found it: what the
        // project recorded at open is not news.
        <p
          className="project-problem"
          data-targeted-unavailable={availability}
          role={found === null ? undefined : "alert"}
        >
          {t(AVAILABILITY_KEYS[availability])}
        </p>
      ) : page.status === "loading" ? (
        <p className="project-note" data-targeted-rows-loading="">
          {t("targetedRowsLoading")}
        </p>
      ) : page.status === "refused" ? (
        <p className="project-problem" data-targeted-rows-refused={page.code}>
          {page.code in AVAILABILITY_KEYS
            ? t(AVAILABILITY_KEYS[page.code as PayloadAvailability])
            : refusalText(page.code)}
        </p>
      ) : (
        <>
          {/* What the outcome words mean, before the rows that use them, and
              the table's own output beside the table: the chosen target's
              evidence then follows its row directly. */}
          <p className="project-note targeted-meaning">{t("targetedMeaning")}</p>

          {/* The table's own output, on the rows' head: always offered, never
              folded away. */}
          <div className="targeted-table-export" data-targeted-table-export="">
            <span className="targeted-table-export-label">{t("targetedTableExports")}</span>
            <div className="targeted-output-actions">
              {(["csv", "tsv"] as const).map((format) => (
                <Button
                  key={format}
                  variant="secondary"
                  size="sm"
                  icon={<Icon name="download" />}
                  // The pressed control keeps focus across the native picker;
                  // `start` refuses a repeat, keyboard or pointer.
                  refused={running}
                  disabled={running && !initiated(format, null)}
                  data-targeted-export={format}
                  onClick={() => exportTable(format)}
                >
                  {t(initiated(format, null) ? "viewerExporting" : "viewerExportFormat", {
                    name: format.toUpperCase(),
                  })}
                </Button>
              ))}
            </div>
            {status("table", null)}
          </div>

          <div className="targeted-rows">
            <table className="qc-report-table" data-targeted-rows={page.value.total}>
              <caption>{t("targetedRowsCaption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("targetedFieldLabel")}</th>
                  <th scope="col">{t("targetedColumnOutcome")}</th>
                  <th scope="col">{t("targetedColumnApex")}</th>
                  <th scope="col">{t("targetedColumnRawArea")}</th>
                </tr>
              </thead>
              <tbody>
                {page.value.rows.map((row) => (
                  <tr
                    key={row.targetId}
                    className={row.targetId === chosen ? "is-chosen" : undefined}
                    data-targeted-row={row.targetId}
                    data-outcome={row.outcome}
                  >
                    <th scope="row">
                      <Button
                        variant="quiet"
                        size="sm"
                        aria-pressed={row.targetId === chosen}
                        aria-label={t("targetedShowEvidenceNamed", { name: nameOf(row.targetId) })}
                        data-targeted-choose={row.targetId}
                        onClick={() => {
                          revealing.current = row.targetId;
                          setChosen(row.targetId);
                          // Pressed again: its evidence may already be in place.
                          if (row.targetId === chosen) settle();
                        }}
                      >
                        {nameOf(row.targetId)}
                      </Button>
                    </th>
                    <td>
                      <span aria-hidden="true" className="targeted-symbol">
                        {OUTCOME_SYMBOLS[row.outcome]}
                      </span>{" "}
                      {t(OUTCOME_KEYS[row.outcome])}
                      {row.failureReason === null ? null : (
                        <span className="targeted-reason"> — {t(ROW_FAILURE_KEYS[row.failureReason])}</span>
                      )}
                    </td>
                    <td>{row.feature === null ? "—" : seconds(row.feature.apexRtS)}</td>
                    <td>{row.feature === null ? "—" : formatIntensity(row.feature.rawArea)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {page.value.total > page.value.rows.length ? (
            <p className="project-note">
              {t("targetedRowsBounded", {
                count: page.value.rows.length,
                total: page.value.total,
              })}
            </p>
          ) : null}

          {selectedRow === null ? (
            <p className="project-empty" data-targeted-no-selection="">
              {t("targetedChooseRow")}
            </p>
          ) : (
            <div className="targeted-selected" data-targeted-selected={selectedRow.targetId}>
              <h4>
                {nameOf(selectedRow.targetId)}
                {formulaOf(selectedRow.targetId) === "" ? null : (
                  <span className="qc-report-when"> · {formulaOf(selectedRow.targetId)}</span>
                )}
              </h4>
              {selectedRow.ion === null ? (
                <p className="project-note" data-targeted-no-points="">
                  {t("targetedNoPoints")}
                </p>
              ) : shown.status === "loading" ? (
                <p className="project-note">{t("targetedEvidenceLoading")}</p>
              ) : shown.status === "refused" ? (
                <p className="project-problem" data-targeted-evidence-refused={shown.code}>
                  {shown.code in AVAILABILITY_KEYS
                    ? t(AVAILABILITY_KEYS[shown.code as PayloadAvailability])
                    : refusalText(shown.code)}
                </p>
              ) : (
                <>
                  <EvidenceFigure
                    artifactId={artifact.id}
                    targetId={selectedRow.targetId}
                    alt={t("targetedFigureAlt", {
                      name: nameOf(selectedRow.targetId),
                      outcome: t(OUTCOME_KEYS[selectedRow.outcome]),
                      drawn: t(
                        DRAWN_KEYS[
                          selectedRow.feature === null
                            ? otherCandidates(selectedRow).length === 0
                              ? "points"
                              : "candidates"
                            : otherCandidates(selectedRow).length === 0
                              ? "feature"
                              : "featureAndCandidates"
                        ],
                      ),
                    })}
                    traces={shown.value.traces}
                    settings={drawn}
                    errorText={outputError}
                    onRefused={noteRefusal}
                    onDrawn={settle}
                  />
                  {/* Open or closed as the user left it, whichever target is shown. */}
                  <div className="targeted-export">
                    <Disclosure
                      variant="secondary"
                      label={t("targetedFigureExports")}
                      open={figureExportOpen}
                      onOpenChange={setFigureExportOpen}
                      regionProps={{ className: "targeted-export-region", "data-targeted-figure-export": "" }}
                    >
                      <FigureSettingsFields
                        idPrefix={figurePrefix}
                        settings={draft}
                        validation={validation}
                        onFigureSetting={(field, value) => editFigure({ ...draft, [field]: value })}
                        onFigureTheme={(theme) => editFigure({ ...draft, theme })}
                      />
                      <div className="targeted-output-actions">
                        {(["svg", "png"] as const).map((operation) => {
                          // A size or resolution that is not a whole count
                          // refuses the output, focusable, and points at the
                          // field's own problem sentence.
                          const problemId =
                            validation.render !== null
                              ? renderProblemId(figurePrefix)
                              : operation === "png" && validation.dpi !== null
                                ? dpiProblemId(figurePrefix)
                                : null;
                          return (
                            <Button
                              key={operation}
                              variant="secondary"
                              size="sm"
                              icon={<Icon name="download" />}
                              refused={running || problemId !== null}
                              reasonId={problemId ?? undefined}
                              // Frozen while another output's picker is out.
                              disabled={running && !initiated(operation, selectedRow.targetId)}
                              data-targeted-export={operation}
                              onClick={() => exportFigure(selectedRow.targetId, operation)}
                            >
                              {t(
                                initiated(operation, selectedRow.targetId) ? "viewerExporting" : "viewerExportFormat",
                                { name: operation.toUpperCase() },
                              )}
                            </Button>
                          );
                        })}
                      </div>
                      {status("figure", selectedRow.targetId)}
                    </Disclosure>
                  </div>
                </>
              )}
              <RowFacts row={selectedRow} nameOf={nameOf} />
            </div>
          )}
        </>
      )}
    </section>
  );
}

/**
 * One target's stored evidence, drawn by the shared figure renderer in Rust.
 *
 * The image is the SVG an export writes for these settings, shown in an inert
 * image context -- never parsed, never placed in the DOM as markup. Every
 * point is also in the table beneath it, for a reader who cannot see it.
 */
function EvidenceFigure({
  artifactId,
  targetId,
  alt,
  traces,
  settings,
  errorText,
  onRefused,
  onDrawn,
}: {
  readonly artifactId: string;
  readonly targetId: string;
  /** The image's text alternative, naming the outcome and what is drawn. */
  readonly alt: string;
  readonly traces: readonly EvidenceTrace[];
  readonly settings: FigureSettings;
  readonly errorText: (error: PreviewError) => string;
  /** Told a drawing's refusal, so a result found damaged stops being shown. */
  readonly onRefused: (code: string) => void;
  /** Told once the drawing, or its refusal, is in place. */
  readonly onDrawn: () => void;
}) {
  const t = useUiMessages();
  const api = useProjectApi();
  const ids = useId();
  const { widthPx: width, heightPx: height, theme } = settings;
  const target = `${artifactId}/${targetId}`;
  const key = `${target}/${width}x${height}/${theme}`;
  const [answer, setAnswer] = useState<{
    readonly key: string;
    readonly target: string;
    readonly value:
      | { readonly status: "ready"; readonly figure: TargetedFigure }
      | { readonly status: "failed"; readonly error: PreviewError };
  } | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      // A drawing records no resolution; the value only fills the shared shape.
      .previewTargetedMs1Figure(artifactId, targetId, { widthPx: width, heightPx: height, pngDpi: 300, theme })
      .then((figure) => {
        if (live) setAnswer({ key, target, value: { status: "ready", figure } });
      })
      .catch((error: unknown) => {
        if (!live) return;
        const failed = toPreviewError(error);
        setAnswer({ key, target, value: { status: "failed", error: failed } });
        onRefused(failed.kind);
      });
    return () => {
      live = false;
    };
  }, [api, artifactId, height, key, onRefused, target, targetId, theme, width]);

  // The last drawing of this target stays while the next size is drawn.
  const current = answer !== null && answer.target === target ? answer.value : null;
  const figure = current?.status === "ready" ? current.figure : null;
  useEffect(() => {
    if (figure === null) {
      setImageUrl(null);
      return;
    }
    // Image context is inert: no innerHTML, object/embed, script, or DOM SVG.
    const url = URL.createObjectURL(new Blob([figure.svg], { type: "image/svg+xml" }));
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [figure]);

  // In the commit that shows it, so whatever is brought into view is where
  // it will stay: the image's box is set by its size before it decodes.
  const drawnOrRefused = (figure !== null && imageUrl !== null) || current?.status === "failed";
  useLayoutEffect(() => {
    if (drawnOrRefused) onDrawn();
  }, [drawnOrRefused, onDrawn]);

  const points = traces.reduce((count, trace) => count + trace.points.length, 0);
  const traceName = (trace: number) => (trace === 0 ? "M" : `M+${trace}`);
  return (
    <figure className="targeted-plot" data-targeted-plot="" aria-busy={answer?.key !== key}>
      {figure !== null && imageUrl !== null ? (
        <img
          src={imageUrl}
          alt={alt}
          width={figure.width}
          height={figure.height}
          data-targeted-figure={figure.specId}
          aria-describedby={traces.length === 0 ? undefined : `${ids}-caption`}
        />
      ) : current?.status === "failed" ? (
        <p className="project-problem" data-targeted-figure-refused={current.error.kind}>
          {errorText(current.error)}
        </p>
      ) : (
        <p className="project-note" data-targeted-figure-loading="">
          {t("targetedFigureLoading")}
        </p>
      )}
      {points === 0 ? (
        <p className="project-note" data-targeted-no-points="">
          {t("targetedFigureNoPoints")}
        </p>
      ) : null}
      {/* Evidence with no trace has nothing for the caption to name; Rust
          refuses to draw it, and that refusal is what is shown. */}
      {traces.length === 0 ? null : (
        <figcaption id={`${ids}-caption`} className="project-note">
          {t("targetedPlotCaption", {
            traces: traces
              .map((trace) => `${traceName(trace.trace)} ${formatMz(trace.mzTheoretical)}`)
              .join(", "),
          })}
        </figcaption>
      )}
      <div className="targeted-disclosure">
        <Disclosure label={t("targetedPointsTable")} regionProps={{ className: "targeted-points", "data-targeted-points": "" }}>
          <table className="qc-report-table">
            <thead>
              <tr>
                <th scope="col">{t("targetedColumnTrace")}</th>
                <th scope="col">{t("targetedAxisRt")}</th>
                <th scope="col">{t("targetedColumnIntensity")}</th>
              </tr>
            </thead>
            <tbody>
              {traces.flatMap((trace) =>
                trace.points.map((point) => (
                  <tr key={`${trace.trace}/${point[0]}`}>
                    <th scope="row">{traceName(trace.trace)}</th>
                    <td>{seconds(point[1])}</td>
                    <td>{formatIntensity(point[2])}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </Disclosure>
      </div>
    </figure>
  );
}

/** Everything one row records, as label and value. */
function RowFacts({
  row,
  nameOf,
}: {
  readonly row: PayloadRow;
  readonly nameOf: (targetId: string) => string;
}) {
  const t = useUiMessages();
  const none = t("targetedNone");
  const names = (ids: readonly string[]) => (ids.length === 0 ? none : ids.map(nameOf).join(", "));
  const feature = row.feature;
  return (
    <>
      <dl className="provenance-facts targeted-facts" data-targeted-facts="">
        <dt>{t("targetedColumnOutcome")}</dt>
        <dd>
          {t(OUTCOME_KEYS[row.outcome])}
          {row.failureReason === null ? null : ` — ${t(ROW_FAILURE_KEYS[row.failureReason])}`}
        </dd>
        {row.ion === null ? null : (
          <>
            <dt>{t("targetedIon")}</dt>
            <dd>
              {row.ion.adduct} ·{" "}
              {row.ion.mzTheoretical
                .map((mz, index) => `${index === 0 ? "M" : `M+${index}`} ${formatMz(mz)}`)
                .join(", ")}
            </dd>
          </>
        )}
        {row.windows === null ? null : (
          <>
            <dt>{t("targetedRtWindow")}</dt>
            <dd>
              [{seconds(row.windows.rtClosedS[0])}, {seconds(row.windows.rtClosedS[1])}]
            </dd>
            <dt>{t("targetedMzWindows")}</dt>
            <dd>
              {row.windows.mzOpen
                .map(([low, high]) => `(${formatMz(low)}, ${formatMz(high)})`)
                .join(", ")}
            </dd>
          </>
        )}
        {row.signal === null ? null : (
          <>
            <dt>{t("targetedSignal")}</dt>
            <dd>
              {t(row.signal.anyNonzeroPoint ? "targetedSignalSome" : "targetedSignalNone", {
                count: row.signal.points,
              })}
            </dd>
          </>
        )}
        {feature === null ? null : (
          <>
            <dt>{t("targetedColumnApex")}</dt>
            <dd>{seconds(feature.apexRtS)}</dd>
            <dt>{t("targetedBounds")}</dt>
            <dd>
              [{seconds(feature.leftS)}, {seconds(feature.rightS)}]
            </dd>
            <dt>{t("targetedColumnRawArea")}</dt>
            <dd>{formatIntensity(feature.rawArea)}</dd>
            <dt>{t("targetedModelStatus")}</dt>
            {/* The engine's own words, preserved as it reported them. */}
            <dd lang="en">{feature.modelStatus}</dd>
            <dt>{t("targetedEngineIntensity")}</dt>
            <dd>
              {feature.engineIntensity === null ? none : formatIntensity(feature.engineIntensity)} ·{" "}
              {t(
                feature.engineIntensitySource === "modelArea"
                  ? "targetedIntensityFromModel"
                  : "targetedIntensityImputed",
              )}
            </dd>
          </>
        )}
        <dt>{t("targetedCandidates")}</dt>
        <dd>{formatCount(row.candidates.length)}</dd>
        <dt>{t("targetedSharedWith")}</dt>
        <dd>{names(row.relations.sharedWith)}</dd>
        <dt>{t("targetedSuppressedBy")}</dt>
        <dd>{row.relations.suppressedBy === null ? none : nameOf(row.relations.suppressedBy)}</dd>
        <dt>{t("targetedOverlapRemoved")}</dt>
        <dd>{names(row.relations.overlapRemoved)}</dd>
        {row.edgeTraceCount > 0 ? (
          <>
            <dt>{t("targetedEdgeTraces")}</dt>
            <dd>{formatCount(row.edgeTraceCount)}</dd>
          </>
        ) : null}
      </dl>
      {feature === null ? null : <p className="project-note">{t("targetedIntensityNote")}</p>}
    </>
  );
}

/**
 * What a targeted run's attempt established, for the Details region.
 *
 * Measured digests are MSCanvas's own observations; versions are what the
 * engine reported about itself; a stop's facts are what was observed, kept
 * apart from why it was asked for.
 */
export function TargetedFacts({ lineage }: { readonly lineage: TargetedLineage }) {
  const t = useUiMessages();
  const { execution, plan } = lineage;
  const attempt = execution.attempt;
  const report = attempt?.engineReport ?? null;
  const yesNo = (value: boolean) => t(value ? "targetedYes" : "targetedNo");
  return (
    <>
      {execution.failure === null ? null : (
        <>
          <p className="provenance-section-label">{t("targetedFailure")}</p>
          <p className="provenance-current-row" data-targeted-failure={execution.failure.code}>
            {t(FAILURE_KEYS[execution.failure.code])}
          </p>
          <p className="provenance-note">
            {t("targetedFailureStage", { stage: t(STAGE_KEYS[execution.failure.stage]) })}
          </p>
        </>
      )}
      {execution.stop === null ? null : (
        <>
          <p className="provenance-section-label">{t("targetedStop")}</p>
          <dl className="provenance-facts" data-targeted-stop={execution.stop.reason}>
            <dt>{t("targetedStopReason")}</dt>
            <dd>
              {t(
                execution.stop.reason === "cancelRequested"
                  ? "targetedStopCancel"
                  : "targetedStopTimeBudget",
              )}
            </dd>
            <dt>{t("targetedStopTerminated")}</dt>
            <dd>{yesNo(execution.stop.workerTerminated)}</dd>
            <dt>{t("targetedStopExitObserved")}</dt>
            <dd>{yesNo(execution.stop.exitObserved)}</dd>
          </dl>
        </>
      )}
      <p className="provenance-section-label">{t("targetedPlan")}</p>
      <dl className="provenance-facts" data-targeted-plan-facts="">
        <dt>{t("targetedPlanDigestLabel")}</dt>
        <dd className="provenance-digest" title={execution.planSha256}>{execution.planSha256}</dd>
        {plan === null ? null : (
          <>
            <dt>{t("targetedTargetListDigest")}</dt>
            <dd className="provenance-digest" title={plan.targetListSha256}>{plan.targetListSha256}</dd>
            <dt>{t("targetedRecipeVersion")}</dt>
            <dd>{plan.recipe.recipeVersion}</dd>
            <dt>{t("targetedEngineProfileDigest")}</dt>
            <dd className="provenance-digest" title={plan.recipe.engineProfileSha256}>{plan.recipe.engineProfileSha256}</dd>
            <dt>{t("targetedSummaryTargets")}</dt>
            <dd>{formatCount(plan.targets.length)}</dd>
            <dt>{t("targetedFieldMzHalfWidth")}</dt>
            <dd>{plan.parameters.mzHalfWidthPpm}</dd>
            <dt>{t("targetedFieldPeakWidth")}</dt>
            <dd>{plan.parameters.expectedPeakWidthS}</dd>
          </>
        )}
      </dl>
      <p className="provenance-section-label">{t("targetedSourceRead")}</p>
      {execution.consumedContent.length === 0 ? (
        <p className="provenance-empty" data-targeted-not-read="">
          {t("targetedSourceNotRead")}
        </p>
      ) : (
        <dl className="provenance-facts" data-targeted-consumed="">
          {execution.consumedContent.map((member) => (
            <div key={member.relativeName} className="targeted-member">
              <dt>{t("targetedSourceBytes")}</dt>
              <dd>{formatCount(member.byteLength)}</dd>
              <dt>SHA-256</dt>
              <dd className="provenance-digest" title={member.sha256}>{member.sha256}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="provenance-section-label">{t("targetedAttempt")}</p>
      {attempt === null ? (
        <p className="provenance-empty" data-targeted-no-attempt="">
          {t("targetedNoAttempt")}
        </p>
      ) : (
        <>
          <dl className="provenance-facts" data-targeted-attempt="">
            <dt>{t("targetedEngineReported")}</dt>
            <dd>
              {report === null
                ? t("provenanceProducerNotReported")
                : `pyOpenMS ${report.pyopenms} · OpenMS ${report.openms} (${report.openmsRevision}, ${report.openmsBuildTime}) · Python ${report.python}`}
            </dd>
            <dt>{t("targetedSourceView")}</dt>
            <dd data-targeted-source-view={attempt.sourceView}>
              {t(
                attempt.sourceView === "verifiedSnapshotInWorkArea"
                  ? "targetedSourceViewSnapshot"
                  : "targetedSourceViewLink",
              )}
            </dd>
            <dt>{t("targetedAdapterDigest")}</dt>
            <dd className="provenance-digest" title={attempt.adapterSha256}>{attempt.adapterSha256}</dd>
            <dt>{t("targetedRuntimeDigest")}</dt>
            <dd className="provenance-digest" title={attempt.runtimeManifestSha256}>{attempt.runtimeManifestSha256}</dd>
            <dt>{t("targetedInterpreterDigest")}</dt>
            <dd className="provenance-digest" title={attempt.interpreterSha256}>{attempt.interpreterSha256}</dd>
          </dl>
          {attempt.loadedModules.length === 0 ? null : (
            <div className="targeted-disclosure">
              <Disclosure label={t("targetedModules", { count: attempt.loadedModules.length })}>
                <dl className="provenance-facts">
                  {attempt.loadedModules.map((module) => (
                    <div key={module.name} className="targeted-member">
                      <dt>{module.name}</dt>
                      <dd className="provenance-digest" title={module.sha256}>{module.sha256}</dd>
                    </div>
                  ))}
                </dl>
              </Disclosure>
            </div>
          )}
          <p className="provenance-note">{t("targetedAttemptNote")}</p>
        </>
      )}
    </>
  );
}
