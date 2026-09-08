/**
 * M6.6: real UI -> native acquisition picker -> Rust queue -> installed
 * ProteoWizard -> task-owned files. No IPC answers or scientific fixtures are
 * injected into the application. The e2e build's export-only seeded spectrum
 * is unrelated to this flow and is never selected.
 *
 * Supply MSCANVAS_THERMO_FIXTURE (the approved hash-pinned FT-HCD-MSX.raw) and
 * MSCANVAS_M66_NATIVE_OUTPUT_ROOT (an existing, external task directory).
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
const OUTPUT_ROOT = process.env["MSCANVAS_M66_NATIVE_OUTPUT_ROOT"];
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

runNative("M6.6 real native destination and conflict proof (requires authorized fixture environment)", () => {
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
    runRoot = mkdtempSync(join(outputRoot, "m66-native-"));
    const capabilities = browser.capabilities as unknown as Record<string, unknown>;
    applicationProcessId = Number(capabilities["goog:processID"]);
    if (!Number.isSafeInteger(applicationProcessId) || applicationProcessId <= 0) throw new Error("WebDriver did not identify its application process.");
    expect(capabilities["browserName"]).toBe("webview2");
    await browser.$("button=Add files…").waitForDisplayed();
    expect(await browser.execute(() => Object.keys((window as unknown as { __mscanvasIpcTable__: object }).__mscanvasIpcTable__))).toEqual([]);
    evidence.push({ kind: "identity", binarySha256: sha256(resolve(REPOSITORY, "target/e2e/release/mscanvas-desktop.exe")), fixtureSha256: FIXTURE_SHA256, browserName: capabilities["browserName"], browserVersion: capabilities["browserVersion"], driver: capabilities["msedge"] });
    console.log(`M6.6 native evidence: ${runRoot}`);
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
    await browser.$(ROWS).click();
    await browser.keys(["Control", "a"]);
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
    const target = name.includes("draft") || name.includes("invalid") ? ".conversion-destination" : '[aria-label="Queue destination"]';
    await reveal(target);
    await browser.saveScreenshot(join(runRoot, `${String(scenario)}-${name}.png`));
  }

  it("preserves editable drafts and keyboard focus after Escape cancels the real custom picker", async () => {
    await add(source("cancel", "Thermo_native_destination_long_acquisition_name_for_narrow_layout_check.raw"));
    await expect(browser.$('input[name="conversion-destination-policy"][value="customFolder"]')).toBeSelected();
    await conflict("skip");
    await policy("namedSubfolder");
    await subfolderName("Native QA draft");
    await policy("customFolder");
    await browser.$(CONVERT).waitForEnabled({ timeout: 60_000 });
    const drafts = await browser.execute(() => Array.from(document.querySelectorAll<HTMLInputElement>('section.conversion-panel input:checked')).map((input) => [input.name, input.value]));
    for (const [width, height] of [[1366, 768], [1920, 1080], [960, 640], [1200, 800]] as const) {
      await browser.setWindowSize(width, height);
      await snapshot(`draft-${String(width)}x${String(height)}`);
      expect(await browser.execute(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      const geometry = await browser.execute(() => {
        const group = document.querySelector<HTMLElement>(".conversion-destination");
        if (group === null) throw new Error("The destination group is absent.");
        const rect = group.getBoundingClientRect();
        let top = 0;
        let bottom = window.innerHeight;
        for (let parent = group.parentElement; parent !== null; parent = parent.parentElement) {
          if (/(?:auto|scroll|hidden|clip)/u.test(getComputedStyle(parent).overflowY)) {
            const ancestor = parent.getBoundingClientRect();
            top = Math.max(top, ancestor.top + parent.clientTop);
            bottom = Math.min(bottom, ancestor.top + parent.clientTop + parent.clientHeight);
          }
        }
        return { viewportWidth: innerWidth, viewportHeight: innerHeight, groupTop: rect.top, groupBottom: rect.bottom, clipTop: top, clipBottom: bottom };
      });
      evidence.push({ kind: "destination-layout", requestedWidth: width, requestedHeight: height, ...geometry });
      if (width <= 1120) {
        // The narrow stacked layout must make the complete destination choice
        // readable. Intersect every scroll ancestor, not merely the viewport.
        expect(geometry.groupTop).toBeGreaterThanOrEqual(geometry.clipTop - 1);
        expect(geometry.groupBottom).toBeLessThanOrEqual(geometry.clipBottom + 1);
      }
    }
    // Tab through the actual document; Enter opens the native modal. The helper
    // sends Escape only after checking the exact dialog owns foreground.
    await conflict("skip");
    let focused = false;
    for (let step = 0; step < 12; step += 1) {
      await browser.keys("Tab");
      if (await browser.$(CONVERT).isFocused()) { focused = true; break; }
    }
    expect(focused).toBe(true);
    const handler = handleDialog(applicationProcessId, "conversion-folder", "escape");
    const [handled] = await Promise.all([handler, browser.keys("Enter")]);
    evidence.push({ kind: "native-picker", scenario, result: handled });
    expect(handled.method).toBe("WindowsForms.SendKeys.Escape");
    await browser.$(CONVERT).waitForEnabled();
    await expect(browser.$(CONVERT)).toBeFocused();
    expect(await conversionState()).toEqual({ status: "idle" });
    expect(await browser.execute(() => Array.from(document.querySelectorAll<HTMLInputElement>('section.conversion-panel input:checked')).map((input) => [input.name, input.value]))).toEqual(drafts);
    await policy("namedSubfolder");
    await expect(browser.$("#conversion-subfolder-name")).toHaveValue("Native QA draft");
    expect(existsSync(join(runRoot, `scenario-${String(scenario)}`, "cancel", "Native QA draft"))).toBe(false);
    await snapshot("cancelled-drafts");
  });

  it("writes a real validated mzML to the chosen custom folder", async () => {
    await add(source("custom-source"));
    await policy("customFolder");
    await conflict("fail");
    const destination = join(runRoot, `scenario-${String(scenario)}`, "chosen");
    mkdirSync(destination);
    const state = await convert(destination);
    expect(state.queue.destinationPolicy).toEqual({ kind: "customFolder" });
    expect(state.queue.destinationStatus).toBe("bound");
    expect(state.queue.finalizedCount).toBe(1);
    expect(state.queue.receipt).not.toBeNull();
    const result = state.queue.items[0]?.result;
    expect(result?.kind).toBe("single");
    if (result?.kind !== "single") throw new Error("The real Thermo conversion has no single-output result.");
    expect(result.report.backend?.exitCode).toBe(0);
    expect(result.report.validation?.mode).toBe("output_only");
    expect(result.report.validation?.fullyVerified).toBe(false);
    expect(result.report.validation?.verified).toContain("source_unchanged");
    output(join(destination, "FT-HCD-MSX.mzML"));
    await expect(browser.$('[aria-label="Queue destination"]')).toHaveText(expect.stringContaining("Chosen local folder"));
    await snapshot("custom-finalized");
  });

  it("binds equal output names to two different source parents", async () => {
    const first = source("first-parent");
    const second = source("second-parent");
    await add(first);
    await policy("sourceSibling");
    await conflict("fail");
    await add(second);
    await selectAll();
    const state = await convert();
    expect(state.queue.destinationPolicy).toEqual({ kind: "sourceSibling" });
    expect(state.queue.destinationStatus).toBe("bound");
    expect(state.queue.finalizedCount).toBe(2);
    output(join(dirname(first), "FT-HCD-MSX.mzML"));
    output(join(dirname(second), "FT-HCD-MSX.mzML"));
    await snapshot("source-siblings-finalized");
  });

  it("rejects a path-like name without BEGIN or folder creation, then creates valid named subfolders", async () => {
    const first = source("named-first");
    const second = source("named-second");
    await add(first);
    await policy("namedSubfolder");
    await conflict("fail");
    await subfolderName("Native QA");
    await add(second);
    await selectAll();
    const before = (await calls()).filter((call) => call.command === "begin_workspace_conversion_queue").length;
    await subfolderName("../escaped");
    await browser.$("#conversion-plan-pending").waitForDisplayed();
    await browser.waitUntil(async () => !(await browser.$("#conversion-plan-pending").getText()).includes("Working out"));
    await expect(browser.$(CONVERT)).toBeDisabled();
    expect((await calls()).filter((call) => call.command === "begin_workspace_conversion_queue").length).toBe(before);
    expect(existsSync(join(dirname(dirname(first)), "escaped"))).toBe(false);
    await snapshot("invalid-name");
    await subfolderName("Native QA");
    await browser.$(CONVERT).waitForEnabled();
    expect(existsSync(join(dirname(first), "Native QA"))).toBe(false);
    expect(existsSync(join(dirname(second), "Native QA"))).toBe(false);
    const state = await convert();
    expect(state.queue.destinationPolicy).toEqual({ kind: "namedSubfolder", name: "Native QA" });
    expect(state.queue.destinationStatus).toBe("bound");
    expect(state.queue.finalizedCount).toBe(2);
    output(join(dirname(first), "Native QA", "FT-HCD-MSX.mzML"));
    output(join(dirname(second), "Native QA", "FT-HCD-MSX.mzML"));
    await snapshot("named-subfolders-finalized");
  });

  it("preserves existing target bytes through real Fail and Skip attempts", async () => {
    const acquisition = source("conflict-source");
    const destination = join(dirname(acquisition), "FT-HCD-MSX.mzML");
    writeFileSync(destination, "M6.6 test-owned existing output: must remain byte-identical.\n", { flag: "wx" });
    const existingHash = sha256(destination);
    await add(acquisition);
    await policy("sourceSibling");
    await conflict("fail");
    const failed = await convert();
    expect(failed.queue.conflictPolicy).toBe("fail");
    expect(failed.queue.failedCount).toBe(1);
    expect(failed.queue.finalizedCount).toBe(0);
    expect(sha256(destination)).toBe(existingHash);
    await snapshot("conflict-failed");
    await conflict("skip");
    const skipped = await convert();
    expect(skipped.queue.conflictPolicy).toBe("skip");
    expect(skipped.queue.skippedCount).toBe(1);
    expect(skipped.queue.finalizedCount).toBe(0);
    expect(sha256(destination)).toBe(existingHash);
    evidence.push({ kind: "existing-output-preserved", sha256: existingHash, failState: failed.queue.items[0]?.state, skipState: skipped.queue.items[0]?.state });
    await snapshot("conflict-skipped");
  });
});
