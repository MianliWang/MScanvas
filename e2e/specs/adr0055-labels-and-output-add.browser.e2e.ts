/**
 * The not-verified label on the viewer and the figure dialog (ADR 0055, owner
 * decision A0055 of 2026-10-31), one Add per converted output (ADR 0052) and
 * no Describe again after a refusal that is final.
 *
 * Production React in Chrome over a controlled IPC table. What Rust decides,
 * the label on a row and whether an output is offered, is what the table says;
 * the Rust side is `preview/tests/conversion_intent_wire.rs`.
 */
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { metrics } from "../support/cdp";
import { CONVERSION_SURFACE, showConversion } from "../support/conversion";
import { answerFigurePreviews, openFigureDialog, waitForFigurePreview } from "../support/figure";
import { MZML_ROW } from "../support/fixtures";
import { ALLOWED_CONSOLE_SUBSTRINGS, consoleEntries, installIpcBoundary, ipcCalls, setInvokeResult } from "../support/harness";
import { NO_PROJECT, scenario, type Locale } from "../support/pm9Scenarios";
import { ENDED, ENDED_ITEMS, found, listed } from "../support/runHistory";
import { readBackSavedPreferences, revealRosterRow, selectTheSpectrum } from "../support/viewer";
import {
  availableBackend,
  completeCatalog,
  finalizedAttemptFacts,
  outputSetReport,
  queueItem,
  queueOf,
  sciexQueueItem,
  settledAt,
  shippedIntent,
} from "../../apps/desktop/src/test/previewFixtures";
import type { NotVerifiedByMscanvas, SelectedFile } from "../../apps/desktop/src/features/mzml-preview/contracts";
import { en } from "../../apps/desktop/src/features/preferences/locales/en";
import { zhCN } from "../../apps/desktop/src/features/preferences/locales/zh-CN";

const OUTPUT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", ".tmp", "adr0055-labels");
const AUTHORITY = settledAt(1, 1);
const OPERATION = "labels-queue";
const RELEASE = "3.0.26204";
const LABEL = { unverifiedSettings: false, unverifiedBuildRelease: RELEASE };
const BUNDLES = { en, "zh-CN": zhCN } as const;
const buildLabel = (locale: Locale) => BUNDLES[locale].m74CnvNotVerifiedBuild.replace("{{release}}", RELEASE);

const RAW: SelectedFile = { handle: "raw-1", fileName: "QC_pool_01.raw", byteLength: 52_428_800, sourceKind: "thermo_raw", relativeContext: null };
const OUTPUT_NAME = "QC_pool_01.mzML";
const LABELLED_FINISHED = {
  status: "terminal",
  reason: "completed",
  operationId: OPERATION,
  queue: queueOf([queueItem(RAW.handle, RAW.fileName, {
    state: "finalized",
    attempts: 1,
    finalizedOutputs: [{ outputId: "output-1", fileName: OUTPUT_NAME }],
    notVerifiedByMscanvas: LABEL,
    ...finalizedAttemptFacts(),
  })]),
};
const ADDED_ROW: SelectedFile = { handle: "added-1", fileName: OUTPUT_NAME, byteLength: 1_048_576, sourceKind: "mzml", relativeContext: null, notVerifiedByMscanvas: LABEL };

const WIFF: SelectedFile = { handle: "wiff-1", fileName: "Plasma_QC_batch_08_sciex_set.wiff", byteLength: 1_048_576, sourceKind: "sciex_wiff", relativeContext: null };
const SET_NAMES = Array.from({ length: 24 }, (_, index) => `Plasma_QC_batch_08_sciex_set-${String(index + 1).padStart(2, "0")}.mzML`);
const setFinished = (overrides: Parameters<typeof outputSetReport>[2] = {}, adoption = {}) => ({
  status: "terminal",
  reason: "completed",
  operationId: OPERATION,
  queue: queueOf([sciexQueueItem(WIFF.handle, WIFF.fileName, {
    state: "finalized",
    attempts: 1,
    finalizedOutputs: SET_NAMES.map((fileName, index) => ({ outputId: `set-${String(index)}`, fileName })),
    result: { kind: "outputSet", report: outputSetReport(WIFF.handle, SET_NAMES, overrides) },
    ...finalizedAttemptFacts(),
    ...adoption,
  })]),
});

function conversionWorld(locale: Locale, rows: readonly SelectedFile[], state: { status: string }): Record<string, unknown> {
  const table = scenario("populated", locale);
  table.inspect_backend = { ...availableBackend, authority: AUTHORITY };
  table.get_workspace_roster = { datasets: rows, capacity: 1024 };
  table.get_project_state = NO_PROJECT;
  table.read_conversion_configuration = {
    authority: AUTHORITY,
    configuration: { configuration: "ready", catalog: completeCatalog, shipped: shippedIntent.id },
    outcome: { outcome: "answered" },
  };
  table.get_workspace_conversion_state = {
    sequence: state.status === "idle" ? 0 : 1,
    state,
    diagnostics: { eligibleItemCount: 0, available: false, exporting: false, lastExport: null },
    backendQuarantined: false,
    authority: AUTHORITY,
  };
  return table;
}

/** The populated world with its mzML row labelled, under the name given. */
function labelledViewerWorld(locale: Locale, fileName: string): Record<string, unknown> {
  const table = scenario("populated", locale);
  const roster = table.get_workspace_roster as { datasets: SelectedFile[]; capacity: number };
  table.get_workspace_roster = {
    ...roster,
    datasets: roster.datasets.map((row) => row.handle === MZML_ROW.handle ? { ...row, fileName, notVerifiedByMscanvas: LABEL } : row),
  };
  return table;
}

