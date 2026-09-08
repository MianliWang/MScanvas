/** M6.6 rendered proof. Only Tauri invoke is mocked; the controls and hooks ship. */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  ALLOWED_CONSOLE_SUBSTRINGS, consoleEntries, holdInvoke, horizontalOverflow,
  installIpcBoundary, ipcCalls, releaseInvokeHold, setInvokeRejection, setInvokeResult,
} from "../support/harness";
import { ipcTable, VENDOR_ROW } from "../support/fixtures";
import {
  availableBackend, completeCatalog, queueItem, queueOf, settledAt, shippedIntent,
} from "../../apps/desktop/src/test/previewFixtures";
import type {
  ConversionConflictPolicy, DestinationPolicy, WorkspaceConversionUpdate,
} from "../../apps/desktop/src/features/mzml-preview/contracts";

const PANEL = "section.conversion-panel";
const CONVERT = `${PANEL} button.primary-button`;
const DESCRIBE = "describe_workspace_conversion_queue";
const BEGIN = "begin_workspace_conversion_queue";
const RESOLVE = "choose_workspace_conversion_destination";
const AUTHORITY = settledAt(1, 1);
const IDLE: WorkspaceConversionUpdate = {
  sequence: 0, state: { status: "idle" }, authority: AUTHORITY, backendQuarantined: false,
  diagnostics: { eligibleItemCount: 0, available: false, exporting: false, lastExport: null },
};
const destination = (kind: DestinationPolicy["kind"]) =>
  `input[name="conversion-destination-policy"][value="${kind}"]`;

function planned(destinationPolicy: DestinationPolicy, conflictPolicy: ConversionConflictPolicy = "fail") {
  return {
    outcome: "planned", plan: {
      items: [{ datasetHandle: VENDOR_ROW.handle, fileName: VENDOR_ROW.fileName,
        sourceKind: VENDOR_ROW.sourceKind, output: { kind: "knownSingle", fileName: "sample-9.mzML" } }],
      outputFormat: "mzML", compression: "zlib", validationMode: "output_only", capacity: 16,
      intent: shippedIntent, conflictPolicy, destinationPolicy, receipt: 1,
    },
  };
}

async function innerViewport() {
  return browser.execute(() => ({ width: window.innerWidth, height: window.innerHeight }));
}

/** Window dimensions include browser chrome; every layout claim names the viewport. */
async function setInnerViewport(width: number, height: number) {
  await browser.setWindowSize(width, height);
  const frame = await browser.execute(() => ({
    width: window.outerWidth - window.innerWidth,
    height: window.outerHeight - window.innerHeight,
  }));
  await browser.setWindowSize(width + frame.width, height + frame.height);
  await browser.waitUntil(async () => {
    const actual = await innerViewport();
    return actual.width === width && actual.height === height;
  }, { timeoutMsg: `the inner viewport did not reach ${String(width)}x${String(height)}` });
  expect(await innerViewport()).toEqual({ width, height });
  console.log("M6.6 measured inner viewport", { width, height, frame });
}

async function openWorkspace(overrides: Record<string, unknown> = {}) {
  await setInnerViewport(1_366, 768);
  await installIpcBoundary({
    ...ipcTable(), inspect_backend: { ...availableBackend, authority: AUTHORITY },
    read_conversion_configuration: {
      authority: AUTHORITY,
      configuration: { configuration: "ready", catalog: completeCatalog, shipped: shippedIntent.id },
      outcome: { outcome: "answered" },
    },
    [DESCRIBE]: planned({ kind: "customFolder" }), get_workspace_conversion_state: IDLE,
    ...overrides,
  });
  await browser.url("/");
  expect(await innerViewport()).toEqual({ width: 1_366, height: 768 });
  const row = await browser.$(`li.dataset-row[data-handle="${VENDOR_ROW.handle}"]`);
  await row.waitForDisplayed({ timeout: 60_000 });
  await row.click();
  await browser.$(CONVERT).waitForEnabled({ timeout: 30_000 });
}

async function requests(command: string) {
  return (await ipcCalls()).filter((call) => call.command === command).map((call) => call.args);
}

async function requestedDestination() {
  return browser.execute(() => {
    const term = [...document.querySelectorAll(".conversion-plan dt")]
      .find((element) => element.textContent === "Requested destination");
    return term?.nextElementSibling?.textContent ?? null;
  });
}

