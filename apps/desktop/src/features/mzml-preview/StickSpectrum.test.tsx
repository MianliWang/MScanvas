/**
 * What the plot caption and its source sentence (Details → Spectrum source)
 * say about their own drawing.
 *
 * The counts themselves are covered where they are made -- the reduction's
 * bounds and its refusal to lose a point are in `scale.test.tsx` -- so these
 * tests assert only that the sentence agrees with the number it carries, and
 * that the source sentence adds only what the caption and the axes cannot say.
 */

import { screen } from "@testing-library/react";
import { renderWithPreferences as render } from "../../test/renderWithPreferences";
import { describe, expect, it } from "vitest";

import { UI_RESOURCES } from "../preferences/i18n";
import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import type { SpectrumRepresentation } from "./contracts";
import { describeSpectrumSource, StickSpectrum, type SpectrumDrawing } from "./StickSpectrum";

const en = UI_RESOURCES.en;

/** One English resource with its values written in, numbers grouped as the runtime groups them. */
function fill(template: string, values: Readonly<Record<string, number>> = {}): string {
  return template.replace(/\{\{\s*(\w+)(?:,\s*number)?\s*\}\}/gu, (_, name: string) => (values[name] ?? NaN).toLocaleString("en-US"));
}

function caption(): string {
  return document.querySelector("figcaption > p")?.textContent ?? "";
}

/** The plot, and the source sentence Details shows for it (hidden when empty). */
function Plot({ mz, intensity, drawing, representation = "centroid" }: {
  readonly mz: readonly number[]; readonly intensity: readonly number[];
  readonly drawing: SpectrumDrawing; readonly representation?: SpectrumRepresentation;
}) {
  const text = describeSpectrumSource(mz, intensity, drawing, representation, useUiMessages());
  return <>
    <StickSpectrum drawing={drawing} intensity={intensity} labelledBy="caption-under-test" mz={mz} representation={representation}
      surface={{ kind: "static" }} />
    <div className="source-under-test" hidden={text === ""}><p>{text}</p></div>
  </>;
}

/** The source sentence's box, whether or not it is shown. */
function details(): HTMLElement {
  return document.querySelector<HTMLElement>(".source-under-test")!;
}

function renderSpectrum(mz: readonly number[], intensity: readonly number[], representation: SpectrumRepresentation = "centroid"): void {
  render(
    <Plot
      drawing={{
        kind: "transfer",
        reportedMzHigh: Math.max(...mz),
        reportedMzLow: Math.min(...mz),
      }}
      intensity={intensity}
      mz={mz}
      representation={representation}
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
    <Plot
      drawing={{
        kind: "viewport",
        low: window.low,
        high: window.high,
        sourcePoints: window.sourcePoints,
        reduced: window.reduced,
      }}
      intensity={intensity}
      mz={mz}
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

    expect(caption()).toBe(`${fill(en.plotCaption, { count: 900, total: 1_200 })}`);
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

    expect(caption()).toBe(`${fill(en.plotCaption, { count: 3, total: 3 })}`);
    // Hidden rather than opening onto nothing, and no axis restated.
    expect(details()).not.toBeVisible();
    expect(screen.queryByText(/Horizontal axis/u)).not.toBeInTheDocument();
  });

  it("leaves a blank range's state to the status line rather than captioning it", () => {
    // A failed projection is not an outstanding request; the viewport's status
    // line says which it is, so the caption names neither.
    render(<Plot drawing={{ kind: "viewport-blank", low: 300, high: 400, reason: "failed" }} intensity={[]} mz={[]} />);

    expect(caption()).toBe("");
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
        surface={{ kind: "static" }}
      />,
    );

    expect(screen.queryByText(en.plotFlat)).not.toBeInTheDocument();
    expect(screen.queryByText(/Vertical axis: intensity/u)).not.toBeInTheDocument();
    // The m/z axis is still the range, because that much the plot does know,
    // and the value axis has no tick at all.
    expect(screen.getByRole("img")).toHaveAttribute("data-mz-low", "300.0000");
    expect(screen.getByRole("img")).toHaveAttribute("data-mz-high", "400.0000");
    expect(screen.getByText("300")).toBeInTheDocument();
    expect(screen.getByText("400")).toBeInTheDocument();
    expect(document.querySelectorAll(".plot-y-ticks .plot-tick")).toHaveLength(0);
  });

  it("titles each axis with what is known of its unit and ticks it at round values outside the drawing", () => {
    render(<StickSpectrum drawing={{ kind: "viewport", low: 300, high: 302.5, sourcePoints: 3, reduced: false }}
      intensity={[1_000, 2_850, 400]} labelledBy="caption-under-test" mz={[300.4, 301.2, 302.1]} surface={{ kind: "static" }} />);

    // No unit is invented for either axis, and the caption no longer repeats it.
    expect(screen.getByText(en.plotAxisMz)).toBeVisible();
    expect(screen.getByText(en.plotAxisIntensity)).toBeVisible();
    expect(caption()).not.toContain("unit");
    const ticks = (axis: "x" | "y") => [...document.querySelectorAll(`.plot-${axis}-ticks .plot-tick`)].map((node) => node.textContent);
    expect(ticks("x")).toEqual(["300.0", "300.5", "301.0", "301.5", "302.0", "302.5"]);
    // Headroom above the tallest stick, and round values up to it.
    expect(ticks("y")).toEqual(["0", "500", "1000", "1500", "2000", "2500"]);
    // The labels are HTML beside the drawing, so nothing in it is text to stretch.
    expect(document.querySelector("svg text")).toBeNull();
    expect(document.querySelectorAll("svg .plot-gridlines line")).toHaveLength(6);
  });

  it("states each declared unit by its accession, and a flat drawing, in the axis titles", () => {
    render(<StickSpectrum drawing={{ kind: "viewport", low: 300, high: 302, sourcePoints: 2, reduced: false }}
      intensityUnit={{ state: "declared", accession: "MS:1000131" }} mzUnit={{ state: "declared", accession: "MS:1000040" }}
      intensity={[0, 0]} labelledBy="caption-under-test" mz={[300.5, 301.5]} surface={{ kind: "static" }} />);

    expect(screen.getByText(`Intensity (MS:1000131) · ${en.plotFlat}`)).toBeVisible();
    expect(screen.getByText("m/z (MS:1000040)")).toBeVisible();
  });
});

