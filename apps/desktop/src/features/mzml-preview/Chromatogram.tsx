import { memo, useCallback, useEffect, useMemo, useRef } from "react";

import { formatCount, formatIntensity } from "./format";
import type {
  ViewerEvent,
  ViewerInteractionState,
} from "./viewer/interactionState";
import { activeGestureEpoch, renderedDomain } from "./viewer/interactionState";
import type { ValueExtent, VisibleVertex } from "./viewer/renderGeometry";
import { clipTrace, reduceVisible, visibleExtent } from "./viewer/renderGeometry";
import type {
  RetentionTimeDomain,
  ScanModel,
  ScanModelRefusal,
  ScanPoint,
  TraceKind,
} from "./viewer/scanModel";
import { nearestScan } from "./viewer/scanModel";
import { panDomain } from "./viewer/viewport";
import type { ViewportAction } from "./viewer/viewportAction";
import {
  applyViewportAction,
  planViewportAction,
  planWheelGesture,
} from "./viewer/viewportAction";
import { normalizeWheelDelta } from "./viewer/wheelInput";
import type { TraceVisibility } from "./usePreviewWorkspace";

/**
 * The drawing area, in viewBox units. The element scales to its container, so
 * these are resolution units rather than pixels -- the same approach the stick
 * spectrum takes.
 */
const PLOT_WIDTH = 1000;
const PLOT_HEIGHT = 210;
const PADDING_LEFT = 64;
const PADDING_RIGHT = 12;
const PADDING_TOP = 12;
const BASELINE_Y = PLOT_HEIGHT - 30;
const USABLE_WIDTH = PLOT_WIDTH - PADDING_LEFT - PADDING_RIGHT;
const USABLE_HEIGHT = BASELINE_Y - PADDING_TOP;

/** How far a pointer may move between press and release and still be a click. */
const CLICK_SLOP = 4;

/** What one pan step moves, as a fraction of the visible span. */
const PAN_STEP = 0.25;

/**
 * How long after the last wheel event the gesture is asked to settle.
 *
 * A wheel is a stream of events with no end signal, so something has to decide
 * when it stopped. That is all this is: an adapter that eventually emits
 * `gesture-settled` for the epoch it was scheduled under. Whether that settle
 * still means anything is the reducer's decision, not a race between
 * `clearTimeout` and a callback -- which is why cancelling the timer below is
 * an efficiency and never a correctness measure.
 */
const SETTLE_DELAY_MS = 120;

const TRACES: readonly {
  readonly trace: TraceKind;
  readonly label: string;
  /** The dash pattern, so the two traces are told apart without colour. */
  readonly dash: string | undefined;
  /**
   * The radius of the point this trace draws when it has one visible vertex.
   *
   * Two sizes rather than one, and the stylesheet fills one and leaves the
   * other open. A run of a single scan can carry the same value in both series
   * -- a scan whose total ion current *is* its base peak -- and the two marks
   * then land on the same coordinate. A filled disc inside an open ring is
   * still two marks, told apart by fill and size rather than by colour, which
   * is the same rule the solid and dashed lines follow.
   */
  readonly pointRadius: number;
}[] = [
  { trace: "tic", label: "TIC", dash: undefined, pointRadius: 4 },
  { trace: "bpc", label: "BPC", dash: "7 4", pointRadius: 7.5 },
];

/**
 * The visible viewport controls, in the order they are offered.
 *
 * One list so the three share a rule rather than three call sites that could
 * drift -- which is how `Reset range` came to be the only one of them telling
 * the truth about being inert.
 */
const VIEWPORT_CONTROLS: readonly {
  readonly action: ViewportAction;
  readonly label: string;
}[] = [
  { action: "zoom-in", label: "Zoom in" },
  { action: "zoom-out", label: "Zoom out" },
  { action: "reset", label: "Reset range" },
];

