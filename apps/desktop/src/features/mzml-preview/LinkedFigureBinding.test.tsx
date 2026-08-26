/**
 * What a linked figure operation is bound to, and how long it stays bound.
 *
 * The linked surface is the only one whose export is about a *pair*. Everything
 * here follows from that: an operation names two retained sources, either of
 * which the user can replace while it is still running, and the two answers the
 * interface owes them are different questions.
 *
 * - **Is the lane held?** Until Rust says the operation ended, and not a moment
 *   before. Reporting it free while a file is being written would re-offer every
 *   scientific export, and Rust would refuse them.
 * - **Does this result belong beside what is on screen?** Only while the pair it
 *   was begun on is still the pair on screen. Publishing it afterwards would put
 *   "Saved ..., marking spectrum 0" beside a different scan.
 *
 * Nothing here is the science. Every number this surface sends is a request, and
 * the assertions below are about what crossed the boundary.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { PreviewApiProvider, type PreviewApi } from "./api";
import type {
  LinkedFigureCopyOutcome,
  LinkedFigureExportOutcome,
  Preview,
  SelectedSpectrumOutcome,
} from "./contracts";
import { usePreviewWorkspace } from "./usePreviewWorkspace";
import {
  FAKE_FIGURE_SETTINGS,
  FAKE_SELECTED_INDEX,
  FAKE_SELECTED_RETENTION_TIME,
  buildPreview,
  buildSpectrum,
  createFakePreviewApi,
  deferred,
  fakeCopiedFigure,
  fakeExportedFigure,
  selectedFile,
} from "../../test/previewFixtures";

/** The step between two scans in the fixture run. */
const RT_STEP = 0.0125;

function wrapper(api: PreviewApi) {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return <PreviewApiProvider value={api}>{children}</PreviewApiProvider>;
  };
}

/**
 * A preview whose chromatogram is named freshly on every open.
 *
 * What Rust does: the token is a counter, and installing a chromatogram issues a
 * new one, so no two opens are ever named the same. The shared fixture answers
 * with a fixed token, which is enough for the cases that only need *a* token and
 * wrong for the ones that turn on a replacement being distinguishable from the
 * run it replaced.
 */
function previewsNamedPerOpen(): () => Promise<Preview> {
  let opens = 0;
  return () => {
    opens += 1;
    return Promise.resolve({
      ...buildPreview(),
      chromatogramExportToken: `chromatogram-token-${opens}`,
    });
  };
}

/** Drives one workspace to an open run with a scan selected. */
async function linkedWorkspace(options: Parameters<typeof createFakePreviewApi>[0] = {}) {
  const api = createFakePreviewApi({
    initialDatasets: [{ file: selectedFile, parents: [] }],
    ...options,
  });
  const rendered = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(api) });
  const { result } = rendered;
  await waitFor(() => {
    expect(result.current.roster.datasets).toHaveLength(1);
  });
  act(() => {
    result.current.activateDataset(selectedFile.handle);
  });
  await waitFor(() => {
    expect(result.current.preview.status).toBe("loaded");
  });
  act(() => {
    result.current.selectSpectrum(0);
  });
  await waitFor(() => {
    expect(result.current.spectrum.status).toBe("loaded");
  });
  // The viewer opens with TIC alone, which is one visible trace and therefore
  // a linked figure this run can draw.
  expect(result.current.linkedFigureUnavailable).toBeNull();
  return { api, rendered, result };
}

