/**
 * Details (rebuild spec 4): the run, its MS levels, the selected spectrum, what
 * the two plots are drawn from, and the file's own metadata -- each a section,
 * none a `<details>`.
 */

import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { buildPreview, buildSpectrum } from "../../test/previewFixtures";
import { renderWithPreferences as render } from "../../test/renderWithPreferences";
import { UI_RESOURCES } from "../preferences/i18n";
import { PreviewSummary } from "./PreviewSummary";
import { initialSpectrumViewportState } from "./viewer/spectrumViewport";

const en = UI_RESOURCES.en;
const preview = buildPreview();

function renderDetails(props: Partial<Parameters<typeof PreviewSummary>[0]> = {}) {
  render(<PreviewSummary chromatogramScanCount={null} file={preview.file} metadata={preview.metadata} runSummary={preview.runSummary}
    spectrum={null} spectrumListTotal={preview.spectrumTable.totalRowCount} spectrumViewport={initialSpectrumViewportState} {...props} />);
}

describe("the Details inspector", () => {
  it("names the run and its acquisition, and has no disclosure elements", () => {
    renderDetails();

    const run = screen.getByRole("region", { name: en.summaryRun });
    expect(within(run).getByText(/^QC_pool_01\.mzML ·/u)).toBeVisible();
    expect(document.querySelector("details")).toBeNull();
    // Session timings are diagnostics, not a fact about the run.
    expect(screen.queryByText("Timing")).toBeNull();
  });

  it("says no spectrum is selected, then shows the selected spectrum's facts", () => {
    renderDetails();
    expect(screen.getByText(en.viewerSpectrumNone)).toBeVisible();

    renderDetails({ spectrum: { ...buildSpectrum(3, 4), identifiers: ["scan=4"], precursors: [] } });
    expect(screen.getAllByRole("heading", { name: en.viewerSpectrum })).toHaveLength(2);
    expect(screen.getByText("scan=4")).toBeVisible();
    expect(screen.getByText(en.viewerBasePeak)).toBeVisible();
  });

  it("says what each plot is drawn from, only while there is something to say", () => {
    renderDetails({ chromatogramScanCount: 50, spectrum: { ...buildSpectrum(3, 4), representationKnown: false } });

    expect(screen.getByRole("heading", { name: en.detailsChromatogramSource })).toBeVisible();
    expect(screen.getByText(en.viewerScanSource.replace(/\{\{\s*count(?:,\s*number)?\s*\}\}/u, "50"))).toBeVisible();
    expect(screen.getByRole("heading", { name: en.detailsSpectrumSource })).toBeVisible();
    expect(screen.getByText(en.plotUnknownRepresentation)).toBeVisible();
  });

  it("folds each metadata section behind a button named by the file's own heading", () => {
    renderDetails();

    const section = screen.getByRole("button", { name: "Software" });
    expect(section).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("software: pwiz 3.0.25000")).not.toBeVisible();

    fireEvent.click(section);

    expect(section).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("software: pwiz 3.0.25000")).toBeVisible();
  });
});
