/**
 * What the plot caption says about its own drawing.
 *
 * The counts themselves are covered where they are made -- the reduction's
 * bounds and its refusal to lose a point are in `scale.test.tsx` -- so these
 * tests assert only that the sentence agrees with the number it carries.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StickSpectrum } from "./StickSpectrum";

function renderSpectrum(mz: readonly number[], intensity: readonly number[]): void {
  render(
    <StickSpectrum
      intensity={intensity}
      labelledBy="caption-under-test"
      mz={mz}
      representationKnown
      reportedMzHigh={Math.max(...mz)}
      reportedMzLow={Math.min(...mz)}
    />,
  );
}

describe("stick plot caption", () => {
  it("says one stick when the reduction draws one", () => {
    // Two points at the same m/z and the same sign reduce to the column's
    // highest value, which is one stick.
    renderSpectrum([300, 300], [100, 200]);

    expect(screen.getByText(/^Drawn as 1 stick from 2 points,/)).toBeVisible();
  });

  it("keeps the plural when the reduction draws more than one", () => {
    renderSpectrum([300, 300, 301], [100, 200, 300]);

    expect(screen.getByText(/^Drawn as 2 sticks from 3 points,/)).toBeVisible();
  });

  it("says one stick for a spectrum drawn one stick per point", () => {
    renderSpectrum([300], [100]);

    expect(screen.getByText(/^Drawn as 1 stick, one per point\./)).toBeVisible();
  });
});
