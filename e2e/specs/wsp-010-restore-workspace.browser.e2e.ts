/**
 * WSP-010 Restore workspace (ADR 0061), rendered.
 *
 * The real production composition in real Chrome over the real Vite dev server,
 * with only `window.__TAURI_INTERNALS__.invoke` replaced. Every answer is a
 * controlled fixture: no file was read, no record written. Whether a real
 * document round-trips belongs to the native campaign.
 */
import { metrics } from "../support/cdp";
import { MZML_ROW, ipcTable } from "../support/fixtures";
import { consoleEntries, holdInvoke, horizontalOverflow, installIpcBoundary, ipcCalls, releaseInvokeHold, setInvokeResult } from "../support/harness";
import { revealRosterRow } from "../support/viewer";
import { en } from "../../apps/desktop/src/features/preferences/locales/en";

const ROW_STATES = ["changed", "missing", "unreachable", "unreadable", "unsafe"] as const;

function row(index: number, displayName: string, state: string, extra: Record<string, unknown> = {}) {
  return { handle: `restored-${String(index)}`, sourceKind: "thermo_raw", displayName, context: null, checked: false, state, ...extra };
}

function read(rows: readonly unknown[], expired = 0, leftoverCopies = 0) {
  return { outcome: "restored", groups: [{ name: null, rows }], expired, leftoverCopies };
}

const FIRST_RUN = read([]);
const OFFER = read([row(0, "QC_01.raw", "matching", { checked: true }), row(1, "QC_02.raw", "matching")]);
const MARKED = read(ROW_STATES.map((state, index) => row(index, `${state}.raw`, state)));
const MIXED = read([row(0, "QC_01.raw", "matching"), row(1, "QC.raw", "missing", { context: "batch-1" }), row(2, "QC.raw", "changed", { context: "batch-2" })]);

function world(answers: Record<string, unknown>, rows: readonly unknown[] = []) {
  return {
    ...ipcTable(),
    subscribe_workspace_drop_updates: { reservationId: "restore-reservation" },
    get_workspace_roster: { datasets: rows, capacity: 1024 },
    ...answers,
  };
}

async function start(answers: Record<string, unknown>, rows: readonly unknown[] = [], hold: readonly string[] = [], size: readonly [number, number] = [1366, 768]) {
  await metrics(size[0], size[1]);
  await installIpcBoundary(world(answers, rows), { hold });
  await browser.url("/");
  await browser.$(".workbench-header").waitForDisplayed({ timeout: 60_000 });
}

const calls = async (command: string) => (await ipcCalls()).filter(call => call.command === command);
const text = (css: string) => browser.$(css).getText();

async function expectCleanConsole() {
  expect(await consoleEntries()).toEqual([]);
}

async function toggleRow() {
  await revealRosterRow(MZML_ROW.handle);
  await browser.$(`.grouped-roster [data-handle="${MZML_ROW.handle}"] input[type="checkbox"]`).click();
}

