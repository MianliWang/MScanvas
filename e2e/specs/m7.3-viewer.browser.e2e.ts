/** Production viewer; deterministic synthetic source responses at the existing IPC boundary only. */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildPreview, buildSpectrum, secondFile, selectedFile } from "../../apps/desktop/src/test/previewFixtures";
import { en } from "../../apps/desktop/src/features/preferences/locales/en";
import { zhCN } from "../../apps/desktop/src/features/preferences/locales/zh-CN";
import { ipcTable } from "../support/fixtures";
import { PLOT_BAND, PLOT_VIEWBOX_WIDTH, readBackSavedPreferences, revealRosterRow, seedARunOf, SPECTRUM_BAND } from "../support/viewer";
import { choosePlotMenuItem, FIGURE_DIALOG, openFigureDialog } from "../support/figure";
import { installIpcBoundary, IPC_TABLE_KEY, ipcCalls, consoleEntries, holdInvoke, heldCallers, releaseInvokeHold, setInvokeResult, setInvokeRejection } from "../support/harness";

const RT = "svg.chromatogram-svg";
const MZ = "svg.spectrum-plot";
const SCANS = ".spectrum-table-panel";
const row = (index: number) => SCANS + ' [data-source-index="' + index + '"]';
/**
 * Brings the scan table to the top of its scroller with the DOM's own
 * scrollIntoView. WebdriverIO 9.32's element scrollIntoView is a wheel action
 * whose origin is the element, so over the table it scrolls the table's own
 * viewport instead, and the first rows are windowed away (CI, 2026-10-30).
 */
async function revealScans() {
  await browser.execute((css: string) => document.querySelector(css)?.scrollIntoView({ block: "start" }), SCANS);
}
let output = "";
const evidence: unknown[] = [];

