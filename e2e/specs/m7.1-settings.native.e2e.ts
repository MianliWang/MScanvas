/** Real Tauri, native pickers and installed provider; no mocked IPC answers. */
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { en } from "../../apps/desktop/src/features/preferences/locales/en";
import { zhCN as zh } from "../../apps/desktop/src/features/preferences/locales/zh-CN";
import { nativeResourceOrigins } from "../support/nativeResourceOrigins";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const DIALOG = "[data-settings-dialog]";
const ROW = '.dataset-roster-list [role="option"]';
const CONVERT = ".conversion-plan button.primary-button";
const MZML_SHA = "a1228c104790670515f948f523dfe43caa7085cedb7d57d19ed07cbca5775ea7";
const RAW_SHA = "b3d97b3856dd1e8dd6846d21c58b1b1824c309480908fe4c2dfabe152bd6dd7b";
const evidence: unknown[] = [];
let output = "", mzml = "", raw = "", processId = 0;
let expectedDpi = 0;
const windowsViewports = new Map([
  [96, { width: 1920, height: 1080 }],
  [120, { width: 1200, height: 800 }],
  [144, { width: 1366, height: 768 }],
  [192, { width: 960, height: 640 }],
]);
const digest = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

async function calls() { return browser.execute(() => (window as unknown as { __mscanvasIpcCalls__: { command: string; args: Record<string, unknown> }[] }).__mscanvasIpcCalls__); }
type NativeRect = { left: number; top: number; right: number; bottom: number };
type WindowMetrics = {
  dpi: number; foregroundProcessId: number; executable: string;
  bounds: { client: NativeRect; visibleFrameInsideWorkArea: boolean };
};
function windowMetrics() {
  return JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolve(HERE, "../native/m7.1-window-metrics.ps1"), "-ApplicationProcessId", String(processId)], { encoding: "utf8", windowsHide: true })) as WindowMetrics;
}
function assertNativeViewport(metrics: WindowMetrics, state: { cssViewport: { width: number; height: number }; devicePixelRatio: number }) {
  expect(metrics.dpi).toBe(expectedDpi);
  expect(state.cssViewport).toEqual(windowsViewports.get(expectedDpi));
  expect(state.devicePixelRatio).toBe(expectedDpi / 96);
  expect(metrics.bounds.visibleFrameInsideWorkArea).toBe(true);
  const client = metrics.bounds.client;
  expect({ width: client.right - client.left, height: client.bottom - client.top }).toEqual({
    width: Math.round(state.cssViewport.width * state.devicePixelRatio),
    height: Math.round(state.cssViewport.height * state.devicePixelRatio),
  });
}
async function observeWindow(label: string) {
  const metrics = windowMetrics();
  const state = await browser.execute(() => ({
    cssViewport: { width: innerWidth, height: innerHeight },
    outerWindow: { width: outerWidth, height: outerHeight, x: screenX, y: screenY },
    screen: { width: screen.width, height: screen.height, availableWidth: screen.availWidth, availableHeight: screen.availHeight },
    devicePixelRatio, visualViewportScale: visualViewport?.scale,
    cssZoom: getComputedStyle(document.documentElement).zoom, documentHasFocus: document.hasFocus(),
  }));
  const observation = { kind: "window transition", label, metrics, ...state };
  evidence.push(observation);
  writeFileSync(join(output, "evidence.json"), JSON.stringify(evidence, null, 2));
  console.log(`M7.1 window observation: ${JSON.stringify(observation)}`);
  return observation;
}
function native(script: string, args: string[]): Promise<Record<string, unknown>> {
  const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolve(HERE, `../native/${script}.ps1`), ...args], { windowsHide: true });
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  return new Promise((settle, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error("The owned native helper exceeded its bounded lifetime.")); }, 65_000);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", code => {
      clearTimeout(timer);
      try {
        const result = JSON.parse(stdout.trim()) as Record<string, unknown>;
        evidence.push({ kind: "native helper", script, exitCode: code, result, stderr });
        if (code !== 0) throw new Error(JSON.stringify(result));
        settle(result);
      } catch (error) { reject(new Error(`${script}: ${String(error)}; ${stderr}; ${stdout}`)); }
    });
  });
}
async function capture(label: string) {
  const metrics = windowMetrics();
  const state = await browser.execute(() => ({
    cssViewport: { width: innerWidth, height: innerHeight }, devicePixelRatio,
    visualViewportScale: visualViewport?.scale, cssZoom: getComputedStyle(document.documentElement).zoom,
    locale: document.documentElement.lang, density: document.querySelector("[data-density]")?.getAttribute("data-density"),
    documentHasFocus: document.hasFocus(), activeId: document.activeElement?.id,
    activeTag: document.activeElement?.tagName, activeText: document.activeElement?.textContent,
    activeIsConvert: document.activeElement?.matches(".conversion-plan button.primary-button"),
    rows: [...document.querySelectorAll<HTMLElement>('.dataset-roster-list [role="option"]')].map(row => ({ handle: row.dataset.handle, height: row.getBoundingClientRect().height, name: row.textContent })),
    applicationOrigin: location.origin,
    resourceUrls: performance.getEntriesByType("resource").map(entry => entry.name),
  }));
  const resources = nativeResourceOrigins(state.resourceUrls, state.applicationOrigin);
  evidence.push({ kind: "actual Windows/Tauri", label, metrics, expectedDpi, ...state, ...resources });
  // Retain the rendered state even when a subsequent observation fails.
  await browser.saveScreenshot(join(output, `${label}.png`));
  const afterScreenshot = await observeWindow(`${label}: after screenshot`);
  assertNativeViewport(metrics, state);
  assertNativeViewport(afterScreenshot.metrics, afterScreenshot);
  expect(afterScreenshot.cssViewport).toEqual(state.cssViewport);
  expect(resources.externalResources).toEqual([]);
  return state;
}
async function openSettings(observe = false) {
  const entry = browser.$("[data-settings-entry]");
  await entry.scrollIntoView({ block: "center" });
  if (observe) await observeWindow("figure draft: after Settings opener scroll");
  await entry.click();
  await browser.$(DIALOG).waitForDisplayed();
  if (observe) await observeWindow("figure draft: after Settings opener click");
}
async function choose(value: string) { await browser.$(`${DIALOG} input[value="${value}"]`).click(); }
async function press(name: string) {
  await browser.$(DIALOG).$(name === en.close || name === zh.close ? `button[aria-label="${name}"]` : `button=${name}`).click();
}
async function returned() {
  await browser.$(DIALOG).waitForExist({ reverse: true });
  await browser.waitUntil(() => browser.execute(() => document.hasFocus() && document.activeElement?.matches("[data-settings-entry]") === true), { timeoutMsg: "Settings did not return natural foreground focus to its opener." });
}
async function add(path: string) {
  const before = await browser.$$(ROW).length;
  const button = browser.$("button=Add files…");
  await button.waitForEnabled();
  await button.scrollIntoView({ block: "center" });
  const handler = native("choose-workspace-files", ["-ApplicationProcessId", String(processId), "-Action", "choose", "-Path", path, "-TimeoutSeconds", "35"]);
  const [result] = await Promise.all([handler, button.click()]);
  expect(result.closed).toBe(true);
  expect(result.entered).toBe(true);
  await browser.waitUntil(async () => (await browser.$$(ROW).length) === before + 1);
}

