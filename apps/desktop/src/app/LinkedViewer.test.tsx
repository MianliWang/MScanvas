/**
 * The three linked views, as one document.
 *
 * Each surface is pinned on its own beside its own component. What only this
 * level can answer is whether they agree: whether a click in the plot reaches
 * the table's marker and the spectrum panel, whether a row committed in the
 * table moves the plot's rule, whether committing the same scan again brings a
 * row that was scrolled away back without taking the keyboard from whatever
 * committed it -- and whether any of that costs the backend a request it should
 * not.
 *
 * The last one is the reason this file mounts the shipped composition rather
 * than a harness: "hovering does not re-render the table" is a claim about the
 * props `PreviewWorkspace` hands down, and only the real component hands them.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { memo } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PreviewApi } from "../features/mzml-preview/api";
import { PreviewApiProvider } from "../features/mzml-preview/api";
import { WorkspaceDropTransportProvider } from "../features/mzml-preview/dropTransport";
import type { SpectrumTableProps } from "../features/mzml-preview/SpectrumTable";
import {
  buildPreview,
  buildRows,
  createFakePreviewApi,
  createFakeWorkspaceDropTransport,
  selectedFile,
  shimadzuDataset,
} from "../test/previewFixtures";
import { App } from "./App";

/**
 * How many times the workspace handed the scan table a different set of props.
 *
 * Counted inside a memo boundary, which is what makes it the question worth
 * asking: the count rises only when something the table is actually given
 * changes. A hover that leaked into its props -- or a callback rebuilt on every
 * render -- would show up here immediately.
 */
let tableRenders = 0;

/**
 * How many times the workspace walked the table to find the selected row.
 *
 * `adjacentScan` is linear, because Previous and Next walk the table's own order
 * and nothing promises the indices are a gapless ascending run. That walk must
 * not be on the cursor's path.
 */
let adjacencyWalks = 0;

vi.mock("../features/mzml-preview/viewer/scanModel", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../features/mzml-preview/viewer/scanModel")>();
  return {
    ...actual,
    adjacentScan: (
      ...args: Parameters<typeof actual.adjacentScan>
    ): ReturnType<typeof actual.adjacentScan> => {
      adjacencyWalks += 1;
      return actual.adjacentScan(...args);
    },
  };
});

vi.mock("../features/mzml-preview/SpectrumTable", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../features/mzml-preview/SpectrumTable")>();
  return {
    ...actual,
    SpectrumTable: memo(function CountingSpectrumTable(props: SpectrumTableProps) {
      tableRenders += 1;
      return <actual.SpectrumTable {...props} />;
    }),
  };
});

const VENDOR_ROW = shimadzuDataset(9);
const SCAN_COUNT = 60;
const ROW_HEIGHT = 30;
/** The plot's own width in client pixels, so viewBox units are 1:1 with them. */
const PLOT_PIXELS = 1_000;
const PADDING_LEFT = 64;
const DRAWN_WIDTH = PLOT_PIXELS - PADDING_LEFT - 12;
/** `buildRows` places scan n at n × 0.0125. */
const RT_STEP = 0.0125;

