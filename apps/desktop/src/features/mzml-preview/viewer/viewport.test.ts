import { describe, expect, it } from "vitest";

import type { RetentionTimeDomain } from "./scanModel";
import {
  clampDomain,
  contains,
  isFullDomain,
  minimumSpan,
  panDomain,
  revealDomain,
  zoomDomain,
} from "./viewport";

const FULL: RetentionTimeDomain = { low: 0, high: 100 };

describe("what a viewport may be", () => {
  it("treats a missing viewport as the whole run", () => {
    expect(isFullDomain(null, FULL)).toBe(true);
    expect(isFullDomain({ low: 0, high: 100 }, FULL)).toBe(true);
    expect(isFullDomain({ low: 10, high: 20 }, FULL)).toBe(false);
  });

  it("is always finite, forward and inside the run, whatever it is asked for", () => {
    for (const request of [
      { low: -50, high: -10 },
      { low: 200, high: 260 },
      { low: 60, high: 20 },
      { low: NaN, high: 10 },
      { low: 10, high: NaN },
      { low: Number.NEGATIVE_INFINITY, high: Number.POSITIVE_INFINITY },
      { low: 5, high: 5 },
    ]) {
      const clamped = clampDomain(request, FULL);
      expect(Number.isFinite(clamped.low)).toBe(true);
      expect(Number.isFinite(clamped.high)).toBe(true);
      expect(clamped.high).toBeGreaterThan(clamped.low);
      expect(clamped.low).toBeGreaterThanOrEqual(FULL.low);
      expect(clamped.high).toBeLessThanOrEqual(FULL.high);
    }
  });

  it("clamps out-of-range requests to each edge", () => {
    expect(clampDomain({ low: -50, high: -10 }, FULL)).toEqual({ low: 0, high: 40 });
    expect(clampDomain({ low: 200, high: 260 }, FULL)).toEqual({ low: 40, high: 100 });
  });
});

describe("zoom and pan", () => {
  it("zooms about the pointer, keeping the held time in place", () => {
    const zoomed = zoomDomain({ low: 0, high: 100 }, FULL, 0.5, 0.25);

    expect(zoomed.high - zoomed.low).toBeCloseTo(50, 10);
    expect(zoomed.low + (zoomed.high - zoomed.low) * 0.25).toBeCloseTo(25, 10);
  });

  it("never zooms out past the whole run, nor in past the minimum span", () => {
    expect(zoomDomain({ low: 40, high: 60 }, FULL, 100, 0.5)).toEqual(FULL);

    const tiny = zoomDomain({ low: 40, high: 60 }, FULL, 1e-9, 0.5);
    expect(tiny.high - tiny.low).toBeCloseTo(minimumSpan(FULL), 12);
    expect(minimumSpan(FULL)).toBeGreaterThan(0);
  });

  it("pans without changing the span, and stops at each edge", () => {
    expect(panDomain({ low: 20, high: 40 }, FULL, 0.5)).toEqual({ low: 30, high: 50 });
    expect(panDomain({ low: 0, high: 20 }, FULL, -5)).toEqual({ low: 0, high: 20 });
    expect(panDomain({ low: 80, high: 100 }, FULL, 5)).toEqual({ low: 80, high: 100 });
  });

  it("is inert on a run whose scans all share one retention time", () => {
    const flat: RetentionTimeDomain = { low: 7, high: 7 };

    expect(minimumSpan(flat)).toBe(0);
    expect(zoomDomain(flat, flat, 0.5, 0.5)).toEqual(flat);
    expect(panDomain(flat, flat, 1)).toEqual(flat);
  });
});

