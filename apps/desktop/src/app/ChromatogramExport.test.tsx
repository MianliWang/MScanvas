import { UI_RESOURCES } from "../features/preferences/i18n";
/**
 * What the run on screen can be exported as, through the shipped composition.
 *
 * Mounted as the document rather than as a harness, because the questions worth
 * asking are about what the workspace hands the chromatogram's head: which
 * token, which range, which traces, and whether the one scientific export lane
 * is respected. PNG and Copy are in the head, CSV and TSV under its ⋯ menu, and
 * range and size in the figure dialog.
 *
 * The one rule under all of it: **nothing here is the science.** Every number
 * this surface sends is a request, and the assertions below are about what
 * crossed the boundary -- never about arrays this document holds.
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
  shimadzuDataset,
} from "../test/previewFixtures";
import { App } from "./App";

const en = UI_RESOURCES.en;

/** Enough scans that a range can hold some of them and not others. */
const SCAN_COUNT = 200;
const RT_STEP = 0.0125;
const PLOT_PIXELS = 1_000;
const PADDING_LEFT = 64;
const DRAWN_WIDTH = PLOT_PIXELS - PADDING_LEFT - 12;
const SETTLING = { timeout: 15_000 } as const;

const VENDOR_ROW = shimadzuDataset(1);

const NativeUrl = URL;
beforeEach(() => {
  // The figure dialog draws its preview from an object URL, which jsdom lacks.
  vi.stubGlobal("URL", class extends NativeUrl { static createObjectURL = () => "blob:mock-figure"; static revokeObjectURL = vi.fn(); });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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
  fireEvent.keyDown(await screen.findByRole("treegrid", {}, SETTLING), { key: "Enter" });
  await screen.findByRole("grid", { name: "Scans" }, SETTLING);
  await screen.findByRole("img", { name: "Chromatogram" }, SETTLING);
  vi.spyOn(plot(), "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: PLOT_PIXELS, bottom: 210, width: PLOT_PIXELS, height: 210, toJSON: () => ({}),
  } as DOMRect);
}

function plot(): HTMLElement {
  return screen.getByRole("img", { name: "Chromatogram" });
}

/** The chromatogram's plot box. */
function panel(): HTMLElement {
  return document.querySelector("section.chromatogram-panel") as HTMLElement;
}

/** The selected spectrum's plot box, which shares the one export lane. */
function spectrumPanel(): HTMLElement {
  return document.querySelector("section.spectrum-panel") as HTMLElement;
}

/** A head control of a plot box, scoped so the two plots' identically named actions never mix. */
function head(name: string, box: HTMLElement = panel()): HTMLButtonElement {
  return within(box).getByRole("button", { name }) as HTMLButtonElement;
}

/** A data format under a plot box's ⋯ menu, opening the menu if it is closed. */
async function data(format: "CSV" | "TSV", box: HTMLElement = panel()): Promise<HTMLElement> {
  if (screen.queryByRole("menu") === null) fireEvent.keyDown(head(en.plotMoreExports, box), { key: "Enter" });
  return screen.findByRole("menuitem", { name: `Export ${format}…` });
}

