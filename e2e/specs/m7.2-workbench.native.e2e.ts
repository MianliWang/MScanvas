/** Real Windows/Tauri workbench; pass-through observation only, no mock answers. */
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeResourceOrigins } from "../support/nativeResourceOrigins";

const HERE = dirname(fileURLToPath(import.meta.url)), REPO = resolve(HERE, "../..");
const INPUTS = resolve(REPO, ".tmp/m72-evidence/native-inputs");
const MZML_SHA = "a1228c104790670515f948f523dfe43caa7085cedb7d57d19ed07cbca5775ea7";
const RAW_SHA = "b3d97b3856dd1e8dd6846d21c58b1b1824c309480908fe4c2dfabe152bd6dd7b";
const ROW = ".grouped-roster [data-handle]", ADD = ".dataset-roster-actions .primary-button";
const evidence: unknown[] = [];
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
let output = "", processId = 0, dpi = 0, firstHandle = "", secondHandle = "", rawHandle = "";
let viewport = { width: 1366, height: 768 };
type Rect = { left: number; top: number; right: number; bottom: number };
type Metrics = { dpi: number; foregroundProcessId: number; executable: string; bounds: { client: Rect; visibleFrameInsideWorkArea: boolean } };
function metrics(): Metrics {
  return JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolve(HERE, "../native/m7.1-window-metrics.ps1"), "-ApplicationProcessId", String(processId)], { encoding: "utf8", windowsHide: true })) as Metrics;
}
function saveEvidence() { if (output) writeFileSync(join(output, "evidence.json"), JSON.stringify(evidence, null, 2)); }
async function calls() { return browser.execute(() => Reflect.get(window, "__mscanvasIpcCalls__") as { command: string; args: Record<string, unknown> }[]); }
async function previewReads() {
  return browser.execute(() => performance.getEntriesByType("resource")
    .filter(entry => new URL(entry.name).origin === "http://ipc.localhost" && new URL(entry.name).pathname === "/open_mzml_preview")
    .map(entry => ({ url: entry.name, startTime: entry.startTime, responseEnd: (entry as PerformanceResourceTiming).responseEnd, duration: entry.duration })));
}
function helper(script: string, args: string[]) {
  const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolve(HERE, `../native/${script}.ps1`), "-ApplicationProcessId", String(processId), ...args], { windowsHide: true });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += String(chunk); }); child.stderr.on("data", chunk => { stderr += String(chunk); });
  return new Promise<Record<string, unknown>>((done, fail) => {
    const timer = setTimeout(() => { child.kill(); fail(Error("Owned picker helper exceeded its bounded lifetime.")); }, 60_000);
    child.once("error", error => { clearTimeout(timer); fail(error); });
    child.once("close", code => {
      clearTimeout(timer); evidence.push({ kind: "owned helper", script, args, code, stdout, stderr }); saveEvidence();
      try { const result = JSON.parse(stdout.trim()) as Record<string, unknown>; if (code !== 0) throw Error(stdout); done(result); } catch (error) { fail(error); }
    });
  });
}
async function capture(label: string, validate = true) {
  const owned = metrics();
  const state = await browser.execute(() => ({ css: { width: innerWidth, height: innerHeight }, dpr: devicePixelRatio, cssZoom: getComputedStyle(document.documentElement).zoom,
    locale: document.documentElement.lang, density: document.querySelector("[data-density]")?.getAttribute("data-density"), focus: { hasFocus: document.hasFocus(), tag: document.activeElement?.tagName, text: document.activeElement?.textContent, add: document.activeElement?.matches(".dataset-roster-actions .primary-button") },
    rows: [...document.querySelectorAll<HTMLElement>(".grouped-roster [data-handle]")].map(row => ({ handle: row.dataset.handle, group: row.dataset.group, name: row.textContent, selected: row.getAttribute("aria-selected"), checked: row.querySelector<HTMLInputElement>("input")?.checked })),
    groupCounts: [...document.querySelectorAll(".roster-group-header")].map(group => ({ id: group.getAttribute("data-group-id"), text: group.textContent })),
    source: document.querySelector(".dataset-row.is-active")?.getAttribute("data-handle"),
    applicationOrigin: location.origin, resourceUrls: performance.getEntriesByType("resource").map(entry => entry.name),
    horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
    trace: Reflect.get(window, "__m72NativeTrace") ?? [],
    invokeDescriptor: { writable: Object.getOwnPropertyDescriptor(Reflect.get(window, "__TAURI_INTERNALS__"), "invoke")?.writable, configurable: Object.getOwnPropertyDescriptor(Reflect.get(window, "__TAURI_INTERNALS__"), "invoke")?.configurable },
  }));
  const resources = nativeResourceOrigins(state.resourceUrls, state.applicationOrigin);
  await browser.saveScreenshot(join(output, `${label}.png`));
  const png = readFileSync(join(output, `${label}.png`));
  const raster = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  evidence.push({ label, kind: "actual Tauri WebView2; automated mouse/keyboard, not physical touch", owned, ...state, ...resources, raster, previewReads: await previewReads() }); saveEvidence();
  if (!validate) return state;
  expect(owned.dpi).toBe(dpi); expect(state.dpr).toBe(dpi / 96); expect(state.css).toEqual(viewport);
  expect(owned.bounds.visibleFrameInsideWorkArea).toBe(true);
  const physical = { width: owned.bounds.client.right - owned.bounds.client.left, height: owned.bounds.client.bottom - owned.bounds.client.top };
  expect(physical).toEqual({ width: Math.round(viewport.width * state.dpr), height: Math.round(viewport.height * state.dpr) });
  expect(raster).toEqual(physical); expect(state.horizontalOverflow).toBeLessThanOrEqual(1); expect(resources.externalResources).toEqual([]);
  return state;
}
async function point(selector: string) {
  return browser.execute(selector => { const box = document.querySelector(selector)!.getBoundingClientRect(); return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }; }, selector);
}
const row = (handle: string) => `${ROW}[data-handle="${handle}"]`;
async function add(file: string) {
  const before = await browser.$$(ROW).map(row => row.getAttribute("data-handle"));
  await browser.$(ADD).waitForEnabled();
  const [result] = await Promise.all([helper("choose-workspace-files", ["-Action", "choose", "-Path", file, "-TimeoutSeconds", "35"]), browser.$(ADD).click()]);
  expect(result.closed).toBe(true); expect(result.entered).toBe(true);
  await browser.waitUntil(async () => (await browser.$$(ROW).length) === before.length + 1);
  const added = (await browser.$$(ROW).map(row => row.getAttribute("data-handle"))).find(handle => !before.includes(handle));
  if (!added) throw Error("No unique new native handle."); return added;
}
async function settings(locale: "en" | "zh-CN", density: "comfortable" | "compact") {
  await browser.$("[data-settings-entry]").click();
  await browser.$(`[data-settings-dialog] input[value="${locale}"]`).click();
  await browser.$(`[data-settings-dialog] input[value="${density}"]`).click();
  await browser.$("[data-settings-dialog]").$(locale === "en" ? "button=Apply" : "button=应用").click();
  await browser.$("[data-settings-dialog]").waitForExist({ reverse: true });
  await browser.waitUntil(() => browser.execute(() => document.hasFocus() && document.activeElement?.matches("[data-settings-entry]") === true));
}

