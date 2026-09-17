/**
 * What a reader is told when a scan cannot be committed.
 *
 * One key per reason, in one place. The rule that decides the reason is in
 * [`selectionAvailability`] and is read by the operation as well as by the
 * interface -- an operation has no locale, so it carries the reason and
 * nothing else. This is where the reason becomes words, next to the surface
 * that renders them.
 *
 * Each sentence is named after something on screen or something the reader can
 * change. A lane, a ref, a token or a mutex is true and useless: it describes
 * the machinery that refused rather than the situation the reader is in.
 */

import type { MessageKey, UiMessage } from "../../preferences/i18n";
import type { SpectrumSelectionUnavailableReason } from "./selectionAvailability";

const SELECTION_MESSAGE = {
  "no-loaded-run": "viewerSelectionEmpty",
  "backend-unavailable": "viewerSelectionBackend",
  "backend-changing": "viewerSelectionChecking",
  "conversion-running": "viewerSelectionConverting",
} as const satisfies Record<SpectrumSelectionUnavailableReason, MessageKey>;

export function spectrumSelectionMessage(
  reason: SpectrumSelectionUnavailableReason,
  t: UiMessage,
): string {
  return t(SELECTION_MESSAGE[reason]);
}
