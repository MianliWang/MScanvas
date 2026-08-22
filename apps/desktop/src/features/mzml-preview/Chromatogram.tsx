import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  ChromatogramModel,
  ChromatogramPoint,
  ChromatogramTrace,
  ChromatogramUnavailableReason,
  RetentionTimeDomain,
} from "./chromatogramModel";
import {
  isFullDomain,
  nearestPoint,
  panDomain,
  reduceTrace,
  revealDomain,
  traceValue,
  valueExtent,
  zoomDomain,
} from "./chromatogramModel";
import { formatCount, formatIntensity } from "./format";

/**
 * The drawing area, in viewBox units. The element scales to its container, so
 * these are resolution units rather than pixels — the same approach the stick
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

/** What one wheel notch does to the visible span. */
const WHEEL_ZOOM = 0.85;
/** What the keyboard and the buttons do, which is a larger deliberate step. */
const STEP_ZOOM = 0.6;
/** What one pan step moves, as a fraction of the visible span. */
const PAN_STEP = 0.25;

/**
 * How long a gesture stays local before its result is published.
 *
 * A wheel is a stream of events with no end signal, so the semantic domain is
 * committed a moment after the last one. A drag has an end and commits there.
 * Between those, the viewport moves in this component's own state — pointer
 * coordinates never reach the workspace.
 */
const COMMIT_DELAY_MS = 120;

const TRACES: readonly {
  readonly trace: ChromatogramTrace;
  readonly label: string;
  readonly shortLabel: string;
  /** The dash pattern, so the two traces are told apart without colour. */
  readonly dash: string | undefined;
}[] = [
  { trace: "tic", label: "TIC", shortLabel: "TIC", dash: undefined },
  { trace: "bpc", label: "BPC", shortLabel: "BPC", dash: "7 4" },
];

export interface TraceVisibility {
  readonly tic: boolean;
  readonly bpc: boolean;
}

export interface ChromatogramProps {
  readonly model: ChromatogramModel;
  readonly traces: TraceVisibility;
  readonly onToggleTrace: (trace: ChromatogramTrace) => void;
  /** The committed viewport. `null` is the whole run. */
  readonly visibleDomain: RetentionTimeDomain | null;
  readonly onVisibleDomainChange: (domain: RetentionTimeDomain | null) => void;
  readonly selectedIndex: number | null;
  readonly onSelect: (index: number) => void;
  readonly onSelectPrevious: () => void;
  readonly onSelectNext: () => void;
  readonly canSelectPrevious: boolean;
  readonly canSelectNext: boolean;
}

