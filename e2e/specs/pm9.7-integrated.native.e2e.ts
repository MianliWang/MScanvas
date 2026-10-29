/**
 * PM9.7 I1/I2/I3 on real WebView2 at Windows 144 DPI: preparation UNRUN.
 *
 * Run only through wdio.pm9-native.conf.ts after a named admitted dispatch.
 * The e2e binary's built-in IPC table supplies pm9Scenarios answers. Native
 * window sizing, raster capture and Tab input are real; scientific data,
 * Project records and preferences are controlled. This is not provider,
 * engine, native-picker, installed-product or release acceptance. Initial
 * application mount may perform the separately permitted discovery probe.
 * No CDP/emulated DPR and no replacement preference invoke wrapper are used.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { en } from "../../apps/desktop/src/features/preferences/locales/en";
import { zhCN } from "../../apps/desktop/src/features/preferences/locales/zh-CN";
import { MZML_ROW } from "../support/fixtures";
import { nativeResourceOrigins } from "../support/nativeResourceOrigins";
import { EMPTY_ROSTER, NO_PROJECT, preferences, scenario, type Locale } from "../support/pm9Scenarios";
import { loadWith, revealTauriRoster } from "../support/tauriPanel";

const REPOSITORY = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BUNDLES = { en, "zh-CN": zhCN } as const;
const ANCHORS = [[1920, 1080], [1366, 768], [960, 640]] as const;
const RING = "2px solid rgb(23, 105, 209)";
const CONVERT = ".conversion-panel .conversion-start";
const ROSTER_TOGGLE = '[aria-controls="workbench-roster"]';
const TAURI_RELOAD_NOTICE = /^\[TAURI\] Couldn't find callback id \d+\. This might happen when the app is reloaded while Rust is running an asynchronous operation\.$/u;
const evidence: unknown[] = [];
let output = "", processId = 0;
let expectedCss: { width: number; height: number } = { width: 0, height: 0 };
let answerKeys: readonly string[] = [];

interface NativeRect { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
interface WindowMetrics {
  readonly processId: number;
  readonly executable: string;
  readonly mainWindow: number;
  readonly dpi: number;
  readonly foregroundProcessId: number;
  readonly maximized: boolean;
  readonly minimized: boolean;
  readonly measuredUtc: string;
  readonly bounds: { readonly client: NativeRect; readonly visibleFrameInsideWorkArea: boolean };
}
interface IpcCall { readonly command: string; readonly args: Record<string, unknown> }
interface ConsoleEntry { readonly level: string; readonly text: string }
interface Dispatch {
  readonly dispatchId: string;
  readonly head: string;
  readonly binary: string;
  readonly binarySha256: string;
  readonly preferenceRoot: string;
  readonly changes: unknown;
}
let dispatch: Dispatch;

function digest(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** These helpers measure/size only the PID attributed by this WebDriver session. */
function native<T>(name: "m7.1-window-metrics" | "m7.1-size-window", args: readonly string[] = []): T {
  const argv = [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolve(REPOSITORY, `e2e/native/${name}.ps1`),
    "-ApplicationProcessId", String(processId), ...args,
  ];
  const launchObservedUtc = new Date().toISOString();
  const result = spawnSync("powershell.exe", argv, { encoding: "utf8", windowsHide: true, timeout: 30_000 });
  evidence.push({
    kind: "native helper launch observation", helper: name, executable: "powershell.exe", argv,
    pid: result.pid, parentPid: process.pid, launchObservedUtc, endObservedUtc: new Date().toISOString(),
    status: result.status, signal: result.signal, error: result.error === undefined ? null : String(result.error),
    stdout: result.stdout, stderr: result.stderr,
    timeScope: "Launcher observation, not an independently measured OS creation time.",
  });
  writeEvidence();
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`The owned ${name} helper failed: ${String(result.error ?? result.status)}; ${result.stderr}`);
  }
  return JSON.parse(result.stdout) as T;
}