/** A RAW row opened through the view cache on an unmeasured build, its object labelled or not. */
function viewedWorld(locale: Locale, rowLabel: NotVerifiedByMscanvas | null): Record<string, unknown> {
  const file: SelectedFile = rowLabel === null ? RAW : { ...RAW, notVerifiedByMscanvas: rowLabel };
  const table = conversionWorld(locale, [file], { status: "idle" });
  table.get_raw_view_state = {
    state: { state: "ready", operation: 1, handle: RAW.handle, intentId: shippedIntent.id, cacheHit: false, unverifiedBuildRelease: RELEASE, openable: true },
    availability: { available: true, unverifiedBuildRelease: RELEASE },
  };
  table.open_raw_view = {
    ...(table.open_mzml_preview as object),
    file,
    qcSnapshotToken: null,
    qcProducerIdentified: false,
    viewSource: {
      kind: "viewCache", sourceFileName: RAW.fileName, sourceKind: "thermo_raw", sourceSha256: "a".repeat(64),
      providerRelease: RELEASE, providerSha256: "b".repeat(64), intent: shippedIntent, verified: false, unverifiedBuildRelease: RELEASE,
      convertedAt: "2026-11-03T04:12:09Z",
    },
  };
  return table;
}

async function open(table: Record<string, unknown>, locale: Locale, width: number, height: number, hold: readonly string[] = []) {
  await metrics(width, height);
  await installIpcBoundary(table, { hold });
  await browser.url("/");
  await browser.$(".workbench-header").waitForDisplayed({ timeout: 30_000 });
  await browser.waitUntil(() => browser.execute((lang: string) => document.documentElement.lang === lang, locale));
  await readBackSavedPreferences();
}

/** Opens the RAW row's view and takes the roster off it where the roster is a drawer. */
async function openTheView(table: Record<string, unknown>, locale: Locale, width: number, height: number) {
  await open(table, locale, width, height);
  await revealRosterRow(RAW.handle);
  await browser.$(`.grouped-roster [data-handle="${RAW.handle}"]`).click();
  await browser.$("[data-raw-view-open]").click();
  await browser.$("[data-view-export-withheld]").waitForExist({ timeout: 10_000 });
  const toggle = browser.$('[aria-controls="workbench-roster"]');
  if (width < 1050 && (await toggle.getAttribute("aria-expanded")) === "true") {
    await toggle.click();
    await browser.waitUntil(async () => (await toggle.getAttribute("aria-expanded")) === "false");
  }
}

/** The label each of the four places says, on the screen, with a shot of the row and of Metadata. */
async function labelsOnTheFileRowAndMetadata(name: string) {
  const fileRow = await browser.execute(() => {
    const said = (css: string) => Array.from(document.querySelectorAll(css), (tag) => tag.textContent);
    const box = (css: string) => document.querySelector(css)?.getBoundingClientRect();
    const tabs = box(".viewer-tabs > .ui-tablist")!;
    const titleTag = box(".viewer-file-title [data-not-verified]");
    const convert = box("[data-raw-view-convert]");
    return {
      title: said(".viewer-file-title [data-not-verified]"),
      facts: said(".viewer-file-facts [data-not-verified]"),
      clipped: Array.from(document.querySelectorAll(".viewer-file [data-not-verified]")).filter((tag) => tag.scrollWidth > tag.clientWidth + 1).length,
      overTabs: (titleTag !== undefined && titleTag.right > tabs.left + 1) || (convert !== undefined && convert.left < tabs.right - 1),
      overflowX: document.documentElement.scrollWidth - innerWidth,
    };
  });
  await shot(`${name}-file-row`);
  await browser.$('.viewer-tabs [role="tab"]:nth-child(3)').click();
  await browser.$(".preview-metadata").waitForExist({ timeout: 30_000 });
  const metadata = await browser.execute(() => {
    const said = (css: string) => Array.from(document.querySelectorAll(css), (tag) => tag.textContent);
    return {
      fileTerm: said(".preview-metadata .inspector-section:not([data-view-source]) [data-not-verified]"),
      source: said(".preview-metadata [data-view-source] [data-not-verified]"),
    };
  });
  await shot(`${name}-metadata`);
  return { ...fileRow, ...metadata };
}

async function shot(name: string) {
  mkdirSync(OUTPUT, { recursive: true });
  await browser.saveScreenshot(join(OUTPUT, `${name}.png`));
}

async function requests(command: string): Promise<unknown[]> {
  return (await ipcCalls()).filter((call) => call.command === command).map((call) => call.args);
}

async function unexpectedConsole(): Promise<string[]> {
  return (await consoleEntries())
    .filter((entry) => !ALLOWED_CONSOLE_SUBSTRINGS.some((allowed) => entry.text.includes(allowed)))
    .map((entry) => `${entry.level}: ${entry.text}`);
}

/** The group that holds one output's actions. */
const group = (locale: Locale, name: string) =>
  `.output-open-actions[aria-label="${BUNDLES[locale].outputOpenGroup.replace("{{name}}", name)}"]`;
const OUTPUT_ADD = "button:nth-of-type(3)";
const EVERY_SIZE = [["en", 1366, 768], ["en", 960, 640], ["zh-CN", 1366, 768], ["zh-CN", 960, 640]] as const;

