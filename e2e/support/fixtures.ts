/**
 * What the mocked Tauri backend answers, for the rendered QA run.
 *
 * Built from the repository's own preview fixtures rather than from hand-typed
 * literals, so the shapes a rendered test drives are the shapes the unit suite
 * already agrees with. A fixture that drifted from the contract here would make
 * a passing rendered test evidence for nothing.
 */

import {
  FAKE_WORKSPACE_CAPACITY,
  availableBackend,
  buildPreview,
  buildSpectrum,
  selectedFile,
  shimadzuDataset,
} from "../../apps/desktop/src/test/previewFixtures";

/** The vendor acquisition the export must never follow focus onto. */
export const VENDOR_ROW = shimadzuDataset(9);

/** The converted mzML whose preview is opened and whose spectrum is exported. */
export const MZML_ROW = selectedFile;

/** How many points the mocked backend says a complete exported spectrum holds. */
export const COMPLETE_POINT_COUNT = 1_000_000;

/**
 * How many scans the mocked backend says the run holds.
 *
 * Unlike any row count this document receives, deliberately: Rust counts the
 * facts it retained, and a fixture whose answer matched the transfer would let
 * an export that read the transfer pass.
 */
export const COMPLETE_SCAN_COUNT = 36_319;

/** The end of the run the mocked chromatogram export reports covering. */
const FULL_RANGE_HIGH = 0.0625;

/** The spectrum index the QA run selects. */
export const SELECTED_INDEX = 0;

/**
 * Where the mocked backend says that scan sits.
 *
 * The retained table row's own number, which is the marker's coordinate. Stated
 * here because it is Rust's answer rather than the document's: nothing the
 * webview holds supplies it, and a rendered test asserting it came back proves
 * the direction it travelled in.
 */
export const SELECTED_RETENTION_TIME = 0.0125;

/** A spectrum that loaded and has peaks. */
export function spectrumWithPeaks() {
  return buildSpectrum(SELECTED_INDEX, 6);
}

/**
 * A second spectrum, with its own token and its own m/z domain.
 *
 * The mocked boundary answers every selection from one table, so a test about
 * *changing* spectra has to supply the second one: a row click that returns the
 * same token is a redelivery of the spectrum already current, and correctly
 * resets nothing.
 */
export function secondSpectrum() {
  return buildSpectrum(SELECTED_INDEX + 1, 6);
}

/** A spectrum that loaded and has none, which is still exportable. */
export function spectrumWithoutPeaks() {
  const spectrum = buildSpectrum(SELECTED_INDEX, 0);
  return { ...spectrum, pointCount: 0, mz: [], intensity: [] };
}

/**
 * The m/z range the mocked spectrum's viewport opens at.
 *
 * `buildSpectrum` places six points from 300 at a step of 0.5, and admits the
 * domain they span. Stated here because a rendered test that recomputed it
 * would be testing its own arithmetic.
 */
export const SPECTRUM_MZ_LOW = 300;
export const SPECTRUM_MZ_HIGH = 302.5;

/**
 * The m/z range a *truncated* mocked spectrum spans.
 *
 * Far wider than the points that reach the document, which is the whole point
 * of it: `TRUNCATED_MZ_HIGH` is where the retained source ends and
 * `SPECTRUM_MZ_HIGH` is where the transferred prefix does. A viewport moved
 * between those two numbers is asking for a region this document has never
 * held, and what it draws there can only have come from Rust.
 */
export const TRUNCATED_MZ_LOW = 300;
export const TRUNCATED_MZ_HIGH = 900;

/** How many points the mocked backend says the truncated spectrum really has. */
export const TRUNCATED_POINT_COUNT = 900_000;

/**
 * A spectrum whose retained source runs far past what was transferred.
 *
 * The arrays are the same six points; everything the backend reports about the
 * whole spectrum is not. That is the shape M5.2 exists to get right: the domain
 * is Rust's answer about the complete spectrum, and the arrays are a bounded
 * prefix that must never be used to contradict it.
 */
export function truncatedSpectrum() {
  const spectrum = spectrumWithPeaks();
  return {
    ...spectrum,
    truncated: true,
    pointCount: TRUNCATED_POINT_COUNT,
    mzLow: TRUNCATED_MZ_LOW,
    mzHigh: TRUNCATED_MZ_HIGH,
    basePeakMz: 812.5,
    basePeakIntensity: 4_200_000,
    viewportDomain: { state: "admitted", low: TRUNCATED_MZ_LOW, high: TRUNCATED_MZ_HIGH },
  };
}

