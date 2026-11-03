/**
 * The conversion history (RUN-007, ADR 0065), rendered: production React in
 * Chrome over the mocked IPC boundary. It says what the interface asks and shows;
 * that a real queue records, and what a real store answers, is the Rust suite's
 * and the native specs'.
 */
import { consoleEntries, holdInvoke, horizontalOverflow, installIpcBoundary, ipcCalls, releaseInvokeHold, setInvokeResult } from "../support/harness";
import { scenario } from "../support/pm9Scenarios";
import { ENDED, ENDED_ITEMS, INTERRUPTED, INTERRUPTED_ITEMS, MANY_ITEMS, MANY_RUNS, RUNNING, found, listed } from "../support/runHistory";
import { readBackSavedPreferences } from "../support/viewer";
import { metrics } from "../support/cdp";
import { en } from "../../apps/desktop/src/features/preferences/locales/en";

const ENTRY = "[data-run-history-entry]";
const VIEW = "[data-run-history]";
const DIALOG = "[data-settings-dialog]";
const row = (runId: string) => `[data-run-row="${runId}"]`;

async function start(table: Record<string, unknown>) {
  await installIpcBoundary(table);
  await browser.url("/");
  await browser.$(".workbench-header").waitForDisplayed({ timeout: 60_000 });
  await readBackSavedPreferences();
  await browser.$('[data-surface-tab="conversion"]').click();
  await browser.$(ENTRY).waitForDisplayed();
}

const world = (overrides: Record<string, unknown>) => ({ ...scenario("populated"), ...overrides });
const focused = (selector: string) => browser.waitUntil(() => browser.execute((css: string) => document.activeElement?.matches(css) === true, selector), { timeoutMsg: `the keyboard never reached ${selector}` });
const commands = async (name: string) => (await ipcCalls()).filter((call) => call.command === name);
const pageText = () => browser.execute(() => document.body.innerText);

