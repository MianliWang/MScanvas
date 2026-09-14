/** Current-build Windows/WebView2 acceptance. Real IPC, explicitly synthetic source. */
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeResourceOrigins } from "../support/nativeResourceOrigins";
import { M73_MZ, M73_INTENSITY, M73_SCAN_COUNT, writeM73NativeFixture } from "../support/m73NativeFixture";

const HERE = dirname(fileURLToPath(import.meta.url)), REPO = resolve(HERE, "../..");
const RT = "svg.chromatogram-svg", MZ = "svg.spectrum-plot", SCANS = ".spectrum-table-panel";
const row = (index: number) => SCANS + ' [data-source-index="' + index + '"]';
const evidence: unknown[] = [];
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
let output = "", fixture = "", sourceSha = "", processId = 0, dpi = 0;
let viewport = { width: 1366, height: 768 };
type Rect = { left: number; top: number; right: number; bottom: number };
type Metrics = { dpi: number; mainWindow: number; foregroundProcessId: number; executable: string;
  bounds: { client: Rect; visibleFrameInsideWorkArea: boolean } };
function metrics(): Metrics {
  return JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    resolve(HERE, "../native/m7.1-window-metrics.ps1"), "-ApplicationProcessId", String(processId)],
  { encoding: "utf8", windowsHide: true })) as Metrics;
}
function saveEvidence() { if (output) writeFileSync(join(output, "evidence.json"), JSON.stringify(evidence, null, 2)); }
async function calls() { return browser.execute(() => Reflect.get(window, "__mscanvasIpcCalls__") as { command: string; args: Record<string, unknown> }[]); }
async function reads() { return (await calls()).filter(call => ["load_selected_spectrum", "project_selected_spectrum"].includes(call.command)); }
function helper(script: string, args: string[]) {
  const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolve(HERE, "../native/" + script + ".ps1"),
    "-ApplicationProcessId", String(processId), ...args], { windowsHide: true });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += String(chunk); }); child.stderr.on("data", chunk => { stderr += String(chunk); });
  return new Promise<Record<string, unknown>>((done, fail) => {
    const timer = setTimeout(() => { child.kill(); fail(Error("Owned native helper exceeded its bounded lifetime.")); }, 60_000);
    child.once("error", error => { clearTimeout(timer); fail(error); });
    child.once("close", code => {
      clearTimeout(timer); evidence.push({ kind: "owned helper", script, args, code, stdout, stderr }); saveEvidence();
      try { if (code !== 0) throw Error(stdout + stderr); done(JSON.parse(stdout.trim()) as Record<string, unknown>); } catch (error) { fail(error); }
    });
  });
}
async function capture(label: string, validate = true) {
  const owned = metrics();
  const state = await browser.execute(() => {
    const box = (node: Element) => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    return { css: { width: innerWidth, height: innerHeight }, dpr: devicePixelRatio, language: document.documentElement.lang,
      focus: { hasFocus: document.hasFocus(), element: document.activeElement?.outerHTML },
      plots: [...document.querySelectorAll("svg.chromatogram-svg,svg.spectrum-plot")].map(node => ({ ...box(node), labels:
        [...node.querySelectorAll("text")].map(label => ({ text: label.textContent, ...box(label), font: getComputedStyle(label).fontSize })) })),
      body: document.body.innerText, trace: Reflect.get(window, "__m73NativeTrace") ?? [],
      mockKeys: Object.keys(Reflect.get(window, "__mscanvasIpcTable__") as object),
      applicationOrigin: location.origin, resourceUrls: performance.getEntriesByType("resource").map(entry => entry.name),
      console: Reflect.get(window, "__mscanvasConsole__") ?? [],
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
      invokeDescriptor: Object.getOwnPropertyDescriptor(Reflect.get(window, "__TAURI_INTERNALS__"), "invoke")?.writable,
    };
  });
  const resources = nativeResourceOrigins(state.resourceUrls, state.applicationOrigin);
  const path = join(output, label + ".png"); await browser.saveScreenshot(path);
  const png = readFileSync(path), raster = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  evidence.push({ label, attribution: "actual Windows scaling; WebDriver input; real IPC; synthetic mzML source", owned, ...state, ...resources, raster, calls: await calls() }); saveEvidence();
  if (validate) {
    expect(owned.foregroundProcessId).toBe(processId); expect(state.focus.hasFocus).toBe(true);
    expect(owned.dpi).toBe(dpi); expect(state.dpr).toBe(dpi / 96); expect(state.css).toEqual(viewport);
    expect(owned.bounds.visibleFrameInsideWorkArea).toBe(true);
    expect(raster).toEqual({ width: owned.bounds.client.right - owned.bounds.client.left, height: owned.bounds.client.bottom - owned.bounds.client.top });
    expect(raster).toEqual({ width: Math.round(viewport.width * state.dpr), height: Math.round(viewport.height * state.dpr) });
    expect(state.horizontalOverflow).toBeLessThanOrEqual(1); expect(resources.externalResources).toEqual([]); expect(state.mockKeys).toEqual([]);
    expect(state.console).toEqual([]); expect(state.invokeDescriptor).toBe(false);
  }
  return state;
}
async function point(selector: string, fraction: number) {
  return browser.execute((css, part) => {
    const node = document.querySelector(css)!, r = node.getBoundingClientRect(), mz = node.classList.contains("spectrum-plot");
    return { x: Math.round(r.x + r.width * ((mz ? 8 : 64) + (mz ? 984 : 924) * part) / 1000), y: Math.round(r.y + r.height * .45) };
  }, selector, fraction);
}
async function clickPlot(selector: string, fraction: number) {
  await browser.performActions([{ type: "pointer", id: "m73-native-pointer", parameters: { pointerType: "mouse" }, actions: [
    { type: "pointerMove", duration: 0, origin: "viewport", ...await point(selector, fraction) },
    { type: "pointerDown", button: 0 }, { type: "pointerUp", button: 0 },
  ] }]); await browser.releaseActions();
}
async function drag(selector: string, from: number, to: number, button = 0, release = true) {
  await browser.$(selector).scrollIntoView({ block: "center" });
  await browser.performActions([{ type: "pointer", id: "m73-native-pointer", parameters: { pointerType: "mouse" }, actions: [
    { type: "pointerMove", duration: 0, origin: "viewport", ...await point(selector, from) }, { type: "pointerDown", button },
    { type: "pointerMove", duration: 120, origin: "viewport", ...await point(selector, to) },
    ...(release ? [{ type: "pointerUp" as const, button }] : []),
  ] }]); if (release) await browser.releaseActions();
}
async function edit(axis: "rt" | "mz", low: string, high: string) {
  const panel = axis === "rt" ? ".chromatogram-panel" : ".spectrum-panel";
  await browser.$(panel + " .plot-range-editor summary").click();
  await browser.$("#plot-range-" + axis + "-low").setValue(low); await browser.$("#plot-range-" + axis + "-high").setValue(high);
  await browser.$(panel + " .plot-range-form button[type=submit]").click();
}
async function rememberPickerTrigger(selector: string, text: string | null = null) {
  const element = await browser.execute((css, name) => {
    const matches = [...document.querySelectorAll(css)].filter(node => name === null || node.textContent === name);
    if (matches.length !== 1) throw Error("Expected exactly one native picker trigger.");
    Reflect.set(window, "__m73NativePickerTrigger", matches[0]);
    return matches[0].outerHTML;
  }, selector, text);
  evidence.push({ kind: "native picker initiating control", selector, text, element }); saveEvidence();
}
async function naturalReturn(label: string) {
  // Observation only: no focus(), click, foreground API or activation helper.
  try {
    await browser.waitUntil(async () => await browser.execute(() => document.hasFocus() &&
      document.activeElement === Reflect.get(window, "__m73NativePickerTrigger")) && metrics().foregroundProcessId === processId,
    { timeout: 15_000, interval: 500, timeoutMsg: "Native picker did not return naturally to its exact initiating control." });
  } finally {
    const focus = await browser.execute(() => ({ hasFocus: document.hasFocus(), element: document.activeElement?.outerHTML,
      sameTrigger: document.activeElement === Reflect.get(window, "__m73NativePickerTrigger") }));
    evidence.push({ kind: "natural native picker return", label, focus, owned: metrics() }); saveEvidence();
  }
}
async function csv(axis: "rt" | "mz", label: string, cancel = false) {
  const panel = axis === "rt" ? ".chromatogram-panel" : ".spectrum-panel";
  const path = join(output, label + ".csv");
  await rememberPickerTrigger(panel + " button", "Export CSV…");
  const [result] = await Promise.all([helper("save-dialog", ["-Title", axis === "rt" ? "Export chromatogram data" : "Export spectrum data",
    "-Action", cancel ? "cancel" : "save", "-Path", path, "-TimeoutSeconds", "35"]), browser.$(panel).$("button=Export CSV…").click()]);
  expect(result.found).toBe(true); expect(result.invoked).toBe(true);
  await naturalReturn(label);
  const command = axis === "rt" ? "begin_chromatogram_export" : "begin_selected_spectrum_export";
  const request = (await calls()).filter(call => call.command === command).at(-1)!;
  if (cancel) { expect(existsSync(path)).toBe(false); await capture(label); return { request, rows: [] as number[][], text: "" }; }
  await browser.waitUntil(() => existsSync(path));
  const text = readFileSync(path, "utf8"), data = text.split(/\r?\n/u).filter(line => line && !line.startsWith("#")).slice(1).map(line => line.split(",").map(Number));
  evidence.push({ kind: "real scientific CSV", axis, path, sha256: digest(path), bytes: readFileSync(path).length, request, text }); saveEvidence();
  return { request, rows: data, text };
}

