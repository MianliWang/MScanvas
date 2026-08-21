/**
 * What an export is bound to, and what it deliberately is not.
 *
 * `PreviewWorkspace` lets the keyboard move through the roster while an mzML
 * preview stays on screen, which is the behaviour that makes this worth pinning:
 * the focused row and the loaded preview are different things, and a vendor
 * acquisition can be focused while a converted mzML is the thing being read.
 * An export that followed focus would write -- or refuse -- the wrong dataset
 * while the panel a user is looking at is unchanged.
 *
 * It also pins the other half of the same property: the token an export sends
 * comes from the loaded spectrum rather than from anything this side computed,
 * so the file is the complete measurement Rust retained and never the bounded
 * arrays that reached the browser.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { PreviewApiProvider, type PreviewApi } from "./api";
import { usePreviewWorkspace } from "./usePreviewWorkspace";
import {
  FAKE_COMPLETE_SPECTRUM_POINTS,
  FAKE_FIGURE_SETTINGS,
  fakeExportedFigure,
  createFakePreviewApi,
  selectedFile,
  shimadzuDataset,
} from "../../test/previewFixtures";

function wrapper(api: PreviewApi) {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return <PreviewApiProvider value={api}>{children}</PreviewApiProvider>;
  };
}

describe("selected spectrum export binding", () => {
  it("exports the loaded spectrum even while a vendor row holds focus", async () => {
    // One converted mzML and one vendor acquisition in the workspace. The mzML
    // preview is opened and a spectrum is selected; focus then moves to the
    // vendor row, which is an ordinary thing to do while reading a spectrum.
    const vendorRow = shimadzuDataset(9);
    const api = createFakePreviewApi({
      initialDatasets: [
        { file: selectedFile, parents: [] },
        { file: vendorRow, parents: [] },
      ],
    });
    const { result } = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(api) });
    await waitFor(() => {
      expect(result.current.roster.datasets).toHaveLength(2);
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
    const bound =
      result.current.spectrum.status === "loaded"
        ? result.current.spectrum.spectrum.exportToken
        : null;
    expect(bound).not.toBeNull();

    // Focus moves to the vendor acquisition. Nothing about the preview or the
    // spectrum changes, which is the whole reason this is allowed.
    act(() => {
      result.current.dispatchRoster({
        type: "rowPressed",
        handle: vendorRow.handle,
        modifiers: { ctrl: false, shift: false },
      });
    });
    expect(result.current.roster.focused).toBe(vendorRow.handle);
    expect(result.current.preview.status).toBe("loaded");

    act(() => {
      result.current.exportSpectrum("csv");
    });
    await waitFor(() => {
      expect(result.current.spectrumExport.status).toBe("saved");
    });

    // The export named the spectrum that is on screen, not the row that has
    // the keyboard.
    // The figure settings travel with it, exactly as the panel holds them.
    expect(api.spectrumExportRequests).toEqual([
      { exportToken: bound, format: "csv", settings: FAKE_FIGURE_SETTINGS },
    ]);
    // And the preview is exactly as it was: exporting a spectrum is not
    // selecting one, and no reload was provoked by it.
    expect(result.current.preview.status).toBe("loaded");
    expect(result.current.spectrum.status).toBe("loaded");
  });

  it("reports the complete point count rather than the transferred arrays", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [{ file: selectedFile, parents: [] }],
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
    act(() => {
      result.current.selectSpectrum(0);
    });
    await waitFor(() => {
      expect(result.current.spectrum.status).toBe("loaded");
    });

    act(() => {
      result.current.exportSpectrum("svg");
    });
    await waitFor(() => {
      expect(result.current.spectrumExport.status).toBe("saved");
    });

    const saved = result.current.spectrumExport;
    if (saved.status !== "saved") {
      throw new Error("the export resolved to something other than a saved file");
    }
    // Larger than any array this document holds. What was written is the
    // spectrum Rust kept, and this side could not have produced that number.
    expect(saved.pointCount).toBe(FAKE_COMPLETE_SPECTRUM_POINTS);
    const transferred =
      result.current.spectrum.status === "loaded" ? result.current.spectrum.spectrum.mz.length : 0;
    expect(saved.pointCount).toBeGreaterThan(transferred);
  });

  it("clears a result when a different spectrum is loaded", async () => {
    const api = createFakePreviewApi({
      initialDatasets: [{ file: selectedFile, parents: [] }],
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
    act(() => {
      result.current.selectSpectrum(0);
    });
    await waitFor(() => {
      expect(result.current.spectrum.status).toBe("loaded");
    });
    act(() => {
      result.current.exportSpectrum("tsv");
    });
    await waitFor(() => {
      expect(result.current.spectrumExport.status).toBe("saved");
    });

    // A result belongs to the measurement it describes. Loading another one
    // clears it, so a panel can never say "saved" beside a spectrum no file was
    // written from.
    act(() => {
      result.current.selectSpectrum(1);
    });
    await waitFor(() => {
      expect(result.current.spectrumExport.status).toBe("idle");
    });
  });

  it("drops a result that lands after a different spectrum has loaded", async () => {
    // The other ordering, and the one clearing alone cannot cover. A save is
    // still in flight when the user moves to another spectrum; it finishes
    // afterwards. Publishing it then would put "saved 1,000,000 points" beside a
    // measurement those points did not come from -- a confirmation that is worse
    // than none, because a reader has no way to tell it is about a spectrum that
    // is no longer on screen.
    let finishExport = (): void => undefined;
    const api = createFakePreviewApi({
      initialDatasets: [{ file: selectedFile, parents: [] }],
      spectrumExport: async (_token, format, settings) => {
        await new Promise<void>((resolve) => {
          finishExport = resolve;
        });
        return {
          status: "saved",
          format,
          fileName: `mscanvas-spectrum.${format}`,
          figure: fakeExportedFigure(settings, format),
          pointCount: FAKE_COMPLETE_SPECTRUM_POINTS,
        };
      },
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
    act(() => {
      result.current.selectSpectrum(0);
    });
    await waitFor(() => {
      expect(result.current.spectrum.status).toBe("loaded");
    });

    act(() => {
      result.current.exportSpectrum("csv");
    });
    await waitFor(() => {
      expect(result.current.spectrumExport.status).toBe("running");
    });

    // The user moves on while the write is still running.
    act(() => {
      result.current.selectSpectrum(1);
    });
    await waitFor(() => {
      expect(result.current.spectrum.status).toBe("loaded");
    });
    expect(result.current.spectrumExport.status).toBe("idle");

    await act(async () => {
      finishExport();
      await Promise.resolve();
    });

    // The file was written. It is simply not this spectrum's file, so this
    // spectrum says nothing about it.
    expect(result.current.spectrumExport.status).toBe("idle");
  });

  /** Drives one workspace to a loaded spectrum and answers with its hook. */
  async function loadedWorkspace(options: Parameters<typeof createFakePreviewApi>[0] = {}) {
    const api = createFakePreviewApi({
      initialDatasets: [{ file: selectedFile, parents: [] }],
      ...options,
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
    act(() => {
      result.current.selectSpectrum(0);
    });
    await waitFor(() => {
      expect(result.current.spectrum.status).toBe("loaded");
    });
    return { api, result };
  }

  it("sends the figure settings the user chose", async () => {
    const { api, result } = await loadedWorkspace();

    act(() => {
      result.current.setFigureSetting("widthPx", "800");
      result.current.setFigureSetting("heightPx", "600");
      result.current.setFigureSetting("pngDpi", "600");
      result.current.setFigureTheme("dark");
    });
    act(() => {
      result.current.exportSpectrum("png");
    });
    await waitFor(() => {
      expect(result.current.spectrumExport.status).toBe("saved");
    });

    expect(api.spectrumExportRequests).toEqual([
      {
        exportToken: "token-0",
        format: "png",
        settings: { widthPx: 800, heightPx: 600, pngDpi: 600, theme: "dark" },
      },
    ]);
  });

  it("copies the plot with the same token and settings a save would use", async () => {
    const { api, result } = await loadedWorkspace();

    act(() => {
      result.current.setFigureTheme("dark");
    });
    act(() => {
      result.current.copySpectrumPlot();
    });
    await waitFor(() => {
      expect(result.current.spectrumExport.status).toBe("copied");
    });

    // The token the loaded spectrum carries, and no path, no name, no format.
    expect(api.spectrumCopyRequests).toEqual([
      {
        exportToken: "token-0",
        settings: { widthPx: 1_200, heightPx: 640, pngDpi: 300, theme: "dark" },
      },
    ]);
    expect(api.spectrumExportRequests).toEqual([]);
  });

  it("starts no operation at all while the settings describe no figure", async () => {
    const { api, result } = await loadedWorkspace();

    act(() => {
      result.current.setFigureSetting("widthPx", "0");
    });
    expect(result.current.figureSettingsProblem).toBe("Width must be a whole number of at least 1.");
    expect(result.current.resolvedFigureSettings).toBeNull();

    act(() => {
      result.current.exportSpectrum("png");
      result.current.copySpectrumPlot();
    });

    // Nothing reached the boundary. A refusal Rust would have had to send back
    // is a round trip for something this side already knew.
    expect(api.spectrumExportRequests).toEqual([]);
    expect(api.spectrumCopyRequests).toEqual([]);
    expect(result.current.spectrumExport.status).toBe("idle");
  });

  it("keeps the settings an operation was started with when they change under it", async () => {
    let finish = (): void => undefined;
    const { api, result } = await loadedWorkspace({
      spectrumExport: async (_token, format, settings) => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return {
          status: "saved",
          format,
          fileName: `mscanvas-spectrum.${format}`,
          figure: fakeExportedFigure(settings, format),
          pointCount: FAKE_COMPLETE_SPECTRUM_POINTS,
        };
      },
    });

    act(() => {
      result.current.exportSpectrum("png");
    });
    await waitFor(() => {
      expect(result.current.spectrumExport.status).toBe("running");
    });

    // The user changes their mind while the dialog is open.
    act(() => {
      result.current.setFigureSetting("widthPx", "4000");
      result.current.setFigureTheme("dark");
    });
    await act(async () => {
      finish();
      await Promise.resolve();
    });

    // What was asked for is what was sent, and what came back describes it.
    expect(api.spectrumExportRequests[0]?.settings).toEqual(FAKE_FIGURE_SETTINGS);
    const outcome = result.current.spectrumExport;
    expect(outcome.status).toBe("saved");
    if (outcome.status === "saved") {
      expect(outcome.figure).toEqual({ width: 1_200, height: 640, dpi: 300, theme: "light" });
    }
  });

  it("drops a copy result that lands after a different spectrum has loaded", async () => {
    // The same binding discipline a save has. The clipboard was written, but a
    // "copied" message beside a spectrum those pixels did not come from would
    // say the wrong thing about what is on the clipboard.
    let finishCopy = (): void => undefined;
    const { result } = await loadedWorkspace({
      spectrumCopy: async (_token, settings) => {
        await new Promise<void>((resolve) => {
          finishCopy = resolve;
        });
        return {
          status: "copied",
          figure: fakeExportedFigure(settings, "png"),
          pointCount: FAKE_COMPLETE_SPECTRUM_POINTS,
        };
      },
    });

    act(() => {
      result.current.copySpectrumPlot();
    });
    await waitFor(() => {
      expect(result.current.spectrumExport.status).toBe("running");
    });

    act(() => {
      result.current.selectSpectrum(1);
    });
    await waitFor(() => {
      expect(result.current.spectrum.status).toBe("loaded");
    });
    expect(result.current.spectrumExport.status).toBe("idle");

    await act(async () => {
      finishCopy();
      await Promise.resolve();
    });

    expect(result.current.spectrumExport.status).toBe("idle");
  });

  it("carries a data export the same way whatever the figure is set to", async () => {
    // The transport is uniform, and Rust ignores what a data document has no
    // use for. What must not happen is a figure setting changing which
    // measurement, or how much of it, is written.
    const { api, result } = await loadedWorkspace();

    act(() => {
      result.current.exportSpectrum("csv");
    });
    await waitFor(() => {
      expect(result.current.spectrumExport.status).toBe("saved");
    });
    act(() => {
      result.current.setFigureSetting("widthPx", "4000");
      result.current.setFigureTheme("dark");
    });
    act(() => {
      result.current.exportSpectrum("csv");
    });
    await waitFor(() => {
      expect(api.spectrumExportRequests).toHaveLength(2);
    });

    const [first, second] = api.spectrumExportRequests;
    expect(first?.exportToken).toBe(second?.exportToken);
    expect(first?.format).toBe("csv");
    expect(second?.format).toBe("csv");
    // A data export reports no figure, whatever the figure settings are.
    const outcome = result.current.spectrumExport;
    if (outcome.status === "saved") {
      expect(outcome.figure).toBeNull();
    }
  });
});