describe("Conversion history", () => {
  afterEach(async () => {
    const problems = (await consoleEntries()).filter((entry) => entry.level !== "warn");
    expect(problems).toEqual([]);
  });

  it("opens on the newest run, reads the one chosen, and comes back with nothing lost", async () => {
    await start(world({ list_conversion_runs: listed([ENDED, INTERRUPTED]), read_conversion_run: found(ENDED, ENDED_ITEMS) }));
    expect(await commands("list_conversion_runs")).toEqual([]);

    await browser.$(ENTRY).click();
    await browser.$(VIEW).waitForDisplayed();
    await focused("#run-history-heading");
    await browser.$(`[data-run-detail="${ENDED.runId}"] [data-run-item]`).waitForDisplayed();
    expect((await commands("read_conversion_run")).map((call) => call.args)).toEqual([{ runId: ENDED.runId }]);
    expect(await browser.$(row(ENDED.runId)).getAttribute("aria-current")).toBe("true");
    // The queue's panel keeps its state, hidden, rather than being unmounted.
    expect(await browser.execute(() => document.querySelector<HTMLElement>('.conversion-panel:not([data-run-history])')?.hidden)).toBe(true);

    await setInvokeResult("read_conversion_run", found(INTERRUPTED, INTERRUPTED_ITEMS));
    await browser.$(row(INTERRUPTED.runId)).click();
    await browser.$(`[data-run-detail="${INTERRUPTED.runId}"] [data-run-interrupted-at]`).waitForDisplayed();
    expect((await commands("read_conversion_run")).at(-1)?.args).toEqual({ runId: INTERRUPTED.runId });
    expect(await browser.execute(() => [...document.querySelectorAll("[data-run-item]")].map((item) => item.getAttribute("data-item-state")))).toEqual(["finalized", "interrupted", "notRun"]);
    // An interrupted run claims no end: its facts name when it was found, not when it stopped.
    const facts = await browser.execute(() => [...document.querySelectorAll("[data-run-detail] dl > div")].map((fact) => fact.textContent));
    expect(facts.some((fact) => fact?.startsWith(en.runHistoryEnded))).toBe(false);
    expect(facts.some((fact) => fact?.startsWith(en.runHistoryInterruptedAt))).toBe(true);

    await browser.$("[data-run-history-back]").click();
    await browser.$(VIEW).waitForExist({ reverse: true });
    await focused(ENTRY);
  });

  it("never sends a path and shows none", async () => {
    await start(world({ list_conversion_runs: listed([ENDED]), read_conversion_run: found(ENDED, ENDED_ITEMS) }));
    await browser.$(ENTRY).click();
    await browser.$("[data-run-item]").waitForDisplayed();
    const text = await pageText();
    expect(text.includes("\\")).toBe(false);
    expect(text.includes(":/")).toBe(false);
    for (const call of [...await commands("list_conversion_runs"), ...await commands("read_conversion_run")]) {
      expect(JSON.stringify(call.args)).not.toMatch(/[\\/]/u);
    }
  });

  it("asks before Clear, keeps the keyboard on the safe answer, and says what it kept", async () => {
    await start(world({ list_conversion_runs: listed([ENDED, RUNNING]), read_conversion_run: found(ENDED, ENDED_ITEMS), clear_conversion_runs: { outcome: "done", keptInProgress: 1 } }));
    await browser.$(ENTRY).click();
    await browser.$(row(ENDED.runId)).waitForDisplayed();

    await browser.$("[data-run-history-clear]").click();
    await focused("[data-run-history-keep]");
    await browser.keys("Enter");
    await focused("[data-run-history-clear]");
    expect(await commands("clear_conversion_runs")).toEqual([]);

    await browser.keys("Enter");
    await focused("[data-run-history-keep]");
    await setInvokeResult("list_conversion_runs", listed([RUNNING]));
    await browser.$("[data-run-history-forget]").click();
    await browser.$(`[data-run-history-clear-status]`).waitUntil(async function (this: WebdriverIO.Element) {
      return (await this.getText()).includes("1");
    });
    expect((await commands("clear_conversion_runs")).length).toBe(1);
    await browser.$(row(ENDED.runId)).waitForExist({ reverse: true });
    // The run it kept is what the detail falls to.
    await browser.$(`[data-run-detail="${RUNNING.runId}"]`).waitForDisplayed();
  });

  it("takes the keyboard from a run to what it recorded, by Tab and Enter alone", async () => {
    await start(world({ list_conversion_runs: listed([ENDED, INTERRUPTED]), read_conversion_run: found(ENDED, ENDED_ITEMS) }));
    await browser.$(ENTRY).click();
    await focused("#run-history-heading");
    await browser.$("[data-run-item]").waitForDisplayed();
    await browser.keys("Tab");
    await focused("[data-run-history-back]");
    await browser.keys("Tab");
    await focused("[data-run-history-refresh]");
    await browser.keys("Tab");
    await focused(row(ENDED.runId));
    await browser.keys("Tab");
    await focused(row(INTERRUPTED.runId));
    await setInvokeResult("read_conversion_run", found(INTERRUPTED, INTERRUPTED_ITEMS));
    await browser.keys("Enter");
    await browser.$(`[data-run-detail="${INTERRUPTED.runId}"] [data-run-item]`).waitForDisplayed();
    await focused(row(INTERRUPTED.runId));
    await browser.keys("Tab");
    await focused("[data-run-history-clear]");
    await browser.keys("Tab");
    await focused("[data-run-item] .conversion-item-toggle");
    await browser.keys("Enter");
    await browser.$("[data-run-item] .conversion-item-manifest").waitForDisplayed();
  });

  it("gives Conversion back to the queue when anything sends the reader to a surface", async () => {
    await start(world({ list_conversion_runs: listed([]) }));
    await browser.$(ENTRY).click();
    await browser.$(VIEW).waitForDisplayed();
    await browser.$('[data-surface-tab="workbench"]').click();
    await browser.$('[data-surface-tab="conversion"]').click();
    await browser.$(ENTRY).waitForDisplayed();
    expect(await browser.$(VIEW).isExisting()).toBe(false);
  });

  it("refuses Clear with its reason while there is nothing to clear", async () => {
    await start(world({}));
    await browser.$(ENTRY).click();
    await browser.$(".run-history-empty").waitForDisplayed();
    expect(await browser.$("[data-run-history-clear]").getAttribute("aria-disabled")).toBe("true");
    expect(await browser.$("[data-run-history-clear]").getAttribute("aria-describedby")).toBe(await browser.$("[data-run-history-clear-status]").getAttribute("id"));
    expect(await browser.$("[data-run-history-clear-status]").getText()).not.toBe("");
    await browser.$("[data-run-history-clear]").click();
    expect(await browser.$("[data-run-history-confirm]").isExisting()).toBe(false);
  });

  it("reads a list that was held, and a list that was refused says so with a way to read again", async () => {
    await installIpcBoundary(world({ list_conversion_runs: { __reject: { kind: "stale_document", summary: "", detail: null, retryable: false } } }));
    await browser.url("/");
    await browser.$(".workbench-header").waitForDisplayed({ timeout: 60_000 });
    await readBackSavedPreferences();
    await browser.$('[data-surface-tab="conversion"]').click();
    await browser.$(ENTRY).click();
    await browser.$('[data-run-history-problem="error"]').waitForDisplayed();

    await holdInvoke("list_conversion_runs");
    await setInvokeResult("list_conversion_runs", listed([ENDED]));
    await setInvokeResult("read_conversion_run", found(ENDED, ENDED_ITEMS));
    await browser.$("[data-run-history-refresh]").click();
    await browser.waitUntil(async () => (await browser.$("[data-run-history-refresh]").getAttribute("aria-disabled")) === "true");
    await releaseInvokeHold("list_conversion_runs");
    await browser.$("[data-run-item]").waitForDisplayed();
    expect(await browser.$('[data-run-history-problem="error"]').isExisting()).toBe(false);
  });

  it("stays usable at the store's bounds: 200 runs and a 1,024-file run, windowed, no sideways scroll", async () => {
    for (const [width, height] of [[1366, 768], [960, 640]] as const) {
      await metrics(width, height);
      await start(world({ list_conversion_runs: listed(MANY_RUNS), read_conversion_run: found(MANY_RUNS[0]!, MANY_ITEMS) }));
      const before = await browser.execute(() => performance.now());
      await browser.$(ENTRY).click();
      await browser.$("[data-run-item]").waitForDisplayed();
      // Evidence for the record, not a gate: a shared runner's clock proves nothing.
      console.log(`run history at ${String(width)}x${String(height)}: open to first file in ${String(Math.round(await browser.execute((origin: number) => performance.now() - origin, before)))} ms`);
      const facts = await browser.execute(() => ({
        runs: document.querySelectorAll("[data-run-row]").length,
        items: document.querySelectorAll("[data-run-item]").length,
      }));
      expect(facts.runs).toBeLessThan(200);
      expect(facts.items).toBeLessThan(1_024);
      const { scrollWidth, innerWidth } = await horizontalOverflow();
      expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
    }
  });
});

