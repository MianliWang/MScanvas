import { UI_RESOURCES } from "../features/preferences/i18n";
/**
 * The linked chromatogram + spectrum figure, through the shipped composition.
 *
 * It is reached from the chromatogram's ⋯ menu ("Linked figure…"), which opens
 * the figure dialog for the pair; what it writes is said under the chromatogram
 * in a status region of its own. Availability in the menu (no scan, loading, no
 * trace, outside the range, too short) is asserted in M74FigureComposition.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PreviewApi } from "../features/mzml-preview/api";
import { PreviewApiProvider } from "../features/mzml-preview/api";
import { WorkspaceDropTransportProvider } from "../features/mzml-preview/dropTransport";
import {
  FAKE_COMPLETE_SCAN_COUNT,
  buildPreview,
  createFakePreviewApi,
  createFakeWorkspaceDropTransport,
  selectedFile,
} from "../test/previewFixtures";
import { App } from "./App";

const en = UI_RESOURCES.en;
const SCAN_COUNT = 200;
const SETTLING = { timeout: 15_000 } as const;

const NativeUrl = URL;
beforeEach(() => {
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  // The figure dialog draws its preview from an object URL, which jsdom lacks.
  vi.stubGlobal("URL", class extends NativeUrl { static createObjectURL = () => "blob:mock-figure"; static revokeObjectURL = vi.fn(); });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function api(options: Parameters<typeof createFakePreviewApi>[0] = {}): ReturnType<typeof createFakePreviewApi> {
  return createFakePreviewApi({ initialDatasets: [selectedFile], preview: buildPreview(SCAN_COUNT), ...options });
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
}

function panel(): HTMLElement {
  return document.querySelector("section.chromatogram-panel") as HTMLElement;
}

function spectrumPanel(): HTMLElement {
  return document.querySelector("section.spectrum-panel") as HTMLElement;
}

function status(name: string): string {
  return within(panel()).getByRole("status", { name }).textContent ?? "";
}

function linkedStatus(): string {
  return status(en.viewerLinkedStatus);
}

async function selectAScan(row = 1): Promise<void> {
  const grid = screen.getByRole("grid", { name: "Spectra" });
  fireEvent.click(within(grid).getAllByRole("row")[row] as HTMLElement);
  await waitFor(() => {
    expect(within(spectrumPanel()).queryByRole("button", { name: en.viewerCopy })).not.toBeNull();
  }, SETTLING);
}

/** Opens the linked figure dialog from the chromatogram's ⋯ menu, with its preview drawn. */
async function openLinked(): Promise<HTMLElement> {
  fireEvent.keyDown(within(panel()).getByRole("button", { name: en.plotMoreExports }), { key: "Enter" });
  fireEvent.click(await screen.findByRole("menuitem", { name: new RegExp("^" + en.figurePreviewLinked, "u") }));
  const dialog = screen.getByRole("dialog");
  await within(dialog).findByRole("img");
  return dialog;
}

/** Presses one of the dialog's actions once it is offered. */
async function press(dialog: HTMLElement, name: string): Promise<void> {
  const action = within(dialog).getByRole("button", { name });
  await waitFor(() => expect(action).not.toHaveAttribute("aria-disabled", "true"));
  fireEvent.click(action);
}

