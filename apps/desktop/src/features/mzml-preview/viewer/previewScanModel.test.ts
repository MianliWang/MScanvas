/**
 * The adapter, and only the adapter.
 *
 * `scanModel.test.ts` beside this already holds what a model is and when there
 * is not one. What is left to establish here is the mapping: that TIC is the
 * row's own total ion current and BPC is its own base peak intensity, that the
 * x axis is the row's retention time, that a row's place in the table survives
 * the sort onto the retention-time axis, and that each of the boundary's
 * refusals reaches the model unaltered.
 *
 * The last of those is what stops a "small" adapter quietly becoming a second
 * place where science is decided.
 */

import { describe, expect, it } from "vitest";

import type { SpectrumRow, SpectrumTable } from "../contracts";
import { buildPreviewScanModel } from "./previewScanModel";
import { traceValue } from "./scanModel";

function row(overrides: Partial<SpectrumRow> & { readonly index: number }): SpectrumRow {
  return {
    identifier: `controllerType=0 controllerNumber=1 scan=${String(overrides.index + 1)}`,
    scanNumber: overrides.index + 1,
    msLevel: 1,
    retentionTime: { value: overrides.index, unitKnown: false },
    basePeakMz: 400,
    basePeakIntensity: 10,
    totalIonCurrent: 100,
    precursorMz: null,
    ...overrides,
  };
}

function table(
  rows: readonly SpectrumRow[],
  truncated = false,
): SpectrumTable {
  return { rows, totalRowCount: truncated ? rows.length * 10 : rows.length, truncated };
}

describe("reading a preview's spectrum table as the scan model", () => {
  it("takes TIC from the total ion current and BPC from the base peak intensity", () => {
    // Deliberately distinct numbers, and deliberately the pair that could be
    // swapped without any type complaining.
    const model = buildPreviewScanModel(
      table([
        row({ index: 0, totalIonCurrent: 10_000, basePeakIntensity: 1_000 }),
        row({ index: 1, totalIonCurrent: 20_000, basePeakIntensity: 2_000 }),
      ]),
    );

    expect(model.status).toBe("ready");
    if (model.status !== "ready") {
      return;
    }
    expect(model.points.map((point) => traceValue(point, "tic"))).toEqual([10_000, 20_000]);
    expect(model.points.map((point) => traceValue(point, "bpc"))).toEqual([1_000, 2_000]);
  });

  it("places a scan at the retention time its own row reported", () => {
    const model = buildPreviewScanModel(
      table([
        row({ index: 0, retentionTime: { value: 4.5, unitKnown: false } }),
        row({ index: 1, retentionTime: { value: 9.25, unitKnown: false } }),
      ]),
    );

    expect(model.status).toBe("ready");
    if (model.status !== "ready") {
      return;
    }
    expect(model.points.map((point) => point.retentionTime)).toEqual([4.5, 9.25]);
    expect(model.fullDomain).toEqual({ low: 4.5, high: 9.25 });
  });

  it("carries each row's place in the table across the sort onto the axis", () => {
    // The table's order and the trace's order are different questions. A run
    // whose rows do not arrive in retention-time order is the case that tells
    // them apart, and the table position is what Previous/Next later walks.
    const model = buildPreviewScanModel(
      table([
        row({ index: 7, retentionTime: { value: 9, unitKnown: false } }),
        row({ index: 8, retentionTime: { value: 3, unitKnown: false } }),
        row({ index: 9, retentionTime: { value: 6, unitKnown: false } }),
      ]),
    );

    expect(model.status).toBe("ready");
    if (model.status !== "ready") {
      return;
    }
    expect(model.points.map((point) => point.spectrumIndex)).toEqual([8, 9, 7]);
    expect(model.points.map((point) => point.tablePosition)).toEqual([1, 2, 0]);
  });

  it("keeps scan number and MS level as the row reported them", () => {
    const model = buildPreviewScanModel(
      table([row({ index: 0, scanNumber: null, msLevel: 2 })]),
    );

    expect(model.status).toBe("ready");
    if (model.status !== "ready") {
      return;
    }
    expect(model.points[0]?.scanNumber).toBeNull();
    expect(model.points[0]?.msLevel).toBe(2);
  });

  it("has no model for a table the preview did not load whole", () => {
    // A prefix drawn as a chromatogram is a picture of a shorter experiment
    // than the one that happened.
    expect(buildPreviewScanModel(table([row({ index: 0 }), row({ index: 1 })], true))).toEqual({
      status: "unavailable",
      reason: "truncated",
    });
  });

  it("has no model for a run with no spectra", () => {
    expect(buildPreviewScanModel(table([]))).toEqual({
      status: "unavailable",
      reason: "no-spectra",
    });
  });

  it("has no model when a retention time cannot be placed on an axis", () => {
    expect(
      buildPreviewScanModel(
        table([row({ index: 0, retentionTime: { value: Number.NaN, unitKnown: false } })]),
      ),
    ).toEqual({ status: "unavailable", reason: "unusable-retention-time" });
  });

  it("has no model when an intensity cannot be drawn", () => {
    expect(
      buildPreviewScanModel(
        table([row({ index: 0, totalIonCurrent: Number.POSITIVE_INFINITY })]),
      ),
    ).toEqual({ status: "unavailable", reason: "unusable-intensity" });
  });

  it("forwards a reported retention-time unit rather than deciding it is absent", () => {
    // The boolean the wire carries is passed through, and the model refuses.
    // Reading it here as "no unit" would be the adapter answering a scientific
    // question that is not its to answer, and the axis would be labelled as
    // though nothing had been reported.
    expect(
      buildPreviewScanModel(
        table([
          row({ index: 0, retentionTime: { value: 0, unitKnown: false } }),
          row({ index: 1, retentionTime: { value: 1, unitKnown: true } }),
        ]),
      ),
    ).toEqual({ status: "unavailable", reason: "unsupported-retention-time-unit" });
  });
});
