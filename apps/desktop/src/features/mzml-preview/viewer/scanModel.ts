/**
 * Layer A — the full scientific model.
 *
 * One immutable set of per-scan facts for one loaded preview. Every question
 * about *what the data is* is answered here, and every question about *what is
 * on screen* is answered somewhere else. That separation is the point of this
 * slice: PR #72 shipped a viewer in which drawing geometry, the visible value
 * range and the identity of a clicked scan were all derived from the same
 * partially-reduced array, and review found a real defect at each place the two
 * kinds of question were confused.
 *
 * What this module deliberately does not contain: screen coordinates, viewport
 * intersections, reduced vertices, hover geometry. See `renderGeometry.ts`.
 */

/** One scan, as everything downstream needs it. */
export interface ScanPoint {
  /** The row's own spectrum index. What a selection commits. */
  readonly spectrumIndex: number;
  /**
   * Where the row sits in the scan table.
   *
   * The table's order and the trace's order are different questions: the table
   * stays in acquisition order and the trace is drawn by retention time. This
   * is what makes a tie decidable and what Previous/Next walks.
   */
  readonly tablePosition: number;
  readonly scanNumber: number | null;
  readonly msLevel: number;
  readonly retentionTime: number;
  readonly totalIonCurrent: number;
  readonly basePeakIntensity: number;
}

/** Which per-scan series a trace draws. */
export type TraceKind = "tic" | "bpc";

/** A closed interval on the retention-time axis. */
export interface RetentionTimeDomain {
  readonly low: number;
  readonly high: number;
}

/** Why a run has no scientific model this build can present. */
export type ScanModelRefusal =
  /** The preview did not load the complete spectrum table. */
  | "truncated"
  /** The run has no spectra at all. */
  | "no-spectra"
  /** A row carried a retention time that cannot be placed on an axis. */
  | "unusable-retention-time"
  /** A row carried an intensity that cannot be drawn. */
  | "unusable-intensity"
  /**
   * A row said its retention time carries a unit, and this build cannot say
   * which.
   *
   * The wire carries a value and a boolean. When the boolean is true there is
   * nowhere in it for the unit's identity, so an axis could neither be labelled
   * with the unit nor honestly say none was reported. The frontend type is
   * wider than anything the boundary can currently produce, and the extra state
   * has no honest rendering -- so it produces no model rather than a
   * half-described one.
   *
   * Carried forward from PR #72, where it was established and accepted. A
   * future provider that genuinely reports a unit needs the typed boundary
   * widened to carry the unit itself; this refusal is what forces that to be an
   * explicit change.
   */
  | "unsupported-retention-time-unit";

export type ScanModel =
  | { readonly status: "unavailable"; readonly reason: ScanModelRefusal }
  | {
      readonly status: "ready";
      /**
       * Every scan, ordered by retention time and then by table position.
       *
       * Never reduced. Reduction is a property of a drawing, and this is not
       * one -- which is why nearest-scan resolution reads this and nothing
       * else.
       */
      readonly points: readonly ScanPoint[];
      readonly fullDomain: RetentionTimeDomain;
    };

/** What one row of the spectrum table has to say for a model to be built. */
export interface ScanSource {
  readonly index: number;
  readonly tablePosition: number;
  readonly scanNumber: number | null;
  readonly msLevel: number;
  readonly retentionTime: number;
  /** Whether the source reported what the retention time is measured in. */
  readonly retentionTimeUnitKnown: boolean;
  readonly totalIonCurrent: number;
  readonly basePeakIntensity: number;
}

/**
 * Reads the scientific model, or refuses with a reason.
 *
 * Fails closed throughout. A truncated table is a prefix of the run, and a
 * prefix drawn as a chromatogram is a picture of a shorter experiment than the
 * one that happened; a coordinate that is not a finite number cannot be placed
 * on an axis; and a unit this build cannot name cannot be honestly labelled.
 * Each of those produces no model rather than a partial one.
 */