async function closeDialog(dialog: HTMLElement): Promise<void> {
  fireEvent.click(within(dialog).getByRole("button", { name: "Return to viewer" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
}

describe("the linked chromatogram and spectrum figure", () => {
  it("sends the pair, the range and the visible traces once a scan is ready", async () => {
    const preview = api();
    await openTheViewer(preview);
    await selectAScan();

    const dialog = await openLinked();
    await press(dialog, "Export SVG…");

    await waitFor(() => expect(preview.linkedFigureRequests).toHaveLength(1));
    expect(preview.linkedFigureRequests[0]).toEqual({
      chromatogramToken: "chromatogram-token",
      spectrumToken: "token-0",
      format: "svg",
      range: { scope: "full", low: null, high: null },
      // The viewer opens with TIC alone.
      traces: { tic: true, bpc: false },
      settings: { widthPx: 1_200, heightPx: 640, pngDpi: 300, theme: "light" },
    });
    // The linked figure is its own action: neither single-source export ran.
    expect(preview.chromatogramExportRequests).toEqual([]);
    expect(preview.spectrumExportRequests).toEqual([]);
  });

  it("draws whichever traces are on screen", async () => {
    const preview = api();
    await openTheViewer(preview);
    await selectAScan();
    fireEvent.click(within(panel()).getByRole("button", { name: "BPC" }));
    fireEvent.click(within(panel()).getByRole("button", { name: "TIC" }));

    await press(await openLinked(), "Export SVG…");

    await waitFor(() => expect(preview.linkedFigureRequests).toHaveLength(1));
    expect(preview.linkedFigureRequests[0]?.traces).toEqual({ tic: false, bpc: true });
  });

  it("carries the current range when the dialog asks for it", async () => {
    const preview = api();
    await openTheViewer(preview);
    await selectAScan();

    const dialog = await openLinked();
    fireEvent.click(within(dialog).getByRole("radio", { name: "Current range" }));
    await within(dialog).findByRole("img");
    await press(dialog, "Export SVG…");

    await waitFor(() => expect(preview.linkedFigureRequests).toHaveLength(1));
    // Nothing has been committed, so the current range is the whole run.
    expect(preview.linkedFigureRequests[0]?.range).toEqual({ scope: "current", low: null, high: null });
  });
});

describe("what a finished linked export says", () => {
  it("names the file, the scan it marked and the run it came from, under the chromatogram", async () => {
    const preview = api();
    await openTheViewer(preview);
    await selectAScan();

    const dialog = await openLinked();
    await press(dialog, "Export SVG…");
    await waitFor(() => expect(preview.linkedFigureRequests).toHaveLength(1));
    await closeDialog(dialog);

    await waitFor(() => expect(linkedStatus()).toContain("mscanvas-linked-spectrum-0-full.svg"));
    const said = linkedStatus();
    expect(said).toContain("marking spectrum 0");
    expect(said).toContain("at retention time 0.0125");
    expect(said).toContain(`in a run of ${FAKE_COMPLETE_SCAN_COUNT.toLocaleString("en-US")} scans`);
    expect(status(en.viewerChromatogramExportStatus)).toBe("");

    fireEvent.click(within(panel()).getByRole("button", { name: en.viewerLinkedDismiss }));
    expect(linkedStatus()).toBe("");
  });

  it("says a cancelled linked export saved nothing", async () => {
    const preview = api({ linkedFigureExport: async () => ({ status: "cancelled" }) });
    await openTheViewer(preview);
    await selectAScan();

    const dialog = await openLinked();
    await press(dialog, "Export PNG…");
    await waitFor(() => expect(preview.linkedFigureRequests).toHaveLength(1));
    await closeDialog(dialog);

    await waitFor(() => expect(linkedStatus()).toContain("Export cancelled. Nothing was saved."));
  });

  it("localizes a known typed refusal, and reads out the part the user has to act on", async () => {
    const residue = "A temporary file .mscanvas-export-7 was left in the folder.";
    const preview = api({
      linkedFigureExport: () => Promise.reject({
        kind: "spectrum_not_written",
        summary: "The linked figure could not be written.",
        detail: residue,
        retryable: true,
      }),
    });
    await openTheViewer(preview);
    await selectAScan();

    const dialog = await openLinked();
    await press(dialog, "Export SVG…");
    await waitFor(() => expect(preview.linkedFigureRequests).toHaveLength(1));
    await closeDialog(dialog);

    await waitFor(() => expect(linkedStatus()).toContain(en.m74ErrorNotWritten));
    expect(linkedStatus()).toContain(residue);
    expect(within(panel()).getByText(residue)).toHaveClass("notice-detail");
  });

  it("names the figure it put on the clipboard", async () => {
    const preview = api();
    await openTheViewer(preview);
    await selectAScan();

    const dialog = await openLinked();
    await press(dialog, "Copy plot");
    await waitFor(() => expect(preview.linkedFigureCopyRequests).toHaveLength(1));
    await closeDialog(dialog);

    await waitFor(() => expect(linkedStatus()).toContain("Copied linked figure: 1200×640, Light theme"));
    expect(linkedStatus()).toContain("spectrum 0 marked");
    expect(preview.linkedFigureRequests).toEqual([]);
  });

  it("writes the marked scan's canonical retention time without display rounding", async () => {
    const preview = api({
      linkedFigureExport: async (_chromatogram, _spectrum, format, range, traces, settings) => ({
        status: "saved", format, fileName: `mscanvas-linked-spectrum-0-${range.scope}.${format}`,
        figure: { width: settings.widthPx, height: settings.heightPx, dpi: null, theme: settings.theme }, traces,
        rangeScope: range.scope, rangeLow: 0, rangeHigh: 2.5, sourceScanCount: 24, selectedIndex: 0, selectedRetentionTime: 0.1,
      }),
    });
    await openTheViewer(preview);
    await selectAScan();

    const dialog = await openLinked();
    await press(dialog, "Export SVG…");
    await closeDialog(dialog);

    await waitFor(() => expect(linkedStatus()).toContain("Saved"));
    expect(linkedStatus()).toContain("at retention time 0.1 ");
    expect(linkedStatus()).not.toContain("at retention time 0.1000");
  });
});

describe("the one scientific export lane, and a linked export that outlives its pair", () => {
  it("refuses both plots' figure actions while a linked figure is being written, and then forgets it", async () => {
    let release: () => void = () => undefined;
    const preview = api({
      linkedFigureExport: () => new Promise((resolve) => { release = () => { resolve({ status: "cancelled" }); }; }),
    });
    await openTheViewer(preview);
    await selectAScan();

    const dialog = await openLinked();
    await press(dialog, "Export SVG…");
    await waitFor(() => expect(preview.linkedFigureRequests).toHaveLength(1));
    await closeDialog(dialog);

    for (const box of [panel(), spectrumPanel()]) {
      expect(within(box).getByRole("button", { name: en.figureQuickPng })).toHaveAttribute("aria-disabled", "true");
    }
    // Another scan: the export still holds the lane, but it no longer names
    // the pair on screen, so its result is not said about this one.
    await selectAScan(3);
    act(() => { release(); });
    await waitFor(() => {
      expect(within(panel()).getByRole("button", { name: en.figureQuickPng })).not.toHaveAttribute("aria-disabled");
    });
    expect(linkedStatus()).toBe("");
  });
});

describe("two results in one plot", () => {
  it("gives each dismiss control its own name, and clears only its own message", async () => {
    const preview = api();
    await openTheViewer(preview);
    await selectAScan();

    fireEvent.keyDown(within(panel()).getByRole("button", { name: en.plotMoreExports }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Export CSV…" }));
    await waitFor(() => expect(status(en.viewerChromatogramExportStatus)).toContain("Saved"));
    const dialog = await openLinked();
    await press(dialog, "Export SVG…");
    await closeDialog(dialog);
    await waitFor(() => expect(linkedStatus()).toContain("Saved"));

    const chromatogramDismiss = within(panel()).getByRole("button", { name: en.viewerDismiss });
    const linkedDismiss = within(panel()).getByRole("button", { name: en.viewerLinkedDismiss });
    expect(chromatogramDismiss).not.toBe(linkedDismiss);

    fireEvent.click(linkedDismiss);
    expect(linkedStatus()).toBe("");
    expect(status(en.viewerChromatogramExportStatus)).toContain("Saved");

    fireEvent.click(chromatogramDismiss);
    expect(status(en.viewerChromatogramExportStatus)).toBe("");
  });
});
