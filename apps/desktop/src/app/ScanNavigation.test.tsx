/** N-V3 through the delivered application: go to a scan, the list following the range, memory per file. */
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { PreviewApiProvider } from "../features/mzml-preview/api";
import { WorkspaceDropTransportProvider } from "../features/mzml-preview/dropTransport";
import { availableBackend, buildPreview, buildSpectrum, createFakePreviewApi, createFakeWorkspaceDropTransport, secondFile, selectedFile } from "../test/previewFixtures";
import { UI_RESOURCES } from "../features/preferences/i18n";
import { usePreviewWorkspace } from "../features/mzml-preview/usePreviewWorkspace";

const en = UI_RESOURCES.en;
const source = () => {
  const preview = buildPreview(8);
  return { ...preview, spectrumTable: { ...preview.spectrumTable,
    rows: preview.spectrumTable.rows.map((row, index) => ({ ...row,
      identifier: index === 3 || index === 7 ? `rare-raw-${index}` : `raw-${index}`,
      totalIonCurrent: (index + 1) * 10,
      retentionTime: { value: index, unit: "notReported" as const },
    })),
  } };
};
const spectrum = async (index: number) => ({ outcome: "spectrum" as const, spectrum: { ...buildSpectrum(index, 12),
  mzLow: 100, mzHigh: 900, viewportDomain: { state: "admitted" as const, low: 100, high: 900 } } });
async function mount() {
  const api = createFakePreviewApi({ initialDatasets: [selectedFile], preview: source(), spectrum });
  render(<WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
    <PreviewApiProvider value={api}><App /></PreviewApiProvider>
  </WorkspaceDropTransportProvider>);
  fireEvent.keyDown(await screen.findByRole("treegrid"), { key: "Enter" });
  await screen.findByRole("grid", { name: en.scansTitle });
  return { api };
}
const grid = () => screen.getByRole("grid", { name: en.scansTitle });
const shown = () => within(grid()).getAllByRole("row").filter(row => row.hasAttribute("data-row-position"))
  .map(row => Number(row.getAttribute("data-source-index")));
