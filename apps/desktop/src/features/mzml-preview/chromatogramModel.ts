/**
 * The chromatogram, as a projection of facts the spectrum table already carries.
 *
 * Every value drawn here crossed the typed preview boundary when the file was
 * opened. `SpectrumRow` reports a retention time, a total ion current and a
 * base peak intensity per scan, and the scan table already puts two of those on
 * screen — so the trace is a second reading of a table the user is looking at,
 * not a second measurement.
 *
 * Two things this deliberately is not:
 *
 * - It is **not** the standalone `msaccess tic` query. That capability is
 *   evidence-gated in this repository, and the representative acquisition
 *   returned exit 0 with no output for it. No preview operation is added here.
 * - It is **not** a stored chromatogram record read out of the file. Nothing in
 *   the accepted contract establishes that the source contained one, so nothing
 *   here may claim it.
 *
 * Neither is it recomputed from spectrum arrays. Summing intensities per scan
 * would need one selected-spectrum read per row — thousands of ProteoWizard
 * processes — and would produce numbers that could disagree with the table
 * beside them.
 */

import type { SpectrumRow, SpectrumTable } from "./contracts";

/** Which per-scan series a trace draws. */
export type ChromatogramTrace = "tic" | "bpc";

/**
 * One scan, as the chromatogram needs it.
 *
 * Deliberately narrow. The identifier and the precursor are on the row and are
 * not copied here, because nothing this plot draws or says needs them, and a
 * field copied "in case" is a field that ends up in a tooltip.
 */
export interface ChromatogramPoint {
  /** The row's own spectrum index, which is what a selection commits. */
  readonly spectrumIndex: number;
  /**
   * Where the row sits in the scan table.
   *
   * Kept because the table's order and the trace's order are different
   * questions: the table stays in acquisition order and the trace is drawn by
   * retention time. This is what makes a tie deterministic and what
   * Previous/Next walks.
   */
  readonly tablePosition: number;
  readonly scanNumber: number | null;
  readonly msLevel: number;
  readonly retentionTime: number;
  readonly totalIonCurrent: number;
  readonly basePeakIntensity: number;
}

/** A closed interval on the retention-time axis. */
export interface RetentionTimeDomain {
  readonly low: number;
  readonly high: number;
}

/** Why there is no chromatogram to draw. */
export type ChromatogramUnavailableReason =
  /** The preview did not load the complete spectrum table. */
  | "truncated"
  /** The run has no spectra at all. */
  | "no-spectra"
  /** A row carried a retention time that cannot be placed on an axis. */
  | "unusable-retention-time"
  /** A row carried a total ion current or base peak intensity that cannot be drawn. */
  | "unusable-intensity"
  /**
   * A row said its retention time carries a unit, and this build cannot say
   * which.
   *
   * `RetentionTime` on the wire is a value and a boolean. When the boolean is
   * true there is nowhere in it for the unit's identity, so the axis could not
   * be labelled with it -- and labelling the axis "unit not reported" while the
   * file did report one would be as false as guessing minutes. The frontend
   * type is simply wider than anything the boundary can currently produce.
   */
  | "unsupported-retention-time-unit";

export type ChromatogramModel =
  | { readonly status: "unavailable"; readonly reason: ChromatogramUnavailableReason }
  | {
      readonly status: "ready";
      /** Every scan, ordered for drawing. Never reduced — see {@link reduceTrace}. */
      readonly points: readonly ChromatogramPoint[];
      readonly fullDomain: RetentionTimeDomain;
    };

/*
 * A ready model carries no unit field, and that absence is the contract.
 *
 * It used to carry `retentionTimeUnitKnown`, and every reader had to decide
 * what to do with `true` -- which produced exactly the disagreement it invited:
 * the axis stopped saying "unit not reported" while the readout beside it went
 * on saying it. There was no honest third option, because `true` names no unit.
 *
 * So a ready model now *means* the retention-time unit is unreported. The axis
 * and the readout read one fact, and there is no branch where they can differ.
 * A row claiming a unit does not make a ready model at all.
 *
 * When a provider genuinely supplies one, the boundary has to widen first: a
 * typed state carrying the identity -- `Unreported` or `Known(unit)` -- rather
 * than a boolean with nothing behind it. This shape forces that change to be
 * explicit rather than letting a `true` slip through half-supported.
 */