describe("what a linked figure operation is bound to", () => {
  it("sends both tokens, the range and the traces, and no retention time", async () => {
    const { api, result } = await linkedWorkspace();

    act(() => {
      result.current.exportLinkedFigure("svg");
    });
    await waitFor(() => {
      expect(api.linkedFigureRequests).toHaveLength(1);
    });

    // The pair, as two opaque names. Nothing about where the scan sits crosses
    // the boundary: the marker's coordinate is the retained row's, and this
    // side does not have it and does not send one.
    expect(api.linkedFigureRequests).toEqual([
      {
        chromatogramToken: "chromatogram-token",
        spectrumToken: "token-0",
        format: "svg",
        range: { scope: "full", low: null, high: null },
        traces: { tic: true, bpc: false },
        settings: { widthPx: 1_200, heightPx: 640, pngDpi: 300, theme: "light" },
      },
    ]);
    const [request] = api.linkedFigureRequests;
    expect(Object.keys(request ?? {}).sort()).toEqual([
      "chromatogramToken",
      "format",
      "range",
      "settings",
      "spectrumToken",
      "traces",
    ]);
    // And no single-source export was started beside it.
    expect(api.chromatogramExportRequests).toEqual([]);
    expect(api.spectrumExportRequests).toEqual([]);
  });

  it("copies the linked plot with the same pair and none of the chosen resolution", async () => {
    const { api, result } = await linkedWorkspace();

    act(() => {
      result.current.setFigureTheme("dark");
      result.current.setFigureSetting("pngDpi", "600");
    });
    act(() => {
      result.current.copyLinkedPlot();
    });
    await waitFor(() => {
      expect(result.current.linkedFigureExport.status).toBe("copied");
    });

    // A clipboard image carries no physical size, so the resolution the user
    // chose for a PNG is not forwarded -- the rule the two single-source copies
    // already follow, and 600 is what a save of the same figure would carry.
    expect(api.linkedFigureCopyRequests).toEqual([
      {
        chromatogramToken: "chromatogram-token",
        spectrumToken: "token-0",
        format: null,
        range: { scope: "full", low: null, high: null },
        traces: { tic: true, bpc: false },
        settings: { widthPx: 1_200, heightPx: 640, pngDpi: 300, theme: "dark" },
      },
    ]);
    const copied = result.current.linkedFigureExport;
    if (copied.status !== "copied") {
      throw new Error("the copy resolved to something other than a copied figure");
    }
    expect(copied.selectedIndex).toBe(FAKE_SELECTED_INDEX);
    expect(copied.selectedRetentionTime).toBe(FAKE_SELECTED_RETENTION_TIME);
  });

  it("reads the retention time it shows from Rust rather than from the table", async () => {
    // The marker is Rust's fact. What this side is allowed to display is the
    // number that came back, whatever the table it drew from happens to say --
    // so a fake that answers with a time no row in the fixture holds is
    // reported unchanged rather than corrected.
    const elsewhere = 98.75;
    const { result } = await linkedWorkspace({
      linkedFigureExport: async (_chromatogram, _spectrum, format, range, traces, settings) =>
        ({
          status: "saved",
          format,
          fileName: `mscanvas-linked-spectrum-0-${range.scope}.${format}`,
          figure: fakeExportedFigure(settings, format),
          traces,
          rangeScope: range.scope,
          rangeLow: 0,
          rangeHigh: 0.0625,
          sourceScanCount: 6,
          selectedIndex: 4,
          selectedRetentionTime: elsewhere,
        }) satisfies LinkedFigureExportOutcome,
    });

    act(() => {
      result.current.exportLinkedFigure("png");
    });
    await waitFor(() => {
      expect(result.current.linkedFigureExport.status).toBe("saved");
    });
    const saved = result.current.linkedFigureExport;
    if (saved.status !== "saved") {
      throw new Error("the export resolved to something other than a saved file");
    }
    expect(saved.selectedIndex).toBe(4);
    expect(saved.selectedRetentionTime).toBe(elsewhere);
  });
});

