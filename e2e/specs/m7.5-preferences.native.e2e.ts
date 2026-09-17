/**
 * M7.5 on real Windows: the compiled build, its own preference file on a real
 * filesystem, real focus, real native pickers.
 *
 * Everything the browser layer could not say is here, and only here. Whether a
 * choice reached disk is a question about bytes in a directory. Whether Cancel
 * left the file alone is a question about those bytes being the same bytes.
 * Whether the application survives being unable to save is a question the
 * filesystem has to answer, and it answers it by refusing a replacement while
 * a handle is open on the published name. None of that is observable behind a
 * mocked IPC boundary, and none of it is claimed there.
 *
 * ## The profile this runs against
 *
 * Not the operator's. `MSCANVAS_E2E_PREFERENCE_ROOT` binds a directory this
 * campaign created, and the `e2e` build resolves its preference root from that
 * variable instead of from the per-user directory -- refusing the whole session
 * if it is missing or unusable rather than falling back. Below that binding
 * nothing is substituted: the same record type, the same validation, the same
 * bounded temporary, the same handle-bound replace. It is a different root, not
 * a different store, and the run ends by showing that the real per-user record
 * still does not exist.
 *
 * ## What each chain is for
 *
 *   1. that one explicit choice becomes a file holding five allowed values and
 *      nothing else, and that a restarted application starts on it;
 *   2. that Cancel, Reset-then-Cancel, a genuinely refused write and a record
 *      this build cannot use all leave the saved file exactly as they found it,
 *      and that only an explicit replacement overwrites one;
 *   3. that the backend is explained offline in both languages, that a
 *      cancelled and an unusable folder choice both recover to the reading this
 *      host really has, and that a retained acquisition still converts through
 *      the installed ProteoWizard, opens, reads and exports -- with the
 *      exported document's keys, unit states and numbers unchanged by the
 *      interface language.
 */
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { WorkspaceConversionUpdate, WorkspaceRoster } from "../../apps/desktop/src/features/mzml-preview/contracts";
import { nativeResourceOrigins } from "../support/nativeResourceOrigins";
import {
  PREFERENCE_ROOT_VARIABLE, preferenceFile, readStoredRecord, recordViolations, replaced,
  requireOwnedPreferenceRoot, sameBytes, seedStoredBytes, type StoredRecordFacts,
} from "../support/m75PreferenceRoot";
import { en } from "../../apps/desktop/src/features/preferences/locales/en";
import { zhCN as zh } from "../../apps/desktop/src/features/preferences/locales/zh-CN";

const HERE = dirname(fileURLToPath(import.meta.url)), REPO = resolve(HERE, "../..");
const DIALOG = "[data-settings-dialog]", ENTRY = "[data-settings-entry]";
const ROSTER = '[aria-controls="workbench-roster"]', SHELL = ".workbench-shell";
const ROW = '.dataset-roster-list [role="row"][data-handle]';
const BANNER = "[data-backend-status]", HELP = "[data-backend-help]";
const PANEL = ".conversion-panel", CONVERT = PANEL + " .conversion-plan button.primary-button";
const input = process.env.MSCANVAS_M75_INPUT_ROOT;
const root = requireOwnedPreferenceRoot(process.env[PREFERENCE_ROOT_VARIABLE]);
/** The real per-user record, read only to show this campaign never made one. */
const realProfile = join(process.env.LOCALAPPDATA ?? "", "org.mscanvas.desktop", "ui-preferences.json");
const evidence: unknown[] = [];
let output = "", processId = 0, dpi = 0, launches = 0;
let viewport = { width: 1366, height: 768 };
type Rect = { left: number; top: number; right: number; bottom: number };
type Metrics = { dpi: number; mainWindow: number; foregroundProcessId: number; executable: string; bounds: { client: Rect; visibleFrameInsideWorkArea: boolean } };

function digest(path: string) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function saveEvidence() { if (output) writeFileSync(join(output, "evidence.json"), JSON.stringify(evidence, null, 2)); }
function record(value: unknown) { evidence.push(value); saveEvidence(); }
function metrics(): Metrics {
  return JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    resolve(HERE, "../native/m7.1-window-metrics.ps1"), "-ApplicationProcessId", String(processId)], { encoding: "utf8", windowsHide: true })) as Metrics;
}
function helper(script: string, args: string[], ownedWindow = true, lifetime = 60_000) {
  const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolve(HERE, "../native/" + script + ".ps1"),
    ...(ownedWindow ? ["-ApplicationProcessId", String(processId)] : []), ...args], { windowsHide: true });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += String(chunk); }); child.stderr.on("data", chunk => { stderr += String(chunk); });
  return new Promise<Record<string, unknown>>((done, fail) => {
    const timer = setTimeout(() => { child.kill(); fail(Error("Owned native helper exceeded its bounded lifetime.")); }, lifetime);
    child.once("error", error => { clearTimeout(timer); fail(error); });
    child.once("close", code => {
      clearTimeout(timer); record({ kind: "owned helper", script, args, code, stdout, stderr, helperPid: child.pid });
      try { if (code !== 0) throw Error(stdout + stderr); done(stdout.trim() ? JSON.parse(stdout.trim()) as Record<string, unknown> : {}); } catch (error) { fail(error); }
    });
  });
}

