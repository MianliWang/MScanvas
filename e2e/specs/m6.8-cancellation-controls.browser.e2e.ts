/** M6.8 browser evidence: production React, mocked Tauri boundary only. */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { ALLOWED_CONSOLE_SUBSTRINGS, consoleEntries, horizontalOverflow, installIpcBoundary, ipcCalls, setInvokeResult } from "../support/harness";
import { ipcTable } from "../support/fixtures";
import { availableBackend, completeCatalog, settledAt, shippedIntent } from "../../apps/desktop/src/test/previewFixtures";
import type { ConversionQueueItem, SelectedFile, WorkspaceConversionUpdate } from "../../apps/desktop/src/features/mzml-preview/contracts";

const STATE = "get_workspace_conversion_state";
const CANCEL_ITEM = "cancel_current_workspace_conversion_item";
const SKIP_ITEM = "skip_pending_workspace_conversion_item";
const STOP_QUEUE = "stop_workspace_conversion_queue";
const PANEL = "section.conversion-panel";
const RUNNING = `${PANEL} .conversion-running`;
const authority = settledAt(1, 1);

const row = (index: number): SelectedFile => ({ handle: `raw-${index}`, fileName: `sample-${index}.raw`, byteLength: index * 10, sourceKind: "thermo_raw", relativeContext: null });

function item(index: number, state: ConversionQueueItem["state"], attempts: number): ConversionQueueItem {
  return {
    datasetHandle: row(index).handle, fileName: row(index).fileName, sourceKind: "thermo_raw",
    output: { kind: "knownSingle", fileName: `sample-${index}.mzML` },
    state, attempts, retryable: false, result: null, error: null, cancellation: null,
    // The three facts an attempt establishes about itself, plus the fifth
    // judgement. A finished row renders them, so a fixture that omitted them
    // would be describing a wire Rust does not produce.
    process: state === "finalized"
      ? { kind: "settled" as const, termination: "exited", exitCode: 0 }
      : { kind: "notAttempted" as const },
    staged: state === "finalized" ? { kind: "published" as const } : { kind: "notCreated" as const },
    runIdentity: state === "finalized" ? `0000000000000001000000000000000${index}` : null,
    adoption: { kind: "nothingToAdopt" as const },
  } as ConversionQueueItem;
}

/** A queue, counted the way Rust counts it: from the item states themselves. */
function queue(items: readonly ConversionQueueItem[], retryRound = 0) {
  const count = (state: ConversionQueueItem["state"]) => items.filter((entry) => entry.state === state).length;
  const failed = count("failed");
  return {
    items, itemCount: items.length, receipt: 1, retryRound,
    currentIndex: items.findIndex((entry) => entry.state === "running") === -1
      ? items.filter((entry) => entry.state !== "pending").length
      : items.findIndex((entry) => entry.state === "running"),
    conflictPolicy: "fail" as const, destinationPolicy: { kind: "customFolder" as const }, destinationStatus: "bound" as const,
    finalizedCount: count("finalized"), skippedCount: count("skipped"), failedCount: failed,
    retryableFailedCount: 0, nonRetryableFailedCount: failed,
    cancelledCount: count("cancelled"), notRunCount: count("notRun"),
    skippedByRequestCount: count("skippedByRequest"), cancellationFailedCount: count("cancellationFailed"),
    adoptableOutputCount: 0, error: null,
  };
}

function update(state: WorkspaceConversionUpdate["state"], sequence: number, backendQuarantined = false): WorkspaceConversionUpdate {
  return { sequence, state, authority, backendQuarantined, diagnostics: { eligibleItemCount: 0, available: false, exporting: false, lastExport: null } };
}

const running = (items: readonly ConversionQueueItem[], sequence: number) =>
  update({ status: "running", operationId: "1", queue: queue(items) }, sequence);
const stopping = (items: readonly ConversionQueueItem[], sequence: number) =>
  update({ status: "stopping", operationId: "1", queue: queue(items) }, sequence);
const terminal = (items: readonly ConversionQueueItem[], reason: "completed" | "stopped" | "stopFailed", sequence: number, quarantined = false) =>
  update({ status: "terminal", operationId: "1", reason, queue: queue(items) }, sequence, quarantined);

const MID_RUN = [item(1, "finalized", 1), item(2, "running", 1), item(3, "pending", 0)];

