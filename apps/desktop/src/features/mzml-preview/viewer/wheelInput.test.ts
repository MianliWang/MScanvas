/**
 * What a wheel event asks for, before anything knows what a viewport is.
 *
 * The defect this closes was a viewer that read one bit of a `WheelEvent` -- the
 * sign of `deltaY` -- and applied a fixed step per event. Zoom rate was then a
 * property of how a device chose to *packetise* a gesture rather than of the
 * gesture: one hundred small events and one large one carrying the same travel
 * asked for the same thing and got answers three orders of magnitude apart.
 *
 * So the property under test is not "the numbers came out right". It is
 * **compositional**: the factor of a sum is the product of the factors. Every
 * case below is an instance of that, or of what has to be true for it to hold --
 * that magnitude is read at all, that a unit is read before a magnitude is
 * believed, and that the two directions are reciprocal.
 */

import { describe, expect, it } from "vitest";

import {
  DOM_DELTA_LINE,
  DOM_DELTA_PAGE,
  DOM_DELTA_PIXEL,
  LINE_COEFFICIENT,
  PAGE_COEFFICIENT,
  PIXEL_COEFFICIENT,
  normalizeWheelDelta,
  wheelZoomFactor,
} from "./wheelInput";

/** A pixel-mode event, which is what nearly every device sends. */
function pixels(deltaY: number) {
  return { deltaY, deltaMode: DOM_DELTA_PIXEL };
}

function lines(deltaY: number) {
  return { deltaY, deltaMode: DOM_DELTA_LINE };
}

function pages(deltaY: number) {
  return { deltaY, deltaMode: DOM_DELTA_PAGE };
}

describe("reading one wheel event", () => {
  it("reads the magnitude, not merely the sign", () => {
    // The defect, stated as its inverse. Under the old rule these four were one
    // request; a wheel that says how far it turned deserves an answer that
    // depends on how far it turned.
    const factors = [-1, -20, -100, -240].map((delta) => wheelZoomFactor(pixels(delta)));

    expect(new Set(factors).size).toBe(4);
    for (const factor of factors) {
      expect(factor).not.toBeNull();
    }
  });

  it("reads the unit before it believes the magnitude", () => {
    // 25 pixels and one line are the same request in this product's units, and
    // a viewer that ignored `deltaMode` would treat one of them as 25 times the
    // other.
    expect(normalizeWheelDelta(pixels(-25))).toBe(normalizeWheelDelta(lines(-1)));
    expect(normalizeWheelDelta(pixels(-500))).toBe(normalizeWheelDelta(lines(-20)));
    expect(normalizeWheelDelta(pixels(-500))).toBe(normalizeWheelDelta(pages(-1)));
  });

  it("scales each unit by its own coefficient and nothing else", () => {
    expect(normalizeWheelDelta(pixels(-3))).toBeCloseTo(-3 * PIXEL_COEFFICIENT, 15);
    expect(normalizeWheelDelta(lines(-3))).toBeCloseTo(-3 * LINE_COEFFICIENT, 15);
    expect(normalizeWheelDelta(pages(-3))).toBeCloseTo(-3 * PAGE_COEFFICIENT, 15);
  });

  it("turns one page of wheel into a halving, which is where the scale comes from", () => {
    // The one absolute decision in the mapping. Everything else is this,
    // continuously.
    expect(wheelZoomFactor(pages(-1))).toBeCloseTo(0.5, 12);
    expect(wheelZoomFactor(pages(1))).toBeCloseTo(2, 12);
  });

  it("narrows on a negative delta and widens on a positive one", () => {
    expect(wheelZoomFactor(pixels(-100))).toBeLessThan(1);
    expect(wheelZoomFactor(pixels(100))).toBeGreaterThan(1);
  });
});

