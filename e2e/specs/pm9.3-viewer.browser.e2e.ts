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
const EXPORT_PANEL = "#chromatogram-export-panel";

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

function answers(options: { readonly refusedViewport?: boolean; readonly locale?: "en" | "zh-CN" } = {}) {
  const table: Record<string, unknown> = ipcTable({ refusedViewport: options.refusedViewport === true });
  table.open_mzml_preview = eightScans();
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
async function answerBySource() {
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
    SPECTRUM,
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
  if (options.refusedViewport !== true) await answerBySource();
  await view(MZML_ROW.handle);
}

/** A header destination, by its visible name. */
async function navigate(names: readonly string[]) {
  await browser.execute((labels: readonly string[]) => {
    [...document.querySelectorAll<HTMLButtonElement>(".workbench-navigation > button")]
      .find((button) => labels.includes(button.textContent ?? ""))
      ?.click();
  }, names);
}

function row(index: number) {
  return `${SCANS} [data-source-index="${String(index)}"]`;
}

/** A real click on one ordinary cell of a scan row, as M7.3 activates rows. */
async function activateRow(index: number) {
  await browser.$(SCANS).scrollIntoView({ block: "start" });
  await browser.$(`${row(index)} [role="gridcell"]:nth-child(5)`).click();
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
    committed: text.startsWith(prefix(en.rangeCommitted)),
    low: Number(low),
    high: Number(high),
  };
}

/** Chooses one scope radio by script: which scope is chosen is the subject, not how. */
async function chooseScope(name: "chromatogram-range-scope" | "spectrum-range-scope", scope: "full" | "current") {
  await browser.execute(
    (group: string, value: string) =>
      document.querySelector<HTMLInputElement>(`input[name="${group}"][value="${value}"]`)?.click(),
    name,
    scope,
  );
}

function checkedScope(name: string): Promise<string | null> {
  return browser.execute(
    (group: string) => document.querySelector<HTMLInputElement>(`input[name="${group}"]:checked`)?.value ?? null,
    name,
  ) as Promise<string | null>;
}

async function openChromatogramExport() {
  if ((await browser.$("#chromatogram-export-toggle").getAttribute("aria-expanded")) !== "true") {
    await browser.$("#chromatogram-export-toggle").click();
  }
  await browser.$(EXPORT_PANEL).waitForExist();
}

