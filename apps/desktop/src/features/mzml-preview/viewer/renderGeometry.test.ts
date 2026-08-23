import { describe, expect, it } from "vitest";

import type { RetentionTimeDomain, ScanPoint } from "./scanModel";
import {
  MAX_TRACE_COLUMNS,
  clipTrace,
  reduceVisible,
  revealScrollTop,
  visibleExtent,
} from "./renderGeometry";
import type { VisibleVertex } from "./renderGeometry";

/** One scan. TIC and BPC are set apart so a trace cannot read the wrong one. */
function scan(retentionTime: number, tic: number, bpc = tic / 10, index = 0): ScanPoint {
  return {
    spectrumIndex: index,
    tablePosition: index,
    scanNumber: index + 1,
    msLevel: 1,
    retentionTime,
    totalIonCurrent: tic,
    basePeakIntensity: bpc,
  };
}

function run(points: readonly [number, number][]): ScanPoint[] {
  return points.map(([rt, tic], index) => scan(rt, tic, tic / 10, index));
}

/** The value at one retention time in a clipped trace, for readability. */
function valueAt(vertices: readonly VisibleVertex[], retentionTime: number): number | undefined {
  return vertices.find((vertex) => vertex.retentionTime === retentionTime)?.value;
}

describe("clipping one trace to the viewport", () => {
  it("keeps both endpoints of a segment that is entirely inside", () => {
    const points = run([
      [10, 100],
      [11, 200],
    ]);

    const vertices = clipTrace(points, "tic", { low: 0, high: 20 });
    expect(vertices.map((vertex) => vertex.kind)).toEqual(["scan", "scan"]);
    expect(vertices.map((vertex) => vertex.value)).toEqual([100, 200]);
  });

  it("interpolates where a segment enters from the left", () => {
    const points = run([
      [0, 0],
      [10, 100],
    ]);

    const vertices = clipTrace(points, "tic", { low: 5, high: 20 });
    expect(vertices[0]?.kind).toBe("boundary");
    expect(vertices[0]?.retentionTime).toBe(5);
    // Half way along a segment from 0 to 100.
    expect(vertices[0]?.value).toBeCloseTo(50, 10);
    expect(vertices[1]?.kind).toBe("scan");
  });

  it("interpolates where a segment leaves to the right", () => {
    const points = run([
      [0, 0],
      [10, 100],
    ]);

    const vertices = clipTrace(points, "tic", { low: -5, high: 2.5 });
    expect(vertices[vertices.length - 1]?.kind).toBe("boundary");
    expect(vertices[vertices.length - 1]?.retentionTime).toBe(2.5);
    expect(vertices[vertices.length - 1]?.value).toBeCloseTo(25, 10);
  });

  it("draws a segment that crosses the viewport with both scans outside", () => {
    const points = run([
      [0, 0],
      [100, 1_000],
    ]);

    const vertices = clipTrace(points, "tic", { low: 40, high: 60 });
    expect(vertices).toHaveLength(2);
    expect(vertices.every((vertex) => vertex.kind === "boundary")).toBe(true);
    expect(vertices[0]?.value).toBeCloseTo(400, 10);
    expect(vertices[1]?.value).toBeCloseTo(600, 10);
  });

  it("draws nothing for a segment entirely outside", () => {
    const points = run([
      [0, 10],
      [1, 20],
    ]);

    expect(clipTrace(points, "tic", { low: 50, high: 60 })).toEqual([]);
  });

  it("keeps both scans of a vertical segment without interpolating", () => {
    // Two scans at one retention time. There is no interior to interpolate, and
    // dividing by the span would be a division by zero.
    const points = run([
      [10, 100],
      [10, 400],
      [11, 200],
    ]);

    const vertices = clipTrace(points, "tic", { low: 0, high: 20 });
    expect(vertices.map((vertex) => vertex.value)).toEqual([100, 400, 200]);
    expect(vertices.every((vertex) => vertex.kind === "scan")).toBe(true);
  });

  it("draws a single-scan run as a point, and only where it is visible", () => {
    const one = run([[10, 100]]);

    expect(clipTrace(one, "tic", { low: 0, high: 20 })).toHaveLength(1);
    expect(clipTrace(one, "tic", { low: 20, high: 30 })).toEqual([]);
  });

  it("draws a zero-width run", () => {
    // Every scan at one retention time: the domain is a single point, and the
    // scans are on it.
    const flat = run([
      [7, 10],
      [7, 20],
    ]);

    expect(clipTrace(flat, "tic", { low: 7, high: 7 })).toHaveLength(2);
  });

  it("draws nothing at all when there are no scans", () => {
    expect(clipTrace([], "tic", { low: 0, high: 1 })).toEqual([]);
  });

  it("draws the trace that was asked for", () => {
    const points = [scan(10, 5_000, 11), scan(11, 6_000, 12, 1)];

    expect(clipTrace(points, "tic", { low: 0, high: 20 }).map((each) => each.value)).toEqual([
      5_000, 6_000,
    ]);
    expect(clipTrace(points, "bpc", { low: 0, high: 20 }).map((each) => each.value)).toEqual([
      11, 12,
    ]);
  });

  it("never gives a boundary vertex a scan", () => {
    // The type says so; this pins it against a future edit that widens the
    // shape. A boundary is not a scan and can never be a selection.
    const vertices = clipTrace(run([[0, 0], [100, 1_000]]), "tic", { low: 40, high: 60 });

    for (const vertex of vertices) {
      if (vertex.kind === "boundary") {
        expect(Object.hasOwn(vertex, "scan")).toBe(false);
      }
    }
  });
});

