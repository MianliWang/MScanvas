import { describe, expect, it } from "vitest";

import type { SpectrumRow, SpectrumTable } from "./contracts";
import {
  MAX_TRACE_COLUMNS,
  adjacentSpectrumIndex,
  buildChromatogramModel,
  clampDomain,
  isFullDomain,
  minimumSpan,
  nearestPoint,
  panDomain,
  reduceTrace,
  revealDomain,
  traceValue,
  valueExtent,
  visibleSlice,
  zoomDomain,
} from "./chromatogramModel";
import type { ChromatogramPoint, RetentionTimeDomain } from "./chromatogramModel";

/**
 * One scan-table row, with the two series deliberately far apart.
 *
 * A fixture whose total ion current and base peak intensity were close, or
 * derived from one another, would let a trace read the wrong field and still
 * look right. Here TIC is thousands and BPC is tens, so any confusion between
 * them is a failure rather than a rounding difference.
 */
function row(overrides: Partial<SpectrumRow> & { readonly index: number }): SpectrumRow {
  return {
    identifier: `controllerType=0 controllerNumber=1 scan=${String(overrides.index + 1)}`,
    scanNumber: overrides.index + 1,
    msLevel: 1,
    retentionTime: { value: overrides.index, unitKnown: false },
    basePeakMz: 400,
    basePeakIntensity: 10 + overrides.index,
    totalIonCurrent: 5_000 + overrides.index,
    precursorMz: null,
    ...overrides,
  };
}

function table(rows: readonly SpectrumRow[], truncated = false): SpectrumTable {
  return { rows, totalRowCount: truncated ? rows.length * 10 : rows.length, truncated };
}

function readyModel(rows: readonly SpectrumRow[]) {
  const model = buildChromatogramModel(table(rows));
  if (model.status !== "ready") {
    throw new Error(`expected a chromatogram, got ${model.reason}`);
  }
  return model;
}

/** A point built directly, for the pure helpers that take points rather than rows. */
function point(overrides: Partial<ChromatogramPoint> & { readonly retentionTime: number }): ChromatogramPoint {
  return {
    spectrumIndex: 0,
    tablePosition: 0,
    scanNumber: null,
    msLevel: 1,
    totalIonCurrent: 0,
    basePeakIntensity: 0,
    ...overrides,
  };
}

describe("what each trace is made of", () => {
  it("draws TIC from the row's own total ion current", () => {
    // The whole point of this milestone's data posture: the trace is the table.
    // Not a stored chromatogram, not the standalone msaccess `tic` query, and
    // not a sum recomputed from spectrum arrays.
    const model = readyModel([
      row({ index: 0, totalIonCurrent: 5_000, basePeakIntensity: 11 }),
      row({ index: 1, totalIonCurrent: 7_250.5, basePeakIntensity: 12 }),
    ]);

    expect(model.points.map((each) => traceValue(each, "tic"))).toEqual([5_000, 7_250.5]);
  });

  it("draws BPC from the row's own base peak intensity", () => {
    const model = readyModel([
      row({ index: 0, totalIonCurrent: 5_000, basePeakIntensity: 11 }),
      row({ index: 1, totalIonCurrent: 7_250.5, basePeakIntensity: 12.25 }),
    ]);

    expect(model.points.map((each) => traceValue(each, "bpc"))).toEqual([11, 12.25]);
  });

  it("never reads the base peak m/z as an intensity", () => {
    // A base peak has both an m/z and an intensity, and one of them is a
    // position rather than a height. Drawing the m/z would produce a plausible
    // trace of the wrong quantity.
    const model = readyModel([row({ index: 0, basePeakMz: 999.75, basePeakIntensity: 11 })]);

    expect(traceValue(model.points[0] as ChromatogramPoint, "bpc")).toBe(11);
  });

  it("keeps the spectrum index each point came from", () => {
    // What a click commits. Without it a selection would have to be guessed
    // from a position in the sorted projection, which is not the table's order.
    const model = readyModel([row({ index: 40 }), row({ index: 41 })]);

    expect(model.points.map((each) => each.spectrumIndex)).toEqual([40, 41]);
  });
});

