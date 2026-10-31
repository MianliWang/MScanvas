import type { KeyboardEventHandler, ReactNode, Ref } from "react";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import { joinSentences, type UiMessage } from "../preferences/i18n";

import type { ProjectionSample, SpectrumRepresentation, ValueUnit } from "./contracts";
import { formatIntensity, formatMz } from "./format";
import { niceTicks, paintTicks, withHeadroom } from "./viewer/plotAxes";

/**
 * The drawing area, in viewBox units. The element scales to its container, so
 * these are resolution units rather than pixels.
 *
 * The tick labels and axis titles are HTML around the drawing, so the
 * stretched viewBox never distorts them and none of it is reserved for text.
 */
const PLOT_WIDTH = 1000;
const PLOT_HEIGHT = 260;
const PLOT_PADDING_LEFT = 8;
const PLOT_PADDING_RIGHT = 8;
/** Deep enough that the value title in the corner clears the headroom's top. */
const PLOT_PADDING_TOP = 12;
/** Room past each edge of the drawn band for a stick's stroke, in viewBox units (about 2 px). */
const STICK_BLEED = 4;

/**
 * The drawn band, exported so an interaction adapter resolves a pointer against
 * the same geometry the drawing used.
 *
 * A second copy of these numbers in the adapter is how a wheel comes to anchor
 * somewhere other than where the cursor is: the element scales to its
 * container, so the only way from a client x to an m/z is through this viewBox
 * and this padding. `preserveAspectRatio="none"` and `width: 100%` are what
 * make that mapping linear.
 */
export const SPECTRUM_PLOT_VIEWBOX_WIDTH = PLOT_WIDTH;
export const SPECTRUM_PLOT_PADDING_LEFT = PLOT_PADDING_LEFT;
export const SPECTRUM_PLOT_DRAWN_WIDTH = PLOT_WIDTH - PLOT_PADDING_LEFT - PLOT_PADDING_RIGHT;

/**
 * The part of the drawing an interaction adapter moves directly.
 *
 * A gesture is a stream of pointer frames, and this repository's frontend rules
 * keep frame data out of React state -- so during one the adapter transforms
 * this layer itself, and repaints the m/z axis with {@link paintMzAxis}, rather
 * than asking React to redraw the panel per frame. Named here, beside the
 * geometry they are positioned by, so the component that renders them and the
 * adapter that moves them cannot come to disagree about which node is which.
 *
 * The layer exists to be transformed as a whole: a pan is a translate and a
 * wheel zoom a scale about the pointer, which is exact and costs no reduction.
 */
export const SPECTRUM_STICKS_LAYER = "spectrum-sticks-layer";

/**
 * Puts the m/z ticks for `[low, high]` under the plot, and writes the window on
 * the drawing (`data-mz-low`/`data-mz-high`, at the axis precision) for a
 * reader that checks which range the drawing is under. One writer for a render
 * and for a gesture frame, so the two cannot disagree.
 */
export function paintMzAxis(plot: SVGSVGElement | null, low: number, high: number): void {
  const frame = plot?.closest(".spectrum-frame");
  if (plot === null || plot === undefined || frame === null || frame === undefined) return;
  const span = high - low;
  paintTicks(frame.querySelector<HTMLElement>(".plot-x-ticks"), niceTicks(low, high),
    value => ((PLOT_PADDING_LEFT + (span > 0 ? (value - low) / span : 0.5) * SPECTRUM_PLOT_DRAWN_WIDTH) / PLOT_WIDTH) * 100,
    "x");
  plot.setAttribute("data-mz-low", formatMz(low));
  plot.setAttribute("data-mz-high", formatMz(high));
}

/**
 * Where the sticks are clipped to while a gesture is moving them.
 *
 * Static drawings never reach it -- every stick is placed inside the band by
 * construction -- but a transient translate slides them out of it, and without a
 * clip they would be painted over the axis labels and the panel beside them.
 *
 * One identifier rather than a generated one: this panel renders exactly one
 * spectrum plot, either the viewport's or the inert transferred drawing, never
 * both.
 */
const STICKS_CLIP = "spectrum-plot-clip";
/** The bottom of the drawing area; the labels are outside the drawing. */
const BASELINE_Y = PLOT_HEIGHT - 4;

