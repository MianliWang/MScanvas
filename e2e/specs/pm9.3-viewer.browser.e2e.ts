/**
 * PM9.3 -- the existing viewer's contracts, rendered, before the slice changes
 * how the viewer is presented.
 *
 * The real production composition in real Chrome over the real Vite dev server,
 * with only `window.__TAURI_INTERNALS__.invoke` replaced, on the M8/M9 harness.
 * What it pins is behaviour the viewer's owners already define: one source
 * index behind every way of choosing a scan, a hidden selection never silently
 * replaced, a pending range that is not export authority, projection that is
 * not a source read, the m/z context rules, the full-source data export a
 * refused viewport keeps, format-specific exports, and what survives a trip
 * around the shell. A later presentation change has to leave all of it true.
 *
 * It is **not** provider, parser or export-content evidence. The preview, the
 * spectra and every export outcome are controlled answers built from the
 * repository's fixture builders; what an export writes, and that Rust refuses
 * a range it does not have, are proved in the Rust suite. Only the request the
 * interface sends is asserted here.
 *
 * Owners are named in `docs/phases/pm9/slice-03.md`; the rules come from
 * ADR 0032 (selection and committed viewport, M7.3 amendment), ADR 0034
 * (chromatogram range scope), ADR 0038 (m/z viewport context), ADR 0040
 * (spectrum range export) and the M7.3 record.
 *
 * Deliberately not reused: `openTheViewer` and the DPR-waiting `metrics()`
 * helpers. The viewport helper is M8.2/M9.1's, with DPR fixed at 1. A row is
 * revealed through the shared `revealRosterRow`, the narrow-window reveal PM9.3
 * repaired (slice-03 §0).
 *
 * Status when written: authored, NOT RUN. PM9.3 extended the observation to
 * the eleven-size sweep and made L13 (one chromatogram header row) and one row
 * per viewer toolbar its regression.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  ALLOWED_CONSOLE_SUBSTRINGS,
  IPC_TABLE_KEY,
  consoleEntries,
  installIpcBoundary,
  ipcCalls,
  type IpcCall,
} from "../support/harness";
import { MZML_ROW, ipcTable } from "../support/fixtures";
import {
  FIGURE_DIALOG,
  answerFigurePreviews,
  choosePlotMenuItem,
  closeFigureDialog,
  figureActions,
  figureDialogButton,
  openFigureDialog,
  openPlotMenu,
} from "../support/figure";
import {
  CHROMATOGRAM,
  PLOT,
  SPECTRUM_PLOT,
  SPECTRUM_RANGE,
  SPECTRUM_STATUS,
  readBackSavedPreferences,
  revealRosterRow,
  selectTheSpectrum,
  viewerReads,
} from "../support/viewer";
import {
  FAKE_WORKSPACE_CAPACITY,
  buildPreview,
  buildSpectrum,
  secondFile,
} from "../../apps/desktop/src/test/previewFixtures";
import { fixed, untrue } from "../../apps/desktop/src/test/rangeClaims";
import { en } from "../../apps/desktop/src/features/preferences/locales/en";
import { zhCN as zh } from "../../apps/desktop/src/features/preferences/locales/zh-CN";

let output = "";
const evidence: unknown[] = [];

async function unexpectedConsole(): Promise<string[]> {
  return (await consoleEntries())
    .filter((entry) => !ALLOWED_CONSOLE_SUBSTRINGS.some((allowed) => entry.text.includes(allowed)))
    .map((entry) => `${entry.level}: ${entry.text}`);
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)(?:, \w+)?\}\}/gu, (_, key: string) => values[key] ?? "");
}

function prefix(template: string): string {
  return template.split("{{")[0]!;
}

// ---------------------------------------------------------------- answers

const SCANS = ".spectrum-table-panel";
const RT_PANEL = ".chromatogram-panel";
const MZ_PANEL = ".spectrum-panel";

const NO_PROJECT = {
  open: false,
  projectId: null,
  name: "",
  dirty: false,
  published: false,
  inputs: [],
  artifacts: [],
  runs: [],
  layers: [],
};

/**
 * M7.3's eight-scan run: retention time equal to the index, MS level
 * alternating, total ion current rising with the index, and two identifiers a
 * search can single out. Synthetic; no file was read.
 */
function eightScans() {
  const preview = buildPreview(8);
  preview.spectrumTable.rows.forEach((row, index) =>
    Object.assign(row, {
      identifier: `${index === 3 || index === 7 ? "rare" : "raw"}-${String(index)}-controllerType=0 controllerNumber=1 scan=${String(index + 1)}`,
      retentionTime: { value: index, unitKnown: false },
      msLevel: (index % 2) + 1,
      totalIonCurrent: (index + 1) * 10,
    }),
  );
  Object.assign(preview.runSummary, {
    retentionTimeRange: { minimum: { value: 0, unitKnown: false }, maximum: { value: 7, unitKnown: false } },
    msLevels: [
      { msLevel: 1, spectrumCount: 4 },
      { msLevel: 2, spectrumCount: 4 },
    ],
  });
  return preview;
}

/** M7.3's twelve-point spectrum, admitted over m/z 100 to 650. */
const SPECTRUM = {
  ...buildSpectrum(0, 12),
  mz: Array.from({ length: 12 }, (_, i) => 100 + i * 50),
  intensity: [10, 35, -5, 65, 100, 42, 18, 75, 30, 19, 55, 8],
  mzLow: 100,
  mzHigh: 650,
  viewportDomain: { state: "admitted", low: 100, high: 650 },
};

/**
 * The same eight scans at a real run's size (baseline §12's coverage gap):
 * retention times in seconds from 1234.5678 to 3456.7892, base peaks above
 * m/z 1000 and intensities in the tens and hundreds of millions. Synthetic; no
 * file was read.
 */
function longScans() {
  const preview = eightScans();
  preview.spectrumTable.rows.forEach((row, index) =>
    Object.assign(row, {
      retentionTime: { value: 1234.5678 + index * 317.4602, unitKnown: false },
      basePeakMz: 1234.5678 + index * 107.5838,
      basePeakIntensity: 12_345_678 + index * 1_111_111,
      totalIonCurrent: (index + 1) * 123_456_789,
      precursorMz: row.msLevel === 1 ? null : 1456.7891 + index,
    }),
  );
  Object.assign(preview.runSummary, {
    retentionTimeRange: {
      minimum: { value: 1234.5678, unitKnown: false },
      maximum: { value: 1234.5678 + 7 * 317.4602, unitKnown: false },
    },
  });
  return preview;
}

/** Twelve points from m/z 1234.5678 to 1987.6543, at intensities of a real spectrum's size. */
const LONG_MZ = Array.from({ length: 12 }, (_, i) => 1234.5678 + (i * (1987.6543 - 1234.5678)) / 11);
const LONG_SPECTRUM: typeof SPECTRUM = {
  ...SPECTRUM,
  mz: LONG_MZ,
  intensity: [12_345_678, 45_678_901, 3_456_789, 65_432_109, 98_765_432, 41_234_567, 17_654_321, 74_321_098, 29_876_543, 18_765_432, 54_321_987, 7_654_321],
  mzLow: LONG_MZ[0]!,
  mzHigh: LONG_MZ[11]!,
  basePeakMz: LONG_MZ[4]!,
  basePeakIntensity: 98_765_432,
  // The sum of the points above.
  totalIonCurrent: 469_507_178,
  precursors: [{ index: 0, mz: 1456.7891, intensity: 84_000_000 }],
  viewportDomain: { state: "admitted", low: LONG_MZ[0]!, high: LONG_MZ[11]! },
};

function answers(options: { readonly refusedViewport?: boolean; readonly locale?: "en" | "zh-CN"; readonly long?: boolean } = {}) {
  const table: Record<string, unknown> = ipcTable({ refusedViewport: options.refusedViewport === true });
  table.open_mzml_preview = options.long === true ? longScans() : eightScans();
  // Two mzML rows, so a second acquisition can replace the first.
  table.get_workspace_roster = { datasets: [MZML_ROW, secondFile], capacity: FAKE_WORKSPACE_CAPACITY };
  table.get_project_state = NO_PROJECT;
  // A working native drop subscription, as M7.2 answers it, so no drop
  // notice takes height from the viewer.
  table.subscribe_workspace_drop_updates = { reservationId: "pm93-browser-reservation" };
  if (options.locale === "zh-CN") {
    const preferences = {
      schemaVersion: 1,
      appearance: { locale: "zh-CN", density: "comfortable" },
      layout: { roster: "automatic", details: "automatic" },
    };
    table.load_ui_preferences = { outcome: "loaded", revision: 1, preferences };
    table.save_ui_preferences = { outcome: "saved", revision: 2, preferences };
  }
  return table;
}

/**
 * Answers each read for what it names, as M7.3's `sourceBoundary` does: the
 * preview for the row asked for, the spectrum at the index asked for (with a
 * token of its own, as Rust mints one per read), and the exact retained window
 * a projection asks for. Test boundary only; nothing in the application is
 * patched. Installed after navigation, before any row is read.
 *
 * A refused viewport keeps the shared table's single spectrum instead, so the
 * refusal it carries is the one the application meets.
 */
async function answerBySource(fixture: typeof SPECTRUM = SPECTRUM) {
  await browser.execute(
    (tableKey: string, fixture: { mz: number[]; intensity: number[] }) => {
      const table = Reflect.get(window, tableKey) as Record<string, unknown>;
      const internals = Reflect.get(window, "__TAURI_INTERNALS__") as {
        invoke: (command: string, args: Record<string, unknown>) => Promise<unknown>;
      };
      const invoke = internals.invoke;
      const preview = table["open_mzml_preview"] as {
        file: unknown;
        spectrumTable: { rows: { index: number; retentionTime: unknown }[] };
      };
      const roster = (table["get_workspace_roster"] as { datasets: { handle: string }[] }).datasets;
      const load = table["load_selected_spectrum"] as { authority: unknown };
      internals.invoke = (command, args) => {
        if (command === "open_mzml_preview") {
          table[command] = { ...preview, file: roster.find((row) => row.handle === args["handle"]) ?? preview.file };
        } else if (command === "load_selected_spectrum") {
          const index = Number(args["index"]);
          const row = preview.spectrumTable.rows.find((candidate) => candidate.index === index);
          table[command] = {
            authority: load.authority,
            outcome: {
              outcome: "spectrum",
              spectrum: {
                ...fixture,
                index,
                exportToken: `pm93-${String(args["handle"])}-${String(index)}`,
                retentionTime: row?.retentionTime,
              },
            },
          };
        } else if (command === "project_selected_spectrum") {
          const low = Number(args["low"]);
          const high = Number(args["high"]);
          const kept = fixture.mz.flatMap((value, i) => (value >= low && value <= high ? [i] : []));
          table[command] = {
            low,
            high,
            mz: kept.map((i) => fixture.mz[i]),
            intensity: kept.map((i) => fixture.intensity[i]),
            sourcePoints: kept.length,
            reduced: false,
          };
        }
        return invoke(command, args);
      };
    },
    IPC_TABLE_KEY,
    fixture,
  );
}

// ---------------------------------------------------------------- driving

async function cdp(cmd: string, params: Record<string, unknown>) {
  const { hostname = "127.0.0.1", port, path = "/", protocol = "http" } = browser.options;
  if (port === undefined) throw Error("Owned ChromeDriver port missing");
  const root = `${protocol}://${hostname}:${port}${path.endsWith("/") ? path : path + "/"}`;
  const response = await fetch(new URL(`session/${browser.sessionId}/goog/cdp/execute`, root), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd, params }),
  });
  const data = (await response.json()) as { value?: Record<string, unknown> };
  if (!response.ok || data.value?.error) throw Error(JSON.stringify(data));
  return data.value ?? {};
}