describe("completeness", () => {
  it("refuses a chromatogram when the table is a prefix of the run", () => {
    // A truncated table is the first N scans. Drawing them and calling the
    // result a TIC is a picture of a shorter experiment than the one that ran.
    const model = buildChromatogramModel(table([row({ index: 0 }), row({ index: 1 })], true));

    expect(model).toEqual({ status: "unavailable", reason: "truncated" });
  });

  it("refuses a run with no spectra rather than drawing an empty axis", () => {
    expect(buildChromatogramModel(table([]))).toEqual({
      status: "unavailable",
      reason: "no-spectra",
    });
  });

  it("refuses a retention time that cannot be placed on an axis", () => {
    const model = buildChromatogramModel(
      table([row({ index: 0 }), row({ index: 1, retentionTime: { value: NaN, unitKnown: false } })]),
    );

    expect(model).toEqual({ status: "unavailable", reason: "unusable-retention-time" });
  });

  it("refuses an intensity that cannot be drawn", () => {
    expect(
      buildChromatogramModel(table([row({ index: 0, totalIonCurrent: Number.POSITIVE_INFINITY })])),
    ).toEqual({ status: "unavailable", reason: "unusable-intensity" });
    expect(buildChromatogramModel(table([row({ index: 0, basePeakIntensity: NaN })]))).toEqual({
      status: "unavailable",
      reason: "unusable-intensity",
    });
  });
});

describe("order", () => {
  it("draws by retention time while the scan table keeps its own order", () => {
    const rows = [
      row({ index: 0, retentionTime: { value: 9, unitKnown: false } }),
      row({ index: 1, retentionTime: { value: 3, unitKnown: false } }),
      row({ index: 2, retentionTime: { value: 6, unitKnown: false } }),
    ];
    const source = table(rows);
    const model = readyModel(rows);

    expect(model.points.map((each) => each.retentionTime)).toEqual([3, 6, 9]);
    expect(model.points.map((each) => each.spectrumIndex)).toEqual([1, 2, 0]);
    // The table itself is untouched: a projection was sorted, not the source.
    expect(source.rows.map((each) => each.index)).toEqual([0, 1, 2]);
  });

  it("keeps table order among scans that share a retention time", () => {
    const model = readyModel([
      row({ index: 7, retentionTime: { value: 2, unitKnown: false } }),
      row({ index: 8, retentionTime: { value: 1, unitKnown: false } }),
      row({ index: 9, retentionTime: { value: 2, unitKnown: false } }),
    ]);

    expect(model.points.map((each) => each.spectrumIndex)).toEqual([8, 7, 9]);
    expect(model.points.map((each) => each.tablePosition)).toEqual([1, 0, 2]);
  });

  it("reports the full retention-time domain the run covers", () => {
    const model = readyModel([
      row({ index: 0, retentionTime: { value: 4.5, unitKnown: false } }),
      row({ index: 1, retentionTime: { value: 0.25, unitKnown: false } }),
    ]);

    expect(model.fullDomain).toEqual({ low: 0.25, high: 4.5 });
  });
});

describe("the retention-time unit", () => {
  it("draws the run the current boundary actually produces", () => {
    // Every row unreported, which is the only state Rust can emit: `UnitState`
    // has one variant. A ready model therefore *means* the unit is unreported,
    // and both the axis and the readout say so from that one fact.
    const model = readyModel([
      row({ index: 0, retentionTime: { value: 0, unitKnown: false } }),
      row({ index: 1, retentionTime: { value: 1, unitKnown: false } }),
    ]);

    expect(model.points).toHaveLength(2);
  });

  it("refuses a row that claims a unit, because nothing carries which one", () => {
    // `unitKnown: true` names no unit. Labelling the axis with it is
    // impossible, and labelling it "unit not reported" would contradict the
    // row. There is no honest third option, so there is no chromatogram.
    expect(
      buildChromatogramModel(
        table([
          row({ index: 0, retentionTime: { value: 0, unitKnown: false } }),
          row({ index: 1, retentionTime: { value: 1, unitKnown: true } }),
        ]),
      ),
    ).toEqual({ status: "unavailable", reason: "unsupported-retention-time-unit" });
  });

  it("refuses it just as firmly when every row claims one", () => {
    // Deliberately not a special path. "They all agree" is a second, quieter
    // way of reaching a state this build cannot describe.
    expect(
      buildChromatogramModel(
        table([
          row({ index: 0, retentionTime: { value: 0, unitKnown: true } }),
          row({ index: 1, retentionTime: { value: 1, unitKnown: true } }),
        ]),
      ),
    ).toEqual({ status: "unavailable", reason: "unsupported-retention-time-unit" });
  });
});

