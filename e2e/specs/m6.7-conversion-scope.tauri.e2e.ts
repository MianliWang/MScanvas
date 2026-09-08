/**
 * M6.7: real UI -> native acquisition picker -> Rust queue -> installed
 * ProteoWizard -> task-owned files. No IPC answers or scientific fixtures are
 * injected into the application. The e2e build's export-only seeded spectrum
 * is unrelated to this flow and is never selected.
 *
 * Supply MSCANVAS_THERMO_FIXTURE (the approved hash-pinned FT-HCD-MSX.raw) and
 * MSCANVAS_M67_NATIVE_OUTPUT_ROOT (an existing, external task directory).
 * The suite retains its uniquely named scratch directory as evidence. It never
 * removes sources, overwrites a conversion output, or downloads a dependency.
 * No fixture environment means an explicit skip, not a claimed native pass.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { DestinationPolicy, WorkspaceConversionState, WorkspaceConversionUpdate } from "../../apps/desktop/src/features/mzml-preview/contracts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY = resolve(HERE, "..", "..");
const FIXTURE = process.env["MSCANVAS_THERMO_FIXTURE"];
const OUTPUT_ROOT = process.env["MSCANVAS_M67_NATIVE_OUTPUT_ROOT"];
const FIXTURE_SHA256 = "b3d97b3856dd1e8dd6846d21c58b1b1824c309480908fe4c2dfabe152bd6dd7b";
const PANEL = "section.conversion-panel";
const CONVERT = `${PANEL} .conversion-plan button.primary-button`;
const ROWS = 'ul.dataset-roster-list[role="listbox"] [role="option"]';
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

runNative("M6.7 real native destination and conflict proof (requires authorized fixture environment)", () => {
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
    runRoot = mkdtempSync(join(outputRoot, "m67-native-"));
    const capabilities = browser.capabilities as unknown as Record<string, unknown>;
    applicationProcessId = Number(capabilities["goog:processID"]);
    if (!Number.isSafeInteger(applicationProcessId) || applicationProcessId <= 0) throw new Error("WebDriver did not identify its application process.");
    expect(capabilities["browserName"]).toBe("webview2");
    await browser.$("button=Add files…").waitForDisplayed();
    expect(await browser.execute(() => Object.keys((window as unknown as { __mscanvasIpcTable__: object }).__mscanvasIpcTable__))).toEqual([]);
    evidence.push({ kind: "identity", binarySha256: sha256(resolve(REPOSITORY, "target/e2e/release/mscanvas-desktop.exe")), fixtureSha256: FIXTURE_SHA256, browserName: capabilities["browserName"], browserVersion: capabilities["browserVersion"], driver: capabilities["msedge"] });
    console.log(`M6.7 native evidence: ${runRoot}`);
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
    // Record every scenario, including a failure. This log only contains the
    // application's path-free DTOs; acquisition bytes never enter the report.
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

  function source(parent: string, name = "FT-HCD-MSX.raw"): string {
    if (FIXTURE === undefined) throw new Error("The authorized fixture is absent.");
    const directory = join(runRoot, `scenario-${String(scenario)}`, parent);
    mkdirSync(directory, { recursive: true });
    const path = join(directory, name);
    copyFileSync(FIXTURE, path);
    sourceCopies.push(path);
    return path;
  }

  async function add(path: string): Promise<void> {
    const before = await browser.$$(ROWS).length;
    await browser.$("button=Add files…").waitForEnabled({ timeout: 60_000 });
    const handler = handleDialog(applicationProcessId, "workspace-files", "choose", path);
    const [handled] = await Promise.all([handler, browser.$("button=Add files…").click()]);
    evidence.push({ kind: "native-picker", scenario, result: handled });
    expect(handled.entered).toBe(true);
    await browser.waitUntil(async () => (await browser.$$(ROWS).length) === before + 1);
    // Admission only. A previous draft or a multi-source custom destination
    // may truthfully refuse Convert; each scenario chooses its policy below.
    await browser.$('input[name="conversion-destination-policy"]').waitForDisplayed({ timeout: 60_000 });
  }

  async function policy(kind: DestinationPolicy["kind"]): Promise<void> {
    const selector = `input[name="conversion-destination-policy"][value="${kind}"]`;
    await reveal(selector);
    await browser.$(selector).click();
  }

  async function conflict(value: "fail" | "skip"): Promise<void> {
    const selector = `input[name="conversion-conflict-policy"][value="${value}"]`;
    await reveal(selector);
    await browser.$(selector).click();
  }

  async function subfolderName(value: string): Promise<void> {
    await reveal("#conversion-subfolder-name");
    await browser.$("#conversion-subfolder-name").setValue(value);
  }

  async function selectAll(): Promise<void> {
    await reveal('input[name="conversion-scope"][value="all"]');
    await browser.$('input[name="conversion-scope"][value="all"]').click();
    await browser.$(CONVERT).waitForEnabled();
  }

  async function terminal(previousId: string | null): Promise<Extract<WorkspaceConversionState, { status: "terminal" }>> {
    await browser.waitUntil(async () => {
      const state = await conversionState();
      return state.status === "terminal" && state.operationId !== previousId;
    }, { timeout: 120_000, timeoutMsg: "The real conversion did not produce a new terminal queue." });
    const state = await conversionState();
    if (state.status !== "terminal") throw new Error("The queue no longer has its terminal result.");
    await browser.waitUntil(async () => (await browser.$(PANEL).getText()).includes(
      `${String(state.queue.finalizedCount)} converted, ${String(state.queue.skippedCount)} skipped, ${String(state.queue.failedCount)} failed of ${String(state.queue.itemCount)}.`,
    ));
    return state;
  }

  async function convert(destination?: string): Promise<Extract<WorkspaceConversionState, { status: "terminal" }>> {
    await browser.$(CONVERT).waitForEnabled();
    await reveal(CONVERT);
    const previous = await conversionState();
    const previousId = previous.status === "idle" ? null : previous.operationId;
    if (destination === undefined) {
      await browser.$(CONVERT).click();
    } else {
      const handler = handleDialog(applicationProcessId, "conversion-folder", "choose", destination);
      const [handled] = await Promise.all([handler, browser.$(CONVERT).click()]);
      evidence.push({ kind: "native-picker", scenario, result: handled });
    }
    return terminal(previousId);
  }

  function output(path: string): void {
    expect(existsSync(path)).toBe(true);
    const xml = readFileSync(path, "utf8");
    expect(xml).toMatch(/<mzML\s/u);
    expect(xml).toMatch(/<spectrumList\s+count="[1-9]\d*"/u);
    expect(xml).toContain("</mzML>");
    evidence.push({ kind: "output", name: basename(path), relativePath: relative(runRoot, path), sha256: sha256(path), bytes: Buffer.byteLength(xml) });
  }

  async function reveal(selector: string): Promise<void> {
    // WDIO's desktop scroll command wheels the window. These controls are in
    // nested scroll containers, so use the DOM's native ancestor scrolling and
    // still drive clicks/typing with WebDriver. Never alter styles or values.
    await browser.execute(async (target: string) => {
      const element = document.querySelector<HTMLElement>(target);
      if (element === null) throw new Error(`The rendered control is absent: ${target}`);
      const windowX = window.scrollX;
      const windowY = window.scrollY;
      element.scrollIntoView({ block: "center", inline: "nearest" });
      // The shell intentionally does not scroll. Native scrollIntoView can
      // still move an overflow:hidden document programmatically; preserve its
      // position while retaining the nested panel/workspace scroll offsets.
      window.scrollTo(windowX, windowY);
      await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
    }, selector);
  }

  async function snapshot(name: string): Promise<void> {
    const target = name.includes("review") ? '[aria-label="Reviewed conversion order"]' : '[aria-label="Queue destination"]';
    await reveal(target);
    await browser.saveScreenshot(join(runRoot, `${String(scenario)}-${name}.png`));
  }


  async function select(name: string, extend = false): Promise<void> {
    const matches = await browser.$$(ROWS);
    for (const item of matches) {
      if ((await item.getText()).includes(name)) {
        if (extend) await browser.action("key").down("\uE009").perform(true);
        await item.click();
        if (extend) await browser.action("key").up("\uE009").perform();
        return;
      }
    }
    throw new Error(`Workspace row not found: ${name}`);
  }

  async function reviewed(): Promise<readonly string[]> {
    await browser.$(CONVERT).waitForEnabled();
    return browser.execute(() => [...document.querySelectorAll('[aria-label="Reviewed conversion order"] .conversion-queue-name')].map((node) => node.textContent ?? ""));
  }

  async function measuredViewport(width: number, height: number): Promise<void> {
    await browser.setWindowSize(width, height);
    const actual = await browser.execute(() => ({ width: innerWidth, height: innerHeight }));
    await browser.setWindowSize(width + width - actual.width, height + height - actual.height);
    expect(await browser.execute(() => ({ width: innerWidth, height: innerHeight }))).toEqual({ width, height });
    evidence.push({ kind: "viewport", scenario, width, height });
  }

  function unrelatedOpenFormat(): string {
    const directory = join(runRoot, `scenario-${scenario}`, "unrelated-open");
    mkdirSync(directory, { recursive: true });
    const path = join(directory, "unrelated.mzML");
    writeFileSync(path, '<?xml version="1.0"?><mzML xmlns="http://psi.hupo.org/ms/mzml" version="1.1.0"><run id="unrelated"><spectrumList count="0"/></run></mzML>');
    return path;
  }

  it("converts only the selected eligible subset in reviewed order and preserves unrelated sources/targets", async () => {
    const beta = source("beta", "beta.raw");
    const unrelated = source("unrelated", "unrelated.raw");
    const alpha = source("alpha", "alpha.raw");
    const openFormat = unrelatedOpenFormat();
    for (const path of [beta, unrelated, alpha, openFormat]) await add(path);
    const untouchedTarget = join(dirname(unrelated), "unrelated.mzML");
    writeFileSync(untouchedTarget, "M6.7 unrelated existing target");
    const unchanged = [openFormat, untouchedTarget].map((path) => ({ path, hash: sha256(path) }));
    await select("beta.raw"); await select("alpha.raw", true); await select("unrelated.mzML", true);
    await policy("sourceSibling"); await conflict("fail");
    await browser.$("#dataset-roster-sort").selectByAttribute("value", "name-asc");
    await measuredViewport(1366, 768);
    expect(await reviewed()).toEqual(["alpha.raw", "beta.raw"]);
    expect(await browser.$("#conversion-scope-summary").getText()).toContain("3 requested · 2 eligible · 1 excluded");
    await snapshot("selected-review");
    const state = await convert();
    expect(state.queue.items.map((item) => item.fileName)).toEqual(["alpha.raw", "beta.raw"]);
    expect(state.queue.finalizedCount).toBe(2);
    expect(state.queue.destinationPolicy).toEqual({ kind: "sourceSibling" });
    for (const path of [alpha, beta]) output(join(dirname(path), basename(path, ".raw") + ".mzML"));
    for (const item of unchanged) expect(sha256(item.path)).toBe(item.hash);
    await snapshot("selected-finalized");
    evidence.push({ kind: "selected-proof", reviewed: ["alpha.raw", "beta.raw"], excluded: 1, untouched: unchanged.map((item) => ({ name: basename(item.path), sha256: item.hash })) });
  });

  it("converts every eligible workspace row under search and keeps Fail/Skip target bytes", async () => {
    const beta = source("beta", "beta.raw");
    const alpha = source("alpha", "alpha.raw");
    const gamma = source("gamma", "gamma.raw");
    const openFormat = unrelatedOpenFormat();
    const openHash = sha256(openFormat);
    for (const path of [beta, alpha, gamma, openFormat]) await add(path);
    // Clear the import's selection explicitly, so search really hides members.
    await browser.$(ROWS).click();
    await browser.keys(" ");
    await browser.$("#dataset-roster-search").setValue("alpha");
    await browser.$("#dataset-roster-sort").selectByAttribute("value", "name-desc");
    await policy("namedSubfolder"); await subfolderName("M67 results"); await conflict("fail");
    await selectAll();
    await measuredViewport(1920, 1080);
    expect(await browser.$$(ROWS).length).toBe(1);
    const order = ["gamma.raw", "beta.raw", "alpha.raw"];
    expect(await reviewed()).toEqual(order);
    expect(await browser.$("#conversion-scope-summary").getText()).toContain("4 requested · 3 eligible · 1 excluded");
    await snapshot("all-filtered-review");
    const state = await convert();
    expect(state.queue.items.map((item) => item.fileName)).toEqual(order);
    expect(state.queue.finalizedCount).toBe(3);
    const outputs = [gamma, beta, alpha].map((path) => join(dirname(path), "M67 results", basename(path, ".raw") + ".mzML"));
    outputs.forEach(output);
    const hashes = outputs.map(sha256);
    expect(sha256(openFormat)).toBe(openHash);
    await measuredViewport(960, 640); await snapshot("all-finalized-narrow");
    const failed = await convert();
    expect(failed.queue.failedCount).toBe(3);
    expect(failed.queue.items.map((item) => item.fileName)).toEqual(order);
    expect(outputs.map(sha256)).toEqual(hashes);
    await conflict("skip");
    const skipped = await convert();
    expect(skipped.queue.skippedCount).toBe(3);
    expect(outputs.map(sha256)).toEqual(hashes);
    await measuredViewport(1200, 800); await snapshot("all-skipped-intermediate");
    expect(sha256(openFormat)).toBe(openHash);
    evidence.push({ kind: "all-proof", reviewed: order, search: "alpha", excluded: 1, outputHashes: hashes });
  });
});
