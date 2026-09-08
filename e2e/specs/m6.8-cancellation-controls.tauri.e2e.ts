/**
 * M6.8: real UI -> native acquisition picker -> Rust queue -> installed
 * ProteoWizard -> a stop that lands while the provider is genuinely executing.
 * No IPC answers and no scientific fixtures are injected. The e2e build's
 * export-only seeded spectrum is unrelated to this flow and is never selected.
 *
 * Supply MSCANVAS_THERMO_FIXTURE (the approved hash-pinned FT-HCD-MSX.raw) and
 * MSCANVAS_M68_NATIVE_OUTPUT_ROOT (an existing, external task directory). The
 * suite retains its uniquely named scratch directory as evidence. It never
 * removes sources, overwrites a conversion output, or downloads a dependency.
 * No fixture environment means an explicit skip, not a claimed native pass.
 *
 * **The phase is observed, never assumed.** Nothing here sleeps to decide that
 * a conversion is under way: the suite reads Rust's own authoritative state
 * until an item reports `running`, dispatches against that exact item and
 * attempt, and retries against the next running item if the queue moved on
 * first. A stop that Rust refused is not counted as a stop.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { WorkspaceConversionState, WorkspaceConversionUpdate } from "../../apps/desktop/src/features/mzml-preview/contracts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY = resolve(HERE, "..", "..");
const FIXTURE = process.env["MSCANVAS_THERMO_FIXTURE"];
const OUTPUT_ROOT = process.env["MSCANVAS_M68_NATIVE_OUTPUT_ROOT"];
const FIXTURE_SHA256 = "b3d97b3856dd1e8dd6846d21c58b1b1824c309480908fe4c2dfabe152bd6dd7b";
const PANEL = "section.conversion-panel";
const RUNNING = `${PANEL} .conversion-running`;
const CONVERT = `${PANEL} .conversion-plan button.primary-button`;
const ROWS = 'ul.dataset-roster-list[role="listbox"] [role="option"]';
/** Enough real items that a stop has a running one to land on. */
const QUEUE_SIZE = 8;
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

