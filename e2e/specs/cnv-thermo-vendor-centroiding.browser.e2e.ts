/**
 * Rendered QA of Thermo's own centroiding (ADR 0059): the two verified rows,
 * "MS1 and above" and "MS2 and above", chosen over Thermo-only, mzML-only and
 * mixed selections, in en and zh-CN, at 1366x768 and 960x640.
 *
 * What only a browser can say: that each row's "Lossy" tag is on screen beside
 * its tile at both widths with its loss and family note as the spoken
 * description and no paragraph on screen, that a selection holding a row that
 * is not Thermo RAW is refused with its reason in place of the plan and a
 * refused Convert, that the shipped settings take it back, and that the
 * processing choices are walked with the arrow keys. Every control is found by
 * structure, never by its words. The plan answers come from
 * `support/conversion.ts`, which refuses a vendor row as Rust's describe does.
 */
import { metrics } from "../support/cdp";
import { CONVERT, answerPlans, checkMembers, isRefused, showConversion, waitUntilOffered } from "../support/conversion";
import { ALLOWED_CONSOLE_SUBSTRINGS, consoleEntries, horizontalOverflow, installIpcBoundary } from "../support/harness";
import { NO_PROJECT, scenario, type Locale } from "../support/pm9Scenarios";
import { availableBackend, completeCatalog, settledAt, shippedIntent } from "../../apps/desktop/src/test/previewFixtures";
import type { SelectedFile } from "../../apps/desktop/src/features/mzml-preview/contracts";
import { en } from "../../apps/desktop/src/features/preferences/locales/en";
import { zhCN } from "../../apps/desktop/src/features/preferences/locales/zh-CN";

const WORDS = { en, "zh-CN": zhCN } as const;
const AUTHORITY = settledAt(1, 1);
const thermo = (index: number): SelectedFile => ({
  handle: `raw-${String(index)}`, fileName: `QC_pool_0${String(index)}.raw`, byteLength: 52_428_800, sourceKind: "thermo_raw", relativeContext: null,
});
const FIRST = thermo(1);
const SECOND = thermo(2);
const OPEN: SelectedFile = { handle: "open", fileName: "reference_run.mzML", byteLength: 4_194_304, sourceKind: "mzml", relativeContext: null };
const LCD: SelectedFile = { handle: "lcd", fileName: "Shimadzu_run_01.lcd", byteLength: 8_388_608, sourceKind: "shimadzu_lcd", relativeContext: null };
const ROWS = [FIRST, SECOND, OPEN, LCD];
const VENDOR = ["vendor_centroiding_from_ms1", "vendor_centroiding_from_ms2"] as const;
const LABEL = { vendor_centroiding_from_ms1: "cnvVendorCentroiding", vendor_centroiding_from_ms2: "cnvVendorCentroidingMs2" } as const;
const NOTE = { vendor_centroiding_from_ms1: "cnvVendorCentroidingNote", vendor_centroiding_from_ms2: "cnvVendorCentroidingMs2Note" } as const;
const PROCESSING = '.conversion-setting[data-axis="processing"]';

function world(locale: Locale): Record<string, unknown> {
  const table = scenario("populated", locale);
  table.inspect_backend = { ...availableBackend, authority: AUTHORITY };
  table.get_workspace_roster = { datasets: ROWS, capacity: 1024 };
  table.get_project_state = NO_PROJECT;
  table.read_conversion_configuration = {
    authority: AUTHORITY,
    configuration: { configuration: "ready", catalog: completeCatalog, shipped: shippedIntent.id },
    outcome: { outcome: "answered" },
  };
  table.get_workspace_conversion_state = {
    sequence: 0,
    state: { status: "idle" },
    diagnostics: { eligibleItemCount: 0, available: false, exporting: false, lastExport: null },
    backendQuarantined: false,
    authority: AUTHORITY,
  };
  return table;
}

async function open(locale: Locale, [width, height]: readonly [number, number], members: readonly SelectedFile[], offered = true) {
  await metrics(width, height);
  await installIpcBoundary(world(locale));
  await browser.url("/");
  await browser.$(".workbench-header").waitForDisplayed({ timeout: 60_000 });
  await answerPlans(ROWS);
  await checkMembers(members.map((row) => row.handle));
  await showConversion();
  if (offered) await waitUntilOffered(CONVERT);
}

async function planText(): Promise<string> {
  return browser.execute(() => document.querySelector(".conversion-plan-summary")?.textContent ?? "");
}

async function choose(value: string) {
  await browser.execute((css: string) => document.querySelector<HTMLInputElement>(css)?.click(), `${PROCESSING} input[value="${value}"]`);
}

/** The tile's own note, as its radio names it, and whether the tile's "Lossy" tag is drawn whole inside the window. */
async function noteOf(value: string) {
  return browser.execute((css: string) => {
    const input = document.querySelector<HTMLInputElement>(css);
    const notes = (input?.getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id)).filter((node) => node !== null);
    const note = notes.find((node) => node.classList.contains("conversion-setting-note") && node.closest(".conversion-setting-choice") !== null) ?? null;
    const tag = input?.closest(".conversion-setting-choice")?.querySelector(".conversion-lossy") ?? null;
    if (note === null || tag === null) return null;
    const box = tag.getBoundingClientRect();
    return {
      text: note.textContent ?? "",
      hidden: note.classList.contains("visually-hidden"),
      tagInside: box.width > 0 && box.height > 0 && box.left >= 0 && box.right <= innerWidth + 0.5,
    };
  }, `${PROCESSING} input[value="${value}"]`);
}

