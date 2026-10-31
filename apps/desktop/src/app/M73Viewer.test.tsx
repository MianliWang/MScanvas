import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { PreviewApiProvider } from "../features/mzml-preview/api";
import { WorkspaceDropTransportProvider } from "../features/mzml-preview/dropTransport";
import { buildPreview, buildSpectrum, createFakePreviewApi, createFakeWorkspaceDropTransport, selectedFile } from "../test/previewFixtures";
import { UI_RESOURCES } from "../features/preferences/i18n";

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
async function mount() {
  const preview = source();
  const api = createFakePreviewApi({ initialDatasets: [selectedFile], preview,
    spectrum: async index => ({ outcome: "spectrum", spectrum: { ...buildSpectrum(index, 12),
      pointCount: 1_000_000, truncated: true, mzLow: 100, mzHigh: 900,
      viewportDomain: { state: "admitted", low: 100, high: 900 },
    } }),
  });
  render(<WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}>
    <PreviewApiProvider value={api}><App /></PreviewApiProvider>
  </WorkspaceDropTransportProvider>);
  fireEvent.keyDown(await screen.findByRole("treegrid"), { key: "Enter" });
  await screen.findByRole("grid", { name: UI_RESOURCES.en.scansTitle });
  return { api, preview };
}
const grid = () => screen.getByRole("grid");
const rows = () => within(grid()).getAllByRole("row").filter(row => row.hasAttribute("data-row-position"));
function rowIndex(row: HTMLElement): number { return Number(row.getAttribute("data-source-index")); }
function selectRow(index: number, cell = 2) {
  const row = rows().find(row => rowIndex(row) === index);
  if (!row) throw new Error(`Source row ${index} is not displayed`);
  fireEvent.click(within(row).getAllByRole("gridcell")[cell]);
}
const spectrumPanel = () => screen.getByRole("region", { name: UI_RESOURCES.en.viewerSpectrum });
const chromatogramPanel = () => screen.getByRole("region", { name: "Chromatogram" });
function plotIn(panel: HTMLElement) {
  const plot = within(panel).getByRole("img");
  vi.spyOn(plot, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0,
    right: 1000, bottom: 260, width: 1000, height: 260, toJSON: () => ({}) });
  return plot;
}
const point = (axis: "rt" | "mz", fraction: number) => axis === "rt" ? 64 + 924 * fraction : 8 + 984 * fraction;
function pointer(plot: HTMLElement, name: "pointerDown" | "pointerMove" | "pointerUp", x: number) {
  fireEvent[name](plot, { button: 0, pointerId: 1, isPrimary: true, pointerType: "mouse", clientX: x, clientY: 80 });
}
function startBand(plot: HTMLElement, axis: "rt" | "mz") {
  pointer(plot, "pointerDown", point(axis, .25)); pointer(plot, "pointerMove", point(axis, .5));
}
function releaseBand(plot: HTMLElement, axis: "rt" | "mz") {
  pointer(plot, "pointerUp", point(axis, .5)); fireEvent.click(plot, { detail: 1 });
}
/** The RT header shows its short label first and its full name after it. */
const RT_HEADER = "RT (Retention time) (unit not reported)";
/** Each plot's Set range… is the first item of its own ⋯ menu (direction A). */
async function openRangeEditor(panel: HTMLElement, locale: "en" | "zh-CN" = "en") {
  fireEvent.keyDown(within(panel).getByRole("button", { name: UI_RESOURCES[locale].plotMoreExports }), { key: "Enter" });
  fireEvent.click(await screen.findByRole("menuitem", { name: UI_RESOURCES[locale].rangeSet }));
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
}
async function editRange(panel: HTMLElement, low: string, high: string) {
  await openRangeEditor(panel);
  fireEvent.change(within(panel).getByRole("textbox", { name: "From" }), { target: { value: low } });
  fireEvent.change(within(panel).getByRole("textbox", { name: "To" }), { target: { value: high } });
  fireEvent.click(within(panel).getByRole("button", { name: "Apply range" }));
}
/** A plot's export scope lives in its figure dialog. */
async function chooseScope(panel: HTMLElement, name: string) {
  fireEvent.click(within(panel).getByRole("button", { name: "Export figure" }));
  const dialog = screen.getByRole("dialog");
  // A current range names its window after the words (rebuild spec 6).
  fireEvent.click(within(dialog).getByRole("radio", { name: new RegExp(`^${name}`, "u") }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Return to viewer" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
}
/** Exports a plot's CSV from its ⋯ menu once the one lane is free. */
async function exportCsv(panel: HTMLElement) {
  fireEvent.keyDown(within(panel).getByRole("button", { name: UI_RESOURCES.en.plotMoreExports }), { key: "Enter" });
  const item = await screen.findByRole("menuitem", { name: "Export CSV…" });
  await waitFor(() => expect(item).not.toHaveAttribute("aria-disabled", "true"));
  fireEvent.click(item);
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
}
const NativeUrl = URL;
beforeEach(() => {
  // The figure dialog draws its preview from an object URL, which jsdom lacks.
  vi.stubGlobal("URL", class extends NativeUrl { static createObjectURL = () => "blob:mock-figure"; static revokeObjectURL = vi.fn(); });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("M7.3 through the delivered application", () => {
  it("sorts and searches loaded facts and activates source indices from row bodies or keys", async () => {
    const { api, preview } = await mount(); const sourceRows = [...preview.spectrumTable.rows];
    const search = screen.getByRole("searchbox", { name: "Search loaded scans" });
    fireEvent.click(within(grid()).getByRole("button", { name: RT_HEADER }));
    fireEvent.click(within(grid()).getByRole("button", { name: RT_HEADER }));
    expect(within(grid()).getByRole("columnheader", { name: /^RT(?: |$)/u })).toHaveAttribute("aria-sort", "descending");
    expect(rows().map(rowIndex)).toEqual([7, 6, 5, 4, 3, 2, 1, 0]);
    fireEvent.change(search, { target: { value: "rare" } });
    expect(rows().map(rowIndex)).toEqual([7, 3]);
    const first = rows()[0]; first.focus(); fireEvent.keyDown(first, { key: "End" });
    expect(document.activeElement).toBe(rows()[1]);
    expect(api.requestedSpectra).toEqual([]);
    expect(api.spectrumProjectionRequests).toEqual([]);
    fireEvent.keyDown(rows()[1], { key: "Enter" });
    await screen.findByRole("img", { name: /^Spectrum 3,/u });
    expect(api.requestedSpectra).toEqual([3]);
    selectRow(7, 3);
    await screen.findByRole("img", { name: /^Spectrum 7,/u });
    expect(api.requestedSpectra).toEqual([3, 7]);
    selectRow(3, 3);
    await screen.findByRole("img", { name: /^Spectrum 3,/u });
    expect(api.requestedSpectra).toEqual([3, 7, 3]);
    expect(preview.spectrumTable.rows).toEqual(sourceRows);
  });

  it("preserves a hidden selection and resumes navigation in the displayed sort order", async () => {
    const { api, preview } = await mount(); const sourceRows = [...preview.spectrumTable.rows];
    fireEvent.click(within(grid()).getByRole("button", { name: RT_HEADER }));
    fireEvent.click(within(grid()).getByRole("button", { name: RT_HEADER }));
    expect(rows().map(rowIndex)).toEqual([7, 6, 5, 4, 3, 2, 1, 0]);
    selectRow(3, 3);
    await screen.findByRole("img", { name: /^Spectrum 3,/u });
    expect(api.requestedSpectra).toEqual([3]);
    const search = screen.getByRole("searchbox", { name: "Search loaded scans" });
    search.focus(); fireEvent.change(search, { target: { value: "raw-1" } });
    expect(screen.getByText(/Selected scan 3 is hidden by the filters/u)).toBeVisible();
    expect(screen.getByRole("button", { name: "Previous scan" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Next scan" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("img", { name: /^Spectrum 3,/u })).toBeInTheDocument();
    expect(document.activeElement).toBe(search);
    fireEvent.click(screen.getByRole("button", { name: "Clear filters and reveal" }));
    fireEvent.click(screen.getByRole("button", { name: "Next scan" }));
    await screen.findByRole("img", { name: /^Spectrum 2,/u });
    expect(api.requestedSpectra).toEqual([3, 2]);
    expect(preview.spectrumTable.rows).toEqual(sourceRows);
  });

  // Its own allowance: ~2 s alone, but 5175 ms against the 5 s default in a loaded whole-suite run (PM9 slice-07 U1-2).
  it("exports only committed axis ranges while drawing or pending, then the newly confirmed range from retained tokens", { timeout: 15_000 }, async () => {
    const { api } = await mount(); selectRow(4);
    await screen.findByRole("img", { name: /^Spectrum 4,/u });
    await waitFor(() => expect(api.spectrumProjectionRequests).toHaveLength(1));
    const mzPanel = spectrumPanel(); const rtPanel = chromatogramPanel();
    await editRange(mzPanel, "2e2", "800"); await editRange(rtPanel, "1", "6");
    await waitFor(() => expect(api.spectrumProjectionRequests).toHaveLength(2));
    expect(api.spectrumProjectionRequests[1]).toEqual({ exportToken: "token-4", low: 200, high: 800 });
    await chooseScope(mzPanel, "Current range");
    await chooseScope(rtPanel, "Current range");
    // The table hides the selected row; the scientific source and export pair remain unchanged.
    fireEvent.change(screen.getByRole("searchbox", { name: "Search loaded scans" }), { target: { value: "rare" } });
    const mzPlot = plotIn(mzPanel); const rtPlot = plotIn(rtPanel);
    startBand(mzPlot, "mz");
    await exportCsv(mzPanel);
    await waitFor(() => expect(api.spectrumExportRequests).toHaveLength(1));
    expect(api.spectrumExportRequests[0].range).toEqual({ scope: "current", low: 200, high: 800 });
    // The menu took focus from the plot, which abandons a drawing (never a
    // settled band), so the band is drawn again before it can pend.
    startBand(mzPlot, "mz"); releaseBand(mzPlot, "mz");
    expect(api.spectrumProjectionRequests).toHaveLength(2);
    const confirmMz = within(mzPanel).getByRole("button", { name: "Zoom to selection — m/z 350.0000 to 500.0000" });
    expect(confirmMz).toBeVisible();
    await exportCsv(mzPanel);
    await waitFor(() => expect(api.spectrumExportRequests).toHaveLength(2));
    expect(api.spectrumExportRequests[1].range).toEqual({ scope: "current", low: 200, high: 800 });
    fireEvent.click(confirmMz);
    await waitFor(() => expect(api.spectrumProjectionRequests).toHaveLength(3));
    expect(api.spectrumProjectionRequests[2]).toEqual({ exportToken: "token-4", low: 350, high: 500 });
    await exportCsv(mzPanel);
    await waitFor(() => expect(api.spectrumExportRequests).toHaveLength(3));
    expect(api.spectrumExportRequests[2]).toMatchObject({ exportToken: "token-4", range: { scope: "current", low: 350, high: 500 } });
    startBand(rtPlot, "rt"); releaseBand(rtPlot, "rt");
    await exportCsv(rtPanel);
    await waitFor(() => expect(api.chromatogramExportRequests).toHaveLength(1));
    expect(api.chromatogramExportRequests[0].range).toEqual({ scope: "current", low: 1, high: 6 });
    // The menu returned focus to its trigger; the band confirms from the plot.
    rtPlot.focus(); fireEvent.keyDown(rtPlot, { key: "Enter" });
    await exportCsv(rtPanel);
    await waitFor(() => expect(api.chromatogramExportRequests).toHaveLength(2));
    expect(api.chromatogramExportRequests[1].range).toEqual({ scope: "current", low: 2.25, high: 3.5 });
    // The linked figure, from the chromatogram's ⋯ menu, over the full run.
    fireEvent.keyDown(within(rtPanel).getByRole("button", { name: UI_RESOURCES.en.plotMoreExports }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: new RegExp("^" + UI_RESOURCES.en.figurePreviewLinked, "u") }));
    const linked = screen.getByRole("dialog");
    fireEvent.click(within(linked).getByRole("radio", { name: "Full run" }));
    await within(linked).findByRole("img");
    const svg = within(linked).getByRole("button", { name: "Export SVG…" });
    await waitFor(() => expect(svg).not.toHaveAttribute("aria-disabled", "true"));
    fireEvent.click(svg);
    await waitFor(() => expect(api.linkedFigureRequests).toHaveLength(1));
    expect(api.linkedFigureRequests[0]).toMatchObject({ spectrumToken: "token-4", range: { scope: "full", low: null, high: null } });
    fireEvent.click(within(linked).getByRole("button", { name: "Return to viewer" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Full export still delegates complete retained source; neither filtered rows nor vertices supply its data.
    await chooseScope(mzPanel, "Full spectrum");
    await exportCsv(mzPanel);
    await waitFor(() => expect(api.spectrumExportRequests).toHaveLength(4));
    expect(api.spectrumExportRequests[3].range).toEqual({ scope: "full", low: null, high: null });
    expect(api.requestedSpectra).toEqual([4]);
    expect(api.spectrumProjectionRequests).toHaveLength(3);
  });

  it("preserves pending source coordinates and raw drafts across Settings while refusing modal-covered shortcuts", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const { api } = await mount(); selectRow(4);
    await screen.findByRole("img", { name: /^Spectrum 4,/u });
    await waitFor(() => expect(api.spectrumProjectionRequests).toHaveLength(1));
    const panel = spectrumPanel(); const plot = plotIn(panel);
    startBand(plot, "mz"); releaseBand(plot, "mz");
    await openRangeEditor(panel);
    const from = within(panel).getByRole("textbox", { name: "From" }) as HTMLInputElement;
    from.focus(); fireEvent.change(from, { target: { value: "2e" } }); from.setSelectionRange(1, 1);
    fireEvent.compositionStart(from); fireEvent.keyDown(from, { key: "Enter", isComposing: true });
    expect(api.spectrumProjectionRequests).toHaveLength(1); fireEvent.compositionEnd(from);
    const entry = screen.getByRole("button", { name: "Settings…" }); entry.focus(); fireEvent.click(entry);
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(plot, { key: "Enter" });
    fireEvent.click(within(dialog).getByRole("radio", { name: UI_RESOURCES.en.simplifiedChinese }));
    fireEvent.click(within(dialog).getByRole("radio", { name: UI_RESOURCES["zh-CN"].compact }));
    fireEvent.click(within(dialog).getByRole("button", { name: UI_RESOURCES["zh-CN"].close }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("textbox", { name: "起点" })).toBe(from);
    expect(from.value).toBe("2e"); expect(from.selectionStart).toBe(1);
    expect(screen.getByRole("button", { name: /放大选区.*300.*500/u })).toBeVisible();
    expect(api.spectrumProjectionRequests).toHaveLength(1); expect(api.requestedSpectra).toEqual([4]);
    fireEvent.click(screen.getByRole("button", { name: "应用范围" }));
    expect(screen.getByText(UI_RESOURCES["zh-CN"].rangeInvalid)).toBeVisible();
    from.focus(); fireEvent.keyDown(from, { key: "Escape" });
    expect(from).not.toBeInTheDocument();
    // Closing gives the keyboard back to the ⋯ trigger the editor came from.
    expect(within(panel).getByRole("button", { name: UI_RESOURCES["zh-CN"].plotMoreExports })).toHaveFocus();
    expect(api.spectrumProjectionRequests).toHaveLength(1);
  });
});
