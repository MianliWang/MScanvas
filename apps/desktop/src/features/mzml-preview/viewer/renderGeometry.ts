/**
 * Layer F — geometry, and nothing that is a measurement.
 *
 * Everything here exists because a line has to be drawn inside a rectangle.
 * None of it is scientific data: a boundary intersection is not a scan, a
 * reduced vertex list is not the run, and neither may ever answer "which scan
 * did the user point at". That question is `nearestScan`'s, over the full
 * model, always.
 *
 * The pipeline is ordered, and the order is the contract:
 *
 *   full source scans
 *     -> segments intersecting the x viewport
 *     -> clip to the viewport, interpolating at the edges
 *     -> visible y extent
 *     -> screen reduction of the visible geometry
 *     -> render
 *
 * PR #72 ran it the other way at one step: it took the value extent from a
 * source window that deliberately included one scan outside each edge, so a
 * fully clipped peak could set the axis. Zooming into the valley after a tall
 * peak -- the most ordinary thing anyone does with a chromatogram -- flattened
 * every visible feature and labelled the axis with a number that was not on
 * screen. Deriving the extent from the clipped polyline instead removes the
 * question rather than answering it more carefully.
 */

import type { RetentionTimeDomain, ScanPoint, TraceKind } from "./scanModel";
import { lowerBound, traceValue } from "./scanModel";

/**
 * One vertex of a drawn line.
 *
 * Two kinds, told apart by the type rather than by a convention, because only
 * one of them is a scan. A `boundary` vertex has no spectrum index and no way
 * to acquire one: it exists only because a real segment between two real scans
 * visibly crosses the edge of the viewport.
 */
export type VisibleVertex =
  | {
      readonly kind: "scan";
      readonly retentionTime: number;
      readonly value: number;
      readonly scan: ScanPoint;
    }
  | {
      readonly kind: "boundary";
      readonly retentionTime: number;
      /** Linearly interpolated between the two scans the segment joins. */
      readonly value: number;
    };

export interface ValueExtent {
  readonly low: number;
  readonly high: number;
}

/**
 * The part of one trace that is actually inside the viewport.
 *
 * Piecewise linear between real scan values, clipped to
 * `[domain.low, domain.high]`, with an interpolated vertex wherever a segment
 * crosses an edge. Vertices come out in retention-time order and are not
 * repeated where consecutive segments share an endpoint.
 */
export function clipTrace(
  points: readonly ScanPoint[],
  trace: TraceKind,
  domain: RetentionTimeDomain,
): readonly VisibleVertex[] {
  if (points.length === 0 || !(domain.high >= domain.low)) {
    return [];
  }

  // One scan is a point rather than a line: there is no segment to clip, so it
  // is visible exactly when it is inside.
  if (points.length === 1) {
    const only = points[0] as ScanPoint;
    return inside(domain, only.retentionTime) ? [scanVertex(only, trace)] : [];
  }

  // Start one segment before the first scan at or after `domain.low`, so a
  // segment that enters the viewport from the left is considered.
  const first = Math.max(0, lowerBound(points, domain.low) - 1);
  const vertices: VisibleVertex[] = [];

  for (let index = first; index + 1 < points.length; index += 1) {
    const left = points[index];
    const right = points[index + 1];
    if (left === undefined || right === undefined) {
      continue;
    }
    // Past the right edge: every later segment is too.
    if (left.retentionTime > domain.high) {
      break;
    }
    appendSegment(vertices, left, right, trace, domain);
  }

  return vertices;
}

/** Adds the visible part of one segment, if it has one. */
function appendSegment(
  vertices: VisibleVertex[],
  left: ScanPoint,
  right: ScanPoint,
  trace: TraceKind,
  domain: RetentionTimeDomain,
): void {
  const leftTime = left.retentionTime;
  const rightTime = right.retentionTime;
  // Entirely on one side, touching nothing.
  if (Math.max(leftTime, rightTime) < domain.low || Math.min(leftTime, rightTime) > domain.high) {
    return;
  }

  // A vertical segment -- two scans at the same retention time -- has no
  // interior to interpolate. Whichever endpoints are inside are the visible
  // ones.
  if (leftTime === rightTime) {
    if (inside(domain, leftTime)) {
      push(vertices, scanVertex(left, trace));
      push(vertices, scanVertex(right, trace));
    }
    return;
  }

  const start = inside(domain, leftTime)
    ? scanVertex(left, trace)
    : boundaryVertex(left, right, trace, leftTime < domain.low ? domain.low : domain.high);
  const end = inside(domain, rightTime)
    ? scanVertex(right, trace)
    : boundaryVertex(left, right, trace, rightTime > domain.high ? domain.high : domain.low);

  push(vertices, start);
  push(vertices, end);
}

/** The interpolated crossing of one segment at one retention time. */
function boundaryVertex(
  left: ScanPoint,
  right: ScanPoint,
  trace: TraceKind,
  at: number,
): VisibleVertex {
  const span = right.retentionTime - left.retentionTime;
  const fraction = span === 0 ? 0 : (at - left.retentionTime) / span;
  const from = traceValue(left, trace);
  const to = traceValue(right, trace);
  return { kind: "boundary", retentionTime: at, value: from + (to - from) * fraction };
}

