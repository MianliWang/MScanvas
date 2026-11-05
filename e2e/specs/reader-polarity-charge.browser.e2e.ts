/**
 * A selected spectrum's polarity and precursor charge, rendered (ADR 0056, R-1):
 * the head and Details say what the file states, not reported is a value, the
 * scan table gains no column, and no fact is lost to the two new ones.
 *
 * Deterministic answers at the invoke boundary; the reader's own rules are the
 * Rust tests'. Screenshots go to MSCANVAS_BROWSER_EVIDENCE when it is set.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

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

type Locale = "en" | "zh-CN";
type Facts = { readonly polarity: "positive" | "negative" | null; readonly charge: number | null;
  readonly totalPrecursorCount?: number; readonly representation?: "centroid" | "profile" | "notReported" };

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
    ...buildSpectrum(index, 6), representation: "notReported", ...facts } } };
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

/** Each fact's words, and which of them the head's box hides. */
function headFacts() {
  return browser.execute((css: string) => {
    const head = document.querySelector<HTMLElement>(css)!;
    const box = head.getBoundingClientRect();
    const facts = [...head.querySelectorAll<HTMLElement>(":scope > span")];
    return {
      facts: facts.map(fact => fact.textContent ?? ""),
      dropped: facts.filter(fact => fact.getBoundingClientRect().bottom > box.bottom + 0.5 || fact.getBoundingClientRect().right > box.right + 0.5)
        .map(fact => fact.textContent ?? ""),
      // Inside the head's 36 px, and under none of its buttons.
      overHead: box.bottom > head.closest(".plot-head")!.getBoundingClientRect().bottom + 0.5,
      covered: [...head.closest(".plot-head")!.querySelectorAll<HTMLElement>("button")].filter(button => button.getClientRects().length > 0)
        .map(button => button.getBoundingClientRect())
        .some(button => button.left < box.right - 1 && button.right > box.left + 1 && button.top < box.bottom - 1 && button.bottom > box.top + 1),
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
    };
  }, HEAD_FACTS);
}

async function openDetails() {
  await readBackSavedPreferences();
  const toggle = browser.$('[aria-controls="workbench-inspector"]');
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  await browser.$(".spectrum-facts").waitForDisplayed();
}

function detailsValue(label: string) {
  return browser.execute((name: string) => [...document.querySelectorAll(".spectrum-facts dt")]
    .find(term => term.textContent === name)?.nextElementSibling?.textContent ?? null, label);
}

async function unexpectedConsole() {
  return (await consoleEntries()).filter(entry => !ALLOWED_CONSOLE_SUBSTRINGS.some(allowed => entry.text.includes(allowed)))
    .map(entry => `${entry.level}: ${entry.text}`);
}

async function capture(name: string) {
  if (EVIDENCE === undefined) return;
  mkdirSync(EVIDENCE, { recursive: true });
  await browser.saveScreenshot(join(EVIDENCE, `${name}.png`));
}

