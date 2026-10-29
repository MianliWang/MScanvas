/**
 * PM9.5 -- the targeted-MS1 task end to end, rendered: choose acquisitions,
 * type a request, review it, run one plan or an independent batch, follow
 * and stop it, and reach the run or result it left.
 *
 * The real production composition in real Chrome over the real Vite dev
 * server, with only `window.__TAURI_INTERNALS__.invoke` replaced, and unknown
 * commands refused. So this is React, CSS, layout, focus and interaction
 * evidence, against the finite list in `docs/phases/pm9/slice-05.md` §4.
 *
 * It is **not** engine, filesystem, scheduling or persistence evidence. Every
 * review, phase, member state and ending is a controlled answer from
 * `e2e/support/targeted.ts`: no worker ran, no source was read and nothing
 * was recorded. A rejection is never put on a held command (releasing a hold
 * resolves whatever the table says, `__reject` included).
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { cdp, metrics } from "../support/cdp";
import {
  ALLOWED_CONSOLE_SUBSTRINGS,
  consoleEntries,
  holdInvoke,
  installIpcBoundary,
  ipcCalls,
  releaseInvokeHold,
  setInvokeRejection,
  setInvokeResult,
  type IpcCall,
} from "../support/harness";
import { scenario } from "../support/pm9Scenarios";
import {
  ARTIFACTS,
  LABELS,
  LAYERS,
  MAX_MEMBERS,
  MAX_TARGETS,
  NEGATIVE_ROWS,
  OPERATION,
  RUNS,
  SENT_TARGETS,
  SHAS,
  TYPED,
  batchProgress,
  manyPlanReview,
  manyTyped,
  planReview,
  problemsReview,
  project,
  singleEnd,
  stoppedBatchEnd,
  targetedTable,
  wideBatchReview,
  wideLayers,
  wideProject,
  type Locale,
} from "../support/targeted";
import { readBackSavedPreferences } from "../support/viewer";
import { en } from "../../apps/desktop/src/features/preferences/locales/en";
import { zhCN } from "../../apps/desktop/src/features/preferences/locales/zh-CN";

let output = "";
const evidence: unknown[] = [];

const BUNDLES = { en, "zh-CN": zhCN } as const;

/**
 * One bundle sentence by key, with its values filled in. Read loosely on
 * purpose: a key PM9.5 adds is missing before the change, and that fails the
 * case at the assertion that needs it rather than the whole file's compile.
 */
function copy(locale: Locale, key: string, values: Record<string, string | number> = {}): string {
  const raw = (BUNDLES[locale] as Record<string, string | undefined>)[key];
  if (raw === undefined) throw new Error(`the ${locale} bundle has no ${key}`);
  return raw.replace(/\{\{(\w+)(?:, number)?\}\}/gu, (_, name: string) => String(values[name] ?? `{{${name}}}`));
}

/** An invented estimate: a percentage, an ETA or time remaining. */
const ESTIMATE = /\d+\s?%|\bETA\b|[Rr]emaining(?! items)|剩余|预计/u;

/** Commands that review, start, stop or replace. Navigation may issue none of them. */
const WORK = [
  "resolve_targeted_ms1_plan",
  "resolve_targeted_ms1_batch",
  "begin_project_job",
  "run_targeted_ms1",
  "run_targeted_ms1_batch",
  "cancel_project_job",
  "create_project",
  "open_project",
  "close_project",
];

const SETUP = "[data-targeted-setup]";
const REVIEW = "[data-targeted-review]";
const AREA = "[data-targeted-review-area]";
const RUN = "[data-targeted-run]";
const BLOCK = "[data-targeted-run-block]";
const BATCH = "[data-targeted-batch]";

// ---------------------------------------------------------------- driving