/** The single m/z every point of the inert spectrum below reports. */
export const SPECTRUM_SINGLE_MZ = 301.25;

/**
 * A spectrum whose points all report one m/z: admitted, ready, and inert.
 *
 * The figure contract admits the domain -- it is a real range over real points,
 * and calling it refused would be a lie about the data -- but it has no width.
 * There is no subrange to zoom into, no superrange to zoom out to and nowhere to
 * pan, so every viewport action is unavailable while the spectrum stays `ready`
 * and is drawn normally.
 *
 * The case exists to hold apart two things that look alike from outside: a
 * viewport that is *admitted* and one that is *actionable*.
 */
export function spectrumAtOneMz() {
  const spectrum = spectrumWithPeaks();
  return {
    ...spectrum,
    mz: spectrum.mz.map(() => SPECTRUM_SINGLE_MZ),
    mzLow: SPECTRUM_SINGLE_MZ,
    mzHigh: SPECTRUM_SINGLE_MZ,
    basePeakMz: SPECTRUM_SINGLE_MZ,
    viewportDomain: { state: "admitted", low: SPECTRUM_SINGLE_MZ, high: SPECTRUM_SINGLE_MZ },
  };
}

/** The drawing that answers the one window that spectrum has. */
export function singleMzProjection() {
  const spectrum = spectrumAtOneMz();
  return {
    low: SPECTRUM_SINGLE_MZ,
    high: SPECTRUM_SINGLE_MZ,
    mz: spectrum.mz,
    intensity: spectrum.intensity,
    sourcePoints: spectrum.mz.length,
    reduced: false,
  };
}

/** A spectrum the figure contract cannot establish an m/z domain over. */
export function spectrumWithoutViewport() {
  return {
    ...spectrumWithPeaks(),
    viewportDomain: { state: "refused", reason: "sourceNotOrdered" },
  };
}

/**
 * The drawing the mocked backend answers a full-domain viewport with.
 *
 * The spectrum's own six points, so what the plot shows is what the fixture
 * says the spectrum holds. A test about an empty window, a reduction or a
 * refusal replaces this answer through `setInvokeResult`.
 */
export function fullSpectrumProjection() {
  const spectrum = spectrumWithPeaks();
  return {
    low: SPECTRUM_MZ_LOW,
    high: SPECTRUM_MZ_HIGH,
    mz: spectrum.mz,
    intensity: spectrum.intensity,
    sourcePoints: spectrum.mz.length,
    reduced: false,
  };
}

/**
 * Every command the frontend may invoke during this run, and what it answers.
 *
 * Deliberately total over what the application reaches for on mount. The mock
 * boundary throws on an unmocked command, which is the behaviour worth keeping:
 * a command this table does not know about is a surface the QA run has not
 * accounted for, and silently answering it would hide that.
 */
