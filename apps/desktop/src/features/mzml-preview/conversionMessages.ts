import type { UiMessage } from "../preferences/i18n";
import { ownedErrorMessage } from "./ownedErrorMessages";
import type { ConversionQueue, PreviewError } from "./contracts";
import { conversionJudgedAnyOutput } from "./contracts";
import type { ConversionUnavailableReason } from "./conversionAvailability";
import type { ConversionOperation } from "./useConversionOperation";

/** Known application codes are localized; unknown/provider evidence stays original. */
const ERROR_MESSAGE = {
  staging_recovery_in_progress: "m74CnvNoticeStagingReclaiming",
  queue_destination_changed: "m74CnvErrorQueueDestinationChanged",
  queue_installation_changed: "m74CnvErrorQueueInstallationChanged",
  conversion_intent_not_admitted: "m74CnvErrorConversionIntentNotAdmitted",
  conversion_intent_unavailable: "m74CnvErrorConversionIntentUnavailable",
  conversion_configuration_unread: "m74CnvErrorConversionConfigurationUnread",
  conversion_backend_busy: "m74CnvErrorConversionBackendBusy",
  conversion_binding_replaced: "m74CnvErrorConversionBindingReplaced",
  conversion_without_an_installation: "m74CnvErrorConversionWithoutAnInstallation",
  conversion_busy: "m74CnvErrorConversionBusy",
  conversion_not_stoppable: "m74CnvErrorConversionNotStoppable",
  conversion_item_not_cancellable: "m74CnvErrorConversionItemNotCancellable",
  conversion_item_not_skippable: "m74CnvErrorConversionItemNotSkippable",
  backend_quarantined: "m74CnvErrorBackendQuarantined",
  dataset_not_convertible: "m74CnvErrorDatasetNotConvertible",
  conversion_settings_not_evidenced_for_source: "m74CnvErrorConversionSettingsNotEvidencedForSource",
  destination_not_resolvable: "m74CnvErrorDestinationNotResolvable",
  subfolder_name_unusable: "m74CnvErrorSubfolderNameUnusable",
  subfolder_not_created: "m74CnvErrorSubfolderNotCreated",
  destination_is_the_source: "m74CnvErrorDestinationIsTheSource",
  destination_inside_acquisition: "m74CnvErrorDestinationInsideAcquisition",
  destination_unprovable: "m74CnvErrorDestinationUnprovable",
} as const;

export function conversionErrorMessage(error: PreviewError, t: UiMessage): string {
  const key = ERROR_MESSAGE[error.kind as keyof typeof ERROR_MESSAGE];
  return key === undefined ? ownedErrorMessage(error, t) : t(key);
}

const NOTICE_MESSAGE = {
  "staging-reclaiming": "m74CnvNoticeStagingReclaiming",
  "backend-quarantined": "m74CnvNoticeBackendQuarantined",
  "backend-changing": "m74CnvNoticeBackendChanging",
  "backend-unavailable": "m74CnvNoticeBackendUnavailable",
  "conversion-running": "m74CnvNoticeConversionRunning",
  "preview-running": "m74CnvNoticePreviewRunning",
  "configuration-probing": "m74CnvNoticeConfigurationProbing",
  "adoption-running": "m74CnvNoticeAdoptionRunning",
  "diagnostics-exporting": "m74CnvNoticeDiagnosticsExporting",
  "workspace-settling": "m74CnvNoticeWorkspaceSettling",
  "no-convertible-target": "m74CnvNoticeNoConvertibleTarget",
  "plan-capacity-exceeded": "m74CnvNoticePlanCapacityExceeded",
  "plan-reading": "m74CnvNoticePlanReading",
  "plan-failed": "m74CnvNoticePlanFailed",
  "plan-settings-unknown": "m74CnvNoticePlanSettingsUnknown",
  "plan-selection-unavailable": "m74CnvNoticePlanSelectionUnavailable",
  "plan-selection-not-evidenced": "m74CnvNoticePlanSelectionNotEvidenced",
  "queue-not-retryable": "m74CnvNoticeQueueNotRetryable",
  "nothing-to-retry": "m74CnvNoticeNothingToRetry",
} as const satisfies Record<ConversionUnavailableReason, string>;

