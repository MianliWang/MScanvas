/**
 * Axis ticks for the on-screen plots, and nothing that is a measurement.
 *
 * A tick is a place on an axis, labelled with the value that sits there. None
 * of it changes what is drawn, which range is on screen or what a value is.
 *
 * The range rule is the exported figure's (`crates/plot-spec`, `svg.rs`
 * `value_axis` and `project`), so a screen plot and its export frame the data
 * alike: the x axis is the drawn domain exactly, with no padding at either
 * end, and the value axis gains 5% of its span above the largest value and
 * below the deepest negative one, never across zero. Both value ranges hold
 * zero before the headroom, as the figure's do (`chromatogram.rs` and
 * `export.rs` `visible_value_extent`).
 */

export interface AxisTick {
  readonly value: number;
  readonly label: string;
}

/** The share of the visible value span left empty beyond its extremes: plot-spec's `HEADROOM`. */
export const VALUE_HEADROOM = 0.05;

/**
 * The value range the axis spans: the visible extent, widened by the headroom
 * on each side that holds a value. Zero stays where it is, so an all-positive
 * plot still starts at zero.
 */
export function withHeadroom(low: number, high: number): { readonly low: number; readonly high: number } {
  const span = high - low;
  if (!Number.isFinite(span) || !(span > 0)) return { low, high };
  const pad = span * VALUE_HEADROOM;
  return { low: low < 0 ? low - pad : low, high: high > 0 ? high + pad : high };
}

/** How many ticks an axis aims for: plot-spec's `TARGET_TICKS`. */
const TARGET_TICKS = 5;
/** Past this many, a finer step only adds labels: plot-spec's `MAX_TICKS`. */
const MAX_TICKS = 12;
/** Past this, `k × mantissa` stops being an exact integer: plot-spec's `EXACT_INTEGER / 8`. */
const EXACT_MULTIPLE = 2 ** 53 / 8;
/** The longest a fixed-point tick label may be before the axis uses exponents: plot-spec's `MAX_FIXED_CHARS`. */
const MAX_FIXED_CHARS = 12;

/**
 * The ticks for `[low, high]` and what each says: `crates/plot-spec/src/ticks.rs`
 * `nice_ticks` under a `fits` that always answers yes, and where that has none,
 * the ends as its caller labels them. `fixtures/plot-ticks/nice-ticks.json` holds
 * both sides to one table.
 *
 * ponytail: no label-collision check, the figure's `fits`: long labels on a
 * narrow plot can overlap, or be cut at the panel's edge, where the figure would
 * thin them out. Measure them here if that matters in real data.
 */
export function niceTicks(low: number, high: number): readonly AxisTick[] {
  if (!Number.isFinite(low) || !Number.isFinite(high)) return [];
  return ruleTicks(low, high) ?? endTicks(low, high);
}

/** `nice_ticks`: coarsest first, the count nearest the target, and the coarser of two equally near. */
function ruleTicks(low: number, high: number): readonly AxisTick[] | null {
  const span = high - low;
  if (!(span > 0) || !Number.isFinite(span)) return null;
  const top = Math.floor(Math.log10(span)) + 1;
  let best: { readonly score: number; readonly ticks: readonly AxisTick[] } | null = null;
  for (let exponent = top; exponent >= top - 4; exponent -= 1) {
    for (const mantissa of [5, 2, 1]) {
      const step = Number(`${mantissa}e${exponent}`);
      if (!Number.isFinite(step) || step === 0) continue;
      const first = Math.floor(low / step) - 1;
      const last = Math.ceil(high / step) + 1;
      // A finer step only needs larger integers: no later candidate is exact.
      if (!(Math.abs(first) <= EXACT_MULTIPLE && Math.abs(last) <= EXACT_MULTIPLE)) return best?.ticks ?? null;
      const ticks = candidateTicks(low, high, first, last, mantissa, exponent);
      if (ticks === null || ticks.length > MAX_TICKS) return best?.ticks ?? null;
      if (ticks.length < 2) continue;
      const score = Math.abs(ticks.length - TARGET_TICKS);
      if (best === null || score < best.score) best = { score, ticks };
    }
  }
  return best?.ticks ?? null;
}

/**
 * `k × mantissa × 10^exponent` inside the range, each parsed from its decimal
 * string so `0.3` is the number nearest three tenths and not `3 × 0.1`; `null`
 * where two parse to one number.
 */
