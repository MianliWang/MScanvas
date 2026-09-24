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

import { useCallback, useEffect, useId, useRef, useState } from "react";

import {
  toPreviewError,
  type ExportedFigure,
  type FigureSettings,
  type PreviewError,
} from "../mzml-preview/contracts";
import { FigureSettingsFields } from "../mzml-preview/FigureSettingsFields";
import { validateFigureDraft, wholeCount } from "../mzml-preview/figureSettingsValidation";
import { formatCount, formatIntensity, formatMz } from "../mzml-preview/format";
import { ownedErrorDetail } from "../mzml-preview/ownedErrorMessages";
import type { FigureSettingsDraft } from "../mzml-preview/usePreviewWorkspace";
import type { UiMessage } from "../preferences/i18n";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import {
  useProjectApi,
  type EvidenceTrace,
  type FailureCode,
  type FailureStage,
  type PayloadAvailability,
  type PayloadRow,
  type PlanRequest,
  type PlanResolution,
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

export interface TargetedMs1SetupProps {
  readonly session: ProjectSession;
  readonly layerId: string;
  readonly sourceName: string;
  readonly onClose: () => void;
  /** The sentence for one refusal identifier, as the surface words it. */
  readonly refusalText: (code: string) => string;
}

export function TargetedMs1Setup({
  session,
  layerId,
  sourceName,
  onClose,
  refusalText,
}: TargetedMs1SetupProps) {
  const t = useUiMessages();
  const ids = useId();
  const [ppm, setPpm] = useState("5");
  const [width, setWidth] = useState("6");
  const [text, setText] = useState("");
  const [review, setReview] = useState<{
    readonly resolution: PlanResolution;
    readonly lines: readonly number[];
  } | null>(null);
  const [overfull, setOverfull] = useState<number | null>(null);
  const working = session.busy !== "idle";
  const analysing = session.busy === "analysing";
  const heading = useRef<HTMLHeadingElement | null>(null);

  // Opened by a control in a layer row, and it appears above the lists: the
  // keyboard follows to what the press made, and the surface scrolls to it.
  useEffect(() => {
    bringIntoView(heading.current);
    heading.current?.focus({ preventScroll: true });
  }, []);

  // Any edit makes the plan on screen a plan for other text, so it goes. The
  // inputs are held while anything is out, so a review cannot answer for text
  // that changed while it was being asked.
  const edited = (set: (value: string) => void) => (value: string) => {
    set(value);
    setReview(null);
    setOverfull(null);
  };

  const onReview = async () => {
    if (working) return;
    const parsed = parseTargets(text);
    if (parsed.overfull !== null) {
      setOverfull(parsed.overfull);
      setReview(null);
      return;
    }
    const resolution = await session.reviewTargetedMs1({
      layerId,
      mzHalfWidthPpm: ppm,
      expectedPeakWidthS: width,
      targets: parsed.targets,
    });
    setReview(resolution === null ? null : { resolution, lines: parsed.lines });
  };

  const plan = review?.resolution.plan ?? null;
  const blocked = review?.resolution.blocked ?? null;
  const runnable = plan !== null && blocked === null;
  const phase = phaseKey(session.analysisPhase);

  // How the last run this session started over this layer ended, while that
  // run is still in the project.
  const last = session.lastTargetedRun;
  const lastRun =
    last === null
      ? undefined
      : session.state.runs.find(
          (run) => run.id === last.runId && run.layerIds.includes(layerId),
        );
  const lastFailure = lastRun?.targetedMs1?.failure ?? null;

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
        <button
          type="button"
          className="link-button"
          aria-disabled={analysing || undefined}
          data-targeted-close=""
          onClick={() => {
            if (!analysing) onClose();
          }}
        >
          {t("targetedSetupClose")}
        </button>
      </div>
      <p className="qc-report-of">{sourceName}</p>
      <p className="targeted-experimental" data-targeted-experimental="">
        {t("targetedExperimental")}
      </p>
      <p className="project-note">{t("targetedDomain")}</p>

      <div className="targeted-parameters">
        <label>
          <span>{t("targetedFieldMzHalfWidth")}</span>
          <input
            type="text"
            inputMode="decimal"
            value={ppm}
            disabled={working}
            data-targeted-ppm=""
            onChange={(event) => edited(setPpm)(event.target.value)}
          />
        </label>
        <label>
          <span>{t("targetedFieldPeakWidth")}</span>
          <input
            type="text"
            inputMode="decimal"
            value={width}
            disabled={working}
            data-targeted-width=""
            onChange={(event) => edited(setWidth)(event.target.value)}
          />
        </label>
      </div>
      <label className="targeted-targets">
        <span>{t("targetedTargetsLabel")}</span>
        <textarea
          rows={6}
          value={text}
          disabled={working}
          spellCheck={false}
          aria-describedby={`${ids}-format`}
          placeholder={t("targetedTargetsPlaceholder")}
          data-targeted-text=""
          onChange={(event) => edited(setText)(event.target.value)}
        />
      </label>
      <p id={`${ids}-format`} className="project-note">
        {t("targetedTargetsFormat")}
      </p>

      <div className="project-actions">
        <button
          type="button"
          className="secondary-button"
          aria-disabled={working || text.trim() === "" || undefined}
          data-targeted-review=""
          onClick={() => {
            if (text.trim() !== "") void onReview();
          }}
        >
          {t("targetedReview")}
        </button>
        <button
          type="button"
          className="primary-button"
          aria-disabled={working || !runnable || undefined}
          title={runnable ? undefined : t("targetedRunNeedsReview")}
          data-targeted-run=""
          onClick={() => {
            if (!working && plan !== null && blocked === null) {
              void session.runTargetedMs1(plan.planSha256);
            }
          }}
        >
          {t("targetedRun")}
        </button>
      </div>

      {analysing ? (
        <p className="project-note" data-targeted-phase={session.analysisPhase ?? ""}>
          {t(phase ?? "targetedPhasePreparing")}
        </p>
      ) : null}

      {!analysing && lastRun !== undefined ? (
        <p className="project-note" data-targeted-last={lastRun.outcome}>
          {lastRun.outcome === "completed"
            ? t("targetedLastCompleted")
            : lastRun.outcome === "cancelled"
              ? t("targetedLastCancelled")
              : lastFailure === null
                ? t("targetedLastFailed")
                : `${t("targetedLastFailed")} ${t(FAILURE_KEYS[lastFailure.code])}`}
        </p>
      ) : null}

      {overfull === null ? null : (
        <p className="project-problem" data-targeted-overfull={overfull}>
          {t("targetedLineOverfull", { line: String(overfull) })}
        </p>
      )}

      {review === null ? null : (
        <PlanReview
          resolution={review.resolution}
          lines={review.lines}
          refusalText={refusalText}
        />
      )}
    </section>
  );
}

