import { describe, expect, it } from "vitest";

import { niceTicks, withHeadroom } from "./plotAxes";

const labels = (low: number, high: number) => niceTicks(low, high).map(tick => tick.label);

describe("plot axis ticks", () => {
  it("steps by 1, 2 or 5, stays inside the range and trims the decimals to the step", () => {
    // The fixture run's retention times: four-decimal values, labelled at the step.
    expect(labels(0, 0.0625)).toEqual(["0", "0.02", "0.04", "0.06"]);
    expect(labels(300, 302.5)).toEqual(["300.0", "300.5", "301.0", "301.5", "302.0", "302.5"]);
    expect(labels(0, 30.1)).toEqual(["0", "10", "20", "30"]);
    expect(labels(100, 2000)).toEqual(["500", "1000", "1500", "2000"]);
    for (const [low, high] of [[0, 0.0625], [300.5, 302], [0.3, 17.9], [-45, 63], [0, 9450]] as const) {
      const ticks = niceTicks(low, high);
      expect(ticks.length, `${low}–${high}`).toBeGreaterThanOrEqual(3);
      expect(ticks.length, `${low}–${high}`).toBeLessThanOrEqual(7);
      for (const tick of ticks) {
        expect(tick.value).toBeGreaterThanOrEqual(low);
        expect(tick.value).toBeLessThanOrEqual(high);
      }
    }
  });

  it("puts large and tiny values on one shared exponent", () => {
    expect(labels(0, 2_100_000)).toEqual(["0", "0.5e+6", "1.0e+6", "1.5e+6", "2.0e+6"]);
    expect(labels(0, 0.00042)).toEqual(["0", "1e-4", "2e-4", "3e-4", "4e-4"]);
  });

  it("labels a range with no width at its one value", () => {
    expect(niceTicks(250, 250)).toEqual([{ value: 250, label: "250" }]);
    expect(niceTicks(Number.NaN, 1)).toEqual([]);
  });

  it("adds headroom only on the sides that hold values, and leaves zero where it is", () => {
    expect(withHeadroom(0, 9000)).toEqual({ low: 0, high: 9450 });
    expect(withHeadroom(-40, 60)).toEqual({ low: -45, high: 65 });
    expect(withHeadroom(0, 0)).toEqual({ low: 0, high: 0 });
  });
});