function candidateTicks(low: number, high: number, first: number, last: number, mantissa: number,
  exponent: number): readonly AxisTick[] | null {
  const kept: { readonly integer: number; readonly value: number }[] = [];
  for (let k = first; k <= last; k += 1) {
    const integer = k * mantissa;
    const value = Number(`${integer}e${exponent}`);
    if (value < low || value > high) continue;
    if (kept.length > 0 && kept[kept.length - 1].value >= value) return null;
    kept.push({ integer, value });
  }
  const largest = Math.max(0, ...kept.map(tick => Math.abs(tick.value)));
  const fixed = kept.map(tick => fixedLabel(tick.integer, exponent));
  const exponential = largest >= 1e6 || (largest > 0 && largest < 1e-3)
    || fixed.some(label => label.length > MAX_FIXED_CHARS);
  return kept.map((tick, index) => ({ value: tick.value,
    label: exponential ? scientificLabel(tick.integer, exponent) : fixed[index] }));
}

/** `integer × 10^exponent` with the step's own decimals: `0.0, 0.5, 1.0`, never `0, 0.5, 1`. */
function fixedLabel(integer: number, exponent: number): string {
  const sign = integer < 0 ? "-" : "";
  const digits = String(Math.abs(integer));
  if (exponent >= 0) return integer === 0 ? "0" : `${sign}${digits}${"0".repeat(exponent)}`;
  const padded = digits.padStart(1 - exponent, "0");
  const point = padded.length + exponent;
  return `${sign}${padded.slice(0, point)}.${padded.slice(point)}`;
}

/** `integer × 10^exponent` as a shortest mantissa and an exponent: `2e6`, `1.5e-7`, and `0` for zero. */
function scientificLabel(integer: number, exponent: number): string {
  if (integer === 0) return "0";
  const digits = String(Math.abs(integer));
  const kept = digits.replace(/0+$/u, "");
  const mantissa = kept.length === 1 ? kept : `${kept[0]}.${kept.slice(1)}`;
  return `${integer < 0 ? "-" : ""}${mantissa}e${exponent + digits.length - 1}`;
}

/**
 * `svg.rs` `axis_ends`, for a range the rule has no ticks for: one tick at the
 * only value of a range with no width, and two numbers that read as two
 * otherwise. Fixed point while it states them, else the shortest exponent form.
 */
function endTicks(low: number, high: number): readonly AxisTick[] {
  const span = high - low;
  const ends = span > 0 ? [low, high] : [low];
  let decimals = span > 0 && Number.isFinite(span) ? Math.min(6, Math.max(0, Math.ceil(-Math.log10(span)) + 2)) : 6;
  while (ends.length === 2 && decimals < 17 && fixedNumber(low, decimals) === fixedNumber(high, decimals)) decimals += 1;
  const fixed = ends.map(value => fixedNumber(value, decimals));
  const exponential = (ends.length === 2 && fixed[0] === fixed[1]) || ends.some((value, index) =>
    fixed[index].length > 24 || (value !== 0 && Number(fixed[index]) === 0));
  return ends.map((value, index) => ({ value,
    label: exponential ? value.toExponential().replace("e+", "e") : fixed[index] }));
}

/**
 * `svg.rs` `format_number`, Rust's `{:.decimals$}`. `toFixed` differs from it
 * twice: an exact tie goes up there and to the even digit here, and from 1e21 it
 * turns exponential, where every double is an integer `BigInt` writes in full.
 */
function fixedNumber(value: number, decimals: number): string {
  if (Math.abs(value) >= 1e21) return `${BigInt(value)}${decimals > 0 ? `.${"0".repeat(decimals)}` : ""}`;
  // A hundred places hold every digit of a tie, which ends one place past `decimals`.
  const exact = value.toFixed(100);
  const point = exact.indexOf(".");
  const down = exact.slice(0, decimals > 0 ? point + 1 + decimals : point);
  const tie = /^50*$/u.test(exact.slice(point + 1 + decimals));
  return tie && Number(down.at(-1)) % 2 === 0 ? down : value.toFixed(decimals);
}

/**
 * Writes tick labels into a container that React leaves empty, each at its
 * percentage along the axis. Used for every paint, so a gesture frame and a
 * render put the same labels in the same places. The axis titles have rows of
 * their own, so no label ever gives way to one.
 */
export function paintTicks(container: HTMLElement | null, ticks: readonly AxisTick[], percent: (value: number) => number,
  axis: "x" | "y"): void {
  if (container === null) return;
  container.replaceChildren(...ticks.map(tick => {
    const label = document.createElement("span");
    label.className = "plot-tick";
    label.textContent = tick.label;
    label.style.setProperty(axis === "x" ? "left" : "top", `${percent(tick.value)}%`);
    return label;
  }));
}

/** Light horizontal rules at the given viewBox heights, into a group React leaves empty. */
export function paintGridlines(group: SVGGElement | null, ys: readonly number[], left: number, right: number): void {
  if (group === null) return;
  group.replaceChildren(...ys.map(y => {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(left));
    line.setAttribute("x2", String(right));
    line.setAttribute("y1", String(y));
    line.setAttribute("y2", String(y));
    return line;
  }));
}