/**
 * The columns the plot reduces to. A spectrum can carry far more points than a
 * screen has columns, so points are reduced per column rather than emitting a
 * node per point. Each column can draw two sticks, one per sign.
 *
 * The same 900 `MAX_PROJECTION_COLUMNS` Rust reduces a screen projection to, and
 * that is not a coincidence: both numbers answer "how many columns does this
 * drawing have", which is what lets one reduction rule serve a transferred
 * prefix and a retained-source window alike.
 *
 * **It does not follow that a projection passes through here untouched**, and
 * believing it did is what let this component's caption claim every observation
 * was drawn when they were not. Rust's budget is `MAX_PROJECTION_POINTS`, which
 * is 1,800 -- two per column, one per sign -- and a window whose observations
 * fit that budget comes back *exact*, at source granularity. A window holding
 * 1,200 same-sign observations therefore arrives unreduced and is collapsed
 * here, into at most 900 sticks. So this reduction is a second one, and the
 * caption asks how many sticks it produced rather than what Rust reported.
 */
const MAX_COLUMNS = 900;

/**
 * What this drawing is of, and therefore what its axis is and what its caption
 * may claim.
 *
 * Tagged rather than a nullable domain, because the two are not the same
 * drawing with one number missing. A `transfer` drawing is the bounded array
 * this document received, over the range those points and the backend's
 * reported pair span -- the m/z axis is *derived from what is here*, which is
 * the only honest thing to do when nothing has established a domain. A
 * `viewport` drawing is one committed m/z window of the complete spectrum Rust
 * retained, and its axis is that window exactly: derived from the points would
 * be wrong, because the whole point of the window is that it may hold fewer
 * points than it spans, or none.
 */
export type SpectrumDrawing =
  | {
      readonly kind: "transfer";
      /** The pair the spectrum states for itself; `null` where it states none. */
      readonly reportedMzLow: number | null;
      readonly reportedMzHigh: number | null;
    }
  /**
   * A range with no drawing under it, and why there is none.
   *
   * **No points are drawn**, which is the whole point of the state existing: the
   * previous projection answered a different window, and leaving it under these
   * axes is how a reader comes to see one range's data beneath another range's
   * numbers.
   *
   * The reason is carried because the two are not the same thing to a reader. A
   * drawing that has not arrived is on its way; one that failed is not. The
   * status line beside the plot says which, so the caption names neither.
   */
  | {
      readonly kind: "viewport-blank";
      readonly low: number;
      readonly high: number;
      readonly reason: "pending" | "failed";
    }
  /**
   * A gesture in progress, drawn from the projection already in hand.
   *
   * Immediate feedback rather than a request per frame. The caption says the
   * points answer a different window, so a mid-drag picture is never read as the
   * answer to the range under the cursor.
   */
  | { readonly kind: "viewport-transient"; readonly low: number; readonly high: number; readonly outside?: OutsideSamples }
  | {
      readonly kind: "viewport";
      /** A profile projection's samples beyond each edge, which its line is cut between. */
      readonly outside?: OutsideSamples;
      /**
       * The committed window, used exactly.
       *
       * Nothing widens it to fit the points: a viewport that quietly grew to
       * include a peak just outside it would be showing a range the reader did
       * not ask for, and a window may truthfully hold no point at all.
       */
      readonly low: number;
      readonly high: number;
      /** How many observations the window holds, as Rust counted them. */
      readonly sourcePoints: number;
      /** Whether Rust drew fewer points than the window measured. */
      readonly reduced: boolean;
    };

/** The measured samples just below and just above a projection's window. */
export type OutsideSamples = readonly [ProjectionSample | null, ProjectionSample | null];

/**
 * Whether this drawing is something the reader can act on, and how.
 *
 * Tagged rather than a bag of optional handlers, so "this plot is inert" is a
 * state the type system holds rather than a set of props that happen to be
 * absent. A spectrum with no admitted viewport is genuinely inert: it is a
 * picture of the points this document received, and there is no range to move.
 *
 * Only the three attributes that must sit on the drawing itself are here. The
 * pointer and wheel adapters live on the element wrapping this one, because
 * they need a node whose identity does not change as the drawing does.
 */
