import { describe, expect, it } from "vitest";

import geometry from "../../../../../../fixtures/plot-ticks/axis-geometry.json";
import table from "../../../../../../fixtures/plot-ticks/nice-ticks.json";
import { bandFraction, DOMAIN_INSET, niceTicks, positionAt, VALUE_HEADROOM, withHeadroom, xAt, xBand } from "./plotAxes";

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

  it("writes an end label digit for digit as the figure does, where toFixed would not", () => {
    // An exact tie goes to the even digit, either way and with either sign.
    expect(labels(12.0078125, 12.0078125)).toEqual(["12.007812"]);
    expect(labels(12.0234375, 12.0234375)).toEqual(["12.023438"]);
    expect(labels(-12.0078125, -12.0078125)).toEqual(["-12.007812"]);
    // From 1e21 fixed point still states every digit, up to the 24 characters an end label may have.
    expect(labels(4.436925591500016e21, 4.436925591500016e21 + 2 ** 19))
      .toEqual(["4436925591500015796224", "4436925591500016320512"]);
    expect(labels(1e21, 1e21)).toEqual(["1e21"]);
  });

  it("adds headroom only on the sides that hold values, and leaves zero where it is", () => {
    expect(withHeadroom(0, 9000)).toEqual({ low: 0, high: 9450 });
    expect(withHeadroom(-40, 60)).toEqual({ low: -45, high: 65 });
    expect(withHeadroom(0, 0)).toEqual({ low: 0, high: 0 });
  });
});

/** One frame and domain, and where `crates/plot-spec/src/svg.rs` draws three places on it. */
interface XRow {
  readonly frame: readonly [number, number];
  readonly low: number;
  readonly high: number;
  readonly at: readonly (readonly [number, number])[];
}
/** One value range and the axis and ticks the figure gives it; `null` for a range the screen never has. */
interface ValueRow {
  readonly low: number;
  readonly high: number;
  readonly axis: readonly [number, number];
  readonly ticks: readonly (readonly [number, string])[] | null;
}

describe("one geometry with the figure", () => {
  const xRows = geometry.x as unknown as readonly XRow[];
  const valueRows = geometry.values as unknown as readonly ValueRow[];

  it("has the figure's inset and headroom", () => {
    expect(DOMAIN_INSET).toBe(geometry.domain_inset);
    expect(VALUE_HEADROOM).toBe(geometry.headroom);
  });

  it("draws every place in the shared table where the figure does, to the last bit", () => {
    expect(xRows.length).toBeGreaterThan(0);
    for (const { frame, low, high, at } of xRows) {
      for (const [value, x] of at) {
        expect(xAt(value, { low, high }, xBand(frame[0], frame[1])), `${value} on ${low} to ${high}`).toBe(x);
      }
    }
  });

  it("reads every drawn place back as itself, each end to the last bit", () => {
    for (const { frame, low, high, at } of xRows) {
      const band = xBand(frame[0], frame[1]);
      const domain = { low, high };
      const back = (value: number) => positionAt(bandFraction(xAt(value, domain, band), band), domain);
      expect(back(low), `${low} to ${high}`).toBe(low);
      expect(back(high), `${low} to ${high}`).toBe(high);
      for (const [value] of at) {
        const slack = 4 * Number.EPSILON * Math.max(Math.abs(low), Math.abs(high));
        expect(Math.abs(back(value) - value), `${value} on ${low} to ${high}`).toBeLessThanOrEqual(slack);
      }
    }
  });

  it("reads a place in the inset as the end beside it, never as a place past the range", () => {
    const band = xBand(64, 988);
    const domain = { low: 0.3, high: 0.9 };
    expect(band).toEqual({ left: 72, drawnWidth: 908 });
    for (const x of [0, 64, 71.5]) expect(positionAt(bandFraction(x, band), domain)).toBe(0.3);
    for (const x of [980.5, 988, 1000]) expect(positionAt(bandFraction(x, band), domain)).toBe(0.9);
    // A fraction just short of the end stays inside the range.
    expect(positionAt(1 - Number.EPSILON / 2, domain)).toBeLessThanOrEqual(0.9);
  });

  it("draws a range with no width down the middle, and reads it back as its one value", () => {
    const band = xBand(64, 988);
    const domain = { low: 250, high: 250 };
    expect(xAt(250, domain, band)).toBe(526);
    for (const x of [64, 526, 988]) expect(positionAt(bandFraction(x, band), domain)).toBe(250);
  });

  it("gives every value range in the shared table the figure's axis, and the figure's ticks", () => {
    expect(valueRows.length).toBeGreaterThan(0);
    for (const { low, high, axis, ticks } of valueRows) {
      const name = `${low} to ${high}`;
      const shown = withHeadroom(low, high);
      expect([shown.low, shown.high], name).toEqual(axis);
      if (ticks !== null) expect(niceTicks(shown.low, shown.high).map(tick => [tick.value, tick.label]), name).toEqual(ticks);
    }
  });

  it("leaves off the headroom that would pass the largest number there is", () => {
    expect(withHeadroom(0, 1.79e308)).toEqual({ low: 0, high: 1.79e308 });
    expect(withHeadroom(-1.79e308, 0)).toEqual({ low: -1.79e308, high: 0 });
  });
});
