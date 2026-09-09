/**
 * M6.9: real UI -> native acquisition picker -> Rust queue -> installed
 * ProteoWizard -> a real output-only completion, its manifest, and an explicit
 * adoption with a real duplicate and a real changed-output refusal.
 *
 * No IPC answers and no scientific fixtures are injected. The e2e build's
 * export-only seeded spectrum is unrelated to this flow and is never selected.
 *
 * Supply MSCANVAS_THERMO_FIXTURE (the approved hash-pinned FT-HCD-MSX.raw) and
 * MSCANVAS_M69_NATIVE_OUTPUT_ROOT (an existing, external task directory). The
 * suite retains its uniquely named scratch directory as evidence. It never
 * removes sources, overwrites a conversion output it did not write, or
 * downloads a dependency. No fixture environment means an explicit skip, not a
 * claimed native pass.
 *
 * **The changed-output case modifies a file this suite itself made**, inside
 * its own scratch directory, after MSCanvas finalized it. No source and no
 * pre-existing target is touched, and every source copy's digest is re-checked
 * after every scenario.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { WorkspaceConversionState, WorkspaceConversionUpdate } from "../../apps/desktop/src/features/mzml-preview/contracts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY = resolve(HERE, "..", "..");
const FIXTURE = process.env["MSCANVAS_THERMO_FIXTURE"];
const OUTPUT_ROOT = process.env["MSCANVAS_M69_NATIVE_OUTPUT_ROOT"];
const FIXTURE_SHA256 = "b3d97b3856dd1e8dd6846d21c58b1b1824c309480908fe4c2dfabe152bd6dd7b";
const PANEL = "section.conversion-panel";
const RUNNING = `${PANEL} .conversion-running`;
const LIST = `${RUNNING} .conversion-queue-list`;
const CONVERT = `${PANEL} .conversion-plan button.primary-button`;
const ADOPT = `${PANEL} .conversion-adoption button`;
const ROWS = 'ul.dataset-roster-list[role="listbox"] [role="option"]';
const QUEUE_SIZE = 2;
const runNative = FIXTURE !== undefined && OUTPUT_ROOT !== undefined ? describe : describe.skip;

interface DialogResult {
  readonly found: boolean;
  readonly entered: boolean;
  readonly invoked: boolean;
  readonly closed: boolean;
  readonly method: string;
  readonly detail: string;
}

interface Call { readonly command: string; readonly args: Record<string, unknown> }

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function isWithin(root: string, path: string): boolean {
  const suffix = relative(root, path);
  return suffix === "" || (!suffix.startsWith("..") && !isAbsolute(suffix));
}

async function calls(): Promise<Call[]> {
  return browser.execute(() => (window as unknown as { __mscanvasIpcCalls__: Call[] }).__mscanvasIpcCalls__);
}

/** A read-only production command; mutations always start at rendered controls. */
async function conversionState(): Promise<WorkspaceConversionState> {
  const update = await browser.execute(async () => {
    const target = window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string) => Promise<WorkspaceConversionUpdate> } };
    return target.__TAURI_INTERNALS__.invoke("get_workspace_conversion_state");
  });
  return update.state;
}

function handleDialog(applicationProcessId: number, kind: "workspace-files" | "conversion-folder", action: "choose" | "cancel" | "escape", path?: string, timeoutSeconds = 60): Promise<DialogResult> {
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolve(HERE, "..", "native", `choose-${kind}.ps1`), "-ApplicationProcessId", String(applicationProcessId), "-Action", action, "-TimeoutSeconds", String(timeoutSeconds)];
  if (path !== undefined) args.push("-Path", path);
  const child = spawn("powershell.exe", args, { windowsHide: true });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  return new Promise((settle, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error("The owned native picker helper exceeded its bounded lifetime.")); }, (timeoutSeconds + 25) * 1000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      try {
        const result = JSON.parse(stdout.trim()) as DialogResult;
        if (code !== 0 || !result.closed) throw new Error(`Native ${kind} ${action} failed: ${result.detail}`);
        settle(result);
      } catch (error) {
        reject(new Error(`Native helper failed (${String(code)}): ${String(error)} ${stderr}`));
      }
    });
  });
}