export type SpectrumSurface =
  | { readonly kind: "static" }
  | {
      readonly kind: "interactive";
      /** Where a pointer is resolved against, and where the wheel is claimed. */
      readonly plotRef: Ref<SVGSVGElement>;
      /** The element saying what this viewport is doing right now. */
      readonly describedBy: string;
      readonly onKeyDown?: KeyboardEventHandler<SVGSVGElement>;
      /**
       * Whether any viewport action would change what this spectrum shows.
       *
       * Separate from `kind`, because a viewport can be admitted and still have
       * nothing to do: a spectrum whose points all report one m/z is `ready`,
       * truthfully drawn, and inert. It has a description worth reading and no
       * keyboard operation to perform, and those are different facts.
       *
       * The caller answers this from the M5.2 planner. Nothing here recomputes
       * a viewport limit.
       */
      readonly focusable: boolean;
    };

export interface StickSpectrumProps {
  readonly mz: readonly number[];
  readonly intensity: readonly number[];
  readonly drawing: SpectrumDrawing;
  /** A declared profile spectrum is drawn as a joined line over a viewport; anything else as sticks. */
  readonly representation?: SpectrumRepresentation;
  readonly mzUnit?: ValueUnit;
  readonly intensityUnit?: ValueUnit;
  readonly labelledBy: string;
  readonly surface: SpectrumSurface;
  /** The line under the ticks, left of the m/z title: what range is on screen. */
  readonly readout?: ReactNode;
  /** Whatever sits over the drawing without taking height (the range editor, its pending band). */
  readonly overlay?: ReactNode;
}

interface Stick {
  readonly x: number;
  readonly y: number;
}

interface Reduction {
  readonly sticks: readonly Stick[];
  /** Where one measured sample lands on this drawing's axes. */
  readonly toPoint: (mz: number, intensity: number) => Stick;
  readonly domainLow: number;
  readonly domainHigh: number;
  readonly intensityLow: number;
  readonly intensityHigh: number;
  /** The value axis: the visible extent with its headroom. */
  readonly axisLow: number;
  readonly axisHigh: number;
  /** How many of the given points fell inside the domain and were drawn from. */
  readonly drawnFrom: number;
  readonly negativeCount: number;
  /** Negative sticks that were placed at all -- one per column that had any. */
  readonly negativesDrawn: number;
  /**
   * Negative sticks drawn with no length: on the zero line rather than below
   * it, because the value range is wider than two decimals can hold apart.
   */
  readonly negativesDrawnFlat: number;
  readonly zeroY: number;
}

/**
 * How a coordinate is written into the path.
 *
 * Shared with the question of whether a stick has any length rather than
 * restated there: the caption has to ask exactly the question the drawing
 * answers, and a second copy of this rounding is how the two would come to
 * disagree. The export renderer learned the same lesson closing
 * M4.1-BLOCKER-A.
 */
function coordinate(value: number): string {
  return value.toFixed(2);
}

/** Whether a stick is drawn on the zero line rather than away from it. */
function drawsWithoutLength(y: number, zeroY: number): boolean {
  return coordinate(y) === coordinate(zeroY);
}

/**
 * The m/z range a transferred array is drawn over.
 *
 * The backend's reported pair, widened to hold every point that actually
 * arrived. Widened rather than trusted, because the pair describes the whole
 * spectrum while the array is a bounded prefix of it, and a point drawn outside
 * its own axis is drawn outside the plot.
 *
 * **This is not a viewport domain and must never be used as one.** It is
 * derived from what this document happens to hold, which is exactly why ADR 0038
 * put the domain question in Rust: an m/z array mzML permits but the figure
 * contract refuses still has a minimum and a maximum.
 */
