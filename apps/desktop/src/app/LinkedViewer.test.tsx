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
import type { BackendAvailability } from "../features/mzml-preview/contracts";
import {
  availableBackend,
  buildPreview,
  buildRows,
  createFakePreviewApi,
  createFakeWorkspaceDropTransport,
  selectedFile,
  shimadzuDataset,
  unavailableBackend,
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

/**
 * What the document held at the moment each measurement was appended.
 *
 * `appendMeasurement` runs inside the state updater, which React calls while
 * rendering the commit *after* the one that scheduled it -- so the DOM it can
 * see is the commit the measurement was taken in. That is the one instant at
 * which "was the plot drawn yet" is answerable from outside.
 */
const measuredWith: { readonly name: string; readonly plotDrawn: boolean }[] = [];

vi.mock("../features/mzml-preview/instrumentation", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../features/mzml-preview/instrumentation")>();
  return {
    ...actual,
    appendMeasurement: (
      ...args: Parameters<typeof actual.appendMeasurement>
    ): ReturnType<typeof actual.appendMeasurement> => {
      measuredWith.push({
        name: args[1].name,
        plotDrawn: document.querySelector("path.chromatogram-trace") !== null,
      });
      return actual.appendMeasurement(...args);
    },
  };
});

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

function api(
  options: { readonly availability?: () => Promise<BackendAvailability> } = {},
): ReturnType<typeof createFakePreviewApi> {
  return createFakePreviewApi({
    initialDatasets: [selectedFile, VENDOR_ROW],
    preview: buildPreview(SCAN_COUNT),
    ...(options.availability === undefined ? {} : { availability: options.availability }),
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
  /*
   * Longer than the one-second default, because mounting this document is not
   * one await. The backend verdict, the workspace roster and the native-drop
   * subscription all settle before a row can be activated, and the preview that
   * follows carries the whole spectrum table -- 36,319 rows in one of the cases
   * below. Observed timing out once under load at the default, which is a flake
   * in the harness rather than anything the product did.
   */
  const SETTLING = { timeout: 15_000 } as const;
  fireEvent.click(await screen.findByRole("button", { name: "Preview focused" }, SETTLING));
  await screen.findByRole("grid", { name: "Spectra" }, SETTLING);
  await screen.findByRole("img", { name: "Chromatogram" }, SETTLING);
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
  measuredWith.length = 0;
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

  it("renders the scan steps disabled once the backend is resolved unavailable", async () => {
    /*
     * The rendered end of the affordance rule. The lane matrix beside the hook
     * pins every blocker; this pins that the capability actually reaches the
     * `disabled` attribute of the two buttons the finding was about, with the
     * table still on screen behind them.
     */
    let checks = 0;
    const preview = api({
      availability: () => {
        checks += 1;
        return Promise.resolve(checks === 1 ? availableBackend : unavailableBackend);
      },
    });
    await openTheViewer(preview);
    const grid = screen.getByRole("grid", { name: "Spectra" });
    fireEvent.click(within(grid).getByText("controllerType=0 controllerNumber=1 scan=2"));
    await waitFor(() => {
      expect(selectedRowPosition()).toBe(1);
    });
    await screen.findByRole("img", { name: /^Spectrum 1,/u });
    expect(screen.getByRole("button", { name: "Previous scan" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next scan" })).toBeEnabled();

    fireEvent.click(screen.getAllByRole("button", { name: "Check again" })[0] as HTMLElement);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Next scan" })).toBeDisabled();
    });
    expect(screen.getByRole("button", { name: "Previous scan" })).toBeDisabled();
    // Still there, and still spatially where they were: an action that cannot
    // act right now is disabled rather than removed.
    expect(screen.getByRole("grid", { name: "Spectra" })).toBeVisible();
    expect(selectedRowPosition()).toBe(1);
    expect(preview.requestedSpectra).toEqual([1]);
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

describe("what the open measurement waits for", () => {
  /*
   * `Open to first preview` names the moment the preview is on screen, and the
   * chromatogram is part of what is on screen.
   *
   * The run's domain reaches the interaction in a layout effect, so the commit
   * that first renders a loaded preview draws the plot's placeholder rather than
   * the plot. Nobody sees that -- a layout effect's update is flushed before the
   * browser paints -- but a stopwatch stopped there would time everything except
   * the clipping, the reduction and the path, and would exclude more of them the
   * larger the run, which is the one size where the number is worth having.
   *
   * So the pending measurement is left standing until the plot's own commit.
   * The risk that creates is the opposite one, and it is the one worth testing:
   * a measurement that waits for something never coming is a measurement nobody
   * ever gets.
   */
  function openMeasurement(): string {
    return screen.getByText("Open to first preview").nextElementSibling?.textContent ?? "";
  }

  it("takes it with the plot on screen rather than with its placeholder", async () => {
    const preview = api();
    await openTheViewer(preview);

    expect(screen.getByRole("img", { name: "Chromatogram" })).toBeVisible();
    expect(document.querySelector("path.chromatogram-trace")).not.toBeNull();
    expect(openMeasurement()).not.toBe("Not measured yet");

    // The discriminating half. Stopping the clock in the commit that renders
    // the placeholder would time everything except the drawing -- and would be
    // invisible once everything has settled, which is why this looks at the
    // document as the measurement was appended rather than afterwards.
    const opens = measuredWith.filter((entry) => entry.name === "openToFirstPreview");
    expect(opens.length).toBeGreaterThan(0);
    for (const open of opens) {
      expect(open.plotDrawn, "the trace was not drawn when the open was timed").toBe(true);
    }
  });

  it("still takes it for a preview that has no chromatogram to wait for", async () => {
    /*
     * A truncated table draws no trace at all. Waiting for a plot that is never
     * coming would strand the metric for exactly the previews whose tables are
     * largest -- which is the failure the repair could have introduced, so it is
     * the one pinned here.
     */
    const truncated = createFakePreviewApi({
      initialDatasets: [selectedFile, VENDOR_ROW],
      preview: {
        ...buildPreview(SCAN_COUNT),
        spectrumTable: {
          rows: buildRows(SCAN_COUNT),
          totalRowCount: SCAN_COUNT * 10,
          truncated: true,
        },
      },
    });
    render(
      <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
        <PreviewApiProvider value={truncated}>
          <App />
        </PreviewApiProvider>
      </WorkspaceDropTransportProvider>,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Preview focused" }, { timeout: 15_000 }),
    );
    await screen.findByRole("grid", { name: "Spectra" }, { timeout: 15_000 });

    expect(screen.queryByRole("img", { name: "Chromatogram" })).toBeNull();
    await waitFor(() => {
      expect(openMeasurement()).not.toBe("Not measured yet");
    });
  });

  it("takes it again for the next preview", async () => {
    const preview = api();
    await openTheViewer(preview);
    const first = openMeasurement();
    expect(first).not.toBe("Not measured yet");

    // A second reading of the same row, which is a whole new open.
    fireEvent.click(screen.getByText(VENDOR_ROW.fileName));
    fireEvent.click(screen.getByText(selectedFile.fileName));
    fireEvent.click(screen.getByRole("button", { name: "Preview focused" }));

    await screen.findByRole("img", { name: "Chromatogram" }, { timeout: 15_000 });
    await waitFor(() => {
      expect(openMeasurement()).not.toBe("Not measured yet");
    });
    expect(document.querySelector("path.chromatogram-trace")).not.toBeNull();
  });
});
