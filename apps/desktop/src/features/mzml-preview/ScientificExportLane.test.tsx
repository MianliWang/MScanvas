/**
 * One scientific export lane, seen from both of the surfaces that share it.
 *
 * Rust holds a single lane across the selected spectrum and the chromatogram:
 * two native save dialogs for one window is not a state this application can be
 * in, and a clipboard rasterization racing a file write is two claims on the
 * same memory that nothing on screen would explain. That makes "may another
 * scientific export begin now" a question with **one** answer, and the interface
 * has to give the same one.
 *
 * These are the callbacks rather than the buttons. A disabled control is what a
 * user meets, and it is pinned where the panels are rendered -- but a control is
 * only disabled because the workspace said the lane was busy, and a guard that
 * lived only in the rendering would let anything else that can reach these
 * functions dispatch an operation already known to be refused.
 *
 * What is shared is availability and nothing else: each surface keeps its own
 * result, its own status message and its own token binding, and neither ever
 * publishes the other's.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { PreviewApiProvider, type PreviewApi } from "./api";
import { usePreviewWorkspace } from "./usePreviewWorkspace";
import { createFakePreviewApi, selectedFile } from "../../test/previewFixtures";

function wrapper(api: PreviewApi) {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return <PreviewApiProvider value={api}>{children}</PreviewApiProvider>;
  };
}

/** A workspace with the run open and one spectrum read, so both surfaces exist. */
async function bothSurfacesReady(
  api: ReturnType<typeof createFakePreviewApi>,
): Promise<ReturnType<typeof renderHook<ReturnType<typeof usePreviewWorkspace>, unknown>>> {
  const rendered = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(api) });
  await waitFor(() => {
    expect(rendered.result.current.roster.datasets).toHaveLength(1);
  });
  act(() => {
    rendered.result.current.activateDataset(selectedFile.handle);
  });
  await waitFor(() => {
    expect(rendered.result.current.preview.status).toBe("loaded");
  });
  act(() => {
    rendered.result.current.selectSpectrum(0);
  });
  await waitFor(() => {
    expect(rendered.result.current.spectrum.status).toBe("loaded");
  });
  expect(rendered.result.current.chromatogramExportToken).not.toBeNull();
  return rendered;
}

function oneDataset(): { readonly file: typeof selectedFile; readonly parents: never[] } {
  return { file: selectedFile, parents: [] };
}

describe("the one scientific export lane", () => {
  it("closes the selected spectrum's operations while a chromatogram export runs", async () => {
    // The half Round 2 of M4.3's review found. The chromatogram's own callbacks
    // already watched both states; these two watched only their own, so with a
    // chromatogram export running a spectrum action still reached Rust -- and
    // came back refused, which is a failure the interface caused rather than
    // one it reported.
    let release: (() => void) | null = null;
    const api = createFakePreviewApi({
      initialDatasets: [oneDataset()],
      chromatogramExport: async () =>
        new Promise((resolve) => {
          release = () => {
            resolve({ status: "cancelled" });
          };
        }),
    });
    const { result } = await bothSurfacesReady(api);

    act(() => {
      result.current.exportChromatogram("csv");
    });
    await waitFor(() => {
      expect(api.chromatogramExportRequests).toHaveLength(1);
    });
    expect(result.current.scientificExportBusy).toBe(true);

    // Every selected-spectrum operation, while the lane is held elsewhere.
    act(() => {
      result.current.exportSpectrum("svg");
      result.current.exportSpectrum("png");
      result.current.exportSpectrum("csv");
      result.current.exportSpectrum("tsv");
      result.current.copySpectrumPlot();
    });

    expect(api.spectrumExportRequests).toEqual([]);
    expect(api.spectrumCopyRequests).toEqual([]);
    // And the spectrum surface says nothing about an export it never started:
    // the lane is shared, the result is not.
    expect(result.current.spectrumExport).toEqual({ status: "idle" });

    act(() => {
      release?.();
    });
    await waitFor(() => {
      expect(result.current.scientificExportBusy).toBe(false);
    });

    // What was refused was the lane, not the action.
    act(() => {
      result.current.exportSpectrum("csv");
    });
    await waitFor(() => {
      expect(api.spectrumExportRequests).toHaveLength(1);
    });
  });

  it("closes the chromatogram's operations while a selected-spectrum export runs", async () => {
    // The direction that already held, pinned so it stays symmetric. One lane
    // means neither surface is the privileged one.
    let release: (() => void) | null = null;
    const api = createFakePreviewApi({
      initialDatasets: [oneDataset()],
      spectrumExport: async () =>
        new Promise((resolve) => {
          release = () => {
            resolve({ status: "cancelled" });
          };
        }),
    });
    const { result } = await bothSurfacesReady(api);

    act(() => {
      result.current.exportSpectrum("csv");
    });
    await waitFor(() => {
      expect(api.spectrumExportRequests).toHaveLength(1);
    });
    expect(result.current.scientificExportBusy).toBe(true);

    act(() => {
      result.current.exportChromatogram("svg");
      result.current.exportChromatogram("png");
      result.current.exportChromatogram("csv");
      result.current.exportChromatogram("tsv");
      result.current.copyChromatogramPlot();
    });

    expect(api.chromatogramExportRequests).toEqual([]);
    expect(api.chromatogramCopyRequests).toEqual([]);
    expect(result.current.chromatogramExport).toEqual({ status: "idle" });

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

  it("closes both surfaces for a copy as well as for a save", async () => {
    // A clipboard rasterization is the same lane. Rust commits it immediately --
    // there is no destination to choose and nothing to come back from -- so a
    // second scientific operation over the top of one is refused there too.
    let release: (() => void) | null = null;
    const api = createFakePreviewApi({
      initialDatasets: [oneDataset()],
      chromatogramCopy: async () =>
        new Promise((resolve) => {
          release = () => {
            resolve({
              status: "copied",
              figure: { width: 1_200, height: 640, theme: "light" },
              traces: { tic: true, bpc: false },
              rangeScope: "full",
              rangeLow: 0,
              rangeHigh: 1,
              sourceScanCount: 6,
            });
          };
        }),
    });
    const { result } = await bothSurfacesReady(api);

    act(() => {
      result.current.copyChromatogramPlot();
    });
    await waitFor(() => {
      expect(api.chromatogramCopyRequests).toHaveLength(1);
    });
    expect(result.current.scientificExportBusy).toBe(true);

    act(() => {
      result.current.copySpectrumPlot();
      result.current.exportSpectrum("png");
    });
    expect(api.spectrumCopyRequests).toEqual([]);
    expect(api.spectrumExportRequests).toEqual([]);

    act(() => {
      release?.();
    });
    await waitFor(() => {
      expect(result.current.scientificExportBusy).toBe(false);
    });
  });

  it("says the lane is free where neither surface is running", async () => {
    const api = createFakePreviewApi({ initialDatasets: [oneDataset()] });
    const { result } = await bothSurfacesReady(api);

    expect(result.current.scientificExportBusy).toBe(false);
    expect(result.current.spectrumExport).toEqual({ status: "idle" });
    expect(result.current.chromatogramExport).toEqual({ status: "idle" });
  });
});