describe("the visible value range", () => {
  const RUN = run([
    [9, 9_000_000],
    [10, 90],
    [11, 100],
    [12, 110],
    [13, 120],
  ]);

  it("is not set by a peak that is entirely outside the viewport", () => {
    // The finding this whole slice was re-scoped around. Zooming into the
    // valley after a tall peak is the most ordinary thing anyone does with a
    // chromatogram, and PR #72 let the peak at 9 -- clipped away, invisible --
    // set the axis to 9,000,000 and flatten everything on screen.
    const vertices = clipTrace(RUN, "tic", { low: 10, high: 13 });

    expect(visibleExtent([vertices])).toEqual({ low: 0, high: 120 });
    expect(vertices.some((vertex) => vertex.value === 9_000_000)).toBe(false);
  });

  it("is not set by a peak entirely outside on the right either", () => {
    const rightward = run([
      [10, 90],
      [11, 100],
      [12, 9_000_000],
    ]);
    const vertices = clipTrace(rightward, "tic", { low: 10, high: 11 });

    expect(visibleExtent([vertices]).high).toBe(100);
  });

  it("is set by the interpolated height where a visible segment crosses the edge", () => {
    // The other half, and the reason the extent cannot simply drop everything
    // outside: the line really is that high where it crosses the edge, and a
    // reader can see it.
    const vertices = clipTrace(RUN, "tic", { low: 9.5, high: 13 });
    const crossing = valueAt(vertices, 9.5) as number;

    // Half way from 9,000,000 down to 90.
    expect(crossing).toBeCloseTo((9_000_000 + 90) / 2, 6);
    expect(visibleExtent([vertices]).high).toBeCloseTo(crossing, 6);
  });

  it("keeps a visible interior maximum and minimum", () => {
    const shaped = run([
      [0, 10],
      [1, 900],
      [2, -400],
      [3, 20],
    ]);
    const vertices = clipTrace(shaped, "tic", { low: 0, high: 3 });

    expect(visibleExtent([vertices])).toEqual({ low: -400, high: 900 });
  });

  it("always includes zero", () => {
    const high = run([
      [0, 4_000_000],
      [1, 4_000_010],
    ]);

    expect(visibleExtent([clipTrace(high, "tic", { low: 0, high: 1 })])).toEqual({
      low: 0,
      high: 4_000_010,
    });
  });

  it("collapses to zero for an all-zero trace", () => {
    const flat = run([
      [0, 0],
      [1, 0],
    ]);

    expect(visibleExtent([clipTrace(flat, "tic", { low: 0, high: 1 })])).toEqual({
      low: 0,
      high: 0,
    });
  });

  it("covers every visible trace together, and each alone", () => {
    const points = [scan(0, 900, 20), scan(1, 800, 30, 1)];
    const tic = clipTrace(points, "tic", { low: 0, high: 1 });
    const bpc = clipTrace(points, "bpc", { low: 0, high: 1 });

    expect(visibleExtent([tic])).toEqual({ low: 0, high: 900 });
    expect(visibleExtent([bpc])).toEqual({ low: 0, high: 30 });
    expect(visibleExtent([tic, bpc])).toEqual({ low: 0, high: 900 });
  });

  it("is zero-width when nothing is drawn", () => {
    expect(visibleExtent([])).toEqual({ low: 0, high: 0 });
    expect(visibleExtent([[]])).toEqual({ low: 0, high: 0 });
  });

  it("survives an extreme finite dynamic range", () => {
    const wide = run([
      [0, 1e-9],
      [1, 1e18],
    ]);
    const extent = visibleExtent([clipTrace(wide, "tic", { low: 0, high: 1 })]);

    expect(Number.isFinite(extent.low)).toBe(true);
    expect(extent.high).toBe(1e18);
  });
});

