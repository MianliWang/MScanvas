/**
 * PM9.6 -- stored results, history, provenance and explicit continuation,
 * rendered: read a targeted MS1 or descriptive QC report in the main region,
 * inspect a target's evidence beside its row, walk to the run that produced
 * it and back, use the existing outputs, and reopen a project to continue
 * only through explicit checks.
 *
 * The real production composition in real Chrome over the real Vite dev
 * server, with only `window.__TAURI_INTERNALS__.invoke` replaced and unknown
 * commands refused. So this is React, CSS, layout, focus and interaction
 * evidence, against the finite list in `docs/phases/pm9/slice-06.md` §4.
 *
 * It is **not** engine, filesystem, dialog or persistence evidence. Every
 * project, row, drawing and export answer is a controlled fixture from
 * `e2e/support/pm9Scenarios.ts` and `targeted.ts`, or a variant built here:
 * nothing was read from a payload, no dialog opened and no file was written.
 * A rejection is never put on a held command (releasing a hold resolves
 * whatever the table says, `__reject` included).
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { cdp, metrics } from "../support/cdp";
import {
  ALLOWED_CONSOLE_SUBSTRINGS,
  consoleEntries,
  heldCallers,
  holdInvoke,
  installIpcBoundary,
  ipcCalls,
  releaseInvokeHold,
  setInvokeRejection,
  setInvokeResult,
  type IpcCall,
} from "../support/harness";
import {
  ABSENT as STORED_ABSENT,
  CAFFEINE as STORED_CAFFEINE,
  DIGEST as STORED_DIGEST,
  NO_PROJECT,
  QC_ARTIFACT,
  QC_RUN,
  RESULT,
  STAND_IN_SVG,
  TARGETED_INPUT,
  TARGETED_LAYER,
  qcProject,
  scenario,
  storedRow,
  targetedProject,
} from "../support/pm9Scenarios";
import {
  ARTIFACTS,
  CAFFEINE,
  DETECTED_ROWS,
  LAYERS,
  NEGATIVE_ROWS,
  RUNS,
  SHAS,
  TYPED,
  manyRows,
  manyTargets,
  project,
  targetedTable,
  type Locale,
} from "../support/targeted";
import { readBackSavedPreferences } from "../support/viewer";
import { en } from "../../apps/desktop/src/features/preferences/locales/en";
import { zhCN } from "../../apps/desktop/src/features/preferences/locales/zh-CN";

let output = "";
const evidence: unknown[] = [];

const BUNDLES = { en, "zh-CN": zhCN } as const;
const LOCALES: readonly Locale[] = ["en", "zh-CN"];
const ANCHORS = [
  [960, 640],
  [1366, 768],
  [1920, 1080],
] as const;

/**
 * One bundle sentence by key, with its values filled in. Read loosely on
 * purpose: a key PM9.6 adds is missing before the change, and that fails the
 * case at the assertion that needs it rather than the whole file's compile.
 */
function copy(locale: Locale, key: string, values: Record<string, string | number> = {}): string {
  const raw = (BUNDLES[locale] as Record<string, string | undefined>)[key];
  if (raw === undefined) throw new Error(`the ${locale} bundle has no ${key}`);
  return raw.replace(/\{\{(\w+)(?:, number)?\}\}/gu, (_, name: string) => String(values[name] ?? `{{${name}}}`));
}

/**
 * Commands that start, stop, record, check, relink, admit, save or replace.
 * Reading a stored result issues none of them; reads are rows, evidence,
 * drawings and the runtime fact.
 */
const WORK = [
  "resolve_targeted_ms1_plan",
  "resolve_targeted_ms1_batch",
  "begin_project_job",
  "run_targeted_ms1",
  "run_targeted_ms1_batch",
  "cancel_project_job",
  "capture_project_file_facts",
  "capture_project_qc_summary",
  "check_project_links",
  "propose_project_relink",
  "commit_project_relink",
  "abandon_project_relink",
  "add_project_input_to_workspace",
  "add_project_input",
  "remove_project_input",
  "create_project_layer",
  "remove_project_layer",
  "save_project",
  "save_project_as",
  "create_project",
  "open_project",
  "close_project",
  "export_targeted_ms1_table",
  "export_targeted_ms1_figure",
];

/** A labelled stand-in drawing; `name` tells one answer from another. Never the renderer's output. */
function drawing(name: string) {
  return {
    svg: STAND_IN_SVG.replace("Fixture figure", `Fixture figure ${name}`),
    specId: `pm96-${name}`,
    width: 1200,
    height: 640,
  };
}

/** motion's development-build notice when the page asks for reduced motion. */
const REDUCED_MOTION_NOTICE = "You have Reduced Motion enabled on your device";

const report = (artifact: string) => `[data-targeted-report="${artifact}"]`;
const choose = (target: string) => `[data-targeted-choose="${target}"]`;

// ---------------------------------------------------------------- driving

