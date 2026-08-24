/**
 * What the run on screen can be exported as, through the shipped composition.
 *
 * Mounted as the document rather than as a harness, because the questions worth
 * asking are about what the workspace hands the panel: which token, which range,
 * which traces, and whether the one scientific export lane is respected. A
 * harness that supplied those itself would be testing the fixture.
 *
 * The one rule under all of it: **nothing here is the science.** Every number
 * this surface sends is a request, and the assertions below are about what
 * crossed the boundary -- never about arrays this document holds.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PreviewApi } from "../features/mzml-preview/api";
import { PreviewApiProvider } from "../features/mzml-preview/api";
import { WorkspaceDropTransportProvider } from "../features/mzml-preview/dropTransport";
import {
  FAKE_COMPLETE_SCAN_COUNT,
  buildPreview,
  createFakePreviewApi,
  createFakeWorkspaceDropTransport,
  selectedFile,
  shimadzuDataset,
} from "../test/previewFixtures";
import { App } from "./App";

/** Enough scans that a range can hold some of them and not others. */
const SCAN_COUNT = 200;
const RT_STEP = 0.0125;
const PLOT_PIXELS = 1_000;
const PADDING_LEFT = 64;
const DRAWN_WIDTH = PLOT_PIXELS - PADDING_LEFT - 12;
const SETTLING = { timeout: 15_000 } as const;

const VENDOR_ROW = shimadzuDataset(1);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function api(
  options: Parameters<typeof createFakePreviewApi>[0] = {},
): ReturnType<typeof createFakePreviewApi> {
  return createFakePreviewApi({
    initialDatasets: [selectedFile, VENDOR_ROW],
    preview: buildPreview(SCAN_COUNT),
    ...options,
  });
}

async function openTheViewer(preview: PreviewApi): Promise<void> {
  render(
    <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
      <PreviewApiProvider value={preview}>
        <App />
      </PreviewApiProvider>
    </WorkspaceDropTransportProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Preview focused" }, SETTLING));
  await screen.findByRole("grid", { name: "Spectra" }, SETTLING);
  await screen.findByRole("img", { name: "Chromatogram" }, SETTLING);
  vi.spyOn(plot(), "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: PLOT_PIXELS,
    bottom: 210,
    width: PLOT_PIXELS,
    height: 210,
    toJSON: () => ({}),
  } as DOMRect);
}

function plot(): HTMLElement {
  return screen.getByRole("img", { name: "Chromatogram" });
}

/** Opens the export surface, which is closed when the viewer opens. */
function openExport(): void {
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
}

/** The chromatogram's own export surface. */
function panel(): HTMLElement {
  const found = document.querySelector("#chromatogram-export-panel");
  if (found === null) {
    throw new Error("the export surface is not open");
  }
  return found as HTMLElement;
}

/**
 * One of this panel's controls.
 *
 * Scoped deliberately: the selected-spectrum panel offers `Export CSV…` too, and
 * a query that could reach either would pass for the wrong reason on the day
 * these two surfaces disagree.
 */
function button(name: string): HTMLButtonElement {
  return within(panel()).getByRole("button", { name }) as HTMLButtonElement;
}

function radio(name: string): HTMLInputElement {
  return within(panel()).getByRole("radio", { name }) as HTMLInputElement;
}

/** What this panel's live region currently says. */
function exportStatus(): string {
  return within(panel()).getByRole("status").textContent ?? "";
}

/** Where a retention time falls in client pixels, for the range on screen. */
function clientXFor(retentionTime: number): number {
  const caption = document.querySelector(".chromatogram-range")?.textContent ?? "";
  const [, low, high] = /Showing ([\d.]+) to ([\d.]+)/u.exec(caption) ?? [];
  const domain = { low: Number(low), high: Number(high) };
  const fraction = (retentionTime - domain.low) / (domain.high - domain.low);
  return PADDING_LEFT + fraction * DRAWN_WIDTH;
}