describe("Conversion history in Settings", () => {
  const openSettings = async () => {
    await browser.$("[data-settings-entry]").click();
    await browser.$(DIALOG).waitForDisplayed();
  };

  it("reads the switch when Settings opens, asks before Off, and Off then answers from the store", async () => {
    await installIpcBoundary(world({ list_conversion_runs: listed([ENDED]) }));
    await browser.url("/");
    await browser.$(".workbench-header").waitForDisplayed({ timeout: 60_000 });
    await readBackSavedPreferences();
    expect(await commands("list_conversion_runs")).toEqual([]);

    await openSettings();
    await browser.$('[data-run-history-toggle="on"]').waitForDisplayed();
    await browser.$('[data-run-history-toggle="on"]').click();
    await focused("[data-run-history-off-keep]");
    await browser.keys("Enter");
    await focused('[data-run-history-toggle="on"]');
    expect(await commands("set_conversion_run_history_enabled")).toEqual([]);

    await browser.$('[data-run-history-toggle="on"]').click();
    await setInvokeResult("list_conversion_runs", listed([], { recording: false }));
    await browser.$("[data-run-history-off-forget]").click();
    await browser.$('[data-run-history-toggle="off"]').waitForDisplayed();
    expect((await commands("set_conversion_run_history_enabled")).map((call) => call.args)).toEqual([{ enabled: false }]);

    await setInvokeResult("list_conversion_runs", listed([]));
    await browser.$('[data-run-history-toggle="off"]').click();
    await browser.$('[data-run-history-toggle="on"]').waitForDisplayed();
    expect((await commands("set_conversion_run_history_enabled")).map((call) => call.args)).toEqual([{ enabled: false }, { enabled: true }]);
  });

  it("refuses the switch with its reason while it is read, and an unavailable store keeps the reason", async () => {
    await installIpcBoundary(world({ list_conversion_runs: { outcome: "unavailable", problem: "directoryUnusable" } }), { hold: ["list_conversion_runs"] });
    await browser.url("/");
    await browser.$(".workbench-header").waitForDisplayed({ timeout: 60_000 });
    await readBackSavedPreferences();
    await openSettings();
    const toggle = browser.$(`${DIALOG} [data-run-history-setting]`);
    await toggle.waitForExist();
    expect(await toggle.getAttribute("aria-disabled")).toBe("true");
    const reason = await browser.execute((css: string) => document.getElementById(document.querySelector(css)?.getAttribute("aria-describedby") ?? "")?.textContent, `${DIALOG} [data-run-history-setting]`);
    expect(reason?.trim()).toBeTruthy();
    await releaseInvokeHold("list_conversion_runs");
    await browser.waitUntil(async () => {
      const after = await browser.execute((css: string) => document.getElementById(document.querySelector(css)?.getAttribute("aria-describedby") ?? "")?.textContent, `${DIALOG} [data-run-history-setting]`);
      return after !== reason;
    });
    // Still refused, now with the store's own reason.
    expect(await toggle.getAttribute("aria-disabled")).toBe("true");
    expect(await browser.$('[data-run-history-toggle="on"]').isExisting()).toBe(false);
  });
});
