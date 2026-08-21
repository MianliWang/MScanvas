/**
 * What the mocked Tauri backend answers, for the rendered M4.1 QA run.
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

/** The spectrum index the QA run selects. */
export const SELECTED_INDEX = 0;

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
      pointCount: COMPLETE_POINT_COUNT,
    },
  } as Record<string, unknown>;
}