/** Drags the plot far enough to commit a pan, and settles it. */
function panTo(retentionTime: number): void {
  const from = clientXFor(retentionTime + 20 * RT_STEP);
  const to = clientXFor(retentionTime);
  fireEvent.pointerDown(plot(), { button: 0, clientX: from, clientY: 100, pointerId: 1 });
  fireEvent.pointerMove(plot(), { clientX: to, clientY: 100, pointerId: 1 });
  fireEvent.pointerUp(plot(), { button: 0, clientX: to, clientY: 100, pointerId: 1 });
}

/** The selected spectrum's own panel, which shares the one export lane. */
function spectrumPanel(): HTMLElement {
  const found = document.querySelector("section.spectrum-panel");
  if (found === null) {
    throw new Error("the selected spectrum panel is not on screen");
  }
  return found as HTMLElement;
}

/** One of the selected spectrum's controls, scoped away from this panel's. */
function spectrumButton(name: string): HTMLButtonElement {
  return within(spectrumPanel()).getByRole("button", { name }) as HTMLButtonElement;
}

/** Reads one spectrum, so the other surface has exports to offer. */
async function selectAScan(): Promise<void> {
  const grid = screen.getByRole("grid", { name: "Spectra" });
  const rows = within(grid).getAllByRole("row");
  fireEvent.click(rows[1] as HTMLElement);
  await waitFor(() => {
    expect(within(spectrumPanel()).queryByRole("button", { name: "Copy plot" })).not.toBeNull();
  }, SETTLING);
}

/** Every scientific action the selected spectrum offers. */
const SPECTRUM_ACTIONS = [
  "Export SVG\u2026",
  "Export PNG\u2026",
  "Export CSV\u2026",
  "Export TSV\u2026",
  "Copy plot",
] as const;

/** Every scientific action this panel offers. */
const CHROMATOGRAM_ACTIONS = [
  "Export SVG\u2026",
  "Export PNG\u2026",
  "Export CSV\u2026",
  "Export TSV\u2026",
  "Copy plot",
] as const;

