import { useCallback, useEffect, useRef } from "react";

import type { PreviewError, SpectrumDomainRefusal } from "./contracts";
import { formatMz } from "./format";
import type { SpectrumDrawing } from "./StickSpectrum";
import {
  SPECTRUM_PLOT_DRAWN_WIDTH,
  SPECTRUM_PLOT_PADDING_LEFT,
  SPECTRUM_PLOT_VIEWBOX_WIDTH,
  StickSpectrum,
} from "./StickSpectrum";
import type { MzDomain, SpectrumViewportEvent, SpectrumViewportState } from "./viewer/spectrumViewport";
import {
  activeMzGestureEpoch,
  isFullMzDomain,
  panMzDomain,
  renderedMzDomain,
} from "./viewer/spectrumViewport";
import type {
  SpectrumViewportActionPlan,
  VisibleSpectrumViewportAction,
} from "./viewer/spectrumViewportAction";
import {
  applySpectrumViewportAction,
  planMzWheelGesture,
  planRenderedMzTransition,
  planSpectrumViewportAction,
  VISIBLE_SPECTRUM_VIEWPORT_ACTIONS,
} from "./viewer/spectrumViewportAction";
import { normalizeWheelDelta } from "./viewer/wheelInput";

/**
 * How long after the last wheel event the gesture is asked to settle.
 *
 * A wheel is a stream of events with no end signal, so something has to decide
 * when it stopped. The chromatogram's 120ms, deliberately: the two plots are
 * one interaction language, and a reader who has learned how long a zoom takes
 * to commit on one should not have to learn a different number for the other.
 *
 * Whether the settle still means anything is the reducer's decision rather than
 * a race between `clearTimeout` and a callback -- which is why cancelling the
 * timer below is an efficiency and never a correctness measure.
 */
const SETTLE_DELAY_MS = 120;

/**
 * How far a pointer may move before a press becomes a pan.
 *
 * A press that has not travelled sideways is not a pan: without a threshold a
 * one-pixel tremor would start a gesture, and a gesture publishes an epoch and
 * eventually a committed window and a request for a drawing of it.
 *
 * Unlike the chromatogram there is nothing on the other side of the threshold.
 * A press that never passes it does nothing at all, because a click on a
 * spectrum selects nothing -- the scan is chosen on the chromatogram and in the
 * table, and inventing a peak, ion or annotation selection here would be new
 * product semantics rather than a viewport.
 */