describe("nearest scan", () => {
  const points = [
    point({ retentionTime: 0, tablePosition: 0, spectrumIndex: 0 }),
    point({ retentionTime: 10, tablePosition: 1, spectrumIndex: 1 }),
    point({ retentionTime: 20, tablePosition: 2, spectrumIndex: 2 }),
  ];

  it("returns the scan at an exact retention time", () => {
    expect(nearestPoint(points, 10)?.spectrumIndex).toBe(1);
  });

  it("returns the closer of two neighbours", () => {
    expect(nearestPoint(points, 12)?.spectrumIndex).toBe(1);
    expect(nearestPoint(points, 16)?.spectrumIndex).toBe(2);
  });

  it("breaks an exact halfway tie by table position", () => {
    // Deterministic rather than whichever the comparison reached first: a
    // click exactly between two scans must always answer the same scan.
    expect(nearestPoint(points, 15)?.spectrumIndex).toBe(1);
  });

  it("answers the first scan for a time before the run", () => {
    expect(nearestPoint(points, -100)?.spectrumIndex).toBe(0);
  });

  it("answers the last scan for a time after the run", () => {
    expect(nearestPoint(points, 100)?.spectrumIndex).toBe(2);
  });

  it("compares the earliest row of each equally near group, not whichever member the search met", () => {
    // The lower group's *last* member is what a binary search lands beside, and
    // the upper group's *first*. Comparing those two decides the tie on rows
    // that are not the ones the rule is about: here the lower group holds
    // position 1 and the upper holds 50, so the lower group must win -- but its
    // last member is position 100, which would lose.
    const groups = [
      point({ retentionTime: 10, tablePosition: 1, spectrumIndex: 11 }),
      point({ retentionTime: 10, tablePosition: 100, spectrumIndex: 12 }),
      point({ retentionTime: 20, tablePosition: 50, spectrumIndex: 13 }),
    ];

    const answer = nearestPoint(groups, 15);
    expect(answer?.retentionTime).toBe(10);
    expect(answer?.tablePosition).toBe(1);
  });

  it("lets the upper group win when its earliest row is the earlier one", () => {
    // The same rule, the other way round. Not "prefer the lower retention
    // time": the retention times are equally near, and the table position
    // decides.
    const groups = [
      point({ retentionTime: 10, tablePosition: 80, spectrumIndex: 21 }),
      point({ retentionTime: 20, tablePosition: 2, spectrumIndex: 22 }),
    ];

    const answer = nearestPoint(groups, 15);
    expect(answer?.retentionTime).toBe(20);
    expect(answer?.tablePosition).toBe(2);
  });

  it("answers the earlier table row when scans share a retention time", () => {
    const shared = [
      point({ retentionTime: 5, tablePosition: 3, spectrumIndex: 30 }),
      point({ retentionTime: 5, tablePosition: 4, spectrumIndex: 31 }),
    ];

    expect(nearestPoint(shared, 5)?.spectrumIndex).toBe(30);
    expect(nearestPoint(shared, 5.1)?.spectrumIndex).toBe(30);
  });

  it("has no answer for an empty model or an unusable coordinate", () => {
    expect(nearestPoint([], 1)).toBeNull();
    expect(nearestPoint(points, NaN)).toBeNull();
  });

  it("finds the same scan a linear scan would, across the whole run", () => {
    // The lookup is a binary search, which is what keeps a pointer move off a
    // 36,319-element loop. This pins it against the obvious implementation.
    const many = Array.from({ length: 2_000 }, (_, index) =>
      point({ retentionTime: index * 0.37, tablePosition: index, spectrumIndex: index }),
    );
    for (const probe of [-1, 0, 0.18, 0.185, 123.4, 369.5, 739.63, 10_000]) {
      let expected = many[0] as ChromatogramPoint;
      for (const candidate of many) {
        const closer =
          Math.abs(candidate.retentionTime - probe) < Math.abs(expected.retentionTime - probe);
        if (closer) {
          expected = candidate;
        }
      }
      expect(nearestPoint(many, probe)?.spectrumIndex).toBe(expected.spectrumIndex);
    }
  });
});