export function Chromatogram({
  model,
  traces,
  onToggleTrace,
  visibleDomain,
  onVisibleDomainChange,
  selectedIndex,
  onSelect,
  onSelectPrevious,
  onSelectNext,
  canSelectPrevious,
  canSelectNext,
}: ChromatogramProps) {
  return (
    <section aria-labelledby="chromatogram-heading" className="panel chromatogram-panel">
      <header className="panel-header compact">
        <div>
          <h2 id="chromatogram-heading">Chromatogram</h2>
          <p>{describeSource(model)}</p>
        </div>
        {model.status === "ready" ? (
          <ChromatogramControls
            canSelectNext={canSelectNext}
            canSelectPrevious={canSelectPrevious}
            onSelectNext={onSelectNext}
            onSelectPrevious={onSelectPrevious}
            onToggleTrace={onToggleTrace}
            traces={traces}
          />
        ) : null}
      </header>
      <div className="chromatogram-body">
        {model.status === "ready" ? (
          <ChromatogramPlot
            labelledBy="chromatogram-heading"
            model={model}
            onSelect={onSelect}
            onVisibleDomainChange={onVisibleDomainChange}
            selectedIndex={selectedIndex}
            traces={traces}
            visibleDomain={visibleDomain}
          />
        ) : (
          <div className="empty-state">
            <strong>{UNAVAILABLE[model.reason].summary}</strong>
            <span>{UNAVAILABLE[model.reason].detail}</span>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Why there is no chromatogram, in the words the panel says it.
 *
 * Each names what happened rather than that something did. A truncation in
 * particular has to be readable as a property of this preview, because the
 * scan table beside it is on screen and does show rows.
 */
const UNAVAILABLE: Record<
  ChromatogramUnavailableReason,
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
};

/** What the caption says the traces are, which is deliberately specific. */
function describeSource(model: ChromatogramModel): string {
  if (model.status !== "ready") {
    return "Derived from the loaded spectrum table.";
  }
  return `Per-scan values from the loaded spectrum table, across ${formatCount(
    model.points.length,
  )} scans. Not a stored chromatogram record.`;
}

function ChromatogramControls({
  traces,
  onToggleTrace,
  onSelectPrevious,
  onSelectNext,
  canSelectPrevious,
  canSelectNext,
}: {
  readonly traces: TraceVisibility;
  readonly onToggleTrace: (trace: ChromatogramTrace) => void;
  readonly onSelectPrevious: () => void;
  readonly onSelectNext: () => void;
  readonly canSelectPrevious: boolean;
  readonly canSelectNext: boolean;
}) {
  return (
    <div className="chromatogram-controls">
      <fieldset className="chromatogram-traces">
        <legend>Traces</legend>
        {TRACES.map(({ trace, label }) => (
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
              {/* The same dash pattern the trace is drawn with, so the legend
                  distinguishes the two without asking anyone to compare
                  colours. */}
              <svg aria-hidden="true" className="chromatogram-swatch" viewBox="0 0 24 8">
                <path
                  d="M 1 4 L 23 4"
                  strokeDasharray={TRACES.find((each) => each.trace === trace)?.dash}
                />
              </svg>
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset className="chromatogram-scan-steps">
        <legend>Scan</legend>
        <button
          className="secondary-button"
          disabled={!canSelectPrevious}
          onClick={onSelectPrevious}
          type="button"
        >
          Previous scan
        </button>
        <button
          className="secondary-button"
          disabled={!canSelectNext}
          onClick={onSelectNext}
          type="button"
        >
          Next scan
        </button>
      </fieldset>
    </div>
  );
}

interface Hover {
  readonly point: ChromatogramPoint;
  readonly x: number;
}

function ChromatogramPlot({
  model,
  traces,
  visibleDomain,
  onVisibleDomainChange,
  selectedIndex,
  onSelect,
  labelledBy,
}: {
  readonly model: Extract<ChromatogramModel, { status: "ready" }>;
  readonly traces: TraceVisibility;
  readonly visibleDomain: RetentionTimeDomain | null;
  readonly onVisibleDomainChange: (domain: RetentionTimeDomain | null) => void;
  readonly selectedIndex: number | null;
  readonly onSelect: (index: number) => void;
  readonly labelledBy: string;
}) {
  const { points, fullDomain } = model;
  const plotRef = useRef<SVGSVGElement | null>(null);

  /**
   * The viewport while a gesture is happening.
   *
   * A wheel or a drag produces dozens of events a second, and putting each one
   * through the workspace would re-render the scan table and the spectrum panel
   * for every frame of a pan. So the gesture moves this, and what the workspace
   * learns is the semantic domain the gesture arrived at.
   */
  const [gestureDomain, setGestureDomain] = useState<RetentionTimeDomain | null>(null);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const domain = gestureDomain ?? visibleDomain ?? fullDomain;
  const domainRef = useRef(domain);
  domainRef.current = domain;

  useEffect(
    () => () => {
      if (commitTimer.current !== null) {
        clearTimeout(commitTimer.current);
      }
    },
    [],
  );

  /** Publishes what a gesture arrived at, and hands the viewport back. */
  const commit = useCallback(
    (next: RetentionTimeDomain) => {
      if (commitTimer.current !== null) {
        clearTimeout(commitTimer.current);
        commitTimer.current = null;
      }
      setGestureDomain(null);
      onVisibleDomainChange(isFullDomain(next, fullDomain) ? null : next);
    },
    [fullDomain, onVisibleDomainChange],
  );

  /** Moves the viewport now and publishes it once the gesture settles. */
  const moveViewport = useCallback(
    (next: RetentionTimeDomain) => {
      setGestureDomain(next);
      if (commitTimer.current !== null) {
        clearTimeout(commitTimer.current);
      }
      commitTimer.current = setTimeout(() => {
        commitTimer.current = null;
        setGestureDomain(null);
        onVisibleDomainChange(isFullDomain(next, fullDomain) ? null : next);
      }, COMMIT_DELAY_MS);
    },
    [fullDomain, onVisibleDomainChange],
  );

  const [hover, setHover] = useState<Hover | null>(null);
  const hoverFrame = useRef<number | null>(null);
  const drag = useRef<{ readonly pointerId: number; readonly x: number; readonly domain: RetentionTimeDomain; moved: boolean } | null>(
    null,
  );

  const activeTraces = useMemo(
    () => TRACES.filter((each) => traces[each.trace]).map((each) => each.trace),
    [traces],
  );

  const extent = useMemo(
    () => valueExtent(points, activeTraces, domain),
    [points, activeTraces, domain],
  );

  const scale = useMemo(() => {
    const span = domain.high - domain.low;
    const valueSpan = extent.high - extent.low;
    return {
      x: (retentionTime: number) =>
        PADDING_LEFT + (span > 0 ? ((retentionTime - domain.low) / span) * USABLE_WIDTH : USABLE_WIDTH / 2),
      y: (value: number) =>
        PADDING_TOP + (valueSpan > 0 ? ((extent.high - value) / valueSpan) * USABLE_HEIGHT : USABLE_HEIGHT),
    };
  }, [domain, extent]);

  const paths = useMemo(
    () =>
      TRACES.filter((each) => traces[each.trace]).map((each) => ({
        ...each,
        // One path per trace. A node per scan would be 36,319 elements for the
        // repository's representative acquisition.
        d: pathOf(reduceTrace(points, each.trace, domain), each.trace, scale),
      })),
    [points, traces, domain, scale],
  );

  const selectedPoint = useMemo(
    () => (selectedIndex === null ? null : points.find((each) => each.spectrumIndex === selectedIndex) ?? null),
    [points, selectedIndex],
  );

  // A selection can arrive from the scan table or from Previous/Next, and land
  // outside the stretch the plot is showing. Panning to it is right; resetting
  // the zoom is not -- the user chose that span, and selecting a scan is not a
  // request to stop looking at it. Keyed by the scan so a pan the user then
  // makes is not undone on the next render.
  const revealed = useRef<number | null>(null);
  useEffect(() => {
    if (selectedPoint === null) {
      revealed.current = null;
      return;
    }
    if (revealed.current === selectedPoint.spectrumIndex) {
      return;
    }
    revealed.current = selectedPoint.spectrumIndex;
    // Nothing to reveal at full range: every scan is already on screen.
    if (visibleDomain === null) {
      return;
    }
    const next = revealDomain(visibleDomain, fullDomain, selectedPoint.retentionTime);
    if (next !== visibleDomain) {
      onVisibleDomainChange(next);
    }
  }, [selectedPoint, visibleDomain, fullDomain, onVisibleDomainChange]);

  /** The retention time under a pointer, in the plot's own units. */
  const retentionTimeAt = useCallback((clientX: number): number | null => {
    const element = plotRef.current;
    if (element === null) {
      return null;
    }
    const box = element.getBoundingClientRect();
    if (box.width === 0) {
      return null;
    }
    const viewBoxX = ((clientX - box.left) / box.width) * PLOT_WIDTH;
    const fraction = (viewBoxX - PADDING_LEFT) / USABLE_WIDTH;
    const current = domainRef.current;
    return current.low + Math.min(1, Math.max(0, fraction)) * (current.high - current.low);
  }, []);

  // Wheel is attached by hand because React's own wheel listener is passive, so
  // `preventDefault` inside `onWheel` cannot stop the page scrolling under a
  // zoom gesture.
  useEffect(() => {
    const element = plotRef.current;
    if (element === null) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) {
        return;
      }
      event.preventDefault();
      const box = element.getBoundingClientRect();
      const anchor =
        box.width === 0
          ? 0.5
          : (((event.clientX - box.left) / box.width) * PLOT_WIDTH - PADDING_LEFT) / USABLE_WIDTH;
      moveViewport(
        zoomDomain(
          domainRef.current,
          fullDomain,
          event.deltaY < 0 ? WHEEL_ZOOM : 1 / WHEEL_ZOOM,
          Math.min(1, Math.max(0, anchor)),
        ),
      );
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", onWheel);
    };
  }, [fullDomain, moveViewport]);

  const showHover = useCallback(
    (clientX: number) => {
      // Throttled to a frame. A pointer move is not a state change worth a
      // render each, and this is the only place hover exists -- it is never a
      // selection, never a request, and never reaches the workspace.
      if (hoverFrame.current !== null) {
        return;
      }
      hoverFrame.current = requestAnimationFrame(() => {
        hoverFrame.current = null;
        const retentionTime = retentionTimeAt(clientX);
        if (retentionTime === null) {
          return;
        }
        const point = nearestPoint(points, retentionTime);
        setHover(point === null ? null : { point, x: scale.x(point.retentionTime) });
      });
    },
    [points, retentionTimeAt, scale],
  );

  useEffect(
    () => () => {
      if (hoverFrame.current !== null) {
        cancelAnimationFrame(hoverFrame.current);
      }
    },
    [],
  );

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) {
      return;
    }
    drag.current = { pointerId: event.pointerId, x: event.clientX, domain: domainRef.current, moved: false };
    // Capture so a pan that leaves the plot keeps being a pan. Guarded because
    // it is the one part of this gesture that not every environment implements,
    // and a drag that merely stops tracking outside the element is far better
    // than a plot that cannot be pressed at all.
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const active = drag.current;
    if (active === null || active.pointerId !== event.pointerId) {
      showHover(event.clientX);
      return;
    }
    const box = event.currentTarget.getBoundingClientRect();
    const moved = event.clientX - active.x;
    // A press that has not travelled is still a click. Without a threshold a
    // one-pixel tremor between press and release would pan instead of select.
    if (!active.moved && Math.abs(moved) < CLICK_SLOP) {
      return;
    }
    active.moved = true;
    const span = active.domain.high - active.domain.low;
    const perPixel = box.width === 0 ? 0 : span / ((box.width * USABLE_WIDTH) / PLOT_WIDTH);
    moveViewport(
      panDomain(active.domain, fullDomain, span > 0 ? (-moved * perPixel) / span : 0),
    );
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
      commit(domainRef.current);
      return;
    }
    // A click, resolved against the full model rather than the drawn vertices:
    // the drawing has fewer points than the run has scans, so resolving here
    // would select a neighbour of the scan that was pointed at.
    const retentionTime = retentionTimeAt(event.clientX);
    if (retentionTime === null) {
      return;
    }
    const point = nearestPoint(points, retentionTime);
    if (point !== null) {
      onSelect(point.spectrumIndex);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<SVGSVGElement>) => {
    const current = domainRef.current;
    switch (event.key) {
      case "+":
      case "=":
        commit(zoomDomain(current, fullDomain, STEP_ZOOM, 0.5));
        break;
      case "-":
      case "_":
        commit(zoomDomain(current, fullDomain, 1 / STEP_ZOOM, 0.5));
        break;
      case "ArrowLeft":
        commit(panDomain(current, fullDomain, -PAN_STEP));
        break;
      case "ArrowRight":
        commit(panDomain(current, fullDomain, PAN_STEP));
        break;
      case "Home":
      case "0":
        commit(fullDomain);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const zoomedIn = !isFullDomain(visibleDomain, fullDomain) || gestureDomain !== null;

  return (
    <div className="chromatogram-plot">
      <svg
        aria-describedby="chromatogram-readout"
        aria-labelledby={labelledBy}
        className="chromatogram-svg"
        onBlur={() => {
          setHover(null);
        }}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerLeave={() => {
          setHover(null);
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
            <rect
              height={USABLE_HEIGHT}
              width={USABLE_WIDTH}
              x={PADDING_LEFT}
              y={PADDING_TOP}
            />
          </clipPath>
        </defs>
        <g className="chromatogram-axes">
          <line x1={PADDING_LEFT} x2={PLOT_WIDTH - PADDING_RIGHT} y1={BASELINE_Y} y2={BASELINE_Y} />
          <line x1={PADDING_LEFT} x2={PADDING_LEFT} y1={PADDING_TOP} y2={BASELINE_Y} />
          {ticksOf(domain).map((tick) => (
            <text key={tick} textAnchor="middle" x={scale.x(tick)} y={BASELINE_Y + 14}>
              {tick.toFixed(4)}
            </text>
          ))}
          <text className="chromatogram-value-label" textAnchor="end" x={PADDING_LEFT - 6} y={PADDING_TOP + 8}>
            {formatIntensity(extent.high)}
          </text>
          <text className="chromatogram-value-label" textAnchor="end" x={PADDING_LEFT - 6} y={BASELINE_Y}>
            {formatIntensity(extent.low)}
          </text>
        </g>
        <g clipPath="url(#chromatogram-clip)">
          {paths.map((each) => (
            <path
              className={`chromatogram-trace chromatogram-trace-${each.trace}`}
              d={each.d}
              key={each.trace}
              strokeDasharray={each.dash}
            />
          ))}
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
          {hover === null ? null : (
            <g className="chromatogram-hover">
              <line x1={hover.x} x2={hover.x} y1={PADDING_TOP} y2={BASELINE_Y} />
            </g>
          )}
        </g>
      </svg>
      <p className="chromatogram-axis-caption">
        {/* The unit state, said rather than assumed. Nothing in the accepted
            contract establishes what these numbers are measured in, and a
            chromatogram labelled "minutes" states something the file did not. */}
        Retention time
        {model.retentionTimeUnitKnown ? "" : " — unit not reported"} · Intensity — unit not
        reported
      </p>
      <p aria-live="polite" className="chromatogram-readout" id="chromatogram-readout">
        {hover === null ? describeSelection(selectedPoint) : describePoint(hover.point, "Hovering")}
      </p>
      <div className="chromatogram-viewport-actions">
        <button
          className="secondary-button"
          onClick={() => {
            commit(zoomDomain(domain, fullDomain, STEP_ZOOM, 0.5));
          }}
          type="button"
        >
          Zoom in
        </button>
        <button
          className="secondary-button"
          onClick={() => {
            commit(zoomDomain(domain, fullDomain, 1 / STEP_ZOOM, 0.5));
          }}
          type="button"
        >
          Zoom out
        </button>
        <button
          className="secondary-button"
          disabled={!zoomedIn}
          onClick={() => {
            commit(fullDomain);
          }}
          type="button"
        >
          Reset range
        </button>
        <span className="chromatogram-range">
          Showing {domain.low.toFixed(4)} to {domain.high.toFixed(4)}
          {zoomedIn ? "" : " (full range)"}
        </span>
      </div>
    </div>
  );
}

/** The joined path for one trace, in viewBox units. */
function pathOf(
  vertices: readonly ChromatogramPoint[],
  trace: ChromatogramTrace,
  scale: { readonly x: (value: number) => number; readonly y: (value: number) => number },
): string {
  let path = "";
  for (let index = 0; index < vertices.length; index += 1) {
    const vertex = vertices[index];
    if (vertex === undefined) {
      continue;
    }
    const x = scale.x(vertex.retentionTime).toFixed(2);
    const y = scale.y(traceValue(vertex, trace)).toFixed(2);
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

/** What the readout says about one scan. */
function describePoint(point: ChromatogramPoint, verb: string): string {
  const scan = point.scanNumber === null ? "scan number not reported" : `scan ${formatCount(point.scanNumber)}`;
  return (
    `${verb} index ${formatCount(point.spectrumIndex)}, ${scan}, MS${formatCount(point.msLevel)}, ` +
    `retention time ${point.retentionTime.toFixed(4)} (unit not reported), ` +
    `TIC ${formatIntensity(point.totalIonCurrent)}, BPC ${formatIntensity(point.basePeakIntensity)}.`
  );
}

function describeSelection(point: ChromatogramPoint | null): string {
  return point === null
    ? "No scan selected. Click the plot or a table row to select one."
    : describePoint(point, "Selected");
}
