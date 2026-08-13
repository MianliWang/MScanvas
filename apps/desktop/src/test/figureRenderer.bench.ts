/**
 * Developer-only screen-renderer evidence harness.
 *
 * Not part of `pnpm test`: vitest's default run collects `*.test.*`, and this
 * is collected by `vitest bench` instead. It exists to answer what the *screen*
 * costs, which is the half of the renderer decision the Rust harness beside it
 * cannot see.
 *
 * Run it directly:
 *
 * ```text
 * pnpm --filter @mscanvas/desktop exec vitest bench --run
 * ```
 *
 * **What these scenes are.** `StickSpectrum` is the only screen renderer this
 * product has, and it draws sticks for every input -- it takes no plot kind and
 * no representation, only a `representationKnown` boolean that changes the
 * caption. So the scenes below are *point-shape stress inputs to the stick
 * renderer*, not four different screen rendering modes. `chromatogram-100k`
 * measures what 100,000 ordered points cost that renderer; it does **not**
 * measure a chromatogram screen path, because no continuous-trace screen
 * renderer exists yet. Building one is M4.1's slice, not this harness's.
 *
 * Two honest limits, recorded here rather than in the evidence write-up alone:
 *
 * - jsdom lays nothing out and rasterizes nothing, so every duration below is
 *   the cost of *producing* a scene, never of painting one. A real paint cost
 *   can only come from a rendered window.
 * - jsdom has no Canvas2D implementation, so a canvas candidate cannot be
 *   measured here at all. That is why the comparison below is between the
 *   repository-owned SVG component and a DOM-serialization export, and why the
 *   canvas question is answered architecturally rather than by timing.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { bench, describe } from "vitest";

import { StickSpectrum } from "../features/mzml-preview/StickSpectrum";

/**
 * The same linear congruential sequence the Rust harness uses, so both measure
 * the same points rather than two similar-looking clouds.
 */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0xffff_ffff;
  };
}

interface Scene {
  readonly name: string;
  readonly mz: readonly number[];
  readonly intensity: readonly number[];
}

function profileSpectrum(points: number, name: string): Scene {
  const noise = lcg(0x9e37_79b9);
  const mz = new Array<number>(points);
  const intensity = new Array<number>(points);
  for (let index = 0; index < points; index += 1) {
    const value = 200 + index * (1_800 / points);
    let height = -35 + (noise() - 0.5) * 40;
    for (let cluster = 0; cluster < 14; cluster += 1) {
      const centre = 260 + cluster * 118;
      for (let isotope = 0; isotope < 4; isotope += 1) {
        const peak = centre + isotope * 1.003;
        const offset = (value - peak) / 0.012;
        height += (52_000 / (isotope + 1)) * Math.exp(-0.5 * offset * offset);
      }
    }
    mz[index] = value;
    intensity[index] = height;
  }
  return { name, mz, intensity };
}

function centroidSpectrum(points: number): Scene {
  const noise = lcg(0xb529_7a4d);
  const mz = new Array<number>(points);
  const intensity = new Array<number>(points);
  let value = 150;
  for (let index = 0; index < points; index += 1) {
    value += 0.02 + noise() * 0.16;
    mz[index] = value;
    intensity[index] = noise() < 0.04 ? noise() * 90_000 : noise() * 1_400;
  }
  return { name: "centroid-dense-20k", mz, intensity };
}

function chromatogram(points: number): Scene {
  const noise = lcg(0x2545_f491);
  const mz = new Array<number>(points);
  const intensity = new Array<number>(points);
  for (let index = 0; index < points; index += 1) {
    const time = index * (30 / points);
    let height = 400 + 60 * Math.sin(time * 0.4);
    for (const [centre, peak, width] of [
      [6, 9_000, 0.18],
      [11.5, 42_000, 0.09],
      [19, 15_500, 0.25],
    ] as const) {
      const offset = (time - centre) / width;
      height += peak * Math.exp(-0.5 * offset * offset);
    }
    height += (noise() - 0.5) * 220;
    mz[index] = time;
    intensity[index] = height;
  }
  return { name: "chromatogram-100k", mz, intensity };
}

const SCENES: readonly Scene[] = [
  chromatogram(100_000),
  profileSpectrum(60_000, "profile-dense-60k"),
  centroidSpectrum(20_000),
  profileSpectrum(500_000, "transfer-bound-500k"),
];