async function frames(): Promise<void> {
  await browser.execute(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
}

async function ipcCalls(): Promise<IpcCall[]> {
  return browser.execute(() => (window as unknown as { __mscanvasIpcCalls__: IpcCall[] }).__mscanvasIpcCalls__);
}

async function consoleEntries(): Promise<ConsoleEntry[]> {
  return browser.execute(() => (window as unknown as { __mscanvasConsole__: ConsoleEntry[] }).__mscanvasConsole__);
}

async function measuredSize(width: number, height: number): Promise<void> {
  const before = native<WindowMetrics>("m7.1-window-metrics");
  expect(before.foregroundProcessId).toBe(processId);
  expect(before.dpi).toBe(144);
  const sizing = native<unknown>("m7.1-size-window", ["-ExpectedDpi", "144", "-CssWidth", String(width), "-CssHeight", String(height)]);
  expectedCss = { width, height };
  evidence.push({ kind: "real native sizing", requestedCss: expectedCss, sizing });
  await browser.waitUntil(() => browser.execute((w, h) => innerWidth === w && innerHeight === h, width, height), {
    timeout: 30_000, timeoutMsg: "The owned native client did not reach the requested CSS viewport.",
  });
  await frames();
}

async function navigate(label: string): Promise<void> {
  const tab = browser.$(".workbench-navigation").$(`button=${label}`);
  if (await tab.isExisting()) {
    await tab.click();
  } else {
    // Project is the header menu's first item, not a tab (rebuild spec 1.1).
    await browser.$("[data-project-menu]").click();
    await browser.$('[data-project-menu-item="surface"]').waitForDisplayed();
    await browser.$('[data-project-menu-item="surface"]').click();
  }
  await frames();
}

async function reveal(selector: string): Promise<void> {
  await browser.execute(async css => {
    const node = document.querySelector<HTMLElement>(css);
    if (node === null) throw new Error(`The rendered target is absent: ${css}`);
    const x = scrollX, y = scrollY;
    node.scrollIntoView({ block: "center", inline: "nearest" });
    window.scrollTo(x, y);
    await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())));
  }, selector);
}

async function open(table: Record<string, unknown>, locale: Locale, width: number, height: number): Promise<void> {
  await measuredSize(width, height);
  // The only preference mutation these cases perform is the real roster
  // toggle to "shown". Answer its exact committed record in the built-in
  // table, rather than wrapping invoke with a browser preference helper.
  table = { ...table, save_ui_preferences: {
    outcome: "saved", revision: 2,
    preferences: { ...preferences(locale), layout: { roster: "shown", details: "automatic" } },
  } };
  answerKeys = Object.keys(table).sort();
  // loadWith writes only the e2e seed table and refreshes. The binary's own
  // initialization installs it before mount; invoke is never replaced here.
  await loadWith(table);
  await browser.$(".workbench-header").waitForDisplayed({ timeout: 60_000 });
  await browser.waitUntil(() => browser.execute(lang => document.documentElement.lang === lang, locale), {
    timeout: 30_000, timeoutMsg: "The controlled locale did not reach the native document.",
  });
  await frames();
  const boundary = await browser.execute(() => ({
    descriptor: Object.getOwnPropertyDescriptor((window as unknown as { __TAURI_INTERNALS__: object }).__TAURI_INTERNALS__, "invoke")?.writable,
    marker: (window as unknown as { __mscanvasBoundary__: { wrapped: boolean } }).__mscanvasBoundary__,
    keys: Object.keys((window as unknown as { __mscanvasIpcTable__: object }).__mscanvasIpcTable__).sort(),
  }));
  expect(boundary.descriptor).toBe(false);
  expect(boundary.marker.wrapped).toBe(true);
  expect(boundary.keys).toEqual(answerKeys);
}

function emptyTable(locale: Locale): Record<string, unknown> {
  return { ...scenario("populated", locale), get_workspace_roster: EMPTY_ROSTER, get_project_state: NO_PROJECT };
}

