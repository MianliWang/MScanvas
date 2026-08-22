import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PreviewApi } from "../features/mzml-preview/api";
import { PreviewApiProvider } from "../features/mzml-preview/api";
import { WorkspaceDropTransportProvider } from "../features/mzml-preview/dropTransport";
import type { SelectedFile, SelectedSpectrumOutcome } from "../features/mzml-preview/contracts";
import {
  availableBackend,
  buildPreview,
  buildSpectrum,
  createFakePreviewApi,
  createFakeWorkspaceDropTransport,
  deferred,
  secondFile,
  selectedFile,
  shimadzuDataset,
} from "../test/previewFixtures";
import { App } from "./App";

/**
 * The linked viewer, end to end through the real workspace state.
 *
 * The component tests beside this one pin what each surface does with the props
 * it is given. What is only visible here is that there is **one** selected
 * scan: a click in the chromatogram, a click in the table and Previous/Next all
 * arrive at the same `selectSpectrum`, and every surface renders that one
 * answer rather than keeping a selection of its own.
 */

const PLOT_WIDTH = 1_000;
const PADDING_LEFT = 64;
const PADDING_RIGHT = 12;

function renderApp(api: PreviewApi): void {
  render(
    <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
      <PreviewApiProvider value={api}>
        <App />
      </PreviewApiProvider>
    </WorkspaceDropTransportProvider>,
  );
}

async function openTheFile(api: PreviewApi): Promise<void> {
  renderApp(api);
  fireEvent.click(await screen.findByRole("button", { name: "Add files…" }));
  await screen.findByRole("grid", { name: "Spectra" });
}

function plot(): HTMLElement {
  return screen.getByRole("img", { name: "Chromatogram" });
}

/** Gives the plot a real box, which jsdom does not. */
function givePlotABox(): void {
  vi.spyOn(plot(), "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: PLOT_WIDTH,
    bottom: 200,
    width: PLOT_WIDTH,
    height: 200,
    toJSON: () => ({}),
  } as DOMRect);
}

/** Clicks the plot at the retention time of one fixture row. */
function clickScan(index: number, rowCount: number): void {
  const high = (rowCount - 1) * 0.0125;
  const fraction = high === 0 ? 0 : (index * 0.0125) / high;
  const clientX = PADDING_LEFT + fraction * (PLOT_WIDTH - PADDING_LEFT - PADDING_RIGHT);
  fireEvent.pointerDown(plot(), { clientX, button: 0, pointerId: 1 });
  fireEvent.pointerUp(plot(), { clientX, button: 0, pointerId: 1 });
}

/** How wide a "Showing a to b" caption says the viewport is. */
function spanOf(caption: string): number {
  const [, low, high] = /Showing ([\d.]+) to ([\d.]+)/u.exec(caption) ?? [];
  return Number(high) - Number(low);
}

function rowFor(index: number): HTMLElement {
  const grid = screen.getByRole("grid", { name: "Spectra" });
  return within(grid).getByText(`controllerType=0 controllerNumber=1 scan=${String(index + 1)}`)
    .closest("[data-row-position]") as HTMLElement;
}

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("the chromatogram selects a scan", () => {
  it("commits one selection that every linked surface then shows", async () => {
    const api = createFakePreviewApi();
    await openTheFile(api);
    givePlotABox();

    clickScan(3, 6);

    // One backend read, for the scan that was pointed at.
    await waitFor(() => {
      expect(api.requestedSpectra).toEqual([3]);
    });
    // The table row is the selected one.
    await waitFor(() => {
      expect(rowFor(3)).toHaveAttribute("aria-selected", "true");
    });
    // The chromatogram marks it, and says which scan in words.
    expect(document.querySelector("g.chromatogram-selected")).not.toBeNull();
    expect(screen.getByText(/Selected index 3, scan 4/u)).toBeVisible();
    // And the spectrum panel is showing it.
    expect(await screen.findByRole("img", { name: /^Spectrum 3,/u })).toBeVisible();
  });

  it("does not select anything merely because a pointer crossed the plot", async () => {
    const api = createFakePreviewApi();
    await openTheFile(api);
    givePlotABox();

    for (const clientX of [200, 300, 400, 500, 600]) {
      fireEvent.pointerMove(plot(), { clientX });
    }
    await act(async () => {
      await Promise.resolve();
    });

    expect(api.requestedSpectra).toEqual([]);
    expect(screen.queryByText(/^Selected index/u)).toBeNull();
  });
});

