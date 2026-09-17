import { describe, expect, it } from "vitest";
import { bindUiMessages, createUiRuntime } from "../preferences/i18n";
import type { PreviewError } from "./contracts";
import { ownedErrorDetail, ownedErrorMessage } from "./ownedErrorMessages";

describe("owned errors and original evidence", () => {
  it.each(["en", "zh-CN"] as const)("uses authoritative parameters and keeps unknown evidence intact in %s", locale => {
    const t = bindUiMessages(createUiRuntime().instance.getFixedT(locale, "ui"));
    const raw: PreviewError = { kind: "provider_specific", summary: "Provider text Ω <unmodified>", detail: "sample 名称.raw: third-party diagnostic", retryable: true };
    expect(ownedErrorMessage(raw, t)).toBe(raw.summary);
    expect(ownedErrorDetail(raw, t)).toBe(raw.detail);
    expect(ownedErrorMessage({ ...raw, kind: "figure_settings_refused", context: { kind: "pngDpi", min: 72, max: 1200 } }, t)).toBe(t("m74ErrorDpi", { min: 72, max: 1200 }));
    expect(ownedErrorMessage({ ...raw, kind: "spectrum_destination_misnamed", context: { kind: "exportExtension", extension: "tsv" } }, t)).toContain(".tsv");
    for (const kind of ["outputs_not_adoptable", "adoption_superseded", "diagnostics_unavailable", "invalid_diagnostics_reservation", "queue_output_name_collision", "queue_output_name_claimed", "spectrum_not_written", "linked_selection_outside_range"]) {
      expect(ownedErrorMessage({ ...raw, kind }, t)).not.toBe(raw.summary);
    }
    expect(ownedErrorDetail({ ...raw, context: { kind: "temporaryExportLeftBehind" } }, t)).toBe(t("m74ErrorTemporaryLeft"));
    expect(ownedErrorDetail({ ...raw, context: { kind: "clipboardBusy" } }, t)).toBe(t("m74ErrorClipboardBusy"));
  });
});
