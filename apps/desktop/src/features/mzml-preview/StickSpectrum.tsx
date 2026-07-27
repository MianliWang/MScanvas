import { useMemo } from "react";

import { formatIntensity, formatMz } from "./format";

/**
 * The drawing area, in viewBox units. The element scales to its container, so
 * these are resolution units rather than pixels.
 */
const PLOT_WIDTH = 1000;
const PLOT_HEIGHT = 260;
const PLOT_PADDING_LEFT = 8;
const PLOT_PADDING_RIGHT = 8;
const PLOT_PADDING_TOP = 10;
const BASELINE_Y = PLOT_HEIGHT - 22;

/**
 * The columns the plot reduces to. A spectrum can carry far more points than a
 * screen has columns, so points are reduced per column rather than emitting a
 * node per point. Each column can draw two sticks, one per sign.
 */
const MAX_COLUMNS = 900;

export interface StickSpectrumProps {
  readonly mz: readonly number[];
  readonly intensity: readonly number[];
  readonly reportedMzLow: number;
  readonly reportedMzHigh: number;
  /**
   * Whether the file said these are profile samples or centroided peaks. When
   * it did not, the caption says so, because a reduced profile spectrum looks
   * like a centroid one and the reader must not have to guess which they are
   * being shown.
   */
  readonly representationKnown: boolean;
  readonly labelledBy: string;
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
  readonly negativeCount: number;
  readonly zeroY: number;
}

/**
 * Reduces the transferred points to the highest and the lowest value in each
 * column.
 *
 * Both extremes, because intensities can legitimately be negative after
 * baseline subtraction: dropping them, or keeping only whichever magnitude is
 * larger, would erase measured signal of the other sign. Keeping extremes is
 * also what makes the reduction safe to look at — a tall peak can never be
 * replaced by a shorter neighbour, and no value is drawn that the spectrum
 * does not contain.
 */
function reduce(
  mz: readonly number[],
  intensity: readonly number[],
  reportedMzLow: number,
  reportedMzHigh: number,
): Reduction {
  let domainLow = reportedMzLow;
  let domainHigh = reportedMzHigh;
  let intensityLow = 0;
  let intensityHigh = 0;
  let negativeCount = 0;
  for (let index = 0; index < mz.length; index += 1) {
    const value = mz[index] ?? 0;
    const height = intensity[index] ?? 0;
    domainLow = Math.min(domainLow, value);
    domainHigh = Math.max(domainHigh, value);
    intensityLow = Math.min(intensityLow, height);
    intensityHigh = Math.max(intensityHigh, height);
    if (height < 0) {
      negativeCount += 1;
    }
  }

  const span = domainHigh - domainLow;
  const columnCount = Math.min(MAX_COLUMNS, Math.max(1, mz.length));
  // Two extremes per column, not one. A column holding +100 and -90 must draw
  // both: keeping only the larger magnitude would erase a measured signal of
  // the other sign, which is the same defect as dropping negatives outright.
  const highest = new Array<number | null>(columnCount).fill(null);
  const highestMz = new Array<number>(columnCount).fill(0);
  const lowest = new Array<number | null>(columnCount).fill(null);
  const lowestMz = new Array<number>(columnCount).fill(0);

  for (let index = 0; index < mz.length; index += 1) {
    const value = mz[index] ?? 0;
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
  const place = (height: number | null | undefined, value: number) => {
    if (height === null || height === undefined) {
      return;
    }
    const fraction = span > 0 ? (value - domainLow) / span : 0.5;
    const scaled = valueSpan > 0 ? (intensityHigh - height) / valueSpan : 1;
    sticks.push({
      x: PLOT_PADDING_LEFT + fraction * usableWidth,
      y: PLOT_PADDING_TOP + scaled * usableHeight,
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
    negativeCount,
    zeroY,
  };
}

/**
 * A stick spectrum drawn as one SVG path.
 *
 * Sticks, not a connected line: a mass spectrum is a set of discrete m/z
 * measurements, and joining them would draw intensity at m/z values that were
 * never measured. Everything is emitted into a single path so that a large
 * spectrum costs one node rather than thousands.
 */
export function StickSpectrum({
  mz,
  intensity,
  reportedMzLow,
  reportedMzHigh,
  representationKnown,
  labelledBy,
}: StickSpectrumProps) {
  const reduction = useMemo(
    () => reduce(mz, intensity, reportedMzLow, reportedMzHigh),
    [intensity, mz, reportedMzHigh, reportedMzLow],
  );

  const path = useMemo(
    () =>
      reduction.sticks
        .map((stick) => `M${stick.x.toFixed(2)} ${reduction.zeroY.toFixed(2)}V${stick.y.toFixed(2)}`)
        .join(""),
    [reduction.sticks, reduction.zeroY],
  );

  const flat = reduction.intensityHigh === reduction.intensityLow;

  return (
    <figure className="spectrum-figure">
      <svg
        aria-labelledby={labelledBy}
        className="plot spectrum-plot"
        preserveAspectRatio="none"
        role="img"
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
        {reduction.sticks.length < mz.length
          ? `Drawn as ${reduction.sticks.length} sticks from ${mz.length} points, keeping the highest and the lowest value in each column, so a peak spread over several points can appear as one stick.`
          : `Drawn as ${reduction.sticks.length} sticks, one per point.`}
        {" Horizontal axis: m/z. Vertical axis: intensity, scaled to the point furthest from zero."}
        {reduction.negativeCount > 0
          ? ` ${reduction.negativeCount} of the points ${reduction.negativeCount === 1 ? "carries" : "carry"} negative intensity; the lowest in each column is drawn below the zero line.`
          : ""}
        {representationKnown
          ? ""
          : " This file does not report whether these are profile samples or centroided peaks, so read each stick as one measured point rather than as a peak."}
      </figcaption>
    </figure>
  );
}