describe("profile line (P175)", () => {
  /** A peak with flanks beyond both edges of the window 150 to 250. */
  const window = (outside: readonly [{ mz: number; intensity: number } | null, { mz: number; intensity: number } | null],
    sourcePoints = 1): SpectrumDrawing => ({ kind: "viewport", low: 150, high: 250, sourcePoints, reduced: false, outside });
  const plot = () => document.querySelector("svg.spectrum-plot");

  it("draws a declared profile spectrum as one joined line, cut at the window's edges", () => {
    render(<Plot drawing={window([{ mz: 100, intensity: 0 }, { mz: 300, intensity: 40 }])} intensity={[80]} mz={[200]}
      representation="profile" />);

    expect(plot()).toHaveAttribute("data-drawn-as", "line");
    expect(document.querySelector(".spectrum-sticks")).toBeNull();
    // Beyond the edge, through the sample, beyond the other edge: the band's clip cuts it at each edge.
    expect(document.querySelector(".spectrum-line")?.getAttribute("d")?.match(/[ML]/gu)).toEqual(["M", "L", "L"]);
    // The edge heights set the scale, as the export's do: 40 at 150, 60 at 250, under the 80 peak.
    expect(plot()).toHaveAttribute("data-value-high", "80.00");
    expect(caption()).toBe(fill(en.plotLineCaption_one, { total: 1 }));
    expect(details()).toHaveTextContent(en.plotProfileLine);
  });

  it("scales a window between two samples to the line's heights at its edges", () => {
    render(<Plot drawing={window([{ mz: 100, intensity: 100 }, { mz: 300, intensity: 0 }], 0)}
      intensity={[]} mz={[]} representation="profile" />);

    expect(plot()).toHaveAttribute("data-drawn-as", "line");
    // 75 at 150 and 25 at 250: the line is drawn, not a blank window.
    expect(plot()).toHaveAttribute("data-value-high", "75.00");
  });

  it("names the line's own reduction rule when Rust reduced the window", () => {
    render(<Plot drawing={window([null, null], 4_000)} intensity={[80, 60]} mz={[200, 220]} representation="profile" />);

    expect(details()).toHaveTextContent(en.plotLineReduced);
    expect(details()).not.toHaveTextContent(en.plotReduced);
  });

  it("keeps centroid and undeclared spectra as sticks", () => {
    for (const representation of ["centroid", "notReported"] as const) {
      const { unmount } = render(<Plot drawing={window([null, null])} intensity={[80]} mz={[200]} representation={representation} />);
      expect(plot()).toHaveAttribute("data-drawn-as", "sticks");
      expect(document.querySelector(".spectrum-line")).toBeNull();
      unmount();
    }
  });

  it("draws a profile spectrum with no viewport as sticks, and says why", () => {
    renderSpectrum([300, 301], [10, 20], "profile");

    expect(plot()).toHaveAttribute("data-drawn-as", "sticks");
    expect(details()).toHaveTextContent(en.plotProfileSticks);
  });

  it.each(["pending", "failed"] as const)("gives no sticks reason while a profile window's drawing is %s", reason => {
    render(<Plot drawing={{ kind: "viewport-blank", low: 150, high: 250, reason }} intensity={[]} mz={[]} representation="profile" />);

    expect(details()).not.toHaveTextContent(en.plotProfileSticks);
    expect(details()).not.toHaveTextContent(en.plotProfileLine);
  });

  it("gives no sticks reason for a profile window holding one sample to join", () => {
    render(<Plot drawing={window([null, null])} intensity={[80]} mz={[200]} representation="profile" />);

    expect(details()).not.toHaveTextContent(en.plotProfileSticks);
  });
});

describe("stick plot caption", () => {
  it("says one stick when the reduction draws one, and that points merged", () => {
    // Two points at the same m/z and the same sign reduce to the column's
    // highest value, which is one stick.
    renderSpectrum([300, 300], [100, 200]);

    expect(caption()).toBe(`${fill(en.plotTransferCaption_one, { total: 2 })}`);
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

    expect(caption()).toBe(`${fill(en.plotTransferCaption, { count: 2, total: 3 })}`);
    expect(details().querySelector("p")).toHaveTextContent(en.plotTransferReduced);
  });

  it("says one stick for a spectrum drawn one stick per point, and adds nothing", () => {
    renderSpectrum([300], [100]);

    expect(caption()).toBe(`${fill(en.plotTransferCaption_one, { total: 1 })}`);
    expect(details()).not.toBeVisible();
  });

  it("discloses an unreported representation even when nothing else needs saying", () => {
    renderSpectrum([300], [100], "notReported");

    const disclosure = details();
    expect(disclosure).toBeVisible();
    expect(disclosure.querySelector("p")?.textContent).toBe(en.plotUnknownRepresentation);
  });
});
