/**
 * One-click view of a Thermo RAW row through the delivered application (ADR 0060
 * slice 3), over a fake boundary whose answers each test moves by hand.
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { PreviewApiProvider } from "../features/mzml-preview/api";
import type { RawViewAvailability, RawViewSnapshot, RawViewState, SelectedFile, ViewSource } from "../features/mzml-preview/contracts";
import { WorkspaceDropTransportProvider } from "../features/mzml-preview/dropTransport";
import { rawViewFailureText, shortFileName } from "../features/mzml-preview/RawViewPane";
import { UI_RESOURCES } from "../features/preferences/i18n";
import { availableBackend, buildPreview, createFakePreviewApi, createFakeWorkspaceDropTransport, selectedFile, shippedIntent, unavailableBackend } from "../test/previewFixtures";

const words = UI_RESOURCES.en;
const RAW: SelectedFile = { handle: "raw-1", fileName: "QC_pool_01.raw", byteLength: 78_309, sourceKind: "thermo_raw", relativeContext: null };
const OTHER: SelectedFile = { handle: "raw-2", fileName: "QC_pool_02.raw", byteLength: 78_309, sourceKind: "thermo_raw", relativeContext: null };
const SOURCE: ViewSource = {
  kind: "viewCache",
  sourceFileName: RAW.fileName,
  sourceKind: "thermo_raw",
  sourceSha256: "a".repeat(64),
  providerRelease: "3.0.26013",
  providerSha256: "b".repeat(64),
  intent: shippedIntent,
  verified: true,
  unverifiedBuildRelease: null,
  convertedAt: "2026-11-03T04:00:00Z",
};

const running = (phase: "checkingSource" | "converting" | "storing", extra: Partial<RawViewState> = {}): RawViewState => ({
  state: "running", operation: 1, handle: RAW.handle, fileName: RAW.fileName, phase,
  elapsedMs: 42_000, bytesRead: phase === "checkingSource" ? 10 : null, bytesTotal: phase === "checkingSource" ? 40 : null,
  intentId: shippedIntent.id, unverifiedBuildRelease: null, cachedCopyDamaged: false, ...extra,
} as RawViewState);
const ready = (extra: Partial<RawViewState> = {}): RawViewState => ({
  state: "ready", operation: 1, handle: RAW.handle, intentId: shippedIntent.id, cacheHit: false,
  unverifiedBuildRelease: null, openable: true, ...extra,
} as RawViewState);
const failed = (code: string, retryable: boolean, extra: Partial<RawViewState> = {}): RawViewState => ({
  state: "failed", operation: 1, handle: RAW.handle, intentId: shippedIntent.id, code, message: "English from Rust.",
  retryable, neededBytes: null, freeBytes: null, ...extra,
} as RawViewState);

/** A session whose view the test moves by hand. */
function session(initial: { state?: RawViewState; availability?: RawViewAvailability; datasets?: readonly SelectedFile[]; available?: boolean } = {}) {
  const world = { state: initial.state ?? ({ state: "idle" } as RawViewState), availability: initial.availability ?? ({ available: true, unverifiedBuildRelease: null } as RawViewAvailability) };
  const begun: string[] = [];
  const cancelled: number[] = [];
  const opened: number[] = [];
  const read = vi.fn((handle: string | null): Promise<RawViewSnapshot> => Promise.resolve({
    state: world.state,
    availability: handle === null ? null : world.availability,
  }));
  const api = createFakePreviewApi({
    availability: initial.available === false ? unavailableBackend : availableBackend,
    initialDatasets: initial.datasets ?? [RAW, OTHER, selectedFile],
    getRawViewState: read,
    beginRawView: (handle) => { begun.push(handle); world.state = running("checkingSource"); return Promise.resolve(world.state); },
    cancelRawView: (operation) => { cancelled.push(operation); world.state = { state: "cancelled", operation, handle: RAW.handle, stored: false }; return Promise.resolve(world.state); },
    openRawView: (operation) => {
      opened.push(operation);
      world.state = ready({ openable: false });
      return Promise.resolve({ ...buildPreview(), file: RAW, qcSnapshotToken: null, qcProducerIdentified: false, viewSource: SOURCE });
    },
  });
  render(<WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
    <PreviewApiProvider value={api}><App /></PreviewApiProvider>
  </WorkspaceDropTransportProvider>);
  return { world, api, begun, cancelled, opened, read };
}