describe("M7.3 real native viewer and committed exports", function () {
  this.bail(true);
  before(async () => {
    const root = resolve(REPO, ".tmp/m73-evidence"); mkdirSync(root, { recursive: true }); output = mkdtempSync(join(root, "native-"));
    fixture = join(output, "M73-synthetic-12-scans.mzML"); writeM73NativeFixture(fixture); sourceSha = digest(fixture);
    try {
      if (process.env.MSCANVAS_M73_NATIVE_READY !== "true") throw Error("Fresh user native readiness must be recorded before launching this run.");
      const capabilities = browser.capabilities as unknown as Record<string, unknown>;
      processId = Number(capabilities["goog:processID"]); if (!Number.isSafeInteger(processId) || processId <= 0) throw Error("Missing owned process identity.");
      await browser.$("[data-settings-entry]").waitForDisplayed();
      const owned = metrics(); dpi = owned.dpi;
      evidence.push({ kind: "current build and synthetic fixture", capabilities, owned, binarySha256: digest(owned.executable), fixture, sourceSha,
        sourceHead: process.env.MSCANVAS_M73_SOURCE_HEAD, productionSha256: process.env.MSCANVAS_M73_PRODUCTION_SHA,
        fixtureGeneratorSha256: digest(resolve(REPO, "e2e/support/m73NativeFixture.ts")), harnessSha256: digest(fileURLToPath(import.meta.url)) }); saveEvidence();
      expect(realpathSync(owned.executable)).toBe(realpathSync(resolve(REPO, "target/e2e/release/mscanvas-desktop.exe")));
      expect(digest(owned.executable)).toBe(process.env.MSCANVAS_M73_BINARY_SHA);
      expect(capabilities["browserName"]).toBe("webview2");
      console.log("M7.3 NATIVE INITIAL CLICK: owned MSCanvas PID " + processId + "; HWND " + owned.mainWindow + "; evidence " + output);
      await browser.waitUntil(async () => metrics().foregroundProcessId === processId && await browser.execute(() => document.hasFocus()),
        { timeout: 90_000, interval: 1000, timeoutMsg: "Fresh initial foreground was not established." });
      const available = await browser.execute(() => ({ width: screen.availWidth, height: screen.availHeight }));
      viewport = { width: Math.min(1366, Math.floor(available.width - 40)), height: Math.min(768, Math.floor(available.height - 80)) };
      if (viewport.width < 960 || viewport.height < 640) throw Error("Current owned monitor cannot contain targeted viewport.");
      await helper("m7.1-size-window", ["-ExpectedDpi", String(dpi), "-CssWidth", String(viewport.width), "-CssHeight", String(viewport.height)]);
      await browser.waitUntil(() => browser.execute(v => innerWidth === v.width && innerHeight === v.height, viewport));
      await browser.execute(() => {
        const trace: unknown[] = []; Reflect.set(window, "__m73NativeTrace", trace);
        for (const type of ["pointerdown", "pointerup", "pointercancel", "lostpointercapture", "click", "dblclick", "wheel", "keydown"]) {
          document.addEventListener(type, event => {
            if (!(event.target instanceof Element) || !event.target.closest("svg.chromatogram-svg,svg.spectrum-plot")) return;
            trace.push({ type, trusted: event.isTrusted, time: performance.now(), target: event.target.getAttribute("class"),
              pointerId: "pointerId" in event ? event.pointerId : null, key: "key" in event ? event.key : null });
          }, true);
        }
      });
      await capture("00-current-native-empty");
    } catch (error) { if (processId > 0) await capture("setup-failure", false); throw error; }
  });
  afterEach(async function () {
    evidence.push({ test: this.currentTest?.title, state: this.currentTest?.state }); saveEvidence();
    if (this.currentTest?.state === "failed") await capture("failure-" + evidence.length, false);
  });
  it("reads synthetic mzML through the real provider and activates exact sorted row bodies and keyboard indices", async () => {
    await rememberPickerTrigger(".dataset-roster-actions .primary-button");
    const [chosen] = await Promise.all([helper("choose-workspace-files", ["-Action", "choose", "-Path", fixture, "-TimeoutSeconds", "35"]),
      browser.$(".dataset-roster-actions .primary-button").click()]);
    expect(chosen.closed).toBe(true); await naturalReturn("choose-synthetic-source");
    await browser.$(".grouped-roster [data-handle]").waitForDisplayed(); await browser.$(".grouped-roster [data-handle]").click();
    await browser.$(SCANS).waitForExist(); await browser.$(RT).waitForDisplayed();
    await browser.$(".workbench-home").click();
    await capture("01-native-source-entry");
    expect(await browser.$(SCANS).getText()).toContain("12 matches / 12 loaded rows / 12 reported spectra");
    const header = browser.$(SCANS + ' [role="columnheader"]:nth-child(8) button'); await header.click(); await header.click();
    // Current msaccess emits this raw native identifier and RT in multiples of
    // 60 from the fixture's minute CV values; the UI still reports units unknown.
    await browser.$(SCANS + " input[type=search]").setValue("0.1.8");
    expect(await reads()).toEqual([]);
    await browser.$(row(7) + ' [role="gridcell"]:nth-child(5)').click();
    await browser.waitUntil(async () => await browser.$("#selected-spectrum-summary").getText() === "Spectrum 7, MS2, 12 points.");
    await browser.$("#spectrum-viewport-status").waitForExist();
    await browser.waitUntil(async () => (await reads()).some(call => call.command === "project_selected_spectrum"));
    await browser.$(SCANS + " input[type=search]").setValue("");
    await browser.$(row(7) + ' [role="gridcell"]:nth-child(6)').click();
    const before = (await reads()).filter(call => call.command === "load_selected_spectrum").length;
    await browser.keys("End"); expect(await browser.execute(() => document.activeElement?.getAttribute("data-source-index"))).toBe("0");
    expect((await reads()).filter(call => call.command === "load_selected_spectrum")).toHaveLength(before);
    await browser.keys("Enter"); await browser.waitUntil(async () => (await reads()).filter(call => call.command === "load_selected_spectrum").length === before + 1);
    await browser.waitUntil(async () => (await browser.$("#selected-spectrum-summary").getText()).startsWith("Spectrum 0,"));
    await browser.$(row(7) + ' [role="gridcell"]:nth-child(8)').click();
    await browser.waitUntil(async () => (await browser.$("#selected-spectrum-summary").getText()).startsWith("Spectrum 7,"));
    await browser.$(MZ).scrollIntoView({ block: "center" }); await capture("02-native-source-index-seven");
  });
  it("keeps bands pending until a fresh confirmation and preserves committed ranges on Escape and cancellation", async () => {
    await edit("mz", "200", "550"); await browser.waitUntil(async () => await browser.$("#spectrum-viewport-status").getText() === "");
    await drag(MZ, .2, .7); const before = await reads();
    await browser.$(".spectrum-panel .plot-pending-actions").waitForDisplayed(); await capture("03-native-mz-pending");
    expect(await browser.execute(() => window.getSelection()?.toString() ?? "")).toBe("");
    const current = await browser.$("#spectrum-viewport-range").getText();
    await browser.keys("Escape"); expect(await browser.$(".spectrum-panel .plot-pending-actions").isExisting()).toBe(false);
    expect(await reads()).toEqual(before); expect(await browser.$("#spectrum-viewport-range").getText()).toBe(current);
    await drag(MZ, .2, .7); await clickPlot(MZ, .4);
    await browser.waitUntil(async () => (await reads()).length === before.length + 1);
    await capture("04-native-mz-confirmed");
    await drag(MZ, .2, .7, 0, false);
    await browser.execute(css => {
      const trace = Reflect.get(window, "__m73NativeTrace") as { type: string; pointerId: number }[];
      const pointerId = trace.filter(event => event.type === "pointerdown").at(-1)!.pointerId;
      document.querySelector(css)!.dispatchEvent(new PointerEvent("pointercancel", { pointerId, bubbles: true }));
    }, MZ);
    evidence.push({ kind: "untrusted DOM pointercancel following trusted WebDriver capture; not physical device input" });
    await browser.releaseActions();
    expect(await browser.$(".spectrum-panel .plot-pending-actions").isExisting()).toBe(false);
    await browser.$(MZ).scrollIntoView({ block: "center" }); const at = await point(MZ, .5), beforeWheel = await reads();
    await browser.performActions([{ type: "wheel", id: "m73-native-wheel", actions: [{ type: "scroll", origin: "viewport", ...at, deltaX: 0, deltaY: -120, duration: 120 }] }]);
    await browser.releaseActions(); await browser.waitUntil(async () => (await reads()).length === beforeWheel.length + 1);
    await drag(MZ, .5, .4, 1); await browser.waitUntil(async () => (await reads()).length === beforeWheel.length + 2);
    await clickPlot(MZ, .5); const host = await reads(); await browser.keys(["Control", "+"]); await browser.keys(["Control", "0"]);
    expect(await reads()).toEqual(host); await browser.keys("Tab");
    expect(await browser.execute(css => document.activeElement?.matches(css), MZ)).not.toBe(true);
    await edit("rt", "60", "600"); await drag(RT, .2, .7); await browser.keys("Escape");
    expect(await browser.$(".chromatogram-panel .plot-pending-actions").isExisting()).toBe(false);
    await capture("05-native-input-ownership");
  });
  it("writes current and full retained CSV for both axes, including pending export and natural save cancellation", async () => {
    await edit("mz", "200", "550"); await edit("rt", "60", "600");
    await drag(MZ, .25, .5);
    await browser.$(".spectrum-export-disclosure summary").click(); await browser.$('input[name="spectrum-range-scope"][value="current"]').click();
    const pendingMz = await csv("mz", "06-mz-current-while-pending");
    expect(pendingMz.request.args.range).toEqual({ scope: "current", low: 200, high: 550 });
    expect(pendingMz.rows).toEqual(M73_MZ.flatMap((mz, index) => mz >= 200 && mz <= 550 ? [[mz, M73_INTENSITY[index] * 8]] : []));
    await browser.$(".spectrum-export-disclosure summary").click();
    const beforeConfirm = (await reads()).length;
    await browser.$(".spectrum-panel .plot-pending-actions button:first-child").click();
    await browser.waitUntil(async () => (await reads()).length === beforeConfirm + 1);
    const confirmedMz = (await reads()).filter(call => call.command === "project_selected_spectrum").at(-1)!.args;
    await browser.$(".spectrum-export-disclosure summary").click();
    const narrowedMz = await csv("mz", "07-mz-confirmed-current");
    expect(narrowedMz.request.args.range).toEqual({ scope: "current", low: confirmedMz.low, high: confirmedMz.high });
    expect(narrowedMz.rows).toEqual(M73_MZ.flatMap((mz, index) => mz >= Number(confirmedMz.low) && mz <= Number(confirmedMz.high) ? [[mz, M73_INTENSITY[index] * 8]] : []));
    await csv("mz", "08-native-save-cancel", true);
    await browser.$('input[name="spectrum-range-scope"][value="full"]').click();
    const fullMz = await csv("mz", "09-mz-full"); expect(fullMz.request.args.range).toEqual({ scope: "full", low: null, high: null });
    expect(fullMz.rows).toEqual(M73_MZ.map((mz, index) => [mz, M73_INTENSITY[index] * 8]));
    expect(new Set([pendingMz.request.args.exportToken, narrowedMz.request.args.exportToken, fullMz.request.args.exportToken]).size).toBe(1);
    await browser.$(".spectrum-export-disclosure summary").click();
    await drag(RT, .25, .5); await browser.$("#chromatogram-export-toggle").click();
    await browser.$('input[name="chromatogram-range-scope"][value="current"]').click();
    const pendingRt = await csv("rt", "10-rt-current-while-pending"); expect(pendingRt.request.args.range).toEqual({ scope: "current", low: 60, high: 600 });
    expect(pendingRt.rows.map(row => row[0])).toEqual(Array.from({ length: 10 }, (_, index) => index + 1));
    await browser.$("#chromatogram-export-toggle").click(); await browser.$(".chromatogram-panel .plot-pending-actions button:first-child").click();
    await browser.$("#chromatogram-export-toggle").click();
    const narrowedRt = await csv("rt", "11-rt-confirmed-current"), range = narrowedRt.request.args.range as { low: number; high: number };
    expect(range.low).toBeGreaterThan(60); expect(range.high).toBeLessThan(600);
    expect(narrowedRt.rows.map(row => row[0])).toEqual(Array.from({ length: M73_SCAN_COUNT }, (_, index) => index).filter(index => index * 60 >= range.low && index * 60 <= range.high));
    await browser.$('input[name="chromatogram-range-scope"][value="full"]').click();
    const fullRt = await csv("rt", "12-rt-full"); expect(fullRt.request.args.range).toEqual({ scope: "full", low: null, high: null });
    expect(fullRt.rows.map(row => [row[0], row[3], row[4], row[5]])).toEqual(Array.from({ length: M73_SCAN_COUNT }, (_, index) => [index, index * 60, 452 * (index + 1), 100 * (index + 1)]));
    expect(new Set([pendingRt.request.args.exportToken, narrowedRt.request.args.exportToken, fullRt.request.args.exportToken]).size).toBe(1);
    expect(digest(fixture)).toBe(sourceSha);
    await browser.$("#chromatogram-export-toggle").click(); await capture("13-native-final-current-source");
  });
});
