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
import { queueItem, queueOf, settledAt, shippedIntent } from "../../apps/desktop/src/test/previewFixtures";
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
const RAW_ROW = { handle: "raw-row", fileName: "QC_pool.raw", byteLength: 52_428_800, sourceKind: "thermo_raw", relativeContext: null };

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

/** The element and the keyboard's place both inside the part of Settings that scrolls. */
async function expectInSettingsBody(css: string) {
  const seen = await browser.execute((selector: string) => {
    const body = document.querySelector(".settings-dialog-body")?.getBoundingClientRect();
    const inside = (box: DOMRect | undefined) => box !== undefined && body !== undefined && box.top >= body.top - 0.5 && box.bottom <= body.bottom + 0.5;
    return { answer: inside(document.querySelector(selector)?.getBoundingClientRect()), keyboard: inside(document.activeElement?.getBoundingClientRect()) };
  }, css);
  expect(seen).toEqual({ answer: true, keyboard: true });
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
        placed: [{ handle: MZML_ROW.handle, group: 0, checked: true, added: true }],
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

  it("keeps the later writer's refusal on screen through a dismiss and a later change, and stops recording", async () => {
    await start({ read_workspace_restore: MARKED, save_workspace_restore: { outcome: "refused", problem: "changedElsewhere" } }, [MZML_ROW]);
    await browser.$("[data-restored-row]").waitForDisplayed();
    await toggleRow();
    const stopped = browser.$('[data-restore="stopped"]');
    await stopped.waitForDisplayed();
    expect(await stopped.getText()).toBe(`${en.restoreNotRecorded}\n${en.restoreProblemChangedElsewhere}`);
    expect(await browser.$("[data-restore-retry]").isExisting()).toBe(false);
    await setInvokeResult("read_workspace_restore", read(ROW_STATES.slice(1).map((state, index) => row(index + 1, `${state}.raw`, state))));
    await browser.$('[data-state="changed"] [data-restore-dismiss]').click();
    await browser.waitUntil(async () => (await browser.$$("[data-restored-row]").length) === 4);
    expect(await stopped.isDisplayed()).toBe(true);
    await browser.$(`.grouped-roster [data-handle="${MZML_ROW.handle}"] input[type="checkbox"]`).click();
    expect(await calls("save_workspace_restore")).toHaveLength(1);
    expect(await stopped.isDisplayed()).toBe(true);
    expect(await browser.$('[data-live-region="restore"]').getProperty("textContent")).toContain(en.restoreProblemChangedElsewhere);
    await expectCleanConsole();
  });

  it("keeps a failed Off and its Try again through a later save that went through", async () => {
    await start({ set_workspace_restore_enabled: { outcome: "failed", problem: "notPublished", retryable: true, temporaryLeftBehind: false } }, [MZML_ROW]);
    await browser.$("[data-settings-entry]").click();
    const off = browser.$('[role="radio"]:has([data-setting-value="restore-off"])');
    await off.waitForExist();
    await browser.execute(() => document.querySelector('[role="radio"]:has([data-setting-value="restore-off"])')?.scrollIntoView());
    await browser.waitUntil(async () => (await off.getAttribute("aria-disabled")) === null);
    await off.click();
    const inSettings = browser.$('[data-restore-settings="action"]');
    await inSettings.waitForExist();
    expect(await inSettings.getText()).toContain(en.restoreProblemNotPublished);
    await browser.keys("Escape");
    await browser.$("[data-settings-dialog]").waitForExist({ reverse: true });
    await toggleRow();
    await browser.waitUntil(async () => (await calls("save_workspace_restore")).length === 1);
    const action = browser.$('[data-restore="action"]');
    await action.waitForDisplayed();
    expect(await action.getText()).toContain(en.restoreProblemNotPublished);
    await setInvokeResult("set_workspace_restore_enabled", { outcome: "saved" });
    await setInvokeResult("read_workspace_restore", { outcome: "off", leftoverCopies: 0 });
    await browser.$('[data-restore="action"] [data-restore-retry]').click();
    await action.waitForExist({ reverse: true });
    expect((await calls("set_workspace_restore_enabled")).map(call => call.args["enabled"])).toEqual([false, false]);
    await expectCleanConsole();
  });

  it("asks a failed dismiss again on Try again, and not a save", async () => {
    await start({ read_workspace_restore: MARKED, dismiss_restored_row: { __reject: { kind: "unexpected_error", summary: "no answer", detail: null, retryable: true } } });
    await browser.$("[data-restored-row]").waitForDisplayed();
    await browser.$('[data-state="missing"] [data-restore-dismiss]').click();
    await browser.$('[data-restore="action"]').waitForDisplayed();
    await setInvokeResult("dismiss_restored_row", null);
    await setInvokeResult("read_workspace_restore", read(ROW_STATES.filter(state => state !== "missing").map(state => row(ROW_STATES.indexOf(state), `${state}.raw`, state))));
    await browser.$('[data-restore="action"] [data-restore-retry]').click();
    await browser.$('[data-restore="action"]').waitForExist({ reverse: true });
    expect((await calls("dismiss_restored_row")).map(call => call.args["handle"])).toEqual(["restored-1", "restored-1"]);
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
    await start({ read_workspace_restore: read([row(0, "QC.raw", "missing")], 0, 2) });
    await browser.$("[data-settings-entry]").click();
    const copies = browser.$('[data-restore-settings="leftovers"]');
    await copies.waitForExist();
    expect(await copies.getText()).toContain("2 kept-aside copies remain");
    await browser.execute(() => document.querySelector("[data-restore-settings-clear]")?.scrollIntoView());
    await setInvokeResult("read_workspace_restore", read([], 0, 2));
    await browser.$("[data-restore-settings-clear]").click();
    await browser.waitUntil(async () => (await calls("clear_workspace_restore")).length === 1);
    // Nothing is waiting now, so another press would only be written again at once.
    await browser.waitUntil(async () => (await browser.$("[data-restore-settings-clear]").getAttribute("aria-disabled")) === "true");
    expect(await browser.$('[data-live-region="restore"]').getProperty("textContent")).toBe(en.restoreNothingWaiting);
    await setInvokeResult("read_workspace_restore", { outcome: "off", leftoverCopies: 2 });
    await browser.$('[role="radio"]:has([data-setting-value="restore-off"])').click();
    await browser.waitUntil(async () => (await calls("set_workspace_restore_enabled")).length === 1);
    expect((await calls("set_workspace_restore_enabled"))[0]?.args["enabled"]).toBe(false);
    await browser.waitUntil(async () => (await browser.$('[role="radio"]:has([data-setting-value="restore-off"])').getAttribute("aria-checked")) === "true");
    expect(await copies.getText()).toContain("2 kept-aside copies remain");
    await expectCleanConsole();
  });

  for (const [problem, sentence] of [
    ["changedElsewhere", en.restoreTurnedOffChangedElsewhere],
    ["identityUnknown", en.restoreTurnedOffIdentityUnknown],
  ] as const) {
    it(`says a clear that found ${problem} emptied the record and turned restore off, and offers no retry`, async () => {
      await start({ read_workspace_restore: read([], 3, 0), clear_workspace_restore: { outcome: "turnedOff", problem } });
      await browser.$("[data-settings-entry]").click();
      await browser.$("[data-restore-settings-clear]").waitForExist();
      await browser.waitUntil(async () => (await browser.$("[data-restore-settings-clear]").getAttribute("aria-disabled")) === null);
      await setInvokeResult("read_workspace_restore", { outcome: "off", leftoverCopies: 0 });
      await browser.execute(() => document.querySelector("[data-restore-settings-clear]")?.scrollIntoView());
      await browser.$("[data-restore-settings-clear]").click();
      const inSettings = browser.$('[data-restore-settings="action"]');
      await inSettings.waitForExist();
      expect(await inSettings.getText()).toContain(sentence);
      await browser.keys("Escape");
      await browser.$("[data-settings-dialog]").waitForExist({ reverse: true });
      const action = browser.$('[data-restore="action"]');
      await action.waitForDisplayed();
      expect(await action.getText()).toBe(`${en.restoreTurnedOff}\n${sentence}`);
      expect(await browser.$("[data-restore-retry]").isExisting()).toBe(false);
      await browser.$('[data-restore="action"] .notice-dismiss').click();
      await action.waitForExist({ reverse: true });
      await expectCleanConsole();
    });
  }

  it("says what is happening while a dismiss and its re-read are held, on the line a refusal points at", async () => {
    await start({ read_workspace_restore: MARKED }, [], ["dismiss_restored_row"]);
    await browser.$("[data-restored-row]").waitForDisplayed();
    await holdInvoke("read_workspace_restore");
    await browser.$('[data-state="changed"] [data-restore-dismiss]').click();
    const fresh = browser.$('[data-restore="offer"] [data-restore-start-fresh]');
    const described = async () => browser.execute(() => {
      const refused = document.querySelector('[data-restore="offer"] [data-restore-start-fresh]');
      const id = refused?.getAttribute("aria-describedby");
      return { refused: refused?.getAttribute("aria-disabled") ?? null, target: id === null || id === undefined ? null : document.getElementById(id)?.textContent ?? null };
    });
    await browser.waitUntil(async () => (await fresh.getAttribute("aria-disabled")) === "true");
    expect(await described()).toEqual({ refused: "true", target: en.restoreBusy });
    await browser.$('.notice[data-restore="working"]').waitForDisplayed();
    await releaseInvokeHold("dismiss_restored_row");
    await browser.waitUntil(async () => (await calls("read_workspace_restore")).length === 2);
    expect(await described()).toEqual({ refused: "true", target: en.restoreBusy });
    expect(await browser.$('.notice[data-restore="working"]').isDisplayed()).toBe(true);
    await releaseInvokeHold("read_workspace_restore");
    await browser.$('[data-restore="working"]').waitForExist({ reverse: true });
    await browser.waitUntil(async () => (await fresh.getAttribute("aria-disabled")) === null);
    await expectCleanConsole();
  });

  it("says the rows are being added while a put-back runs, on the line its refusals point at", async () => {
    await start({ read_workspace_restore: OFFER, restore_workspace: { workspace: { roster: { datasets: [], capacity: 1024 }, outcomes: [] }, placed: [] } }, [], ["restore_workspace"]);
    const action = browser.$("[data-restore-action]");
    await action.waitForClickable();
    await action.click();
    await browser.waitUntil(async () => (await action.getAttribute("aria-disabled")) === "true");
    const said = await browser.execute(() => {
      const id = document.querySelector('[data-restore="offer"] [data-restore-start-fresh]')?.getAttribute("aria-describedby");
      return id === null || id === undefined ? null : document.getElementById(id)?.textContent ?? null;
    });
    expect(said).toBe("Adding 2 files again…");
    await releaseInvokeHold("restore_workspace");
    await browser.waitUntil(async () => (await action.getAttribute("aria-disabled")) === null);
    await expectCleanConsole();
  });

  it("says what is happening in Settings while Off is held, on the line its refusals point at", async () => {
    await start({}, [], ["set_workspace_restore_enabled"]);
    await browser.$("[data-settings-entry]").click();
    const off = browser.$('[role="radio"]:has([data-setting-value="restore-off"])');
    await off.waitForExist();
    await browser.waitUntil(async () => (await off.getAttribute("aria-disabled")) === null);
    await browser.execute(() => document.querySelector('[role="radio"]:has([data-setting-value="restore-off"])')?.scrollIntoView());
    await off.click();
    await browser.waitUntil(async () => (await off.getAttribute("aria-disabled")) === "true");
    const said = await browser.execute(() => {
      const id = document.querySelector('[role="radio"]:has([data-setting-value="restore-off"])')?.getAttribute("aria-describedby");
      return id === null || id === undefined ? null : document.getElementById(id)?.textContent ?? null;
    });
    expect(said).toBe(en.restoreBusy);
    await browser.$(".settings-storage-note[data-restore-settings=\"working\"]").waitForDisplayed();
    await releaseInvokeHold("set_workspace_restore_enabled");
    await browser.$('[data-restore-settings="working"]').waitForExist({ reverse: true });
    await expectCleanConsole();
  });

  it("says when there is nowhere to keep a record, and that line can be put away", async () => {
    await start({ read_workspace_restore: { outcome: "unavailable", problem: "rootUnresolved" } });
    const notice = browser.$('[data-restore="unavailable"]');
    await notice.waitForDisplayed();
    expect(await notice.getText()).toContain(en.restoreUnavailable);
    expect(await browser.$('[data-live-region="restore"]').getProperty("textContent")).toContain(en.restoreUnavailable);
    await browser.$('[data-restore="unavailable"] .notice-dismiss').click();
    await notice.waitForExist({ reverse: true });
    await expectCleanConsole();
  });

  it("counts the marked rows beside the offered ones", async () => {
    await start({ read_workspace_restore: MIXED });
    await browser.$("[data-restore-action]").waitForDisplayed();
    expect(await text("[data-restore-attention]")).toBe("2 files from the last session need attention.");
    expect(await browser.$('[data-live-region="restore"]').getProperty("textContent")).toBe("1 file from the last session can be added again. 2 files from the last session need attention.");
    await expectCleanConsole();
  });

  it("shows neither switch choice as made after a failed read, and says why it failed", async () => {
    await start({ read_workspace_restore: { __reject: { kind: "unexpected_error", summary: "boom", detail: null, retryable: true } } });
    await browser.$('[data-restore="read-failed"]').waitForDisplayed();
    await browser.$("[data-settings-entry]").click();
    await browser.$('[data-restore-settings="read-failed"]').waitForExist();
    for (const choice of ["restore-on", "restore-off"]) {
      expect(await browser.$(`[role="radio"]:has([data-setting-value="${choice}"])`).getAttribute("aria-checked")).toBe("false");
    }
    await expectCleanConsole();
  });

  it("keeps the keyboard on the row it was on, so a second Enter dismisses a row in view", async () => {
    const name = (index: number) => `run_${String(index).padStart(2, "0")}.raw`;
    const rows = Array.from({ length: 40 }, (_, index) => row(index, name(index), "missing"));
    await start({ read_workspace_restore: read(rows) }, [], [], [960, 640]);
    await browser.$("[data-restored-row]").waitForDisplayed();
    const focused = () => browser.execute(() => {
      const active = document.activeElement;
      const box = active?.getBoundingClientRect();
      const track = document.querySelector(".shell-notices")?.getBoundingClientRect();
      return { label: active?.getAttribute("aria-label") ?? null, inView: box !== undefined && track !== undefined && box.top >= track.top - 0.5 && box.bottom <= track.bottom + 0.5 };
    });
    await browser.execute(() => document.querySelector<HTMLElement>('[data-restored-row="restored-29"] [data-restore-dismiss]')?.focus());
    await setInvokeResult("read_workspace_restore", read(rows.filter(entry => entry.handle !== "restored-29")));
    await browser.keys("Enter");
    await browser.waitUntil(async () => (await browser.$$("[data-restored-row]").length) === 39);
    await browser.waitUntil(async () => (await focused()).label === `Dismiss ${name(30)}`);
    expect((await focused()).inView).toBe(true);
    await setInvokeResult("read_workspace_restore", read(rows.filter(entry => entry.handle !== "restored-29" && entry.handle !== "restored-30")));
    await browser.keys("Enter");
    await browser.waitUntil(async () => (await browser.$$("[data-restored-row]").length) === 38);
    expect((await calls("dismiss_restored_row")).map(call => call.args["handle"])).toEqual(["restored-29", "restored-30"]);
    await expectCleanConsole();
  });

  for (const size of [[1366, 768], [960, 640]] as const) {
    it(`shows the name and the reason beside a group name of the longest length at ${String(size[0])}x${String(size[1])}`, async () => {
      const longName = "组".repeat(120);
      await start({ read_workspace_restore: { outcome: "restored", groups: [{ name: null, rows: [] }, { name: longName, rows: [row(0, "QC_01.raw", "missing")] }], expired: 0, leftoverCopies: 0 } }, [], [], size);
      await browser.$("[data-restored-row]").waitForDisplayed();
      const widths = await browser.execute(() => {
        const width = (css: string) => document.querySelector(css)?.getBoundingClientRect().width ?? 0;
        const notice = document.querySelector<HTMLElement>('[data-restore="offer"]');
        return { name: width(".restore-marked-name"), group: width(".restore-marked-group"), reason: width(".restore-marked-reason"), client: notice?.clientWidth ?? 0, scroll: notice?.scrollWidth ?? 0 };
      });
      expect(widths.name).toBeGreaterThan(0);
      expect(widths.reason).toBeGreaterThan(0);
      expect(widths.group).toBeGreaterThan(0);
      expect(widths.scroll).toBeLessThanOrEqual(widths.client);
      const overflow = await horizontalOverflow();
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);
      await expectCleanConsole();
    });
  }

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

  /** Wholly on screen at once: each named element inside the track, and what the keyboard is on inside the track, and inside the list when it is a row. */
  async function expectOnScreen(css: readonly string[]) {
    const hidden = await browser.execute((selectors: readonly string[]) => {
      const track = document.querySelector(".shell-notices")?.getBoundingClientRect();
      const list = document.querySelector(".restore-marked")?.getBoundingClientRect();
      const inside = (box: DOMRect | undefined, within: DOMRect | undefined) => box !== undefined && within !== undefined && box.top >= within.top - 0.5 && box.bottom <= within.bottom + 0.5;
      const active = document.activeElement;
      const onARow = active?.closest(".restore-marked") !== null;
      return [
        ...selectors.filter(selector => !inside(document.querySelector(selector)?.getBoundingClientRect(), track)),
        ...(inside(active?.getBoundingClientRect(), track) && (!onARow || inside(active?.getBoundingClientRect(), list)) ? [] : [`focused: ${active?.getAttribute("aria-label") ?? active?.tagName ?? "nothing"}`]),
      ];
    }, css);
    expect(hidden).toEqual([]);
  }

  /** How many marked rows the list shows whole. */
  const wholeRows = () => browser.execute(() => {
    const list = document.querySelector(".restore-marked")?.getBoundingClientRect();
    const track = document.querySelector(".shell-notices")?.getBoundingClientRect();
    if (list === undefined || track === undefined) return 0;
    const top = Math.max(list.top, track.top) - 0.5;
    const bottom = Math.min(list.bottom, track.bottom) + 0.5;
    return [...document.querySelectorAll("[data-restored-row]")].filter(rowNode => {
      const box = rowNode.getBoundingClientRect();
      return box.top >= top && box.bottom <= bottom;
    }).length;
  });

  /** Enter on Restore workspace, and the press answered: Restore workspace is no longer busy. */
  async function pressRestoreByKeyboard() {
    await browser.execute(() => document.querySelector<HTMLElement>("[data-restore-action]")?.focus());
    await browser.keys("Enter");
    await browser.waitUntil(async () => (await browser.$("[data-restore-action]").getAttribute("aria-busy")) !== "true" && (await browser.$('[data-live-region="restore"]').getProperty("textContent")) !== "");
    expect(await browser.execute(() => document.activeElement?.hasAttribute("data-restore-action"))).toBe(true);
  }

  /** Eight of nine rows refused by a full workspace, and four more marked below the offer. */
  const PARTLY_ROWS = [...Array.from({ length: 9 }, (_, index) => row(index, `QC_${String(index)}.raw`, "matching")), ...[9, 10, 11, 12].map(index => row(index, `run_${String(index)}.raw`, "missing"))];
  const PARTLY_ANSWER = {
    workspace: {
      roster: { datasets: [MZML_ROW], capacity: 1024 },
      outcomes: [
        { outcome: "added", dataset: MZML_ROW },
        ...[1, 2, 3, 4, 5, 6, 7, 8].map(index => ({ outcome: "rejected", candidateName: `QC_${String(index)}.raw`, error: { kind: "workspace_full", summary: "The workspace is full.", detail: null, retryable: true } })),
      ],
    },
    placed: [{ handle: MZML_ROW.handle, group: 0, checked: false, added: true }],
  };

  for (const size of [[960, 640], [1366, 768]] as const) {
    const at = `at ${String(size[0])}x${String(size[1])}`;

    it(`keeps the pressed Restore workspace, Start fresh and the rows beside a put-back partly refused ${at}`, async () => {
      await start({ read_workspace_restore: read(PARTLY_ROWS), restore_workspace: PARTLY_ANSWER }, [], [], size);
      await browser.$("[data-restore-action]").waitForClickable();
      await setInvokeResult("read_workspace_restore", read(PARTLY_ROWS.slice(1)));
      await pressRestoreByKeyboard();
      await browser.$(".shell-notices > .notice-warning").waitForDisplayed();
      await expectOnScreen([".shell-notices > .notice-warning", "[data-restore-action]", '[data-restore="offer"] [data-restore-start-fresh]']);
      expect(await wholeRows()).toBeGreaterThanOrEqual(2);
      await expectCleanConsole();
    });

    it(`keeps the pressed Restore workspace, Start fresh and the rows beside a put-back refused whole ${at}`, async () => {
      const rows = [row(0, "QC_01.raw", "matching"), row(1, "QC_02.raw", "matching"), ...[2, 3, 4, 5, 6].map(index => row(index, `run_${String(index)}.raw`, "missing"))];
      await start({ read_workspace_restore: read(rows), restore_workspace: { __reject: { kind: "conversion_busy", summary: "A conversion is running.", detail: null, retryable: true } } }, [], [], size);
      await browser.$("[data-restore-action]").waitForClickable();
      await pressRestoreByKeyboard();
      await browser.$(".shell-notices > .notice-danger").waitForDisplayed();
      await expectOnScreen([".shell-notices > .notice-danger", "[data-restore-action]", '[data-restore="offer"] [data-restore-start-fresh]']);
      expect(await wholeRows()).toBeGreaterThanOrEqual(4);
      await expectCleanConsole();
    });
  }

  it("brings the pressed Restore workspace into view when three refusals pass the track's bound", async () => {
    const rejectedDismiss = { __reject: { kind: "unexpected_error", summary: "no answer", detail: null, retryable: true } };
    await start({ read_workspace_restore: read(PARTLY_ROWS), restore_workspace: PARTLY_ANSWER, save_workspace_restore: { outcome: "refused", problem: "changedElsewhere" } }, [], [], [960, 640]);
    await browser.$("[data-restored-row]").waitForDisplayed();
    await setInvokeResult("read_workspace_restore", read(PARTLY_ROWS.slice(0, -1)));
    await browser.execute(() => [...document.querySelectorAll<HTMLElement>("[data-restore-dismiss]")].at(-1)?.focus());
    await browser.keys("Enter");
    await browser.$('[data-restore="stopped"]').waitForDisplayed();
    await setInvokeResult("dismiss_restored_row", rejectedDismiss);
    await browser.execute(() => [...document.querySelectorAll<HTMLElement>("[data-restore-dismiss]")].at(-1)?.focus());
    await browser.keys("Enter");
    await browser.$('[data-restore="action"]').waitForDisplayed();
    await setInvokeResult("read_workspace_restore", read(PARTLY_ROWS.slice(1, -1)));
    await pressRestoreByKeyboard();
    await browser.$(".shell-notices > .notice-warning:not([data-restore])").waitForExist();
    await expectOnScreen(["[data-restore-action]"]);
    await expectCleanConsole();
  });

  const REFUSAL_BESIDE_THE_LIST = [[[960, 640], 5], [[1366, 768], 6]] as const;
  const named = (count: number) => Array.from({ length: count }, (_, index) => row(index, `run_${String(index)}.raw`, "missing"));
  const focusLastDismiss = () => browser.execute(() => {
    const buttons = document.querySelectorAll<HTMLElement>("[data-restore-dismiss]");
    buttons[buttons.length - 1]?.focus();
  });
  const rejected = { __reject: { kind: "unexpected_error", summary: "no answer", detail: null, retryable: true } };

  for (const [size, count] of REFUSAL_BESIDE_THE_LIST) {
    const at = `at ${String(size[0])}x${String(size[1])}`;

    it(`keeps a failed dismiss, its Try again, Start fresh and the row beside each other ${at}`, async () => {
      await start({ read_workspace_restore: read(named(count)), dismiss_restored_row: rejected }, [], [], size);
      await browser.$("[data-restored-row]").waitForDisplayed();
      await focusLastDismiss();
      await browser.keys("Enter");
      await browser.$('[data-restore="action"]').waitForDisplayed();
      await expectOnScreen(['[data-restore="action"]', '[data-restore="action"] [data-restore-retry]', '[data-restore="offer"] [data-restore-start-fresh]']);
      await expectCleanConsole();
    });

    it(`says what is happening beside the row a held dismiss is on ${at}`, async () => {
      await start({ read_workspace_restore: read(named(count)) }, [], ["dismiss_restored_row"], size);
      await browser.$("[data-restored-row]").waitForDisplayed();
      await focusLastDismiss();
      await browser.keys("Enter");
      await browser.$('.notice[data-restore="working"]').waitForDisplayed();
      await expectOnScreen(['.notice[data-restore="working"]', '[data-restore="offer"] [data-restore-start-fresh]']);
      await releaseInvokeHold("dismiss_restored_row");
      await expectCleanConsole();
    });

    it(`keeps the later writer's refusal beside the row a dismiss left the keyboard on ${at}`, async () => {
      const rows = named(count);
      await start({ read_workspace_restore: read(rows), save_workspace_restore: { outcome: "refused", problem: "changedElsewhere" } }, [], [], size);
      await browser.$("[data-restored-row]").waitForDisplayed();
      await setInvokeResult("read_workspace_restore", read(rows.slice(0, -1)));
      await focusLastDismiss();
      await browser.keys("Enter");
      await browser.$('[data-restore="stopped"]').waitForDisplayed();
      await expectOnScreen(['[data-restore="stopped"]', '[data-restore="offer"] [data-restore-start-fresh]']);
      await expectCleanConsole();
    });

    it(`keeps two refusals and the row on screen together ${at}`, async () => {
      const rows = named(count);
      await start({ read_workspace_restore: read(rows), save_workspace_restore: { outcome: "refused", problem: "changedElsewhere" } }, [], [], size);
      await browser.$("[data-restored-row]").waitForDisplayed();
      await setInvokeResult("read_workspace_restore", read(rows.slice(0, -1)));
      await focusLastDismiss();
      await browser.keys("Enter");
      await browser.$('[data-restore="stopped"]').waitForDisplayed();
      await setInvokeResult("dismiss_restored_row", rejected);
      await focusLastDismiss();
      await browser.keys("Enter");
      await browser.$('[data-restore="action"]').waitForDisplayed();
      await expectOnScreen(['[data-restore="stopped"]', '[data-restore="action"]', '[data-restore="action"] [data-restore-retry]']);
      await expectCleanConsole();
    });
  }

  it("shows the rows a too-many-rows choice is about, beside Start fresh, in the narrow window", async () => {
    await start({ read_workspace_restore: read(named(5)), save_workspace_restore: { outcome: "refused", problem: "tooManyRows" } }, [MZML_ROW], [], [960, 640]);
    await browser.$("[data-restored-row]").waitForDisplayed();
    await toggleRow();
    await browser.$('[data-restore="problem"]').waitForDisplayed();
    const shown = await browser.execute(() => {
      const list = document.querySelector(".restore-marked")?.getBoundingClientRect();
      const track = document.querySelector(".shell-notices")?.getBoundingClientRect();
      const inside = (box: DOMRect | undefined, within: DOMRect | undefined) => box !== undefined && within !== undefined && box.top >= within.top - 0.5 && box.bottom <= within.bottom + 0.5;
      return {
        rows: [...document.querySelectorAll("[data-restored-row]")].filter(entry => inside(entry.getBoundingClientRect(), list) && inside(entry.getBoundingClientRect(), track)).length,
        fresh: inside(document.querySelector('[data-restore="offer"] [data-restore-start-fresh]')?.getBoundingClientRect(), track),
      };
    });
    expect(shown).toEqual({ rows: 5, fresh: true });
    await expectCleanConsole();
  });

  it("answers the switch in view in the narrow window, with the keyboard still on it", async () => {
    await start({ set_workspace_restore_enabled: { outcome: "failed", problem: "notPublished", retryable: true, temporaryLeftBehind: false } }, [], [], [960, 640]);
    await browser.$("[data-settings-entry]").click();
    const off = browser.$('[role="radio"]:has([data-setting-value="restore-off"])');
    await off.waitForExist();
    await browser.waitUntil(async () => (await off.getAttribute("aria-disabled")) === null);
    await browser.execute(() => document.querySelector<HTMLElement>('[role="radio"]:has([data-setting-value="restore-off"])')?.focus());
    await browser.keys("Enter");
    await browser.$('[data-restore-settings="action"]').waitForExist();
    await expectInSettingsBody('[data-restore-settings="action"]');
    expect(await browser.execute(() => document.activeElement?.querySelector("[data-setting-value]")?.getAttribute("data-setting-value"))).toBe("restore-off");
    await expectCleanConsole();
  });

  it("shows why the switch is refused when the keyboard reaches it in the narrow window", async () => {
    await start({ read_workspace_restore: { outcome: "refused", problem: "unreadable", leftoverCopies: 0 } }, [], [], [960, 640]);
    await browser.$("[data-settings-entry]").click();
    await browser.$('[data-restore-settings="refused"]').waitForExist();
    await browser.execute(() => document.querySelector<HTMLElement>('[role="radio"]:has([data-setting-value="restore-off"])')?.focus());
    await expectInSettingsBody('[data-restore-settings="refused"]');
    await expectCleanConsole();
  });

  it("offers Start fresh in the refusal when too many rows leave nothing else to press", async () => {
    await start({ save_workspace_restore: { outcome: "refused", problem: "tooManyRows" } }, [MZML_ROW]);
    await toggleRow();
    await browser.$('[data-restore="problem"] [data-restore-start-fresh]').waitForDisplayed();
    await setInvokeResult("save_workspace_restore", { outcome: "saved" });
    await browser.$('[data-restore="problem"] [data-restore-start-fresh]').click();
    await browser.$('[data-restore="problem"]').waitForExist({ reverse: true });
    expect(await calls("clear_workspace_restore")).toHaveLength(1);
    await expectCleanConsole();
  });

  it("keeps the offer when the workspace refuses a put-back, shows why and says it", async () => {
    await start({ read_workspace_restore: OFFER, restore_workspace: { __reject: { kind: "conversion_busy", summary: "A conversion is running.", detail: null, retryable: true } } });
    const action = browser.$("[data-restore-action]");
    await action.waitForClickable();
    await action.click();
    await browser.$(".shell-notices > .notice-danger").waitForDisplayed();
    expect(await action.isDisplayed()).toBe(true);
    expect(await browser.$('[data-live-region="restore"]').getProperty("textContent")).toBe("The workspace could not be changed. A conversion is running.");
    await expectCleanConsole();
  });

  it("is refused with the conversion's reason while a conversion runs", async () => {
    await start({
      read_workspace_restore: OFFER,
      get_workspace_conversion_state: {
        sequence: 1,
        state: { status: "running", operationId: "wsp-010", queue: queueOf([queueItem(MZML_ROW.handle, MZML_ROW.fileName, { state: "running", attempts: 1 })]) },
        diagnostics: { eligibleItemCount: 0, available: false, exporting: false, lastExport: null },
        backendQuarantined: false,
        authority: settledAt(1, 1),
      },
    }, [MZML_ROW]);
    await browser.$("[data-restore-action]").waitForDisplayed();
    await browser.waitUntil(async () => (await browser.$("#restore-reason").isExisting()) && (await text("#restore-reason")) === en.shellConversionRunning);
    expect(await browser.$("[data-restore-action]").getAttribute("aria-disabled")).toBe("true");
    await browser.$("[data-restore-action]").click();
    expect(await calls("restore_workspace")).toEqual([]);
    await expectCleanConsole();
  });

  it("is refused with the view's reason while a view runs, and the refusal lifts when it ends", async () => {
    const running = {
      state: "running", operation: 1, handle: RAW_ROW.handle, fileName: RAW_ROW.fileName, phase: "converting", elapsedMs: 12_000,
      bytesRead: null, bytesTotal: null, intentId: shippedIntent.id, unverifiedBuildRelease: null, cachedCopyDamaged: false,
    };
    await start({ read_workspace_restore: OFFER, get_raw_view_state: { state: running, availability: { available: false, code: "raw_view_busy" } } }, [RAW_ROW]);
    const action = browser.$("[data-restore-action]");
    await action.waitForDisplayed();
    await browser.waitUntil(async () => (await browser.$("#restore-reason").isExisting()) && (await text("#restore-reason")) === en.rawViewBusy.replace("{{name}}", RAW_ROW.fileName));
    expect(await action.getAttribute("aria-disabled")).toBe("true");
    expect(await action.getAttribute("aria-describedby")).toBe("restore-reason");
    await action.click();
    expect(await calls("restore_workspace")).toEqual([]);
    await setInvokeResult("get_raw_view_state", { state: { state: "idle" }, availability: { available: true, unverifiedBuildRelease: null } });
    await browser.waitUntil(async () => (await action.getAttribute("aria-disabled")) === null);
    expect(await browser.$("#restore-reason").isExisting()).toBe(false);
    await expectCleanConsole();
  });

  it("highlights a RAW row a put-back added, shows its pane and starts nothing", async () => {
    await start({
      read_workspace_restore: OFFER,
      restore_workspace: {
        workspace: { roster: { datasets: [MZML_ROW, RAW_ROW], capacity: 1024 }, outcomes: [{ outcome: "added", dataset: RAW_ROW }] },
        placed: [{ handle: RAW_ROW.handle, group: 0, checked: true, added: true }],
      },
    }, [MZML_ROW]);
    const action = browser.$("[data-restore-action]");
    await action.waitForClickable();
    await setInvokeResult("read_workspace_restore", FIRST_RUN);
    await action.click();
    await browser.$(`[data-raw-view-pane="${RAW_ROW.handle}"]`).waitForExist();
    expect(await browser.$(`.grouped-roster [data-handle="${RAW_ROW.handle}"]`).getAttribute("aria-selected")).toBe("true");
    expect(await calls("begin_raw_view")).toEqual([]);
    expect(await calls("open_raw_view")).toEqual([]);
    expect(await calls("open_mzml_preview")).toEqual([]);
    await expectCleanConsole();
  });

  it("gives the next Enter nothing to forget after Restore workspace leaves the marked rows", async () => {
    await start({
      read_workspace_restore: MIXED,
      restore_workspace: {
        workspace: { roster: { datasets: [MZML_ROW], capacity: 1024 }, outcomes: [{ outcome: "added", dataset: MZML_ROW }] },
        placed: [{ handle: MZML_ROW.handle, group: 0, checked: false, added: true }],
      },
    });
    await browser.$("[data-restore-action]").waitForClickable();
    await setInvokeResult("read_workspace_restore", read([row(1, "QC.raw", "missing", { context: "batch-1" }), row(2, "QC.raw", "changed", { context: "batch-2" })]));
    await browser.execute(() => document.querySelector<HTMLElement>("[data-restore-action]")?.focus());
    await browser.keys("Enter");
    await browser.$("[data-restore-action]").waitForExist({ reverse: true });
    await browser.waitUntil(async () => browser.execute(() => document.activeElement?.getAttribute("data-restore") === "offer"));
    // The keyboard's place shows whole: the marked rows sit flush under the offer.
    expect(await browser.execute(() => {
      const offer = document.querySelector('[data-restore="offer"]');
      const list = document.querySelector(".restore-marked");
      if (offer === null || list === null) return null;
      const ring = getComputedStyle(offer);
      return { visible: offer.matches(":focus-visible"), clear: offer.getBoundingClientRect().bottom + parseFloat(ring.outlineOffset) + parseFloat(ring.outlineWidth) <= list.getBoundingClientRect().top + 0.5 };
    })).toEqual({ visible: true, clear: true });
    await browser.keys("Enter");
    expect(await calls("dismiss_restored_row")).toEqual([]);
    await browser.keys("Tab");
    expect(await browser.execute(() => document.activeElement?.hasAttribute("data-restore-start-fresh"))).toBe(true);
    await expectCleanConsole();
  });

  for (const size of [[960, 640], [1366, 768]] as const) {
    it(`keeps the first marked row's whole focus ring in the list at ${String(size[0])}x${String(size[1])}`, async () => {
      await start({ read_workspace_restore: MARKED }, [], [], size);
      await browser.$("[data-restored-row]").waitForDisplayed();
      await browser.execute(() => document.querySelector<HTMLElement>("[data-restore-dismiss]")?.focus());
      expect(await browser.execute(() => {
        const dismiss = document.querySelector("[data-restore-dismiss]");
        const next = document.querySelectorAll("[data-restore-dismiss]")[1];
        const list = document.querySelector(".restore-marked");
        if (dismiss === null || next === undefined || list === null) return null;
        const ring = getComputedStyle(dismiss);
        const reach = parseFloat(ring.outlineOffset) + parseFloat(ring.outlineWidth);
        const box = dismiss.getBoundingClientRect();
        return { visible: dismiss.matches(":focus-visible"), top: box.top - reach >= list.getBoundingClientRect().top - 0.5, bottom: box.bottom + reach <= next.getBoundingClientRect().top + 0.5 };
      })).toEqual({ visible: true, top: true, bottom: true });
      await expectCleanConsole();
    });

    it(`keeps the row the keyboard is on whole as a folder scan starts and answers at ${String(size[0])}x${String(size[1])}`, async () => {
      const answer = { roster: { datasets: [MZML_ROW], capacity: 1024 }, outcomes: [{ outcome: "added", dataset: MZML_ROW }], discovery: { complete: true, skippedReparseCount: 0, inaccessibleEntryCount: 0, limitsReached: [] } };
      await start({ read_workspace_restore: read([row(0, "QC_01.raw", "matching"), ...ROW_STATES.map((state, index) => row(index + 1, `run_${String(index)}.raw`, state))], 3), dismiss_restored_row: null, begin_mzml_folder_import: { reservationId: "restore-folder" }, choose_mzml_folder: answer }, [], ["choose_mzml_folder"], size);
      await browser.$("[data-restored-row]").waitForDisplayed();
      const keyboard = () => browser.execute(() => {
        const box = document.activeElement?.getBoundingClientRect();
        const list = document.querySelector(".restore-marked")?.getBoundingClientRect();
        const track = document.querySelector(".shell-notices")?.getBoundingClientRect();
        if (box === undefined || list === undefined || track === undefined) return null;
        return { label: document.activeElement?.getAttribute("aria-label"), whole: box.top >= Math.max(list.top, track.top) - 0.5 && box.bottom <= Math.min(list.bottom, track.bottom) + 0.5 };
      });
      await browser.execute(() => document.querySelector<HTMLElement>("[data-restore-dismiss]")?.focus());
      await browser.keys("ArrowDown");
      await browser.keys("ArrowDown");
      // Not modal for its whole length: both notices arrive with the keyboard in the list.
      await browser.waitUntil(async () => browser.execute((label: string) => {
        const button = [...document.querySelectorAll<HTMLElement>("button")].find(entry => entry.textContent === label && entry.getAttribute("aria-disabled") === null);
        button?.click();
        return button !== undefined;
      }, en.addFolder));
      await browser.waitUntil(async () => (await browser.$(".shell-notices").getText()).includes(en.folderBusy));
      expect(await keyboard()).toEqual({ label: "Dismiss run_2.raw", whole: true });
      await releaseInvokeHold("choose_mzml_folder");
      await browser.$(`[data-handle="${MZML_ROW.handle}"]`).waitForExist();
      expect(await keyboard()).toEqual({ label: "Dismiss run_2.raw", whole: true });
      await browser.keys("Enter");
      await browser.waitUntil(async () => (await calls("dismiss_restored_row")).length === 1);
      expect((await calls("dismiss_restored_row"))[0]?.args["handle"]).toBe("restored-3");
      await expectCleanConsole();
    });

    it(`keeps the stored order of groups through a put-back in two parts at ${String(size[0])}x${String(size[1])}`, async () => {
      const second = { ...MZML_ROW, handle: "file-second" };
      const stored = (a: readonly unknown[], b: readonly unknown[]) => ({ outcome: "restored", groups: [{ name: null, rows: [] }, { name: "Batch A", rows: a }, { name: "Batch B", rows: b }], expired: 0, leftoverCopies: 0 });
      const putBack = (datasets: readonly (typeof MZML_ROW)[], handle: string, group: number) => ({
        workspace: { roster: { datasets, capacity: 1024 }, outcomes: [{ outcome: "added", dataset: datasets.at(-1) }] },
        placed: [{ handle, group, checked: false, added: true }],
      });
      const saved = async () => (await calls("save_workspace_restore")).map(call => call.args["arrangement"]);
      // Batch A is on a disk that is out, and back by the time the press is answered.
      await start({ read_workspace_restore: stored([row(0, "a.raw", "missing")], [row(1, "b.raw", "matching")]), restore_workspace: putBack([MZML_ROW], MZML_ROW.handle, 2) }, [], [], size);
      await browser.$("[data-restore-action]").waitForClickable();
      await setInvokeResult("read_workspace_restore", stored([row(0, "a.raw", "matching")], []));
      await pressRestoreByKeyboard();
      await browser.waitUntil(async () => (await saved()).length === 1);
      expect(await saved()).toEqual([{ groups: [{ name: null, handles: [] }, { name: "Batch A", handles: ["restored-0"] }, { name: "Batch B", handles: [MZML_ROW.handle] }], checked: [] }]);

      await setInvokeResult("restore_workspace", putBack([MZML_ROW, second], second.handle, 1));
      await setInvokeResult("read_workspace_restore", stored([], []));
      await browser.execute(() => document.querySelector<HTMLElement>("[data-restore-action]")?.focus());
      await browser.keys("Enter");
      await browser.waitUntil(async () => (await saved()).length === 2);
      expect((await saved())[1]).toEqual({ groups: [{ name: null, handles: [] }, { name: "Batch A", handles: [second.handle] }, { name: "Batch B", handles: [MZML_ROW.handle] }], checked: [] });
      await revealRosterRow(second.handle);
      const shown = await browser.execute(() => [...document.querySelectorAll(".roster-group-header")].map(header => header.textContent).filter(name => name.includes("Batch")));
      expect(shown).toHaveLength(2);
      expect(shown[0]).toContain("Batch A");
      expect(shown[1]).toContain("Batch B");
      await expectCleanConsole();
    });
  }

  it("leaves the keyboard in the restore section after a read's Try again in Settings", async () => {
    await start({ read_workspace_restore: { __reject: { kind: "unexpected_error", summary: "boom", detail: null, retryable: true } } }, [], [], [960, 640]);
    await browser.$("[data-settings-entry]").click();
    const failed = browser.$('[data-restore-settings="read-failed"]');
    await failed.waitForExist();
    await setInvokeResult("read_workspace_restore", FIRST_RUN);
    await browser.execute(() => document.querySelector<HTMLElement>('[data-restore-settings="read-failed"] button')?.focus());
    await browser.keys("Enter");
    await failed.waitForExist({ reverse: true });
    await browser.waitUntil(async () => browser.execute(() => document.activeElement?.querySelector("[data-setting-value]")?.getAttribute("data-setting-value") === "restore-on"));
    await browser.keys("Tab");
    expect(await browser.execute(() => document.activeElement?.closest(".setting-field")?.querySelector("[data-restore-settings-clear]") !== null)).toBe(true);
    await expectCleanConsole();
  });

  it("does not let the dialog's clipped box scroll: only its body does", async () => {
    await start({}, [], [], [960, 640]);
    await browser.$("[data-settings-entry]").click();
    await browser.$("[data-restore-settings-clear]").waitForExist();
    const box = await browser.execute(() => {
      const dialog = document.querySelector("[data-settings-dialog]");
      // What a centring scroll would do to it, as any scroll into view can.
      document.querySelector('[data-live-region="settings-layout"]')?.scrollIntoView({ block: "center" });
      return { scroll: dialog?.scrollHeight ?? 0, client: dialog?.clientHeight ?? 0, top: dialog?.scrollTop ?? -1 };
    });
    expect(box.scroll).toBeLessThanOrEqual(box.client);
    expect(box.top).toBe(0);
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
