/** Production React in Chrome; only the existing Tauri IPC boundary is mocked. */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { consoleEntries, holdInvoke, installIpcBoundary, ipcCalls, releaseInvokeHold, setInvokeResult } from "../support/harness";
import { ipcTable } from "../support/fixtures";
import { selectedFile, unavailableBackend } from "../../apps/desktop/src/test/previewFixtures";
import { en } from "../../apps/desktop/src/features/preferences/locales/en";
import { zhCN as zh } from "../../apps/desktop/src/features/preferences/locales/zh-CN";

const DIALOG = "[data-settings-dialog]";
const ROW = '.dataset-roster-list [role="option"]';
const evidence: unknown[] = [];
let output = "";

async function openSettings() {
  await browser.execute(() => document.querySelector("[data-settings-entry]")!.scrollIntoView({ block: "nearest" }));
  await browser.$("[data-settings-entry]").click();
  await browser.$(DIALOG).waitForDisplayed();
}
async function choose(value: string) { await browser.$(`${DIALOG} input[value="${value}"]`).click(); }
async function press(name: string) {
  await browser.$(DIALOG).$(name === en.close || name === zh.close ? `button[aria-label="${name}"]` : `button=${name}`).click();
}
async function returned() {
  await browser.$(DIALOG).waitForExist({ reverse: true });
  await browser.waitUntil(() => browser.execute(() => document.activeElement?.matches("[data-settings-entry]") === true));
}

/** The ChromeDriver session's standard CDP endpoint; no additional test package. */
async function cdp(cmd: string, params: Record<string, unknown>) {
  const { hostname = "127.0.0.1", port, path = "/", protocol = "http" } = browser.options;
  if (port === undefined) throw new Error("The owned ChromeDriver port is missing.");
  const root = `${protocol}://${hostname}:${port}${path.endsWith("/") ? path : path + "/"}`;
  const response = await fetch(new URL(`session/${browser.sessionId}/goog/cdp/execute`, root), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd, params }),
  });
  const result = await response.json() as { value?: Record<string, unknown> };
  if (!response.ok || result.value?.error) throw new Error(`Chrome command refused: ${JSON.stringify(result)}`);
  return result.value ?? {};
}

async function metrics(width: number, height: number, dpr = 1) {
  await cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false, screenWidth: Math.round(width * dpr), screenHeight: Math.round(height * dpr) });
  await browser.waitUntil(() => browser.execute((w, h, scale) => innerWidth === w && innerHeight === h && devicePixelRatio === scale, width, height, dpr));
}

async function connectivityProbe(label: string) {
  const result = await browser.execute(async () => {
    try {
      const response = await fetch(`/?m71-connectivity=${Date.now()}`, { cache: "no-store" });
      return { reached: response.ok, online: navigator.onLine };
    } catch { return { reached: false, online: navigator.onLine }; }
  });
  evidence.push({ kind: "controlled local network probe", label, ...result });
  return result.reached;
}