describe("what makes event chunking irrelevant", () => {
  /*
   * The compositional property, tested as algebra here and again at the
   * viewport in `viewportAction.test.ts`. Both are worth having: this one says
   * the mapping is right, that one says the viewer uses it.
   */

  it("multiplies where the deltas add", () => {
    for (const [a, b] of [
      [-1, -1],
      [-40, -60],
      [-0.5, -99.5],
      [30, 70],
      [-25, 75],
    ] as const) {
      const together = wheelZoomFactor(pixels(a + b)) as number;
      const apart =
        (wheelZoomFactor(pixels(a)) as number) * (wheelZoomFactor(pixels(b)) as number);

      expect(Math.abs(apart - together) / together, `${String(a)} + ${String(b)}`).toBeLessThan(
        1e-12,
      );
    }
  });

  it("arrives at the same factor however finely the same travel is cut up", () => {
    const whole = wheelZoomFactor(pixels(-100)) as number;

    for (const pieces of [2, 4, 10, 100]) {
      let compounded = 1;
      for (let step = 0; step < pieces; step += 1) {
        compounded *= wheelZoomFactor(pixels(-100 / pieces)) as number;
      }
      // Ordinary double-precision drift over `pieces` multiplications, and
      // nothing else. This is not a user-facing tolerance: the two paths are
      // the same number computed two ways.
      expect(Math.abs(compounded - whole) / whole, `${String(pieces)} pieces`).toBeLessThan(
        1e-12,
      );
    }
  });

  it("does not do this by accident of a linear mapping", () => {
    /*
     * The rejected alternative, pinned so the reason survives. `1 + k·delta`
     * would make partitioning matter again -- (1 + k·d/2)² is not 1 + k·d -- and
     * the difference is large at the magnitudes a wheel actually carries.
     */
    const k = PIXEL_COEFFICIENT;
    const linearWhole = 1 - k * 100;
    const linearHalves = (1 - (k * 100) / 2) ** 2;

    expect(Math.abs(linearHalves - linearWhole) / Math.abs(linearWhole)).toBeGreaterThan(1e-3);
    // Where the exponential mapping's own halves land on top of each other.
    const halves = (wheelZoomFactor(pixels(-50)) as number) ** 2;
    expect(Math.abs(halves - (wheelZoomFactor(pixels(-100)) as number))).toBeLessThan(1e-15);
  });

  it("comes back to where it started when the wheel is turned back", () => {
    for (const magnitude of [1, 13.5, 100, 240, 1_000]) {
      const there = wheelZoomFactor(pixels(-magnitude)) as number;
      const back = wheelZoomFactor(pixels(magnitude)) as number;

      expect(there * back, `+-${String(magnitude)}`).toBeCloseTo(1, 12);
    }
  });

  it("keeps a larger delta a larger request, in both directions", () => {
    const inward = [-1, -20, -100, -240].map((delta) => wheelZoomFactor(pixels(delta)) as number);
    const outward = [1, 20, 100, 240].map((delta) => wheelZoomFactor(pixels(delta)) as number);

    for (let step = 1; step < inward.length; step += 1) {
      // Further below 1 each time, which is more narrowing.
      expect(inward[step]).toBeLessThan(inward[step - 1] as number);
      expect(outward[step]).toBeGreaterThan(outward[step - 1] as number);
    }
  });
});

describe("what the viewer will not read", () => {
  it("declines a delta of zero, which asks for nothing", () => {
    expect(normalizeWheelDelta(pixels(0))).toBeNull();
    expect(wheelZoomFactor(pixels(0))).toBeNull();
    expect(wheelZoomFactor(lines(0))).toBeNull();
  });

  it("declines a delta that is not a number", () => {
    for (const delta of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(normalizeWheelDelta(pixels(delta))).toBeNull();
      expect(wheelZoomFactor(pixels(delta))).toBeNull();
    }
  });

  it("declines a unit it has never heard of rather than guessing pixels", () => {
    /*
     * Fails open, and that is the point: an unclaimed wheel still scrolls the
     * page. A mode this code does not know could mean anything, and reading it
     * as pixels would turn some future device's ordinary scroll into a wild
     * zoom.
     */
    for (const mode of [3, 4, -1, 1.5, Number.NaN]) {
      expect(normalizeWheelDelta({ deltaY: -100, deltaMode: mode }), String(mode)).toBeNull();
      expect(wheelZoomFactor({ deltaY: -100, deltaMode: mode }), String(mode)).toBeNull();
    }
  });

  it("declines a magnitude so large the factor is no longer a number", () => {
    // Nothing a device emits comes near this. What matters is that an overflow
    // is declined rather than handed to the viewport arithmetic as an infinity
    // or a zero.
    expect(wheelZoomFactor(pixels(1e9))).toBeNull();
    expect(wheelZoomFactor(pixels(-1e9))).toBeNull();
    expect(wheelZoomFactor(pages(2_000))).toBeNull();
  });

  it("still reads the largest magnitudes a device could plausibly send", () => {
    for (const wheel of [pixels(-4_000), pixels(4_000), lines(-160), pages(-8)]) {
      const factor = wheelZoomFactor(wheel);
      expect(factor).not.toBeNull();
      expect(Number.isFinite(factor as number)).toBe(true);
      expect(factor as number).toBeGreaterThan(0);
    }
  });
});
