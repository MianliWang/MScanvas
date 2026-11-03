import { describe, expect, it } from "vitest";

import table from "../../../../../../fixtures/plot-ticks/nice-ticks.json";
import { niceTicks, withHeadroom } from "./plotAxes";

/** One range and what `crates/plot-spec/src/ticks.rs` gives it, `null` where it gives nothing. */
interface Row {
  readonly low: number;
  readonly high: number;
  readonly ticks: readonly (readonly [number, string])[] | null;
}

const labels = (low: number, high: number) => niceTicks(low, high).map(tick => tick.label);

describe("plot axis ticks", () => {
  it("gives every range in the shared table what the figure's rule gives it", () => {
    const rows = table as unknown as readonly Row[];
    expect(rows.length).toBeGreaterThan(0);
    for (const { low, high, ticks } of rows) {
      const name = `${low} to ${high}`;
      if (ticks === null) {
        // No ticks to offer: the ends, as the rule's caller labels them.
        expect(niceTicks(low, high).map(tick => tick.value), name).toEqual(low === high ? [low] : [low, high]);
      } else {
        expect(niceTicks(low, high).map(tick => [tick.value, tick.label]), name).toEqual(ticks);
      }
    }
  });

  it("steps by 1, 2 or 5, stays inside the range and writes each label with the step's own decimals", () => {
    // The fixture run's retention times: four-decimal values, labelled at the step.
    expect(labels(0, 0.0625)).toEqual(["0.00", "0.02", "0.04", "0.06"]);
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

  it("takes the coarser of two steps equally near five ticks", () => {
    expect(labels(0, 1.2)).toEqual(["0.0", "0.5", "1.0"]);
  });

  it("writes large and tiny values as exponents, each from the tick's own digits", () => {
    expect(labels(0, 2_100_000)).toEqual(["0", "5e5", "1e6", "1.5e6", "2e6"]);
    expect(labels(0, 0.00042)).toEqual(["0", "1e-4", "2e-4", "3e-4", "4e-4"]);
  });

  it("labels the ends of a range the rule has no ticks for, as the figure does", () => {
    // A range with no width: its one value, and never rounded to another.
    expect(niceTicks(250, 250)).toEqual([{ value: 250, label: "250.000000" }]);
    expect(labels(12.5, 12.5)).toEqual(["12.500000"]);
    expect(labels(0, 0)).toEqual(["0.000000"]);
    // Fixed point would state these as zero, or as hundreds of digits.
    expect(labels(1e-20, 1e-20)).toEqual(["1e-20"]);
    expect(labels(1e307, 1e307)).toEqual(["1e307"]);
    // A span narrow beside its magnitude: two numbers that read as two.
    expect(labels(1e20, 1e20 + 65_536)).toEqual(["100000000000000000000", "100000000000000065536"]);
    expect(niceTicks(Number.NaN, 1)).toEqual([]);
  });

  it("adds headroom only on the sides that hold values, and leaves zero where it is", () => {
    expect(withHeadroom(0, 9000)).toEqual({ low: 0, high: 9450 });
    expect(withHeadroom(-40, 60)).toEqual({ low: -45, high: 65 });
    expect(withHeadroom(0, 0)).toEqual({ low: 0, high: 0 });
  });
});
