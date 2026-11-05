/** N-V3 through the delivered application: go to a scan, the list following the range, memory per file. */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { PreviewApiProvider } from "../features/mzml-preview/api";
import { WorkspaceDropTransportProvider } from "../features/mzml-preview/dropTransport";
import { buildPreview, buildSpectrum, createFakePreviewApi, createFakeWorkspaceDropTransport, selectedFile } from "../test/previewFixtures";
import { UI_RESOURCES } from "../features/preferences/i18n";

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
    const sentence = en.scanSelectedOutsideRange.replace("{{name}}", "7");
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
    expect(screen.getByText(en.scanSelectedOutside.replace("{{name}}", "7"))).toBeVisible();
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
