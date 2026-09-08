/** M6.7 browser evidence: production React, mocked Tauri boundary only. */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { ALLOWED_CONSOLE_SUBSTRINGS, consoleEntries, holdInvoke, horizontalOverflow, installIpcBoundary, ipcCalls, releaseInvokeHold, setInvokeResult } from "../support/harness";
import { ipcTable } from "../support/fixtures";
import { availableBackend, completeCatalog, settledAt, shippedIntent } from "../../apps/desktop/src/test/previewFixtures";
import type { ConversionConflictPolicy, DestinationPolicy, SelectedFile, WorkspaceConversionUpdate } from "../../apps/desktop/src/features/mzml-preview/contracts";

const DESCRIBE = "describe_workspace_conversion_queue";
const BEGIN = "begin_workspace_conversion_queue";
const CONVERT = ".conversion-plan button.primary-button";
const ALL = 'input[name="conversion-scope"][value="all"]';
const SELECTED = 'input[name="conversion-scope"][value="selected"]';
const SEARCH = 'input[type="search"]';
const authority = settledAt(1, 1);
const idle: WorkspaceConversionUpdate = { sequence: 0, state: { status: "idle" }, authority, backendQuarantined: false,
  diagnostics: { eligibleItemCount: 0, available: false, exporting: false, lastExport: null } };
const row = (index: number): SelectedFile => ({ handle: `raw-${index}`, fileName: `sample-${index}.raw`, byteLength: index * 10, sourceKind: "thermo_raw", relativeContext: null });
const open: SelectedFile = { ...row(0), handle: "open", fileName: "open.mzML", sourceKind: "mzml" };
const policy: DestinationPolicy = { kind: "customFolder" };

function planned(indices: readonly number[], destinationPolicy = policy, conflictPolicy: ConversionConflictPolicy = "fail", capacity = 16) {
  return { outcome: "planned", plan: {
    items: indices.map((index) => ({ datasetHandle: row(index).handle, fileName: row(index).fileName, sourceKind: "thermo_raw",
      output: { kind: "knownSingle", fileName: `sample-${index}.mzML` } })),
    outputFormat: "mzML", compression: "zlib", validationMode: "output_only", capacity,
    intent: shippedIntent, conflictPolicy, destinationPolicy, receipt: 1,
  } };
}
async function viewport(width: number, height: number) {
  await browser.setWindowSize(width, height);
  const frame = await browser.execute(() => ({ width: outerWidth - innerWidth, height: outerHeight - innerHeight }));
  await browser.setWindowSize(width + frame.width, height + frame.height);
  expect(await browser.execute(() => ({ width: innerWidth, height: innerHeight }))).toEqual({ width, height });
  console.log("M6.7 measured inner viewport", { width, height });
}
async function reveal(selector: string) {
  await browser.execute((target: string) => {
    const x = scrollX, y = scrollY;
    document.querySelector(target)!.scrollIntoView({ block: "center", inline: "nearest" });
    window.scrollTo(x, y);
  }, selector);
}
async function click(selector: string) { await reveal(selector); await browser.$(selector).click(); }
async function capture(name: string, selector: string) {
  await reveal(selector);
  const directory = process.env.MSCANVAS_QA_ARTIFACTS ?? resolve("test-results", "m6.7-browser");
  await mkdir(directory, { recursive: true });
  await browser.saveScreenshot(resolve(directory, `${name}.png`));
}
async function requests(command: string) { return (await ipcCalls()).filter((call) => call.command === command).map((call) => call.args); }
async function start(count = 3) {
  await viewport(1366, 768);
  await installIpcBoundary({ ...ipcTable(), inspect_backend: { ...availableBackend, authority },
    get_workspace_roster: { datasets: [...Array.from({ length: count }, (_, i) => row(i + 1)), open], capacity: 1024 },
    read_conversion_configuration: { authority, configuration: { configuration: "ready", catalog: completeCatalog, shipped: shippedIntent.id }, outcome: { outcome: "answered" } },
    [DESCRIBE]: planned([2]), get_workspace_conversion_state: idle,
  });
  await browser.url("/");
  await browser.$('[data-handle="open"]').waitForDisplayed();
}
async function ready() { await browser.$(CONVERT).waitForEnabled({ timeout: 30_000 }); }
async function names() { return browser.execute(() => [...document.querySelectorAll('[aria-label="Reviewed conversion order"] .conversion-queue-name')].map((node) => node.textContent)); }