async function metrics(width: number, height: number) {
  await cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await browser.waitUntil(() =>
    browser.execute((w, h) => innerWidth === w && innerHeight === h, width, height),
  );
}

async function frames() {
  await browser.execute(
    () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
}

/** Opens the viewer on one roster row, as M8.5 does: reveal the roster if folded, then click. */
async function view(handle: string) {
  await revealRosterRow(handle);
  await browser.$(`.grouped-roster [data-handle="${handle}"]`).click();
  await browser.$(`${SCANS} [data-source-index="0"]`).waitForExist({ timeout: 60_000 });
}

async function open(options: Parameters<typeof answers>[0] = {}) {
  await installIpcBoundary(answers(options));
  await browser.url("/");
  await browser.$(".workbench-header").waitForDisplayed();
  if (options.refusedViewport !== true) await answerBySource(options.long === true ? LONG_SPECTRUM : SPECTRUM);
  // The figure dialog draws a preview before it offers SVG, PNG or Copy.
  await answerFigurePreviews();
  await view(MZML_ROW.handle);
}

/** A header destination, by its visible name. */
async function navigate(names: readonly string[]) {
  const found = await browser.execute((labels: readonly string[]) => {
    const target = [...document.querySelectorAll<HTMLButtonElement>(".workbench-navigation > button")]
      .find((button) => labels.includes(button.textContent ?? ""));
    target?.click();
    return target !== undefined;
  }, names);
  // Project is the header menu's first item, not a tab (rebuild spec 1.1).
  if (!found) {
    await browser.$("[data-project-menu]").click();
    await browser.$('[data-project-menu-item="surface"]').waitForDisplayed();
    await browser.$('[data-project-menu-item="surface"]').click();
  }
}

function row(index: number) {
  return `${SCANS} [data-source-index="${String(index)}"]`;
}

/**
 * A real click on one ordinary cell of a scan row, as M7.3 activates rows: the
 * MS level, the third of the compact list's four columns (rebuild spec 3.5).
 */
async function activateRow(index: number) {
  await browser.$(SCANS).scrollIntoView({ block: "start" });
  await browser.$(`${row(index)} [role="gridcell"]:nth-child(3)`).click();
}

/** A toolbar's icon button, by its accessible name: it has no text (rebuild spec 3.4, 3.5). */
function iconButton(scope: string, label: string) {
  return browser.$(scope).$(`button[aria-label="${label}"]`);
}

/** Whether a control is refused: still a Tab stop, aria-disabled with its reason. */
async function refused(scope: string, label: string): Promise<boolean> {
  return (await iconButton(scope, label).getAttribute("aria-disabled")) === "true";
}

/** Every source index the viewer has asked Rust to read a spectrum for, in order. */
async function spectrumReads(): Promise<number[]> {
  return (await ipcCalls())
    .filter((call) => call.command === "load_selected_spectrum")
    .map((call) => Number(call.args["index"]));
}

async function waitForReads(count: number) {
  await browser.waitUntil(async () => (await spectrumReads()).length === count, {
    timeout: 15_000,
    timeoutMsg: `expected ${String(count)} spectrum reads`,
  });
}

/** The one committed selection, as the table, the plot and the spectrum panel show it. */
function shownSelection() {
  return browser.execute(
    (scans: string) => ({
      row: document.querySelector(`${scans} [aria-selected="true"]`)?.getAttribute("data-source-index") ?? null,
      marker: document.querySelector("g.chromatogram-selected") !== null,
      summary: document.querySelector("#selected-spectrum-summary")?.textContent ?? null,
    }),
    SCANS,
  );
}

async function expectSelected(index: number) {
  await browser.waitUntil(
    async () => (await shownSelection()).summary?.startsWith(`Spectrum ${String(index)},`) === true,
    { timeout: 15_000, timeoutMsg: `the spectrum panel never showed spectrum ${String(index)}` },
  );
  expect(await shownSelection()).toEqual({
    row: String(index),
    marker: true,
    summary: expect.stringMatching(new RegExp(`^Spectrum ${String(index)},`, "u")),
  });
}

/** Where a fraction of one plot's drawn band falls, with M7.3's padding. */
async function point(selector: string, fraction: number) {
  return browser.execute(
    (css: string, part: number) => {
      const node = document.querySelector(css)!;
      const box = node.getBoundingClientRect();
      const mz = node.classList.contains("spectrum-plot");
      return {
        x: Math.round(box.x + (box.width * ((mz ? 8 : 64) + (mz ? 984 : 924) * part)) / 1000),
        y: Math.round(box.y + box.height * 0.45),
      };
    },
    selector,
    fraction,
  );
}

async function clickPlot(selector: string, fraction: number) {
  const at = await point(selector, fraction);
  await browser.performActions([
    {
      type: "pointer",
      id: "pm93-pointer",
      parameters: { pointerType: "mouse" },
      actions: [
        { type: "pointerMove", duration: 0, origin: "viewport", ...at },
        { type: "pointerDown", button: 0 },
        { type: "pointerUp", button: 0 },
      ],
    },
  ]);
  await browser.releaseActions();
}

/** A primary drag across a plot, released: M7.3's proposal gesture. */
async function drag(selector: string, from: number, to: number) {
  const start = await point(selector, from);
  const end = await point(selector, to);
  await browser.performActions([
    {
      type: "pointer",
      id: "pm93-pointer",
      parameters: { pointerType: "mouse" },
      actions: [
        { type: "pointerMove", duration: 0, origin: "viewport", ...start },
        { type: "pointerDown", button: 0 },
        { type: "pointerMove", duration: 150, origin: "viewport", ...end },
        { type: "pointerUp", button: 0 },
      ],
    },
  ]);
  await browser.releaseActions();
}

/**
 * One element's text, read from the document rather than through `getText`, so
 * a line the evidence column has scrolled out of view still answers.
 */
function textOf(css: string): Promise<string> {
  return browser.execute(
    (selector: string) => document.querySelector(selector)?.textContent?.trim() ?? "",
    css,
  ) as Promise<string>;
}

/** What the m/z viewport says is on screen. */
function mzCaption(): Promise<string> {
  return textOf(SPECTRUM_RANGE);
}

/** What a plot's range line says: committed or pending, and the two numbers. */
async function rangeLine(panel: string) {
  const text = await browser.execute(
    (css: string) => document.querySelector(`${css} .plot-committed-range`)?.textContent ?? "",
    panel,
  );
  const [, low, high] = /(-?[\d.]+(?:e[-+]?\d+)?) to (-?[\d.]+(?:e[-+]?\d+)?)$/u.exec(text) ?? [];
  return {
    pending: text.startsWith(prefix(en.rangePending)),
    committed: text.startsWith(prefix(en.rangeCommittedPart)),
    low: Number(low),
    high: Number(high),
  };
}

/**
 * One plot's range row and caption, read in one script: the sentence a sighted
 * reader sees (outside .visually-hidden, the pending actions and Set range…
 * with its editor), the sentence the line states whether printed or only
 * announced (its committed claim, without the announced bounds), what the live
 * line says, the bounds it carries, the bounds the caption prints for the range
 * on screen, and how many announcers the row has.
 *
 * With nothing pending and nothing narrower than the full range committed, the
 * line is announced and not printed (the caption already says "full range"), so
 * `visible` is empty there and `sentence` is what its truth is judged on.
 */
function rangeFacts(panel: string) {
  return browser.execute((css: string) => {
    const root = document.querySelector(css)!;
    const row = root.querySelector(".plot-range-actions")!;
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    let visible = "";
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      // Set range… and its editor took the old range disclosure's place (rebuild spec 3.4).
      const hidden = node.parentElement?.closest(".visually-hidden, .plot-pending-actions, .plot-range-toggle, .plot-range-editor");
      if (hidden === null || hidden === undefined || !row.contains(hidden)) visible += node.textContent ?? "";
    }
    const line = row.querySelector(".plot-committed-range");
    let sentence = "";
    if (line !== null) {
      const lineWalker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      for (let node = lineWalker.nextNode(); node !== null; node = lineWalker.nextNode()) {
        const hidden = node.parentElement?.closest(".visually-hidden");
        if (hidden === null || hidden === undefined || hidden === line || !line.contains(hidden)) sentence += node.textContent ?? "";
      }
    }
    const bounds = (text: string) => {
      const match = /(-?\d+\.\d+) (?:to|至) (-?\d+\.\d+)/u.exec(text);
      return match === null ? null : `${match[1]} to ${match[2]}`;
    };
    const spoken = (row.querySelector(".plot-committed-range")?.textContent ?? "").replace(/\s+/gu, " ").trim();
    return {
      visible: visible.replace(/\s+/gu, " ").trim(),
      sentence: sentence.replace(/\s+/gu, " ").trim(),
      spoken,
      bounds: bounds(spoken),
      displayed: bounds(root.querySelector(".chromatogram-range, #spectrum-viewport-range")?.textContent ?? ""),
      announcers: [...row.querySelectorAll("[aria-live]")].filter((node) => node.closest(".plot-range-editor") === null).length,
    };
  }, panel);
}

/** Records what the live line says each time anything inside it changes. */
async function watchLine(panel: string) {
  await browser.execute((css: string) => {
    const line = document.querySelector(`${css} .plot-committed-range`)!;
    const seen: string[] = [];
    Reflect.set(window, "__pm93Line", seen);
    new MutationObserver(() => {
      seen.push((line.textContent ?? "").replace(/\s+/gu, " ").trim());
    }).observe(line, { attributes: true, characterData: true, childList: true, subtree: true });
  }, panel);
}

/** Every text the live line has taken since watchLine, in order. */
function lineChanges(): Promise<string[]> {
  return browser.execute(() => (Reflect.get(window, "__pm93Line") as string[] | undefined) ?? []);
}

/**
 * A middle-button press on a plot, moved past the slop and held: a pan in
 * flight. Middle drag pans since M7.3, where a primary drag proposes a band.
 *
 * Driven through the DevTools input domain rather than WebDriver actions: held
 * across two action calls, ChromeDriver releases the middle button as a button
 * change (a pointermove, then an auxclick with `buttons` 2) instead of a
 * pointerup, so the pan never ends (observed on Chrome 154). Returns where the
 * pointer rests, for releasePan.
 */
async function holdPan(selector: string, from: number, to: number) {
  const start = await point(selector, from);
  const end = await point(selector, to);
  await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: start.x, y: start.y, button: "none", buttons: 0 });
  await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: start.x, y: start.y, button: "middle", buttons: 4, clickCount: 1 });
  for (let step = 1; step <= 5; step += 1) {
    const x = Math.round(start.x + ((end.x - start.x) * step) / 5);
    await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y: start.y, button: "middle", buttons: 4 });
  }
  return end;
}

async function releasePan(at: { readonly x: number; readonly y: number }) {
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: at.x, y: at.y, button: "middle", buttons: 0, clickCount: 1 });
}

/** Escape, pressed and released on whatever has the focus. */
async function pressEscape() {
  const key = { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 };
  await cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", ...key });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", ...key });
}

/** The figure dialog's width field: its id is generated, its class is not. */
const DIALOG_WIDTH = `${FIGURE_DIALOG} .spectrum-figure-field-widthPx input`;