describe("screen reduction", () => {
  const domain: RetentionTimeDomain = { low: 0, high: 999 };
  const many = run(
    Array.from({ length: 10_000 }, (_, index): [number, number] => [
      index * 0.0999,
      1_000 + (index % 17),
    ]),
  );

  it("draws far fewer vertices than the run has scans", () => {
    const reduced = reduceVisible(clipTrace(many, "tic", domain), domain);

    expect(reduced.length).toBeLessThan(many.length);
    expect(reduced.length).toBeLessThanOrEqual(MAX_TRACE_COLUMNS * 4 + 2);
  });

  it("keeps only vertices it was given", () => {
    const vertices = clipTrace(many, "tic", domain);
    const given = new Set(vertices);

    for (const vertex of reduceVisible(vertices, domain, 40)) {
      expect(given.has(vertex)).toBe(true);
    }
  });

  it("keeps them in retention-time order", () => {
    const reduced = reduceVisible(clipTrace(many, "tic", domain), domain, 40);

    for (let index = 1; index < reduced.length; index += 1) {
      expect((reduced[index] as VisibleVertex).retentionTime).toBeGreaterThanOrEqual(
        (reduced[index - 1] as VisibleVertex).retentionTime,
      );
    }
  });

  it("keeps a tall local peak and a deep local trough inside a column", () => {
    // 5,123 rather than a multiple of the column width: an extreme sitting on a
    // column boundary is kept as that column's *first* vertex whether or not
    // extremes are kept at all, which would make this pass for the wrong reason.
    const shaped = many.map((point, index) =>
      index === 5_123 ? { ...point, totalIonCurrent: 9_999_999 } : point,
    );
    const troughed = many.map((point, index) =>
      index === 5_123 ? { ...point, totalIonCurrent: -42 } : point,
    );

    expect(
      reduceVisible(clipTrace(shaped, "tic", domain), domain, 40).some(
        (vertex) => vertex.value === 9_999_999,
      ),
    ).toBe(true);
    expect(
      reduceVisible(clipTrace(troughed, "tic", domain), domain, 40).some(
        (vertex) => vertex.value === -42,
      ),
    ).toBe(true);
  });

  it("returns a short trace unchanged rather than pretending to reduce it", () => {
    const few = clipTrace(many.slice(0, 20), "tic", { low: 0, high: 2 });

    expect(reduceVisible(few, { low: 0, high: 2 })).toEqual(few);
  });

  it("cannot change what the axis says, because it runs after the extent", () => {
    // The ordering rule, asserted rather than left to a comment: the extent is
    // taken from the clipped polyline, and reducing that polyline afterwards
    // must not be able to move it.
    const vertices = clipTrace(many, "tic", domain);
    const before = visibleExtent([vertices]);
    const reduced = reduceVisible(vertices, domain, 40);

    expect(visibleExtent([reduced])).toEqual(before);
  });
});

describe("bringing a table row into view", () => {
  const LAYOUT = { rowHeight: 30, headerHeight: 30, viewportHeight: 330 };

  /** Where a row renders, which is what every expectation below is derived from. */
  function viewportY(rowPosition: number, scrollTop: number): number {
    return LAYOUT.headerHeight + rowPosition * LAYOUT.rowHeight - scrollTop;
  }

  it("leaves a row that already begins immediately below the sticky header", () => {
    // Row 10 sits at 300; with the scroll at 300 it renders at y = 30, touching
    // the header's bottom edge and entirely visible. Subtracting the header
    // again -- which PR #72 did -- would scroll to 270 and move a row nobody
    // needed moved.
    expect(revealScrollTop(LAYOUT, 10, 300)).toBe(300);
    expect(viewportY(10, 300)).toBe(LAYOUT.headerHeight);
  });

  it("reveals a row genuinely hidden beneath the header, and no further", () => {
    expect(viewportY(9, 300)).toBe(0);
    const scrolled = revealScrollTop(LAYOUT, 9, 300);

    expect(scrolled).toBe(270);
    expect(viewportY(9, scrolled)).toBe(LAYOUT.headerHeight);
  });

  it("reveals a row below the fold with the smallest scroll that shows all of it", () => {
    const scrolled = revealScrollTop(LAYOUT, 20, 0);

    // Its bottom edge lands on the viewport's, and not a pixel past it.
    expect(viewportY(20, scrolled) + LAYOUT.rowHeight).toBe(LAYOUT.viewportHeight);
    // And the row above it is still whole, so this was the smallest move.
    expect(viewportY(19, scrolled)).toBeGreaterThanOrEqual(LAYOUT.headerHeight);
  });

  it("moves nothing for a row already whole in the middle", () => {
    expect(revealScrollTop(LAYOUT, 14, 300)).toBe(300);
  });

  it("moves one row at a time walking upward", () => {
    // The user-visible shape of the same defect: arrowing up past the top of
    // the viewport brings one row into view at a time, not two.
    expect(revealScrollTop(LAYOUT, 9, 300)).toBe(270);
    expect(revealScrollTop(LAYOUT, 8, 270)).toBe(240);
  });

  it("floors the usable height at one row rather than dividing by nothing", () => {
    // A panel too short to hold a row at all still has to answer.
    const cramped = { rowHeight: 30, headerHeight: 30, viewportHeight: 40 };

    expect(revealScrollTop(cramped, 0, 300)).toBe(0);
    expect(revealScrollTop(cramped, 10, 0)).toBe(300);
  });
});