describe("revealing a retention time", () => {
  it("returns the same viewport, by identity, when nothing needs to move", () => {
    // By identity, so a caller can decide whether to publish anything without
    // comparing numbers.
    const visible = { low: 20, high: 40 };

    expect(revealDomain(visible, FULL, 30)).toBe(visible);
    expect(revealDomain(visible, FULL, NaN)).toBe(visible);
  });

  it("pans the least it can, keeping the span the user chose", () => {
    const revealed = revealDomain({ low: 20, high: 40 }, FULL, 55);

    expect(revealed.high - revealed.low).toBeCloseTo(20, 10);
    expect(contains(revealed, 55)).toBe(true);
    expect(revealed.low).toBeGreaterThan(20);
  });

  it("reveals a time before the viewport too, and stays inside the run", () => {
    expect(contains(revealDomain({ low: 60, high: 80 }, FULL, 5), 5)).toBe(true);
    expect(revealDomain({ low: 60, high: 80 }, FULL, 0)).toEqual({ low: 0, high: 20 });
    expect(revealDomain({ low: 0, high: 20 }, FULL, 100)).toEqual({ low: 80, high: 100 });
  });
});

describe("a clamped viewport is inside the run to the last bit", () => {
  /*
   * Round 1 of M4.3.2's review. Holding a viewport inside the run was written
   * as arithmetic rather than as a fact: the left edge is `full.high - span`
   * and the right edge is that plus the span again. Neither step is required to
   * land back on the run's own numbers in binary floating point.
   *
   * Nothing on screen shows one unit in the last place. But the committed
   * viewport is the range a current-range export asks for, and Rust refuses a
   * range reaching outside the run rather than quietly exporting the nearest
   * one it has -- so the viewer could hand its own export boundary a range that
   * boundary must reject.
   *
   * These retention times are ones the arithmetic was actually searched for and
   * found on, in minutes with fractional seconds, which is what a run is.
   */
  const AWKWARD: readonly RetentionTimeDomain[] = [
    { low: 5.400241350394454, high: 82.72436049997539 },
    { low: 1.4667649833154983, high: 8.634284613181652 },
  ];

  it("returns the whole run unchanged when that is what it is given", () => {
    for (const full of AWKWARD) {
      // The step that used to move it: the furthest left edge a full-width
      // span may start at rounds *below* the run's own start.
      expect(full.high - (full.high - full.low)).toBeLessThan(full.low);

      expect(clampDomain({ low: full.low, high: full.high }, full)).toEqual(full);
    }
  });

  it("never leaves the run at either edge, whatever it is given", () => {
    // The property, over the shapes a gesture produces: any span, any position,
    // panned or zoomed past either end.
    for (const full of AWKWARD) {
      const fullSpan = full.high - full.low;
      for (let step = 0; step <= 200; step++) {
        const span = (fullSpan * (step + 1)) / 201;
        for (const low of [
          -1e9,
          full.low - span,
          full.low,
          full.low + fullSpan / 3,
          full.high - span,
          full.high,
          1e9,
        ]) {
          const clamped = clampDomain({ low, high: low + span }, full);
          expect(clamped.low).toBeGreaterThanOrEqual(full.low);
          expect(clamped.high).toBeLessThanOrEqual(full.high);
          expect(clamped.high).toBeGreaterThanOrEqual(clamped.low);
        }
      }
    }
  });

  it("keeps zoom and pan inside the run over a long session", () => {
    // Every gesture clamps through the same door, so the invariant is about the
    // state a session can reach rather than about one call. Deterministic: the
    // sequence is fixed, and it is the shape that found the defect.
    for (const full of AWKWARD) {
      let visible: RetentionTimeDomain = { low: full.low, high: full.high };
      for (let step = 0; step < 200; step++) {
        visible =
          step % 3 === 0
            ? zoomDomain(visible, full, 0.6 + (step % 7) / 10, (step % 11) / 10)
            : clampDomain(
                {
                  low: visible.low + (visible.high - visible.low) * (((step % 5) - 2) / 3),
                  high: visible.high + (visible.high - visible.low) * (((step % 5) - 2) / 3),
                },
                full,
              );
        expect(visible.low).toBeGreaterThanOrEqual(full.low);
        expect(visible.high).toBeLessThanOrEqual(full.high);
      }
    }
  });
});