async function capture(label: string, expectedDpr?: number) {
  const state = await browser.execute(() => {
    const dialog = document.querySelector<HTMLElement>("[data-settings-dialog]");
    const rect = dialog?.getBoundingClientRect();
    const rows = [...document.querySelectorAll<HTMLElement>('.dataset-roster-list [role="option"]')];
    return {
      cssViewport: { width: innerWidth, height: innerHeight }, devicePixelRatio,
      visualViewportScale: visualViewport?.scale, cssZoom: getComputedStyle(document.documentElement).zoom,
      locale: document.documentElement.lang, density: document.querySelector("[data-density]")?.getAttribute("data-density"),
      dialog: rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height, scrollWidth: dialog!.scrollWidth, clientWidth: dialog!.clientWidth } : null,
      rows: rows.map(row => ({ handle: row.dataset.handle, height: row.getBoundingClientRect().height, text: row.textContent, fontSize: getComputedStyle(row).fontSize })),
      font: dialog ? getComputedStyle(dialog).fontFamily : null,
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      dialogAnimation: dialog ? getComputedStyle(dialog).animationName : null,
      externalResources: performance.getEntriesByType("resource").map(entry => entry.name).filter(url => /^https?:/u.test(url) && new URL(url).origin !== location.origin),
    };
  });
  // Capture the existing Chrome session directly and measure before/after.
  // The earlier interaction/capture sequence did not retain its requested DPR.
  const shot = await cdp("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  if (typeof shot.data !== "string") throw new Error("Chrome did not return screenshot bytes.");
  const png = Buffer.from(shot.data, "base64");
  const raster = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  const afterScreenshot = await browser.execute(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }));
  evidence.push({ label, kind: "browser mock IPC; CDP DPR emulation, browser zoom 100%; not Windows scaling", ...state, raster, afterScreenshot });
  writeFileSync(join(output, `${label}.png`), png);
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(afterScreenshot).toEqual({ ...state.cssViewport, dpr: state.devicePixelRatio });
  if (expectedDpr !== undefined) expect(state.devicePixelRatio).toBe(expectedDpr);
  expect(Math.abs(raster.width - state.cssViewport.width * state.devicePixelRatio)).toBeLessThanOrEqual(1);
  expect(Math.abs(raster.height - state.cssViewport.height * state.devicePixelRatio)).toBeLessThanOrEqual(1);
  if (state.dialog) {
    expect(state.dialog.left).toBeGreaterThanOrEqual(0);
    expect(state.dialog.top).toBeGreaterThanOrEqual(0);
    expect(state.dialog.right).toBeLessThanOrEqual(state.cssViewport.width + 1);
    expect(state.dialog.bottom).toBeLessThanOrEqual(state.cssViewport.height + 1);
    expect(state.dialog.scrollWidth).toBeLessThanOrEqual(state.dialog.clientWidth + 1);
  }
  expect(state.externalResources).toEqual([]);
  return state;
}

async function loadWorkspace(emptySpectrum = false, refusedViewport = false) {
  const table = ipcTable({ emptySpectrum, refusedViewport });
  table.get_workspace_roster = { datasets: [selectedFile, { ...selectedFile, handle: "long-name", fileName: `${en.simplifiedChinese}_long_acquisition_name_preserved_without_ellipsis_or_identity_changes_2026_09_12.mzML` }], capacity: 1024 };
  await installIpcBoundary(table);
  await browser.url("/");
  await browser.$(ROW).waitForDisplayed();
  await browser.$(ROW).click();
  await browser.$("button=Preview focused").waitForEnabled();
  await browser.$("button=Preview focused").click();
  await browser.$('.spectrum-table[role="grid"]').waitForDisplayed();
  await browser.$('[role="grid"] [role="row"][aria-rowindex="2"]').click();
  await browser.$(".spectrum-panel").waitForDisplayed();
}