/** Each retained frame binds native DPI/client bounds to the actual PNG raster. */
async function sample(label: string) {
  await frames();
  const metrics = native<WindowMetrics>("m7.1-window-metrics");
  const path = join(output, `${label}.png`);
  await browser.saveScreenshot(path);
  const png = readFileSync(path);
  const raster = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  const measured = await browser.execute(() => {
    const shell = document.querySelector<HTMLElement>(".workbench-shell");
    const surface = shell?.getAttribute("data-surface") ?? null;
    const owner = document.querySelector<HTMLElement>(surface === "conversion" ? "#workbench-conversion" : surface === "project" ? "#workbench-project" : "#workbench-evidence");
    const rect = owner?.getBoundingClientRect();
    const header = document.querySelector(".workbench-header")?.getBoundingClientRect();
    return {
      css: { width: innerWidth, height: innerHeight }, dpr: devicePixelRatio,
      zoom: getComputedStyle(document.documentElement).zoom, visualScale: visualViewport?.scale ?? null,
      hasFocus: document.hasFocus(), locale: document.documentElement.lang, userAgent: navigator.userAgent,
      density: document.querySelector("[data-density]")?.getAttribute("data-density") ?? null,
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      surface, panels: { roster: shell?.getAttribute("data-roster-open"), details: shell?.getAttribute("data-details-open") },
      overflow: { x: document.documentElement.scrollWidth - innerWidth, y: document.documentElement.scrollHeight - innerHeight },
      header: header === undefined ? null : { top: header.top, bottom: header.bottom },
      owner: owner === null || rect === undefined ? null : { top: rect.top, bottom: rect.bottom, scrollTop: owner.scrollTop, clientHeight: owner.clientHeight, scrollHeight: owner.scrollHeight },
      text: (owner?.innerText ?? "").slice(0, 4_000), applicationOrigin: location.origin,
      resources: performance.getEntriesByType("resource").map(entry => entry.name),
    };
  });
  const console = await consoleEntries();
  const calls = await ipcCalls();
  const resources = nativeResourceOrigins(measured.resources, measured.applicationOrigin);
  const passThrough = calls.filter(call => !answerKeys.includes(call.command));
  evidence.push({ kind: "native controlled-IPC frame", label, dispatchId: dispatch.dispatchId, metrics, raster, ...measured, ...resources, console, calls, passThrough });
  writeEvidence();
  expect(metrics.processId).toBe(processId);
  expect(realpathSync(metrics.executable)).toBe(realpathSync(dispatch.binary));
  expect(metrics.dpi).toBe(144);
  expect(metrics.foregroundProcessId).toBe(processId);
  expect(metrics.bounds.visibleFrameInsideWorkArea).toBe(true);
  expect(measured.hasFocus).toBe(true);
  expect(measured.css).toEqual(expectedCss);
  expect(measured.dpr).toBe(1.5);
  expect(measured.density).toBe("comfortable");
  expect(measured.zoom).toBe("1");
  expect(measured.visualScale).toBe(1);
  expect(raster).toEqual({ width: expectedCss.width * 1.5, height: expectedCss.height * 1.5 });
  expect(raster).toEqual({ width: metrics.bounds.client.right - metrics.bounds.client.left, height: metrics.bounds.client.bottom - metrics.bounds.client.top });
  expect(resources.externalResources).toEqual([]);
  // loadWith reloads the document while Rust may still answer a real request
  // of the previous document (the cold mount issues several). Tauri's own
  // IPC layer then reports the orphaned callback in the new document. The
  // harness reloads; the application never does. That exact notice stays in
  // the evidence above and is excluded here; any other entry fails.
  expect(console.filter(entry => !(entry.level === "warn" && TAURI_RELOAD_NOTICE.test(entry.text)))).toEqual([]);
  // Tauri event transport may pass through. Scientific/application commands
  // in these states must all be answered by the recorded scenario table.
  expect(passThrough.filter(call => !call.command.startsWith("plugin:event|"))).toEqual([]);
  return measured;
}

function writeEvidence(): void {
  writeFileSync(join(output, "integrated-evidence.json"), JSON.stringify({
    preparationStatus: "UNRUN", scope: "Real WebView2, controlled IPC; no provider/engine/release acceptance", dispatch, evidence,
  }, null, 2));
}

async function mark(scope: string, label: string, attribute: string): Promise<string | null> {
  return browser.execute((css, name, attr) => {
    document.querySelectorAll(`[${attr}]`).forEach(node => node.removeAttribute(attr));
    const node = [...document.querySelectorAll<HTMLButtonElement>(`${css} button`)].find(button => (button.textContent ?? "").trim() === name && button.getClientRects().length > 0);
    if (node === undefined) return null;
    node.setAttribute(attr, "");
    return `[${attr}]`;
  }, scope, label, attribute);
}

function offered(selector: string): Promise<boolean> {
  return browser.execute(css => {
    const node = document.querySelector<HTMLButtonElement>(css);
    return node !== null && node.getClientRects().length > 0 && !node.disabled && node.getAttribute("aria-disabled") !== "true";
  }, selector);
}

/** Setup focuses the brand once; all measured focus changes use real Tab input. */
async function reach(selector: string, label: string): Promise<void> {
  await browser.execute(() => document.querySelector<HTMLElement>(".workbench-home")?.focus({ preventScroll: true }));
  let reached: number | null = null;
  for (let press = 0; press <= 100; press += 1) {
    if (await browser.execute(css => document.activeElement === document.querySelector(css), selector)) { reached = press; break; }
    await browser.keys("Tab");
  }
  await frames();
  evidence.push({ kind: "real Tab reach", label, selector, presses: reached });
  expect(reached).not.toBeNull();
}

