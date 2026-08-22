/**
 * The nine PR #72 findings, each tied to the invariant that now prevents it and
 * to the test that holds that invariant.
 *
 * This file is a map rather than a second implementation of those tests. Its
 * value is that the mapping is checked: every entry names a real exported
 * function, and every invariant is exercised here in one line so that deleting
 * or weakening the thing it points at breaks something.
 *
 * The point of Viewer Closure R0 is that none of these depend on the order in
 * which React effects happen to run. They are properties of pure functions.
 */

import { describe, expect, it } from "vitest";

import {
  activeGestureEpoch,
  consumeSelection,
  initialSelectionConsumer,
  initialViewerInteractionState,
  viewerInteractionReducer,
} from "./interactionState";
import type { ViewerInteractionState } from "./interactionState";
import { clipTrace, revealScrollTop, visibleExtent } from "./renderGeometry";
import { buildScanModel, nearestScan } from "./scanModel";
import type { ScanPoint } from "./scanModel";

const FULL = { low: 0, high: 100 };

function loaded(): ViewerInteractionState {
  return viewerInteractionReducer(initialViewerInteractionState, {
    type: "preview-loaded",
    fullDomain: FULL,
  });
}

function scan(retentionTime: number, tic: number, index: number): ScanPoint {
  return {
    spectrumIndex: index,
    tablePosition: index,
    scanNumber: index + 1,
    msLevel: 1,
    retentionTime,
    totalIonCurrent: tic,
    basePeakIntensity: tic / 10,
  };
}

/**
 * Finding -> invariant -> where it lives.
 *
 * The `holds` column is the assertion, in one line, so this table cannot drift
 * away from the code it describes.
 */
describe("the PR #72 findings, and what now prevents each", () => {
  it("1. a roving tab stop is not visibility — reveal is a geometry question", () => {
    // `revealScrollTop` takes a scroll position and a row, and nothing about
    // focus. There is no argument through which focus could suppress it.
    expect(revealScrollTop({ rowHeight: 30, headerHeight: 30, viewportHeight: 330 }, 9, 300)).toBe(
      270,
    );
  });

  it("2. duplicate retention times are canonicalized before the tie is broken", () => {
    // The lower retention-time group holds the earlier table row, but its
    // *last* member -- the one a binary search lands beside -- does not.
    const groups = [
      { ...scan(10, 1, 11), tablePosition: 1 },
      { ...scan(10, 1, 12), tablePosition: 100 },
      { ...scan(20, 1, 13), tablePosition: 50 },
    ];

    expect(nearestScan(groups, 15)?.tablePosition).toBe(1);
  });

  it("3. a repeated commit of the same scan is a new event", () => {
    const first = consumeSelection(initialSelectionConsumer, {
      index: 4,
      revision: 1,
      retentionTime: 20,
    });
    const again = consumeSelection(first.consumer, { index: 4, revision: 2, retentionTime: 20 });

    expect(again.consumed).not.toBeNull();
  });

  it("4. a retention-time unit this build cannot name produces no model", () => {
    expect(
      buildScanModel({
        rows: [
          {
            index: 0,
            tablePosition: 0,
            scanNumber: 1,
            msLevel: 1,
            retentionTime: 0,
            retentionTimeUnitKnown: true,
            totalIonCurrent: 1,
            basePeakIntensity: 1,
          },
        ],
        truncated: false,
      }),
    ).toEqual({ status: "unavailable", reason: "unsupported-retention-time-unit" });
  });

  it("5. one revision, and any number of consumers with their own bookmarks", () => {
    // The omission was structural: the table consumed the revision and the plot
    // did not. `consumeSelection` is the whole rule, and it belongs to no
    // surface, so wiring a new consumer is one call rather than a new idea.
    const selection = { index: 4, revision: 1, retentionTime: 20 };
    const table = consumeSelection(initialSelectionConsumer, selection);
    const plot = consumeSelection(initialSelectionConsumer, selection);

    expect(table.consumed).not.toBeNull();
    expect(plot.consumed).not.toBeNull();
  });

  it("6. the sticky header is in normal flow and is subtracted once", () => {
    const layout = { rowHeight: 30, headerHeight: 30, viewportHeight: 330 };

    // A row already at the header's bottom edge does not move.
    expect(revealScrollTop(layout, 10, 300)).toBe(300);
  });

  it("7. the visible extent comes from the clipped polyline", () => {
    const points = [scan(9, 9_000_000, 0), scan(10, 90, 1), scan(13, 120, 2)];

    expect(visibleExtent([clipTrace(points, "tic", { low: 10, high: 13 })]).high).toBe(120);
  });

  it("8. a selection cancels a pending gesture before it can settle", () => {
    const gesturing = viewerInteractionReducer(loaded(), {
      type: "gesture-started",
      domain: { low: 10, high: 30 },
    });
    const epoch = activeGestureEpoch(gesturing) as number;
    const selected = viewerInteractionReducer(gesturing, {
      type: "selection-committed",
      index: 1,
      revision: 1,
      retentionTime: 90,
    });

    expect(viewerInteractionReducer(selected, { type: "gesture-settled", epoch })).toBe(selected);
  });

  it("9. hover does not survive a viewport change", () => {
    const hovering = viewerInteractionReducer(loaded(), {
      type: "hover-established",
      retentionTime: 42,
      spectrumIndex: 8,
    });
    const zoomed = viewerInteractionReducer(hovering, {
      type: "viewport-step",
      domain: { low: 30, high: 50 },
    });

    expect(zoomed.hover).toBeNull();
  });
});

describe("the two authorities that must never move", () => {
  it("a scan is chosen from the full model, never from drawn geometry", () => {
    // The reduced drawing has fewer vertices than the run has scans, and a
    // boundary intersection is not a scan at all. `nearestScan` takes
    // `ScanPoint[]`, so neither can be passed to it.
    const points = Array.from({ length: 1_000 }, (_, index) => scan(index, index, index));
    const drawn = clipTrace(points, "tic", { low: 400, high: 600 });

    expect(nearestScan(points, 500.4)?.spectrumIndex).toBe(500);
    // Every drawn vertex that is a scan is one of the source scans; the rest
    // carry no identity to select by.
    for (const vertex of drawn) {
      if (vertex.kind === "boundary") {
        expect(Object.hasOwn(vertex, "scan")).toBe(false);
      }
    }
  });

  it("a committed viewport is the only thing a current-range export could read", () => {
    // A gesture in progress is deliberately not committed, so an export taken
    // mid-drag cannot describe a range the user never settled on.
    const gesturing = viewerInteractionReducer(loaded(), {
      type: "gesture-started",
      domain: { low: 10, high: 30 },
    });

    expect(gesturing.committedDomain).toBeNull();
    expect(gesturing.gesture).not.toBeNull();
  });
});
