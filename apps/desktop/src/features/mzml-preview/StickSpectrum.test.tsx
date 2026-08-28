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
      drawing={{
        kind: "transfer",
        reportedMzHigh: Math.max(...mz),
        reportedMzLow: Math.min(...mz),
      }}
      intensity={intensity}
      labelledBy="caption-under-test"
      mz={mz}
      representationKnown
      surface={{ kind: "static" }}
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

  it("does not claim a negative is below the line when it is drawn on it", () => {
    // A value range wide enough that the smaller negative cannot be held apart
    // from zero at two decimals. It is a real measurement and it is disclosed
    // as one -- but the sentence that used to follow claimed the drawing shows
    // it below the zero line, and the drawing shows it *on* the line with no
    // length at all. This is the screen half of M4.1-BLOCKER-A: a reader who
    // compares the panel against an exported figure must not be told two
    // different things about the same measurement.
    renderSpectrum([300, 301], [-1e20, -1]);

    expect(screen.getByText(/2 of the points carry negative intensity\./)).toBeVisible();
    expect(
      screen.getByText(
        /The deepest negative in 1 of the columns is drawn below the zero line; in the rest the value range is too wide/,
      ),
    ).toBeVisible();
  });

  it("says so when no negative can be drawn away from the zero line at all", () => {
    // One enormous positive sets the scale, so the only negative collapses onto
    // the zero line and there is nothing below it to point at. Claiming
    // otherwise would send a reader looking for a stick that is not drawn, and
    // let them conclude the drawing disagrees with the measurement.
    renderSpectrum([300, 301], [1e20, -1]);

    expect(screen.getByText(/1 of the points carries negative intensity\./)).toBeVisible();
    expect(
      screen.getByText(
        /too wide to hold them apart from zero at this size, so they are drawn on the zero line without a length rather than below it\./,
      ),
    ).toBeVisible();
    expect(screen.queryByText(/is drawn below the zero line/)).toBeNull();
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