function api(): ReturnType<typeof createFakePreviewApi> {
  return createFakePreviewApi({
    initialDatasets: [selectedFile, VENDOR_ROW],
    preview: buildPreview(SCAN_COUNT),
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
  fireEvent.click(await screen.findByRole("button", { name: "Preview focused" }));
  await screen.findByRole("grid", { name: "Spectra" });
  await screen.findByRole("img", { name: "Chromatogram" });
  givePlotABox();
}

function plot(): HTMLElement {
  return screen.getByRole("img", { name: "Chromatogram" });
}

function givePlotABox(): void {
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

/** Where a retention time falls in client pixels, for the range on screen. */
function clientXFor(retentionTime: number): number {
  const caption = document.querySelector(".chromatogram-range")?.textContent ?? "";
  const [, low, high] = /Showing ([\d.]+) to ([\d.]+)/u.exec(caption) ?? [];
  const domain = { low: Number(low), high: Number(high) };
  const fraction = (retentionTime - domain.low) / (domain.high - domain.low);
  return PADDING_LEFT + fraction * DRAWN_WIDTH;
}

function clickThePlotAt(retentionTime: number): void {
  const at = clientXFor(retentionTime);
  fireEvent.pointerDown(plot(), { button: 0, clientX: at, pointerId: 1 });
  fireEvent.pointerUp(plot(), { button: 0, clientX: at, pointerId: 1 });
}

function selectedRowPosition(): number | null {
  const row = document.querySelector('div.spectrum-table-row[aria-selected="true"]');
  const position = row?.getAttribute("data-row-position");
  return position === undefined || position === null ? null : Number(position);
}

function tableViewport(): HTMLElement {
  const viewport = document.querySelector<HTMLElement>(".spectrum-table-viewport");
  if (viewport === null) {
    throw new Error("no scan table");
  }
  return viewport;
}

function scrollTableTo(scrollTop: number): void {
  fireEvent.scroll(tableViewport(), { target: { scrollTop } });
}

function readout(): string {
  return document.querySelector("#chromatogram-readout")?.textContent ?? "";
}

function rangeCaption(): string {
  return document.querySelector(".chromatogram-range")?.textContent ?? "";
}

function spanOf(caption: string): number {
  const [, low, high] = /Showing ([\d.]+) to ([\d.]+)/u.exec(caption) ?? [];
  return Number(high) - Number(low);
}

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
  tableRenders = 0;
  adjacencyWalks = 0;
});

describe("the linked viewer", () => {
  it("carries a click in the plot to the table, the spectrum and the marker", async () => {
    const preview = api();
    await openTheViewer(preview);

    clickThePlotAt(30 * RT_STEP);

    await waitFor(() => {
      expect(selectedRowPosition()).toBe(30);
    });
    expect(preview.requestedSpectra).toEqual([30]);
    expect(document.querySelector("g.chromatogram-selected")).not.toBeNull();
    await screen.findByRole("img", { name: /^Spectrum 30,/u });
  });

  it("carries a table selection to the plot's marker", async () => {
    const preview = api();
    await openTheViewer(preview);

    const grid = screen.getByRole("grid", { name: "Spectra" });
    fireEvent.click(
      within(grid).getByText("controllerType=0 controllerNumber=1 scan=5"),
    );

    await waitFor(() => {
      expect(readout()).toMatch(/^Selected index 4,/u);
    });
    expect(document.querySelector("g.chromatogram-selected")).not.toBeNull();
    expect(preview.requestedSpectra).toEqual([4]);
  });

  it("brings a row that was scrolled away back when the same scan is committed again", async () => {
    // A selection is an event. The user who selected a scan, scrolled its row
    // out of view and asked for that scan again was asking to be shown it.
    const preview = api();
    await openTheViewer(preview);
    clickThePlotAt(30 * RT_STEP);
    await waitFor(() => {
      expect(selectedRowPosition()).toBe(30);
    });
    await screen.findByRole("img", { name: /^Spectrum 30,/u });

    scrollTableTo(0);
    clickThePlotAt(30 * RT_STEP);

    await waitFor(() => {
      expect(tableViewport().scrollTop).toBeGreaterThan(0);
    });
    // Row 30 sits at canvas offset 900, and the fallback viewport leaves 570px
    // for rows, so the least scroll that shows all of it is 360.
    expect(tableViewport().scrollTop).toBe(30 * ROW_HEIGHT + ROW_HEIGHT - 570);
    expect(preview.requestedSpectra).toEqual([30, 30]);
  });

  it("does not take the keyboard away from the control that committed the selection", async () => {
    const preview = api();
    await openTheViewer(preview);
    const grid = screen.getByRole("grid", { name: "Spectra" });
    fireEvent.click(
      within(grid).getByText("controllerType=0 controllerNumber=1 scan=1"),
    );
    await waitFor(() => {
      expect(selectedRowPosition()).toBe(0);
    });
    await screen.findByRole("img", { name: /^Spectrum 0,/u });

    const next = screen.getByRole("button", { name: "Next scan" });
    next.focus();
    fireEvent.click(next);

    await waitFor(() => {
      expect(selectedRowPosition()).toBe(1);
    });
    expect(document.activeElement).toBe(next);
  });

  it("reveals a marker panned out of view without giving up the span the user chose", async () => {
    const preview = api();
    await openTheViewer(preview);
    const grid = screen.getByRole("grid", { name: "Spectra" });
    fireEvent.click(
      within(grid).getByText("controllerType=0 controllerNumber=1 scan=30"),
    );
    await waitFor(() => {
      expect(readout()).toMatch(/^Selected index 29,/u);
    });
    await screen.findByRole("img", { name: /^Spectrum 29,/u });

    // Zoom to the start of the run, which leaves the marker off screen.
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    fireEvent.keyDown(plot(), { key: "ArrowLeft" });
    fireEvent.keyDown(plot(), { key: "ArrowLeft" });
    fireEvent.keyDown(plot(), { key: "ArrowLeft" });
    fireEvent.keyDown(plot(), { key: "ArrowLeft" });
    const zoomed = rangeCaption();
    const span = spanOf(zoomed);
    expect(span).toBeGreaterThan(0);
    expect(span).toBeLessThan((SCAN_COUNT - 1) * RT_STEP);

    // Commit the same scan again from the table, which is a new commit.
    fireEvent.click(
      within(grid).getByText("controllerType=0 controllerNumber=1 scan=30"),
    );

    await waitFor(() => {
      expect(rangeCaption()).not.toBe(zoomed);
    });
    // Moved the least it could, and kept the width the user chose rather than
    // resetting the zoom. Compared at the caption's own resolution: it renders
    // four decimals, so two endpoints that moved by the same amount can round
    // a ten-thousandth apart.
    expect(spanOf(rangeCaption())).toBeCloseTo(span, 3);
    expect(rangeCaption()).not.toContain("full range");
  });

  it("does not pull a pan back once the same commit has been acted on", async () => {
    const preview = api();
    await openTheViewer(preview);
    const grid = screen.getByRole("grid", { name: "Spectra" });
    fireEvent.click(
      within(grid).getByText("controllerType=0 controllerNumber=1 scan=1"),
    );
    await waitFor(() => {
      expect(readout()).toMatch(/^Selected index 0,/u);
    });

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    fireEvent.keyDown(plot(), { key: "ArrowRight" });
    fireEvent.keyDown(plot(), { key: "ArrowRight" });
    const panned = rangeCaption();

    // A render that changes nothing about the selection: toggling a trace.
    fireEvent.click(screen.getByRole("checkbox", { name: /BPC/u }));

    expect(rangeCaption()).toBe(panned);
  });

  it("moves table focus with the arrows without reading a spectrum", async () => {
    // Load-bearing: selection-following-focus would launch one ProteoWizard
    // process per key press.
    const preview = api();
    await openTheViewer(preview);
    const grid = screen.getByRole("grid", { name: "Spectra" });
    within(grid).getAllByRole("row")[1]?.focus();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "ArrowDown" });

    expect(preview.requestedSpectra).toEqual([]);
    expect(selectedRowPosition()).toBeNull();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Enter" });

    await waitFor(() => {
      expect(selectedRowPosition()).toBe(2);
    });
    expect(preview.requestedSpectra).toEqual([2]);
  });

  it("steps through scans in table order with Previous and Next", async () => {
    const preview = api();
    await openTheViewer(preview);
    expect(screen.getByRole("button", { name: "Previous scan" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next scan" })).toBeDisabled();

    clickThePlotAt(10 * RT_STEP);
    await waitFor(() => {
      expect(selectedRowPosition()).toBe(10);
    });
    await screen.findByRole("img", { name: /^Spectrum 10,/u });

    fireEvent.click(screen.getByRole("button", { name: "Next scan" }));
    await waitFor(() => {
      expect(selectedRowPosition()).toBe(11);
    });
    await screen.findByRole("img", { name: /^Spectrum 11,/u });

    fireEvent.click(screen.getByRole("button", { name: "Previous scan" }));
    await waitFor(() => {
      expect(selectedRowPosition()).toBe(10);
    });
    expect(preview.requestedSpectra).toEqual([10, 11, 10]);
  });

  it("leaves the loaded viewer exactly as it was when a vendor row takes focus", async () => {
    const preview = api();
    await openTheViewer(preview);
    clickThePlotAt(20 * RT_STEP);
    await waitFor(() => {
      expect(selectedRowPosition()).toBe(20);
    });
    await screen.findByRole("img", { name: /^Spectrum 20,/u });
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    const range = rangeCaption();
    const marker = readout();
    const calls = preview.calls().length;

    fireEvent.click(screen.getByText(VENDOR_ROW.fileName));

    expect(plot()).toBeVisible();
    expect(rangeCaption()).toBe(range);
    expect(readout()).toBe(marker);
    expect(selectedRowPosition()).toBe(20);
    expect(preview.requestedSpectra).toEqual([20]);
    // Focusing a row is a workspace action with its own commands. What must not
    // happen is the viewer being re-read.
    expect(preview.calls().length).toBe(calls);
  });
});

describe("what a moving pointer costs", () => {
  it("re-renders nothing linked while the pointer stays over one scan", async () => {
    const preview = api();
    await openTheViewer(preview);
    // A run of 60 scans over 924 drawn pixels puts roughly 15 pixels between
    // neighbours, so these frames all resolve to the same one.
    fireEvent.pointerMove(plot(), { clientX: clientXFor(30 * RT_STEP) });
    const settled = tableRenders;
    const reported = readout();

    act(() => {
      for (let offset = -4; offset <= 4; offset += 1) {
        fireEvent.pointerMove(plot(), { clientX: clientXFor(30 * RT_STEP) + offset });
      }
    });

    expect(tableRenders).toBe(settled);
    expect(readout()).toBe(reported);
    expect(preview.requestedSpectra).toEqual([]);
  });

  it("re-renders nothing linked when the pointer crosses into another scan either", async () => {
    // Crossing a scan is a real state change, and the readout follows it. What
    // must not follow is the virtualized table: the run's scans outnumber the
    // plot's pixels, so at a full-run zoom nearly every pointer frame crosses
    // one.
    const preview = api();
    await openTheViewer(preview);
    fireEvent.pointerMove(plot(), { clientX: clientXFor(10 * RT_STEP) });
    const settled = tableRenders;

    act(() => {
      for (let scan = 11; scan < 30; scan += 1) {
        fireEvent.pointerMove(plot(), { clientX: clientXFor(scan * RT_STEP) });
      }
    });

    expect(readout()).toMatch(/^Hovering index 29,/u);
    expect(tableRenders).toBe(settled);
    expect(preview.requestedSpectra).toEqual([]);
  });

  it("does not walk the table to find the selected row on the cursor's path", async () => {
    /*
     * A hover crossing re-renders the workspace, and the workspace is where
     * Previous and Next resolve their neighbours -- a linear walk each, over a
     * table that can hold tens of thousands of rows, with the worst case being
     * a scan selected near the end. Neither input changes on a hover, so the
     * answer is memoized and this count must not move.
     */
    const preview = api();
    await openTheViewer(preview);
    const grid = screen.getByRole("grid", { name: "Spectra" });
    fireEvent.click(within(grid).getByText("controllerType=0 controllerNumber=1 scan=1"));
    await waitFor(() => {
      expect(selectedRowPosition()).toBe(0);
    });
    await screen.findByRole("img", { name: /^Spectrum 0,/u });
    const settled = adjacencyWalks;

    act(() => {
      for (let scan = 5; scan < 40; scan += 1) {
        fireEvent.pointerMove(plot(), { clientX: clientXFor(scan * RT_STEP) });
      }
    });

    expect(readout()).toMatch(/^Hovering index 39,/u);
    expect(adjacencyWalks).toBe(settled);
  });

  it("asks the backend for nothing while the viewport moves", async () => {
    const preview = api();
    await openTheViewer(preview);
    const calls = preview.calls().length;

    fireEvent.wheel(plot(), { clientX: 500, deltaY: -240 });
    fireEvent.pointerMove(plot(), { clientX: 500 });
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset range" }));
    fireEvent.keyDown(plot(), { key: "ArrowRight" });

    expect(preview.calls().length).toBe(calls);
  });

  it("keeps the table windowed and the trace bounded at acquisition scale", async () => {
    // The measured representative acquisition has 36,319 spectra.
    const scans = 36_319;
    const preview = createFakePreviewApi({
      initialDatasets: [selectedFile],
      preview: {
        ...buildPreview(1),
        spectrumTable: { rows: buildRows(scans), totalRowCount: scans, truncated: false },
      },
    });
    await openTheViewer(preview);

    const grid = screen.getByRole("grid", { name: "Spectra" });
    expect(within(grid).getAllByRole("row").length).toBeLessThan(100);
    const paths = document.querySelectorAll("path.chromatogram-trace");
    expect(paths).toHaveLength(1);
    expect(document.querySelectorAll("svg.chromatogram-svg circle")).toHaveLength(0);
    const vertices = (paths[0]?.getAttribute("d") ?? "").split(/[ML]/u).length - 1;
    expect(vertices).toBeLessThanOrEqual(3_600);

    // And a click still resolves against every scan rather than the 3,600 that
    // were drawn.
    clickThePlotAt(12_345 * RT_STEP);
    await waitFor(() => {
      expect(preview.requestedSpectra).toEqual([12_345]);
    });
  });
});