async function unfoldRoster(label: string): Promise<void> {
  await reach(ROSTER_TOGGLE, `${label} roster`);
  await browser.keys("Enter");
  await browser.$("#workbench-roster").waitForDisplayed();
}

/** Full outline reach is checked against each ancestor's actual clipping axes. */
function focusFacts() {
  return browser.execute(() => {
    const active = document.activeElement as HTMLElement | null;
    if (active === null || active === document.body) return { onBody: true } as const;
    const rect = active.getBoundingClientRect(), style = getComputedStyle(active);
    const extent = Math.max(0, (Number.parseFloat(style.outlineOffset) || 0) + (Number.parseFloat(style.outlineWidth) || 0));
    const ring = { left: rect.left - extent, right: rect.right + extent, top: rect.top - extent, bottom: rect.bottom + extent };
    const clippedBy: string[] = [];
    for (let node = active.parentElement; node !== null; node = node.parentElement) {
      const css = getComputedStyle(node), box = node.getBoundingClientRect();
      const left = box.left + node.clientLeft, top = box.top + node.clientTop;
      const clipsX = /^(auto|scroll|hidden|clip)$/u.test(css.overflowX);
      const clipsY = /^(auto|scroll|hidden|clip)$/u.test(css.overflowY);
      if ((clipsX && (ring.left < left - 1 || ring.right > left + node.clientWidth + 1)) ||
          (clipsY && (ring.top < top - 1 || ring.bottom > top + node.clientHeight + 1))) clippedBy.push(`${node.tagName}.${String(node.className).split(" ")[0]}#${node.id}`);
    }
    const x = Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2));
    const y = Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2));
    const hit = document.elementFromPoint(x, y), label = active.closest("label");
    const covered = hit === null || !(hit === active || active.contains(hit) || hit.contains(active) || (label !== null && label.contains(hit)));
    const labelledBy = (active.getAttribute("aria-labelledby") ?? "").split(/\s+/u).map(id => document.getElementById(id)?.textContent ?? "").join(" ");
    const fieldLabel = active instanceof HTMLInputElement || active instanceof HTMLSelectElement || active instanceof HTMLTextAreaElement ? active.labels?.[0]?.textContent ?? "" : "";
    return {
      onBody: false, documentHasFocus: document.hasFocus(), zeroSize: rect.width === 0 || rect.height === 0,
      name: `${active.tagName} ${active.getAttribute("aria-label") ?? (labelledBy || fieldLabel || active.textContent || "")}`.trim().slice(0, 100),
      rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }, ringBox: ring,
      inViewport: ring.left >= -1 && ring.top >= -1 && ring.right <= innerWidth + 1 && ring.bottom <= innerHeight + 1,
      clippedBy, covered, outline: `${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor}`, offset: style.outlineOffset,
    } as const;
  });
}

async function assertFocus(label: string): Promise<void> {
  const facts = await focusFacts();
  evidence.push({ kind: "native focus geometry", label, facts });
  expect(facts).toMatchObject({ onBody: false, documentHasFocus: true, zeroSize: false, inViewport: true, clippedBy: [], covered: false, outline: RING });
}

async function viewer(locale: Locale, width: number, height: number): Promise<void> {
  await open(scenario("populated", locale), locale, width, height);
  await revealTauriRoster();
  const row = `.grouped-roster [role="row"][data-handle="${MZML_ROW.handle}"]`;
  await reveal(row);
  await browser.$(row).click();
  await browser.$(".viewer-column").waitForDisplayed({ timeout: 60_000 });
  const scan = '.spectrum-table-row[data-row-position="0"]';
  await browser.$(scan).waitForExist({ timeout: 60_000 });
  await reveal(scan);
  await browser.$(scan).click();
  await browser.$("svg.spectrum-plot").waitForDisplayed({ timeout: 60_000 });
}

