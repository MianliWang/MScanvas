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
