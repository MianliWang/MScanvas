import { describe, expect, it } from "vitest";

import { bindUiMessages, UI_RESOURCES } from "../preferences/i18n";
import type { UiMessage } from "../preferences/i18n";
import type { UiLocale } from "../preferences/sessionPreferences";
import {
  explainBackendFailure,
  presentBackend,
  type BackendPresentationKind,
} from "./backendPresentation";
import type { BackendAvailability } from "./contracts";
import type { BackendState } from "./usePreviewWorkspace";
import {
  availableBackend,
  chosenBackend,
  chosenFolderWithoutTools,
  previewError,
  quarantinedBackend,
  unavailableBackend,
} from "../../test/previewFixtures";

/** The typed message binding over one bundled locale's own values. */
function messages(locale: UiLocale): UiMessage {
  const bundle = UI_RESOURCES[locale] as Record<string, string>;
  return bindUiMessages(((key: string, values?: Record<string, unknown>) =>
    Object.entries(values ?? {}).reduce<string>(
      (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
      bundle[key],
    )) as never);
}

const en = messages("en");
const zh = messages("zh-CN");

function resolved(availability: BackendAvailability): BackendState {
  return { status: "resolved", availability };
}

function withFailure(kind: string): BackendState {
  return resolved({
    ...unavailableBackend,
    failure: { kind, summary: "unused", correctiveAction: "unused" },
  });
}

describe("the states the banner tells apart", () => {
  it.each<[BackendPresentationKind, BackendState, boolean]>([
    ["checking", { status: "checking" }, false],
    ["requestFailed", { status: "failed", error: previewError({ kind: "preview_worker_unavailable" }) }, false],
    ["staleReading", resolved(availableBackend), true],
    ["missing", resolved(unavailableBackend), false],
    ["unsupported", resolved(chosenFolderWithoutTools), false],
    ["quarantined", resolved(quarantinedBackend), false],
    ["available", resolved(availableBackend), false],
  ])("answers %s", (kind, state, stale) => {
    expect(presentBackend(state, stale, en).kind).toBe(kind);
  });

  it("does not present a failed call as an absence", () => {
    const failed = presentBackend(
      { status: "failed", error: previewError({ kind: "preview_worker_unavailable" }) },
      false,
      en,
    );
    expect(failed.kind).toBe("requestFailed");
    expect(failed.tone).toBe("danger");
    // Which installation was in use is exactly what a failed call does not say.
    expect(failed.names).toBeNull();
    expect(failed.chosen).toBe(false);
    expect(failed.body.join(" ")).not.toContain("not found");
  });

  it("names no build at all while the reading is superseded", () => {
    const stale = presentBackend(resolved(chosenBackend), true, en);
    expect(stale.kind).toBe("staleReading");
    // Not the verdict, not the release, not the build date and not the origin:
    // the reading describes a publication this session has moved past.
    expect(stale.names).toBeNull();
    expect(stale.chosen).toBe(false);
    expect(stale.title).not.toContain("available");
  });

  it("keeps the reason a superseded reading carried, said as history", () => {
    const stale = presentBackend(resolved(unavailableBackend), true, en);
    const said = stale.body.join(" ");
    expect(said).toContain("That earlier reading said");
    expect(said).toContain("ProteoWizard was not found on this computer.");
  });

  it("tells an absent installation from one it cannot use", () => {
    expect(presentBackend(withFailure("backend_not_found"), false, en).kind).toBe("missing");
    expect(presentBackend(withFailure("chosen_folder_missing"), false, en).kind).toBe("missing");
    expect(presentBackend(withFailure("chosen_folder_not_a_directory"), false, en).kind).toBe("missing");
    // Found and judged, so a repair rather than a setup step.
    for (const kind of [
      "msconvert_missing",
      "msaccess_missing",
      "tool_missing",
      "different_installations",
      "version_probe_failed",
      "capability_evidence_unavailable",
      "chosen_folder_unreadable",
      "chosen_folder_missing_both_tools",
      "chosen_folder_incompatible_tools",
    ]) {
      expect(presentBackend(withFailure(kind), false, en).kind).toBe("unsupported");
    }
  });

  it("keeps a quarantined session apart from a verdict about the installation", () => {
    const quarantined = presentBackend(resolved(quarantinedBackend), false, en);
    expect(quarantined.kind).toBe("quarantined");
    // The recovery is a restart of MSCanvas, not a repair of ProteoWizard.
    expect(quarantined.body.join(" ")).toContain("Restart MSCanvas");
    expect(quarantined.body.join(" ")).not.toContain("repair ProteoWizard");
    // And the ways out are still offered, because Rust is what refuses them.
    expect(quarantined.actions.map(entry => entry.id)).toEqual(["recheck", "choose"]);
  });

  it("names the build only when the reading is current and positive", () => {
    const available = presentBackend(resolved(availableBackend), false, en);
    expect(available.names?.release).toBe(availableBackend.release);
    expect(available.names?.buildDate).toBe(availableBackend.buildDate);
    expect(available.chosen).toBe(false);

    const chosen = presentBackend(resolved(chosenBackend), false, en);
    expect(chosen.chosen).toBe(true);
    expect(chosen.names?.release).toBe(chosenBackend.release);
  });
});

describe("recovery action identity", () => {
  it("is the same in every language, though no label is", () => {
    for (const state of [
      { status: "failed", error: previewError({ kind: "x" }) } as BackendState,
      resolved(unavailableBackend),
      resolved(chosenFolderWithoutTools),
      resolved(availableBackend),
      resolved(chosenBackend),
    ]) {
      const english = presentBackend(state, false, en);
      const chinese = presentBackend(state, false, zh);
      expect(chinese.actions.map(entry => entry.id)).toEqual(english.actions.map(entry => entry.id));
      // And the labels really do differ, so the identity is carrying the weight.
      expect(chinese.actions.map(entry => entry.label))
        .not.toEqual(english.actions.map(entry => entry.label));
    }
  });

  it("always offers a way back to searching automatically", () => {
    for (const state of [
      { status: "failed", error: previewError({ kind: "x" }) } as BackendState,
      resolved(unavailableBackend),
      resolved(chosenFolderWithoutTools),
      resolved(chosenBackend),
    ]) {
      const ids = presentBackend(state, false, en).actions.map(entry => entry.id);
      // A chosen folder is the only place MSCanvas then looks, so a state
      // without this offer can strand a session.
      expect(ids.includes("automatic") || !presentBackend(state, false, en).chosen).toBe(true);
      expect(ids).toContain("recheck");
    }
    expect(presentBackend(resolved(chosenBackend), false, en).actions.map(e => e.id))
      .toEqual(["recheck", "automatic"]);
  });

  it("offers a chosen-but-unusable folder both a replacement and a way out", () => {
    const unusable = presentBackend(resolved(chosenFolderWithoutTools), false, en);
    expect(unusable.actions.map(entry => entry.id)).toEqual(["recheck", "automatic", "choose"]);
    // The same action as a first choice, worded for what it is being offered
    // for. The identity does not move with the wording.
    expect(unusable.actions[2]?.label).toBe("Choose a different folder…");
  });

  it("does not offer a folder choice beside a verdict that already names one", () => {
    // Read from the verdict rather than from a remembered choice, so a folder
    // the user picked and a verdict about the previous one cannot appear
    // together.
    expect(presentBackend(resolved(availableBackend), false, en).actions.map(e => e.id))
      .toEqual(["recheck", "choose"]);
  });

  it("offers both ways out wherever it cannot say which binding is current", () => {
    for (const state of [
      { status: "failed", error: previewError({ kind: "x" }) } as BackendState,
    ]) {
      expect(presentBackend(state, false, en).actions.map(e => e.id))
        .toEqual(["recheck", "choose", "automatic"]);
    }
    expect(presentBackend(resolved(chosenBackend), true, en).actions.map(e => e.id))
      .toEqual(["recheck", "choose", "automatic"]);
  });
});

describe("explaining an owned backend code", () => {
  it("has a sentence of its own for every code the boundary can send", () => {
    // Every `kind` the Rust sources answer, enumerated here so a new one fails
    // this test rather than reaching a reader as a bare identifier.
    const codes = [
      "backend_not_found",
      "invalid_configured_location",
      "msconvert_missing",
      "msaccess_missing",
      "tool_missing",
      "different_installations",
      "version_probe_failed",
      "capability_evidence_unavailable",
      "backend_quarantined",
      "chosen_folder_missing",
      "chosen_folder_not_a_directory",
      "chosen_folder_unreadable",
      "chosen_folder_missing_msconvert",
      "chosen_folder_missing_msaccess",
      "chosen_folder_missing_both_tools",
      "chosen_folder_probe_failed",
      "chosen_folder_incompatible_tools",
    ];
    const said = new Set<string>();
    for (const code of codes) {
      for (const message of [en, zh]) {
        const sentence = explainBackendFailure(code, message);
        expect(sentence.trim()).not.toBe("");
        // Not the honest wrapper: that is for codes this build does not know.
        expect(sentence).not.toContain(code);
      }
      said.add(explainBackendFailure(code, en));
    }
    // Distinct sentences, so two different problems are not told as one.
    expect(said.size).toBe(codes.length);
  });

  it("names an unrecognised code instead of dropping or paraphrasing it", () => {
    const wrapped = explainBackendFailure("aCodeFromALaterBuild", en);
    expect(wrapped).toContain("aCodeFromALaterBuild");
    expect(wrapped).toBe(
      UI_RESOURCES.en.backendUnknownProblem.replace("{{code}}", "aCodeFromALaterBuild"),
    );
    // In both languages, wrapped rather than left in English.
    expect(explainBackendFailure("aCodeFromALaterBuild", zh)).toContain("aCodeFromALaterBuild");
    expect(explainBackendFailure("aCodeFromALaterBuild", zh)).not.toBe(wrapped);
  });

  it("shows an unrecognised code through the banner as well", () => {
    const unknown = presentBackend(withFailure("somethingNewFromALaterBuild"), false, en);
    expect(unknown.kind).toBe("unsupported");
    expect(unknown.body.join(" ")).toContain("somethingNewFromALaterBuild");
    expect(unknown.code).toBe("somethingNewFromALaterBuild");
  });
});