function PlanReview({
  resolution,
  lines,
  refusalText,
}: {
  readonly resolution: PlanResolution;
  readonly lines: readonly number[];
  readonly refusalText: (code: string) => string;
}) {
  const t = useUiMessages();
  const { plan, problems, blocked, engine } = resolution;
  return (
    <div className="targeted-review" data-targeted-review-result={plan === null ? "problems" : "plan"}>
      <p className="project-note" data-targeted-engine="">
        {t("targetedEngine", {
          engine: `${engine.package} ${engine.version} · ${engine.algorithm} · ${engine.revision}`,
        })}
      </p>
      {/* The whole profile the engine runs with, as the build fixes it: no
          value in it is the user's to change in this recipe. */}
      <details className="targeted-modules" data-targeted-profile="">
        <summary>{t("targetedEngineProfile")}</summary>
        <pre className="targeted-profile">{engine.fixedProfile}</pre>
      </details>
      {problems.length > 0 ? (
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
            {problems.map((problem, index) => (
              <tr key={index} data-targeted-problem={problem.problem}>
                <th scope="row">
                  {problem.row === null
                    ? t("targetedWhereParameters")
                    : t("targetedWhereLine", {
                        line: String(lines[problem.row - 1] ?? problem.row),
                      })}
                </th>
                <td>{t(keyed(FIELD_KEYS, problem.field, FIELD_KEYS.targets))}</td>
                <td>{t(keyed(PROBLEM_KEYS, problem.problem, PROBLEM_KEYS.invalid))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {plan === null ? null : (
        <>
          <table className="qc-report-table" data-targeted-plan={plan.planSha256}>
            <caption>
              {t("targetedPlanCaption", {
                ppm: plan.parameters.mzHalfWidthPpm,
                width: plan.parameters.expectedPeakWidthS,
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
              {plan.targets.map((target) => (
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
          <p className="project-note targeted-digest">
            {t("targetedPlanDigest", { digest: plan.planSha256 })}
          </p>
        </>
      )}
      {blocked === null ? null : (
        <p className="project-problem" data-targeted-blocked={blocked}>
          {refusalText(blocked)}
        </p>
      )}
    </div>
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

const PAYLOAD_STATE_KEYS = {
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
      <p className="spectrum-export-status" role="status" data-targeted-output={state.status}>
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
      <h3 ref={heading} id={`${ids}-title`} tabIndex={-1}>
        {t("targetedReportTitle")}
      </h3>
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

      {result === null ? null : (
        <table className="qc-report-table" data-targeted-summary="">
          <caption>{t("targetedSummary")}</caption>
          <tbody>
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
              <tr key={name} data-targeted-count={name}>
                <th scope="row">{t(label)}</th>
                <td>{formatCount(count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
                      <button
                        type="button"
                        className="link-button"
                        aria-pressed={row.targetId === chosen}
                        aria-label={t("targetedShowEvidenceNamed", { name: nameOf(row.targetId) })}
                        data-targeted-choose={row.targetId}
                        onClick={() => setChosen(row.targetId)}
                      >
                        {nameOf(row.targetId)}
                      </button>
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
          <p className="project-note">{t("targetedMeaning")}</p>

          <details className="targeted-export" data-targeted-table-export="">
            <summary>{t("targetedTableExports")}</summary>
            <p className="project-note">{t("targetedTableExportHelp")}</p>
            <div className="spectrum-export-actions">
              {(["csv", "tsv"] as const).map((format) => (
                <button
                  key={format}
                  type="button"
                  className="secondary-button"
                  // The pressed control keeps focus across the native picker;
                  // `start` refuses a repeat, keyboard or pointer.
                  aria-disabled={running || undefined}
                  disabled={running && !initiated(format, null)}
                  data-targeted-export={format}
                  onClick={() => exportTable(format)}
                >
                  {t(initiated(format, null) ? "viewerExporting" : "viewerExportFormat", {
                    name: format.toUpperCase(),
                  })}
                </button>
              ))}
            </div>
            {status("table", null)}
          </details>

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
                  />
                  {/* Open or closed as the user left it, whichever target is shown. */}
                  <details
                    className="targeted-export"
                    data-targeted-figure-export=""
                    open={figureExportOpen}
                    onToggle={(event) => setFigureExportOpen(event.currentTarget.open)}
                  >
                    <summary>{t("targetedFigureExports")}</summary>
                    <p className="project-note">{t("targetedFigureExportHelp")}</p>
                    <FigureSettingsFields
                      idPrefix={`targeted-${ids}`}
                      settings={draft}
                      validation={validation}
                      onFigureSetting={(field, value) => editFigure({ ...draft, [field]: value })}
                      onFigureTheme={(theme) => editFigure({ ...draft, theme })}
                    />
                    <div className="spectrum-export-actions">
                      {(["svg", "png"] as const).map((operation) => (
                        <button
                          key={operation}
                          type="button"
                          className="secondary-button"
                          aria-disabled={running || undefined}
                          disabled={
                            (running && !initiated(operation, selectedRow.targetId)) ||
                            validation.render !== null ||
                            (operation === "png" && validation.dpi !== null)
                          }
                          data-targeted-export={operation}
                          onClick={() => exportFigure(selectedRow.targetId, operation)}
                        >
                          {t(
                            initiated(operation, selectedRow.targetId) ? "viewerExporting" : "viewerExportFormat",
                            { name: operation.toUpperCase() },
                          )}
                        </button>
                      ))}
                    </div>
                    {status("figure", selectedRow.targetId)}
                  </details>
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
      <details className="targeted-points">
        <summary>{t("targetedPointsTable")}</summary>
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
      </details>
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
        <dd className="provenance-digest">{execution.planSha256}</dd>
        {plan === null ? null : (
          <>
            <dt>{t("targetedTargetListDigest")}</dt>
            <dd className="provenance-digest">{plan.targetListSha256}</dd>
            <dt>{t("targetedRecipeVersion")}</dt>
            <dd>{plan.recipe.recipeVersion}</dd>
            <dt>{t("targetedEngineProfileDigest")}</dt>
            <dd className="provenance-digest">{plan.recipe.engineProfileSha256}</dd>
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
              <dd className="provenance-digest">{member.sha256}</dd>
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
            <dd className="provenance-digest">{attempt.adapterSha256}</dd>
            <dt>{t("targetedRuntimeDigest")}</dt>
            <dd className="provenance-digest">{attempt.runtimeManifestSha256}</dd>
            <dt>{t("targetedInterpreterDigest")}</dt>
            <dd className="provenance-digest">{attempt.interpreterSha256}</dd>
          </dl>
          {attempt.loadedModules.length === 0 ? null : (
            <details className="targeted-modules">
              <summary>{t("targetedModules", { count: attempt.loadedModules.length })}</summary>
              <dl className="provenance-facts">
                {attempt.loadedModules.map((module) => (
                  <div key={module.name} className="targeted-member">
                    <dt>{module.name}</dt>
                    <dd className="provenance-digest">{module.sha256}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
          <p className="provenance-note">{t("targetedAttemptNote")}</p>
        </>
      )}
    </>
  );
}
