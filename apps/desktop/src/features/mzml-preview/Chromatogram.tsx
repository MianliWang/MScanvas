import type { ReactNode } from "react";
import { memo, useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { Button, Icon, IconButton, Toolbar, type IconName } from "../../components/ui";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import type { UiMessage } from "../preferences/i18n";

import { PlotRangeActions, plotGestureHelpId, usePlotRangeEditor } from "./PlotRangeActions";
import type { PlotMenuItem } from "./QuickFigureActions";
import { niceTicks, paintGridlines, paintTicks, withHeadroom } from "./viewer/plotAxes";
import { retentionTimeInput } from "./viewer/plotInputAdapters";
import { usePlotInput } from "./viewer/usePlotInput";
import { usePlotTextSize } from "./viewer/usePlotTextSize";

import type { RetentionTimeUnit } from "./contracts";
import { formatCount, formatIntensity, retentionTimeUnitSymbol } from "./format";
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
 *
 * The tick labels and axis titles are HTML around the drawing, so the stretched
 * viewBox never distorts them. The left gutter is where the value labels sit,
 * outside the drawn area; nothing else of the viewBox is reserved for text.
 */
const PLOT_WIDTH = 1000;
const PLOT_HEIGHT = 210;
const PADDING_LEFT = 64;
const PADDING_RIGHT = 12;
/** Deep enough that the value title in the corner clears the headroom's top. */
const PADDING_TOP = 12;
const BASELINE_Y = PLOT_HEIGHT - 4;
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
 * The visible viewport controls, in the order they are offered: −, + and the
 * text button Fit all.
 *
 * One list so the three share a rule rather than three call sites that could
 * drift -- which is how `Reset range` came to be the only one of them telling
 * the truth about being inert.
 */
const VIEWPORT_CONTROLS: readonly { readonly action: ViewportAction; readonly icon: IconName | null }[] = [
  { action: "zoom-out", icon: "minus" },
  { action: "zoom-in", icon: "plus" },
  { action: "reset", icon: null },
];

/** The line the zoom controls point at when one would change nothing: the range on screen. */
const AXIS_CAPTION_ID = "chromatogram-axis-caption";
/** The two axis titles, which carry the unit state and describe the plot. */
const AXIS_X_ID = "chromatogram-axis-x";
const AXIS_Y_ID = "chromatogram-axis-y";

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
  /** The figure actions, at the end of the head's toolbar, given the plot's own ⋯ items (Set range…). */
  readonly exportTools?: (leadingItems: readonly PlotMenuItem[]) => ReactNode;
  /** What the last export did, over the plot's corner. */
  readonly exportStatus?: ReactNode;
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
  exportTools,
  exportStatus,
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
  const rangeEditor = usePlotRangeEditor();

  return (
    <section aria-labelledby="chromatogram-heading" className="plot-box chromatogram-panel">
      {/* Direction A's plot head: the title, which traces, then one toolbar
          for the range and the figure. */}
      <div className="plot-head">
        <h2 id="chromatogram-heading">{t("viewerChromatogram")}</h2>
        {model.status === "ready" ? <>
          <div className="plot-traces" role="group" aria-label={t("viewerTraces")}>
            {TRACES.map(({ trace, label, dash }) => (
              <Button aria-pressed={traces[trace]} key={trace} onClick={() => { onToggleTrace(trace); }} size="sm"
                // The same dash the trace is drawn with, so the toggles do not rely on colour.
                icon={<svg aria-hidden="true" className="chromatogram-swatch" viewBox="0 0 24 8"><path d="M 1 4 L 23 4" strokeDasharray={dash} /></svg>}>
                {label}
              </Button>
            ))}
          </div>
          {/* The range on screen, in the head beside the controls it refuses
              (P4): the visible reason for a refused Fit all and −. */}
          {domain === null ? null : (() => {
            const range = t("viewerShowing", { low: domain.low.toFixed(4), high: withUnit(domain.high, model.retentionTimeUnit) }) +
              (showingFullRange ? t("viewerFullRange") : "");
            return <span className="plot-range chromatogram-axis-caption chromatogram-range" id={AXIS_CAPTION_ID} title={range}>{range}</span>;
          })()}
          {/* An export's result, on the head's line beside its tools, never
              over the plot's data. */}
          {exportTools ? exportStatus : null}
          <Toolbar className="plot-tools" label={t("plotChromatogramTools")} roving>
            {VIEWPORT_CONTROLS.map(({ action, icon }) => {
              const label = t(action === "reset" ? "viewerReset" : action === "zoom-in" ? "viewerZoomIn" : "viewerZoomOut");
              // Planned again against the live state, not against the refusal
              // this render computed.
              const onClick = () => { applyViewportAction(readInteraction(), dispatch, action); };
              const refused = !viewportPlans[action].available;
              return icon === null
                ? <Button key={action} aria-label={label} onClick={onClick} reasonId={AXIS_CAPTION_ID} refused={refused} size="sm">{t("plotFitAll")}</Button>
                : <IconButton icon={<Icon name={icon} />} key={action} label={label} onClick={onClick}
                  reasonId={AXIS_CAPTION_ID} refused={refused} size="sm" variant="secondary" />;
            })}
            {exportTools ? <><span aria-hidden="true" className="plot-tools-divider" />{exportTools([rangeEditor.item])}</> : null}
          </Toolbar>
        </> : null}
      </div>
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
            unit={model.retentionTimeUnit}
            rangeEditing={rangeEditor.editing}
            onRangeEditorClose={rangeEditor.close}
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
            {model.reason === "no-spectra" ? null : <span>{t(UNAVAILABLE[model.reason])}</span>}
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
 * table beside it is on screen and does show rows. A run with no spectra needs
 * no second sentence: its heading already says so.
 */
const UNAVAILABLE = {
  truncated: "viewerTicPrefix", "unusable-retention-time": "viewerTicRt",
  "unusable-intensity": "viewerTicIntensity", "mixed-retention-time-units": "viewerTicUnit",
} as const satisfies Record<Exclude<ScanModelRefusal, "no-spectra">, string>;

/** A retention time with the symbol of the unit the run declares, or bare where it declares none. */
function withUnit(value: number, unit: RetentionTimeUnit): string {
  const symbol = retentionTimeUnitSymbol(unit);
  return symbol === null ? value.toFixed(4) : `${value.toFixed(4)} ${symbol}`;
}

interface PlotProps {
  /** The one unit every row declares; nothing converts it. */
  readonly unit: RetentionTimeUnit;
  readonly points: readonly ScanPoint[];
  readonly domain: RetentionTimeDomain;
  readonly full: RetentionTimeDomain;
  readonly traces: TraceVisibility;
  readonly selected: number | null;
  readonly hover: number | null;
  readonly dispatch: (event: ViewerEvent) => ViewerInteractionState;
  readonly readInteraction: () => ViewerInteractionState;
  readonly onSelect: (index: number) => void;
  readonly selectionAvailability: SpectrumSelectionAvailability;
  readonly rangeEditing: boolean;
  readonly onRangeEditorClose: () => void;
}

function ChromatogramPlot({
  unit,
  points,
  domain,
  traces,
  selected,
  hover,
  dispatch,
  readInteraction,
  onSelect,
  selectionAvailability,
  rangeEditing,
  onRangeEditorClose,
}: PlotProps) {
  const t = useUiMessages();
  const rtSymbol = retentionTimeUnitSymbol(unit);
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
    // The axes, from the same range and extent the traces were just placed by:
    // ticks along the range on screen, and value ticks and their rules over
    // the visible extent. With no trace drawn there are no values to rule.
    const frame = node.closest(".chromatogram-plot");
    const valueTicks = geometry.traces.length === 0 ? [] : niceTicks(scaleNow.valueLow, scaleNow.valueHigh);
    paintTicks(frame?.querySelector<HTMLElement>(".plot-x-ticks") ?? null, niceTicks(shown.low, shown.high),
      value => (scaleNow.x(value) / PLOT_WIDTH) * 100, "x");
    paintTicks(frame?.querySelector<HTMLElement>(".plot-y-ticks") ?? null, valueTicks, value => (scaleNow.y(value) / PLOT_HEIGHT) * 100, "y");
    paintGridlines(node.querySelector<SVGGElement>(".plot-gridlines"), valueTicks.map(tick => scaleNow.y(tick.value)),
      PADDING_LEFT, PLOT_WIDTH - PADDING_RIGHT);
    // The visible extent the value axis is scaled from, the clipped trace's
    // own: what PR #72's guard reads, since the ticks are rounded on purpose.
    for (const [name, value] of [["data-value-high", extentNow.high], ["data-value-low", extentNow.low]] as const) {
      if (geometry.traces.length === 0) node.removeAttribute(name); else node.setAttribute(name, formatIntensity(value));
    }
    for (const [kind, index] of [["selected", state.selection?.index], ["hover", state.hover?.spectrumIndex]] as const) {
      const group = node.querySelector(`.chromatogram-${kind}`); const point = index === undefined ? undefined : byIndex.get(index);
      group?.setAttribute("visibility", point === undefined ? "hidden" : "visible");
      if (point !== undefined) {
        const x = scaleNow.x(point.retentionTime);
        group?.querySelector("line")?.setAttribute("x1", String(x)); group?.querySelector("line")?.setAttribute("x2", String(x));
        if (kind === "selected") {
          // The rule's label follows it through a gesture, like the rule.
          const label = frame?.querySelector<HTMLElement>(".chromatogram-cursor-label");
          const at = (x / PLOT_WIDTH) * 100;
          if (label) {
            label.style.left = `${at.toFixed(3)}%`; label.dataset.side = at > 60 ? "left" : "right";
            label.hidden = x < PADDING_LEFT || x > PLOT_WIDTH - PADDING_RIGHT;
          }
        }
      }
    }
    // The range line is in the plot head, outside the plot's own frame.
    const line = node.closest(".chromatogram-panel")?.querySelector(".chromatogram-range");
    if (line) line.textContent = t("viewerShowing", { low: shown.low.toFixed(4), high: withUnit(shown.high, unit) }) +
      (state.committedDomain === null && state.gesture === null ? t("viewerFullRange") : "");
  }, [readInteraction, activeTraces, points, byIndex, t, domain, extent, scale, marks, unit]);
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
      {/* The drawing and its axes: the value title on its own row above, the
          ticks beside and under it, and the position title on the line under
          the ticks. The labels are HTML placed by percentage over the
          stretched drawing, so no height distorts them; React leaves the tick
          containers empty and paintFrame fills them. */}
      <div className="plot-frame chromatogram-frame">
        {/* The unit state, said rather than assumed. Nothing in the accepted
            contract establishes what these numbers are measured in, and a
            chromatogram labelled "minutes" states something the file did not.
            Said once per axis, in its title, and the two titles describe the
            plot (PM9 UI-33). */}
        <p className="plot-axis-title plot-axis-title-y" id={AXIS_Y_ID}>{t("plotAxisIntensity")}</p>
        <svg
          /*
           * The readout always, and the reason for a blocked selection while
           * there is one. Described rather than disabled: this plot can still be
           * read, and a reader who arrives at it is told which of the things it
           * offers is temporarily not one of them.
           */
          aria-describedby={
            selectionAvailability.status === "available"
              ? `chromatogram-readout ${AXIS_X_ID} ${AXIS_Y_ID} ${plotGestureHelpId("rt")}`
              : `chromatogram-readout ${AXIS_X_ID} ${AXIS_Y_ID} ${plotGestureHelpId("rt")} ${SPECTRUM_SELECTION_NOTICE_ID}`
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
          {/* Light rules at the value ticks, under everything drawn. */}
          <g aria-hidden="true" className="plot-gridlines" />
          <g className="chromatogram-axes">
            <line x1={PADDING_LEFT} x2={PLOT_WIDTH - PADDING_RIGHT} y1={BASELINE_Y} y2={BASELINE_Y} />
            <line x1={PADDING_LEFT} x2={PADDING_LEFT} y1={PADDING_TOP} y2={BASELINE_Y} />
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
                {/* A full-height rule, labelled with its scan and RT below
                    (P7): which scan is selected is readable without colour. */}
                <line
                  x1={scale.x(selectedPoint.retentionTime)}
                  x2={scale.x(selectedPoint.retentionTime)}
                  y1={PADDING_TOP}
                  y2={BASELINE_Y}
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
        <div aria-hidden="true" className="plot-y-ticks chromatogram-y-ticks" />
        <div aria-hidden="true" className="plot-x-ticks" />
        {/* The selected scan's own label at the top of its rule (P7), HTML
            placed by percentage like the ticks, so the stretch never distorts it. */}
        {selectedPoint === null ? null : (() => {
          const x = scale.x(selectedPoint.retentionTime);
          const at = (x / PLOT_WIDTH) * 100;
          // Off the range on screen, the rule is clipped and so is its label.
          return <span aria-hidden="true" className="chromatogram-cursor-label" data-side={at > 60 ? "left" : "right"}
            hidden={x < PADDING_LEFT || x > PLOT_WIDTH - PADDING_RIGHT}
            style={{ left: `${at.toFixed(3)}%` }}>
            {t("viewerCursorLabel", { scan: selectedPoint.scanNumber === null ? formatCount(selectedPoint.spectrumIndex) : formatCount(selectedPoint.scanNumber),
              rt: withUnit(selectedPoint.retentionTime, unit) })}
          </span>;
        })()}
        <PlotRangeActions port={inputPort} editing={rangeEditing} onClose={onRangeEditorClose} />
      </div>
      {/* One line under the ticks: the hovered scan while the pointer or the
          keyboard is on the plot, then the position title at the right. */}
      <div className="plot-foot">
        <p className="plot-readout">
          {/* Not a live region. Which scan the pointer is over changes on most
              pointer frames at a full-run zoom, and a region that announced each
              of them would be noise rather than feedback. It is the plot's
              accessible description instead, so a reader who focuses the plot is
              told what is selected. It shows while the pointer is over the plot
              or the plot holds the keyboard (P9: each fact once on screen). */}
          <span className="chromatogram-readout" id="chromatogram-readout" data-hover={hoveredPoint === null ? undefined : ""}
            data-idle={hoveredPoint === null && selectedPoint === null ? "" : undefined}>
            {hoveredPoint === null
              ? selectedPoint === null ? t("viewerNoSelection") : describeScan(selectedPoint, t("viewerSelected"), unit, t)
              : describeScan(hoveredPoint, t("viewerHover"), unit, t)}
          </span>
        </p>
        {/* The unit the file declares, or that it declares none; never a guess. */}
        <p className="plot-axis-title plot-axis-title-x" id={AXIS_X_ID}>{rtSymbol === null
          ? t("plotAxisRt") : t("plotAxisRtUnit", { unit: rtSymbol })}</p>
      </div>
    </div>
  );
}