describe("M7.1 focused real Windows Settings, figure and picker integration", function () {
  // These cases share one native session. A failed prerequisite ends the run;
  // later scenarios remain unproved instead of interacting with a stranded modal.
  this.bail(true);
  before(async () => {
    mzml = process.env["MSCANVAS_M71_MZML"] ?? "";
    raw = process.env["MSCANVAS_THERMO_FIXTURE"] ?? "";
    const root = process.env["MSCANVAS_M71_OUTPUT_ROOT"] ?? "";
    if (![root, mzml, raw].every(isAbsolute)) throw new Error("Existing absolute M7.1 native fixture/output paths are required; no acquisition is performed.");
    const suffix = relative(realpathSync(REPO), realpathSync(root));
    if (suffix === "" || (!suffix.startsWith("..") && !isAbsolute(suffix))) throw new Error("Native output must be outside Git.");
    expect(digest(mzml)).toBe(MZML_SHA);
    expect(digest(raw)).toBe(RAW_SHA);
    mkdirSync(root, { recursive: true });
    output = mkdtempSync(join(root, "native-"));
    const capabilities = browser.capabilities as unknown as Record<string, unknown>;
    processId = Number(capabilities["goog:processID"]);
    if (!Number.isSafeInteger(processId) || processId <= 0) throw new Error("No attributable application process ID.");
    expect(capabilities["browserName"]).toBe("webview2");
    await browser.$("[data-settings-entry]").waitForDisplayed();
    expect(await browser.execute(() => Object.keys((window as unknown as { __mscanvasIpcTable__: object }).__mscanvasIpcTable__))).toEqual([]);
    const metrics = windowMetrics();
    expect(realpathSync(metrics.executable)).toBe(realpathSync(resolve(REPO, "target/e2e/release/mscanvas-desktop.exe")));
    evidence.push({ kind: "identity", sourceHead: process.env["MSCANVAS_M71_SOURCE_HEAD"], binarySha256: digest(metrics.executable), mzmlSha256: digest(mzml), rawSha256: digest(raw), capabilities, metrics });
    expectedDpi = Number(process.env["MSCANVAS_M71_EXPECTED_DPI"] ?? metrics.dpi);
    if (!windowsViewports.has(expectedDpi)) throw new Error("M7.1 requires a measured 96/120/144/192-DPI native test window.");
    expect(metrics.dpi).toBe(expectedDpi);
    // Establish initial user-visible foreground once. Never call this after a
    // picker closes or as a repair for a failed focus assertion.
    if (process.env["MSCANVAS_M71_MANUAL_FOREGROUND"] === "1") {
      console.log(`Manual host action required: activate the MSCanvas window owned by PID ${processId}.`);
      await browser.waitUntil(async () => windowMetrics().foregroundProcessId === processId && await browser.execute(() => document.hasFocus()), {
        timeout: 90_000, interval: 1000, timeoutMsg: "The requested manual foreground action did not occur; native proof is blocked.",
      });
      evidence.push({ kind: "manual initial foreground", metrics: windowMetrics() });
    } else {
      const focused = await native("focus-window", ["-TitleContains", "MSCanvas"]);
      expect(focused.focused).toBe(true);
    }
    expect(windowMetrics().foregroundProcessId).toBe(processId);
    await browser.waitUntil(() => browser.execute(() => document.hasFocus()));
    console.log(`M7.1 native evidence: ${output}`);
  });
  after(() => {
    // Preserve preparation and host refusals even if before-all fails.
    if (output) writeFileSync(join(output, "evidence.json"), JSON.stringify(evidence, null, 2));
  });
  afterEach(async () => {
    if (!output) return;
    const console = await browser.execute(() => (window as unknown as { __mscanvasConsole__: unknown[] }).__mscanvasConsole__);
    evidence.push({ kind: "console and IPC", console, calls: await calls() });
    writeFileSync(join(output, "evidence.json"), JSON.stringify(evidence, null, 2));
    expect(digest(mzml)).toBe(MZML_SHA);
    expect(digest(raw)).toBe(RAW_SHA);
    expect(console).toEqual([]);
    expect(await browser.execute(() => Object.keys((window as unknown as { __mscanvasIpcTable__: object }).__mscanvasIpcTable__))).toEqual([]);
  });

  it("applies, cancels, resets and dismisses Settings in the actual app", async () => {
    const viewport = windowsViewports.get(expectedDpi)!;
    await observeWindow("before requested viewport");
    await native("m7.1-size-window", ["-ApplicationProcessId", String(processId), "-ExpectedDpi", String(expectedDpi), "-CssWidth", String(viewport.width), "-CssHeight", String(viewport.height)]);
    await browser.waitUntil(() => browser.execute((width, height) => innerWidth === width && innerHeight === height, viewport.width, viewport.height), { timeoutMsg: "The real native client size did not reach the required CSS viewport." });
    const sized = await observeWindow("after requested native client size");
    assertNativeViewport(sized.metrics, sized);
    await openSettings();
    await choose("zh-CN");
    await choose("compact");
    await capture("01-native-chinese-preview");
    await press(zh.apply);
    await returned();
    await openSettings();
    await press(zh.reset);
    expect(await browser.execute(() => document.documentElement.lang)).toBe("en");
    await press(en.cancel);
    await returned();
    expect(await browser.execute(() => document.documentElement.lang)).toBe("zh-CN");
    await openSettings();
    await choose("en");
    await browser.keys("Escape");
    await returned();
    expect(await browser.execute(() => document.documentElement.lang)).toBe("zh-CN");
    await openSettings();
    await press(zh.reset);
    await press(en.apply);
    await returned();
  });

  it("reads retained lawful mzML and exports a real PNG from the shared numeric fields", async () => {
    await add(mzml);
    await browser.$('.spectrum-table[role="grid"]').waitForDisplayed({ timeout: 60_000 });
    await browser.$('[role="grid"] [role="row"][aria-rowindex="2"]').click();
    await browser.$('.spectrum-panel input[id$="-widthPx"]').waitForDisplayed({ timeout: 60_000 });
    await browser.$("#chromatogram-export-toggle").click();
    const before = await capture("02-native-real-roster-figure");
    await browser.$('.spectrum-panel input[id$="-widthPx"]').setValue("00640");
    await observeWindow("figure draft: after width input");
    await browser.$('.spectrum-panel input[id$="-heightPx"]').setValue("480");
    await observeWindow("figure draft: after height input");
    await browser.$('.spectrum-panel input[id$="-pngDpi"]').setValue("144");
    await observeWindow("figure draft: after PNG DPI input");
    await openSettings(true);
    await choose("zh-CN");
    await observeWindow("figure draft: after locale choice");
    await choose("compact");
    await observeWindow("figure draft: after density choice");
    const compact = await capture("03-native-real-compact-preview");
    expect(compact.rows[0].height).toBeLessThan(before.rows[0].height);
    await press(zh.apply);
    await returned();
    const figure = join(output, "m71-shared-fields-640x480-144dpi.png");
    expect(existsSync(figure)).toBe(false);
    const button = browser.$('.spectrum-panel').$('button=Export PNG…');
    await button.scrollIntoView({ block: "center" });
    await button.waitForEnabled();
    const handler = native("save-dialog", ["-ApplicationProcessId", String(processId), "-Title", "Export spectrum figure", "-Action", "save", "-Path", figure, "-TimeoutSeconds", "35"]);
    const [result] = await Promise.all([handler, button.click()]);
    expect(result.invoked).toBe(true);
    await browser.waitUntil(() => existsSync(figure), { timeout: 30_000 });
    const png = readFileSync(figure);
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.readUInt32BE(16)).toBe(640);
    expect(png.readUInt32BE(20)).toBe(480);
    let pixelsPerMeter = 0;
    for (let cursor = 8; cursor + 12 <= png.length;) {
      const length = png.readUInt32BE(cursor), type = png.toString("ascii", cursor + 4, cursor + 8);
      if (type === "pHYs") { pixelsPerMeter = png.readUInt32BE(cursor + 8); expect(png[cursor + 16]).toBe(1); }
      cursor += 12 + length;
    }
    expect(pixelsPerMeter).toBe(Math.round(144 / 0.0254));
    const request = (await calls()).reverse().find(call => call.command === "begin_selected_spectrum_export");
    expect(request?.args["settings"]).toEqual({ widthPx: 640, heightPx: 480, pngDpi: 144, theme: "light" });
    evidence.push({ kind: "real PNG", file: figure, sha256: digest(figure), byteLength: png.length, pixelsPerMeter, request });
    await capture("04-native-real-png-result");
  });

  it("naturally returns from the affected real cancelled destination picker", async () => {
    await add(raw);
    await browser.$(".dataset-roster-list").$("li*=FT-HCD-MSX.raw").click();
    await browser.$(CONVERT).waitForEnabled({ timeout: 60_000 });
    await browser.$(CONVERT).scrollIntoView({ block: "center" });
    const handler = native("choose-conversion-folder", ["-ApplicationProcessId", String(processId), "-Action", "escape", "-TimeoutSeconds", "35"]);
    const [result] = await Promise.all([handler, browser.$(CONVERT).click()]);
    expect(result.closed).toBe(true);
    await browser.$(CONVERT).waitForEnabled();
    await browser.waitUntil(() => browser.execute(() => document.hasFocus() && document.activeElement?.matches(".conversion-plan button.primary-button") === true), { timeoutMsg: "Cancelled native picker did not naturally return focus to Convert." });
    expect(windowMetrics().foregroundProcessId).toBe(processId);
    await capture("05-native-cancelled-picker-natural-return");
    await openSettings();
    await press(zh.reset);
    await press(en.cancel);
    await returned();
    expect(await browser.$(CONVERT).isEnabled()).toBe(true);
  });
});
