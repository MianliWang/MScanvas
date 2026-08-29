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
import { mzDomain } from "./viewer/spectrumViewport";
import {
  FAKE_COMPLETE_SPECTRUM_POINTS,
  FAKE_FIGURE_SETTINGS,
  FAKE_RETAINED_MZ_HIGH,
  FAKE_RETAINED_MZ_LOW,
  buildSpectrum,
  fakeExportedFigure,
  createFakePreviewApi,
  selectedFile,
  shimadzuDataset,
} from "../../test/previewFixtures";

/**
 * The range every case in this file exports over.
 *
 * A selected spectrum's export context starts at the full source and stays
 * there unless a reader chooses otherwise, so these cases -- all written before
 * ranges existed -- are full-source ones and still assert exactly what they
 * did. The scope is carried explicitly rather than left off, which is what
 * makes "a viewport did not reach this request" a thing the shape can say.
 */
const FULL_RANGE = { scope: "full", low: null, high: null } as const;

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
      { exportToken: bound, format: "csv", range: FULL_RANGE, settings: FAKE_FIGURE_SETTINGS },
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
    expect(saved.sourcePointCount).toBe(FAKE_COMPLETE_SPECTRUM_POINTS);
    const transferred =
      result.current.spectrum.status === "loaded" ? result.current.spectrum.spectrum.mz.length : 0;
    expect(saved.sourcePointCount).toBeGreaterThan(transferred);
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
      spectrumExport: async (_token, format, _range, settings) => {
        await new Promise<void>((resolve) => {
          finishExport = resolve;
        });
        return {
          status: "saved",
          format,
          fileName: `mscanvas-spectrum.${format}`,
          figure: fakeExportedFigure(settings, format),
          rangeScope: "full",
          rangeLow: null,
          rangeHigh: null,
          sourcePointCount: FAKE_COMPLETE_SPECTRUM_POINTS,
          exportedPointCount: FAKE_COMPLETE_SPECTRUM_POINTS,
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
    // Still running, because Rust is still writing. Moving to another spectrum
    // ends this export's claim on *this panel's words*, not its hold on the one
    // scientific lane -- and reporting the lane free here would re-offer every
    // export while a file is being written, which Rust refuses.
    expect(result.current.spectrumExport).toEqual({
      status: "running",
      operation: "csv",
      namesVisibleRun: false,
    });
    expect(result.current.scientificExportBusy).toBe(true);

    await act(async () => {
      finishExport();
      await Promise.resolve();
    });

    // The file was written. It is simply not this spectrum's file, so this
    // spectrum says nothing about it -- and the lane is free again, because the
    // operation that held it has ended.
    expect(result.current.spectrumExport.status).toBe("idle");
    expect(result.current.scientificExportBusy).toBe(false);
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
        range: FULL_RANGE,
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
        range: FULL_RANGE,
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
    expect(result.current.renderSettingsProblem).toBe(
      "Width must be a whole number of at least 1.",
    );
    expect(result.current.resolvedRenderSettings).toBeNull();
    // And the resolution beside it is untouched, because nothing is wrong with
    // it: the two questions are answered separately.
    expect(result.current.pngDpiProblem).toBeNull();
    expect(result.current.resolvedPngDpi).toBe(300);

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
      spectrumExport: async (_token, format, _range, settings) => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return {
          status: "saved",
          format,
          fileName: `mscanvas-spectrum.${format}`,
          figure: fakeExportedFigure(settings, format),
          rangeScope: "full",
          rangeLow: null,
          rangeHigh: null,
          sourcePointCount: FAKE_COMPLETE_SPECTRUM_POINTS,
          exportedPointCount: FAKE_COMPLETE_SPECTRUM_POINTS,
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
      spectrumCopy: async (_token, _range, settings) => {
        await new Promise<void>((resolve) => {
          finishCopy = resolve;
        });
        return {
          status: "copied",
          figure: fakeExportedFigure(settings, "png"),
          rangeScope: "full",
          rangeLow: null,
          rangeHigh: null,
          sourcePointCount: FAKE_COMPLETE_SPECTRUM_POINTS,
          exportedPointCount: FAKE_COMPLETE_SPECTRUM_POINTS,
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
    // A clipboard rasterization holds the lane exactly as a save does, and the
    // same rule applies: what the move ends is this panel's claim on it.
    expect(result.current.spectrumExport).toEqual({
      status: "running",
      operation: "copy",
      namesVisibleRun: false,
    });
    expect(result.current.scientificExportBusy).toBe(true);

    await act(async () => {
      finishCopy();
      await Promise.resolve();
    });

    expect(result.current.spectrumExport.status).toBe("idle");
    expect(result.current.scientificExportBusy).toBe(false);
  });

  it("still exports data while the figure settings describe no figure", async () => {
    // The panel deliberately leaves the data actions live when a width is
    // unusable, because a size and a theme are not properties of a measurement.
    // An enabled button that silently does nothing is worse than either
    // offering it or closing it.
    const { api, result } = await loadedWorkspace();

    act(() => {
      result.current.setFigureSetting("widthPx", "0");
    });
    expect(result.current.resolvedRenderSettings).toBeNull();

    act(() => {
      result.current.exportSpectrum("csv");
    });
    await waitFor(() => {
      expect(result.current.spectrumExport.status).toBe("saved");
    });
    expect(api.spectrumExportRequests.map((request) => request.format)).toEqual(["csv"]);

    // The figure actions are still refused, because there is no figure.
    act(() => {
      result.current.exportSpectrum("png");
      result.current.copySpectrumPlot();
    });
    expect(api.spectrumExportRequests).toHaveLength(1);
    expect(api.spectrumCopyRequests).toEqual([]);
  });

  it("sends the SVG and the copy while only the resolution is unusable", async () => {
    // The Round-2 finding, at the boundary rather than at the button. DPI is
    // written into one format's metadata and read by nothing else, so an
    // unusable one must leave every other output exactly where it was --
    // proven by activating them and reading what actually crossed, not by
    // checking whether a button was enabled.
    const { api, result } = await loadedWorkspace();

    act(() => {
      result.current.setFigureSetting("pngDpi", "");
    });
    expect(result.current.pngDpiProblem).toBe("PNG DPI must be a whole number of at least 1.");
    expect(result.current.resolvedPngDpi).toBeNull();
    // The figure itself is undisturbed.
    expect(result.current.renderSettingsProblem).toBeNull();
    expect(result.current.resolvedRenderSettings).toEqual({
      widthPx: 1_200,
      heightPx: 640,
      theme: "light",
    });

    act(() => {
      result.current.exportSpectrum("svg");
    });
    await waitFor(() => {
      expect(result.current.spectrumExport.status).toBe("saved");
    });
    act(() => {
      result.current.dismissSpectrumExport();
    });
    act(() => {
      result.current.copySpectrumPlot();
    });
    await waitFor(() => {
      expect(result.current.spectrumExport.status).toBe("copied");
    });

    // Both crossed, and both carried the figure that was asked for. The
    // resolution they travel with is the default stand-in the uniform
    // transport needs and neither output reads.
    expect(api.spectrumExportRequests).toEqual([
      { exportToken: "token-0", format: "svg", range: FULL_RANGE, settings: FAKE_FIGURE_SETTINGS },
    ]);
    expect(api.spectrumCopyRequests).toEqual([
      { exportToken: "token-0", range: FULL_RANGE, settings: FAKE_FIGURE_SETTINGS },
    ]);
  });

  it("sends a resolution only Rust can judge, and lets Rust judge it", async () => {
    // The division of labour, stated as a test. 50 is a whole positive number,
    // so this side has nothing to say about it; whether a PNG can record it is
    // a bound Rust holds, and duplicating that bound here would be a second
    // copy to drift. So every operation crosses, carrying the number that was
    // typed -- and the one that writes it is the one Rust refuses.
    const { api, result } = await loadedWorkspace();

    act(() => {
      result.current.setFigureSetting("pngDpi", "50");
    });
    expect(result.current.pngDpiProblem).toBeNull();
    expect(result.current.resolvedPngDpi).toBe(50);

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
        range: FULL_RANGE,
        settings: { widthPx: 1_200, heightPx: 640, pngDpi: 50, theme: "light" },
      },
    ]);
  });

  it("starts no PNG export while the resolution is unusable", async () => {
    // The other half. The one output that writes the number is the one the
    // number closes, and it is closed here rather than by a refusal Rust would
    // have to send back.
    const { api, result } = await loadedWorkspace();

    act(() => {
      result.current.setFigureSetting("pngDpi", "0");
    });
    act(() => {
      result.current.exportSpectrum("png");
    });

    expect(api.spectrumExportRequests).toEqual([]);
    expect(result.current.spectrumExport.status).toBe("idle");
  });

  it("says what was copied without claiming a resolution the clipboard has none of", async () => {
    // A clipboard image is RGBA, a width and a height. There is no `pHYs`
    // chunk and nowhere for one, so a confirmation naming a DPI would describe
    // a property the artifact does not have -- and would go on saying 300
    // while the user changed the field, because nothing ever read it.
    const { result } = await loadedWorkspace();

    act(() => {
      result.current.setFigureSetting("pngDpi", "600");
    });
    act(() => {
      result.current.copySpectrumPlot();
    });
    await waitFor(() => {
      expect(result.current.spectrumExport.status).toBe("copied");
    });

    const outcome = result.current.spectrumExport;
    expect(outcome.status).toBe("copied");
    if (outcome.status === "copied") {
      expect(outcome.figure).toEqual({ width: 1_200, height: 640, theme: "light" });
      expect(outcome.figure).not.toHaveProperty("dpi");
    }
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

/**
 * Which range a selected-spectrum export is taken over, and whose it is.
 *
 * The scope belongs to one spectrum's export context, so every case here is a
 * way that ownership could be lost: a choice following a different spectrum, a
 * choice surviving a viewport that stopped admitting one, or a screen state
 * deciding whether a scientific export may happen at all.
 */
describe("the selected spectrum's export range", () => {
  /** One workspace with a spectrum loaded, and the fake it is talking to. */
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

  /**
   * Waits until the loaded spectrum's viewport is the admitted one.
   *
   * The fixture spectrum carries an admitted domain, so this is the ordinary
   * path rather than a state these tests arrange: what it waits for is the
   * reducer having been told, not a viewport being forced into existence.
   */
  async function admitViewport(
    result: { readonly current: ReturnType<typeof usePreviewWorkspace> },
    { settle = true }: { readonly settle?: boolean } = {},
  ): Promise<void> {
    await waitFor(() => {
      expect(result.current.spectrumRangeAvailability).toBe("available");
    });
    if (settle) {
      await waitFor(() => {
        const viewport = result.current.spectrumViewport;
        expect(viewport.status === "ready" ? viewport.projection.status : null).toBe("ready");
      });
    }
  }

  it("starts at the full source, carrying no window", async () => {
    const { api, result } = await loadedWorkspace();

    expect(result.current.spectrumRangeScope).toBe("full");
    act(() => {
      result.current.exportSpectrum("csv");
    });
    await waitFor(() => {
      expect(api.spectrumExportRequests).toHaveLength(1);
    });
    expect(api.spectrumExportRequests[0]?.range).toEqual(FULL_RANGE);
  });

  it("sends the committed window once the current range is chosen", async () => {
    const { api, result } = await loadedWorkspace();
    await admitViewport(result);

    act(() => {
      result.current.dispatchSpectrumViewportEvent({
        type: "viewport-step",
        domain: mzDomain(301.5, 303.5),
      });
    });
    act(() => {
      result.current.setSpectrumRangeScope("current");
    });
    act(() => {
      result.current.exportSpectrum("csv");
    });
    await waitFor(() => {
      expect(api.spectrumExportRequests).toHaveLength(1);
    });

    expect(api.spectrumExportRequests[0]?.range).toEqual({
      scope: "current",
      low: 301.5,
      high: 303.5,
    });
  });

  it("sends a null window while nothing narrower is committed", async () => {
    // A real state rather than a missing answer: Rust resolves it from the
    // domain it retained. Nothing here invents a subrange to fill it.
    const { api, result } = await loadedWorkspace();
    await admitViewport(result);

    act(() => {
      result.current.setSpectrumRangeScope("current");
    });
    act(() => {
      result.current.copySpectrumPlot();
    });
    await waitFor(() => {
      expect(api.spectrumCopyRequests).toHaveLength(1);
    });

    expect(api.spectrumCopyRequests[0]?.range).toEqual({
      scope: "current",
      low: null,
      high: null,
    });
  });

  it("reports the resolved domain when a whole-spectrum range is exported", async () => {
    // A current request with nothing committed carries a null pair, and Rust
    // answers it from the retained domain -- so the outcome always names one.
    // The sentence a reader gets is therefore the full "N of M, m/z X to Y"
    // one, not a range with no bounds in it.
    const { api, result } = await loadedWorkspace();
    await admitViewport(result);
    act(() => {
      result.current.setSpectrumRangeScope("current");
    });
    act(() => {
      result.current.exportSpectrum("csv");
    });
    await waitFor(() => {
      expect(result.current.spectrumExport.status).toBe("saved");
    });

    expect(api.spectrumExportRequests[0]?.range).toEqual({
      scope: "current",
      low: null,
      high: null,
    });
    const outcome = result.current.spectrumExport;
    if (outcome.status !== "saved") {
      throw new Error("the export resolved to something other than a saved file");
    }
    expect(outcome.rangeScope).toBe("current");
    // Resolved, never echoed back as the null it was asked with.
    expect(outcome.rangeLow).toBe(FAKE_RETAINED_MZ_LOW);
    expect(outcome.rangeHigh).toBe(FAKE_RETAINED_MZ_HIGH);
    expect(outcome.exportedPointCount).toBe(outcome.sourcePointCount);
  });

  it("distinguishes a spectrum with no peaks from one with no viewport", async () => {
    const { result } = await loadedWorkspace({
      spectrum: (index) =>
        Promise.resolve({
          outcome: "spectrum",
          spectrum: { ...buildSpectrum(index, 0), pointCount: 0, mz: [], intensity: [] },
        }),
    });

    // An empty spectrum's domain is admitted and zero wide, so this document
    // publishes no viewport for it -- and that is not the figure contract
    // refusing anything.
    await waitFor(() => {
      expect(result.current.spectrumRangeAvailability).toBe("noPeaks");
    });
    expect(result.current.spectrumRangeScope).toBe("full");
  });

  it("exports the last committed window while a gesture is still moving", async () => {
    // A gesture is a drawing rather than a decision. Exporting over one neither
    // settles it nor cancels it, and what is written is what was last settled.
    const { api, result } = await loadedWorkspace();
    await admitViewport(result);

    act(() => {
      result.current.dispatchSpectrumViewportEvent({
        type: "viewport-step",
        domain: mzDomain(301.5, 303.5),
      });
    });
    let epoch = 0;
    act(() => {
      const started = result.current.dispatchSpectrumViewportEvent({
        type: "gesture-started",
        domain: mzDomain(304, 305),
      });
      epoch = started.status === "ready" ? (started.gesture?.epoch ?? 0) : 0;
    });
    act(() => {
      result.current.dispatchSpectrumViewportEvent({
        type: "gesture-moved",
        epoch,
        domain: mzDomain(304.5, 305.5),
      });
    });

    act(() => {
      result.current.setSpectrumRangeScope("current");
    });
    act(() => {
      result.current.exportSpectrum("tsv");
    });
    await waitFor(() => {
      expect(api.spectrumExportRequests).toHaveLength(1);
    });

    expect(api.spectrumExportRequests[0]?.range).toEqual({
      scope: "current",
      low: 301.5,
      high: 303.5,
    });
    // And the gesture is exactly where it was: it was not settled by having
    // been exported over.
    const viewport = result.current.spectrumViewport;
    expect(viewport.status === "ready" ? viewport.gesture?.epoch : null).toBe(epoch);
  });

  it("takes a newly committed window immediately, before any drawing succeeds", async () => {
    const { api, result } = await loadedWorkspace({
      // Every projection fails, so no drawing for this window ever arrives.
      spectrumProjection: () => Promise.reject(new Error("the screen cannot draw this")),
    });
    await admitViewport(result, { settle: false });

    act(() => {
      result.current.dispatchSpectrumViewportEvent({
        type: "viewport-step",
        domain: mzDomain(301.5, 303.5),
      });
    });
    act(() => {
      result.current.setSpectrumRangeScope("current");
    });
    act(() => {
      result.current.exportSpectrum("csv");
    });
    await waitFor(() => {
      expect(api.spectrumExportRequests).toHaveLength(1);
    });

    // The committed window is the authority, and it was committed the moment
    // the reader settled it -- not when a screen agreed to draw it.
    expect(api.spectrumExportRequests[0]?.range).toEqual({
      scope: "current",
      low: 301.5,
      high: 303.5,
    });
  });

  it("keeps the current range available while a projection is loading or failed", async () => {
    // A failed drawing is not empty science. The export reads the retained
    // source and the committed window, neither of which the screen owns.
    let failProjection = (): void => undefined;
    const { api, result } = await loadedWorkspace({
      spectrumProjection: () =>
        new Promise((_resolve, reject) => {
          failProjection = () => {
            reject(new Error("the screen cannot draw this"));
          };
        }),
    });
    await admitViewport(result, { settle: false });

    // Loading.
    expect(result.current.spectrumRangeAvailability).toBe("available");
    act(() => {
      result.current.setSpectrumRangeScope("current");
    });
    expect(result.current.spectrumRangeScope).toBe("current");

    // Failed.
    await act(async () => {
      failProjection();
      await Promise.resolve();
    });
    expect(result.current.spectrumRangeAvailability).toBe("available");
    expect(result.current.spectrumRangeScope).toBe("current");

    act(() => {
      result.current.exportSpectrum("csv");
    });
    await waitFor(() => {
      expect(api.spectrumExportRequests).toHaveLength(1);
    });
    expect(api.spectrumExportRequests[0]?.range.scope).toBe("current");
  });

  it("offers no current range for a spectrum whose viewport is refused", async () => {
    // Rust's verdict about this spectrum, arriving with the spectrum -- not a
    // state dispatched over the top of one that has a domain.
    const { api, result } = await loadedWorkspace({
      spectrum: (index) =>
        Promise.resolve({
          outcome: "spectrum",
          spectrum: {
            ...buildSpectrum(index, 12),
            viewportDomain: { state: "refused", reason: "sourceNotOrdered" },
          },
        }),
    });
    await waitFor(() => {
      expect(result.current.spectrumViewport.status).toBe("refused");
    });

    expect(result.current.spectrumRangeAvailability).toBe("noViewport");
    expect(result.current.spectrumRangeScope).toBe("full");
    // And the full-source export is exactly as available as ever: a viewport
    // refusal is a fact about drawability, never about the source.
    act(() => {
      result.current.exportSpectrum("csv");
    });
    await waitFor(() => {
      expect(api.spectrumExportRequests).toHaveLength(1);
    });
    expect(api.spectrumExportRequests[0]?.range).toEqual(FULL_RANGE);
  });

  it("returns to the full source when a viewport stops being admitted", async () => {
    const { result } = await loadedWorkspace();
    await admitViewport(result);
    act(() => {
      result.current.setSpectrumRangeScope("current");
    });
    expect(result.current.spectrumRangeScope).toBe("current");

    act(() => {
      result.current.dispatchSpectrumViewportEvent({
        type: "spectrum-selected",
        spectrumToken: "token-refused",
        domain: { state: "refused", reason: "sourceNotOrdered" },
      });
    });

    expect(result.current.spectrumRangeAvailability).toBe("noViewport");
    expect(result.current.spectrumRangeScope).toBe("full");
  });

  it("does not resurrect a hidden choice when a viewport is admitted again", async () => {
    const { result } = await loadedWorkspace();
    await admitViewport(result);
    act(() => {
      result.current.setSpectrumRangeScope("current");
    });
    act(() => {
      result.current.dispatchSpectrumViewportEvent({
        type: "spectrum-selected",
        spectrumToken: "token-refused",
        domain: { state: "refused", reason: "sourceNotOrdered" },
      });
    });
    act(() => {
      result.current.dispatchSpectrumViewportEvent({
        type: "spectrum-selected",
        spectrumToken: "token-admitted-again",
        domain: { state: "admitted", low: 100, high: 400 },
      });
    });

    // A choice the reader had no way to see they still had is not a choice.
    expect(result.current.spectrumRangeAvailability).toBe("available");
    expect(result.current.spectrumRangeScope).toBe("full");
  });

  it("survives an ordinary zoom, pan and reset of the same spectrum", async () => {
    // Moving a window is not choosing a different scope.
    const { result } = await loadedWorkspace();
    await admitViewport(result);
    act(() => {
      result.current.setSpectrumRangeScope("current");
    });

    for (const event of [
      { type: "viewport-step", domain: mzDomain(120, 140) },
      { type: "viewport-step", domain: mzDomain(160, 180) },
      { type: "viewport-reset" },
    ] as const) {
      act(() => {
        result.current.dispatchSpectrumViewportEvent(event);
      });
      expect(result.current.spectrumRangeScope).toBe("current");
    }
  });

  it("starts a newly selected spectrum's own context at the full source", async () => {
    // A `Current` chosen for one spectrum must not follow another, whose
    // committed window and admitted domain are not the first one's.
    const { api, result } = await loadedWorkspace();
    await admitViewport(result);
    act(() => {
      result.current.setSpectrumRangeScope("current");
    });
    expect(result.current.spectrumRangeScope).toBe("current");

    act(() => {
      result.current.selectSpectrum(1);
    });
    await waitFor(() => {
      expect(result.current.spectrum.status).toBe("loaded");
    });

    expect(result.current.spectrumRangeScope).toBe("full");
    act(() => {
      result.current.exportSpectrum("csv");
    });
    await waitFor(() => {
      expect(api.spectrumExportRequests).toHaveLength(1);
    });
    expect(api.spectrumExportRequests[0]?.range).toEqual(FULL_RANGE);
  });

  it("publishes the range Rust resolved rather than one read back afterwards", async () => {
    let finish = (): void => undefined;
    const { result } = await loadedWorkspace({
      spectrumExport: async (_token, format, range) => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return {
          status: "saved",
          format,
          fileName: `mscanvas-spectrum-current.${format}`,
          figure: null,
          rangeScope: "current",
          rangeLow: range.low ?? 0,
          rangeHigh: range.high ?? 0,
          sourcePointCount: FAKE_COMPLETE_SPECTRUM_POINTS,
          exportedPointCount: 7,
        };
      },
    });
    await admitViewport(result);
    act(() => {
      result.current.dispatchSpectrumViewportEvent({
        type: "viewport-step",
        domain: mzDomain(301.5, 303.5),
      });
    });
    act(() => {
      result.current.setSpectrumRangeScope("current");
    });
    act(() => {
      result.current.exportSpectrum("csv");
    });
    await waitFor(() => {
      expect(result.current.spectrumExport.status).toBe("running");
    });

    // The reader moves the viewport while the save dialog is open.
    act(() => {
      result.current.dispatchSpectrumViewportEvent({
        type: "viewport-step",
        domain: mzDomain(304.5, 305.5),
      });
    });
    await act(async () => {
      finish();
      await Promise.resolve();
    });

    const outcome = result.current.spectrumExport;
    expect(outcome.status).toBe("saved");
    if (outcome.status === "saved") {
      // The window the export began on, which is what the file holds.
      expect(outcome.rangeLow).toBe(301.5);
      expect(outcome.rangeHigh).toBe(303.5);
      expect(outcome.exportedPointCount).toBe(7);
      expect(outcome.sourcePointCount).toBe(FAKE_COMPLETE_SPECTRUM_POINTS);
    }
    // While what the *next* export would cover has moved on, as it should.
    expect(result.current.spectrumCommittedDomain).toEqual({ low: 304.5, high: 305.5 });
  });

  it("leaves the linked figure's range to the chromatogram", async () => {
    // ADR 0036: the linked figure's lower panel is the complete selected
    // spectrum. Choosing a spectrum range says nothing about it, and the linked
    // request carries the chromatogram's range and no other.
    const { api, result } = await loadedWorkspace();
    await admitViewport(result);
    act(() => {
      result.current.dispatchSpectrumViewportEvent({
        type: "viewport-step",
        domain: mzDomain(301.5, 303.5),
      });
    });
    act(() => {
      result.current.setSpectrumRangeScope("current");
    });

    act(() => {
      result.current.exportLinkedFigure("svg");
    });
    await waitFor(() => {
      expect(api.linkedFigureRequests).toHaveLength(1);
    });

    const request = api.linkedFigureRequests[0];
    expect(request?.range).toEqual({ scope: "full", low: null, high: null });
    expect(Object.keys(request ?? {}).sort()).toEqual([
      "chromatogramToken",
      "format",
      "range",
      "settings",
      "spectrumToken",
      "traces",
    ]);
    // No m/z number reached it, under any key.
    expect(JSON.stringify(request)).not.toContain("301.5");
    expect(JSON.stringify(request)).not.toContain("303.5");
  });
});