describe("screen reduction", () => {
  const full: RetentionTimeDomain = { low: 0, high: 999 };
  const many = Array.from({ length: 10_000 }, (_, index) =>
    point({
      retentionTime: index * 0.0999,
      tablePosition: index,
      spectrumIndex: index,
      totalIonCurrent: 1_000 + (index % 17),
      basePeakIntensity: 10,
    }),
  );

  it("draws far fewer vertices than the run has scans", () => {
    const reduced = reduceTrace(many, "tic", full, MAX_TRACE_COLUMNS);

    expect(reduced.length).toBeLessThan(many.length);
    expect(reduced.length).toBeLessThanOrEqual(MAX_TRACE_COLUMNS * 4 + 2);
  });

  it("draws only scans the run really has", () => {
    // Nothing averaged, interpolated or bucketed into a new value: every vertex
    // is a row, which is what lets a vertex name a scan.
    const sources = new Set(many);
    for (const vertex of reduceTrace(many, "tic", full, 40)) {
      expect(sources.has(vertex)).toBe(true);
    }
  });

  it("keeps the vertices in retention-time order", () => {
    const reduced = reduceTrace(many, "tic", full, 40);
    for (let index = 1; index < reduced.length; index += 1) {
      expect((reduced[index] as ChromatogramPoint).retentionTime).toBeGreaterThanOrEqual(
        (reduced[index - 1] as ChromatogramPoint).retentionTime,
      );
    }
  });

  // Deliberately not a multiple of the column width. At 10,000 points over 40
  // columns each column starts on a multiple of 250, and an extreme sitting on
  // one is kept as that column's *first* point whether or not the extremes are
  // kept at all -- which would make these two tests pass for the wrong reason.
  const INSIDE_A_COLUMN = 5_123;

  it("keeps a tall local peak that a column would otherwise hide", () => {
    const withPeak = many.map((each, index) =>
      index === INSIDE_A_COLUMN ? { ...each, totalIonCurrent: 9_999_999 } : each,
    );
    const reduced = reduceTrace(withPeak, "tic", full, 40);

    expect(reduced.some((vertex) => vertex.totalIonCurrent === 9_999_999)).toBe(true);
  });

  it("keeps a deep local trough, which an envelope would fill in", () => {
    // The reason a joined trace cannot use the stick spectrum's rule. Keeping
    // only each column's greatest value turns a line into an upper envelope and
    // silently removes every valley between two peaks.
    const withTrough = many.map((each, index) =>
      index === INSIDE_A_COLUMN ? { ...each, totalIonCurrent: -42 } : each,
    );
    const reduced = reduceTrace(withTrough, "tic", full, 40);

    expect(reduced.some((vertex) => vertex.totalIonCurrent === -42)).toBe(true);
  });

  it("reduces the trace that is being drawn rather than the other one", () => {
    const shaped = many.map((each, index) =>
      index === INSIDE_A_COLUMN ? { ...each, basePeakIntensity: 8_888 } : each,
    );

    expect(reduceTrace(shaped, "bpc", full, 40).some((each) => each.basePeakIntensity === 8_888)).toBe(
      true,
    );
  });

  it("keeps the first and last scan of the visible stretch", () => {
    const reduced = reduceTrace(many, "tic", full, 40);

    expect((reduced[0] as ChromatogramPoint).spectrumIndex).toBe(0);
    expect((reduced[reduced.length - 1] as ChromatogramPoint).spectrumIndex).toBe(many.length - 1);
  });

  it("returns a short trace unchanged rather than pretending to reduce it", () => {
    const few = many.slice(0, 20);

    expect(reduceTrace(few, "tic", { low: 0, high: 2 }, MAX_TRACE_COLUMNS)).toEqual(few);
  });

  it("reaches one scan past each edge so a zoomed line meets the axis", () => {
    // Without the overhang a zoomed trace would begin at the first scan inside
    // the viewport, leaving a gap that reads as though the run started there.
    const window = { low: 10, high: 20 };
    const reduced = reduceTrace(many, "tic", window, MAX_TRACE_COLUMNS);

    expect((reduced[0] as ChromatogramPoint).retentionTime).toBeLessThan(window.low);
    expect(
      (reduced[reduced.length - 1] as ChromatogramPoint).retentionTime,
    ).toBeGreaterThan(window.high);
  });

  it("draws nothing when the model is empty", () => {
    expect(reduceTrace([], "tic", full)).toEqual([]);
  });

  it("draws a single scan", () => {
    const one = [point({ retentionTime: 4, spectrumIndex: 3, totalIonCurrent: 12 })];

    expect(reduceTrace(one, "tic", { low: 4, high: 4 })).toEqual(one);
  });
});

