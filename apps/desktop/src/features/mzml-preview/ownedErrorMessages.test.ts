import { describe, expect, it } from "vitest";
import { bindUiMessages, createUiRuntime, UI_RESOURCES } from "../preferences/i18n";
import type { PreviewError } from "./contracts";
import { ownedErrorDetail, ownedErrorMessage } from "./ownedErrorMessages";

describe("owned errors and original evidence", () => {
  it.each(["en", "zh-CN"] as const)("uses authoritative parameters and keeps unknown evidence intact in %s", locale => {
    const t = bindUiMessages(createUiRuntime().instance.getFixedT(locale, "ui"));
    const raw: PreviewError = { kind: "provider_specific", summary: "Provider text Ω <unmodified>", detail: "sample 名称.raw: third-party diagnostic", retryable: true };
    // A code this build has no sentence for. The words are kept whole -- byte
    // for byte, provider glyphs included. In Simplified Chinese they are
    // *labelled* as untranslated original, so a reader is told why they are
    // reading English instead of being handed it as though it were coverage;
    // in English the words are already the reader's language, so a provenance
    // label would explain nothing and would only displace the problem.
    const unknown = ownedErrorMessage(raw, t);
    expect(unknown).toContain(raw.summary);
    expect(unknown).toBe(t("errorReportedAsSent", { summary: raw.summary }));
    if (locale === "en") {
      expect(unknown).toBe(raw.summary);
    } else {
      expect(unknown).not.toBe(raw.summary);
      expect(unknown.startsWith(raw.summary)).toBe(false);
    }
    expect(ownedErrorDetail(raw, t)).toBe(raw.detail);
    // With no words at all there is nothing to label, so the code is named.
    expect(ownedErrorMessage({ ...raw, summary: "   " }, t)).toBe(
      t("errorUnknownProblem", { code: "provider_specific" }),
    );
    expect(ownedErrorMessage({ ...raw, kind: "figure_settings_refused", context: { kind: "pngDpi", min: 72, max: 1200 } }, t)).toBe(t("m74ErrorDpi", { min: 72, max: 1200 }));
    expect(ownedErrorMessage({ ...raw, kind: "spectrum_destination_misnamed", context: { kind: "exportExtension", extension: "tsv" } }, t)).toContain(".tsv");
    for (const kind of ["outputs_not_adoptable", "adoption_superseded", "diagnostics_unavailable", "invalid_diagnostics_reservation", "queue_output_name_collision", "queue_output_name_claimed", "spectrum_not_written", "linked_selection_outside_range"]) {
      expect(ownedErrorMessage({ ...raw, kind }, t)).not.toBe(raw.summary);
    }
    expect(ownedErrorDetail({ ...raw, context: { kind: "temporaryExportLeftBehind" } }, t)).toBe(t("m74ErrorTemporaryLeft"));
    expect(ownedErrorDetail({ ...raw, context: { kind: "clipboardBusy" } }, t)).toBe(t("m74ErrorClipboardBusy"));
  });
});

/**
 * Which of the boundary's codes have a sentence of their own, and which are
 * shown through the honest untranslated-original wrapper.
 *
 * The list below is the declared remainder, and it is the point of this test:
 * a code that reaches a reader without a resource shows English in a Chinese
 * session, and that is a thing to count rather than to discover. Every entry is
 * a code whose message interpolates evidence -- a folder, a count, a process
 * detail -- or is produced only by a test seam. Paraphrasing one of those would
 * lose the part a reader can act on, which is why the wrapper keeps the words
 * whole and labels them instead.
 *
 * Adding a resource for one of these means deleting it from here. Adding a new
 * boundary code without either fails this test.
 */
const SHOWN_AS_UNTRANSLATED_ORIGINAL: readonly string[] = [
  // Interpolates the evidence it is about.
  "backend_supervision_failed",
  "conversion_not_plannable",
  "queue_too_large",
  "file_picker_selection_too_large",
  "file_picker_selection_unreadable",
  "folder_scan_failed",
  "folder_scan_unreadable",
  "file_unreadable",
  "spectrum_failed",
  // Test seams. Not reachable from any shipped path.
  "synthetic_drop_failure",
  "test_exhausted",
];

describe("the declared remainder", () => {
  it("names every code without a resource, and nothing that has one", () => {
    const t = bindUiMessages(createUiRuntime().instance.getFixedT("zh-CN", "ui"));
    for (const kind of SHOWN_AS_UNTRANSLATED_ORIGINAL) {
      const summary = `boundary words for ${kind}`;
      // Confirms this really is a code with no resource: with one, the wrapper
      // would not be reached and the list would be out of date.
      expect(ownedErrorMessage({ kind, summary, detail: null, retryable: true }, t)).toBe(
        t("errorReportedAsSent", { summary }),
      );
    }
  });

  it("is a set, in the locale the wrapper is read in", () => {
    expect(new Set(SHOWN_AS_UNTRANSLATED_ORIGINAL).size).toBe(SHOWN_AS_UNTRANSLATED_ORIGINAL.length);
    // The wrapper itself is localized in both bundles, which is what makes it
    // honest rather than a second English fallback.
    expect(UI_RESOURCES["zh-CN"].errorReportedAsSent).not.toBe(UI_RESOURCES.en.errorReportedAsSent);
    expect(UI_RESOURCES["zh-CN"].errorUnknownProblem).not.toBe(UI_RESOURCES.en.errorUnknownProblem);
    expect(UI_RESOURCES.en.errorReportedAsSent).toContain("{{summary}}");
    expect(UI_RESOURCES["zh-CN"].errorReportedAsSent).toContain("{{summary}}");
  });
});
