import { describe, expect, it } from "vitest";

import {
  adjacentScan,
  buildScanModel,
  nearestScan,
  traceValue,
} from "./scanModel";
import type { ScanPoint, ScanSource } from "./scanModel";

/**
 * One source row, with the two series deliberately far apart.
 *
 * A fixture whose total ion current and base peak intensity were close, or
 * derived from one another, would let a trace read the wrong field and still
 * look right.
 */
function row(overrides: Partial<ScanSource> & { readonly index: number }): ScanSource {
  return {
    tablePosition: overrides.index,
    scanNumber: overrides.index + 1,
    msLevel: 1,
    retentionTime: overrides.index,
    retentionTimeUnitKnown: false,
    totalIonCurrent: 5_000 + overrides.index,
    basePeakIntensity: 10 + overrides.index,
    ...overrides,
  };
}

function ready(rows: readonly ScanSource[], truncated = false) {
  const model = buildScanModel({ rows, truncated });
  if (model.status !== "ready") {
    throw new Error(`expected a model, got ${model.reason}`);
  }
  return model;
}

function point(overrides: Partial<ScanPoint> & { readonly retentionTime: number }): ScanPoint {
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
  it("reads TIC and BPC from the row's own fields", () => {
    const model = ready([
      row({ index: 0, totalIonCurrent: 5_000, basePeakIntensity: 11 }),
      row({ index: 1, totalIonCurrent: 7_250.5, basePeakIntensity: 12.25 }),
    ]);

    expect(model.points.map((each) => traceValue(each, "tic"))).toEqual([5_000, 7_250.5]);
    expect(model.points.map((each) => traceValue(each, "bpc"))).toEqual([11, 12.25]);
  });

  it("keeps the spectrum index a selection commits", () => {
    expect(
      ready([row({ index: 40 }), row({ index: 41 })]).points.map((each) => each.spectrumIndex),
    ).toEqual([40, 41]);
  });
});

describe("what refuses to become a model", () => {
  it("refuses a table that is a prefix of the run", () => {
    expect(buildScanModel({ rows: [row({ index: 0 })], truncated: true })).toEqual({
      status: "unavailable",
      reason: "truncated",
    });
  });

  it("refuses a run with no spectra", () => {
    expect(buildScanModel({ rows: [], truncated: false })).toEqual({
      status: "unavailable",
      reason: "no-spectra",
    });
  });

  it("refuses coordinates that cannot be placed or drawn", () => {
    expect(
      buildScanModel({ rows: [row({ index: 0, retentionTime: NaN })], truncated: false }),
    ).toEqual({ status: "unavailable", reason: "unusable-retention-time" });
    expect(
      buildScanModel({
        rows: [row({ index: 0, totalIonCurrent: Number.POSITIVE_INFINITY })],
        truncated: false,
      }),
    ).toEqual({ status: "unavailable", reason: "unusable-intensity" });
    expect(
      buildScanModel({ rows: [row({ index: 0, basePeakIntensity: NaN })], truncated: false }),
    ).toEqual({ status: "unavailable", reason: "unusable-intensity" });
  });

  it("refuses a retention-time unit it cannot name, however many rows claim one", () => {
    // Carried forward from PR #72. `unitKnown: true` names no unit, so an axis
    // could neither be labelled with it nor honestly say none was reported.
    // "Every row agreed" is deliberately not a special path.
    for (const rows of [
      [row({ index: 0 }), row({ index: 1, retentionTimeUnitKnown: true })],
      [
        row({ index: 0, retentionTimeUnitKnown: true }),
        row({ index: 1, retentionTimeUnitKnown: true }),
      ],
    ]) {
      expect(buildScanModel({ rows, truncated: false })).toEqual({
        status: "unavailable",
        reason: "unsupported-retention-time-unit",
      });
    }
  });

  it("builds the run the current boundary actually produces", () => {
    expect(ready([row({ index: 0 }), row({ index: 1 })]).points).toHaveLength(2);
  });
});

describe("order", () => {
  it("sorts a projection by retention time and leaves the source alone", () => {
    const rows = [
      row({ index: 0, retentionTime: 9 }),
      row({ index: 1, retentionTime: 3 }),
      row({ index: 2, retentionTime: 6 }),
    ];
    const model = ready(rows);

    expect(model.points.map((each) => each.retentionTime)).toEqual([3, 6, 9]);
    expect(rows.map((each) => each.index)).toEqual([0, 1, 2]);
  });

  it("keeps table order among scans sharing a retention time", () => {
    const model = ready([
      row({ index: 7, tablePosition: 0, retentionTime: 2 }),
      row({ index: 8, tablePosition: 1, retentionTime: 1 }),
      row({ index: 9, tablePosition: 2, retentionTime: 2 }),
    ]);

    expect(model.points.map((each) => each.spectrumIndex)).toEqual([8, 7, 9]);
  });

  it("reports the full retention-time domain", () => {
    expect(
      ready([row({ index: 0, retentionTime: 4.5 }), row({ index: 1, retentionTime: 0.25 })])
        .fullDomain,
    ).toEqual({ low: 0.25, high: 4.5 });
  });
});

