import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
      retentionTime: { value: index, unitKnown: false },
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
  fireEvent.click(await screen.findByRole("button", { name: "Preview focused" }));
  await screen.findByRole("grid", { name: "Spectra" });
  return { api, preview };
}
const grid = () => screen.getByRole("grid");
const rows = () => within(grid()).getAllByRole("row").filter(row => row.hasAttribute("data-row-position"));
function rowIndex(row: HTMLElement): number { return Number(within(row).getAllByRole("gridcell")[0].textContent); }
function selectRow(index: number, cell = 2) {
  const row = rows().find(row => rowIndex(row) === index);
  if (!row) throw new Error(`Source row ${index} is not displayed`);
  fireEvent.click(within(row).getAllByRole("gridcell")[cell]);
}
const spectrumPanel = () => screen.getByRole("region", { name: "Selected spectrum" });
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
function editRange(panel: HTMLElement, low: string, high: string) {
  fireEvent.click(within(panel).getByText(/^Edit .* range$/u));
  fireEvent.change(within(panel).getByRole("textbox", { name: "From" }), { target: { value: low } });
  fireEvent.change(within(panel).getByRole("textbox", { name: "To" }), { target: { value: high } });
  fireEvent.click(within(panel).getByRole("button", { name: "Apply range" }));
}
afterEach(() => { vi.restoreAllMocks(); });

