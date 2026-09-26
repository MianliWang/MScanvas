/**
 * Whether the Simplified Chinese bundle is a translation or a copy.
 *
 * Key parity is what `validateBundle` already enforces, and key parity is not
 * coverage: a value copied from English passes it. So this compares the two
 * bundles value by value and requires every difference to be either a
 * translation or a deliberate, named identity -- a product name, a unit, a
 * language's own endonym, a machine identifier.
 *
 * The named list is the point. An untranslated value has to be written into it
 * with a reason, which is a thing a reader of the diff can disagree with.
 */

import { describe, expect, it } from "vitest";

import { UI_RESOURCES } from "./i18n";

const en = UI_RESOURCES.en as Record<string, string>;
const zh = UI_RESOURCES["zh-CN"] as Record<string, string>;

/**
 * Values that are the same in both bundles on purpose.
 *
 * Each is something that is not English: a language's own name for itself, a
 * unit, an axis, a file extension, a product or vendor name, or a value whose
 * whole content is an interpolation.
 */
const DELIBERATELY_IDENTICAL: readonly string[] = [
  // A language is named in its own language, in either bundle.
  "english",
  "simplifiedChinese",
  // Units, axes and machine identifiers. None of these is an English word.
  "pixels",
  "rangeMzAxis",
  "pngDpi",
  // Product and format identities.
  "appName",
  "mzml",
  // An MS level as the instrument field names it ("MS2"), and the one tool a
  // preview runs, by its product name.
  "qcReportMsLevel",
  "provenanceProducerMsaccess",
  // Values that are an interpolation and a separator, with no prose at all.
  "summaryIdentity",
  "noticeListPair",
  "noticeListComma",
  "m74CnvListSeparator",
];

/** Keys whose value is one interpolation plus punctuation, in any language. */
function isPurePlaceholder(value: string): boolean {
  return /^[\s·,;:|/–—-]*\{\{[^}]+\}\}[\s·,;:|/–—-]*(\{\{[^}]+\}\}[\s·,;:|/–—-]*)*$/u.test(value);
}

describe("the Simplified Chinese bundle", () => {
  it("has a value for every key the English bundle has, at its own plural arity", () => {
    // Simplified Chinese has one plural category, so a base with `_one` and
    // `_other` in English has only `_other` here. That is `validateBundle`'s
    // rule, and it is why this compares bases rather than raw key names.
    const base = (key: string) => key.replace(/_(zero|one|two|few|many|other)$/u, "");
    expect([...new Set(Object.keys(zh).map(base))].sort()).toEqual(
      [...new Set(Object.keys(en).map(base))].sort(),
    );
    // And every key the Chinese bundle has is one English also has a form of.
    for (const key of Object.keys(zh)) {
      expect(Object.keys(en).map(base), key).toContain(base(key));
    }
  });

  it("translates every value that is prose", () => {
    const untranslated: string[] = [];
    for (const [key, english] of Object.entries(en)) {
      if (DELIBERATELY_IDENTICAL.includes(key)) continue;
      const chinese = zh[key];
      if (chinese === undefined || chinese !== english) continue;
      // An identical value that is only an interpolation carries no prose.
      if (isPurePlaceholder(english)) continue;
      // Nor does one with no letters in it at all.
      if (!/[A-Za-z]/u.test(english)) continue;
      untranslated.push(`${key}: ${english}`);
    }
    // Named individually, so a failure says which value is still English.
    expect(untranslated).toEqual([]);
  });

  it("keeps every value non-empty in both bundles", () => {
    for (const [key, value] of Object.entries(zh)) {
      expect(value.trim(), key).not.toBe("");
      expect(en[key]?.trim(), key).not.toBe("");
    }
  });

  it("carries the same interpolations in both bundles, so no parameter is lost", () => {
    const parameters = (value: string) =>
      [...new Set([...value.matchAll(/\{\{\s*(\w+)(?:,\s*number)?\s*\}\}/gu)].map(m => m[1]))].sort();
    for (const [key, english] of Object.entries(en)) {
      // Only where both bundles have that exact key: a plural form English has
      // and Chinese does not is arity, not a lost parameter.
      if (!(key in zh)) continue;
      expect(parameters(zh[key] ?? ""), key).toEqual(parameters(english));
    }
  });

  it("keeps scientific identities, units and file extensions original", () => {
    // A translated bundle must not rename what a reader will compare against a
    // file, a manifest or an instrument's own vocabulary.
    //
    // Machine identifiers only. Product names are deliberately absent: a
    // Chinese sentence may leave the subject implicit, and requiring
    // "MSCanvas" in every one of them would be requiring bad Chinese rather
    // than accurate Chinese.
    // `SHA-256` is deliberately absent: it is drawn as a bare label beside a
    // digest rather than said inside a sentence, so no resource carries it and
    // there is nothing here for a translation to get wrong.
    const originals = ["m/z", "mzML", "msconvert.exe", "msaccess.exe"];
    for (const original of originals) {
      const inEnglish = Object.entries(en).filter(([, value]) => value.includes(original));
      expect(inEnglish.length, original).toBeGreaterThan(0);
      for (const [key] of inEnglish) {
        // Where the English says it, the Chinese says it too: `.mzML` is not a
        // word to translate, and `m/z` is an axis.
        expect(zh[key], `${key} must keep ${original}`).toContain(original);
      }
    }
  });

  it("states the approved support target identically in both bundles", () => {
    // A support target is a fact about Windows, not a sentence to adapt.
    expect(en.backendHelpTarget).toContain("Windows 11 25H2 x64");
    expect(zh.backendHelpTarget).toContain("Windows 11 25H2 x64");
  });

  it("names the preference file's own prefix identically, so a residue can be found", () => {
    // A reader told to look for a file has to be told the name it really has.
    expect(en.saveTemporaryLeftBehind).toContain(".mscanvas-ui-preferences-");
    expect(zh.saveTemporaryLeftBehind).toContain(".mscanvas-ui-preferences-");
  });
});