/**
 * How far into the full span a visible domain may narrow.
 *
 * One ten-thousandth of the full retention-time span, and never below it. The
 * rule has to exist for two reasons: a zero-width viewport divides by zero when
 * a value is placed in it, and a span a few floating-point ulps wide places
 * every point in the same column. Stating it as a fraction of the data rather
 * than as an absolute time keeps it meaningful whether the run is seconds or
 * hours long — which matters especially because the unit is not reported.
 *
 * A run whose retention times are all identical has a zero-width full span. It
 * has no subrange to zoom into, so zooming is inert there rather than
 * ill-defined.
 */
export const MINIMUM_SPAN_FRACTION = 1 / 10_000;

/** How many columns a reduced trace may draw at most. */
export const MAX_TRACE_COLUMNS = 900;

/**
 * Reads the chromatogram out of a loaded spectrum table.
 *
 * Fails closed rather than drawing something smaller than it claims. A
 * truncated table is a prefix of the run, and a prefix drawn as a chromatogram
 * is a picture of a shorter experiment than the one that happened.
 */
export function buildChromatogramModel(table: SpectrumTable): ChromatogramModel {
  if (table.truncated) {
    return { status: "unavailable", reason: "truncated" };
  }
  if (table.rows.length === 0) {
    return { status: "unavailable", reason: "no-spectra" };
  }

  const points: ChromatogramPoint[] = [];
  for (let position = 0; position < table.rows.length; position += 1) {
    const row = table.rows[position];
    if (row === undefined) {
      continue;
    }
    // A coordinate that is not a finite number cannot be placed on an axis, and
    // a plot that quietly skips the rows it cannot place is a plot that has
    // stopped being the table. The backend contract says these are numbers; if
    // one ever is not, the honest answer is to say there is no chromatogram.
    if (!Number.isFinite(row.retentionTime.value)) {
      return { status: "unavailable", reason: "unusable-retention-time" };
    }
    if (!Number.isFinite(row.totalIonCurrent) || !Number.isFinite(row.basePeakIntensity)) {
      return { status: "unavailable", reason: "unusable-intensity" };
    }
    // One row is enough. There is no aggregate to take here: "every row said so"
    // would be a second, quieter way of arriving at a state this build cannot
    // describe, and the whole point is that it has no honest rendering.
    if (row.retentionTime.unitKnown) {
      return { status: "unavailable", reason: "unsupported-retention-time-unit" };
    }
    points.push({
      spectrumIndex: row.index,
      tablePosition: position,
      scanNumber: row.scanNumber,
      msLevel: row.msLevel,
      retentionTime: row.retentionTime.value,
      totalIonCurrent: row.totalIonCurrent,
      basePeakIntensity: row.basePeakIntensity,
    });
  }

  // A projection is sorted; the table is not touched. The scan table stays in
  // the order the run produced, because that is the order a scan number means
  // something in, and this array is a separate thing built for an axis.
  //
  // Equal retention times keep their table order, so which of two scans at the
  // same time is "first" is decided once, here, rather than by whatever
  // ordering a sort happened to produce.
  points.sort((left, right) =>
    left.retentionTime === right.retentionTime
      ? left.tablePosition - right.tablePosition
      : left.retentionTime - right.retentionTime,
  );

  const low = points[0]?.retentionTime ?? 0;
  const high = points[points.length - 1]?.retentionTime ?? 0;
  return { status: "ready", points, fullDomain: { low, high } };
}

/** The value one trace draws for one scan. Exactly the table's own number. */
export function traceValue(point: ChromatogramPoint, trace: ChromatogramTrace): number {
  return trace === "tic" ? point.totalIonCurrent : point.basePeakIntensity;
}