describe("what the chromatogram can be exported as", () => {
  it("offers nothing where the viewer draws no chromatogram", async () => {
    // A truncated table has no chromatogram on screen, and Rust issues no token
    // for one. The export surface is not offered at all rather than offered and
    // refused.
    const truncated = createFakePreviewApi({
      initialDatasets: [selectedFile, VENDOR_ROW],
      preview: buildPreview(SCAN_COUNT, true),
    });
    render(
      <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
        <PreviewApiProvider value={truncated}>
          <App />
        </PreviewApiProvider>
      </WorkspaceDropTransportProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Preview focused" }, SETTLING));
    await screen.findByRole("grid", { name: "Spectra" }, SETTLING);

    expect(screen.queryByRole("img", { name: "Chromatogram" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Export" })).toBeNull();
  });

  it("needs no selected spectrum", async () => {
    // The chromatogram is the run, and the run is loaded. Routing this through
    // the selected-spectrum state would make an export of one thing depend on
    // another thing having been read.
    const preview = api();
    await openTheViewer(preview);
    openExport();

    // Nothing has been selected, so nothing has been read.
    expect(preview.requestedSpectra).toEqual([]);
    expect(button("Export CSV…").disabled).toBe(false);

    fireEvent.click(button("Export CSV…"));

    await waitFor(() => {
      expect(preview.chromatogramExportRequests).toHaveLength(1);
    });
    expect(preview.requestedSpectra).toEqual([]);
  });

  it("sends the token Rust issued, and nothing about the rows", async () => {
    const preview = api();
    await openTheViewer(preview);
    openExport();

    fireEvent.click(button("Export CSV…"));

    await waitFor(() => {
      expect(preview.chromatogramExportRequests).toHaveLength(1);
    });
    const request = preview.chromatogramExportRequests[0];
    expect(request?.exportToken).toBe("chromatogram-token");
    expect(request?.format).toBe("csv");
  });

  it("exports the whole run until another range is chosen", async () => {
    const preview = api();
    await openTheViewer(preview);
    openExport();

    // The opening state, and the one a reader is in before touching the plot.
    expect(radio("Full run").checked).toBe(
      true,
    );
    fireEvent.click(button("Export CSV…"));

    await waitFor(() => {
      expect(preview.chromatogramExportRequests).toHaveLength(1);
    });
    expect(preview.chromatogramExportRequests[0]?.range).toEqual({
      scope: "full",
      low: null,
      high: null,
    });
  });

  it("says a current range is the whole run until the viewport is committed", async () => {
    const preview = await api();
    await openTheViewer(preview);
    openExport();
    fireEvent.click(radio("Current range"));

    expect(
      within(panel()).getByText(
        "Current range is the whole run until the viewport is changed.",
      ),
    ).toBeDefined();

    fireEvent.click(button("Export CSV…"));

    await waitFor(() => {
      expect(preview.chromatogramExportRequests).toHaveLength(1);
    });
    // Null rather than the run's own bounds. Rust resolves it, and this side
    // does not invent a subrange to make the option look different.
    expect(preview.chromatogramExportRequests[0]?.range).toEqual({
      scope: "current",
      low: null,
      high: null,
    });
  });

  it("sends the committed range once the viewport has been moved", async () => {
    const preview = api();
    await openTheViewer(preview);
    // A wheel that settles is a committed viewport.
    act(() => {
      plot().dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 500, deltaY: -500 }),
      );
    });
    await waitFor(() => {
      expect(document.querySelector(".chromatogram-range")?.textContent ?? "").not.toContain(
        "full range",
      );
    });
    openExport();
    fireEvent.click(radio("Current range"));
    // The gesture settles 120ms after the last event, and only then is there a
    // committed range. The panel says which one, so that is what to wait for.
    await waitFor(() => {
      expect(within(panel()).getByText(/^Current range is [\d.]/u)).toBeDefined();
    });

    fireEvent.click(button("Export CSV…"));

    await waitFor(() => {
      expect(preview.chromatogramExportRequests).toHaveLength(1);
    });
    const range = preview.chromatogramExportRequests[0]?.range;
    expect(range?.scope).toBe("current");
    expect(range?.low).not.toBeNull();
    expect(range?.high).not.toBeNull();
    // The committed range, which the caption is also drawn from.
    const caption = document.querySelector(".chromatogram-range")?.textContent ?? "";
    const [, low, high] = /Showing ([\d.]+) to ([\d.]+)/u.exec(caption) ?? [];
    expect(range?.low).toBeCloseTo(Number(low), 3);
    expect(range?.high).toBeCloseTo(Number(high), 3);
  });

  it("ignores a range a gesture is still holding", async () => {
    /*
     * An export invoked mid-gesture writes the last range the user settled on.
     * The transient range is a drawing, not a decision -- and being exported
     * over neither settles the gesture nor cancels it.
     */
    const preview = api();
    await openTheViewer(preview);
    // One committed range to compare against.
    act(() => {
      plot().dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 500, deltaY: -500 }),
      );
    });
    await waitFor(() => {
      expect(document.querySelector(".chromatogram-range")?.textContent ?? "").not.toContain(
        "full range",
      );
    });
    openExport();
    fireEvent.click(radio("Current range"));
    await waitFor(() => {
      expect(within(panel()).getByText(/^Current range is [\d.]/u)).toBeDefined();
    });
    const committed = document.querySelector(".chromatogram-range")?.textContent ?? "";

    // Now a drag that has moved but has not been released.
    const from = clientXFor(50 * RT_STEP);
    fireEvent.pointerDown(plot(), { button: 0, clientX: from, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(plot(), { clientX: from - 60, clientY: 100, pointerId: 1 });
    const transient = document.querySelector(".chromatogram-range")?.textContent ?? "";
    expect(transient).not.toBe(committed);

    fireEvent.click(button("Export CSV…"));

    await waitFor(() => {
      expect(preview.chromatogramExportRequests).toHaveLength(1);
    });
    const range = preview.chromatogramExportRequests[0]?.range;
    const [, low, high] = /Showing ([\d.]+) to ([\d.]+)/u.exec(committed) ?? [];
    expect(range?.low).toBeCloseTo(Number(low), 3);
    expect(range?.high).toBeCloseTo(Number(high), 3);
    // And the gesture is still the user's: releasing it still commits.
    fireEvent.pointerUp(plot(), { button: 0, clientX: from - 60, clientY: 100, pointerId: 1 });
    expect(document.querySelector(".chromatogram-range")?.textContent ?? "").toBe(transient);
  });

  it("sends the traces that are on screen with a figure", async () => {
    const preview = api();
    await openTheViewer(preview);
    // The viewer opens with TIC alone.
    openExport();

    fireEvent.click(button("Export SVG…"));

    await waitFor(() => {
      expect(preview.chromatogramExportRequests).toHaveLength(1);
    });
    expect(preview.chromatogramExportRequests[0]?.traces).toEqual({ tic: true, bpc: false });

    fireEvent.click(screen.getByRole("checkbox", { name: "BPC" }));
    fireEvent.click(button("Export SVG…"));

    await waitFor(() => {
      expect(preview.chromatogramExportRequests).toHaveLength(2);
    });
    expect(preview.chromatogramExportRequests[1]?.traces).toEqual({ tic: true, bpc: true });
  });

  it("closes the figure outputs when neither trace is on screen, and leaves the data", async () => {
    // A panel of no series is refused by the contract, so a figure is not
    // offered. Hiding a trace is a choice about a plot, and the data document
    // carries both measured columns whatever is on screen.
    const preview = api();
    await openTheViewer(preview);
    fireEvent.click(screen.getByRole("checkbox", { name: "TIC" }));
    openExport();

    expect(button("Export SVG…").disabled).toBe(true);
    expect(button("Export PNG…").disabled).toBe(true);
    expect(button("Copy plot").disabled).toBe(true);
    expect(button("Export CSV…").disabled).toBe(false);
    expect(button("Export TSV…").disabled).toBe(false);
    expect(
      within(panel()).getByText("Data exports always include both TIC and BPC source columns."),
    ).toBeDefined();

    fireEvent.click(button("Export TSV…"));
    await waitFor(() => {
      expect(preview.chromatogramExportRequests).toHaveLength(1);
    });
    expect(preview.chromatogramExportRequests[0]?.format).toBe("tsv");
  });

  it("closes the figure outputs when the settings could not draw one", async () => {
    const preview = api();
    await openTheViewer(preview);
    openExport();
    const width = within(panel()).getByLabelText(/Width/u);

    // Empty rather than small: the panel refuses what cannot be a size at all,
    // and Rust refuses what is a size but not one a figure can be drawn at.
    fireEvent.change(width, { target: { value: "" } });

    expect(button("Export SVG…").disabled).toBe(true);
    // A width nobody could draw at says nothing about a list of numbers.
    expect(button("Export CSV…").disabled).toBe(false);
  });

  it("keeps the two panels' settings identifiers apart", async () => {
    // Both export surfaces can be on screen at once. Two elements sharing an
    // id, or two radio groups sharing a name, would leave a label pointing at
    // the wrong control and one theme choice silently changing the other.
    const preview = api();
    await openTheViewer(preview);
    // The other export surface appears once a spectrum has been read, which is
    // the state this rule is about.
    fireEvent.click(within(screen.getByRole("grid", { name: "Spectra" })).getAllByRole("row")[1]!);
    await screen.findByRole("button", { name: "Export SVG…" }, SETTLING);
    openExport();

    const ids = [...document.querySelectorAll("[id]")].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
    const names = [...document.querySelectorAll("input[type=radio]")].map(
      (input) => (input as HTMLInputElement).name,
    );
    expect(names).toContain("chromatogram-figure-theme");
    expect(names).toContain("spectrum-figure-theme");
  });

  it("says what was saved, including a range that held no scans", async () => {
    const preview = api({
      chromatogramExport: () =>
        Promise.resolve({
          status: "saved",
          format: "csv",
          fileName: "mscanvas-chromatogram-current.csv",
          figure: null,
          traces: null,
          rangeScope: "current",
          rangeLow: 4,
          rangeHigh: 5,
          sourceScanCount: FAKE_COMPLETE_SCAN_COUNT,
          // A real answer: the range lies between two scans, and the figure for
          // it still draws the segment crossing it.
          rowCount: 0,
        }),
    });
    await openTheViewer(preview);
    openExport();

    fireEvent.click(button("Export CSV…"));

    await waitFor(() => {
      expect(exportStatus()).toContain("mscanvas-chromatogram-current.csv");
    });
    expect(exportStatus()).toContain("0 source scans");
    expect(exportStatus()).toContain("36,319");
  });

  it("says when an export was cancelled, and when one failed", async () => {
    const cancelled = api({
      chromatogramExport: () => Promise.resolve({ status: "cancelled" }),
    });
    await openTheViewer(cancelled);
    openExport();
    fireEvent.click(button("Export CSV…"));
    await waitFor(() => {
      expect(exportStatus()).toContain("Export cancelled");
    });

    cleanup();

    const failed = api({
      chromatogramExport: () =>
        Promise.reject({
          kind: "chromatogram_range_outside_source",
          summary: "That retention-time range is not inside the run MSCanvas has loaded.",
          detail: null,
          retryable: true,
        }),
    });
    await openTheViewer(failed);
    openExport();
    fireEvent.click(button("Export CSV…"));
    await waitFor(() => {
      expect(exportStatus()).toContain("not inside the run");
    });
  });

  it("holds every scientific export in one lane", async () => {
    /*
     * Rust owns one lane across both surfaces and refuses a second export
     * there. Offering one here while another is running would be offering an
     * action already known to fail.
     */
    let release: (() => void) | null = null;
    const preview = api({
      chromatogramExport: () =>
        new Promise((resolve) => {
          release = () => {
            resolve({ status: "cancelled" });
          };
        }),
    });
    await openTheViewer(preview);
    openExport();

    fireEvent.click(button("Export CSV…"));

    await waitFor(() => {
      expect(button("Export TSV…").disabled).toBe(true);
    });
    expect(button("Export SVG…").disabled).toBe(true);
    expect(button("Copy plot").disabled).toBe(true);

    // A second export while it runs sends nothing, because every other action
    // is closed rather than merely ignored.
    fireEvent.click(button("Export TSV…"));
    expect(preview.chromatogramExportRequests).toHaveLength(1);

    act(() => {
      release?.();
    });
    await waitFor(() => {
      expect(button("Export TSV…").disabled).toBe(false);
    });
  });

  it("copies the plot through the same lane and says what was copied", async () => {
    const preview = api();
    await openTheViewer(preview);
    openExport();

    fireEvent.click(button("Copy plot"));

    await waitFor(() => {
      expect(preview.chromatogramCopyRequests).toHaveLength(1);
    });
    expect(preview.chromatogramCopyRequests[0]?.traces).toEqual({ tic: true, bpc: false });
    await waitFor(() => {
      expect(exportStatus()).toContain("Copied the chromatogram");
    });
  });

  it("keeps the export surface through a vendor row's focus", async () => {
    // Focusing a row this build cannot preview does not close the viewer, so it
    // does not close what the viewer can be exported as either.
    const preview = api();
    await openTheViewer(preview);
    openExport();

    fireEvent.click(screen.getByText(VENDOR_ROW.fileName));

    expect(screen.getByRole("img", { name: "Chromatogram" })).toBeDefined();
    expect(button("Export CSV…").disabled).toBe(false);
    fireEvent.click(button("Export CSV…"));
    await waitFor(() => {
      expect(preview.chromatogramExportRequests).toHaveLength(1);
    });
    expect(preview.chromatogramExportRequests[0]?.exportToken).toBe("chromatogram-token");
  });

  it("adds no height to the viewer while it is closed", async () => {
    // The three-panel column has measured floors and its panels clip, so the
    // control that opens this surface lives in the header row that already
    // exists. Closed, the panel is simply not in the document.
    const preview = api();
    await openTheViewer(preview);

    expect(document.querySelector("#chromatogram-export-panel")).toBeNull();
    expect(screen.getByRole("button", { name: "Export" }).getAttribute("aria-expanded")).toBe(
      "false",
    );

    openExport();

    expect(document.querySelector("#chromatogram-export-panel")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Export" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("closes the selected spectrum's actions while a chromatogram export runs", async () => {
    /*
     * The half Round 2 of M4.3's review found. One lane means both surfaces are
     * unavailable while either owns it -- otherwise a visibly available button
     * reaches Rust and comes back refused, which is a failure this interface
     * caused rather than reported.
     *
     * Both panels stay on screen and stay where they are. Hiding one would move
     * everything below it while a file is being written, and the user has not
     * navigated anywhere.
     */
    let release: (() => void) | null = null;
    const preview = api({
      chromatogramExport: () =>
        new Promise((resolve) => {
          release = () => {
            resolve({ status: "cancelled" });
          };
        }),
    });
    await openTheViewer(preview);
    await selectAScan();
    openExport();

    for (const name of SPECTRUM_ACTIONS) {
      expect(spectrumButton(name).disabled).toBe(false);
    }

    fireEvent.click(button("Export CSV\u2026"));
    await waitFor(() => {
      expect(button("Export TSV\u2026").disabled).toBe(true);
    });

    for (const name of SPECTRUM_ACTIONS) {
      expect(spectrumButton(name).disabled).toBe(true);
    }
    // Present, not hidden, and saying nothing about an export it did not start.
    expect(within(spectrumPanel()).getByRole("status").textContent ?? "").not.toContain(
      "chromatogram",
    );

    act(() => {
      release?.();
    });
    await waitFor(() => {
      expect(spectrumButton("Export CSV\u2026").disabled).toBe(false);
    });
    for (const name of CHROMATOGRAM_ACTIONS) {
      expect(button(name).disabled).toBe(false);
    }
  });

  it("closes this panel's actions while a selected-spectrum export runs", async () => {
    // The other direction of the same lane. Neither surface is the privileged
    // one, and a test that pinned only one of them would let the pair drift.
    let release: (() => void) | null = null;
    const preview = api({
      spectrumExport: () =>
        new Promise((resolve) => {
          release = () => {
            resolve({ status: "cancelled" });
          };
        }),
    });
    await openTheViewer(preview);
    await selectAScan();
    openExport();

    for (const name of CHROMATOGRAM_ACTIONS) {
      expect(button(name).disabled).toBe(false);
    }

    fireEvent.click(spectrumButton("Export CSV\u2026"));
    await waitFor(() => {
      expect(spectrumButton("Export TSV\u2026").disabled).toBe(true);
    });

    for (const name of CHROMATOGRAM_ACTIONS) {
      expect(button(name).disabled).toBe(true);
    }
    // A closed control sends nothing, rather than sending and being ignored.
    fireEvent.click(button("Export TSV\u2026"));
    expect(preview.chromatogramExportRequests).toEqual([]);
    // And this panel is still describing its own range rather than the other
    // surface's export.
    expect(exportStatus()).not.toContain("spectrum");

    act(() => {
      release?.();
    });
    await waitFor(() => {
      expect(button("Export TSV\u2026").disabled).toBe(false);
    });
  });

  it("keeps the settings rules independent of the surface that is not running", async () => {
    // Availability is what the lane shares. An unusable figure size is a fact
    // about a figure, not about the lane: it still closes the figures on both
    // panels and still leaves both panels' data exports open, exactly as before.
    const preview = api();
    await openTheViewer(preview);
    await selectAScan();
    openExport();

    fireEvent.change(within(panel()).getByRole("textbox", { name: /^Width/u }), {
      target: { value: "" },
    });

    await waitFor(() => {
      expect(button("Export SVG\u2026").disabled).toBe(true);
    });
    expect(button("Export CSV\u2026").disabled).toBe(false);
    expect(spectrumButton("Export CSV\u2026").disabled).toBe(false);
    expect(spectrumButton("Export SVG\u2026").disabled).toBe(true);
  });

  it("does not pan on a press the export surface owns", async () => {
    // A guard against the surface being wired into the plot's own gestures:
    // pressing a control in it must not reach the pan adapter.
    const preview = api();
    await openTheViewer(preview);
    openExport();
    const before = document.querySelector(".chromatogram-range")?.textContent ?? "";

    fireEvent.click(radio("Current range"));

    expect(document.querySelector(".chromatogram-range")?.textContent ?? "").toBe(before);
    void panTo;
  });
});