/** The published record as it is on disk right now, bytes first. */
function disk(): StoredRecordFacts { return readStoredRecord(root); }
function noted(label: string, facts = disk()) {
  record({ kind: "stored record", label, exists: facts.exists, byteLength: facts.byteLength, sha256: facts.sha256,
    modifiedMs: facts.modifiedMs, text: facts.text, entries: facts.entries, temporaries: facts.temporaries,
    violations: facts.json === null ? null : recordViolations(facts.json) });
  return facts;
}

/**
 * Holds this campaign's own preference file open until released.
 *
 * Spawned rather than awaited: the helper blocks by design, and the scenario
 * needs the application to meet the refusal while it is still in force. The
 * journal is what says the hold is actually armed -- starting the scenario on
 * the spawn alone would race, and a write that succeeded because the hold was
 * late would read as the application ignoring a failure.
 */
async function holdPreferences(label: string) {
  const journal = join(output, `hold-${label}.json`), signal = join(output, `hold-${label}.release`);
  const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
    resolve(HERE, "../native/m7.5-hold-preferences.ps1"), "-PreferenceRoot", root,
    "-Journal", journal, "-ReleaseSignal", signal, "-LifetimeSeconds", "180"], { windowsHide: true });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += String(chunk); });
  const finished = new Promise<number | null>(done => child.once("close", code => done(code)));
  await browser.waitUntil(() => {
    if (!existsSync(journal)) return false;
    return (JSON.parse(readFileSync(journal, "utf8")) as { held: boolean }).held;
  }, { timeout: 40_000, interval: 100, timeoutMsg: `The preference hold never armed. ${stderr}` });
  record({ kind: "preference hold armed", label, journal: JSON.parse(readFileSync(journal, "utf8")) as unknown });
  return {
    async release() {
      writeFileSync(signal, "release");
      expect(await finished).toBe(0);
      const final = JSON.parse(readFileSync(journal, "utf8")) as { released: boolean; expired: boolean; sha256AtHold: string; sha256AtRelease: string };
      record({ kind: "preference hold released", label, journal: final });
      expect(final).toMatchObject({ released: true, expired: false });
      // The held record is the record it was: a refused publish changed nothing.
      expect(final.sha256AtRelease).toBe(final.sha256AtHold);
    },
  };
}

async function calls() { return browser.execute(() => Reflect.get(window, "__mscanvasIpcCalls__") as { command: string; args: Record<string, unknown> }[]); }
/** Rust's own answer, asked directly, rather than read off the screen. */
async function read<T>(command: "get_workspace_conversion_state" | "get_workspace_roster"): Promise<T> {
  return browser.execute(async cmd => {
    const api = Reflect.get(window, "__TAURI_INTERNALS__") as { invoke: (command: string) => Promise<T> };
    return api.invoke(cmd);
  }, command);
}
async function conversion() { return (await read<WorkspaceConversionUpdate>("get_workspace_conversion_state")).state; }
async function roster() { return read<WorkspaceRoster>("get_workspace_roster"); }
async function saves() { return (await calls()).filter(call => call.command === "save_ui_preferences"); }
async function probes() { return (await calls()).filter(call => call.command === "inspect_backend").length; }