export function buildScanModel(source: {
  readonly rows: readonly ScanSource[];
  readonly truncated: boolean;
}): ScanModel {
  if (source.truncated) {
    return { status: "unavailable", reason: "truncated" };
  }
  if (source.rows.length === 0) {
    return { status: "unavailable", reason: "no-spectra" };
  }

  const points: ScanPoint[] = [];
  for (const row of source.rows) {
    if (!Number.isFinite(row.retentionTime)) {
      return { status: "unavailable", reason: "unusable-retention-time" };
    }
    if (!Number.isFinite(row.totalIonCurrent) || !Number.isFinite(row.basePeakIntensity)) {
      return { status: "unavailable", reason: "unusable-intensity" };
    }
    // One row is enough. "Every row agreed" is not a special path, because
    // agreement does not supply the missing identity.
    if (row.retentionTimeUnitKnown) {
      return { status: "unavailable", reason: "unsupported-retention-time-unit" };
    }
    points.push({
      spectrumIndex: row.index,
      tablePosition: row.tablePosition,
      scanNumber: row.scanNumber,
      msLevel: row.msLevel,
      retentionTime: row.retentionTime,
      totalIonCurrent: row.totalIonCurrent,
      basePeakIntensity: row.basePeakIntensity,
    });
  }

  // A projection is sorted; the source order is the caller's and is not
  // touched. Equal retention times keep table order, which is what makes every
  // later "which of these two scans" answerable without depending on iteration
  // order.
  points.sort((left, right) =>
    left.retentionTime === right.retentionTime
      ? left.tablePosition - right.tablePosition
      : left.retentionTime - right.retentionTime,
  );

  return {
    status: "ready",
    points,
    fullDomain: {
      low: points[0]?.retentionTime ?? 0,
      high: points[points.length - 1]?.retentionTime ?? 0,
    },
  };
}

/** The value one trace draws for one scan. Exactly the source's own number. */
export function traceValue(point: ScanPoint, trace: TraceKind): number {
  return trace === "tic" ? point.totalIonCurrent : point.basePeakIntensity;
}

/** The first index whose retention time is at or after `retentionTime`. */
export function lowerBound(
  points: readonly ScanPoint[],
  retentionTime: number,
): number {
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
 * Never from reduced drawing vertices, and never from a boundary intersection:
 * a reduced trace has fewer vertices than the run has scans, so resolving there
 * would select a neighbour of the scan the user pointed at -- silently, and more
 * often the larger the run -- and a boundary intersection is not a scan at all.
 *
 * Ties are decided by table position, low first, then by spectrum index. Both
 * neighbours are reduced to their group's earliest row *before* anything is
 * compared: a binary search lands beside the last member of the lower
 * retention-time group and the first member of the upper one, and comparing
 * those two is comparing the wrong pair.
 */
export function nearestScan(
  points: readonly ScanPoint[],
  retentionTime: number,
): ScanPoint | null {
  if (points.length === 0 || !Number.isFinite(retentionTime)) {
    return null;
  }
  const at = lowerBound(points, retentionTime);
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
  points: readonly ScanPoint[],
  point: ScanPoint | undefined,
): ScanPoint | null {
  if (point === undefined) {
    return null;
  }
  return points[lowerBound(points, point.retentionTime)] ?? point;
}

/** Of two equally near candidates, the one this module always chooses. */
function preferred(left: ScanPoint, right: ScanPoint): ScanPoint {
  if (left.tablePosition !== right.tablePosition) {
    return left.tablePosition < right.tablePosition ? left : right;
  }
  return left.spectrumIndex <= right.spectrumIndex ? left : right;
}

/**
 * The scan before or after the selected one, in the order the table shows.
 *
 * Table order rather than arithmetic on the index. The two are the same thing
 * only if the table is a gapless ascending run of indices, which nothing in the
 * contract promises. A selected index the table does not contain answers `null`
 * rather than guessing a neighbour for it.
 */
export function adjacentScan(
  rows: readonly { readonly index: number }[],
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
