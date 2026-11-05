/**
 * A selected spectrum's polarity and precursor charge, rendered (ADR 0056, R-1):
 * the head and Details say what the file states, not reported is a value, the
 * scan table gains no column, and no fact is lost to the two new ones.
 *
 * Deterministic answers at the invoke boundary; the reader's own rules are the
 * Rust tests'. The scan number and the size are a real file's (`dto.rs`: the
 * measured representative acquisition has 36,319 spectra), because a one-digit
 * scan leaves the head 32 px the real one does not. Screenshots go to
 * MSCANVAS_BROWSER_EVIDENCE when it is set.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import type { SelectedSpectrum } from "../../apps/desktop/src/features/mzml-preview/contracts";
import { en } from "../../apps/desktop/src/features/preferences/locales/en";
import { zhCN as zh } from "../../apps/desktop/src/features/preferences/locales/zh-CN";
import { DISPLAY_DEFAULTS, PREFERENCE_SCHEMA_VERSION } from "../../apps/desktop/src/features/preferences/storedPreferences";
import { buildPreview, buildSpectrum, selectedFile } from "../../apps/desktop/src/test/previewFixtures";
import { metrics } from "../support/cdp";
import { ipcTable } from "../support/fixtures";
import { ALLOWED_CONSOLE_SUBSTRINGS, consoleEntries, installIpcBoundary, setInvokeResult } from "../support/harness";
import { readBackSavedPreferences, revealRosterRow } from "../support/viewer";

const EVIDENCE = process.env["MSCANVAS_BROWSER_EVIDENCE"];
const SCANS = ".spectrum-table-panel";
const HEAD_FACTS = ".spectrum-head-facts";
const SIZES = [[1366, 768], [960, 640]] as const;
const SCAN = 36_319;
const POINTS = 1_234;

type Locale = "en" | "zh-CN";
type Facts = Pick<SelectedSpectrum, "polarity" | "charge">
  & Partial<Pick<SelectedSpectrum, "totalPrecursorCount" | "representation" | "msLevel" | "precursors" | "scanNumber" | "index">>;

function answers(locale: Locale, facts: Facts) {
  const table: Record<string, unknown> = ipcTable();
  const preview = buildPreview(8);
  preview.spectrumTable.rows.forEach((row, index) => Object.assign(row, { msLevel: index % 2 + 1 }));
  table["open_mzml_preview"] = preview;
  table["get_workspace_roster"] = { capacity: 1024, datasets: [selectedFile] };
  table["subscribe_workspace_drop_updates"] = { reservationId: "polarity-charge-reservation" };
  table["load_selected_spectrum"] = spectrumAnswer(table, 1, facts);
  if (locale === "zh-CN") {
    const preferences = { schemaVersion: PREFERENCE_SCHEMA_VERSION, appearance: { locale, density: "comfortable" },
      layout: { roster: "automatic", details: "automatic" }, display: DISPLAY_DEFAULTS };
    table["load_ui_preferences"] = { outcome: "loaded", revision: 1, preferences };
    table["save_ui_preferences"] = { outcome: "saved", revision: 2, preferences };
  }
  return table;
}

function spectrumAnswer(table: Record<string, unknown>, index: number, facts: Facts) {
  const { authority } = table["load_selected_spectrum"] as { authority: unknown };
  return { authority, outcome: { outcome: "spectrum", spectrum: {
    ...buildSpectrum(index, POINTS), scanNumber: SCAN - 1 + index, representation: "notReported", ...facts } } };
}

async function openOn(locale: Locale, [width, height]: readonly [number, number], facts: Facts) {
  await metrics(width, height);
  await installIpcBoundary(answers(locale, facts));
  await browser.url("/");
  await browser.$(".workbench-header").waitForDisplayed();
  await revealRosterRow(selectedFile.handle);
  await browser.$(`.grouped-roster [data-handle="${selectedFile.handle}"]`).click();
  await browser.$(`${SCANS} [data-source-index="1"]`).waitForExist({ timeout: 60_000 });
  if (await browser.$('[aria-controls="workbench-roster"]').getAttribute("aria-expanded") === "true" && width <= 1050) {
    await browser.$(".workbench-home").click();
  }
  await chooseScan(1);
}

async function chooseScan(index: number) {
  await browser.execute((css: string) => document.querySelector(css)?.scrollIntoView({ block: "start" }), SCANS);
  await browser.$(`${SCANS} [data-source-index="${String(index)}"] [role="gridcell"]:nth-child(3)`).click();
  await browser.$(HEAD_FACTS).waitForDisplayed();
}

/** Each fact's words, which of them the head has no room for, and which it cuts. */
function headFacts() {
  return browser.execute((css: string) => {
    const head = document.querySelector<HTMLElement>(css)!;
    const box = head.getBoundingClientRect();
    const facts = [...head.querySelectorAll<HTMLElement>(":scope > span")];
    const text = (fact: HTMLElement) => fact.textContent ?? "";
    // On a line the head shows, and not hidden.
    const shown = (fact: HTMLElement) => getComputedStyle(fact).visibility !== "hidden" && fact.getBoundingClientRect().top < box.bottom - 0.5;
    return {
      facts: facts.map(text),
      dropped: facts.filter(fact => !shown(fact)).map(text),
      // Shown, but running past the head's edge: a cut word.
      cut: facts.filter(fact => shown(fact) && fact.getBoundingClientRect().right > box.right + 0.5).map(text),
      // Inside the head's 36 px, and under none of its buttons.
      overHead: box.bottom > head.closest(".plot-head")!.getBoundingClientRect().bottom + 0.5,
      covered: [...head.closest(".plot-head")!.querySelectorAll<HTMLElement>("button")].filter(button => button.getClientRects().length > 0)
        .map(button => button.getBoundingClientRect())
        .some(button => button.left < box.right - 1 && button.right > box.left + 1 && button.top < box.bottom - 1 && button.bottom > box.top + 1),
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
    };
  }, HEAD_FACTS);
}