describe("nearest scan", () => {
  const points = [
    point({ retentionTime: 0, tablePosition: 0, spectrumIndex: 0 }),
    point({ retentionTime: 10, tablePosition: 1, spectrumIndex: 1 }),
    point({ retentionTime: 20, tablePosition: 2, spectrumIndex: 2 }),
  ];

  it("answers an exact hit, the closer neighbour, and each edge", () => {
    expect(nearestScan(points, 10)?.spectrumIndex).toBe(1);
    expect(nearestScan(points, 12)?.spectrumIndex).toBe(1);
    expect(nearestScan(points, 16)?.spectrumIndex).toBe(2);
    expect(nearestScan(points, -100)?.spectrumIndex).toBe(0);
    expect(nearestScan(points, 100)?.spectrumIndex).toBe(2);
  });

  it("breaks an exact halfway tie by table position", () => {
    expect(nearestScan(points, 15)?.spectrumIndex).toBe(1);
  });

  it("compares the earliest row of each equally near group", () => {
    // A binary search lands beside the *last* member of the lower group and the
    // *first* of the upper one; comparing those two is comparing the wrong
    // pair. Here the lower group holds position 1 and must win, though its last
    // member is position 100.
    const groups = [
      point({ retentionTime: 10, tablePosition: 1, spectrumIndex: 11 }),
      point({ retentionTime: 10, tablePosition: 100, spectrumIndex: 12 }),
      point({ retentionTime: 20, tablePosition: 50, spectrumIndex: 13 }),
    ];

    expect(nearestScan(groups, 15)?.tablePosition).toBe(1);
  });

  it("lets the upper group win when its earliest row is the earlier one", () => {
    // Not "prefer the lower retention time": the times are equally near and the
    // table position decides.
    const groups = [
      point({ retentionTime: 10, tablePosition: 80, spectrumIndex: 21 }),
      point({ retentionTime: 20, tablePosition: 2, spectrumIndex: 22 }),
    ];

    expect(nearestScan(groups, 15)?.tablePosition).toBe(2);
  });

  it("answers the earliest row of a duplicated retention time from either side", () => {
    const shared = [
      point({ retentionTime: 5, tablePosition: 3, spectrumIndex: 30 }),
      point({ retentionTime: 5, tablePosition: 4, spectrumIndex: 31 }),
    ];

    expect(nearestScan(shared, 4.9)?.spectrumIndex).toBe(30);
    expect(nearestScan(shared, 5)?.spectrumIndex).toBe(30);
    expect(nearestScan(shared, 5.1)?.spectrumIndex).toBe(30);
  });

  it("has no answer for an empty model or an unusable coordinate", () => {
    expect(nearestScan([], 1)).toBeNull();
    expect(nearestScan(points, NaN)).toBeNull();
  });

  it("agrees with a linear scan across a large run", () => {
    // The lookup is a binary search, which is what keeps a pointer move off a
    // 36,319-element loop. This pins it against the obvious implementation.
    const many = Array.from({ length: 2_000 }, (_, index) =>
      point({ retentionTime: index * 0.37, tablePosition: index, spectrumIndex: index }),
    );

    for (const probe of [-1, 0, 0.18, 0.185, 123.4, 369.5, 739.63, 10_000]) {
      let expected = many[0] as ScanPoint;
      for (const candidate of many) {
        if (
          Math.abs(candidate.retentionTime - probe) < Math.abs(expected.retentionTime - probe)
        ) {
          expected = candidate;
        }
      }
      expect(nearestScan(many, probe)?.spectrumIndex).toBe(expected.spectrumIndex);
    }
  });
});

describe("previous and next scan", () => {
  const rows = [{ index: 4 }, { index: 9 }, { index: 11 }];

  it("walks the table's order rather than the index's arithmetic", () => {
    expect(adjacentScan(rows, 9, 1)).toBe(11);
    expect(adjacentScan(rows, 9, -1)).toBe(4);
  });

  it("has no answer at either end, without a selection, or off the table", () => {
    expect(adjacentScan(rows, 4, -1)).toBeNull();
    expect(adjacentScan(rows, 11, 1)).toBeNull();
    expect(adjacentScan(rows, null, 1)).toBeNull();
    expect(adjacentScan(rows, 7, 1)).toBeNull();
  });
});

describe("the representative scale", () => {
  // ADR 0003 measured the representative acquisition at 36,319 spectra.
  const REPRESENTATIVE_SCANS = 36_319;
  const rows = Array.from({ length: REPRESENTATIVE_SCANS }, (_, index) =>
    row({
      index,
      retentionTime: index * 0.0125,
      totalIonCurrent: 5_000 + ((index * 7) % 4_000),
      basePeakIntensity: 10 + ((index * 3) % 900),
    }),
  );

  it("builds one point per scan in retention-time order", () => {
    const model = ready(rows);

    expect(model.points).toHaveLength(REPRESENTATIVE_SCANS);
    expect(model.fullDomain.low).toBe(0);
  });

  it("answers a nearest-scan lookup without walking the run", () => {
    const model = ready(rows);
    const probes = 5_000;
    const started = performance.now();
    for (let probe = 0; probe < probes; probe += 1) {
      nearestScan(model.points, (probe / probes) * model.fullDomain.high);
    }

    // Not a threshold on this machine's speed: a linear scan would be
    // 36,319 x 5,000 comparisons, orders of magnitude away from this bound
    // rather than a percentage away from it.
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
