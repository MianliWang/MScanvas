/** Real Windows/Tauri campaign. Retained acquisition copies and explicitly synthetic mzML. */
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { WorkspaceConversionUpdate, WorkspaceRoster } from "../../apps/desktop/src/features/mzml-preview/contracts";
import { nativeResourceOrigins } from "../support/nativeResourceOrigins";
import { inspectNativePng } from "../support/m74NativeFixture";

const HERE = dirname(fileURLToPath(import.meta.url)), REPO = resolve(HERE, "../..");
const PANEL = ".conversion-panel", CONVERT = PANEL + " .conversion-plan button.primary-button", RESULT = PANEL + " .conversion-running";
const ROWS = ".grouped-roster [data-handle]", FIGURE = '[role="dialog"].figure-export-dialog';
const input = process.env.MSCANVAS_M74_INPUT_ROOT;
const evidence: unknown[] = [], sources = new Map<string, string>();
let output = "", processId = 0, dpi = 0, lastOutput = "";
let viewport = { width: 1366, height: 768 };
type Rect = { left: number; top: number; right: number; bottom: number };
type Metrics = { dpi: number; mainWindow: number; foregroundProcessId: number; executable: string; bounds: { client: Rect; visibleFrameInsideWorkArea: boolean } };
function digest(path: string) {
  const hash = createHash("sha256"), file = openSync(path, "r"), bytes = Buffer.alloc(1024 * 1024);
  try { let count; while ((count = readSync(file, bytes, 0, bytes.length, null)) > 0) hash.update(bytes.subarray(0, count)); }
  finally { closeSync(file); }
  return hash.digest("hex");
}
function metrics(): Metrics {
  return JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolve(HERE, "../native/m7.1-window-metrics.ps1"), "-ApplicationProcessId", String(processId)], { encoding: "utf8", windowsHide: true })) as Metrics;
}
function saveEvidence() { if (output) writeFileSync(join(output, "evidence.json"), JSON.stringify(evidence, null, 2)); }
function record(value: unknown) { evidence.push(value); saveEvidence(); }
async function calls() { return browser.execute(() => Reflect.get(window, "__mscanvasIpcCalls__") as { command: string; args: Record<string, unknown> }[]); }
async function read<T>(command: "get_workspace_conversion_state" | "get_workspace_roster"): Promise<T> {
  return browser.execute(async cmd => {
    const api = Reflect.get(window, "__TAURI_INTERNALS__") as { invoke: (command: string) => Promise<T> };
    return api.invoke(cmd);
  }, command);
}
async function state() { return (await read<WorkspaceConversionUpdate>("get_workspace_conversion_state")).state; }
async function roster() { return read<WorkspaceRoster>("get_workspace_roster"); }
function helper(script: string, args: string[], ownedWindow = true, lifetime = 60_000) {
  const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolve(HERE, "../native/" + script + ".ps1"),
    ...(ownedWindow ? ["-ApplicationProcessId", String(processId)] : []), ...args], { windowsHide: true });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += String(chunk); }); child.stderr.on("data", chunk => { stderr += String(chunk); });
  return new Promise<Record<string, unknown>>((done, fail) => {
    const timer = setTimeout(() => { child.kill(); fail(Error("Owned native helper exceeded its bounded lifetime.")); }, lifetime);
    child.once("error", error => { clearTimeout(timer); fail(error); });
    child.once("close", code => {
      clearTimeout(timer); record({ kind: "owned helper", script, args, code, stdout, stderr, helperPid: child.pid });
      try { if (code !== 0) throw Error(stdout + stderr); done(stdout.trim() ? JSON.parse(stdout.trim()) as Record<string, unknown> : {}); } catch (error) { fail(error); }
    });
  });
}
async function reveal(selector: string) { await browser.execute(css => document.querySelector(css)!.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" }), selector); }
async function remember(selector: string, name: string | null = null) {
  await browser.execute((css, text) => {
    const matches = [...document.querySelectorAll(css)].filter(node => text === null || node.textContent === text);
    if (matches.length !== 1) throw Error("Expected one native picker initiating control.");
    Reflect.set(window, "__m74PickerTrigger", matches[0]);
  }, selector, name);
}
async function naturalReturn(label: string, replacementConvert = false) {
  try {
    await browser.waitUntil(async () => metrics().foregroundProcessId === processId && await browser.execute(replacement => {
      const target = replacement ? document.querySelector(".conversion-plan button.primary-button") : Reflect.get(window, "__m74PickerTrigger");
      return document.hasFocus() && document.activeElement === target;
    }, replacementConvert), { timeout: 15_000, interval: 500, timeoutMsg: "The native picker did not return naturally to its initiating action." });
  } finally { record({ kind: "natural picker return", label, replacementConvert, owned: metrics(), focus: await browser.execute(() => ({ focused: document.hasFocus(), element: document.activeElement?.outerHTML })) }); }
}
async function capture(label: string, validate = true) {
  const owned = metrics();
  const screenState = await browser.execute(() => ({ css: { width: innerWidth, height: innerHeight }, dpr: devicePixelRatio,
    focus: { hasFocus: document.hasFocus(), element: document.activeElement?.outerHTML }, language: document.documentElement.lang,
    body: document.body.innerText, horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
    mockKeys: Object.keys(Reflect.get(window, "__mscanvasIpcTable__") as object), applicationOrigin: location.origin,
    resourceUrls: performance.getEntriesByType("resource").map(entry => entry.name), console: Reflect.get(window, "__mscanvasConsole__") ?? [],
    invokeWritable: Object.getOwnPropertyDescriptor(Reflect.get(window, "__TAURI_INTERNALS__"), "invoke")?.writable }));
  const path = join(output, label + ".png"); await browser.saveScreenshot(path);
  const png = readFileSync(path), raster = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  const resources = nativeResourceOrigins(screenState.resourceUrls, screenState.applicationOrigin);
  record({ label, owned, ...screenState, ...resources, raster, calls: await calls() });
  if (validate) {
    expect(owned.foregroundProcessId).toBe(processId); expect(screenState.focus.hasFocus).toBe(true);
    expect(owned.dpi).toBe(dpi); expect(screenState.dpr).toBe(dpi / 96); expect(screenState.css).toEqual(viewport);
    expect(owned.bounds.visibleFrameInsideWorkArea).toBe(true);
    expect(raster).toEqual({ width: owned.bounds.client.right - owned.bounds.client.left, height: owned.bounds.client.bottom - owned.bounds.client.top });
    expect(screenState.horizontalOverflow).toBeLessThanOrEqual(1); expect(resources.externalResources).toEqual([]);
    expect(screenState.mockKeys).toEqual([]); expect(screenState.invokeWritable).toBe(false); expect(screenState.console).toEqual([]);
  }
}
async function showRoster() {
  const toggle = browser.$('[aria-controls="workbench-roster"]');
  if (await toggle.isExisting() && await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
}
async function workbench() { await browser.$(".workbench-home").click(); }
async function conversion() { await browser.$("button=Conversion & results").click(); await browser.$(PANEL).waitForDisplayed(); }
async function add(path: string) {
  const before = (await roster()).datasets.length;
  await workbench(); await showRoster();
  await browser.$("button=Add files…").waitForEnabled();
  const [result] = await Promise.all([helper("choose-workspace-files", ["-Action", "choose", "-Path", path, "-TimeoutSeconds", "35"]), browser.$("button=Add files…").click()]);
  expect(result.invoked).toBe(true);
  await browser.waitUntil(async () => (await roster()).datasets.length === before + 1);
}
async function selectOnly(paths: string[]) {
  await workbench(); await showRoster();
  const names = paths.map(path => basename(path));
  const datasets = (await roster()).datasets;
  await browser.execute(() => {
    const root = document.querySelector<HTMLElement>(".grouped-roster")!, trace: unknown[] = [];
    const events = ["pointerdown", "focusin", "scroll", "pointerup", "click", "change"];
    const listener = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      const row = target?.closest<HTMLElement>("[data-handle]");
      if (trace.length < 2048) trace.push({ event: event.type, time: performance.now(), handle: row?.dataset.handle,
        checked: target instanceof HTMLInputElement ? target.checked : null, scrollTop: root.scrollTop,
        row: row?.getBoundingClientRect().toJSON() });
    };
    for (const event of events) root.addEventListener(event, listener, { capture: true, passive: true });
    Reflect.set(window, "__m74StopMembershipTrace", () => {
      for (const event of events) root.removeEventListener(event, listener, true);
      return trace;
    });
  });
  try {
    for (const dataset of datasets) {
      const rowSelector = ROWS + '[data-handle="' + dataset.handle + '"]';
      const selector = rowSelector + ' input[type="checkbox"]';
      const checkbox = browser.$(selector), checked = names.includes(dataset.fileName);
      if (await checkbox.isSelected() !== checked) {
        await reveal(rowSelector);
        const point = await browser.execute(async css => {
          const control = document.querySelector<HTMLInputElement>(css)!;
          const row = control.closest<HTMLElement>("[data-handle]")!, root = control.closest<HTMLElement>(".grouped-roster")!;
          const before = row.getBoundingClientRect();
          await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())));
          const after = row.getBoundingClientRect(), bounds = root.getBoundingClientRect();
          const rect = control.getBoundingClientRect();
          const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
          return { x, y, hit: document.elementFromPoint(x, y) === control, checked: control.checked,
            stable: Math.abs(before.top - after.top) <= 1 && Math.abs(before.bottom - after.bottom) <= 1,
            wholeRowVisible: after.top >= bounds.top - 1 && after.bottom <= bounds.bottom + 1 };
        }, selector);
        record({ kind: "native membership click target", handle: dataset.handle, fileName: dataset.fileName, intended: checked, point });
        expect(point.hit).toBe(true); expect(point.stable).toBe(true); expect(point.wholeRowVisible).toBe(true); await checkbox.click();
        await browser.waitUntil(async () => await checkbox.isSelected() === checked);
      }
    }
    const checkedHandles = await browser.execute(css => [...document.querySelectorAll<HTMLInputElement>(css + ' input[type="checkbox"]')]
      .filter(control => control.checked).map(control => control.closest<HTMLElement>("[data-handle]")!.dataset.handle!), ROWS);
    const expectedHandles = datasets.filter(dataset => names.includes(dataset.fileName)).map(dataset => dataset.handle);
    expect(expectedHandles).toHaveLength(paths.length);
    expect(checkedHandles.sort()).toEqual(expectedHandles.sort());
    record({ kind: "verified native conversion membership", checkedHandles, expectedHandles, names });
  } finally {
    record({ kind: "passive native membership trace", trace: await browser.execute(() => {
      const stop = Reflect.get(window, "__m74StopMembershipTrace") as () => unknown[];
      Reflect.deleteProperty(window, "__m74StopMembershipTrace"); return stop();
    }) });
  }
  await conversion(); await browser.$(CONVERT).waitForEnabled({ timeout: 60_000 });
}
async function clearIdle() {
  expect((await state()).status).not.toBe("running");
  await workbench(); await showRoster();
  if ((await roster()).datasets.length) { await browser.$("button=Clear list").click(); await browser.waitUntil(async () => (await roster()).datasets.length === 0); }
}
function source(name: string, original: string) {
  const path = join(output, "sources", name); mkdirSync(dirname(path), { recursive: true }); copyFileSync(original, path); sources.set(path, digest(path)); return path;
}
function destination(name: string) { const path = join(output, name); mkdirSync(path); return path; }
function sciexInput() {
  const manifest = JSON.parse(readFileSync(join(input!, "inputs.json"), "utf8")) as { version?: number;
    files?: { file: string; bytes: number; sha256: string }[]; sciex?: {
    file: string; inputBundleObjectCount: number; inputBundleBytes: number; expectedOutputs: string[];
    expectedCompleteness: { kind: "established"; method: string; sampleCount: number };
    expectedFirstAdded: number; expectedRepeatAlready: number;
    expectedOutputBasis: { independentHistoricalEvidence: { path: string; sha256: string; gitBlob: string }[] };
  } };
  const sciex = manifest.sciex;
  if (manifest.version !== 2 || !sciex || sciex.inputBundleObjectCount !== 2 || sciex.inputBundleBytes !== 3_944_804 ||
    sciex.expectedOutputs?.length !== 10 || new Set(sciex.expectedOutputs).size !== 10 ||
    sciex.expectedCompleteness?.kind !== "established" || sciex.expectedCompleteness.method !== "reader_error_audit_v1" ||
    sciex.expectedCompleteness.sampleCount !== 10 || sciex.expectedFirstAdded !== 10 || sciex.expectedRepeatAlready !== 10 ||
    !sciex.expectedOutputBasis?.independentHistoricalEvidence.length) {
    throw Error("Required verified Enolase pair and independently bound ten-member fixture guidance are missing.");
  }
  const inputFiles = [sciex.file, sciex.file + ".scan"].map(file => {
    const entries = manifest.files?.filter(entry => entry.file === file) ?? [];
    if (entries.length !== 1) throw Error("Each SCIEX run-bundle member needs one pinned file identity.");
    return entries[0]!;
  });
  return { ...sciex, inputFiles };
}
function sciexSources(directory: string, sciex: ReturnType<typeof sciexInput>) {
  const copied = sciex.inputFiles.map(expected => {
    const path = source(join(directory, expected.file), join(input!, expected.file));
    const actual = { fileName: basename(path), bytes: statSync(path).size, sha256: digest(path) };
    record({ kind: "SCIEX source copy identity", expected, actual });
    expect(actual).toEqual({ fileName: expected.file, bytes: expected.bytes, sha256: expected.sha256 });
    return { path, ...actual };
  });
  return { file: copied[0]!.path, bundle: copied.map(({ path: _path, ...member }) => member) };
}
async function start(destinationPath: string, cancel = false) {
  await reveal(CONVERT); await remember(CONVERT);
  const [result] = await Promise.all([helper("choose-conversion-folder", ["-Action", cancel ? "cancel" : "choose", "-Path", destinationPath, "-TimeoutSeconds", "35"]), browser.$(CONVERT).click()]);
  expect(result.invoked).toBe(true);
  if (cancel) await naturalReturn("conversion destination cancel", true);
}
async function terminal() {
  await browser.waitUntil(async () => (await state()).status === "terminal", { timeout: 240_000, interval: 250 });
  const result = await state(); if (result.status !== "terminal") throw Error("No terminal queue."); record({ kind: "real terminal conversion", result }); return result;
}
async function save(selector: string, name: string, title: string, path: string, cancel = false) {
  await reveal(selector); await remember(selector + " button", name);
  const [result] = await Promise.all([helper("save-dialog", ["-Title", title, "-Action", cancel ? "cancel" : "save", "-Path", path, "-TimeoutSeconds", "35"]), browser.$(selector).$("button=" + name).click()]);
  expect(result.found).toBe(true); expect(result.invoked).toBe(true); await naturalReturn(basename(path));
  if (cancel) expect(existsSync(path)).toBe(false); else { await browser.waitUntil(() => existsSync(path)); record({ kind: "real export", name: basename(path), bytes: readFileSync(path).length, sha256: digest(path) }); }
}
async function preview() {
  await browser.$(FIGURE + " .figure-preview img").waitForExist();
  await browser.waitUntil(async () => await browser.$(FIGURE).$('button=Export SVG…').getAttribute("aria-disabled") === "false");
  return browser.execute(async css => {
    const img = document.querySelector<HTMLImageElement>(css + " .figure-preview img")!;
    return { svg: await (await fetch(img.src)).text(), specId: img.dataset.specId, width: img.width, height: img.height };
  }, FIGURE);
}
async function scope(panel: string, name: "Current range" | "Full spectrum" | "Full run") {
  const label = browser.$(panel).$("label*=" + name); await label.click();
}
async function edit(axis: "rt" | "mz", low: string, high: string) {
  const panel = axis === "rt" ? ".chromatogram-panel" : ".spectrum-panel";
  const details = browser.$(panel + " .plot-range-editor"); if (await details.getAttribute("open") === null) await details.$("summary").click();
  await browser.$("#plot-range-" + axis + "-low").setValue(low); await browser.$("#plot-range-" + axis + "-high").setValue(high);
  await browser.$(panel + " .plot-range-form button[type=submit]").click();
}
async function pendingSpectrumBand() {
  await reveal("svg.spectrum-plot");
  const coordinates = await browser.execute(() => {
    const svg = document.querySelector("svg.spectrum-plot")!, r = svg.getBoundingClientRect();
    const from = { x: Math.round(r.x + r.width * .25), y: Math.round(r.y + r.height * .45) };
    const to = { x: Math.round(r.x + r.width * .55), y: from.y };
    if (![from, to].every(p => { const hit = document.elementFromPoint(p.x, p.y); return hit !== null && svg.contains(hit); })) throw Error("Pending band coordinates did not hit the real plot.");
    return { from, to };
  });
  await browser.performActions([{ type: "pointer", id: "m74-native-band", parameters: { pointerType: "mouse" }, actions: [
    { type: "pointerMove", origin: "viewport", duration: 0, ...coordinates.from }, { type: "pointerDown", button: 0 },
    { type: "pointerMove", origin: "viewport", duration: 120, ...coordinates.to }, { type: "pointerUp", button: 0 },
  ] }]); await browser.releaseActions();
  await browser.waitUntil(async () => (await browser.$(".spectrum-panel").getText()).includes("Zoom to selection"));
  record({ kind: "uncommitted spectrum band", coordinates });
}