describe("the value range", () => {
  const window: RetentionTimeDomain = { low: 0, high: 10 };

  it("always includes zero", () => {
    // A trace floating between 4,000,000 and 4,000,010 on a fitted axis looks
    // like structure. Including zero keeps the shape a reader is judging real.
    const points = [
      point({ retentionTime: 0, totalIonCurrent: 4_000_000 }),
      point({ retentionTime: 10, totalIonCurrent: 4_000_010 }),
    ];

    expect(valueExtent(points, ["tic"], window)).toEqual({ low: 0, high: 4_000_010 });
  });

  it("keeps negative values below zero rather than clipping them", () => {
    const points = [
      point({ retentionTime: 0, totalIonCurrent: -500 }),
      point({ retentionTime: 10, totalIonCurrent: 250 }),
    ];

    expect(valueExtent(points, ["tic"], window)).toEqual({ low: -500, high: 250 });
  });

  it("collapses to zero when every visible value is zero", () => {
    const points = [
      point({ retentionTime: 0, totalIonCurrent: 0 }),
      point({ retentionTime: 10, totalIonCurrent: 0 }),
    ];

    expect(valueExtent(points, ["tic"], window)).toEqual({ low: 0, high: 0 });
  });

  it("covers every visible trace at once", () => {
    const points = [point({ retentionTime: 5, totalIonCurrent: 900, basePeakIntensity: 20 })];

    expect(valueExtent(points, ["tic", "bpc"], window)).toEqual({ low: 0, high: 900 });
    expect(valueExtent(points, ["bpc"], window)).toEqual({ low: 0, high: 20 });
  });

  it("is zero-width when no trace is shown", () => {
    const points = [point({ retentionTime: 5, totalIonCurrent: 900 })];

    expect(valueExtent(points, [], window)).toEqual({ low: 0, high: 0 });
  });

  it("survives an extreme finite dynamic range", () => {
    const points = [
      point({ retentionTime: 0, totalIonCurrent: 1e-9 }),
      point({ retentionTime: 10, totalIonCurrent: 1e18 }),
    ];
    const extent = valueExtent(points, ["tic"], window);

    expect(Number.isFinite(extent.low)).toBe(true);
    expect(Number.isFinite(extent.high)).toBe(true);
    expect(extent.high).toBe(1e18);
  });
});