/** What is on screen and what is on disk, measured together. */
async function capture(label: string, validate = true) {
  const owned = metrics();
  const state = await browser.execute(() => {
    const box = (element: Element | null) => {
      if (element === null) return null;
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height,
        insideViewport: rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight + 1 && rect.right <= innerWidth + 1,
        clipped: element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1,
        text: (element.textContent ?? "").trim(), disabled: (element as HTMLButtonElement).disabled ?? null };
    };
    const shell = document.querySelector(".workbench-shell"), dialog = document.querySelector<HTMLElement>("[data-settings-dialog]");
    return {
      css: { width: innerWidth, height: innerHeight }, dpr: devicePixelRatio,
      focus: { hasFocus: document.hasFocus(), element: document.activeElement?.outerHTML?.slice(0, 400),
        action: document.activeElement?.getAttribute("data-backend-action") ?? null },
      locale: document.documentElement.lang,
      density: document.querySelector("[data-density]")?.getAttribute("data-density") ?? null,
      rosterOpen: shell?.getAttribute("data-roster-open") ?? null,
      detailsOpen: shell?.getAttribute("data-details-open") ?? null,
      backendStatus: document.querySelector("[data-backend-status]")?.getAttribute("data-backend-status") ?? null,
      backendReading: box(document.querySelector(".backend-status-reading")),
      backendActions: [...document.querySelectorAll("[data-backend-action]")].map(node => node.getAttribute("data-backend-action")),
      help: box(document.querySelector("[data-backend-help]")),
      helpOpen: document.querySelector<HTMLDetailsElement>("[data-backend-help]")?.open ?? null,
      helpFitsWithoutScrolling: (() => {
        const help = document.querySelector("[data-backend-help]"), port = help?.closest(".shell-notices") ?? null;
        if (help === null || port === null) return null;
        return help.getBoundingClientRect().bottom <= port.getBoundingClientRect().bottom + 1;
      })(),
      storageNote: box(document.querySelector("[data-storage-note]")),
      storedRecordAlert: box(document.querySelector("[data-stored-record='unusable']")),
      saveFailure: box(document.querySelector("[data-save='failed']")),
      saveRefused: box(document.querySelector("[data-save='refused']")),
      layoutReset: box(document.querySelector("[data-layout-reset]")),
      layoutUnsaved: box(document.querySelector("[data-layout-unsaved]")),
      layoutRegion: (document.querySelector("[data-live-region='layout']")?.textContent ?? "").trim(),
      preferenceRegion: (document.querySelector("[data-live-region='preferences']")?.textContent ?? "").trim(),
      inspector: box(document.querySelector(".inspector-panel")),
      dialog: dialog === null ? null : { ...box(dialog), scrollWidth: dialog.scrollWidth, clientWidth: dialog.clientWidth,
        primary: box(dialog.querySelector(".settings-dialog-actions .primary-button")) },
      bodyText: document.body.innerText, horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
      mockKeys: Object.keys(Reflect.get(window, "__mscanvasIpcTable__") as object), applicationOrigin: location.origin,
      resourceUrls: performance.getEntriesByType("resource").map(entry => entry.name),
      console: Reflect.get(window, "__mscanvasConsole__") ?? [],
      invokeWritable: Object.getOwnPropertyDescriptor(Reflect.get(window, "__TAURI_INTERNALS__"), "invoke")?.writable,
    };
  });
  const path = join(output, label + ".png"); await browser.saveScreenshot(path);
  const png = readFileSync(path), raster = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  const resources = nativeResourceOrigins(state.resourceUrls, state.applicationOrigin);
  const stored = disk();
  record({ label, owned, ...state, ...resources, raster, launches,
    stored: { exists: stored.exists, sha256: stored.sha256, byteLength: stored.byteLength, text: stored.text, temporaries: stored.temporaries },
    calls: await calls() });
  if (validate) {
    expect(owned.foregroundProcessId).toBe(processId); expect(state.focus.hasFocus).toBe(true);
    expect(owned.dpi).toBe(dpi); expect(state.dpr).toBe(dpi / 96); expect(state.css).toEqual(viewport);
    expect(owned.bounds.visibleFrameInsideWorkArea).toBe(true);
    expect(raster).toEqual({ width: owned.bounds.client.right - owned.bounds.client.left, height: owned.bounds.client.bottom - owned.bounds.client.top });
    expect(state.horizontalOverflow).toBeLessThanOrEqual(1); expect(resources.externalResources).toEqual([]);
    // Real commands, not a table the page answered for itself.
    expect(state.mockKeys).toEqual([]); expect(state.invokeWritable).toBe(false); expect(state.console).toEqual([]);
    // Nothing on screen is ever clipped out of reach.
    for (const region of [state.backendReading, state.storageNote, state.storedRecordAlert, state.saveFailure, state.saveRefused, state.layoutUnsaved]) {
      if (region !== null) expect(region.clipped).toBe(false);
    }
    if (state.dialog !== null) {
      expect(state.dialog.scrollWidth).toBeLessThanOrEqual(state.dialog.clientWidth + 1);
      expect(state.dialog.primary?.insideViewport).toBe(true);
    }
  }
  return state;
}

/**
 * Binds the newly launched process, gives it the foreground, and sizes it.
 *
 * One temporary topmost, one neutral caption click, one restore, per launched
 * process. No manual step, and no foreground rescue afterwards: a scenario that
 * needs the window activated again would be hiding something.
 */
async function establish(label: string) {
  launches += 1;
  processId = Number((browser.capabilities as unknown as Record<string, unknown>)["goog:processID"]);
  if (!Number.isSafeInteger(processId) || processId <= 0) throw Error("Missing owned application PID.");
  await browser.$(ENTRY).waitForDisplayed({ timeout: 90_000 });
  const owned = metrics(); dpi = owned.dpi;
  expect(digest(owned.executable)).toBe(process.env.MSCANVAS_M75_BINARY_SHA);
  const activation = await helper("m7.5-activate-window", []);
  expect(activation.foregroundProcessId).toBe(processId); expect(activation.topmostAfter).toBe(false);
  const available = await browser.execute(() => ({ width: screen.availWidth, height: screen.availHeight }));
  viewport = { width: Math.min(1366, Math.floor(available.width - 40)), height: Math.min(768, Math.floor(available.height - 80)) };
  if (viewport.width < 960 || viewport.height < 640) throw Error("The current monitor cannot contain the target viewport.");
  await helper("m7.1-size-window", ["-ExpectedDpi", String(dpi), "-CssWidth", String(viewport.width), "-CssHeight", String(viewport.height)]);
  record({ kind: "owned launch", label, launches, processId, mainWindow: owned.mainWindow, dpi, viewport, activation });
  await capture(label);
}

/** A real restart: another process, another window, the same file. */
async function relaunch(label: string) {
  await browser.reloadSession();
  await establish(label);
}

