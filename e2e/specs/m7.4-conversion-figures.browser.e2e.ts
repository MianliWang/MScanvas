/** Production React with synthetic IPC only; no filesystem, process, or clipboard qualification. */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { UI_RESOURCES } from "../../apps/desktop/src/features/preferences/i18n";
import { availableBackend, finalizedAttemptFacts, outputSetReport, queueItem, queueOf, sciexQueueItem, selectedFile, shippedIntent } from "../../apps/desktop/src/test/previewFixtures";
import type { FigurePreviewRequest, WorkspaceConversionUpdate } from "../../apps/desktop/src/features/mzml-preview/contracts";
import { ipcTable } from "../support/fixtures";
import { consoleEntries, heldCallers, holdInvoke, installIpcBoundary, IPC_TABLE_KEY, ipcCalls, releaseInvokeHold, setInvokeResult } from "../support/harness";

const authority = availableBackend.authority;
const names = ["Synthetic sample 空格 very-long-member-0001.mzML", "Synthetic sample 空格 very-long-member-0002.mzML"];
const completed = sciexQueueItem("synthetic-wiff", "Synthetic acquisition 空格.wiff", {
  ...finalizedAttemptFacts(), state: "finalized", attempts: 1,
  result: { kind: "outputSet", report: outputSetReport("synthetic-wiff", names) },
  finalizedOutputs: names.map((fileName, index) => ({ outputId: "m74-output-" + index, fileName })),
});
const failed = queueItem("synthetic-raw", "Synthetic locked output.raw", {
  state: "failed", attempts: 1, retryable: true,
  process: { kind: "settled", termination: "exited", exitCode: 1 },
  staged: { kind: "observed", phase: "provider_returned", entryCount: 1, directoryCount: 0, nonEmptyFileObserved: true, bounded: false },
  error: { kind: "synthetic-provider-failure", summary: "SYNTHETIC_PROVIDER_FAILURE", detail: null, retryable: true },
  result: { kind: "single", report: { datasetHandle: "synthetic-raw", sourceKind: "thermo_raw", outcome: "backend_rejected", detailedOutcome: null,
    outputFileName: null, output: null, validationMode: "output_only", validation: null,
    backend: { exitCode: 1, elapsedMilliseconds: 10 }, stagingResidue: "Synthetic owned staging remained locked.", receipt: 1 } },
  stagingRecovery: { recoveryId: "m74-owned-staging", attempt: 1, status: "recoverable" },
});
function queueUpdate(running = false, cleaned = false): WorkspaceConversionUpdate {
  const items = running ? [queueItem("synthetic-raw", "Synthetic active acquisition.raw", { state: "running", attempts: 1 })] : [completed, { ...failed, stagingRecovery: { ...failed.stagingRecovery!, status: cleaned ? "cleaned" as const : "recoverable" as const } }];
  return { sequence: cleaned ? 3 : 2, authority, backendQuarantined: false,
    diagnostics: { eligibleItemCount: 1, available: !running, exporting: false, lastExport: null },
    state: running ? { status: "running", operationId: "m74-queue", queue: queueOf(items) } : { status: "terminal", reason: "completed", operationId: "m74-queue", queue: queueOf(items) } };
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
async function open(width = 1366, height = 768, dpr = 1, running = false, empty = false) {
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: width === 960 ? "reduce" : "no-preference" }] });
  await installIpcBoundary({ ...ipcTable({ emptySpectrum: empty }),
    get_workspace_roster: { capacity: 1024, datasets: [selectedFile, { handle: "synthetic-raw", fileName: "Synthetic acquisition 原始名称.raw", sourceKind: "thermo_raw", byteLength: 1200, relativeContext: null }] },
    get_workspace_conversion_state: queueUpdate(running),
    subscribe_workspace_drop_updates: { reservationId: "m74-browser-drop" },
    open_finalized_output: { status: "refused", reason: "noAssociation" },
    reclaim_conversion_staging: { status: "refused", reason: "stillBlocked" },
    plan_workspace_clear: { Ok: { planId: "m74-clear", totalCount: 2, removableCount: 1, protectedCount: 1, active: true } },
    execute_workspace_clear: { status: "refused", reason: "stalePlan" },
    describe_workspace_conversion_queue: { outcome: "planned", plan: { items: [{ datasetHandle: "synthetic-raw", fileName: "Synthetic acquisition 原始名称.raw", sourceKind: "thermo_raw", output: { kind: "knownSingle", fileName: "Synthetic acquisition 原始名称.mzML" } }], outputFormat: "mzML", compression: "zlib", validationMode: "output_only", capacity: 16, intent: shippedIntent, conflictPolicy: "fail", destinationPolicy: { kind: "customFolder" }, receipt: 1 } },
    preview_figure: null,
  });
  await cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
  await browser.url("/");
  await browser.$(".workbench-shell").waitForExist();
  // The artifact is explicitly a synthetic IPC image, not a second scientific renderer.
  await browser.execute((key, isEmpty) => {
    const table = Reflect.get(window, key) as Record<string, unknown>;
    const internals = Reflect.get(window, "__TAURI_INTERNALS__") as { invoke: (command: string, args: Record<string, unknown>) => Promise<unknown> };
    const invoke = internals.invoke;
    internals.invoke = (command, args) => {
      if (command === "preview_figure") {
        const request = args.request as FigurePreviewRequest;
        const { widthPx: width, heightPx: height } = request.settings;
        table[command] = { status: "rendered", requestId: request.requestId, specId: JSON.stringify(request), empty: isEmpty, width, height,
          svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1200 640"><rect width="1200" height="640" fill="white"/><text x="70" y="55" fill="#1b2532" font-size="24">MOCK IPC FIGURE — layout evidence only</text><path d="M80 90V550H1150" fill="none" stroke="#485666" stroke-width="2"/>${isEmpty ? "" : '<path d="M150 550V430M330 550V250M600 550V125M850 550V375M1050 550V480" stroke="#267fbb" stroke-width="3"/>'}</svg>` };
      }
      return invoke(command, args);
    };
  }, IPC_TABLE_KEY, empty);
  expect(await browser.execute(() => [innerWidth, innerHeight, devicePixelRatio])).toEqual([width, height, dpr]);
}
async function preferences(language: "en" | "zh-CN", density: "comfortable" | "compact") {
  await browser.$("[data-settings-entry]").click();
  await browser.$('[data-settings-dialog] input[value="' + language + '"]').click();
  await browser.$('[data-settings-dialog] input[value="' + density + '"]').click();
  await browser.$("[data-settings-dialog]").$("button=" + UI_RESOURCES[language].apply).click();
  await browser.$("[data-settings-dialog]").waitForExist({ reverse: true });
}
async function conversion() {
  await browser.$('.workbench-navigation button:nth-child(2)').click();
  await browser.$(".conversion-running").waitForDisplayed();
}
async function viewer(selectSpectrum = true) {
  await browser.$(".workbench-home").click();
  const row = browser.$('.grouped-roster [data-handle="' + selectedFile.handle + '"]');
  if (!await row.isDisplayed()) await browser.$('[aria-controls="workbench-roster"]').click();
  await row.click();
  if (await browser.$('[aria-controls="workbench-roster"]').getAttribute("aria-expanded") === "true") await browser.$(".workbench-home").click();
  await browser.$('.spectrum-table-panel [data-source-index="0"]').waitForDisplayed();
  if (!selectSpectrum) return;
  await browser.$('.spectrum-table-panel [data-source-index="0"]').click();
  await browser.$(".spectrum-panel .figure-quick-actions").waitForDisplayed();
}
async function click(selector: string) { await browser.$(selector).scrollIntoView({ block: "center" }); await browser.$(selector).click(); }
async function capture(label: string) {
  const geometry = await browser.execute(() => {
    const rect = (node: Element) => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    const visible = (node: Element) => node.getClientRects().length > 0;
    return { css: [innerWidth, innerHeight], dpr: devicePixelRatio, language: document.documentElement.lang,
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
      active: document.activeElement?.outerHTML,
      dialogs: [...document.querySelectorAll('[role="dialog"]')].map(rect),
      controls: [...document.querySelectorAll('.conversion-panel button, .figure-export-dialog button, .figure-quick-actions button')].filter(visible).map(node => ({ text: node.textContent, ...rect(node) })),
      duplicateIds: [...document.querySelectorAll('[id]')].map(node => node.id).filter((id, index, all) => all.indexOf(id) !== index),
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      external: performance.getEntriesByType("resource").map(entry => entry.name).filter(url => /^https?:/u.test(url) && new URL(url).origin !== location.origin),
    };
  });
  const screenshot = await cdp("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  if (typeof screenshot.data !== "string") throw Error("Screenshot bytes missing");
  writeFileSync(join(output, label + ".png"), Buffer.from(screenshot.data, "base64"));
  evidence.push({ label, attribution: "synthetic IPC; headless Chrome; emulated DPR and input", ...geometry });
  expect(geometry.horizontalOverflow).toBeLessThanOrEqual(1);
  expect(geometry.duplicateIds).toEqual([]);
  expect(geometry.external).toEqual([]);
  for (const dialog of geometry.dialogs) {
    expect(dialog.x).toBeGreaterThanOrEqual(-1); expect(dialog.y).toBeGreaterThanOrEqual(-1);
    expect(dialog.x + dialog.width).toBeLessThanOrEqual(geometry.css[0] + 1);
    expect(dialog.y + dialog.height).toBeLessThanOrEqual(geometry.css[1] + 1);
  }
  return geometry;
}

describe("M7.4 conversion, recovery and export composition", () => {
  before(() => {
    const root = process.env.MSCANVAS_M74_OUTPUT_ROOT ?? resolve("test-results/m7.4");
    mkdirSync(root, { recursive: true }); output = mkdtempSync(join(root, "browser-"));
    console.log("M7.4 browser evidence: " + output);
  });
  afterEach(async function () {
    evidence.push({ test: this.currentTest?.title, state: this.currentTest?.state, calls: await ipcCalls(), console: await consoleEntries() });
    if (this.currentTest?.state === "failed") await capture("failure-" + evidence.length);
    writeFileSync(join(output, "evidence.json"), JSON.stringify(evidence, null, 2));
    const reducedMotion = await browser.execute(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
    const motionDevelopmentNotice = "You have Reduced Motion enabled on your device. Animations may not appear as expected.. For more information and steps for solving, visit https://motion.dev/troubleshooting/reduced-motion-disabled";
    expect((await consoleEntries()).filter(entry => !(reducedMotion && entry.level === "warn" && entry.text === motionDevelopmentNotice))).toEqual([]);
  });

  for (const locale of ["en", "zh-CN"] as const) it("keeps linked preview behind viewer prerequisites and restores it in " + locale, async () => {
    const words = UI_RESOURCES[locale];
    await open(locale === "en" ? 1366 : 960, locale === "en" ? 768 : 640);
    await preferences(locale, "comfortable");
    await expect(browser.$("button=" + words.figurePreviewLinked)).not.toExist();
    await viewer(false);
    await click("#chromatogram-export-toggle");
    const entry = browser.$("button=" + words.figurePreviewLinked);
    const previewCalls = async () => (await ipcCalls()).filter(call => call.command === "preview_figure");
    const blocked = async (reason: string, phase: string) => {
      await expect(entry).toBeDisabled();
      await expect(entry).toHaveAttribute("aria-describedby", "chromatogram-linked-unavailable");
      await expect(browser.$("#chromatogram-linked-unavailable")).toHaveText(reason);
      await entry.scrollIntoView({ block: "center" }); await entry.click();
      await expect(browser.$(".figure-export-dialog")).not.toExist();
      await capture("linked-entry-" + phase + "-" + locale);
    };
    await blocked(words.linkedNoSpectrum, "no-spectrum");
    expect(await previewCalls()).toHaveLength(0);
    await holdInvoke("load_selected_spectrum");
    await click('.spectrum-table-panel [data-source-index="0"]');
    await browser.waitUntil(async () => await heldCallers("load_selected_spectrum") === 1);
    await blocked(words.linkedLoading, "loading");
    expect(await previewCalls()).toHaveLength(0);
    await releaseInvokeHold("load_selected_spectrum");
    await expect(entry).toBeEnabled();
    await click("button=" + words.figurePreviewLinked);
    await browser.$(".figure-preview img").waitForDisplayed();
    expect((await previewCalls()).at(-1)?.args?.request).toMatchObject({ source: { kind: "linked", traces: { tic: true, bpc: false } } });
    await capture("linked-entry-selected-" + locale);
    await browser.$("button=" + words.figureExportReturn).click();
    await expect(entry).toBeFocused();
    const prior = (await previewCalls()).length;
    await click("label=TIC");
    await blocked(words.linkedNoTrace, "no-trace");
    expect(await previewCalls()).toHaveLength(prior);
    await click("label=BPC");
    await expect(entry).toBeEnabled();
    await click("button=" + words.figurePreviewLinked);
    await browser.$(".figure-preview img").waitForDisplayed();
    expect((await previewCalls()).at(-1)?.args?.request).toMatchObject({ source: { kind: "linked", traces: { tic: false, bpc: true } } });
    await browser.$("button=" + words.figureExportReturn).click();
    await expect(entry).toBeFocused();
    await browser.keys("Enter");
    await browser.$(".figure-preview img").waitForDisplayed();
    await browser.keys("Escape");
    await expect(entry).toBeFocused();
  });

  for (const scenario of [
    { width: 1920, height: 1080, dpr: 1, language: "en", density: "comfortable" },
    { width: 1366, height: 768, dpr: 1.5, language: "zh-CN", density: "compact" },
    { width: 1200, height: 800, dpr: 1.25, language: "en", density: "compact" },
    { width: 960, height: 640, dpr: 2, language: "zh-CN", density: "comfortable" },
  ] as const) it("retains conversion intent and readable figure controls at " + scenario.width + "x" + scenario.height, async () => {
    const words = UI_RESOURCES[scenario.language];
    await open(scenario.width, scenario.height, scenario.dpr);
    await preferences(scenario.language, scenario.density);
    await conversion();
    await browser.$('.conversion-settings[data-settings-state="ready"]').waitForExist();
    await capture("conversion-basic-" + scenario.width);
    const requestCount = (await ipcCalls()).filter(call => call.command === "describe_workspace_conversion_queue").length;
    await browser.$(".conversion-settings").$("button=" + words.cnvAdvanced).click();
    await expect(browser.$(".conversion-settings")).toHaveAttribute("data-settings-view", "advanced");
    await browser.$(".conversion-settings").$("button=" + words.cnvBasic).click();
    expect((await ipcCalls()).filter(call => call.command === "describe_workspace_conversion_queue")).toHaveLength(requestCount);
    await click(".conversion-bound-details summary");
    await capture("conversion-results-" + scenario.width);
    await viewer();
    const entry = browser.$(".spectrum-panel .figure-quick-actions").$("button=" + words.figureExportTitle);
    await entry.scrollIntoView({ block: "center" }); await entry.click();
    await browser.$(".figure-preview img").waitForDisplayed();
    // Clicking the actual visible label must target its own raw numeric field.
    const widthLabel = browser.$('.figure-export-dialog label[for$="-widthPx"]');
    await widthLabel.click();
    await expect(browser.$('.figure-export-dialog input[id$="-widthPx"]')).toBeFocused();
    await browser.$('.figure-export-dialog input[id$="-widthPx"]').setValue(" 1400 ");
    await browser.waitUntil(async () => (await ipcCalls()).some(call => call.command === "preview_figure" && (call.args?.request as FigurePreviewRequest)?.settings.widthPx === 1400));
    await browser.$(".figure-preview img").waitForDisplayed();
    expect(await browser.$('.figure-export-dialog input[id$="-widthPx"]').getValue()).toBe(" 1400 ");
    await browser.$('.figure-export-dialog input[id$="-widthPx"]').click();
    await browser.keys(["Control", "a"]); await browser.keys("Backspace");
    await expect(browser.$('.figure-export-dialog input[id$="-widthPx"]')).toHaveValue("");
    await expect(browser.$(".figure-export-dialog").$("label*=" + words.viewerExportFull)).toExist();
    await expect(browser.$(".figure-export-dialog").$("label*=" + words.viewerExportFullRun)).not.toExist();
    await expect(browser.$(".figure-export-dialog .spectrum-export-actions button:first-child")).toHaveAttribute("aria-disabled", "true");
    await browser.$('.figure-export-dialog input[id$="-widthPx"]').setValue(" 1400 ");
    await browser.$(".figure-preview img").waitForDisplayed();
    await capture("figure-preview-" + scenario.width);
    await browser.keys("Escape");
    await browser.$(".figure-export-dialog").waitForExist({ reverse: true });
    await expect(entry).toBeFocused();
  });

  it("keeps the diagnostics initiator focused and refuses duplicate export while saving", async () => {
    await open(); await conversion();
    const base = queueUpdate();
    const busy = { ...base, sequence: 3, diagnostics: { ...base.diagnostics, exporting: true } };
    const saved = { ...base, sequence: 4, diagnostics: { ...base.diagnostics, lastExport: {
      operationId: "m74-queue", retryRound: 0, fileName: "synthetic-diagnostics.json",
      byteLength: 2048, sha256: "A".repeat(64), diagnosticItemCount: 1,
    } } };
    await setInvokeResult("begin_workspace_conversion_diagnostics_export", { reservationId: "m74-diagnostics" });
    await setInvokeResult("get_workspace_conversion_state", busy);
    await setInvokeResult("save_workspace_conversion_diagnostics", saved);
    await holdInvoke("save_workspace_conversion_diagnostics");
    const action = browser.$(".conversion-diagnostics button");
    await action.scrollIntoView({ block: "center" }); await action.click();
    await browser.waitUntil(async () => await heldCallers("save_workspace_conversion_diagnostics") === 1);
    await expect(action).toHaveAttribute("aria-disabled", "true");
    await expect(action).toBeEnabled(); await expect(action).toBeFocused();
    await action.click(); await browser.keys("Enter");
    expect((await ipcCalls()).filter(call => call.command === "begin_workspace_conversion_diagnostics_export")).toHaveLength(1);
    expect(await heldCallers("save_workspace_conversion_diagnostics")).toBe(1);
    await capture("diagnostics-initiator-preserved");
    await setInvokeResult("get_workspace_conversion_state", saved);
    await releaseInvokeHold("save_workspace_conversion_diagnostics");
    await expect(action).not.toHaveAttribute("aria-disabled"); await expect(action).toBeFocused();
    await expect(browser.$(".conversion-diagnostics-summary")).toHaveText(expect.stringContaining("Saved synthetic-diagnostics.json"));
  });

  it("deduplicates opening, reports no association and permits explicit folder recovery", async () => {
    await open(); await conversion();
    const group = browser.$(".output-open-actions");
    const file = group.$("button=Open file");
    await file.scrollIntoView({ block: "center" });
    await holdInvoke("open_finalized_output");
    await file.click(); await file.click();
    expect(await heldCallers("open_finalized_output")).toBe(1);
    await expect(file).toHaveAttribute("aria-disabled", "true");
    await releaseInvokeHold("open_finalized_output");
    await expect(group).toHaveText(expect.stringContaining(UI_RESOURCES.en.outputNoAssociation));
    await setInvokeResult("open_finalized_output", { status: "accepted" });
    await group.$("button=Open folder").click();
    await expect(group).toHaveText(expect.stringContaining(UI_RESOURCES.en.outputOpenAccepted));
    const calls = await ipcCalls();
    const opens = calls.filter(call => call.command === "open_finalized_output");
    expect(opens.map(call => call.args)).toEqual([
      expect.objectContaining({ outputId: "m74-output-0", action: "file" }),
      expect.objectContaining({ outputId: "m74-output-0", action: "folder" }),
    ]);
    expect(calls.filter(call => /^(begin_workspace_conversion|adopt_workspace_conversion|reclaim_conversion)/u.test(call.command))).toHaveLength(0);
    await capture("open-refusal-folder-recovery");
  });

  it("keeps a blocked cleanup separate from its original result and requires fresh review", async () => {
    await open(); await conversion();
    const group = browser.$(".conversion-recovery");
    await group.scrollIntoView({ block: "center" });
    await group.$("button=" + UI_RESOURCES.en.stagingRecoveryButton).click();
    await expect(group).toHaveText(expect.stringContaining(UI_RESOURCES.en.stagingRecoveryBlocked));
    await capture("cleanup-still-blocked");
    await setInvokeResult("get_workspace_conversion_state", queueUpdate(false, true));
    await setInvokeResult("reclaim_conversion_staging", { status: "cleaned" });
    await group.$("button=" + UI_RESOURCES.en.stagingRecoveryButton).click();
    await expect(group).toHaveText(expect.stringContaining(UI_RESOURCES.en.stagingRecoveryCleaned));
    await expect(group.$("button=" + UI_RESOURCES.en.stagingReviewNewPlan)).toBeFocused();
    expect((await ipcCalls()).filter(call => call.command === "begin_workspace_conversion_queue")).toHaveLength(0);
    await group.$("button=" + UI_RESOURCES.en.stagingReviewNewPlan).click();
    await expect(browser.$(".conversion-plan")).toBeFocused();
    expect((await ipcCalls()).filter(call => call.command === "begin_workspace_conversion_queue")).toHaveLength(0);
    await capture("cleanup-fresh-review");
  });

  it("keeps Return and Escape inert and invalidates a stale active-clear confirmation", async () => {
    await open(1200, 800, 1.25, true);
    const clear = browser.$("#workbench-roster").$("button=" + UI_RESOURCES.en.clearList);
    if (!await clear.isDisplayed()) await browser.$('[aria-controls="workbench-roster"]').click();
    await clear.click();
    await expect(browser.$('[role="dialog"]')).toHaveText(expect.stringContaining("1 of 2 rows"));
    await browser.keys("Escape");
    await browser.$('[role="dialog"]').waitForExist({ reverse: true });
    await expect(clear).toBeFocused();
    expect((await ipcCalls()).filter(call => call.command === "execute_workspace_clear")).toHaveLength(0);
    await clear.click(); await browser.$('[role="dialog"]').$("button=Return").click();
    expect((await ipcCalls()).filter(call => call.command === "execute_workspace_clear")).toHaveLength(0);
    await clear.click(); await browser.$('[role="dialog"]').$("button=Remove non-running").click();
    await expect(browser.$('[role="dialog"]')).toHaveText(expect.stringContaining(UI_RESOURCES.en.clearStale));
    await expect(browser.$('[role="dialog"]').$("button=Cancel and clear")).toBeDisabled();
    await capture("active-clear-stale");
    await browser.$('[role="dialog"]').$("button=" + UI_RESOURCES.en.clearReevaluate).click();
    await expect(browser.$('[role="dialog"]').$("button=Cancel and clear")).toBeEnabled();
    expect((await ipcCalls()).filter(call => call.command === "execute_workspace_clear")).toHaveLength(1);
    await browser.keys("Escape");
  });

  for (const action of ["Remove non-running", "Cancel and clear"]) {
    it(`active Clear focus retains ${action} while pending and recovers a refusal`, async () => {
      await open(1366, 768, 1, true);
      const clear = browser.$("#workbench-roster").$("button=" + UI_RESOURCES.en.clearList);
      await clear.click();
      const dialog = browser.$('[role="dialog"]');
      const initiator = dialog.$("button=" + action);
      await expect(initiator).toBeEnabled();
      await holdInvoke("execute_workspace_clear");
      await initiator.click();
      await browser.waitUntil(async () => await heldCallers("execute_workspace_clear") === 1);
      await expect(initiator).toBeEnabled();
      await expect(initiator).toHaveAttribute("aria-disabled", "true");
      await expect(initiator).toBeFocused();
      await browser.keys(["Enter", "Enter", "Escape"]);
      await initiator.click();
      expect(await heldCallers("execute_workspace_clear")).toBe(1);
      await expect(dialog.$("button=Return")).toBeDisabled();
      await expect(dialog.$("button=" + (action === "Cancel and clear" ? "Remove non-running" : "Cancel and clear"))).toBeDisabled();
      await capture("active-clear-pending-" + action.replaceAll(" ", "-"));
      await releaseInvokeHold("execute_workspace_clear");
      await expect(dialog.$("button=" + UI_RESOURCES.en.clearReevaluate)).toBeFocused();
      await expect(dialog).toHaveText(expect.stringContaining(UI_RESOURCES.en.clearStale));
      expect((await ipcCalls()).filter(call => call.command === "execute_workspace_clear")).toHaveLength(1);
      await capture("active-clear-refusal-" + action.replaceAll(" ", "-"));
      await browser.keys("Escape");
      await expect(clear).toBeFocused();
    });
  }

  for (const timing of ["before", "after"]) {
    it(`active Clear focus returns to Add files when conversion settles ${timing} close`, async () => {
      await open(960, 640, 1.25, true);
      const clear = browser.$("#workbench-roster").$("button=" + UI_RESOURCES.en.clearList);
      if (!await clear.isDisplayed()) await browser.$('[aria-controls="workbench-roster"]').click();
      await clear.click();
      const cancel = browser.$('[role="dialog"]').$("button=Cancel and clear");
      await expect(cancel).toBeEnabled();
      await holdInvoke("execute_workspace_clear");
      await setInvokeResult("execute_workspace_clear", { status: "removed", result: { roster: { capacity: 1024, datasets: [] }, removedHandles: [selectedFile.handle, "synthetic-raw"], unknownHandles: [] } });
      await setInvokeResult("get_workspace_roster", { capacity: 1024, datasets: [] });
      await cancel.click();
      await browser.waitUntil(async () => await heldCallers("execute_workspace_clear") === 1);
      const settle = async () => {
        const reads = (await ipcCalls()).filter(call => call.command === "get_workspace_conversion_state").length;
        await setInvokeResult("get_workspace_conversion_state", { ...queueUpdate(true), sequence: 3,
          state: { status: "terminal", reason: "stopped", operationId: "m74-queue", queue: queueOf([queueItem("synthetic-raw", "Synthetic active acquisition.raw", { state: "cancelled", attempts: 1 })]) } });
        await browser.waitUntil(async () => (await ipcCalls()).filter(call => call.command === "get_workspace_conversion_state").length > reads);
      };
      if (timing === "before") await settle();
      await releaseInvokeHold("execute_workspace_clear");
      await browser.$('[role="dialog"]').waitForExist({ reverse: true });
      const add = browser.$("#workbench-roster").$("button=" + UI_RESOURCES.en.addFiles);
      if (timing === "after") { await expect(add).toBeDisabled(); await settle(); }
      await expect(add).toBeEnabled(); await expect(add).toBeFocused();
      await expect(clear).not.toExist();
      expect((await ipcCalls()).filter(call => call.command === "execute_workspace_clear")).toHaveLength(1);
      expect((await ipcCalls()).filter(call => call.command === "begin_workspace_conversion_queue")).toHaveLength(0);
      await capture("active-clear-empty-" + timing);
    });
  }

  it("uses the latest preview, keeps DPI PNG-only and makes save cancel distinct from copy", async () => {
    await open(); await viewer();
    await holdInvoke("preview_figure");
    await browser.$(".spectrum-panel .figure-quick-actions").$("button=Export figure").click();
    await browser.waitUntil(async () => await heldCallers("preview_figure") === 1);
    await browser.$('.figure-export-dialog input[id$="-widthPx"]').setValue("1400");
    const dialog = browser.$(".figure-export-dialog");
    await dialog.$("button=Export SVG…").click();
    expect((await ipcCalls()).filter(call => call.command === "begin_selected_spectrum_export")).toHaveLength(0);
    await releaseInvokeHold("preview_figure");
    await browser.waitUntil(async () => (await browser.$(".figure-preview img").getAttribute("data-spec-id"))?.includes('"widthPx":1400') === true);
    await browser.$('.figure-export-dialog input[id$="-pngDpi"]').setValue("bad dpi");
    await expect(dialog.$("button=Export PNG…")).toHaveAttribute("aria-disabled", "true");
    await expect(dialog.$("button=Export SVG…")).toHaveAttribute("aria-disabled", "false");
    await setInvokeResult("save_selected_spectrum_export", { status: "cancelled" });
    await holdInvoke("save_selected_spectrum_export");
    await dialog.$("button=Export SVG…").click();
    await browser.waitUntil(async () => await heldCallers("save_selected_spectrum_export") === 1);
    await dialog.$("button=Export SVG…").click();
    expect(await heldCallers("save_selected_spectrum_export")).toBe(1);
    await releaseInvokeHold("save_selected_spectrum_export");
    await expect(dialog.$("button=Copy plot")).toHaveAttribute("aria-disabled", "false");
    await dialog.$("button=Copy plot").click();
    await browser.waitUntil(async () => (await ipcCalls()).some(call => call.command === "copy_selected_spectrum_plot"));
    const calls = await ipcCalls();
    const begin = calls.filter(call => call.command === "begin_selected_spectrum_export");
    expect(begin).toHaveLength(1);
    expect(begin[0].args).toEqual(expect.objectContaining({ format: "svg", settings: expect.objectContaining({ widthPx: 1400 }) }));
    await capture("figure-cancel-then-copy-invalid-dpi");
  });

  it("shows an honest empty figure and leaves zero-row data export reachable", async () => {
    await open(960, 640, 2, false, true); await viewer();
    await browser.$(".spectrum-panel .figure-quick-actions").$("button=Export figure").click();
    await browser.$(".figure-preview img").waitForDisplayed();
    await expect(browser.$(".figure-preview")).toHaveText(expect.stringContaining(UI_RESOURCES.en.figurePreviewEmpty));
    await capture("empty-spectrum-preview");
    await browser.keys("Escape");
    await click(".spectrum-export-disclosure summary");
    await expect(browser.$(".spectrum-panel .spectrum-data-actions").$("button=Export CSV…")).toBeEnabled();
  });
});