async function captureView(name: string, selector: string) {
  await scrollNestedIntoView(selector);
  const artifacts = process.env.MSCANVAS_QA_ARTIFACTS ?? resolve("test-results", "m6.6");
  await mkdir(artifacts, { recursive: true });
  await browser.saveScreenshot(resolve(artifacts, `${name}.png`));
}

/** WDIO's desktop wheel scroll targets the window; this panel owns its scroll. */
async function scrollNestedIntoView(selector: string) {
  await browser.execute((target: string) => {
    // The document is intentionally overflow:hidden. DOM scrolling may move
    // that hidden ancestor too; preserve its position and scroll only the
    // panel/workspace scrollports that a reader can operate.
    const pageX = window.scrollX;
    const pageY = window.scrollY;
    document.querySelector(target)!.scrollIntoView({ block: "center", inline: "nearest" });
    window.scrollTo(pageX, pageY);
  }, selector);
  await browser.execute(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
}

async function controlInsideScrollports(selector: string) {
  await scrollNestedIntoView(selector);
  return browser.execute((target: string) => {
    const element = document.querySelector(target)!;
    const box = element.getBoundingClientRect();
    let top = 0, bottom = innerHeight, left = 0, right = innerWidth;
    for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      const clip = parent.getBoundingClientRect();
      if (style.overflowY !== "visible") { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); }
      if (style.overflowX !== "visible") { left = Math.max(left, clip.left); right = Math.min(right, clip.right); }
    }
    return { visible: box.height > 0 && box.width > 0 && box.top >= top && box.bottom <= bottom && box.left >= left && box.right <= right,
      box: { top: box.top, bottom: box.bottom, left: box.left, right: box.right }, clip: { top, bottom, left, right } };
  }, selector);
}

