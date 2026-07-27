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
 * The most sticks the plot draws. A spectrum can carry far more points than a
 * screen has columns, so points are reduced to at most one stick per column
 * rather than emitting a node per point.
 */
const MAX_STICKS = 900;

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
  readonly maximumIntensity: number;
  readonly columnCount: number;
}

/**
 * Reduces the transferred points to at most one stick per column, keeping the
 * most intense point in each column.
 *
 * Keeping the maximum rather than the first or an average is what makes the
 * reduction safe to look at: a tall peak can never be replaced by a shorter
 * neighbour, and no value is drawn that the spectrum does not contain.
 */
function reduce(
  mz: readonly number[],
  intensity: readonly number[],
  reportedMzLow: number,
  reportedMzHigh: number,
): Reduction {
  let domainLow = reportedMzLow;
  let domainHigh = reportedMzHigh;
  let maximumIntensity = 0;
  for (let index = 0; index < mz.length; index += 1) {
    const value = mz[index] ?? 0;
    domainLow = Math.min(domainLow, value);
    domainHigh = Math.max(domainHigh, value);
    maximumIntensity = Math.max(maximumIntensity, intensity[index] ?? 0);
  }

  const span = domainHigh - domainLow;
  const columnCount = Math.min(MAX_STICKS, Math.max(1, mz.length));
  const columns = new Array<number>(columnCount).fill(-1);
  const columnMz = new Array<number>(columnCount).fill(0);

  for (let index = 0; index < mz.length; index += 1) {
    const value = mz[index] ?? 0;
    const height = intensity[index] ?? 0;
    const fraction = span > 0 ? (value - domainLow) / span : 0.5;
    const column = Math.min(columnCount - 1, Math.max(0, Math.floor(fraction * columnCount)));
    if (height > (columns[column] ?? -1)) {
      columns[column] = height;
      columnMz[column] = value;
    }
  }

  const usableWidth = PLOT_WIDTH - PLOT_PADDING_LEFT - PLOT_PADDING_RIGHT;
  const usableHeight = BASELINE_Y - PLOT_PADDING_TOP;
  const sticks: Stick[] = [];
  for (let column = 0; column < columnCount; column += 1) {
    const height = columns[column] ?? -1;
    if (height < 0) {
      continue;
    }
    const value = columnMz[column] ?? domainLow;
    const fraction = span > 0 ? (value - domainLow) / span : 0.5;
    const scaled = maximumIntensity > 0 ? height / maximumIntensity : 0;
    sticks.push({
      x: PLOT_PADDING_LEFT + fraction * usableWidth,
      y: BASELINE_Y - scaled * usableHeight,
    });
  }

  return { sticks, domainLow, domainHigh, maximumIntensity, columnCount };
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
        .map((stick) => `M${stick.x.toFixed(2)} ${BASELINE_Y}V${stick.y.toFixed(2)}`)
        .join(""),
    [reduction.sticks],
  );

  const flat = reduction.maximumIntensity <= 0;

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
          <line x1={0} x2={PLOT_WIDTH} y1={BASELINE_Y} y2={BASELINE_Y} />
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
          {flat ? "no intensity above zero" : formatIntensity(reduction.maximumIntensity)}
        </text>
      </svg>
      <figcaption className="spectrum-caption">
        {reduction.sticks.length < mz.length
          ? `Drawn as ${reduction.sticks.length} columns from ${mz.length} points, keeping the most intense point in each column.`
          : `Drawn as ${reduction.sticks.length} sticks, one per point.`}
        {" Horizontal axis: m/z. Vertical axis: intensity, scaled to the most intense point."}
        {representationKnown
          ? ""
          : " This file does not report whether these are profile samples or centroided peaks, so read each stick as one measured point rather than as a peak."}
      </figcaption>
    </figure>
  );
}