/** The range the open figure dialog has checked: Current is its first segment, Full its second. */
function dialogScope(): Promise<"current" | "full" | null> {
  return browser.execute((dialog: string) => {
    const segments = [...document.querySelectorAll(`${dialog} .figure-export-range [role="radio"]`)];
    const at = segments.findIndex((segment) => segment.getAttribute("aria-checked") === "true");
    return at === 0 ? "current" : at === 1 ? "full" : null;
  }, FIGURE_DIALOG) as Promise<"current" | "full" | null>;
}

/**
 * Chooses a plot's export range, and optionally its figure width, in the figure
 * dialog its head's Export… opens, then closes the dialog. The scope and the
 * draft are the workspace's, so they hold for the head's PNG and the ⋯ menu's
 * data exports as well (rebuild spec 3.4, 6). The dialog is modal: a gesture
 * on the plot comes after it closes.
 */
async function chooseScope(panel: string, scope: "full" | "current", width?: string) {
  await openFigureDialog(panel);
  await browser.$(`${FIGURE_DIALOG} .figure-export-range [role="radio"]:nth-child(${scope === "current" ? "1" : "2"})`).click();
  await browser.waitUntil(async () => (await dialogScope()) === scope, { timeoutMsg: `the dialog never checked ${scope}` });
  if (width !== undefined) await browser.$(DIALOG_WIDTH).setValue(width);
  await closeFigureDialog();
}

/** A plot's export range and figure width, read in its figure dialog, which is then closed. */
async function figureChoice(panel: string) {
  await openFigureDialog(panel);
  const choice = { scope: await dialogScope(), width: await browser.$(DIALOG_WIDTH).getValue() };
  await closeFigureDialog();
  return choice;
}

/** Presses one export action by its visible label inside one surface. */
async function press(surface: string, label: string) {
  await browser.execute(
    (css: string, text: string) => {
      [...document.querySelectorAll<HTMLButtonElement>(`${css} button`)]
        .find((button) => button.textContent?.trim() === text)
        ?.click();
    },
    surface,
    label,
  );
}

/** The arguments of the latest request of one command, once it has been made. */
async function lastRequest(command: string, after: number): Promise<Record<string, unknown>> {
  await browser.waitUntil(
    async () => (await ipcCalls()).filter((call) => call.command === command).length > after,
    { timeout: 15_000, timeoutMsg: `${command} never reached the boundary` },
  );
  return (await ipcCalls()).filter((call) => call.command === command).at(-1)!.args;
}

function countOf(calls: readonly IpcCall[], command: string): number {
  return calls.filter((call) => call.command === command).length;
}

/**
 * Waits for the one scientific export lane to be free again: every plot head's
 * PNG and Copy are refused while it is busy (rebuild spec 3.4).
 */
async function laneFree() {
  await browser.waitUntil(
    () =>
      browser.execute(() => {
        const actions = [...document.querySelectorAll<HTMLButtonElement>(".figure-quick-actions button")];
        return actions.length > 0 && actions.every((button) => button.getAttribute("aria-disabled") !== "true");
      }),
    { timeout: 15_000, timeoutMsg: "the export lane stayed busy" },
  );
  await frames();
}

/** The open figure dialog's buttons by group: its figure actions in the foot, and its data actions. */
function dialogGroups() {
  return browser.execute((dialog: string) => {
    const names = (css: string) =>
      [...document.querySelectorAll<HTMLButtonElement>(`${dialog} ${css} button`)].map((button) => (button.textContent ?? "").trim());
    return { figure: names(".figure-export-actions"), data: names(".figure-export-data-actions") };
  }, FIGURE_DIALOG);
}

/** A plot's ⋯ menu items, by their words; the menu is closed again with Escape. */
async function plotMenuItems(panel: string): Promise<string[]> {
  await openPlotMenu(panel);
  const items = await browser.execute(() =>
    [...document.querySelectorAll('[role="menuitem"]')].map((item) => (item.textContent ?? "").trim()),
  );
  await browser.keys("Escape");
  await browser.$('[role="menuitem"]').waitForExist({ reverse: true });
  return items;
}

// ---------------------------------------------------------------- observation

/**
 * Waits until the `100vh` shell fills the resized viewport, as PM9.1's
 * `settled` does (`8d3c9d8`). A read straight after `metrics()` can still see
 * the previous height: PM9.3's before-capture read the zh-CN 1920x1080 frame
 * with the document 360 px over, the 2560x1440 frame's height.
 */
async function settled(label: string) {
  await browser.waitUntil(
    () =>
      browser.execute(() => {
        const shell = document.querySelector(".workbench-shell");
        return shell !== null && Math.abs(shell.getBoundingClientRect().height - innerHeight) <= 1;
      }),
    { timeout: 10_000, interval: 50, timeoutMsg: `${label}: the shell never filled the resized viewport` },
  );
}