describe("a linked operation that outlives the pair it names", () => {
  /** One linked export that hangs until the test releases it. */
  function heldExport(): {
    readonly options: Parameters<typeof createFakePreviewApi>[0];
    readonly finish: () => void;
  } {
    let release: (() => void) | null = null;
    const options: Parameters<typeof createFakePreviewApi>[0] = {
      preview: previewsNamedPerOpen(),
      linkedFigureExport: async (_chromatogram, _spectrum, format, range, traces, settings) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return {
          status: "saved",
          format,
          fileName: `mscanvas-linked-spectrum-0-${range.scope}.${format}`,
          figure: fakeExportedFigure(settings, format),
          traces,
          rangeScope: range.scope,
          rangeLow: 0,
          rangeHigh: 0.0625,
          sourceScanCount: 6,
          selectedIndex: FAKE_SELECTED_INDEX,
          selectedRetentionTime: FAKE_SELECTED_RETENTION_TIME,
        } satisfies LinkedFigureExportOutcome;
      },
    };
    return {
      options,
      finish: () => {
        release?.();
      },
    };
  }

  it("keeps the lane and stops naming the pair when another scan is selected", async () => {
    // CASE 1. Selecting another scan replaces half the pair, which is enough:
    // what is being written is no longer what is on screen. The lane is still
    // held, because Rust is still writing, and nothing here says the new pair
    // is the one being exported.
    const held = heldExport();
    const { result } = await linkedWorkspace(held.options);

    act(() => {
      result.current.exportLinkedFigure("svg");
    });
    await waitFor(() => {
      expect(result.current.linkedFigureExport).toEqual({
        status: "running",
        operation: "svg",
        namesVisiblePair: true,
      });
    });

    act(() => {
      result.current.selectSpectrum(1);
    });
    await waitFor(() => {
      expect(result.current.spectrum.status).toBe("loaded");
    });

    expect(result.current.linkedFigureExport).toEqual({
      status: "running",
      operation: "svg",
      namesVisiblePair: false,
    });
    expect(result.current.scientificExportBusy).toBe(true);

    await act(async () => {
      held.finish();
      await Promise.resolve();
    });

    // The file was written. It is simply not this pair's file, so this surface
    // says nothing about it -- and the lane is free, because the operation that
    // held it has ended.
    expect(result.current.linkedFigureExport).toEqual({ status: "idle" });
    expect(result.current.scientificExportBusy).toBe(false);
  });

  it("keeps the lane and stops naming the pair when the preview is replaced", async () => {
    // CASE 2. The other half of the pair, and the same semantics: a new run is
    // a new chromatogram token, so the figure being written is about a run that
    // is no longer on screen.
    const held = heldExport();
    const { result } = await linkedWorkspace(held.options);

    act(() => {
      result.current.exportLinkedFigure("png");
    });
    await waitFor(() => {
      expect(result.current.linkedFigureExport.status).toBe("running");
    });
    expect(result.current.chromatogramExportToken).toBe("chromatogram-token-1");

    act(() => {
      result.current.activateDataset(selectedFile.handle);
    });
    await waitFor(() => {
      expect(result.current.chromatogramExportToken).toBe("chromatogram-token-2");
    });

    expect(result.current.linkedFigureExport).toEqual({
      status: "running",
      operation: "png",
      namesVisiblePair: false,
    });
    expect(result.current.scientificExportBusy).toBe(true);

    await act(async () => {
      held.finish();
      await Promise.resolve();
    });
    expect(result.current.linkedFigureExport).toEqual({ status: "idle" });
    expect(result.current.scientificExportBusy).toBe(false);
  });

  it("releases the lane on a stale failure without showing it beside another pair", async () => {
    // CASE 3. A failure is an ending like any other, so the lane is released --
    // and a failure carries the part of the answer a user has to act on, which
    // is exactly what must not appear beside a pair it is not about.
    let reject: ((cause: unknown) => void) | null = null;
    const { result } = await linkedWorkspace({
      preview: previewsNamedPerOpen(),
      linkedFigureExport: () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    });

    act(() => {
      result.current.exportLinkedFigure("svg");
    });
    await waitFor(() => {
      expect(result.current.linkedFigureExport.status).toBe("running");
    });

    act(() => {
      result.current.selectSpectrum(1);
    });
    await waitFor(() => {
      expect(result.current.spectrum.status).toBe("loaded");
    });

    await act(async () => {
      reject?.({
        kind: "spectrum_not_written",
        summary: "The linked figure could not be written.",
        detail: "A temporary file .mscanvas-export-1 was left in the folder.",
        retryable: true,
      });
      await Promise.resolve();
    });

    expect(result.current.linkedFigureExport).toEqual({ status: "idle" });
    expect(result.current.scientificExportBusy).toBe(false);
  });

  it("presents an ordinary success, cancel and failure for the pair that asked", async () => {
    // CASE 4. Nothing moved, so every outcome is this pair's and is shown.
    let answer: LinkedFigureExportOutcome | "fail" = { status: "cancelled" };
    const { result } = await linkedWorkspace({
      linkedFigureExport: async () => {
        if (answer === "fail") {
          throw {
            kind: "linked_figure_source_mismatch",
            summary: "That selected spectrum is not a scan of the chromatogram on screen.",
            detail: null,
            retryable: true,
          };
        }
        return answer;
      },
    });

    act(() => {
      result.current.exportLinkedFigure("svg");
    });
    await waitFor(() => {
      expect(result.current.linkedFigureExport).toEqual({ status: "cancelled" });
    });
    expect(result.current.scientificExportBusy).toBe(false);

    answer = {
      status: "saved",
      format: "svg",
      fileName: "mscanvas-linked-spectrum-0-full.svg",
      figure: fakeExportedFigure(FAKE_FIGURE_SETTINGS, "svg"),
      traces: { tic: true, bpc: false },
      rangeScope: "full",
      rangeLow: 0,
      rangeHigh: 0.0625,
      sourceScanCount: 6,
      selectedIndex: FAKE_SELECTED_INDEX,
      selectedRetentionTime: FAKE_SELECTED_RETENTION_TIME,
    };
    act(() => {
      result.current.exportLinkedFigure("svg");
    });
    await waitFor(() => {
      expect(result.current.linkedFigureExport.status).toBe("saved");
    });

    answer = "fail";
    act(() => {
      result.current.exportLinkedFigure("png");
    });
    await waitFor(() => {
      expect(result.current.linkedFigureExport.status).toBe("failed");
    });
    const failed = result.current.linkedFigureExport;
    if (failed.status !== "failed") {
      throw new Error("the export resolved to something other than a failure");
    }
    expect(failed.operation).toBe("png");
    expect(failed.error.kind).toBe("linked_figure_source_mismatch");
    expect(result.current.scientificExportBusy).toBe(false);

    act(() => {
      result.current.dismissLinkedFigureExport();
    });
    expect(result.current.linkedFigureExport).toEqual({ status: "idle" });
  });

  it("does not publish a copy that lands after the pair has moved", async () => {
    let release: (() => void) | null = null;
    const { result } = await linkedWorkspace({
      preview: previewsNamedPerOpen(),
      linkedFigureCopy: async (_chromatogram, _spectrum, range, traces, settings) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return {
          status: "copied",
          figure: fakeCopiedFigure(settings),
          traces,
          rangeScope: range.scope,
          rangeLow: 0,
          rangeHigh: 0.0625,
          sourceScanCount: 6,
          selectedIndex: FAKE_SELECTED_INDEX,
          selectedRetentionTime: FAKE_SELECTED_RETENTION_TIME,
        } satisfies LinkedFigureCopyOutcome;
      },
    });

    act(() => {
      result.current.copyLinkedPlot();
    });
    await waitFor(() => {
      expect(result.current.linkedFigureExport).toEqual({
        status: "running",
        operation: "copy",
        namesVisiblePair: true,
      });
    });

    act(() => {
      result.current.selectSpectrum(1);
    });
    await waitFor(() => {
      expect(result.current.spectrum.status).toBe("loaded");
    });
    expect(result.current.scientificExportBusy).toBe(true);

    await act(async () => {
      release?.();
      await Promise.resolve();
    });
    expect(result.current.linkedFigureExport).toEqual({ status: "idle" });
    expect(result.current.scientificExportBusy).toBe(false);
  });
});