const goToInput = () => screen.getByRole("textbox", { name: en.scanGoTo });
function goTo(text: string) {
  fireEvent.change(goToInput(), { target: { value: text } });
  fireEvent.keyDown(goToInput(), { key: "Enter" });
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("go to scan N", () => {
  it("selects the scan through the press path and keeps focus in the input", async () => {
    const { api } = await mount();
    goToInput().focus();
    goTo("3");
    await screen.findByRole("img", { name: /^Spectrum 2,/u });
    expect(api.requestedSpectra.at(-1)).toBe(2);
    expect(document.activeElement).toBe(goToInput());
    expect(goToInput()).toHaveValue("");
    expect(goToInput()).not.toHaveAttribute("aria-invalid");
  });

  it("clears the filters that hide it, and leaves filters that do not", async () => {
    await mount();
    const search = screen.getByRole("searchbox", { name: en.scanSearch });
    fireEvent.change(search, { target: { value: "rare" } });
    expect(shown()).toEqual([3, 7]);
    goTo("4"); // Index 3, which "rare" lets through: nothing to clear.
    await screen.findByRole("img", { name: /^Spectrum 3,/u });
    expect(search).toHaveValue("rare");
    goTo("2");
    await screen.findByRole("img", { name: /^Spectrum 1,/u });
    expect(search).toHaveValue("");
    expect(shown()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(within(grid()).getAllByRole("row").find(row => row.getAttribute("data-source-index") === "1")).toHaveAttribute("aria-selected", "true");
  });

  it("refuses a number not in the table in place, and changes nothing", async () => {
    const { api } = await mount();
    const before = api.requestedSpectra.length;
    const search = screen.getByRole("searchbox", { name: en.scanSearch });
    fireEvent.change(search, { target: { value: "rare" } });
    goTo("99");
    const refusal = en.scanGoToRefused.replace("{{value}}", "99");
    expect(screen.getByText(refusal)).toBeVisible();
    expect(goToInput()).toHaveAttribute("aria-invalid", "true");
    expect(goToInput()).toHaveAccessibleDescription(expect.stringContaining(refusal));
    expect(goToInput()).toHaveValue("99");
    expect(search).toHaveValue("rare");
    expect(api.requestedSpectra.length).toBe(before);
    fireEvent.change(goToInput(), { target: { value: "9" } });
    expect(screen.queryByText(refusal)).toBeNull();
    expect(goToInput()).not.toHaveAttribute("aria-invalid");
  });
});

describe("the list following the chromatogram's range (V-2)", () => {
  const chromatogram = () => screen.getByRole("region", { name: "Chromatogram" });
  const count = () => document.querySelector(".scan-result-count")?.textContent ?? "";
  const counted = (visible: number) => `${visible} matches / 8 loaded rows / 8 reported spectra`;
  async function setRange(low: string, high: string) {
    fireEvent.keyDown(within(chromatogram()).getByRole("button", { name: en.plotMoreExports }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: en.rangeSet }));
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    fireEvent.change(within(chromatogram()).getByRole("textbox", { name: en.rangeLow }), { target: { value: low } });
    fireEvent.change(within(chromatogram()).getByRole("textbox", { name: en.rangeHigh }), { target: { value: high } });
    fireEvent.click(within(chromatogram()).getByRole("button", { name: "Apply range" }));
  }
  const fitAll = () => fireEvent.click(within(chromatogram()).getByRole("button", { name: en.viewerReset }));

  it("follows the committed range and says how many of how many, then comes back on a reset", async () => {
    await mount();
    expect(count()).toBe("8");
    await setRange("2", "4.5");
    await waitFor(() => expect(shown()).toEqual([2, 3, 4]));
    expect(count()).toBe(counted(3));
    fitAll();
    await waitFor(() => expect(shown()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]));
    expect(count()).toBe("8");
  });

  it("says the range hides the selected scan, and moves the range to it without reading anything", async () => {
    const { api } = await mount();
    goTo("8");
    await screen.findByRole("img", { name: /^Spectrum 7,/u });
    const reads = api.requestedSpectra.length;
    await setRange("1", "3");
    await waitFor(() => expect(shown()).toEqual([1, 2, 3]));
    const sentence = en.scanSelectedOutsideRange.replace("{{name}}", "8");
    expect(screen.getByText(sentence)).toBeVisible();
    expect(screen.getByRole("button", { name: en.scanNext })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: en.scanNext })).toHaveAccessibleDescription(sentence);
    expect(screen.getByRole("img", { name: /^Spectrum 7,/u })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: en.scanRevealInRange }));
    await waitFor(() => expect(shown()).toContain(7));
    expect(screen.queryByText(sentence)).toBeNull();
    expect(api.requestedSpectra.length).toBe(reads);
  });

  it("clears the filters and moves the range when both hide the selected scan", { timeout: 15_000 }, async () => {
    await mount();
    goTo("8");
    await screen.findByRole("img", { name: /^Spectrum 7,/u });
    await setRange("1", "3");
    await waitFor(() => expect(shown()).toEqual([1, 2, 3]));
    const search = screen.getByRole("searchbox", { name: en.scanSearch });
    fireEvent.change(search, { target: { value: "raw-2" } });
    await waitFor(() => expect(shown()).toEqual([2]));
    expect(screen.getByText(en.scanSelectedOutside.replace("{{name}}", "8"))).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: en.scanReveal }));
    await waitFor(() => expect(shown()).toContain(7));
    expect(search).toHaveValue("");
  });

  it("names the range when a narrow one holds no scan, with the rows still loaded", async () => {
    await mount();
    await setRange("2.2", "2.8");
    await waitFor(() => expect(screen.getByText(en.scanNoMatchesInRange)).toBeVisible());
    expect(count()).toBe(counted(0));
    fitAll();
    await waitFor(() => expect(shown()).toHaveLength(8));
    expect(screen.queryByText(en.scanNoMatchesInRange)).toBeNull();
  });

  it("goes to a scan the range hides, by the selection's own reveal", async () => {
    await mount();
    await setRange("1", "3");
    await waitFor(() => expect(shown()).toEqual([1, 2, 3]));
    goTo("7");
    await screen.findByRole("img", { name: /^Spectrum 6,/u });
    await waitFor(() => expect(shown()).toContain(6));
    expect(within(grid()).getAllByRole("row").find(row => row.getAttribute("data-source-index") === "6")).toHaveAttribute("aria-selected", "true");
  });

  it("leaves a truncated prefix unfiltered, since it has no chromatogram to follow", async () => {
    const preview = buildPreview(8, true);
    const api = createFakePreviewApi({ initialDatasets: [selectedFile],
      preview: { ...preview, spectrumTable: { ...preview.spectrumTable, totalRowCount: 120_000 } }, spectrum });
    render(<WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
      <PreviewApiProvider value={api}><App /></PreviewApiProvider>
    </WorkspaceDropTransportProvider>);
    fireEvent.keyDown(await screen.findByRole("treegrid"), { key: "Enter" });
    await screen.findByRole("grid", { name: en.scansTitle });
    expect(shown()).toHaveLength(8);
    expect(screen.queryByRole("button", { name: en.viewerReset })).toBeNull();
    expect(count()).toContain(en.scanPrefix);
    goTo("120000");
    expect(screen.getByText(en.scanGoToRefused.replace("{{value}}", "120000"))).toBeVisible();
  });
});