function scanVertex(scan: ScanPoint, trace: TraceKind): VisibleVertex {
  return {
    kind: "scan",
    retentionTime: scan.retentionTime,
    value: traceValue(scan, trace),
    scan,
  };
}

/** Appends unless it repeats the vertex already at the end. */
function push(vertices: VisibleVertex[], vertex: VisibleVertex): void {
  const last = vertices[vertices.length - 1];
  if (
    last !== undefined &&
    last.retentionTime === vertex.retentionTime &&
    last.value === vertex.value &&
    last.kind === vertex.kind
  ) {
    return;
  }
  vertices.push(vertex);
}

function inside(domain: RetentionTimeDomain, retentionTime: number): boolean {
  return retentionTime >= domain.low && retentionTime <= domain.high;
}

/**
 * The value range the plot draws, from the geometry it actually draws.
 *
 * Zero is always in it: an axis that started at the smallest value present
 * would make a flat trace at 4,000,000 look like structure, and a
 * chromatogram's shape is what a reader is being asked to judge.
 *
 * Nothing is normalized, scaled to a percentage or clipped. A negative value
 * the backend emitted is below zero because that is what the source says.
 *
 * The input is the **clipped** polyline, so a scan outside the viewport cannot
 * set the range, while the interpolated height where a segment crosses the edge
 * can -- because that height is on screen.
 */
export function visibleExtent(
  traces: readonly (readonly VisibleVertex[])[],
): ValueExtent {
  let low = 0;
  let high = 0;
  for (const vertices of traces) {
    for (const vertex of vertices) {
      low = Math.min(low, vertex.value);
      high = Math.max(high, vertex.value);
    }
  }
  return { low, high };
}

/** How many columns a reduced trace may draw at most. */
export const MAX_TRACE_COLUMNS = 900;

/**
 * Reduces the visible polyline to what a screen can draw.
 *
 * Each column keeps up to four of its own vertices -- its first, its lowest,
 * its highest and its last -- emitted in retention-time order and de-duplicated.
 *
 * A joined trace cannot use the stick spectrum's per-sign extreme rule: keeping
 * each column's greatest value draws the line through the maxima and turns it
 * into an upper envelope, with every trough between two peaks removed. The
 * extremes stop a tall peak being replaced by a shorter neighbour and a deep
 * trough being filled in; the first and last keep the line entering and leaving
 * each column where the data does.
 *
 * Runs last, on geometry that is already clipped, so it cannot change what the
 * axis says. No value is invented: every vertex it keeps is one it was given.
 */
export function reduceVisible(
  vertices: readonly VisibleVertex[],
  domain: RetentionTimeDomain,
  columnCount: number = MAX_TRACE_COLUMNS,
): readonly VisibleVertex[] {
  const columns = Math.max(1, Math.floor(columnCount));
  if (vertices.length <= columns * 4) {
    return vertices;
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

  for (let index = 0; index < vertices.length; index += 1) {
    const vertex = vertices[index];
    if (vertex === undefined) {
      continue;
    }
    const fraction = span > 0 ? (vertex.retentionTime - domain.low) / span : 0;
    const bucket = Math.min(columns - 1, Math.max(0, Math.floor(fraction * columns)));
    if (bucket !== column) {
      flush();
      column = bucket;
      first = index;
      lowest = index;
      highest = index;
    }
    last = index;
    if (vertex.value < (vertices[lowest]?.value ?? vertex.value)) {
      lowest = index;
    }
    if (vertex.value > (vertices[highest]?.value ?? vertex.value)) {
      highest = index;
    }
  }
  flush();

  return [...kept]
    .sort((left, right) => left - right)
    .map((index) => vertices[index] as VisibleVertex);
}

/**
 * What a virtualized table needs to know to bring a row into view.
 *
 * Modelled on MSCanvas's own layout and on nothing else. The header is
 * `position: sticky`, so it stays in normal flow and occupies its own
 * `headerHeight` at the top of the track; the row canvas begins after it. A row
 * at canvas offset `rowTop` therefore renders at
 *
 *     viewport y = headerHeight + rowTop - scrollTop
 *
 * and is clear of the header exactly when `rowTop >= scrollTop`.
 */
export interface TableLayout {
  readonly rowHeight: number;
  readonly headerHeight: number;
  readonly viewportHeight: number;
}

/**
 * The scroll position that brings one row into view, moving the least it can.
 *
 * The top edge compares the canvas-relative `rowTop` with `scrollTop`
 * **directly**. Subtracting the header here would subtract it twice -- the
 * canvas already begins after it -- and scroll a row that was entirely visible.
 * PR #72 did exactly that, on a misreading of a WebDriver failure: the click
 * that had been intercepted by the column header was positioned by the driver's
 * own `scrollIntoView`, which puts a target at the container's top edge and so
 * underneath a sticky header. That is the driver's geometry. This function does
 * not model it.
 */
export function revealScrollTop(
  layout: TableLayout,
  rowPosition: number,
  scrollTop: number,
): number {
  const rowTop = rowPosition * layout.rowHeight;
  // What the rows have, which is what the header leaves them.
  const visibleHeight = Math.max(
    layout.rowHeight,
    layout.viewportHeight - layout.headerHeight,
  );
  if (rowTop < scrollTop) {
    return rowTop;
  }
  if (rowTop + layout.rowHeight > scrollTop + visibleHeight) {
    return rowTop + layout.rowHeight - visibleHeight;
  }
  return scrollTop;
}