export function ipcTable(
  options: {
    readonly emptySpectrum?: boolean;
    readonly refusedViewport?: boolean;
    readonly truncatedSource?: boolean;
    readonly oneMzViewport?: boolean;
  } = {},
) {
  const spectrum =
    options.emptySpectrum === true
      ? spectrumWithoutPeaks()
      : options.refusedViewport === true
        ? spectrumWithoutViewport()
        : options.truncatedSource === true
          ? truncatedSpectrum()
          : options.oneMzViewport === true
            ? spectrumAtOneMz()
            : spectrumWithPeaks();
  return {
    inspect_backend: availableBackend,
    get_workspace_roster: {
      datasets: [MZML_ROW, VENDOR_ROW],
      capacity: FAKE_WORKSPACE_CAPACITY,
    },
    subscribe_workspace_drop_updates: null,
    get_workspace_conversion_state: {
      sequence: 0,
      state: { status: "idle" },
      diagnostics: { available: false, itemCount: 0, exporting: false, lastExport: null },
      backendQuarantined: false,
    },
    open_mzml_preview: buildPreview(6),
    load_selected_spectrum: { outcome: "spectrum", spectrum },
    // The m/z viewport's read of the same retained spectrum. Answered here
    // because the boundary rejects an unmocked command, and every selection of
    // a spectrum with an admitted domain asks for the drawing of its full
    // range -- so a run without this answer would fail as an unhandled
    // rejection rather than as the thing it is.
    //
    // One answer for every window, which is what a static table can be. A test
    // about a particular window replaces it through `setInvokeResult`, and what
    // window was *asked for* is read from the call ledger rather than from what
    // came back.
    project_selected_spectrum:
      options.oneMzViewport === true ? singleMzProjection() : fullSpectrumProjection(),
    // The two halves of one export. The reservation is opaque and the outcome
    // is replaced per test through `setInvokeResult`.
    begin_selected_spectrum_export: "reservation-1",
    save_selected_spectrum_export: {
      status: "saved",
      format: "svg",
      fileName: "mscanvas-spectrum-0.svg",
      figure: { width: 1_200, height: 640, dpi: null, theme: "light" },
      // The full source, which is where a spectrum's export context starts. A
      // test about a range replaces this answer through `setInvokeResult`, and
      // the range that was *asked for* is read from the call ledger rather than
      // from what came back -- so this fixture cannot make a range claim true.
      rangeScope: "full",
      rangeLow: null,
      rangeHigh: null,
      sourcePointCount: COMPLETE_POINT_COUNT,
      exportedPointCount: COMPLETE_POINT_COUNT,
    },
    // One command rather than two: a copy chooses no destination, so there is
    // no dialog to gate and nothing to come back from.
    // The chromatogram export, in the same two-phase shape. The reservation is
    // opaque and the outcome is replaced per test through `setInvokeResult`.
    begin_chromatogram_export: "chromatogram-reservation-1",
    save_chromatogram_export: {
      status: "saved",
      format: "csv",
      fileName: "mscanvas-chromatogram-full.csv",
      figure: null,
      traces: null,
      rangeScope: "full",
      rangeLow: 0,
      rangeHigh: FULL_RANGE_HIGH,
      sourceScanCount: COMPLETE_SCAN_COUNT,
      rowCount: COMPLETE_SCAN_COUNT,
    },
    copy_chromatogram_plot: {
      status: "copied",
      figure: { width: 1_200, height: 640, theme: "light" },
      traces: { tic: true, bpc: false },
      rangeScope: "full",
      rangeLow: 0,
      rangeHigh: FULL_RANGE_HIGH,
      sourceScanCount: COMPLETE_SCAN_COUNT,
    },
    copy_selected_spectrum_plot: {
      status: "copied",
      // A size and a theme, as Rust answers. No resolution: the clipboard holds
      // RGBA with nowhere for a `pHYs` chunk, so a fixture that reported one
      // would be modelling a claim the product does not make.
      figure: { width: 1_200, height: 640, theme: "light" },
      rangeScope: "full",
      rangeLow: null,
      rangeHigh: null,
      sourcePointCount: COMPLETE_POINT_COUNT,
      exportedPointCount: COMPLETE_POINT_COUNT,
    },
    // The linked two-panel figure: a third surface over the two above, in the
    // same two-phase shape. The retention time it answers with is the retained
    // row's, which is why the fixture states one at all -- nothing this
    // document holds could have supplied it.
    begin_linked_figure_export: "linked-reservation-1",
    save_linked_figure_export: {
      status: "saved",
      format: "svg",
      fileName: "mscanvas-linked-spectrum-0-full.svg",
      figure: { width: 1_200, height: 640, dpi: null, theme: "light" },
      traces: { tic: true, bpc: false },
      rangeScope: "full",
      rangeLow: 0,
      rangeHigh: FULL_RANGE_HIGH,
      sourceScanCount: COMPLETE_SCAN_COUNT,
      selectedIndex: SELECTED_INDEX,
      selectedRetentionTime: SELECTED_RETENTION_TIME,
    },
    copy_linked_plot: {
      status: "copied",
      figure: { width: 1_200, height: 640, theme: "light" },
      traces: { tic: true, bpc: false },
      rangeScope: "full",
      rangeLow: 0,
      rangeHigh: FULL_RANGE_HIGH,
      sourceScanCount: COMPLETE_SCAN_COUNT,
      selectedIndex: SELECTED_INDEX,
      selectedRetentionTime: SELECTED_RETENTION_TIME,
    },
  } as Record<string, unknown>;
}

/** The figure settings the panel starts at, as they cross the boundary. */
export const DEFAULT_FIGURE_SETTINGS = {
  widthPx: 1_200,
  heightPx: 640,
  pngDpi: 300,
  theme: "light",
} as const;
