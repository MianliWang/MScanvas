/**
 * WSP-010 on real Windows: the compiled `e2e` build, a real `workspace-restore.json`
 * in a root this campaign owns, real restarts and the real file picker.
 *
 * What the browser spec cannot say is here: whether a session reaches disk as a
 * document, whether another process finds it, and whether a deleted file then
 * reads as marked. The chains build on each other, so the first failure ends the
 * run.
 *
 * Run alone, on an idle desktop, with `MSCANVAS_M75_NATIVE_READY=true`, a root from
 * `createPreferenceRoot` in `MSCANVAS_E2E_PREFERENCE_ROOT` and an admitted mzML in
 * `MSCANVAS_WSP010_MZML`:
 *
 *   wdio run ./e2e/wdio.tauri.conf.ts --spec ./e2e/specs/wsp-010-restore-workspace.native.e2e.ts
 */
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PREFERENCE_ROOT_VARIABLE, requireOwnedPreferenceRoot } from "../support/m75PreferenceRoot";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROW = ".grouped-roster [data-handle]", ADD = ".roster-head [data-add-files]";
const root = requireOwnedPreferenceRoot(process.env[PREFERENCE_ROOT_VARIABLE]);
const input = process.env["MSCANVAS_WSP010_MZML"];
if (input === undefined) throw Error("MSCANVAS_WSP010_MZML must name an admitted mzML.");
const documentPath = join(root, "workspace-restore.json");
const files = mkdtempSync(join(tmpdir(), "mscanvas-wsp010-"));
const first = join(files, "first.mzML"), second = join(files, "second.mzML");

interface StoredRow { readonly checked: boolean; readonly offered: number; readonly members: readonly { readonly path: string }[] }
interface StoredDocument { readonly enabled: boolean; readonly groups: readonly { readonly name: string | null; readonly rows: readonly StoredRow[] }[] }

const stored = () => JSON.parse(readFileSync(documentPath, "utf8")) as StoredDocument;
const paths = (document: StoredDocument) => document.groups.flatMap(group => group.rows.map(row => row.members[0]?.path));
const processId = () => Number((browser.capabilities as unknown as Record<string, unknown>)["goog:processID"]);

function chooseInPicker(file: string) {
  const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolve(HERE, "../native/choose-workspace-files.ps1"),
    "-ApplicationProcessId", String(processId()), "-Action", "choose", "-Path", file, "-TimeoutSeconds", "35"], { windowsHide: true });
  return new Promise<void>((done, fail) => {
    child.once("error", fail);
    child.once("close", code => { if (code === 0) done(); else fail(Error(`The picker helper exited with ${String(code)}.`)); });
  });
}

async function add(file: string) {
  const before = await browser.$$(ROW).length;
  await browser.waitUntil(async () => (await browser.$(ADD).getAttribute("aria-disabled")) !== "true");
  await Promise.all([chooseInPicker(file), browser.$(ADD).click()]);
  await browser.waitUntil(async () => (await browser.$$(ROW).length) === before + 1);
}

/** Saves follow every change, one at a time, so a document is awaited rather than read. */
const documentSays = (holds: (document: StoredDocument) => boolean) =>
  browser.waitUntil(() => existsSync(documentPath) && holds(stored()), { timeout: 30_000, timeoutMsg: "the document never said so" });

/** Another process, another window, the same file. */
async function relaunch() {
  await browser.reloadSession();
  requireOwnedPreferenceRoot(process.env[PREFERENCE_ROOT_VARIABLE]);
  await browser.$("[data-settings-entry]").waitForDisplayed({ timeout: 90_000 });
}