export interface ChromatogramProps {
  readonly model: ScanModel;
  /** The one interaction state. This component holds no part of it. */
  readonly interaction: ViewerInteractionState;
  readonly dispatch: (event: ViewerEvent) => ViewerInteractionState;
  /** The same state, for a listener that runs between renders. */
  readonly readInteraction: () => ViewerInteractionState;
  readonly traces: TraceVisibility;
  readonly onToggleTrace: (trace: TraceKind) => void;
  /** The one selected-spectrum operation, which the table and the steps share. */
  readonly onSelect: (index: number) => void;
}

/**
 * The run's shape over retention time, and the surface a scan is chosen on.
 *
 * Every semantic decision this component appears to make belongs to somewhere
 * else, and that is the point of it. What range is drawn is
 * `renderedDomain(state)`; which scan a click means is `nearestScan` over the
 * full model; what the value axis says is `visibleExtent` over the *clipped*
 * polyline; what a hover is worth after the axis moves is the reducer's
 * finalizer. This file turns browser events into the events that contract
 * names, and draws the result.
 *
 * Memoized. Its own props change on a hover, which is the one thing about this
 * viewer that happens at pointer frequency -- so this boundary is not what
 * keeps the cursor cheap. It is here so that everything else the workspace
 * re-renders for -- a conversion poll, a roster reply, a figure setting -- does
 * not redraw a trace that has not changed.
 */