async function openSpectrumExport() {
  const disclosure = `${MZ_PANEL} .spectrum-export-disclosure`;
  if ((await browser.$(disclosure).getAttribute("open")) === null) {
    await browser.$(`${disclosure} summary`).click();
  }
  await browser.$(`${MZ_PANEL} .spectrum-data-actions`).waitForExist();
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

/** Waits for the one scientific export lane to be free again. */
async function laneFree() {
  await browser.waitUntil(
    () =>
      browser.execute(
        () =>
          [...document.querySelectorAll<HTMLButtonElement>(".spectrum-data-actions button, #chromatogram-export-panel button")].every(
            (button) => button.getAttribute("aria-disabled") !== "true",
          ),
      ),
    { timeout: 15_000, timeoutMsg: "the export lane stayed busy" },
  );
  await frames();
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
    // rather than by top edge, so a label over its input and a 32px summary
    // beside it are one row, and a heading counts, so actions that drop below
    // it as a whole are a second row.
    const rows = (css: string) => {
      const node = document.querySelector(css);
      if (node === null || node.getClientRects().length === 0) return null;
      const boxes = [...node.querySelectorAll("h2, button, label, summary, .plot-committed-range")]
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
      toolbars: {
        chromatogramHeader: rows(".chromatogram-panel > .panel-header"),
        chromatogramControls: rows(".chromatogram-body > .chromatogram-controls"),
        spectrumHeader: rows(".spectrum-panel > .panel-header"),
        spectrumViewport: rows(".spectrum-viewport-actions"),
        scansHeader: rows(".spectrum-table-panel > .panel-header"),
        scanViewControls: rows(".scan-view-controls"),
      },
      rangeRows: {
        chromatogram: rows(".chromatogram-panel .plot-range-actions"),
        spectrum: rows(".spectrum-panel .plot-range-actions"),
      },
      reach: {
        spectrumHeader: reach(".spectrum-panel > .panel-header"),
        spectrumViewport: reach(".spectrum-viewport-actions"),
        scanSteps: reach(".spectrum-scan-steps"),
        tableHeader: reach(".spectrum-table-head"),
        firstRow: reach('.spectrum-table-panel [data-row-position="0"]'),
      },
      documentOverflowY: document.documentElement.scrollHeight - innerHeight,
      // The known UI rework (baseline §12). Each quick-action caption: on how
      // many lines its figure size sits (UI-26).
      captions: [...document.querySelectorAll(".figure-quick-context")]
        .filter((node) => node.getClientRects().length > 0)
        .map((node) => {
          const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
          for (let text = walker.nextNode(); text !== null; text = walker.nextNode()) {
            const match = /\d+\s×\s\d+\spx/u.exec(text.textContent ?? "");
            if (match === null) continue;
            const range = document.createRange();
            range.setStart(text, match.index);
            range.setEnd(text, match.index + match[0].length);
            return { text: node.textContent, sizeLines: new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size };
          }
          return { text: node.textContent, sizeLines: null };
        }),
      // The m/z controls' pill against the column it sits in (UI-30).
      mzPill: (() => {
        const pill = document.querySelector(".spectrum-viewport-actions");
        if (pill === null || pill.parentElement === null || pill.getClientRects().length === 0) return null;
        return { width: pill.getBoundingClientRect().width, column: pill.parentElement.getBoundingClientRect().width };
      })(),
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
      // Whether the selected spectrum's heading block, whole, and its controls,
      // in one line, fit its header side by side (UI-28: "one row where the
      // controls fit"). Measured by laying each out at that size and back.
      spectrumControlsFit: (() => {
        const header = document.querySelector<HTMLElement>(".spectrum-panel > .panel-header");
        const heading = header?.querySelector<HTMLElement>(":scope > div");
        const actions = header?.querySelector<HTMLElement>(":scope > .spectrum-export-header-actions");
        if (!header || !heading || !actions) return null;
        const at = (node: HTMLElement, width: string) => {
          const saved = [node.style.flex, node.style.width];
          node.style.flex = "none";
          node.style.width = width;
          const measured = node.getBoundingClientRect().width;
          [node.style.flex, node.style.width] = saved as [string, string];
          return measured;
        };
        const style = getComputedStyle(header);
        const room = header.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        return at(heading, "max-content") + parseFloat(style.columnGap) + at(actions, "min-content") <= room + 0.5;
      })(),
      // The sentence about the selected spectrum, whole and uncovered by its
      // header's controls (UI-28).
      spectrumHeading: (() => {
        const heading = document.querySelector<HTMLElement>(".spectrum-panel > .panel-header > div:not(.spectrum-export-header-actions)");
        const actions = document.querySelector<HTMLElement>(".spectrum-panel > .panel-header > .spectrum-export-header-actions");
        const summary = heading?.querySelector<HTMLElement>("p");
        if (!heading || !actions || !summary || summary.getClientRects().length === 0) return null;
        const text = heading.getBoundingClientRect();
        const covered = [...actions.querySelectorAll<HTMLElement>("button, summary, .figure-quick-context")]
          .filter((node) => node.getClientRects().length > 0)
          .map((node) => node.getBoundingClientRect())
          .some((box) => box.left < text.right - 1 && box.right > text.left + 1 && box.top < text.bottom - 1 && box.bottom > text.top + 1);
        return { cut: summary.scrollWidth > summary.clientWidth + 1, covered };
      })(),
      // Which acquisition the evidence belongs to, where the shell names it
      // (ADR 0006's Run identity; PM9.2's context line).
      identity: (() => {
        const item = document.querySelector<HTMLElement>('[data-shell-context="viewing"]');
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
      exportEntries: [...document.querySelectorAll(".figure-quick-actions button, #chromatogram-export-toggle, .spectrum-export-disclosure summary")].map(
        (node) => (node.textContent ?? "").trim(),
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

      await browser.$(SCANS).$(`button=${en.scanNext}`).click();
      await waitForReads(2);
      await expectSelected(4);

      await browser.$(SCANS).$(`button=${en.scanPrevious}`).click();
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

      // Sort by total ion current, descending.
      await browser.$(SCANS).$(`button*=${en.scanTotalIonCurrent}`).click();
      await browser.$(SCANS).$(`button*=${en.scanTotalIonCurrent}`).click();
      expect(await browser.$(`${SCANS} [aria-sort="descending"]`).getText()).toContain(en.scanTotalIonCurrent);

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
      expect(await browser.$(SCANS).$(`button=${en.scanNext}`).isEnabled()).toBe(false);
      expect(await browser.$(SCANS).$(`button=${en.scanPrevious}`).isEnabled()).toBe(false);
      expect((await shownSelection()).summary).toMatch(/^Spectrum 3,/u);
      // Nothing else was chosen for the reader, and nothing was read.
      expect((await spectrumReads()).length).toBe(reads);

      // The one recovery path: clear the filters, which keeps the sort.
      await browser.$(SCANS).$(`button=${en.scanReveal}`).click();
      await browser.$(`${row(3)}[aria-selected="true"]`).waitForDisplayed();
      await browser.$(SCANS).$(`button=${en.scanNext}`).click();
      await waitForReads(reads + 1);
      // Next in the displayed, still-sorted order: 3 is followed by 2.
      await expectSelected(2);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("PM9.3-V3 exports the committed range, never a pending one, over Current range", async () => {
      await metrics(1920, 1080);
      await open();
      await openChromatogramExport();
      await chooseScope("chromatogram-range-scope", "current");
      const before = countOf(await ipcCalls(), "begin_chromatogram_export");

      // A released drag is a proposal, not a decision.
      await browser.$(CHROMATOGRAM).scrollIntoView({ block: "nearest" });
      await drag(PLOT, 0.2, 0.7);
      await browser.$(`${RT_PANEL} .plot-pending-actions`).waitForDisplayed();
      expect((await rangeLine(RT_PANEL)).pending).toBe(true);

      await press(EXPORT_PANEL, fill(en.viewerExportFormat, { name: "CSV" }));
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
      await open();
      await openChromatogramExport();
      await chooseScope("chromatogram-range-scope", "current");

      await browser.$(CHROMATOGRAM).scrollIntoView({ block: "nearest" });
      await drag(PLOT, 0.2, 0.7);
      await browser.$(`${RT_PANEL} .plot-pending-actions`).waitForDisplayed();
      // Confirm by the band's own action ("Zoom to selection").
      await browser.$(`${RT_PANEL} .plot-pending-actions button:nth-child(1)`).click();
      await browser.$(`${RT_PANEL} .plot-pending-actions`).waitForExist({ reverse: true });
      const line = await rangeLine(RT_PANEL);
      expect(line.committed).toBe(true);
      // The exact bounds are the export note's: the line under the plot shows
      // them at the plot's own four decimals (the known UI rework, UI-31).
      const note = await textOf(`${EXPORT_PANEL} .chromatogram-export-range .chromatogram-export-note`);
      const [, low, high] = /(-?[\d.]+(?:e[-+]?\d+)?) to (-?[\d.]+(?:e[-+]?\d+)?)/u.exec(note) ?? [];
      const committed = { low: Number(low), high: Number(high) };
      expect(committed.low).toBeLessThan(committed.high);
      // The panel offers exactly what it will send, and the line says the same range.
      expect(note).toBe(fill(en.viewerExportRtHelp, { low: String(committed.low), high: String(committed.high) }));
      expect(line.low).toBeCloseTo(committed.low, 3);
      expect(line.high).toBeCloseTo(committed.high, 3);

      const before = countOf(await ipcCalls(), "begin_chromatogram_export");
      await press(EXPORT_PANEL, fill(en.viewerExportFormat, { name: "CSV" }));
      const current = (await lastRequest("begin_chromatogram_export", before))["range"] as Record<string, unknown>;
      expect(current["scope"]).toBe("current");
      expect(Number(current["low"])).toBeCloseTo(committed.low, 6);
      expect(Number(current["high"])).toBeCloseTo(committed.high, 6);
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
      await press(EXPORT_PANEL, fill(en.viewerExportFormat, { name: "CSV" }));
      const kept = (await lastRequest("begin_chromatogram_export", overPending))["range"] as Record<string, unknown>;
      expect(kept["scope"]).toBe("current");
      expect(Number(kept["low"])).toBeCloseTo(committed.low, 6);
      expect(Number(kept["high"])).toBeCloseTo(committed.high, 6);
      await laneFree();
      await browser.$(`${RT_PANEL} .plot-pending-actions button:nth-child(2)`).click();
      await browser.$(`${RT_PANEL} .plot-pending-actions`).waitForExist({ reverse: true });

      await chooseScope("chromatogram-range-scope", "full");
      const full = countOf(await ipcCalls(), "begin_chromatogram_export");
      await press(EXPORT_PANEL, fill(en.viewerExportFormat, { name: "CSV" }));
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

      await browser.$(RT_PANEL).$(`button=${en.viewerZoomIn}`).click();
      await browser.$(RT_PANEL).$(`button=${en.viewerZoomOut}`).click();
      await browser.$(RT_PANEL).$(`button=${en.viewerReset}`).click();
      const at = await point(PLOT, 0.5);
      await browser.action("wheel").scroll({ x: at.x, y: at.y, deltaY: -300 }).perform();
      await drag(PLOT, 0.3, 0.6);
      await browser.$(`${RT_PANEL} .plot-pending-actions`).waitForDisplayed();
      await browser.$(`${RT_PANEL} .plot-pending-actions button:nth-child(2)`).click();

      await browser.$(SPECTRUM_PLOT).scrollIntoView({ block: "nearest" });
      await browser.$(MZ_PANEL).$(`button=${en.viewerMzZoomIn}`).click();
      await browser.waitUntil(async () => !(await mzCaption()).includes(en.viewerFullRange.trim()), {
        timeout: 15_000,
        timeoutMsg: "Zoom in m/z never committed",
      });
      await browser.$(MZ_PANEL).$(`button=${en.viewerMzReset}`).click();
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
      await browser.$(MZ_PANEL).$(`button=${en.viewerMzZoomIn}`).click();
      await browser.waitUntil(async () => !(await mzCaption()).includes(en.viewerFullRange.trim()), {
        timeout: 15_000,
        timeoutMsg: "Zoom in m/z never committed",
      });
      await openSpectrumExport();
      await chooseScope("spectrum-range-scope", "current");
      await frames();
      const zoomed = await mzCaption();
      const calls = await ipcCalls();

      // Around the shell and back: the same spectrum, the same token, the same view.
      await navigate([en.conversionTask]);
      await navigate([en.projectSurface]);
      await navigate([en.workbench]);
      expect(await mzCaption()).toBe(zoomed);
      expect(await checkedScope("spectrum-range-scope")).toBe("current");
      const trip = (await ipcCalls()).slice(calls.length);
      evidence.push({ label: "pm93-v6-trip-requests", commands: trip.map((call) => call.command) });
      expect(viewerReads(trip)).toBe(0);

      // Another spectrum is another viewport context (ADR 0038) and another
      // export context (ADR 0040): the view opens full and the scope at Full.
      await browser.$(SCANS).$(`button=${en.scanNext}`).click();
      await waitForReads(2);
      await expectSelected(2);
      await browser.waitUntil(async () => (await mzCaption()).includes(en.viewerFullRange.trim()), {
        timeout: 15_000,
        timeoutMsg: "the next spectrum kept the previous m/z window",
      });
      expect(await checkedScope("spectrum-range-scope")).toBe("full");
      expect(await unexpectedConsole()).toEqual([]);
    });

    it("PM9.3-V7 refuses an unordered m/z domain honestly and keeps the full-source data export", async () => {
      await metrics(1920, 1080);
      await open({ refusedViewport: true });
      await selectTheSpectrum(0);

      // The viewport says it cannot navigate, and why, and offers nothing that would.
      expect(await mzCaption()).toBe(en.viewerMzNoRange);
      expect((await textOf(SPECTRUM_STATUS)).startsWith(en.viewerMzRefused)).toBe(true);
      for (const label of [en.viewerMzZoomIn, en.viewerMzZoomOut, en.viewerMzReset]) {
        expect(await browser.$(MZ_PANEL).$(`button=${label}`).isEnabled()).toBe(false);
      }

      // Export: no Current range to choose, and the data export stays.
      await openSpectrumExport();
      expect(await browser.$(`${MZ_PANEL} input[name="spectrum-range-scope"]`).isExisting()).toBe(false);
      expect(await textOf(`${MZ_PANEL} .spectrum-export-range .chromatogram-export-note`)).toBe(
        en.viewerExportNoViewport,
      );
      const before = countOf(await ipcCalls(), "begin_selected_spectrum_export");
      await press(`${MZ_PANEL} .spectrum-data-actions`, fill(en.viewerExportFormat, { name: "CSV" }));
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
      await openChromatogramExport();
      await openSpectrumExport();

      const labels = await browser.execute(() => {
        const names = (css: string) =>
          [...document.querySelectorAll<HTMLButtonElement>(`${css} button`)].map((button) => (button.textContent ?? "").trim());
        return {
          spectrumFigure: names(".spectrum-panel .spectrum-figure-actions"),
          spectrumData: names(".spectrum-panel .spectrum-data-actions"),
          chromatogram: names("#chromatogram-export-panel"),
          linked: names("#chromatogram-linked-section"),
        };
      });
      evidence.push({ label: "pm93-v8-labels", ...labels });
      const svg = fill(en.viewerExportFormat, { name: "SVG" });
      const png = fill(en.viewerExportFormat, { name: "PNG" });
      const csv = fill(en.viewerExportFormat, { name: "CSV" });
      const tsv = fill(en.viewerExportFormat, { name: "TSV" });
      // A spectrum's figure and its data are separate groups.
      expect(labels.spectrumFigure).toEqual([svg, png, en.viewerCopy]);
      expect(labels.spectrumData).toEqual([csv, tsv]);
      // The linked figure is a figure only: it has no data export.
      expect(labels.linked).not.toContain(csv);
      expect(labels.linked).not.toContain(tsv);

      // Each action sends its own command and its own format.
      const chromatogram = countOf(await ipcCalls(), "begin_chromatogram_export");
      await press(EXPORT_PANEL, tsv);
      expect((await lastRequest("begin_chromatogram_export", chromatogram))["format"]).toBe("tsv");
      await laneFree();

      const spectrum = countOf(await ipcCalls(), "begin_selected_spectrum_export");
      await press(`${MZ_PANEL} .spectrum-figure-actions`, png);
      expect((await lastRequest("begin_selected_spectrum_export", spectrum))["format"]).toBe("png");
      await laneFree();

      const linked = countOf(await ipcCalls(), "begin_linked_figure_export");
      await press("#chromatogram-linked-section", fill(en.viewerLinkedExport, { name: "SVG" }));
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
      await openChromatogramExport();
      await chooseScope("chromatogram-range-scope", "current");
      await browser.$("#chromatogram-widthPx").setValue("1000");
      await frames();

      const held = async () => ({
        selection: await shownSelection(),
        rt: await rangeLine(RT_PANEL),
        mz: await mzCaption(),
        search: await browser.$(`${SCANS} input[type="search"]`).getValue(),
        scope: await checkedScope("chromatogram-range-scope"),
        width: await browser.$("#chromatogram-widthPx").getValue(),
      });
      const before = await held();
      const calls = await ipcCalls();

      await navigate([en.conversionTask]);
      await navigate([en.projectSurface]);
      await navigate([en.workbench]);
      // Surfaces stay mounted: the owners still hold what they held.
      expect(await held()).toEqual(before);
      const trip = (await ipcCalls()).slice(calls.length);
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
      // Recorded, not asserted: whether the run scope, the table's search and
      // the figure draft follow the new preview is not a documented contract.
      evidence.push({
        label: "pm93-v9-after-new-preview",
        scope: await checkedScope("chromatogram-range-scope"),
        search: await browser.$(`${SCANS} input[type="search"]`).getValue(),
        width: await browser.$("#chromatogram-widthPx").isExisting() ? await browser.$("#chromatogram-widthPx").getValue() : null,
      });
      expect(countOf(await ipcCalls(), "open_mzml_preview")).toBe(2);
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
        // The selected spectrum's header is held to one row where its controls
        // fit beside the heading, and to heading plus one row of controls where
        // they do not (UI-28).
        const overOneRow = (frame: (typeof defaults)[number], withRangeRows: boolean) =>
          Object.entries({ ...frame.toolbars, ...(withRangeRows ? frame.rangeRows : {}) })
            .filter(([name, toolbar]) => toolbar !== null && toolbar.rows > (name === "spectrumHeader" && frame.spectrumControlsFit === false ? 2 : 1))
            .map(([name, toolbar]) => `${frame.label} ${name} ${String(toolbar?.rows)}`);
        const wrapped = defaults.flatMap((frame) => overOneRow(frame, true));
        expect(wrapped).toEqual([]);

        // The rest of the known UI rework on the default frames (baseline §12):
        // the figure size never split (UI-26); the m/z pill as wide as its
        // controls, not the column (UI-30); range lines at the plot's own
        // precision (UI-31); the missing unit said once per axis, and still in
        // the plot's description (UI-33); no committed-range numbers before a
        // range is committed (UI-31).
        const rework = defaults.flatMap((frame) => [
          ...frame.captions.filter((caption) => caption.sizeLines !== 1).map((caption) => `${frame.label} caption ${String(caption.text)}`),
          ...(frame.mzPill !== null && frame.mzPill.width > frame.mzPill.column - 8 ? [`${frame.label} m/z pill spans its column`] : []),
          ...frame.rangeTexts.filter((text) => /\d\.\d{5,}/u.test(text)).map((text) => `${frame.label} raw digits: ${text}`),
          ...(frame.chromatogramUnits !== null && frame.chromatogramUnits !== 2 ? [`${frame.label} unit caveat ${String(frame.chromatogramUnits)} times`] : []),
          ...(/unit not reported|单位未报告/u.test(frame.plotDescription) ? [] : [`${frame.label} plot description without the unit caveat`]),
          // Settled, the committed range is the one the caption prints: the
          // line says so and does not repeat its numbers (dispatch item 5).
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
        // the one-column swap at the narrow anchor. Since the known UI rework
        // (UI-27, UI-28, UI-29) the chromatogram header stays one row down to
        // the 571 px column of 1152x720. The spectrum header does too wherever
        // its heading and controls fit side by side; where they do not (en at
        // 1152x720) it takes the heading plus one row of controls. The lines
        // under the plots count from 699 px.
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
          detailsOpen.flatMap((frame) => overOneRow(frame, (frame.evidence?.width ?? 0) >= 690)),
        ).toEqual([]);
        // And never by cutting or covering the sentence about the spectrum.
        expect(
          [...defaults, ...detailsOpen]
            .filter((frame) => frame.spectrumHeading !== null && (frame.spectrumHeading.cut || frame.spectrumHeading.covered))
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
          // (M7.3). The distances are recorded, not asserted.
          expect(measured.chromatogramWhole).toBe(true);
          expect(measured.atEntry.plotTop).toBeLessThan(height);
          expect(measured.atEntry.plotHeight).toBeGreaterThanOrEqual(219);
        }
        evidence.push({ label: `pm93-t-${locale}`, kind: "Observation only.", candidate: process.env["MSCANVAS_PM9_CANDIDATE"] ?? "unlabelled", task });
        expect(await unexpectedConsole()).toEqual([]);
      });
    }
  });
});
