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

/** The same plot, drawn as one committed window of a retained spectrum. */
function renderWindow(
  mz: readonly number[],
  intensity: readonly number[],
  window: { readonly low: number; readonly high: number; readonly sourcePoints: number; readonly reduced: boolean },
): void {
  render(
    <StickSpectrum
      drawing={{
        kind: "viewport",
        low: window.low,
        high: window.high,
        sourcePoints: window.sourcePoints,
        reduced: window.reduced,
      }}
      intensity={intensity}
      labelledBy="caption-under-test"
      mz={mz}
      representationKnown
      surface={{ kind: "static" }}
    />,
  );
}

describe("what a window's caption may claim about it", () => {
  it("does not say every observation is drawn when this plot collapsed some", () => {
    /*
     * The defect this closes, at the numbers that produced it.
     *
     * Rust's projection budget is 1,800 points and this plot has 900 columns, so
     * a window holding 1,200 same-sign observations comes back *exact* --
     * `reduced` false -- and is collapsed here. Reading Rust's flag, the caption
     * said "Drawn as 900 sticks of the 1,200 observations ... Every one of them
     * is drawn", contradicting its own first sentence, on the plot's visible
     * caption and in its accessible description at once.
     */
    const mz: number[] = [];
    const intensity: number[] = [];
    for (let index = 0; index < 1_200; index += 1) {
      mz.push(100 + index * 0.1);
      intensity.push(10 + (index % 7));
    }
    renderWindow(mz, intensity, { low: 100, high: 219.9, sourcePoints: 1_200, reduced: false });

    expect(screen.getByText(/^Drawn as 900 sticks of the 1,200 observations/u)).toBeVisible();
    expect(screen.queryByText(/Every one of them is drawn\./u)).not.toBeInTheDocument();
    expect(
      screen.getByText(/groups observations by screen column/u),
    ).toBeVisible();
    // And it does not blame a shortage of columns, which for 1,200 observations
    // happens to be true and for most windows is not.
    expect(
      screen.queryByText(/More were measured here than this drawing has columns/u),
    ).not.toBeInTheDocument();
  });

  it("says every observation is drawn when this plot drew every one", () => {
    renderWindow([100, 110, 120], [5, 9, 7], {
      low: 100,
      high: 120,
      sourcePoints: 3,
      reduced: false,
    });

    expect(
      screen.getByText(
        /^Drawn as 3 sticks of the 3 observations this spectrum has between m\/z 100\.0000 and 120\.0000\. Every one of them is drawn\./u,
      ),
    ).toBeVisible();
  });

  it("says a range could not be drawn rather than that its drawing is on its way", () => {
    // A failed projection is not an outstanding request, and for one that cannot
    // be retried the "waiting" sentence would never go away.
    render(
      <StickSpectrum
        drawing={{ kind: "viewport-blank", low: 300, high: 400, reason: "failed" }}
        intensity={[]}
        labelledBy="caption-under-test"
        mz={[]}
        representationKnown
        surface={{ kind: "static" }}
      />,
    );

    expect(screen.getByText(/^This range could not be drawn\. Nothing is drawn here\./u)).toBeVisible();
    expect(screen.queryByText(/Waiting for the drawing/u)).not.toBeInTheDocument();
  });

  it("claims nothing about intensity over a plot that holds none", () => {
    /*
     * With nothing drawn the value extent is zero to zero, so the axis label
     * used to read "every intensity is the same" -- a statement about
     * measurements, shown identically while a drawing was outstanding, after one
     * had failed, and for a window that truthfully holds no measured point.
     */
    render(
      <StickSpectrum
        drawing={{ kind: "viewport-blank", low: 300, high: 400, reason: "pending" }}
        intensity={[]}
        labelledBy="caption-under-test"
        mz={[]}
        representationKnown
        surface={{ kind: "static" }}
      />,
    );

    expect(screen.queryByText("every intensity is the same")).not.toBeInTheDocument();
    expect(screen.queryByText(/Vertical axis: intensity/u)).not.toBeInTheDocument();
    // The m/z axis is still the range, because that much the plot does know.
    expect(screen.getByText("300.0000")).toBeInTheDocument();
    expect(screen.getByText("400.0000")).toBeInTheDocument();
  });
});

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