describe("the visible domain", () => {
  const full: RetentionTimeDomain = { low: 0, high: 100 };

  it("treats a missing visible domain as the whole run", () => {
    expect(isFullDomain(null, full)).toBe(true);
    expect(isFullDomain({ low: 0, high: 100 }, full)).toBe(true);
    expect(isFullDomain({ low: 10, high: 20 }, full)).toBe(false);
  });

  it("zooms about the pointer, keeping the held time in place", () => {
    const zoomed = zoomDomain({ low: 0, high: 100 }, full, 0.5, 0.25);

    expect(zoomed.high - zoomed.low).toBeCloseTo(50, 10);
    // A quarter of the way across stays a quarter of the way across.
    expect(zoomed.low + (zoomed.high - zoomed.low) * 0.25).toBeCloseTo(25, 10);
  });

  it("never zooms out past the whole run", () => {
    expect(zoomDomain({ low: 40, high: 60 }, full, 100, 0.5)).toEqual(full);
  });

  it("never zooms in past the minimum span", () => {
    const tiny = zoomDomain({ low: 40, high: 60 }, full, 1e-9, 0.5);

    expect(tiny.high - tiny.low).toBeCloseTo(minimumSpan(full), 12);
    expect(minimumSpan(full)).toBeGreaterThan(0);
  });

  it("pans without changing the span", () => {
    const panned = panDomain({ low: 20, high: 40 }, full, 0.5);

    expect(panned).toEqual({ low: 30, high: 50 });
  });

  it("stops panning at each edge rather than shrinking the span", () => {
    expect(panDomain({ low: 0, high: 20 }, full, -5)).toEqual({ low: 0, high: 20 });
    expect(panDomain({ low: 80, high: 100 }, full, 5)).toEqual({ low: 80, high: 100 });
  });

  it("clamps an out-of-range or inverted request back inside the run", () => {
    expect(clampDomain({ low: -50, high: -10 }, full)).toEqual({ low: 0, high: 40 });
    expect(clampDomain({ low: 200, high: 260 }, full)).toEqual({ low: 40, high: 100 });
    const inverted = clampDomain({ low: 60, high: 20 }, full);
    expect(inverted.low).toBeLessThanOrEqual(inverted.high);
  });

  it("is inert on a run whose scans all share one retention time", () => {
    // A zero-width run has no subrange, so zoom is defined as doing nothing
    // rather than producing a viewport a value cannot be placed in.
    const flat: RetentionTimeDomain = { low: 7, high: 7 };

    expect(minimumSpan(flat)).toBe(0);
    expect(zoomDomain(flat, flat, 0.5, 0.5)).toEqual(flat);
    expect(panDomain(flat, flat, 1)).toEqual(flat);
  });

  it("never produces a domain that is not a finite forward interval", () => {
    for (const request of [
      { low: NaN, high: 10 },
      { low: 10, high: NaN },
      { low: Number.NEGATIVE_INFINITY, high: Number.POSITIVE_INFINITY },
      { low: 5, high: 5 },
    ]) {
      const clamped = clampDomain(request, full);
      expect(Number.isFinite(clamped.low)).toBe(true);
      expect(Number.isFinite(clamped.high)).toBe(true);
      expect(clamped.high).toBeGreaterThan(clamped.low);
      expect(clamped.low).toBeGreaterThanOrEqual(full.low);
      expect(clamped.high).toBeLessThanOrEqual(full.high);
    }
  });
});

describe("revealing a selection", () => {
  const full: RetentionTimeDomain = { low: 0, high: 100 };

  it("leaves a viewport alone when the selection is already inside it", () => {
    const visible = { low: 20, high: 40 };

    expect(revealDomain(visible, full, 30)).toBe(visible);
  });

  it("pans the least it can, keeping the span the user chose", () => {
    // Not a reset. Selecting a scan is not a request to stop looking at the
    // stretch the user zoomed into.
    const visible = { low: 20, high: 40 };
    const revealed = revealDomain(visible, full, 55);

    expect(revealed.high - revealed.low).toBeCloseTo(20, 10);
    expect(55).toBeGreaterThanOrEqual(revealed.low);
    expect(55).toBeLessThanOrEqual(revealed.high);
    expect(revealed.low).toBeGreaterThan(visible.low);
  });

  it("reveals a selection before the viewport too", () => {
    const revealed = revealDomain({ low: 60, high: 80 }, full, 5);

    expect(revealed.high - revealed.low).toBeCloseTo(20, 10);
    expect(5).toBeGreaterThanOrEqual(revealed.low);
    expect(5).toBeLessThanOrEqual(revealed.high);
  });

  it("stays inside the run at the edges", () => {
    expect(revealDomain({ low: 60, high: 80 }, full, 0)).toEqual({ low: 0, high: 20 });
    expect(revealDomain({ low: 0, high: 20 }, full, 100)).toEqual({ low: 80, high: 100 });
  });
});

