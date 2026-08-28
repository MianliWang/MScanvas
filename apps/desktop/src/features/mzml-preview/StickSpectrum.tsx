import type { KeyboardEventHandler, Ref } from "react";
import { useMemo } from "react";

import { formatCount, formatIntensity, formatMz } from "./format";

/**
 * The drawing area, in viewBox units. The element scales to its container, so
 * these are resolution units rather than pixels.
 */
const PLOT_WIDTH = 1000;
const PLOT_HEIGHT = 260;
const PLOT_PADDING_LEFT = 8;
const PLOT_PADDING_RIGHT = 8;
const PLOT_PADDING_TOP = 10;

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
 * The bottom of the drawing area. The gutter below it is deep enough for the
 * lowest-intensity label to sit clear of the m/z labels, which a spectrum
 * carrying negative intensity shows at the same time.
 */
const BASELINE_Y = PLOT_HEIGHT - 34;

/**
 * The columns the plot reduces to. A spectrum can carry far more points than a
 * screen has columns, so points are reduced per column rather than emitting a
 * node per point. Each column can draw two sticks, one per sign.
 *
 * The same 900 `MAX_PROJECTION_COLUMNS` Rust reduces a screen projection to, and
 * that is not a coincidence: both numbers answer "how many columns does this
 * drawing have". A projection therefore arrives already at this granularity and
 * passing it through here changes nothing, which is what makes one reduction
 * rule serve a transferred prefix and a retained-source window alike.
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
      /** The backend's own reported pair for the whole spectrum. */
      readonly reportedMzLow: number;
      readonly reportedMzHigh: number;
    }
  /**
   * A committed window whose drawing has not arrived.
   *
   * The axis is the committed one and **no points are drawn**, which is the
   * whole point of the state existing: the previous projection answered a
   * different window, and leaving it under these axes is how a reader comes to
   * see one range's data beneath another range's numbers.
   */
  | { readonly kind: "viewport-pending"; readonly low: number; readonly high: number }
  /**
   * A gesture in progress, drawn from the projection already in hand.
   *
   * Immediate feedback rather than a request per frame. The caption says the
   * points answer a different window, so a mid-drag picture is never read as the
   * answer to the range under the cursor.
   */
  | { readonly kind: "viewport-transient"; readonly low: number; readonly high: number }
  | {
      readonly kind: "viewport";
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
      readonly onKeyDown: KeyboardEventHandler<SVGSVGElement>;
    };

export interface StickSpectrumProps {
  readonly mz: readonly number[];
  readonly intensity: readonly number[];
  readonly drawing: SpectrumDrawing;
  /**
   * Whether the file said these are profile samples or centroided peaks. When
   * it did not, the caption says so, because a reduced profile spectrum looks
   * like a centroid one and the reader must not have to guess which they are
   * being shown.
   */
  readonly representationKnown: boolean;
  readonly labelledBy: string;
  readonly surface: SpectrumSurface;
}

interface Stick {
  readonly x: number;
  readonly y: number;
}

