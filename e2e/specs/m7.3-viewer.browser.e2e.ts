/** Production viewer; deterministic synthetic source responses at the existing IPC boundary only. */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildPreview, buildSpectrum, selectedFile } from "../../apps/desktop/src/test/previewFixtures";
import { ipcTable } from "../support/fixtures";
import { seedARunOf } from "../support/viewer";
import { installIpcBoundary, IPC_TABLE_KEY, ipcCalls, consoleEntries, holdInvoke, heldCallers, releaseInvokeHold, setInvokeResult, setInvokeRejection } from "../support/harness";

const RT = "svg.chromatogram-svg";
const MZ = "svg.spectrum-plot";
const SCANS = ".spectrum-table-panel";
const row = (index: number) => SCANS + ' [data-source-index="' + index + '"]';
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
  await browser.$("[data-settings-entry]").click();
  await browser.$('[data-settings-dialog] input[value="' + language + '"]').click();
  await browser.$('[data-settings-dialog] input[value="' + density + '"]').click();
  await browser.$("[data-settings-dialog]").$(language === "en" ? "button=Apply" : "button=应用").click();
  await browser.$("[data-settings-dialog]").waitForExist({ reverse: true });
}
function answers(kind: "complete" | "prefix" | "empty" | "refused" | "one" | "large-values" = "complete") {
  const table: Record<string, unknown> = ipcTable({ emptySpectrum: kind === "empty", refusedViewport: kind === "refused", oneMzViewport: kind === "one" });
  const preview = buildPreview(8);
  preview.spectrumTable.rows.forEach((row, index) => Object.assign(row, {
    identifier: (index === 3 || index === 7 ? "rare-" : "raw-") + index + "-原始标识符_controllerType=0_controllerNumber=1_scan=" + (index + 1),
    retentionTime: { value: index, unitKnown: false }, msLevel: index % 2 + 1,
    totalIonCurrent: (index + 1) * 10,
  }));
  Object.assign(preview.runSummary, { retentionTimeRange: {
    minimum: { value: 0, unitKnown: false }, maximum: { value: 7, unitKnown: false },
  }, msLevels: [{ msLevel: 1, spectrumCount: 4 }, { msLevel: 2, spectrumCount: 4 }] });
  if (kind === "large-values") preview.spectrumTable.rows.forEach((row, index) => {
    Object.assign(row, { totalIonCurrent: index === 0 ? -1e12 : (index + 1) * 1e12 });
  });
  if (kind === "prefix") {
    Object.assign(preview.spectrumTable, { truncated: true, totalRowCount: 120000 });
    Object.assign(preview.runSummary, { totalSpectrumCount: 120000 });
  }
  table.open_mzml_preview = preview;
  table.get_workspace_roster = { capacity: 1024, datasets: [selectedFile] };
  table.subscribe_workspace_drop_updates = { reservationId: "browser-m73-reservation" };
  return table;
}
/** The fixture answers requested source indices and exact retained windows, with no production state patch. */
async function sourceBoundary(rtStep = 1) {
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
          ...fixture, index, exportToken: "m73-spectrum-" + index, retentionTime: { value: index * step, unitKnown: false },
        } } };
      } else if (command === "project_selected_spectrum") {
        const response = table[command];
        if (response !== null && typeof response === "object" && "__reject" in response) return invoke(command, args);
        const low = Number(args.low), high = Number(args.high);
        const positions = fixture.mz.flatMap((value, index) => value >= low && value <= high ? [index] : []);
        table[command] = { low, high, mz: positions.map(index => fixture.mz[index]),
          intensity: positions.map(index => fixture.intensity[index]), sourcePoints: positions.length, reduced: false };
      }
      return invoke(command, args);
    };
  }, IPC_TABLE_KEY, { ...buildSpectrum(0, 12), mz: Array.from({ length: 12 }, (_, i) => 100 + i * 50),
    intensity: [10, 35, -5, 65, 100, 42, 18, 75, 30, 19, 55, 8], mzLow: 100, mzHigh: 650,
    viewportDomain: { state: "admitted", low: 100, high: 650 } }, rtStep);
}
async function open(kind: Parameters<typeof answers>[0] = "complete", options = { width: 1366, height: 768, dpr: 1.5 }, count?: number) {
  await installIpcBoundary(answers(kind));
  await metrics(options.width, options.height, options.dpr);
  await browser.url("/");
  await browser.$('.grouped-roster [data-handle="' + selectedFile.handle + '"]').waitForExist();
  if (count !== undefined) await seedARunOf(count);
  if (kind === "complete" || kind === "prefix") await sourceBoundary(count === undefined ? 1 : .0125);
  const rosterToggle = browser.$('[aria-controls="workbench-roster"]');
  if (!await browser.$('.grouped-roster [data-handle="' + selectedFile.handle + '"]').isDisplayed()) await rosterToggle.click();
  await browser.$('.grouped-roster [data-handle="' + selectedFile.handle + '"]').click();
  await browser.$(SCANS).waitForExist();
  if (await rosterToggle.getAttribute("aria-expanded") === "true") await browser.$(".workbench-home").click();
}
async function point(selector: string, fraction: number) {
  return browser.execute((css, part) => {
    const node = document.querySelector(css)!;
    const box = node.getBoundingClientRect();
    const mz = node.classList.contains("spectrum-plot");
    return { x: Math.round(box.x + box.width * ((mz ? 8 : 64) + (mz ? 984 : 924) * part) / 1000),
      y: Math.round(box.y + box.height * .45) };
  }, selector, fraction);
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
    expect(await browser.$(".spectrum-export-disclosure").getAttribute("open")).toBeNull();
    expect(await consoleEntries()).toEqual([]);
  });
  it("uses real full header and row targets, raw search, source identity and loaded-only navigation", async () => {
    await open(); await browser.$(SCANS).scrollIntoView({ block: "start" });
    const header = browser.$(SCANS + ' [role="columnheader"]:nth-child(8) button');
    const before = await scientificCalls(); await header.click(); await header.click();
    expect(await browser.$(SCANS + ' [aria-sort="descending"]').getText()).toContain("Total ion current");
    await browser.$(SCANS + ' input[type="search"]').setValue("rare-");
    expect(await browser.$$(SCANS + " [data-source-index]").map(row => row.getAttribute("data-source-index"))).toEqual(["7", "3"]);
    await browser.$(row(3) + ' [role="gridcell"]:nth-child(5)').click();
    await browser.waitUntil(async () => (await scientificCalls()).some(call => call.command === "load_selected_spectrum" && call.args.index === 3));
    await browser.$(row(7) + ' [role="gridcell"]:nth-child(8)').click();
    await browser.waitUntil(async () => (await scientificCalls()).filter(call => call.command === "load_selected_spectrum").length === 2);
    await browser.keys("End");
    expect(await browser.execute(() => document.activeElement?.getAttribute("data-source-index"))).toBe("3");
    expect((await scientificCalls()).filter(call => call.command === "load_selected_spectrum").map(call => call.args.index)).toEqual([3, 7]);
    await browser.keys("Enter");
    await browser.waitUntil(async () => (await scientificCalls()).filter(call => call.command === "load_selected_spectrum").length === 3);
    expect(before).toEqual([]);
    await browser.$(SCANS + ' input[type="search"]').setValue("raw-1");
    expect(await browser.$(SCANS).getText()).toContain("Selected scan 3 is outside these results");
    expect(await browser.$("button=Next scan").isEnabled()).toBe(false);
    await capture("hidden-selection");
    await browser.$("button=Clear filters and reveal").click(); await browser.$("button=Next scan").click();
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
  it("windows the 100000 loaded rows, reaches End without a read and aligns horizontally scrolled headers", async () => {
    await open("complete", { width: 1200, height: 800, dpr: 1.25 }, 100000);
    await browser.$(SCANS).scrollIntoView({ block: "start" });
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
    for (const id of ["workbench-roster", "workbench-inspector"]) {
      const toggle = browser.$('[aria-controls="' + id + '"]');
      if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
    }
    await browser.$(SCANS).scrollIntoView({ block: "start" });
    await browser.execute(() => { document.querySelector(".spectrum-table-viewport")!.scrollLeft = 220; });
    const columns = await browser.execute(() => {
      const box = (node: Element) => { const r = node.getBoundingClientRect(); return { x: r.x, width: r.width }; };
      return { headers: [...document.querySelectorAll('.spectrum-table [role="columnheader"]')].map(box),
        values: [...document.querySelectorAll('.spectrum-table [data-source-index="99999"] [role="gridcell"]')].map(box),
        mounted: document.querySelectorAll('.spectrum-table [data-source-index]').length,
        scrollLeft: document.querySelector('.spectrum-table-viewport')!.scrollLeft };
    });
    evidence.push({ kind: "100000 loaded rows", columns });
    expect(columns.scrollLeft).toBeGreaterThan(0);
    expect(columns.headers.length).toBe(9);
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
    expect(await browser.$(SCANS).getText()).toContain("Selected scan 3 is outside these results");
    expect(await browser.$(SCANS + " select").getValue()).toBe("1");
    expect(await browser.$("button=Next scan").isEnabled()).toBe(false);
    await capture("plot-hidden-by-ms-filter");
  });
  it("distinguishes empty, refused, loading and failed projection, then actually retries", async () => {
    for (const kind of ["empty", "refused"] as const) {
      await open(kind, { width: 1920, height: 1080, dpr: 1 });
      await clickPlot(RT, .3);
      await browser.waitUntil(async () => (await scientificCalls()).some(call => call.command === "load_selected_spectrum"));
      await browser.$(".spectrum-source-details").waitForExist();
      if (kind === "empty") expect(await browser.$(".spectrum-panel").getText()).toContain("zero points");
      else { expect(await browser.$(MZ).getAttribute("tabindex")).toBe("-1"); expect(await browser.$("#spectrum-viewport-status").getText()).not.toBe(""); }
      await capture("spectrum-" + kind);
    }
    await open("complete", { width: 1920, height: 1080, dpr: 1 });
    await clickPlot(RT, .3); await browser.$(MZ).waitForDisplayed();
    await holdInvoke("project_selected_spectrum");
    await browser.$("button=Zoom in m/z").click();
    await browser.waitUntil(async () => await heldCallers("project_selected_spectrum") === 1);
    expect(await browser.$("#spectrum-viewport-status").getText()).toContain("Nothing is drawn here until it arrives");
    await capture("projection-loading");
    await releaseInvokeHold("project_selected_spectrum");
    await browser.waitUntil(async () => await browser.$("#spectrum-viewport-status").getText() === "");
    await setInvokeRejection("project_selected_spectrum", { kind: "spectrum_projection_failed",
      summary: "Controlled retained-source refusal.", detail: "M7.3 retry fixture.", retryable: true });
    await browser.$("button=Zoom in m/z").click();
    await browser.$("button=Draw this m/z range again").waitForDisplayed();
    expect(await browser.$("#spectrum-viewport-status").getText()).toContain("Controlled retained-source refusal.");
    await capture("projection-failed");
    const count = (await scientificCalls()).length;
    await setInvokeResult("project_selected_spectrum", null);
    await browser.$("button=Draw this m/z range again").click();
    await browser.waitUntil(async () => (await scientificCalls()).length === count + 1);
    await browser.$("button=Draw this m/z range again").waitForExist({ reverse: true });
    expect(await browser.$(".spectrum-caption").getText()).toMatch(/sticks? ·/u);
  });
  it("keeps numeric raw text, IME and host keys separate and supports wheel and pan with reduced motion", async () => {
    await open("complete", { width: 1920, height: 1080, dpr: 1 });
    await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await clickPlot(RT, .4); await browser.$(MZ).waitForDisplayed();
    await browser.$(".spectrum-panel .plot-range-editor summary").click();
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
    await browser.$(".spectrum-panel .plot-range-editor summary").click(); await low.setValue("0200."); await browser.keys("Escape");
    expect(await browser.$(".spectrum-panel .plot-range-editor").getAttribute("open")).toBeNull();
    expect(await scientificCalls()).toEqual(host);
    await capture("numeric-wheel-pan-reduced-motion");
    await cdp("Emulation.setEmulatedMedia", { features: [] });
  });
  it("cancels emulated touch on vertical travel and multiple contacts without committing", async () => {
    await open("complete", { width: 960, height: 640, dpr: 2 });
    await cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2 });
    const start = await point(RT, .25), end = await point(RT, .65);
    const touch = (p: { x: number; y: number }, id = 1) => ({ ...p, id, radiusX: 2, radiusY: 2, force: 1 });
    await cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touch(start)] });
    await cdp("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [touch(end)] });
    await cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await browser.$(".chromatogram-panel .plot-pending-actions").waitForDisplayed();
    expect(await scientificCalls()).toEqual([]);
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
    expect(await scientificCalls()).toEqual([]);
    const trace = await browser.execute(() => Reflect.get(window, "__m73TouchTrace") as string[]);
    evidence.push({ kind: "CDP emulated touch; no physical touch certification", trace, scrollBefore,
      scrollAfter: await browser.$("#workbench-evidence").getProperty("scrollTop") });
    expect(trace).toContain("pointercancel");
    await capture("touch-vertical-and-multitouch-cancel");
    await cdp("Emulation.setTouchEmulationEnabled", { enabled: false });
  });
});