runNative("M6.9 real native output completion and adoption (requires authorized fixture environment)", () => {
  let runRoot = "";
  let applicationProcessId = 0;
  let scenario = 0;
  let sourceIndex = 0;
  const sourceCopies: string[] = [];
  const evidence: unknown[] = [];

  before(async () => {
    if (FIXTURE === undefined || OUTPUT_ROOT === undefined) throw new Error("Native fixture environment is required.");
    if (!isAbsolute(FIXTURE) || !isAbsolute(OUTPUT_ROOT)) throw new Error("Native fixture and output root must be absolute paths.");
    expect(sha256(FIXTURE)).toBe(FIXTURE_SHA256);
    const outputRoot = realpathSync(OUTPUT_ROOT);
    if (isWithin(realpathSync(REPOSITORY), outputRoot)) throw new Error("Native output must stay outside the repository.");
    runRoot = mkdtempSync(join(outputRoot, "m69-native-"));
    const capabilities = browser.capabilities as unknown as Record<string, unknown>;
    applicationProcessId = Number(capabilities["goog:processID"]);
    if (!Number.isSafeInteger(applicationProcessId) || applicationProcessId <= 0) throw new Error("WebDriver did not identify its application process.");
    expect(capabilities["browserName"]).toBe("webview2");
    await browser.$("button=Add files…").waitForDisplayed();
    expect(await browser.execute(() => Object.keys((window as unknown as { __mscanvasIpcTable__: object }).__mscanvasIpcTable__))).toEqual([]);
    evidence.push({ kind: "identity", binarySha256: sha256(resolve(REPOSITORY, "target/e2e/release/mscanvas-desktop.exe")), fixtureSha256: FIXTURE_SHA256, browserName: capabilities["browserName"], browserVersion: capabilities["browserVersion"], driver: capabilities["msedge"] });
    console.log(`M6.9 native evidence: ${runRoot}`);
  });

  beforeEach(async () => {
    scenario += 1;
    await browser.setWindowSize(1366, 768);
    await browser.waitUntil(async () => (await conversionState()).status !== "running", {
      timeout: 180_000, timeoutMsg: "A previous scenario's queue never settled.",
    });
    const clear = browser.$("button=Clear list");
    if (await clear.isExisting()) {
      await clear.scrollIntoView({ block: "center" });
      await clear.waitForClickable({ timeout: 30_000 });
      await clear.click();
      await browser.waitUntil(async () => (await browser.$$(ROWS).length) === 0);
    }
  });

  afterEach(async () => {
    if (runRoot !== "") {
      for (const source of sourceCopies) expect(sha256(source)).toBe(FIXTURE_SHA256);
      if (FIXTURE !== undefined) expect(sha256(FIXTURE)).toBe(FIXTURE_SHA256);
      evidence.push({ kind: "scenario", scenario, state: await conversionState(), calls: await calls() });
      const consoleEntries = await browser.execute(() => (window as unknown as { __mscanvasConsole__: unknown[] }).__mscanvasConsole__);
      evidence.push({ kind: "console", scenario, entries: consoleEntries });
      writeFileSync(join(runRoot, "evidence.json"), JSON.stringify(evidence, null, 2));
      expect(consoleEntries).toEqual([]);
      expect(await browser.execute(() => Object.keys((window as unknown as { __mscanvasIpcTable__: object }).__mscanvasIpcTable__))).toEqual([]);
    }
  });

  function source(index: number): string {
    if (FIXTURE === undefined) throw new Error("The authorized fixture is absent.");
    const directory = join(runRoot, `scenario-${String(scenario)}`, `source-${String(index)}`);
    mkdirSync(directory, { recursive: true });
    const path = join(directory, `FT-HCD-MSX-${String(index)}.raw`);
    copyFileSync(FIXTURE, path);
    sourceCopies.push(path);
    return path;
  }

  async function reveal(selector: string): Promise<void> {
    await browser.execute((target: string) => {
      document.querySelector(target)?.scrollIntoView({ block: "center", inline: "nearest" });
    }, selector);
  }

  async function add(path: string): Promise<void> {
    const before = await browser.$$(ROWS).length;
    const addButton = browser.$("button=Add files…");
    await addButton.waitForEnabled({ timeout: 60_000 });
    await browser.waitUntil(async () => {
      await browser.execute(() => { window.scrollTo(0, 0); });
      await addButton.scrollIntoView({ block: "center" });
      return addButton.isClickable();
    }, { timeout: 60_000, timeoutMsg: "Add files… never became reachable." });
    const handler = handleDialog(applicationProcessId, "workspace-files", "choose", path);
    const [handled] = await Promise.all([handler, addButton.click()]);
    evidence.push({ kind: "native-picker", scenario, result: handled });
    expect(handled.entered).toBe(true);
    await browser.waitUntil(async () => (await browser.$$(ROWS).length) === before + 1);
  }

  /** A real queue of lawful sources, into one task-owned folder. */
  async function convertRealQueue(): Promise<string> {
    for (let index = 0; index < QUEUE_SIZE; index += 1) await add(source(sourceIndex + index));
    const destination = join(runRoot, `scenario-${String(scenario)}`, `converted-${String(sourceIndex)}`);
    mkdirSync(destination, { recursive: true });
    await browser.$(ROWS).click();
    await browser.keys(["Control", "a"]);
    await browser.$(CONVERT).waitForEnabled({ timeout: 60_000 });
    await reveal(CONVERT);
    const handler = handleDialog(applicationProcessId, "conversion-folder", "choose", destination);
    const [handled] = await Promise.all([handler, browser.$(CONVERT).click()]);
    evidence.push({ kind: "native-picker", scenario, result: handled });
    expect(handled.entered).toBe(true);
    await browser.waitUntil(async () => (await conversionState()).status === "terminal", {
      timeout: 240_000, timeoutMsg: "The real queue never settled.",
    });
    sourceIndex += QUEUE_SIZE;
    return destination;
  }

  async function terminal(): Promise<Extract<WorkspaceConversionState, { status: "terminal" }>> {
    const state = await conversionState();
    if (state.status !== "terminal") throw new Error("The queue no longer has its terminal result.");
    return state;
  }

  /** Opens one row's detail disclosure and returns its rendered text. */
  async function details(index: number): Promise<string> {
    const summary = `${LIST} > li:nth-child(${index}) details > summary`;
    await reveal(summary);
    if ((await browser.$(`${LIST} > li:nth-child(${index}) details`).getAttribute("open")) === null) {
      await browser.$(summary).click();
    }
    return browser.$(`${LIST} > li:nth-child(${index}) details`).getText();
  }

  async function rosterNames(): Promise<string[]> {
    return browser.execute((selector: string) =>
      [...document.querySelectorAll(selector)].map((node) => node.querySelector(".dataset-roster-name")?.textContent ?? node.textContent ?? ""), ROWS);
  }

  it("completes output-only, shows the manifest, and adopts only when asked", async () => {
    const destination = await convertRealQueue();
    const state = await terminal();

    // A real completion, judged by the real integrity contract.
    expect(state.reason).toBe("completed");
    expect(state.queue.finalizedCount).toBe(QUEUE_SIZE);
    expect(state.queue.failedCount).toBe(0);
    const produced = readdirSync(destination).sort();
    expect(produced).toEqual(state.queue.items.map((item) => item.output.kind === "knownSingle" ? item.output.fileName : "").sort());

    for (const item of state.queue.items) {
      // 1 process: a real converter ran and exited cleanly.
      expect(item.process).toEqual({ kind: "settled", termination: "exited", exitCode: 0 });
      // 2 staged output: what it wrote took its final name.
      expect(item.staged).toEqual({ kind: "published" });
      // The identity was minted before the converter was invoked, and is opaque.
      expect(item.runIdentity).toMatch(/^[0-9a-f]{32}$/);
      // 3 finalized output, 4 integrity, measured rather than declared.
      const report = item.result?.kind === "single" ? item.result.report : null;
      expect(report?.outputFileName).not.toBeNull();
      expect(report?.output?.sha256).toMatch(/^[0-9A-Fa-f]{64}$/);
      expect(report?.validation?.mode).toBe("output_only");
      expect(report?.validation?.fullyVerified).toBe(false);
      // 5 adoption: nobody has asked, which is not a refusal.
      expect(item.adoption).toEqual({ kind: "notRequested" });
    }
    // Two attempts, two identities.
    const identities = new Set(state.queue.items.map((item) => item.runIdentity));
    expect(identities.size).toBe(QUEUE_SIZE);

    // The digest on the wire is the digest of the file on disk.
    const first = state.queue.items[0];
    const firstReport = first?.result?.kind === "single" ? first.result.report : null;
    const firstName = firstReport?.outputFileName ?? "";
    expect(sha256(join(destination, firstName)).toLowerCase())
      .toBe((firstReport?.output?.sha256 ?? "").toLowerCase());

    // The manifest is on screen, with the digest and the size.
    const shown = await details(1);
    expect(shown).toContain("What was written to the temporary working folder took its final name.");
    expect(shown).toContain("Output-only.");
    expect(shown).toContain(firstName);
    expect(shown).not.toMatch(/fully verified/i);

    // Nothing was adopted and nothing was previewed because a queue finished.
    expect(await rosterNames()).toHaveLength(QUEUE_SIZE);
    const beforeAdoption = (await calls()).filter((call) => call.command === "adopt_workspace_conversion_outputs");
    expect(beforeAdoption).toHaveLength(0);

    // **One output is changed on disk, by this suite, after MSCanvas finalized
    // it.** It is a file this run wrote inside its own scratch directory; no
    // source and no pre-existing target is touched.
    const second = state.queue.items[1];
    const secondReport = second?.result?.kind === "single" ? second.result.report : null;
    const changedName = secondReport?.outputFileName ?? "";
    const changedPath = join(destination, changedName);
    const digestBefore = sha256(changedPath);
    appendFileSync(changedPath, "\n<!-- changed by the M6.9 native suite after finalization -->\n");
    expect(sha256(changedPath)).not.toBe(digestBefore);
    evidence.push({ kind: "changed-output", scenario, name: changedName, before: digestBefore, after: sha256(changedPath) });

    await reveal(ADOPT);
    await browser.$(ADOPT).click();
    await browser.waitUntil(async () => (await browser.$(`${PANEL} .conversion-adoption-summary`).getText()).includes("added"), {
      timeout: 60_000, timeoutMsg: "The adoption never reported a result.",
    });

    // One added, one refused, and the refusal did not stop the other.
    expect(await browser.$(`${PANEL} .conversion-adoption-summary`).getText())
      .toBe("1 added, 0 already in the workspace, 1 not added.");
    expect(await browser.$(PANEL).getText()).toContain(`${changedName} was not added: changed since it was converted.`);
    expect(await rosterNames()).toHaveLength(QUEUE_SIZE + 1);

    // The rows say what the adoption did with their own outputs. Waited for:
    // the reply carries the roster, and the judgement lives on the queue, so
    // the document re-reads the slot and the row settles a round trip later.
    await browser.waitUntil(
      async () => (await details(1)).includes("When outputs were last added"),
      { timeout: 60_000, timeoutMsg: "The row never reported what the adoption did." },
    );
    const addedRow = await details(1);
    expect(addedRow).toContain("When outputs were last added: 1 added, 0 already in the workspace, 0 not added.");
    const refusedRow = await details(2);
    expect(refusedRow).toContain("When outputs were last added: 0 added, 0 already in the workspace, 1 not added.");
    expect(refusedRow).toContain("Not added because it changed since it was converted.");
    // A refusal erases neither the finalization nor what the check established.
    expect(refusedRow).toContain(`One output obtained its final name: ${changedName}.`);
    expect(refusedRow).toContain("Output-only.");

    // Nothing was previewed as a result of adopting.
    const previewed = (await calls()).filter((call) => call.command === "open_preview" || call.command === "read_preview");
    expect(previewed).toHaveLength(0);

    // **The duplicate case, for real.** Asking again reports the added output as
    // already present rather than adding it twice.
    await reveal(ADOPT);
    await browser.$(ADOPT).click();
    await browser.waitUntil(async () => (await browser.$(`${PANEL} .conversion-adoption-summary`).getText()).includes("already in the workspace"), {
      timeout: 60_000, timeoutMsg: "The repeated adoption never reported a result.",
    });
    expect(await browser.$(`${PANEL} .conversion-adoption-summary`).getText())
      .toBe("0 added, 1 already in the workspace, 1 not added.");
    expect(await rosterNames()).toHaveLength(QUEUE_SIZE + 1);
    await browser.waitUntil(
      async () =>
        (await details(1)).includes("0 added, 1 already in the workspace"),
      { timeout: 60_000, timeoutMsg: "The row never reported the repeated adoption." },
    );

    // The queue's own result is what it was: an adoption reads it and does not
    // rewrite it.
    const after = await terminal();
    expect(after.queue.finalizedCount).toBe(QUEUE_SIZE);
    expect(after.queue.items.map((item) => item.runIdentity)).toEqual(state.queue.items.map((item) => item.runIdentity));
  });
});