async function viewport(width: number, height: number) {
  await browser.setWindowSize(width, height);
  const frame = await browser.execute(() => ({ width: outerWidth - innerWidth, height: outerHeight - innerHeight }));
  await browser.setWindowSize(width + frame.width, height + frame.height);
  expect(await browser.execute(() => ({ width: innerWidth, height: innerHeight }))).toEqual({ width, height });
  console.log("M6.8 measured inner viewport", { width, height });
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
  const directory = process.env.MSCANVAS_QA_ARTIFACTS ?? resolve("test-results", "m6.8-browser");
  await mkdir(directory, { recursive: true });
  await browser.saveScreenshot(resolve(directory, `${name}.png`));
}
async function requests(command: string) { return (await ipcCalls()).filter((call) => call.command === command).map((call) => call.args); }
async function button(name: string) { return browser.$(RUNNING).$(`button=${name}`); }

async function start(first: WorkspaceConversionUpdate) {
  await viewport(1366, 768);
  await installIpcBoundary({ ...ipcTable(), inspect_backend: { ...availableBackend, authority },
    get_workspace_roster: { datasets: [row(1), row(2), row(3)], capacity: 1024 },
    read_conversion_configuration: { authority, configuration: { configuration: "ready", catalog: completeCatalog, shipped: shippedIntent.id }, outcome: { outcome: "answered" } },
    [STATE]: first,
  });
  await browser.url("/");
  await browser.$(RUNNING).waitForDisplayed({ timeout: 30_000 });
}