describe("M7.1 localized Settings and real shared consumers", () => {
  before(() => {
    const root = process.env["MSCANVAS_M71_OUTPUT_ROOT"] ?? resolve("test-results/m7.1");
    mkdirSync(root, { recursive: true });
    output = mkdtempSync(join(root, "browser-"));
    console.log(`M7.1 browser evidence: ${output}`);
  });
  afterEach(async () => {
    const console = await consoleEntries();
    evidence.push({ kind: "console", entries: console, calls: await ipcCalls() });
    writeFileSync(join(output, "evidence.json"), JSON.stringify(evidence, null, 2));
    expect(console).toEqual([]);
  });

  it("previews real row geometry offline, preserves work and returns keyboard ownership", async () => {
    await loadWorkspace();
    await metrics(1366, 768);
    await browser.$("#chromatogram-export-toggle").click();
    await browser.$('.spectrum-panel input[id$="-widthPx"]').setValue("00640");
    await browser.$('.spectrum-panel input[id$="-heightPx"]').setValue("480");
    await browser.$('.spectrum-panel input[id$="-pngDpi"]').setValue("1e");
    const before = await capture("01-comfortable-figure-draft");
    await browser.execute(() => {
      const target = window as unknown as { m71Nodes: Element[] };
      target.m71Nodes = [...document.querySelectorAll('.dataset-row, .spectrum-panel, input[id$="-widthPx"]')];
    });
    const calls = await ipcCalls();
    await cdp("Network.enable", {});
    expect(await connectivityProbe("before-offline")).toBe(true);
    await cdp("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    expect(await connectivityProbe("offline")).toBe(false);
    try {
      await openSettings();
      expect(await browser.execute(() => (document.activeElement as HTMLInputElement).value)).toBe("en");
      await choose("zh-CN");
      await choose("compact");
      const changed = await capture("02-chinese-compact-preview");
      expect(changed.rows[0].height).toBeLessThan(before.rows[0].height);
      expect(changed.rows[0].fontSize).toBe(before.rows[0].fontSize);
      expect(changed.rows.map(row => row.handle)).toEqual(before.rows.map(row => row.handle));
      // Native radio semantics plus the actual modal's Tab and Shift-Tab loop.
      for (let step = 0; step < 12; step++) {
        await browser.keys("Tab");
        expect(await browser.execute(() => document.querySelector("[data-settings-dialog]")?.contains(document.activeElement))).toBe(true);
      }
      await browser.keys(["Shift", "Tab"]);
      expect(await browser.execute(() => document.querySelector("[data-settings-dialog]")?.contains(document.activeElement))).toBe(true);
      await browser.action("pointer").move({ x: 2, y: 2 }).down().up().perform();
      expect(await browser.$(DIALOG).isExisting()).toBe(true);
      await press(zh.apply);
      await returned();
      expect(await browser.execute(() => document.documentElement.lang)).toBe("zh-CN");
      expect(await browser.execute(() => (window as unknown as { m71Nodes: Element[] }).m71Nodes.every(node => node.isConnected))).toBe(true);
      await openSettings();
      await press(zh.reset);
      const reset = await capture("03-reset-preview-english");
      expect(reset.rows[0].height).toBe(before.rows[0].height);
      await press(en.cancel);
      await returned();
      expect(await browser.execute(() => document.documentElement.lang)).toBe("zh-CN");
      await openSettings();
      await choose("en");
      await browser.keys("Escape");
      await returned();
      expect(await browser.execute(() => document.documentElement.lang)).toBe("zh-CN");
      expect(await ipcCalls()).toEqual(calls);
      const fieldFacts = await browser.execute(() => {
        const widths = [...document.querySelectorAll<HTMLInputElement>('input[id$="-widthPx"]')];
        const ids = [...document.querySelectorAll("[id]")].map(node => node.id);
        const themes = [...document.querySelectorAll<HTMLInputElement>('.spectrum-figure-settings input[type="radio"]')];
        return { widths: widths.map(input => input.value), idsUnique: new Set(ids).size === ids.length, themeGroups: new Set(themes.map(input => input.name)).size };
      });
      expect(fieldFacts).toEqual({ widths: ["00640", "00640"], idsUnique: true, themeGroups: 2 });
      expect(await browser.$('.spectrum-panel').$('button=Export SVG…').isEnabled()).toBe(true);
      expect(await browser.$('.spectrum-panel').$('button=Export PNG…').isEnabled()).toBe(false);
      await browser.$(ROW).scrollIntoView();
      await browser.$(ROW).click();
      await browser.keys("ArrowDown");
      expect(await browser.execute(() => document.activeElement?.getAttribute("data-handle"))).toBe("long-name");
      await capture("04-chinese-shared-figure-controls");
    } finally {
      await cdp("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      expect(await connectivityProbe("restored-online")).toBe(true);
    }
  });

  it("keeps Settings readable across four viewports and explicit 100/125/150/200 percent DPR emulation", async () => {
    await loadWorkspace();
    await browser.$("#chromatogram-export-toggle").click();
    const cases = [
      [1366, 768, 1], [1920, 1080, 1], [960, 640, 1], [1200, 800, 1],
      [1093, 614, 1.25], [1280, 720, 1.5], [480, 320, 2],
    ] as const;
    for (let index = 0; index < cases.length; index++) {
      const [width, height, dpr] = cases[index];
      await metrics(width, height, dpr);
      await openSettings();
      await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: dpr === 2 ? "reduce" : "no-preference" }] });
      await choose(index % 2 === 0 ? "zh-CN" : "en");
      await capture(`layout-${width}x${height}-dpr-${dpr}`, dpr);
      // Scroll the dialog's own surface and reach its last action by keyboard.
      for (let step = 0; step < 8; step++) await browser.keys("Tab");
      expect(await browser.execute(() => document.querySelector("[data-settings-dialog]")?.contains(document.activeElement))).toBe(true);
      if (dpr === 2) {
        await browser.execute(() => document.querySelector(".settings-dialog-actions .primary-button")!.scrollIntoView({ block: "center" }));
        const visible = await browser.execute(() => {
          const target = document.querySelector<HTMLElement>(".settings-dialog-actions .primary-button")!;
          const rect = target.getBoundingClientRect();
          return rect.top >= 0 && rect.bottom <= innerHeight;
        });
        expect(visible).toBe(true);
        await capture("layout-480x320-dpr-2-footer", dpr);
      }
      await press(index % 2 === 0 ? zh.apply : en.apply);
      await returned();
      // Both actual field instances must remain pointer/focus reachable at the
      // same scale after modal return, including their existing scroll owners.
      for (const panel of [".spectrum-panel", ".chromatogram-export-panel"]) {
        const input = browser.$(`${panel} input[id$="-widthPx"]`);
        // The pinned WDIO helper wheels at viewport (0, 0), outside these
        // nested scrollports. Use the DOM scroll operation, then a real click.
        await browser.execute((selector) => document.querySelector(`${selector} input[id$="-widthPx"]`)!.scrollIntoView({ block: "center" }), panel);
        await input.click();
        const field = await browser.execute((selector) => {
          const input = document.querySelector<HTMLInputElement>(`${selector} input[id$="-widthPx"]`)!;
          const rect = input.getBoundingClientRect();
          return { focused: document.activeElement === input, dpr: devicePixelRatio, fontSize: getComputedStyle(input).fontSize,
            rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
            scrollOwners: [...(function* () { for (let node = input.parentElement; node; node = node.parentElement) yield node; })()]
              .filter(node => node.scrollHeight > node.clientHeight)
              .map(node => ({ className: node.className, scrollTop: node.scrollTop, clientHeight: node.clientHeight, scrollHeight: node.scrollHeight, overflow: getComputedStyle(node).overflow })),
            visible: rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth };
        }, panel);
        evidence.push({ kind: "scaled shared consumer", panel, width, height, expectedDpr: dpr, ...field });
        if (!field.visible) await capture(`consumer-diagnostic-${width}x${height}-${panel.slice(1)}`, dpr);
        expect(field.focused).toBe(true);
        expect(field.visible).toBe(true);
        expect(field.dpr).toBe(dpr);
        expect(field.fontSize).toBe("13px");
      }
      await capture(`consumers-${width}x${height}-dpr-${dpr}`, dpr);
    }
    await metrics(1366, 768);
  });

  it("stays reachable over empty, loading and unsupported consumers", async () => {
    const table = ipcTable();
    table.inspect_backend = unavailableBackend;
    table.get_workspace_roster = { datasets: [], capacity: 1024 };
    await installIpcBoundary(table);
    await browser.url("/");
    await browser.$("[data-settings-entry]").waitForDisplayed();
    await openSettings();
    await choose("zh-CN");
    await capture("state-empty-unavailable-chinese");
    await press(zh.close);
    await returned();
    await loadWorkspace(true);
    await capture("state-empty-spectrum");
    await holdInvoke("open_mzml_preview");
    await browser.$("button=Preview focused").click();
    await openSettings();
    await choose("zh-CN");
    await capture("state-loading-chinese");
    await press(zh.cancel);
    await returned();
    await releaseInvokeHold("open_mzml_preview");
    await browser.$('.spectrum-table[role="grid"]').waitForDisplayed();
    await setInvokeResult("load_selected_spectrum", { __reject: { kind: "backend_failed", summary: "Controlled provider refusal", detail: "Original provider detail", retryable: true } });
    await browser.$('[role="grid"] [role="row"][aria-rowindex="2"]').click();
    await browser.waitUntil(async () => (await browser.$(".spectrum-panel").getText()).includes("Controlled provider refusal"));
    await openSettings();
    await capture("state-provider-error-english");
    await press(en.cancel);
    await returned();
    await loadWorkspace(false, true);
    await capture("state-unsupported-viewport");
  });
});