describe("each file as it was left (VW-51, VW-35)", () => {
  async function mountTwo() {
    const api = createFakePreviewApi({ initialDatasets: [selectedFile, secondFile], preview: () => Promise.resolve(buildPreview(400)), spectrum });
    render(<WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
      <PreviewApiProvider value={api}><App /></PreviewApiProvider>
    </WorkspaceDropTransportProvider>);
    await screen.findByRole("treegrid");
    return api;
  }
  /** A press on the row highlights it, and Enter on the list opens the highlighted row. */
  async function open(api: ReturnType<typeof createFakePreviewApi>, name: string) {
    const opens = api.openedHandles.length;
    fireEvent.click(screen.getByText(name));
    fireEvent.keyDown(screen.getByRole("treegrid"), { key: "Enter" });
    await waitFor(() => expect(api.openedHandles.length).toBe(opens + 1));
    await screen.findByRole("grid", { name: en.scansTitle });
  }
  const scroller = () => grid().querySelector<HTMLElement>(".spectrum-table-viewport")!;
  const scrollTo = (top: number) => { scroller().scrollTop = top; fireEvent.scroll(scroller()); };
  const selectedRow = () => document.querySelector('div.spectrum-table-row[aria-selected="true"]')?.getAttribute("data-source-index") ?? null;
  const ROW = 28;

  it("brings back the selected scan, filters and page of each file", { timeout: 15_000 }, async () => {
    const api = await mountTwo();
    await open(api, selectedFile.fileName);
    goTo("6");
    await screen.findByRole("img", { name: /^Spectrum 5,/u });
    fireEvent.change(screen.getByRole("combobox", { name: en.scanMsLevel }), { target: { value: "2" } });
    scrollTo(120 * ROW);
    const top = shown()[0];

    await open(api, secondFile.fileName);
    expect(screen.getByRole("combobox", { name: en.scanMsLevel })).toHaveValue("all");
    expect(scroller().scrollTop).toBe(0);
    fireEvent.change(screen.getByRole("searchbox", { name: en.scanSearch }), { target: { value: "scan=3" } });

    const reads = api.requestedSpectra.length;
    await open(api, selectedFile.fileName);
    expect(screen.getByRole("combobox", { name: en.scanMsLevel })).toHaveValue("2");
    expect(screen.getByRole("searchbox", { name: en.scanSearch })).toHaveValue("");
    await screen.findByRole("img", { name: /^Spectrum 5,/u });
    expect(api.requestedSpectra.slice(reads)).toEqual([5]);
    // The list is where it was left, not at the selected row, which is out of view.
    expect(scroller().scrollTop).toBe(120 * ROW);
    expect(selectedRow()).toBeNull();
    expect(shown()[0]).toBe(top);

    await open(api, secondFile.fileName);
    expect(screen.getByRole("searchbox", { name: en.scanSearch })).toHaveValue("scan=3");
    expect(screen.getByRole("combobox", { name: en.scanMsLevel })).toHaveValue("all");
  });

  describe("per-scan zoom", () => {
    const spectrumPanel = () => screen.getByRole("region", { name: en.viewerSpectrum });
    async function zoomSpectrum(low: string, high: string) {
      fireEvent.keyDown(within(spectrumPanel()).getByRole("button", { name: en.plotMoreExports }), { key: "Enter" });
      fireEvent.click(await screen.findByRole("menuitem", { name: en.rangeSet }));
      await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
      fireEvent.change(within(spectrumPanel()).getByRole("textbox", { name: en.rangeLow }), { target: { value: low } });
      fireEvent.change(within(spectrumPanel()).getByRole("textbox", { name: en.rangeHigh }), { target: { value: high } });
      fireEvent.click(within(spectrumPanel()).getByRole("button", { name: "Apply range" }));
    }
    async function visit(api: ReturnType<typeof createFakePreviewApi>, scan: number) {
      const asked = api.spectrumProjectionRequests.length;
      goTo(String(scan));
      await screen.findByRole("img", { name: new RegExp(`^Spectrum ${scan - 1},`, "u") });
      await waitFor(() => expect(api.spectrumProjectionRequests.length).toBe(asked + 1));
      return api.spectrumProjectionRequests.at(-1)!;
    }
    async function zoomed(api: ReturnType<typeof createFakePreviewApi>, scan: number) {
      await visit(api, scan);
      const asked = api.spectrumProjectionRequests.length;
      await zoomSpectrum(String(100 + scan), String(500 + scan));
      await waitFor(() => expect(api.spectrumProjectionRequests.length).toBe(asked + 1));
    }
    const shownWindow = (request: { low: number; high: number }) => [request.low, request.high];

    it("gives each scan its own, asks once for it on return, and follows a reset", { timeout: 15_000 }, async () => {
      const api = await mountTwo();
      await open(api, selectedFile.fileName);
      await zoomed(api, 3);
      expect(shownWindow(await visit(api, 4))).toEqual([100, 900]);
      expect(shownWindow(await visit(api, 3))).toEqual([103, 503]);
      const asked = api.spectrumProjectionRequests.length;
      fireEvent.click(within(spectrumPanel()).getByRole("button", { name: en.viewerMzReset }));
      await waitFor(() => expect(api.spectrumProjectionRequests.length).toBe(asked + 1));
      await visit(api, 4);
      expect(shownWindow(await visit(api, 3))).toEqual([100, 900]);
    });

    // The 12th and 13th zoom are `scanMemory.test.ts`'s.
    it("keeps a scan's zoom across files, each file's own", { timeout: 30_000 }, async () => {
      const api = await mountTwo();
      await open(api, selectedFile.fileName);
      await zoomed(api, 3);
      await open(api, secondFile.fileName);
      expect(shownWindow(await visit(api, 3))).toEqual([100, 900]);
      await zoomed(api, 5);
      // Back to the first file: its selection, scan 3, comes back with its zoom.
      await open(api, selectedFile.fileName);
      await screen.findByRole("img", { name: /^Spectrum 2,/u });
      await waitFor(() => expect(shownWindow(api.spectrumProjectionRequests.at(-1)!)).toEqual([103, 503]));
    });
  });
});

