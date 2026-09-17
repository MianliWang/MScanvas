import { useCallback, useLayoutEffect, useRef } from "react";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import type { UiMessage } from "../preferences/i18n";

import { PlotRangeActions } from "./PlotRangeActions";
import { mzInput } from "./viewer/plotInputAdapters";
import { usePlotInput } from "./viewer/usePlotInput";

import type { PreviewError, SpectrumDomainRefusal } from "./contracts";
import { formatMz } from "./format";
import type { SpectrumDrawing } from "./StickSpectrum";
import {
  SPECTRUM_AXIS_HIGH,
  SPECTRUM_AXIS_LOW,
  SPECTRUM_PLOT_DRAWN_WIDTH,
  SPECTRUM_PLOT_PADDING_LEFT,
  SPECTRUM_PLOT_VIEWBOX_WIDTH,
  SPECTRUM_STICKS_LAYER,
  StickSpectrum,
} from "./StickSpectrum";
import type { MzDomain, SpectrumViewportEvent, SpectrumViewportState } from "./viewer/spectrumViewport";
import {
  isFullMzDomain,
  renderedMzDomain,
} from "./viewer/spectrumViewport";
import { ownedErrorDetail, ownedErrorMessage } from "./ownedErrorMessages";
import type {
  SpectrumViewportActionPlan,
  VisibleSpectrumViewportAction,
} from "./viewer/spectrumViewportAction";
import {
  applySpectrumViewportAction,
  hasProductiveSpectrumViewportAction,
  planSpectrumViewportAction,
  VISIBLE_SPECTRUM_VIEWPORT_ACTIONS,
} from "./viewer/spectrumViewportAction";

// Shared pointer thresholds, pending confirmation and wheel settling live in usePlotInput.

/** Where the surface says what it is doing. */
const STATUS_ID = "spectrum-viewport-status";
/** Where the surface says what range is on screen. */
const RANGE_ID = "spectrum-viewport-range";

/**
 * Why a spectrum has no viewport, in the words the panel says it.
 *
 * Each names what happened rather than that something did, and none of them
 * says the spectrum is unusable -- because it is not. A refusal is a fact about
 * *drawability*: the scientific figure contract cannot establish an m/z domain
 * over this spectrum without altering it, and MSCanvas does not alter it. The
 * points are still shown, the facts are still shown, and the data still
 * exports.
 */
const REFUSED = {
  sourceNotOrdered: "viewerMzUnordered", notFinite: "viewerMzNonfinite", axisLengthMismatch: "viewerMzMismatch",
  domainUnusable: "viewerMzDomain", valueDomainUnusable: "viewerMzValues",
} as const satisfies Record<SpectrumDomainRefusal, string>;

export interface SpectrumViewportProps {
  /** The one m/z viewport authority. This component holds no part of it. */
  readonly state: SpectrumViewportState;
  readonly dispatch: (event: SpectrumViewportEvent) => SpectrumViewportState;
  /** The same state, for a listener that runs between renders. */
  readonly readState: () => SpectrumViewportState;
  /**
   * The message behind the current failure, where the reducer accepted one.
   *
   * Resolved against the reducer's own generation before it arrives here, so
   * this is the sentence belonging to *this* failure rather than a second
   * frontend record of which failure is current.
   */
  readonly projectionError: PreviewError | null;
  /** Asks again for the drawing of the window already committed. */
  readonly onRetryProjection: () => void;
  /** The transferred arrays, drawn where there is no viewport to navigate. */
  readonly mz: readonly number[];
  readonly intensity: readonly number[];
  readonly reportedMzLow: number;
  readonly reportedMzHigh: number;
  readonly representationKnown: boolean;
  readonly valueUnitsKnown?: boolean;
  readonly labelledBy: string;
}

/**
 * The selected spectrum's m/z viewport, made reachable.
 *
 * Every semantic decision this component appears to make belongs somewhere
 * else, and that is the point of it. What range is drawn is
 * `renderedMzDomain(state)`; whether a control would do anything is
 * `planSpectrumViewportAction`; whether a wheel is this panel's is
 * `planMzWheelGesture`; which epoch a settle carries and which generation an
 * answer belongs to are the reducer's. This file turns browser events into the
 * events ADR 0038 names, and draws the result.
 *
 * What it does hold is renderer-local and nothing else: where a press started,
 * a settle timer, and the plot's box. Those are adapters, not authority -- a
 * pointer coordinate says *where to anchor a gesture*, never *what source
 * domain exists*.
 */