/** The note is the radio's description and not on screen; the tag is. */
function expectSpokenNote(note: Awaited<ReturnType<typeof noteOf>>, text: string) {
  expect(note?.text).toBe(text);
  expect(note?.hidden).toBe(true);
  expect(note?.tagInside).toBe(true);
}

async function unexpectedConsole(): Promise<string[]> {
  return (await consoleEntries())
    .filter((entry) => !ALLOWED_CONSOLE_SUBSTRINGS.some((allowed) => entry.text.includes(allowed)))
    .map((entry) => `${entry.level}: ${entry.text}`);
}

for (const locale of ["en", "zh-CN"] as const) {
  const words = WORDS[locale];
  for (const viewport of [[1366, 768], [960, 640]] as const) {
    const at = `${locale} ${String(viewport[0])}x${String(viewport[1])}`;
    describe(`Thermo vendor centroiding, ${at}`, () => {
      it("plans each row over Thermo RAW alone, Lossy on its tile and its note spoken", async () => {
        await open(locale, viewport, [FIRST, SECOND]);
        for (const value of VENDOR) {
          const text = words[NOTE[value]];
          // Before it is chosen as well as after.
          expectSpokenNote(await noteOf(value), text);
          await choose(value);
          await waitUntilOffered(CONVERT);
          await browser.waitUntil(async () => (await browser.$('[data-plan-changed="processing"] dd').isExisting()) &&
            (await browser.$('[data-plan-changed="processing"] dd').getText()) === words[LABEL[value]], { timeout: 15_000, timeoutMsg: `${value} never reached the plan` });
          expectSpokenNote(await noteOf(value), text);
        }
        const overflow = await horizontalOverflow();
        expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);
        expect(await unexpectedConsole()).toEqual([]);
      });

      it("converts nothing over an mzML-only selection, and keeps each row's tag and note", async () => {
        // mzML is not a family the visible queue converts, so the vendor rows
        // meet no plan at all: Convert is refused for the empty scope.
        await open(locale, viewport, [OPEN], false);
        for (const value of VENDOR) {
          await choose(value);
          await browser.waitUntil(async () => isRefused(CONVERT), { timeout: 15_000, timeoutMsg: "Convert was offered over mzML alone" });
          expectSpokenNote(await noteOf(value), words[NOTE[value]]);
        }
        expect(await unexpectedConsole()).toEqual([]);
      });

      it("plans each row over Thermo RAW and mzML, the mzML row excluded", async () => {
        await open(locale, viewport, [FIRST, OPEN]);
        for (const value of VENDOR) {
          await choose(value);
          await waitUntilOffered(CONVERT);
          await browser.waitUntil(async () => (await planText()).includes(words[LABEL[value]]), { timeout: 15_000, timeoutMsg: `${value} never reached the mixed plan` });
          expect(await browser.execute(() => document.querySelectorAll(".conversion-plan-list > li:not(.list-window-spacer)").length)).toBe(1);
        }
        expect(await unexpectedConsole()).toEqual([]);
      });

      it("refuses each row over Thermo RAW and Shimadzu LCD, says why, and recovers", async () => {
        await open(locale, viewport, [FIRST, LCD]);
        for (const value of VENDOR) {
          await choose(value);
          await browser.waitUntil(async () => (await browser.$(".conversion-plan-pending").isExisting()) &&
            (await browser.$(".conversion-plan-pending").getText()).includes(words.m74CnvErrorConversionSettingsNotEvidencedForSource),
          { timeout: 15_000, timeoutMsg: `${value} over Thermo and Shimadzu was never refused in words` });
          expect(await isRefused(CONVERT)).toBe(true);
          // Convert's reason, on screen rather than hidden.
          expect(await browser.$(".conversion-plan-pending").isDisplayed()).toBe(true);
          expect(await browser.execute((css: string) => (document.querySelector(css)?.getAttribute("aria-describedby") ?? "").split(" ").includes("conversion-plan-pending"), CONVERT)).toBe(true);
          await choose("no_additional_centroiding");
          await waitUntilOffered(CONVERT);
        }
        expect(await unexpectedConsole()).toEqual([]);
      });

      it("walks the processing choices with the arrow keys", async () => {
        await open(locale, viewport, [FIRST, SECOND]);
        const values = await browser.execute((css: string) => [...document.querySelectorAll<HTMLInputElement>(`${css} input[type="radio"]`)].map((input) => input.value), PROCESSING);
        expect(values).toEqual(expect.arrayContaining([...VENDOR]));
        expect(values).toHaveLength(4);
        await browser.execute((css: string) => document.querySelector<HTMLElement>(`${css} input:checked`)?.focus(), PROCESSING);
        // A refused value takes the focus and nothing else: the choice stays
        // where it was. A selectable one is chosen.
        const walk = async (key: "ArrowDown" | "ArrowUp", expected: string) => {
          await browser.keys(key);
          await browser.waitUntil(async () => browser.execute((css: string, value: string) => {
            const active = document.activeElement as HTMLInputElement | null;
            const input = document.querySelector<HTMLInputElement>(`${css} input[value="${value}"]`);
            const refused = input?.getAttribute("aria-disabled") === "true";
            return active === input && (refused || input?.checked === true);
          }, PROCESSING, expected), { timeout: 15_000, timeoutMsg: `${key} never reached ${expected}` });
        };
        const start = values.indexOf("no_additional_centroiding");
        for (let step = 1; step < values.length; step += 1) await walk("ArrowDown", values[(start + step) % values.length]!);
        await walk("ArrowUp", values[(start + values.length - 2) % values.length]!);
        expect(await unexpectedConsole()).toEqual([]);
      });
    });
  }
}