describe("why a linked figure cannot be exported", () => {
  it("says a run with no chromatogram has nothing to link to", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [{ file: selectedFile, parents: [] }],
      preview: () => Promise.resolve(buildPreview(6, true)),
    });
    const { result } = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(api) });
    await waitFor(() => {
      expect(result.current.roster.datasets).toHaveLength(1);
    });
    act(() => {
      result.current.activateDataset(selectedFile.handle);
    });
    await waitFor(() => {
      expect(result.current.preview.status).toBe("loaded");
    });

    expect(result.current.chromatogramExportToken).toBeNull();
    expect(result.current.linkedFigureUnavailable).toBe(
      "This run has no chromatogram to link to.",
    );
  });

  it("says to select a scan, and then to wait for it", async () => {
    const slow = deferred<SelectedSpectrumOutcome>();
    const api = createFakePreviewApi({
      initialDatasets: [{ file: selectedFile, parents: [] }],
      spectrum: () => slow.promise,
    });
    const { result } = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(api) });
    await waitFor(() => {
      expect(result.current.roster.datasets).toHaveLength(1);
    });
    act(() => {
      result.current.activateDataset(selectedFile.handle);
    });
    await waitFor(() => {
      expect(result.current.preview.status).toBe("loaded");
    });

    // Nothing selected yet.
    expect(result.current.linkedFigureUnavailable).toBe(
      "Select a scan and wait for its spectrum to load.",
    );

    act(() => {
      result.current.selectSpectrum(0);
    });
    await waitFor(() => {
      expect(result.current.spectrum.status).toBe("loading");
    });
    expect(result.current.linkedFigureUnavailable).toBe(
      "Wait for the selected spectrum to load.",
    );

    act(() => {
      slow.resolve({ outcome: "spectrum", spectrum: buildSpectrum(0, 4) });
    });
    await waitFor(() => {
      expect(result.current.spectrum.status).toBe("loaded");
    });
    expect(result.current.linkedFigureUnavailable).toBeNull();
  });

  it("says which trace to show when both are hidden", async () => {
    const { api, result } = await linkedWorkspace();

    act(() => {
      result.current.toggleChromatogramTrace("tic");
    });
    expect(result.current.chromatogramTraces).toEqual({ tic: false, bpc: false });
    expect(result.current.linkedFigureUnavailable).toBe(
      "Show at least one chromatogram trace to create a linked figure.",
    );

    // Closed means closed: pressing anyway sends nothing.
    act(() => {
      result.current.exportLinkedFigure("svg");
      result.current.copyLinkedPlot();
    });
    expect(api.linkedFigureRequests).toEqual([]);
    expect(api.linkedFigureCopyRequests).toEqual([]);

    // Either trace on its own is a figure this run can draw.
    act(() => {
      result.current.toggleChromatogramTrace("bpc");
    });
    expect(result.current.chromatogramTraces).toEqual({ tic: false, bpc: true });
    expect(result.current.linkedFigureUnavailable).toBeNull();
  });

  it("says the selected scan is outside the current range, and how to fix it", async () => {
    // Guidance, not authority. Rust decides this again against the retained row
    // and refuses with its own typed answer; this exists so a user is told
    // before a save dialog would have opened, and is told what to change.
    const { api, result } = await linkedWorkspace();

    act(() => {
      result.current.setChromatogramRangeScope("current");
    });
    // A committed viewport that leaves the selected scan behind, which is what
    // panning away from it does.
    act(() => {
      result.current.dispatchViewerEvent({
        type: "viewport-step",
        domain: { low: 2 * RT_STEP, high: 5 * RT_STEP },
      });
    });
    await waitFor(() => {
      expect(result.current.chromatogramCommittedDomain).not.toBeNull();
    });

    expect(result.current.linkedFigureUnavailable).toBe(
      "The selected scan is outside the current chromatogram range. Choose Full run or move " +
        "the current range to include the selected scan.",
    );
    act(() => {
      result.current.exportLinkedFigure("svg");
    });
    expect(api.linkedFigureRequests).toEqual([]);

    // Choosing Full run is one of the two things the sentence offers, and it
    // works without moving the viewer.
    act(() => {
      result.current.setChromatogramRangeScope("full");
    });
    expect(result.current.linkedFigureUnavailable).toBeNull();
    expect(result.current.chromatogramCommittedDomain).not.toBeNull();
  });

  it("accepts a current range that still holds the selected scan", async () => {
    const { api, result } = await linkedWorkspace();

    act(() => {
      result.current.setChromatogramRangeScope("current");
    });
    act(() => {
      result.current.dispatchViewerEvent({
        type: "viewport-step",
        domain: { low: 0, high: 3 * RT_STEP },
      });
    });
    await waitFor(() => {
      expect(result.current.chromatogramCommittedDomain).not.toBeNull();
    });

    expect(result.current.linkedFigureUnavailable).toBeNull();
    act(() => {
      result.current.exportLinkedFigure("svg");
    });
    await waitFor(() => {
      expect(api.linkedFigureRequests).toHaveLength(1);
    });
    expect(api.linkedFigureRequests[0]?.range).toEqual({
      scope: "current",
      low: 0,
      high: 3 * RT_STEP,
    });
  });

  it("closes at 259 and opens at 260", async () => {
    const { api, result } = await linkedWorkspace();

    act(() => {
      result.current.setFigureSetting("heightPx", "259");
    });
    expect(result.current.linkedFigureUnavailable).toBe(
      "A two-panel linked figure needs a height of at least 260.",
    );
    // The single-source exports are untouched: one panel still fits.
    expect(result.current.renderSettingsProblem).toBeNull();
    act(() => {
      result.current.exportLinkedFigure("svg");
      result.current.copyLinkedPlot();
    });
    expect(api.linkedFigureRequests).toEqual([]);
    expect(api.linkedFigureCopyRequests).toEqual([]);

    act(() => {
      result.current.setFigureSetting("heightPx", "260");
    });
    expect(result.current.linkedFigureUnavailable).toBeNull();
    act(() => {
      result.current.exportLinkedFigure("svg");
    });
    await waitFor(() => {
      expect(api.linkedFigureRequests).toHaveLength(1);
    });
    expect(api.linkedFigureRequests[0]?.settings.heightPx).toBe(260);
  });

  it("forwards the figure problem when the width is not a size at all", async () => {
    const { api, result } = await linkedWorkspace();

    act(() => {
      result.current.setFigureSetting("widthPx", "");
    });
    expect(result.current.renderSettingsProblem).not.toBeNull();
    expect(result.current.linkedFigureUnavailable).toBe(result.current.renderSettingsProblem);
    act(() => {
      result.current.exportLinkedFigure("png");
    });
    expect(api.linkedFigureRequests).toEqual([]);
  });

  it("closes the linked actions while either single-source export runs", async () => {
    let release: (() => void) | null = null;
    const { api, result } = await linkedWorkspace({
      chromatogramExport: () =>
        new Promise((resolve) => {
          release = () => {
            resolve({ status: "cancelled" });
          };
        }),
    });

    act(() => {
      result.current.exportChromatogram("csv");
    });
    await waitFor(() => {
      expect(result.current.scientificExportBusy).toBe(true);
    });

    // Available on its own terms, and closed because the lane is held.
    expect(result.current.linkedFigureUnavailable).toBeNull();
    act(() => {
      result.current.exportLinkedFigure("svg");
      result.current.copyLinkedPlot();
    });
    expect(api.linkedFigureRequests).toEqual([]);
    expect(api.linkedFigureCopyRequests).toEqual([]);
    // And this surface says nothing about an export it never started.
    expect(result.current.linkedFigureExport).toEqual({ status: "idle" });

    act(() => {
      release?.();
    });
    await waitFor(() => {
      expect(result.current.scientificExportBusy).toBe(false);
    });
    act(() => {
      result.current.exportLinkedFigure("svg");
    });
    await waitFor(() => {
      expect(api.linkedFigureRequests).toHaveLength(1);
    });
  });

  it("closes both single-source surfaces while a linked export runs", async () => {
    let release: (() => void) | null = null;
    const { api, result } = await linkedWorkspace({
      linkedFigureExport: () =>
        new Promise((resolve) => {
          release = () => {
            resolve({ status: "cancelled" });
          };
        }),
    });

    act(() => {
      result.current.exportLinkedFigure("svg");
    });
    await waitFor(() => {
      expect(result.current.scientificExportBusy).toBe(true);
    });

    act(() => {
      result.current.exportChromatogram("csv");
      result.current.copyChromatogramPlot();
      result.current.exportSpectrum("svg");
      result.current.copySpectrumPlot();
    });
    expect(api.chromatogramExportRequests).toEqual([]);
    expect(api.chromatogramCopyRequests).toEqual([]);
    expect(api.spectrumExportRequests).toEqual([]);
    expect(api.spectrumCopyRequests).toEqual([]);
    // Availability is shared; results are not.
    expect(result.current.chromatogramExport).toEqual({ status: "idle" });
    expect(result.current.spectrumExport).toEqual({ status: "idle" });

    act(() => {
      release?.();
    });
    await waitFor(() => {
      expect(result.current.scientificExportBusy).toBe(false);
    });
    act(() => {
      result.current.exportChromatogram("csv");
    });
    await waitFor(() => {
      expect(api.chromatogramExportRequests).toHaveLength(1);
    });
  });
});