export function SpectrumViewport({
  state,
  dispatch,
  readState,
  projectionError,
  onRetryProjection,
  mz,
  intensity,
  reportedMzLow,
  reportedMzHigh,
  representationKnown,
  valueUnitsKnown = false,
  labelledBy,
}: SpectrumViewportProps) {
  const t = useUiMessages();
  const plotRef = useRef<SVGSVGElement | null>(null);

  const paintedRange = useRef<MzDomain | null>(null);
  const paintedNodes = useRef<{
    layer: SVGGElement | null;
    low: SVGTextElement | null;
    high: SVGTextElement | null;
  }>({ layer: null, low: null, high: null });
  const rangeRef = useRef<HTMLParagraphElement | null>(null);

  /**
   * Moves the drawing to where the gesture has got to, without React.
   *
   * A pan is a translation of the sticks and a wheel zoom a scale about the
   * pointer, so the whole layer is transformed rather than the reduction being
   * run again: one attribute per frame instead of a pass over the projection and
   * a re-render of the panel around it. The axis numbers and the range line are
   * written beside it, because a drawing that moves under numbers that do not is
   * worse than one that does not move.
   *
   * Nothing here decides anything. The range comes from the reducer's own live
   * state, and this is only the arithmetic that puts a range on screen.
   */
  const paintTransientFrame = useCallback((current: SpectrumViewportState) => {
    const target = renderedMzDomain(current);
    const base = paintedRange.current;
    const nodes = paintedNodes.current;
    if (target === null || base === null) {
      return;
    }
    const painted = base.high - base.low;
    const wanted = target.high - target.low;
    if (nodes.layer !== null) {
      if (!(painted > 0) || !(wanted > 0) || (base.low === target.low && base.high === target.high)) {
        nodes.layer.removeAttribute("transform");
      } else {
        // x' = scale * x + shift, in viewBox units, so that the m/z a stick was
        // drawn at lands where the range on screen now puts it.
        const scale = painted / wanted;
        const shift =
          SPECTRUM_PLOT_PADDING_LEFT * (1 - scale) +
          (SPECTRUM_PLOT_DRAWN_WIDTH * (base.low - target.low)) / wanted;
        nodes.layer.setAttribute(
          "transform",
          `translate(${String(shift)} 0) scale(${String(scale)} 1)`,
        );
      }
    }
    if (nodes.low !== null) {
      nodes.low.textContent = formatMz(target.low);
    }
    if (nodes.high !== null) {
      nodes.high.textContent = formatMz(target.high);
    }
    if (rangeRef.current !== null) {
      rangeRef.current.textContent = describeRange(current, target, t);
    }
  }, [t]);

  // React draws the published domain; later frames can still live only in the
  // controller. Rebase, then restore that live frame before any browser paint.
  useLayoutEffect(() => {
    const plot = plotRef.current;
    paintedNodes.current = {
      layer: plot?.querySelector<SVGGElement>(`g.${SPECTRUM_STICKS_LAYER}`) ?? null,
      low: plot?.querySelector<SVGTextElement>(`text.${SPECTRUM_AXIS_LOW}`) ?? null,
      high: plot?.querySelector<SVGTextElement>(`text.${SPECTRUM_AXIS_HIGH}`) ?? null,
    };
    paintedNodes.current.layer?.removeAttribute("transform");
    paintedRange.current = renderedMzDomain(state);
    paintTransientFrame(readState());
  });

  /**
   * The wheel, attached by hand because React's own listener is passive.
   *
   * Which is the whole reason the order below matters. Cancelling a wheel event
   * is a claim on it, and this panel sits inside a column that scrolls *and*
   * inside a panel that scrolls: a wheel cancelled and then not used is a wheel
   * that neither zoomed nor scrolled anything. So the claim is made **after**
   * the contract has said the gesture would move the axis, never before.
   *
   * Attached through a callback ref rather than an effect over `plotRef`, so
   * the listener follows the element rather than a snapshot of it: the drawing
   * is replaced when a viewport is refused, admitted or replaced, and an effect
   * that had already run would be holding a node no longer in the document.
   */
  const inputPort = mzInput(readState, dispatch);
  const input = usePlotInput({ port: inputPort,
    geometry: { width: SPECTRUM_PLOT_VIEWBOX_WIDTH, left: SPECTRUM_PLOT_PADDING_LEFT, drawnWidth: SPECTRUM_PLOT_DRAWN_WIDTH },
    paintFrame: () => paintTransientFrame(readState()) });
  const attachPlot = useCallback((node: SVGSVGElement | null) => {
    plotRef.current = node; input.attachPlot(node);
  }, [input.attachPlot]);

  const plans: Record<VisibleSpectrumViewportAction, SpectrumViewportActionPlan> = {
    "zoom-in": planSpectrumViewportAction(state, "zoom-in"),
    "zoom-out": planSpectrumViewportAction(state, "zoom-out"),
    reset: planSpectrumViewportAction(state, "reset"),
  };

  const shown = renderedMzDomain(state);
  const failure =
    state.status === "ready" && state.projection.status === "failed" ? state.projection : null;
  const drawn = state.status === "ready" ? drawnPoints(state) : EMPTY_POINTS;

  return (
    <div className="spectrum-viewport">
      <fieldset className="spectrum-viewport-actions">
        <legend className="visually-hidden">{t("rangeMzAxis")}</legend>
        {VISIBLE_SPECTRUM_VIEWPORT_ACTIONS.map(({ action }) => (
          <button
            className="secondary-button"
            disabled={!plans[action].available}
            key={action}
            onClick={() => {
              // Planned again against the live state, not against the
              // `disabled` this render computed. The state can move between the
              // render that drew the button and the press that reaches it -- a
              // settling gesture, a drawing arriving, another spectrum chosen.
              applySpectrumViewportAction(readState(), dispatch, action);
            }}
            type="button"
          >
            {t(action === "reset" ? "viewerMzReset" : action === "zoom-in" ? "viewerMzZoomIn" : "viewerMzZoomOut")}
          </button>
        ))}
      </fieldset>

      {state.status === "ready" ? (
        <div
          className="spectrum-viewport-plot"
        >
          <StickSpectrum
            drawing={drawingFor(state)}
            intensity={drawn.intensity}
            labelledBy={labelledBy}
            mz={drawn.mz}
            representationKnown={representationKnown}
            valueUnitsKnown={valueUnitsKnown}
            surface={{
              kind: "interactive",
              plotRef: attachPlot,
              describedBy: `${RANGE_ID} ${STATUS_ID}`,
              // From the planner that governs every other consumer of this
              // question, over the whole action set rather than the three with
              // buttons. A viewport that is admitted and inert is described but
              // not a tab stop.
              focusable: hasProductiveSpectrumViewportAction(state),
            }}
          />
        </div>
      ) : (
        // No viewport, and therefore nothing to drag, zoom or claim a wheel
        // for. The spectrum itself is unchanged: these are the points this
        // document received, drawn over the range they span, exactly as they
        // were before this panel had a viewport at all.
        <StickSpectrum
          drawing={{ kind: "transfer", reportedMzLow, reportedMzHigh }}
          intensity={intensity}
          labelledBy={labelledBy}
          mz={mz}
          representationKnown={representationKnown}
          valueUnitsKnown={valueUnitsKnown}
          surface={{ kind: "static" }}
        />
      )}

      {/* Not a live region. It changes on every frame of a drag, and a region
          that announced each of them would be noise rather than feedback. It is
          half of the plot's accessible description instead. */}
      <PlotRangeActions port={inputPort} />
      <p className="spectrum-viewport-range" id={RANGE_ID} ref={rangeRef}>
        {describeRange(state, shown, t)}
      </p>

      {/*
        One element doing both jobs: the visible account of what this viewport
        is doing, and the region that says so when it changes. A second hidden
        copy would be read twice by a reader traversing the panel, which is the
        duplicate-announcement debt this repository already carries once and
        must not gain again.

        `aria-live` without `role="status"`, which is this application's own
        shape for a region that is also its own visible text -- the figure
        settings' problem line is the same element doing the same two jobs. The
        role would additionally make this the *second* thing in the panel
        answering to `status`, beside the export result, and two regions with
        one name are two regions a reader cannot tell apart.

        One expression producing one string, and empty while a current drawing
        is on screen: a region whose text is added and removed as a sibling node
        is not reliably announced, and a region with nothing to say should say
        nothing.
      */}
      <p aria-live="polite" className="spectrum-viewport-status" id={STATUS_ID}>
        {describeViewport(state, projectionError, t)}
      </p>

      {failure?.retryable === true ? (
        <button className="secondary-button" onClick={onRetryProjection} type="button">
          {t("viewerMzRetry")}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Nothing to draw, as one shared value.
 *
 * A fresh `[]` each render would invalidate the drawing's memo on every pass,
 * which for a loading state is a reduction of nothing computed repeatedly.
 */
const EMPTY_POINTS: {
  readonly mz: readonly number[];
  readonly intensity: readonly number[];
} = { mz: Object.freeze([]), intensity: Object.freeze([]) };

/**
 * The points this render draws, and nothing beyond them.
 *
 * A drawing is current for the axes it is drawn under, or it is not shown at
 * all. The one state where a projection is drawn under a *different* range is a
 * gesture in progress, which says so in its own caption -- and even there the
 * points came from this spectrum's retained source, never from another
 * spectrum's.
 */
function drawnPoints(state: SpectrumViewportState & { readonly status: "ready" }): {
  readonly mz: readonly number[];
  readonly intensity: readonly number[];
} {
  return state.projection.status === "ready" ? state.projection.projection : EMPTY_POINTS;
}

/**
 * What the plot is drawing, in the terms the caption is allowed to use.
 *
 * The reducer's four projection states do not map onto four drawings, and the
 * one distinction that has to survive the collapse is **why** there is nothing
 * under the axes. `idle` and `loading` are a drawing on its way; `failed` is
 * not, and captioning it as one leaves a refusal describing itself as an
 * outstanding request -- for as long as it is on screen, since a non-retryable
 * failure never resolves into anything else.
 */
function drawingFor(state: SpectrumViewportState & { readonly status: "ready" }): SpectrumDrawing {
  const shown = renderedMzDomain(state) ?? state.full;
  if (state.projection.status !== "ready") {
    return {
      kind: "viewport-blank",
      low: shown.low,
      high: shown.high,
      reason: state.projection.status === "failed" ? "failed" : "pending",
    };
  }
  if (state.gesture !== null) {
    return { kind: "viewport-transient", low: shown.low, high: shown.high };
  }
  return {
    kind: "viewport",
    low: shown.low,
    high: shown.high,
    sourcePoints: state.projection.projection.sourcePoints,
    reduced: state.projection.projection.reduced,
  };
}

/**
 * What range is on screen, in one sentence.
 *
 * Written once and read twice: React renders it, and the gesture writer puts the
 * same sentence back on the same element while a drag is between publications.
 * Two copies of this wording would be two answers to the question the line
 * exists to answer.
 */
function describeRange(state: SpectrumViewportState, shown: MzDomain | null, t: UiMessage): string {
  if (shown === null) {
    return t("viewerMzNoRange");
  }
  const full = state.status === "ready" && isFullMzDomain(shown, state.full) ? t("viewerFullRange") : "";
  return t("viewerMzShowing", { low: formatMz(shown.low), high: formatMz(shown.high) }) + full;
}

/**
 * What the status region says, as one string.
 *
 * Every asynchronous state this surface can be in gets its own sentence, and
 * the ones that could be mistaken for one another are the ones written most
 * carefully. A window that truthfully holds no reported point is **not** a
 * spectrum with no peaks, is **not** a drawing that has not arrived, and is
 * **not** a failure; saying which of those it is, is most of this function's
 * job.
 *
 * Empty while a current drawing is on screen, because the drawing and its
 * caption have already said everything there is to say.
 */
function describeViewport(
  state: SpectrumViewportState,
  projectionError: PreviewError | null,
  t: UiMessage,
): string {
  if (state.status === "none") {
    return "";
  }
  if (state.status === "refused") {
    return `${t("viewerMzRefused")} ${t(REFUSED[state.reason.reason])}`;
  }
  switch (state.projection.status) {
    case "idle":
    case "loading": {
      // The window being asked for, which for `idle` is the one a request is
      // about to be made for. Never the gesture's: a gesture is a drawing
      // rather than a decision, and nothing is asked of Rust for one.
      const window =
        state.projection.status === "loading"
          ? state.projection.window
          : (state.committed ?? state.full);
      return t("viewerMzLoading", { low: formatMz(window.low), high: formatMz(window.high) });
    }
    case "failed":
      return projectionError === null
        ? t("viewerMzFailed")
        : projectionError.detail === null
          ? projectionError.summary
          : `${ownedErrorMessage(projectionError, t)} ${ownedErrorDetail(projectionError, t) ?? ""}`.trim();
    case "ready":
      return state.projection.projection.sourcePoints === 0
        ? t("viewerMzEmpty", { low: formatMz(state.projection.window.low), high: formatMz(state.projection.window.high) })
        : "";
  }
}