export const Chromatogram = memo(function Chromatogram({
  model,
  interaction,
  dispatch,
  readInteraction,
  traces,
  onToggleTrace,
  onSelect,
}: ChromatogramProps) {
  const domain = renderedDomain(interaction);
  const full = interaction.fullDomain;
  /**
   * Whether the caption says "(full range)".
   *
   * A projection for a sentence, kept apart from what the buttons may claim.
   * Both ask about the range, and it was tempting to let one answer serve both
   * -- but "the whole run is on screen" and "this control would change what is
   * on screen" are different questions, and the second is now one rule shared
   * by three controls.
   */
  const showingFullRange =
    domain === null ||
    full === null ||
    (domain.low <= full.low && domain.high >= full.high);

  /**
   * What each visible viewport control would do, planned from the state this
   * render is drawing.
   *
   * Three bounded projections per render, and nothing a pointer frame touches.
   */
  const viewportPlans = {
    "zoom-in": planViewportAction(interaction, "zoom-in"),
    "zoom-out": planViewportAction(interaction, "zoom-out"),
    reset: planViewportAction(interaction, "reset"),
  } as const;

  return (
    <section aria-labelledby="chromatogram-heading" className="panel chromatogram-panel">
      {/* One line, and every control on it. The viewer is three stacked panels
          in a column that is about 480px tall at a 768px window, so what this
          panel spends on chrome it takes from the scan table and the spectrum
          below it. A locator earns less of that than the things being read,
          which is why the source sentence lives under the plot with the axis
          rather than as a second header line. */}
      <header className="panel-header compact">
        <h2 id="chromatogram-heading">Chromatogram</h2>
        {model.status === "ready" ? (
          <div className="chromatogram-controls">
            <fieldset className="chromatogram-traces">
              {/* Named for a screen reader without spending a line on it. A
                  group of controls still has to say what it groups. */}
              <legend className="visually-hidden">Traces</legend>
              {TRACES.map(({ trace, label, dash }) => (
                <label className="chromatogram-trace-toggle" key={trace}>
                  <input
                    checked={traces[trace]}
                    onChange={() => {
                      onToggleTrace(trace);
                    }}
                    type="checkbox"
                  />
                  <span>
                    {label}
                    {/* The same dash pattern the trace is drawn with, so the
                        legend distinguishes the two without asking anyone to
                        compare colours. */}
                    <svg aria-hidden="true" className="chromatogram-swatch" viewBox="0 0 24 8">
                      <path d="M 1 4 L 23 4" strokeDasharray={dash} />
                    </svg>
                  </span>
                </label>
              ))}
            </fieldset>
            <fieldset className="chromatogram-viewport-actions">
              <legend className="visually-hidden">Range</legend>
              {VIEWPORT_CONTROLS.map(({ action, label }) => (
                <button
                  className="secondary-button"
                  disabled={!viewportPlans[action].available}
                  key={action}
                  onClick={() => {
                    // Planned again against the live state, not against the
                    // `disabled` this render computed.
                    applyViewportAction(readInteraction(), dispatch, action);
                  }}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </fieldset>
          </div>
        ) : null}
      </header>
      <div className="chromatogram-body">
        {model.status === "ready" && domain !== null && full !== null ? (
          <ChromatogramPlot
            dispatch={dispatch}
            domain={domain}
            full={full}
            hover={interaction.hover?.spectrumIndex ?? null}
            onSelect={onSelect}
            points={model.points}
            readInteraction={readInteraction}
            selected={interaction.selection?.index ?? null}
            traces={traces}
            showingFullRange={showingFullRange}
          />
        ) : model.status === "ready" ? (
          // The model is read and the interaction has not adopted it yet. The
          // workspace announces a loaded run in a layout effect, so this is
          // never painted; it exists because a component may not choose a range
          // the contract has not published.
          <p className="chromatogram-axis-caption">Preparing the retention-time range…</p>
        ) : (
          <div className="empty-state">
            <strong>{UNAVAILABLE[model.reason].summary}</strong>
            <span>{UNAVAILABLE[model.reason].detail}</span>
          </div>
        )}
      </div>
    </section>
  );
})

/**
 * Why there is no chromatogram, in the words the panel says it.
 *
 * Each names what happened rather than that something did. A truncation in
 * particular has to be readable as a property of this preview, because the scan
 * table beside it is on screen and does show rows.
 */
const UNAVAILABLE: Record<
  ScanModelRefusal,
  { readonly summary: string; readonly detail: string }
> = {
  truncated: {
    summary: "TIC and BPC are unavailable for this preview.",
    detail:
      "They are drawn from the spectrum table, and this preview did not load the complete " +
      "table. Drawing the rows it did load would be a chromatogram of part of the run " +
      "presented as the whole of it.",
  },
  "no-spectra": {
    summary: "This run has no spectra.",
    detail: "There is nothing to draw a retention-time trace from.",
  },
  "unusable-retention-time": {
    summary: "TIC and BPC are unavailable for this preview.",
    detail: "A scan reported a retention time that cannot be placed on an axis.",
  },
  "unusable-intensity": {
    summary: "TIC and BPC are unavailable for this preview.",
    detail: "A scan reported a total ion current or base peak intensity that cannot be drawn.",
  },
  "unsupported-retention-time-unit": {
    summary: "TIC and BPC are unavailable for this preview.",
    detail:
      "This preview reports a retention-time unit state that this build cannot identify " +
      "precisely, so the traces are not drawn. Nothing is wrong with the file: what MSCanvas " +
      "receives says that a unit was reported without saying which, and an axis cannot be " +
      "labelled with a unit that was never named.",
  },
};

interface PlotProps {
  readonly points: readonly ScanPoint[];
  readonly domain: RetentionTimeDomain;
  readonly full: RetentionTimeDomain;
  readonly traces: TraceVisibility;
  readonly selected: number | null;
  readonly hover: number | null;
  readonly showingFullRange: boolean;
  readonly dispatch: (event: ViewerEvent) => ViewerInteractionState;
  readonly readInteraction: () => ViewerInteractionState;
  readonly onSelect: (index: number) => void;
}

function ChromatogramPlot({
  points,
  domain,
  full,
  traces,
  selected,
  hover,
  showingFullRange,
  dispatch,
  readInteraction,
  onSelect,
}: PlotProps) {
  const plotRef = useRef<SVGSVGElement | null>(null);

  const activeTraces = useMemo(
    () => TRACES.filter((each) => traces[each.trace]),
    [traces],
  );

  /*
   * The pipeline, in the order that is the contract.
   *
   * Clip the full source scans to the viewport first; take the value extent
   * from what clipping produced; only then reduce for the screen. PR #72 took
   * the extent from a source window that deliberately included one scan outside
   * each edge, so a peak that was entirely clipped away could set the axis --
   * and zooming into the valley after a tall peak, the most ordinary thing
   * anyone does with a chromatogram, flattened every visible feature and
   * labelled the axis with a number that was not on screen.
   */
  const clipped = useMemo(
    () =>
      activeTraces.map((each) => ({
        ...each,
        vertices: clipTrace(points, each.trace, domain),
      })),
    [activeTraces, domain, points],
  );

  const extent = useMemo(
    () => visibleExtent(clipped.map((each) => each.vertices)),
    [clipped],
  );

  const drawn = useMemo(
    () =>
      clipped.map((each) => ({
        ...each,
        vertices: reduceVisible(each.vertices, domain),
      })),
    [clipped, domain],
  );

  const scale = useMemo(() => scaleFor(domain, extent), [domain, extent]);

  /**
   * How each active trace is painted: as a line, or as the one point it is.
   *
   * A trace has three drawing cardinalities, and only two of them are a
   * polyline. No visible vertex draws nothing. Two or more draw the joined path
   * -- one node per trace, because a node per scan would be 36,319 elements for
   * the repository's representative acquisition. **One** visible vertex is the
   * degenerate case, and it is a real one: a complete acquisition of a single
   * spectrum has a correct value and a correct axis, and `M x y` alone strokes
   * nothing, so the panel drew a labelled axis over an empty plot for a run that
   * had a measurement.
   *
   * The point is painted at exactly that vertex's own coordinate. Nothing
   * invents a second x to give an SVG line command a length: a horizontal
   * segment across the plot would be a retention-time extent this run does not
   * have, and would read as a scan that lasted.
   *
   * The glyph is rendering geometry and only that. It creates no `ScanPoint`,
   * changes no `VisibleVertex`, is never resolved against by `nearestScan`, and
   * does not touch the extent. It is how one vertex that already exists is
   * painted.
   */
  const marks = useMemo(
    () =>
      drawn.map((each) => {
        const only = each.vertices.length === 1 ? each.vertices[0] : undefined;
        return {
          trace: each.trace,
          dash: each.dash,
          pointRadius: each.pointRadius,
          point:
            only === undefined
              ? null
              : { x: scale.x(only.retentionTime), y: scale.y(only.value) },
          d: only === undefined ? pathOf(each.vertices, scale) : "",
        };
      }),
    [drawn, scale],
  );

  /**
   * Every scan by its own index.
   *
   * Built once per run. The selection and the hover both name a scan, and both
   * have to be drawn where that scan actually is -- from the full model, and
   * never from a reduced vertex or a boundary intersection, neither of which is
   * a scan.
   */
  const byIndex = useMemo(() => {
    const map = new Map<number, ScanPoint>();
    for (const point of points) {
      map.set(point.spectrumIndex, point);
    }
    return map;
  }, [points]);

  const selectedPoint = selected === null ? null : (byIndex.get(selected) ?? null);
  const hoveredPoint = hover === null ? null : (byIndex.get(hover) ?? null);

  /**
   * Where a client x falls across the drawn area, as a fraction of it.
   *
   * The one mapping from a screen coordinate into the plot, so the scan a hover
   * resolves to and the retention time a wheel holds under the pointer cannot
   * come to disagree about where the pointer is. `null` when there is nothing
   * measurable on screen, which each caller answers in its own terms.
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
    const viewBoxX = ((clientX - box.left) / box.width) * PLOT_WIDTH;
    return clamp01((viewBoxX - PADDING_LEFT) / USABLE_WIDTH);
  }, []);

  /** The retention time under a pointer, read against the range on screen now. */
  const retentionTimeAt = useCallback(
    (clientX: number): number | null => {
      const fraction = plotFractionAt(clientX);
      if (fraction === null) {
        return null;
      }
      const shown = renderedDomain(readInteraction());
      if (shown === null) {
        return null;
      }
      return shown.low + fraction * (shown.high - shown.low);
    },
    [plotFractionAt, readInteraction],
  );

  /**
   * The pointer's own coordinates, which never leave this file.
   *
   * What crosses into the contract is the scan the pointer resolved to, and
   * establishing the same one again is a no-op by identity -- so this may
   * dispatch on every frame without any consumer re-rendering. What reaches the
   * state is the pointer crossing from one scan to another, bounded by the run
   * rather than by the pointer's sampling rate.
   */
  const showHover = useCallback(
    (clientX: number) => {
      const retentionTime = retentionTimeAt(clientX);
      if (retentionTime === null) {
        return;
      }
      const scan = nearestScan(points, retentionTime);
      if (scan === null) {
        return;
      }
      dispatch({ type: "hover-established", spectrumIndex: scan.spectrumIndex });
    },
    [dispatch, points, retentionTimeAt],
  );

  /**
   * The wheel's settle, scheduled under the epoch the reducer assigned.
   *
   * Resetting the timer keeps a long scroll from committing halfway through it.
   * Correctness does not rest on that: a settle whose epoch has been cancelled,
   * superseded or invalidated is the very state it was given, by identity.
   */
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
   * A press that has not travelled yet.
   *
   * It may still become a click, so nothing is dispatched until it passes the
   * slop threshold. Its own starting domain is kept so every later move is
   * computed from the origin rather than from the previous move -- the same pan
   * arrived at by a different route accumulates no drift.
   */
  const drag = useRef<{
    readonly pointerId: number;
    readonly originX: number;
    readonly originY: number;
    readonly start: RetentionTimeDomain;
    epoch: number | null;
    moved: boolean;
  } | null>(null);

  /*
   * Attached by hand because React's own wheel listener is passive, so
   * `preventDefault` inside `onWheel` could not stop the page scrolling under a
   * zoom gesture.
   *
   * Which is the whole reason the order below matters. Cancelling a wheel event
   * is a claim on it, and this panel sits at the top of a column that scrolls:
   * a wheel cancelled and then not used is a wheel that neither zoomed nor
   * scrolled. So the claim is made *after* the contract has said the gesture
   * would move the axis, never before.
   *
   * Two questions, kept apart. `wheelInput.ts` decides **how much** the event
   * asks for, from its own magnitude and unit; the planner decides **whether
   * this viewer owns it**, which is unchanged. A large delta at a boundary is
   * still not ours, and a small one that moves the axis still is.
   */
  useEffect(() => {
    const element = plotRef.current;
    if (element === null) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      /*
       * Both numbers the event carries, and nothing else about it.
       *
       * `deltaY` is not a length until `deltaMode` says what its unit is, so
       * neither is read without the other. `ctrlKey` is deliberately not read:
       * this viewer has no pinch semantics, and treating a modifier as one
       * would be a guess about the hardware rather than a reading of it.
       */
      /*
       * A press owns the gesture, and this one is not it.
       *
       * `planWheelGesture` reads the active epoch out of the state, so a wheel
       * arriving mid-pan would join the *pan's* gesture -- and then this
       * adapter's 120ms timer would settle someone else's gesture, after which
       * every later pointer move carries a dead epoch and the pan freezes until
       * the button comes up. Whatever the wheel asked for would be overwritten
       * by the next pan move anyway, which is computed from where the press
       * began. So it is not this viewer's event: nothing is cancelled, nothing
       * dispatched, nothing scheduled, and the pan is left exactly as it was.
       */
      if (drag.current !== null) {
        return;
      }
      const wheel = { deltaY: event.deltaY, deltaMode: event.deltaMode };
      // Asked before anything is measured. An event this viewer cannot read is
      // not worth a layout, and the answer is the same one the planner would
      // give -- the same helper, asked the same question.
      if (normalizeWheelDelta(wheel) === null) {
        return;
      }
      const state = readInteraction();
      // The centre when there is nothing to measure against, which is the same
      // anchor a keyboard zoom uses and the only honest guess available.
      const anchor = plotFractionAt(event.clientX) ?? 0.5;
      const plan = planWheelGesture(state, wheel, anchor);
      if (plan.event === null) {
        // Not ours. The run cannot go any further this way, so the browser
        // keeps the event and the column below can still be scrolled with it.
        // Nothing is dispatched either: an input this viewer did not consume
        // must not leave a gesture, or an epoch, behind.
        return;
      }
      event.preventDefault();
      // The epoch is the reducer's to hand out. An adapter that allocated one
      // could address a gesture that is not its own, which is exactly the race
      // an epoch exists to remove.
      scheduleSettle(activeGestureEpoch(dispatch(plan.event)));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", onWheel);
    };
  }, [dispatch, plotFractionAt, readInteraction, scheduleSettle]);

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) {
      return;
    }
    const shown = renderedDomain(readInteraction());
    if (shown === null) {
      return;
    }
    drag.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      start: shown,
      epoch: null,
      moved: false,
    };
    // Capture so a pan that leaves the plot keeps being a pan. Guarded because
    // it is the one part of this gesture not every environment implements, and
    // a drag that stops tracking outside the element is far better than a plot
    // that cannot be pressed at all.
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const active = drag.current;
    if (active === null || active.pointerId !== event.pointerId) {
      showHover(event.clientX);
      return;
    }
    const moved = event.clientX - active.originX;
    // A press that has not travelled sideways is not a pan. Without a threshold
    // a one-pixel tremor between press and release would pan instead of select;
    // whether the release is still a *click* is decided at pointer up, against
    // travel in both directions.
    if (!active.moved && Math.abs(moved) < CLICK_SLOP) {
      return;
    }
    const box = event.currentTarget.getBoundingClientRect();
    const drawnWidth = (USABLE_WIDTH / PLOT_WIDTH) * box.width;
    const next = panDomain(
      active.start,
      full,
      drawnWidth === 0 ? 0 : -moved / drawnWidth,
    );
    if (active.moved) {
      if (active.epoch !== null) {
        dispatch({ type: "gesture-moved", epoch: active.epoch, domain: next });
      }
      return;
    }
    active.moved = true;
    active.epoch = activeGestureEpoch(dispatch({ type: "gesture-started", domain: next }));
  };

  const handlePointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    const active = drag.current;
    drag.current = null;
    if (active === null || active.pointerId !== event.pointerId) {
      return;
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId) === true) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    if (active.moved) {
      if (active.epoch !== null) {
        dispatch({ type: "gesture-settled", epoch: active.epoch });
      }
      return;
    }
    // A press that travelled past the slop is not a click, whichever way it
    // went. Only sideways travel can pan, so a vertical drag starts no gesture
    // -- but it is still a drag, and releasing it must not commit a selection
    // the user did not ask for. Every selection is one ProteoWizard process.
    if (
      Math.hypot(event.clientX - active.originX, event.clientY - active.originY) >= CLICK_SLOP
    ) {
      return;
    }
    // A click, resolved against the full model. The drawing has fewer vertices
    // than the run has scans and its edges carry interpolated points that are
    // not scans at all, so resolving there would select a neighbour of the scan
    // that was pointed at -- silently, and more often the larger the run.
    const retentionTime = retentionTimeAt(event.clientX);
    if (retentionTime === null) {
      return;
    }
    const scan = nearestScan(points, retentionTime);
    if (scan !== null) {
      onSelect(scan.spectrumIndex);
    }
  };

  const handlePointerCancel = (event: React.PointerEvent<SVGSVGElement>) => {
    const active = drag.current;
    drag.current = null;
    if (active === null || active.pointerId !== event.pointerId || active.epoch === null) {
      return;
    }
    // Abandoned rather than committed: what the user was in the middle of doing
    // is discarded, and the committed viewport is untouched.
    dispatch({ type: "gesture-cancelled", epoch: active.epoch });
  };

  const handleKeyDown = (event: React.KeyboardEvent<SVGSVGElement>) => {
    const state = readInteraction();
    const runDomain = state.fullDomain;
    const shown = renderedDomain(state);
    if (runDomain === null || shown === null) {
      return;
    }
    switch (event.key) {
      case "+":
      case "=":
        applyViewportAction(state, dispatch, "zoom-in");
        break;
      case "-":
      case "_":
        applyViewportAction(state, dispatch, "zoom-out");
        break;
      case "ArrowLeft":
        dispatch({ type: "viewport-step", domain: panDomain(shown, runDomain, -PAN_STEP) });
        break;
      case "ArrowRight":
        dispatch({ type: "viewport-step", domain: panDomain(shown, runDomain, PAN_STEP) });
        break;
      case "Home":
      case "0":
        applyViewportAction(state, dispatch, "reset");
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const nothingDrawn = activeTraces.length === 0;

  return (
    <div className="chromatogram-plot">
      <svg
        aria-describedby="chromatogram-readout"
        aria-labelledby="chromatogram-heading"
        className="chromatogram-svg"
        onBlur={() => {
          dispatch({ type: "hover-cleared" });
        }}
        onKeyDown={handleKeyDown}
        onPointerCancel={handlePointerCancel}
        onPointerDown={handlePointerDown}
        onPointerLeave={() => {
          dispatch({ type: "hover-cleared" });
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        preserveAspectRatio="none"
        ref={plotRef}
        role="img"
        tabIndex={0}
        viewBox={`0 0 ${String(PLOT_WIDTH)} ${String(PLOT_HEIGHT)}`}
      >
        <defs>
          <clipPath id="chromatogram-clip">
            <rect height={USABLE_HEIGHT} width={USABLE_WIDTH} x={PADDING_LEFT} y={PADDING_TOP} />
          </clipPath>
        </defs>
        <g className="chromatogram-axes">
          <line x1={PADDING_LEFT} x2={PLOT_WIDTH - PADDING_RIGHT} y1={BASELINE_Y} y2={BASELINE_Y} />
          <line x1={PADDING_LEFT} x2={PADDING_LEFT} y1={PADDING_TOP} y2={BASELINE_Y} />
          {ticksOf(domain).map((tick, position) => (
            <text
              key={`${String(position)}:${String(tick)}`}
              textAnchor="middle"
              x={scale.x(tick)}
              y={BASELINE_Y + 14}
            >
              {tick.toFixed(4)}
            </text>
          ))}
          {nothingDrawn ? null : (
            <>
              <text
                className="chromatogram-value-label"
                textAnchor="end"
                x={PADDING_LEFT - 6}
                y={PADDING_TOP + 8}
              >
                {formatIntensity(extent.high)}
              </text>
              <text
                className="chromatogram-value-label"
                textAnchor="end"
                x={PADDING_LEFT - 6}
                y={BASELINE_Y}
              >
                {formatIntensity(extent.low)}
              </text>
            </>
          )}
        </g>
        <g clipPath="url(#chromatogram-clip)">
          {marks.map((each) =>
            each.point === null ? (
              each.d === "" ? null : (
                <path
                  className={`chromatogram-trace chromatogram-trace-${each.trace}`}
                  d={each.d}
                  key={each.trace}
                  strokeDasharray={each.dash}
                />
              )
            ) : (
              <circle
                className={`chromatogram-point chromatogram-point-${each.trace}`}
                cx={each.point.x}
                cy={each.point.y}
                key={each.trace}
                r={each.pointRadius}
              />
            ),
          )}
          {nothingDrawn ? (
            // An intentional state rather than an empty drawing. The axis is
            // still the run's, and the plot is still where a scan is chosen.
            <text
              className="chromatogram-hidden-note"
              textAnchor="middle"
              x={PADDING_LEFT + USABLE_WIDTH / 2}
              y={PADDING_TOP + USABLE_HEIGHT / 2}
            >
              Both traces are hidden.
            </text>
          ) : null}
          {selectedPoint === null ? null : (
            <g className="chromatogram-selected">
              {/* A rule and a glyph, not a colour change. Which scan is
                  selected has to be readable without seeing colour. */}
              <line
                x1={scale.x(selectedPoint.retentionTime)}
                x2={scale.x(selectedPoint.retentionTime)}
                y1={PADDING_TOP}
                y2={BASELINE_Y}
              />
              <rect
                height={9}
                width={9}
                x={scale.x(selectedPoint.retentionTime) - 4.5}
                y={PADDING_TOP - 1}
              />
            </g>
          )}
          {hoveredPoint === null ? null : (
            <g className="chromatogram-hover">
              {/* Placed from the scan's own retention time under the range on
                  screen now, never from a coordinate scaled when the
                  observation was made. */}
              <line
                x1={scale.x(hoveredPoint.retentionTime)}
                x2={scale.x(hoveredPoint.retentionTime)}
                y1={PADDING_TOP}
                y2={BASELINE_Y}
              />
            </g>
          )}
        </g>
      </svg>
      <p className="chromatogram-axis-caption">
        {/* The unit state, said rather than assumed. Nothing in the accepted
            contract establishes what these numbers are measured in, and a
            chromatogram labelled "minutes" states something the file did not.
            Beside it, what the traces are made of. */}
        Retention time — unit not reported · Intensity — unit not reported ·{" "}
        <span className="chromatogram-range">
          Showing {domain.low.toFixed(4)} to {domain.high.toFixed(4)}
          {showingFullRange ? " (full range)" : ""}
        </span>{" "}
        · Per-scan values from the loaded spectrum table, across{" "}
        {formatCount(points.length)} scans. Not a stored chromatogram record.
      </p>
      {/* Not a live region. Which scan the pointer is over changes on most
          pointer frames at a full-run zoom, and a region that announced each of
          them would be noise rather than feedback. It is the plot's accessible
          description instead, so a reader who focuses the plot is told what is
          selected -- and the persistent selection, not the transient hover, is
          what every keyboard route establishes. */}
      <p className="chromatogram-readout" id="chromatogram-readout">
        {hoveredPoint === null
          ? describeSelection(selectedPoint)
          : describeScan(hoveredPoint, "Hovering")}
      </p>
    </div>
  );
}

/** How a value and a retention time become viewBox coordinates. */
function scaleFor(domain: RetentionTimeDomain, extent: ValueExtent) {
  const span = domain.high - domain.low;
  const valueSpan = extent.high - extent.low;
  // Both guards are about the same thing: a divisor that is zero, or that
  // overflowed adding two finite extremes, would put `NaN` or `Infinity` into
  // an SVG coordinate -- which draws nothing and says nothing about why.
  const usableX = Number.isFinite(span) && span > 0;
  const usableY = Number.isFinite(valueSpan) && valueSpan > 0;
  return {
    x: (retentionTime: number) =>
      PADDING_LEFT +
      (usableX ? ((retentionTime - domain.low) / span) * USABLE_WIDTH : USABLE_WIDTH / 2),
    y: (value: number) =>
      PADDING_TOP +
      (usableY ? ((extent.high - value) / valueSpan) * USABLE_HEIGHT : USABLE_HEIGHT),
  };
}

/** The joined path for one trace, in viewBox units. */
function pathOf(
  vertices: readonly VisibleVertex[],
  scale: { readonly x: (value: number) => number; readonly y: (value: number) => number },
): string {
  let path = "";
  for (let index = 0; index < vertices.length; index += 1) {
    const vertex = vertices[index];
    if (vertex === undefined) {
      continue;
    }
    const x = scale.x(vertex.retentionTime).toFixed(2);
    const y = scale.y(vertex.value).toFixed(2);
    path += `${index === 0 ? "M" : "L"} ${x} ${y} `;
  }
  return path.trimEnd();
}

/** Five evenly spaced retention times across the viewport. */
function ticksOf(domain: RetentionTimeDomain): readonly number[] {
  const span = domain.high - domain.low;
  if (!(span > 0)) {
    return [domain.low];
  }
  return [0, 0.25, 0.5, 0.75, 1].map((fraction) => domain.low + span * fraction);
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
}

/** What the readout says about one scan. */
function describeScan(point: ScanPoint, verb: string): string {
  const scan =
    point.scanNumber === null
      ? "scan number not reported"
      : `scan ${formatCount(point.scanNumber)}`;
  return (
    `${verb} index ${formatCount(point.spectrumIndex)}, ${scan}, MS${formatCount(point.msLevel)}, ` +
    `retention time ${point.retentionTime.toFixed(4)} (unit not reported), ` +
    `TIC ${formatIntensity(point.totalIonCurrent)}, BPC ${formatIntensity(point.basePeakIntensity)}.`
  );
}

function describeSelection(point: ScanPoint | null): string {
  return point === null
    ? "No scan selected. Click the plot or a table row to select one."
    : describeScan(point, "Selected");
}
