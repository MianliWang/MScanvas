/** N-V3 through the delivered application: go to a scan, the list following the range, memory per file. */
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { PreviewApiProvider } from "../features/mzml-preview/api";
import { WorkspaceDropTransportProvider } from "../features/mzml-preview/dropTransport";
import { buildPreview, buildSpectrum, createFakePreviewApi, createFakeWorkspaceDropTransport, secondFile, selectedFile } from "../test/previewFixtures";
import { UI_RESOURCES } from "../features/preferences/i18n";
import { usePreviewWorkspace } from "../features/mzml-preview/usePreviewWorkspace";

const en = UI_RESOURCES.en;
const source = () => {
  const preview = buildPreview(8);
  return { ...preview, spectrumTable: { ...preview.spectrumTable,
    rows: preview.spectrumTable.rows.map((row, index) => ({ ...row,
      identifier: index === 3 || index === 7 ? `rare-raw-${index}` : `raw-${index}`,
      msLevel: index % 2 === 0 ? 1 : 2, totalIonCurrent: (index + 1) * 10,
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

  it("clears the filters and moves the range when both hide the selected scan", async () => {
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

  it("brings back the selected scan, filters and page of each file", async () => {
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

    it("keeps a scan's zoom across files, and the 13th zoom pushes out the longest unused", { timeout: 30_000 }, async () => {
      const api = await mountTwo();
      await open(api, selectedFile.fileName);
      await zoomed(api, 1);
      await open(api, secondFile.fileName);
      for (let scan = 2; scan <= 12; scan += 1) await zoomed(api, scan);
      // Back to the first file: its selection, scan 1, comes back with its zoom.
      await open(api, selectedFile.fileName);
      await screen.findByRole("img", { name: /^Spectrum 0,/u });
      await waitFor(() => expect(shownWindow(api.spectrumProjectionRequests.at(-1)!)).toEqual([101, 501]));
      await open(api, secondFile.fileName);
      await waitFor(() => expect(shownWindow(api.spectrumProjectionRequests.at(-1)!)).toEqual([112, 512]));
      await zoomed(api, 13);
      expect(shownWindow(await visit(api, 2))).toEqual([100, 900]);
      expect(shownWindow(await visit(api, 3))).toEqual([103, 503]);
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
