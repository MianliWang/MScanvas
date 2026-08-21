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
    expect(api.spectrumExportRequests).toEqual([{ exportToken: bound, format: "csv" }]);
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
      spectrumExport: async (_token, format) => {
        await new Promise<void>((resolve) => {
          finishExport = resolve;
        });
        return {
          status: "saved",
          format,
          fileName: `mscanvas-spectrum.${format}`,
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
      expect(result.current.spectrumExport.status).toBe("exporting");
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
});