async function cdp(cmd: string, params: Record<string, unknown>) {
  const { hostname = "127.0.0.1", port, path = "/", protocol = "http" } = browser.options;
  if (port === undefined) throw Error("Owned ChromeDriver port missing");
  const root = protocol + "://" + hostname + ":" + port + (path.endsWith("/") ? path : path + "/");
  const response = await fetch(new URL("session/" + browser.sessionId + "/goog/cdp/execute", root), {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cmd, params }),
  });
  const result = await response.json() as { value?: Record<string, unknown> };
  if (!response.ok || result.value?.error) throw Error(JSON.stringify(result));
  return result.value ?? {};
}
async function metrics(width: number, height: number, dpr: number) {
  await cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
  await browser.waitUntil(() => browser.execute((w, h, s) => innerWidth === w && innerHeight === h && devicePixelRatio === s, width, height, dpr));
}
async function preferences(language: "en" | "zh-CN", density: "comfortable" | "compact") {
  // Settings saves the choice and the shell adopts what the save confirms.
  await readBackSavedPreferences();
  await browser.$("[data-settings-entry]").click();
  await browser.$('[data-settings-dialog] [role="radio"]:has([data-setting-value="' + language + '"])').click();
  await browser.$('[data-settings-dialog] [role="radio"]:has([data-setting-value="' + density + '"])').click();
  await browser.$("[data-settings-close]").click();
  await browser.$("[data-settings-dialog]").waitForExist({ reverse: true });
}
function answers(kind: "complete" | "ms2" | "prefix" | "empty" | "refused" | "one" | "large-values" | "mixed" | "minutes" | "narrow" = "complete") {
  const table: Record<string, unknown> = ipcTable({ emptySpectrum: kind === "empty", refusedViewport: kind === "refused", oneMzViewport: kind === "one" });
  const preview = buildPreview(8);
  preview.spectrumTable.rows.forEach((row, index) => Object.assign(row, {
    identifier: (index === 3 || index === 7 ? "rare-" : "raw-") + index + "-原始标识符_controllerType=0_controllerNumber=1_scan=" + (index + 1),
    retentionTime: { value: index, unit: "notReported" }, msLevel: index % 2 + 1,
    totalIonCurrent: (index + 1) * 10,
  }));
  Object.assign(preview.runSummary, { retentionTimeRange: { state: "reported", minimum: 0, maximum: 7, unit: "notReported" },
    msLevels: [{ msLevel: 1, spectrumCount: 4 }, { msLevel: 2, spectrumCount: 4 }] });
  if (kind === "large-values") preview.spectrumTable.rows.forEach((row, index) => {
    Object.assign(row, { totalIonCurrent: index === 0 ? -1e12 : (index + 1) * 1e12 });
  });
  if (kind === "ms2") preview.spectrumTable.rows.forEach(row => Object.assign(row, { msLevel: 2 }));
  if (kind === "prefix") {
    Object.assign(preview.spectrumTable, { truncated: true, totalRowCount: 120000 });
    Object.assign(preview.runSummary, { totalSpectrumCount: 120000 });
  }
  if (kind === "mixed") {
    // Half the scans declare minutes and half seconds (ADR 0056): Rust gives no
    // range and no chromatogram token, and nothing converts one to the other.
    preview.spectrumTable.rows.forEach((row, index) => Object.assign(row, {
      retentionTime: { value: index, unit: index % 2 === 0 ? "minute" : "second" } }));
    Object.assign(preview.runSummary, { retentionTimeRange: { state: "mixedUnits" } });
    Object.assign(preview, { chromatogramExportToken: null });
  }
  if (kind === "minutes") {
    // Every scan declares minutes, as most native mzML does (ADR 0056).
    preview.spectrumTable.rows.forEach((row, index) => Object.assign(row, { retentionTime: { value: index, unit: "minute" } }));
    Object.assign(preview.runSummary, { retentionTimeRange: { state: "reported", minimum: 0, maximum: 7, unit: "minute" } });
  }
  if (kind === "narrow") {
    // Narrow beside its value: every x label is long, and the last is at the plot's right end.
    preview.spectrumTable.rows.forEach((row, index) => Object.assign(row, {
      retentionTime: { value: index === 7 ? 1000.12025 : 1000.12 + index * 0.00003, unit: "notReported" } }));
    Object.assign(preview.runSummary, { retentionTimeRange: { state: "reported", minimum: 1000.12, maximum: 1000.12025, unit: "notReported" } });
  }
  table.open_mzml_preview = preview;
  table.get_workspace_roster = { capacity: 1024, datasets: [selectedFile] };
  table.subscribe_workspace_drop_updates = { reservationId: "browser-m73-reservation" };
  return table;
}
/** The fixture answers requested source indices and exact retained windows, with no production state patch. */
async function sourceBoundary(rtStep = 1, declared: Record<string, unknown> = {}) {
  await browser.execute((tableKey, fixture, step) => {
    const table = Reflect.get(window, tableKey) as Record<string, unknown>;
    const internals = Reflect.get(window, "__TAURI_INTERNALS__") as {
      invoke: (command: string, args: Record<string, unknown>) => Promise<unknown>;
    };
    const invoke = internals.invoke;
    const template = table.load_selected_spectrum as { authority: unknown; outcome: { spectrum: unknown } };
    internals.invoke = (command, args) => {
      if (command === "load_selected_spectrum") {
        const index = Number(args.index);
        table[command] = { authority: template.authority, outcome: { outcome: "spectrum", spectrum: {
          ...fixture, index, exportToken: "m73-spectrum-" + index, retentionTime: { value: index * step, unit: "notReported" },
        } } };
      } else if (command === "project_selected_spectrum") {
        const response = table[command];
        if (response !== null && typeof response === "object" && "__reject" in response) return invoke(command, args);
        const low = Number(args.low), high = Number(args.high);
        const positions = fixture.mz.flatMap((value, index) => value >= low && value <= high ? [index] : []);
        // Rust's rule: a profile projection carries the measured sample beyond each edge.
        const sample = (index: number) => fixture.representation === "profile" && index >= 0 && index < fixture.mz.length
          ? { mz: fixture.mz[index], intensity: fixture.intensity[index] } : null;
        const first = fixture.mz.findIndex(value => value >= low);
        const after = fixture.mz.findIndex(value => value > high);
        table[command] = { low, high, mz: positions.map(index => fixture.mz[index]),
          intensity: positions.map(index => fixture.intensity[index]), sourcePoints: positions.length, reduced: false,
          outsideLow: sample((first < 0 ? fixture.mz.length : first) - 1), outsideHigh: after < 0 ? null : sample(after) };
      }
      return invoke(command, args);
    };
  }, IPC_TABLE_KEY, { ...buildSpectrum(0, 12), mz: Array.from({ length: 12 }, (_, i) => 100 + i * 50),
    intensity: [10, 35, -5, 65, 100, 42, 18, 75, 30, 19, 55, 8], mzLow: 100, mzHigh: 650,
    viewportDomain: { state: "admitted", low: 100, high: 650 }, ...declared }, rtStep);
}
async function open(kind: Parameters<typeof answers>[0] = "complete", options = { width: 1366, height: 768, dpr: 1.5 }, count?: number,
  declared: Record<string, unknown> = {}) {
  await installIpcBoundary(answers(kind));
  await metrics(options.width, options.height, options.dpr);
  await browser.url("/");
  await browser.$('.grouped-roster [data-handle="' + selectedFile.handle + '"]').waitForExist();
  if (count !== undefined) await seedARunOf(count);
  if (kind === "complete" || kind === "ms2" || kind === "prefix" || kind === "narrow") await sourceBoundary(count === undefined ? 1 : .0125, declared);
  const rosterToggle = browser.$('[aria-controls="workbench-roster"]');
  await revealRosterRow(selectedFile.handle);
  await browser.$('.grouped-roster [data-handle="' + selectedFile.handle + '"]').click();
  await browser.$(SCANS).waitForExist();
  if (await rosterToggle.getAttribute("aria-expanded") === "true") await browser.$(".workbench-home").click();
}
async function point(selector: string, fraction: number) {
  return browser.execute((css, part, rt, mzBand, width) => {
    const node = document.querySelector(css)!;
    const box = node.getBoundingClientRect();
    const band = node.classList.contains("spectrum-plot") ? mzBand : rt;
    return { x: Math.round(box.x + box.width * (band.left + band.drawnWidth * part) / width),
      y: Math.round(box.y + box.height * .45) };
  }, selector, fraction, PLOT_BAND, SPECTRUM_BAND, PLOT_VIEWBOX_WIDTH);
}
async function clickPlot(selector: string, fraction: number) {
  await browser.performActions([{ type: "pointer", id: "m73-pointer", parameters: { pointerType: "mouse" }, actions: [
    { type: "pointerMove", duration: 0, origin: "viewport", ...await point(selector, fraction) },
    { type: "pointerDown", button: 0 }, { type: "pointerUp", button: 0 },
  ] }]); await browser.releaseActions();
}
async function drag(selector: string, from: number, to: number, button = 0, release = true) {
  await browser.performActions([{ type: "pointer", id: "m73-pointer", parameters: { pointerType: "mouse" }, actions: [
    { type: "pointerMove", duration: 0, origin: "viewport", ...await point(selector, from) },
    { type: "pointerDown", button },
    { type: "pointerMove", duration: 150, origin: "viewport", ...await point(selector, to) },
    ...(release ? [{ type: "pointerUp" as const, button }] : []),
  ] }]); if (release) await browser.releaseActions();
}
async function scientificCalls() { return (await ipcCalls()).filter(call => ["load_selected_spectrum", "project_selected_spectrum"].includes(call.command)); }
async function capture(label: string) {
  const geometry = await browser.execute(() => {
    const rect = (node: Element) => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    return { css: { width: innerWidth, height: innerHeight }, dpr: devicePixelRatio, language: document.documentElement.lang,
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
      plots: [...document.querySelectorAll("svg.chromatogram-svg, svg.spectrum-plot")].map(node => ({ class: node.getAttribute("class"), ...rect(node),
        labels: [...node.querySelectorAll("text")].filter(node => node.textContent?.trim()).map(label => {
          const matrix = (label as SVGGraphicsElement).getScreenCTM();
          return { text: label.textContent, ...rect(label), font: getComputedStyle(label).fontSize,
            scaleX: matrix?.a, scaleY: matrix?.d };
        }) })),
      sections: [...document.querySelectorAll("#workbench-evidence section.panel")].map(node => ({ class: node.className, ...rect(node) })),
      scroll: [...document.querySelectorAll("#workbench-evidence, .preview-stack, .spectrum-table-viewport")].map(node => ({
        class: node.className, top: node.scrollTop, client: node.clientHeight, total: node.scrollHeight,
      })),
      active: document.activeElement?.outerHTML, reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      external: performance.getEntriesByType("resource").map(entry => entry.name).filter(url => /^https?:/u.test(url) && new URL(url).origin !== location.origin),
    };
  });
  const screen = await cdp("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  if (typeof screen.data !== "string") throw Error("Screenshot bytes missing");
  const png = Buffer.from(screen.data, "base64");
  writeFileSync(join(output, label + ".png"), png);
  evidence.push({ label, attribution: "browser synthetic IPC; WebDriver/CDP input; emulated DPR", ...geometry,
    raster: { width: png.readUInt32BE(16), height: png.readUInt32BE(20) } });
  expect(geometry.horizontalOverflow).toBeLessThanOrEqual(1);
  expect(geometry.external).toEqual([]);
  return geometry;
}
describe("M7.3 viewer, loaded scan projection and committed ranges", () => {
  before(() => { const root = process.env.MSCANVAS_M73_OUTPUT_ROOT ?? resolve("test-results/m7.3"); mkdirSync(root, { recursive: true });
    output = mkdtempSync(join(root, "browser-")); console.log("M7.3 browser evidence: " + output); });
  afterEach(async function () {
    evidence.push({ test: this.currentTest?.title, state: this.currentTest?.state, calls: await ipcCalls(), console: await consoleEntries() });
    if (this.currentTest?.state === "failed") { await capture("failure-" + evidence.length); evidence.push({ body: await browser.execute(() => document.body.innerText) }); }
    writeFileSync(join(output, "evidence.json"), JSON.stringify(evidence, null, 2));
  });
  for (const scenario of [
    { width: 1920, height: 1080, dpr: 1, language: "en", density: "comfortable" },
    { width: 1366, height: 768, dpr: 1.5, language: "zh-CN", density: "compact" },
    { width: 1200, height: 800, dpr: 1.25, language: "en", density: "compact" },
    { width: 960, height: 640, dpr: 2, language: "zh-CN", density: "comfortable" },
  ] as const) it("initial evidence and readable controls at " + scenario.width + "x" + scenario.height, async () => {
    await open("complete", scenario);
    await preferences(scenario.language, scenario.density);
    await capture("entry-" + scenario.width);
    await clickPlot(RT, .4);
    await browser.$(MZ).waitForDisplayed();
    const initial = await capture("selected-" + scenario.width);
    expect(initial.plots[0].y).toBeLessThan(scenario.height);
    expect(initial.plots[1].y).toBeLessThan(scenario.height);
    // Every action in the evidence is a button; nothing is folded behind a disclosure.
    expect(await browser.$("#workbench-evidence details").isExisting()).toBe(false);
    expect(await consoleEntries()).toEqual([]);
  });
  it("uses real full header and row targets, raw search, source identity and loaded-only navigation", async () => {
    await open(); await revealScans();
    const header = browser.$(SCANS + ' [role="columnheader"]:nth-child(2) button');
    // The open selected the MS1 at the apex of the declared TIC (V-1); sorting reads nothing.
    await browser.waitUntil(async () => (await scientificCalls()).some(call => call.command === "load_selected_spectrum"));
    const before = await scientificCalls(); await header.click(); await header.click();
    // The header shows "RT"; its full name is its tooltip and the rest of its name.
    expect(await browser.$(SCANS + ' [aria-sort="descending"]').getText()).toContain("RT");
    expect(await header.getAttribute("title")).toBe("Retention time");
    await browser.$(SCANS + ' input[type="search"]').setValue("rare-");
    expect(await browser.$$(SCANS + " [data-source-index]").map(row => row.getAttribute("data-source-index"))).toEqual(["7", "3"]);
    await browser.$(row(3) + ' [role="gridcell"]:nth-child(3)').click();
    await browser.waitUntil(async () => (await scientificCalls()).some(call => call.command === "load_selected_spectrum" && call.args.index === 3));
    await browser.$(row(7) + ' [role="gridcell"]:nth-child(4)').click();
    await browser.waitUntil(async () => (await scientificCalls()).filter(call => call.command === "load_selected_spectrum").length === 3);
    await browser.keys("End");
    expect(await browser.execute(() => document.activeElement?.getAttribute("data-source-index"))).toBe("3");
    expect((await scientificCalls()).filter(call => call.command === "load_selected_spectrum").map(call => call.args.index)).toEqual([6, 3, 7]);
    await browser.keys("Enter");
    await browser.waitUntil(async () => (await scientificCalls()).filter(call => call.command === "load_selected_spectrum").length === 4);
    expect(before.filter(call => call.command === "load_selected_spectrum").map(call => call.args.index)).toEqual([6]);
    await browser.$(SCANS + ' input[type="search"]').setValue("raw-1");
    expect(await browser.$(SCANS).getText()).toContain("Selected scan 4 is hidden by the filters");
    expect(await browser.$('button[aria-label="Next scan"]').getAttribute("aria-disabled")).toBe("true");
    await capture("hidden-selection");
    await browser.$("button=Clear filters and reveal").click(); await browser.$('button[aria-label="Next scan"]').click();
    await browser.waitUntil(async () => (await scientificCalls()).some(call => call.command === "load_selected_spectrum" && call.args.index === 2));
    expect(await consoleEntries()).toEqual([]);
  });
  it("leaves a real released band pending, confirms by a fresh click once, cancels and preserves source through Settings", async () => {
    await open("complete", { width: 1920, height: 1080, dpr: 1 });
    await clickPlot(RT, .4); await browser.$(MZ).waitForDisplayed();
    const before = await scientificCalls();
    const range = await browser.$("#spectrum-viewport-range").getText();
    await drag(MZ, .2, .7);
    await browser.$('.spectrum-panel .plot-pending-actions').waitForDisplayed();
    await capture("range-01-released-pending");
    expect(await browser.execute(() => window.getSelection()?.toString() ?? "")).toBe("");
    expect(await scientificCalls()).toEqual(before);
    expect(await browser.$("#spectrum-viewport-range").getText()).toBe(range);
    await clickPlot(MZ, .4);
    await browser.$('.spectrum-panel .plot-pending-actions').waitForExist({ reverse: true });
    await browser.waitUntil(async () => (await scientificCalls()).length === before.length + 1);
    await capture("range-02-explicit-confirm");
    await drag(MZ, .2, .7); await browser.$('.spectrum-panel .plot-pending-actions').waitForDisplayed();
    const band = await browser.$('.spectrum-panel .plot-committed-range').getText();
    const noRead = await scientificCalls();
    await preferences("zh-CN", "compact");
    expect(await browser.$('.spectrum-panel .plot-pending-actions').isExisting()).toBe(true);
    expect(await scientificCalls()).toEqual(noRead);
    evidence.push({ beforeLocaleBand: band, afterLocaleBand: await browser.$('.spectrum-panel .plot-committed-range').getText() });
    await browser.$('.spectrum-panel .plot-pending-actions button:nth-child(2)').click();
    expect(await browser.execute(() => document.activeElement?.matches("svg.spectrum-plot"))).toBe(true);
    expect(await scientificCalls()).toEqual(noRead);
    await capture("range-03-cancel-after-settings");
    expect(await consoleEntries()).toEqual([]);
  });
  it("keeps signed exponent labels readable in constrained side-panel geometry", async () => {
    await open("large-values", { width: 1200, height: 800, dpr: 1.25 });
    await browser.$('[aria-controls="workbench-roster"]').click();
    const inspector = browser.$('[aria-controls="workbench-inspector"]');
    if (await inspector.getAttribute("aria-expanded") !== "true") await inspector.click();
    const picture = await capture("large-values-open-panels");
    const plot = picture.plots[0];
    for (const label of plot.labels) {
      expect(label.x).toBeGreaterThanOrEqual(plot.x - 1);
      expect(label.x + label.width).toBeLessThanOrEqual(plot.x + plot.width + 1);
      expect(label.font).toBe("12px");
    }
  });
  it("keeps an x label at a plot's right end whole, at any window and zoom", async () => {
    // Cut by the panel's edge, 1000.12025 would read as 1000.1202: another number.
    const xLabels = (plot: string) => browser.execute((css: string) => [...document.querySelectorAll(css + " .plot-x-ticks .plot-tick")].map(label => label.textContent), plot);
    const outsideTheFrame = () => browser.execute(() => [...document.querySelectorAll(".plot-frame .plot-x-ticks .plot-tick")].flatMap(label => {
      const box = label.getBoundingClientRect(), frame = label.closest(".plot-frame")!.getBoundingClientRect();
      return box.left < frame.left || box.right > frame.right ? [label.textContent + " " + box.left + ".." + box.right + " outside " + frame.left + ".." + frame.right] : [];
    }));
    const mz = [1000.12, 1000.12005, 1000.1201, 1000.12015, 1000.1202, 1000.12025];
    await open("narrow", { width: 1366, height: 768, dpr: 1 }, undefined, { mz, intensity: [10, 40, 20, 80, 30, 60], mzLow: mz[0], mzHigh: mz[5],
      basePeakMz: mz[3], basePeakIntensity: 80, viewportDomain: { state: "admitted", low: mz[0], high: mz[5] } });
    await clickPlot(RT, .4);
    await browser.$(MZ).waitForDisplayed();
    for (const plot of [".chromatogram-plot", ".spectrum-frame"]) expect((await xLabels(plot)).at(-1)).toBe("1000.12025");
    expect(await outsideTheFrame()).toEqual([]);
    // A resize paints nothing: the labels hold by themselves.
    await metrics(960, 640, 1);
    expect(await outsideTheFrame()).toEqual([]);
    await browser.execute((css: string) => document.querySelector<SVGSVGElement>(css)?.focus(), MZ);
    await browser.keys("+");
    await browser.waitUntil(async () => (await xLabels(".spectrum-frame")).at(-1) === "1000.12020");
    expect(await outsideTheFrame()).toEqual([]);
    expect(await consoleEntries()).toEqual([]);
  });
  it("windows the 100000 loaded rows, reaches End without a read and keeps the compact headers over their values", async () => {
    await open("complete", { width: 1200, height: 800, dpr: 1.25 }, 100000);
    await revealScans();
    await browser.$(row(0) + ' [role="gridcell"]:nth-child(4)').click();
    await browser.waitUntil(async () => (await scientificCalls()).some(call => call.command === "load_selected_spectrum"));
    const before = await scientificCalls();
    await browser.keys("End");
    expect(await browser.execute(() => document.activeElement?.getAttribute("data-source-index"))).toBe("99999");
    expect(await scientificCalls()).toEqual(before);
    expect(await browser.$$(SCANS + " [data-source-index]").length).toBeLessThan(40);
    await browser.keys("Enter");
    await browser.waitUntil(async () => (await scientificCalls()).some(call => call.command === "load_selected_spectrum" && call.args.index === 99999));
    await metrics(1366, 768, 1.5);
    // Each toggle is saved, and the shell adopts the layout the save confirms;
    // the shared table's fixed record would fold Details again (PM9.3).
    await readBackSavedPreferences();
    for (const id of ["workbench-roster", "workbench-inspector"]) {
      const toggle = browser.$('[aria-controls="' + id + '"]');
      if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
    }
    await revealScans();
    await browser.execute(() => { document.querySelector(".spectrum-table-viewport")!.scrollLeft = 220; });
    const columns = await browser.execute(() => {
      const box = (node: Element) => { const r = node.getBoundingClientRect(); return { x: r.x, width: r.width }; };
      return { headers: [...document.querySelectorAll('.spectrum-table [role="columnheader"]')].map(box),
        values: [...document.querySelectorAll('.spectrum-table [data-source-index="99999"] [role="gridcell"]')].map(box),
        mounted: document.querySelectorAll('.spectrum-table [data-source-index]').length,
        scrollLeft: document.querySelector('.spectrum-table-viewport')!.scrollLeft };
    });
    evidence.push({ kind: "100000 loaded rows", columns });
    // The compact four columns give ground instead of overflowing, so there is nothing to scroll sideways.
    expect(columns.scrollLeft).toBe(0);
    expect(columns.headers.length).toBe(4);
    columns.headers.forEach((header, index) => {
      expect(Math.abs(header.x - columns.values[index].x)).toBeLessThanOrEqual(1);
      expect(Math.abs(header.width - columns.values[index].width)).toBeLessThanOrEqual(1);
    });
    await capture("loaded-ceiling-end");
  });
  it("states the loaded prefix, no matches and a plot selection outside the MS filter", async () => {
    await open("prefix");
    expect(await browser.$(SCANS).getText()).toContain("8 matches / 8 loaded rows / 120,000 reported spectra");
    expect(await browser.$(RT).isExisting()).toBe(false);
    await browser.$(SCANS + ' input[type="search"]').setValue("absent-scan");
    expect(await browser.$(SCANS).getText()).toContain("No matches in the loaded rows");
    expect(await browser.$(SCANS + ' [role="grid"]').getAttribute("aria-rowcount")).toBe("1");
    expect(await scientificCalls()).toEqual([]); await capture("prefix-no-matches");
    await open("complete", { width: 1920, height: 1080, dpr: 1 });
    await browser.$(SCANS + " select").selectByAttribute("value", "1");
    await browser.$(RT).scrollIntoView({ block: "center" });
    await clickPlot(RT, 3 / 7);
    await browser.$(MZ).waitForDisplayed();
    expect(await browser.$(SCANS).getText()).toContain("Selected scan 4 is hidden by the filters");
    expect(await browser.$(SCANS + " select").getValue()).toBe("1");
    expect(await browser.$('button[aria-label="Next scan"]').getAttribute("aria-disabled")).toBe("true");
    await capture("plot-hidden-by-ms-filter");
  });
  it("distinguishes empty, refused, loading and failed projection, then actually retries", async () => {
    for (const kind of ["empty", "refused"] as const) {
      await open(kind, { width: 1920, height: 1080, dpr: 1 });
      await clickPlot(RT, .3);
      await browser.waitUntil(async () => (await scientificCalls()).some(call => call.command === "load_selected_spectrum"));
      await browser.$("#selected-spectrum-summary").waitForExist();
      // Zero points is said by the summary; the empty state says no extent is inferred.
      if (kind === "empty") {
        expect(await browser.$(".spectrum-panel").getText()).toContain(", 0 points.");
        expect(await browser.$(".spectrum-panel .empty-state").getText()).toContain("No base peak or m/z range is inferred.");
      }
      else { expect(await browser.$(MZ).getAttribute("tabindex")).toBe("-1"); expect(await browser.$("#spectrum-viewport-status").getText()).not.toBe(""); }
      await capture("spectrum-" + kind);
    }
    await open("complete", { width: 1920, height: 1080, dpr: 1 });
    await clickPlot(RT, .3); await browser.$(MZ).waitForDisplayed();
    await holdInvoke("project_selected_spectrum");
    await browser.$('button[aria-label="Zoom in m/z"]').click();
    await browser.waitUntil(async () => await heldCallers("project_selected_spectrum") === 1);
    expect(await browser.$("#spectrum-viewport-status").getText()).toContain("Drawing m/z");
    await capture("projection-loading");
    await releaseInvokeHold("project_selected_spectrum");
    await browser.waitUntil(async () => await browser.$("#spectrum-viewport-status").getText() === "");
    await setInvokeRejection("project_selected_spectrum", { kind: "spectrum_projection_failed",
      summary: "Controlled retained-source refusal.", detail: "M7.3 retry fixture.", retryable: true });
    await browser.$('button[aria-label="Zoom in m/z"]').click();
    await browser.$("button=Redraw").waitForDisplayed();
    expect(await browser.$("#spectrum-viewport-status").getText()).toContain("Controlled retained-source refusal.");
    await capture("projection-failed");
    const count = (await scientificCalls()).length;
    await setInvokeResult("project_selected_spectrum", null);
    await browser.$("button=Redraw").click();
    await browser.waitUntil(async () => (await scientificCalls()).length === count + 1);
    await browser.$("button=Redraw").waitForExist({ reverse: true });
    // The drawing's caption is the plot's description (Details shows it to the eye).
    expect(await browser.$(".spectrum-caption").getProperty("textContent")).toMatch(/sticks? ·/u);
  });
  it("keeps numeric raw text, IME and host keys separate and supports wheel and pan with reduced motion", async () => {
    await open("complete", { width: 1920, height: 1080, dpr: 1 });
    await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await clickPlot(RT, .4); await browser.$(MZ).waitForDisplayed();
    // Set range… is the spectrum's ⋯ menu's first item (direction A).
    await choosePlotMenuItem(".spectrum-panel", "Set range…");
    const low = browser.$("#plot-range-mz-low"), high = browser.$("#plot-range-mz-high");
    await low.setValue("1,00"); await browser.$(".spectrum-panel .plot-range-form button[type=submit]").click();
    expect(await low.getAttribute("aria-invalid")).toBe("true");
    await low.setValue("2e2"); await high.setValue("5.5e2");
    const before = await scientificCalls();
    await browser.execute(() => document.querySelector("#plot-range-mz-low")!.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })));
    await low.click(); await browser.keys("Enter");
    expect(await scientificCalls()).toEqual(before);
    await browser.execute(() => document.querySelector("#plot-range-mz-low")!.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })));
    await browser.$(".spectrum-panel .plot-range-form button[type=submit]").click();
    await browser.waitUntil(async () => (await scientificCalls()).length === before.length + 1);
    const at = await point(MZ, .5), range = await browser.$("#spectrum-viewport-range").getText();
    await cdp("Input.dispatchMouseEvent", { type: "mouseWheel", ...at, deltaX: 0, deltaY: -120 });
    await browser.waitUntil(async () => (await scientificCalls()).length === before.length + 2);
    expect(await browser.$("#spectrum-viewport-range").getText()).not.toBe(range);
    const zoomed = await browser.$("#spectrum-viewport-range").getText();
    await cdp("Input.dispatchMouseEvent", { type: "mouseWheel", ...at, modifiers: 8, deltaX: 0, deltaY: 120 });
    await browser.waitUntil(async () => (await scientificCalls()).length === before.length + 3);
    expect(await browser.$("#spectrum-viewport-range").getText()).not.toBe(zoomed);
    await drag(MZ, .5, .4, 1);
    await browser.waitUntil(async () => (await scientificCalls()).length === before.length + 4);
    await clickPlot(MZ, .5); const host = await scientificCalls();
    await browser.keys(["Control", "+"]); await browser.keys(["Control", "0"]);
    expect(await scientificCalls()).toEqual(host);
    await browser.keys("Tab"); expect(await browser.execute(css => document.activeElement?.matches(css), MZ)).not.toBe(true);
    await choosePlotMenuItem(".spectrum-panel", "Set range…"); await low.setValue("0200."); await browser.keys("Escape");
    // Closed, and the keyboard is back on the ⋯ it came from.
    expect(await browser.$("#plot-range-mz-editor").isExisting()).toBe(false);
    expect(await browser.execute(() => document.activeElement?.getAttribute("aria-haspopup"))).toBe("menu");
    expect(await scientificCalls()).toEqual(host);
    await capture("numeric-wheel-pan-reduced-motion");
    await cdp("Emulation.setEmulatedMedia", { features: [] });
  });
  for (const axis of ["rt", "mz"] as const) for (const format of ["csv", "tsv"] as const) {
    it(`runs one ${axis} ${format} data export from the plot menu and keeps focus where the reader is`, async () => {
      await open("complete", { width: 1366, height: 768, dpr: 1.5 });
      await clickPlot(RT, .4); await browser.$(MZ).waitForDisplayed();
      const panel = axis === "rt" ? ".chromatogram-panel" : ".spectrum-panel";
      const plot = axis === "rt" ? RT : MZ;
      const command = axis === "rt" ? "save_chromatogram_export" : "save_selected_spectrum_export";
      const begin = axis === "rt" ? "begin_chromatogram_export" : "begin_selected_spectrum_export";
      await holdInvoke(command); await setInvokeResult(command, { status: "cancelled" });
      const more = browser.$(panel).$('button[aria-label="More export options"]');
      const item = (name: string) => browser.$(`//*[@role="menuitem"][starts-with(normalize-space(), "${name}")]`);
      const label = "Export " + format.toUpperCase() + "…", other = "Export " + (format === "csv" ? "TSV" : "CSV") + "…";
      await more.click(); await item(label).click();
      await browser.waitUntil(async () => await heldCallers(command) === 1);
      // The menu closes and hands focus back to its trigger.
      await browser.waitUntil(async () => await more.isFocused());
      const count = (await ipcCalls()).filter(call => call.command === begin).length;
      // Reopened while the one export lane is held, both data items are refused and do nothing.
      await browser.keys("Enter"); await item(label).waitForDisplayed();
      expect(await item(label).getAttribute("aria-disabled")).toBe("true");
      expect(await item(other).getAttribute("aria-disabled")).toBe("true");
      await item(label).click();
      expect((await ipcCalls()).filter(call => call.command === begin)).toHaveLength(count);
      await capture(axis + "-" + format + "-export-busy");
      await browser.keys("Escape"); await browser.waitUntil(async () => await more.isFocused());
      // TSV also proves that settling does not take focus from a later choice.
      if (format === "tsv") await browser.execute(css => document.querySelector<SVGElement>(css)?.focus(), plot);
      await releaseInvokeHold(command);
      await browser.waitUntil(async () => (await browser.$(panel + " .plot-status").getText()).includes("Export cancelled"));
      expect(await browser.execute(css => document.activeElement?.matches(css) ?? false,
        format === "tsv" ? plot : panel + ' button[aria-label="More export options"]')).toBe(true);
      await more.click();
      await browser.waitUntil(async () => await item(label).getAttribute("aria-disabled") === null);
      await browser.keys("Escape");
      await capture(axis + "-" + format + "-export-cancelled");
    });
  }
  it("cancels emulated touch on vertical travel and multiple contacts without committing", async () => {
    await open("complete", { width: 960, height: 640, dpr: 2 });
    await browser.waitUntil(async () => (await scientificCalls()).some(call => call.command === "project_selected_spectrum"));
    const openRead = await scientificCalls();
    await cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2 });
    const start = await point(RT, .25), end = await point(RT, .65);
    const touch = (p: { x: number; y: number }, id = 1) => ({ ...p, id, radiusX: 2, radiusY: 2, force: 1 });
    await cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touch(start)] });
    await cdp("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [touch(end)] });
    await cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await browser.$(".chromatogram-panel .plot-pending-actions").waitForDisplayed();
    expect(await scientificCalls()).toEqual(openRead);
    await browser.$(".chromatogram-panel .plot-pending-actions button:nth-child(2)").click();
    await cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touch(start)] });
    await cdp("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [touch(end)] });
    await cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touch(end), touch({ x: end.x + 30, y: end.y + 10 }, 2)] });
    await cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    expect(await browser.$(".chromatogram-panel .plot-pending-actions").isExisting()).toBe(false);
    await browser.execute(() => {
      Reflect.set(window, "__m73TouchTrace", []);
      document.querySelector("svg.chromatogram-svg")!.addEventListener("pointercancel", () => (Reflect.get(window, "__m73TouchTrace") as string[]).push("pointercancel"));
    });
    const scrollBefore = await browser.$("#workbench-evidence").getProperty("scrollTop");
    await cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touch(start)] });
    for (const dy of [20, 55, 90]) await cdp("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [touch({ x: start.x + 1, y: start.y - dy })] });
    await cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    expect(await browser.$(".chromatogram-panel .plot-pending-actions").isExisting()).toBe(false);
    expect(await scientificCalls()).toEqual(openRead);
    const trace = await browser.execute(() => Reflect.get(window, "__m73TouchTrace") as string[]);
    evidence.push({ kind: "CDP emulated touch; no physical touch certification", trace, scrollBefore,
      scrollAfter: await browser.$("#workbench-evidence").getProperty("scrollTop") });
    expect(trace).toContain("pointercancel");
    await capture("touch-vertical-and-multitouch-cancel");
    await cdp("Emulation.setTouchEmulationEnabled", { enabled: false });
  });

  // ADR 0056 slice 2's webview: what the file declares, drawn and said as it declares it.
  const UNITS = { mzUnit: { state: "declared", accession: "MS:1000040" }, intensityUnit: { state: "declared", accession: "MS:1000131" } };
  const axisTitles = () => browser.execute(() =>
    [...document.querySelectorAll(".spectrum-panel .plot-axis-title")].map(node => node.textContent));
  const lineStartX = () => browser.execute(() =>
    Number(/^M(-?[\d.]+)/u.exec(document.querySelector(".spectrum-panel .spectrum-line")?.getAttribute("d") ?? "")?.[1]));

  it("draws a declared profile spectrum as one joined line, cut at a zoomed window's edges (P175)", async () => {
    await open("complete", { width: 1366, height: 768, dpr: 1 }, undefined, { representation: "profile", ...UNITS });
    await clickPlot(RT, .4);
    await browser.$(MZ + '[data-drawn-as="line"]').waitForExist();
    expect(await browser.$(".spectrum-panel .spectrum-sticks").isExisting()).toBe(false);
    expect(await browser.$(".spectrum-head-facts").getText()).toContain("Profile");
    expect(await axisTitles()).toEqual(["Intensity (MS:1000131)", "m/z (MS:1000040)"]);
    await capture("profile-line");
    // Zoomed in from the keyboard, the line runs in from the sample beyond the
    // low edge and the band's clip cuts it there, as the export cuts it.
    await browser.execute((css: string) => document.querySelector<SVGSVGElement>(css)?.focus(), MZ);
    await browser.keys("+");
    await browser.waitUntil(async () => await lineStartX() < SPECTRUM_BAND.left, { timeoutMsg: "the zoomed line never started beyond the band" });
    expect(await browser.$(MZ).getAttribute("data-drawn-as")).toBe("line");
    await capture("profile-line-zoomed");
    // And from the button, the same.
    const line = () => browser.$(".spectrum-panel .spectrum-line").getAttribute("d");
    const before = await line();
    await browser.$('.spectrum-panel button[aria-label="Zoom in m/z"]').click();
    await browser.waitUntil(async () => await line() !== before && await lineStartX() < SPECTRUM_BAND.left,
      { timeoutMsg: "the button's zoom never redrew the cut line" });
    expect(await browser.$(MZ).getAttribute("data-drawn-as")).toBe("line");
    expect(await consoleEntries()).toEqual([]);
  });

  it("keeps a declared centroid spectrum as sticks", async () => {
    await open("complete", { width: 1366, height: 768, dpr: 1 }, undefined, { representation: "centroid", ...UNITS });
    await clickPlot(RT, .4);
    await browser.$(MZ + '[data-drawn-as="sticks"]').waitForExist();
    await browser.$(".spectrum-panel .spectrum-sticks").waitForExist();
    expect(await browser.$(".spectrum-panel .spectrum-line").isExisting()).toBe(false);
    expect(await browser.$(".spectrum-head-facts").getText()).toContain("Centroid");
    await capture("centroid-sticks");
  });

  it("refuses a chromatogram over scans in mixed retention-time units, and converts nothing", async () => {
    await open("mixed", { width: 1366, height: 768, dpr: 1 });
    await browser.$(".chromatogram-panel .empty-state").waitForDisplayed();
    expect(await browser.$(".chromatogram-panel .empty-state").getText()).toContain("different units");
    expect(await browser.$(RT).isExisting()).toBe(false);
    // The header claims no one unit, and each value keeps its own.
    expect(await browser.$(SCANS + " .scan-sort-unit").getText()).toBe("(mixed units)");
    // Heard as well as seen: the unit is in the sort button's name.
    expect(await browser.$(SCANS + ' [role="columnheader"]:nth-child(2) button').getAttribute("aria-label")).toBe("RT (Retention time) (mixed units)");
    expect(await browser.$(row(0)).getText()).toContain("0.0000 min");
    expect(await browser.$(row(1)).getText()).toContain("1.0000 s");
    await capture("mixed-unit-refusal");
  });

  it("states a run's declared minutes wherever it prints a retention time, and converts nothing", async () => {
    await open("minutes", { width: 1366, height: 768, dpr: 1 });
    await browser.$(RT).waitForDisplayed();
    expect(await browser.$(".chromatogram-panel .plot-axis-title-x").getText()).toBe("Retention time (min)");
    expect(await browser.$(".chromatogram-range").getText()).toContain("7.0000 min");
    expect(await browser.$(SCANS + " .scan-sort-unit").getText()).toBe("(min)");
    // The range editor's fields and the range it commits.
    await choosePlotMenuItem(".chromatogram-panel", "Set range…");
    expect(await browser.$("#plot-range-rt-low-label").getText()).toBe("From (min)");
    expect(await browser.$("#plot-range-rt-high-label").getText()).toBe("To (min)");
    await browser.$("#plot-range-rt-low").setValue("2"); await browser.$("#plot-range-rt-high").setValue("5");
    await browser.$(".chromatogram-panel .plot-range-form button[type=submit]").click();
    await browser.waitUntil(async () => String(await browser.$(".chromatogram-panel .plot-committed-range").getProperty("textContent"))
      .includes("2.0000 to 5.0000 min"), { timeoutMsg: "the committed range never stated its unit" });
    await capture("minutes-range");
    // The figure dialog names the run's window in the same unit.
    await openFigureDialog(".chromatogram-panel");
    expect(await browser.$(FIGURE_DIALOG).getText()).toContain("RT 2.0000–5.0000 min");
    await capture("minutes-figure-dialog");
    expect(await consoleEntries()).toEqual([]);
  });

  it("states a truncated spectrum's prefix and its total", async () => {
    await open("complete", { width: 1366, height: 768, dpr: 1 }, undefined, { truncated: true, pointCount: 900_000 });
    await clickPlot(RT, .4);
    await browser.$(".spectrum-panel .notice-warning").waitForDisplayed();
    expect(await browser.$(".spectrum-panel .notice-warning").getText()).toContain("12 of 900,000 points transferred");
    await capture("truncated-spectrum");
  });

  it("keeps a superseded open's reason on screen beside a button that reads the file again", async () => {
    const table = answers("complete");
    await installIpcBoundary({ ...table, open_mzml_preview: { __reject: { kind: "selection_superseded",
      summary: "A newer request for that file arrived before this one finished, so its result was not used.", detail: null, retryable: false } } });
    await metrics(1366, 768, 1);
    await browser.url("/");
    await revealRosterRow(selectedFile.handle);
    await browser.$('.grouped-roster [data-handle="' + selectedFile.handle + '"]').click();
    const failed = browser.$('#workbench-evidence[data-evidence="failed"]');
    await failed.waitForDisplayed();
    expect(await failed.getText()).toContain("A newer request for that file arrived before this one finished");
    // Nothing was wrong with the file: neither its row nor the announcement calls it unreadable.
    expect(await browser.execute(() => document.body.textContent ?? "")).not.toMatch(/could not be read/iu);
    await capture("superseded-open");
    await setInvokeResult("open_mzml_preview", table.open_mzml_preview);
    await failed.$("button").click();
    await browser.$(SCANS).waitForExist();
  });

  // N-V3: go to a scan, the list following the range, each file as it was left.
  const shownScans = () => browser.$$(SCANS + " [data-source-index]").map(row => row.getAttribute("data-source-index"));
  const reads = async () => (await scientificCalls()).filter(call => call.command === "load_selected_spectrum").map(call => call.args.index);
  /** Nothing cut: what the element holds fits the width it has. */
  const whole = (css: string) => browser.execute((selector: string) => {
    const node = document.querySelector<HTMLElement>(selector);
    return node !== null && node.scrollWidth <= node.clientWidth;
  }, css);
  async function goToScan(text: string) {
    await browser.$("#scan-go-to").setValue(text);
    await browser.keys("Enter");
  }
  async function setRtRange(words: typeof en | typeof zhCN, low: string, high: string) {
    await choosePlotMenuItem(".chromatogram-panel", words.rangeSet);
    await browser.$("#plot-range-rt-low").setValue(low); await browser.$("#plot-range-rt-high").setValue(high);
    await browser.$(".chromatogram-panel .plot-range-form button[type=submit]").click();
  }
  for (const scenario of [
    { width: 1366, height: 768, dpr: 1, language: "en", words: en },
    { width: 1366, height: 768, dpr: 1, language: "zh-CN", words: zhCN },
    { width: 960, height: 640, dpr: 1, language: "en", words: en },
    { width: 960, height: 640, dpr: 1, language: "zh-CN", words: zhCN },
  ] as const) it("goes to a scan and follows the range, " + scenario.language + " at " + scenario.width + "x" + scenario.height, async () => {
    const { words } = scenario;
    const label = (state: string) => "nav-" + state + "-" + scenario.language + "-" + scenario.width;
    await open("complete", scenario);
    await preferences(scenario.language, "comfortable");
    await revealScans();
    // A number not in the table is refused in place, and reads nothing.
    const already = (await reads()).length;
    await goToScan("99");
    const refused = words.scanGoToRefused.replace("{{value}}", "99");
    expect(await browser.$(".scan-go-to-refusal").getText()).toBe(refused);
    expect(await browser.$("#scan-go-to").getAttribute("aria-invalid")).toBe("true");
    expect((await reads()).length).toBe(already);
    await capture(label("refused"));
    // Six digits and the input's own short name stay whole, and a pasted refusal
    // wraps rather than running off the panel.
    for (const text of ["123456", words.scanGoToShort]) {
      await browser.$("#scan-go-to").setValue(text);
      expect(await whole("#scan-go-to")).toBe(true);
    }
    await goToScan("1".repeat(300));
    expect(await whole(".scan-go-to-refusal")).toBe(true);
    expect(await whole(".spectrum-table-panel")).toBe(true);
    await capture(label("refused-long"));
    // Filters that hide the scan go; focus stays for the next number.
    await browser.$(SCANS + ' input[type="search"]').setValue("rare-");
    expect(await shownScans()).toEqual(["3", "7"]);
    await goToScan("5");
    await browser.waitUntil(async () => (await reads()).at(-1) === 4);
    expect(await browser.$(SCANS + ' input[type="search"]').getValue()).toBe("");
    expect(await browser.$(row(4)).getAttribute("aria-selected")).toBe("true");
    expect(await browser.execute(() => document.activeElement?.id)).toBe("scan-go-to");
    await capture(label("went"));
    // The list follows the committed range, and the count says how many of how many.
    await setRtRange(words, "1", "2.5");
    await browser.waitUntil(async () => (await shownScans()).join() === "1,2", { timeoutMsg: "the list never followed the range" });
    expect(await browser.$(".scan-result-count:not(:empty)").getText()).toContain("2");
    expect(await whole(".scan-result-count:not(:empty)")).toBe(true);
    // The selected scan is outside it: said so, recoverable, with nothing read.
    const outside = words.scanSelectedOutsideRange.replace("{{name}}", "5");
    expect(await browser.$("#scan-hidden-selection-reason").getText()).toBe(outside);
    await capture(label("selected-outside"));
    // The Scans tab draws no chromatogram, and the range still holds there.
    const onTab = async (position: number) => { await browser.$('.viewer-tabs [role="tab"]:nth-child(' + position + ")").click(); await browser.$(SCANS).waitForExist(); };
    await onTab(2);
    expect(await browser.$(RT).isExisting()).toBe(false);
    expect(await shownScans()).toEqual(["1", "2"]);
    await capture(label("scans-tab-selected-outside"));
    await onTab(1);
    const before = (await reads()).length;
    await browser.$(".scan-hidden-selection button").click();
    await browser.waitUntil(async () => (await shownScans()).includes("4"), { timeoutMsg: "the range never moved to the scan" });
    expect((await reads()).length).toBe(before);
    // A narrow range holding no scan names the range, not the filters.
    await setRtRange(words, "2.2", "2.8");
    await browser.waitUntil(async () => (await browser.$(SCANS).getText()).includes(words.scanNoMatchesInRange), { timeoutMsg: "the empty range never said so" });
    expect(await browser.$(SCANS + ' [role="grid"]').getAttribute("aria-rowcount")).toBe("1");
    await capture(label("empty-range"));
    await onTab(2);
    expect(await browser.$(SCANS).getText()).toContain(words.scanNoMatchesInRange);
    await capture(label("scans-tab-empty-range"));
    await onTab(1);
    // Going to a scan the range hides brings the range to it.
    await goToScan("8");
    await browser.waitUntil(async () => (await reads()).at(-1) === 7);
    await browser.waitUntil(async () => (await shownScans()).includes("7"), { timeoutMsg: "the scan never came into the list" });
    await capture(label("went-into-range"));
    expect(await consoleEntries()).toEqual([]);
  });
  for (const scenario of [
    { width: 1366, height: 768, dpr: 1, language: "en" },
    { width: 1366, height: 768, dpr: 1, language: "zh-CN" },
    { width: 960, height: 640, dpr: 1, language: "en" },
    { width: 960, height: 640, dpr: 1, language: "zh-CN" },
  ] as const) it("keeps a long run's numbers whole in the scan head, " + scenario.language + " at " + scenario.width + "x" + scenario.height, async () => {
    const label = (state: string) => "long-run-" + state + "-" + scenario.language + "-" + scenario.width;
    // M0's public file: 36,319 spectra.
    await open("complete", scenario, 36319);
    await preferences(scenario.language, "comfortable");
    await revealScans();
    expect(await browser.$(".scan-head .scan-result-count").getText()).toBe("36,319");
    for (const css of [".scan-head", ".scan-head .scan-result-count"]) expect(await whole(css)).toBe(true);
    await capture(label("one-number"));
    // Some of them match: the head stays one line with nothing cut, and the counts are whole under it.
    await browser.$(SCANS + ' input[type="search"]').setValue("scan=1");
    await browser.waitUntil(async () => (await browser.$(".spectrum-table-panel > .scan-result-count").getText()).includes("36,319"));
    for (const css of [".scan-head", ".spectrum-table-panel > .scan-result-count"]) expect(await whole(css)).toBe(true);
    expect(await browser.$(".scan-head").getSize("height")).toBe(36);
    await browser.$("#scan-go-to").setValue("123456");
    expect(await whole("#scan-go-to")).toBe(true);
    await capture(label("three-counts"));
    expect(await consoleEntries()).toEqual([]);
  });
  it("comes back to a file as it was left, and to a scan's own zoom", async () => {
    await installIpcBoundary({ ...answers("complete"), get_workspace_roster: { capacity: 1024, datasets: [selectedFile, secondFile] } });
    await metrics(1366, 768, 1);
    await browser.url("/");
    await browser.$('.grouped-roster [data-handle="' + selectedFile.handle + '"]').waitForExist();
    await sourceBoundary(1);
    // Each open's reply is its own object, as one crossing the real boundary is.
    await browser.execute(() => {
      const internals = Reflect.get(window, "__TAURI_INTERNALS__") as { invoke: (command: string, args: unknown) => Promise<unknown> };
      const invoke = internals.invoke;
      internals.invoke = (command, args) => command === "open_mzml_preview" ? invoke(command, args).then(reply => structuredClone(reply)) : invoke(command, args);
    });
    const openRow = async (handle: string) => {
      const opens = (await ipcCalls()).filter(call => call.command === "open_mzml_preview").length;
      await revealRosterRow(handle);
      await browser.$('.grouped-roster [data-handle="' + handle + '"]').click();
      await browser.waitUntil(async () => (await ipcCalls()).filter(call => call.command === "open_mzml_preview").length === opens + 1);
      await browser.$(SCANS).waitForExist();
    };
    const windows = async () => (await scientificCalls()).filter(call => call.command === "project_selected_spectrum").map(call => [call.args.low, call.args.high]);
    await openRow(selectedFile.handle);
    await revealScans();
    await goToScan("4");
    await browser.waitUntil(async () => (await reads()).at(-1) === 3);
    await browser.$(MZ).waitForDisplayed();
    await choosePlotMenuItem(".spectrum-panel", "Set range…");
    await browser.$("#plot-range-mz-low").setValue("200"); await browser.$("#plot-range-mz-high").setValue("400");
    await browser.$(".spectrum-panel .plot-range-form button[type=submit]").click();
    await browser.waitUntil(async () => (await windows()).at(-1)?.join() === "200,400");
    await revealScans();
    await browser.$(SCANS + " select").selectByAttribute("value", "2");
    await openRow(secondFile.handle);
    expect(await browser.$(SCANS + " select").getValue()).toBe("all");
    await openRow(selectedFile.handle);
    expect(await browser.$(SCANS + " select").getValue()).toBe("2");
    await browser.waitUntil(async () => (await reads()).at(-1) === 3);
    await browser.$(MZ).waitForDisplayed();
    await browser.waitUntil(async () => (await windows()).at(-1)?.join() === "200,400", { timeoutMsg: "the scan's zoom never came back" });
    await revealScans();
    expect(await browser.$(row(3)).getAttribute("aria-selected")).toBe("true");
    await capture("nav-back-to-file");
    expect(await consoleEntries()).toEqual([]);
  });

  // N-V3 part 4: what an open selects (V-1, V-1-NOMS1).
  for (const scenario of [
    { width: 1366, height: 768, dpr: 1, language: "en", words: en },
    { width: 1366, height: 768, dpr: 1, language: "zh-CN", words: zhCN },
    { width: 960, height: 640, dpr: 1, language: "en", words: en },
    { width: 960, height: 640, dpr: 1, language: "zh-CN", words: zhCN },
  ] as const) it("shows what an open selects, " + scenario.language + " at " + scenario.width + "x" + scenario.height, async () => {
    const { words } = scenario;
    const label = (state: string) => "entry-" + state + "-" + scenario.language + "-" + scenario.width;
    const selectedSource = () => browser.execute(() => document.querySelector('div.spectrum-table-row[aria-selected="true"]')?.getAttribute("data-source-index") ?? null);
    const inSpectrumPanel = async (text: string) => (await browser.$(".spectrum-panel").getText()).includes(text);
    // The apex of the declared TIC among the MS1 rows: index 6, with a larger MS2 at index 7.
    await open("complete", scenario);
    await preferences(scenario.language, "comfortable");
    await browser.waitUntil(async () => (await reads()).at(-1) === 6);
    await browser.$(MZ).waitForDisplayed();
    expect(await selectedSource()).toBe("6");
    await capture(label("apex"));
    // No MS1: nothing selected, the empty spectrum says what to do, and nothing was read.
    await open("ms2", scenario);
    await preferences(scenario.language, "comfortable");
    expect(await selectedSource()).toBeNull();
    expect(await reads()).toEqual([]);
    expect(await inSpectrumPanel(words.viewerChooseHelp)).toBe(true);
    await capture(label("ms2-only"));
    // A truncated table: its largest value is a prefix's, so nothing selected either.
    await open("prefix", scenario);
    await preferences(scenario.language, "comfortable");
    expect(await selectedSource()).toBeNull();
    expect(await reads()).toEqual([]);
    expect(await inSpectrumPanel(words.viewerChooseHelp)).toBe(true);
    await capture(label("truncated"));
    // A numpress file shows its refusal at once, with the table there to choose from.
    await installIpcBoundary({ ...answers("complete"), load_selected_spectrum: { __reject: {
      kind: "spectrum_encoding_unsupported", summary: "Rust's words.", detail: null, retryable: false } } });
    await metrics(scenario.width, scenario.height, scenario.dpr);
    await browser.url("/");
    await browser.$('.grouped-roster [data-handle="' + selectedFile.handle + '"]').waitForExist();
    await preferences(scenario.language, "comfortable");
    await revealRosterRow(selectedFile.handle);
    await browser.$('.grouped-roster [data-handle="' + selectedFile.handle + '"]').click();
    await browser.$(SCANS).waitForExist();
    await browser.waitUntil(() => inSpectrumPanel(words.errSpectrumEncodingUnsupported), { timeoutMsg: "the refusal was never shown on open" });
    expect(await selectedSource()).toBe("6");
    await capture(label("numpress"));
  });
});