describe("M6.7 explicit selected/all review", () => {
  afterEach(async function () {
    if (this.currentTest?.state === "failed") await capture(`failure-${this.currentTest.title.slice(0, 25).replace(/[^a-z0-9]/gi, "-")}`, ".conversion-plan");
    expect((await consoleEntries()).filter((entry) => !ALLOWED_CONSOLE_SUBSTRINGS.some((allowed) => entry.text.includes(allowed)))).toEqual([]);
  });

  it("reviews a selected subset and excludes unsupported rows while all includes filtered-out rows", async () => {
    await start();
    expect(await browser.$(CONVERT).isEnabled()).toBe(false);
    expect(await requests(DESCRIBE)).toEqual([]);
    await click('[data-handle="raw-2"]'); await ready();
    await browser.action("key").down("\uE009").perform(true);
    await click('[data-handle="open"]');
    await browser.action("key").up("\uE009").perform();
    expect(await browser.$("#conversion-scope-summary").getText()).toContain("2 requested · 1 eligible · 1 excluded");
    const previous = await requests(DESCRIBE);
    await browser.$(SEARCH).setValue("sample-2");
    expect(await requests(DESCRIBE)).toEqual(previous);
    expect(await names()).toEqual(["sample-2.raw"]);
    await capture("selected-subset", "#conversion-scope-summary");
    await setInvokeResult(DESCRIBE, planned([1, 2, 3]));
    await click(ALL); await ready();
    expect(await names()).toEqual(["sample-1.raw", "sample-2.raw", "sample-3.raw"]);
    expect(await browser.$('[data-handle="raw-1"]').isExisting()).toBe(false);
    expect(await browser.$("#conversion-scope-summary").getText()).toContain("4 requested · 3 eligible · 1 excluded");
    expect((await requests(DESCRIBE)).at(-1)?.request).toMatchObject({ handles: ["raw-1", "raw-2", "raw-3"] });
    await capture("all-with-search", '[aria-label="Reviewed conversion order"]');
  });

  it("refuses over capacity before BEGIN or picker and recovers through keyboard scope selection", async () => {
    await start(17);
    await setInvokeResult(DESCRIBE, { outcome: "capacityExceeded", capacity: 16, requestedCount: 17 });
    await click(ALL);
    const refusal = browser.$('[data-testid="conversion-capacity"]');
    await refusal.waitForExist();
    expect(await refusal.getText()).toContain("17 eligible acquisitions exceed the queue capacity of 16");
    expect(await browser.$(CONVERT).isEnabled()).toBe(false);
    expect(await requests(BEGIN)).toEqual([]);
    expect(await requests("choose_workspace_conversion_destination")).toEqual([]);
    await capture("capacity-refusal", '[data-testid="conversion-capacity"]');
    await click('[data-handle="raw-2"]');
    await setInvokeResult(DESCRIBE, planned([2]));
    await click(ALL); await browser.keys("ArrowUp");
    await ready();
    expect(await browser.$(SELECTED).isSelected()).toBe(true);
    expect(await browser.$(SELECTED).isFocused()).toBe(true);
    await capture("keyboard-recovery", SELECTED);
  });

  it("withdraws order/scope review and preserves destination/conflict settings", async () => {
    await start();
    await setInvokeResult(DESCRIBE, planned([1, 2, 3])); await click(ALL); await ready();
    await setInvokeResult(DESCRIBE, planned([1, 2, 3], { kind: "namedSubfolder", name: "Converted" }));
    await click('input[name="conversion-destination-policy"][value="namedSubfolder"]'); await ready();
    await setInvokeResult(DESCRIBE, planned([1, 2, 3], { kind: "namedSubfolder", name: "Converted" }, "skip"));
    await click('input[name="conversion-conflict-policy"][value="skip"]'); await ready();
    const before = (await requests(DESCRIBE)).length;
    await holdInvoke(DESCRIBE);
    await browser.$("select#dataset-roster-sort").selectByAttribute("value", "name-desc");
    await browser.waitUntil(async () => (await requests(DESCRIBE)).length > before);
    expect(await browser.$(CONVERT).isEnabled()).toBe(false);
    expect(await names()).toEqual([]);
    expect(await requests(BEGIN)).toEqual([]);
    await capture("order-review-withdrawn", "#conversion-plan-pending");
    await setInvokeResult(DESCRIBE, planned([3, 2, 1], { kind: "namedSubfolder", name: "Converted" }, "skip"));
    await releaseInvokeHold(DESCRIBE); await ready();
    expect(await names()).toEqual(["sample-3.raw", "sample-2.raw", "sample-1.raw"]);
    await click('[data-handle="raw-2"]');
    await setInvokeResult(DESCRIBE, planned([2], { kind: "namedSubfolder", name: "Converted" }, "skip"));
    await click(SELECTED); await ready();
    expect(await browser.$("#conversion-subfolder-name").getValue()).toBe("Converted");
    expect(await browser.$('input[name="conversion-conflict-policy"][value="skip"]').isSelected()).toBe(true);
  });

  for (const [width, height] of [[1366, 768], [1920, 1080], [1200, 800], [960, 640]]) {
    it(`keeps scope, review and action usable at ${width}x${height}`, async () => {
      await start(); await viewport(width!, height!);
      await setInvokeResult(DESCRIBE, planned([1, 2, 3])); await click(ALL); await ready();
      expect((await horizontalOverflow()).scrollWidth).toBeLessThanOrEqual(width! + 1);
      for (const selector of [ALL, '[aria-label="Reviewed conversion order"]', CONVERT]) {
        await reveal(selector);
        expect(await browser.$(selector).isDisplayed()).toBe(true);
        expect(await browser.execute((target: string) => {
          const rect = document.querySelector(target)!.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
        }, selector)).toBe(true);
        await capture(`${width}-${selector === ALL ? "scope" : selector === CONVERT ? "action" : "review"}`, selector);
      }
    });
  }
});