describe("WSP-010 on real Windows", function () {
  this.bail(true);

  before(async () => {
    expect(existsSync(documentPath)).toBe(false);
    copyFileSync(input, first);
    copyFileSync(input, second);
    await browser.$("[data-settings-entry]").waitForDisplayed({ timeout: 90_000 });
  });

  after(() => rmSync(files, { recursive: true, force: true }));

  it("writes nothing until something changes, then records the rows, their group and their checked state", async () => {
    expect(existsSync(documentPath)).toBe(false);
    await add(first);
    await add(second);
    await documentSays(document => paths(document).length === 2);
    await browser.$("[data-roster-list-menu]").click();
    await browser.$("[data-roster-new-group]").click();
    await browser.$("#organization-group-name").setValue("Batch");
    await browser.$("button=Save group").click();
    await browser.$(".group-name-dialog").waitForExist({ reverse: true });
    // A plain click highlights a row; the list menu moves what is highlighted.
    await browser.$(ROW).click();
    await browser.$("[data-roster-list-menu]").click();
    await browser.$("[data-roster-move]").click();
    await browser.execute(() => {
      const items = [...document.querySelectorAll<HTMLElement>('.roster-menu [role="menuitem"]')];
      const batch = items.find(item => item.textContent === "Batch");
      if (batch === undefined) throw Error("Move to group does not offer Batch.");
      batch.click();
    });
    await documentSays(document => document.groups.some(group => group.name === "Batch" && group.rows.length === 1));
    await browser.$(`${ROW} input[type="checkbox"]:checked`).click();
    await documentSays(document => document.groups.some(group => group.rows.some(row => !row.checked)));
    const recorded = stored();
    expect(recorded.enabled).toBe(true);
    expect(paths(recorded).sort()).toEqual([first, second].sort());
    expect(readFileSync(documentPath, "utf8").includes(first.replaceAll("\\", "\\\\"))).toBe(true);
  });

  it("offers them at a real restart, changes nothing until asked, and puts them back on the press", async () => {
    const before = readFileSync(documentPath);
    await relaunch();
    await browser.$("[data-restore-action]").waitForDisplayed();
    expect(await browser.$$(ROW).length).toBe(0);
    expect(readFileSync(documentPath).equals(before)).toBe(true);
    await browser.$("[data-restore-action]").click();
    await browser.waitUntil(async () => (await browser.$$(ROW).length) === 2, { timeout: 60_000 });
    await browser.$("[data-restore-action]").waitForExist({ reverse: true });
    expect(await browser.$('[data-live-region="workspace"]').getProperty("textContent")).toContain("not verified against the last session");
    await documentSays(current => paths(current).length === 2 && current.groups.every(group => group.rows.every(row => row.offered === 0)));
    expect(stored().groups.some(group => group.name === "Batch" && group.rows.length === 1)).toBe(true);
    expect(await browser.$$(".roster-group-header").map(header => header.getText())).toContainEqual(expect.stringContaining("Batch"));
  });

  it("marks a deleted file rather than dropping it, and a dismiss forgets it in the document", async () => {
    await relaunch();
    await browser.$("[data-restore-action]").waitForDisplayed();
    // After the offer, when no process holds it: a restored row has no lease.
    // Restore workspace re-checks each row now, and the read after it marks this one.
    rmSync(second);
    await browser.$("[data-restore-action]").click();
    const missing = browser.$('[data-restored-row][data-state="missing"]');
    await missing.waitForDisplayed();
    await browser.$('[data-restored-row][data-state="missing"] [data-restore-dismiss]').click();
    await missing.waitForExist({ reverse: true });
    await documentSays(document => !paths(document).includes(second));
  });

  it("forgets every path when turned off, and a restart stays off and quiet", async () => {
    await browser.$("[data-settings-entry]").click();
    await browser.$('[role="radio"]:has([data-setting-value="restore-off"])').click();
    await documentSays(document => !document.enabled && paths(document).length === 0);
    await relaunch();
    expect(await browser.$("[data-restore-action]").isExisting()).toBe(false);
    expect(await browser.$("[data-restored-row]").isExisting()).toBe(false);
    expect(stored().enabled).toBe(false);
    await browser.$("[data-settings-entry]").click();
    await browser.waitUntil(async () => (await browser.$('[role="radio"]:has([data-setting-value="restore-off"])').getAttribute("aria-checked")) === "true");
  });
});
