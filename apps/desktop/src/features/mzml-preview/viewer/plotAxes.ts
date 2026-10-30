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
 * below the deepest negative one, never across zero.
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

/**
 * About `target` ticks inside `[low, high]`, at a 1, 2 or 5 step.
 *
 * Inside, never beyond: an axis whose ends were rounded outwards would show a
 * range the reader did not ask for. A range with no width has one tick, at its
 * only value.
 */
export function niceTicks(low: number, high: number, target = 5): readonly AxisTick[] {
  const span = high - low;
  if (!Number.isFinite(low) || !Number.isFinite(high)) return [];
  if (!(span > 0) || !Number.isFinite(span)) return labelTicks([low], 0);
  const base = 10 ** Math.floor(Math.log10(span / target));
  let best = { step: base, first: 0, count: 0 };
  let miss = Infinity;
  // Ascending steps, and a tie goes to the smaller one: seven ticks read a
  // scale better than three.
  for (const factor of [1, 2, 5, 10]) {
    const step = factor * base;
    const first = Math.ceil(low / step - 1e-9);
    const count = Math.floor(high / step + 1e-9) - first + 1;
    if (Math.abs(count - target) < miss) {
      miss = Math.abs(count - target);
      best = { step, first, count };
    }
  }
  const values = Array.from({ length: Math.max(0, best.count) },
    (_, offset) => Number(((best.first + offset) * best.step).toPrecision(12)));
  return labelTicks(values, best.step);
}

/**
 * Each tick at the precision its step needs and no more. Very large or very
 * small values share one exponent, so the labels line up and read as a scale.
 */
function labelTicks(values: readonly number[], step: number): readonly AxisTick[] {
  const largest = Math.max(0, ...values.map(Math.abs));
  const stepPower = step > 0 ? Math.floor(Math.log10(step) + 1e-9) : Math.floor(Math.log10(largest || 1));
  if (largest >= 1e6 || (largest > 0 && largest < 1e-3)) {
    const power = Math.floor(Math.log10(largest) + 1e-9);
    const digits = Math.max(0, power - stepPower);
    return values.map(value => ({ value, label: value === 0 ? "0"
      : `${(value / 10 ** power).toFixed(digits)}e${power < 0 ? "-" : "+"}${Math.abs(power)}` }));
  }
  const decimals = Math.max(0, -stepPower);
  return values.map(value => ({ value, label: value === 0 ? "0" : value.toFixed(decimals) }));
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