/** The head's facts, once no word is cut, they sit inside its 36 px, under no button, with no sideways scroll. */
async function soundHead() {
  const head = await headFacts();
  expect({ cut: head.cut, overHead: head.overHead, covered: head.covered, horizontalOverflow: head.horizontalOverflow })
    .toEqual({ cut: [], overHead: false, covered: false, horizontalOverflow: 0 });
  return head;
}

/** Opens Details, and checks the head again beside it: at 1366 px it is narrowest then. */
async function openDetails() {
  await readBackSavedPreferences();
  const toggle = browser.$('[aria-controls="workbench-inspector"]');
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  await browser.$(".spectrum-facts").waitForDisplayed();
  await soundHead();
}

function detailsValue(label: string) {
  return browser.execute((name: string) => [...document.querySelectorAll(".spectrum-facts dt")]
    .find(term => term.textContent === name)?.nextElementSibling?.textContent ?? null, label);
}

async function capture(name: string) {
  if (EVIDENCE === undefined) return;
  mkdirSync(EVIDENCE, { recursive: true });
  await browser.saveScreenshot(join(EVIDENCE, `${name}.png`));
}

describe("a spectrum's polarity and charge", () => {
  afterEach(async () => {
    const unexpected = (await consoleEntries()).filter(entry => !ALLOWED_CONSOLE_SUBSTRINGS.some(allowed => entry.text.includes(allowed)))
      .map(entry => `${entry.level}: ${entry.text}`);
    expect(unexpected).toEqual([]);
  });

  for (const locale of ["en", "zh-CN"] as const) {
    const words = locale === "en" ? en : zh;
    const charge = (value: string) => words.viewerChargeValue.replace("{{charge}}", value);
    const chargeOf = (value: string, total: string) =>
      words.viewerChargeValueOfPrecursor.replace("{{charge}}", value).replace("{{total, number}}", total);
    const points = words.viewerExportPoints.replace("{{count, number}}", "1,234");

    for (const size of SIZES) {
      const label = `${locale} ${String(size[0])}x${String(size[1])}`;
      const shot = (state: string) => capture(`${state}-${locale}-${String(size[0])}x${String(size[1])}`);
      // As built: en at 960 px has no room for the facts below (126 px).
      const narrowEn = locale === "en" && size[0] <= 1050;

      it(`says what the file states, in the head and in Details, ${label}`, async () => {
        await openOn(locale, size, { polarity: "negative", charge: 2, representation: "profile" });

        const head = await soundHead();
        expect(head.facts).toEqual(["MS2", words.viewerRepresentationProfile, words.viewerPolarityNegative, charge("2"), points]);
        expect(head.dropped.filter(fact => fact !== points)).toEqual([]);
        await shot("stated");

        await openDetails();
        expect(await detailsValue(words.viewerPolarity)).toBe(words.viewerPolarityNegative);
        expect(await detailsValue(words.viewerCharge)).toBe("2");
        await shot("stated-details");
      });

      it(`says not reported as a value, and never 0, ${label}`, async () => {
        await openOn(locale, size, { polarity: null, charge: null, representation: "profile" });

        const head = await soundHead();
        expect(head.facts).toEqual(["MS2", words.viewerRepresentationProfile, words.viewerPolarityChargeNotReported, points]);
        expect(head.facts.join(" ")).not.toMatch(/\b0\b/u);
        // Whole or not at all: wider than the head, it is hidden, never cut.
        expect(head.dropped.includes(words.viewerPolarityChargeNotReported)).toBe(narrowEn);
        await shot("not-reported");

        await openDetails();
        expect(await detailsValue(words.viewerPolarity)).toBe(words.viewerNotReported);
        expect(await detailsValue(words.viewerCharge)).toBe(words.viewerNotReported);
        await shot("not-reported-details");
      });

      it(`keeps the representation when a file states none of the three, never cut, ${label}`, async () => {
        await openOn(locale, size, { polarity: null, charge: null, representation: "notReported" });

        // The longest head there is. At 1366 px only the size gives way. At
        // 960 px en "Representation not reported" is wider than the head, so it
        // is hidden, never cut, and so is what follows it (ADR 0029: Details).
        const head = await soundHead();
        expect(head.dropped.includes(words.viewerRepresentationNotReported)).toBe(narrowEn);
        if (size[0] >= 1366) expect(head.dropped.filter(fact => fact !== points)).toEqual([]);
        await shot("none-of-three");

        await openDetails();
        expect(await detailsValue(words.viewerCharge)).toBe(words.viewerNotReported);
      });

      it(`says whose charge it is beside more than one precursor, in the same fact, ${label}`, async () => {
        await openOn(locale, size, { polarity: "positive", charge: 3, totalPrecursorCount: 3, representation: "centroid" });

        // One fact, so "Charge 3" never stands without whose it is.
        const head = await soundHead();
        expect(head.facts).toEqual(["MS2", words.viewerRepresentationCentroid, words.viewerPolarityPositive, chargeOf("3", "3"), points]);
        // At 960 px en "MS2 Centroid Positive" fills the first line and the charge the second.
        expect(head.dropped.filter(fact => fact !== points)).toEqual([]);
        await shot("three-precursors");

        await openDetails();
        expect(await detailsValue(words.viewerCharge)).toBe(words.viewerChargeOfPrecursor.replace("{{value}}", "3").replace("{{total, number}}", "3"));
      });

      it(`says whose only beside a stated charge in the head, and always in Details, ${label}`, async () => {
        await openOn(locale, size, { polarity: "positive", charge: null, totalPrecursorCount: 3, representation: "centroid" });

        const head = await soundHead();
        expect(head.facts).toEqual(["MS2", words.viewerRepresentationCentroid, words.viewerPolarityPositive, words.viewerChargeNotReported, points]);
        expect(head.dropped).not.toContain(words.viewerPolarityPositive);
        await shot("three-precursors-no-charge");

        await openDetails();
        expect(await detailsValue(words.viewerCharge))
          .toBe(words.viewerChargeOfPrecursor.replace("{{value}}", words.viewerNotReported).replace("{{total, number}}", "3"));
      });

      it(`keeps a stated charge before a polarity not reported, ${label}`, async () => {
        await openOn(locale, size, { polarity: null, charge: 2, representation: "profile" });

        const head = await soundHead();
        expect(head.facts).toEqual(["MS2", words.viewerRepresentationProfile, charge("2"), words.viewerPolarityNotReported, points]);
        expect(head.dropped).not.toContain(charge("2"));
        await shot("charge-only");
      });

      it(`gives way from its end where a spectrum has no scan number, ${label}`, async () => {
        // A native ID without a scan number: the head is named by the index,
        // which leaves en 97 px at 960 px. The index is not a row of this
        // table, so no retention time is linked; the head reads none.
        const noScan = (index: number, facts: Facts): Facts => ({ ...facts, scanNumber: null, index: SCAN - 1 + index });
        await openOn(locale, size, noScan(1, { polarity: "negative", charge: 2, representation: "profile" }));
        expect(await browser.$("#selected-spectrum-scan").getText()).toBe(words.viewerSpectrumIndex.replace("{{index}}", "36,319"));

        // As built: en at 960 px keeps the stated polarity and leaves the charge after it to Details.
        let head = await soundHead();
        expect(head.facts).toEqual(["MS2", words.viewerRepresentationProfile, words.viewerPolarityNegative, charge("2"), points]);
        expect(head.dropped.filter(fact => fact !== points)).toEqual(narrowEn ? [charge("2")] : []);
        await shot("no-scan-number");

        // A charge only: it keeps the charge and leaves "Polarity not reported" to Details.
        const chargeOnly = noScan(2, { polarity: null, charge: 2, representation: "profile" });
        await setInvokeResult("load_selected_spectrum", spectrumAnswer(answers(locale, chargeOnly), 2, chargeOnly));
        await chooseScan(2);
        await browser.waitUntil(async () => (await headFacts()).facts.includes(words.viewerPolarityNotReported), {
          timeoutMsg: "the head never followed the selected spectrum",
        });
        head = await soundHead();
        expect(head.facts).toEqual(["MS2", words.viewerRepresentationProfile, charge("2"), words.viewerPolarityNotReported, points]);
        expect(head.dropped.filter(fact => fact !== points)).toEqual(narrowEn ? [words.viewerPolarityNotReported] : []);

        await openDetails();
        expect(await detailsValue(words.viewerPolarity)).toBe(words.viewerNotReported);
        expect(await detailsValue(words.viewerCharge)).toBe("2");
      });

      for (const representation of ["profile", "centroid"] as const) {
        it(`keeps a stated polarity before a charge not reported, as an MS1 has it, ${representation}, ${label}`, async () => {
          await openOn(locale, size, { polarity: "positive", charge: null, representation, msLevel: 1, precursors: [], totalPrecursorCount: 0 });

          const head = await soundHead();
          expect(head.facts).toEqual(["MS1", words[representation === "profile" ? "viewerRepresentationProfile" : "viewerRepresentationCentroid"],
            words.viewerPolarityPositive, words.viewerChargeNotReported, points]);
          expect(head.dropped).not.toContain(words.viewerPolarityPositive);
          await shot(`polarity-only-${representation}`);
        });
      }
    }
  }

  it("follows the selection, and adds no scan table column", async () => {
    await openOn("en", [1366, 768], { polarity: "positive", charge: 2 });
    expect((await soundHead()).facts).toContain("Charge 2");
    const columns = await browser.execute((css: string) =>
      [...document.querySelectorAll(`${css} [role="columnheader"]`)].map(header => header.textContent ?? ""), SCANS);
    expect(columns.join(" ")).not.toMatch(/polarity|charge/iu);

    // Another scan, stating neither: the head says so, and nothing carries over.
    await setInvokeResult("load_selected_spectrum", spectrumAnswer(answers("en", { polarity: null, charge: null }), 2, { polarity: null, charge: null }));
    await chooseScan(2);
    await browser.waitUntil(async () => (await headFacts()).facts.includes(en.viewerPolarityChargeNotReported), {
      timeoutMsg: "the head never followed the selected scan",
    });
    expect((await soundHead()).facts).not.toContain("Charge 2");
  });
});