async function frames() {
  await browser.execute(
    () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
}

async function navigate(name: string) {
  await browser.execute((label: string) => {
    [...document.querySelectorAll<HTMLButtonElement>(".workbench-navigation > button")]
      .find((button) => (button.textContent ?? "").trim() === label)
      ?.click();
  }, name);
  await frames();
}

/** Opens the page on `table` at a logical viewport, in `locale`, on the Project surface. */
async function open(table: Record<string, unknown>, locale: Locale, width: number, height: number) {
  await metrics(width, height);
  await installIpcBoundary(table);
  await browser.url("/");
  await browser.$(".workbench-header").waitForDisplayed({ timeout: 30_000 });
  if (locale !== "en") {
    await browser.waitUntil(() => browser.execute(() => document.documentElement.lang === "zh-CN"));
  }
  // A saved layout is read back as saved, so Details and the language stay put.
  await readBackSavedPreferences();
  await navigate(BUNDLES[locale].projectSurface);
  await browser.$("[data-project-surface]").waitForDisplayed();
}

/** Focuses a control by script and presses a key on it, as a keyboard user does. */
async function keyPress(selector: string, key: "Enter" | "Space") {
  const focused = await browser.execute((css: string) => {
    const element = document.querySelector<HTMLElement>(css);
    element?.focus();
    return element !== null && document.activeElement === element;
  }, selector);
  expect({ selector, focused }).toEqual({ selector, focused: true });
  await browser.keys([key]);
  await frames();
}

/** A real pointer press at the centre of what `selector` names, where it now is: no scrolling first. */
async function pointerPress(selector: string) {
  const point = await browser.execute((css: string) => {
    const box = document.querySelector(css)?.getBoundingClientRect();
    return box === undefined ? null : { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
  }, selector);
  if (point === null) throw new Error(`nothing matches ${selector}`);
  const hit = await browser.execute(
    (x: number, y: number, css: string) => document.elementFromPoint(x, y)?.closest(css) !== null,
    point.x,
    point.y,
    selector,
  );
  if (!hit) throw new Error(`${selector} is not what a pointer at ${String(point.x)},${String(point.y)} reaches`);
  await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await frames();
}

/** Clicks the button inside `scope` whose text is `label`. */
async function pressNamed(scope: string, label: string) {
  const pressed = await browser.execute(
    (css: string, name: string) => {
      const button = [...document.querySelectorAll<HTMLButtonElement>(`${css} button`)].find(
        (each) => (each.textContent ?? "").trim() === name,
      );
      button?.click();
      return button !== undefined;
    },
    scope,
    label,
  );
  expect({ scope, label, pressed }).toEqual({ scope, label, pressed: true });
  await frames();
}

/** Sets a field's text the way React hears typing: the native setter, then `input`. */
async function typeInto(selector: string, value: string) {
  await browser.execute(
    (css: string, text: string) => {
      const element = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(css);
      if (element === null) throw new Error(`nothing matches ${css}`);
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, text);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    },
    selector,
    value,
  );
  await frames();
}

/** Opens a closed disclosure by its summary. */
async function openDisclosure(selector: string) {
  await browser.execute((css: string) => {
    const details = document.querySelector<HTMLDetailsElement>(css);
    if (details !== null && !details.open) details.querySelector("summary")?.click();
  }, selector);
  await frames();
}

/** Opens a record from the history, as a reader does. */
async function openRecord(artifact: string) {
  await browser.$(`[data-project-inspect-artifact="${artifact}"]`).click();
  await frames();
}

/** Shows the Details region through the surface's own hint, where it is folded. */
async function showDetails() {
  if (await exists("[data-project-inspect-hint] button")) {
    await browser.$("[data-project-inspect-hint] button").click();
  }
  await browser.$("#workbench-inspector [data-provenance]").waitForDisplayed();
}

// ---------------------------------------------------------------- reading

async function unexpectedConsole(): Promise<string[]> {
  return (await consoleEntries())
    .filter((entry) => !ALLOWED_CONSOLE_SUBSTRINGS.some((allowed) => entry.text.includes(allowed)))
    .map((entry) => `${entry.level}: ${entry.text}`);
}

async function callCount(): Promise<number> {
  return (await ipcCalls()).length;
}

/** The work commands issued after the first `since` calls, in order. */
async function work(since: number): Promise<IpcCall[]> {
  return (await ipcCalls()).slice(since).filter((call) => WORK.includes(call.command));
}

/** How many times `command` was issued after the first `since` calls. */
async function issued(command: string, since = 0): Promise<number> {
  return (await ipcCalls()).slice(since).filter((call) => call.command === command).length;
}

async function text(selector: string): Promise<string> {
  return browser.execute((css: string) => (document.querySelector<HTMLElement>(css)?.innerText ?? "").trim(), selector);
}

/** Text as the DOM holds it, layout aside: what a test of a sentence compares. */
async function content(selector: string): Promise<string> {
  return browser.execute((css: string) => (document.querySelector(css)?.textContent ?? "").trim(), selector);
}

async function exists(selector: string): Promise<boolean> {
  return browser.execute((css: string) => document.querySelector(css) !== null, selector);
}

async function focusedOn(selector: string): Promise<boolean> {
  return browser.execute((css: string) => {
    const element = document.querySelector(css);
    return element !== null && document.activeElement === element;
  }, selector);
}

async function focusDescription(): Promise<string> {
  return browser.execute(() => {
    const active = document.activeElement;
    if (active === null || active === document.body) return "body";
    const data = [...active.attributes].filter((attribute) => attribute.name.startsWith("data-")).map((attribute) => attribute.name);
    return `${active.tagName}${data.length > 0 ? `[${data.join(",")}]` : ""} ${(active.textContent ?? "").trim().slice(0, 40)}`;
  });
}

/** Whether every selector's element is in the document, in this order. */
async function inOrder(selectors: readonly string[]): Promise<boolean> {
  return browser.execute((list: readonly string[]) => {
    const elements = list.map((css) => document.querySelector(css));
    if (elements.some((element) => element === null)) return false;
    return elements.every(
      (element, index) =>
        index === 0 || (elements[index - 1]!.compareDocumentPosition(element!) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    );
  }, selectors);
}

/** Marks a node, so a later read can tell the same node from a remounted one. */
async function mark(selector: string) {
  await browser.execute((css: string) => {
    const element = document.querySelector<HTMLElement>(css);
    if (element !== null) element.dataset["pm96Kept"] = "yes";
  }, selector);
}

async function marked(selector: string): Promise<boolean> {
  return browser.execute((css: string) => document.querySelector<HTMLElement>(css)?.dataset["pm96Kept"] === "yes", selector);
}

/**
 * Where a chosen row and its evidence sit after a choice (slice-06 R2): the
 * row and the plot image against the Project surface's visible box, the
 * rows scroller's own position, the surface's, and where the keyboard is.
 */
async function geometry(artifact: string, target: string) {
  return browser.execute(
    (css: string, id: string) => {
      const owner = document.querySelector<HTMLElement>("#workbench-project");
      const section = document.querySelector(css);
      const row = section?.querySelector(`[data-targeted-row="${id}"]`) ?? null;
      const scroller = section?.querySelector<HTMLElement>(".targeted-rows") ?? null;
      const image = section?.querySelector(`[data-targeted-selected="${id}"] [data-targeted-plot] img`) ?? null;
      // Whatever the panel ended in: the drawing, a refusal, or a row's lack of points.
      const end =
        section?.querySelector(`[data-targeted-selected="${id}"]`)?.querySelector(
          "[data-targeted-plot] img, [data-targeted-figure-refused], [data-targeted-evidence-refused], :scope > [data-targeted-no-points]",
        ) ?? null;
      if (owner === null || row === null || scroller === null) return null;
      const bounds = owner.getBoundingClientRect();
      const top = Math.max(bounds.top, 0);
      const bottom = Math.min(bounds.bottom, innerHeight);
      const inside = (box: DOMRect) => box.top >= top - 0.5 && box.bottom <= bottom + 0.5;
      const rowBox = row.getBoundingClientRect();
      const plotBox = image?.getBoundingClientRect() ?? null;
      return {
        rowInside: inside(rowBox),
        plotInside: plotBox !== null && plotBox.height > 0 && inside(plotBox),
        endInside: end !== null && inside(end.getBoundingClientRect()),
        rowTop: Math.round(rowBox.top - top),
        plotBottom: plotBox === null ? null : Math.round(plotBox.bottom - bottom),
        plotHeight: plotBox === null ? null : Math.round(plotBox.height),
        visibleHeight: Math.round(bottom - top),
        surface: owner.scrollTop,
        inner: scroller.scrollTop,
        focused: document.activeElement?.getAttribute("data-targeted-choose") ?? null,
      };
    },
    report(artifact),
    target,
  );
}

/**
 * Waits for a chosen target's panel to reach its end -- the drawing in place,
 * or a refusal said -- and for the surface to stop moving. Read from the
 * document, never from a timer.
 */
async function settledChoice(artifact: string, target: string) {
  await browser.waitUntil(
    () =>
      browser.execute(
        (css: string, id: string) => {
          const panel = document.querySelector(`${css} [data-targeted-selected="${id}"]`);
          if (panel === null) return false;
          const image = panel.querySelector<HTMLImageElement>("[data-targeted-plot] img");
          return (
            (image !== null && image.complete) ||
            panel.querySelector("[data-targeted-figure-refused], [data-targeted-evidence-refused]") !== null ||
            panel.querySelector(":scope > [data-targeted-no-points]") !== null
          );
        },
        report(artifact),
        target,
      ),
    { timeoutMsg: `${target}'s evidence never reached an end in ${artifact}` },
  );
  let previous = await browser.execute(() => document.querySelector("#workbench-project")?.scrollTop ?? -1);
  for (let step = 0; step < 40; step += 1) {
    await frames();
    const now = await browser.execute(() => document.querySelector("#workbench-project")?.scrollTop ?? -1);
    if (now === previous) break;
    previous = now;
  }
  return geometry(artifact, target);
}

/** Chooses a target by keyboard and reads the reveal: the row's scroller position before, and after. */
async function chooseAndReveal(artifact: string, target: string) {
  const before = await geometry(artifact, target);
  await keyPress(`${report(artifact)} ${choose(target)}`, "Enter");
  const after = await settledChoice(artifact, target);
  return { before, after };
}

/** The frozen R2 fit: row and plot both in view, the rows scroller unmoved, the keyboard where it was pressed. */
function fit(target: string, reveal: Awaited<ReturnType<typeof chooseAndReveal>>) {
  return {
    rowInside: reveal.after?.rowInside,
    plotInside: reveal.after?.plotInside,
    innerUnchanged: reveal.after?.inner === reveal.before?.inner,
    focused: reveal.after?.focused === target,
  };
}

const FITS = { rowInside: true, plotInside: true, innerUnchanged: true, focused: true };

/**
 * One frame, with the facts it is judged by. The screenshot comes first, so a
 * case that fails afterwards still leaves it behind.
 */
async function frame(label: string) {
  await frames();
  const screenshot = await cdp("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  if (typeof screenshot.data === "string") writeFileSync(join(output, `${label}.png`), Buffer.from(screenshot.data, "base64"));
  const measured = await browser.execute(() => {
    const owner = document.querySelector<HTMLElement>("#workbench-project");
    const shell = document.querySelector<HTMLElement>(".workbench-shell");
    const box = (css: string) => {
      const element = document.querySelector(css);
      if (element === null) return null;
      const rect = element.getBoundingClientRect();
      return { top: Math.round(rect.top), bottom: Math.round(rect.bottom), height: Math.round(rect.height) };
    };
    const scrollers = [...document.querySelectorAll<HTMLElement>(".targeted-rows")];
    return {
      css: { width: innerWidth, height: innerHeight },
      outer: { width: outerWidth, height: outerHeight },
      devicePixelRatio,
      userAgent: navigator.userAgent,
      lang: document.documentElement.lang,
      panels: { roster: shell?.getAttribute("data-roster-open") ?? null, details: shell?.getAttribute("data-details-open") ?? null },
      surface: owner === null ? null : { width: owner.clientWidth, height: owner.clientHeight, scrollTop: owner.scrollTop, scrollHeight: owner.scrollHeight },
      boxes: {
        report: box("[data-targeted-report], [data-qc-report]"),
        summary: box("[data-targeted-summary]"),
        rows: box(".targeted-rows"),
        selected: box("[data-targeted-selected]"),
        plot: box("[data-targeted-selected] [data-targeted-plot] img"),
        history: box("[data-project-run]"),
      },
      horizontalOverflow: Math.max(
        document.documentElement.scrollWidth - innerWidth,
        owner === null ? 0 : owner.scrollWidth - owner.clientWidth,
        ...scrollers.map((element) => element.scrollWidth - element.clientWidth),
      ),
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      focus: (() => {
        const active = document.activeElement;
        return active === null || active === document.body ? "body" : `${active.tagName} ${(active.textContent ?? "").trim().slice(0, 40)}`;
      })(),
    };
  });
  evidence.push({
    label,
    kind: "PM9.6 frame. Controlled IPC; every project, row, drawing and export is a fixture answer.",
    candidate: process.env["MSCANVAS_PM9_CANDIDATE"] ?? "unlabelled",
    ...measured,
  });
  return measured;
}

// ---------------------------------------------------------------- fixtures built here

/** Two finish times, one minute apart, for runs this file adds. */
const LATER = ["2026-10-04T10:03:09Z", "2026-10-04T10:04:09Z"];
const CANCELLED_RUN = "ffffffff-9696-4111-8111-000000000001";
const REPEAT_RUN = "ffffffff-9696-4111-8111-000000000002";
const REPEAT_ARTIFACT = "eeeeeeee-9696-4111-8111-000000000002";

/**
 * The history P10 reads: the first acquisition completed with a target
 * found, the second failed, the third completed with every target not
 * detected; then a cancelled run of the second, and the first acquisition's
 * plan run again, whose stored result the project found missing.
 */
function historyProject() {
  const base = project(["completed", "failed", "negative"]);
  const failed = base.runs[1]!;
  const first = base.runs[0]!;
  const firstResult = base.artifacts[0]!;
  return {
    ...base,
    runs: [
      ...base.runs,
      {
        ...failed,
        id: CANCELLED_RUN,
        outcome: "cancelled",
        startedAt: LATER[0]!.replace(":09Z", ":00Z"),
        finishedAt: LATER[0]!,
        targetedMs1: {
          ...failed.targetedMs1,
          failure: null,
          stop: { reason: "cancelRequested", workerTerminated: true, exitObserved: true },
        },
      },
      {
        ...first,
        id: REPEAT_RUN,
        outputArtifactIds: [REPEAT_ARTIFACT],
        startedAt: LATER[1]!.replace(":09Z", ":00Z"),
        finishedAt: LATER[1]!,
      },
    ],
    artifacts: [
      ...base.artifacts,
      {
        ...firstResult,
        id: REPEAT_ARTIFACT,
        producedByRunId: REPEAT_RUN,
        targetedMs1: { ...firstResult.targetedMs1, availability: "payloadMissing" },
      },
    ],
  };
}

/** The first acquisition's completed result, holding `count` targets in plan order. */
function manyResultProject(count: number) {
  const base = project(["completed", null, null]);
  const half = Math.floor(count / 2);
  return {
    ...base,
    plans: base.plans.map((plan) => ({ ...plan, targets: manyTargets(count) })),
    artifacts: base.artifacts.map((artifact) => ({
      ...artifact,
      targetedMs1: {
        ...artifact.targetedMs1,
        result: {
          ...artifact.targetedMs1.result,
          summary: {
            targets: count,
            detected: count - half,
            detectedAmbiguous: 0,
            shared: 0,
            suppressedByOverlap: 0,
            notDetected: half,
            failed: 0,
          },
        },
      },
    })),
  };
}

/** The stored-result project as a reopen finds it: nothing checked yet. */
function reopened(options: { readonly sourceMissing?: boolean; readonly proposed?: boolean } = {}) {
  const base = targetedProject("available", { sourceMissing: options.sourceMissing === true });
  const verification = options.sourceMissing === true ? "unavailable" : "notChecked";
  return {
    ...base,
    inputs: base.inputs.map((input) => ({
      ...input,
      verification,
      relinkProposed: options.proposed === true,
      relinkCandidateMatches: false,
    })),
  };
}

// ---------------------------------------------------------------- cases

describe("PM9.6 results, history and explicit continuation, rendered", () => {
  before(() => {
    const root = process.env["MSCANVAS_PM9_OUTPUT_ROOT"] ?? resolve("test-results/pm9.6");
    mkdirSync(root, { recursive: true });
    output = mkdtempSync(join(root, "browser-"));
    console.log(`PM9.6 browser evidence: ${output}`);
  });

  after(async () => {
    evidence.push({ console: await consoleEntries() });
    writeFileSync(join(output, "evidence.json"), JSON.stringify(evidence, null, 2));
  });

  afterEach(async function () {
    evidence.push({ test: this.currentTest?.title, state: this.currentTest?.state, console: await consoleEntries() });
    if (this.currentTest?.state === "failed") {
      await browser.saveScreenshot(join(output, `failure-${String(evidence.length)}.png`));
      evidence.push({
        failedDocument: await browser.execute(() =>
          (document.querySelector<HTMLElement>("#workbench-project")?.innerText ?? document.body.innerText).slice(0, 8000),
        ),
        focus: await focusDescription(),
      });
    }
    writeFileSync(join(output, "evidence.json"), JSON.stringify(evidence, null, 2));
  });

  it("PM9.6-P1 from PM9.5's Open result to the report, its run and back (R2, R3; path 1)", async () => {
    // Through the manual review harness's own table.
    await open(scenario("targetedTask", "en"), "en", 1366, 768);
    await keyPress(`[data-project-targeted="${LAYERS[0]}"]`, "Enter");
    await browser.$("[data-targeted-setup]").waitForDisplayed();
    await typeInto("[data-targeted-text]", TYPED);
    await keyPress("[data-targeted-review]", "Enter");
    await browser.$("[data-targeted-review-area] [data-targeted-plan]").waitForDisplayed();
    const beforeRun = await callCount();
    await keyPress("[data-targeted-run]", "Enter");
    await browser.$(`[data-targeted-open-result="${ARTIFACTS[0]}"]`).waitForDisplayed();

    const beforeOpen = await callCount();
    await keyPress(`[data-targeted-open-result="${ARTIFACTS[0]}"]`, "Enter");
    await browser.waitUntil(() => focusedOn(`${report(ARTIFACTS[0])} h3`), {
      timeoutMsg: "Open result did not take the keyboard to the result's heading",
    });
    await browser.$(`${report(ARTIFACTS[0])} [data-targeted-row]`).waitForDisplayed();
    await frame("p1-report-en-1366x768");

    // The table and its evidence are one task: the evidence comes into view
    // beside the row, and the keyboard stays on the row.
    const reveal = await chooseAndReveal(ARTIFACTS[0], CAFFEINE);
    await frame("p1-evidence-en-1366x768");
    expect(fit(CAFFEINE, reveal)).toEqual(FITS);
    await openDisclosure(`${report(ARTIFACTS[0])} [data-targeted-figure-export]`);
    await mark(report(ARTIFACTS[0]));

    // To the run that produced it, in Details, and back: the same report,
    // and nothing read again on the way.
    const beforeWalk = await callCount();
    await showDetails();
    await browser.$(`#workbench-inspector [data-provenance-link="${RUNS[0]}"]`).click();
    await browser.$('#workbench-inspector [data-provenance="run"]').waitForDisplayed();
    await frame("p1-run-en-1366x768");
    expect(await marked(report(ARTIFACTS[0]))).toBe(true);
    expect(await exists(`${report(ARTIFACTS[0])} [data-targeted-selected="${CAFFEINE}"]`)).toBe(true);
    expect(await exists(`${report(ARTIFACTS[0])} [data-targeted-figure-export][open]`)).toBe(true);
    expect(await text("#workbench-inspector [data-targeted-plan-facts]")).toContain(SHAS[0]);

    await browser.$(`#workbench-inspector [data-provenance-link="${ARTIFACTS[0]}"]`).click();
    await browser.$('#workbench-inspector [data-provenance="artifact"]').waitForDisplayed();
    expect(await marked(report(ARTIFACTS[0]))).toBe(true);
    expect(await exists(`${report(ARTIFACTS[0])} [data-targeted-selected="${CAFFEINE}"]`)).toBe(true);

    // Reading starts nothing, and the walk asked for nothing. (The dev server
    // mounts under StrictMode, which runs a mount's reads twice; a count of
    // reads would measure that, not the walk.)
    expect(await work(beforeOpen)).toEqual([]);
    expect(await issued("read_targeted_ms1_rows", beforeRun)).toBeGreaterThan(0);
    // Showing Details may save the layout; the walk itself reads no project or result.
    expect(
      (await ipcCalls())
        .slice(beforeWalk)
        .map((call) => call.command)
        .filter((command) => /project|targeted/u.test(command)),
    ).toEqual([]);
    expect(await unexpectedConsole()).toEqual([]);
  });

  for (const [locale, width, height] of [
    ["en", 1366, 768],
    ["zh-CN", 960, 640],
  ] as const) {
    it(`PM9.6-P2 a QC snapshot from history, then its run (R3; path 2) ${locale} ${String(width)}x${String(height)}`, async () => {
      const table = scenario("qcCapture", locale);
      table.get_project_state = qcProject(true);
      await open(table, locale, width, height);
      const before = await callCount();
      await openRecord(QC_ARTIFACT);
      const snapshot = `[data-qc-report="${QC_ARTIFACT}"]`;
      await browser.$(snapshot).waitForDisplayed();
      await frame(`p2-qc-${locale}-${String(width)}x${String(height)}`);
      expect(await content(`${snapshot} h3`)).toBe(copy(locale, "qcReportTitle"));
      expect(await content("[data-qc-total-spectra]")).toBe("12,345");
      expect(await browser.$("[data-qc-chromatograms]").getAttribute("data-qc-chromatograms")).toBe("notReported");
      // A description, not a verdict.
      expect((await text(snapshot)).toLowerCase()).not.toMatch(/\b(pass|fail|good|poor|grade|score)\b|合格|不合格|评分|等级/u);
      await mark(snapshot);

      // Its run keeps the report on screen.
      await browser.$(`[data-project-inspect-run="${QC_RUN}"]`).click();
      await frames();
      expect(await marked(snapshot)).toBe(true);
      if (width >= 1366) {
        await showDetails();
        expect(await browser.$('#workbench-inspector [data-provenance="run"]').isDisplayed()).toBe(true);
      }
      // Opening a snapshot captures nothing.
      expect(await work(before)).toEqual([]);
      expect(await unexpectedConsole()).toEqual([]);
    });
  }

  it("PM9.6-P3 two results with one label and shared targets: late answers and outputs stay with their own (V3; path 3)", async () => {
    const table = targetedTable("en", project(["completed", "negative", null]));
    table.preview_targeted_ms1_figure = drawing("A");
    table.export_targeted_ms1_figure = {
      status: "saved",
      format: "svg",
      fileName: "caffeine.svg",
      figure: { width: 1200, height: 640, dpi: null, theme: "light" },
    };
    table.export_targeted_ms1_table = { status: "saved", format: "csv", fileName: "result.csv", rowCount: 2 };
    await open(table, "en", 1366, 768);
    // Both records carry one name in the history; only their identities differ.
    expect(await content(`[data-project-inspect-artifact="${ARTIFACTS[0]}"]`)).toBe(
      await content(`[data-project-inspect-artifact="${ARTIFACTS[1]}"]`),
    );
    await openRecord(ARTIFACTS[0]);
    await browser.$(`${report(ARTIFACTS[0])} [data-targeted-row]`).waitForDisplayed();
    await showDetails();
    expect(await text("#workbench-inspector [data-targeted-plan-facts]")).toContain(SHAS[0]);

    // A's drawing is asked for and held; B opens before it answers.
    await holdInvoke("preview_targeted_ms1_figure");
    await keyPress(`${report(ARTIFACTS[0])} ${choose(CAFFEINE)}`, "Enter");
    await browser.waitUntil(async () => (await heldCallers("preview_targeted_ms1_figure")) >= 1, {
      timeoutMsg: "A's drawing was never asked for",
    });
    await setInvokeResult("read_targeted_ms1_rows", NEGATIVE_ROWS);
    await openRecord(ARTIFACTS[1]);
    await browser.$(`${report(ARTIFACTS[1])} [data-targeted-row]`).waitForDisplayed();
    expect(await exists(report(ARTIFACTS[0]))).toBe(false);
    expect(await text("#workbench-inspector [data-targeted-plan-facts]")).toContain(SHAS[1]);

    await releaseInvokeHold("preview_targeted_ms1_figure");
    await frames();
    await frames();
    // A's late drawing landed nowhere: B has no selection and no figure.
    expect(await exists(`${report(ARTIFACTS[1])} [data-targeted-selected]`)).toBe(false);
    expect(await exists('[data-targeted-figure="pm96-A"]')).toBe(false);
    expect(await exists(`${report(ARTIFACTS[1])} [data-targeted-no-selection]`)).toBe(true);
    await frame("p3-late-drawing-dropped-en-1366x768");

    // B's own Caffeine: B's outcome, B's drawing, B's exports.
    await setInvokeResult("preview_targeted_ms1_figure", drawing("B"));
    await keyPress(`${report(ARTIFACTS[1])} ${choose(CAFFEINE)}`, "Enter");
    await settledChoice(ARTIFACTS[1], CAFFEINE);
    const image = `${report(ARTIFACTS[1])} [data-targeted-selected="${CAFFEINE}"] img`;
    expect(await browser.$(image).getAttribute("data-targeted-figure")).toBe("pm96-B");
    const alt = await browser.$(image).getAttribute("alt");
    expect(alt).toContain("Caffeine");
    expect(alt).toContain(en.targetedOutcomeNotDetected);

    const beforeExports = await callCount();
    await openDisclosure(`${report(ARTIFACTS[1])} [data-targeted-figure-export]`);
    await browser.$(`${report(ARTIFACTS[1])} [data-targeted-figure-export] [data-targeted-export="svg"]`).click();
    await browser.$(`${report(ARTIFACTS[1])} [data-targeted-figure-export] [data-targeted-output="savedFigure"]`).waitForDisplayed();
    await openDisclosure(`${report(ARTIFACTS[1])} [data-targeted-table-export]`);
    await browser.$(`${report(ARTIFACTS[1])} [data-targeted-table-export] [data-targeted-export="csv"]`).click();
    await browser.$(`${report(ARTIFACTS[1])} [data-targeted-table-export] [data-targeted-output="savedTable"]`).waitForDisplayed();
    expect(await work(beforeExports)).toEqual([
      {
        command: "export_targeted_ms1_figure",
        args: {
          artifactId: ARTIFACTS[1],
          targetId: CAFFEINE,
          format: "svg",
          settings: { widthPx: 1200, heightPx: 640, pngDpi: 300, theme: "light" },
        },
      },
      { command: "export_targeted_ms1_table", args: { artifactId: ARTIFACTS[1], format: "csv" } },
    ]);

    // B's table export held, A opened, then B's answer: nothing said in A.
    await holdInvoke("export_targeted_ms1_table");
    await browser.$(`${report(ARTIFACTS[1])} [data-targeted-table-export] [data-targeted-export="tsv"]`).click();
    await browser.waitUntil(async () => (await heldCallers("export_targeted_ms1_table")) >= 1, {
      timeoutMsg: "B's table export was never asked for",
    });
    await setInvokeResult("read_targeted_ms1_rows", DETECTED_ROWS);
    await openRecord(ARTIFACTS[0]);
    await browser.$(`${report(ARTIFACTS[0])} [data-targeted-row]`).waitForDisplayed();
    await setInvokeResult("export_targeted_ms1_table", { status: "saved", format: "tsv", fileName: "late.tsv", rowCount: 2 });
    await releaseInvokeHold("export_targeted_ms1_table");
    await frames();
    await frames();
    expect(await browser.$(`${report(ARTIFACTS[0])} [data-targeted-table-export] [data-targeted-output]`).getAttribute("data-targeted-output")).toBe(
      "idle",
    );
    expect(await content(`${report(ARTIFACTS[0])} [data-targeted-export="csv"]`)).toBe(copy("en", "viewerExportFormat", { name: "CSV" }));
    expect(await content(report(ARTIFACTS[0]))).not.toContain("late.tsv");
    expect(await text("#workbench-inspector [data-targeted-plan-facts]")).toContain(SHAS[0]);
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("PM9.6-P4 a stored result read, drawn and exported with no source and no runtime (V5; path 4)", async () => {
    const table = scenario("resultSourceAndRuntimeUnavailable", "en");
    table.export_targeted_ms1_table = { status: "saved", format: "csv", fileName: "result.csv", rowCount: 2 };
    table.export_targeted_ms1_figure = {
      status: "saved",
      format: "svg",
      fileName: "caffeine.svg",
      figure: { width: 1200, height: 640, dpi: null, theme: "light" },
    };
    await open(table, "en", 1366, 768);
    const before = await callCount();
    await openRecord(RESULT);
    await browser.$(`${report(RESULT)} [data-targeted-row]`).waitForDisplayed();
    expect(await content(`${report(RESULT)} [data-targeted-source]`)).toBe(en.projectStateMissing);
    await browser.waitUntil(async () => (await content(`${report(RESULT)} [data-targeted-runtime]`)) === en.targetedNewRunsRuntimeUnavailable);
    const reveal = await chooseAndReveal(RESULT, STORED_CAFFEINE);
    expect(fit(STORED_CAFFEINE, reveal)).toEqual(FITS);
    await frame("p4-no-source-no-runtime-en-1366x768");

    const beforeExports = await callCount();
    await openDisclosure(`${report(RESULT)} [data-targeted-table-export]`);
    await browser.$(`${report(RESULT)} [data-targeted-export="csv"]`).click();
    await browser.$(`${report(RESULT)} [data-targeted-table-export] [data-targeted-output="savedTable"]`).waitForDisplayed();
    await openDisclosure(`${report(RESULT)} [data-targeted-figure-export]`);
    await browser.$(`${report(RESULT)} [data-targeted-export="svg"]`).click();
    await browser.$(`${report(RESULT)} [data-targeted-figure-export] [data-targeted-output="savedFigure"]`).waitForDisplayed();
    // Only the two outputs the reader asked for; nothing reads or checks the source.
    expect((await work(beforeExports)).map((call) => call.command)).toEqual(["export_targeted_ms1_table", "export_targeted_ms1_figure"]);
    expect(await work(before)).toHaveLength(2);
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("PM9.6-P5 a missing or damaged payload, and a refused drawing or evidence read, each said where it belongs (R5, R6, V4; path 5)", async () => {
    for (const [name, availability] of [
      ["resultPayloadMissing", "payloadMissing"],
      ["resultPayloadCorrupt", "payloadCorrupt"],
    ] as const) {
      await open(scenario(name, "en"), "en", 1366, 768);
      // The history says it before the record is opened.
      expect(await content(`[data-project-artifact="${RESULT}"] [data-project-artifact-availability="${availability}"]`)).toBe(
        copy("en", availability === "payloadMissing" ? "targetedStatePayloadMissing" : "targetedStatePayloadCorrupt"),
      );
      const before = await callCount();
      await openRecord(RESULT);
      await browser.$(`${report(RESULT)} [data-targeted-unavailable="${availability}"]`).waitForDisplayed();
      await frame(`p5-${availability}-en-1366x768`);
      expect(await content(`${report(RESULT)} [data-targeted-unavailable]`)).toBe(
        copy("en", availability === "payloadMissing" ? "targetedPayloadMissing" : "targetedPayloadCorrupt"),
      );
      expect(await issued("read_targeted_ms1_rows", before)).toBe(0);
      expect(await exists(`${report(RESULT)} [data-targeted-table-export], ${report(RESULT)} [data-targeted-row]`)).toBe(false);
      expect(await work(before)).toEqual([]);
    }
    // The damaged sentence gives its next step (R6).
    expect(en.targetedPayloadCorrupt).toContain("put it back and open the project again");

    // A drawing refused for one target stays in that target's panel.
    const table = scenario("projectWithResult", "en");
    table.export_targeted_ms1_table = { status: "saved", format: "csv", fileName: "result.csv", rowCount: 2 };
    await open(table, "en", 1366, 768);
    await openRecord(RESULT);
    await browser.$(`${report(RESULT)} [data-targeted-row]`).waitForDisplayed();
    await setInvokeRejection("preview_targeted_ms1_figure", {
      kind: "targeted_figure_not_drawable",
      summary: "This target's stored evidence could not be drawn as a figure.",
      detail: null,
      retryable: false,
    });
    await keyPress(`${report(RESULT)} ${choose(STORED_CAFFEINE)}`, "Enter");
    const refusedDrawing = await settledChoice(RESULT, STORED_CAFFEINE);
    expect(await content(`${report(RESULT)} [data-targeted-figure-refused]`)).toBe(en.m92ErrorFigureNotDrawable);
    expect(refusedDrawing?.rowInside).toBe(true);
    expect(await exists(`${report(RESULT)} ${choose(STORED_ABSENT)}`)).toBe(true);
    expect(await exists(`${report(RESULT)} [data-targeted-table-export]`)).toBe(true);
    await frame("p5-drawing-refused-en-1366x768");
    await setInvokeResult("preview_targeted_ms1_figure", drawing("absent"));
    await keyPress(`${report(RESULT)} ${choose(STORED_ABSENT)}`, "Enter");
    await settledChoice(RESULT, STORED_ABSENT);
    expect(await browser.$(`${report(RESULT)} [data-targeted-selected] img`).getAttribute("data-targeted-figure")).toBe("pm96-absent");

    // An evidence read refused for one target, not as a damaged payload, also
    // stays in that target's panel: the rows, the table's output and the other
    // target are untouched. (Asserted by its hook: the identifier, not the
    // project's general sentence, is what this case is about.)
    await setInvokeRejection("read_targeted_ms1_evidence", { kind: "unknownRecord", summary: "unknownRecord", detail: null, retryable: false });
    await keyPress(`${report(RESULT)} ${choose(STORED_CAFFEINE)}`, "Enter");
    const refusedRead = await settledChoice(RESULT, STORED_CAFFEINE);
    expect(await exists(`${report(RESULT)} [data-targeted-selected="${STORED_CAFFEINE}"] [data-targeted-evidence-refused="unknownRecord"]`)).toBe(true);
    expect({ rowInside: refusedRead?.rowInside, endInside: refusedRead?.endInside }).toEqual({ rowInside: true, endInside: true });
    expect(await browser.$$(`${report(RESULT)} [data-targeted-row]`).length).toBe(2);
    expect(await exists(`${report(RESULT)} [data-targeted-table-export]`)).toBe(true);
    expect(await content(`${report(RESULT)} [data-targeted-payload]`)).toBe(en.targetedStatePayloadWhole);
    await setInvokeResult("read_targeted_ms1_evidence", { targetId: STORED_ABSENT, traces: [] });
    await keyPress(`${report(RESULT)} ${choose(STORED_ABSENT)}`, "Enter");
    await settledChoice(RESULT, STORED_ABSENT);
    expect(await exists(`${report(RESULT)} [data-targeted-selected="${STORED_ABSENT}"] img`)).toBe(true);

    // An evidence read that finds the payload damaged takes the rows and outputs away.
    await setInvokeRejection("read_targeted_ms1_evidence", { kind: "payloadCorrupt" });
    await keyPress(`${report(RESULT)} ${choose(STORED_CAFFEINE)}`, "Enter");
    await browser.$(`${report(RESULT)} [data-targeted-unavailable="payloadCorrupt"]`).waitForDisplayed();
    expect(await browser.$(`${report(RESULT)} [data-targeted-unavailable]`).getAttribute("role")).toBe("alert");
    expect(await content(`${report(RESULT)} [data-targeted-payload]`)).toBe(en.targetedStatePayloadCorrupt);
    expect(await exists(`${report(RESULT)} [data-targeted-row], ${report(RESULT)} [data-targeted-table-export]`)).toBe(false);
    expect(await focusDescription()).not.toBe("body");
    // The history keeps what the project recorded (slice-06 §11).
    expect(await exists(`[data-project-artifact="${RESULT}"] [data-project-artifact-availability]`)).toBe(false);
    await frame("p5-read-found-damaged-en-1366x768");
    expect(await unexpectedConsole()).toEqual([]);
  });

  for (const [width, height] of [
    [960, 640],
    [1366, 768],
  ] as const) {
    for (const locale of LOCALES) {
      it(`PM9.6-P6 the 200th target reached by wheel and keyboard, and its evidence beside it (R2; path 6) ${locale} ${String(width)}x${String(height)}`, async () => {
        const last = manyTargets(200)[199]!.targetId;
        const table = targetedTable(locale, manyResultProject(200));
        table.read_targeted_ms1_rows = manyRows(200);
        await open(table, locale, width, height);
        await openRecord(ARTIFACTS[0]);
        await browser.$(`${report(ARTIFACTS[0])} [data-targeted-row="${last}"]`).waitForExist();
        expect(await browser.$$(`${report(ARTIFACTS[0])} [data-targeted-row]`).length).toBe(200);

        // A real wheel over the rows scroller, framed in the surface by script first.
        const point = await browser.execute((css: string) => {
          const scroller = document.querySelector<HTMLElement>(`${css} .targeted-rows`);
          const owner = document.querySelector<HTMLElement>("#workbench-project");
          if (scroller === null || owner === null) return null;
          owner.scrollTop += scroller.getBoundingClientRect().top - owner.getBoundingClientRect().top - 24;
          const box = scroller.getBoundingClientRect();
          return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + Math.min(box.height, innerHeight - box.top) / 2) };
        }, report(ARTIFACTS[0]));
        if (point === null) throw new Error("no rows scroller");
        const lastShown = () =>
          browser.execute(
            (css: string, id: string) => {
              const row = document.querySelector(`${css} [data-targeted-row="${id}"]`);
              const scroller = document.querySelector<HTMLElement>(`${css} .targeted-rows`);
              const owner = document.querySelector<HTMLElement>("#workbench-project");
              if (row === null || scroller === null || owner === null) return { shown: false, inner: -1, outer: -1 };
              const box = row.getBoundingClientRect();
              const bounds = scroller.getBoundingClientRect();
              return {
                shown: box.top >= bounds.top - 1 && box.bottom <= bounds.bottom + 1 && box.top >= 0 && box.bottom <= innerHeight,
                inner: scroller.scrollTop,
                outer: owner.scrollTop,
              };
            },
            report(ARTIFACTS[0]),
            last,
          );
        const settled = async () => {
          let previous = await lastShown();
          for (let step = 0; step < 40; step += 1) {
            await frames();
            const now = await lastShown();
            if (now.inner === previous.inner && now.outer === previous.outer) return now;
            previous = now;
          }
          return previous;
        };
        const beforeWheel = await settled();
        let wheel = beforeWheel;
        for (let step = 0; step < 80 && !wheel.shown; step += 1) {
          await cdp("Input.dispatchMouseEvent", { type: "mouseWheel", x: point.x, y: point.y, deltaX: 0, deltaY: 200 });
          wheel = await settled();
        }
        expect({ shown: wheel.shown, innerMoved: wheel.inner > 0, surfaceStill: wheel.outer === beforeWheel.outer }).toEqual({
          shown: true,
          innerMoved: true,
          surfaceStill: true,
        });
        await frame(`p6-wheel-${locale}-${String(width)}x${String(height)}`);
        const beforePointer = await geometry(ARTIFACTS[0], last);
        await pointerPress(`${report(ARTIFACTS[0])} ${choose(last)}`);
        const pointed = await settledChoice(ARTIFACTS[0], last);
        await frame(`p6-wheel-chosen-${locale}-${String(width)}x${String(height)}`);
        expect(fit(last, { before: beforePointer, after: pointed })).toEqual(FITS);

        // The keyboard: from the control after the report, one Shift+Tab.
        await open(table, locale, width, height);
        await openRecord(ARTIFACTS[0]);
        await browser.$(`${report(ARTIFACTS[0])} [data-targeted-row="${last}"]`).waitForExist();
        const after = await browser.execute((css: string) => {
          const section = document.querySelector(css);
          const following = [...document.querySelectorAll<HTMLElement>("[data-project-surface] button, [data-project-surface] summary")].find(
            (element) => section !== null && (section.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 && !section.contains(element),
          );
          following?.focus();
          return following !== undefined && document.activeElement === following;
        }, report(ARTIFACTS[0]));
        expect(after).toBe(true);
        await browser.keys(["Shift", "Tab"]);
        await frames();
        expect(await focusedOn(`${report(ARTIFACTS[0])} ${choose(last)}`)).toBe(true);
        const focusedLast = await settled();
        expect(focusedLast.shown).toBe(true);
        const beforeKey = await geometry(ARTIFACTS[0], last);
        await browser.keys(["Enter"]);
        const keyed = await settledChoice(ARTIFACTS[0], last);
        await frame(`p6-keyboard-chosen-${locale}-${String(width)}x${String(height)}`);
        expect(fit(last, { before: beforeKey, after: keyed })).toEqual(FITS);
        expect(await unexpectedConsole()).toEqual([]);
      });
    }
  }

  it("PM9.6-P7 each output said in its own region, for what was asked (V7, V13; path 7)", async () => {
    const table = scenario("projectWithResult", "en");
    table.export_targeted_ms1_table = { status: "saved", format: "csv", fileName: "result.csv", rowCount: 2 };
    await open(table, "en", 1366, 768);
    await openRecord(RESULT);
    await browser.$(`${report(RESULT)} [data-targeted-row]`).waitForDisplayed();
    const tableRegion = `${report(RESULT)} [data-targeted-table-export]`;
    const figureRegion = `${report(RESULT)} [data-targeted-figure-export]`;
    const before = await callCount();

    await openDisclosure(tableRegion);
    await browser.$(`${tableRegion} [data-targeted-export="csv"]`).click();
    await browser.$(`${tableRegion} [data-targeted-output="savedTable"]`).waitForDisplayed();
    expect(await content(`${tableRegion} [data-targeted-output]`)).toBe(copy("en", "targetedTableSaved", { name: "result.csv", count: 2 }));

    await setInvokeResult("export_targeted_ms1_table", { status: "cancelled" });
    await browser.$(`${tableRegion} [data-targeted-export="tsv"]`).click();
    await browser.$(`${tableRegion} [data-targeted-output="cancelled"]`).waitForDisplayed();
    expect(await content(`${tableRegion} [data-targeted-output]`)).toBe(en.viewerExportCancelled);

    await keyPress(`${report(RESULT)} ${choose(STORED_CAFFEINE)}`, "Enter");
    await settledChoice(RESULT, STORED_CAFFEINE);
    await openDisclosure(figureRegion);
    await setInvokeRejection("export_targeted_ms1_figure", {
      kind: "exportInProgress",
      summary: "Another export of a stored result is in progress.",
      detail: null,
      retryable: true,
    });
    await browser.$(`${figureRegion} [data-targeted-export="svg"]`).click();
    await browser.$(`${figureRegion} [data-targeted-output="failed"]`).waitForDisplayed();
    expect(await content(`${figureRegion} [data-targeted-output]`)).toContain(en.projectRefusedExportInProgress);
    // Said under the figure only, and the rows stay: a busy lane is not a damaged result.
    expect(await browser.$(`${tableRegion} [data-targeted-output]`).getAttribute("data-targeted-output")).toBe("idle");
    expect(await exists(`${report(RESULT)} [data-targeted-row]`)).toBe(true);

    await setInvokeResult("export_targeted_ms1_figure", {
      status: "saved",
      format: "png",
      fileName: "caffeine.png",
      figure: { width: 1200, height: 640, dpi: 300, theme: "light" },
    });
    await browser.$(`${figureRegion} [data-targeted-export="png"]`).click();
    await browser.$(`${figureRegion} [data-targeted-output="savedFigure"]`).waitForDisplayed();
    expect(await content(`${figureRegion} [data-targeted-output]`)).toBe(
      copy("en", "viewerExportSaved", {
        name: "caffeine.png",
        details: `${copy("en", "viewerFigureSize", { width: "1,200", height: "640", theme: en.light })}, 300 DPI`,
      }),
    );
    await frame("p7-outputs-en-1366x768");
    const settings = { widthPx: 1200, heightPx: 640, pngDpi: 300, theme: "light" };
    expect(await work(before)).toEqual([
      { command: "export_targeted_ms1_table", args: { artifactId: RESULT, format: "csv" } },
      { command: "export_targeted_ms1_table", args: { artifactId: RESULT, format: "tsv" } },
      { command: "export_targeted_ms1_figure", args: { artifactId: RESULT, targetId: STORED_CAFFEINE, format: "svg", settings } },
      { command: "export_targeted_ms1_figure", args: { artifactId: RESULT, targetId: STORED_CAFFEINE, format: "png", settings } },
    ]);
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("PM9.6-P8 close and reopen, then continue only through explicit checks (V10; path 8)", async () => {
    const table = scenario("projectWithResult", "en");
    table.close_project = NO_PROJECT;
    table.open_project = reopened();
    table.check_project_links = reopened({ sourceMissing: true });
    await open(table, "en", 1366, 768);
    await openRecord(RESULT);
    await browser.$(`${report(RESULT)} [data-targeted-row]`).waitForDisplayed();

    await pressNamed(".project-header", en.projectClose);
    await browser.$(".project-surface > .project-empty").waitForDisplayed();
    expect(await exists("[data-targeted-report]")).toBe(false);
    const beforeOpen = await callCount();
    await pressNamed(".project-header", en.projectOpen);
    await browser.$(`[data-project-inspect-artifact="${RESULT}"]`).waitForDisplayed();
    // Reopening offers the history; it checks, relinks and admits nothing.
    expect((await work(beforeOpen)).map((call) => call.command)).toEqual(["open_project"]);
    expect(await exists("[data-targeted-report]")).toBe(false);

    const beforeRead = await callCount();
    await openRecord(RESULT);
    await browser.$(`${report(RESULT)} [data-targeted-row]`).waitForDisplayed();
    expect(await content(`${report(RESULT)} [data-targeted-source]`)).toBe(en.projectStateNotChecked);
    await keyPress(`${report(RESULT)} ${choose(STORED_CAFFEINE)}`, "Enter");
    await settledChoice(RESULT, STORED_CAFFEINE);
    expect(await work(beforeRead)).toEqual([]);
    await showDetails();
    const recorded = await text("#workbench-inspector [data-targeted-consumed]");
    expect(recorded).toContain(STORED_DIGEST);
    await frame("p8-reopened-en-1366x768");

    // Check linked files: its own job, and nothing else.
    const beforeCheck = await callCount();
    await browser.$("[data-project-check]").click();
    await browser.waitUntil(async () => (await content(`${report(RESULT)} [data-targeted-source]`)) === en.projectStateMissing);
    expect((await work(beforeCheck)).map((call) => call.command)).toEqual(["begin_project_job", "check_project_links"]);
    expect(await exists(`${report(RESULT)} [data-targeted-selected="${STORED_CAFFEINE}"]`)).toBe(true);
    expect(await text("#workbench-inspector [data-targeted-consumed]")).toBe(recorded);

    // Locate, then the reader's own Cancel: nothing committed, nothing changed.
    await setInvokeResult("propose_project_relink", reopened({ sourceMissing: true, proposed: true }));
    await setInvokeResult("abandon_project_relink", reopened({ sourceMissing: true }));
    const beforeLocate = await callCount();
    await browser.$(`[data-project-relink="${TARGETED_INPUT}"]`).click();
    await browser.$(`[data-project-proposal="${TARGETED_INPUT}"]`).waitForDisplayed();
    expect(await content(`[data-project-proposal="${TARGETED_INPUT}"]`)).toBe(en.projectRelinkDiffers);
    await frame("p8-proposal-en-1366x768");
    await pressNamed(`[data-project-input="${TARGETED_INPUT}"]`, en.projectRelinkAbandon);
    await browser.$(`[data-project-relink="${TARGETED_INPUT}"]`).waitForDisplayed();
    expect((await work(beforeLocate)).map((call) => call.command)).toEqual(["propose_project_relink", "abandon_project_relink"]);
    expect(await content(`${report(RESULT)} [data-targeted-source]`)).toBe(en.projectStateMissing);
    expect(await text("#workbench-inspector [data-targeted-consumed]")).toBe(recorded);

    // A Locate whose dialog the reader closed changes nothing either.
    await setInvokeResult("propose_project_relink", null);
    const beforeCancelled = await callCount();
    await browser.$(`[data-project-relink="${TARGETED_INPUT}"]`).click();
    await frames();
    expect((await work(beforeCancelled)).map((call) => call.command)).toEqual(["propose_project_relink"]);
    expect(await exists(`[data-project-proposal="${TARGETED_INPUT}"]`)).toBe(false);
    expect(await exists("[data-project-problem]")).toBe(false);
    expect(await issued("add_project_input_to_workspace")).toBe(0);
    expect(await issued("commit_project_relink")).toBe(0);
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("PM9.6-P9 navigation keeps the report; a replaced project leaks nothing into the next (V11; path 9)", async () => {
    const table = scenario("projectWithResult", "en");
    table.open_project = targetedProject("available", { name: "Another copy" });
    await open(table, "en", 1366, 768);
    // A draft in the targeted setup, then a result inspected beside it.
    await keyPress(`[data-project-targeted="${TARGETED_LAYER}"]`, "Enter");
    await browser.$("[data-targeted-setup]").waitForDisplayed();
    await typeInto("[data-targeted-text]", "Caffeine, C8H10N4O2, 120, 30");
    await openRecord(RESULT);
    await browser.$(`${report(RESULT)} [data-targeted-row]`).waitForDisplayed();
    await keyPress(`${report(RESULT)} ${choose(STORED_CAFFEINE)}`, "Enter");
    await settledChoice(RESULT, STORED_CAFFEINE);
    await openDisclosure(`${report(RESULT)} [data-targeted-figure-export]`);
    await mark(report(RESULT));

    const before = await callCount();
    await navigate(en.workbench);
    await navigate(en.projectSurface);
    await browser.$(report(RESULT)).waitForDisplayed();
    expect(await marked(report(RESULT))).toBe(true);
    expect(await exists(`${report(RESULT)} [data-targeted-selected="${STORED_CAFFEINE}"]`)).toBe(true);
    expect(await exists(`${report(RESULT)} [data-targeted-figure-export][open]`)).toBe(true);
    expect(await browser.$("[data-targeted-text]").getValue()).toBe("Caffeine, C8H10N4O2, 120, 30");
    expect(await ipcCalls().then((calls) => calls.slice(before).filter((call) => call.command.startsWith("read_targeted")))).toEqual([]);
    expect(await work(before)).toEqual([]);
    await frame("p9-after-navigation-en-1366x768");

    // An evidence read held across a replacement answers nothing in the next project.
    await holdInvoke("read_targeted_ms1_evidence");
    await keyPress(`${report(RESULT)} ${choose(STORED_ABSENT)}`, "Enter");
    await browser.waitUntil(async () => (await heldCallers("read_targeted_ms1_evidence")) >= 1);
    await pressNamed(".project-header", en.projectOpen);
    await browser.waitUntil(async () => (await content(".project-header h2")) === "Another copy");
    expect(await exists("[data-targeted-report]")).toBe(false);
    expect(await exists("[data-targeted-setup]")).toBe(false);
    await openRecord(RESULT);
    await browser.$(`${report(RESULT)} [data-targeted-row]`).waitForDisplayed();
    expect(await marked(report(RESULT))).toBe(false);
    await releaseInvokeHold("read_targeted_ms1_evidence");
    await frames();
    await frames();
    expect(await exists(`${report(RESULT)} [data-targeted-selected]`)).toBe(false);
    expect(await exists(`${report(RESULT)} [data-targeted-no-selection]`)).toBe(true);
    await frame("p9-replaced-en-1366x768");
    expect(await unexpectedConsole()).toEqual([]);
  });

  for (const [width, height] of ANCHORS) {
    for (const locale of LOCALES) {
      it(`PM9.6-P10 history says how each attempt ended (R4, R5, V12) ${locale} ${String(width)}x${String(height)}`, async () => {
        await open(targetedTable(locale, historyProject()), locale, width, height);
        const failedRow = `[data-project-run="${RUNS[1]}"]`;
        const cancelledRow = `[data-project-run="${CANCELLED_RUN}"]`;
        await browser.execute((css: string) => document.querySelector(css)?.scrollIntoView({ block: "center" }), failedRow);
        await frame(`p10-history-${locale}-${String(width)}x${String(height)}`);

        expect(await content(`${failedRow} [data-project-run-failure="sourceChanged"]`)).toBe(copy(locale, "targetedFailureSourceChanged"));
        expect(await content(`${failedRow} [data-project-no-artifact]`)).toBe(copy(locale, "projectRunNoResult"));
        expect(await exists(`${cancelledRow} [data-project-run-failure]`)).toBe(false);
        expect(await content(`${cancelledRow} [data-project-no-artifact]`)).toBe(copy(locale, "projectRunNoResult"));
        expect(await content(`[data-project-artifact="${REPEAT_ARTIFACT}"] [data-project-artifact-availability="payloadMissing"]`)).toBe(
          copy(locale, "targetedStatePayloadMissing"),
        );
        expect(await exists(`[data-project-artifact="${ARTIFACTS[0]}"] [data-project-artifact-availability]`)).toBe(false);
        expect(await content(`[data-project-surface] section[aria-label="${copy(locale, "projectHistory")}"] > .project-note`)).toBe(
          copy(locale, "projectCaptureMeaning"),
        );

        // One plan run twice: two runs and two records, each named by when it ended.
        const names = await browser.execute(
          (ids: readonly string[]) => ids.map((id) => document.querySelector(`[data-project-inspect-run="${id}"]`)?.getAttribute("aria-label") ?? ""),
          [RUNS[0], REPEAT_RUN],
        );
        expect(names[0]).not.toBe(names[1]);
        await openRecord(ARTIFACTS[0]);
        await browser.$(`${report(ARTIFACTS[0])} [data-targeted-row]`).waitForDisplayed();
        await openRecord(REPEAT_ARTIFACT);
        await browser.$(`${report(REPEAT_ARTIFACT)} [data-targeted-unavailable="payloadMissing"]`).waitForDisplayed();
        expect(await exists(report(ARTIFACTS[0]))).toBe(false);
        expect(await unexpectedConsole()).toEqual([]);
      });
    }
  }

  for (const [width, height] of ANCHORS) {
    for (const locale of LOCALES) {
      it(`PM9.6-P11 the report, its evidence and the QC report at an anchor (R1, R2) ${locale} ${String(width)}x${String(height)}`, async () => {
        await open(scenario("projectWithResult", locale), locale, width, height);
        await openRecord(RESULT);
        await browser.$(`${report(RESULT)} [data-targeted-row]`).waitForDisplayed();
        const first = await frame(`p11-report-${locale}-${String(width)}x${String(height)}`);
        // R1: one compact summary, every count in order, zeros kept.
        expect(
          await browser.execute(() => [...document.querySelectorAll("[data-targeted-count]")].map((item) => item.getAttribute("data-targeted-count"))),
        ).toEqual(["targets", "detected", "detectedAmbiguous", "shared", "suppressedByOverlap", "notDetected", "failed"]);
        expect(first.boxes.summary?.height ?? Infinity).toBeLessThanOrEqual(64);
        // R2: the meaning and the table's export before the rows, the chosen target after.
        expect(
          await inOrder([
            `${report(RESULT)} [data-targeted-summary]`,
            `${report(RESULT)} .targeted-meaning`,
            `${report(RESULT)} [data-targeted-table-export]`,
            `${report(RESULT)} .targeted-rows`,
            `${report(RESULT)} [data-targeted-no-selection]`,
          ]),
        ).toBe(true);
        expect(first.horizontalOverflow).toBeLessThanOrEqual(0);

        const caffeine = await chooseAndReveal(RESULT, STORED_CAFFEINE);
        await frame(`p11-evidence-${locale}-${String(width)}x${String(height)}`);
        expect(fit(STORED_CAFFEINE, caffeine)).toEqual(FITS);
        // The next row's plot takes the same place: already in view, nothing moves.
        const absent = await chooseAndReveal(RESULT, STORED_ABSENT);
        expect(fit(STORED_ABSENT, absent)).toEqual(FITS);
        expect(absent.after?.surface).toBe(caffeine.after?.surface);

        const qc = scenario("qcCapture", locale);
        qc.get_project_state = qcProject(true);
        await open(qc, locale, width, height);
        await openRecord(QC_ARTIFACT);
        await browser.$(`[data-qc-report="${QC_ARTIFACT}"]`).waitForDisplayed();
        const snapshot = await frame(`p11-qc-${locale}-${String(width)}x${String(height)}`);
        expect(snapshot.horizontalOverflow).toBeLessThanOrEqual(0);
        expect(await unexpectedConsole()).toEqual([]);
      });
    }
  }

  for (const [width, height] of [
    [1280, 720],
    [1536, 864],
    [2560, 1440],
  ] as const) {
    it(`PM9.6-P11 the report and its evidence at a review size, recorded (R2) en ${String(width)}x${String(height)}`, async () => {
      await open(scenario("projectWithResult", "en"), "en", width, height);
      await openRecord(RESULT);
      await browser.$(`${report(RESULT)} [data-targeted-row]`).waitForDisplayed();
      const reveal = await chooseAndReveal(RESULT, STORED_CAFFEINE);
      await frame(`p11-evidence-en-${String(width)}x${String(height)}`);
      evidence.push({ label: `p11-fit-en-${String(width)}x${String(height)}`, fit: fit(STORED_CAFFEINE, reveal), geometry: reveal });
      expect(reveal.after?.rowInside).toBe(true);
      expect(await unexpectedConsole()).toEqual([]);
    });
  }

  it("PM9.6-P11 reduced motion: the same reveal, at once (R2) en 1366x768", async () => {
    await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    try {
      await open(scenario("projectWithResult", "en"), "en", 1366, 768);
      await openRecord(RESULT);
      await browser.$(`${report(RESULT)} [data-targeted-row]`).waitForDisplayed();
      const reveal = await chooseAndReveal(RESULT, STORED_CAFFEINE);
      const shown = await frame("p11-reduced-motion-en-1366x768");
      expect(shown.reducedMotion).toBe(true);
      expect(fit(STORED_CAFFEINE, reveal)).toEqual(FITS);
      expect(await browser.execute(() => getComputedStyle(document.querySelector("#workbench-project")!).scrollBehavior)).toBe("auto");
    } finally {
      await cdp("Emulation.setEmulatedMedia", { features: [] });
    }
    // motion's development-build notice answers the emulation itself, as in
    // PM9.1's reduced-motion frames; nothing else may appear.
    expect((await unexpectedConsole()).filter((entry) => !entry.includes(REDUCED_MOTION_NOTICE))).toEqual([]);
  });

  it("PM9.6-P1b the run a record came from, inspected, keeps that record's report and drops any other (R3)", async () => {
    await open(targetedTable("en", project(["completed", "negative", null])), "en", 1366, 768);
    await openRecord(ARTIFACTS[0]);
    await browser.$(`${report(ARTIFACTS[0])} [data-targeted-row]`).waitForDisplayed();
    await mark(report(ARTIFACTS[0]));
    const loaded = await callCount();
    await browser.$(`[data-project-inspect-run="${RUNS[0]}"]`).click();
    await frames();
    expect(await marked(report(ARTIFACTS[0]))).toBe(true);
    // Another run, or a reference, is not this report's origin.
    await browser.$(`[data-project-inspect-run="${RUNS[1]}"]`).click();
    await frames();
    expect(await exists("[data-targeted-report]")).toBe(false);
    // And a run never opens a report that was not already on screen.
    await browser.$(`[data-project-inspect-run="${RUNS[0]}"]`).click();
    await frames();
    expect(await exists("[data-targeted-report]")).toBe(false);
    expect(await issued("read_targeted_ms1_rows", loaded)).toBe(0);
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("PM9.6-P12 the reveal: only while the keyboard stays, again on a second press, never for a view already whole (R2)", async () => {
    await open(scenario("projectWithResult", "en"), "en", 1366, 768);
    await openRecord(RESULT);
    await browser.$(`${report(RESULT)} [data-targeted-row]`).waitForDisplayed();
    const surfaceTop = () => browser.execute(() => document.querySelector("#workbench-project")?.scrollTop ?? -1);

    // The reader moves on before the drawing arrives: nothing moves for it.
    await holdInvoke("preview_targeted_ms1_figure");
    await keyPress(`${report(RESULT)} ${choose(STORED_CAFFEINE)}`, "Enter");
    await browser.waitUntil(async () => (await heldCallers("preview_targeted_ms1_figure")) >= 1, {
      timeoutMsg: "the drawing was never asked for",
    });
    await browser.keys(["Tab"]);
    await frames();
    expect(await focusedOn(`${report(RESULT)} ${choose(STORED_ABSENT)}`)).toBe(true);
    const movedOn = await surfaceTop();
    await releaseInvokeHold("preview_targeted_ms1_figure");
    const unrevealed = await settledChoice(RESULT, STORED_CAFFEINE);
    expect(unrevealed?.surface).toBe(movedOn);
    expect(unrevealed?.plotInside).toBe(false);
    await frame("p12-moved-on-en-1366x768");

    // Pressed again, with its drawing already there: it comes into view now.
    const again = await chooseAndReveal(RESULT, STORED_CAFFEINE);
    expect(fit(STORED_CAFFEINE, again)).toEqual(FITS);
    expect(again.after?.surface).not.toBe(movedOn);

    // Both already in view, the drawing's end within the reveal's margin of
    // the bottom: a press moves nothing.
    await browser.execute(() => {
      const owner = document.querySelector<HTMLElement>("#workbench-project");
      if (owner !== null) owner.scrollTop -= 4;
    });
    const whole = await chooseAndReveal(RESULT, STORED_CAFFEINE);
    expect(whole.before?.rowInside && whole.before?.plotInside).toBe(true);
    expect(whole.before?.plotBottom ?? -100).toBeGreaterThan(-8);
    expect(whole.after?.surface).toBe(whole.before?.surface);
    await frame("p12-already-whole-en-1366x768");
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("PM9.6-P12b a row with no points: its own note comes into view beside it, and nothing is read (R2)", async () => {
    const table = scenario("projectWithResult", "en");
    table.read_targeted_ms1_rows = {
      total: 2,
      offset: 0,
      rows: [
        storedRow(STORED_CAFFEINE, true),
        {
          ...storedRow(STORED_ABSENT, false),
          outcome: "FAILED",
          failureReason: "TARGET_UNACCOUNTED",
          ion: null,
          windows: null,
          signal: null,
          feature: null,
          candidates: [],
        },
      ],
    };
    await open(table, "en", 1366, 768);
    await openRecord(RESULT);
    await browser.$(`${report(RESULT)} [data-targeted-row]`).waitForDisplayed();
    const before = await callCount();
    const reveal = await chooseAndReveal(RESULT, STORED_ABSENT);
    await frame("p12b-no-points-en-1366x768");
    expect({
      rowInside: reveal.after?.rowInside,
      endInside: reveal.after?.endInside,
      innerUnchanged: reveal.after?.inner === reveal.before?.inner,
      focused: reveal.after?.focused,
    }).toEqual({ rowInside: true, endInside: true, innerUnchanged: true, focused: STORED_ABSENT });
    expect(await issued("read_targeted_ms1_evidence", before)).toBe(0);
    expect(await unexpectedConsole()).toEqual([]);
  });
});