interface Reduction {
  readonly sticks: readonly Stick[];
  readonly domainLow: number;
  readonly domainHigh: number;
  readonly intensityLow: number;
  readonly intensityHigh: number;
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
  reportedMzLow: number,
  reportedMzHigh: number,
): { readonly low: number; readonly high: number } {
  let low = reportedMzLow;
  let high = reportedMzHigh;
  for (let index = 0; index < mz.length; index += 1) {
    const value = mz[index] ?? 0;
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  return { low, high };
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
): Reduction {
  let intensityLow = 0;
  let intensityHigh = 0;
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
  // The zero line sits where zero falls in the value range, so a negative
  // stick hangs below it and a positive one rises above it.
  const valueSpan = intensityHigh - intensityLow;
  const zeroY =
    valueSpan > 0
      ? PLOT_PADDING_TOP + (intensityHigh / valueSpan) * usableHeight
      : BASELINE_Y;

  const sticks: Stick[] = [];
  let negativesDrawn = 0;
  let negativesDrawnFlat = 0;
  const place = (height: number | null | undefined, value: number) => {
    if (height === null || height === undefined) {
      return;
    }
    const fraction = span > 0 ? (value - domainLow) / span : 0.5;
    const scaled = valueSpan > 0 ? (intensityHigh - height) / valueSpan : 1;
    const y = PLOT_PADDING_TOP + scaled * usableHeight;
    if (height < 0) {
      negativesDrawn += 1;
      if (drawsWithoutLength(y, zeroY)) {
        negativesDrawnFlat += 1;
      }
    }
    sticks.push({
      x: PLOT_PADDING_LEFT + fraction * usableWidth,
      y,
    });
  };
  for (let column = 0; column < columnCount; column += 1) {
    place(highest[column], highestMz[column] ?? domainLow);
    place(lowest[column], lowestMz[column] ?? domainLow);
  }

  return {
    sticks,
    domainLow,
    domainHigh,
    intensityLow,
    intensityHigh,
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
function describeNegativeDrawing(reduction: Reduction): string {
  const withHeight = reduction.negativesDrawn - reduction.negativesDrawnFlat;
  if (reduction.negativesDrawnFlat === 0) {
    return " The deepest negative in each column is drawn below the zero line.";
  }
  if (withHeight === 0) {
    return (
      " The value range is too wide to hold them apart from zero at this size," +
      " so they are drawn on the zero line without a length rather than below it."
    );
  }
  return (
    ` The deepest negative in ${withHeight} of the columns is drawn below the zero` +
    " line; in the rest the value range is too wide to hold them apart from zero" +
    " at this size, so they are drawn on the line without a length."
  );
}

/**
 * The drawn count, in agreement with itself. A reduction that yields one column
 * drew one stick, and saying `1 sticks` reads as a defect in the number.
 */
function formatSticks(count: number): string {
  return count === 1 ? "1 stick" : `${count} sticks`;
}

/**
 * What the drawing is, in the words it is allowed to use.
 *
 * The two drawings make different claims and the difference is the milestone.
 * A transferred prefix can only say how many of *its own* points went into how
 * many sticks. A viewport window can say how many observations the retained
 * source holds there -- which is a fact about the spectrum rather than about
 * this document, and is the number that makes panning past the transferred
 * prefix legible instead of mysterious.
 *
 * Neither sentence calls the drawing the measurement. A screen projection is a
 * bounded drawing of the science and never the science.
 */
function describeDrawing(reduction: Reduction, drawing: SpectrumDrawing): string {
  const drawn = formatSticks(reduction.sticks.length);
  if (drawing.kind === "transfer") {
    // The count is written plainly, not grouped. The sentence has said
    // `from 200000 points` since M4.1 and a reader comparing it with the
    // grouped `Points` fact beside it is comparing the same number twice; what
    // is not worth doing is changing a shipped sentence while moving it.
    return reduction.sticks.length < reduction.drawnFrom
      ? `Drawn as ${drawn} from ${String(reduction.drawnFrom)} points, keeping the greatest non-negative and the deepest negative value in each column, so a peak spread over several points can appear as one stick.`
      : `Drawn as ${drawn}, one per point.`;
  }
  if (drawing.kind === "viewport-pending") {
    // No claim about points at all, because none are drawn. What was drawn
    // before answered a different range and is not shown beneath these numbers.
    return `Waiting for the drawing of m/z ${formatMz(drawing.low)} to ${formatMz(drawing.high)}. Nothing is drawn here yet.`;
  }
  if (drawing.kind === "viewport-transient") {
    // Said plainly rather than hidden, because it is the one moment the picture
    // is not an answer about the range beneath it. The drawing in hand is being
    // stretched for feedback; the range is asked for when the gesture stops.
    return `Showing the drawing already in hand while the range is being changed. Release to draw m/z ${formatMz(drawing.low)} to ${formatMz(drawing.high)} from the retained spectrum.`;
  }
  const observations =
    drawing.sourcePoints === 1
      ? "1 observation"
      : `${formatCount(drawing.sourcePoints)} observations`;
  const opening = `Drawn as ${drawn} of the ${observations} this spectrum has between m/z ${formatMz(drawing.low)} and ${formatMz(drawing.high)}.`;
  return drawing.reduced
    ? `${opening} More were measured here than this drawing has columns, so each column keeps the greatest non-negative and the deepest negative value in it and a peak spread over several points can appear as one stick.`
    : `${opening} Every one of them is drawn.`;
}

/**
 * A stick spectrum drawn as one SVG path.
 *
 * Sticks, not a connected line: a mass spectrum is a set of discrete m/z
 * measurements, and joining them would draw intensity at m/z values that were
 * never measured. Everything is emitted into a single path so that a large
 * spectrum costs one node rather than thousands.
 *
 * The axis is a prop rather than a derivation, which is the M5.2 change. A
 * spectrum with no admitted viewport is still drawn over the range its own
 * points span, exactly as before; one with a viewport is drawn over the range
 * that viewport committed to, and the points come from Rust's bounded
 * projection of the complete spectrum it retained. This component decides
 * neither -- it draws what it is handed, over the axis it is handed.
 */
export function StickSpectrum({
  mz,
  intensity,
  drawing,
  representationKnown,
  labelledBy,
  surface,
}: StickSpectrumProps) {
  const domain = useMemo(
    () =>
      drawing.kind === "transfer"
        ? transferDomain(mz, drawing.reportedMzLow, drawing.reportedMzHigh)
        : { low: drawing.low, high: drawing.high },
    [drawing, mz],
  );

  const reduction = useMemo(
    () => reduce(mz, intensity, domain.low, domain.high),
    [domain.high, domain.low, intensity, mz],
  );

  const path = useMemo(
    () =>
      reduction.sticks
        .map(
          (stick) =>
            `M${coordinate(stick.x)} ${coordinate(reduction.zeroY)}V${coordinate(stick.y)}`,
        )
        .join(""),
    [reduction.sticks, reduction.zeroY],
  );

  const flat = reduction.intensityHigh === reduction.intensityLow;

  return (
    <figure className="spectrum-figure">
      <svg
        aria-describedby={surface.kind === "interactive" ? surface.describedBy : undefined}
        aria-labelledby={labelledBy}
        className="plot spectrum-plot"
        onKeyDown={surface.kind === "interactive" ? surface.onKeyDown : undefined}
        preserveAspectRatio="none"
        ref={surface.kind === "interactive" ? surface.plotRef : undefined}
        role="img"
        // Focusable exactly where there is something to do. A tab stop that
        // reaches a picture nothing can be done to spends a keyboard user's
        // time to tell them nothing.
        tabIndex={surface.kind === "interactive" ? 0 : undefined}
        viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`}
      >
        <g className="plot-grid">
          <line x1={0} x2={PLOT_WIDTH} y1={reduction.zeroY} y2={reduction.zeroY} />
          <line x1={0} x2={PLOT_WIDTH} y1={PLOT_PADDING_TOP} y2={PLOT_PADDING_TOP} />
        </g>
        {path === "" ? null : <path className="spectrum-sticks" d={path} />}
        <text className="axis-label" x={PLOT_PADDING_LEFT} y={PLOT_HEIGHT - 6}>
          {formatMz(reduction.domainLow)}
        </text>
        <text
          className="axis-label"
          textAnchor="end"
          x={PLOT_WIDTH - PLOT_PADDING_RIGHT}
          y={PLOT_HEIGHT - 6}
        >
          {formatMz(reduction.domainHigh)}
        </text>
        <text className="axis-label" x={PLOT_PADDING_LEFT} y={PLOT_PADDING_TOP - 2}>
          {flat ? "every intensity is the same" : formatIntensity(reduction.intensityHigh)}
        </text>
        {reduction.intensityLow < 0 ? (
          <text className="axis-label" x={PLOT_PADDING_LEFT} y={BASELINE_Y + 10}>
            {formatIntensity(reduction.intensityLow)}
          </text>
        ) : null}
      </svg>
      <figcaption className="spectrum-caption">
        {describeDrawing(reduction, drawing)}
        {" Horizontal axis: m/z. Vertical axis: intensity, scaled to the point furthest from zero."}
        {reduction.negativeCount > 0
          ? ` ${reduction.negativeCount} of the points ${reduction.negativeCount === 1 ? "carries" : "carry"} negative intensity.${describeNegativeDrawing(reduction)}`
          : ""}
        {representationKnown
          ? ""
          : " This file does not report whether these are profile samples or centroided peaks, so read each stick as one measured point rather than as a peak."}
      </figcaption>
    </figure>
  );
}