describe("M6.8 cancellation scopes, skip and truthful progress", () => {
  afterEach(async function () {
    if (this.currentTest?.state === "failed") await capture(`failure-${this.currentTest.title.slice(0, 25).replace(/[^a-z0-9]/gi, "-")}`, PANEL);
    expect((await consoleEntries()).filter((entry) => !ALLOWED_CONSOLE_SUBSTRINGS.some((allowed) => entry.text.includes(allowed)))).toEqual([]);
  });

  it("offers two stop scopes that name themselves, and no third", async () => {
    await start(running(MID_RUN, 1));

    expect(await browser.$(RUNNING).getText()).toContain("Converting item 2 of 3");
    // Two scopes, and exactly two. Each says which one it is: two controls both
    // called "Stop" would be the ambiguity this pair exists to avoid.
    const scoped = await browser.execute(() =>
      [...document.querySelectorAll(".conversion-running .conversion-actions button")].map((node) => node.textContent));
    expect(scoped).toEqual(["Stop queue", "Stop this file"]);
    // Named at the control, not in a legend somewhere else.
    expect(await browser.$("#conversion-cancel-item-scope").getText())
      .toContain("Stop this file ends sample-2.raw and carries on with the rest of the queue.");
    // Nothing that would suspend the run or take a row out of the bound plan.
    for (const absent of ["Pause", "Resume", "Remove"]) {
      expect(await (await button(absent)).isExisting()).toBe(false);
    }
    await capture("two-stop-scopes", `${RUNNING} .conversion-actions`);
  });

  it("ends one file by its exact attempt and lets the queue carry on", async () => {
    await start(running(MID_RUN, 1));

    await setInvokeResult(CANCEL_ITEM, running([item(1, "finalized", 1), item(2, "cancelled", 1), item(3, "running", 1)], 2));
    await (await button("Stop this file")).click();

    // The exact identity, not "whatever is running now": the operation, the
    // item's index and that item's attempt number.
    await browser.waitUntil(async () => (await requests(CANCEL_ITEM)).length === 1);
    expect((await requests(CANCEL_ITEM))[0]).toMatchObject({ operationId: "1", itemIndex: 1, attempt: 1 });
    // The queue was not stopped.
    expect(await requests(STOP_QUEUE)).toEqual([]);

    await browser.waitUntil(async () => (await browser.$(RUNNING).getText()).includes("Converting item 3 of 3"));
    const states = await browser.execute(() =>
      [...document.querySelectorAll(".conversion-running .conversion-queue-list > li")].map((node) => node.getAttribute("data-item-state")));
    expect(states).toEqual(["finalized", "cancelled", "running"]);
    // The control comes back for the next item rather than staying disabled.
    expect(await (await button("Stop this file")).isEnabled()).toBe(true);
    await capture("one-file-ended-queue-continues", RUNNING);
  });

  it("skips only a waiting row, and says who decided", async () => {
    await start(running(MID_RUN, 1));

    // Offered on the waiting row and on no other: the row being converted is
    // ended by the other action, and a finished one has nothing to skip.
    const offered = await browser.execute(() =>
      [...document.querySelectorAll(".conversion-running .conversion-queue-list > li")]
        .map((node) => node.querySelector(".conversion-queue-skip")?.textContent ?? null));
    expect(offered).toEqual([null, null, "Skip sample-3.raw"]);
    await capture("skip-offered-on-waiting-row-only", `${RUNNING} .conversion-queue-list`);

    await setInvokeResult(SKIP_ITEM, running([item(1, "finalized", 1), item(2, "running", 1), item(3, "skippedByRequest", 0)], 2));
    await click(`${RUNNING} .conversion-queue-list > li:nth-child(3) .conversion-queue-skip`);

    await browser.waitUntil(async () => (await requests(SKIP_ITEM)).length === 1);
    expect((await requests(SKIP_ITEM))[0]).toMatchObject({ operationId: "1", itemIndex: 2 });
    await browser.waitUntil(async () =>
      (await browser.$(`${RUNNING} .conversion-queue-list > li:nth-child(3)`).getAttribute("data-item-state")) === "skippedByRequest");
    // Said in words, and it names who decided rather than reusing either
    // neighbouring state's sentence.
    expect(await browser.$(`${RUNNING} .conversion-queue-list > li:nth-child(3) .conversion-queue-status`).getText())
      .toBe("Skipped — you chose not to convert this one");
    // The row keeps its place and its name: this is an outcome, not a removal.
    expect(await browser.$$(`${RUNNING} .conversion-queue-list > li`).length).toBe(3);
    expect(await browser.$(`${RUNNING} .conversion-queue-list > li:nth-child(3)`).getText()).toContain("sample-3.raw");
    await capture("skipped-by-request", `${RUNNING} .conversion-queue-list`);
  });

  it("withdraws both narrower scopes while the whole queue is stopping", async () => {
    await start(stopping(MID_RUN, 1));

    expect(await browser.$(RUNNING).getText()).toContain("Stopping queue…");
    // Neither narrower action is offered: once the queue is ending there is no
    // "carry on" left for either of them to preserve.
    expect(await (await button("Stop this file")).isExisting()).toBe(false);
    expect(await browser.$(`${RUNNING} .conversion-queue-skip`).isExisting()).toBe(false);
    // And nothing predicts how the item under way will end.
    expect(await browser.$(RUNNING).getText()).not.toContain("Cancelled");
    await capture("stopping-withdraws-narrower-scopes", RUNNING);
  });

  it("counts every item a completed queue held, including the two the user decided", async () => {
    await start(terminal([item(1, "finalized", 1), item(2, "cancelled", 1), item(3, "skippedByRequest", 0)], "completed", 1));

    // Three counts used to be the whole vocabulary for a completed queue,
    // because a cancelled item could only arrive through a queue stop. Now that
    // a user can end one file and settle another without running it, a
    // three-count sentence would leave two of three items unaccounted for.
    expect(await browser.$(PANEL).getText())
      .toContain("1 converted, 0 skipped, 0 failed, 1 cancelled, 1 skipped by you of 3.");
    // Each said in words on its own row, and neither borrows the other's
    // sentence or a conflict-policy skip's.
    const states = await browser.execute(() =>
      [...document.querySelectorAll(".conversion-panel .conversion-queue-list > li")]
        .map((node) => node.querySelector(".conversion-queue-status")?.textContent ?? null)
        .filter((text) => text !== null));
    expect(states.slice(0, 3)).toEqual([
      "Converted",
      "Cancelled",
      "Skipped — you chose not to convert this one",
    ]);
    await capture("counts-partition-the-queue", PANEL);
  });

  it("never calls an unconfirmed stop a success, and says the session is quarantined", async () => {
    await start(terminal([item(1, "finalized", 1), item(2, "cancellationFailed", 1), item(3, "notRun", 0)], "stopFailed", 1, true));

    // The heading a user skims must not claim the one thing this state does not
    // establish, and then be walked back by the warning under it.
    const panelText = await browser.$(PANEL).getText();
    expect(panelText).toContain("Stop could not be confirmed");
    expect(panelText).not.toContain("Queue stopped");
    // The consequence, said where it is acted on: no further backend work while
    // MSCanvas cannot say whether a converter process of its own survives.
    expect(panelText).toContain("Restart MSCanvas");
    await capture("unconfirmed-stop-quarantine", PANEL);
  });

  for (const [width, height] of [[1366, 768], [1920, 1080], [1200, 800], [960, 640]]) {
    it(`keeps both stop scopes and the skip control usable at ${width}x${height}`, async () => {
      await start(running(MID_RUN, 1));
      await viewport(width!, height!);
      expect((await horizontalOverflow()).scrollWidth).toBeLessThanOrEqual(width! + 1);
      for (const [name, selector] of [
        ["stop-queue", `${RUNNING} .conversion-actions button:first-child`],
        ["stop-file", `${RUNNING} .conversion-actions button:last-child`],
        ["skip", `${RUNNING} .conversion-queue-list > li:nth-child(3) .conversion-queue-skip`],
      ] as const) {
        await reveal(selector);
        expect(await browser.$(selector).isDisplayed()).toBe(true);
        expect(await browser.execute((target: string) => {
          const rect = document.querySelector(target)!.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
        }, selector)).toBe(true);
        await capture(`${width}-${name}`, selector);
      }
    });
  }
});
