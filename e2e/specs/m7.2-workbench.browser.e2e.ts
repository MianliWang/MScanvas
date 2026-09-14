/** Real production composition. Synthetic roster metadata and controlled IPC are browser evidence only. */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { installIpcBoundary, ipcCalls, consoleEntries, holdInvoke, heldCallers, releaseInvokeHold, setInvokeResult } from "../support/harness";
import { ipcTable } from "../support/fixtures";
import { selectedFile } from "../../apps/desktop/src/test/previewFixtures";

const row = (id: string) => `.grouped-roster [data-handle="${id}"]`;
let output = "";
const evidence: unknown[] = [];
async function cdp(cmd: string, params: Record<string, unknown>) {
  const { hostname = "127.0.0.1", port, path = "/", protocol = "http" } = browser.options;
  if (port === undefined) throw Error("Owned ChromeDriver port missing");
  const root = `${protocol}://${hostname}:${port}${path.endsWith("/") ? path : path + "/"}`;
  const response = await fetch(new URL(`session/${browser.sessionId}/goog/cdp/execute`, root), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cmd, params }) });
  const data = await response.json() as { value?: Record<string, unknown> };
  if (!response.ok || data.value?.error) throw Error(JSON.stringify(data));
  return data.value ?? {};
}
async function metrics(width: number, height: number, dpr: number) {
  await cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
  await browser.waitUntil(() => browser.execute((w, h, s) => innerWidth === w && innerHeight === h && devicePixelRatio === s, width, height, dpr));
}
async function capture(label: string) {
  const measured = await browser.execute(() => {
    const rect = (element: Element) => { const box = element.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height }; };
    const root = document.querySelector(".workbench-shell")!;
    return { css: { width: innerWidth, height: innerHeight }, dpr: devicePixelRatio, locale: document.documentElement.lang, surface: root.getAttribute("data-surface"), root: rect(root),
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
      controls: [...document.querySelectorAll(".workbench-header button")].map(node => ({ text: node.textContent, ...rect(node) })),
      roster: [...document.querySelectorAll(".grouped-roster [data-handle]")].map(node => ({ handle: node.getAttribute("data-handle"), group: node.getAttribute("data-group"), selected: node.getAttribute("aria-selected"), ...rect(node), font: getComputedStyle(node).fontSize })),
      evidence: [...document.querySelectorAll("#workbench-evidence svg")].map(node => rect(node)),
      motion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      external: performance.getEntriesByType("resource").map(entry => entry.name).filter(url => /^https?:/u.test(url) && new URL(url).origin !== location.origin),
    };
  });
  const screenshot = await cdp("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  if (typeof screenshot.data !== "string") throw Error("Screenshot bytes missing");
  const png = Buffer.from(screenshot.data, "base64");
  const raster = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  writeFileSync(join(output, `${label}.png`), png);
  evidence.push({ label, kind: "browser mock IPC; DPR emulation, not native Windows scale", ...measured, raster });
  expect(measured.horizontalOverflow).toBeLessThanOrEqual(1);
  expect(measured.external).toEqual([]);
  expect(Math.abs(raster.width - measured.css.width * measured.dpr)).toBeLessThanOrEqual(1);
  expect(Math.abs(raster.height - measured.css.height * measured.dpr)).toBeLessThanOrEqual(1);
  for (const control of measured.controls) {
    expect(control.x).toBeGreaterThanOrEqual(0);
    expect(control.x + control.width).toBeLessThanOrEqual(measured.css.width + 1);
    expect(control.y + control.height).toBeLessThanOrEqual(measured.css.height);
  }
}
async function newGroup(name: string) {
  await browser.$("button=New group").click();
  await browser.$("#organization-group-name").setValue(name);
  await browser.$("button=Save group").click();
  await browser.$(".group-name-dialog").waitForExist({ reverse: true });
}
async function locale(value: "en" | "zh-CN") {
  await browser.$("[data-settings-entry]").click();
  await browser.$(`[data-settings-dialog] input[value="${value}"]`).click();
  await browser.$("[data-settings-dialog]").$(value === "en" ? "button=Apply" : "button=应用").click();
  await browser.$("[data-settings-dialog]").waitForExist({ reverse: true });
}
async function viewerAnnouncement() {
  return browser.$('[data-live-region="viewer"]').getProperty("textContent");
}
async function center(selector: string) {
  return browser.execute(selector => {
    const element = document.querySelector(selector);
    if (!element) throw Error(`Missing target: ${selector}`);
    const box = element.getBoundingClientRect();
    return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  }, selector);
}
async function startDrag(selector: string) {
  const source = await center(selector);
  await browser.performActions([{ type: "pointer", id: "organization-pointer", parameters: { pointerType: "mouse" }, actions: [
    { type: "pointerMove", duration: 0, ...source, origin: "viewport" }, { type: "pointerDown", button: 0 },
    { type: "pointerMove", duration: 160, x: source.x + 12, y: source.y + 8, origin: "viewport" },
  ] }]);
  await browser.$('.grouped-roster[data-drag-active="true"]').waitForExist();
}
async function dragOver(selector: string) {
  await browser.performActions([{ type: "pointer", id: "organization-pointer", parameters: { pointerType: "mouse" }, actions: [
    { type: "pointerMove", duration: 320, ...await center(selector), origin: "viewport" }, { type: "pause", duration: 180 },
  ] }]);
}
async function dropDrag() {
  await browser.performActions([{ type: "pointer", id: "organization-pointer", parameters: { pointerType: "mouse" }, actions: [{ type: "pointerUp", button: 0 }] }]);
  await browser.releaseActions();
  await browser.$('.grouped-roster[data-drag-active="true"]').waitForExist({ reverse: true });
}
describe("M7.2 workbench shell and grouped roster", () => {
  before(() => { const root = process.env["MSCANVAS_M72_OUTPUT_ROOT"] ?? resolve("test-results/m7.2"); mkdirSync(root, { recursive: true }); output = mkdtempSync(join(root, "browser-")); console.log(`M7.2 browser evidence: ${output}`); });
  after(async () => { evidence.push({ console: await consoleEntries(), keyboard: await browser.execute(() => Reflect.get(window, "__m72Keys") ?? []) }); writeFileSync(join(output, "evidence.json"), JSON.stringify(evidence, null, 2)); });
  afterEach(async function () {
    evidence.push({ test: this.currentTest?.title, state: this.currentTest?.state, console: await consoleEntries(), calls: await ipcCalls() });
    if (this.currentTest?.state === "failed") {
      await browser.saveScreenshot(join(output, `failure-${evidence.length}.png`));
      evidence.push({ failedDocument: await browser.execute(() => document.body.innerText.slice(0, 8000)) });
    }
    writeFileSync(join(output, "evidence.json"), JSON.stringify(evidence, null, 2));
  });
  it("review regression: announces successive in-group keyboard destinations before committing", async () => {
    for (const language of ["en", "zh-CN"] as const) {
      const table: Record<string, unknown> = ipcTable();
      table.subscribe_workspace_drop_updates = { reservationId: "browser-m72-reservation" };
      table.get_workspace_roster = { capacity: 1024, datasets: [0, 1, 2].map(index => ({ ...selectedFile,
        handle: `feedback-${index}`, sourceKind: "thermo_raw", fileName: `采集_${index}.raw`,
      })) };
      await installIpcBoundary(table); await browser.url("/"); await metrics(1366, 768, 1.5);
      await browser.$(row("feedback-0")).waitForDisplayed();
      if (language === "zh-CN") await locale(language);
      const before = await ipcCalls();
      await browser.$(`${row("feedback-0")} .row-drag-handle`).click();
      await browser.keys("\uE00D");
      await browser.$('.grouped-roster[data-drag-active="true"]').waitForExist();
      for (const position of [2, 3]) {
        await browser.keys("ArrowDown");
        const expected = language === "en" ? `Move to Ungrouped, position ${position} of 3 (1 selected).` : `移至未分组，第 ${position} 位，共 3 个采集（已选 1 个）。`;
        await browser.waitUntil(async () => await browser.$(".organization-notice").getText() === expected);
        expect(await browser.$$(".grouped-roster [data-handle]").map(node => node.getAttribute("data-handle"))).toEqual(["feedback-0", "feedback-1", "feedback-2"]);
        evidence.push({ kind: "pre-commit keyboard destination", language, position, announcement: await browser.$(".organization-notice").getText() });
        await capture(`review-keyboard-${language}-${position}`);
      }
      await browser.keys("Enter");
      await browser.$('.grouped-roster[data-drag-active="true"]').waitForExist({ reverse: true });
      expect(await browser.$$(".grouped-roster [data-handle]").map(node => node.getAttribute("data-handle"))).toEqual(["feedback-1", "feedback-2", "feedback-0"]);
      expect(await ipcCalls()).toEqual(before);
      expect(await consoleEntries()).toEqual([]);
    }
  });
  it("review regression: keeps empty, reading and failed evidence reachable when details are unavailable", async () => {
    for (const language of ["en", "zh-CN"] as const) {
      const table: Record<string, unknown> = ipcTable();
      table.subscribe_workspace_drop_updates = { reservationId: "browser-m72-reservation" };
      table.get_workspace_roster = { capacity: 1024, datasets: [selectedFile] };
      await installIpcBoundary(table); await metrics(1920, 1080, 1); await browser.url("/");
      if (language === "zh-CN") await locale(language);
      const details = browser.$('[aria-controls="workbench-inspector"]');
      const unavailable = async (state: string) => {
        expect(await details.isEnabled()).toBe(false);
        expect(await details.getAttribute("aria-expanded")).toBe("false");
        expect(await browser.$("#workbench-inspector").isDisplayed()).toBe(false);
        expect(await browser.$("#workbench-evidence").isDisplayed()).toBe(true);
        await capture(`review-inspector-${language}-${state}`);
      };
      await browser.$("#workbench-evidence .empty-state").waitForDisplayed();
      await unavailable("wide-empty");
      await metrics(960, 640, 2);
      await unavailable("empty");
      await holdInvoke("open_mzml_preview");
      await browser.$('[aria-controls="workbench-roster"]').click();
      await browser.$(row(selectedFile.handle)).click();
      await browser.waitUntil(async () => await heldCallers("open_mzml_preview") === 1);
      await browser.$(".workbench-home").click();
      expect(await browser.$("#workbench-evidence strong").getText()).toBe(language === "en" ? "Reading the acquisition…" : "正在读取采集…");
      await unavailable("reading");
      // A held call resolves at release; a malformed DTO exercises the real
      // adapter's retryable protocol failure without modifying the harness.
      await setInvokeResult("open_mzml_preview", { malformedPreview: true });
      await releaseInvokeHold("open_mzml_preview");
      await browser.$("#workbench-evidence").$("strong=Something went wrong while talking to the MSCanvas backend.").waitForDisplayed();
      await unavailable("failed");
      await setInvokeResult("open_mzml_preview", table.open_mzml_preview);
      await browser.$("#workbench-evidence").$(language === "en" ? "button=Try reading this file again" : "button=重试读取此文件").click();
      await details.waitForEnabled(); await details.click();
      await browser.$("#workbench-inspector").waitForDisplayed();
      expect(await browser.$("#workbench-inspector").getText()).toContain(selectedFile.fileName);
      await capture(`review-inspector-${language}-loaded`);
      // Re-read with an already requested inspector. Availability must close it
      // immediately, even before a resize folds the constrained layout.
      await metrics(1366, 768, 1.5);
      await browser.$('[aria-controls="workbench-roster"]').click();
      await holdInvoke("open_mzml_preview");
      await browser.$(".dataset-roster-actions button:nth-child(3)").click();
      await browser.waitUntil(async () => await heldCallers("open_mzml_preview") === 1);
      await unavailable("already-open-reading");
      await metrics(960, 640, 2);
      await unavailable("narrowed-reading");
      await setInvokeResult("open_mzml_preview", { malformedPreview: true });
      await releaseInvokeHold("open_mzml_preview");
      await browser.$("#workbench-evidence").$("strong=Something went wrong while talking to the MSCanvas backend.").waitForDisplayed();
      await unavailable("narrowed-failed");
      expect(await consoleEntries()).toEqual([]);
    }
  });
  it("review regression: reveals accepted roster previews and leaves rejected activation on its current surface", async () => {
    for (const [width, language, activation] of [[960, "en", "pointer"], [1366, "zh-CN", "keyboard"], [960, "zh-CN", "button"]] as const) {
      const table: Record<string, unknown> = ipcTable();
      table.subscribe_workspace_drop_updates = { reservationId: "browser-m72-reservation" };
      table.get_workspace_roster = { capacity: 1024, datasets: [selectedFile, { ...selectedFile, handle: "unreadable-raw", fileName: "研究.raw", sourceKind: "thermo_raw" }] };
      await installIpcBoundary(table); await metrics(width, 768, 1.5); await browser.url("/");
      if (language === "zh-CN") await locale(language);
      await browser.$(".workbench-navigation button:nth-child(2)").click();
      if (width === 960) await browser.$('[aria-controls="workbench-roster"]').click();
      const before = await ipcCalls();
      await browser.$(row("unreadable-raw")).click();
      expect(await browser.$(".workbench-shell").getAttribute("data-surface")).toBe("conversion");
      expect(await ipcCalls()).toEqual(before);
      // Highlighting/focusing an mzML row is not an activation request.
      await browser.performActions([{ type: "key", id: "reveal-selection", actions: [{ type: "keyDown", value: "\uE009" }] }]);
      await browser.$(row(selectedFile.handle)).click(); await browser.releaseActions();
      expect(await browser.$(".workbench-shell").getAttribute("data-surface")).toBe("conversion");
      expect(await ipcCalls()).toEqual(before);
      await holdInvoke("open_mzml_preview");
      if (activation === "pointer") await browser.$(row(selectedFile.handle)).click();
      else if (activation === "keyboard") await browser.keys("Enter");
      else await browser.$(".dataset-roster-actions button:nth-child(3)").click();
      await browser.waitUntil(async () => await heldCallers("open_mzml_preview") === 1);
      expect(await browser.$(".workbench-shell").getAttribute("data-surface")).toBe("workbench");
      expect(await browser.$("#workbench-evidence").isDisplayed()).toBe(true);
      if (width === 960) {
        expect(await browser.$("#workbench-roster").isDisplayed()).toBe(false);
        expect(await browser.execute(() => document.activeElement?.id)).toBe("workbench-evidence");
      }
      await capture(`review-reveal-${width}-${language}-${activation}`);
      // A subsequent deliberate navigation stays authoritative while reading.
      await browser.$(".workbench-navigation button:nth-child(2)").click();
      if (width === 960) await browser.$('[aria-controls="workbench-roster"]').click();
      const pendingCalls = await ipcCalls();
      await browser.$(row(selectedFile.handle)).click();
      expect(await browser.$(".workbench-shell").getAttribute("data-surface")).toBe("conversion");
      expect(await ipcCalls()).toEqual(pendingCalls);
      await releaseInvokeHold("open_mzml_preview");
      await browser.$(".spectrum-table").waitForExist();
      expect(await browser.$(".workbench-shell").getAttribute("data-surface")).toBe("conversion");
      await browser.$(".workbench-home").click();
      await browser.$(".spectrum-table").waitForDisplayed();
      expect(await consoleEntries()).toEqual([]);
    }
  });
  it("review regression: omits unknown roster capacity through initial loading and failure", async () => {
    for (const language of ["en", "zh-CN"] as const) {
      const table: Record<string, unknown> = ipcTable();
      table.subscribe_workspace_drop_updates = { reservationId: "browser-m72-reservation" };
      table.get_workspace_roster = { capacity: 1024, datasets: [] };
      await installIpcBoundary(table, { hold: ["get_workspace_roster"] });
      await metrics(1366, 768, 1.5); await browser.url("/");
      if (language === "zh-CN") await locale(language);
      await browser.waitUntil(async () => await heldCallers("get_workspace_roster") === 1);
      expect(await browser.$("#dataset-roster-matches").isExisting()).toBe(false);
      expect(await browser.$('[data-live-region="search"]').getProperty("textContent")).toBe("");
      await capture(`review-capacity-${language}-loading`);
      await setInvokeResult("get_workspace_roster", { malformedRoster: true });
      await releaseInvokeHold("get_workspace_roster");
      const retry = browser.$(language === "en" ? "button=Try reading it again" : "button=重试读取列表");
      await retry.waitForDisplayed();
      expect(await browser.$("#dataset-roster-matches").isExisting()).toBe(false);
      expect(await browser.$(".dataset-roster-actions button:first-child").isEnabled()).toBe(true);
      expect(await browser.$('[data-live-region="search"]').getProperty("textContent")).toBe("");
      await capture(`review-capacity-${language}-failed`);
      await setInvokeResult("get_workspace_roster", { capacity: 1024, datasets: [] });
      await retry.click();
      await browser.waitUntil(async () => (await browser.$("#dataset-roster-matches").getText()).includes("1024"));
      expect(await browser.$("#dataset-roster-matches").getAttribute("title")).toContain("1024");
      expect(await browser.$('[data-live-region="search"]').getProperty("textContent")).toContain("1024");
      await capture(`review-capacity-${language}-known`);
      expect(await consoleEntries()).toEqual([]);
    }
  });
  it("review regression: restores group-menu focus after dissolving while retaining rename and Escape", async () => {
    for (const language of ["en", "zh-CN"] as const) {
      const table: Record<string, unknown> = ipcTable();
      table.subscribe_workspace_drop_updates = { reservationId: "browser-m72-reservation" };
      table.get_workspace_roster = { capacity: 1024, datasets: [selectedFile] };
      await installIpcBoundary(table); await metrics(1366, 768, 1.5); await browser.url("/");
      await browser.$(row(selectedFile.handle)).waitForDisplayed();
      const originalGroup = await browser.$(row(selectedFile.handle)).getAttribute("data-group");
      await newGroup("Dissolve target");
      await browser.$(`${row(selectedFile.handle)} .row-menu-trigger`).click();
      await browser.$('[role="menuitem"]=Dissolve target').click();
      if (language === "zh-CN") await locale(language);
      const before = await ipcCalls();
      const membership = await browser.$(`${row(selectedFile.handle)} input[type="checkbox"]`).isSelected();
      const group = '.roster-group-header[data-group-id="group-1"]';
      const trigger = `${group} .row-menu-trigger`;
      await browser.$(trigger).click(); await browser.keys("Escape");
      await browser.waitUntil(() => browser.execute(selector => document.activeElement?.matches(selector) === true, trigger));
      await browser.$(trigger).click(); await browser.keys(["Home", "Enter"]);
      await browser.$(".group-name-dialog").waitForDisplayed();
      expect(await browser.$("#organization-group-name").getValue()).toBe("Dissolve target");
      await browser.keys("Escape");
      await browser.$(".group-name-dialog").waitForExist({ reverse: true });
      await browser.waitUntil(() => browser.execute(selector => document.activeElement?.matches(selector) === true, trigger));
      await capture(`review-group-dissolve-${language}-before`);
      await browser.$(trigger).click(); await browser.keys(["End", "Enter"]);
      await browser.$(group).waitForExist({ reverse: true });
      await browser.waitUntil(() => browser.execute(() => document.activeElement?.matches(".organization-toolbar button:first-child") === true));
      expect(await browser.$(row(selectedFile.handle)).getAttribute("data-group")).toBe(originalGroup);
      expect(await browser.$(`${row(selectedFile.handle)} input[type="checkbox"]`).isSelected()).toBe(membership);
      expect(await ipcCalls()).toEqual(before);
      await capture(`review-group-dissolve-${language}-after`);
      expect(await consoleEntries()).toEqual([]);
    }
  });
  it("review disposition: keeps matching acquisitions in collapsed groups recoverable", async () => {
    for (const language of ["en", "zh-CN"] as const) {
      const table: Record<string, unknown> = ipcTable();
      table.subscribe_workspace_drop_updates = { reservationId: "browser-m72-reservation" };
      table.get_workspace_roster = { capacity: 1024, datasets: [selectedFile] };
      await installIpcBoundary(table); await metrics(1366, 768, 1.5); await browser.url("/");
      await browser.$(row(selectedFile.handle)).waitForDisplayed();
      await newGroup("Collapsed matches");
      const group = '.roster-group-header[data-group-id="group-1"]';
      await browser.$(`${group} .group-disclosure`).click();
      await browser.$(`${row(selectedFile.handle)} .row-menu-trigger`).click();
      await browser.$('[role="menuitem"]=Collapsed matches').click();
      if (language === "zh-CN") await locale(language);
      const before = await ipcCalls();
      await browser.$("#dataset-roster-search").setValue(selectedFile.fileName);
      expect(await browser.$(".roster-empty strong").getText()).toBe(language === "en" ? "No matching rows are visible" : "没有可见的匹配行");
      expect(await browser.$(".roster-empty span").getText()).toBe(language === "en" ? "Clear the search or expand a group. Hidden highlighted rows remain selected." : "请清除搜索或展开分组。隐藏的高亮行仍保持选中。");
      expect(await browser.$(`${group} .group-count`).getText()).toBe("1");
      await capture(`review-collapsed-match-${language}`);
      await browser.$(`${group} .group-disclosure`).click();
      await browser.$(row(selectedFile.handle)).waitForDisplayed();
      expect(await browser.$("#dataset-roster-search").getValue()).toBe(selectedFile.fileName);
      expect(await browser.$(".roster-empty").isExisting()).toBe(false);
      expect(await ipcCalls()).toEqual(before);
      expect(await consoleEntries()).toEqual([]);
    }
  });
  it("review regression: restores row-menu focus after moving into a collapsed group", async () => {
    const table: Record<string, unknown> = ipcTable();
    table.subscribe_workspace_drop_updates = { reservationId: "browser-m72-reservation" };
    table.get_workspace_roster = { capacity: 1024, datasets: [selectedFile] };
    await installIpcBoundary(table); await metrics(1366, 768, 1.5); await browser.url("/");
    await browser.$(row(selectedFile.handle)).waitForDisplayed();
    await newGroup("Keyboard destination");
    const group = '.roster-group-header[data-group-id="group-1"]';
    await browser.$(`${group} .group-disclosure`).click();
    const before = await ipcCalls();
    await browser.$(`${row(selectedFile.handle)} .row-menu-trigger`).click();
    await browser.keys(["End", "Enter"]);
    await browser.$('[role="menu"]').waitForExist({ reverse: true });
    await browser.$(row(selectedFile.handle)).waitForExist({ reverse: true });
    await browser.waitUntil(() => browser.execute(() => document.activeElement?.matches('.roster-group-header[data-group-id="group-1"] .group-disclosure') === true));
    await capture("review-menu-collapsed-focus");
    await browser.keys("Enter");
    await browser.$(row(selectedFile.handle)).waitForDisplayed();
    expect(await ipcCalls()).toEqual(before);
    expect(await consoleEntries()).toEqual([]);
  });
  it("review regression: falls back when a bulk move unmounts the destination header", async () => {
    const table: Record<string, unknown> = ipcTable();
    table.subscribe_workspace_drop_updates = { reservationId: "browser-m72-reservation" };
    table.get_workspace_roster = { capacity: 1024, datasets: Array.from({ length: 230 }, (_, index) => ({ ...selectedFile,
      handle: `menu-${index}`, sourceKind: "thermo_raw", fileName: `${index < 80 ? "Move" : "Tail"}_${index}.raw`,
    })) };
    await installIpcBoundary(table); await metrics(1366, 768, 1.5); await browser.url("/");
    await browser.$(row("menu-0")).waitForDisplayed();
    await newGroup("Collapsed target"); await newGroup("Tail");
    const search = browser.$("#dataset-roster-search");
    await search.setValue("Tail_"); await browser.$(row("menu-80")).click();
    await browser.performActions([{ type: "key", id: "menu-tail-select", actions: [{ type: "keyDown", value: "\uE009" }, { type: "keyDown", value: "a" }, { type: "keyUp", value: "a" }, { type: "keyUp", value: "\uE009" }] }]);
    await browser.releaseActions();
    expect(await browser.$(".roster-selection-context").getText()).toContain("150 highlighted");
    await browser.$(`${row("menu-80")} .row-menu-trigger`).click();
    await browser.$('[role="menuitem"]=Tail').click();
    await search.setValue("Move_"); await browser.$(row("menu-0")).click();
    await browser.performActions([{ type: "key", id: "menu-source-select", actions: [{ type: "keyDown", value: "\uE009" }, { type: "keyDown", value: "a" }, { type: "keyUp", value: "a" }, { type: "keyUp", value: "\uE009" }] }]);
    await browser.releaseActions();
    expect(await browser.$(".roster-selection-context").getText()).toContain("80 highlighted");
    await browser.keys("End"); await browser.$(row("menu-79")).waitForDisplayed();
    await browser.$("button=Clear search").click();
    await browser.$('[data-group-id="group-1"] .group-disclosure').click();
    await browser.$(`${row("menu-79")} .row-menu-trigger`).click();
    expect(await browser.$('.grouped-roster[data-windowed="true"]').isExisting()).toBe(true);
    const before = await ipcCalls();
    const beforeScroll = await browser.execute(() => {
      const target = document.querySelector('[data-group-id="group-1"] .group-disclosure');
      if (target === null) throw Error("Target header must be mounted before the move.");
      Reflect.set(window, "__m72MenuTargetBefore", target);
      return document.querySelector(".grouped-roster")!.scrollTop;
    });
    expect(beforeScroll).toBeGreaterThan(1000);
    await browser.$('[role="menuitem"]=Collapsed target').click();
    await browser.$('[role="menu"]').waitForExist({ reverse: true });
    evidence.push({ kind: "bulk menu windowing after move", beforeScroll, observed: await browser.execute(() => ({
      targetConnected: (Reflect.get(window, "__m72MenuTargetBefore") as Element).isConnected,
      focus: document.activeElement?.outerHTML, scrollTop: document.querySelector(".grouped-roster")!.scrollTop,
      groups: Array.from(document.querySelectorAll(".roster-group-header")).map(element => ({ id: element.getAttribute("data-group-id"), text: element.textContent, expanded: element.getAttribute("aria-expanded") })),
      selection: document.querySelector(".roster-selection-context")?.textContent,
    })) });
    await browser.waitUntil(() => browser.execute(() => !(Reflect.get(window, "__m72MenuTargetBefore") as Element).isConnected));
    await browser.waitUntil(() => browser.execute(() => document.activeElement?.matches(".organization-toolbar button:first-child") === true));
    expect(await ipcCalls()).toEqual(before);
    expect(await browser.$(".roster-selection-context").getText()).toContain("80 highlighted · 80 hidden");
    await capture("review-menu-unmounted-target-fallback");
    expect(await consoleEntries()).toEqual([]);
  });
  it("keeps work and independent checked/highlighted state through real navigation and organization", async () => {
    const table = ipcTable();
    table.get_workspace_roster = { capacity: 1024, datasets: [selectedFile, ...Array.from({ length: 5 }, (_, i) => ({ ...selectedFile, handle: `sample-${i}`, fileName: `研究样本_${i}_long_acquisition_name.mzML` }))] };
    await installIpcBoundary(table);
    await browser.url("/"); await metrics(1366, 768, 1.5);
    await browser.$(row(selectedFile.handle)).waitForDisplayed();
    await browser.$(row(selectedFile.handle)).click();
    await browser.$(".chromatogram-panel").waitForDisplayed();
    await capture("01-workbench-before-organization");
    await browser.$(`${row("sample-0")} input`).click();
    await browser.performActions([{ type: "key", id: "roster-modifier", actions: [{ type: "keyDown", value: "\uE009" }] }]);
    await browser.$(row("sample-1")).click(); await browser.releaseActions();
    expect(await browser.$(`${row("sample-0")} input`).isSelected()).toBe(true);
    expect(await browser.$(`${row("sample-1")} input`).isSelected()).toBe(false);
    await newGroup("Session group 研究");
    const before = await ipcCalls();
    await browser.$(`${row("sample-1")} .row-menu-trigger`).click();
    await browser.$('[role="menuitem"]=Session group 研究').click();
    expect(await browser.$(row("sample-1")).getAttribute("data-group")).toBe("group-1");
    expect(await ipcCalls()).toEqual(before);
    await browser.$("button=Undo organization").click();
    expect(await browser.$(row("sample-1")).getAttribute("data-group")).toBe("ungrouped");
    await browser.$(".workbench-navigation button:nth-child(2)").click();
    await browser.$("#workbench-conversion").waitForDisplayed();
    await browser.$(".workbench-home").click();
    await browser.$(".chromatogram-panel").waitForDisplayed();
    expect(await ipcCalls()).toEqual(before);
    await capture("02-workbench-retained-home");
    await metrics(1920, 1080, 1);
    await startDrag(`${row("sample-1")} .row-drag-handle`);
    await capture("03-pointer-pickup");
    await dragOver('[data-group-id="group-1"]');
    await capture("04-pointer-target");
    await dropDrag();
    expect(await browser.$(row("sample-1")).getAttribute("data-group")).toBe("group-1");
    expect(await browser.$(row(selectedFile.handle)).getAttribute("data-group")).toBe("group-1");
    expect(await ipcCalls()).toEqual(before);
    await capture("05-pointer-drop");
    await browser.$("button=Undo organization").click();
    await startDrag(`${row("sample-1")} .row-drag-handle`);
    await dragOver('[data-group-id="group-1"]');
    await browser.keys("Escape");
    await browser.releaseActions();
    await browser.$('.grouped-roster[data-drag-active="true"]').waitForExist({ reverse: true });
    expect(await browser.$(row("sample-1")).getAttribute("data-group")).toBe("ungrouped");
    expect(await ipcCalls()).toEqual(before);
    await browser.performActions([{ type: "key", id: "roster-modifier", actions: [{ type: "keyDown", value: "\uE009" }] }]);
    await browser.$(row("sample-2")).click(); await browser.releaseActions();
    await browser.$("#dataset-roster-search").setValue("研究样本_1");
    await browser.execute(() => {
      const field = document.querySelector<HTMLInputElement>("#dataset-roster-search")!;
      field.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape", code: "Escape", isComposing: true }));
    });
    expect(await browser.$("#dataset-roster-search").getValue()).toBe("研究样本_1");
    expect(await browser.$(row("sample-2")).isExisting()).toBe(false);
    await browser.$('[data-group-id="group-1"] .group-disclosure').click();
    await startDrag(`${row("sample-1")} .row-drag-handle`);
    await dragOver('[data-group-id="group-1"]');
    await capture("06-hidden-payload-collapsed-target");
    await dropDrag();
    expect(await browser.$('[data-group-id="group-1"] .group-count').getText()).toBe("3");
    await browser.$("button=Clear search").click();
    await browser.$('[data-group-id="group-1"] .group-disclosure').click();
    for (const handle of [selectedFile.handle, "sample-1", "sample-2"]) expect(await browser.$(row(handle)).getAttribute("data-group")).toBe("group-1");
    await browser.performActions([{ type: "key", id: "roster-modifier", actions: [{ type: "keyDown", value: "\uE009" }] }]);
    await browser.$(row("sample-1")).click(); await browser.releaseActions();
    await browser.$('[data-group-id="group-1"] .group-disclosure').click();
    expect(await browser.execute(() => document.activeElement?.matches('[data-group-id="group-1"] .group-disclosure'))).toBe(true);
    await browser.keys("\uE00D");
    expect(await browser.$('[data-group-id="group-1"] .group-disclosure').getAttribute("aria-expanded")).toBe("true");
    await browser.$('[data-group-id="group-1"] .row-menu-trigger').click();
    await browser.$('[role="menuitem"]=Rename group').click();
    await browser.$("#organization-group-name").setValue("Raw 研究/../QC");
    await browser.execute(() => {
      const input = document.querySelector("#organization-group-name")!;
      input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape", code: "Escape" }));
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter", code: "Enter" }));
    });
    expect(await browser.$(".group-name-dialog").isDisplayed()).toBe(true);
    expect(await browser.$("#organization-group-name").getValue()).toBe("Raw 研究/../QC");
    await browser.execute(() => document.querySelector("#organization-group-name")!.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })));
    await browser.keys("Enter");
    await browser.$(".group-name-dialog").waitForExist({ reverse: true });
    await browser.waitUntil(() => browser.execute(() => document.activeElement?.matches('[data-group-id="group-1"] .row-menu-trigger') === true));
    expect(await browser.$('[data-group-id="group-1"] .group-disclosure').getText()).toContain("Raw 研究/../QC");
    await browser.execute(() => {
      const keys: unknown[] = []; Reflect.set(window, "__m72Keys", keys);
      document.addEventListener("keydown", event => { if (keys.length < 30) keys.push({ key: event.key, code: event.code, trusted: event.isTrusted, target: (event.target as Element)?.getAttribute("aria-label") }); }, true);
    });
    await browser.$(`${row("sample-0")} .row-drag-handle`).click();
    await browser.keys("\uE00D");
    await browser.$('.grouped-roster[data-drag-active="true"]').waitForExist();
    await browser.keys("ArrowDown");
    await capture("07-keyboard-target");
    await browser.keys("Enter");
    await browser.$('.grouped-roster[data-drag-active="true"]').waitForExist({ reverse: true });
    const ungrouped = await browser.$$('.grouped-roster [data-group="ungrouped"]').map(element => element.getAttribute("data-handle"));
    expect(ungrouped).toEqual(["sample-3", "sample-0", "sample-4"]);
    expect(await ipcCalls()).toEqual(before);
    await capture("08-keyboard-drop");
    evidence.push({ kind: "actual browser keyboard events", keys: await browser.execute(() => Reflect.get(window, "__m72Keys")) });
    expect(await consoleEntries()).toEqual([]);
  });
  it("moves an offscreen selection in a windowed roster and keeps narrow bilingual controls reachable", async () => {
    const table: Record<string, unknown> = ipcTable();
    table.subscribe_workspace_drop_updates = { reservationId: "browser-m72-reservation" };
    table.get_workspace_roster = { capacity: 1024, datasets: Array.from({ length: 200 }, (_, index) => ({ ...selectedFile,
      handle: `wide-${index}`, sourceKind: "thermo_raw", fileName: `采集_${index}${index % 9 === 0 ? "_variable_height_very_long_acquisition_label_研究项目重复条件" : ""}.raw`,
    })) };
    await installIpcBoundary(table); await browser.url("/"); await metrics(1920, 1080, 1);
    await browser.$(row("wide-0")).waitForDisplayed();
    await newGroup("Offscreen group");
    await browser.$(row("wide-0")).click();
    await browser.performActions([{ type: "key", id: "roster-select-all", actions: [
      { type: "keyDown", value: "\uE009" }, { type: "keyDown", value: "a" }, { type: "keyUp", value: "a" }, { type: "keyUp", value: "\uE009" },
    ] }]);
    await browser.releaseActions();
    expect(await browser.$(".roster-selection-context").getText()).toBe("200 highlighted · 0 hidden · 0 checked");
    expect(await browser.$$(".grouped-roster [data-handle]").length).toBeLessThan(80);
    const before = await ipcCalls();
    await startDrag(`${row("wide-0")} .row-drag-handle`);
    const edge = await browser.execute(() => { const b = document.querySelector(".grouped-roster")!.getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.bottom - 9) }; });
    await browser.performActions([{ type: "pointer", id: "organization-pointer", parameters: { pointerType: "mouse" }, actions: [{ type: "pointerMove", ...edge, origin: "viewport", duration: 300 }] }]);
    await browser.waitUntil(() => browser.execute(() => document.querySelector(".grouped-roster")!.scrollTop > 100));
    await capture("09a-dnd-owned-auto-scroll");
    await browser.keys("Escape"); await browser.releaseActions();
    await browser.$('.grouped-roster[data-drag-active="true"]').waitForExist({ reverse: true });
    await browser.$(row("wide-0")).click();
    await browser.performActions([{ type: "key", id: "roster-select-all", actions: [{ type: "keyDown", value: "\uE009" }, { type: "keyDown", value: "a" }, { type: "keyUp", value: "a" }, { type: "keyUp", value: "\uE009" }] }]);
    await browser.releaseActions();
    await browser.keys("End");
    await browser.$(row("wide-199")).waitForDisplayed();
    expect(await browser.$(row("wide-0")).isExisting()).toBe(false);
    await capture("09-windowed-end");
    const scrollPoint = await center(".grouped-roster");
    await browser.performActions([{ type: "wheel", id: "roster-wheel", actions: [{ type: "scroll", ...scrollPoint, deltaX: 0, deltaY: 180, duration: 200, origin: "viewport" }] }]);
    await browser.waitUntil(() => browser.execute(() => {
      const bounds = document.querySelector(".grouped-roster")!.getBoundingClientRect();
      const target = document.querySelector('[data-group-id="group-1"]')?.getBoundingClientRect();
      return target !== undefined && target.top >= bounds.top && target.bottom <= bounds.bottom;
    }));
    await startDrag(`${row("wide-199")} .row-drag-handle`);
    await dragOver('[data-group-id="group-1"]');
    await capture("10-windowed-200-payload");
    await dropDrag();
    expect(await browser.$(row("wide-199")).getAttribute("data-group")).toBe("group-1");
    await browser.performActions([{ type: "wheel", id: "roster-wheel", actions: [{ type: "scroll", ...scrollPoint, deltaX: 0, deltaY: -20000, duration: 200, origin: "viewport" }] }]);
    await browser.$('[data-group-id="group-1"]').waitForExist();
    expect(await browser.$('[data-group-id="group-1"] .group-count').getText()).toBe("200");
    expect(await ipcCalls()).toEqual(before);
    await browser.$("button=Undo organization").click();
    expect(await browser.$(row("wide-0")).getAttribute("data-group")).toBe("ungrouped");
    await browser.$("[data-settings-entry]").click();
    await browser.$('[data-settings-dialog] input[value="zh-CN"]').click();
    await browser.$('[data-settings-dialog] input[value="compact"]').click();
    await browser.$('[data-settings-dialog]').$("button=应用").click();
    await browser.$('[data-settings-dialog]').waitForExist({ reverse: true });
    await metrics(1200, 800, 1.25); await capture("11-zh-compact-1200");
    await metrics(960, 640, 2);
    await browser.$(".workbench-home").click();
    await capture("12-zh-compact-960-evidence");
    await browser.$('[aria-controls="workbench-roster"]').click();
    await browser.$("#workbench-roster").waitForDisplayed();
    await capture("13-zh-compact-960-roster");
    expect(await browser.$("#workbench-evidence").isDisplayed()).toBe(false);
    await browser.$("#dataset-roster-search").setValue("采集_199");
    await browser.$(row("wide-199")).waitForDisplayed();
    await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await startDrag(`${row("wide-199")} .row-drag-handle`);
    await dragOver('[data-group-id="group-1"]');
    await capture("14-reduced-motion-hidden-199-payload");
    await browser.keys("Escape"); await browser.releaseActions();
    await browser.$('.grouped-roster[data-drag-active="true"]').waitForExist({ reverse: true });
    expect(await browser.$('[data-group-id="group-1"] .group-count').getText()).toBe("0");
    expect(await ipcCalls()).toEqual(before);
    expect(await consoleEntries()).toEqual([]);
  });
  it("recovers a refused roster, preserves pending reads, and cancels outside, keyboard, pointer and stale drops", async () => {
    await cdp("Emulation.setEmulatedMedia", { features: [] });
    await metrics(1366, 768, 1.5);
    const table: Record<string, unknown> = ipcTable();
    table.subscribe_workspace_drop_updates = { reservationId: "browser-m72-reservation" };
    table.get_workspace_roster = { capacity: 1024, datasets: [] };
    await installIpcBoundary(table); await browser.url("/"); await metrics(1366, 768, 1.5);
    await browser.$("strong=No acquisitions yet").waitForDisplayed(); await capture("15-empty-roster");
    await locale("zh-CN");
    expect(await viewerAnnouncement()).toBe("工作区为空。");
    await capture("15a-zh-empty-announcement");
    table.get_workspace_roster = { __reject: { kind: "test_roster_refusal", summary: "Controlled roster refusal 原文", detail: null, retryable: true } };
    await installIpcBoundary(table); await browser.url("/"); await metrics(1366, 768, 1.5);
    await browser.$("strong=The workspace list could not be read").waitForDisplayed(); await capture("16-roster-refused");
    await locale("zh-CN");
    expect(await viewerAnnouncement()).toBe("无法读取工作区列表. Controlled roster refusal 原文");
    await capture("16a-zh-refused-announcement");
    await locale("en");
    const extra = [0, 1, 2].map(index => ({ ...selectedFile, handle: `async-${index}`, fileName: `异步样本_${index}.raw`, sourceKind: "thermo_raw" }));
    await holdInvoke("get_workspace_roster");
    await setInvokeResult("get_workspace_roster", { datasets: [selectedFile, ...extra], capacity: 1024 });
    await browser.$("#workbench-roster").$("button=Try reading it again").click();
    await browser.$("strong=Reading the workspace list…").waitForDisplayed(); await capture("17-roster-loading");
    await locale("zh-CN");
    expect(await viewerAnnouncement()).toBe("正在读取工作区名单。");
    await capture("17a-zh-loading-announcement");
    await releaseInvokeHold("get_workspace_roster");
    await browser.$(row(selectedFile.handle)).waitForDisplayed();
    expect(await viewerAnnouncement()).toBe("工作区中有 4 个文件，尚未打开预览。");
    await locale("en");
    await holdInvoke("open_mzml_preview");
    await browser.$(row(selectedFile.handle)).click();
    await browser.waitUntil(async () => (await heldCallers("open_mzml_preview")) === 1);
    await capture("18-evidence-reading");
    expect(await browser.$(".workbench-navigation .work-status-dot").isExisting()).toBe(false);
    const readingCalls = await ipcCalls();
    await browser.$(".workbench-navigation button:nth-child(2)").click();
    await newGroup("Async group");
    await browser.$("[data-settings-entry]").click();
    await browser.$('[data-settings-dialog] input[value="zh-CN"]').click();
    await browser.$('[data-settings-dialog]').$("button=应用").click();
    await browser.$('[data-settings-dialog]').waitForExist({ reverse: true });
    await browser.$(".workbench-home").click();
    expect(await ipcCalls()).toEqual(readingCalls);
    await releaseInvokeHold("open_mzml_preview");
    await browser.$(".chromatogram-panel").waitForDisplayed();
    await capture("19-zh-home-read-complete");
    // Action controls and composition events cannot pick up or activate a row.
    const before = await ipcCalls();
    await browser.$(`${row(selectedFile.handle)} input`).click();
    await browser.execute(() => {
      const field = document.querySelector<HTMLInputElement>("#dataset-roster-search")!;
      field.focus();
      field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "研" }));
      field.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, code: "Space", key: " ", isComposing: true }));
      field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "研究" }));
    });
    expect(await browser.$('.grouped-roster[data-drag-active="true"]').isExisting()).toBe(false);
    expect(await ipcCalls()).toEqual(before);
    await startDrag(`${row("async-0")} .row-drag-handle`);
    await dragOver('[data-group-id="group-1"]');
    await browser.performActions([{ type: "pointer", id: "organization-pointer", parameters: { pointerType: "mouse" }, actions: [{ type: "pointerMove", x: 1100, y: 160, origin: "viewport", duration: 250 }] }]);
    await dropDrag();
    expect(await browser.$(row("async-0")).getAttribute("data-group")).toBe("ungrouped");
    await browser.$(`${row("async-0")} .row-drag-handle`).click();
    await browser.keys("\uE00D");
    await browser.$('.grouped-roster[data-drag-active="true"]').waitForExist();
    const workbenchWindow = await browser.getWindowHandle();
    await browser.newWindow("about:blank", { type: "tab" });
    await browser.closeWindow();
    await browser.switchToWindow(workbenchWindow);
    await browser.$('.grouped-roster[data-drag-active="true"]').waitForExist({ reverse: true });
    expect(await browser.$(row("async-0")).getAttribute("data-group")).toBe("ungrouped");
    await browser.$(`${row("async-0")} .row-drag-handle`).click();
    await browser.keys("\uE00D"); await browser.keys("ArrowDown"); await browser.keys("Escape");
    await browser.$('.grouped-roster[data-drag-active="true"]').waitForExist({ reverse: true });
    expect(await browser.$(row("async-0")).getAttribute("data-group")).toBe("ungrouped");
    const touch = await center(`${row("async-0")} .row-drag-handle`);
    await cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...touch, id: 1 }] });
    await cdp("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: touch.x, y: touch.y + 20, id: 1 }] });
    await browser.$('.grouped-roster[data-drag-active="true"]').waitForExist();
    await cdp("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    await browser.$('.grouped-roster[data-drag-active="true"]').waitForExist({ reverse: true });
    expect(await browser.$(row("async-0")).getAttribute("data-group")).toBe("ungrouped");
    evidence.push({ kind: "browser cancellation inputs", outside: "W3C mouse", keyboard: "W3C Escape", focusLoss: "actual browser tab switch during keyboard drag", pointer: "CDP touchCancel; automated, not physical touchscreen", composition: "DOM composition and isComposing boundary; not an OS IME test" });
    expect(await ipcCalls()).toEqual(before);
    // An already owed Rust removal answer arrives during a new organization drag.
    await browser.$(row("async-1")).click();
    await holdInvoke("remove_workspace_datasets");
    await setInvokeResult("remove_workspace_datasets", { roster: { datasets: [selectedFile, extra[0], extra[2]], capacity: 1024 }, removedHandles: ["async-1"], unknownHandles: [] });
    await browser.$(".dataset-roster-actions button:nth-last-child(2)").click();
    await browser.waitUntil(async () => (await heldCallers("remove_workspace_datasets")) === 1);
    const removalCalls = await ipcCalls();
    await startDrag(`${row("async-1")} .row-drag-handle`);
    await dragOver('[data-group-id="group-1"]');
    await releaseInvokeHold("remove_workspace_datasets");
    await browser.$('.grouped-roster[data-drag-active="true"]').waitForExist({ reverse: true });
    await browser.releaseActions();
    expect(await browser.$(row("async-1")).isExisting()).toBe(false);
    expect(await browser.$('[data-group-id="group-1"] .group-count').getText()).toBe("0");
    expect(await browser.$(".organization-notice").getText()).toContain("取消");
    expect(await ipcCalls()).toEqual(removalCalls);
    await capture("20-zh-stale-cancel-after-authoritative-removal");
    expect(await consoleEntries()).toEqual([]);
  });
});
