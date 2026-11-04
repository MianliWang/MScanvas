import { describe, expect, it } from "vitest";

import { bindUiMessages, UI_RESOURCES } from "./i18n";
import type { UiMessage } from "./i18n";
import {
  DISPLAY_DEFAULTS,
  PREFERENCE_SCHEMA_VERSION,
  isStoredPreferences,
  isStoredRecordProblem,
} from "./storedPreferences";
import {
  explainStoredProblem,
  explainUnavailableProblem,
  explainWriteProblem,
} from "./storageMessages";

const en = UI_RESOURCES.en;

/** The typed message binding, over the bundled English values. */
const message: UiMessage = bindUiMessages(((key: string, values?: Record<string, unknown>) => {
  const template = en[key as keyof typeof en];
  return Object.entries(values ?? {}).reduce<string>(
    (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
    template,
  );
}) as never);

const valid = {
  schemaVersion: PREFERENCE_SCHEMA_VERSION,
  appearance: { locale: "zh-CN", density: "compact" },
  layout: { roster: "hidden", details: "automatic" },
  display: DISPLAY_DEFAULTS,
};

describe("what this side will consume from the store", () => {
  it("accepts a record of exactly the enumerated domains", () => {
    expect(isStoredPreferences(valid)).toBe(true);
    expect(isStoredPreferences({
      schemaVersion: 2,
      appearance: { locale: "en", density: "comfortable" },
      layout: { roster: "shown", details: "shown" },
      display: { textSize: "large", contrast: "high", motion: "reduce", wheelHabit: "figma", crosshair: true, grid: false, remember: false },
    })).toBe(true);
  });

  it("has the defaults Rust has, so a build without the fields behaves as before", () => {
    expect(DISPLAY_DEFAULTS).toEqual({
      textSize: "standard", contrast: "normal", motion: "system", wheelHabit: "draw", crosshair: false, grid: true, remember: true,
    });
  });

  it("refuses another schema version rather than reading the fields beside it", () => {
    expect(isStoredPreferences({ ...valid, schemaVersion: 1 })).toBe(false);
    expect(isStoredPreferences({ ...valid, schemaVersion: 3 })).toBe(false);
    expect(isStoredPreferences({ ...valid, schemaVersion: "2" })).toBe(false);
    const { schemaVersion: _omitted, ...versionless } = valid;
    expect(isStoredPreferences(versionless)).toBe(false);
  });

  it("refuses a record with no display group, or a display field outside its domain", () => {
    const { display: _omitted, ...withoutTheGroup } = valid;
    expect(isStoredPreferences(withoutTheGroup)).toBe(false);
    expect(isStoredPreferences({ ...valid, display: null })).toBe(false);
    for (const [field, value] of [
      ["textSize", "huge"], ["contrast", "low"], ["motion", "off"], ["wheelHabit", "touch"],
      ["crosshair", "on"], ["grid", 1], ["remember", null],
    ] as const) {
      expect(isStoredPreferences({ ...valid, display: { ...DISPLAY_DEFAULTS, [field]: value } })).toBe(false);
      const { [field]: _missing, ...partial } = DISPLAY_DEFAULTS;
      expect(isStoredPreferences({ ...valid, display: partial })).toBe(false);
    }
  });

  it("refuses a value outside its domain, and a shape that is not a record", () => {
    expect(isStoredPreferences({ ...valid, appearance: { locale: "de", density: "compact" } })).toBe(false);
    expect(isStoredPreferences({ ...valid, appearance: { locale: "en", density: "cosy" } })).toBe(false);
    expect(isStoredPreferences({ ...valid, layout: { roster: "maybe", details: "shown" } })).toBe(false);
    expect(isStoredPreferences({ ...valid, layout: { roster: "shown" } })).toBe(false);
    for (const value of [null, undefined, 1, "record", [], [valid]]) {
      expect(isStoredPreferences(value)).toBe(false);
    }
  });

  it("names the problem codes it has copy for, and nothing else", () => {
    for (const code of ["malformed", "unsupportedVersion", "oversized", "unreadable", "unsafeTarget"]) {
      expect(isStoredRecordProblem(code)).toBe(true);
    }
    expect(isStoredRecordProblem("somethingElse")).toBe(false);
  });
});

describe("explaining an owned storage code", () => {
  it("answers every read problem with its own sentence", () => {
    expect(explainStoredProblem("malformed", message)).toBe(en.storedMalformed);
    expect(explainStoredProblem("unsupportedVersion", message)).toBe(en.storedUnsupportedVersion);
    expect(explainStoredProblem("oversized", message)).toBe(en.storedOversized);
    expect(explainStoredProblem("unreadable", message)).toBe(en.storedUnreadable);
    expect(explainStoredProblem("unsafeTarget", message)).toBe(en.storedUnsafeTarget);
  });

  it("answers every write problem with its own sentence", () => {
    expect(explainWriteProblem("notPublished", message)).toBe(en.writeNotPublished);
    expect(explainWriteProblem("notWritten", message)).toBe(en.writeNotWritten);
    expect(explainWriteProblem("notConfirmed", message)).toBe(en.writeNotConfirmed);
    expect(explainWriteProblem("unsafeTarget", message)).toBe(en.writeUnsafeTarget);
    expect(explainWriteProblem("directoryUnusable", message)).toBe(en.writeDirectoryUnusable);
    expect(explainWriteProblem("oversized", message)).toBe(en.writeOversized);
    expect(explainWriteProblem("invalidRecord", message)).toBe(en.writeInvalidRecord);
    expect(explainWriteProblem("nothingToSave", message)).toBe(en.writeNothingToSave);
    expect(explainWriteProblem("requestFailed", message)).toBe(en.writeRequestFailed);
  });

  it("answers each reason there is no store", () => {
    expect(explainUnavailableProblem("rootUnresolved", message)).toBe(en.storageRootUnresolved);
    expect(explainUnavailableProblem("readFailed", message)).toBe(en.storageReadFailed);
    for (const code of ["qaRootUnbound", "qaRootNotAbsolute", "qaRootNotADirectory"]) {
      expect(explainUnavailableProblem(code, message)).toBe(en.storageQaRoot);
    }
  });

  it("shows an unrecognised code instead of dropping or guessing at it", () => {
    const wrapped = explainStoredProblem("aCodeFromALaterBuild", message);
    expect(wrapped).toBe(en.storageUnknownProblem.replace("{{code}}", "aCodeFromALaterBuild"));
    expect(wrapped).toContain("aCodeFromALaterBuild");
    // Every table, and the absent case, use the same honest wrapper.
    expect(explainWriteProblem("unheardOf", message)).toContain("unheardOf");
    expect(explainUnavailableProblem("unheardOf", message)).toContain("unheardOf");
    expect(explainStoredProblem(null, message)).toBe(en.storageUnknownProblem.replace("{{code}}", "-"));
  });

  it("does not answer one table's code from another's", () => {
    // `unsafeTarget` is the one code both tables own, and each says its own
    // thing about it: one is about a record that cannot be read, the other
    // about a name that was not replaced.
    expect(explainStoredProblem("unsafeTarget", message)).not.toBe(explainWriteProblem("unsafeTarget", message));
    expect(explainWriteProblem("malformed", message)).toContain("malformed");
    expect(explainStoredProblem("notPublished", message)).toContain("notPublished");
  });
});
