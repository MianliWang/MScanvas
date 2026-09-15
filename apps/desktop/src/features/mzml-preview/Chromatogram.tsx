import type { ReactNode } from "react";
import { memo, useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import type { UiMessage } from "../preferences/i18n";

import { PlotRangeActions } from "./PlotRangeActions";
import { retentionTimeInput } from "./viewer/plotInputAdapters";
import { usePlotInput } from "./viewer/usePlotInput";
import { usePlotTextSize } from "./viewer/usePlotTextSize";

import { formatCount, formatIntensity } from "./format";
import type {
  ViewerEvent,
  ViewerInteractionState,
} from "./viewer/interactionState";
import { renderedDomain } from "./viewer/interactionState";
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
import type { SpectrumSelectionAvailability } from "./viewer/selectionAvailability";
import { SPECTRUM_SELECTION_NOTICE_ID } from "./viewer/selectionAvailability";
import type { ViewportAction } from "./viewer/viewportAction";
import {
  applyViewportAction,
  planViewportAction,
} from "./viewer/viewportAction";
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
  /**
   * Whether a click may commit a scan, from the one selection authority.
   *
   * Read rather than re-derived, and it governs the commit alone. The plot is a
   * viewport over data already on screen: refusing a hover, a zoom or a pan
   * because a conversion holds the backend lane would take away the reading
   * that is still perfectly true.
   */
  readonly selectionAvailability: SpectrumSelectionAvailability;
  /**
   * The control that opens this panel's export surface.
   *
   * Rendered into the header's existing control row rather than below the plot,
   * so a viewer with the surface closed is exactly as tall as it was: the
   * three-panel column's floors are measured, and a disclosure that added a row
   * to the body would push a control out of a panel that clips.
   */
  readonly exportToggle?: ReactNode;
  /** The export surface itself, when it is open. */
  readonly exportPanel?: ReactNode;
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
  selectionAvailability,
  exportToggle,
  exportPanel,
}: ChromatogramProps) {
  const t = useUiMessages();
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
    <section
      aria-labelledby="chromatogram-heading"
      className="panel chromatogram-panel"
      data-export-open={exportPanel === null || exportPanel === undefined ? undefined : "true"}
    >
      {/* One line, and every control on it. The viewer is three stacked panels
          in a column that is about 480px tall at a 768px window, so what this
          panel spends on chrome it takes from the scan table and the spectrum
          below it. A locator earns less of that than the things being read,
          which is why the source sentence lives under the plot with the axis
          rather than as a second header line. */}
      <header className="panel-header compact">
        <h2 id="chromatogram-heading">{t("viewerChromatogram")}</h2>
        {model.status === "ready" ? (
          <div className="chromatogram-controls">
            <fieldset className="chromatogram-traces">
              {/* Named for a screen reader without spending a line on it. A
                  group of controls still has to say what it groups. */}
              <legend className="visually-hidden">{t("viewerTraces")}</legend>
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
              <legend className="visually-hidden">{t("viewerRange")}</legend>
              {VIEWPORT_CONTROLS.map(({ action }) => (
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
                  {t(action === "reset" ? "viewerReset" : action === "zoom-in" ? "viewerZoomIn" : "viewerZoomOut")}
                </button>
              ))}
            </fieldset>
            {exportToggle}
          </div>
        ) : null}
      </header>
      {exportPanel}
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
            selectionAvailability={selectionAvailability}
            traces={traces}
            showingFullRange={showingFullRange}
          />
        ) : model.status === "ready" ? (
          // The model is read and the interaction has not adopted it yet. The
          // workspace announces a loaded run in a layout effect, so this is
          // never painted; it exists because a component may not choose a range
          // the contract has not published.
          <p className="chromatogram-axis-caption">{t("viewerPreparingRt")}</p>
        ) : (
          <div className="empty-state">
            <strong>{t(model.reason === "no-spectra" ? "viewerNoSpectra" : "viewerTicUnavailable")}</strong>
            <span>{t(UNAVAILABLE[model.reason])}</span>
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
const UNAVAILABLE = {
  truncated: "viewerTicPrefix", "no-spectra": "viewerTicEmpty", "unusable-retention-time": "viewerTicRt",
  "unusable-intensity": "viewerTicIntensity", "unsupported-retention-time-unit": "viewerTicUnit",
} as const satisfies Record<ScanModelRefusal, string>;

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
  readonly selectionAvailability: SpectrumSelectionAvailability;
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
  selectionAvailability,
}: PlotProps) {
  const t = useUiMessages();
  const plotRef = useRef<SVGSVGElement | null>(null);
  const sizeText = usePlotTextSize();

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
  const inputPort = retentionTimeInput(readInteraction, dispatch);
  const frameGeometry = useRef<{
    points: typeof points; traces: typeof activeTraces; domain: RetentionTimeDomain;
    extent: typeof extent; scale: typeof scale; marks: typeof marks;
  } | null>(null);
  const paintFrame = useCallback(() => {
    const state = readInteraction(); const shown = renderedDomain(state); const node = plotRef.current;
    if (shown === null || node === null) return;
    let geometry = frameGeometry.current;
    if (geometry === null || geometry.points !== points || geometry.traces !== activeTraces ||
        geometry.domain.low !== shown.low || geometry.domain.high !== shown.high) {
      if (shown.low === domain.low && shown.high === domain.high) {
        geometry = { points, traces: activeTraces, domain: shown, extent, scale, marks };
      } else {
        const clippedNow = activeTraces.map(each => ({ ...each, vertices: clipTrace(points, each.trace, shown) }));
        const extentNow = visibleExtent(clippedNow.map(each => each.vertices));
        const scaleNow = scaleFor(shown, extentNow);
        const marksNow = clippedNow.map(each => {
          const vertices = reduceVisible(each.vertices, shown);
          const only = vertices.length === 1 ? vertices[0] : undefined;
          return { ...each, point: only === undefined ? null :
            { x: scaleNow.x(only.retentionTime), y: scaleNow.y(only.value) },
          d: only === undefined ? pathOf(vertices, scaleNow) : "" };
        });
        geometry = { points, traces: activeTraces, domain: shown, extent: extentNow, scale: scaleNow, marks: marksNow };
      }
      frameGeometry.current = geometry;
    }
    const { extent: extentNow, scale: scaleNow } = geometry;
    for (const mark of geometry.marks) {
      node.querySelector(`.chromatogram-trace-${mark.trace}`)?.setAttribute("d", mark.d);
      const point = node.querySelector(`.chromatogram-point-${mark.trace}`);
      point?.setAttribute("visibility", mark.point === null ? "hidden" : "visible");
      if (mark.point !== null) { point?.setAttribute("cx", String(mark.point.x)); point?.setAttribute("cy", String(mark.point.y)); }
    }
    node.querySelectorAll(".chromatogram-time-label").forEach((label, position) => {
      label.textContent = ticksOf(shown)[position]?.toFixed(4) ?? "";
    });
    node.querySelectorAll(".chromatogram-value-label").forEach((label, position) => {
      label.textContent = formatIntensity(position === 0 ? extentNow.high : extentNow.low);
    });
    for (const [kind, index] of [["selected", state.selection?.index], ["hover", state.hover?.spectrumIndex]] as const) {
      const group = node.querySelector(`.chromatogram-${kind}`); const point = index === undefined ? undefined : byIndex.get(index);
      group?.setAttribute("visibility", point === undefined ? "hidden" : "visible");
      if (point !== undefined) {
        const x = scaleNow.x(point.retentionTime);
        group?.querySelector("line")?.setAttribute("x1", String(x)); group?.querySelector("line")?.setAttribute("x2", String(x));
        group?.querySelector("rect")?.setAttribute("x", String(x - 4.5));
      }
    }
    const line = node.parentElement?.querySelector(".chromatogram-range");
    if (line) line.textContent = t("viewerShowing", { low: shown.low.toFixed(4), high: shown.high.toFixed(4) }) +
      (state.committedDomain === null && state.gesture === null ? t("viewerFullRange") : "");
  }, [readInteraction, activeTraces, points, byIndex, t, domain, extent, scale, marks]);
  const input = usePlotInput({ port: inputPort, geometry: { width: PLOT_WIDTH, left: PADDING_LEFT, drawnWidth: USABLE_WIDTH }, paintFrame,
    onInspect: retentionTime => {
      if (selectionAvailability.status !== "available") return;
      const scan = nearestScan(points, retentionTime); if (scan) onSelect(scan.spectrumIndex);
    },
    onHover: retentionTime => { const scan = nearestScan(points, retentionTime);
      if (scan) dispatch({ type: "hover-established", spectrumIndex: scan.spectrumIndex }); },
    onLeave: () => { dispatch({ type: "hover-cleared" }); } });
  const attachPlot = useCallback((node: SVGSVGElement | null) => {
    plotRef.current = node; input.attachPlot(node); sizeText(node);
  }, [input.attachPlot, sizeText]);
  useLayoutEffect(paintFrame);

  const nothingDrawn = activeTraces.length === 0;

  return (
    <div className="chromatogram-plot">
      <svg
        /*
         * The readout always, and the reason for a blocked selection while
         * there is one. Described rather than disabled: this plot can still be
         * read, and a reader who arrives at it is told which of the things it
         * offers is temporarily not one of them.
         */
        aria-describedby={
          selectionAvailability.status === "available"
            ? "chromatogram-readout"
            : `chromatogram-readout ${SPECTRUM_SELECTION_NOTICE_ID}`
        }
        aria-labelledby="chromatogram-heading"
        className="chromatogram-svg"
        preserveAspectRatio="none"
        ref={attachPlot}
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
              className="chromatogram-time-label"
              key={`${String(position)}:${String(tick)}`}
              textAnchor={position === 4 ? "end" : "middle"}
              x={scale.x(tick)}
              y={BASELINE_Y + 14}
            >
              {tick.toFixed(4)}
            </text>
          ))}
        </g>
        <g clipPath="url(#chromatogram-clip)">
          <rect className="plot-range-band" aria-hidden="true" visibility="hidden" x={0} y={PADDING_TOP} width={0} height={USABLE_HEIGHT} />
          {marks.map(each => <g key={each.trace}>
            <path className={`chromatogram-trace chromatogram-trace-${each.trace}`} d={each.d} strokeDasharray={each.dash} />
            <circle className={`chromatogram-point chromatogram-point-${each.trace}`} visibility={each.point === null ? "hidden" : "visible"}
              cx={each.point?.x ?? 0} cy={each.point?.y ?? 0} r={each.pointRadius} />
          </g>)}
          {nothingDrawn ? (
            // An intentional state rather than an empty drawing. The axis is
            // still the run's, and the plot is still where a scan is chosen.
            <text
              className="chromatogram-hidden-note"
              textAnchor="middle"
              x={PADDING_LEFT + USABLE_WIDTH / 2}
              y={PADDING_TOP + USABLE_HEIGHT / 2}
            >
              {t("viewerTracesHidden")}
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
        {/* Paint intensity text above traces so the existing halo protects signs and digits. */}
        {nothingDrawn ? null : (
          <g className="chromatogram-axes">
            <text
              className="chromatogram-value-label"
              textAnchor="start"
              x={PADDING_LEFT + 6}
              y={PADDING_TOP + 8}
            >
              {formatIntensity(extent.high)}
            </text>
            <text
              className="chromatogram-value-label"
              textAnchor="start"
              x={PADDING_LEFT + 6}
              y={BASELINE_Y}
            >
              {formatIntensity(extent.low)}
            </text>
          </g>
        )}
      </svg>
      <PlotRangeActions port={inputPort} />
      <div className="chromatogram-context">
      <p className="chromatogram-axis-caption">
        {/* The unit state, said rather than assumed. Nothing in the accepted
            contract establishes what these numbers are measured in, and a
            chromatogram labelled "minutes" states something the file did not.
            Beside it, what the traces are made of. */}
        {t("viewerRtUnits")} ·{" "}
        <span className="chromatogram-range">
          {t("viewerShowing", { low: domain.low.toFixed(4), high: domain.high.toFixed(4) }) +
            (showingFullRange ? t("viewerFullRange") : "")}
        </span>{" "}
      </p>
      <details className="plot-source-details"><summary>{t("viewerSourceDetails")}</summary>
        <p>{t("viewerScanSource", { count: points.length })}</p>
      </details>
      </div>
      {/* Not a live region. Which scan the pointer is over changes on most
          pointer frames at a full-run zoom, and a region that announced each of
          them would be noise rather than feedback. It is the plot's accessible
          description instead, so a reader who focuses the plot is told what is
          selected -- and the persistent selection, not the transient hover, is
          what every keyboard route establishes. */}
      <p className="chromatogram-readout" id="chromatogram-readout">
        {hoveredPoint === null
          ? selectedPoint === null ? t("viewerNoSelection") : describeScan(selectedPoint, t("viewerSelected"), t)
          : describeScan(hoveredPoint, t("viewerHover"), t)}
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


/** What the readout says about one scan. */
function describeScan(point: ScanPoint, verb: string, t: UiMessage): string {
  const scan =
    point.scanNumber === null
      ? t("viewerScanUnreported")
      : t("viewerReportedScan", { index: formatCount(point.scanNumber) });
  return t("viewerScanReadout", { name: verb, index: formatCount(point.spectrumIndex), scan,
    level: formatCount(point.msLevel), rt: point.retentionTime.toFixed(4),
    tic: formatIntensity(point.totalIonCurrent), bpc: formatIntensity(point.basePeakIntensity) });
}