/** The first index whose retention time is at or after `retentionTime`. */
function lowerBound(points: readonly ChromatogramPoint[], retentionTime: number): number {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((points[middle]?.retentionTime ?? 0) < retentionTime) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

/**
 * The scan nearest a retention time, from the **full** model.
 *
 * Never from the reduced drawing. A reduced trace is a picture with fewer
 * vertices than the run has scans, so resolving a click against it would select
 * a neighbour of the scan the user pointed at — silently, and more often the
 * larger the run.
 *
 * Nearest means nearest retention time, because that is what the axis is.
 *
 * Ties are decided by table position, low first, and then by spectrum index.
 * Two scans can share a retention time exactly, and a click exactly between two
 * scans is equidistant from both; in neither case may the answer depend on
 * which one an iteration happened to reach first.
 */
export function nearestPoint(
  points: readonly ChromatogramPoint[],
  retentionTime: number,
): ChromatogramPoint | null {
  if (points.length === 0 || !Number.isFinite(retentionTime)) {
    return null;
  }
  const at = lowerBound(points, retentionTime);
  // Both neighbours are reduced to their group's earliest row *before* anything
  // is compared. Several scans can share a retention time, and the member the
  // search lands on depends on which side the probe approached from: `after` is
  // the first of its group and `before` is the last of its own. Comparing those
  // two table positions is comparing the wrong pair -- at an exact midpoint it
  // can pick the upper retention time even though the lower group holds the
  // earlier row -- so the tie rule is applied to the two canonical rows.
  const before = canonical(points, points[at - 1]);
  const after = canonical(points, points[at]);
  if (before === null) {
    return after;
  }
  if (after === null) {
    return before;
  }
  const toBefore = retentionTime - before.retentionTime;
  const toAfter = after.retentionTime - retentionTime;
  if (toBefore < toAfter) {
    return before;
  }
  if (toAfter < toBefore) {
    return after;
  }
  return preferred(before, after);
}

/** The earliest table row among the scans sharing this one's retention time. */
function canonical(
  points: readonly ChromatogramPoint[],
  point: ChromatogramPoint | undefined,
): ChromatogramPoint | null {
  if (point === undefined) {
    return null;
  }
  return points[lowerBound(points, point.retentionTime)] ?? point;
}

/** Of two equally good candidates, the one this module always chooses. */
function preferred(left: ChromatogramPoint, right: ChromatogramPoint): ChromatogramPoint {
  if (left.tablePosition !== right.tablePosition) {
    return left.tablePosition < right.tablePosition ? left : right;
  }
  return left.spectrumIndex <= right.spectrumIndex ? left : right;
}

/**
 * The stretch of the model a domain draws, with one scan of overhang each side.
 *
 * The overhang is what makes a zoomed trace continuous: without it the line
 * starts at the first scan inside the viewport, leaving a gap between the axis
 * edge and the data, as though the run began there. Both overhang points are
 * real scans, and the drawing is clipped to the plot area, so what the overhang
 * adds is the part of a real segment that crosses the edge.
 */
export function visibleSlice(
  points: readonly ChromatogramPoint[],
  domain: RetentionTimeDomain,
): { readonly start: number; readonly end: number } {
  const first = lowerBound(points, domain.low);
  let last = lowerBound(points, domain.high);
  while (last < points.length && (points[last]?.retentionTime ?? 0) <= domain.high) {
    last += 1;
  }
  return {
    start: Math.max(0, first - 1),
    end: Math.min(points.length, last + 1),
  };
}

/**
 * Reduces a trace to what a screen can draw, keeping only scans it really has.
 *
 * A joined trace cannot use the stick spectrum's per-sign extreme rule. That
 * rule keeps the greatest value in each column and the deepest negative one,
 * which is correct for sticks standing on a baseline and wrong for a line: the
 * line would be drawn through the column maxima and become an upper envelope,
 * with every trough between two peaks removed.
 *
 * So each column keeps up to four of its own scans -- its first, its lowest,
 * its highest and its last -- emitted in retention-time order and de-duplicated.
 * The extremes are what stops a tall peak being replaced by a shorter neighbour
 * and a deep trough being filled in; the first and last are what keeps the line
 * entering and leaving each column where the data does.
 *
 * No value is computed. Every vertex is a scan, which is why hovering one and
 * clicking one can both name a real row.
 */
export function reduceTrace(
  points: readonly ChromatogramPoint[],
  trace: ChromatogramTrace,
  domain: RetentionTimeDomain,
  columnCount: number = MAX_TRACE_COLUMNS,
): readonly ChromatogramPoint[] {
  const { start, end } = visibleSlice(points, domain);
  const available = end - start;
  if (available <= 0) {
    return [];
  }
  const columns = Math.max(1, Math.floor(columnCount));
  // Four vertices per column is this reduction's ceiling, so a slice already
  // below it cannot be shortened by running it and is returned whole.
  if (available <= columns * 4) {
    return points.slice(start, end);
  }

  const span = domain.high - domain.low;
  const kept = new Set<number>();
  let column = -1;
  let first = -1;
  let last = -1;
  let lowest = -1;
  let highest = -1;
  const flush = () => {
    if (first < 0) {
      return;
    }
    kept.add(first);
    kept.add(last);
    kept.add(lowest);
    kept.add(highest);
  };

  for (let index = start; index < end; index += 1) {
    const point = points[index];
    if (point === undefined) {
      continue;
    }
    const fraction = span > 0 ? (point.retentionTime - domain.low) / span : 0;
    const bucket = Math.min(columns - 1, Math.max(0, Math.floor(fraction * columns)));
    if (bucket !== column) {
      flush();
      column = bucket;
      first = index;
      lowest = index;
      highest = index;
    }
    last = index;
    const value = traceValue(point, trace);
    if (value < traceValue(points[lowest] ?? point, trace)) {
      lowest = index;
    }
    if (value > traceValue(points[highest] ?? point, trace)) {
      highest = index;
    }
  }
  flush();

  // Ascending, because these are vertices of one line and a line drawn through
  // them in any other order is a different shape.
  return [...kept].sort((left, right) => left - right).map((index) => points[index] as ChromatogramPoint);
}

export interface ValueExtent {
  readonly low: number;
  readonly high: number;
}

/**
 * The value range the plot draws, over the scans a domain shows.
 *
 * Zero is always in it. An intensity axis that started at the smallest value
 * present would make a flat trace at 4,000,000 look like structure, and a
 * chromatogram's shape is the thing a reader is being asked to judge.
 *
 * Nothing is normalized, scaled to a percentage, or clipped. A negative value
 * the backend emitted is drawn below zero, because it is what the table says.
 */
export function valueExtent(
  points: readonly ChromatogramPoint[],
  traces: readonly ChromatogramTrace[],
  domain: RetentionTimeDomain,
): ValueExtent {
  let low = 0;
  let high = 0;
  if (traces.length === 0) {
    return { low, high };
  }
  const { start, end } = visibleSlice(points, domain);
  for (let index = start; index < end; index += 1) {
    const point = points[index];
    if (point === undefined) {
      continue;
    }
    for (const trace of traces) {
      const value = traceValue(point, trace);
      low = Math.min(low, value);
      high = Math.max(high, value);
    }
  }
  return { low, high };
}

/** The narrowest retention-time span this domain may be zoomed to. */
export function minimumSpan(full: RetentionTimeDomain): number {
  const span = full.high - full.low;
  return span > 0 ? span * MINIMUM_SPAN_FRACTION : 0;
}

/** Whether a visible domain is the whole run. */
export function isFullDomain(
  visible: RetentionTimeDomain | null,
  full: RetentionTimeDomain,
): boolean {
  return visible === null || (visible.low <= full.low && visible.high >= full.high);
}

/**
 * Brings a domain back inside the run, keeping its span where it can.
 *
 * A pan that would leave the run is stopped at the edge rather than shortened,
 * so panning to the end and back does not slowly narrow the viewport.
 */
export function clampDomain(
  visible: RetentionTimeDomain,
  full: RetentionTimeDomain,
): RetentionTimeDomain {
  const fullSpan = full.high - full.low;
  if (!(fullSpan > 0)) {
    return { low: full.low, high: full.high };
  }
  const smallest = minimumSpan(full);
  let span = Math.min(fullSpan, Math.max(smallest, visible.high - visible.low));
  if (!Number.isFinite(span) || span <= 0) {
    span = fullSpan;
  }
  let low = Number.isFinite(visible.low) ? visible.low : full.low;
  low = Math.min(Math.max(low, full.low), full.high - span);
  return { low, high: low + span };
}

/**
 * Zooms about a point in the current viewport.
 *
 * `anchor` is where the pointer is, as a fraction of the visible width, so the
 * retention time under the cursor stays under the cursor. A keyboard zoom
 * passes 0.5 and works on the middle.
 */
export function zoomDomain(
  visible: RetentionTimeDomain,
  full: RetentionTimeDomain,
  factor: number,
  anchor: number,
): RetentionTimeDomain {
  const fullSpan = full.high - full.low;
  if (!(fullSpan > 0) || !Number.isFinite(factor) || factor <= 0) {
    return clampDomain(visible, full);
  }
  const span = visible.high - visible.low;
  if (!(span > 0)) {
    return clampDomain(visible, full);
  }
  const held = visible.low + span * Math.min(1, Math.max(0, anchor));
  const next = Math.min(fullSpan, Math.max(minimumSpan(full), span * factor));
  return clampDomain(
    { low: held - (held - visible.low) * (next / span), high: held + (visible.high - held) * (next / span) },
    full,
  );
}

/** Slides the viewport by a fraction of its own width. */
export function panDomain(
  visible: RetentionTimeDomain,
  full: RetentionTimeDomain,
  fraction: number,
): RetentionTimeDomain {
  const span = visible.high - visible.low;
  const shift = span * fraction;
  return clampDomain({ low: visible.low + shift, high: visible.high + shift }, full);
}

/**
 * Moves a viewport the least it can to put a retention time inside it.
 *
 * Used when a selection arrives from somewhere else — the scan table, or
 * Previous/Next — and lands outside what the plot is showing. Resetting the
 * zoom would be the easy answer and the wrong one: the user chose that span,
 * and selecting a scan is not a request to stop looking at it.
 */
export function revealDomain(
  visible: RetentionTimeDomain,
  full: RetentionTimeDomain,
  retentionTime: number,
): RetentionTimeDomain {
  if (!Number.isFinite(retentionTime)) {
    return visible;
  }
  if (retentionTime >= visible.low && retentionTime <= visible.high) {
    return visible;
  }
  const span = visible.high - visible.low;
  // A margin, so the marker arrives inside the plot rather than exactly on its
  // edge where the rule and the axis line coincide.
  const margin = span * 0.1;
  const low =
    retentionTime < visible.low ? retentionTime - margin : visible.high - span + (retentionTime - visible.high) + margin;
  return clampDomain({ low, high: low + span }, full);
}

/**
 * The row before or after the selected one, in the order the table shows.
 *
 * Table order rather than arithmetic on the index. The two are the same thing
 * only if the table is a gapless ascending run of indices, which nothing in the
 * contract promises: a filtered or reordered table would make `index + 1` a row
 * somewhere else, or no row at all.
 *
 * A selected index the table does not contain answers `null` rather than
 * guessing a neighbour for it — that state is reachable while a preview is
 * being replaced, and a guess there would move the user to an unrelated scan.
 */
export function adjacentSpectrumIndex(
  rows: readonly SpectrumRow[],
  selectedIndex: number | null,
  direction: -1 | 1,
): number | null {
  if (selectedIndex === null) {
    return null;
  }
  const position = rows.findIndex((row) => row.index === selectedIndex);
  if (position < 0) {
    return null;
  }
  return rows[position + direction]?.index ?? null;
}
