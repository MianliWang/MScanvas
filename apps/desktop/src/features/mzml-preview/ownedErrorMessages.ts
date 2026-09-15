import type { UiMessage } from "../preferences/i18n";
import type { PreviewError } from "./contracts";

const MESSAGE = {
  outputs_not_adoptable: "m74ErrorNotAdoptable", adoption_in_progress: "m74ErrorAdopting", adoption_superseded: "m74ErrorAdoptionChanged",
  queue_output_name_collision: "m74ErrorNameCollision",
  queue_output_name_claimed: "m74ErrorNameClaimed",
  diagnostics_picker_unavailable: "m74ErrorPicker", diagnostics_destination_unusable: "m74ErrorLocalFolder",
  diagnostics_destination_misnamed: "m74ErrorJsonName", diagnostics_destination_exists: "m74ErrorExists",
  diagnostics_not_written: "m74ErrorNotWritten", diagnostics_not_finalized: "m74ErrorNotFinalized",
  diagnostics_too_large: "m74ErrorDiagnosticsSize", diagnostics_export_in_progress: "m74ErrorBusy", diagnostics_export_superseded: "m74ErrorDiagnosticsChanged",
  diagnostics_unavailable: "m74ErrorDiagnosticsChanged", invalid_diagnostics_reservation: "m74ErrorDiagnosticsChanged",
  spectrum_export_in_progress: "m74ErrorBusy", scientific_export_in_progress: "m74ErrorBusy",
  spectrum_export_stale: "m74ErrorSpectrumChanged", chromatogram_export_stale: "m74ErrorChromatogramChanged",
  chromatogram_range_outside_source: "m74ErrorRtRange", chromatogram_no_visible_trace: "m74ErrorTrace",
  chromatogram_export_refused: "m74ErrorChromatogramFigure", spectrum_range_unusable: "m74ErrorMzRange",
  spectrum_range_outside_source: "m74ErrorMzRange", spectrum_range_unavailable: "m74ErrorNoMzRange",
  spectrum_export_refused: "m74ErrorSpectrumFigure", spectrum_picker_unavailable: "m74ErrorPicker",
  spectrum_destination_exists: "m74ErrorExists", spectrum_destination_unusable: "m74ErrorLocalFolder",
  spectrum_not_written: "m74ErrorNotWritten", spectrum_not_finalized: "m74ErrorNotFinalized",
  linked_figure_stale: "m74ErrorLinkedChanged", linked_figure_source_mismatch: "m74ErrorLinkedMismatch",
  linked_selection_outside_range: "m74ErrorLinkedRange", linked_figure_not_drawable: "m74ErrorLinkedFigure",
  linked_figure_too_short: "m74ErrorLinkedHeight", figure_font_unavailable: "m74ErrorFont",
  figure_not_rasterizable: "m74ErrorRaster", figure_clipboard_unavailable: "m74ErrorClipboard",
  figure_preview_too_large: "m74ErrorPreviewSize",
} as const;

/** Parameters come from the Rust decision; no translated-string parsing. */
export function ownedErrorMessage(error: PreviewError, t: UiMessage): string {
  const context = error.context;
  if (error.kind === "figure_settings_refused") {
    switch (context?.kind) {
      case "figureSize": return t("m74ErrorFigureSize", { minWidth: context.minWidth, minHeight: context.minHeight, max: context.maxEdge });
      case "pngDpi": return t("m74ErrorDpi", { min: context.min, max: context.max });
      case "rasterBudget": return t("m74ErrorRasterBudget", { max: context.maxPixels });
      case "figureTheme": return t("m74ErrorTheme");
    }
  }
  if (error.kind === "spectrum_destination_misnamed" && context?.kind === "exportExtension") {
    return t("m74ErrorExtension", { extension: context.extension });
  }
  const key = MESSAGE[error.kind as keyof typeof MESSAGE];
  return key === undefined ? error.summary : t(key);
}

/** A known recovery context localizes only that owned detail. Names and unknown evidence stay original. */
export function ownedErrorDetail(error: PreviewError, t: UiMessage): string | null {
  if (error.context?.kind === "temporaryExportLeftBehind") return t("m74ErrorTemporaryLeft");
  if (error.context?.kind === "clipboardBusy") return t("m74ErrorClipboardBusy");
  return error.detail;
}
