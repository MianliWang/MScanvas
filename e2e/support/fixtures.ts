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

/** A spectrum that loaded and has none, which is still exportable. */
export function spectrumWithoutPeaks() {
  const spectrum = buildSpectrum(SELECTED_INDEX, 0);
  return { ...spectrum, pointCount: 0, mz: [], intensity: [] };
}

/**
 * Every command the frontend may invoke during this run, and what it answers.
 *
 * Deliberately total over what the application reaches for on mount. The mock
 * boundary throws on an unmocked command, which is the behaviour worth keeping:
 * a command this table does not know about is a surface the QA run has not
 * accounted for, and silently answering it would hide that.
 */
export function ipcTable(options: { readonly emptySpectrum?: boolean } = {}) {
  const spectrum = options.emptySpectrum === true ? spectrumWithoutPeaks() : spectrumWithPeaks();
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
    // The two halves of one export. The reservation is opaque and the outcome
    // is replaced per test through `setInvokeResult`.
    begin_selected_spectrum_export: "reservation-1",
    save_selected_spectrum_export: {
      status: "saved",
      format: "svg",
      fileName: "mscanvas-spectrum-0.svg",
      figure: { width: 1_200, height: 640, dpi: null, theme: "light" },
      pointCount: COMPLETE_POINT_COUNT,
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
      pointCount: COMPLETE_POINT_COUNT,
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