describe("M7.3 through the delivered application", () => {
  it("sorts and searches loaded facts, activates source indices from row bodies or keys, and preserves hidden selection", async () => {
    const { api, preview } = await mount(); const sourceRows = [...preview.spectrumTable.rows];
    const search = screen.getByRole("searchbox", { name: "Search loaded scans" });
    fireEvent.click(within(grid()).getByRole("button", { name: "Total ion current" }));
    fireEvent.click(within(grid()).getByRole("button", { name: "Total ion current" }));
    expect(within(grid()).getByRole("columnheader", { name: "Total ion current" })).toHaveAttribute("aria-sort", "descending");
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
    selectRow(3, 5);
    await screen.findByRole("img", { name: /^Spectrum 3,/u });
    expect(api.requestedSpectra).toEqual([3, 7, 3]);
    search.focus(); fireEvent.change(search, { target: { value: "raw-1" } });
    expect(screen.getByText(/Selected scan 3 is outside these results/u)).toBeVisible();
    expect(screen.getByRole("button", { name: "Previous scan" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next scan" })).toBeDisabled();
    expect(screen.getByRole("img", { name: /^Spectrum 3,/u })).toBeInTheDocument();
    expect(document.activeElement).toBe(search);
    fireEvent.click(screen.getByRole("button", { name: "Clear filters and reveal" }));
    fireEvent.click(screen.getByRole("button", { name: "Next scan" }));
    await screen.findByRole("img", { name: /^Spectrum 2,/u });
    expect(api.requestedSpectra).toEqual([3, 7, 3, 2]);
    expect(preview.spectrumTable.rows).toEqual(sourceRows);
  });

  it("exports only committed axis ranges while drawing or pending, then the newly confirmed range from retained tokens", async () => {
    const { api } = await mount(); selectRow(4);
    await screen.findByRole("img", { name: /^Spectrum 4,/u });
    await waitFor(() => expect(api.spectrumProjectionRequests).toHaveLength(1));
    const mzPanel = spectrumPanel(); const rtPanel = chromatogramPanel();
    editRange(mzPanel, "2e2", "800"); editRange(rtPanel, "1", "6");
    await waitFor(() => expect(api.spectrumProjectionRequests).toHaveLength(2));
    expect(api.spectrumProjectionRequests[1]).toEqual({ exportToken: "token-4", low: 200, high: 800 });
    fireEvent.click(within(mzPanel).getByText("Export spectrum"));
    fireEvent.click(within(mzPanel).getByRole("radio", { name: "Current range" }));
    fireEvent.click(document.getElementById("chromatogram-export-toggle")!);
    fireEvent.click(within(rtPanel).getByRole("radio", { name: "Current range" }));
    // The table hides the selected row; the scientific source and export pair remain unchanged.
    fireEvent.change(screen.getByRole("searchbox", { name: "Search loaded scans" }), { target: { value: "rare" } });
    const mzPlot = plotIn(mzPanel); const rtPlot = plotIn(rtPanel);
    startBand(mzPlot, "mz");
    fireEvent.click(within(mzPanel).getByRole("button", { name: "Export CSV…" }));
    await waitFor(() => expect(api.spectrumExportRequests).toHaveLength(1));
    expect(api.spectrumExportRequests[0].range).toEqual({ scope: "current", low: 200, high: 800 });
    releaseBand(mzPlot, "mz");
    expect(api.spectrumProjectionRequests).toHaveLength(2);
    const confirmMz = within(mzPanel).getByRole("button", { name: "Zoom to selection — m/z 350 to 500" });
    expect(confirmMz).toBeVisible();
    await waitFor(() => expect(within(mzPanel).getByRole("button", { name: "Export CSV…" })).toBeEnabled());
    fireEvent.click(within(mzPanel).getByRole("button", { name: "Export CSV…" }));
    await waitFor(() => expect(api.spectrumExportRequests).toHaveLength(2));
    expect(api.spectrumExportRequests[1].range).toEqual({ scope: "current", low: 200, high: 800 });
    fireEvent.click(confirmMz);
    await waitFor(() => expect(api.spectrumProjectionRequests).toHaveLength(3));
    expect(api.spectrumProjectionRequests[2]).toEqual({ exportToken: "token-4", low: 350, high: 500 });
    await waitFor(() => expect(within(mzPanel).getByRole("button", { name: "Export CSV…" })).toBeEnabled());
    fireEvent.click(within(mzPanel).getByRole("button", { name: "Export CSV…" }));
    await waitFor(() => expect(api.spectrumExportRequests).toHaveLength(3));
    expect(api.spectrumExportRequests[2]).toMatchObject({ exportToken: "token-4", range: { scope: "current", low: 350, high: 500 } });
    startBand(rtPlot, "rt"); releaseBand(rtPlot, "rt");
    await waitFor(() => expect(within(rtPanel).getByRole("button", { name: "Export CSV…" })).toBeEnabled());
    fireEvent.click(within(rtPanel).getByRole("button", { name: "Export CSV…" }));
    await waitFor(() => expect(api.chromatogramExportRequests).toHaveLength(1));
    expect(api.chromatogramExportRequests[0].range).toEqual({ scope: "current", low: 1, high: 6 });
    fireEvent.keyDown(rtPlot, { key: "Enter" });
    await waitFor(() => expect(within(rtPanel).getByRole("button", { name: "Export CSV…" })).toBeEnabled());
    fireEvent.click(within(rtPanel).getByRole("button", { name: "Export CSV…" }));
    await waitFor(() => expect(api.chromatogramExportRequests).toHaveLength(2));
    expect(api.chromatogramExportRequests[1].range).toEqual({ scope: "current", low: 2.25, high: 3.5 });
    fireEvent.click(within(rtPanel).getByRole("radio", { name: "Full run" }));
    await waitFor(() => expect(within(rtPanel).getByRole("button", { name: "Export linked SVG…" })).toBeEnabled());
    fireEvent.click(within(rtPanel).getByRole("button", { name: "Export linked SVG…" }));
    await waitFor(() => expect(api.linkedFigureRequests).toHaveLength(1));
    expect(api.linkedFigureRequests[0]).toMatchObject({ spectrumToken: "token-4", range: { scope: "full", low: null, high: null } });
    // Full export still delegates complete retained source; neither filtered rows nor vertices supply its data.
    fireEvent.click(within(mzPanel).getByRole("radio", { name: "Full spectrum" }));
    await waitFor(() => expect(within(mzPanel).getByRole("button", { name: "Export CSV…" })).toBeEnabled());
    fireEvent.click(within(mzPanel).getByRole("button", { name: "Export CSV…" }));
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
    fireEvent.click(within(panel).getByText("Edit m/z range"));
    const from = within(panel).getByRole("textbox", { name: "From" }) as HTMLInputElement;
    from.focus(); fireEvent.change(from, { target: { value: "2e" } }); from.setSelectionRange(1, 1);
    fireEvent.compositionStart(from); fireEvent.keyDown(from, { key: "Enter", isComposing: true });
    expect(api.spectrumProjectionRequests).toHaveLength(1); fireEvent.compositionEnd(from);
    const entry = screen.getByRole("button", { name: "Settings" }); entry.focus(); fireEvent.click(entry);
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(plot, { key: "Enter" });
    fireEvent.click(within(dialog).getByRole("radio", { name: UI_RESOURCES.en.simplifiedChinese }));
    fireEvent.click(within(dialog).getByRole("radio", { name: UI_RESOURCES["zh-CN"].compact }));
    fireEvent.click(within(dialog).getByRole("button", { name: UI_RESOURCES["zh-CN"].apply }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("textbox", { name: "起点" })).toBe(from);
    expect(from.value).toBe("2e"); expect(from.selectionStart).toBe(1);
    expect(screen.getByRole("button", { name: /放大选区.*300.*500/u })).toBeVisible();
    expect(api.spectrumProjectionRequests).toHaveLength(1); expect(api.requestedSpectra).toEqual([4]);
    fireEvent.click(screen.getByRole("button", { name: "应用范围" }));
    expect(screen.getByText(UI_RESOURCES["zh-CN"].rangeInvalid)).toBeVisible();
    from.focus(); fireEvent.keyDown(from, { key: "Escape" });
    expect(from).not.toBeInTheDocument();
    expect(screen.getByText("编辑 m/z 范围")).toHaveFocus();
    expect(api.spectrumProjectionRequests).toHaveLength(1);
  });
});
