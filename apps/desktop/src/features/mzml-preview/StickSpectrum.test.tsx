/**
 * What the plot caption and its details say about their own drawing.
 *
 * The counts themselves are covered where they are made -- the reduction's
 * bounds and its refusal to lose a point are in `scale.test.tsx` -- so these
 * tests assert only that the sentence agrees with the number it carries, and
 * that the details add only what the caption and the axes cannot say.
 */

import { fireEvent, screen } from "@testing-library/react";
import { renderWithPreferences as render } from "../../test/renderWithPreferences";
import { describe, expect, it } from "vitest";

import { UI_RESOURCES } from "../preferences/i18n";
import { StickSpectrum } from "./StickSpectrum";

const en = UI_RESOURCES.en;

/** One English resource with its values written in, numbers grouped as the runtime groups them. */
function fill(template: string, values: Readonly<Record<string, number>> = {}): string {
  return template.replace(/\{\{\s*(\w+)(?:,\s*number)?\s*\}\}/gu, (_, name: string) => (values[name] ?? NaN).toLocaleString("en-US"));
}

function caption(): string {
  return document.querySelector("figcaption > p")?.textContent ?? "";
}

/** The details disclosure, opened, whether or not it is shown. */
function details(): HTMLDetailsElement {
  const disclosure = screen.getByText("Source and drawing details");
  const element = disclosure.closest("details")!;
  expect(element).not.toHaveAttribute("open");
  fireEvent.click(disclosure);
  return element;
}

function renderSpectrum(mz: readonly number[], intensity: readonly number[], representationKnown = true): void {
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
      representationKnown={representationKnown}
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
  it("says the drawing is grouped when this plot collapsed some observations", () => {
    /*
     * The defect this closes, at the numbers that produced it.
     *
     * Rust's projection budget is 1,800 points and this plot has 900 columns, so
     * a window holding 1,200 same-sign observations comes back *exact* --
     * `reduced` false -- and is collapsed here. Reading Rust's flag, the caption
     * once said every observation was drawn, contradicting its own counts.
     */
    const mz: number[] = [];
    const intensity: number[] = [];
    for (let index = 0; index < 1_200; index += 1) {
      mz.push(100 + index * 0.1);
      intensity.push(10 + (index % 7));
    }
    renderWindow(mz, intensity, { low: 100, high: 219.9, sourcePoints: 1_200, reduced: false });

    expect(caption()).toBe(`${fill(en.plotCaption, { count: 900, total: 1_200 })} · ${en.plotUnits}`);
    const disclosure = details();
    expect(disclosure).toBeVisible();
    expect(disclosure.querySelector("p")).toHaveTextContent(en.plotReduced);
    expect(screen.queryByText(/Every one of them is drawn\./u)).not.toBeInTheDocument();
  });

  it("adds nothing to a caption whose counts already say every observation is drawn", () => {
    renderWindow([100, 110, 120], [5, 9, 7], {
      low: 100,
      high: 120,
      sourcePoints: 3,
      reduced: false,
    });

    expect(caption()).toBe(`${fill(en.plotCaption, { count: 3, total: 3 })} · ${en.plotUnits}`);
    // Hidden rather than opening onto nothing, and no axis restated.
    expect(details()).not.toBeVisible();
    expect(screen.queryByText(/Horizontal axis/u)).not.toBeInTheDocument();
  });

  it("leaves a blank range's state to the status line rather than captioning it", () => {
    // A failed projection is not an outstanding request; the viewport's status
    // line says which it is, so the caption names neither.
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

    expect(caption()).toBe(en.plotUnits);
    expect(screen.queryByText(/Waiting for the drawing/u)).not.toBeInTheDocument();
    expect(details()).not.toBeVisible();
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

    expect(screen.queryByText(en.plotFlat)).not.toBeInTheDocument();
    expect(screen.queryByText(/Vertical axis: intensity/u)).not.toBeInTheDocument();
    // The m/z axis is still the range, because that much the plot does know.
    expect(screen.getByText("300.0000")).toBeInTheDocument();
    expect(screen.getByText("400.0000")).toBeInTheDocument();
  });
});

describe("stick plot caption", () => {
  it("says one stick when the reduction draws one, and that points merged", () => {
    // Two points at the same m/z and the same sign reduce to the column's
    // highest value, which is one stick.
    renderSpectrum([300, 300], [100, 200]);

    expect(caption()).toBe(`${fill(en.plotTransferCaption_one, { total: 2 })} · ${en.plotUnits}`);
    expect(details().querySelector("p")).toHaveTextContent(en.plotTransferReduced);
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

    expect(caption()).toContain(fill(en.plotNegativeCount, { count: 2 }));
    const disclosure = details();
    expect(disclosure).toBeVisible();
    expect(disclosure.querySelector("p")).toHaveTextContent(fill(en.plotNegativeMixed, { count: 1 }));
  });

  it("says so when no negative can be drawn away from the zero line at all", () => {
    // One enormous positive sets the scale, so the only negative collapses onto
    // the zero line and there is nothing below it to point at. Claiming
    // otherwise would send a reader looking for a stick that is not drawn, and
    // let them conclude the drawing disagrees with the measurement.
    renderSpectrum([300, 301], [1e20, -1]);

    expect(caption()).toContain(en.plotNegativeCount_one);
    const text = details().querySelector("p")?.textContent ?? "";
    expect(text).toBe(en.plotNegativeFlat);
    expect(text).not.toContain(en.plotNegativeBelow);
  });

  it("keeps the plural when the reduction draws more than one", () => {
    renderSpectrum([300, 300, 301], [100, 200, 300]);

    expect(caption()).toBe(`${fill(en.plotTransferCaption, { count: 2, total: 3 })} · ${en.plotUnits}`);
    expect(details().querySelector("p")).toHaveTextContent(en.plotTransferReduced);
  });

  it("says one stick for a spectrum drawn one stick per point, and adds nothing", () => {
    renderSpectrum([300], [100]);

    expect(caption()).toBe(`${fill(en.plotTransferCaption_one, { total: 1 })} · ${en.plotUnits}`);
    expect(details()).not.toBeVisible();
  });

  it("discloses an unreported representation even when nothing else needs saying", () => {
    renderSpectrum([300], [100], false);

    const disclosure = details();
    expect(disclosure).toBeVisible();
    expect(disclosure.querySelector("p")?.textContent).toBe(en.plotUnknownRepresentation);
  });
});
