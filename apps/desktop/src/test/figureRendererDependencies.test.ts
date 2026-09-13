/**
 * What the renderer decision costs the shipped bundle, pinned.
 *
 * ADR 0028 selects an architecture whose screen half is repository-owned and
 * whose export half runs in Rust, so the accepted answer adds **no** frontend
 * production dependency at all. That is a measured decision rather than a
 * preference, and this is where it stops being a sentence in a document.
 *
 * A future milestone may well decide differently. This is not a ban: it is a
 * requirement that the change be deliberate, because adding a charting library
 * to the production surface is exactly the kind of edit that arrives as a
 * transitive convenience and is noticed a release later.
 */

import { describe, expect, it } from "vitest";

import manifest from "../../package.json";

/**
 * The libraries a chart-shaped dependency would most plausibly arrive as.
 *
 * Measured during the M4.0 spike rather than guessed at: each was a real
 * candidate or a transitive component of one.
 */
const CHARTING_PACKAGES = [
  "@observablehq/plot",
  "uplot",
  "uplot-react",
  "echarts",
  "chart.js",
  "plotly.js",
  "plotly.js-basic-dist",
  "recharts",
  "victory",
  "@visx/xychart",
  "d3",
  "d3-scale",
  "d3-shape",
  "d3-array",
];

describe("the figure renderer decision's dependency cost", () => {
  it("retains the approved frontend dependency set, including M7.1 Settings and M7.2 organization", () => {
    // The exact set, not a subset check. A production dependency that arrived
    // without a decision is the thing worth failing on, whatever it is called.
    expect(Object.keys(manifest.dependencies).sort()).toEqual([
      "@dnd-kit/dom",
      "@dnd-kit/helpers",
      "@dnd-kit/react",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@tauri-apps/api",
      "i18next",
      "motion",
      "react",
      "react-dom",
      "react-i18next",
    ]);
    expect(manifest.dependencies["@radix-ui/react-dialog"]).toBe("1.1.23");
    expect(manifest.dependencies.i18next).toBe("26.4.2");
    expect(manifest.dependencies["react-i18next"]).toBe("17.0.13");
    expect(manifest.dependencies.motion).toBe("13.2.0");
    for (const name of ["@dnd-kit/react", "@dnd-kit/dom", "@dnd-kit/helpers"] as const) expect(manifest.dependencies[name]).toBe("0.5.0");
    expect(manifest.dependencies["@radix-ui/react-dropdown-menu"]).toBe("2.1.24");
  });

  it("carries no charting library, in production or in development", () => {
    const declared = new Set([
      ...Object.keys(manifest.dependencies),
      ...Object.keys(manifest.devDependencies),
    ]);
    const found = CHARTING_PACKAGES.filter((name) => declared.has(name));

    expect(found).toEqual([]);
  });
});