/**
 * How a value and a retention time become viewBox coordinates.
 *
 * The retention-time axis is the range on screen exactly. The value axis is the
 * visible extent with headroom, so the tallest visible point sits below the
 * frame rather than on it; `valueLow`/`valueHigh` are that axis, for its ticks.
 */
function scaleFor(domain: RetentionTimeDomain, extent: ValueExtent) {
  const span = domain.high - domain.low;
  const axis = withHeadroom(extent.low, extent.high);
  const valueSpan = axis.high - axis.low;
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
      (usableY ? ((axis.high - value) / valueSpan) * USABLE_HEIGHT : USABLE_HEIGHT),
    valueLow: axis.low,
    valueHigh: axis.high,
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


/** What the readout says about one scan. */
function describeScan(point: ScanPoint, verb: string, unit: RetentionTimeUnit, t: UiMessage): string {
  const scan =
    point.scanNumber === null
      ? t("viewerScanUnreported")
      : t("viewerReportedScan", { index: formatCount(point.scanNumber) });
  return t("viewerScanReadout", { name: verb, index: formatCount(point.spectrumIndex), scan,
    level: formatCount(point.msLevel), rt: withUnit(point.retentionTime, unit),
    tic: formatIntensity(point.totalIonCurrent), bpc: formatIntensity(point.basePeakIntensity) });
}