describe("the table selects a scan", () => {
  it("moves the chromatogram marker when a row is clicked", async () => {
    const api = createFakePreviewApi();
    await openTheFile(api);

    fireEvent.click(rowFor(4));

    await waitFor(() => {
      expect(screen.getByText(/Selected index 4, scan 5/u)).toBeVisible();
    });
    expect(api.requestedSpectra).toEqual([4]);
  });

  it("moves the marker when a row is committed with Enter", async () => {
    const api = createFakePreviewApi();
    await openTheFile(api);

    const row = rowFor(2);
    row.focus();
    fireEvent.keyDown(row, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText(/Selected index 2, scan 3/u)).toBeVisible();
    });
  });

  it("moves focus with the arrow keys without reading a spectrum", async () => {
    // Load-bearing: selection-following-focus would launch one ProteoWizard
    // process per arrow key. The marker must not move either, because nothing
    // has been selected.
    const api = createFakePreviewApi();
    await openTheFile(api);

    const row = rowFor(0);
    row.focus();
    fireEvent.keyDown(row, { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "ArrowDown" });
    await act(async () => {
      await Promise.resolve();
    });

    expect(api.requestedSpectra).toEqual([]);
    expect(screen.queryByText(/^Selected index/u)).toBeNull();
  });
});

describe("a selection from outside the table", () => {
  it("reveals the row without taking focus away from the plot", async () => {
    // The row has to become visible -- a marker pointing at a scan the table is
    // not showing is a link the user cannot follow. But focus must stay where
    // the user is working, or their next key press goes somewhere they did not
    // ask for.
    const api = createFakePreviewApi({ preview: buildPreview(400) });
    await openTheFile(api);
    givePlotABox();

    plot().focus();
    expect(document.activeElement).toBe(plot());

    clickScan(300, 400);

    await waitFor(() => {
      expect(api.requestedSpectra).toEqual([300]);
    });
    // Focus never left the plot.
    expect(document.activeElement).toBe(plot());
    // And the table's roving tab stop moved to the selected row, so tabbing in
    // afterwards lands there rather than back at the top.
    await waitFor(() => {
      expect(rowFor(300)).toHaveAttribute("tabindex", "0");
    });
  });

  it("reveals the row when Previous and Next move the selection", async () => {
    const api = createFakePreviewApi({ preview: buildPreview(400) });
    await openTheFile(api);

    fireEvent.click(rowFor(0));
    await waitFor(() => {
      expect(api.requestedSpectra).toEqual([0]);
    });

    const next = screen.getByRole("button", { name: "Next scan" });
    next.focus();
    fireEvent.click(next);

    await waitFor(() => {
      expect(api.requestedSpectra).toEqual([0, 1]);
    });
    // Still on the button the user is pressing, so pressing it again works.
    expect(document.activeElement).toBe(next);
  });
});