runNative("M6.8 real native cancellation scopes (requires authorized fixture environment)", () => {
  let runRoot = "";
  let applicationProcessId = 0;
  let scenario = 0;
  const sourceCopies: string[] = [];
  const evidence: unknown[] = [];

  before(async () => {
    if (FIXTURE === undefined || OUTPUT_ROOT === undefined) throw new Error("Native fixture environment is required.");
    if (!isAbsolute(FIXTURE) || !isAbsolute(OUTPUT_ROOT)) throw new Error("Native fixture and output root must be absolute paths.");
    expect(sha256(FIXTURE)).toBe(FIXTURE_SHA256);
    const outputRoot = realpathSync(OUTPUT_ROOT);
    if (isWithin(realpathSync(REPOSITORY), outputRoot)) throw new Error("Native output must stay outside the repository.");
    runRoot = mkdtempSync(join(outputRoot, "m68-native-"));
    const capabilities = browser.capabilities as unknown as Record<string, unknown>;
    applicationProcessId = Number(capabilities["goog:processID"]);
    if (!Number.isSafeInteger(applicationProcessId) || applicationProcessId <= 0) throw new Error("WebDriver did not identify its application process.");
    expect(capabilities["browserName"]).toBe("webview2");
    await browser.$("button=Add files…").waitForDisplayed();
    expect(await browser.execute(() => Object.keys((window as unknown as { __mscanvasIpcTable__: object }).__mscanvasIpcTable__))).toEqual([]);
    evidence.push({ kind: "identity", binarySha256: sha256(resolve(REPOSITORY, "target/e2e/release/mscanvas-desktop.exe")), fixtureSha256: FIXTURE_SHA256, browserName: capabilities["browserName"], browserVersion: capabilities["browserVersion"], driver: capabilities["msedge"] });
    console.log(`M6.8 native evidence: ${runRoot}`);
  });

  beforeEach(async () => {
    scenario += 1;
    await browser.setWindowSize(1366, 768);
    const clear = browser.$("button=Clear list");
    if (await clear.isExisting()) {
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
    const path = join(directory, "FT-HCD-MSX.raw");
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
    await browser.$("button=Add files…").waitForEnabled({ timeout: 60_000 });
    const handler = handleDialog(applicationProcessId, "workspace-files", "choose", path);
    const [handled] = await Promise.all([handler, browser.$("button=Add files…").click()]);
    evidence.push({ kind: "native-picker", scenario, result: handled });
    expect(handled.entered).toBe(true);
    await browser.waitUntil(async () => (await browser.$$(ROWS).length) === before + 1);
  }

  /** A real queue of `QUEUE_SIZE` lawful sources, into one task-owned folder. */
  async function beginRealQueue(): Promise<string> {
    for (let index = 0; index < QUEUE_SIZE; index += 1) await add(source(index));
    const destination = join(runRoot, `scenario-${String(scenario)}`, "converted");
    mkdirSync(destination, { recursive: true });
    await browser.$(ROWS).click();
    await browser.keys(["Control", "a"]);
    await browser.$(CONVERT).waitForEnabled({ timeout: 60_000 });
    await reveal(CONVERT);
    const handler = handleDialog(applicationProcessId, "conversion-folder", "choose", destination);
    const [handled] = await Promise.all([handler, browser.$(CONVERT).click()]);
    evidence.push({ kind: "native-picker", scenario, result: handled });
    expect(handled.entered).toBe(true);
    await browser.waitUntil(async () => (await conversionState()).status === "running", {
      timeout: 60_000, timeoutMsg: "The real queue never reached running.",
    });
    return destination;
  }

  /** The item Rust says is being converted right now, with its attempt. */
  async function runningItem(): Promise<{ index: number; attempt: number; fileName: string } | null> {
    const state = await conversionState();
    if (state.status !== "running") return null;
    const index = state.queue.items.findIndex((item) => item.state === "running");
    const item = index === -1 ? undefined : state.queue.items[index];
    return item === undefined ? null : { index, attempt: item.attempts, fileName: item.fileName };
  }

  async function terminal(): Promise<Extract<WorkspaceConversionState, { status: "terminal" }>> {
    await browser.waitUntil(async () => (await conversionState()).status === "terminal", {
      timeout: 180_000, timeoutMsg: "The real queue never settled.",
    });
    const state = await conversionState();
    if (state.status !== "terminal") throw new Error("The queue no longer has its terminal result.");
    return state;
  }

  it("ends the file the provider is actually converting, and the queue carries on", async () => {
    const destination = await beginRealQueue();

    // Observed, not assumed. The control is pressed against the exact item and
    // attempt Rust reports as running; if the queue moved on first, Rust
    // refuses and this asks again about the next one. A refused request is not
    // counted as a stop.
    let stopped: { index: number; attempt: number; fileName: string } | null = null;
    const deadline = Date.now() + 120_000;
    while (stopped === null && Date.now() < deadline) {
      const current = await runningItem();
      if (current === null) break;
      const button = browser.$(RUNNING).$("button=Stop this file");
      if (!(await button.isExisting()) || !(await button.isEnabled())) continue;
      await reveal(`${RUNNING} .conversion-actions`);
      await button.click();
      await browser.waitUntil(async () => {
        const state = await conversionState();
        if (state.status === "terminal") return true;
        if (state.status === "idle") return true;
        const item = state.queue.items[current.index];
        return item !== undefined && item.state !== "running";
      }, { timeout: 60_000, timeoutMsg: "The item the stop named never left running." });
      const after = await conversionState();
      const settled = after.status === "idle" ? undefined : after.queue.items[current.index];
      if (settled !== undefined && settled.state === "cancelled") stopped = current;
    }
    expect(stopped).not.toBeNull();
    const reached = stopped as { index: number; attempt: number; fileName: string };
    evidence.push({ kind: "item-stop", scenario, reached });

    const state = await terminal();
    const item = state.queue.items[reached.index];
    expect(item?.state).toBe("cancelled");
    // The claim, in the vocabulary that keeps its three senses apart. A launched
    // attempt whose owned tree was confirmed gone -- not "nothing was launched",
    // and not an admission that the tree could not be established.
    expect(item?.cancellation?.ownedTree).toBe("confirmed_gone");
    expect(item?.cancellation?.processLaunched).toBe(true);
    expect(item?.cancellation?.terminationRequested).toBe(true);
    // The queue was never asked to stop, so it ran to its own end and later
    // items really converted.
    expect(state.reason).toBe("completed");
    expect(state.queue.cancelledCount).toBe(1);
    expect(state.queue.finalizedCount).toBeGreaterThan(0);
    expect(state.queue.notRunCount).toBe(0);
    // The session is not quarantined: a confirmed stop is not an unconfirmed one.
    const update = await browser.execute(async () => {
      const target = window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string) => Promise<WorkspaceConversionUpdate> } };
      return target.__TAURI_INTERNALS__.invoke("get_workspace_conversion_state");
    });
    expect(update.backendQuarantined).toBe(false);
    // The cancelled item wrote nothing; the finalized ones did.
    expect(existsSync(destination)).toBe(true);
    evidence.push({
      kind: "item-stop-outcome",
      scenario,
      cancellation: item?.cancellation ?? null,
      finalizedCount: state.queue.finalizedCount,
      cancelledCount: state.queue.cancelledCount,
      notRunCount: state.queue.notRunCount,
      reason: state.reason,
    });
    await browser.saveScreenshot(join(runRoot, `${String(scenario)}-item-stop.png`));
  });

  it("settles a waiting item without launching it, and keeps its place in the plan", async () => {
    await beginRealQueue();

    // The last row is waiting its turn for seconds, so this needs no race.
    const before = await conversionState();
    if (before.status !== "running") throw new Error("The queue is not running.");
    const last = before.queue.itemCount - 1;
    expect(before.queue.items[last]?.state).toBe("pending");
    const name = before.queue.items[last]?.fileName ?? "";

    const skip = browser.$(`${RUNNING} .conversion-queue-list > li:nth-child(${String(last + 1)}) .conversion-queue-skip`);
    await skip.waitForExist({ timeout: 30_000 });
    await reveal(`${RUNNING} .conversion-queue-list > li:nth-child(${String(last + 1)})`);
    await skip.click();

    await browser.waitUntil(async () => {
      const state = await conversionState();
      if (state.status === "idle") return false;
      return state.queue.items[last]?.state === "skippedByRequest";
    }, { timeout: 30_000, timeoutMsg: "The waiting item never settled as skipped." });

    const state = await terminal();
    const item = state.queue.items[last];
    expect(item?.state).toBe("skippedByRequest");
    // No process ran for it, and the plan still holds it in its own place.
    expect(item?.attempts).toBe(0);
    expect(item?.cancellation).toBeNull();
    expect(item?.fileName).toBe(name);
    expect(state.queue.itemCount).toBe(QUEUE_SIZE);
    // Counted apart from every neighbouring state, and the queue completed.
    expect(state.queue.skippedByRequestCount).toBe(1);
    expect(state.queue.notRunCount).toBe(0);
    expect(state.queue.skippedCount).toBe(0);
    expect(state.reason).toBe("completed");
    evidence.push({
      kind: "item-skip-outcome",
      scenario,
      index: last,
      attempts: item?.attempts ?? null,
      skippedByRequestCount: state.queue.skippedByRequestCount,
      finalizedCount: state.queue.finalizedCount,
      reason: state.reason,
    });
    await browser.saveScreenshot(join(runRoot, `${String(scenario)}-item-skip.png`));
  });

  it("stops the whole queue while the provider runs, and starts nothing after it", async () => {
    await beginRealQueue();

    await browser.waitUntil(async () => (await runningItem()) !== null, {
      timeout: 60_000, timeoutMsg: "No item was ever observed running.",
    });
    await reveal(`${RUNNING} .conversion-actions`);
    await browser.$(RUNNING).$("button=Stop queue").click();

    const state = await terminal();
    // The whole queue ended: the attempt in flight settled, and nothing behind
    // it began.
    expect(["stopped", "stopFailed"]).toContain(state.reason);
    expect(state.queue.notRunCount).toBeGreaterThan(0);
    const attempted = state.queue.items.filter((item) => item.attempts > 0).length;
    expect(attempted).toBeLessThan(QUEUE_SIZE);
    // Whatever the stop reached says which of the three senses applies, and a
    // stop this queue could not confirm is never reported as a success.
    for (const item of state.queue.items) {
      if (item.cancellation === null) continue;
      expect(["confirmed_gone", "none_launched", "unconfirmed"]).toContain(item.cancellation.ownedTree);
      if (item.state === "cancelled") {
        expect(item.cancellation.ownedTree).not.toBe("unconfirmed");
      }
      if (item.state === "cancellationFailed") {
        expect(item.cancellation.ownedTree).toBe("unconfirmed");
      }
    }
    evidence.push({
      kind: "queue-stop-outcome",
      scenario,
      reason: state.reason,
      attempted,
      finalizedCount: state.queue.finalizedCount,
      cancelledCount: state.queue.cancelledCount,
      cancellationFailedCount: state.queue.cancellationFailedCount,
      notRunCount: state.queue.notRunCount,
    });
    await browser.saveScreenshot(join(runRoot, `${String(scenario)}-queue-stop.png`));
  });
});