const row = (file: SelectedFile) => waitFor(() => {
  const found = document.querySelector<HTMLElement>(`.grouped-roster [data-handle="${file.handle}"]`);
  if (found === null) throw new Error("no row yet");
  return found;
});
const evidence = () => document.getElementById("workbench-evidence")!;
const live = () => document.querySelector('[data-live-region="raw-view"]')!;
const statusBar = () => document.querySelector<HTMLElement>("[data-status-raw-view]");

async function highlight(file: SelectedFile = RAW) {
  await waitFor(() => expect(screen.getByRole("button", { name: words.rosterToggle })).not.toHaveAttribute("aria-disabled"));
  const found = await row(file);
  await act(async () => { fireEvent.click(found); });
  await waitFor(() => expect(evidence()).toHaveAttribute("data-evidence", "raw-view"));
  return found;
}
const viewButton = () => within(evidence()).getByRole("button", { name: words.rawViewView });

describe("viewing a Thermo RAW row", () => {
  it("starts nothing on the highlight, and no route but View reaches the boundary", async () => {
    const { begun, api, read } = session();
    await highlight();
    await waitFor(() => expect(viewButton()).not.toHaveAttribute("aria-disabled"));
    expect(begun).toEqual([]);
    expect(api.openCount()).toBe(0);
    expect(read).toHaveBeenCalledWith(RAW.handle);
  });

  it("runs every phase, opens a ready view of the highlighted row once, and shows its source", async () => {
    const { world, begun, opened } = session();
    await highlight();
    await waitFor(() => expect(viewButton()).not.toHaveAttribute("aria-disabled"));
    await act(async () => { fireEvent.click(viewButton()); });
    expect(begun).toEqual([RAW.handle]);

    // Checking file: a measured bar, Cancel, and the bar's line in the status bar.
    expect(document.querySelector("[data-raw-view-phase='checkingSource'] progress")).toHaveAttribute("value", "10");
    expect(within(evidence()).getByRole("button", { name: words.cancel })).toBeVisible();
    expect(statusBar()).toHaveTextContent(`Preparing ${RAW.fileName} for viewing 0:42`);
    expect(live()).toHaveTextContent(`${RAW.fileName}: ${words.rawViewPhaseCheckingSource}`);
    expect(live().textContent).not.toContain("0:42");

    // Converting: an indeterminate bar and a clock, never a fraction.
    world.state = running("converting");
    await waitFor(() => expect(document.querySelector("[data-raw-view-phase='converting']")).not.toBeNull());
    expect(document.querySelector("[data-raw-view-phase='converting'] progress")).not.toHaveAttribute("value");
    expect(document.querySelector("[data-raw-view-elapsed]")).toHaveTextContent("0:42");

    // Storing cannot be cancelled.
    world.state = running("storing");
    await waitFor(() => expect(document.querySelector("[data-raw-view-phase='storing']")).not.toBeNull());
    expect(within(evidence()).queryByRole("button", { name: words.cancel })).toBeNull();

    world.state = ready();
    await waitFor(() => expect(opened).toEqual([1]));
    await waitFor(() => expect(evidence()).toHaveAttribute("data-evidence", "loaded"));
    await waitFor(() => expect(live()).toHaveTextContent(`${RAW.fileName} is open.`));
    expect(within(evidence()).getByRole("heading", { level: 1 })).toHaveTextContent(RAW.fileName);
    // Exports refused, each pointing at the one visible sentence.
    const withheld = document.querySelector("[data-view-export-withheld]")!;
    expect(withheld).toHaveTextContent(words.viewExportWithheld);
    const exports = within(evidence()).getAllByRole("button", { name: words.figureExportTitle });
    expect(exports.length).toBeGreaterThan(0);
    for (const button of exports) {
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button.getAttribute("aria-describedby")).toContain(withheld.id);
    }
    // The Metadata tab opens with the source and the conversion.
    await act(async () => { fireEvent.click(within(evidence()).getByRole("tab", { name: words.viewerTabMetadata })); });
    const group = document.querySelector<HTMLElement>("[data-view-source]")!;
    expect(group).toHaveTextContent(words.rawViewMetadataTitle);
    expect(group).toHaveTextContent(SOURCE.sourceSha256);
    expect(group).toHaveTextContent("ProteoWizard 3.0.26013");
    expect(group.textContent).not.toContain("view.mzML");
  });

  it("holds a ready view of a row the reader left, says so in the bar, and opens on Open", async () => {
    const { world, opened } = session();
    await highlight();
    await waitFor(() => expect(viewButton()).not.toHaveAttribute("aria-disabled"));
    await act(async () => { fireEvent.click(viewButton()); });
    await act(async () => { fireEvent.click(await row(OTHER)); });
    world.state = ready();
    await waitFor(() => expect(statusBar()).toHaveTextContent(`${RAW.fileName} is ready to view.`));
    expect(opened).toEqual([]);
    expect(live()).toHaveTextContent(`${RAW.fileName} is ready to view.`);

    // Show returns to the row; it shows Ready and opens nothing.
    await act(async () => { fireEvent.click(within(statusBar()!).getByRole("button", { name: `Show ${RAW.fileName}` })); });
    await waitFor(() => expect(document.querySelector("[data-raw-view='ready']")).toHaveTextContent(`${RAW.fileName} is ready to view.`));
    expect(opened).toEqual([]);
    await act(async () => { fireEvent.click(within(evidence()).getByRole("button", { name: words.rawViewOpen })); });
    expect(opened).toEqual([1]);
  });

  it("opens a reloaded document's ready view only when asked", async () => {
    const { opened } = session({ state: ready() });
    await highlight();
    await waitFor(() => expect(document.querySelector("[data-raw-view='ready']")).not.toBeNull());
    expect(opened).toEqual([]);
  });

  it("resumes a running view in a reloaded document, and keeps reading it", async () => {
    const { read } = session({ state: running("converting") });
    await waitFor(() => expect(statusBar()).not.toBeNull());
    const before = read.mock.calls.length;
    await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(before), { timeout: 2_000 });
  });

  it("stops reading at a terminal state", async () => {
    const { world, read } = session({ state: running("converting") });
    await waitFor(() => expect(statusBar()).not.toBeNull());
    world.state = { state: "cancelled", operation: 1, handle: RAW.handle, stored: false };
    await waitFor(() => expect(live()).toHaveTextContent(words.rawViewCancelledEmpty), { timeout: 2_000 });
    const settled = read.mock.calls.length;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 900)); });
    expect(read.mock.calls.length).toBe(settled);
  });

  it("cancels the exact operation, says what stayed, and offers View again", async () => {
    const { world, cancelled, begun } = session();
    await highlight();
    await waitFor(() => expect(viewButton()).not.toHaveAttribute("aria-disabled"));
    await act(async () => { fireEvent.click(viewButton()); });
    await act(async () => { fireEvent.click(within(evidence()).getByRole("button", { name: words.cancel })); });
    expect(cancelled).toEqual([1]);
    await waitFor(() => expect(document.querySelector("[data-raw-view='cancelled']")).toHaveTextContent(words.rawViewCancelledEmpty));
    expect(viewButton()).toBeVisible();

    // A stored copy says so, and a cancelled operation is never opened.
    await act(async () => { fireEvent.click(viewButton()); });
    expect(begun).toHaveLength(2);
    world.state = { state: "cancelled", operation: 1, handle: RAW.handle, stored: true };
    await waitFor(() => expect(document.querySelector("[data-raw-view='cancelled']")).toHaveTextContent(words.rawViewCancelledStored), { timeout: 2_000 });
  });

  it("offers Try again only for a retryable failure, in owned words", async () => {
    const first = session({ state: failed("raw_view_source_changed", true) });
    await highlight();
    const alert = await within(evidence()).findByRole("alert");
    expect(alert).toHaveTextContent(words.errRawViewSourceChanged);
    expect(alert.textContent).not.toContain("English from Rust.");
    await act(async () => { fireEvent.click(within(evidence()).getByRole("button", { name: words.rawViewTryAgain })); });
    expect(first.begun).toEqual([RAW.handle]);
  });

  it("offers no Try again for a failure that would fail the same way", async () => {
    session({ state: failed("view_cache_entry_too_large", false) });
    await highlight();
    await within(evidence()).findByRole("alert");
    expect(within(evidence()).queryByRole("button", { name: words.rawViewTryAgain })).toBeNull();
    expect(within(evidence()).getByRole("button", { name: words.rawViewConvert })).toBeVisible();
  });

  it("states both numbers when a miss has no room, and the conversion's failure in owned words", () => {
    const t = (key: string, parameters?: Record<string, string>) => `${key}:${JSON.stringify(parameters ?? {})}`;
    const space = failed("view_cache_no_space", true, { neededBytes: 5 * 2 ** 30, freeBytes: 2 ** 30 } as Partial<RawViewState>);
    expect(rawViewFailureText(space as never, t as never)).toBe('rawViewNoSpace:{"needed":"5.0","free":"1.0"}');
    const own = failed("backend_execution_failed", false, { freeBytes: 2 ** 30 } as Partial<RawViewState>);
    expect(rawViewFailureText(own as never, t as never)).toBe('rawViewConversionFailed:{} rawViewFreeNow:{"free":"1.0"}');
  });

  it.each([
    ["backend_not_found", words.errBackendNotFound, words.rawViewChooseFolder],
    ["backend_quarantined", words.m74CnvNoticeBackendQuarantined, words.rawViewShowBackend],
    ["provider_build_not_evidenced", words.errProviderBuildNotEvidenced, words.rawViewChooseFolder],
    ["conversion_busy", words.rawViewConversionBusy, words.rawViewShowConversion],
    ["view_cache_unavailable", words.errViewCacheUnavailable, null],
    ["view_cache_root_unrecognized", words.errViewCacheRootUnrecognized, null],
    ["view_cache_entry_too_large", words.rawViewTooLarge, null],
  ])("refuses %s before the press, with its reason and its recovery", async (code, reason, recovery) => {
    const { begun } = session({ availability: { available: false, code } });
    await highlight();
    const refused = await waitFor(() => {
      const button = viewButton();
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(document.querySelector(`[data-raw-view-refusal="${code}"]`)).not.toBeNull();
      return button;
    });
    const line = document.querySelector<HTMLElement>(`[data-raw-view-refusal="${code}"]`)!;
    expect(line).toHaveTextContent(reason);
    expect(refused).toHaveAttribute("aria-describedby", line.id);
    if (recovery !== null) expect(within(evidence()).getByRole("button", { name: recovery })).toBeVisible();
    expect(within(evidence()).getByRole("button", { name: words.rawViewConvert })).toBeVisible();
    await act(async () => { fireEvent.click(refused); });
    expect(begun).toEqual([]);
  });

  it("names the file another view holds the slot for, and goes to it", async () => {
    const { world } = session({ availability: { available: false, code: "raw_view_busy" } });
    world.state = running("converting");
    await highlight(OTHER);
    await waitFor(() => expect(document.querySelector("[data-raw-view-refusal='raw_view_busy']")).toHaveTextContent(`Preparing ${RAW.fileName} for viewing.`));
    await act(async () => { fireEvent.click(within(evidence()).getByRole("button", { name: `Show ${RAW.fileName}` })); });
    await waitFor(() => expect(document.querySelector("[data-raw-view-phase='converting']")).not.toBeNull());
  });

  it("shows a press Rust refused after the last read", async () => {
    const { api } = session();
    api.beginRawView = () => Promise.reject({ kind: "view_cache_unavailable", summary: "x", detail: null, retryable: false });
    await highlight();
    await waitFor(() => expect(viewButton()).not.toHaveAttribute("aria-disabled"));
    await act(async () => { fireEvent.click(viewButton()); });
    await waitFor(() => expect(document.querySelector("[data-raw-view-refusal='view_cache_unavailable']")).toHaveTextContent(words.errViewCacheUnavailable));
    // It holds nothing: the next answer is the authority, and this one says View can run.
    expect(viewButton()).not.toHaveAttribute("aria-disabled");
  });

  it("keeps View refused while the installation is being checked, and until Rust has answered", async () => {
    const { read } = session();
    read.mockImplementation(() => new Promise(() => {}));
    await highlight();
    expect(viewButton()).toHaveAttribute("aria-disabled", "true");
  });

  it("labels View and the progress on an unmeasured build", async () => {
    const { world } = session({ availability: { available: true, unverifiedBuildRelease: "3.0.26204" } });
    await highlight();
    await waitFor(() => expect(within(evidence()).getByText("Not verified by MSCanvas: ProteoWizard 3.0.26204")).toBeVisible());
    world.state = running("converting", { unverifiedBuildRelease: "3.0.26204" } as Partial<RawViewState>);
    await waitFor(() => expect(within(evidence()).getByText("Not verified by MSCanvas: ProteoWizard 3.0.26204")).toBeVisible(), { timeout: 2_000 });
  });

  it("refuses Add files and another read while a view holds the slot", async () => {
    const { world, api } = session({ state: running("converting") });
    await waitFor(() => expect(statusBar()).not.toBeNull());
    expect(world.state.state).toBe("running");
    await waitFor(() => expect(screen.getByRole("button", { name: words.addFiles })).toHaveAttribute("aria-disabled", "true"));
    const mzml = await row(selectedFile);
    await act(async () => { fireEvent.click(mzml); });
    expect(api.openCount()).toBe(0);
    // The refused action points at the bar's visible line.
    expect(statusBar()).toHaveAttribute("id", "shell-status-busy");
  });

  describe("the keyboard path", () => {
    const grid = () => screen.getByRole("treegrid");
    async function focusedOnFirst() {
      await row(RAW);
      await waitFor(() => expect(screen.getByRole("button", { name: words.rosterToggle })).not.toHaveAttribute("aria-disabled"));
      await act(async () => { fireEvent.keyDown(grid(), { key: "Home" }); });
    }

    it("highlights on the first Enter and starts nothing; the second presses View", async () => {
      const { begun } = session();
      await focusedOnFirst();
      await act(async () => { fireEvent.keyDown(grid(), { key: "Enter" }); });
      await waitFor(() => expect(evidence()).toHaveAttribute("data-evidence", "raw-view"));
      expect(begun).toEqual([]);
      await waitFor(() => expect(viewButton()).not.toHaveAttribute("aria-disabled"));
      await act(async () => { fireEvent.keyDown(grid(), { key: "Enter" }); });
      expect(begun).toEqual([RAW.handle]);
    });

    it("presses nothing for a held key, and Space only toggles the selection", async () => {
      const { begun } = session();
      await focusedOnFirst();
      await act(async () => { fireEvent.keyDown(grid(), { key: "Enter" }); });
      await waitFor(() => expect(viewButton()).not.toHaveAttribute("aria-disabled"));
      await act(async () => { fireEvent.keyDown(grid(), { key: "Enter", repeat: true }); });
      expect(begun).toEqual([]);
      await act(async () => { fireEvent.keyDown(grid(), { key: " " }); });
      expect(begun).toEqual([]);
    });

    it("presses Open on a ready row, Try again on a retryable failure, and nothing else", async () => {
      const { opened, world, begun } = session({ state: ready() });
      await focusedOnFirst();
      await act(async () => { fireEvent.keyDown(grid(), { key: "Enter" }); });
      await waitFor(() => expect(document.querySelector("[data-raw-view='ready']")).not.toBeNull());
      await act(async () => { fireEvent.keyDown(grid(), { key: "Enter" }); });
      expect(opened).toEqual([1]);

      world.state = failed("view_cache_entry_unrecognized", false);
      await act(async () => { fireEvent.keyDown(grid(), { key: "ArrowDown" }); });
      expect(begun).toEqual([]);
    });

    it("moves the keyboard to Cancel when the pressed View leaves", async () => {
      session();
      await highlight();
      await waitFor(() => expect(viewButton()).not.toHaveAttribute("aria-disabled"));
      const view = viewButton();
      view.focus();
      await act(async () => { fireEvent.click(view); });
      await waitFor(() => expect(within(evidence()).getByRole("button", { name: words.cancel })).toHaveFocus());
    });
  });

  it("shortens a long name in the bar from its middle, keeping its end", () => {
    const short = shortFileName("Plasma_QC_batch_08_replicate_04_long_acquisition.raw");
    expect(short.length).toBeLessThanOrEqual(32);
    expect(short.endsWith("cquisition.raw")).toBe(true);
    expect(short).toContain("…");
    expect(shortFileName("QC_pool_01.raw")).toBe("QC_pool_01.raw");
  });

  it("refuses a QC capture of a viewed preview by its own reason", async () => {
    const { qcUnavailable } = await import("../features/project/lineage");
    const source = { id: "input", label: RAW.fileName, workbenchDatasetHandle: RAW.handle } as never;
    const viewed = { handle: RAW.handle, token: null, producerIdentified: false, viewedThroughCache: true };
    expect(qcUnavailable(source, new Set([RAW.handle]), viewed)).toBe("qcViewedThroughCache");
  });
});