export function conversionNoticeMessage(reason: ConversionUnavailableReason, t: UiMessage): string {
  return t(NOTICE_MESSAGE[reason]);
}

/** Counts describe acquisition outcomes; output member counts stay in the manifests. */
export function conversionCountParts(queue: ConversionQueue, exhaustive: boolean, t: UiMessage): string[] {
  const parts = [
    t("m74CnvCountConverted", { count: queue.finalizedCount }),
    t("m74CnvCountSkipped", { count: queue.skippedCount }),
    t("m74CnvCountFailed", { count: queue.failedCount }),
  ];
  if (exhaustive || queue.cancelledCount > 0) parts.push(t("m74CnvCountCancelled", { count: queue.cancelledCount }));
  if (exhaustive) parts.push(t("m74CnvCountNotRun", { count: queue.notRunCount }));
  if (exhaustive || queue.skippedByRequestCount > 0) parts.push(t("m74CnvCountUserSkipped", { count: queue.skippedByRequestCount }));
  if (!exhaustive && queue.notRunCount > 0) parts.push(t("m74CnvCountNotRun", { count: queue.notRunCount }));
  if (queue.cancellationFailedCount > 0) parts.push(t("m74CnvCountUnconfirmed", { count: queue.cancellationFailedCount }));
  return parts;
}

/** Immediate local dispatch facts precede the last Rust projection. */
export function announceConversion(conversion: ConversionOperation, t: UiMessage): string {
  const { state } = conversion;
  if (conversion.converting) return t("m74CnvAnnounceStarting");
  if (state.status === "idle") return "";
  const { queue } = state;
  if (conversion.retrying && state.status === "terminal") return t("m74CnvAnnounceRetry", { count: queue.retryableFailedCount });
  if (state.status === "awaitingDestination") return t(queue.destinationPolicy.kind === "customFolder" ? "m74CnvChooseDestination" : "m74CnvResolvingDestinations");
  if (state.status === "stopping" || (conversion.stopping && state.status === "running")) return t("m74CnvAnnounceStopping");
  if (state.status === "running") {
    const position = queue.items.findIndex(item => item.state === "running");
    const current = queue.items[position];
    if (current === undefined) return t("m74CnvAnnounceRunning", { count: queue.itemCount });
    if (conversion.cancellingItem) return t("m74CnvAnnounceStoppingItem", { name: current.fileName });
    const skipping = queue.items.findIndex((_, index) => conversion.skippingItem(index));
    if (skipping !== -1) return t("m74CnvAnnounceSkipping", { name: queue.items[skipping]?.fileName ?? t("m74CnvThatFile") });
    return t("m74CnvAnnounceItem", { position: position + 1, total: queue.itemCount, name: current.fileName });
  }
  const prefix = state.reason === "stopFailed" ? t("m74CnvAnnounceUnconfirmed") : state.reason === "stopped" ? t("m74CnvAnnounceStopped") : "";
  const counts = conversionCountParts(queue, state.reason !== "completed", t);
  // Retain the unconfirmed count even at zero for this explicit failed-stop audit.
  if (state.reason === "stopFailed" && queue.cancellationFailedCount === 0) counts.push(t("m74CnvCountUnconfirmed", { count: 0 }));
  return [
    prefix,
    `${counts.join(t("m74CnvListSeparator"))}.`,
    state.reason === "stopFailed" && conversion.backendQuarantined ? t("m74CnvRestartBackend").trim() : "",
    queue.items.some(conversionJudgedAnyOutput) ? t("m74CnvAnnounceOutputOnly") : "",
    queue.error === null ? "" : conversionErrorMessage(queue.error, t),
  ].filter(Boolean).join(" ");
}