/** Closes an open ⋯ menu. */
async function closeMenu(): Promise<void> {
  const menu = screen.queryByRole("menu");
  if (menu === null) return;
  fireEvent.keyDown(menu, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
}

function refused(control: HTMLElement): boolean {
  return control.getAttribute("aria-disabled") === "true";
}

/** A figure action under a plot box's ⋯ menu (Quick PNG, Copy plot: direction A), from a freshly opened menu. */
async function figure(name: string, box: HTMLElement = panel()): Promise<HTMLElement> {
  await closeMenu();
  fireEvent.keyDown(head(en.plotMoreExports, box), { key: "Enter" });
  return screen.findByRole("menuitem", { name });
}

/** Whether a figure action is refused right now; the menu is closed again after reading it. */
async function figureRefused(name: string, box: HTMLElement = panel()): Promise<boolean> {
  const result = refused(await figure(name, box));
  await closeMenu();
  return result;
}

/** What this panel's own live region currently says. */
function exportStatus(): string {
  return within(panel()).getByRole("status", { name: "Chromatogram export status" }).textContent ?? "";
}

/** Changes the chromatogram's figure settings or scope where they live: its figure dialog. */
async function inTheDialog(change: (dialog: HTMLElement) => void): Promise<void> {
  fireEvent.click(head(en.figureExportTitle));
  const dialog = screen.getByRole("dialog");
  change(dialog);
  fireEvent.click(within(dialog).getByRole("button", { name: "Return to viewer" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
}

/** Where a retention time falls in client pixels, for the range on screen. */
function clientXFor(retentionTime: number): number {
  const caption = document.querySelector(".chromatogram-range")?.textContent ?? "";
  const [, low, high] = /Showing ([\d.]+) to ([\d.]+)/u.exec(caption) ?? [];
  const domain = { low: Number(low), high: Number(high) };
  const fraction = (retentionTime - domain.low) / (domain.high - domain.low);
  return PADDING_LEFT + fraction * DRAWN_WIDTH;
}

/** Commits a narrower viewport with a wheel that settles. */
async function commitAWheel(): Promise<void> {
  act(() => {
    plot().dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 500, deltaY: -500 }));
  });
  await waitFor(() => {
    expect(document.querySelector(".chromatogram-range")?.textContent ?? "").not.toContain("full range");
  });
  // The gesture settles 120ms after its last event; the committed line says so.
  await waitFor(() => expect(within(panel()).getByText(/^Committed retention time: part of the full range/u)).toBeInTheDocument());
}

/** Reads one spectrum, so the other surface has exports to offer. */
async function selectAScan(): Promise<void> {
  const grid = screen.getByRole("grid", { name: "Scans" });
  fireEvent.click(within(grid).getAllByRole("row")[1] as HTMLElement);
  await waitFor(() => {
    expect(within(spectrumPanel()).queryByRole("button", { name: en.plotMoreExports })).not.toBeNull();
  }, SETTLING);
}

/** A held chromatogram CSV export, released by the returned function. */
function heldExport(): { readonly preview: ReturnType<typeof api>; readonly release: () => void } {
  let release: () => void = () => undefined;
  const preview = api({
    chromatogramExport: () => new Promise((resolve) => { release = () => { resolve({ status: "cancelled" }); }; }),
  });
  return { preview, release: () => { release(); } };
}

describe("what the chromatogram can be exported as", () => {
  it("offers nothing where the viewer draws no chromatogram", async () => {
    // A truncated table has no chromatogram on screen, and Rust issues no token
    // for one. The actions are not offered at all rather than offered and refused.
    const truncated = createFakePreviewApi({ initialDatasets: [selectedFile, VENDOR_ROW], preview: buildPreview(SCAN_COUNT, true) });
    render(
      <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
        <PreviewApiProvider value={truncated}>
          <App />
        </PreviewApiProvider>
      </WorkspaceDropTransportProvider>,
    );
    fireEvent.keyDown(await screen.findByRole("treegrid", {}, SETTLING), { key: "Enter" });
    await screen.findByRole("grid", { name: "Scans" }, SETTLING);

    expect(screen.queryByRole("img", { name: "Chromatogram" })).toBeNull();
    expect(within(panel()).queryByRole("button", { name: en.figureExportTitle })).toBeNull();
    expect(within(panel()).queryByRole("button", { name: en.plotMoreExports })).toBeNull();
  });

  it("needs no selected spectrum, and sends the token Rust issued", async () => {
    // The chromatogram is the run, and the run is loaded. Routing this through
    // the selected-spectrum state would make an export of one thing depend on
    // another thing having been read.
    const preview = api();
    await openTheViewer(preview);

    expect(preview.requestedSpectra).toEqual([]);
    const csv = await data("CSV");
    expect(refused(csv)).toBe(false);
    fireEvent.click(csv);

    await waitFor(() => expect(preview.chromatogramExportRequests).toHaveLength(1));
    expect(preview.requestedSpectra).toEqual([]);
    expect(preview.chromatogramExportRequests[0]).toMatchObject({ exportToken: "chromatogram-token", format: "csv" });
  });

  it("exports the whole run until another range is chosen", async () => {
    const preview = api();
    await openTheViewer(preview);

    fireEvent.click(await data("CSV"));

    await waitFor(() => expect(preview.chromatogramExportRequests).toHaveLength(1));
    expect(preview.chromatogramExportRequests[0]?.range).toEqual({ scope: "full", low: null, high: null });
  });

  it("sends a current range as the whole run until the viewport is committed", async () => {
    const preview = api();
    await openTheViewer(preview);
    await inTheDialog(dialog => { fireEvent.click(within(dialog).getByRole("radio", { name: /^Current range/u })); });

    fireEvent.click(await data("CSV"));

    await waitFor(() => expect(preview.chromatogramExportRequests).toHaveLength(1));
    // Null rather than the run's own bounds. Rust resolves it, and this side
    // does not invent a subrange to make the option look different.
    expect(preview.chromatogramExportRequests[0]?.range).toEqual({ scope: "current", low: null, high: null });
  });

  it("sends the committed range once the viewport has been moved", async () => {
    const preview = api();
    await openTheViewer(preview);
    await commitAWheel();
    await inTheDialog(dialog => { fireEvent.click(within(dialog).getByRole("radio", { name: /^Current range/u })); });

    fireEvent.click(await data("CSV"));

    await waitFor(() => expect(preview.chromatogramExportRequests).toHaveLength(1));
    const range = preview.chromatogramExportRequests[0]?.range;
    expect(range?.scope).toBe("current");
    // The committed range, which the caption is also drawn from.
    const caption = document.querySelector(".chromatogram-range")?.textContent ?? "";
    const [, low, high] = /Showing ([\d.]+) to ([\d.]+)/u.exec(caption) ?? [];
    expect(range?.low).toBeCloseTo(Number(low), 3);
    expect(range?.high).toBeCloseTo(Number(high), 3);
  });

  it("ignores a range a gesture is still holding", async () => {
    // An export invoked mid-gesture writes the last range the user settled on.
    // The transient range is a drawing, not a decision.
    const preview = api();
    await openTheViewer(preview);
    await commitAWheel();
    await inTheDialog(dialog => { fireEvent.click(within(dialog).getByRole("radio", { name: /^Current range/u })); });
    const committed = document.querySelector(".chromatogram-range")?.textContent ?? "";

    const from = clientXFor(50 * RT_STEP);
    fireEvent.pointerDown(plot(), { button: 1, isPrimary: true, pointerType: "mouse", clientX: from, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(plot(), { button: 1, isPrimary: true, pointerType: "mouse", clientX: from - 60, clientY: 100, pointerId: 1 });
    expect(document.querySelector(".chromatogram-range")?.textContent ?? "").not.toBe(committed);

    fireEvent.click(await data("CSV"));

    await waitFor(() => expect(preview.chromatogramExportRequests).toHaveLength(1));
    const range = preview.chromatogramExportRequests[0]?.range;
    const [, low, high] = /Showing ([\d.]+) to ([\d.]+)/u.exec(committed) ?? [];
    expect(range?.low).toBeCloseTo(Number(low), 3);
    expect(range?.high).toBeCloseTo(Number(high), 3);
  });

  it("sends the traces that are on screen with a figure", async () => {
    const preview = api();
    await openTheViewer(preview);

    // The viewer opens with TIC alone.
    fireEvent.click(await figure(en.figureQuickPng));
    await waitFor(() => expect(preview.chromatogramExportRequests).toHaveLength(1));
    expect(preview.chromatogramExportRequests[0]).toMatchObject({ format: "png", traces: { tic: true, bpc: false } });
    await waitFor(async () => expect(await figureRefused(en.figureQuickPng)).toBe(false));

    fireEvent.click(head("BPC"));
    fireEvent.click(await figure(en.figureQuickPng));

    await waitFor(() => expect(preview.chromatogramExportRequests).toHaveLength(2));
    expect(preview.chromatogramExportRequests[1]?.traces).toEqual({ tic: true, bpc: true });
  });

  it("refuses the figure actions when neither trace is on screen, says why, and leaves the data", async () => {
    // A panel of no series is refused by the contract. Hiding a trace is a
    // choice about a plot, and the data document carries both measured columns.
    const preview = api();
    await openTheViewer(preview);
    fireEvent.click(head("TIC"));

    for (const name of [en.figureQuickPng, en.viewerCopy]) {
      const item = await figure(name);
      expect(refused(item)).toBe(true);
      expect(item).toHaveAccessibleDescription(en.viewerTracesHidden);
    }
    expect(refused(await data("CSV"))).toBe(false);
    fireEvent.click(await data("TSV"));

    await waitFor(() => expect(preview.chromatogramExportRequests).toHaveLength(1));
    expect(preview.chromatogramExportRequests[0]?.format).toBe("tsv");
  });

  it("refuses the figure actions when the settings could not draw one, and leaves the data", async () => {
    const preview = api();
    await openTheViewer(preview);
    // Empty rather than small: the viewer refuses what cannot be a size at all,
    // and Rust refuses what is a size but not one a figure can be drawn at.
    await inTheDialog(dialog => {
      fireEvent.change(within(dialog).getByRole("textbox", { name: /^Width/u }), { target: { value: "" } });
    });

    const png = await figure(en.figureQuickPng);
    expect(refused(png)).toBe(true);
    expect(png).toHaveAccessibleDescription(en.invalidWidth);
    // Said inside the item it refuses, where the reader is looking.
    expect(png).toHaveTextContent(en.invalidWidth);
    expect(refused(await data("CSV"))).toBe(false);
  });

  it("sends a data export at a width no figure could be drawn at", async () => {
    // 20,001 is a whole number, so the viewer forwards it as typed; a data
    // document has no width, and its export must still happen.
    const preview = api();
    await openTheViewer(preview);
    await inTheDialog(dialog => {
      fireEvent.change(within(dialog).getByRole("textbox", { name: /^Width/u }), { target: { value: "20001" } });
    });

    fireEvent.click(await data("CSV"));

    await waitFor(() => expect(preview.chromatogramExportRequests).toHaveLength(1));
    const sent = preview.chromatogramExportRequests[0];
    expect(sent?.format).toBe("csv");
    expect(sent?.range.scope).toBe("full");
    expect(sent?.settings.widthPx).toBe(20001);
  });

  it("keeps every id unique with both plots on screen", async () => {
    const preview = api();
    await openTheViewer(preview);
    await selectAScan();

    const ids = [...document.querySelectorAll("[id]")].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("says what was saved, including a range that held no scans", async () => {
    const preview = api({
      chromatogramExport: () => Promise.resolve({
        status: "saved", format: "csv", fileName: "mscanvas-chromatogram-current.csv", figure: null, traces: null,
        rangeScope: "current", rangeLow: 4, rangeHigh: 5, sourceScanCount: FAKE_COMPLETE_SCAN_COUNT, rowCount: 0,
      }),
    });
    await openTheViewer(preview);

    fireEvent.click(await data("CSV"));

    await waitFor(() => expect(exportStatus()).toContain("mscanvas-chromatogram-current.csv"));
    expect(exportStatus()).toContain("0 source scans");
    expect(exportStatus()).toContain("36,319");
    // A result can be dismissed by its own named control.
    fireEvent.click(within(panel()).getByRole("button", { name: en.viewerDismiss }));
    expect(exportStatus()).toBe("");
  });

  it("says when an export was cancelled, and when one failed", async () => {
    const cancelled = api({ chromatogramExport: () => Promise.resolve({ status: "cancelled" }) });
    await openTheViewer(cancelled);
    fireEvent.click(await data("CSV"));
    await waitFor(() => expect(exportStatus()).toContain("Export cancelled"));

    cleanup();

    const failed = api({
      chromatogramExport: () => Promise.reject({
        kind: "chromatogram_range_outside_source",
        summary: "That retention-time range is not inside the run MSCanvas has loaded.",
        detail: null,
        retryable: true,
      }),
    });
    await openTheViewer(failed);
    fireEvent.click(await data("CSV"));
    await waitFor(() => expect(exportStatus()).toContain(en.m74ErrorRtRange));
    // No actionable half, so no empty line for one.
    expect(panel().querySelector(".notice-detail")).toBeNull();
  });

  it("reads out the part of a failure the user has to act on, on both plots", async () => {
    // A failed write attaches its actionable half to `detail`: above all that
    // the export could not remove the temporary file it left in the folder.
    const RESIDUE =
      'MSCanvas also left a temporary file whose name begins with ".mscanvas-export-" in that ' +
      "folder and could not remove it.";
    const failure = {
      kind: "spectrum_not_finalized",
      summary: "MSCanvas wrote the export and could not give it the name you chose, so nothing was saved under that name.",
      detail: RESIDUE,
      retryable: true,
    };
    const preview = api({ chromatogramExport: () => Promise.reject(failure), spectrumExport: () => Promise.reject(failure) });
    await openTheViewer(preview);
    await selectAScan();

    fireEvent.click(await data("CSV"));
    await waitFor(() => expect(exportStatus()).toContain(en.m74ErrorNotFinalized));
    expect(exportStatus()).toContain(RESIDUE);

    await closeMenu();
    fireEvent.click(await data("CSV", spectrumPanel()));
    await waitFor(() => {
      expect(within(spectrumPanel()).getByRole("status").textContent ?? "").toContain(en.m74ErrorNotFinalized);
    });
    expect(within(spectrumPanel()).getByRole("status").textContent ?? "").toContain(RESIDUE);
  });

  it("holds every scientific export in one lane", async () => {
    // Rust owns one lane across both surfaces and refuses a second export.
    // Offering one here while another runs would offer an action known to fail.
    const { preview, release } = heldExport();
    await openTheViewer(preview);

    fireEvent.click(await data("CSV"));
    await waitFor(() => expect(preview.chromatogramExportRequests).toHaveLength(1));
    await waitFor(async () => expect(await figureRefused(en.figureQuickPng)).toBe(true));
    const copy = await figure(en.viewerCopy);
    expect(refused(copy)).toBe(true);
    expect(copy).toHaveAccessibleDescription(en.plotExportBusy);
    await closeMenu();

    // A second export while it runs sends nothing: the item is closed.
    const tsv = await data("TSV");
    expect(refused(tsv)).toBe(true);
    fireEvent.click(tsv);
    expect(preview.chromatogramExportRequests).toHaveLength(1);
    await closeMenu();

    act(() => { release(); });
    await waitFor(async () => expect(await figureRefused(en.figureQuickPng)).toBe(false));
    expect(refused(await data("TSV"))).toBe(false);
  });

  it("returns the keyboard to ⋯ once a data format is chosen", async () => {
    // The menu closes for the native save picker; the trigger is what is left
    // to come back to, and it stays usable.
    const preview = api();
    await openTheViewer(preview);
    const more = head(en.plotMoreExports);
    more.focus();

    fireEvent.click(await data("TSV"));

    await waitFor(() => expect(preview.chromatogramExportRequests).toHaveLength(1));
    await waitFor(() => expect(more).toHaveFocus());
    expect(refused(more)).toBe(false);
  });

  it("copies the plot through the same lane and says what was copied", async () => {
    const preview = api();
    await openTheViewer(preview);

    fireEvent.click(await figure(en.viewerCopy));

    await waitFor(() => expect(preview.chromatogramCopyRequests).toHaveLength(1));
    expect(preview.chromatogramCopyRequests[0]?.traces).toEqual({ tic: true, bpc: false });
    await waitFor(() => expect(exportStatus()).toContain("Copied the chromatogram"));
  });

  it("keeps the actions through a vendor row's focus", async () => {
    // Focusing a row this build cannot preview does not close the viewer, so it
    // does not close what the viewer can be exported as either.
    const preview = api();
    await openTheViewer(preview);

    fireEvent.click(screen.getByText(VENDOR_ROW.fileName));

    expect(screen.getByRole("img", { name: "Chromatogram" })).toBeDefined();
    fireEvent.click(await data("CSV"));
    await waitFor(() => expect(preview.chromatogramExportRequests).toHaveLength(1));
    expect(preview.chromatogramExportRequests[0]?.exportToken).toBe("chromatogram-token");
  });

  it("refuses the selected spectrum's actions while a chromatogram export runs", async () => {
    // One lane means both surfaces are unavailable while either owns it, and
    // both stay on screen where they are.
    const { preview, release } = heldExport();
    await openTheViewer(preview);
    await selectAScan();
    expect(await figureRefused(en.figureQuickPng, spectrumPanel())).toBe(false);

    fireEvent.click(await data("CSV"));
    await waitFor(() => expect(preview.chromatogramExportRequests).toHaveLength(1));
    await waitFor(async () => expect(await figureRefused(en.figureQuickPng, spectrumPanel())).toBe(true));
    expect(await figureRefused(en.viewerCopy, spectrumPanel())).toBe(true);
    expect(refused(await data("CSV", spectrumPanel()))).toBe(true);
    await closeMenu();
    // Saying nothing about an export it did not start.
    expect(within(spectrumPanel()).getByRole("status").textContent ?? "").not.toContain("chromatogram");

    act(() => { release(); });
    await waitFor(async () => expect(await figureRefused(en.figureQuickPng, spectrumPanel())).toBe(false));
  });

  it("refuses this panel's actions while a selected-spectrum export runs", async () => {
    let release: () => void = () => undefined;
    const preview = api({
      spectrumExport: () => new Promise((resolve) => { release = () => { resolve({ status: "cancelled" }); }; }),
    });
    await openTheViewer(preview);
    await selectAScan();
    expect(await figureRefused(en.figureQuickPng)).toBe(false);

    fireEvent.click(await data("CSV", spectrumPanel()));
    await waitFor(() => expect(preview.spectrumExportRequests).toHaveLength(1));
    await waitFor(async () => expect(await figureRefused(en.figureQuickPng)).toBe(true));
    const tsv = await data("TSV");
    expect(refused(tsv)).toBe(true);
    fireEvent.click(tsv);
    expect(preview.chromatogramExportRequests).toEqual([]);
    expect(exportStatus()).not.toContain("spectrum");
    await closeMenu();

    act(() => { release(); });
    await waitFor(async () => expect(await figureRefused(en.figureQuickPng)).toBe(false));
  });

  it("keeps the settings rules independent of the surface that is not running", async () => {
    // An unusable figure size is a fact about a figure, not about the lane: it
    // refuses the figures on both plots and leaves both plots' data open.
    const preview = api();
    await openTheViewer(preview);
    await selectAScan();
    await inTheDialog(dialog => {
      fireEvent.change(within(dialog).getByRole("textbox", { name: /^Width/u }), { target: { value: "" } });
    });

    expect(await figureRefused(en.figureQuickPng)).toBe(true);
    expect(await figureRefused(en.figureQuickPng, spectrumPanel())).toBe(true);
    expect(refused(await data("CSV"))).toBe(false);
    await closeMenu();
    expect(refused(await data("CSV", spectrumPanel()))).toBe(false);
  });

  it("does not move the range on a press of the head's tools", async () => {
    const preview = api();
    await openTheViewer(preview);
    const before = document.querySelector(".chromatogram-range")?.textContent ?? "";

    await data("CSV");
    await closeMenu();

    expect(document.querySelector(".chromatogram-range")?.textContent ?? "").toBe(before);
  });
});