/**
 * Renders the real component to markup, which is what the screen path costs.
 *
 * `representationKnown: false` throughout, and it changes nothing measured here
 * -- the component draws sticks either way and the flag only selects a caption
 * sentence. It is set to the honest value for synthetic data: nothing reported
 * what these points are.
 */
function renderScene(scene: Scene): string {
  return renderToStaticMarkup(
    createElement(StickSpectrum, {
      mz: scene.mz,
      intensity: scene.intensity,
      reportedMzLow: scene.mz[0] ?? 0,
      reportedMzHigh: scene.mz[scene.mz.length - 1] ?? 1,
      representationKnown: false,
      labelledBy: "bench-heading",
    }),
  );
}

/**
 * A pointer lookup against the *source* domain, which is the semantics the
 * decision criteria require: resolving a pointer against the drawn sample would
 * answer with a point the reduction happened to keep rather than the measured
 * point nearest the cursor.
 */
function nearestSourceIndex(scene: Scene, at: number): number {
  let low = 0;
  let high = scene.mz.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((scene.mz[middle] ?? 0) < at) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  // The search lands on the first sample at or after the cursor, which is the
  // *lower bound* rather than the nearest point: on an irregular m/z axis the
  // sample just before it is often closer. Returning the bound would have made
  // this benchmark time one lookup while claiming another.
  if (low > 0) {
    const before = scene.mz[low - 1] ?? 0;
    const after = scene.mz[low] ?? 0;
    if (at - before <= after - at) {
      return low - 1;
    }
  }
  return low;
}

// Reported once, before the timings, because they are counts rather than
// durations and a benchmark reporter has nowhere to put them.
for (const scene of SCENES) {
  const markup = renderScene(scene);
  const paths = markup.match(/<path/g)?.length ?? 0;
  const elements = (markup.match(/</g)?.length ?? 0) - (markup.match(/<\//g)?.length ?? 0);
  const commands = markup.match(/M[\d.]+ [\d.]+V[\d.]+/g)?.length ?? 0;
  // eslint-disable-next-line no-console
  console.log(
    `${scene.name.padEnd(22)} source=${String(scene.mz.length).padStart(7)} ` +
      `markup_bytes=${String(markup.length).padStart(8)} ` +
      `dom_elements=${String(elements).padStart(4)} ` +
      `path_nodes=${String(paths).padStart(3)} ` +
      `drawn_sticks=${String(commands).padStart(5)}`,
  );
}

/**
 * The export candidate that reuses the screen: serialize the mounted DOM.
 *
 * Measured rather than asserted, because it is the option a reader would
 * reasonably expect to win -- the drawing already exists, so why render it
 * twice? What the numbers below show is what it would actually hand someone.
 */
{
  const scene = SCENES[3] as Scene;
  const host = document.createElement("div");
  host.innerHTML = renderScene(scene);
  const svg = host.querySelector("svg");
  const serialized = svg === null ? "" : new XMLSerializer().serializeToString(svg);
  const sticks = serialized.match(/M[\d.]+ [\d.]+V[\d.]+/g)?.length ?? 0;
  // eslint-disable-next-line no-console
  console.log(
    [
      "",
      "dom-serialization export probe (candidate A), transfer-bound-500k:",
      `  serialized_bytes      = ${String(serialized.length)}`,
      `  source_points         = ${String(scene.mz.length)}`,
      `  exported_points       = ${String(sticks)}`,
      `  exports_full_source   = ${String(sticks === scene.mz.length)}`,
      `  carries_app_classes   = ${String(serialized.includes("class="))}`,
      `  carries_own_colour    = ${String(serialized.includes("stroke=") || serialized.includes("fill="))}`,
      `  has_explicit_size     = ${String(serialized.includes("width=") && serialized.includes("height="))}`,
      `  has_title_or_desc     = ${String(serialized.includes("<title") || serialized.includes("<desc"))}`,
      `  needs_mounted_tree    = true`,
      "",
    ].join("\n"),
  );
}

describe("stick renderer over each point shape", () => {
  for (const scene of SCENES) {
    bench(scene.name, () => {
      renderScene(scene);
    });
  }
});

describe("pointer lookup against the source domain", () => {
  for (const scene of SCENES) {
    bench(scene.name, () => {
      // A sweep rather than one probe: a pointer moving across the plot is what
      // this cost is actually paid for.
      for (let step = 0; step < 200; step += 1) {
        const low = scene.mz[0] ?? 0;
        const high = scene.mz[scene.mz.length - 1] ?? 1;
        nearestSourceIndex(scene, low + ((high - low) * step) / 200);
      }
    });
  }
});