describe("A0055 and ADR 0052, rendered", () => {
  for (const [locale, width, height] of [["en", 1366, 768], ["zh-CN", 960, 640]] as const) {
    it(`labels the viewer's title, the Metadata row and the figure dialog, ${locale} ${String(width)}x${String(height)}`, async () => {
      const name = "Plasma_QC_batch_08_replicate_04_long_acquisition_converted.mzML";
      await open(labelledViewerWorld(locale, name), locale, width, height);
      await revealRosterRow(MZML_ROW.handle);
      await browser.$(`.grouped-roster [data-handle="${MZML_ROW.handle}"]`).click();
      await selectTheSpectrum(0);

      const title = await browser.execute(() => {
        const heading = document.querySelector<HTMLElement>("h1.viewer-file-name")!;
        const tag = document.querySelector<HTMLElement>(".viewer-file-title [data-not-verified]")!;
        const tabs = document.querySelector<HTMLElement>(".viewer-tabs > .ui-tablist")!;
        const box = tag.getBoundingClientRect();
        return {
          heading: heading.textContent,
          tag: tag.textContent,
          tagWhole: tag.scrollWidth <= tag.clientWidth + 1 && box.right <= tabs.getBoundingClientRect().left + 1,
          tagOneLine: box.height <= 24,
          headingShown: heading.getBoundingClientRect().width >= 40,
          overflowX: document.documentElement.scrollWidth - innerWidth,
        };
      });
      await shot(`viewer-title-${locale}-${String(width)}`);
      expect(title).toEqual({ heading: name, tag: buildLabel(locale), tagWhole: true, tagOneLine: true, headingShown: true, overflowX: 0 });

      await browser.$('.viewer-tabs [role="tab"]:nth-child(3)').click();
      await browser.$(".preview-metadata [data-not-verified]").waitForExist({ timeout: 30_000 });
      expect(await browser.$(".preview-metadata [data-not-verified]").getText()).toBe(buildLabel(locale));
      await shot(`viewer-metadata-${locale}-${String(width)}`);

      await browser.$('.viewer-tabs [role="tab"]:nth-child(1)').click();
      await answerFigurePreviews();
      await openFigureDialog(".spectrum-panel");
      await waitForFigurePreview();
      expect(await browser.$(".figure-export-heading [data-not-verified]").getText()).toBe(buildLabel(locale));
      await shot(`figure-dialog-${locale}-${String(width)}`);
      expect(await unexpectedConsole()).toEqual([]);
    });
  }

  // The least room the title row has: the narrowest windows that still dock both
  // panels, which neither named size reaches.
  for (const [locale, width] of [["en", 1051], ["en", 1100], ["en", 1200], ["zh-CN", 1051], ["zh-CN", 1100]] as const) {
    it(`keeps the label off the tabs and a part of the name with both panels docked, ${locale} ${String(width)}x768`, async () => {
      const name = "Plasma_QC_batch_08_replicate_04_long_acquisition_converted.mzML";
      await open(labelledViewerWorld(locale, name), locale, width, 768);
      await revealRosterRow(MZML_ROW.handle);
      await browser.$(`.grouped-roster [data-handle="${MZML_ROW.handle}"]`).click();
      await selectTheSpectrum(0);
      await browser.$('.workbench-header [aria-controls="workbench-inspector"]').click();
      await browser.$(".workbench-inspector").waitForDisplayed({ timeout: 30_000 });

      const title = await browser.execute((words: string) => {
        const heading = document.querySelector<HTMLElement>("h1.viewer-file-name")!;
        const tag = document.querySelector<HTMLElement>(".viewer-file-title [data-not-verified]")!;
        const tabs = document.querySelector<HTMLElement>(".viewer-tabs > .ui-tablist")!;
        const inset = parseFloat(getComputedStyle(heading).paddingLeft) + parseFloat(getComputedStyle(heading).paddingRight);
        const first = document.createRange();
        first.setStart(tag.firstChild!, 0);
        first.setEnd(tag.firstChild!, words.length);
        const tagEnd = tag.getBoundingClientRect().right - parseFloat(getComputedStyle(tag).paddingRight) - parseFloat(getComputedStyle(tag).borderRightWidth);
        return {
          docked: getComputedStyle(document.querySelector(".workbench-inspector")!).position !== "absolute",
          tagClearOfTabs: tag.getBoundingClientRect().right <= tabs.getBoundingClientRect().left,
          nameRoom: heading.getBoundingClientRect().width - inset >= 44,
          firstWordsRoom: tagEnd - first.getBoundingClientRect().right,
          tagText: tag.textContent,
          tagTitle: tag.title,
          overflowX: document.documentElement.scrollWidth - innerWidth,
        };
      }, BUNDLES[locale].m74CnvNotVerified);
      await shot(`viewer-title-docked-${locale}-${String(width)}`);
      const { firstWordsRoom, ...rest } = title;
      expect(rest).toEqual({ docked: true, tagClearOfTabs: true, nameRoom: true, tagText: buildLabel(locale), tagTitle: buildLabel(locale), overflowX: 0 });
      // The label's first words, its whole claim, stay readable from 1100 up, with
      // room left for the ellipsis. Below that, the two panels beside it say it all.
      if (width >= 1100) expect(firstWordsRoom).toBeGreaterThanOrEqual(10);
      expect(await unexpectedConsole()).toEqual([]);
    });
  }

  for (const [locale, width, height] of EVERY_SIZE) {
    it(`keeps Metadata's term on one line beside a long labelled name, ${locale} ${String(width)}x${String(height)}`, async () => {
      const name = `${"Plasma_QC_batch_08_replicate_04_".repeat(3)}long.mzML`;
      await open(labelledViewerWorld(locale, name), locale, width, height);
      await revealRosterRow(MZML_ROW.handle);
      await browser.$(`.grouped-roster [data-handle="${MZML_ROW.handle}"]`).click();
      await selectTheSpectrum(0);
      if (width > 1050) {
        await browser.$('.workbench-header [aria-controls="workbench-inspector"]').click();
        await browser.$(".workbench-inspector").waitForDisplayed({ timeout: 30_000 });
      }
      await browser.$('.viewer-tabs [role="tab"]:nth-child(3)').click();
      await browser.$(".preview-metadata [data-not-verified]").waitForExist({ timeout: 30_000 });

      const row = await browser.execute(() => {
        const dt = document.querySelector<HTMLElement>(".preview-metadata .metadata-list dt")!;
        const dd = dt.nextElementSibling as HTMLElement;
        const tag = dd.querySelector<HTMLElement>("[data-not-verified]")!;
        const term = document.createRange();
        term.selectNodeContents(dt);
        const lines = new Set(Array.from(term.getClientRects(), (rect) => Math.round(rect.top))).size;
        const list = dt.closest<HTMLElement>(".metadata-list")!;
        return {
          termLines: lines,
          ddInsideList: dd.getBoundingClientRect().right <= list.getBoundingClientRect().right + 1,
          tagInsideDd: tag.getBoundingClientRect().right <= dd.getBoundingClientRect().right + 1,
          overflowX: document.documentElement.scrollWidth - innerWidth,
        };
      });
      await shot(`metadata-long-labelled-${locale}-${String(width)}`);
      expect(row).toEqual({ termLines: 1, ddInsideList: true, tagInsideDd: true, overflowX: 0 });
    });
  }

  // Two claims, which a view can hold at once. The object's label (A0055 (a)) stays
  // beside the file's name and on its File row; the conversion's (ADR 0060 slice 3)
  // stays on the line under the row and in the source section.
  for (const [locale, width, height] of EVERY_SIZE) {
    it(`keeps a row's label and a view's label, each in its place, ${locale} ${String(width)}x${String(height)}`, async () => {
      const label = buildLabel(locale);
      const prefix = `both-labels-${locale}-${String(width)}`;
      await open(labelledViewerWorld(locale, MZML_ROW.fileName), locale, width, height);
      await revealRosterRow(MZML_ROW.handle);
      await browser.$(`.grouped-roster [data-handle="${MZML_ROW.handle}"]`).click();
      await selectTheSpectrum(0);
      expect(await labelsOnTheFileRowAndMetadata(`${prefix}-row`)).toEqual({
        title: [label], facts: [], fileTerm: [label], source: [], clipped: 0, overTabs: false, overflowX: 0,
      });

      await openTheView(viewedWorld(locale, null), locale, width, height);
      expect(await labelsOnTheFileRowAndMetadata(`${prefix}-view`)).toEqual({
        title: [], facts: [label], fileTerm: [], source: [label], clipped: 0, overTabs: false, overflowX: 0,
      });

      await openTheView(viewedWorld(locale, LABEL), locale, width, height);
      expect(await labelsOnTheFileRowAndMetadata(`${prefix}-both`)).toEqual({
        title: [label], facts: [label], fileTerm: [label], source: [label], clipped: 0, overTabs: false, overflowX: 0,
      });
      expect(await unexpectedConsole()).toEqual([]);
    });
  }

  it("adds one labelled output from the keyboard, says so on its line and shows the row", async () => {
    const table = conversionWorld("en", [RAW], LABELLED_FINISHED);
    table.adopt_workspace_conversion_output = {
      operationId: OPERATION,
      retryRound: 0,
      roster: { datasets: [RAW, ADDED_ROW], capacity: 1024 },
      outcomes: [{ kind: "added", itemIndex: 0, memberIndex: 0, sourceHandle: RAW.handle, outputFileName: OUTPUT_NAME, dataset: ADDED_ROW }],
    };
    await open(table, "en", 1366, 768);
    await showConversion();
    const scope = `${CONVERSION_SURFACE} ${group("en", OUTPUT_NAME)}`;
    const add = browser.$(`${scope} ${OUTPUT_ADD}`);
    await add.waitForExist({ timeout: 30_000 });
    expect(await add.getText()).toBe(en.outputAdd);
    expect(await add.getAttribute("aria-label")).toBe(en.outputAddNamed.replace("{{name}}", OUTPUT_NAME));
    // Said once on the row, beside the action that carries it on.
    expect(await browser.$(`${scope} [data-not-verified]`).getText()).toBe(buildLabel("en"));
    expect(await browser.execute(() => document.querySelectorAll(".conversion-run-list [data-not-verified]").length)).toBe(1);

    await browser.execute((css: string) => document.querySelector<HTMLElement>(css)?.focus(), `${scope} ${OUTPUT_ADD}`);
    await browser.keys(["Enter"]);
    await browser.waitUntil(async () => (await browser.$(`${scope} [role="status"]`).getText()) === en.outputAdded, { timeout: 15_000 });
    expect(await requests("adopt_workspace_conversion_output")).toEqual([{ operationId: OPERATION, outputId: "output-1" }]);
    expect(await requests("adopt_workspace_conversion_outputs")).toEqual([]);
    expect(await browser.execute((css: string) => document.activeElement === document.querySelector(css), `${scope} ${OUTPUT_ADD}`)).toBe(true);
    await shot("output-added-en-1366");

    await browser.$(`${scope} button:nth-of-type(4)`).click();
    await browser.$(`.grouped-roster [data-handle="${ADDED_ROW.handle}"] [data-not-verified]`).waitForExist({ timeout: 15_000 });
    expect(await browser.execute(() => document.querySelector("#workbench-evidence")?.hasAttribute("hidden"))).toBe(false);
    expect(await unexpectedConsole()).toEqual([]);
  });

  for (const [locale, width, height] of [["en", 960, 640], ["zh-CN", 1366, 768]] as const) {
    it(`says nothing of a row that has left, and Add answers again, ${locale} ${String(width)}x${String(height)}`, async () => {
      const table = conversionWorld(locale, [RAW], LABELLED_FINISHED);
      const answered = {
        operationId: OPERATION,
        retryRound: 0,
        roster: { datasets: [RAW, ADDED_ROW], capacity: 1024 },
        outcomes: [{ kind: "alreadyInWorkspace", itemIndex: 0, memberIndex: 0, sourceHandle: RAW.handle, outputFileName: OUTPUT_NAME, dataset: ADDED_ROW }],
      };
      table.adopt_workspace_conversion_output = answered;
      table.remove_workspace_datasets = { roster: { datasets: [RAW], capacity: 1024 }, removedHandles: [ADDED_ROW.handle], unknownHandles: [] };
      await open(table, locale, width, height);
      await showConversion();
      const scope = `${CONVERSION_SURFACE} ${group(locale, OUTPUT_NAME)}`;
      const line = browser.$(`${scope} [role="status"]`);
      await browser.$(`${scope} ${OUTPUT_ADD}`).waitForExist({ timeout: 30_000 });
      await browser.$(`${scope} ${OUTPUT_ADD}`).click();
      await browser.waitUntil(async () => (await line.getText()) === BUNDLES[locale].outputAlreadyInWorkspace, { timeout: 15_000 });
      expect(await browser.$(`${scope} button:nth-of-type(4)`).isExisting()).toBe(true);

      await revealRosterRow(ADDED_ROW.handle);
      await browser.$(`.grouped-roster [data-handle="${ADDED_ROW.handle}"] .dataset-row-name`).click();
      await revealRosterRow(ADDED_ROW.handle);
      await browser.$("[data-roster-list-menu]").click();
      await browser.$("[data-roster-remove]").click();
      await browser.$(`.grouped-roster [data-handle="${ADDED_ROW.handle}"]`).waitForExist({ reverse: true, timeout: 15_000 });
      await showConversion();
      await browser.$(`${scope} ${OUTPUT_ADD}`).waitForDisplayed({ timeout: 15_000 });
      expect(await line.getText()).toBe("");
      expect(await browser.$(`${scope} button:nth-of-type(4)`).isExisting()).toBe(false);
      expect(await browser.$(`${scope} ${OUTPUT_ADD}`).getAttribute("aria-disabled")).toBe(null);
      await shot(`output-row-left-${locale}-${String(width)}`);

      // The same press answers again, and the sentence is back with its row.
      await browser.$(`${scope} ${OUTPUT_ADD}`).click();
      await browser.waitUntil(async () => (await line.getText()) === BUNDLES[locale].outputAlreadyInWorkspace, { timeout: 15_000 });
      expect(await browser.$(`${scope} button:nth-of-type(4)`).isExisting()).toBe(true);
      expect(await unexpectedConsole()).toEqual([]);
    });
  }

  for (const [locale, width, height] of EVERY_SIZE) {
    it(`keeps an output's line and Show through the conversion history, ${locale} ${String(width)}x${String(height)}`, async () => {
      const table = conversionWorld(locale, [RAW], LABELLED_FINISHED);
      table.adopt_workspace_conversion_output = {
        operationId: OPERATION,
        retryRound: 0,
        roster: { datasets: [RAW, ADDED_ROW], capacity: 1024 },
        outcomes: [{ kind: "added", itemIndex: 0, memberIndex: 0, sourceHandle: RAW.handle, outputFileName: OUTPUT_NAME, dataset: ADDED_ROW }],
      };
      table.list_conversion_runs = listed([ENDED]);
      table.read_conversion_run = found(ENDED, ENDED_ITEMS);
      await open(table, locale, width, height);
      await showConversion();
      const scope = `${CONVERSION_SURFACE} ${group(locale, OUTPUT_NAME)}`;
      const line = browser.$(`${scope} [role="status"]`);
      await browser.$(`${scope} ${OUTPUT_ADD}`).waitForExist({ timeout: 30_000 });
      await browser.$(`${scope} ${OUTPUT_ADD}`).click();
      await browser.waitUntil(async () => (await line.getText()) === BUNDLES[locale].outputAdded, { timeout: 15_000 });
      await shot(`output-added-before-history-${locale}-${String(width)}`);

      await browser.$("[data-run-history-entry]").click();
      await browser.$("[data-run-history]").waitForDisplayed({ timeout: 15_000 });
      expect(await browser.$(scope).isDisplayed()).toBe(false);
      await shot(`history-over-output-${locale}-${String(width)}`);

      await browser.$("[data-run-history-back]").click();
      await browser.$("[data-run-history]").waitForExist({ reverse: true, timeout: 15_000 });
      await browser.waitUntil(() => browser.execute(() => document.activeElement?.matches("[data-run-history-entry]") === true), { timeoutMsg: "the keyboard never came back to the history entry" });
      expect(await line.getText()).toBe(BUNDLES[locale].outputAdded);
      expect(await browser.$(`${scope} button:nth-of-type(4)`).isDisplayed()).toBe(true);
      await shot(`output-added-after-history-${locale}-${String(width)}`);
      expect(await unexpectedConsole()).toEqual([]);
    });
  }

  for (const [locale, width, height] of [["en", 960, 640], ["zh-CN", 960, 640], ["zh-CN", 1366, 768]] as const) {
    it(`fits one Add per member of a 24-member set, and adds one, ${locale} ${String(width)}x${String(height)}`, async () => {
      const table = conversionWorld(locale, [WIFF], setFinished());
      const dataset = { ...ADDED_ROW, fileName: SET_NAMES[2]!, notVerifiedByMscanvas: null };
      table.adopt_workspace_conversion_output = {
        operationId: OPERATION,
        retryRound: 0,
        roster: { datasets: [WIFF, dataset], capacity: 1024 },
        outcomes: [{ kind: "added", itemIndex: 0, memberIndex: 2, sourceHandle: WIFF.handle, outputFileName: SET_NAMES[2]!, dataset }],
      };
      await open(table, locale, width, height);
      await showConversion();
      await browser.$(`${group(locale, SET_NAMES[0]!)} ${OUTPUT_ADD}`).waitForExist({ timeout: 30_000 });

      const fit = await browser.execute((button: string) => {
        const groups = [...document.querySelectorAll<HTMLElement>(".output-open-actions")];
        const panel = document.querySelector<HTMLElement>(".conversion-run-list")!.getBoundingClientRect();
        return {
          groups: groups.length,
          adds: groups.filter((each) => each.querySelector(button) !== null).length,
          clippedButtons: [...document.querySelectorAll<HTMLElement>(".output-open-actions button")].filter((each) => each.scrollWidth > each.clientWidth + 1).length,
          outside: groups.filter((each) => each.getBoundingClientRect().right > panel.right + 1).length,
          overflowX: document.documentElement.scrollWidth - innerWidth,
        };
      }, OUTPUT_ADD);
      await shot(`set-finished-${locale}-${String(width)}`);
      expect(fit).toEqual({ groups: 24, adds: 24, clippedButtons: 0, outside: 0, overflowX: 0 });

      // What Rust records on the item for the re-read that follows the reply
      // (ADR 0052 decision 5): this one member, in place of what the item held.
      await setInvokeResult("get_workspace_conversion_state", {
        ...(table.get_workspace_conversion_state as object),
        sequence: 2,
        state: setFinished({}, { adoption: { kind: "settled", added: 1, alreadyInWorkspace: 0, refused: 0, refusals: [] } }),
      });
      const third = `${group(locale, SET_NAMES[2]!)} ${OUTPUT_ADD}`;
      await browser.$(third).scrollIntoView({ block: "center" });
      await browser.$(third).click();
      await browser.waitUntil(async () => (await browser.$(`${group(locale, SET_NAMES[2]!)} [role="status"]`).getText()) === BUNDLES[locale].outputAdded, { timeout: 15_000 });
      expect(await requests("adopt_workspace_conversion_output")).toEqual([{ operationId: OPERATION, outputId: "set-2" }]);
      // The other members say nothing, and the queue's summary is empty.
      expect(await browser.execute(() => [...document.querySelectorAll('.output-open-actions [role="status"]')].filter((each) => (each.textContent ?? "") !== "").length)).toBe(1);
      expect(await browser.$(".conversion-adoption-summary").getText()).toBe("");
      await shot(`set-member-added-${locale}-${String(width)}`);
      expect(await unexpectedConsole()).toEqual([]);

      // The item's Details say what the latest Add did: this one member.
      const record = await browser.execute(() => {
        const row = document.querySelector('li[data-item-state="finalized"]')!;
        [...row.querySelectorAll<HTMLElement>("button[aria-expanded='false']")].at(-1)?.click();
        return true;
      });
      expect(record).toBe(true);
      const adoption = browser.$('li[data-item-state="finalized"] [data-testid$="-adoption"]');
      await adoption.waitForExist({ timeout: 15_000 });
      await adoption.scrollIntoView({ block: "center" });
      const parts = BUNDLES[locale].cnvAddedCount.replace("{{n}}", "1");
      expect(await adoption.getText()).toContain(parts);
      await shot(`set-member-record-${locale}-${String(width)}`);
    });
  }

  it("offers no Add for a partial set's prefix or while the queue runs, and keeps Open", async () => {
    const partial = setFinished({ completeSetAdoptable: false, groupOutcome: "partially_finalized" }, { adoption: { kind: "nothingToAdopt" } });
    const running = { status: "running", operationId: OPERATION, queue: queueOf([...LABELLED_FINISHED.queue.items, queueItem("raw-2", "other.raw", { state: "running", attempts: 1 })]) };
    for (const [state, rows] of [[partial, [WIFF]], [running, [RAW]]] as const) {
      await open(conversionWorld("en", rows, state), "en", 1366, 768);
      await showConversion();
      await browser.$(".conversion-run-list").waitForExist({ timeout: 30_000 });
      await browser.pause(200);
      expect(await browser.execute((button: string) => document.querySelectorAll(`.output-open-actions ${button}`).length, OUTPUT_ADD)).toBe(0);
    }
  });

  it("says an output the queue does not offer on its own line, not in the queue's words", async () => {
    const table = conversionWorld("en", [RAW], LABELLED_FINISHED);
    table.adopt_workspace_conversion_output = { __reject: { kind: "outputs_not_adoptable", summary: en.m74ErrorNotAdoptable, detail: null, retryable: false } };
    await open(table, "en", 960, 640);
    await showConversion();
    const scope = group("en", OUTPUT_NAME);
    await browser.$(`${scope} ${OUTPUT_ADD}`).waitForExist({ timeout: 30_000 });
    await browser.$(`${scope} ${OUTPUT_ADD}`).click();
    const sentence = en.m74CnvNotAdded.replace("{{name}}", OUTPUT_NAME).replace("{{reason}}", en.cnvAdoptionReasonNotOffered);
    await browser.waitUntil(async () => (await browser.$(`${scope} [role="status"]`).getText()) === sentence, { timeout: 15_000 });
    expect(await browser.$(".conversion-notice").isExisting()).toBe(false);
    await shot("output-refused-en-960");
  });

  for (const [locale, width, height] of EVERY_SIZE) {
    const size = `${locale} ${String(width)}x${String(height)}`;
    /** Member 20 of 24, far enough down that the head of the list has scrolled away. */
    const pressMemberTwenty = async () => {
      const add = `${group(locale, SET_NAMES[19]!)} ${OUTPUT_ADD}`;
      await browser.$(add).waitForExist({ timeout: 30_000 });
      await browser.$(add).scrollIntoView({ block: "center" });
      await browser.$(add).click();
    };

    it(`says a failed Add on that member's line, in view, down a long set, ${size}`, async () => {
      const table = conversionWorld(locale, [WIFF], setFinished());
      table.adopt_workspace_conversion_output = { __reject: { kind: "adoption_superseded", summary: "moved", detail: null, retryable: true } };
      await open(table, locale, width, height);
      await showConversion();
      await pressMemberTwenty();
      const line = `${group(locale, SET_NAMES[19]!)} [role="status"]`;
      const sentence = BUNDLES[locale].m74ErrorAdoptionChanged;
      await browser.waitUntil(async () => (await browser.$(line).getText()) === sentence, { timeout: 15_000 });
      const seen = await browser.execute((css: string) => {
        const box = document.querySelector(css)!.getBoundingClientRect();
        return {
          inView: box.height > 0 && box.top >= 0 && box.bottom <= document.querySelector(".workbench-status")!.getBoundingClientRect().top,
          queueNotice: document.querySelector(".conversion-notice") !== null,
          overflowX: document.documentElement.scrollWidth - innerWidth,
        };
      }, line);
      await shot(`set-member-failed-${locale}-${String(width)}`);
      expect(seen).toEqual({ inView: true, queueNotice: false, overflowX: 0 });
      expect(await browser.$(`${group(locale, SET_NAMES[19]!)} ${OUTPUT_ADD}`).getAttribute("aria-disabled")).toBeNull();
    });

    // A running view takes the bar's busy reason, and it is not why the other Adds wait.
    for (const viewing of [false, true]) it(`says an Add under way on that member's line and in the status bar${viewing ? ", with a view running" : ""}, ${size}`, async () => {
      const table = conversionWorld(locale, viewing ? [RAW, WIFF] : [WIFF], setFinished());
      if (viewing) {
        table.get_raw_view_state = {
          state: { state: "running", operation: 1, handle: RAW.handle, fileName: RAW.fileName, phase: "converting", elapsedMs: 12_000, bytesRead: null, bytesTotal: null, intentId: shippedIntent.id, unverifiedBuildRelease: null, cachedCopyDamaged: false },
          availability: { available: false, code: "raw_view_busy" },
        };
      }
      await open(table, locale, width, height, ["adopt_workspace_conversion_output"]);
      await showConversion();
      await pressMemberTwenty();
      const pressed = group(locale, SET_NAMES[19]!);
      await browser.waitUntil(async () => (await browser.$(`${pressed} [role="status"]`).getText()) === BUNDLES[locale].outputAdding, { timeout: 15_000 });
      const seen = await browser.execute((button: string, one: string, other: string) => {
        const reason = (css: string) => {
          const add = document.querySelector<HTMLElement>(css)!;
          const said = document.getElementById(add.getAttribute("aria-describedby")!)!;
          const box = said.getBoundingClientRect();
          const text = said.querySelector<HTMLElement>(".status-item-text") ?? said;
          return {
            refused: add.getAttribute("aria-disabled"),
            text: said.textContent,
            inView: box.height > 0 && box.top >= 0 && box.bottom <= innerHeight,
            clipped: text.scrollWidth > text.clientWidth + 1,
          };
        };
        return { pressed: reason(`${one} ${button}`), other: reason(`${other} ${button}`) };
      }, OUTPUT_ADD, pressed, group(locale, SET_NAMES[2]!));
      await shot(`set-member-adding${viewing ? "-viewing" : ""}-${locale}-${String(width)}`);
      const line = BUNDLES[locale].outputAdding;
      const bar = BUNDLES[locale].shellContextActivity.replace("{{activity}}", BUNDLES[locale].m74CnvAdoptOneInFlight);
      expect(seen).toEqual({
        pressed: { refused: "true", text: line, inView: true, clipped: false },
        other: { refused: "true", text: bar, inView: true, clipped: false },
      });
    });

    for (const length of [100, 165]) {
      it(`wraps a refused output's name of ${String(length)} characters inside the results, ${size}`, async () => {
        const name = `${"Q".repeat(length - 5)}.mzML`;
        const finished = {
          ...LABELLED_FINISHED,
          queue: queueOf(LABELLED_FINISHED.queue.items.map((item) => ({ ...item, finalizedOutputs: [{ outputId: "output-1", fileName: name }] }))),
        };
        const table = conversionWorld(locale, [RAW], finished);
        table.adopt_workspace_conversion_output = {
          operationId: OPERATION,
          retryRound: 0,
          roster: { datasets: [RAW], capacity: 1024 },
          outcomes: [{ kind: "refused", itemIndex: 0, memberIndex: 0, sourceHandle: RAW.handle, outputFileName: name, reason: "output_changed" }],
        };
        await open(table, locale, width, height);
        await showConversion();
        const scope = group(locale, name);
        await browser.$(`${scope} ${OUTPUT_ADD}`).waitForExist({ timeout: 30_000 });
        await browser.$(`${scope} ${OUTPUT_ADD}`).click();
        const sentence = BUNDLES[locale].m74CnvNotAdded.replace("{{name}}", name).replace("{{reason}}", BUNDLES[locale].cnvAdoptionReasonChanged);
        await browser.waitUntil(async () => (await browser.$(`${scope} [role="status"]`).getText()).replace(/\s/gu, "") === sentence.replace(/\s/gu, ""), { timeout: 15_000 });
        const seen = await browser.execute((css: string) => {
          const panel = document.querySelector(".conversion-run-list")!.getBoundingClientRect().right;
          const surface = document.querySelector<HTMLElement>(".workbench-conversion")!;
          const tag = document.querySelector<HTMLElement>(`${css} [data-not-verified]`)!;
          return {
            line: document.querySelector(`${css} [role="status"]`)!.getBoundingClientRect().right <= panel + 1,
            tag: tag.getBoundingClientRect().right <= panel + 1,
            tagWhole: tag.scrollWidth <= tag.clientWidth + 1,
            sideways: surface.scrollWidth > surface.clientWidth,
            overflowX: document.documentElement.scrollWidth - innerWidth,
          };
        }, scope);
        await shot(`output-refused-long-${String(length)}-${locale}-${String(width)}`);
        expect(seen).toEqual({ line: true, tag: true, tagWhole: true, sideways: false, overflowX: 0 });
      });
    }

    it(`keeps the figure dialog's head and label in place under a long name, ${size}`, async () => {
      await open(labelledViewerWorld(locale, `${"Q".repeat(160)}.mzML`), locale, width, height);
      await revealRosterRow(MZML_ROW.handle);
      await browser.$(`.grouped-roster [data-handle="${MZML_ROW.handle}"]`).click();
      await selectTheSpectrum(0);
      await answerFigurePreviews();
      await openFigureDialog(".spectrum-panel");
      await waitForFigurePreview();
      const seen = await browser.execute(() => {
        const dialog = document.querySelector<HTMLElement>(".figure-export-dialog")!;
        const { left, right } = dialog.getBoundingClientRect();
        const tag = document.querySelector<HTMLElement>(".figure-export-heading [data-not-verified]")!.getBoundingClientRect();
        const source = document.querySelector<HTMLElement>(".figure-export-source")!;
        const close = document.querySelector(".figure-export-head button")!.getBoundingClientRect();
        return {
          scrolled: dialog.scrollLeft,
          wider: dialog.scrollWidth - dialog.clientWidth,
          tagInside: tag.left >= left && tag.right <= right,
          sourceCut: source.scrollWidth > source.clientWidth,
          closeWhole: close.right <= right && Math.abs(close.width - close.height) <= 1,
        };
      });
      await shot(`figure-dialog-long-${locale}-${String(width)}`);
      expect(seen).toEqual({ scrolled: 0, wider: 0, tagInside: true, sourceCut: true, closeWhole: true });
    });
  }

  it("hands the keyboard to Convert when Describe again leaves for a final refusal", async () => {
    const table = conversionWorld("en", [RAW], { status: "idle" });
    table.describe_workspace_conversion_queue = { __reject: { kind: "plan_unreadable", summary: "The plan was not read.", detail: null, retryable: true } };
    await open(table, "en", 960, 640);
    await showConversion();
    await browser.execute(() => document.querySelector<HTMLInputElement>('input[name="conversion-scope"][value="all"]')?.click());
    const again = ".conversion-start-actions [data-describe-again]";
    await browser.$(again).waitForExist({ timeout: 30_000 });

    await setInvokeResult("describe_workspace_conversion_queue", { __reject: { kind: "dataset_not_convertible", summary: "That row is already mzML, so there is nothing to convert.", detail: null, retryable: false } });
    await browser.execute((css: string) => document.querySelector<HTMLElement>(css)?.focus(), again);
    await browser.keys(["Enter"]);
    await browser.waitUntil(async () => !(await browser.$(again).isExisting()) && (await browser.$(".conversion-plan-pending").getText()).length > 0
      && !(await browser.$(".conversion-plan-pending").getText()).includes("The plan was not read."), { timeout: 15_000 });
    await browser.pause(200);
    expect(await browser.execute(() => {
      const convert = document.querySelector<HTMLElement>(".conversion-start")!;
      return { onConvert: document.activeElement === convert, refused: convert.getAttribute("aria-disabled") };
    })).toEqual({ onConvert: true, refused: "true" });
    await shot("describe-again-final-en-960");
  });

  for (const [retryable, buttons] of [[false, 1], [true, 2]] as const) {
    it(`offers Describe again only after a retryable failure: retryable ${String(retryable)}`, async () => {
      const table = conversionWorld("en", [RAW], { status: "idle" });
      table.describe_workspace_conversion_queue = { __reject: { kind: "plan_unreadable", summary: "The plan was not read.", detail: null, retryable } };
      await open(table, "en", 1366, 768);
      await showConversion();
      await browser.execute(() => document.querySelector<HTMLInputElement>('input[name="conversion-scope"][value="all"]')?.click());
      await browser.$(".conversion-plan-pending").waitForExist({ timeout: 30_000 });
      await browser.waitUntil(async () => (await browser.$(".conversion-plan-pending").getText()).includes("The plan was not read."), { timeout: 15_000 });
      expect(await browser.execute(() => document.querySelectorAll(".conversion-start-actions button").length)).toBe(buttons);
    });
  }
});