async function openSettings() {
  await browser.execute(entry => document.querySelector(entry)!.scrollIntoView({ block: "nearest", behavior: "instant" }), ENTRY);
  await browser.$(ENTRY).click();
  await browser.$(DIALOG).waitForDisplayed();
}
async function choose(value: string) { await browser.$(`${DIALOG} input[value="${value}"]`).click(); }
async function press(label: string) { await browser.$(DIALOG).$(`button=${label}`).click(); }
/** The dialog closed and the keyboard came back to the control that opened it. */
async function returned() {
  await browser.$(DIALOG).waitForExist({ reverse: true });
  await browser.waitUntil(() => browser.execute(entry => document.activeElement?.matches(entry) === true, ENTRY),
    { timeout: 15_000, timeoutMsg: "Settings did not return the keyboard to its own entry point." });
}

async function reveal(selector: string) {
  await browser.execute(css => document.querySelector(css)!.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" }), selector);
}

/**
 * Ticks one roster row's conversion membership, the way a person can.
 *
 * The roster is a scrollport whose rows animate in, and a click aimed at a
 * checkbox that is still moving, still partly outside that scrollport or still
 * under something else is refused by the driver -- which is what happened the
 * first time this chain ran. So the row is brought into view, the checkbox's
 * own centre is confirmed to hit the checkbox and nothing else, the row is
 * confirmed to have settled, and the click is only then sent. The state is read
 * back afterwards, because a click that lands on nothing is otherwise
 * indistinguishable from one that lands.
 */
async function pick(handle: string) {
  const row = `.dataset-roster-list [role="row"][data-handle="${handle}"]`;
  const selector = `${row} input[type="checkbox"]`;
  const checkbox = browser.$(selector);
  await checkbox.waitForDisplayed({ timeout: 30_000 });
  await reveal(row);
  const point = await browser.execute(async css => {
    const control = document.querySelector<HTMLInputElement>(css)!;
    const node = control.closest<HTMLElement>("[data-handle]")!;
    const root = control.closest<HTMLElement>(".dataset-roster-list")!;
    const before = node.getBoundingClientRect();
    await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())));
    const after = node.getBoundingClientRect(), bounds = root.getBoundingClientRect();
    const rect = control.getBoundingClientRect();
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    return {
      x, y, checked: control.checked, hit: document.elementFromPoint(x, y) === control,
      stable: Math.abs(before.top - after.top) <= 1 && Math.abs(before.bottom - after.bottom) <= 1,
      wholeRowVisible: after.top >= bounds.top - 1 && after.bottom <= bounds.bottom + 1,
    };
  }, selector);
  record({ kind: "conversion membership click target", handle, point });
  expect(point.hit).toBe(true);
  expect(point.stable).toBe(true);
  expect(point.wholeRowVisible).toBe(true);
  await checkbox.click();
  await browser.waitUntil(() => checkbox.isSelected(), { timeout: 15_000, timeoutMsg: "The membership checkbox did not take the click." });
}

/** Remembers a backend recovery action by its identity, not its label. */
async function remember(action: string) {
  await browser.execute(id => {
    const matches = [...document.querySelectorAll(`[data-backend-action="${id}"]`)];
    if (matches.length !== 1) throw Error("Expected exactly one backend action with this identity.");
    Reflect.set(window, "__m75PickerAction", id);
  }, action);
}
/**
 * The picker returned to the action that opened it, by that action's identity.
 *
 * The banner keeps one button node and relabels it, so "the same DOM element
 * has focus" would pass while the keyboard sat on a different offer. The
 * attribute is the semantic identity, and it is what is checked.
 */
async function naturalReturn(label: string) {
  try {
    await browser.waitUntil(async () => metrics().foregroundProcessId === processId && await browser.execute(() => {
      const id = Reflect.get(window, "__m75PickerAction") as string;
      return document.hasFocus() && document.activeElement?.getAttribute("data-backend-action") === id;
    }), { timeout: 20_000, interval: 500, timeoutMsg: "The native picker did not return to its initiating action." });
  } finally {
    record({ kind: "native picker return", label, owned: metrics(),
      focus: await browser.execute(() => ({ focused: document.hasFocus(), action: document.activeElement?.getAttribute("data-backend-action"), element: document.activeElement?.outerHTML?.slice(0, 300) })) });
  }
}