describe("a spectrum's polarity and charge", () => {
  for (const locale of ["en", "zh-CN"] as const) {
    const words = locale === "en" ? en : zh;
    for (const size of SIZES) {
      const label = `${locale} ${String(size[0])}x${String(size[1])}`;

      it(`says what the file states, in the head and in Details, ${label}`, async () => {
        await openOn(locale, size, { polarity: "negative", charge: 2, representation: "profile" });

        const head = await headFacts();
        expect(head.facts).toEqual(["MS2", words.viewerRepresentationProfile, words.viewerPolarityNegative,
          words.viewerChargeValue.replace("{{charge}}", "2"), words.viewerExportPoints.replace("{{count, number}}", "6")]);
        expect(head.dropped).toEqual([]);
        expect([head.overHead, head.covered, head.horizontalOverflow]).toEqual([false, false, 0]);
        await capture(`stated-${locale}-${String(size[0])}x${String(size[1])}`);

        await openDetails();
        expect(await detailsValue(words.viewerPolarity)).toBe(words.viewerPolarityNegative);
        expect(await detailsValue(words.viewerCharge)).toBe("2");
        await capture(`stated-details-${locale}-${String(size[0])}x${String(size[1])}`);
        expect(await unexpectedConsole()).toEqual([]);
      });

      it(`says not reported as a value, and never 0, ${label}`, async () => {
        await openOn(locale, size, { polarity: null, charge: null, representation: "profile" });

        const head = await headFacts();
        expect(head.facts).toContain(words.viewerPolarityChargeNotReported);
        expect(head.facts.join(" ")).not.toMatch(/\b0\b/u);
        expect(head.dropped).not.toContain(words.viewerPolarityChargeNotReported);
        expect([head.overHead, head.covered, head.horizontalOverflow]).toEqual([false, false, 0]);
        await capture(`not-reported-${locale}-${String(size[0])}x${String(size[1])}`);

        await openDetails();
        expect(await detailsValue(words.viewerPolarity)).toBe(words.viewerNotReported);
        expect(await detailsValue(words.viewerCharge)).toBe(words.viewerNotReported);
        await capture(`not-reported-details-${locale}-${String(size[0])}x${String(size[1])}`);
        expect(await unexpectedConsole()).toEqual([]);
      });

      it(`keeps the representation when a file states none of the three, ${label}`, async () => {
        await openOn(locale, size, { polarity: null, charge: null, representation: "notReported" });

        // The longest head there is. At 1366 px it is whole. Narrower it drops
        // from the end, and the representation stays (ADR 0029): as built, en at
        // 960 px says polarity and charge only in Details, its drawer.
        const head = await headFacts();
        expect(head.dropped).not.toContain(words.viewerRepresentationNotReported);
        if (size[0] >= 1366) expect(head.dropped).toEqual([]);
        expect([head.overHead, head.covered, head.horizontalOverflow]).toEqual([false, false, 0]);
        await capture(`none-of-three-${locale}-${String(size[0])}x${String(size[1])}`);
        await openDetails();
        expect(await detailsValue(words.viewerCharge)).toBe(words.viewerNotReported);
      });

      it(`says whose charge it is beside more than one precursor, never cutting a word, ${label}`, async () => {
        await openOn(locale, size, { polarity: "positive", charge: 3, totalPrecursorCount: 3, representation: "centroid" });

        const owner = words.viewerChargeOfPrecursor.replace("{{total, number}}", "3");
        const head = await headFacts();
        expect(head.facts).toEqual(expect.arrayContaining([words.viewerChargeValue.replace("{{charge}}", "3"), owner]));
        expect(head.dropped).not.toContain(owner);
        if (size[0] >= 1366) expect(head.dropped).toEqual([]);
        await capture(`three-precursors-${locale}-${String(size[0])}x${String(size[1])}`);

        await openDetails();
        expect(await detailsValue(words.viewerCharge)).toBe(`3 ${owner}`);
      });

      it(`says a stated polarity and a charge not reported, as an MS1 usually does, ${label}`, async () => {
        await openOn(locale, size, { polarity: "positive", charge: null, representation: "profile" });

        const head = await headFacts();
        expect(head.facts).toEqual(expect.arrayContaining([words.viewerPolarityPositive, words.viewerChargeNotReported]));
        // Only the size may give way, and it is in Details (P5).
        expect(head.dropped.filter(fact => fact !== words.viewerExportPoints.replace("{{count, number}}", "6"))).toEqual([]);
        await capture(`ms1-like-${locale}-${String(size[0])}x${String(size[1])}`);
      });
    }
  }

  it("follows the selection, and adds no scan table column", async () => {
    await openOn("en", [1366, 768], { polarity: "positive", charge: 2 });
    expect((await headFacts()).facts).toContain("Charge 2");
    const columns = await browser.execute((css: string) =>
      [...document.querySelectorAll(`${css} [role="columnheader"]`)].map(header => header.textContent ?? ""), SCANS);
    expect(columns.join(" ")).not.toMatch(/polarity|charge/iu);

    // Another scan, stating neither: the head says so, and nothing carries over.
    await setInvokeResult("load_selected_spectrum", spectrumAnswer(answers("en", { polarity: null, charge: null }), 2, { polarity: null, charge: null }));
    await chooseScan(2);
    await browser.waitUntil(async () => (await headFacts()).facts.includes(en.viewerPolarityChargeNotReported), {
      timeoutMsg: "the head never followed the selected scan",
    });
    expect((await headFacts()).facts).not.toContain("Charge 2");
    expect(await unexpectedConsole()).toEqual([]);
  });
});