describe("forgetting a file", () => {
  it("does not bring a selection back once the row was removed and added again", async () => {
    const api = createFakePreviewApi({ initialDatasets: [selectedFile, secondFile], preview: () => Promise.resolve(buildPreview(8)), spectrum });
    const wrapper = ({ children }: { children: ReactNode }) =>
      <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
        <PreviewApiProvider value={api}>{children}</PreviewApiProvider>
      </WorkspaceDropTransportProvider>;
    const { result } = renderHook(() => usePreviewWorkspace(), { wrapper });
    const opened = async (handle: string, count: number) => {
      await waitFor(() => expect(result.current.backendBusy).toBe(false));
      await act(async () => { result.current.activateDataset(handle); });
      await waitFor(() => expect(api.openedHandles).toHaveLength(count));
      await waitFor(() => expect(result.current.preview.status).toBe("loaded"));
      await waitFor(() => expect(result.current.spectrum.status).not.toBe("loading"));
    };
    await waitFor(() => expect(result.current.roster.datasets).toHaveLength(2));
    await opened(selectedFile.handle, 1);
    act(() => { result.current.selectSpectrum(3); });
    await waitFor(() => expect(result.current.spectrum.status).toBe("loaded"));
    await opened(secondFile.handle, 2);
    act(() => {
      result.current.dispatchRoster({ type: "rowPressed", handle: selectedFile.handle, modifiers: { ctrl: false, shift: false } });
      result.current.removeSelected();
    });
    await waitFor(() => expect(result.current.roster.datasets).toHaveLength(1));
    await act(async () => { result.current.addFiles(); });
    await waitFor(() => expect(result.current.roster.datasets).toHaveLength(2));
    await opened(selectedFile.handle, 3);
    expect(result.current.viewerInteraction.selection?.index ?? null).not.toBe(3);
  });
});