describe("previous and next scan", () => {
  it("walks the table's order and stops honestly at each end", async () => {
    const api = createFakePreviewApi();
    await openTheFile(api);

    // Nothing selected: neither step has anywhere to go.
    expect(screen.getByRole("button", { name: "Previous scan" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next scan" })).toBeDisabled();

    fireEvent.click(rowFor(0));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Next scan" })).toBeEnabled();
    });
    // The first row has no previous.
    expect(screen.getByRole("button", { name: "Previous scan" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Next scan" }));
    await waitFor(() => {
      expect(api.requestedSpectra).toEqual([0, 1]);
    });
    expect(screen.getByRole("button", { name: "Previous scan" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Previous scan" }));
    await waitFor(() => {
      expect(api.requestedSpectra).toEqual([0, 1, 0]);
    });
  });

  it("has no next at the last row", async () => {
    const api = createFakePreviewApi();
    await openTheFile(api);

    fireEvent.click(rowFor(5));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Previous scan" })).toBeEnabled();
    });
    expect(screen.getByRole("button", { name: "Next scan" })).toBeDisabled();
  });
});

describe("the chromatogram viewport's lifetime", () => {
  it("survives selecting different scans in the same preview", async () => {
    const api = createFakePreviewApi({ preview: buildPreview(400) });
    await openTheFile(api);
    givePlotABox();

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    const ranged = screen.getByText(/^Showing /u).textContent;
    expect(ranged).not.toContain("full range");

    // A scan inside the stretch that is being shown.
    clickScan(200, 400);
    await waitFor(() => {
      expect(api.requestedSpectra).toEqual([200]);
    });

    // The same range. Selecting a scan is not a request to stop looking at the
    // stretch the user chose.
    expect(screen.getByText(/^Showing /u).textContent).toBe(ranged);
  });

  it("pans the least it can when the selection lands outside it", async () => {
    // Not a reset: the span the user zoomed to is kept, and the viewport slides
    // just far enough to put the selected scan inside it.
    // Selected from the scan table, which is the surface that can name a scan
    // the plot is not currently showing.
    const api = createFakePreviewApi();
    await openTheFile(api);

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    const zoomed = screen.getByText(/^Showing /u).textContent ?? "";
    const before = spanOf(zoomed);
    // The first scan is off the left edge of what is being shown.
    expect(Number(/Showing ([\d.]+)/u.exec(zoomed)?.[1])).toBeGreaterThan(0);

    fireEvent.click(rowFor(0));
    await waitFor(() => {
      expect(api.requestedSpectra).toEqual([0]);
    });

    const showing = screen.getByText(/^Showing /u).textContent ?? "";
    expect(spanOf(showing)).toBeCloseTo(before, 6);
    expect(showing).not.toContain("full range");
    expect(Number(/Showing ([\d.]+)/u.exec(showing)?.[1])).toBe(0);
  });

  it("survives moving focus to a vendor row while the mzML preview stays up", async () => {
    // The established rule: a focused workspace row is not the loaded preview's
    // authority. Focusing a Thermo row must not touch the chromatogram's
    // source, its range or its selection.
    const thermoRow: SelectedFile = {
      handle: "file-30",
      fileName: "run-30.raw",
      byteLength: 78_309,
      sourceKind: "thermo_raw",
      relativeContext: null,
    };
    const api = createFakePreviewApi({
      pickedFiles: [selectedFile, thermoRow, shimadzuDataset(28)],
      availability: availableBackend,
    });
    await openTheFile(api);

    fireEvent.click(rowFor(3));
    await waitFor(() => {
      expect(api.requestedSpectra).toEqual([3]);
    });
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    const ranged = screen.getByText(/^Showing /u).textContent;

    fireEvent.click(screen.getByRole("option", { name: /run-30\.raw/u }));

    expect(screen.getByRole("img", { name: "Chromatogram" })).toBeVisible();
    expect(screen.getByText(/^Showing /u).textContent).toBe(ranged);
    expect(screen.getByText(/Selected index 3, scan 4/u)).toBeVisible();
    // And nothing further was read.
    expect(api.openCount()).toBe(1);
    expect(api.requestedSpectra).toEqual([3]);
  });

  it("resets when a different preview is opened", async () => {
    const api = createFakePreviewApi({ pickedFiles: [selectedFile, secondFile] });
    await openTheFile(api);

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText(/^Showing /u).textContent).not.toContain("full range");

    // Opening the other row is a different run, and a range chosen in one run
    // means nothing in another.
    fireEvent.dblClick(screen.getByRole("option", { name: /QC_pool_02\.mzML/u }));

    await waitFor(() => {
      expect(screen.getByText(/^Showing /u).textContent).toContain("full range");
    });
  });

  it("resets when the workspace list is cleared", async () => {
    const api = createFakePreviewApi();
    await openTheFile(api);

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText(/^Showing /u).textContent).not.toContain("full range");

    fireEvent.click(screen.getByRole("button", { name: "Clear list" }));

    await waitFor(() => {
      expect(screen.queryByRole("img", { name: "Chromatogram" })).toBeNull();
    });
  });
});

describe("two selections in a row", () => {
  it("leaves the later one authoritative when the earlier one lands last", async () => {
    // The established request-generation behaviour, reached through the
    // chromatogram rather than reimplemented in it. A stale answer must not
    // move the marker, the table or the spectrum back to the scan it was about.
    const first = deferred<SelectedSpectrumOutcome>();
    const api = createFakePreviewApi({
      preview: buildPreview(20),
      spectrum: (index) =>
        index === 1
          ? first.promise
          : Promise.resolve<SelectedSpectrumOutcome>({
              outcome: "spectrum",
              spectrum: { ...buildSpectrum(index, 4), index },
            }),
    });
    await openTheFile(api);
    givePlotABox();

    clickScan(1, 20);
    await waitFor(() => {
      expect(api.requestedSpectra).toEqual([1]);
    });

    clickScan(9, 20);
    await waitFor(() => {
      expect(api.requestedSpectra).toEqual([1, 9]);
    });
    await waitFor(() => {
      expect(screen.getByText(/Selected index 9, scan 10/u)).toBeVisible();
    });

    // The first read now finishes. It is about a scan nobody is looking at.
    await act(async () => {
      first.resolve({ outcome: "spectrum", spectrum: { ...buildSpectrum(1, 4), index: 1 } });
      await Promise.resolve();
    });

    expect(screen.getByText(/Selected index 9, scan 10/u)).toBeVisible();
    expect(rowFor(9)).toHaveAttribute("aria-selected", "true");
    expect(rowFor(1)).toHaveAttribute("aria-selected", "false");
    expect(await screen.findByRole("img", { name: /^Spectrum 9,/u })).toBeVisible();
  });

  it("does not read the same scan twice while its first read is still running", async () => {
    const pending = deferred<SelectedSpectrumOutcome>();
    const api = createFakePreviewApi({ spectrum: () => pending.promise });
    await openTheFile(api);
    givePlotABox();

    clickScan(3, 6);
    await waitFor(() => {
      expect(api.requestedSpectra).toEqual([3]);
    });
    clickScan(3, 6);
    fireEvent.click(rowFor(3));

    expect(api.requestedSpectra).toEqual([3]);

    await act(async () => {
      pending.resolve({ outcome: "spectrum", spectrum: { ...buildSpectrum(3, 4), index: 3 } });
      await Promise.resolve();
    });
  });
});