function transferDomain(
  mz: readonly number[],
  reportedMzLow: number | null,
  reportedMzHigh: number | null,
): { readonly low: number; readonly high: number } {
  let low = reportedMzLow ?? Infinity;
  let high = reportedMzHigh ?? -Infinity;
  for (let index = 0; index < mz.length; index += 1) {
    const value = mz[index] ?? 0;
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  // A bound the spectrum does not state is drawn against the other one, or the
  // points; with neither, the axis is an empty one at zero, never infinite.
  if (low === Infinity) low = high === -Infinity ? 0 : high;
  if (high === -Infinity) high = low;
  return { low, high };
}

/**
 * The heights a joined profile line has where it crosses the window's edges:
 * the export renderer's rule, interpolated along the segment from the sample
 * beyond each edge to the nearest one inside (or to the sample beyond the
 * other edge, for a window between two samples). They set the value scale, as
 * they do in the export; nothing records them as data.
 */
function edgeHeights(
  mz: readonly number[],
  intensity: readonly number[],
  low: number,
  high: number,
  [below, above]: OutsideSamples,
): number[] {
  let first: ProjectionSample | null = null;
  let last: ProjectionSample | null = null;
  for (let index = 0; index < mz.length; index += 1) {
    const value = mz[index] ?? 0;
    if (value < low || value > high) continue;
    const sample = { mz: value, intensity: intensity[index] ?? 0 };
    first ??= sample;
    last = sample;
  }
  const at = (edge: number, left: ProjectionSample | null, right: ProjectionSample | null) =>
    left !== null && right !== null && left.mz < edge && edge < right.mz
      ? [left.intensity + (right.intensity - left.intensity) * ((edge - left.mz) / (right.mz - left.mz))] : [];
  return [...at(low, below, first ?? above), ...at(high, last ?? below, above)];
}

/**
 * Reduces the points inside the domain to the greatest non-negative and the
 * deepest negative value in each column.
 *
 * Both signs, because intensities can legitimately be negative after baseline
 * subtraction: dropping them, or keeping only whichever magnitude is larger,
 * would erase measured signal of the other sign. Note what this is *not*: an
 * all-positive column keeps one value, not two, so this is not a min/max
 * reduction and the caption below must not call it one. Keeping extremes is
 * also what makes the reduction safe to look at -- a tall peak can never be
 * replaced by a shorter neighbour, and no value is drawn that the spectrum
 * does not contain.
 *
 * **Clipped before the value extent is taken**, which is the order the
 * chromatogram had to learn. Taking the extent from points outside the drawn
 * range lets a peak that is not on screen set the axis, and the ordinary act of
 * zooming into a valley then flattens everything visible and labels the axis
 * with a number nobody can see.
 */
function reduce(
  mz: readonly number[],
  intensity: readonly number[],
  domainLow: number,
  domainHigh: number,
  /** A joined line's heights at the edges, which the scale must hold too. */
  edges: readonly number[] = [],
): Reduction {
  let intensityLow = Math.min(0, ...edges);
  let intensityHigh = Math.max(0, ...edges);
  let negativeCount = 0;
  let drawnFrom = 0;
  const inside = (value: number) => value >= domainLow && value <= domainHigh;
  for (let index = 0; index < mz.length; index += 1) {
    const value = mz[index] ?? 0;
    if (!inside(value)) {
      continue;
    }
    const height = intensity[index] ?? 0;
    drawnFrom += 1;
    intensityLow = Math.min(intensityLow, height);
    intensityHigh = Math.max(intensityHigh, height);
    if (height < 0) {
      negativeCount += 1;
    }
  }

  const span = domainHigh - domainLow;
  const columnCount = Math.min(MAX_COLUMNS, Math.max(1, drawnFrom));
  // Two extremes per column, not one. A column holding +100 and -90 must draw
  // both: keeping only the larger magnitude would erase a measured signal of
  // the other sign, which is the same defect as dropping negatives outright.
  const highest = new Array<number | null>(columnCount).fill(null);
  const highestMz = new Array<number>(columnCount).fill(0);
  const lowest = new Array<number | null>(columnCount).fill(null);
  const lowestMz = new Array<number>(columnCount).fill(0);

  for (let index = 0; index < mz.length; index += 1) {
    const value = mz[index] ?? 0;
    if (!inside(value)) {
      continue;
    }
    const height = intensity[index] ?? 0;
    const fraction = span > 0 ? (value - domainLow) / span : 0.5;
    const column = Math.min(columnCount - 1, Math.max(0, Math.floor(fraction * columnCount)));
    if (height >= 0) {
      const kept = highest[column];
      if (kept === null || kept === undefined || height > kept) {
        highest[column] = height;
        highestMz[column] = value;
      }
    } else {
      const kept = lowest[column];
      if (kept === null || kept === undefined || height < kept) {
        lowest[column] = height;
        lowestMz[column] = value;
      }
    }
  }

  const usableWidth = PLOT_WIDTH - PLOT_PADDING_LEFT - PLOT_PADDING_RIGHT;
  const usableHeight = BASELINE_Y - PLOT_PADDING_TOP;
  // The zero line sits where zero falls on the value axis, so a negative
  // stick hangs below it and a positive one rises above it. The axis is the
  // visible extent with headroom, so the tallest stick stops short of the frame.
  const axis = withHeadroom(intensityLow, intensityHigh);
  const valueSpan = axis.high - axis.low;
  const zeroY =
    valueSpan > 0
      ? PLOT_PADDING_TOP + (axis.high / valueSpan) * usableHeight
      : BASELINE_Y;

  const sticks: Stick[] = [];
  let negativesDrawn = 0;
  let negativesDrawnFlat = 0;
  const toPoint = (value: number, height: number): Stick => ({
    x: PLOT_PADDING_LEFT + (span > 0 ? (value - domainLow) / span : 0.5) * usableWidth,
    y: PLOT_PADDING_TOP + (valueSpan > 0 ? (axis.high - height) / valueSpan : 1) * usableHeight,
  });
  const place = (height: number | null | undefined, value: number) => {
    if (height === null || height === undefined) {
      return;
    }
    const stick = toPoint(value, height);
    if (height < 0) {
      negativesDrawn += 1;
      if (drawsWithoutLength(stick.y, zeroY)) {
        negativesDrawnFlat += 1;
      }
    }
    sticks.push(stick);
  };
  for (let column = 0; column < columnCount; column += 1) {
    place(highest[column], highestMz[column] ?? domainLow);
    place(lowest[column], lowestMz[column] ?? domainLow);
  }

  return {
    sticks,
    toPoint,
    domainLow,
    domainHigh,
    intensityLow,
    intensityHigh,
    axisLow: axis.low,
    axisHigh: axis.high,
    drawnFrom,
    negativeCount,
    negativesDrawn,
    negativesDrawnFlat,
    zeroY,
  };
}

/**
 * What the drawing can honestly claim about the negatives it drew.
 *
 * The caption used to say the deepest negative in each column is drawn below
 * the zero line, whatever the numbers were. Against a wide enough value range
 * that is false: coordinates are written to two decimals, so a small negative
 * beside a huge one lands *on* the zero line, drawn with no length at all.
 * Saying so is the difference between a reader concluding there is no negative
 * signal and a reader knowing there is some this drawing cannot show them.
 */
function describeNegativeDrawing(reduction: Reduction, t: UiMessage): string {
  const withHeight = reduction.negativesDrawn - reduction.negativesDrawnFlat;
  if (reduction.negativesDrawnFlat === 0) {
    return t("plotNegativeBelow");
  }
  if (withHeight === 0) {
    return t("plotNegativeFlat");
  }
  return t("plotNegativeMixed", { count: withHeight });
}

/**
 * Whether the drawing collapsed points, said only when it did.
 *
 * The counts are the caption's, and the m/z bounds the axis's; this sentence
 * says only what neither of them can: that sticks are not one per point. A
 * drawing that is one stick per point says nothing here.
 *
 * Neither sentence calls the drawing the measurement. A screen projection is a
 * bounded drawing of the science and never the science.
 */
function describeDrawing(
  reduction: Reduction,
  drawing: Extract<SpectrumDrawing, { readonly kind: "transfer" | "viewport" }>,
  t: UiMessage,
): string {
  if (drawing.kind === "transfer") {
    return reduction.sticks.length < reduction.drawnFrom ? t("plotTransferReduced") : "";
  }
  /*
   * Whether anything was collapsed, decided by what this drawing did rather
   * than by who did it.
   *
   * Reading Rust's `reduced` flag was wrong, and reachably so. That flag says
   * whether *Rust* drew fewer points than the window measured, and Rust's budget
   * is 1,800 points while this plot has 900 columns -- so a window holding 1,200
   * same-sign observations comes back exact, `reduced` false, and is then
   * collapsed here. The caption said "Drawn as 900 sticks of the 1,200
   * observations ... Every one of them is drawn", which contradicts its own
   * first sentence and is read out as the plot's description.
   *
   * Sticks against observations answers the question the sentence actually
   * asks, and it answers it for both reductions at once: fewer sticks than
   * observations means some observation is not individually drawn, whichever
   * side of the boundary dropped it.
   *
   * **What it must not do is guess why.** The sentence used to say more were
   * measured here than this drawing has columns, and that is a claim about
   * scarcity the drawing usually cannot support: `columnCount` is
   * `min(900, drawnFrom)`, so below nine hundred observations there are exactly
   * as many columns as observations and never fewer. Two peaks at m/z 120 and
   * 130 in a window of 100 to 200 collapse into one of two available columns --
   * the columns were not the constraint, the mapping was. So the reason given is
   * the one that is always true: observations that share a column are kept as
   * that column's extremes, which is the same rule on both sides of the boundary
   * and says nothing about how many columns there were.
   */
  return reduction.sticks.length < drawing.sourcePoints ? t("plotReduced") : "";
}

/**
 * A spectrum drawn as one SVG path.
 *
 * Sticks for a centroid or undeclared spectrum: those are discrete m/z
 * measurements, and joining them would draw intensity at m/z values that were
 * never measured. A spectrum the file declares profile is sampled along m/z,
 * so over a viewport it is the joined line the export draws (P175).
 * Everything is emitted into a single path so that a large spectrum costs one
 * node rather than thousands.
 *
 * The axis is a prop rather than a derivation, which is the M5.2 change. A
 * spectrum with no admitted viewport is still drawn over the range its own
 * points span, exactly as before; one with a viewport is drawn over the range
 * that viewport committed to, and the points come from Rust's bounded
 * projection of the complete spectrum it retained. This component decides
 * neither -- it draws what it is handed, over the axis it is handed.
 */
/**
 * What the caption and the axes cannot say about a drawing: how it was reduced,
 * how negative intensities are drawn, and an unreported representation. Shown
 * in Details → Spectrum source; empty when there is nothing to add.
 */
export function describeSpectrumSource(
  mz: readonly number[],
  intensity: readonly number[],
  drawing: SpectrumDrawing,
  representation: SpectrumRepresentation,
  t: UiMessage,
): string {
  const { reduction, line } = drawingGeometry(mz, intensity, drawing, representation);
  return joinSentences(t, [
    line !== null ? (drawing.kind === "viewport" && reduction.drawnFrom < drawing.sourcePoints ? t("plotReduced") : "")
      : drawing.kind === "viewport" || drawing.kind === "transfer" ? describeDrawing(reduction, drawing, t) : "",
    line === null && reduction.negativeCount > 0 ? describeNegativeDrawing(reduction, t) : "",
    representation === "notReported" ? t("plotUnknownRepresentation")
      : representation === "profile" ? t(line === null ? "plotProfileSticks" : "plotProfileLine") : "",
  ]);
}

const NO_OUTSIDE: OutsideSamples = [null, null];

/**
 * What one drawing draws: its m/z axis, its reduction, and -- for a declared
 * profile spectrum over a viewport -- the joined line (P175). Shared by the
 * plot and by Details, so the two cannot describe different drawings.
 *
 * The line runs from the sample beyond the low edge through the projection's
 * points to the sample beyond the high edge, and the band's clip cuts it at
 * each edge at the height between the two samples beside it -- the export's
 * cut. A settled window is scaled to those heights, as the export is. A
 * transferred drawing (no viewport) and a line of fewer than two samples stay
 * sticks: there is no window to cut, or nothing to join.
 */
function drawingGeometry(
  mz: readonly number[],
  intensity: readonly number[],
  drawing: SpectrumDrawing,
  representation: SpectrumRepresentation,
) {
  const domain = drawing.kind === "transfer"
    ? transferDomain(mz, drawing.reportedMzLow, drawing.reportedMzHigh)
    : { low: drawing.low, high: drawing.high };
  const outside = representation !== "profile" ? null
    : drawing.kind === "viewport" || drawing.kind === "viewport-transient" ? drawing.outside ?? NO_OUTSIDE : null;
  const edges = outside !== null && drawing.kind === "viewport"
    ? edgeHeights(mz, intensity, domain.low, domain.high, outside) : [];
  const reduction = reduce(mz, intensity, domain.low, domain.high, edges);
  let line: Stick[] | null = null;
  if (outside !== null && mz.length + (outside[0] === null ? 0 : 1) + (outside[1] === null ? 0 : 1) >= 2) {
    line = [];
    if (outside[0] !== null) line.push(reduction.toPoint(outside[0].mz, outside[0].intensity));
    for (let index = 0; index < mz.length; index += 1) line.push(reduction.toPoint(mz[index] ?? 0, intensity[index] ?? 0));
    if (outside[1] !== null) line.push(reduction.toPoint(outside[1].mz, outside[1].intensity));
  }
  return { domain, reduction, line };
}

export function StickSpectrum({
  mz,
  intensity,
  drawing,
  representation = "notReported",
  mzUnit,
  intensityUnit,
  labelledBy,
  surface,
  readout,
  overlay,
}: StickSpectrumProps) {
  const t = useUiMessages();
  const plotNode = useRef<SVGSVGElement | null>(null);
  const externalRef = surface.kind === "interactive" ? surface.plotRef : undefined;
  const attachPlot = useCallback((node: SVGSVGElement | null) => {
    plotNode.current = node;
    if (typeof externalRef === "function") externalRef(node);
    else if (externalRef) externalRef.current = node;
  }, [externalRef]);
  const { domain, reduction, line } = useMemo(
    () => drawingGeometry(mz, intensity, drawing, representation),
    [drawing, intensity, mz, representation],
  );

  const path = useMemo(
    () => line !== null
      ? line.map((point, index) => `${index === 0 ? "M" : "L"}${coordinate(point.x)} ${coordinate(point.y)}`).join("")
      : reduction.sticks
        .map(
          (stick) =>
            `M${coordinate(stick.x)} ${coordinate(reduction.zeroY)}V${coordinate(stick.y)}`,
        )
        .join(""),
    [line, reduction.sticks, reduction.zeroY],
  );

  const flat = reduction.intensityHigh === reduction.intensityLow;
  /** Whether this plot has anything on it, which the value axis depends on. */
  const nothingDrawn = line === null && reduction.sticks.length === 0;
  // The m/z axis is painted, not rendered: a gesture repaints it per frame.
  // Every render, so a title that changed width (another language) is
  // measured again against the labels beside it.
  useLayoutEffect(() => { paintMzAxis(plotNode.current, domain.low, domain.high); });
  /*
   * The value axis, and only where there are values.
   *
   * With nothing drawn the extent is zero to zero, so `flat` is true and the
   * axis used to read "every intensity is the same" -- a statement about
   * measurements, over a plot holding none, shown identically while a drawing
   * was outstanding, after one had failed, and for a window that truthfully
   * holds no measured point. An empty plot says nothing about intensity, which
   * is what it knows.
   */
  const valueTicks = nothingDrawn ? [] : niceTicks(reduction.axisLow, reduction.axisHigh);
  const valueSpan = reduction.axisHigh - reduction.axisLow;
  const valueY = (value: number) => valueSpan > 0
    ? PLOT_PADDING_TOP + ((reduction.axisHigh - value) / valueSpan) * (BASELINE_Y - PLOT_PADDING_TOP) : BASELINE_Y;
  // Each axis states the unit its array declares, by accession, as the export does.
  const valueTitle = (intensityUnit?.state === "declared" ? t("plotAxisIntensityUnit", { unit: intensityUnit.accession })
    : t("plotAxisIntensity")) + (flat && !nothingDrawn ? ` · ${t("plotFlat")}` : "");
  const mzTitle = mzUnit?.state === "declared" ? t("plotAxisMzUnit", { unit: mzUnit.accession }) : t("plotAxisMz");
  // A blank plot's caption names no drawing: the status line beside the plot
  // already says whether one is on its way or failed.
  const caption = [
    drawing.kind === "viewport" ? line !== null ? t("plotLineCaption", { count: reduction.drawnFrom, total: drawing.sourcePoints })
      : t("plotCaption", { count: reduction.sticks.length, total: drawing.sourcePoints }) :
      drawing.kind === "transfer" ? t("plotTransferCaption", { count: reduction.sticks.length, total: reduction.drawnFrom }) :
        drawing.kind === "viewport-transient" ? t("plotTransient") : "",
    reduction.negativeCount > 0 ? t("plotNegativeCount", { count: reduction.negativeCount }) : "",
  ].filter(part => part !== "").join(" · ");

  return (
    <figure className="spectrum-figure">
      {/* The drawing and its axes: the value title on its own row above, value
          ticks left of the drawing, m/z ticks under it, and the m/z title on
          the line under those. The text is HTML placed by percentage, so no
          plot height distorts it. */}
      <div className="plot-frame spectrum-frame">
        <p className="plot-axis-title plot-axis-title-y">{valueTitle}</p>
        <div aria-hidden="true" className="plot-y-ticks">
          {valueTicks.map(tick => <span className="plot-tick" key={tick.value} style={{ top: `${(valueY(tick.value) / PLOT_HEIGHT) * 100}%` }}>
            {tick.label}</span>)}
        </div>
        <svg
          // Described wherever there is a viewport, whether or not it can be
          // moved. What the range is and what the drawing is doing are true of an
          // inert viewport too, and are exactly what a reader who cannot act on it
          // still needs.
          aria-describedby={surface.kind === "interactive" ? surface.describedBy : undefined}
          aria-labelledby={labelledBy}
          className="plot spectrum-plot"
          // The visible extent the value axis is scaled from, since its ticks
          // are rounded: what a reader checking the scale reads.
          data-value-high={nothingDrawn ? undefined : formatIntensity(reduction.intensityHigh)}
          data-value-low={nothingDrawn ? undefined : formatIntensity(reduction.intensityLow)}
          // How the points are drawn: a joined line for a declared profile
          // spectrum over a viewport, sticks for everything else.
          data-drawn-as={line === null ? "sticks" : "line"}
          // Focusable exactly where there is something to do, and the keyboard
          // exposed only there with it. A tab stop that reaches a picture nothing
          // can be done to spends a keyboard user's time to tell them nothing --
          // which is what this did for a spectrum whose whole domain is one m/z,
          // because it asked whether a viewport existed rather than whether it
          // could move.
          onKeyDown={surface.kind === "interactive" && surface.focusable ? surface.onKeyDown : undefined}
          preserveAspectRatio="none"
          // Attached wherever there is a viewport. The wheel listener lives on
          // this node and must go on answering an inert spectrum's wheel by
          // declining it, rather than never hearing it.
          ref={attachPlot}
          role="img"
          // Chromium may implicitly tab to an SVG carrying input listeners.
          // Explicitly exclude inert/refused drawings from sequential focus.
          tabIndex={surface.kind === "interactive" && surface.focusable ? 0 : -1}
          viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`}
        >
          <defs>
            {/* A stick on either edge of the drawn band keeps its whole
                width: clipped at its centre it drew half as wide, and read as
                a lighter mark than its neighbours (P6). A joined line is cut
                exactly at the band's edges, which is where the export cuts it. */}
            <clipPath id={STICKS_CLIP}>
              <rect
                height={BASELINE_Y}
                width={PLOT_WIDTH - PLOT_PADDING_LEFT - PLOT_PADDING_RIGHT + 2 * (line === null ? STICK_BLEED : 0)}
                x={PLOT_PADDING_LEFT - (line === null ? STICK_BLEED : 0)}
                y={0}
              />
            </clipPath>
          </defs>
          {surface.kind === "interactive" ? <rect className="plot-range-band" aria-hidden="true"
            visibility="hidden" x={0} y={PLOT_PADDING_TOP} width={0} height={BASELINE_Y - PLOT_PADDING_TOP} /> : null}
          {/* Light rules at the value ticks, and the zero line the sticks stand on. */}
          <g aria-hidden="true" className="plot-gridlines">
            {valueTicks.map(tick => <line key={tick.value} x1={PLOT_PADDING_LEFT} x2={PLOT_WIDTH - PLOT_PADDING_RIGHT}
              y1={valueY(tick.value)} y2={valueY(tick.value)} />)}
          </g>
          <line className="plot-baseline" x1={0} x2={PLOT_WIDTH} y1={reduction.zeroY} y2={reduction.zeroY} />
          {/* The one node a gesture moves. Transformed as a whole rather than
              redrawn, so a pointer frame costs an attribute rather than a
              reduction over the projection. */}
          <g className={SPECTRUM_STICKS_LAYER} clipPath={`url(#${STICKS_CLIP})`}>
            {path === "" ? null : <path className={line === null ? "spectrum-sticks" : "spectrum-line"} d={path} />}
          </g>
        </svg>
        <div aria-hidden="true" className="plot-x-ticks" />
        {overlay}
      </div>
      {/* One line under the ticks, whatever the drawing is doing, so the box
          never changes height when a drawing arrives (which would also
          abandon a gesture): what range is on screen, then the m/z title. */}
      <div className="plot-foot">
        {readout}
        <p className="plot-axis-title plot-axis-title-x">{mzTitle}</p>
      </div>
      {/* What the drawing is made of, for a screen reader: Details says it to
          the eye, beside the rest of the spectrum's source. */}
      <figcaption className="spectrum-caption visually-hidden">
        <p>{caption}</p>
      </figcaption>
    </figure>
  );
}