describe("M7.2 affected final native workbench paths", function () {
  this.bail(true);
  before(async () => {
    const root = resolve(REPO, ".tmp/m72-evidence"); mkdirSync(root, { recursive: true }); output = mkdtempSync(join(root, "native-"));
    try {
    for (const leaf of ["M72-retained-A.mzML", "M72-retained-B.mzML"]) expect(digest(join(INPUTS, "retained", leaf))).toBe(MZML_SHA);
    expect(digest(join(INPUTS, "retained/M72-retained.raw"))).toBe(RAW_SHA);
    const capabilities = browser.capabilities as unknown as Record<string, unknown>;
    processId = Number(capabilities["goog:processID"]); if (!Number.isSafeInteger(processId) || processId <= 0) throw Error("No owned native process identity.");
    await browser.$("[data-settings-entry]").waitForDisplayed();
    const owned = metrics(); dpi = owned.dpi;
    evidence.push({ kind: "native build identity", capabilities, owned, binarySha256: digest(owned.executable), productionManifestSha256: process.env["MSCANVAS_M72_PRODUCTION_SHA"], sourceHead: process.env["MSCANVAS_M72_SOURCE_HEAD"] }); saveEvidence();
    expect(realpathSync(owned.executable)).toBe(realpathSync(resolve(REPO, "target/e2e/release/mscanvas-desktop.exe")));
    expect(digest(owned.executable)).toBe(process.env["MSCANVAS_M72_BINARY_SHA"]);
    expect(capabilities["browserName"]).toBe("webview2");
    expect(await browser.execute(() => Object.keys(Reflect.get(window, "__mscanvasIpcTable__") as object))).toEqual([]);
    console.log(`M7.2 NATIVE INITIAL CLICK: activate the owned MSCanvas window, PID ${processId}; evidence ${output}`);
    await browser.waitUntil(async () => metrics().foregroundProcessId === processId && await browser.execute(() => document.hasFocus()), { timeout: 90_000, interval: 1000, timeoutMsg: "Fresh initial host foreground was not established." });
    const available = await browser.execute(() => ({ width: screen.availWidth, height: screen.availHeight }));
    viewport = { width: Math.min(1366, Math.floor(available.width - 40)), height: Math.min(768, Math.floor(available.height - 80)) };
    if (viewport.width < 960 || viewport.height < 640) throw Error("Current owned monitor cannot contain the targeted native viewport.");
    await helper("m7.1-size-window", ["-ExpectedDpi", String(dpi), "-CssWidth", String(viewport.width), "-CssHeight", String(viewport.height)]);
    await browser.waitUntil(() => browser.execute((v) => innerWidth === v.width && innerHeight === v.height, viewport));
    await browser.execute(() => {
      const trace: unknown[] = []; Reflect.set(window, "__m72NativeTrace", trace);
      // Tauri's invoke property is immutable. Resource Timing observes the real
      // Windows IPC request interval without replacing the command or response.
      new MutationObserver(() => trace.push({ phase: "surface", surface: document.querySelector(".workbench-shell")!.getAttribute("data-surface"), time: performance.now() }))
        .observe(document.querySelector(".workbench-shell")!, { attributes: true, attributeFilter: ["data-surface"] });
    });
    await capture("01-measured-native-empty");
    const normalViewport = viewport;
    viewport = { width: 960, height: 640 };
    await helper("m7.1-size-window", ["-ExpectedDpi", String(dpi), "-CssWidth", "960", "-CssHeight", "640"]);
    await browser.waitUntil(() => browser.execute(() => innerWidth === 960 && innerHeight === 640));
    expect(await browser.$('[aria-controls="workbench-inspector"]').isEnabled()).toBe(false);
    expect(await browser.$("#workbench-evidence .empty-state").isDisplayed()).toBe(true);
    await capture("review-native-narrow-empty");
    viewport = normalViewport;
    await helper("m7.1-size-window", ["-ExpectedDpi", String(dpi), "-CssWidth", String(viewport.width), "-CssHeight", String(viewport.height)]);
    await browser.waitUntil(() => browser.execute((v) => innerWidth === v.width && innerHeight === v.height, viewport));
    await browser.$('[aria-controls="workbench-roster"]').click();
    } catch (cause) {
      evidence.push({ kind: "native setup failure", message: String(cause) }); saveEvidence();
      try { await capture("failed-native-setup", false); } catch (captureError) { evidence.push({ kind: "setup capture unavailable", message: String(captureError) }); saveEvidence(); }
      throw cause;
    }
  });
  after(saveEvidence);
  afterEach(async function () {
    if (!output) return;
    evidence.push({ test: this.currentTest?.title, state: this.currentTest?.state, console: await browser.execute(() => Reflect.get(window, "__mscanvasConsole__")), calls: await calls() }); saveEvidence();
    if (this.currentTest?.state === "failed") await capture("failed-native-state", false);
    expect(await browser.execute(() => Reflect.get(window, "__mscanvasConsole__"))).toEqual([]);
    expect(await browser.execute(() => Object.keys(Reflect.get(window, "__mscanvasIpcTable__") as object))).toEqual([]);
    for (const leaf of ["M72-retained-A.mzML", "M72-retained-B.mzML"]) expect(digest(join(INPUTS, "retained", leaf))).toBe(MZML_SHA);
  });
  it("retains real source, figure drafts and Settings/Home ownership while a preview completes", async () => {
    firstHandle = await add(join(INPUTS, "retained/M72-retained-A.mzML"));
    await browser.$(".spectrum-table").waitForDisplayed({ timeout: 60_000 });
    secondHandle = await add(join(INPUTS, "retained/M72-retained-B.mzML"));
    await browser.$(row(secondHandle)).click();
    await browser.$(`${row(secondHandle)}.is-active`).waitForExist({ timeout: 60_000 });
    await browser.waitUntil(async () => (await previewReads()).length === 2);
    await browser.$(".spectrum-table").waitForExist();
    const priorReads = await previewReads();
    const source = await point(row(firstHandle)), navigation = await point(".workbench-navigation button:nth-child(2)");
    await browser.performActions([{ type: "pointer", id: "native-navigation", parameters: { pointerType: "mouse" }, actions: [
      { type: "pointerMove", ...source, origin: "viewport", duration: 0 }, { type: "pointerDown", button: 0 }, { type: "pointerUp", button: 0 },
      { type: "pointerMove", ...navigation, origin: "viewport", duration: 0 }, { type: "pointerDown", button: 0 }, { type: "pointerUp", button: 0 },
    ] }]); await browser.releaseActions();
    await browser.$("#workbench-conversion").waitForDisplayed();
    await browser.$(`${row(firstHandle)}.is-active`).waitForExist({ timeout: 60_000 });
    await browser.waitUntil(async () => (await previewReads()).length === priorReads.length + 1);
    const trace = await browser.execute(() => Reflect.get(window, "__m72NativeTrace") as { phase: string; time: number; surface?: string }[]);
    const read = (await previewReads()).at(-1)!;
    evidence.push({ kind: "real navigation/read overlap; Windows IPC Resource Timing", read, priorReads, surfaces: trace }); saveEvidence();
    expect(read.responseEnd).toBeGreaterThan(read.startTime);
    expect(trace.some(item => item.phase === "surface" && item.surface === "conversion" && item.time >= read.startTime && item.time < read.responseEnd)).toBe(true);
    await browser.$(".workbench-home").click();
    await browser.$('.spectrum-table [role="row"][aria-rowindex="2"]').click();
    await browser.$('.spectrum-panel input[id$="-widthPx"]').waitForDisplayed({ timeout: 60_000 });
    await browser.$('.spectrum-panel input[id$="-widthPx"]').setValue("0640");
    const before = await calls();
    await settings("zh-CN", "compact"); await capture("02-native-zh-retained-evidence");
    await browser.$(".workbench-navigation button:nth-child(2)").click(); await browser.$(".workbench-home").click();
    expect(await browser.$('.spectrum-panel input[id$="-widthPx"]').getValue()).toBe("0640");
    expect(await browser.$(`${row(firstHandle)}.is-active`).isExisting()).toBe(true);
    expect(await calls()).toEqual(before);
    await settings("en", "comfortable");
  });
  it("review regression: exposes loaded details and announces real in-group keyboard targets", async () => {
    const normalViewport = viewport;
    viewport = { width: 960, height: 640 };
    await helper("m7.1-size-window", ["-ExpectedDpi", String(dpi), "-CssWidth", "960", "-CssHeight", "640"]);
    await browser.waitUntil(() => browser.execute(() => innerWidth === 960 && innerHeight === 640));
    const before = await calls();
    await browser.$('[aria-controls="workbench-inspector"]').click();
    await browser.$("#workbench-inspector").waitForDisplayed();
    expect(await browser.$("#workbench-inspector").getText()).toContain("M72-retained-A.mzML");
    expect(await browser.$("#workbench-evidence").isDisplayed()).toBe(false);
    await capture("review-native-narrow-loaded-details");
    await browser.$('[aria-controls="workbench-inspector"]').click();
    expect(await browser.$("#workbench-evidence").isDisplayed()).toBe(true);
    viewport = normalViewport;
    await helper("m7.1-size-window", ["-ExpectedDpi", String(dpi), "-CssWidth", String(viewport.width), "-CssHeight", String(viewport.height)]);
    await browser.waitUntil(() => browser.execute((v) => innerWidth === v.width && innerHeight === v.height, viewport));
    await browser.$('[aria-controls="workbench-roster"]').click();
    for (const language of ["en", "zh-CN"] as const) {
      await settings(language, "comfortable");
      await browser.$(`${row(firstHandle)} .row-drag-handle`).click();
      await browser.keys("\uE00D");
      await browser.$('.grouped-roster[data-drag-active="true"]').waitForExist();
      await browser.keys("ArrowDown");
      const expected = language === "en" ? "Move to Ungrouped, position 2 of 2 (1 selected)." : "移至未分组，第 2 位，共 2 个采集（已选 1 个）。";
      await browser.waitUntil(async () => await browser.$(".organization-notice").getText() === expected);
      expect(await browser.$$(ROW).map(node => node.getAttribute("data-handle"))).toEqual([firstHandle, secondHandle]);
      evidence.push({ kind: "native pre-commit keyboard destination", language, announcement: await browser.$(".organization-notice").getText() });
      await capture(`review-native-keyboard-${language}`);
      await browser.keys("Enter");
      await browser.$('.grouped-roster[data-drag-active="true"]').waitForExist({ reverse: true });
      expect(await browser.$$(ROW).map(node => node.getAttribute("data-handle"))).toEqual([secondHandle, firstHandle]);
      await browser.$(language === "en" ? "button=Undo organization" : "button=撤销组织操作").click();
      expect(await browser.$$(ROW).map(node => node.getAttribute("data-handle"))).toEqual([firstHandle, secondHandle]);
    }
    await settings("en", "comfortable");
    expect(await calls()).toEqual(before);
    expect(await browser.$(`${row(firstHandle)}.is-active`).isExisting()).toBe(true);
    expect(await browser.$('.spectrum-panel input[id$="-widthPx"]').getValue()).toBe("0640");
  });
  it("moves two real native acquisitions locally and accepts an actual Explorer file/folder drop into ungrouped", async () => {
    rawHandle = await add(join(INPUTS, "retained/M72-retained.raw"));
    await browser.performActions([{ type: "key", id: "native-selection", actions: [{ type: "keyDown", value: "\uE009" }] }]);
    await browser.$(row(firstHandle)).click(); await browser.releaseActions();
    await browser.$("button=New group").click(); await browser.$("#organization-group-name").setValue("Native group"); await browser.$("button=Save group").click();
    const before = await calls(), source = await point(`${row(firstHandle)} .row-drag-handle`);
    await browser.performActions([{ type: "pointer", id: "native-organization", parameters: { pointerType: "mouse" }, actions: [{ type: "pointerMove", ...source, origin: "viewport", duration: 0 }, { type: "pointerDown", button: 0 }, { type: "pointerMove", x: source.x + 12, y: source.y + 8, origin: "viewport", duration: 180 }] }]);
    await browser.$('.grouped-roster[data-drag-active="true"]').waitForExist(); await capture("03-native-drag-pickup");
    await browser.performActions([{ type: "pointer", id: "native-organization", parameters: { pointerType: "mouse" }, actions: [{ type: "pointerMove", ...await point('[data-group-id="group-1"]'), origin: "viewport", duration: 400 }] }]);
    await capture("04-native-drag-target");
    await browser.performActions([{ type: "pointer", id: "native-organization", parameters: { pointerType: "mouse" }, actions: [{ type: "pointerUp", button: 0 }] }]); await browser.releaseActions();
    await browser.$('.grouped-roster[data-drag-active="true"]').waitForExist({ reverse: true });
    expect(await browser.$(row(firstHandle)).getAttribute("data-group")).toBe("group-1"); expect(await browser.$(row(rawHandle)).getAttribute("data-group")).toBe("group-1");
    expect(await browser.$(`${row(rawHandle)} input`).isSelected()).toBe(true); expect(await browser.$(`${row(firstHandle)} input`).isSelected()).toBe(false);
    expect(await calls()).toEqual(before); await capture("05-native-drag-committed");
    const oldHandles = await browser.$$(ROW).map(row => row.getAttribute("data-handle"));
    const dropBefore = await calls();
    const automatedDrop = process.env["MSCANVAS_M72_OS_DROP"] === "explorer";
    if (automatedDrop) {
      const target = await point('[data-group-id="group-1"]');
      const result = await helper("m7.2-explorer-drop", ["-TargetCssX", String(target.x), "-TargetCssY", String(target.y), "-ExpectedDpi", String(dpi)]);
      expect(result.dropped).toBe(true);
    } else {
      console.log(`M7.2 NATIVE OS DROP NOW: in Explorer, drag both entries from ${join(INPUTS, "TaskDrop")} onto Native group in MSCanvas. They must enter Ungrouped. No DOM paths will be injected.`);
      writeFileSync(join(output, "human-drop-ready.json"), JSON.stringify({ processId, sourceDirectory: join(INPUTS, "TaskDrop"), expectedAdded: 3 }));
    }
    await browser.waitUntil(async () => (await browser.$$(ROW).length) === oldHandles.length + 3, { timeout: 120_000, interval: 1000, timeoutMsg: "Actual Explorer file/folder drop was not observed; native OS drop proof remains blocked." });
    const state = await capture("06-native-actual-os-file-and-folder-drop");
    const added = state.rows.filter(item => !oldHandles.includes(item.handle ?? "")); expect(added).toHaveLength(3); expect(added.every(item => item.group === "ungrouped")).toBe(true);
    expect(await browser.$('[data-group-id="group-1"] .group-count').getText()).toBe("2");
    expect((await calls()).slice(dropBefore.length).filter(call => call.command === "open_mzml_preview")).toEqual([]);
    expect((await calls()).filter(call => call.command === "subscribe_workspace_drop_updates")).toEqual(before.filter(call => call.command === "subscribe_workspace_drop_updates"));
    evidence.push({ kind: automatedDrop ? "Windows-input-automated actual Explorer OS import" : "human-assisted actual OS import", added, unchangedInternalGroupCount: 2 }); saveEvidence();
  });
  it("naturally returns from the affected acquisition picker cancellation without a focus rescue", async () => {
    const before = await calls();
    const [result] = await Promise.all([helper("choose-workspace-files", ["-Action", "escape", "-TimeoutSeconds", "35"]), browser.$(ADD).click()]);
    expect(result.closed).toBe(true);
    await browser.$(ADD).waitForEnabled();
    // No click, focus() or foreground helper after cancellation.
    await browser.waitUntil(() => browser.execute(() => document.hasFocus() && document.activeElement?.matches(".dataset-roster-actions .primary-button") === true));
    expect(metrics().foregroundProcessId).toBe(processId);
    const state = await capture("07-native-picker-cancel-natural-return"); expect(state.rows).toHaveLength(6);
    expect((await calls()).slice(before.length).filter(call => call.command === "open_mzml_preview")).toEqual([]);
  });
});