describe("a spectrum on open (V-1)", () => {
  /** A run stating each scan's MS level and declared TIC. */
  const runOf = (scans: readonly (readonly [number, number])[], truncated = false) => {
    const base = buildPreview(scans.length, truncated);
    return { ...base, spectrumTable: { ...base.spectrumTable,
      rows: base.spectrumTable.rows.map((row, index) => ({ ...row, msLevel: scans[index]![0], totalIonCurrent: scans[index]![1],
        retentionTime: { value: index, unit: "notReported" as const } })) } };
  };
  async function opened(api: ReturnType<typeof createFakePreviewApi>) {
    render(<WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
      <PreviewApiProvider value={api}><App /></PreviewApiProvider>
    </WorkspaceDropTransportProvider>);
    fireEvent.keyDown(await screen.findByRole("treegrid"), { key: "Enter" });
    await screen.findByRole("grid", { name: en.scansTitle });
  }
  const selected = () => document.querySelector('div.spectrum-table-row[aria-selected="true"]')?.getAttribute("data-source-index") ?? null;
  const wrapper = (api: ReturnType<typeof createFakePreviewApi>) => ({ children }: { children: ReactNode }) =>
    <WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
      <PreviewApiProvider value={api}>{children}</PreviewApiProvider>
    </WorkspaceDropTransportProvider>;

  it("selects the MS1 at the apex of the declared TIC, not a larger MS2, through a press's path", async () => {
    const api = createFakePreviewApi({ initialDatasets: [selectedFile], spectrum,
      preview: runOf([[1, 10], [2, 900], [1, 70], [2, 500], [1, 30]]) });
    await opened(api);
    await screen.findByRole("img", { name: /^Spectrum 2,/u });
    expect(api.requestedSpectra).toEqual([2]);
    expect(selected()).toBe("2");
    expect(screen.queryByText(en.viewerChooseHelp)).toBeNull();
  });

  it("gives a tie to the first in file order", async () => {
    const api = createFakePreviewApi({ initialDatasets: [selectedFile], spectrum,
      preview: runOf([[1, 10], [1, 70], [2, 70], [1, 70]]) });
    await opened(api);
    await screen.findByRole("img", { name: /^Spectrum 1,/u });
    expect(api.requestedSpectra).toEqual([1]);
  });

  it("selects nothing in a file with no MS1, and never an MS2 in its place (V-1-NOMS1)", async () => {
    const api = createFakePreviewApi({ initialDatasets: [selectedFile], spectrum,
      preview: runOf([[2, 10], [2, 900], [3, 70]]) });
    await opened(api);
    expect(screen.getByText(en.viewerChooseHelp)).toBeVisible();
    expect(api.requestedSpectra).toEqual([]);
    expect(selected()).toBeNull();
  });

  it("selects nothing in a truncated table: a prefix's largest value is not the run's apex", async () => {
    const api = createFakePreviewApi({ initialDatasets: [selectedFile], spectrum,
      preview: runOf([[1, 10], [1, 70]], true) });
    await opened(api);
    expect(screen.getByText(en.viewerChooseHelp)).toBeVisible();
    expect(api.requestedSpectra).toEqual([]);
  });

  it("selects by the table when the run's model refuses, as a press can (mixed units)", async () => {
    const run = runOf([[1, 10], [1, 70]]);
    const mixed = { ...run, chromatogramExportToken: null, spectrumTable: { ...run.spectrumTable, rows: run.spectrumTable.rows.map((row, index) =>
      ({ ...row, retentionTime: { value: index, unit: index === 0 ? "minute" as const : "second" as const } })) } };
    const api = createFakePreviewApi({ initialDatasets: [selectedFile], spectrum, preview: mixed });
    await opened(api);
    await screen.findByRole("img", { name: /^Spectrum 1,/u });
    expect(api.requestedSpectra).toEqual([1]);
  });

  it("gives way to a person pressing a row while its read is out, and the late reply changes nothing", async () => {
    const replies: (() => void)[] = [];
    const api = createFakePreviewApi({ initialDatasets: [selectedFile], preview: runOf([[1, 10], [2, 5], [1, 70]]),
      spectrum: index => new Promise(resolve => { replies[index] = () => { void spectrum(index).then(resolve); }; }) });
    await opened(api);
    await waitFor(() => expect(api.requestedSpectra).toEqual([2]));
    fireEvent.click(within(grid()).getAllByRole("row").find(row => row.getAttribute("data-source-index") === "1")!);
    await waitFor(() => expect(api.requestedSpectra).toEqual([2, 1]));
    replies[1]!();
    await screen.findByRole("img", { name: /^Spectrum 1,/u });
    await act(async () => { replies[2]!(); await Promise.resolve(); });
    expect(screen.getByRole("img", { name: /^Spectrum 1,/u })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /^Spectrum 2,/u })).toBeNull();
    expect(selected()).toBe("1");
  });

  it("holds another file's open until its read lands, as any spectrum read does", async () => {
    let reply: () => void = () => undefined;
    const api = createFakePreviewApi({ initialDatasets: [selectedFile, secondFile], preview: runOf([[1, 10], [1, 70]]),
      spectrum: index => new Promise(resolve => { reply = () => { void spectrum(index).then(resolve); }; }) });
    const { result } = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(api) });
    await waitFor(() => expect(result.current.roster.datasets).toHaveLength(2));
    await waitFor(() => expect(result.current.backendBusy).toBe(false));
    await act(async () => { result.current.activateDataset(selectedFile.handle); });
    await waitFor(() => expect(api.requestedSpectra).toEqual([1]));
    expect(result.current.previewBackendBusy).toBe(true);
    let accepted = true;
    act(() => { accepted = result.current.activateDataset(secondFile.handle); });
    expect(accepted).toBe(false);
    expect(api.openedHandles).toEqual([selectedFile.handle]);
    await act(async () => { reply(); await Promise.resolve(); });
    await waitFor(() => expect(result.current.previewBackendBusy).toBe(false));
    act(() => { accepted = result.current.activateDataset(secondFile.handle); });
    expect(accepted).toBe(true);
    await waitFor(() => expect(api.openedHandles).toEqual([selectedFile.handle, secondFile.handle]));
    await waitFor(() => expect(api.requestedSpectra).toEqual([1, 1]));
    await act(async () => { reply(); await Promise.resolve(); });
    await waitFor(() => expect(result.current.spectrum.status).toBe("loaded"));
  });

  it("never takes the selection from a person coming back: their scan returns, not the apex", async () => {
    const api = createFakePreviewApi({ initialDatasets: [selectedFile, secondFile], spectrum,
      preview: () => Promise.resolve(runOf([[1, 10], [2, 5], [1, 70]])) });
    const { result } = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(api) });
    await waitFor(() => expect(result.current.roster.datasets).toHaveLength(2));
    const open = async (handle: string, count: number) => {
      await waitFor(() => expect(result.current.previewBackendBusy).toBe(false));
      await act(async () => { result.current.activateDataset(handle); });
      await waitFor(() => expect(api.openedHandles).toHaveLength(count));
      await waitFor(() => expect(result.current.spectrum.status).toBe("loaded"));
    };
    await open(selectedFile.handle, 1);
    expect(result.current.viewerInteraction.selection?.index).toBe(2);
    act(() => { result.current.selectSpectrum(0); });
    await waitFor(() => expect(api.requestedSpectra).toEqual([2, 0]));
    await waitFor(() => expect(result.current.spectrum.status).toBe("loaded"));
    await open(secondFile.handle, 2);
    expect(result.current.viewerInteraction.selection?.index).toBe(2);
    await open(selectedFile.handle, 3);
    expect(result.current.viewerInteraction.selection?.index).toBe(0);
  });

  it("is refused where a press would be, and does not come back when the lane frees", async () => {
    let check: () => void = () => undefined;
    let answers = 0;
    let open: (preview: ReturnType<typeof runOf>) => void = () => undefined;
    const api = createFakePreviewApi({ initialDatasets: [selectedFile], spectrum,
      availability: () => (answers += 1) === 1 ? Promise.resolve(availableBackend) : new Promise(resolve => { check = () => resolve(availableBackend); }),
      preview: () => new Promise(resolve => { open = resolve; }) });
    const { result } = renderHook(() => usePreviewWorkspace(), { wrapper: wrapper(api) });
    await waitFor(() => expect(result.current.roster.datasets).toHaveLength(1));
    await waitFor(() => expect(result.current.backendBusy).toBe(false));
    await act(async () => { result.current.activateDataset(selectedFile.handle); });
    await waitFor(() => expect(result.current.preview.status).toBe("opening"));
    act(() => { result.current.checkBackend(); });
    expect(result.current.backendBusy).toBe(true);
    await act(async () => { open(runOf([[1, 10], [1, 70]])); await Promise.resolve(); });
    await waitFor(() => expect(result.current.preview.status).toBe("loaded"));
    expect(result.current.spectrumSelection.status).toBe("unavailable");
    expect(api.requestedSpectra).toEqual([]);
    await act(async () => { check(); await Promise.resolve(); });
    await waitFor(() => expect(result.current.backendBusy).toBe(false));
    expect(result.current.spectrumSelection.status).toBe("available");
    expect(api.requestedSpectra).toEqual([]);
    expect(result.current.viewerInteraction.selection).toBeNull();
  });

  it("shows a refused read at once, with the table still there to choose from", async () => {
    const api = createFakePreviewApi({ initialDatasets: [selectedFile], preview: runOf([[1, 10], [1, 70]]),
      spectrum: () => Promise.reject({ kind: "spectrum_encoding_unsupported", summary: "Rust's words.", detail: null, retryable: false }) });
    await opened(api);
    expect(await screen.findByText(en.errSpectrumEncodingUnsupported)).toBeVisible();
    expect(api.requestedSpectra).toEqual([1]);
    expect(selected()).toBe("1");
    expect(shown()).toEqual([0, 1]);
  });
});