describe("M6.6 destination and conflict review", () => {
  afterEach(async function () {
    if (this.currentTest?.state === "failed") {
      const artifacts = process.env.MSCANVAS_QA_ARTIFACTS ?? resolve("test-results", "m6.6");
      await mkdir(artifacts, { recursive: true });
      await browser.saveScreenshot(resolve(artifacts, `failure-${this.currentTest.title.slice(0, 20).replace(/[^a-zA-Z0-9]/g, "-")}.png`));
      console.log("M66 visible-state diagnostic", JSON.stringify(await browser.execute(() =>
        ["#conversion-plan-pending", '.conversion-running [aria-label="Queue destination"]'].map((selector) => {
          const element = document.querySelector(selector);
          const ancestors = [];
          for (let parent = element; parent !== null && ancestors.length < 6; parent = parent.parentElement) {
            const box = parent.getBoundingClientRect();
            const style = getComputedStyle(parent);
            ancestors.push({ tag: parent.className, top: box.top, bottom: box.bottom, width: box.width,
              overflow: style.overflow, display: style.display, scrollTop: parent.scrollTop });
          }
          return { selector, text: element?.textContent, ancestors };
        }),
      )));
    }
    const unexpected = (await consoleEntries()).filter((entry) =>
      !ALLOWED_CONSOLE_SUBSTRINGS.some((allowed) => entry.text.includes(allowed)));
    expect(unexpected).toEqual([]);
  });

  it("keeps custom as default and makes a keyboard policy change wait for its own description", async () => {
    await openWorkspace();
    expect(await browser.$(destination("customFolder")).isSelected()).toBe(true);
    expect(await requestedDestination()).toBe("One local folder, chosen after Convert");
    const before = (await requests(DESCRIBE)).length;
    await holdInvoke(DESCRIBE);
    await browser.$(destination("customFolder")).click();
    await browser.keys("ArrowDown");
    await browser.waitUntil(async () => (await requests(DESCRIBE)).length === before + 1);
    expect(await browser.$(destination("sourceSibling")).isSelected()).toBe(true);
    expect(await browser.$(CONVERT).isEnabled()).toBe(false);
    await scrollNestedIntoView("#conversion-plan-pending");
    expect(await requestedDestination()).toBeNull();
    expect((await requests(DESCRIBE)).at(-1)).toEqual({ request: {
      handles: [VENDOR_ROW.handle], intentId: shippedIntent.id, conflictPolicy: "fail",
      destinationPolicy: { kind: "sourceSibling" }, expectedReceipt: 1,
    } });
    expect(await requests(BEGIN)).toEqual([]);
    expect(await requests(RESOLVE)).toEqual([]);
    await setInvokeResult(DESCRIBE, planned({ kind: "sourceSibling" }));
    await releaseInvokeHold(DESCRIBE);
    await browser.$(CONVERT).waitForEnabled();
    expect(await requestedDestination()).toContain("Beside each source");
    expect(await browser.$(destination("sourceSibling")).isFocused()).toBe(true);
  });

  it("connects Rust's name refusal to the input and recovers without a path field", async () => {
    await openWorkspace();
    await setInvokeResult(DESCRIBE, planned({ kind: "namedSubfolder", name: "Converted" }));
    await browser.$(destination("namedSubfolder")).click();
    await browser.keys("Tab");
    expect(await browser.$("#conversion-subfolder-name").isFocused()).toBe(true);
    await setInvokeRejection(DESCRIBE, {
      kind: "subfolder_name_unusable", summary: "Use one local subfolder name.", detail: null, retryable: false,
    });
    await browser.$("#conversion-subfolder-name").setValue("../taken ");
    await browser.waitUntil(async () => (await browser.$("#conversion-subfolder-name").getAttribute("aria-invalid")) === "true");
    expect(await browser.$(CONVERT).isEnabled()).toBe(false);
    await scrollNestedIntoView("#conversion-plan-pending");
    expect(await browser.$("#conversion-plan-pending").getText()).toBe("Use one local subfolder name.");
    await captureView("subfolder-refusal", "#conversion-plan-pending");
    expect(await browser.$("#conversion-subfolder-name").getAttribute("aria-describedby")).toContain("conversion-plan-pending");
    expect((await requests(DESCRIBE)).at(-1)?.request).toMatchObject({ destinationPolicy: { kind: "namedSubfolder", name: "../taken " } });
    expect(await requests(BEGIN)).toEqual([]);
    await setInvokeResult(DESCRIBE, planned({ kind: "namedSubfolder", name: "Results" }));
    await browser.$("#conversion-subfolder-name").setValue("Results");
    await browser.$(CONVERT).waitForEnabled();
    expect(await requestedDestination()).toContain("Results");
    expect(await browser.$("#conversion-subfolder-name").getAttribute("aria-invalid")).toBeNull();
    const fields = await browser.$$(`${PANEL} input[type="text"]`);
    expect(fields).toHaveLength(1);
  });

  it("preserves the named draft and conflict choice across a cancelled custom picker", async () => {
    await openWorkspace();
    await setInvokeResult(DESCRIBE, planned({ kind: "namedSubfolder", name: "Converted" }));
    await browser.$(destination("namedSubfolder")).click();
    await setInvokeResult(DESCRIBE, planned({ kind: "namedSubfolder", name: "Native QA" }));
    await browser.$("#conversion-subfolder-name").setValue("Native QA");
    await setInvokeResult(DESCRIBE, planned({ kind: "customFolder" }));
    await browser.$(destination("customFolder")).click();
    await setInvokeResult(DESCRIBE, planned({ kind: "customFolder" }, "skip"));
    await browser.$('input[name="conversion-conflict-policy"][value="skip"]').click();
    await browser.$(CONVERT).waitForEnabled();
    const queue = { ...queueOf([queueItem(VENDOR_ROW.handle, VENDOR_ROW.fileName)]),
      destinationPolicy: { kind: "customFolder" as const }, destinationStatus: "unresolved" as const,
      conflictPolicy: "skip" as const, receipt: null };
    await setInvokeResult(BEGIN, { authority: AUTHORITY,
      outcome: { outcome: "reserved", reservation: { reservationId: "conversion-1" } } });
    await setInvokeResult("get_workspace_conversion_state", {
      ...IDLE, sequence: 1, state: { status: "awaitingDestination", operationId: "1", queue },
    });
    await holdInvoke(RESOLVE);
    await browser.$(CONVERT).click();
    await browser.waitUntil(async () => (await requests(RESOLVE)).length === 1);
    expect(await requests(RESOLVE)).toEqual([{ reservationId: "conversion-1" }]);
    expect((await requests(BEGIN))[0]).toEqual({ request: {
      handles: [VENDOR_ROW.handle], intentId: shippedIntent.id, conflictPolicy: "skip",
      destinationPolicy: { kind: "customFolder" }, expectedReceipt: 1,
    } });
    await browser.$('.conversion-running [aria-label="Queue destination"]').waitForExist();
    expect(await browser.$(".conversion-running").getText()).toContain("No destination bound");
    const cancelled = { ...IDLE, sequence: 2 };
    await setInvokeResult("get_workspace_conversion_state", cancelled);
    await setInvokeResult(RESOLVE, cancelled);
    await releaseInvokeHold(RESOLVE);
    await browser.$(CONVERT).waitForEnabled();
    expect(await browser.$(CONVERT).isFocused()).toBe(true);
    expect(await browser.$('input[name="conversion-conflict-policy"][value="skip"]').isSelected()).toBe(true);
    await setInvokeResult(DESCRIBE, planned({ kind: "namedSubfolder", name: "Native QA" }, "skip"));
    await browser.$(destination("namedSubfolder")).click();
    expect(await browser.$("#conversion-subfolder-name").getValue()).toBe("Native QA");
  });

  it("keeps a bound queue's destination separate from the next request and explains conflicts", async () => {
    const queue = { ...queueOf([queueItem(VENDOR_ROW.handle, VENDOR_ROW.fileName)]),
      destinationPolicy: { kind: "namedSubfolder", name: "Original" }, conflictPolicy: "skip" };
    await openWorkspace({ get_workspace_conversion_state: {
      ...IDLE, sequence: 1, state: { status: "terminal", reason: "completed", operationId: "1", queue },
    } });
    const actual = await browser.$('.conversion-running [aria-label="Queue destination"]');
    await scrollNestedIntoView('.conversion-running [aria-label="Queue destination"]');
    expect(await actual.getText()).toContain("Original");
    expect(await actual.getText()).toContain("Bound when this queue started; revalidated before each attempt");
    await captureView("bound-queue", '.conversion-running [aria-label="Queue destination"]');
    expect(await requestedDestination()).toBe("One local folder, chosen after Convert");
    await scrollNestedIntoView("#conversion-conflict-scope");
    expect(await browser.$("#conversion-conflict-scope").getText()).toContain("a partial collision fails that item");
    expect(await browser.$("#conversion-conflict-scope").getText()).toContain("never overwritten or automatically renamed");
    expect(await browser.$$(`${PANEL} input[type="checkbox"]`)).toHaveLength(0);
  });

  for (const { width, height } of [
    { width: 1_920, height: 1_080 }, { width: 1_366, height: 768 },
    { width: 1_200, height: 800 }, { width: 960, height: 640 },
  ]) {
    it(`keeps destination controls and long names inside the ${String(width)}x${String(height)} inner viewport`, async () => {
      await openWorkspace();
      await setInnerViewport(width, height);
      const name = "Converted scientific acquisition results with a long descriptive folder name";
      await setInvokeResult(DESCRIBE, planned({ kind: "namedSubfolder", name }));
      await browser.$(destination("namedSubfolder")).click();
      await browser.$("#conversion-subfolder-name").setValue(name);
      await browser.$(CONVERT).waitForEnabled();
      const overflow = await horizontalOverflow();
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth + 1);
      expect(await browser.$(PANEL).getCSSProperty("overflow-y")).toMatchObject({ value: "auto" });
      expect(await browser.execute(() => {
        const group = document.querySelector(".conversion-destination")!.getBoundingClientRect();
        return [...document.querySelectorAll(".conversion-destination input")].every((input) => {
          const rect = input.getBoundingClientRect();
          return rect.width > 0 && rect.left >= group.left && rect.right <= group.right;
        });
      })).toBe(true);
      expect(await controlInsideScrollports("#conversion-subfolder-name")).toMatchObject({ visible: true });
      await captureView(`destination-${String(width)}`, ".conversion-destination");
      if (width <= 1_120) expect(await controlInsideScrollports(".conversion-destination")).toMatchObject({ visible: true });
      expect(await controlInsideScrollports(CONVERT)).toMatchObject({ visible: true });
      await captureView(`conflict-and-convert-${String(width)}`, CONVERT);
    });
  }
});