describe("M7.4 current native conversion, recovery and figures", function () {
  this.bail(true); this.timeout(600_000);
  before(async () => {
    if (process.env.MSCANVAS_M74_NATIVE_READY !== "true" || !input) throw Error("Fresh readiness and prebuilt task-owned inputs are required.");
    output = mkdtempSync(join(REPO, ".tmp/m74-evidence/native-"));
    writeFileSync(join(output, "owned-run.json"), JSON.stringify({ createdUtc: new Date().toISOString(), purpose: "M7.4 authorized native campaign" }));
    processId = Number((browser.capabilities as unknown as Record<string, unknown>)["goog:processID"]);
    if (!Number.isSafeInteger(processId) || processId <= 0) throw Error("Missing owned application PID.");
    await browser.$("[data-settings-entry]").waitForDisplayed(); const owned = metrics(); dpi = owned.dpi;
    expect(realpathSync(owned.executable)).toBe(realpathSync(resolve(REPO, "target/e2e/release/mscanvas-desktop.exe")));
    expect(digest(owned.executable)).toBe(process.env.MSCANVAS_M74_BINARY_SHA);
    record({ kind: "current candidate", capabilities: browser.capabilities, owned, binarySha256: digest(owned.executable), sourceHead: process.env.MSCANVAS_M74_SOURCE_HEAD,
      productionSha256: process.env.MSCANVAS_M74_PRODUCTION_SHA, harnessSha256: digest(fileURLToPath(import.meta.url)), inputManifest: JSON.parse(readFileSync(join(input, "inputs.json"), "utf8")) });
    console.log("M7.4 NATIVE INITIAL CLICK: PID " + processId + "; HWND " + owned.mainWindow + "; evidence " + output);
    await browser.waitUntil(async () => metrics().foregroundProcessId === processId && await browser.execute(() => document.hasFocus()), { timeout: 90_000, interval: 1000 });
    const available = await browser.execute(() => ({ width: screen.availWidth, height: screen.availHeight }));
    viewport = { width: Math.min(1366, Math.floor(available.width - 40)), height: Math.min(768, Math.floor(available.height - 80)) };
    if (viewport.width < 960 || viewport.height < 640) throw Error("The current monitor cannot contain the target viewport.");
    await helper("m7.1-size-window", ["-ExpectedDpi", String(dpi), "-CssWidth", String(viewport.width), "-CssHeight", String(viewport.height)]);
    await capture("00-native-ready");
  });
  afterEach(async function () {
    try { await capture(this.currentTest?.state === "passed" ? "scenario-" + String(evidence.length) : "failure", this.currentTest?.state === "passed" && !this.currentTest.title.includes("handler")); }
    finally { for (const [path, hash] of sources) expect(digest(path)).toBe(hash); saveEvidence(); }
  });

  it("runs the exact admitted plan, keeps Fail and Skip truthful, and adopts explicitly", async () => {
    const first = source("M74-existing-target.raw", join(input!, "retained-thermo.raw"));
    const second = source("M74 Unicode 空格 output.raw", join(input!, "retained-thermo.raw"));
    await add(first); await add(second); await selectOnly([first, second]);
    const folder = destination("conversion-fail-skip"), occupied = join(folder, "M74-existing-target.mzML");
    writeFileSync(occupied, "Pre-existing task-owned target; must remain byte-identical.\n"); const occupiedHash = digest(occupied);
    await start(folder, true); expect((await state()).status).toBe("idle");
    await start(folder); const completed = await terminal();
    expect(completed.queue.finalizedCount).toBe(1); expect(completed.queue.failedCount).toBe(1); expect(digest(occupied)).toBe(occupiedHash);
    const item = completed.queue.items.find(value => value.state === "finalized")!;
    expect(item.process).toEqual({ kind: "settled", termination: "exited", exitCode: 0 }); expect(item.staged).toEqual({ kind: "published" });
    expect(item.adoption).toEqual({ kind: "notRequested" }); expect((await roster()).datasets).toHaveLength(2);
    lastOutput = join(folder, item.finalizedOutputs[0]!.fileName);
    const report = item.result?.kind === "single" ? item.result.report : null;
    expect(report?.output?.sha256.toLowerCase()).toBe(digest(lastOutput)); expect(report?.validation?.fullyVerified).toBe(false);
    await browser.$(RESULT + " .conversion-queue-list > li:last-child details summary").click(); await capture("01-native-independent-judgments");
    const diagnostics = join(output, "conversion-failure-diagnostics.json");
    expect(await browser.$("#conversion-diagnostics-scope").getText()).toContain("Review the file before sharing.");
    await save(".conversion-diagnostics", "Export failure diagnostics…", "Save conversion diagnostics", diagnostics);
    const diagnosticText = readFileSync(diagnostics, "utf8"), diagnostic = JSON.parse(diagnosticText) as {
      schema: string; version: number; queue: { diagnosticItemCount: number }; items: { sourceFileName: string }[]; redaction: { warning: string };
    };
    expect(Buffer.byteLength(diagnosticText)).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(diagnostic).toMatchObject({ schema: "mscanvas.conversion-diagnostics", version: 5, queue: { diagnosticItemCount: 1 } });
    expect(diagnostic.items.map(value => value.sourceFileName)).toEqual([basename(first)]);
    expect(diagnostic.redaction.warning).toContain("Review the file before sharing.");
    for (const privatePath of [first, second, folder, input!]) {
      expect(diagnosticText).not.toContain(privatePath); expect(diagnosticText).not.toContain(JSON.stringify(privatePath).slice(1, -1));
    }
    record({ kind: "explicit local diagnostics", bytes: Buffer.byteLength(diagnosticText), sha256: digest(diagnostics), schema: diagnostic.schema, version: diagnostic.version });
    await browser.$(PANEL + " .conversion-adoption button").click(); await browser.waitUntil(async () => (await roster()).datasets.length === 3);
    expect(await browser.$(PANEL + " .conversion-adoption-summary").getText()).toContain("1 added");
    await browser.$('input[name="conversion-conflict-policy"][value="skip"]').click(); await browser.$(CONVERT).waitForEnabled();
    await start(folder); const skipped = await terminal(); expect(skipped.queue.skippedCount).toBe(2); expect(digest(occupied)).toBe(occupiedHash);
    record({ kind: "pre-existing target preserved", name: basename(occupied), sha256: occupiedHash });
  });

  it("keeps every active queue member through Return, Escape and removing outsiders, then cancels and clears rows", async () => {
    await clearIdle();
    const members = Array.from({ length: 8 }, (_, index) => source("M74-active-" + index + ".raw", join(input!, "retained-thermo.raw")));
    const outsider = source("M74-outside-queue.raw", join(input!, "retained-thermo.raw"));
    for (const member of members) await add(member);
    await add(outsider); await selectOnly(members);
    await browser.$('input[name="conversion-conflict-policy"][value="fail"]').click(); await browser.$(CONVERT).waitForEnabled();
    await start(destination("active-clear")); await browser.waitUntil(async () => (await state()).status === "running");
    await showRoster(); const before = (await calls()).filter(call => call.command === "execute_workspace_clear").length;
    const running = await state();
    if (running.status !== "running") throw Error("The eight-member Clear scenario needs an actual running queue.");
    expect(running.queue.items.map(item => item.fileName).sort()).toEqual(members.map(member => basename(member)).sort());
    record({ kind: "active Clear exact queue membership", state: running });
    await browser.$("button=Clear list").click(); await browser.$('[role="dialog"]').$('button=Return').waitForDisplayed();
    expect(await browser.execute(() => document.activeElement?.textContent)).toBe("Return"); await browser.$('[role="dialog"]').$('button=Return').click();
    await browser.$('[role="dialog"]').waitForExist({ reverse: true }); await browser.$("button=Clear list").click(); await browser.keys("Escape");
    await browser.$('[role="dialog"]').waitForExist({ reverse: true });
    expect((await calls()).filter(call => call.command === "execute_workspace_clear")).toHaveLength(before);
    await browser.$("button=Clear list").click(); await browser.$('[role="dialog"]').$('button=Remove non-running').waitForEnabled();
    await browser.$('[role="dialog"]').$('button=Remove non-running').click(); await browser.$('[role="dialog"]').waitForExist({ reverse: true });
    expect((await roster()).datasets.map(row => row.fileName).sort()).toEqual(members.map(member => basename(member)).sort());
    expect((await state()).status).toBe("running"); await browser.$("button=Clear list").click(); await browser.$('[role="dialog"]').$('button=Cancel and clear').waitForEnabled();
    await browser.$('[role="dialog"]').$('button=Cancel and clear').click(); await browser.waitUntil(async () => (await roster()).datasets.length === 0, { timeout: 60_000 });
    const update = await read<WorkspaceConversionUpdate>("get_workspace_conversion_state"); expect(update.backendQuarantined).toBe(false);
    expect(update.state.status).not.toBe("running"); record({ kind: "cancel-and-clear authoritative outcome", update });
  });

  for (const topology of ["single", "set"] as const) it("recovers real locked " + topology + " staging only after release and starts a fresh reviewed conversion", async () => {
    await clearIdle();
    const sciex = topology === "set" ? sciexInput() : null;
    const path = sciex ? sciexSources("set-lock", sciex).file
      : source("M74-lock-recovery.raw", join(input!, "retained-thermo.raw"));
    await add(path); await selectOnly([path]);
    const folder = destination("locked-staging-" + topology);
    const stagingName = sciex ? basename(path).replace(/\.wiff$/iu, ".mzML-set.mscanvas-staging") : "M74-lock-recovery.mzML.mscanvas-staging";
    const staged = join(folder, stagingName, "output", sciex ? sciex.expectedOutputs[0]! : "M74-lock-recovery.mzML");
    const journal = join(output, "lock-journal-" + topology + ".json"), release = join(output, "release-lock-" + topology + ".signal");
    let lockError: unknown;
    const locked = helper("m7.4-hold-staging", ["-TaskRoot", output, "-StagedPath", staged, "-Journal", journal, "-ReleaseSignal", release], false, 95_000).catch(error => { lockError = error; });
    try {
      await browser.waitUntil(() => existsSync(journal)); await start(folder); const failed = await terminal();
      expect(JSON.parse(readFileSync(journal, "utf8").replace(/^\uFEFF/u, "")).held).toBe(true);
      expect(failed.queue.failedCount).toBe(1); expect(failed.queue.items[0]!.stagingRecovery?.status).toBe("recoverable"); expect(existsSync(staged)).toBe(true);
      const publishedBeforeCleanup = failed.queue.items[0]!.finalizedOutputs.map(member => ({ path: join(folder, member.fileName), sha256: digest(join(folder, member.fileName)) }));
      await browser.$("button=Clean owned temporary output").click();
      await expect(browser.$('.conversion-recovery [role="status"]')).toHaveText("Cleanup is still blocked. Release the external lock and try again.");
      await expect(browser.$("button=Clean owned temporary output")).toHaveAttribute("aria-disabled", "false");
      record({ kind: "explicit reclaim refused while the exact native lock is held", topology, state: await state() });
      expect(existsSync(staged)).toBe(true); await capture("02-native-locked-residue-" + topology);
      writeFileSync(release, "release task-owned handle\n"); await locked; if (lockError) throw lockError;
      await browser.$("button=Clean owned temporary output").click(); await browser.$("button=Review a new plan").waitForDisplayed();
      expect(existsSync(dirname(dirname(staged)))).toBe(false);
      expect(await browser.execute(() => document.activeElement?.textContent)).toBe("Review a new plan"); await capture("03-native-cleaned-replan-" + topology);
      await browser.$("button=Review a new plan").click(); await browser.$(CONVERT).waitForEnabled();
      await start(sciex ? destination("recovered-set") : folder);
      const next = await terminal(); expect(next.queue.finalizedCount).toBe(1); expect(next.operationId).not.toBe(failed.operationId);
      for (const member of publishedBeforeCleanup) expect(digest(member.path)).toBe(member.sha256);
    } finally { if (!existsSync(release)) writeFileSync(release, "bounded cleanup after test\n"); await locked; record({ kind: "real lock evidence", value: existsSync(journal) ? JSON.parse(readFileSync(journal, "utf8").replace(/^\uFEFF/u, "")) : null, lockError: String(lockError ?? "") }); }
  });

  it("binds real preview, SVG, PNG, CSV and TSV to committed scopes and keeps quick paths separate", async () => {
    await clearIdle(); const path = source("M74-synthetic-12-scans.mzML", join(input!, "synthetic-12-scans.mzML")); await add(path);
    await browser.$(ROWS).click(); await browser.$(".spectrum-table-panel").waitForDisplayed(); await workbench();
    await browser.$('.spectrum-table-panel [data-source-index="1"]').click();
    await browser.waitUntil(async () => (await browser.$("#selected-spectrum-summary").getText()).startsWith("Spectrum 1,"));
    await edit("mz", "200", "550"); await pendingSpectrumBand(); await browser.$('.spectrum-panel').$('button=Export figure').click();
    await scope(FIGURE, "Current range"); await preview();
    await browser.$(FIGURE + ' input[id$="-widthPx"]').setValue("900"); await browser.$(FIGURE + ' input[id$="-heightPx"]').setValue("600");
    await browser.$(FIGURE + ' input[id$="-pngDpi"]').setValue("150"); const current = await preview();
    expect(createHash("sha256").update(current.svg).digest("hex")).toBe(current.specId);
    const svg = join(output, "spectrum-current.svg"); await save(FIGURE, "Export SVG…", "Export spectrum figure", svg);
    expect(readFileSync(svg, "utf8")).toBe(current.svg);
    const png = join(output, "spectrum-current.png"); await save(FIGURE, "Export PNG…", "Export spectrum figure", png);
    const inspected = inspectNativePng(readFileSync(png)); expect(inspected).toMatchObject({ width: 900, height: 600, unit: 1 });
    expect(inspected.ppmX).toBe(Math.round(150 / .0254)); expect(inspected.ppmY).toBe(inspected.ppmX); record({ kind: "PNG content", inspected });
    await browser.$(FIGURE + ' input[id$="-pngDpi"]').setValue("1e"); await preview();
    expect(await browser.$(FIGURE).$("button=Export PNG…").getAttribute("aria-disabled")).toBe("true");
    await save(FIGURE, "Export SVG…", "Export spectrum figure", join(output, "spectrum-invalid-png-dpi.svg"));
    expect(readFileSync(join(output, "spectrum-invalid-png-dpi.svg"), "utf8")).toBe(current.svg);
    await browser.$(FIGURE + ' input[id$="-pngDpi"]').setValue("150"); await preview();
    await save(FIGURE, "Export PNG…", "Export spectrum figure", join(output, "cancelled-dialog.png"), true);
    await capture("04-native-preview-and-saved-content"); await browser.$(FIGURE).$("button=Return to viewer").click();

    const dataPanel = ".spectrum-panel";
    await browser.$(dataPanel + " .spectrum-export-disclosure summary").click();
    const csv = join(output, "spectrum-current.csv"); await save(dataPanel, "Export CSV…", "Export spectrum data", csv);
    const data = (path: string, separator: string) => readFileSync(path, "utf8").split(/\r?\n/u).filter(line => line && !line.startsWith("#")).slice(1).map(line => line.split(separator).map(Number));
    expect(data(csv, ",").map(row => row[0])).toEqual([200, 250, 300, 350, 400, 450, 500, 550]);
    expect(await browser.$(dataPanel).getText()).toContain("Zoom to selection");
    const tsv = join(output, "spectrum-current.tsv"); await save(dataPanel, "Export TSV…", "Export spectrum data", tsv); expect(data(tsv, "\t")).toEqual(data(csv, ","));
    await scope(dataPanel, "Full spectrum"); const fullCsv = join(output, "spectrum-full.csv"); await save(dataPanel, "Export CSV…", "Export spectrum data", fullCsv);
    expect(data(fullCsv, ",")).toHaveLength(12);
    await browser.$(dataPanel + " .spectrum-export-disclosure summary").click();
    await save(dataPanel + " .figure-quick-group", "Quick PNG", "Export spectrum figure", join(output, "cancelled-quick.png"), true);
    const before = await calls(); await browser.$(dataPanel + ' .figure-quick-actions').$('button=Copy plot').click();
    await browser.waitUntil(async () => (await calls()).filter(call => call.command === "copy_selected_spectrum_plot").length > before.filter(call => call.command === "copy_selected_spectrum_plot").length);
    await browser.waitUntil(async () => !(await browser.$(dataPanel).getText()).includes("Copying plot"));
    const clipboard = await helper("read-clipboard-image", [], false);
    expect(clipboard).toMatchObject({ present: true, width: 900, height: 600 }); expect(Number(clipboard.distinct)).toBeGreaterThan(1); record({ kind: "clipboard dimensions and sampled colors only", clipboard });
    expect((await calls()).filter(call => call.command === "begin_selected_spectrum_export")).toHaveLength(before.filter(call => call.command === "begin_selected_spectrum_export").length);

    await edit("mz", "225", "240"); await browser.$(dataPanel).$('button=Export figure').click(); await scope(FIGURE, "Current range"); const empty = await preview();
    expect(await browser.$(FIGURE).getText()).toContain("empty spectrum figure");
    const emptySvg = join(output, "spectrum-empty-current.svg"); await save(FIGURE, "Export SVG…", "Export spectrum figure", emptySvg); expect(readFileSync(emptySvg, "utf8")).toBe(empty.svg);
    await browser.$(FIGURE).$("button=Return to viewer").click(); await browser.$(dataPanel + " .spectrum-export-disclosure summary").click();
    const emptyCsv = join(output, "spectrum-empty-current.csv"); await save(dataPanel, "Export CSV…", "Export spectrum data", emptyCsv); expect(data(emptyCsv, ",")).toHaveLength(0);
    await browser.$(dataPanel + " .spectrum-export-disclosure summary").click();

    await edit("rt", "60", "180");
    await browser.$('.chromatogram-panel').$('button=Export figure').click(); await scope(FIGURE, "Current range"); const chrom = await preview();
    const chromSvg = join(output, "chromatogram-current.svg"); await save(FIGURE, "Export SVG…", "Export chromatogram figure", chromSvg); expect(readFileSync(chromSvg, "utf8")).toBe(chrom.svg);
    expect(await browser.$(FIGURE).getText()).toContain("Full run"); await browser.$(FIGURE).$("button=Return to viewer").click();
    await browser.$("#chromatogram-export-toggle").click();
    const rtCsv = join(output, "chromatogram-current.csv"); await save(".chromatogram-panel", "Export CSV…", "Export chromatogram data", rtCsv);
    expect(data(rtCsv, ",").map(row => row[0])).toEqual([1, 2, 3]);
    expect(data(rtCsv, ",").map(row => row[3])).toEqual([60, 120, 180]);
    await browser.$('.chromatogram-panel').$('button=Preview linked figure').click(); const linked = await preview();
    expect(await browser.$(FIGURE).getText()).toContain("lower panel always shows that scan's complete spectrum");
    const linkedSvg = join(output, "linked-current.svg"); await save(FIGURE, "Export SVG…", "Export linked figure", linkedSvg); expect(readFileSync(linkedSvg, "utf8")).toBe(linked.svg);
    await scope(FIGURE, "Full run"); const linkedFull = await preview(); const linkedFullSvg = join(output, "linked-full.svg");
    await save(FIGURE, "Export SVG…", "Export linked figure", linkedFullSvg); expect(readFileSync(linkedFullSvg, "utf8")).toBe(linkedFull.svg);
    await capture("05-native-linked-scope"); await browser.$(FIGURE).$("button=Return to viewer").click();
    record({ kind: "real synthetic scientific outputs", sourceSha256: digest(path), spectrumCurrentRows: data(csv, ","), spectrumFullRows: data(fullCsv, ","), emptyRows: data(emptyCsv, ","), currentRtRows: data(rtCsv, ",") });
  });

  it("verifies the real SCIEX bundle, complete output set and first/repeat adoption", async () => {
    const sciex = sciexInput();
    await clearIdle(); const { file, bundle } = sciexSources("set-adoption", sciex);
    expect(readdirSync(dirname(file)).sort()).toEqual(bundle.map(value => value.fileName).sort());
    expect(bundle).toHaveLength(sciex.inputBundleObjectCount);
    expect(bundle.reduce((bytes, member) => bytes + member.bytes, 0)).toBe(sciex.inputBundleBytes);
    await add(file); const sourceRoster = await roster();
    expect(sourceRoster.datasets).toHaveLength(1);
    const acquisition = sourceRoster.datasets[0]!;
    expect(acquisition).toMatchObject({ fileName: basename(file), sourceKind: "sciex_wiff", byteLength: sciex.inputBundleBytes });
    record({ kind: "current SCIEX input bundle and independent fixture guidance", bundle, sourceRoster, guidance: sciex });
    await selectOnly([file]); const folder = destination("sciex-set"); await start(folder); const completed = await terminal();
    const expectedNames = [...sciex.expectedOutputs].sort(), memberCount = expectedNames.length;
    expect(completed).toMatchObject({ reason: "completed", queue: { itemCount: 1, finalizedCount: 1, failedCount: 0, adoptableOutputCount: memberCount } });
    expect(completed.queue.items).toHaveLength(1);
    const item = completed.queue.items[0]!;
    expect(item).toMatchObject({ datasetHandle: acquisition.handle, sourceKind: "sciex_wiff", state: "finalized", attempts: 1,
      output: { kind: "backendNamedSet", maxMembers: 24 }, process: { kind: "settled", termination: "exited", exitCode: 0 }, staged: { kind: "published" } });
    if (item.result?.kind !== "outputSet") throw Error("The SCIEX acquisition did not return a real output-set report.");
    const report = item.result.report;
    expect(report).toMatchObject({ datasetHandle: acquisition.handle, sourceKind: "sciex_wiff", groupOutcome: "fully_finalized",
      memberCount, finalizedCount: memberCount, validatedNotPublishedCount: 0, rejectedCount: 0, notPublishedCount: 0,
      boundSourceObjects: sciex.inputBundleObjectCount, partial: null, stagingResidue: null, completeSetAdoptable: true,
      validationMode: "output_only", completeness: sciex.expectedCompleteness });
    expect(report.members.map(member => member.fileName).sort()).toEqual(expectedNames);
    expect(item.finalizedOutputs.map(value => value.fileName).sort()).toEqual(expectedNames);
    expect(new Set(item.finalizedOutputs.map(value => value.outputId)).size).toBe(memberCount);
    expect(readdirSync(folder, { withFileTypes: true }).filter(entry => entry.isFile()).map(entry => entry.name).sort()).toEqual(expectedNames);
    const outputs = report.members.map(member => {
      const path = join(folder, member.fileName), measured = { fileName: member.fileName, byteLength: statSync(path).size, sha256: digest(path) };
      expect(member.state).toBe("finalized");
      expect(member.output?.byteLength).toBe(measured.byteLength); expect(member.output?.sha256.toLowerCase()).toBe(measured.sha256);
      expect(member.validation).toMatchObject({ mode: "output_only", fullyVerified: false });
      return measured;
    });
    expect(item.adoption).toEqual({ kind: "notRequested" }); expect(await roster()).toEqual(sourceRoster);
    expect(await browser.$(PANEL + " .conversion-adoption").getText()).toContain("10 converted mzML outputs are ready to add");
    const callStart = (await calls()).length, adoptButton = browser.$(PANEL + " .conversion-adoption button");
    let firstAdoptionRoster: WorkspaceRoster | undefined;
    for (const phase of ["first", "repeat"] as const) {
      await adoptButton.waitForEnabled(); await adoptButton.click();
      const added = phase === "first" ? sciex.expectedFirstAdded : 0;
      const alreadyInWorkspace = phase === "repeat" ? sciex.expectedRepeatAlready : 0;
      await browser.waitUntil(async () => {
        const current = await state();
        const adoption = current.status === "terminal" ? current.queue.items[0]?.adoption : null;
        return adoption?.kind === "settled" && adoption.added === added && adoption.alreadyInWorkspace === alreadyInWorkspace;
      });
      const adopted = await state(), currentRoster = await roster();
      record({ kind: "current SCIEX " + phase + " adoption", state: adopted, roster: currentRoster, outputs });
      if (adopted.status !== "terminal") throw Error("Adoption replaced the terminal SCIEX queue.");
      expect(adopted.operationId).toBe(completed.operationId);
      expect(adopted.queue.items[0]).toMatchObject({ attempts: 1, runIdentity: item.runIdentity, result: item.result,
        finalizedOutputs: item.finalizedOutputs, adoption: { kind: "settled", added, alreadyInWorkspace, refused: 0, refusals: [] } });
      await expect(browser.$(PANEL + " .conversion-adoption-summary")).toHaveText(`${added} added, ${alreadyInWorkspace} already in the workspace, 0 not added.`);
      expect(currentRoster.datasets).toHaveLength(memberCount + 1);
      expect(new Set(currentRoster.datasets.map(dataset => dataset.handle)).size).toBe(memberCount + 1);
      expect(currentRoster.datasets.filter(dataset => dataset.sourceKind === "sciex_wiff")).toEqual(sourceRoster.datasets);
      expect(currentRoster.datasets.filter(dataset => dataset.sourceKind === "mzml").map(dataset => dataset.fileName).sort()).toEqual(expectedNames);
      for (const measured of outputs) {
        expect(currentRoster.datasets.find(dataset => dataset.fileName === measured.fileName)?.byteLength).toBe(measured.byteLength);
        expect(digest(join(folder, measured.fileName))).toBe(measured.sha256);
      }
      if (phase === "first") firstAdoptionRoster = currentRoster;
      else expect(currentRoster).toEqual(firstAdoptionRoster);
      await capture("06-native-sciex-" + phase + "-adoption");
    }
    const adoptionCalls = (await calls()).slice(callStart).filter(call => call.command === "adopt_workspace_conversion_outputs");
    expect(adoptionCalls).toHaveLength(2);
    expect(adoptionCalls.map(call => call.args.operationId)).toEqual([completed.operationId, completed.operationId]);
  });

  it("delegates file and folder actions to the actual Windows handler and records OS acceptance honestly", async () => {
    await clearIdle(); const file = source("M74 handler Unicode 空格.raw", join(input!, "retained-thermo.raw")); await add(file); await selectOnly([file]);
    const folder = destination("handler-open"); await start(folder); const completed = await terminal(); expect(completed.queue.finalizedCount).toBe(1);
    const item = completed.queue.items[0]!, target = join(folder, item.finalizedOutputs[0]!.fileName), targetHash = digest(target);
    const before = await calls(), queue = JSON.stringify(await state()), rows = JSON.stringify(await roster());
    await browser.$(".output-open-actions").$("button=Open file").click();
    await browser.waitUntil(async () => await browser.$('.output-open-actions').$('button=Open file').getAttribute("aria-disabled") !== "true" && (await browser.$('.output-open-actions [role="status"]').getText()).length > 0);
    expect(await browser.$('.output-open-actions [role="status"]').getText()).toMatch(/Windows accepted|Windows has no application associated/u);
    record({ kind: "actual OS file opening result", text: await browser.$('.output-open-actions [role="status"]').getText(), owned: metrics() });
    // A second explicit rendered action. No foreground API or focus rescue is
    // used when the first action intentionally launches an external handler.
    await browser.$(".output-open-actions").$("button=Open folder").click();
    await browser.waitUntil(async () => (await browser.$('.output-open-actions [role="status"]').getText()).includes("Windows accepted"));
    record({ kind: "actual OS folder opening result", text: await browser.$('.output-open-actions [role="status"]').getText(), owned: metrics() });
    expect(digest(target)).toBe(targetHash); expect(JSON.stringify(await state())).toBe(queue); expect(JSON.stringify(await roster())).toBe(rows);
    expect((await calls()).slice(before.length).filter(call => /^(begin_workspace_conversion|adopt_workspace_conversion|reclaim_conversion)/u.test(call.command))).toHaveLength(0);
  });
});