describe("M7.5 native preferences, first-run recovery and bilingual coverage", function () {
  this.bail(true); this.timeout(900_000);

  let profileBefore: { exists: boolean; bytes: number | null };

  before(async () => {
    if (process.env.MSCANVAS_M75_NATIVE_READY !== "true") throw Error("Fresh user M7.5 native readiness is required.");
    if (!input) throw Error("Prebuilt task-owned retained inputs are required.");
    output = mkdtempSync(join(REPO, ".tmp/m75-evidence/native-"));
    writeFileSync(join(output, "owned-run.json"), JSON.stringify({ createdUtc: new Date().toISOString(), purpose: "M7.5 authorized native campaign" }));
    profileBefore = { exists: existsSync(realProfile), bytes: existsSync(realProfile) ? statSync(realProfile).size : null };
    record({ kind: "campaign identity", sourceHead: process.env.MSCANVAS_M75_SOURCE_HEAD, binarySha256: process.env.MSCANVAS_M75_BINARY_SHA,
      harnessSha256: digest(fileURLToPath(import.meta.url)), rootIsolation: "MSCANVAS_E2E_PREFERENCE_ROOT, task-owned",
      realPerUserRecord: { path: realProfile, ...profileBefore },
      inputManifest: JSON.parse(readFileSync(join(input, "inputs.json"), "utf8")) as unknown });
    await establish("00-native-ready");
  });

  afterEach(async function () {
    try { await capture(this.currentTest?.state === "passed" ? "scenario-" + String(launches) + "-" + String(evidence.length) : "failure", false); }
    finally { saveEvidence(); }
  });

  after(() => {
    // The one thing a campaign about isolation has to end on.
    const profileAfter = { exists: existsSync(realProfile), bytes: existsSync(realProfile) ? statSync(realProfile).size : null };
    record({ kind: "real per-user record untouched", before: profileBefore, after: profileAfter });
    expect(profileAfter).toEqual(profileBefore);
    saveEvidence();
  });

  it("stores one record of allowed values only, and a restarted application starts on it", async () => {
    // Nothing stored is what a first run is, and it writes nothing to become
    // the defaults it is already showing.
    const first = noted("first run", disk());
    expect(first.exists).toBe(false);
    expect(await saves()).toEqual([]);
    const defaults = await capture("01-first-run-defaults");
    expect(defaults.locale).toBe("en");
    expect(defaults.density).toBe("comfortable");
    expect(defaults.layoutReset?.disabled).toBe(true);

    // One explicit choice, applied.
    await openSettings();
    await choose("zh-CN");
    await choose("compact");
    await capture("02-settings-draft-zh-compact");
    await press(zh.apply);
    await returned();
    const applied = await capture("03-applied-zh-compact");
    expect(applied.locale).toBe("zh-CN");
    expect(applied.density).toBe("compact");
    expect(applied.preferenceRegion).toBe(zh.applied);

    // On disk: five values, all of them allowed, and a bounded record.
    const saved = noted("after one applied choice");
    expect(saved.exists).toBe(true);
    expect(recordViolations(saved.json)).toEqual([]);
    expect(saved.json).toEqual({ schemaVersion: 1, appearance: { locale: "zh-CN", density: "compact" }, layout: { roster: "automatic", details: "automatic" } });
    expect(saved.byteLength).toBeLessThanOrEqual(16 * 1024);
    // No residue: the private sibling this write created is gone.
    expect(saved.temporaries).toEqual([]);
    expect(saved.entries).toEqual([basename(preferenceFile(root))]);

    // And the request carried the appearance group only -- no path, no name, no
    // dataset, no selection.
    const requests = await saves();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.args).toEqual({ request: { appearance: { locale: "zh-CN", density: "compact" } } });

    // A panel toggle is an immediate presentation action that commits its own
    // fields through the same store, leaving the appearance group alone.
    const wasOpen = applied.rosterOpen === "true";
    await browser.$(ROSTER).click();
    await browser.waitUntil(() => browser.execute((shell, open) => document.querySelector(shell)?.getAttribute("data-roster-open") === open, SHELL, wasOpen ? "false" : "true"));
    const layout = noted("after one panel commit");
    expect(replaced(saved, layout)).toBe(true);
    expect(layout.json).toEqual({ schemaVersion: 1, appearance: { locale: "zh-CN", density: "compact" },
      layout: { roster: wasOpen ? "hidden" : "shown", details: "automatic" } });
    const committed = await capture("04-panel-committed");
    expect(committed.layoutReset?.disabled).toBe(false);
    expect(committed.layoutUnsaved).toBeNull();
    expect((await saves()).at(-1)?.args).toEqual({ request: { layout: { roster: wasOpen ? "hidden" : "shown", details: "automatic" } } });

    // The restart. Another process, another window, the same file.
    await relaunch("05-restarted");
    await browser.waitUntil(() => browser.execute(() => document.documentElement.lang === "zh-CN"));
    const restored = await capture("06-restored-from-disk");
    expect(restored.locale).toBe("zh-CN");
    expect(restored.density).toBe("compact");
    expect(restored.rosterOpen).toBe(wasOpen ? "false" : "true");
    // Reading is not writing: startup settled on the record without rewriting
    // it, and saved nothing of its own.
    expect(sameBytes(layout, noted("after a restart"))).toBe(true);
    expect(await saves()).toEqual([]);
  });

  it("leaves the saved file exactly as it found it through Cancel, a refused write and a record it cannot use", async () => {
    const before = noted("before the untouched-file scenarios");
    expect(before.exists).toBe(true);

    // Cancel. A draft is a draft: the language previews, and nothing is written.
    await openSettings();
    await choose("en");
    const draft = await capture("07-draft-previewed-not-saved");
    expect(draft.locale).toBe("en");
    await press(en.cancel);
    await returned();
    expect(sameBytes(before, noted("after Cancel"))).toBe(true);
    expect(await browser.execute(() => document.documentElement.lang)).toBe("zh-CN");

    // Reset, then Cancel. Reset changes the draft only.
    await openSettings();
    await press(zh.reset);
    await capture("08-reset-draft-only");
    await press(en.cancel);
    await returned();
    const untouched = noted("after Reset then Cancel");
    expect(sameBytes(before, untouched)).toBe(true);
    expect(untouched.temporaries).toEqual([]);
    expect(await saves()).toEqual([]);

    // A refusal from the filesystem itself, on this campaign's own file.
    const hold = await holdPreferences("apply");
    let refused: Awaited<ReturnType<typeof capture>>;
    try {
      await openSettings();
      await choose("comfortable");
      await press(zh.apply);
      await browser.$("[data-save='failed']").waitForDisplayed({ timeout: 30_000 });
      refused = await capture("09-real-write-refusal");
      // The exact refusal, named: written, but unable to take the saved name.
      expect(refused.saveFailure?.text).toContain(zh.writeNotPublished);
      expect(refused.saveFailure?.text).not.toContain(zh.applied);
      expect(refused.storageNote?.text).toBe(zh.storageNotSaving);
      // The choices are still on screen, and the dialog is still open.
      expect(refused.dialog).not.toBeNull();
      expect(sameBytes(before, noted("during a refused write"))).toBe(true);

      // Retry, while the refusal is still in force.
      await press(zh.saveRetry);
      await browser.waitUntil(async () => (await saves()).length >= 2);
      const retried = await capture("10-retry-refused-again");
      expect(retried.saveFailure?.text).toContain(zh.writeNotPublished);
      expect(sameBytes(before, disk())).toBe(true);

      // And the session-only way out, which claims nothing about disk.
      await press(zh.saveSessionOnly);
      await returned();
      const sessionOnly = await capture("11-session-only-applied");
      expect(sessionOnly.density).toBe("comfortable");
      expect(sessionOnly.preferenceRegion).toBe(zh.sessionOnlyApplied);
      expect(sameBytes(before, noted("after using preferences for this session only"))).toBe(true);
    } finally {
      await hold.release();
    }

    // Released, and the same apply now lands. The refusal was the filesystem.
    await openSettings();
    await press(zh.apply);
    await returned();
    const persisted = noted("after the refusal was released");
    expect(replaced(before, persisted)).toBe(true);
    expect(recordViolations(persisted.json)).toEqual([]);
    expect((persisted.json as { appearance: { density: string } }).appearance.density).toBe("comfortable");

    // A record this build cannot use, written by something that is not this
    // build. A startup has to survive it and leave it alone.
    seedStoredBytes(root, JSON.stringify({ schemaVersion: 2, appearance: { locale: "zh-CN", density: "compact" }, layout: { roster: "shown", details: "shown" } }));
    const seeded = noted("a future-schema record, seeded");
    await relaunch("12-unusable-record-startup");
    const recovered = await capture("13-unusable-record-recovery");
    // Usable defaults, a reachable interface, and no spinner. The workbench
    // itself says nothing about storage -- being unable to save preferences is
    // not a reason to put a notice over someone's work -- so what it has to
    // show here is that everything is usable.
    expect(recovered.locale).toBe("en");
    expect(recovered.density).toBe("comfortable");
    expect(recovered.layoutReset?.disabled).toBe(true);
    expect(recovered.storageNote).toBeNull();
    // The account of it is in Settings, which is where it can be acted on.
    await openSettings();
    const alerted = await capture("14-unusable-record-explained");
    expect(alerted.storedRecordAlert?.text).toContain(en.storedUnsupportedVersion);
    expect(alerted.storageNote?.text).toBe(en.storageNotSaving);
    await press(en.cancel);
    await returned();
    // Reading it, starting on it and cancelling out of it all left it alone.
    expect(sameBytes(seeded, noted("after a startup that could not use it"))).toBe(true);

    // Only the explicit replacement overwrites it.
    await openSettings();
    await choose("compact");
    await press(en.storedReplace);
    await returned();
    const replacement = noted("after the confirmed replacement");
    expect(replaced(seeded, replacement)).toBe(true);
    expect(recordViolations(replacement.json)).toEqual([]);
    expect(replacement.json).toEqual({ schemaVersion: 1, appearance: { locale: "en", density: "compact" }, layout: { roster: "automatic", details: "automatic" } });
    // A replacement publishes the whole record, not just the group Settings
    // owns. Merging one group into bytes this build cannot read would mean
    // nothing, so the arrangement on screen goes with it -- and the store then
    // invalidates any layout reply still in flight, because it describes a file
    // that no longer exists.
    expect((await saves()).at(-1)?.args).toEqual({
      request: {
        appearance: { locale: "en", density: "compact" },
        layout: { roster: "automatic", details: "automatic" },
        replaceUnusable: true,
      },
    });
    const done = await capture("15-record-replaced");
    expect(done.preferenceRegion).toBe(en.storedReplaced);

    // And Settings no longer has anything to recover from: the alert is gone,
    // and the note -- which is always there, and has to agree with whatever is
    // above it -- now says the preferences are saved.
    await openSettings();
    const settled = await capture("16-recovered-state-cleared");
    expect(settled.storedRecordAlert).toBeNull();
    expect(settled.storageNote?.text).toBe(en.storageSaved);
    await press(en.cancel);
    await returned();
    expect(sameBytes(replacement, noted("after confirming the recovery cleared"))).toBe(true);
  });

  it("explains the backend offline in both languages, recovers from a cancelled and an unusable folder, and converts, reads and exports through the real provider", async () => {
    // This host has ProteoWizard installed per-user, under the `%LOCALAPPDATA%`
    // root the discovery searches, so automatic discovery names it.
    const initial = await capture("17-backend-as-this-host-is");
    record({ kind: "host backend availability", status: initial.backendStatus, actions: initial.backendActions,
      reading: initial.backendReading?.text });
    expect(initial.backendStatus).toBe("available");
    expect(initial.backendActions).toEqual(["recheck", "choose"]);

    // The help, with no data loaded and no backend configured.
    await browser.$(`${HELP} summary`).click();
    await browser.waitUntil(() => browser.execute(help => document.querySelector<HTMLDetailsElement>(help)?.open === true, HELP));
    const english = await capture("18-offline-help-en");
    expect(english.helpOpen).toBe(true);
    expect(english.helpFitsWithoutScrolling).toBe(true);
    expect(english.help?.text).toContain("Windows 11 25H2 x64");
    expect(english.help?.text).toContain(en.backendHelpProvider);
    expect(english.help?.text).toContain(en.backendHelpSessionScope);

    // The same help in Simplified Chinese, and no backend request for having
    // changed the language.
    const beforeLocale = await probes();
    await openSettings();
    await choose("zh-CN");
    await press(zh.apply);
    await returned();
    const chinese = await capture("19-offline-help-zh");
    expect(chinese.locale).toBe("zh-CN");
    expect(chinese.help?.text).toContain(zh.backendHelpProvider);
    expect(chinese.help?.text).toContain("msconvert.exe");
    expect(chinese.help?.text).toContain("Windows 11 25H2 x64");
    expect(chinese.help?.text).not.toContain(en.backendHelpProvider);
    expect(await probes()).toBe(beforeLocale);
    record({ kind: "a language change is not a backend probe", before: beforeLocale, after: await probes() });

    // A cancelled folder choice returns to the action that opened it, and asks
    // the backend nothing.
    const beforeCancel = await probes();
    await remember("choose");
    const [cancelled] = await Promise.all([
      helper("choose-workspace-files", ["-Action", "cancel", "-DialogKind", "installationFolder", "-TimeoutSeconds", "35"]),
      browser.$('[data-backend-action="choose"]').click(),
    ]);
    expect(cancelled.found).toBe(true); expect(cancelled.invoked).toBe(true);
    await naturalReturn("installation folder cancel");
    const afterCancel = await capture("20-folder-choice-cancelled");
    expect(afterCancel.backendStatus).toBe(initial.backendStatus);
    expect(await probes()).toBe(beforeCancel);

    // A folder that exists and holds no ProteoWizard: a real reading, not an
    // error, and the same chooser stays where it was.
    const empty = join(output, "a-folder-with-no-tools"); mkdirSync(empty, { recursive: true });
    await remember("choose");
    const [chosen] = await Promise.all([
      helper("choose-workspace-files", ["-Action", "choose", "-Path", empty, "-DialogKind", "installationFolder", "-TimeoutSeconds", "35"]),
      browser.$('[data-backend-action="choose"]').click(),
    ]);
    expect(chosen.invoked).toBe(true);
    await browser.waitUntil(async () => (await capture("21-unusable-folder", false)).backendStatus === "unsupported",
      { timeout: 30_000, interval: 500, timeoutMsg: "A folder with no tools in it did not read as unsupported." });
    const unsupported = await capture("22-unusable-folder-read");
    expect(unsupported.backendStatus).toBe("unsupported");
    expect(unsupported.backendActions).toContain("automatic");
    expect(unsupported.backendReading?.clipped).toBe(false);
    // The chosen folder is this session's, and nothing about it was saved.
    expect(recordViolations(disk().json)).toEqual([]);
    expect(disk().text ?? "").not.toContain(empty.replaceAll("\\", "\\\\"));
    expect(disk().text ?? "").not.toContain(basename(empty));

    // Back to automatic discovery, which returns this host's real verdict.
    await browser.$('[data-backend-action="automatic"]').click();
    await browser.waitUntil(async () => (await browser.execute(banner => document.querySelector(banner)?.getAttribute("data-backend-status"), BANNER)) === initial.backendStatus,
      { timeout: 30_000, interval: 500, timeoutMsg: "Automatic discovery did not return to this host's own verdict." });
    const rediscovered = await capture("23-rediscovered");
    expect(rediscovered.backendStatus).toBe(initial.backendStatus);

    // And the real provider path, in the Chinese session: a small retained
    // acquisition converted by the installation this host actually has, then
    // opened, read and exported.
    const raw = join(output, "sources", "M75-retained.raw");
    mkdirSync(dirname(raw), { recursive: true });
    copyFileSync(join(input!, "retained-thermo.raw"), raw);
    if (await browser.$(ROSTER).getAttribute("aria-expanded") !== "true") await browser.$(ROSTER).click();
    // Scoped to the roster, because the shell offers this action in more than
    // one place and a text match would pick whichever came first.
    const [added] = await Promise.all([
      helper("choose-workspace-files", ["-Action", "choose", "-Path", raw, "-TimeoutSeconds", "35"]),
      browser.$("#workbench-roster").$(`button=${zh.addFiles}`).click(),
    ]);
    expect(added.invoked).toBe(true);
    await browser.$(ROW).waitForDisplayed({ timeout: 60_000 });
    await browser.waitUntil(async () => (await roster()).datasets.length === 1, { timeout: 60_000 });
    const acquisition = (await roster()).datasets[0];
    if (acquisition === undefined) throw Error("The chosen acquisition is not in the roster.");
    await pick(acquisition.handle);

    await browser.$(`button=${zh.conversionTask}`).click();
    await browser.$(PANEL).waitForDisplayed();
    await browser.$(CONVERT).waitForEnabled();
    const into = join(output, "converted"); mkdirSync(into, { recursive: true });
    const [destination] = await Promise.all([
      helper("choose-conversion-folder", ["-Action", "choose", "-Path", into, "-TimeoutSeconds", "35"]),
      browser.$(CONVERT).click(),
    ]);
    expect(destination.invoked).toBe(true);
    await browser.waitUntil(async () => (await conversion()).status === "terminal", { timeout: 300_000, interval: 500, timeoutMsg: "The real conversion never reached a terminal state." });
    const converted = await conversion();
    if (converted.status !== "terminal") throw Error("No terminal conversion.");
    record({ kind: "real provider conversion in a Chinese session", state: converted });
    expect(converted.queue.finalizedCount).toBe(1);
    await capture("24-real-conversion-zh");

    // The output it produced is the mzML this leg reads.
    await browser.$(PANEL + " .conversion-adoption button").click();
    await browser.waitUntil(async () => (await roster()).datasets.length === 2, { timeout: 60_000 });
    const produced = (await roster()).datasets.find(dataset => dataset.fileName.toLowerCase().endsWith(".mzml"));
    if (produced === undefined) throw Error("The adopted provider output is not in the roster.");
    record({ kind: "adopted provider output", fileName: produced.fileName });
    const producedRow = `.dataset-roster-list [role="row"][data-handle="${produced.handle}"]`;
    await browser.$(producedRow).waitForDisplayed({ timeout: 60_000 });
    await reveal(producedRow);
    await browser.waitUntil(async () => {
      await browser.$(producedRow).doubleClick();
      return browser.$('div.spectrum-table-row[data-row-position="0"]').isDisplayed();
    }, { timeout: 120_000, interval: 2_000, timeoutMsg: "The converted mzML never opened." });
    await reveal('div.spectrum-table-row[data-row-position="0"]');
    await browser.$('div.spectrum-table-row[data-row-position="0"]').click();
    const opened = await capture("25-converted-file-open-zh");
    expect(opened.locale).toBe("zh-CN");
    expect(opened.bodyText).toContain(zh.viewerData);

    const csv = join(output, "M75-spectrum.csv");
    const label = zh.viewerExportFormat.replace("{{name}}", "CSV");
    // The spectrum's own data export. Scoped, because the chromatogram panel
    // labels its exports from the same resource.
    const [exported] = await Promise.all([
      helper("save-dialog", ["-Title", "Export spectrum data", "-Action", "save", "-Path", csv, "-TimeoutSeconds", "35"]),
      browser.$("section.spectrum-panel").$(`button=${label}`).click(),
    ]);
    expect(exported.found).toBe(true); expect(exported.invoked).toBe(true);
    await browser.waitUntil(() => existsSync(csv), { timeout: 60_000 });
    const text = readFileSync(csv, "utf8"), lines = text.split(/\r?\n/u);
    record({ kind: "real export in a Chinese session", bytes: Buffer.byteLength(text), sha256: digest(csv), head: lines.slice(0, 10) });
    // A machine export is a machine export. Its keys, its header, its
    // unreported states and its numbers are the canonical ones in either
    // language -- the interface language is not a property of this document.
    expect(lines[0]).toBe("#format,mscanvas_spectrum_export");
    expect(lines).toContain("#schema_version,1");
    expect(lines).toContain("#mz_unit,unreported");
    expect(lines).toContain("#intensity_unit,unreported");
    expect(lines).toContain("mz,intensity");
    expect(text).toMatch(/^\d+(\.\d+)?,\d+(\.\d+)?$/mu);
    expect(text).not.toMatch(/[一-鿿]/u);
    const exportedFinal = await capture("26-exported-zh");
    expect(exportedFinal.locale).toBe("zh-CN");

    // Nothing about the file, the folder or the selection is in the record.
    const final = noted("at the end of the campaign");
    expect(recordViolations(final.json)).toEqual([]);
    expect(typeof final.text).toBe("string");
    for (const secret of [raw, into, empty, output, input!]) expect(final.text ?? "").not.toContain(basename(secret));
  });
});