const DRAG_SLOP = 4;

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
const REFUSED: Record<SpectrumDomainRefusal, string> = {
  sourceNotOrdered:
    "This spectrum's m/z values do not increase from one point to the next, and nothing here " +
    "sorts them: a sorted copy would be a different measurement. The points below are drawn in " +
    "the order the file reports them.",
  notFinite:
    "This spectrum reports an m/z or an intensity that cannot be placed on an axis, so there is " +
    "no range to navigate.",
  axisLengthMismatch:
    "This spectrum reports a different number of m/z values and intensity values, so there is no " +
    "range to navigate.",
  domainUnusable:
    "This spectrum's m/z values do not span a range MSCanvas can divide an axis by, so there is " +
    "no range to navigate.",
  valueDomainUnusable:
    "This spectrum's intensity values do not span a range MSCanvas can divide an axis by, so " +
    "there is no range to navigate.",
};

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
  labelledBy,
}: SpectrumViewportProps) {
  const plotRef = useRef<SVGSVGElement | null>(null);

  /**
   * The press that owns this plot, if one does.
   *
   * Its own starting domain is kept so every later move is computed from the
   * origin rather than from the previous move -- the same pan arrived at by a
   * different route accumulates no drift, and a frame the browser coalesced
   * away costs nothing.
   *
   * **One pointer owns the lifecycle until that same pointer ends it.** Every
   * pointer that is not the owner is ignored entirely: no capture, no dispatch,
   * and above all no clearing of this record. Ownership is local to this
   * adapter and deliberately not in the viewport state, which knows about
   * gestures and epochs rather than about fingers.
   */
  const drag = useRef<{
    readonly pointerId: number;
    /**
     * Which spectrum this press was begun on.
     *
     * A press outlives a selection: a reader can hold the button while a scan
     * arrives from the table, the chromatogram or the Previous/Next steps. The
     * gesture itself is protected by its epoch -- a `gesture-moved` for an epoch
     * the new context never issued is a no-op by identity -- but a press that
     * has not yet started one carries no epoch to be refused by, and its
     * `start` is the *previous* spectrum's window. Left unchecked it pans the
     * new spectrum to a range taken from the old one's, which is a viewport
     * nobody navigated.
     */
    readonly spectrumToken: string;
    readonly originX: number;
    readonly start: MzDomain;
    /**
     * The gesture this press owns, once it has started one.
     *
     * `null` until the press has travelled past the threshold *and* the travel
     * would move the range. Both have to be true, so this is the flag as well
     * as the address: a press with no epoch has published nothing, and settles
     * nothing when it is released.
     */
    epoch: number | null;
  } | null>(null);

  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSettle = useCallback(
    (epoch: number | null) => {
      if (settleTimer.current !== null) {
        clearTimeout(settleTimer.current);
        settleTimer.current = null;
      }
      if (epoch === null) {
        return;
      }
      settleTimer.current = setTimeout(() => {
        settleTimer.current = null;
        dispatch({ type: "gesture-settled", epoch });
      }, SETTLE_DELAY_MS);
    },
    [dispatch],
  );
  useEffect(
    () => () => {
      if (settleTimer.current !== null) {
        clearTimeout(settleTimer.current);
      }
    },
    [],
  );

  /**
   * Where a client x falls across the drawn area, as a fraction of it.
   *
   * The one mapping from a screen coordinate into the plot, so a wheel's anchor
   * and a drag's displacement cannot come to disagree about where the pointer
   * is. `null` when there is nothing measurable on screen, which each caller
   * answers in its own terms.
   */
  const plotFractionAt = useCallback((clientX: number): number | null => {
    const element = plotRef.current;
    if (element === null) {
      return null;
    }
    const box = element.getBoundingClientRect();
    if (box.width === 0) {
      return null;
    }
    const viewBoxX = ((clientX - box.left) / box.width) * SPECTRUM_PLOT_VIEWBOX_WIDTH;
    return clamp01((viewBoxX - SPECTRUM_PLOT_PADDING_LEFT) / SPECTRUM_PLOT_DRAWN_WIDTH);
  }, []);

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
  const onWheel = useCallback(
    (event: WheelEvent) => {
      /*
       * A press owns the gesture, and this one is not it.
       *
       * `planMzWheelGesture` reads the active epoch out of the state, so a wheel
       * arriving mid-drag would join the *pan's* gesture -- and then this
       * adapter's timer would settle someone else's gesture, after which every
       * later pointer move carries a dead epoch and the pan freezes until the
       * button comes up. Whatever the wheel asked for would be overwritten by
       * the next pan move anyway, which is computed from where the press began.
       * So it is not this panel's event: nothing is cancelled, nothing
       * dispatched, nothing scheduled, and the pan is left exactly as it was.
       */
      if (drag.current !== null) {
        return;
      }
      /*
       * Both numbers the event carries, and nothing else about it. `deltaY` is
       * not a length until `deltaMode` says what its unit is, so neither is read
       * without the other. `ctrlKey` is deliberately not read: this panel has no
       * pinch semantics, and treating a modifier as one would be a guess about
       * the hardware rather than a reading of it.
       */
      const wheel = { deltaY: event.deltaY, deltaMode: event.deltaMode };
      // Asked before anything is measured. An event this panel cannot read is
      // not worth a layout, and the answer is the one the planner would give.
      if (normalizeWheelDelta(wheel) === null) {
        return;
      }
      const current = readState();
      // The centre when there is nothing to measure against, which is the same
      // anchor a keyboard zoom uses and the only honest guess available.
      const anchor = plotFractionAt(event.clientX) ?? 0.5;
      const plan = planMzWheelGesture(current, wheel, anchor);
      if (plan.event === null) {
        // Not ours. The spectrum cannot go any further this way, so the browser
        // keeps the event and the column can still be scrolled with it. Nothing
        // is dispatched either: an input this panel did not consume must not
        // leave a gesture, or an epoch, behind.
        return;
      }
      event.preventDefault();
      // The epoch is the reducer's to hand out. An adapter that allocated one
      // could address a gesture that is not its own, which is exactly the race
      // an epoch exists to remove.
      scheduleSettle(activeMzGestureEpoch(dispatch(plan.event)));
    },
    [dispatch, plotFractionAt, readState, scheduleSettle],
  );

  const attachPlot = useCallback(
    (node: SVGSVGElement | null) => {
      const previous = plotRef.current;
      if (previous !== null) {
        previous.removeEventListener("wheel", onWheel);
      }
      plotRef.current = node;
      if (node !== null) {
        node.addEventListener("wheel", onWheel, { passive: false });
      }
    },
    [onWheel],
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // Someone already has it. A second pointer is not a second gesture, and it
    // may not take the first one's place, its capture, or its record.
    if (drag.current !== null) {
      return;
    }
    if (event.button !== 0) {
      return;
    }
    const current = readState();
    const shown = renderedMzDomain(current);
    if (current.status !== "ready" || shown === null) {
      return;
    }
    drag.current = {
      pointerId: event.pointerId,
      spectrumToken: current.spectrumToken,
      originX: event.clientX,
      start: shown,
      epoch: null,
    };
    // Capture so a pan that leaves the plot keeps being a pan. Guarded because
    // it is the one part of this gesture not every environment implements, and
    // a drag that stops tracking outside the element is far better than a plot
    // that cannot be pressed at all.
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (active === null || active.pointerId !== event.pointerId) {
      // Nobody is pressing, or a pointer that is not the owner. Neither is a
      // pan, and neither publishes anything: the spectrum has no hover to move.
      return;
    }
    const moved = event.clientX - active.originX;
    if (active.epoch === null && Math.abs(moved) < DRAG_SLOP) {
      return;
    }
    const element = plotRef.current;
    const box = element?.getBoundingClientRect();
    const drawnWidth =
      box === undefined
        ? 0
        : (SPECTRUM_PLOT_DRAWN_WIDTH / SPECTRUM_PLOT_VIEWBOX_WIDTH) * box.width;
    const current = readState();
    // The spectrum this press was begun on, still selected. Not cleared here:
    // the record is what stops a second pointer taking the plot, and a press
    // that has lost its spectrum still owns the press until its own pointer
    // ends it -- it simply has nothing left to move.
    if (current.status !== "ready" || current.spectrumToken !== active.spectrumToken) {
      return;
    }
    const full = current.full;
    // From the press origin, never from the previous frame. The same pan
    // arrived at by a different route lands on the same window.
    const next = panMzDomain(active.start, full, drawnWidth === 0 ? 0 : -moved / drawnWidth);
    if (active.epoch !== null) {
      dispatch({ type: "gesture-moved", epoch: active.epoch, domain: next });
      return;
    }
    // The same rule the wheel and the buttons follow, asked before a gesture
    // exists rather than after. A drag at the edge of the spectrum -- or over a
    // spectrum whose whole domain is one m/z -- has nowhere to go, and starting
    // a gesture for it would allocate an epoch, settle it, commit a window
    // identical to the one already committed, and ask Rust to draw it again.
    // A pan that moves nothing asks for nothing.
    if (!planRenderedMzTransition(current, { type: "gesture-started", domain: next }).changed) {
      return;
    }
    active.epoch = activeMzGestureEpoch(dispatch({ type: "gesture-started", domain: next }));
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    // Read before anything is cleared. A stray pointer's release ends nothing:
    // it must not drop the owner's record, and must not hand the wheel back
    // while the owner is still pressing.
    if (active === null || active.pointerId !== event.pointerId) {
      return;
    }
    drag.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId) === true) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    if (active.epoch !== null) {
      dispatch({ type: "gesture-settled", epoch: active.epoch });
    }
    // A press that never passed the threshold committed nothing and selects
    // nothing. The spectrum plot is not the chromatogram's scan-selection
    // surface, and a click here has no meaning to invent.
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    // The owner check comes before the clearing, for the same reason it does on
    // release: a cancelled second contact cancels nothing here.
    if (active === null || active.pointerId !== event.pointerId) {
      return;
    }
    drag.current = null;
    if (active.epoch === null) {
      return;
    }
    // Abandoned rather than committed: what the user was in the middle of doing
    // is discarded, and the committed window is untouched.
    dispatch({ type: "gesture-cancelled", epoch: active.epoch });
  };

  const handleKeyDown = (event: React.KeyboardEvent<SVGSVGElement>) => {
    const current = readState();
    let taken = false;
    switch (event.key) {
      case "+":
      case "=":
        taken = applySpectrumViewportAction(current, dispatch, "zoom-in");
        break;
      case "-":
      case "_":
        taken = applySpectrumViewportAction(current, dispatch, "zoom-out");
        break;
      case "ArrowLeft":
        taken = applySpectrumViewportAction(current, dispatch, "pan-left");
        break;
      case "ArrowRight":
        taken = applySpectrumViewportAction(current, dispatch, "pan-right");
        break;
      case "Home":
      case "0":
        taken = applySpectrumViewportAction(current, dispatch, "reset");
        break;
      default:
        // Every other key belongs to the page: Tab, Escape and the browser's own
        // shortcuts are not this plot's to swallow.
        return;
    }
    if (!taken) {
      // The same rule the wheel follows, and for the same reason. At the edge of
      // the spectrum this key changes nothing, so it is not this panel's input
      // and the surface it sits in keeps it.
      return;
    }
    event.preventDefault();
  };

  /**
   * What each visible control would do, planned from the state this render is
   * drawing.
   *
   * Three bounded projections per render, and nothing a pointer frame touches.
   */
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
        <legend className="visually-hidden">m/z range</legend>
        {VISIBLE_SPECTRUM_VIEWPORT_ACTIONS.map(({ action, label }) => (
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
            {label}
          </button>
        ))}
      </fieldset>

      {state.status === "ready" ? (
        <div
          className="spectrum-viewport-plot"
          onPointerCancel={handlePointerCancel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <StickSpectrum
            drawing={drawingFor(state)}
            intensity={drawn.intensity}
            labelledBy={labelledBy}
            mz={drawn.mz}
            representationKnown={representationKnown}
            surface={{
              kind: "interactive",
              plotRef: attachPlot,
              describedBy: `${RANGE_ID} ${STATUS_ID}`,
              onKeyDown: handleKeyDown,
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
          surface={{ kind: "static" }}
        />
      )}

      {/* Not a live region. It changes on every frame of a drag, and a region
          that announced each of them would be noise rather than feedback. It is
          half of the plot's accessible description instead. */}
      <p className="spectrum-viewport-range" id={RANGE_ID}>
        {shown === null
          ? "No m/z range to navigate."
          : `Showing m/z ${formatMz(shown.low)} to ${formatMz(shown.high)}${
              state.status === "ready" && isFullMzDomain(shown, state.full)
                ? " (full range)"
                : ""
            }`}
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
        {describeViewport(state, projectionError)}
      </p>

      {failure?.retryable === true ? (
        <button className="secondary-button" onClick={onRetryProjection} type="button">
          Draw this m/z range again
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

/** What the plot is drawing, in the terms the caption is allowed to use. */
function drawingFor(state: SpectrumViewportState & { readonly status: "ready" }): SpectrumDrawing {
  const shown = renderedMzDomain(state) ?? state.full;
  if (state.projection.status !== "ready") {
    return { kind: "viewport-pending", low: shown.low, high: shown.high };
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
): string {
  if (state.status === "none") {
    return "";
  }
  if (state.status === "refused") {
    return `The m/z range of this spectrum cannot be navigated. ${REFUSED[state.reason.reason]}`;
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
      return `Drawing m/z ${formatMz(window.low)} to ${formatMz(window.high)} from the retained spectrum. Nothing is drawn here until it arrives.`;
    }
    case "failed":
      return projectionError === null
        ? "This m/z range could not be drawn."
        : projectionError.detail === null
          ? projectionError.summary
          : `${projectionError.summary} ${projectionError.detail}`;
    case "ready":
      return state.projection.projection.sourcePoints === 0
        ? `This spectrum reports no measured point between m/z ${formatMz(state.projection.window.low)} and ${formatMz(state.projection.window.high)}. That is what the file says about this range, not a drawing that failed.`
        : "";
  }
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
}
