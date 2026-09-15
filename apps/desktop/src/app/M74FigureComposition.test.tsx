import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { PreviewApiProvider } from "../features/mzml-preview/api";
import { WorkspaceDropTransportProvider } from "../features/mzml-preview/dropTransport";
import type { FigurePreviewRequest, SpectrumExportOutcome } from "../features/mzml-preview/contracts";
import { buildSpectrum, createFakePreviewApi, createFakeWorkspaceDropTransport, deferred, selectedFile, type FakePreviewApiOptions } from "../test/previewFixtures";
import { UI_RESOURCES } from "../features/preferences/i18n";

const NativeUrl = URL;
beforeEach(() => {
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.stubGlobal("URL", class extends NativeUrl { static createObjectURL = () => "blob:mock-figure"; static revokeObjectURL = vi.fn(); });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function mount(options: FakePreviewApiOptions = {}) {
  const preview = vi.fn(async (request: FigurePreviewRequest) => ({ status: "rendered" as const, requestId: request.requestId,
    specId: JSON.stringify(request), empty: false, width: request.settings.widthPx, height: request.settings.heightPx,
    svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>Mock IPC artifact</text></svg>' }));
  const api = createFakePreviewApi({ initialDatasets: [selectedFile], previewFigure: preview,
    spectrum: async index => ({ outcome: "spectrum", spectrum: { ...buildSpectrum(index, 12), mzLow: 100, mzHigh: 900,
      pointCount: 1_000_000, truncated: true, viewportDomain: { state: "admitted", low: 100, high: 900 } } }), ...options });
  render(<WorkspaceDropTransportProvider value={createFakeWorkspaceDropTransport()}><PreviewApiProvider value={api}><App /></PreviewApiProvider></WorkspaceDropTransportProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "Preview focused" }));
  const grid = await screen.findByRole("grid", { name: "Spectra" });
  fireEvent.click(grid.querySelector('[data-source-index="1"]')!);
  await screen.findByRole("img", { name: /^Spectrum 1,/u });
  return { api, preview, panel: screen.getByRole("region", { name: "Selected spectrum" }) };
}
async function openFigure(panel: HTMLElement) {
  fireEvent.click(within(panel).getByRole("button", { name: "Export figure" }));
  const dialog = screen.getByRole("dialog", { name: "Export figure" });
  await within(dialog).findByRole("img", { name: "Scientific figure to export" });
  return dialog;
}

describe("M7.4 through the delivered figure owner", () => {
  it.each(["en", "zh-CN"] as const)("keeps the save-refusal recovery detail inside the spectrum dialog in %s", async locale => {
    const { api, panel } = await mount({ spectrumExport: async () => { throw { kind: "spectrum_not_written", summary: "Owned original summary", detail: "Owned original residue warning", retryable: true, context: { kind: "temporaryExportLeftBehind" } }; } });
    const messages = UI_RESOURCES[locale];
    if (locale === "zh-CN") {
      fireEvent.click(screen.getByRole("button", { name: UI_RESOURCES.en.settings }));
      const settings = screen.getByRole("dialog");
      fireEvent.click(within(settings).getByRole("radio", { name: UI_RESOURCES.en.simplifiedChinese }));
      fireEvent.click(within(settings).getByRole("button", { name: messages.apply }));
    }
    fireEvent.click(within(panel).getByRole("button", { name: messages.figureExportTitle }));
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByRole("img");
    fireEvent.click(within(dialog).getByRole("button", { name: locale === "en" ? "Export SVG…" : "导出 SVG…" }));
    expect(await within(dialog).findByText(messages.m74ErrorNotWritten)).toBeVisible();
    expect(within(dialog).getByText(messages.m74ErrorTemporaryLeft)).toBeVisible();
    fireEvent.change(dialog.querySelector('input[id$="-widthPx"]')!, { target: { value: "" } });
    expect(within(dialog).getByRole("radio", { name: messages.viewerExportFull })).toBeChecked();
    expect(within(dialog).queryByRole("radio", { name: messages.viewerExportFullRun })).toBeNull();
    expect(within(dialog).getByText(messages.viewerExportScope)).toBeVisible();
    expect(api.spectrumExportRequests).toHaveLength(1);
  });
  it("binds preview and save to committed data and captures settings before the save picker settles", async () => {
    const save = deferred<SpectrumExportOutcome>();
    const { api, preview, panel } = await mount({ spectrumExport: () => save.promise });
    fireEvent.click(within(panel).getByText("Edit m/z range"));
    fireEvent.change(within(panel).getByRole("textbox", { name: "From" }), { target: { value: "200" } });
    fireEvent.change(within(panel).getByRole("textbox", { name: "To" }), { target: { value: "800" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Apply range" }));
    await waitFor(() => expect(api.spectrumProjectionRequests.at(-1)).toEqual({ exportToken: "token-1", low: 200, high: 800 }));
    const plot = within(panel).getByRole("img");
    vi.spyOn(plot, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 260, width: 1000, height: 260, toJSON: () => ({}) });
    for (const [event, x] of [["pointerDown", 254], ["pointerMove", 500], ["pointerUp", 500]] as const) {
      fireEvent[event](plot, { button: 0, pointerId: 1, isPrimary: true, pointerType: "mouse", clientX: x, clientY: 80 });
    }
    fireEvent.click(plot, { detail: 1 });
    expect(within(panel).getByRole("button", { name: "Zoom to selection — m/z 350 to 500" })).toBeVisible();
    const dialog = await openFigure(panel);
    fireEvent.click(within(dialog).getByRole("radio", { name: "Current range" }));
    await waitFor(() => expect(preview.mock.calls.at(-1)?.[0].source).toEqual({ kind: "spectrum", token: "token-1", range: { scope: "current", low: 200, high: 800 } }));
    await within(dialog).findByRole("img");
    const svg = within(dialog).getByRole("button", { name: "Export SVG…" });
    await waitFor(() => expect(svg).toHaveAttribute("aria-disabled", "false"));
    fireEvent.click(svg); fireEvent.click(svg);
    expect(api.spectrumExportRequests).toHaveLength(1);
    const captured = structuredClone(api.spectrumExportRequests[0]);
    expect(captured).toMatchObject({ exportToken: "token-1", format: "svg", range: { scope: "current", low: 200, high: 800 }, settings: { widthPx: 1200 } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: /^Width/ }), { target: { value: "1800" } });
    expect(api.spectrumExportRequests[0]).toEqual(captured);
    await act(async () => save.resolve({ status: "cancelled" }));
    await waitFor(() => expect(svg).toHaveAttribute("aria-disabled", "false"));
    expect(within(dialog).getByText("Export cancelled. Nothing was saved.")).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: "Return to viewer" }));
    expect(within(panel).getByRole("button", { name: "Zoom to selection — m/z 350 to 500" })).toBeVisible();
    expect(api.spectrumProjectionRequests.at(-1)).toEqual({ exportToken: "token-1", low: 200, high: 800 });
  });

  it("allows another explicit save after a cancellation settles without an intervening busy render", async () => {
    const { api, panel } = await mount({ spectrumExport: async () => ({ status: "cancelled" }) });
    const dialog = await openFigure(panel);
    const save = within(dialog).getByRole("button", { name: "Export SVG…" });
    await act(async () => { fireEvent.click(save); await Promise.resolve(); });
    await waitFor(() => expect(save).toHaveAttribute("aria-disabled", "false"));
    expect(api.spectrumExportRequests).toHaveLength(1);
    await act(async () => { fireEvent.click(save); await Promise.resolve(); });
    expect(api.spectrumExportRequests).toHaveLength(2);
  });
});