describe("WSP-010 Restore workspace, rendered", () => {
  it("reads once and saves nothing until something changes", async () => {
    await start({ read_workspace_restore: OFFER });
    await browser.$("[data-restore-action]").waitForDisplayed();
    expect(await text('[data-restore="offer"]')).toContain("2 files from the last session can be added again.");
    expect(await calls("read_workspace_restore")).toHaveLength(1);
    expect(await calls("save_workspace_restore")).toEqual([]);
    expect(await calls("restore_workspace")).toEqual([]);
    expect(await calls("open_mzml_preview")).toEqual([]);
    await expectCleanConsole();
  });

  it("says it is checking while a slow read holds the start", async () => {
    await start({ read_workspace_restore: OFFER }, [], ["read_workspace_restore"]);
    await browser.$('[data-restore="loading"]').waitForDisplayed();
    await releaseInvokeHold("read_workspace_restore");
    await browser.$('[data-restore="loading"]').waitForExist({ reverse: true });
    await browser.$("[data-restore-action]").waitForDisplayed();
    await expectCleanConsole();
  });

  it("is refused with the installation check's reason while that check runs, as Add files is", async () => {
    await start({ read_workspace_restore: OFFER }, [], ["inspect_backend"]);
    const action = browser.$("[data-restore-action]");
    await action.waitForDisplayed();
    expect(await action.getAttribute("aria-disabled")).toBe("true");
    expect(await text("#restore-reason")).toBe(en.backendCheckingInstallation);
    await action.click();
    expect(await calls("restore_workspace")).toEqual([]);
    await releaseInvokeHold("inspect_backend");
    await browser.waitUntil(async () => (await action.getAttribute("aria-disabled")) === null);
    await expectCleanConsole();
  });

  it("puts rows back from the keyboard, says they were not verified, previews nothing and records them", async () => {
    await start({
      read_workspace_restore: OFFER,
      restore_workspace: {
        workspace: { roster: { datasets: [MZML_ROW], capacity: 1024 }, outcomes: [{ outcome: "added", dataset: MZML_ROW }] },
        placed: [{ handle: MZML_ROW.handle, group: null, checked: true, added: true }],
      },
    });
    await browser.$("[data-restore-action]").waitForDisplayed();
    await setInvokeResult("read_workspace_restore", FIRST_RUN);
    await browser.execute(() => document.querySelector<HTMLElement>("[data-restore-action]")?.focus());
    await browser.keys("Enter");
    await browser.$(`[data-handle="${MZML_ROW.handle}"]`).waitForExist();
    await browser.waitUntil(async () => (await calls("save_workspace_restore")).length === 1);
    const [saved] = await calls("save_workspace_restore");
    expect(saved?.args["arrangement"]).toEqual({ groups: [{ name: null, handles: [MZML_ROW.handle] }], checked: [MZML_ROW.handle] });
    expect(await browser.$('[data-live-region="workspace"]').getProperty("textContent")).toContain("It was not verified against the last session.");
    expect(await browser.$("[data-restore-action]").isExisting()).toBe(false);
    expect(await calls("open_mzml_preview")).toEqual([]);
    // The button that held the keyboard left; the keyboard did not fall to the body.
    expect(await browser.execute(() => document.activeElement === document.body)).toBe(false);
    await expectCleanConsole();
  });

  it("lists every marked state with its reason and dismisses one row by keyboard", async () => {
    await start({ read_workspace_restore: MARKED });
    await browser.$("[data-restored-row]").waitForDisplayed();
    expect(await browser.$("[data-restore-action]").isExisting()).toBe(false);
    for (const [state, reason] of [
      ["changed", en.restoreStateChanged], ["missing", en.restoreStateMissing], ["unreachable", en.restoreStateUnreachable],
      ["unreadable", en.restoreStateUnreadable], ["unsafe", en.restoreStateUnsafe],
    ] as const) {
      expect(await text(`[data-restored-row][data-state="${state}"]`)).toContain(reason);
    }
    await setInvokeResult("read_workspace_restore", read(ROW_STATES.slice(1).map((state, index) => row(index + 1, `${state}.raw`, state))));
    await browser.execute(() => document.querySelector<HTMLElement>('[data-state="changed"] [data-restore-dismiss]')?.focus());
    await browser.keys("Enter");
    await browser.waitUntil(async () => (await browser.$$("[data-restored-row]").length) === 4);
    expect((await calls("dismiss_restored_row")).map(call => call.args["handle"])).toEqual(["restored-0"]);
    expect(await browser.execute(() => document.activeElement?.hasAttribute("data-restore-dismiss"))).toBe(true);
    await browser.waitUntil(async () => (await calls("save_workspace_restore")).length === 1);
    await expectCleanConsole();
  });

  it("tells same-named rows apart by the folder context only", async () => {
    await start({ read_workspace_restore: MIXED });
    await browser.$("[data-restored-row]").waitForDisplayed();
    expect(await text('[data-restored-row="restored-1"]')).toContain("QC.raw, batch-1");
    expect(await text('[data-restored-row="restored-2"]')).toContain("QC.raw, batch-2");
    expect(await browser.execute(() => document.body.innerText.includes(":\\"))).toBe(false);
  });

  it("says how many rows are no longer offered", async () => {
    await start({ read_workspace_restore: read([], 3) });
    await browser.$("[data-restore-expired]").waitForDisplayed();
    expect(await text("[data-restore-expired]")).toContain("3 files from an earlier session are no longer offered.");
    await browser.$('[data-restore="offer"] .notice-dismiss').click();
    await browser.$('[data-restore="offer"]').waitForExist({ reverse: true });
  });

  it("keeps the later writer's refusal on screen and stops recording", async () => {
    await start({ save_workspace_restore: { outcome: "refused", problem: "changedElsewhere" } }, [MZML_ROW]);
    await toggleRow();
    await browser.$('[data-restore="problem"]').waitForDisplayed();
    expect(await text('[data-restore="problem"]')).toContain(en.restoreProblemChangedElsewhere);
    expect(await browser.$("[data-restore-retry]").isExisting()).toBe(false);
    await browser.$(`.grouped-roster [data-handle="${MZML_ROW.handle}"] input[type="checkbox"]`).click();
    expect(await calls("save_workspace_restore")).toHaveLength(1);
    await expectCleanConsole();
  });

  it("offers Try again for a record another program holds", async () => {
    await start({ save_workspace_restore: { outcome: "refused", problem: "identityUnknown" } }, [MZML_ROW]);
    await toggleRow();
    await browser.$("[data-restore-retry]").waitForDisplayed();
    await setInvokeResult("save_workspace_restore", { outcome: "saved" });
    await browser.$("[data-restore-retry]").click();
    await browser.$('[data-restore="problem"]').waitForExist({ reverse: true });
    expect(await calls("save_workspace_restore")).toHaveLength(2);
    await expectCleanConsole();
  });

  it("answers too many rows with Start fresh, and records the session after it", async () => {
    await start({ read_workspace_restore: MARKED, save_workspace_restore: { outcome: "refused", problem: "tooManyRows" } }, [MZML_ROW]);
    await browser.$("[data-restored-row]").waitForDisplayed();
    await toggleRow();
    await browser.$('[data-restore="problem"]').waitForDisplayed();
    expect(await text('[data-restore="problem"]')).toContain(en.restoreProblemTooManyRows);
    await setInvokeResult("read_workspace_restore", FIRST_RUN);
    await setInvokeResult("save_workspace_restore", { outcome: "saved" });
    await browser.$('[data-restore="offer"] [data-restore-start-fresh]').click();
    await browser.$('[data-restore="problem"]').waitForExist({ reverse: true });
    expect(await browser.$('[data-restore="offer"]').isExisting()).toBe(false);
    expect(await calls("clear_workspace_restore")).toHaveLength(1);
    expect(await calls("save_workspace_restore")).toHaveLength(2);
    await expectCleanConsole();
  });

  it("recovers a read that failed with Try again", async () => {
    await start({ read_workspace_restore: { __reject: { kind: "unexpected_error", summary: "boom", detail: null, retryable: true } } });
    await browser.$('[data-restore="read-failed"]').waitForDisplayed();
    await setInvokeResult("read_workspace_restore", OFFER);
    await browser.$('[data-restore="read-failed"] button').click();
    await browser.$("[data-restore-action]").waitForDisplayed();
    await expectCleanConsole();
  });

  it("says a refused record was left as found, and Settings says how to go on", async () => {
    await start({ read_workspace_restore: { outcome: "refused", problem: "newerVersion", leftoverCopies: 1 } });
    await browser.$('[data-restore="refused"]').waitForDisplayed();
    expect(await text('[data-restore="refused"]')).toContain(en.restoreRefusedNewerVersion);
    await browser.$("[data-settings-entry]").click();
    const refused = browser.$('[data-restore-settings="refused"]');
    await refused.waitForExist();
    expect(await refused.getText()).toContain(en.restoreRefusedKeepsAside);
    expect(await browser.$('[data-restore-settings="leftovers"]').getText()).toContain("1 kept-aside copy remains");
    await browser.execute(() => document.querySelector("[data-settings-dialog] [role=\"radio\"]:has([data-setting-value=\"restore-on\"])")?.scrollIntoView());
    await setInvokeResult("read_workspace_restore", FIRST_RUN);
    await browser.$('[role="radio"]:has([data-setting-value="restore-on"])').click();
    await browser.waitUntil(async () => (await calls("set_workspace_restore_enabled")).length === 1);
    expect((await calls("set_workspace_restore_enabled"))[0]?.args["enabled"]).toBe(true);
    await refused.waitForExist({ reverse: true });
    await expectCleanConsole();
  });

  it("turns restore off and starts fresh from Settings, saying the kept copies remain", async () => {
    await start({ read_workspace_restore: read([], 0, 2) });
    await browser.$("[data-settings-entry]").click();
    const copies = browser.$('[data-restore-settings="leftovers"]');
    await copies.waitForExist();
    expect(await copies.getText()).toContain("2 kept-aside copies remain");
    await browser.execute(() => document.querySelector("[data-restore-settings-clear]")?.scrollIntoView());
    await browser.$("[data-restore-settings-clear]").click();
    await browser.waitUntil(async () => (await calls("clear_workspace_restore")).length === 1);
    await setInvokeResult("read_workspace_restore", { outcome: "off", leftoverCopies: 2 });
    await browser.$('[role="radio"]:has([data-setting-value="restore-off"])').click();
    await browser.waitUntil(async () => (await calls("set_workspace_restore_enabled")).length === 1);
    expect((await calls("set_workspace_restore_enabled"))[0]?.args["enabled"]).toBe(false);
    await browser.waitUntil(async () => (await browser.$('[role="radio"]:has([data-setting-value="restore-off"])').getAttribute("aria-checked")) === "true");
    expect(await copies.getText()).toContain("2 kept-aside copies remain");
    await expectCleanConsole();
  });

  it("says when a turned-off record's clear found another window's write", async () => {
    await start({ read_workspace_restore: read([], 0, 0), clear_workspace_restore: { outcome: "turnedOff", problem: "changedElsewhere" } });
    await browser.$("[data-settings-entry]").click();
    await browser.$("[data-restore-settings-clear]").waitForExist();
    await setInvokeResult("read_workspace_restore", { outcome: "off", leftoverCopies: 0 });
    await browser.execute(() => document.querySelector("[data-restore-settings-clear]")?.scrollIntoView());
    await browser.$("[data-restore-settings-clear]").click();
    const problem = browser.$('[data-restore-settings="problem"]');
    await problem.waitForExist();
    expect(await problem.getText()).toContain(en.restoreTurnedOff);
    await expectCleanConsole();
  });

  it("fits a long marked list in the narrow window, without moving the page sideways", async () => {
    const many = read(Array.from({ length: 40 }, (_, index) => row(index, `long_acquisition_name_for_a_narrow_window_${String(index)}.raw`, "missing")));
    await start({ read_workspace_restore: many }, [], [], [960, 640]);
    await browser.$("[data-restored-row]").waitForDisplayed();
    const overflow = await horizontalOverflow();
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);
    const stack = await browser.execute(() => {
      const box = document.querySelector(".shell-notices")?.getBoundingClientRect();
      const header = document.querySelector(".workbench-header")?.getBoundingClientRect();
      return { height: box?.height ?? 0, top: box?.top ?? 0, headerBottom: header?.bottom ?? 0, inner: innerHeight };
    });
    expect(stack.height).toBeLessThanOrEqual(180);
    expect(stack.top).toBeGreaterThanOrEqual(stack.headerBottom - 0.5);
    // Keyboard reach: the last row's control scrolls into view inside the stack.
    await browser.execute(() => {
      const buttons = document.querySelectorAll<HTMLElement>("[data-restore-dismiss]");
      buttons[buttons.length - 1]?.focus();
    });
    expect(await browser.execute(() => {
      const box = document.activeElement?.getBoundingClientRect();
      const stackBox = document.querySelector(".shell-notices")?.getBoundingClientRect();
      return box !== undefined && stackBox !== undefined && box.bottom <= stackBox.bottom + 0.5 && box.top >= stackBox.top - 0.5;
    })).toBe(true);
    await expectCleanConsole();
  });

  it("holds a save while a roster change is unanswered", async () => {
    await start({}, [MZML_ROW]);
    await revealRosterRow(MZML_ROW.handle);
    await holdInvoke("remove_workspace_datasets");
    await browser.$(`.grouped-roster [data-handle="${MZML_ROW.handle}"]`).click();
    await browser.$("[data-roster-list-menu]").click();
    await browser.$("[data-roster-remove]").click();
    await browser.waitUntil(async () => (await calls("remove_workspace_datasets")).length === 1);
    await browser.$(`.grouped-roster [data-handle="${MZML_ROW.handle}"] input[type="checkbox"]`).click();
    expect(await calls("save_workspace_restore")).toEqual([]);
  });
});
