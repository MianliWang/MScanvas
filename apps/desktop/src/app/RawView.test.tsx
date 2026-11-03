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
import { spectrumSelectionAvailability } from "../features/mzml-preview/viewer/selectionAvailability";
import { chooseRosterAction, rosterActionRefused } from "../test/rosterActions";
import { availableBackend, buildPreview, createFakePreviewApi, createFakeWorkspaceDropTransport, selectedFile, shippedIntent, unavailableBackend, type FakePreviewApiOptions } from "../test/previewFixtures";

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
function session(initial: { state?: RawViewState; availability?: RawViewAvailability; datasets?: readonly SelectedFile[]; available?: boolean; planWorkspaceClear?: FakePreviewApiOptions["planWorkspaceClear"]; preview?: FakePreviewApiOptions["preview"]; spectrum?: FakePreviewApiOptions["spectrum"] } = {}) {
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
    ...(initial.planWorkspaceClear === undefined ? {} : { planWorkspaceClear: initial.planWorkspaceClear }),
    ...(initial.preview === undefined ? {} : { preview: initial.preview }),
    ...(initial.spectrum === undefined ? {} : { spectrum: initial.spectrum }),
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
    const measured = document.querySelector("[data-raw-view-phase='checkingSource'] [role='progressbar']");
    expect(measured).toHaveAttribute("aria-valuenow", "10");
    expect(measured).toHaveAttribute("aria-valuemax", "40");
    expect(within(evidence()).getByRole("button", { name: words.cancel })).toBeVisible();
    expect(statusBar()).toHaveTextContent(`Preparing ${RAW.fileName} for viewing 0:42`);
    expect(live()).toHaveTextContent(`${RAW.fileName}: ${words.rawViewPhaseCheckingSource}`);
    expect(live().textContent).not.toContain("0:42");

    // Converting: an indeterminate bar and a clock, never a fraction.
    world.state = running("converting");
    await waitFor(() => expect(document.querySelector("[data-raw-view-phase='converting']")).not.toBeNull());
    expect(document.querySelector("[data-raw-view-phase='converting'] [role='progressbar']")).not.toHaveAttribute("aria-valuenow");
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
    expect(rawViewFailureText(own as never, t as never)).toContain('rawViewFailureWithFree');
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

  describe("a failed view and the row's own preview", () => {
    const tryAgain = () => within(evidence()).getByRole("button", { name: words.rawViewTryAgain });

    it("refuses Try again when Rust says a press would be refused, with the reason and its recovery", async () => {
      const { begun } = session({ state: failed("raw_view_source_changed", true), availability: { available: false, code: "conversion_busy" } });
      await highlight();
      await waitFor(() => expect(tryAgain()).toHaveAttribute("aria-disabled", "true"));
      const line = document.querySelector<HTMLElement>("[data-raw-view-refusal='conversion_busy']")!;
      expect(line).toHaveTextContent(words.rawViewConversionBusy);
      expect(tryAgain()).toHaveAttribute("aria-describedby", line.id);
      expect(within(evidence()).getByRole("button", { name: words.rawViewShowConversion })).toBeVisible();
      await act(async () => { fireEvent.click(tryAgain()); });
      expect(begun).toEqual([]);
    });

    it("says a Try again Rust refused after the last read, and is heard saying it", async () => {
      const { api } = session({ state: failed("raw_view_source_changed", true) });
      api.beginRawView = () => Promise.reject({ kind: "backend_quarantined", summary: "x", detail: null, retryable: false });
      await highlight();
      await waitFor(() => expect(tryAgain()).not.toHaveAttribute("aria-disabled"));
      await act(async () => { fireEvent.click(tryAgain()); });
      const line = await waitFor(() => { const found = document.querySelector("[data-raw-view-refusal='backend_quarantined']"); expect(found).not.toBeNull(); return found!; });
      expect(line).toHaveTextContent(words.m74CnvNoticeBackendQuarantined);
      expect(within(evidence()).getByRole("button", { name: words.rawViewShowBackend })).toBeVisible();
      expect(live()).toHaveTextContent(words.m74CnvNoticeBackendQuarantined);
    });

    it("offers the folder for a build the worker could not evidence, and View comes back once it is cured", async () => {
      const { world, begun } = session({ state: failed("provider_build_not_evidenced", false), availability: { available: false, code: "provider_build_not_evidenced" } });
      await highlight();
      await waitFor(() => expect(within(evidence()).getByRole("button", { name: words.rawViewChooseFolder })).toBeVisible());
      expect(within(evidence()).queryByRole("button", { name: words.rawViewTryAgain })).toBeNull();
      world.availability = { available: true, unverifiedBuildRelease: "3.0.26204" };
      // Reading the row again is what any change of installation does.
      await act(async () => { fireEvent.click(await row(OTHER)); });
      await act(async () => { fireEvent.click(await row(RAW)); });
      await waitFor(() => expect(tryAgain()).not.toHaveAttribute("aria-disabled"));
      await act(async () => { fireEvent.click(tryAgain()); });
      expect(begun).toEqual([RAW.handle]);
    });

    it("runs a re-read of a failed open in the pane: progress, Cancel, and a second failure", async () => {
      const { world, api, begun } = session({ state: ready() });
      api.openRawView = () => { world.state = ready({ openable: false }); return Promise.reject({ kind: "view_cache_entry_lost", summary: "x", detail: null, retryable: true }); };
      await highlight();
      await act(async () => { fireEvent.click(await within(evidence()).findByRole("button", { name: words.rawViewOpen })); });
      const again = await within(evidence()).findByRole("button", { name: words.retryEvidence });
      expect(within(evidence()).getByRole("button", { name: words.rawViewConvert })).toBeVisible();
      again.focus();

      await act(async () => { fireEvent.click(again); });
      expect(begun).toEqual([RAW.handle]);
      await waitFor(() => expect(evidence()).toHaveAttribute("data-evidence", "raw-view"));
      // The button that was pressed is gone, and the keyboard is on the one that replaced it.
      await waitFor(() => expect(within(evidence()).getByRole("button", { name: words.cancel })).toHaveFocus());

      world.state = failed("view_cache_not_stored", true);
      await waitFor(() => expect(within(evidence()).getByRole("alert")).toHaveTextContent(words.errViewCacheNotStored), { timeout: 2_000 });
      expect(within(evidence()).getByRole("button", { name: words.rawViewConvert })).toBeVisible();
    });

    it("re-reads an open view from its Reopen in the pane, and Cancel brings the preview back", async () => {
      const { begun } = session({
        state: ready(),
        spectrum: () => Promise.reject({ kind: "spectrum_not_as_recorded", summary: "x", detail: null, retryable: false }),
      });
      await highlight();
      await act(async () => { fireEvent.click(await within(evidence()).findByRole("button", { name: words.rawViewOpen })); });
      const grid = await screen.findByRole("grid", { name: "Scans" });
      await act(async () => { fireEvent.click(within(grid).getAllByRole("row")[1]!); });
      const reopen = await within(evidence()).findByRole("button", { name: words.viewerReopenFile });
      reopen.focus();

      await act(async () => { fireEvent.click(reopen); });
      expect(begun).toEqual([RAW.handle]);
      await waitFor(() => expect(within(evidence()).getByRole("button", { name: words.cancel })).toHaveFocus());

      await act(async () => { fireEvent.click(within(evidence()).getByRole("button", { name: words.cancel })); });
      await waitFor(() => expect(evidence()).toHaveAttribute("data-evidence", "loaded"));
      expect(within(evidence()).getByRole("heading", { level: 1 })).toHaveTextContent(RAW.fileName);
    });

    it("reaches a Ready that became ready while the row's own failed read was left", async () => {
      const { world, api, opened } = session({ state: ready() });
      const open = api.openRawView;
      api.openRawView = () => { world.state = ready({ openable: false }); return Promise.reject({ kind: "view_cache_entry_lost", summary: "x", detail: null, retryable: true }); };
      await highlight();
      await act(async () => { fireEvent.click(await within(evidence()).findByRole("button", { name: words.rawViewOpen })); });
      await within(evidence()).findByRole("button", { name: words.retryEvidence });

      await act(async () => { fireEvent.click(await row(OTHER)); });
      api.openRawView = open;
      world.state = ready({ operation: 2 } as Partial<RawViewState>);
      await act(async () => { fireEvent.click(await row(RAW)); });
      await act(async () => { fireEvent.click(await within(evidence()).findByRole("button", { name: words.rawViewOpen })); });
      expect(opened).toEqual([2]);
    });

    it("keeps Open's reason on screen while another row is being read", async () => {
      session({ state: ready(), preview: () => new Promise(() => {}) });
      await waitFor(() => expect(screen.getByRole("button", { name: words.rosterToggle })).not.toHaveAttribute("aria-disabled"));
      await act(async () => { fireEvent.click(await row(selectedFile)); });
      await act(async () => { fireEvent.click(await row(RAW)); });
      const open = await within(evidence()).findByRole("button", { name: words.rawViewOpen });
      expect(open).toHaveAttribute("aria-disabled", "true");
      const line = document.querySelector<HTMLElement>("[data-raw-view-open-reason]")!;
      expect(line).toHaveTextContent(words.readingSelected);
      expect(open).toHaveAttribute("aria-describedby", line.id);
    });

    it("says a Cancel Rust refused, and the next state takes it away", async () => {
      const { api, world } = session({ state: running("converting") });
      api.cancelRawView = () => Promise.reject({ kind: "unexpected_error", summary: "x", detail: null, retryable: false });
      await highlight();
      await act(async () => { fireEvent.click(await within(evidence()).findByRole("button", { name: words.cancel })); });
      await waitFor(() => expect(document.querySelector("[data-raw-view-refusal='unexpected_error']")).not.toBeNull());
      world.state = failed("view_cache_not_stored", true);
      await waitFor(() => expect(document.querySelector("[data-raw-view-refusal='unexpected_error']")).toBeNull(), { timeout: 2_000 });
    });
  });

  it("waits for the catalog rather than offering View as if the build were verified", async () => {
    const { begun } = session({ availability: { available: false, code: "raw_view_build_unknown" } });
    await highlight();
    await waitFor(() => expect(document.querySelector("[data-raw-view-refusal='raw_view_build_unknown']")).toHaveTextContent(words.backendCheckingInstallation));
    expect(viewButton()).toHaveAttribute("aria-disabled", "true");
    await act(async () => { fireEvent.click(viewButton()); });
    expect(begun).toEqual([]);
  });

  it("asks again after a read that failed, because nothing else would", async () => {
    const { read } = session();
    await waitFor(() => expect(read).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("button", { name: words.rosterToggle })).not.toHaveAttribute("aria-disabled"));
    const answer = read.getMockImplementation()!;
    read.mockImplementation(() => Promise.reject(new Error("no answer")));
    const found = await row(RAW);
    await act(async () => { fireEvent.click(found); });
    const again = await waitFor(() => { const button = document.querySelector<HTMLElement>("[data-raw-view-reask]"); expect(button).not.toBeNull(); return button!; });
    expect(viewButton()).toHaveAttribute("aria-disabled", "true");
    read.mockImplementation(answer);
    await act(async () => { fireEvent.click(again); });
    await waitFor(() => expect(viewButton()).not.toHaveAttribute("aria-disabled"));
    expect(document.querySelector("[data-raw-view-reask]")).toBeNull();
  });

  it("shows a failure out of sight in the bar and as one alert, until its row is looked at", async () => {
    const { world } = session({ state: running("converting") });
    await waitFor(() => expect(statusBar()).not.toBeNull());
    await highlight(OTHER);
    const alert = () => document.querySelector('[data-live-region="raw-view-alert"]')!;
    expect(alert()).toHaveTextContent("");
    world.state = failed("view_cache_not_stored", true);
    await waitFor(() => expect(statusBar()).toHaveTextContent(`${RAW.fileName} could not be viewed.`), { timeout: 2_000 });
    expect(alert()).toHaveTextContent(words.errViewCacheNotStored);
    // Not said a second time by the polite region.
    expect(live()).not.toHaveTextContent(words.errViewCacheNotStored);

    await act(async () => { fireEvent.click(within(statusBar()!).getByRole("button")); });
    await waitFor(() => expect(within(evidence()).getByRole("alert")).toHaveTextContent(words.errViewCacheNotStored));
    expect(statusBar()).toBeNull();
    expect(alert()).toHaveTextContent("");
  });

  it("treats a failure on another surface as out of sight, though its row is highlighted", async () => {
    const { world } = session({ state: running("converting") });
    await highlight();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: words.conversionTask })); });
    world.state = failed("view_cache_not_stored", true);
    await waitFor(() => expect(statusBar()).toHaveTextContent(`${RAW.fileName} could not be viewed.`), { timeout: 2_000 });
    expect(document.querySelector('[data-live-region="raw-view-alert"]')).toHaveTextContent(words.errViewCacheNotStored);
  });

  describe("while a view holds the slot", () => {
    it("keeps the row being prepared in the list", async () => {
      session({ state: running("converting") });
      await highlight();
      await waitFor(() => expect(statusBar()).not.toBeNull());
      expect(await rosterActionRefused("removeHighlighted")).toBe(true);
      await act(async () => { fireEvent.click(await row(OTHER)); });
      // Another row stays the reader's to prune.
      expect(await rosterActionRefused("removeHighlighted")).toBe(false);
    });

    it("clears through the confirmation, in the view's own words", async () => {
      session({
        state: running("converting"),
        planWorkspaceClear: () => Promise.resolve({ Ok: { planId: "p", totalCount: 3, removableCount: 2, protectedCount: 1, active: true } }),
      });
      await highlight();
      await waitFor(() => expect(statusBar()).not.toBeNull());
      await chooseRosterAction("clearList");
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByRole("heading")).toHaveTextContent(words.clearActiveTitleView);
      await waitFor(() => expect(dialog).toHaveTextContent("2 of 3 rows can be removed now; 1 protected by this view."));
    });

    it("refuses the queue's Convert for the view, by the view's name, and Show goes back to it", async () => {
      session({ state: running("converting") });
      await highlight();
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: words.conversionTask })); });
      const notice = await waitFor(() => { const found = document.getElementById("conversion-availability-raw-view-running"); expect(found).not.toBeNull(); return found!; });
      expect(notice).toHaveTextContent(`Preparing ${RAW.fileName} for viewing.`);
      expect(document.getElementById("conversion-availability-preview-running")).toBeNull();
      const panel = document.getElementById("workbench-conversion")!;
      await act(async () => { fireEvent.click(within(panel).getByRole("button", { name: `Show ${RAW.fileName}` })); });
      await waitFor(() => expect(document.querySelector("[data-raw-view-phase='converting']")).not.toBeNull());
    });

    it("says what the settings wait for, reads nothing meanwhile, and reads them as the view ends", async () => {
      const { world, api } = session({ state: running("converting") });
      await waitFor(() => expect(statusBar()).not.toBeNull());
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: words.conversionTask })); });
      const settings = () => document.querySelector("#workbench-conversion [data-settings-state]");
      await waitFor(() => expect(settings()).toHaveTextContent(words.rawViewBusyUnnamed));
      expect(settings()).not.toHaveTextContent(words.cnvSettingsLoading);
      const reads = vi.spyOn(api, "readConversionConfiguration");
      expect(reads).not.toHaveBeenCalled();
      world.state = { state: "cancelled", operation: 1, handle: RAW.handle, stored: false };
      await waitFor(() => expect(reads).toHaveBeenCalled(), { timeout: 2_000 });
    });

    it("says what a pressed mzML row waits for, and goes to the view", async () => {
      const { api } = session({ state: running("converting") });
      await waitFor(() => expect(statusBar()).not.toBeNull());
      await act(async () => { fireEvent.click(await row(selectedFile)); });
      expect(api.openCount()).toBe(0);
      await waitFor(() => expect(document.querySelector("[data-raw-view-held]")).toHaveTextContent(`Preparing ${RAW.fileName} for viewing.`));
      expect(within(evidence()).queryByText(words.emptyEvidence)).toBeNull();
      await act(async () => { fireEvent.click(within(evidence()).getByRole("button", { name: `Show ${RAW.fileName}` })); });
      await waitFor(() => expect(document.querySelector("[data-raw-view-phase='converting']")).not.toBeNull());
    });

    it("names the view, not a conversion, under a scan a reader cannot select", () => {
      const lane = { hasLoadedPreview: true, backendUsable: true, backendBusy: false, conversionBusy: false, rawViewBusy: true };
      expect(spectrumSelectionAvailability(lane)).toEqual({ status: "unavailable", reason: "raw-view-running" });
    });
  });

  it("shortens a long name in the reason and Show, and keeps the whole on the element", async () => {
    const long: SelectedFile = { ...RAW, fileName: `${"Plasma_QC_batch_08_replicate_04_long_acquisition_".repeat(3)}end.raw` };
    session({
      datasets: [OTHER, long],
      availability: { available: false, code: "raw_view_busy" },
      state: running("converting", { handle: long.handle, fileName: long.fileName } as Partial<RawViewState>),
    });
    await highlight(OTHER);
    const short = shortFileName(long.fileName);
    const line = await waitFor(() => { const found = document.querySelector<HTMLElement>("[data-raw-view-refusal='raw_view_busy']"); expect(found).not.toBeNull(); return found!; });
    expect(line).toHaveTextContent(`Preparing ${short} for viewing.`);
    expect(line).toHaveAttribute("title", long.fileName);
    expect(within(evidence()).getByRole("button", { name: `Show ${long.fileName}` })).toHaveTextContent(`Show ${short}`);
  });

  it("puts the tabs before Convert before the panel, as they read on screen", async () => {
    session({ state: ready() });
    await highlight();
    await act(async () => { fireEvent.click(await within(evidence()).findByRole("button", { name: words.rawViewOpen })); });
    const convert = await waitFor(() => { const found = document.querySelector<HTMLElement>("[data-raw-view-convert]"); expect(found).not.toBeNull(); return found!; });
    const tab = within(evidence()).getAllByRole("tab")[0]!;
    const panel = within(evidence()).getByRole("tabpanel");
    expect(tab.compareDocumentPosition(convert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(convert.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("refuses a QC capture of a viewed preview by its own reason", async () => {
    const { qcUnavailable } = await import("../features/project/lineage");
    const source = { id: "input", label: RAW.fileName, workbenchDatasetHandle: RAW.handle } as never;
    const viewed = { handle: RAW.handle, token: null, producerIdentified: false, viewedThroughCache: true };
    expect(qcUnavailable(source, new Set([RAW.handle]), viewed)).toBe("qcViewedThroughCache");
  });
});