async function frames() {
  await browser.execute(
    () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
}

async function navigate(name: string) {
  const found = await browser.execute((label: string) => {
    const target = [...document.querySelectorAll<HTMLButtonElement>(".workbench-navigation > button")]
      .find((button) => (button.textContent ?? "").trim() === label);
    target?.click();
    return target !== undefined;
  }, name);
  // Project is the header menu's first item, not a tab (rebuild spec 1.1).
  if (!found) {
    await browser.$("[data-project-menu]").click();
    await browser.$('[data-project-menu-item="surface"]').waitForDisplayed();
    await browser.$('[data-project-menu-item="surface"]').click();
  }
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
  await browser.$(`[data-project-targeted="${LAYERS[0]}"]`).waitForDisplayed();
}

/** Opens the setup from a layer row, by keyboard. */
async function openSetup(layer: string = LAYERS[0]) {
  await keyPress(`[data-project-targeted="${layer}"]`, "Enter");
  await browser.$(SETUP).waitForDisplayed();
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

/** Ticks or unticks every acquisition named. */
async function toggleMembers(layers: readonly string[]) {
  for (const layer of layers) {
    await browser.execute((id: string) => {
      document.querySelector<HTMLInputElement>(`[data-targeted-member="${id}"]`)?.click();
    }, layer);
  }
  await frames();
}

async function reviewWith(answer: unknown, command = "resolve_targeted_ms1_plan") {
  await setInvokeResult(command, answer);
  await keyPress(REVIEW, "Enter");
  await browser.$(AREA).waitForDisplayed();
}

// ---------------------------------------------------------------- reading

async function unexpectedConsole(): Promise<string[]> {
  return (await consoleEntries())
    .filter((entry) => !ALLOWED_CONSOLE_SUBSTRINGS.some((allowed) => entry.text.includes(allowed)))
    .map((entry) => `${entry.level}: ${entry.text}`);
}

/** The work commands issued after the first `since` calls, in order. */
async function work(since: number): Promise<IpcCall[]> {
  return (await ipcCalls()).slice(since).filter((call) => WORK.includes(call.command));
}

async function callCount(): Promise<number> {
  return (await ipcCalls()).length;
}

async function text(selector: string): Promise<string> {
  return browser.execute((css: string) => (document.querySelector<HTMLElement>(css)?.innerText ?? "").trim(), selector);
}

async function exists(selector: string): Promise<boolean> {
  return browser.execute((css: string) => document.querySelector(css) !== null, selector);
}

/** Whether focus is on (or, for a heading, exactly at) the element `selector` names. */
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

/** Whether an element's top is inside the Project surface's visible box. */
async function inView(selector: string): Promise<boolean> {
  return browser.execute((css: string) => {
    const element = document.querySelector(css);
    const owner = document.querySelector("#workbench-project");
    if (element === null || owner === null) return false;
    const box = element.getBoundingClientRect();
    const bounds = owner.getBoundingClientRect();
    return box.top >= bounds.top - 1 && box.top < Math.min(bounds.bottom, innerHeight) - 16;
  }, selector);
}

async function onScreen(selector: string): Promise<boolean> {
  return browser.execute((css: string) => {
    const box = document.querySelector(css)?.getBoundingClientRect();
    return box !== undefined && box.top >= 0 && box.bottom <= innerHeight;
  }, selector);
}

/** What a control says about itself: name, refusal, and the text its description points at. */
async function control(selector: string) {
  return browser.execute((css: string) => {
    const button = document.querySelector<HTMLButtonElement>(css);
    if (button === null) return null;
    return {
      text: (button.textContent ?? "").trim(),
      refused: button.disabled || button.getAttribute("aria-disabled") === "true",
      disabled: button.disabled,
      primary: button.classList.contains("primary-button"),
      described: (button.getAttribute("aria-describedby") ?? "")
        .split(/\s+/u)
        .filter(Boolean)
        .map((id) => (document.getElementById(id)?.textContent ?? "").trim()),
    };
  }, selector);
}

/**
 * One frame of the task, with the facts it is judged by. The screenshot comes
 * first, so a case that fails afterwards still leaves it behind.
 */
async function frame(label: string) {
  await frames();
  const screenshot = await cdp("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  if (typeof screenshot.data === "string") writeFileSync(join(output, `${label}.png`), Buffer.from(screenshot.data, "base64"));
  const measured = await browser.execute(() => {
    const owner = document.querySelector<HTMLElement>("#workbench-project");
    const setup = document.querySelector<HTMLElement>("[data-targeted-setup]");
    const shell = document.querySelector<HTMLElement>(".workbench-shell");
    const probe = document.createElement("span");
    probe.style.background = "var(--color-accent)";
    document.body.append(probe);
    const accent = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const shown = (element: Element) => element.getClientRects().length > 0 && element.closest("[hidden]") === null;
    const filled = [...(setup?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
      .filter((button) => shown(button) && !button.disabled && button.getAttribute("aria-disabled") !== "true")
      .filter((button) => getComputedStyle(button).backgroundColor === accent)
      .map((button) => (button.textContent ?? "").trim());
    // Controls under the 32 px compact minimum (DESIGN_SYSTEM), inputs aside.
    const small = [...(setup?.querySelectorAll<HTMLElement>("button, summary") ?? [])]
      .filter(shown)
      .map((element) => ({ name: (element.textContent ?? "").trim().slice(0, 40), height: Math.round(element.getBoundingClientRect().height * 10) / 10 }))
      .filter((element) => element.height < 31.5);
    const scrollers = [...(setup?.querySelectorAll<HTMLElement>(".targeted-review-scroll, .targeted-batch-scroll, .targeted-member-list") ?? [])];
    return {
      css: { width: innerWidth, height: innerHeight },
      outer: { width: outerWidth, height: outerHeight },
      devicePixelRatio,
      userAgent: navigator.userAgent,
      lang: document.documentElement.lang,
      panels: { roster: shell?.getAttribute("data-roster-open") ?? null, details: shell?.getAttribute("data-details-open") ?? null },
      surface: owner === null ? null : { width: owner.clientWidth, height: owner.clientHeight, scrollTop: owner.scrollTop, scrollHeight: owner.scrollHeight },
      setupWidth: setup === null ? null : Math.round(setup.getBoundingClientRect().width),
      horizontalOverflow: Math.max(
        document.documentElement.scrollWidth - innerWidth,
        owner === null ? 0 : owner.scrollWidth - owner.clientWidth,
        ...scrollers.map((element) => element.scrollWidth - element.clientWidth),
      ),
      filled,
      small,
      focus: (() => {
        const active = document.activeElement;
        return active === null || active === document.body ? "body" : `${active.tagName} ${(active.textContent ?? "").trim().slice(0, 40)}`;
      })(),
      text: setup?.innerText ?? "",
    };
  });
  const { text: setupText, ...recorded } = measured;
  evidence.push({
    label,
    kind: "PM9.5 frame. Controlled IPC; every review, phase and ending is a fixture answer.",
    candidate: process.env["MSCANVAS_PM9_CANDIDATE"] ?? "unlabelled",
    ...recorded,
  });
  return { ...measured, setupText };
}

/** Wheels inside the Project surface, beside the setup's tables, until `selector` is on screen. */
async function wheelTo(selector: string): Promise<boolean> {
  await browser.execute(() => {
    const owner = document.querySelector<HTMLElement>("#workbench-project");
    if (owner !== null) owner.scrollTop = 0;
  });
  const point = await browser.execute(() => {
    const box = document.querySelector("#workbench-project")!.getBoundingClientRect();
    // The surface's right margin: no table or list scrolls there.
    return { x: Math.round(box.right - 24), y: Math.round(box.top + Math.min(box.height / 2, 200)) };
  });
  for (let step = 0; step < 40; step += 1) {
    if (await onScreen(selector)) return true;
    // A wheel over a table or list that scrolls itself would scroll that
    // instead: the point must stay over the surface's own margin.
    const inner = await browser.execute(
      (x: number, y: number) =>
        (document.elementFromPoint(x, y)?.closest(".targeted-review-scroll, .targeted-batch-scroll, .targeted-member-list") ??
          null) !== null,
      point.x,
      point.y,
    );
    if (inner) throw new Error(`the wheel point ${String(point.x)},${String(point.y)} is over an inner scroller`);
    await cdp("Input.dispatchMouseEvent", { type: "mouseWheel", x: point.x, y: point.y, deltaX: 0, deltaY: 200 });
    await frames();
  }
  return onScreen(selector);
}

/**
 * Whether the review table `table` names, which scrolls inside the review,
 * brings its last row on screen by a real wheel over it, and again by the
 * keyboard: Tab from Review plan to its scroller, then Page Down. Each path
 * must move that scroller and leave the surface's own scroll where it was.
 * The surface is positioned by script first, which only frames the scroller.
 * `label` names the two frames kept, one after each path.
 */
async function scrollsInside(table: string, label: string) {
  const place = () =>
    browser.execute((css: string) => {
      const scroller = document.querySelector(css)?.closest<HTMLElement>(".targeted-review-scroll") ?? null;
      const owner = document.querySelector<HTMLElement>("#workbench-project");
      if (scroller === null || owner === null) return null;
      scroller.scrollTop = 0;
      owner.scrollTop += scroller.getBoundingClientRect().top - owner.getBoundingClientRect().top - 40;
      const box = scroller.getBoundingClientRect();
      return {
        x: Math.round(box.left + box.width / 2),
        y: Math.round(box.top + Math.min(box.height, innerHeight - box.top) / 2),
        overflows: scroller.scrollHeight > scroller.clientHeight + 1,
      };
    }, table);
  /** The last row: inside its scroller's box and inside the window; both scroll positions. */
  const lastShown = () =>
    browser.execute((css: string) => {
      const element = document.querySelector(css);
      const scroller = element?.closest<HTMLElement>(".targeted-review-scroll") ?? null;
      const owner = document.querySelector<HTMLElement>("#workbench-project");
      const last = element?.querySelector("tbody tr:last-child") ?? null;
      if (scroller === null || owner === null || last === null) return { shown: false, inner: 0, outer: -1 };
      const box = last.getBoundingClientRect();
      const bounds = scroller.getBoundingClientRect();
      const inScroller = box.top >= bounds.top - 1 && box.bottom <= bounds.bottom + 1;
      const onScreen = box.top >= 0 && box.bottom <= innerHeight;
      return { shown: inScroller && onScreen, inner: scroller.scrollTop, outer: owner.scrollTop };
    }, table);

  /**
   * Keyboard (and wheel) scrolling animates. The next press waits until the
   * scroller has stopped moving: a press sent while it is still on its way to
   * its end finds it already there and moves the surface instead, which says
   * nothing about the scroller.
   */
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

  const point = await place();
  if (point === null) throw new Error(`no scroller holds ${table}`);
  const beforeWheel = await lastShown();
  let wheel = beforeWheel;
  for (let step = 0; step < 60 && !wheel.shown; step += 1) {
    await cdp("Input.dispatchMouseEvent", { type: "mouseWheel", x: point.x, y: point.y, deltaX: 0, deltaY: 200 });
    wheel = await settled();
  }
  await frame(`${label}-wheel`);

  await place();
  await browser.execute((css: string) => document.querySelector<HTMLElement>(css)?.focus(), REVIEW);
  let tabbed = false;
  for (let step = 0; step < 40 && !tabbed; step += 1) {
    await browser.keys(["Tab"]);
    tabbed = await browser.execute((css: string) => {
      const active = document.activeElement;
      return active !== null && active.matches(".targeted-review-scroll") && active.querySelector(css) !== null;
    }, table);
  }
  // Read once the keyboard is on the scroller: focusing it may bring it into view.
  const beforeKeys = await settled();
  let keyboard = beforeKeys;
  for (let step = 0; tabbed && step < 40 && !keyboard.shown; step += 1) {
    await browser.keys(["PageDown"]);
    keyboard = await settled();
  }
  await frame(`${label}-keyboard`);
  return {
    overflows: point.overflows,
    wheel: wheel.shown && wheel.inner > 0 && wheel.outer === beforeWheel.outer,
    tabbed,
    keyboard: keyboard.shown && keyboard.inner > 0 && keyboard.outer === beforeKeys.outer,
    positions: { beforeWheel, wheel, beforeKeys, keyboard },
  };
}

/** Presses Tab from `from` until `to` has focus. */
async function tabTo(from: string, to: string, limit = 40): Promise<boolean> {
  await browser.execute((css: string) => document.querySelector<HTMLElement>(css)?.focus(), from);
  for (let step = 0; step < limit; step += 1) {
    if (await focusedOn(to)) return true;
    await browser.keys(["Tab"]);
  }
  return focusedOn(to);
}

// ---------------------------------------------------------------- cases

describe("PM9.5 targeted-MS1 journey, rendered", () => {
  before(() => {
    const root = process.env["MSCANVAS_PM9_OUTPUT_ROOT"] ?? resolve("test-results/pm9.5");
    mkdirSync(root, { recursive: true });
    output = mkdtempSync(join(root, "browser-"));
    console.log(`PM9.5 browser evidence: ${output}`);
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

  it("PM9.5-T1 one acquisition: review, run, follow and open its result (R1, R3, R6, R8, R9; path 1, 9)", async () => {
    // Through the manual review harness's own table.
    await open(scenario("targetedTask", "en"), "en", 1920, 1080);
    await openSetup();
    expect(await text("[data-targeted-members] legend")).toBe(copy("en", "targetedAcquisitions"));
    expect(await text("[data-targeted-members]")).toContain(copy("en", "targetedAcquisitionsHelp"));

    await typeInto("[data-targeted-text]", TYPED);
    const beforeReview = await callCount();
    await keyPress(REVIEW, "Enter");
    await browser.$(`${AREA} [data-targeted-plan]`).waitForDisplayed();
    // The layer and the typed text, once; Rust decides what every value means.
    expect(await work(beforeReview)).toEqual([
      {
        command: "resolve_targeted_ms1_plan",
        args: { request: { layerId: LAYERS[0], mzHalfWidthPpm: "5", expectedPeakWidthS: "6", targets: SENT_TARGETS } },
      },
    ]);
    // The review leads to Run, says what will run, and the keyboard follows it.
    expect(await inOrder([REVIEW, AREA, RUN])).toBe(true);
    expect(await focusedOn(`${AREA} h4`)).toBe(true);
    expect(await inView(AREA)).toBe(true);
    const area = await text(AREA);
    expect(area).toContain(copy("en", "targetedPlanFor", { name: LABELS[0] }));
    expect(area).toContain(copy("en", "targetedPlanCaption", { count: 2, ppm: "5", width: "6" }));
    const ready = await frame("t1-ready-en-1920x1080");
    expect(ready.filled).toEqual([copy("en", "targetedRun")]);

    await holdInvoke("run_targeted_ms1");
    const beforeRun = await callCount();
    await keyPress(RUN, "Enter");
    await browser.$(`${BLOCK}[data-targeted-run-block="running"]`).waitForDisplayed();
    expect(await focusedOn(`${BLOCK} h4`)).toBe(true);
    const running = await frame("t1-running-en-1920x1080");
    expect(running.setupText).toContain(copy("en", "targetedPhaseRunningEngine"));
    expect(ESTIMATE.test(running.setupText)).toBe(false);
    expect((await control("[data-targeted-cancel-run]"))?.text).toBe(copy("en", "targetedCancelRun"));
    expect(await work(beforeRun)).toEqual([
      { command: "begin_project_job", args: {} },
      { command: "run_targeted_ms1", args: { operationId: OPERATION, planSha256: SHAS[0] } },
    ]);

    await releaseInvokeHold("run_targeted_ms1");
    await browser.$(`${BLOCK}[data-targeted-run-block="completed"]`).waitForDisplayed();
    const ended = await frame("t1-completed-en-1920x1080");
    expect(ended.setupText).toContain(copy("en", "targetedLastCompleted"));
    // One filled primary: the result. Running the same plan again is secondary and says so.
    expect(ended.filled).toEqual([copy("en", "targetedBatchOpenResult")]);
    expect(await control(RUN)).toMatchObject({ text: copy("en", "targetedRunAgain"), primary: false });
    expect(ended.setupText).toContain(copy("en", "targetedRunAgainNote"));
    // The block outlived its run: the keyboard is still on its heading. (A
    // stop control leaving is T5's.)
    expect(await focusedOn(`${BLOCK} h4`)).toBe(true);

    const beforeOpen = await callCount();
    await keyPress(`[data-targeted-open-result="${ARTIFACTS[0]}"]`, "Enter");
    await browser.waitUntil(() => focusedOn(`[data-targeted-report="${ARTIFACTS[0]}"] h3`), {
      timeoutMsg: "Open result did not take the keyboard to the result's heading",
    });
    // The handoff reads; it starts nothing.
    expect(await work(beforeOpen)).toEqual([]);
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("PM9.5-T2 a refused line, the way back to it, and a fresh review (R3, R4, R10; path 2)", async () => {
    await open(targetedTable("en"), "en", 1366, 768);
    await openSetup();
    const invalid = "Caffeine, C8H10N4O2, 120, 30\n# checked by hand\nBad, C8H10N4O2X, abc, 30";
    await typeInto("[data-targeted-ppm]", "60");
    await typeInto("[data-targeted-text]", invalid);
    await reviewWith(
      problemsReview([
        { row: 2, field: "formula", problem: "invalid" },
        { row: 2, field: "rtS", problem: "invalid" },
        { row: null, field: "mzHalfWidthPpm", problem: "outOfRange" },
      ]),
    );
    // What needs fixing comes first, at the line it was typed on.
    expect(await inOrder([`${AREA} h4`, "[data-targeted-problems]", "[data-targeted-engine]"])).toBe(true);
    const rows = await browser.execute(() =>
      [...document.querySelectorAll<HTMLElement>("[data-targeted-problems] tbody tr")].map((row) =>
        row.innerText.replace(/\s+/gu, " ").trim(),
      ),
    );
    const line3 = copy("en", "targetedWhereLine", { line: "3" });
    expect(rows).toEqual([
      `${line3} ${en.targetedFieldFormula} ${en.targetedProblemInvalid}`,
      `${line3} ${en.targetedFieldRt} ${en.targetedProblemInvalid}`,
      `${en.targetedWhereParameters} ${en.targetedFieldMzHalfWidth} ${en.targetedProblemOutOfRange}`,
    ]);
    expect(await control(RUN)).toMatchObject({ refused: true, described: [copy("en", "targetedRunFixProblems")] });
    await frame("t2-problems-en-1366x768");

    // The line's own control takes the keyboard to that line, selected.
    await keyPress('[data-targeted-problem-line="3"]', "Enter");
    const selection = await browser.execute(() => {
      const area = document.activeElement as HTMLTextAreaElement | null;
      return area?.tagName !== "TEXTAREA" ? null : area.value.slice(area.selectionStart, area.selectionEnd);
    });
    expect(selection).toBe("Bad, C8H10N4O2X, abc, 30");

    // Correcting withdraws the review, and Run says why it waits.
    await typeInto("[data-targeted-ppm]", "5");
    expect(await exists(AREA)).toBe(false);
    expect(await control(RUN)).toMatchObject({ refused: true, described: [copy("en", "targetedRunChanged")] });
    await typeInto("[data-targeted-text]", "Caffeine, C8H10N4O2, 120, 30\n# checked by hand\nAbsent, C9H9NO4, 300, 30");
    const beforeFresh = await callCount();
    await reviewWith(planReview(0));
    await browser.$(`${AREA} [data-targeted-plan]`).waitForDisplayed();
    expect(await work(beforeFresh)).toEqual([
      {
        command: "resolve_targeted_ms1_plan",
        args: { request: { layerId: LAYERS[0], mzHalfWidthPpm: "5", expectedPeakWidthS: "6", targets: SENT_TARGETS } },
      },
    ]);
    expect(await control(RUN)).toMatchObject({ refused: false, primary: true });
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("PM9.5-T3 no stale ready view after an edit or a changed choice (R4; path 3)", async () => {
    await open(targetedTable("en"), "en", 1366, 768);
    await openSetup();
    await typeInto("[data-targeted-text]", TYPED);
    await reviewWith(planReview(0));
    expect(await control(RUN)).toMatchObject({ refused: false });

    await typeInto("[data-targeted-width]", "8");
    expect(await exists(AREA)).toBe(false);
    expect(await control(RUN)).toMatchObject({ refused: true, described: [copy("en", "targetedRunChanged")] });
    const before = await callCount();
    await keyPress(RUN, "Enter");
    await keyPress(RUN, "Space");
    await browser.$(RUN).click();
    expect(await work(before)).toEqual([]);

    // Run counts what it would run, from the chosen acquisitions.
    await toggleMembers([LAYERS[1]]);
    expect(await control(RUN)).toMatchObject({ text: copy("en", "targetedRunBatch", { count: 2 }), refused: true });
    await frame("t3-changed-en-1366x768");
    await toggleMembers([LAYERS[1]]);
    expect((await control(RUN))?.text).toBe(copy("en", "targetedRun"));
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("PM9.5-T4 an independent batch ending mixed, an all-negative member included (R8; path 4, 9)", async () => {
    await open(targetedTable("en"), "en", 1366, 768);
    await openSetup();
    await toggleMembers([LAYERS[1], LAYERS[2]]);
    await typeInto("[data-targeted-text]", TYPED);
    await keyPress(REVIEW, "Enter");
    await browser.$("[data-targeted-batch-members]").waitForDisplayed();
    expect(await inOrder([REVIEW, AREA, "[data-targeted-batch-members]", RUN])).toBe(true);
    expect(await control(RUN)).toMatchObject({ text: copy("en", "targetedRunBatch", { count: 3 }), refused: false, primary: true });

    await setInvokeResult("get_targeted_ms1_progress", batchProgress());
    await holdInvoke("run_targeted_ms1_batch");
    const beforeRun = await callCount();
    await keyPress(RUN, "Enter");
    await browser.$(`${BATCH}[data-targeted-batch="running"] [data-state="running"]`).waitForDisplayed();
    const running = await frame("t4-batch-running-en-1366x768");
    expect(ESTIMATE.test(running.setupText)).toBe(false);
    // Nothing of a member is offered while the batch runs.
    expect(await exists("[data-targeted-batch-open], [data-targeted-batch-run]")).toBe(false);
    expect(await work(beforeRun)).toEqual([
      { command: "begin_project_job", args: {} },
      { command: "run_targeted_ms1_batch", args: { operationId: OPERATION, planSha256s: SHAS } },
    ]);

    await releaseInvokeHold("run_targeted_ms1_batch");
    await browser.$(`${BATCH}[data-targeted-batch="ended"]`).waitForDisplayed();
    const states = await browser.execute(() =>
      [...document.querySelectorAll("[data-targeted-batch-member]")].map((row) => row.getAttribute("data-state")),
    );
    expect(states).toEqual(["completed", "failed", "completed"]);
    const failedRow = await text(`[data-targeted-batch-member="${LAYERS[1]}"]`);
    expect(failedRow).toContain(en.targetedFailureSourceChanged);
    expect(failedRow).not.toContain(en.targetedOutcomeNotDetected);
    expect(await text("[data-targeted-batch-summary]")).toBe(
      `${copy("en", "targetedBatchCountCompleted", { count: 2, total: 3 })} · ${copy("en", "targetedBatchCountFailed", { count: 1 })}`,
    );
    const ended = await frame("t4-batch-mixed-en-1366x768");
    // The same three again is a secondary action that says what it does.
    expect(ended.filled).toEqual([]);
    expect(await control(RUN)).toMatchObject({ text: copy("en", "targetedRunBatchAgain", { count: 3 }), primary: false });
    expect(ended.setupText).toContain(copy("en", "targetedRunBatchAgainNote"));

    // The ending belongs to the setup that ran it: an edit withdraws only the review.
    await toggleMembers([LAYERS[2]]);
    expect(await exists(AREA)).toBe(false);
    expect(await browser.$$("[data-targeted-batch-member]").length).toBe(3);

    // The all-negative member completed: its own result, every target not detected.
    await setInvokeResult("read_targeted_ms1_rows", NEGATIVE_ROWS);
    await keyPress(`[data-targeted-batch-open="${ARTIFACTS[2]}"]`, "Enter");
    await browser.$(`[data-targeted-report="${ARTIFACTS[2]}"] [data-targeted-row]`).waitForDisplayed();
    expect(
      await browser.execute(() => [...document.querySelectorAll("[data-targeted-row]")].map((row) => row.getAttribute("data-outcome"))),
    ).toEqual(["NOT_DETECTED", "NOT_DETECTED"]);
    expect(await focusedOn(`[data-targeted-report="${ARTIFACTS[2]}"] h3`)).toBe(true);
    // The failed member's run, shown where runs are inspected.
    await keyPress(`[data-targeted-batch-run="${RUNS[1]}"]`, "Enter");
    expect(await browser.$(`[data-project-inspect-run="${RUNS[1]}"]`).getAttribute("aria-current")).toBe("true");
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("PM9.5-T5 stopping: requested, then what ended, with no run for what never started (R6, R7, R9; path 5)", async () => {
    // One run, cancelled from beside it.
    await open(targetedTable("en"), "en", 1366, 768);
    await openSetup();
    await typeInto("[data-targeted-text]", TYPED);
    await reviewWith(planReview(0));
    await holdInvoke("run_targeted_ms1");
    await keyPress(RUN, "Enter");
    await browser.$(`${BLOCK}[data-targeted-run-block="running"]`).waitForDisplayed();
    const beforeStop = await callCount();
    await keyPress("[data-targeted-cancel-run]", "Enter");
    await keyPress("[data-targeted-cancel-run]", "Enter");
    expect(await work(beforeStop)).toEqual([{ command: "cancel_project_job", args: { operationId: OPERATION } }]);
    expect(await control("[data-targeted-cancel-run]")).toMatchObject({ text: copy("en", "targetedStopRequested"), refused: true });
    expect((await control("[data-project-cancel]"))?.text).toBe(copy("en", "targetedStopRequested"));
    // Requested, not observed: the run is still said to be running.
    expect(await exists(`${BLOCK}[data-targeted-run-block="running"]`)).toBe(true);
    await frame("t5-stop-requested-en-1366x768");
    await setInvokeResult("run_targeted_ms1", singleEnd(0, "cancelled"));
    await releaseInvokeHold("run_targeted_ms1");
    await browser.$(`${BLOCK}[data-targeted-run-block="cancelled"]`).waitForDisplayed();
    expect(await text(`${BLOCK} [data-targeted-last]`)).toBe(copy("en", "targetedLastCancelled"));
    expect(await exists(`[data-targeted-show-run="${RUNS[0]}"]`)).toBe(true);
    expect(await exists("[data-targeted-open-result]")).toBe(false);
    expect(await focusedOn(`${BLOCK} h4`)).toBe(true);
    expect(await browser.$(`[data-project-run="${RUNS[0]}"]`).getAttribute("data-outcome")).toBe("cancelled");

    // A batch, stopped while its second member ran.
    await open(targetedTable("en"), "en", 1366, 768);
    await openSetup();
    await toggleMembers([LAYERS[1], LAYERS[2]]);
    await typeInto("[data-targeted-text]", TYPED);
    await keyPress(REVIEW, "Enter");
    await browser.$("[data-targeted-batch-members]").waitForDisplayed();
    await setInvokeResult("get_targeted_ms1_progress", batchProgress());
    await setInvokeResult("run_targeted_ms1_batch", stoppedBatchEnd());
    await holdInvoke("run_targeted_ms1_batch");
    await keyPress(RUN, "Enter");
    await browser.$(`${BATCH}[data-targeted-batch="running"] [data-state="running"]`).waitForDisplayed();
    const beforeBatchStop = await callCount();
    await keyPress("[data-targeted-batch-stop]", "Enter");
    expect(await work(beforeBatchStop)).toEqual([{ command: "cancel_project_job", args: { operationId: OPERATION } }]);
    expect(await control("[data-targeted-batch-stop]")).toMatchObject({ text: copy("en", "targetedStopRequested"), refused: true });
    expect((await control("[data-project-cancel]"))?.text).toBe(copy("en", "targetedStopRequested"));
    await releaseInvokeHold("run_targeted_ms1_batch");
    await browser.$(`${BATCH}[data-targeted-batch="ended"]`).waitForDisplayed();
    expect(
      await browser.execute(() => [...document.querySelectorAll("[data-targeted-batch-member]")].map((row) => row.getAttribute("data-state"))),
    ).toEqual(["completed", "cancelled", "notStarted"]);
    // Never started: no run on the panel and none in the history.
    expect(await exists(`[data-targeted-batch-member="${LAYERS[2]}"] button`)).toBe(false);
    expect(await exists(`[data-project-run="${RUNS[2]}"]`)).toBe(false);
    expect(await focusedOn(`${BATCH} h4`)).toBe(true);
    await frame("t5-batch-stopped-en-1366x768");
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("PM9.5-T6 a runtime-blocked plan and a refused review, said where they were asked (R4, R5; path 6)", async () => {
    await open(targetedTable("en"), "en", 1366, 768);
    await openSetup();
    await typeInto("[data-targeted-text]", TYPED);
    await reviewWith(planReview(0, "recipeUnavailable"));
    expect(await text("[data-targeted-blocked]")).toBe(en.projectRefusedRecipeUnavailable);
    expect(await control(RUN)).toMatchObject({ refused: true, described: [en.projectRefusedRecipeUnavailable] });
    const before = await callCount();
    await keyPress(RUN, "Enter");
    await keyPress(RUN, "Space");
    expect(await work(before)).toEqual([]);
    await frame("t6-runtime-blocked-en-1366x768");

    await setInvokeRejection("resolve_targeted_ms1_plan", {
      kind: "recipeSourceUnsupported",
      summary: "recipeSourceUnsupported",
      detail: null,
      retryable: false,
    });
    await keyPress(REVIEW, "Enter");
    await browser.$('[data-targeted-review-refused="recipeSourceUnsupported"]').waitForDisplayed();
    expect(await text('[data-targeted-review-refused="recipeSourceUnsupported"]')).toBe(en.projectRefusedRecipeSourceUnsupported);
    expect(await exists('[data-project-problem="recipeSourceUnsupported"]')).toBe(true);
    expect(await exists("[data-targeted-plan]")).toBe(false);
    await frame("t6-review-refused-en-1366x768");
    // An edit is a new request: the refusal of the old one is withdrawn.
    await typeInto("[data-targeted-text]", `${TYPED}\n`);
    expect(await exists("[data-targeted-review-refused]")).toBe(false);
    expect(await exists("[data-project-problem]")).toBe(false);
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("PM9.5-T7 answers that arrive after navigation or closing, and a replaced project (R11; path 7)", async () => {
    const table = targetedTable("en");
    table.open_project = { ...project(), projectId: "aaaaaaaa-9595-4111-8111-000000000002", name: "Plasma batch 10" };
    await open(table, "en", 1366, 768);
    await openSetup();
    await typeInto("[data-targeted-text]", TYPED);

    // Away and back while the review is out: it lands in the same setup.
    await holdInvoke("resolve_targeted_ms1_plan");
    const beforeTrip = await callCount();
    await keyPress(REVIEW, "Enter");
    await navigate(en.workbench);
    await navigate(en.projectSurface);
    await releaseInvokeHold("resolve_targeted_ms1_plan");
    await browser.$(`${AREA} [data-targeted-plan]`).waitForDisplayed();
    expect((await work(beforeTrip)).map((call) => call.command)).toEqual(["resolve_targeted_ms1_plan"]);

    // Closed while the review is out: nothing populates, and the draft is kept.
    await typeInto("[data-targeted-width]", "7");
    await holdInvoke("resolve_targeted_ms1_plan");
    await keyPress(REVIEW, "Enter");
    await browser.$("[data-targeted-close]").click();
    expect(await exists(SETUP)).toBe(false);
    await releaseInvokeHold("resolve_targeted_ms1_plan");
    await frames();
    expect(await exists(SETUP)).toBe(false);
    await openSetup();
    expect(await browser.$("[data-targeted-text]").getValue()).toBe(TYPED);
    expect(await browser.$("[data-targeted-width]").getValue()).toBe("7");
    expect(await exists(AREA)).toBe(false);

    // Another project: the setup closes and its draft goes with the project.
    await browser.execute((label: string) => {
      [...document.querySelectorAll<HTMLButtonElement>(".project-header button")]
        .find((button) => (button.textContent ?? "").trim() === label)
        ?.click();
    }, en.projectOpen);
    await browser.$("h2=Plasma batch 10").waitForDisplayed();
    expect(await exists(SETUP)).toBe(false);
    await openSetup();
    expect(await browser.$("[data-targeted-text]").getValue()).toBe("");
    expect(await browser.$("[data-targeted-width]").getValue()).toBe("6");
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("PM9.5-T8 the keyboard path, refused presses and a held Close (R4, R6, R9; path 8)", async () => {
    await open(targetedTable("en"), "en", 1366, 768);
    await openSetup();
    // Nothing typed: Review is a Tab stop that says why and sends nothing.
    expect(await control(REVIEW)).toMatchObject({ refused: true, disabled: false, described: [copy("en", "targetedReviewNeedsTargets")] });
    const before = await callCount();
    await keyPress(REVIEW, "Enter");
    await keyPress(REVIEW, "Space");
    expect(await work(before)).toEqual([]);
    await toggleMembers([LAYERS[0]]);
    expect(await control(REVIEW)).toMatchObject({ refused: true, described: [copy("en", "targetedReviewNeedsAcquisition")] });
    await toggleMembers([LAYERS[0]]);

    await typeInto("[data-targeted-text]", TYPED);
    await reviewWith(planReview(0));
    // From Review plan, through the review, to Run.
    expect(await tabTo(REVIEW, RUN)).toBe(true);
    expect(await onScreen(RUN)).toBe(true);

    // While the run is out, Close is held and says why.
    await holdInvoke("run_targeted_ms1");
    await keyPress(RUN, "Enter");
    await browser.$(`${BLOCK}[data-targeted-run-block="running"]`).waitForDisplayed();
    expect(await control("[data-targeted-close]")).toMatchObject({ refused: true, described: [copy("en", "targetedRunInProgressTitle")] });
    await keyPress("[data-targeted-close]", "Enter");
    expect(await exists(SETUP)).toBe(true);
    await releaseInvokeHold("run_targeted_ms1");
    await browser.$(`${BLOCK}[data-targeted-run-block="completed"]`).waitForDisplayed();
    expect(await unexpectedConsole()).toEqual([]);
  });

  for (const locale of ["en", "zh-CN"] as const) {
    it(`PM9.5-T9 the task at the anchors, at its bounds and at review points, in ${locale} (R12)`, async () => {
      const judged: Record<string, unknown>[] = [];
      const judge = (label: string, seen: Awaited<ReturnType<typeof frame>>, filled: number) =>
        judged.push({
          label,
          lang: seen.lang,
          overflow: seen.horizontalOverflow,
          estimate: ESTIMATE.test(seen.setupText),
          filled: seen.filled.length,
          expectedFilled: filled,
          small: seen.small,
        });
      const anchors = [
        [1920, 1080],
        [1366, 768],
        [960, 640],
      ] as const;
      for (const [width, height] of anchors) {
        const size = `${String(width)}x${String(height)}`;
        await open(targetedTable(locale), locale, width, height);
        await openSetup();
        // The first screen of the task, as the row's control opens it.
        judge(`opened ${size}`, await frame(`t9-opened-${locale}-${size}`), 0);
        await typeInto("[data-targeted-text]", TYPED);
        await reviewWith(problemsReview([{ row: 2, field: "formula", problem: "invalid" }]));
        judge(`input-error ${size}`, await frame(`t9-input-error-${locale}-${size}`), 0);
        await reviewWith(planReview(0));
        judge(`ready ${size}`, await frame(`t9-ready-${locale}-${size}`), 1);
        if (width === 960) {
          const wheel = await wheelTo(RUN);
          await frame(`t9-ready-${locale}-${size}-wheeled-to-run`);
          const tab = await tabTo(REVIEW, RUN);
          judged.push({ label: `reach ${size}`, wheel, tab, focusedOnScreen: await onScreen(RUN) });
        }
        await toggleMembers([LAYERS[1], LAYERS[2]]);
        await keyPress(REVIEW, "Enter");
        await browser.$("[data-targeted-batch-members]").waitForDisplayed();
        await setInvokeResult("get_targeted_ms1_progress", batchProgress());
        await setInvokeResult("run_targeted_ms1_batch", stoppedBatchEnd());
        await holdInvoke("run_targeted_ms1_batch");
        await keyPress(RUN, "Enter");
        await browser.$(`${BATCH}[data-targeted-batch="running"] [data-state="running"]`).waitForDisplayed();
        judge(`batch-running ${size}`, await frame(`t9-batch-running-${locale}-${size}`), 0);
        await releaseInvokeHold("run_targeted_ms1_batch");
        await browser.$(`${BATCH}[data-targeted-batch="ended"]`).waitForDisplayed();
        const stopped = await frame(`t9-batch-ended-${locale}-${size}`);
        judge(`batch-ended ${size}`, stopped, 0);
        // A member's action stays on one line.
        judged.push({
          label: `batch-actions ${size}`,
          heights: await browser.execute(() =>
            [...document.querySelectorAll<HTMLElement>("[data-targeted-batch-open], [data-targeted-batch-run]")].map(
              (button) => Math.round(button.getBoundingClientRect().height),
            ),
          ),
        });
        // One acquisition again: its review, its run, its ending.
        await toggleMembers([LAYERS[1], LAYERS[2]]);
        await reviewWith(planReview(0));
        await keyPress(RUN, "Enter");
        await browser.$(`${BLOCK}[data-targeted-run-block="completed"]`).waitForDisplayed();
        judge(`single-ended ${size}`, await frame(`t9-single-ended-${locale}-${size}`), 1);
      }

      if (locale === "en") {
        for (const [width, height] of [
          [1280, 720],
          [1536, 864],
          [2560, 1440],
        ] as const) {
          const size = `${String(width)}x${String(height)}`;
          await open(targetedTable(locale), locale, width, height);
          await openSetup();
          await typeInto("[data-targeted-text]", TYPED);
          await reviewWith(planReview(0));
          judge(`ready ${size}`, await frame(`t9-ready-${locale}-${size}`), 1);
          await toggleMembers([LAYERS[1], LAYERS[2]]);
          await keyPress(REVIEW, "Enter");
          await browser.$("[data-targeted-batch-members]").waitForDisplayed();
          await keyPress(RUN, "Enter");
          await browser.$(`${BATCH}[data-targeted-batch="ended"]`).waitForDisplayed();
          judge(`batch-ended ${size}`, await frame(`t9-batch-ended-${locale}-${size}`), 0);
        }
      }

      // The bounds: 200 targets, then 16 acquisitions, in the narrow window.
      await open(targetedTable(locale), locale, 960, 640);
      await openSetup();
      await typeInto("[data-targeted-text]", manyTyped(MAX_TARGETS));
      await reviewWith(manyPlanReview(MAX_TARGETS));
      expect(await text(AREA)).toContain(copy(locale, "targetedPlanCaption", { count: MAX_TARGETS, ppm: "5", width: "6" }));
      judge("200-targets 960x640", await frame(`t9-200-targets-${locale}-960x640`), 1);
      judged.push({
        label: "200-targets reach",
        wheel: await wheelTo(RUN),
        tab: await tabTo(REVIEW, RUN),
        focusedOnScreen: await onScreen(RUN),
      });
      // The 200th target, inside the plan's own scroller.
      judged.push({
        label: "200-targets inside",
        ...(await scrollsInside("[data-targeted-plan]", `t9-200-targets-${locale}-960x640-last-row`)),
      });

      const wide = targetedTable(locale, wideProject(MAX_MEMBERS));
      wide.resolve_targeted_ms1_batch = wideBatchReview(MAX_MEMBERS);
      await open(wide, locale, 960, 640);
      await openSetup();
      await toggleMembers(wideLayers(MAX_MEMBERS).slice(1));
      await typeInto("[data-targeted-text]", TYPED);
      await keyPress(REVIEW, "Enter");
      await browser.$(`[data-targeted-batch-members="${String(MAX_MEMBERS)}"]`).waitForDisplayed();
      expect((await control(RUN))?.text).toBe(copy(locale, "targetedRunBatch", { count: MAX_MEMBERS }));
      judge("16-members 960x640", await frame(`t9-16-members-${locale}-960x640`), 1);
      judged.push({
        label: "16-members reach",
        wheel: await wheelTo(RUN),
        tab: await tabTo(REVIEW, RUN),
        focusedOnScreen: await onScreen(RUN),
      });
      // The 16th acquisition, inside the members' own scroller.
      judged.push({
        label: "16-members inside",
        ...(await scrollsInside("[data-targeted-batch-members]", `t9-16-members-${locale}-960x640-last-row`)),
      });

      evidence.push({ label: `t9-${locale}-judged`, judged });
      const failures = judged.filter((each) =>
        "lang" in each
          ? each.lang !== locale || (each.overflow as number) > 1 || each.estimate || each.filled !== each.expectedFilled || (each.small as unknown[]).length > 0
          : "heights" in each
            ? (each.heights as number[]).some((height) => height > 34)
            : "keyboard" in each
              ? !(each.overflows && each.wheel && each.tabbed && each.keyboard)
              : !(each.wheel && each.tab && each.focusedOnScreen),
      );
      expect(failures).toEqual([]);
      expect(await unexpectedConsole()).toEqual([]);
    });
  }
});