describe("the visible slice", () => {
  const points = Array.from({ length: 10 }, (_, index) =>
    point({ retentionTime: index, tablePosition: index, spectrumIndex: index }),
  );

  it("covers the domain with one scan of overhang each side", () => {
    expect(visibleSlice(points, { low: 3, high: 6 })).toEqual({ start: 2, end: 8 });
  });

  it("stops at the ends of the run", () => {
    expect(visibleSlice(points, { low: -5, high: 200 })).toEqual({ start: 0, end: 10 });
  });
});

describe("previous and next scan", () => {
  const rows = [row({ index: 4 }), row({ index: 9 }), row({ index: 11 })];

  it("walks the table's order rather than the index's arithmetic", () => {
    // 9 + 1 is not a row here. Table order is what the user sees and what
    // Previous/Next has to agree with.
    expect(adjacentSpectrumIndex(rows, 9, 1)).toBe(11);
    expect(adjacentSpectrumIndex(rows, 9, -1)).toBe(4);
  });

  it("has no answer at either end", () => {
    expect(adjacentSpectrumIndex(rows, 4, -1)).toBeNull();
    expect(adjacentSpectrumIndex(rows, 11, 1)).toBeNull();
  });

  it("has no answer without a selection", () => {
    expect(adjacentSpectrumIndex(rows, null, 1)).toBeNull();
  });

  it("refuses to guess a neighbour for a row the table does not have", () => {
    expect(adjacentSpectrumIndex(rows, 7, 1)).toBeNull();
    expect(adjacentSpectrumIndex(rows, 7, -1)).toBeNull();
  });
});

describe("the representative scale", () => {
  // The repository measured its representative acquisition at 36,319 spectra.
  // The model is built once per preview and the lookups run per pointer move,
  // so both are exercised at that size rather than at fixture size.
  const REPRESENTATIVE_SCANS = 36_319;
  const rows = Array.from({ length: REPRESENTATIVE_SCANS }, (_, index) =>
    row({
      index,
      retentionTime: { value: index * 0.0125, unitKnown: false },
      totalIonCurrent: 5_000 + ((index * 7) % 4_000),
      basePeakIntensity: 10 + ((index * 3) % 900),
    }),
  );

  it("builds one point per scan, in retention-time order", () => {
    const model = readyModel(rows);

    expect(model.points).toHaveLength(REPRESENTATIVE_SCANS);
    expect(model.fullDomain.low).toBe(0);
    expect(model.fullDomain.high).toBeCloseTo((REPRESENTATIVE_SCANS - 1) * 0.0125, 6);
  });

  it("reduces the whole run to a bounded number of vertices", () => {
    const model = readyModel(rows);
    const reduced = reduceTrace(model.points, "tic", model.fullDomain);

    expect(reduced.length).toBeLessThanOrEqual(MAX_TRACE_COLUMNS * 4 + 2);
    expect(reduced.length).toBeLessThan(REPRESENTATIVE_SCANS / 4);
  });

  it("answers a nearest-scan lookup without walking the run", () => {
    const model = readyModel(rows);
    const probes = 5_000;
    const started = performance.now();
    for (let probe = 0; probe < probes; probe += 1) {
      nearestPoint(model.points, (probe / probes) * model.fullDomain.high);
    }
    const elapsed = performance.now() - started;

    // Not a threshold on this machine's speed: a linear scan would be
    // 36,319 x 5,000 comparisons, which is orders of magnitude away from this
    // bound rather than a percentage away from it.
    expect(elapsed).toBeLessThan(2_000);
  });
});
