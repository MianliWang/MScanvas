/**
 * Details (rebuild spec 4) and the Metadata tab (direction A): Details names
 * the open acquisition, the selected spectrum and what the two plots are drawn
 * from; the Metadata tab holds the run and the file's own metadata. No fact is
 * in both, and neither has a `<details>` element.
 */

import { fireEvent, render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createFakePreferencesApi, storedRecord } from "../../test/preferenceFixtures";
import { buildPreview, buildSpectrum } from "../../test/previewFixtures";
import { renderWithPreferences as render } from "../../test/renderWithPreferences";
import { UI_RESOURCES } from "../preferences/i18n";
import { PreferencesApiProvider } from "../preferences/preferencesApi";
import { SessionPreferencesProvider } from "../preferences/SessionPreferencesProvider";
import { PreviewMetadata, PreviewSummary } from "./PreviewSummary";
import { initialSpectrumViewportState } from "./viewer/spectrumViewport";

const en = UI_RESOURCES.en;
const preview = buildPreview();

function renderDetails(props: Partial<Parameters<typeof PreviewSummary>[0]> = {}) {
  render(<PreviewSummary chromatogramScanCount={null} file={preview.file}
    spectrum={null} spectrumViewport={initialSpectrumViewportState} {...props} />);
}

function renderMetadata() {
  render(<PreviewMetadata file={preview.file} metadata={preview.metadata} runSummary={preview.runSummary}
    spectrumListTotal={preview.spectrumTable.totalRowCount} />);
}

describe("the Details inspector", () => {
  it("names the open acquisition, and has no disclosure elements", () => {
    renderDetails();

    expect(screen.getByRole("region", { name: /^QC_pool_01\.mzML ·/u })).toBeVisible();
    expect(document.querySelector("details")).toBeNull();
    // Session timings are diagnostics, not a fact about the run; the run's
    // own facts are the Metadata tab's.
    expect(screen.queryByText("Timing")).toBeNull();
    expect(screen.queryByText(en.summarySpectra)).toBeNull();
    expect(document.querySelector("[data-not-verified]")).toBeNull();
  });

  it("labels an output MSCanvas did not verify beside its name, not in it", () => {
    renderDetails({ file: { ...preview.file, notVerifiedByMscanvas: { unverifiedSettings: true, unverifiedBuildRelease: null } } });

    expect(screen.getByRole("heading", { level: 2 }).textContent).not.toContain(en.m74CnvNotVerified);
    expect(document.querySelector("[data-not-verified]")?.textContent).toBe(en.m74CnvNotVerified);
  });

  it("labels it in zh-CN too, naming the build where the build is why", async () => {
    const preferences = createFakePreferencesApi({ stored: storedRecord({ appearance: { locale: "zh-CN" } }) });
    rtlRender(
      <PreferencesApiProvider value={preferences}>
        <SessionPreferencesProvider>
          <PreviewSummary chromatogramScanCount={null} spectrum={null} spectrumViewport={initialSpectrumViewportState}
            file={{ ...preview.file, notVerifiedByMscanvas: { unverifiedSettings: false, unverifiedBuildRelease: "3.0.26204" } }} />
        </SessionPreferencesProvider>
      </PreferencesApiProvider>,
    );

    await waitFor(() => { expect(document.querySelector("[data-not-verified]")?.textContent).toContain(UI_RESOURCES["zh-CN"].m74CnvNotVerified); });
    expect(document.querySelector("[data-not-verified]")?.textContent).toContain("3.0.26204");
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
});

describe("the Metadata tab", () => {
  it("lists the run's facts as key and value rows", () => {
    renderMetadata();

    const run = screen.getByRole("region", { name: en.summaryRun });
    expect(within(run).getByText(en.summaryFile).nextSibling).toHaveTextContent("QC_pool_01.mzML");
    expect(within(run).getByText(en.summarySpectra).nextSibling).toHaveTextContent("6");
    // Absent, not zero: the fixture reports no chromatogram count.
    expect(within(run).getByText(en.summaryChromatograms).nextSibling).toHaveTextContent(en.viewerNotReported);
    expect(within(run).getByRole("heading", { name: en.summaryMsLevels })).toBeVisible();
    expect(document.querySelector("details")).toBeNull();
  });

  it("folds each metadata section behind a button named by the file's own heading", () => {
    renderMetadata();

    const section = screen.getByRole("button", { name: "Software" });
    expect(section).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("software: pwiz 3.0.25000")).not.toBeVisible();

    fireEvent.click(section);

    expect(section).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("software: pwiz 3.0.25000")).toBeVisible();
  });
});
