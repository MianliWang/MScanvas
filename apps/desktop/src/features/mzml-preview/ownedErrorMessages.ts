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
  // Reachable and previously unmapped, so both showed the boundary's English
  // in a Chinese session. `unexpected_error` is this side's own normalization
  // of anything thrown across the boundary; the plan mismatch is the reply
  // guard's.
  unexpected_error: "errorUnexpected",
  conversion_plan_mismatch: "errorPlanMismatch",
  // The boundary's own owned sentences, by code. Added in M7.5: before this
  // they reached a Chinese session as English, because `ownedErrorMessage`
  // fell through to `error.summary` and the summary is authored in English.
  backend_changed_after_check: "errBackendChangedAfterCheck",
  backend_environment_invalid: "errBackendEnvironmentInvalid",
  backend_launch_denied: "errBackendLaunchDenied",
  backend_launch_failed: "errBackendLaunchFailed",
  backend_not_accounted_for: "errBackendNotAccountedFor",
  backend_not_started: "errBackendNotStarted",
  backend_not_found: "errBackendNotFound",
  backend_not_found_at_launch: "errBackendNotFoundAtLaunch",
  backend_not_inspectable: "errBackendNotInspectable",
  backend_output_capture_failed: "errBackendOutputCaptureFailed",
  backend_termination_failed: "errBackendTerminationFailed",
  backend_wait_failed: "errBackendWaitFailed",
  capability_evidence_unavailable: "errCapabilityEvidenceUnavailable",
  conversion_capability_unavailable: "errConversionCapabilityUnavailable",
  conversion_unsupported: "errConversionUnsupported",
  dataset_not_multi_output: "errDatasetNotMultiOutput",
  dataset_not_previewable: "errDatasetNotPreviewable",
  source_requires_bundle_handoff: "errSourceRequiresBundle",
  source_identity_unavailable: "errSourceIdentityUnavailable",
  source_not_inspectable: "errSourceNotInspectable",
  source_changed_during_read: "errSourceChangedDuringRead",
  source_in_use: "errSourceInUse",
  selection_superseded: "errSelectionSuperseded",
  unknown_file_handle: "errUnknownFileHandle",
  unsupported_extension: "errUnsupportedExtension",
  not_a_regular_file: "errNotARegularFile",
  file_has_no_name: "errFileHasNoName",
  file_not_resolvable: "errFileNotResolvable",
  file_not_inspectable: "errFileNotInspectable",
  file_identity_unavailable: "errFileIdentityUnavailable",
  file_identity_changed: "errFileIdentityChanged",
  file_content_changed: "errFileContentChanged",
  file_picker_unavailable: "errFilePickerUnavailable",
  file_picker_failed: "errFilePickerFailed",
  folder_picker_unavailable: "errFolderPickerUnavailable",
  folder_picker_failed: "errFolderPickerFailed",
  folder_discovery_unavailable: "errFolderDiscoveryUnavailable",
  drop_ingestion_unavailable: "errDropIngestionUnavailable",
  drop_worker_unavailable: "errDropWorkerUnavailable",
  invalid_folder_import_reservation: "errInvalidFolderImport",
  invalid_workspace_drop_subscription: "errInvalidDropSubscription",
  invalid_conversion_reservation: "errInvalidConversionReservation",
  import_superseded: "errImportSuperseded",
  workspace_full: "errWorkspaceFull",
  folder_not_readable: "errFolderNotReadable",
  folder_not_directory: "errFolderNotDirectory",
  folder_link_unsupported: "errFolderLinkUnsupported",
  network_folder_unsupported: "errNetworkFolderUnsupported",
  destination_not_a_folder: "errDestinationNotAFolder",
  destination_unusable: "errDestinationUnusable",
  destination_is_a_link: "errDestinationIsALink",
  destination_is_remote: "errDestinationIsRemote",
  queue_is_empty: "errQueueIsEmpty",
  queue_duplicate_dataset: "errQueueDuplicateDataset",
  preview_worker_unavailable: "errPreviewWorkerUnavailable",
  preview_not_plannable: "errPreviewNotPlannable",
  preview_workspace_unavailable: "errPreviewWorkspaceUnavailable",
  preview_workspace_unusable: "errPreviewWorkspaceUnusable",
  preview_output_not_inspectable: "errPreviewOutputNotInspectable",
  preview_result_missing: "errPreviewResultMissing",
  incomplete_preview_result: "errIncompletePreviewResult",
  unexpected_preview_result: "errUnexpectedPreviewResult",
  non_finite_value: "errNonFiniteValue",
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
  if (key !== undefined) {
    return t(key);
  }
  // A code this build has no sentence for.
  //
  // The boundary's own words are kept whole and are *labelled* as what they
  // are: untranslated original. Two things are wrong with the alternatives.
  // Handing the English over bare tells a Chinese reader nothing about why it
  // is in English, and fallback English presented as coverage is the one
  // outcome a bilingual product must not have. Paraphrasing it would be worse:
  // some of these sentences carry specific detail about a folder, a file or a
  // process, and a wrapper that replaced them would lose the only part the
  // reader can act on.
  //
  // With no words at all there is nothing to label, so the code is named
  // instead -- inspectable, and honest about being unrecognised.
  return error.summary.trim() === ""
    ? t("errorUnknownProblem", { code: error.kind })
    : t("errorReportedAsSent", { summary: error.summary });
}

/** A known recovery context localizes only that owned detail. Names and unknown evidence stay original. */
export function ownedErrorDetail(error: PreviewError, t: UiMessage): string | null {
  if (error.context?.kind === "temporaryExportLeftBehind") return t("m74ErrorTemporaryLeft");
  if (error.context?.kind === "clipboardBusy") return t("m74ErrorClipboardBusy");
  return error.detail;
}