describe("PM9.7 integrated native rendering, controlled IPC, 144 DPI (prepared UNRUN)", function () {
  this.bail(true);
  before(async () => {
    if (process.env.MSCANVAS_PM9_NATIVE_DISPATCH_READY !== "true") throw new Error("Use the dedicated admitted PM9 native dispatch config.");
    output = process.env.MSCANVAS_PM9_NATIVE_RUN_ROOT ?? "";
    if (output === "") throw new Error("The dedicated launcher did not supply its owned evidence directory.");
    dispatch = JSON.parse(readFileSync(join(output, "dispatch.json"), "utf8")) as Dispatch;
    const caps = browser.capabilities as unknown as Record<string, unknown>;
    processId = Number(caps["goog:processID"]);
    if (!Number.isSafeInteger(processId) || processId <= 0) throw new Error("WebDriver did not attribute its application PID.");
    expect(caps["browserName"]).toBe("webview2");
    expect(digest(dispatch.binary)).toBe(dispatch.binarySha256);
    const initial = native<WindowMetrics>("m7.1-window-metrics");
    evidence.push({ kind: "initial native session", capabilities: caps, initial, initialMountCalls: await ipcCalls() });
    writeEvidence();
    expect(realpathSync(initial.executable)).toBe(realpathSync(dispatch.binary));
    expect(initial.dpi).toBe(144);
    expect(initial.foregroundProcessId).toBe(processId);
    expect(initial.maximized).toBe(false);
    expect(initial.minimized).toBe(false);
    // No focus helper repairs a lost foreground. An unready host refuses here.
    expect(await browser.execute(() => document.hasFocus())).toBe(true);
  });

  afterEach(async function () {
    evidence.push({ kind: "test outcome", title: this.currentTest?.title, state: this.currentTest?.state, console: await consoleEntries() });
    if (this.currentTest?.state === "failed") await browser.saveScreenshot(join(output, `failure-${String(evidence.length)}.png`));
    writeEvidence();
  });

  after(() => {
    if (output !== "" && dispatch !== undefined) {
      evidence.push({ kind: "final binary identity", sha256: digest(dispatch.binary) });
      writeEvidence();
      expect(digest(dispatch.binary)).toBe(dispatch.binarySha256);
    }
  });

  for (const locale of ["en", "zh-CN"] as const) {
    const words = BUNDLES[locale];
    for (const [width, height] of ANCHORS) {
      const at = `${locale}-${String(width)}x${String(height)}`;

      it(`PM9.7 native I1 empty entry and refused Project actions, ${at}`, async () => {
        await open(emptyTable(locale), locale, width, height);
        await browser.$(".roster-empty").waitForExist({ timeout: 30_000 });
        const workbench = await sample(`i1-workbench-${at}`);
        expect(workbench.surface).toBe("workbench");
        expect(workbench.text).toContain(words.emptyEvidence);
        let add = await mark(".workbench-shell", words.addFiles, "data-pm97-native-add");
        if (add === null) { await unfoldRoster(at); add = await mark(".workbench-shell", words.addFiles, "data-pm97-native-add"); }
        expect(add).not.toBeNull();
        expect(await offered(add!)).toBe(true);
        await reach(add!, `${at} add acquisition`);
        await assertFocus(`${at} add acquisition`);
        await sample(`i1-add-focused-${at}`);
        expect(workbench.overflow).toEqual({ x: 0, y: 0 });

        await navigate(words.conversionTask);
        await browser.$("#workbench-conversion").waitForDisplayed();
        const conversion = await sample(`i1-conversion-${at}`);
        expect(conversion.surface).toBe("conversion");
        if (await browser.$(CONVERT).isExisting()) expect(await offered(CONVERT)).toBe(false);
        let more = await mark(".workbench-shell", words.addFiles, "data-pm97-native-add");
        if (more === null) { await unfoldRoster(at); more = await mark(".workbench-shell", words.addFiles, "data-pm97-native-add"); }
        expect(more).not.toBeNull();
        await reach(more!, `${at} conversion next action`);
        await assertFocus(`${at} conversion next action`);
        await sample(`i1-conversion-add-focused-${at}`);
        expect(conversion.overflow).toEqual({ x: 0, y: 0 });

        await navigate(words.projectSurface);
        await browser.$("[data-project-surface]").waitForDisplayed();
        const project = await sample(`i1-project-${at}`);
        expect(project.text).toContain(words.projectNoneHint);
        const create = await mark(".project-header", words.projectNew, "data-pm97-native-new");
        const reopen = await mark(".project-header", words.projectOpen, "data-pm97-native-open");
        expect([create, reopen].every(selector => selector !== null)).toBe(true);
        expect([await offered(create!), await offered(reopen!)]).toEqual([true, true]);
        const refused = await browser.execute(labels => labels.map(label => {
          const button = [...document.querySelectorAll<HTMLButtonElement>(".project-header button")].find(node => (node.textContent ?? "").trim() === label);
          return button === undefined ? { label, found: false } : {
            label, found: true, refused: button.getAttribute("aria-disabled"), disabled: button.disabled, opacity: getComputedStyle(button).opacity,
            title: button.title, describedBy: document.getElementById(button.getAttribute("aria-describedby") ?? "")?.textContent?.trim() ?? null,
          };
        }), [words.projectSave, words.projectSaveAs, words.projectClose]);
        evidence.push({ kind: "F1 refused Project controls", label: at, refused });
        for (const fact of refused) expect(fact).toMatchObject({ found: true, refused: "true", disabled: false, opacity: "0.48", title: "", describedBy: words.projectNone });
        const save = await mark(".project-header", words.projectSave, "data-pm97-native-save");
        expect(save).not.toBeNull();
        await reach(save!, `${at} refused Save`);
        expect(await browser.execute(() => getComputedStyle(document.activeElement!).opacity)).toBe("1");
        await assertFocus(`${at} refused Save`);
        await sample(`i1-save-refused-focused-${at}`);
        await reach(create!, `${at} New project`);
        await assertFocus(`${at} New project`);
        await sample(`i1-new-focused-${at}`);
        expect(project.overflow).toEqual({ x: 0, y: 0 });
      });

      it(`PM9.7 native I2 scrolled evidence and Project history, ${at}`, async () => {
        await viewer(locale, width, height);
        await browser.execute(() => { const node = document.querySelector<HTMLElement>("#workbench-evidence")!; node.scrollTop = node.scrollHeight; });
        const view = await sample(`i2-viewer-end-${at}`);
        const scanBottom = await browser.execute(() => document.querySelector(".spectrum-table-panel")!.getBoundingClientRect().bottom);
        expect(view.owner).not.toBeNull();
        expect(view.owner!.scrollTop + view.owner!.clientHeight).toBeGreaterThanOrEqual(view.owner!.scrollHeight - 1);
        expect(scanBottom).toBeLessThanOrEqual(view.owner!.bottom + 1);
        expect(view.header!.top).toBeGreaterThanOrEqual(0);
        expect(view.header!.bottom).toBeLessThanOrEqual(view.owner!.top + 1);
        expect(view.overflow).toEqual({ x: 0, y: 0 });
        await open(scenario("projectWithResult", locale), locale, width, height);
        await navigate(words.projectSurface);
        await browser.$("[data-project-run]").waitForExist();
        await browser.execute(() => { const node = document.querySelector<HTMLElement>("#workbench-project")!; node.scrollTop = node.scrollHeight; });
        const project = await sample(`i2-project-end-${at}`);
        const bottom = await browser.execute(() => [...document.querySelectorAll("[data-project-run]")].at(-1)!.getBoundingClientRect().bottom);
        expect(project.owner).not.toBeNull();
        expect(bottom).toBeLessThanOrEqual(project.owner!.bottom + 1);
        expect(project.header!.top).toBeGreaterThanOrEqual(0);
        expect(project.header!.bottom).toBeLessThanOrEqual(project.owner!.top + 1);
        expect(project.overflow).toEqual({ x: 0, y: 0 });
      });

      it(`PM9.7 native I3 Tab ring reach and ancestor clipping, ${at}`, async () => {
        const walk = async (label: string, minimum: number) => {
          await browser.execute(() => document.querySelector<HTMLElement>(".workbench-home")?.focus({ preventScroll: true }));
          let stops = 0;
          let ended: "body" | "brand" | null = null;
          for (let press = 0; press < 140; press += 1) {
            await browser.keys("Tab");
            await frames();
            const fact = await focusFacts();
            if (fact.onBody) { ended = "body"; break; }
            // Some native Tab cycles return directly to the first control.
            if (press > 0 && await browser.$(".workbench-home").isFocused()) { ended = "brand"; break; }
            stops += 1;
            await assertFocus(`${label} stop ${String(stops)}`);
            if (stops % 8 === 1) await sample(`i3-${label}-stop-${String(stops).padStart(2, "0")}`);
          }
          evidence.push({ kind: "real Tab walk", label, stops, minimum, limit: 140, ended });
          expect(stops).toBeGreaterThanOrEqual(minimum);
          expect(ended).not.toBeNull();
          await sample(`i3-${label}-end`);
        };
        await viewer(locale, width, height);
        await walk(`viewer-${at}`, width === 960 ? 13 : 20);
        await open(scenario("projectWithResult", locale), locale, width, height);
        await navigate(words.projectSurface);
        await browser.$("[data-project-run]").waitForExist();
        await walk(`project-${at}`, 8);
      });
    }
  }
});