/** Viewer geometry for one frame. Recorded only; judged in a validation window. */
async function observeViewer(label: string) {
  await settled(label);
  const measured = await browser.execute(() => {
    const box = (css: string) => {
      const node = document.querySelector<HTMLElement>(css);
      if (node === null || node.hidden) return null;
      const r = node.getBoundingClientRect();
      return { top: r.top, height: r.height, width: r.width };
    };
    const header = document.querySelector(".workbench-header")?.getBoundingClientRect();
    const evidence = document.querySelector<HTMLElement>("#workbench-evidence");
    const evidenceBox = evidence === null || evidence.hidden ? null : evidence.getBoundingClientRect();
    const onScreen = (css: string) => {
      const node = document.querySelector(css);
      if (node === null || evidenceBox === null) return 0;
      const r = node.getBoundingClientRect();
      return Math.max(0, Math.min(r.bottom, evidenceBox.bottom, innerHeight) - Math.max(r.top, evidenceBox.top, 0));
    };
    // How many rows a toolbar's heading and controls take: an item that
    // begins below everything in the current row starts another. By overlap
    // rather than by top edge, so a label over its input and a 32px control
    // beside it are one row, and a heading counts, so actions that drop below
    // it as a whole are a second row. What a sighted reader sees: a visually
    // hidden label is not a row, and the search and MS-level fields are.
    const rows = (css: string) => {
      const node = document.querySelector(css);
      if (node === null || node.getClientRects().length === 0) return null;
      // A committed line hidden at rest takes no row (UI-34 as revised).
      const boxes = [...node.querySelectorAll("h2, button, label:not(.visually-hidden), input, select, .plot-committed-range:not(.visually-hidden)")]
        .filter((item) => item.getClientRects().length > 0)
        .map((item) => item.getBoundingClientRect())
        .sort((a, b) => a.top - b.top);
      let count = 0;
      let bottom = -Infinity;
      for (const box of boxes) {
        if (box.top >= bottom - 1) {
          count += 1;
          bottom = box.bottom;
        } else {
          bottom = Math.max(bottom, box.bottom);
        }
      }
      return { rows: count, height: node.getBoundingClientRect().height };
    };
    // What the evidence column's own scroll can put on screen: the element is
    // scrolled to the column's top (clamped where the column ends) and its
    // height is compared with what the column and every clipping ancestor
    // leave of it. The scroll is put back.
    const reach = (css: string) => {
      const node = document.querySelector(css);
      if (node === null || evidence === null || evidence.hidden) return null;
      const saved = evidence.scrollTop;
      evidence.scrollTop = saved + node.getBoundingClientRect().top - evidence.getBoundingClientRect().top;
      const r = node.getBoundingClientRect();
      let top = r.top;
      let bottom = r.bottom;
      for (let a = node.parentElement; a !== null && a !== evidence.parentElement; a = a.parentElement) {
        const style = getComputedStyle(a);
        if (style.overflowX === "visible" && style.overflowY === "visible") continue;
        const b = a.getBoundingClientRect();
        top = Math.max(top, b.top);
        bottom = Math.min(bottom, b.bottom);
      }
      bottom = Math.min(bottom, innerHeight);
      evidence.scrollTop = saved;
      return { height: r.height, visible: Math.max(0, bottom - top) };
    };
    return {
      css: { width: innerWidth, height: innerHeight },
      lang: document.documentElement.lang,
      headerBottom: header?.bottom ?? null,
      evidence:
        evidence === null || evidence.hidden
          ? null
          : {
              top: evidenceBox!.top,
              height: evidenceBox!.height,
              width: evidenceBox!.width,
              scrollHeight: evidence.scrollHeight,
            },
      // Each plot's range controls are in its head since the rebuild (spec
      // 3.4), so the head is the chromatogram's and the spectrum's one toolbar.
      toolbars: {
        chromatogramHeader: rows(".chromatogram-panel > .plot-head"),
        spectrumHeader: rows(".spectrum-panel > .plot-head"),
        scansHeader: rows(".spectrum-table-panel > .plot-head"),
        scanViewControls: rows(".scan-view-controls"),
      },
      rangeRows: {
        chromatogram: rows(".chromatogram-panel .plot-range-actions"),
        spectrum: rows(".spectrum-panel .plot-range-actions"),
      },
      reach: {
        spectrumHeader: reach(".spectrum-panel > .plot-head"),
        // Previous and Next, in the scan list's head (spec 3.5).
        scanSteps: reach(".spectrum-table-panel > .plot-head .plot-tools"),
        tableHeader: reach(".spectrum-table-head"),
        firstRow: reach('.spectrum-table-panel [data-row-position="0"]'),
      },
      documentOverflowY: document.documentElement.scrollHeight - innerHeight,
      // Not measured since the rebuild, by its spec: the quick-action caption
      // with the figure size (UI-26) left the plot head for the figure dialog,
      // and the m/z pill (UI-30) became icon buttons in the spectrum head
      // (spec 3.4).
      // What the lines under the plots print (UI-31, UI-33).
      rangeTexts: [...document.querySelectorAll(".plot-committed-range")].map((node) => node.textContent ?? ""),
      // What those lines show, without the numbers kept for announcement.
      rangeVisible: [...document.querySelectorAll(".plot-committed-range")].map((node) => {
        const copy = node.cloneNode(true) as HTMLElement;
        copy.querySelectorAll(".visually-hidden").forEach((hidden) => hidden.remove());
        return copy.textContent ?? "";
      }),
      chromatogramUnits: (() => {
        const panel = document.querySelector<HTMLElement>(".chromatogram-panel");
        return panel === null ? null : (panel.innerText.match(/unit not reported|单位未报告/gu) ?? []).length;
      })(),
      plotDescription: (() => {
        const plot = document.querySelector("svg.chromatogram-svg");
        return (plot?.getAttribute("aria-describedby") ?? "")
          .split(/\s+/u)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ");
      })(),
      // Whether the spectrum head's title and its tools, in one line, fit the
      // head side by side, the subtitle between them given no width: it
      // ellipsizes first (UI-28; spec 3.4). Measured by laying each out at
      // that size and back.
      spectrumControlsFit: (() => {
        const head = document.querySelector<HTMLElement>(".spectrum-panel > .plot-head");
        const title = head?.querySelector<HTMLElement>(":scope > h2");
        const tools = head?.querySelector<HTMLElement>(":scope > .plot-tools");
        if (!head || !title || !tools) return null;
        const at = (node: HTMLElement) => {
          const saved = [node.style.flex, node.style.width];
          node.style.flex = "none";
          node.style.width = "max-content";
          const measured = node.getBoundingClientRect().width;
          [node.style.flex, node.style.width] = saved as [string, string];
          return measured;
        };
        const style = getComputedStyle(head);
        const room = head.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        return at(title) + 2 * (parseFloat(style.columnGap) || 0) + at(tools) <= room + 0.5;
      })(),
      // The sentence about the selected spectrum, the head's subtitle, and
      // whether the head's controls cover it (UI-28). Since the rebuild the
      // head is one 36 px line whose subtitle ellipsizes first (spec 3.4), so
      // `cut` is recorded, not a failure.
      spectrumHeading: (() => {
        const head = document.querySelector<HTMLElement>(".spectrum-panel > .plot-head");
        const summary = head?.querySelector<HTMLElement>("#selected-spectrum-summary");
        if (!head || !summary || summary.getClientRects().length === 0) return null;
        const text = summary.getBoundingClientRect();
        const covered = [...head.querySelectorAll<HTMLElement>("button")]
          .filter((node) => node.getClientRects().length > 0)
          .map((node) => node.getBoundingClientRect())
          .some((box) => box.left < text.right - 1 && box.right > text.left + 1 && box.top < text.bottom - 1 && box.bottom > text.top + 1);
        return { cut: summary.scrollWidth > summary.clientWidth + 1, covered };
      })(),
      // Which acquisition the evidence belongs to, where the shell names it
      // (ADR 0006's Run identity; the Workbench's identity row, spec 3.2).
      identity: (() => {
        const item = document.querySelector<HTMLElement>(".viewer-identity-name");
        return item === null ? null : { text: item.textContent, truncated: item.scrollWidth > item.clientWidth };
      })(),
      panels: {
        chromatogram: box(".chromatogram-panel"),
        spectrum: box(".spectrum-panel"),
        scans: box(".spectrum-table-panel"),
      },
      plotsOnScreen: {
        chromatogram: onScreen("svg.chromatogram-svg"),
        spectrum: onScreen("svg.spectrum-plot"),
        scans: onScreen(".spectrum-table-panel"),
      },
      pendingActions: [...document.querySelectorAll(".plot-pending-actions")].length,
      rangeLines: [...document.querySelectorAll(".plot-committed-range")].map((node) => node.textContent),
      exportEntries: [...document.querySelectorAll(".figure-quick-actions button")].map(
        (node) => node.getAttribute("aria-label") ?? (node.textContent ?? "").trim(),
      ),
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
      external: performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((url) => /^https?:/u.test(url) && new URL(url).origin !== location.origin),
    };
  });
  const screenshot = await cdp("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  if (typeof screenshot.data !== "string") throw Error("Screenshot bytes missing");
  writeFileSync(join(output, `${label}.png`), Buffer.from(screenshot.data, "base64"));
  evidence.push({
    label,
    kind: "Observation only. React/mock-IPC viewer geometry over synthetic answers; not a golden and not an acceptance.",
    candidate: process.env["MSCANVAS_PM9_CANDIDATE"] ?? "unlabelled",
    ...measured,
  });
  // The limits other viewer specs already hold; no-overflow is a floor, not acceptance.
  expect(measured.horizontalOverflow).toBeLessThanOrEqual(1);
  expect(measured.external).toEqual([]);
  return { label, ...measured };
}

/**
 * UI-32: a plot's range row stays one row in a box 690 px or wider. Since the
 * rebuild the spectrum box sits beside the scan list rather than spanning the
 * evidence column (spec 3.1), so each plot's own box is what is measured.
 */
function wrappedRangeRows(frame: Awaited<ReturnType<typeof observeViewer>>): string[] {
  return (["chromatogram", "spectrum"] as const)
    .filter((plot) => (frame.panels[plot]?.width ?? 0) >= 690 && (frame.rangeRows[plot]?.rows ?? 0) > 1)
    .map((plot) => `${frame.label} ${plot} range row ${String(frame.rangeRows[plot]?.rows)} in ${String(frame.panels[plot]?.width)} px`);
}

/**
 * The lines under the plots, for the long-value case (baseline §12's coverage
 * gap): each range line and pending action not cut off at the sides by any box
 * that clips it (sides only: the evidence column scrolls vertically, so a row
 * below the fold is not cut off), each visible number on one line, each
 * action's label on one line.
 */
function rangeIntegrity(): Promise<string[]> {
  return browser.execute(() => {
    const evidence = document.querySelector<HTMLElement>("#workbench-evidence");
    const lineCount = (range: Range) => new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
    const clipped = (node: Element) => {
      const r = node.getBoundingClientRect();
      for (let a = node.parentElement; a !== null; a = a.parentElement) {
        const style = getComputedStyle(a);
        if (style.overflowX !== "visible" || style.overflowY !== "visible") {
          const left = a.getBoundingClientRect().left + a.clientLeft;
          if (r.left < left - 0.5 || r.right > left + a.clientWidth + 0.5) return true;
        }
        if (a === evidence) break;
      }
      return false;
    };
    return [...document.querySelectorAll<HTMLElement>(".plot-range-actions")].flatMap((row) => {
      const plot = row.closest(".chromatogram-panel") === null ? "m/z" : "rt";
      const problems: string[] = [];
      // Only a line printed on screen can be clipped; at rest it is hidden
      // and kept only as the announcement.
      const line = row.querySelector<HTMLElement>(".plot-committed-range:not(.visually-hidden)");
      if (line !== null) {
        if (clipped(line) || line.scrollWidth > line.clientWidth + 1) problems.push("line clipped");
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        for (let text = walker.nextNode(); text !== null; text = walker.nextNode()) {
          // The announced bounds are not on screen.
          if ((text.parentElement?.closest(".visually-hidden") ?? null) !== null) continue;
          const value = text.textContent ?? "";
          const numbers = /\d+\.\d+/gu;
          for (let match = numbers.exec(value); match !== null; match = numbers.exec(value)) {
            const range = document.createRange();
            range.setStart(text, match.index);
            range.setEnd(text, match.index + match[0].length);
            if (lineCount(range) !== 1) problems.push(`${match[0]} split`);
          }
        }
      }
      for (const button of row.querySelectorAll<HTMLElement>(".plot-pending-actions button")) {
        const label = document.createRange();
        label.selectNodeContents(button);
        if (clipped(button) || button.scrollWidth > button.clientWidth + 1 || lineCount(label) !== 1) {
          problems.push(`${(button.textContent ?? "").trim()} clipped`);
        }
      }
      return problems.map((problem) => `${plot} ${problem}`);
    });
  });
}

/** Opens or closes one header panel toggle, and waits for the header to say so. */
async function setPanel(panel: "roster" | "details", open: boolean) {
  // The press is saved, and the shell adopts the layout the save confirms.
  await readBackSavedPreferences();
  const toggle = browser.$(`[aria-controls="workbench-${panel === "roster" ? "roster" : "inspector"}"]`);
  if ((await toggle.getAttribute("aria-expanded")) !== String(open)) await toggle.click();
  await browser.waitUntil(async () => (await toggle.getAttribute("aria-expanded")) === String(open), {
    timeoutMsg: `the ${panel} toggle never became ${String(open)}`,
  });
  await frames();
}

/**
 * Real Tab presses from the evidence region into and through the chromatogram
 * panel: each stop's name, whether it shows the focus treatment, and whether
 * it is on screen. Stops once focus has left the panel.
 */
async function keyboardWalk() {
  await browser.execute(() => document.querySelector<HTMLElement>("#workbench-evidence")?.focus({ preventScroll: true }));
  const stops: { name: string; inPanel: boolean; focusVisible: boolean; outline: string; onScreen: boolean }[] = [];
  for (let step = 0; step < 30; step += 1) {
    await browser.keys(["Tab"]);
    const stop = await browser.execute(() => {
      const node = document.activeElement as HTMLElement | null;
      if (node === null) return null;
      const r = node.getBoundingClientRect();
      return {
        name: (node.getAttribute("aria-label") || node.closest("label")?.textContent || node.textContent || node.tagName).trim().slice(0, 48),
        inPanel: node.closest(".chromatogram-panel") !== null,
        focusVisible: node.matches(":focus-visible"),
        outline: getComputedStyle(node).outlineStyle,
        onScreen: r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth,
      };
    });
    if (stop === null) break;
    if (!stop.inPanel && stops.some((each) => each.inPanel)) break;
    stops.push(stop);
  }
  return stops;
}

// ---------------------------------------------------------------- cases

describe("PM9.3 viewer contracts, rendered", () => {
  before(() => {
    const root = process.env["MSCANVAS_PM9_OUTPUT_ROOT"] ?? resolve("test-results/pm9.3");
    mkdirSync(root, { recursive: true });
    output = mkdtempSync(join(root, "browser-"));
    console.log(`PM9.3 browser evidence: ${output}`);
  });

  after(async () => {
    evidence.push({ console: await consoleEntries() });
    writeFileSync(join(output, "evidence.json"), JSON.stringify(evidence, null, 2));
  });

  afterEach(async function () {
    await cdp("Emulation.setEmulatedMedia", { features: [] });
    evidence.push({
      test: this.currentTest?.title,
      state: this.currentTest?.state,
      console: await consoleEntries(),
    });
    if (this.currentTest?.state === "failed") {
      await browser.saveScreenshot(join(output, `failure-${evidence.length}.png`));
      evidence.push({ failedDocument: await browser.execute(() => document.body.innerText.slice(0, 8000)) });
    }
    writeFileSync(join(output, "evidence.json"), JSON.stringify(evidence, null, 2));
  });

  describe("functional (mock-backed)", () => {
    it("PM9.3-V1 commits one source index from the table, Previous/Next and the chromatogram", async () => {
      await metrics(1920, 1080);
      await open();

      await activateRow(3);
      await waitForReads(1);
      await expectSelected(3);

      await iconButton(SCANS, en.scanNext).click();
      await waitForReads(2);
      await expectSelected(4);

      await iconButton(SCANS, en.scanPrevious).click();
      await waitForReads(3);
      await expectSelected(3);

      // Retention time equals the index in this run, so scan 6 sits at 6/7.
      await browser.$(CHROMATOGRAM).scrollIntoView({ block: "nearest" });
      await clickPlot(PLOT, 6 / 7);
      await waitForReads(4);
      await expectSelected(6);

      // Every route named a source index, and the same one the view then showed.
      expect(await spectrumReads()).toEqual([3, 4, 3, 6]);
      // One preview read, at the row click; choosing scans reads no acquisition.
      expect(countOf(await ipcCalls(), "open_mzml_preview")).toBe(1);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("PM9.3-V2 lets search and sort hide the selection without replacing it, and recovers by the existing path", async () => {
      await metrics(1920, 1080);
      await open();
      await activateRow(3);
      await waitForReads(1);
      await expectSelected(3);
      const reads = (await spectrumReads()).length;

      // Sort by total ion current, descending. The compact list shows four
      // columns, so a field without one is ordered from Sort scans, which
      // names the order it applied (rebuild spec 3.5).
      const sortScans = () => browser.$(`${SCANS} button[aria-label^="${en.scanSortBy}"]`);
      for (const choice of [en.scanTotalIonCurrent, en.scanSortDescending]) {
        await sortScans().click();
        const item = browser.$(`//*[@role="menuitemradio"][normalize-space()="${choice}"]`);
        await item.waitForDisplayed();
        await item.click();
        await item.waitForExist({ reverse: true });
      }
      expect(await sortScans().getAttribute("aria-label")).toBe(
        fill(en.scanSortCurrent, { name: en.scanTotalIonCurrent, direction: en.scanSortDescending }),
      );

      await browser.$(`${SCANS} input[type="search"]`).setValue("rare-");
      expect(
        await browser.$$(`${SCANS} [data-source-index]`).map((node) => node.getAttribute("data-source-index")),
      ).toEqual(["7", "3"]);

      // A search that leaves the selected scan out says so and keeps it.
      await browser.$(`${SCANS} input[type="search"]`).setValue("raw-1");
      await browser.$(`${SCANS} .scan-hidden-selection`).waitForDisplayed();
      expect(await browser.$(`${SCANS} .scan-hidden-selection`).getText()).toContain(
        fill(en.scanSelectedOutside, { name: "3" }),
      );
      // Refused, not disabled: still Tab stops, with the hidden selection as the reason.
      expect(await refused(SCANS, en.scanNext)).toBe(true);
      expect(await refused(SCANS, en.scanPrevious)).toBe(true);
      expect((await shownSelection()).summary).toMatch(/^Spectrum 3,/u);
      // Nothing else was chosen for the reader, and nothing was read.
      expect((await spectrumReads()).length).toBe(reads);

      // The one recovery path: clear the filters, which keeps the sort.
      await browser.$(SCANS).$(`button=${en.scanReveal}`).click();
      await browser.$(`${row(3)}[aria-selected="true"]`).waitForDisplayed();
      await iconButton(SCANS, en.scanNext).click();
      await waitForReads(reads + 1);
      // Next in the displayed, still-sorted order: 3 is followed by 2.
      await expectSelected(2);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("PM9.3-V3 exports the committed range, never a pending one, over Current range", async () => {
      await metrics(1920, 1080);
      await open();
      await chooseScope(RT_PANEL, "current");
      const before = countOf(await ipcCalls(), "begin_chromatogram_export");

      // A released drag is a proposal, not a decision.
      await browser.$(CHROMATOGRAM).scrollIntoView({ block: "nearest" });
      await drag(PLOT, 0.2, 0.7);
      await browser.$(`${RT_PANEL} .plot-pending-actions`).waitForDisplayed();
      expect((await rangeLine(RT_PANEL)).pending).toBe(true);

      // The data export, from the plot's ⋯ menu (rebuild spec 3.4).
      await choosePlotMenuItem(RT_PANEL, fill(en.viewerExportFormat, { name: "CSV" }));
      // Nothing is committed yet, so Current is the whole run -- sent as null
      // bounds for Rust to resolve, never the pending band's numbers.
      expect((await lastRequest("begin_chromatogram_export", before))["range"]).toEqual({
        scope: "current",
        low: null,
        high: null,
      });
      evidence.push({ label: "pm93-v3-pending-after-export", line: await rangeLine(RT_PANEL) });
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("PM9.3-V4 sends the confirmed range on the existing Current-range path, and Full stays full", async () => {
      await metrics(1920, 1080);
      const csv = fill(en.viewerExportFormat, { name: "CSV" });
      await open();
      await chooseScope(RT_PANEL, "current");

      await browser.$(CHROMATOGRAM).scrollIntoView({ block: "nearest" });
      await drag(PLOT, 0.2, 0.7);
      await browser.$(`${RT_PANEL} .plot-pending-actions`).waitForDisplayed();
      // Confirm by the band's own action ("Zoom to selection").
      await browser.$(`${RT_PANEL} .plot-pending-actions button:nth-child(1)`).click();
      await browser.$(`${RT_PANEL} .plot-pending-actions`).waitForExist({ reverse: true });
      const line = await rangeLine(RT_PANEL);
      expect(line.committed).toBe(true);
      // The bounds the dialog offers are its Current range's window, at the
      // plot's own four decimals, as the line under the plot says them (UI-31;
      // rebuild spec 6). No surface prints them at full precision any more,
      // so the request is compared at those four decimals.
      await openFigureDialog(RT_PANEL);
      const offered = await textOf(`${FIGURE_DIALOG} .figure-export-window`);
      await closeFigureDialog();
      const [, low, high] = /(-?[\d.]+)–(-?[\d.]+)$/u.exec(offered) ?? [];
      expect(Number(low)).toBeLessThan(Number(high));
      expect(offered).toBe(fill(en.viewerExportRtWindow, { low: line.low.toFixed(4), high: line.high.toFixed(4) }));
      const sent = (range: Record<string, unknown>) => [Number(range["low"]).toFixed(4), Number(range["high"]).toFixed(4)];

      const before = countOf(await ipcCalls(), "begin_chromatogram_export");
      await choosePlotMenuItem(RT_PANEL, csv);
      const current = (await lastRequest("begin_chromatogram_export", before))["range"] as Record<string, unknown>;
      expect(current["scope"]).toBe("current");
      expect(sent(current)).toEqual([low, high]);
      await laneFree();

      // The discriminating case: a new band drawn over a committed range. The
      // export still carries the committed range, not the pending one and not
      // the whole run (ADR 0034, "a gesture in flight is not a decision").
      await drag(PLOT, 0.3, 0.6);
      await browser.$(`${RT_PANEL} .plot-pending-actions`).waitForDisplayed();
      const pending = await rangeLine(RT_PANEL);
      expect(pending.pending).toBe(true);
      expect([pending.low, pending.high]).not.toEqual([line.low, line.high]);
      const overPending = countOf(await ipcCalls(), "begin_chromatogram_export");
      await choosePlotMenuItem(RT_PANEL, csv);
      const kept = (await lastRequest("begin_chromatogram_export", overPending))["range"] as Record<string, unknown>;
      expect(kept["scope"]).toBe("current");
      expect(sent(kept)).toEqual([low, high]);
      await laneFree();
      // The band the export did not take is still pending, and still the reader's to cancel.
      await browser.$(`${RT_PANEL} .plot-pending-actions button:nth-child(2)`).click();
      await browser.$(`${RT_PANEL} .plot-pending-actions`).waitForExist({ reverse: true });

      await chooseScope(RT_PANEL, "full");
      const full = countOf(await ipcCalls(), "begin_chromatogram_export");
      await choosePlotMenuItem(RT_PANEL, csv);
      expect((await lastRequest("begin_chromatogram_export", full))["range"]).toEqual({
        scope: "full",
        low: null,
        high: null,
      });
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("PM9.3-V5 moves the viewports without reading the source again", async () => {
      await metrics(1920, 1080);
      await open();
      await activateRow(2);
      await waitForReads(1);
      await expectSelected(2);
      await frames();
      const before = await ipcCalls();

      await iconButton(RT_PANEL, en.viewerZoomIn).click();
      await iconButton(RT_PANEL, en.viewerZoomOut).click();
      await iconButton(RT_PANEL, en.viewerReset).click();
      const at = await point(PLOT, 0.5);
      await browser.action("wheel").scroll({ x: at.x, y: at.y, deltaY: -300 }).perform();
      await drag(PLOT, 0.3, 0.6);
      await browser.$(`${RT_PANEL} .plot-pending-actions`).waitForDisplayed();
      await browser.$(`${RT_PANEL} .plot-pending-actions button:nth-child(2)`).click();

      await browser.$(SPECTRUM_PLOT).scrollIntoView({ block: "nearest" });
      await iconButton(MZ_PANEL, en.viewerMzZoomIn).click();
      await browser.waitUntil(async () => !(await mzCaption()).includes(en.viewerFullRange.trim()), {
        timeout: 15_000,
        timeoutMsg: "Zoom in m/z never committed",
      });
      await iconButton(MZ_PANEL, en.viewerMzReset).click();
      await frames();

      const delta = (await ipcCalls()).slice(before.length);
      evidence.push({ label: "pm93-v5-requests", commands: delta.map((call) => call.command) });
      // No preview read and no spectrum read: moving a view is not re-acquiring.
      expect(viewerReads(delta)).toBe(0);
      // The only request is the documented screen projection of the retained
      // spectrum ("re-reads no acquisition"), owed after an m/z commit.
      expect(delta.map((call) => call.command).filter((command) => command !== "project_selected_spectrum")).toEqual([]);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("PM9.3-V6 keeps the m/z view for the same spectrum and starts a new context for another", async () => {
      await metrics(1920, 1080);
      await open();
      await activateRow(1);
      await waitForReads(1);
      await expectSelected(1);
      await browser.$(SPECTRUM_PLOT).scrollIntoView({ block: "nearest" });
      await iconButton(MZ_PANEL, en.viewerMzZoomIn).click();
      await browser.waitUntil(async () => !(await mzCaption()).includes(en.viewerFullRange.trim()), {
        timeout: 15_000,
        timeoutMsg: "Zoom in m/z never committed",
      });
      await chooseScope(MZ_PANEL, "current");
      await frames();
      const zoomed = await mzCaption();
      const calls = await ipcCalls();

      // Around the shell and back: the same spectrum, the same token, the same view.
      await navigate([en.conversionTask]);
      await navigate([en.projectSurface]);
      await navigate([en.workbench]);
      expect(await mzCaption()).toBe(zoomed);
      const trip = (await ipcCalls()).slice(calls.length);
      evidence.push({ label: "pm93-v6-trip-requests", commands: trip.map((call) => call.command) });
      expect(viewerReads(trip)).toBe(0);
      expect((await figureChoice(MZ_PANEL)).scope).toBe("current");

      // Another spectrum is another viewport context (ADR 0038) and another
      // export context (ADR 0040): the view opens full and the scope at Full.
      await iconButton(SCANS, en.scanNext).click();
      await waitForReads(2);
      await expectSelected(2);
      await browser.waitUntil(async () => (await mzCaption()).includes(en.viewerFullRange.trim()), {
        timeout: 15_000,
        timeoutMsg: "the next spectrum kept the previous m/z window",
      });
      expect((await figureChoice(MZ_PANEL)).scope).toBe("full");
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("PM9.3-V7 refuses an unordered m/z domain honestly and keeps the full-source data export", async () => {
      await metrics(1920, 1080);
      await open({ refusedViewport: true });
      await selectTheSpectrum(0);

      // The viewport says it cannot navigate, and why, and offers nothing that would.
      expect(await mzCaption()).toBe(en.viewerMzNoRange);
      expect((await textOf(SPECTRUM_STATUS)).startsWith(en.viewerMzRefused)).toBe(true);
      // Refused, not disabled: each stays a Tab stop with the range line as its reason.
      for (const label of [en.viewerMzZoomIn, en.viewerMzZoomOut, en.viewerMzReset]) {
        expect(await refused(MZ_PANEL, label)).toBe(true);
      }

      // Export: no Current range to choose -- the range stays frozen on the
      // full spectrum and the line under it says why -- and the data export stays.
      await openFigureDialog(MZ_PANEL);
      expect(await dialogScope()).toBe("full");
      expect(await browser.$(`${FIGURE_DIALOG} .figure-export-range [role="radio"]:nth-child(1)`).isEnabled()).toBe(false);
      expect(await textOf(`${FIGURE_DIALOG} .figure-export-note`)).toBe(en.viewerExportNoViewport);
      const before = countOf(await ipcCalls(), "begin_selected_spectrum_export");
      await figureDialogButton(fill(en.viewerExportFormat, { name: "CSV" })).click();
      const request = await lastRequest("begin_selected_spectrum_export", before);
      expect(request["format"]).toBe("csv");
      expect(request["range"]).toEqual({ scope: "full", low: null, high: null });
      expect(typeof request["exportToken"]).toBe("string");
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("PM9.3-V8 keeps each surface's formats its own", async () => {
      await metrics(1920, 1080);
      await open();
      await activateRow(2);
      await waitForReads(1);
      await expectSelected(2);
      const svg = fill(en.viewerExportFormat, { name: "SVG" });
      const png = fill(en.viewerExportFormat, { name: "PNG" });
      const csv = fill(en.viewerExportFormat, { name: "CSV" });
      const tsv = fill(en.viewerExportFormat, { name: "TSV" });

      // Since the rebuild each plot's figure is its dialog's (Export…), and
      // its data documents are in the dialog and the head's ⋯ menu; the
      // linked figure opens the same dialog from the chromatogram's ⋯ (spec
      // 3.4, 6).
      await openFigureDialog(MZ_PANEL);
      const spectrumDialog = await dialogGroups();
      await closeFigureDialog();
      await openFigureDialog(RT_PANEL);
      const chromatogramDialog = await dialogGroups();
      await closeFigureDialog();
      const spectrumMenu = await plotMenuItems(MZ_PANEL);
      const chromatogramMenu = await plotMenuItems(RT_PANEL);
      evidence.push({ label: "pm93-v8-labels", spectrumDialog, chromatogramDialog, spectrumMenu, chromatogramMenu });
      // A spectrum's figure and its data are separate groups.
      expect(spectrumDialog).toEqual({ figure: [en.viewerCopy, svg, png], data: [csv, tsv] });
      expect(spectrumMenu).toEqual([csv, tsv]);
      expect(chromatogramDialog.data).toEqual([csv, tsv]);
      expect(chromatogramMenu).toEqual([csv, tsv, en.figurePreviewLinked]);

      // Each action sends its own command and its own format.
      const chromatogram = countOf(await ipcCalls(), "begin_chromatogram_export");
      await choosePlotMenuItem(RT_PANEL, tsv);
      expect((await lastRequest("begin_chromatogram_export", chromatogram))["format"]).toBe("tsv");
      await laneFree();

      // The spectrum head's PNG repeats the dialog's settings without it.
      const spectrum = countOf(await ipcCalls(), "begin_selected_spectrum_export");
      await press(figureActions(MZ_PANEL), "PNG");
      expect((await lastRequest("begin_selected_spectrum_export", spectrum))["format"]).toBe("png");
      await laneFree();

      const linked = countOf(await ipcCalls(), "begin_linked_figure_export");
      await choosePlotMenuItem(RT_PANEL, en.figurePreviewLinked);
      await browser.$(FIGURE_DIALOG).waitForDisplayed();
      // The linked figure is a figure only: it has no data export.
      const linkedDialog = await dialogGroups();
      evidence.push({ label: "pm93-v8-linked", ...linkedDialog });
      expect(linkedDialog).toEqual({ figure: [en.viewerCopy, svg, png], data: [] });
      const linkedSvg = figureDialogButton(svg);
      await browser.waitUntil(async () => (await linkedSvg.getAttribute("aria-disabled")) !== "true", {
        timeout: 15_000,
        timeoutMsg: "the linked figure dialog never offered SVG",
      });
      await linkedSvg.click();
      const pair = await lastRequest("begin_linked_figure_export", linked);
      expect(pair["format"]).toBe("svg");
      expect(typeof pair["chromatogramToken"]).toBe("string");
      expect(typeof pair["spectrumToken"]).toBe("string");
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("PM9.3-V9 keeps the viewer's context across the shell, and a new acquisition resets only what the owners reset", async () => {
      await metrics(1920, 1080);
      await open();
      await activateRow(2);
      await waitForReads(1);
      await expectSelected(2);
      await browser.$(CHROMATOGRAM).scrollIntoView({ block: "nearest" });
      await drag(PLOT, 0.2, 0.8);
      await browser.$(`${RT_PANEL} .plot-pending-actions`).waitForDisplayed();
      await browser.$(`${RT_PANEL} .plot-pending-actions button:nth-child(1)`).click();
      await browser.$(`${RT_PANEL} .plot-pending-actions`).waitForExist({ reverse: true });
      await browser.$(`${SCANS} input[type="search"]`).setValue("raw-");
      // The range and the figure draft are chosen in the chromatogram's figure dialog.
      await chooseScope(RT_PANEL, "current", "1000");
      await frames();

      const held = async () => ({
        selection: await shownSelection(),
        rt: await rangeLine(RT_PANEL),
        mz: await mzCaption(),
        search: await browser.$(`${SCANS} input[type="search"]`).getValue(),
      });
      const before = { ...(await held()), ...(await figureChoice(RT_PANEL)) };
      expect(before.scope).toBe("current");
      expect(before.width).toBe("1000");
      const calls = await ipcCalls();

      await navigate([en.conversionTask]);
      await navigate([en.projectSurface]);
      await navigate([en.workbench]);
      // Surfaces stay mounted: the owners still hold what they held.
      const after = await held();
      const trip = (await ipcCalls()).slice(calls.length);
      expect({ ...after, ...(await figureChoice(RT_PANEL)) }).toEqual(before);
      evidence.push({ label: "pm93-v9-trip-requests", commands: trip.map((call) => call.command) });
      expect(viewerReads(trip)).toBe(0);

      // Another acquisition replaces the preview: the selection and the
      // committed range belong to the one before (ADR 0032, preview-loaded).
      await view(secondFile.handle);
      await browser.waitUntil(async () => (await shownSelection()).row === null, {
        timeout: 15_000,
        timeoutMsg: "the selection survived a new preview",
      });
      expect((await shownSelection()).marker).toBe(false);
      await browser.waitUntil(async () => (await textOf(".chromatogram-range")).includes(en.viewerFullRange.trim()), {
        timeout: 15_000,
        timeoutMsg: "the committed range survived a new preview",
      });
      // Nothing of the previous acquisition's commit stays in the committed
      // line, neither shown nor announced (UI-34).
      const fresh = await rangeFacts(RT_PANEL);
      // At rest the caption shows the range; the line announces it and prints nothing.
      expect(fresh.visible).toBe("");
      expect(fresh.sentence).toBe(fill(en.rangeCommittedFull, { name: en.rangeRtAxis }));
      expect(fresh.spoken).not.toContain(fixed({ low: before.rt.low, high: before.rt.high }));
      // Recorded, not asserted: whether the run scope, the table's search and
      // the figure draft follow the new preview is not a documented contract.
      evidence.push({
        label: "pm93-v9-after-new-preview",
        ...(await figureChoice(RT_PANEL)),
        search: await browser.$(`${SCANS} input[type="search"]`).getValue(),
      });
      expect(countOf(await ipcCalls(), "open_mzml_preview")).toBe(2);
      expect(await unexpectedConsole()).toEqual([]);
    });

    for (const locale of ["en", "zh-CN"] as const) {
      it(`PM9.3-V10 keeps the committed line true through a held pan, and says each commit once, never a gesture's start or cancel (UI-34) in ${locale}`, async () => {
        const words = locale === "en" ? en : zh;
        await metrics(1920, 1080);
        await open({ locale });
        await browser.$(CHROMATOGRAM).scrollIntoView({ block: "nearest" });
        const line = `${RT_PANEL} .plot-committed-range`;
        // Settled: the live line carries a commit other than `previous`, and the caption shows it.
        const settledOn = (previous: string | null) => async () => {
          const now = await rangeFacts(RT_PANEL);
          return now.bounds !== null && now.bounds !== previous && now.bounds === now.displayed;
        };
        // Each visible sentence against the state it is about; collected, so one
        // run says which checkpoints were false.
        const problems: string[] = [];
        // Judged on the line's sentence, printed or only announced.
        const judge = (label: string, facts: { readonly visible: string; readonly sentence: string; readonly displayed: string | null }, committed: string | null) => {
          const why = untrue(facts.sentence, words.rangeRtAxis, { committed, shown: facts.displayed ?? "" }, locale);
          if (why !== null) problems.push(`${label}: ${why}`);
          if (committed !== null && committed === facts.displayed && /\d/u.test(facts.visible)) problems.push(`${label}: repeats the caption: ${facts.visible}`);
        };

        // A committed range first, so a gesture has a commit to differ from.
        await iconButton(RT_PANEL, words.viewerZoomIn).click();
        await browser.waitUntil(settledOn(null), { timeout: 15_000, timeoutMsg: "Zoom in never committed" });
        await frames();
        const zoomed = await rangeFacts(RT_PANEL);
        judge("zoomed", zoomed, zoomed.bounds);
        await watchLine(RT_PANEL);

        // 1. A middle-button pan, held: the plot displays the gesture's range;
        // nothing is committed yet.
        const first = await holdPan(PLOT, 0.5, 0.35);
        await frames();
        const held = await rangeFacts(RT_PANEL);
        expect(held.displayed).not.toBe(zoomed.bounds);
        expect(held.bounds).toBe(zoomed.bounds);
        judge("held pan", held, zoomed.bounds);
        // Starting a gesture says nothing.
        expect(await lineChanges()).toEqual([]);

        // 2. Released: one change, to the new commit.
        await releasePan(first);
        await browser.waitUntil(settledOn(zoomed.bounds), { timeout: 15_000, timeoutMsg: "the pan never settled into a new commit" });
        await frames();
        const panned = await rangeFacts(RT_PANEL);
        judge("panned", panned, panned.bounds);
        expect(await lineChanges()).toEqual([panned.spoken]);
        if (locale === "en") {
          // The parser V3, V4 and V9 read the line with still finds the commit at its end.
          const parsed = await rangeLine(RT_PANEL);
          expect({ committed: parsed.committed, bounds: fixed(parsed) }).toEqual({ committed: true, bounds: panned.bounds });
        }

        // 3. Another held pan, cancelled with Escape: nothing said, nothing committed.
        const second = await holdPan(PLOT, 0.35, 0.5);
        await frames();
        const cancelling = await rangeFacts(RT_PANEL);
        expect(cancelling.displayed).not.toBe(panned.bounds);
        expect(cancelling.bounds).toBe(panned.bounds);
        judge("held pan before Escape", cancelling, panned.bounds);
        expect(await browser.execute((css: string) => document.activeElement === document.querySelector(css), PLOT)).toBe(true);
        await pressEscape();
        await releasePan(second);
        await frames();
        const abandoned = await rangeFacts(RT_PANEL);
        expect({ bounds: abandoned.bounds, displayed: abandoned.displayed }).toEqual({ bounds: panned.bounds, displayed: panned.bounds });
        judge("abandoned", abandoned, panned.bounds);
        expect(await lineChanges()).toEqual([panned.spoken]);

        // 4. A successive wheel commits again, said once, when it settles.
        const at = await point(PLOT, 0.5);
        await browser.action("wheel").scroll({ x: at.x, y: at.y, deltaY: -300 }).perform();
        await browser.waitUntil(settledOn(panned.bounds), { timeout: 15_000, timeoutMsg: "the wheel never settled into a new commit" });
        await frames();
        const wheeled = await rangeFacts(RT_PANEL);
        judge("wheeled", wheeled, wheeled.bounds);
        const changes = await lineChanges();
        evidence.push({ label: `pm93-v10-live-line-${locale}`, zoomed, held, panned, cancelling, abandoned, wheeled, changes, problems });
        expect(changes).toEqual([panned.spoken, wheeled.spoken]);
        expect([wheeled.announcers, await browser.$(line).getAttribute("aria-live"), await browser.$(line).getAttribute("aria-atomic")]).toEqual([1, "polite", "true"]);
        // UI-34: every sentence shown, held gestures included, was true when shown.
        expect(problems).toEqual([]);
        expect(await unexpectedConsole()).toEqual([]);
      });
    }

    // UI-34's closeout samples (baseline §12). Discarding a pending band is a
    // real state transition: a gesture that starts over one discards it (the
    // owners' `gesture-started`), and the line then says the committed range,
    // once. Nothing more at that gesture's start, nothing on Escape, which does
    // not bring the band back, and a later commit is still said once.
    it("PM9.3-V11 says once that a pan discarded a pending band, and nothing on Escape, which restores no band (UI-34, closeout-sample) in en", async () => {
      await metrics(1920, 1080);
      await open();
      await browser.$(CHROMATOGRAM).scrollIntoView({ block: "nearest" });
      const line = `${RT_PANEL} .plot-committed-range`;
      // The pending band as its owner shows it: the band's actions and its drawn rectangle.
      const band = () =>
        browser.execute(
          (css: string) => ({
            actions: document.querySelector(`${css} .plot-pending-actions`) !== null,
            drawn: document.querySelector(`${css} .plot-range-band`)?.getAttribute("visibility") ?? null,
          }),
          RT_PANEL,
        );
      const problems: string[] = [];
      // Judged on the line's sentence, printed or only announced.
      const judge = (label: string, facts: { readonly sentence: string; readonly displayed: string | null }, committed: string | null) => {
        const why = untrue(facts.sentence, en.rangeRtAxis, { committed, shown: facts.displayed ?? "" });
        if (why !== null) problems.push(`${label}: ${why}`);
      };

      // A committed range first, so a pan has somewhere to go and the line has
      // bounds to keep.
      await iconButton(RT_PANEL, en.viewerZoomIn).click();
      await browser.waitUntil(
        async () => {
          const now = await rangeFacts(RT_PANEL);
          return now.bounds !== null && now.bounds === now.displayed;
        },
        { timeout: 15_000, timeoutMsg: "Zoom in never committed" },
      );
      await frames();
      const zoomed = await rangeFacts(RT_PANEL);
      judge("zoomed", zoomed, zoomed.bounds);

      // A band drawn inside it and released: pending, with nothing new on screen.
      await drag(PLOT, 0.3, 0.7);
      await browser.$(`${RT_PANEL} .plot-pending-actions`).waitForDisplayed();
      await frames();
      const pending = await rangeFacts(RT_PANEL);
      const [bandLow, bandHigh] = (pending.bounds ?? "").split(" to ");
      expect(await band()).toEqual({ actions: true, drawn: "visible" });
      expect(pending.spoken).toBe(fill(en.rangePending, { name: en.rangeRtAxis, low: bandLow!, high: bandHigh! }));
      expect(pending.displayed).toBe(zoomed.bounds);
      await watchLine(RT_PANEL);

      // 1. A middle-button pan starts over the band and is held. The owner
      // discards the band, and the line goes from it to the committed range,
      // unchanged: one change, and true while the pan is held.
      const pan = await holdPan(PLOT, 0.5, 0.35);
      await frames();
      const held = await rangeFacts(RT_PANEL);
      expect(await band()).toEqual({ actions: false, drawn: "hidden" });
      expect(held.displayed).not.toBe(zoomed.bounds);
      expect({ visible: held.visible, spoken: held.spoken }).toEqual({ visible: zoomed.visible, spoken: zoomed.spoken });
      judge("held pan", held, zoomed.bounds);
      expect(await lineChanges()).toEqual([held.spoken]);

      // 2. Escape abandons the pan: the committed range is on screen again, the
      // band stays discarded, and the line says nothing more, then or later.
      expect(await browser.execute((css: string) => document.activeElement === document.querySelector(css), PLOT)).toBe(true);
      await pressEscape();
      await releasePan(pan);
      await frames();
      await browser.pause(500);
      const abandoned = await rangeFacts(RT_PANEL);
      expect(await band()).toEqual({ actions: false, drawn: "hidden" });
      expect({ bounds: abandoned.bounds, displayed: abandoned.displayed }).toEqual({ bounds: zoomed.bounds, displayed: zoomed.bounds });
      judge("abandoned", abandoned, zoomed.bounds);
      expect(await lineChanges()).toEqual([held.spoken]);

      // 3. A later commit is still said, once, when it settles.
      const at = await point(PLOT, 0.5);
      await browser.action("wheel").scroll({ x: at.x, y: at.y, deltaY: -300 }).perform();
      await browser.waitUntil(
        async () => {
          const now = await rangeFacts(RT_PANEL);
          return now.bounds !== null && now.bounds !== zoomed.bounds && now.bounds === now.displayed;
        },
        { timeout: 15_000, timeoutMsg: "the wheel never settled into a new commit" },
      );
      await frames();
      const wheeled = await rangeFacts(RT_PANEL);
      judge("wheeled", wheeled, wheeled.bounds);
      const changes = await lineChanges();
      evidence.push({ label: "pm93-v11-discarded-band-en", zoomed, pending, held, abandoned, wheeled, changes, problems });
      expect(changes).toEqual([held.spoken, wheeled.spoken]);
      expect([wheeled.announcers, await browser.$(line).getAttribute("aria-live"), await browser.$(line).getAttribute("aria-atomic")]).toEqual([1, "polite", "true"]);
      expect(problems).toEqual([]);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("PM9.3-V12 renders a committed m/z range in zh-CN at 960x640, its label true and its bounds announced (UI-34, closeout-sample)", async () => {
      await metrics(1920, 1080);
      await open({ locale: "zh-CN" });
      await activateRow(2);
      await waitForReads(1);
      await browser.$(SPECTRUM_PLOT).scrollIntoView({ block: "nearest" });
      expect((await rangeFacts(MZ_PANEL)).sentence).toBe(fill(zh.rangeCommittedFull, { name: zh.rangeMzAxis }));
      await iconButton(MZ_PANEL, zh.viewerMzZoomIn).click();
      await browser.waitUntil(
        async () => {
          const now = await rangeFacts(MZ_PANEL);
          return now.bounds !== null && now.bounds === now.displayed;
        },
        { timeout: 15_000, timeoutMsg: "Zoom in m/z never committed" },
      );

      // The narrow anchor, reached as a reader narrowing the window reaches it,
      // with the m/z range row scrolled into the evidence column's view. By the
      // page's own scrollIntoView: WebdriverIO's wheels at the viewport's
      // origin, over the header, and so never scrolls the evidence column.
      await metrics(960, 640);
      await frames();
      await browser.execute((css: string) => document.querySelector(css)?.scrollIntoView({ block: "center" }), `${MZ_PANEL} .plot-range-actions`);
      await frames();
      const frame = await observeViewer("pm93-v12-zh-CN-committed-mz-960x640");
      const facts = await rangeFacts(MZ_PANEL);
      const rendered = await browser.execute((css: string) => {
        const line = document.querySelector(`${css} .plot-committed-range`)!.getBoundingClientRect();
        return {
          outer: { width: outerWidth, height: outerHeight },
          inner: { width: innerWidth, height: innerHeight },
          devicePixelRatio,
          spectrumPanel: document.querySelector(css)?.getBoundingClientRect().width ?? null,
          line: { top: line.top, bottom: line.bottom, left: line.left, right: line.right },
        };
      }, MZ_PANEL);
      const integrity = await rangeIntegrity();
      const [low, high] = (facts.displayed ?? "").split(" to ");
      evidence.push({
        label: "pm93-v12-zh-CN-committed-mz-960x640",
        rendered,
        column: frame.evidence?.width ?? null,
        rangeRow: frame.rangeRows.spectrum,
        facts,
        integrity,
      });

      // Rendered in Chinese, at the narrow anchor, the line on screen.
      expect({ lang: frame.lang, inner: rendered.inner, devicePixelRatio: rendered.devicePixelRatio }).toEqual({
        lang: "zh-CN",
        inner: { width: 960, height: 640 },
        devicePixelRatio: 1,
      });
      expect(rendered.line.top >= 0 && rendered.line.bottom <= 640 && rendered.line.right > rendered.line.left).toBe(true);
      // A range narrower than the spectrum is committed, and the visible label
      // says so and nothing about the screen: a current-range export takes it.
      expect(facts.displayed).not.toBe(fixed(SPECTRUM.viewportDomain));
      expect(facts.visible).toBe(fill(zh.rangeCommittedPart, { name: zh.rangeMzAxis }));
      expect(facts.sentence).toBe(facts.visible);
      expect(untrue(facts.sentence, zh.rangeMzAxis, { committed: facts.bounds, shown: facts.displayed ?? "" }, "zh-CN")).toBeNull();
      // The live line carries the committed bounds, which at rest are the caption's.
      expect(facts.bounds).toBe(facts.displayed);
      expect(facts.spoken).toBe(`${facts.sentence}${fill(zh.rangeCommittedBounds, { low: low!, high: high! })}`);
      expect([facts.announcers, await browser.$(`${MZ_PANEL} .plot-committed-range`).getAttribute("aria-live")]).toEqual([1, "polite"]);
      // Whole, and one row where UI-32 holds range rows (boxes of 690 px and wider).
      expect(integrity).toEqual([]);
      expect(wrappedRangeRows(frame)).toEqual([]);
      expect(await unexpectedConsole()).toEqual([]);
    });
  });

  describe("observation (current viewer; geometry recorded, L13 and toolbar rows asserted)", () => {
    for (const locale of ["en", "zh-CN"] as const) {
      it(`PM9.3-G viewer with a selected scan, a committed RT range and a pending m/z band in ${locale}`, async () => {
        // The entry state first, at the narrow anchor, reached the way a reader
        // at that window reaches it: the roster from the header, then a row.
        await metrics(960, 640);
        if (locale === "zh-CN") {
          await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
        }
        await installIpcBoundary(answers({ locale }));
        await browser.url("/");
        await browser.$(".workbench-header").waitForDisplayed();
        await answerBySource();
        await view(MZML_ROW.handle);
        await frames();
        const defaults = [await observeViewer(`pm93-g-${locale}-960x640-entry`)];

        await metrics(1920, 1080);
        await activateRow(2);
        await waitForReads(1);
        await browser.$(CHROMATOGRAM).scrollIntoView({ block: "nearest" });
        await drag(PLOT, 0.2, 0.8);
        await browser.$(`${RT_PANEL} .plot-pending-actions`).waitForDisplayed();
        await browser.$(`${RT_PANEL} .plot-pending-actions button:nth-child(1)`).click();
        await browser.$(SPECTRUM_PLOT).scrollIntoView({ block: "nearest" });
        await drag(SPECTRUM_PLOT, 0.2, 0.6);
        await browser.$(`${MZ_PANEL} .plot-pending-actions`).waitForDisplayed();
        await browser.execute(() => document.querySelector<HTMLElement>("#workbench-evidence")?.scrollTo({ top: 0 }));

        // One state, then the window narrows, as a reader resizing it would:
        // the three anchors and the eight review sizes of the manual sweep,
        // each with the panels its width opens by default.
        for (const [width, height] of [
          [2560, 1440],
          [1920, 1080],
          [1680, 1050],
          [1536, 864],
          [1440, 900],
          [1366, 768],
          [1280, 800],
          [1280, 720],
          [1152, 720],
          [1024, 768],
          [960, 640],
        ] as const) {
          await metrics(width, height);
          await frames();
          const measured = await observeViewer(`pm93-g-${locale}-${String(width)}x${String(height)}`);
          expect(measured.lang).toBe(locale);
          defaults.push(measured);
        }

        // L13: no viewer toolbar takes a second row in any default arrangement
        // (DESIGN_SYSTEM: "toolbars must not grow into wrapping ribbons").
        // Since the known UI rework (UI-32), the lines under the plots count too.
        // The selected spectrum's head is held to one row where its title and
        // tools fit side by side -- its subtitle ellipsizes first (spec 3.4) --
        // and to the title plus one row of tools where they do not (UI-28).
        const overOneRow = (frame: (typeof defaults)[number], withRangeRows: boolean) =>
          Object.entries({ ...frame.toolbars, ...(withRangeRows ? frame.rangeRows : {}) })
            .filter(([name, toolbar]) => toolbar !== null && toolbar.rows > (name === "spectrumHeader" && frame.spectrumControlsFit === false ? 2 : 1))
            .map(([name, toolbar]) => `${frame.label} ${name} ${String(toolbar?.rows)}`);
        const wrapped = defaults.flatMap((frame) => overOneRow(frame, true));
        expect(wrapped).toEqual([]);

        // The rest of the known UI rework on the default frames (baseline §12):
        // range lines at the plot's own precision (UI-31); the missing unit
        // said once per axis, and still in the plot's description (UI-33); no
        // committed-range numbers before a range is committed (UI-31). UI-26
        // (the figure size caption) and UI-30 (the m/z pill) are retired: the
        // rebuild removed both elements (spec 3.4).
        const rework = defaults.flatMap((frame) => [
          ...frame.rangeTexts.filter((text) => /\d\.\d{5,}/u.test(text)).map((text) => `${frame.label} raw digits: ${text}`),
          ...(frame.chromatogramUnits !== null && frame.chromatogramUnits !== 2 ? [`${frame.label} unit caveat ${String(frame.chromatogramUnits)} times`] : []),
          ...(/unit not reported|单位未报告/u.test(frame.plotDescription) ? [] : [`${frame.label} plot description without the unit caveat`]),
          // Settled, the committed range is the one the caption prints; the
          // line does not repeat its numbers, which stay in its announcement
          // (dispatch item 5; UI-34).
          ...(/\d/u.test(frame.rangeVisible[0] ?? "") ? [`${frame.label} committed line repeats the caption: ${String(frame.rangeVisible[0])}`] : []),
        ]);
        const entry = defaults[0]!;
        const entryLine = entry.rangeTexts[0] ?? "";
        expect({ rework, entryLine: /\d/u.test(entryLine) ? entryLine : null }).toEqual({ rework: [], entryLine: null });

        // The keyboard path through the chromatogram at the narrow anchor.
        const walk = await keyboardWalk();
        evidence.push({ label: `pm93-g-${locale}-960x640-keyboard`, walk });
        const inPanel = walk.filter((stop) => stop.inPanel);
        expect(inPanel.length).toBeGreaterThan(0);
        expect(inPanel.filter((stop) => !stop.focusVisible || stop.outline === "none" || !stop.onScreen)).toEqual([]);
        await browser.execute(() => document.querySelector<HTMLElement>("#workbench-evidence")?.scrollTo({ top: 0 }));

        // Details opened by the reader where its width does not open it, and
        // the drawers at the narrow anchor. The chromatogram and scan heads
        // stay one row down to the 1152x720 column (UI-27, UI-29); the
        // spectrum head as overOneRow says (UI-28). The lines under the plots
        // count in plot boxes from 690 px (UI-32).
        const detailsOpen = [];
        for (const [width, height] of [
          [1536, 864],
          [1440, 900],
          [1366, 768],
          [1280, 800],
          [1152, 720],
        ] as const) {
          await metrics(width, height);
          await setPanel("details", true);
          detailsOpen.push(await observeViewer(`pm93-g-${locale}-${String(width)}x${String(height)}-details-open`));
          await setPanel("details", false);
        }
        expect(
          detailsOpen.flatMap((frame) => [...overOneRow(frame, false), ...wrappedRangeRows(frame)]),
        ).toEqual([]);
        // And never by covering the sentence about the spectrum. Cutting it
        // short is the rebuilt head's own rule (spec 3.4: the subtitle
        // ellipsizes first), so it is recorded, not failed.
        expect(
          [...defaults, ...detailsOpen]
            .filter((frame) => frame.spectrumHeading !== null && frame.spectrumHeading.covered)
            .map((frame) => `${frame.label} ${JSON.stringify(frame.spectrumHeading)}`),
        ).toEqual([]);
        await metrics(960, 640);
        await frames();
        await setPanel("roster", true);
        await observeViewer(`pm93-g-${locale}-960x640-roster-open`);
        await setPanel("roster", false);
        await setPanel("details", true);
        await observeViewer(`pm93-g-${locale}-960x640-details-open`);
        await setPanel("details", false);

        // The labels are the locale's own; zh-CN is the reference's language.
        evidence.push({ label: `pm93-g-${locale}-labels`, next: locale === "en" ? en.scanNext : zh.scanNext });
        // motion's development build warns that reduced motion is on; this
        // test turned it on in zh-CN, so that notice alone is expected there.
        expect(
          (await unexpectedConsole()).filter(
            (entry) => !(locale === "zh-CN" && entry.includes("You have Reduced Motion enabled on your device")),
          ),
        ).toEqual([]);
      });
    }

    // The whole task at a short window (the known UI rework, UI-49): from the
    // entry state, choose a scan on the chromatogram, then read the whole
    // selected spectrum and reach its row. Recorded for the before-and-after:
    // how far the evidence column scrolls for each, with no plot shrunk.
    for (const locale of ["en", "zh-CN"] as const) {
      it(`PM9.3-T the viewer task at 960x640 and 1366x768 in ${locale}`, async () => {
        const task = [];
        await installIpcBoundary(answers({ locale }));
        for (const [width, height] of [
          [960, 640],
          [1366, 768],
        ] as const) {
          await metrics(width, height);
          await browser.url("/");
          await browser.$(".workbench-header").waitForDisplayed();
          await answerBySource();
          await view(MZML_ROW.handle);
          await frames();
          await clickPlot(PLOT, 2 / 7);
          await waitForReads(1);
          await browser.$(SPECTRUM_PLOT).waitForExist();
          await settled(`pm93-t-${locale}-${String(width)}`);
          await frames();
          const measured = await browser.execute((scans: string) => {
            const evidence = document.querySelector<HTMLElement>("#workbench-evidence")!;
            evidence.scrollTop = 0;
            const bottom = () => evidence.getBoundingClientRect().bottom;
            const chromatogram = document.querySelector("svg.chromatogram-svg")!.getBoundingClientRect();
            const plot = () => document.querySelector("svg.spectrum-plot")!.getBoundingClientRect();
            const atEntry = { plotTop: plot().top, plotHeight: plot().height, onScreen: Math.max(0, Math.min(plot().bottom, bottom()) - plot().top) };
            // Scroll until the whole spectrum plot is on screen.
            const toWholePlot = Math.max(0, plot().bottom - bottom());
            evidence.scrollTop = toWholePlot;
            const row = document.querySelector(`${scans} [aria-selected="true"]`)!.getBoundingClientRect();
            const toRow = Math.max(0, row.bottom - bottom());
            evidence.scrollTop = 0;
            return {
              chromatogramWhole: chromatogram.top >= 0 && chromatogram.bottom <= bottom(),
              atEntry,
              toWholePlot,
              toRowAfterPlot: toRow,
              scrollRange: evidence.scrollHeight - evidence.clientHeight,
            };
          }, SCANS);
          task.push({ label: `pm93-t-${locale}-${String(width)}x${String(height)}`, ...measured });
          // The contracts the task rests on: the chromatogram whole at the
          // column's top and the selected spectrum beginning inside the window
          // (M7.3), never shrunk below its floor. The rebuild replaced the
          // spectrum's fixed 220 px with a height that fills its box above a
          // 160 px minimum (spec 3.1). The distances are recorded, not asserted.
          expect(measured.chromatogramWhole).toBe(true);
          expect(measured.atEntry.plotTop).toBeLessThan(height);
          expect(measured.atEntry.plotHeight).toBeGreaterThanOrEqual(160);
        }
        evidence.push({ label: `pm93-t-${locale}`, kind: "Observation only.", candidate: process.env["MSCANVAS_PM9_CANDIDATE"] ?? "unlabelled", task });
        expect(await unexpectedConsole()).toEqual([]);
      });
    }

    // Baseline §12's coverage gap: every rendered range came from short fixture
    // values. PM9.3-G's state with values of a real run's size at the
    // intermediate evidence columns, then with a pending retention-time band: a
    // settled committed line keeps its numbers for announcement only, so a long
    // retention time reaches a range row only while a band is pending. Held
    // here: range rows in plot boxes from 690 px (UI-32), pending bands,
    // long values and the lines' integrity. G's toolbar, heading and unit
    // checks do not depend on the values and are not repeated. The captions
    // (UI-26) and the chromatogram's context line left with the rebuild (spec
    // 3.4).
    for (const locale of ["en", "zh-CN"] as const) {
      it(`PM9.3-L long range values at the intermediate widths in ${locale}`, async () => {
        type Frame = Awaited<ReturnType<typeof observeViewer>> & { readonly integrity: string[] };
        const LONG_RANGE = /\d{4}\.\d{4} (?:to|至) \d{4}\.\d{4}$/u;
        const sweep = async (phase: string): Promise<Frame[]> => {
          const measured: Frame[] = [];
          for (const [width, height, details] of [
            [1366, 768, true],
            [1280, 800, true],
            [1152, 720, false],
            [1152, 720, true],
            [960, 640, false],
          ] as const) {
            await metrics(width, height);
            if (details) await setPanel("details", true);
            else await frames();
            const frame = await observeViewer(
              `pm93-l-${locale}-${phase}-${String(width)}x${String(height)}${details ? "-details-open" : ""}`,
            );
            measured.push({ ...frame, integrity: await rangeIntegrity() });
            if (details) await setPanel("details", false);
          }
          evidence.push({
            label: `pm93-l-${locale}-${phase}`,
            frames: measured.map((frame) => ({
              label: frame.label,
              column: frame.evidence?.width ?? null,
              rangeRows: frame.rangeRows,
              rangeTexts: frame.rangeTexts,
              integrity: frame.integrity,
            })),
          });
          return measured;
        };
        const problems = (list: readonly Frame[], pending: number) =>
          list.flatMap((frame) => [
            ...(frame.lang === locale ? [] : [`${frame.label} lang ${frame.lang}`]),
            ...(frame.pendingActions === pending ? [] : [`${frame.label} ${String(frame.pendingActions)} pending bands`]),
            ...wrappedRangeRows(frame),
            ...frame.rangeTexts.filter((text) => !LONG_RANGE.test(text)).map((text) => `${frame.label} not long: ${text}`),
            ...frame.integrity.map((problem) => `${frame.label} ${problem}`),
          ]);

        await metrics(1920, 1080);
        await open({ locale, long: true });
        await activateRow(2);
        await waitForReads(1);
        await browser.$(CHROMATOGRAM).scrollIntoView({ block: "nearest" });
        await drag(PLOT, 0.2, 0.8);
        await browser.$(`${RT_PANEL} .plot-pending-actions`).waitForDisplayed();
        await browser.$(`${RT_PANEL} .plot-pending-actions button:nth-child(1)`).click();
        await browser.$(`${RT_PANEL} .plot-pending-actions`).waitForExist({ reverse: true });
        await browser.$(SPECTRUM_PLOT).scrollIntoView({ block: "nearest" });
        await drag(SPECTRUM_PLOT, 0.2, 0.6);
        await browser.$(`${MZ_PANEL} .plot-pending-actions`).waitForDisplayed();
        await browser.execute(() => document.querySelector<HTMLElement>("#workbench-evidence")?.scrollTo({ top: 0 }));

        // Phase 1: a committed retention-time range and a pending m/z band.
        const committed = problems(await sweep("committed-rt"), 1);

        // Phase 2: a band drawn inside the committed range, left pending.
        await metrics(1920, 1080);
        await frames();
        await browser.$(CHROMATOGRAM).scrollIntoView({ block: "nearest" });
        await drag(PLOT, 0.3, 0.7);
        await browser.$(`${RT_PANEL} .plot-pending-actions`).waitForDisplayed();
        await browser.execute(() => document.querySelector<HTMLElement>("#workbench-evidence")?.scrollTo({ top: 0 }));
        const pending = problems(await sweep("pending-rt"), 2);

        expect({ committed, pending }).toEqual({ committed: [], pending: [] });
        expect(await unexpectedConsole()).toEqual([]);
      });
    }
  });
});
