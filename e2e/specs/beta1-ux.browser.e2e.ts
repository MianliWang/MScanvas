/**
 * Beta 1 -- the carried-forward presentation changes, rendered: PM9.7 F2/F3,
 * PM9.4 O1-O8 (O7's plan half) and PM9.5 O1-O4
 * (`docs/development/POST_PM9_DEFERRED_WORK.md`).
 *
 * The real production composition in real Chrome over the real Vite dev
 * server, with only `window.__TAURI_INTERNALS__.invoke` replaced. Every answer
 * is a controlled fixture: no file was read, no dialog opened, no provider or
 * engine ran. Layout, focus and keyboard evidence at DPR 1, not native
 * scaling, and not what a screen reader says.
 *
 * Copy is read from the bundles by key, so a case holds the semantics rather
 * than one wording. Each state leaves a viewport screenshot in
 * `.tmp/beta1-runs/ux/` before it is judged.
 */
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { metrics } from "../support/cdp";
import { CONVERT, CONVERSION_SURFACE, checkMembers, isRefused, showConversion, waitUntilOffered } from "../support/conversion";
import {
  ALLOWED_CONSOLE_SUBSTRINGS,
  IPC_TABLE_KEY,
  consoleEntries,
  holdInvoke,
  installIpcBoundary,
  ipcCalls,
  releaseInvokeHold,
  setInvokeRejection,
  setInvokeResult,
} from "../support/harness";
import { EMPTY_ROSTER, NO_PROJECT, scenario } from "../support/pm9Scenarios";
import { LAYERS, RUNS, TYPED, singleEnd, targetedTable, type Locale } from "../support/targeted";
import { readBackSavedPreferences } from "../support/viewer";
import {
  admittedIntents,
  availableBackend,
  completeCatalog,
  finalizedAttemptFacts,
  outputSetReport,
  queueItem,
  queueOf,
  sciexQueueItem,
  settledAt,
  shippedIntent,
} from "../../apps/desktop/src/test/previewFixtures";
import type { SelectedFile } from "../../apps/desktop/src/features/mzml-preview/contracts";
import { en } from "../../apps/desktop/src/features/preferences/locales/en";
import { zhCN } from "../../apps/desktop/src/features/preferences/locales/zh-CN";

const OUTPUT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", ".tmp", "beta1-runs", "ux");
const LOCALES: readonly Locale[] = ["en", "zh-CN"];
const BUNDLES = { en, "zh-CN": zhCN } as const;

// ---------------------------------------------------------------- words

/** One resource, by key. A key the bundle does not hold is a failure, not a blank. */
function word(locale: Locale, key: string): string {
  const value = (BUNDLES[locale] as Record<string, unknown>)[key];
  if (typeof value !== "string") throw Error(`the ${locale} bundle has no resource ${key}`);
  return value;
}

/** A resource with its `{{values}}` filled and its nested `$t(key)` labels resolved. */
function say(locale: Locale, key: string, values: Record<string, string | number> = {}): string {
  return word(locale, key)
    .replace(/\$t\((\w+)\)/gu, (_, nested: string) => word(locale, nested))
    // A `{{count, number}}` placeholder formats the number (the counts here stay below 1,000).
    .replace(/\{\{(\w+)(?:, number)?\}\}/gu, (_, name: string) => String(values[name] ?? `{{${name}}}`));
}

// ---------------------------------------------------------------- the world

const ROSTER_TOGGLE = '[aria-controls="workbench-roster"]';
const DESCRIBE = "describe_workspace_conversion_queue";
const BEGIN = "begin_workspace_conversion_queue";
const CHOOSE = "choose_workspace_conversion_destination";
const AUTHORITY = settledAt(1, 1);
const OPERATION = "beta1-queue";

const raw = (index: number, fileName: string): SelectedFile => ({
  handle: `raw-${String(index)}`,
  fileName,
  byteLength: index * 52_428_800,
  sourceKind: "thermo_raw",
  relativeContext: null,
});
const FIRST = raw(1, "QC_pool_01.raw");
const SECOND = raw(2, "Plasma_QC_batch_08_replicate_04_long_acquisition.raw");
const THIRD = raw(3, "Blank_03.raw");
const OPEN: SelectedFile = { handle: "open", fileName: "reference_run.mzML", byteLength: 4_194_304, sourceKind: "mzml", relativeContext: null };
const LONG: SelectedFile = {
  handle: "open-long",
  fileName: `${"Calibration_reference_".repeat(6)}pool.mzML`,
  byteLength: 2_097_152,
  sourceKind: "mzml",
  relativeContext: null,
};
const WIFF: SelectedFile = { handle: "wiff-1", fileName: "set_run.wiff", byteLength: 1_048_576, sourceKind: "sciex_wiff", relativeContext: null };
const VENDOR_AND_MZML: readonly SelectedFile[] = [FIRST, SECOND, THIRD, OPEN, LONG];
const FIRST_OUTPUT = { outputId: "beta1-output-1", fileName: "QC_pool_01.mzML" };

function slot(sequence: number, state: unknown) {
  return {
    sequence,
    state,
    diagnostics: { eligibleItemCount: 0, available: false, exporting: false, lastExport: null },
    backendQuarantined: false,
    authority: AUTHORITY,
  };
}

/** A Convert of the first two rows under way: the first converting, the second waiting. */
const STARTED = {
  status: "running",
  operationId: OPERATION,
  queue: queueOf([queueItem(FIRST.handle, FIRST.fileName, { state: "running", attempts: 1 }), queueItem(SECOND.handle, SECOND.fileName)]),
};

/** Finished: one output to add, and one failure whose owned staging can be cleaned. */
const RECOVERABLE = {
  status: "terminal",
  reason: "completed",
  operationId: OPERATION,
  queue: queueOf([
    queueItem(FIRST.handle, FIRST.fileName, { state: "finalized", attempts: 1, finalizedOutputs: [FIRST_OUTPUT], ...finalizedAttemptFacts() }),
    queueItem(SECOND.handle, SECOND.fileName, {
      state: "failed",
      attempts: 1,
      stagingRecovery: { recoveryId: "beta1-staging-2", attempt: 1, status: "recoverable" },
    }),
  ]),
};

/** A SCIEX set that finalized all four members, each paired with its own Open actions. */
const SET_NAMES = ["set_run-01.mzML", "set_run-02.mzML", "set_run-03.mzML", "set_run-04.mzML"];
const SET_DONE = {
  status: "terminal",
  reason: "completed",
  operationId: OPERATION,
  queue: queueOf([
    sciexQueueItem(WIFF.handle, WIFF.fileName, {
      state: "finalized",
      attempts: 1,
      finalizedOutputs: SET_NAMES.map((fileName, index) => ({ outputId: `beta1-set-${String(index)}`, fileName })),
      result: { kind: "outputSet", report: outputSetReport(WIFF.handle, SET_NAMES) },
      ...finalizedAttemptFacts(),
    }),
  ]),
};

const ADOPTED_ROW: SelectedFile = { handle: "adopted-1", fileName: FIRST_OUTPUT.fileName, byteLength: 1_048_576, sourceKind: "mzml", relativeContext: null };

/** The conversion surface over `rows`, with a ready configuration and the queue `state`. */
function conversionWorld(locale: Locale, rows: readonly SelectedFile[], state: unknown = { status: "idle" }): Record<string, unknown> {
  const table = scenario("populated", locale);
  table.inspect_backend = { ...availableBackend, authority: AUTHORITY };
  table.get_workspace_roster = { datasets: rows, capacity: 1024 };
  table.get_project_state = NO_PROJECT;
  table.read_conversion_configuration = {
    authority: AUTHORITY,
    configuration: { configuration: "ready", catalog: completeCatalog, shipped: shippedIntent.id },
    outcome: { outcome: "answered" },
  };
  table.get_workspace_conversion_state = slot(state === null || (state as { status: string }).status === "idle" ? 0 : 1, state);
  table.begin_workspace_conversion_queue = { authority: AUTHORITY, outcome: { outcome: "reserved", reservation: { reservationId: "beta1-reservation" } } };
  table.choose_workspace_conversion_destination = slot(1, STARTED);
  table.open_finalized_output = { status: "accepted" };
  table.adopt_workspace_conversion_outputs = {
    operationId: OPERATION,
    retryRound: 0,
    roster: { datasets: [...rows, ADOPTED_ROW], capacity: 1024 },
    outcomes: [{ kind: "added", itemIndex: 0, memberIndex: 0, sourceHandle: FIRST.handle, outputFileName: FIRST_OUTPUT.fileName, dataset: ADOPTED_ROW }],
  };
  return table;
}

/** The shell with nothing in it: no acquisition and no project. */
function emptyTable(locale: Locale): Record<string, unknown> {
  const table = scenario("populated", locale);
  table.get_workspace_roster = EMPTY_ROSTER;
  table.get_project_state = NO_PROJECT;
  return table;
}

/**
 * Answers each plan question for what it names, as Rust's describe does (the
 * PM9.4 spec's boundary, unchanged): the rows asked for, in the order asked,
 * under the policies asked for. Test boundary only.
 */
async function answerPlans(rows: readonly SelectedFile[]) {
  await browser.execute(
    (tableKey: string, known: readonly SelectedFile[], intents: readonly { id: string }[], command: string) => {
      const table = Reflect.get(window, tableKey) as Record<string, unknown>;
      const internals = Reflect.get(window, "__TAURI_INTERNALS__") as {
        invoke: (name: string, args: Record<string, unknown>, ...rest: unknown[]) => Promise<unknown>;
      };
      const invoke = internals.invoke;
      internals.invoke = (name, args, ...rest) => {
        if (name === command) {
          const request = args["request"] as {
            handles: string[];
            intentId: string;
            conflictPolicy: string;
            destinationPolicy: unknown;
            expectedReceipt: number;
          };
          table[name] = {
            outcome: "planned",
            plan: {
              items: request.handles.map((handle) => {
                const row = known.find((candidate) => candidate.handle === handle)!;
                return {
                  datasetHandle: handle,
                  fileName: row.fileName,
                  sourceKind: row.sourceKind,
                  output: { kind: "knownSingle", fileName: row.fileName.replace(/\.raw$/u, ".mzML") },
                };
              }),
              outputFormat: "mzML",
              compression: "zlib",
              validationMode: "output_only",
              capacity: 16,
              intent: intents.find((intent) => intent.id === request.intentId),
              conflictPolicy: request.conflictPolicy,
              destinationPolicy: request.destinationPolicy,
              receipt: request.expectedReceipt,
            },
          };
        }
        return invoke(name, args, ...rest);
      };
    },
    IPC_TABLE_KEY,
    rows,
    admittedIntents,
    DESCRIBE,
  );
}

// ---------------------------------------------------------------- driving

async function frames() {
  await browser.execute(
    () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
}

/** Opens the page on `table` at a logical viewport, in `locale`. */
async function open(table: Record<string, unknown>, locale: Locale, width: number, height: number) {
  await metrics(width, height);
  await installIpcBoundary(table);
  await browser.url("/");
  await browser.$(".workbench-header").waitForDisplayed({ timeout: 30_000 });
  await browser.waitUntil(() => browser.execute((lang: string) => document.documentElement.lang === lang, locale));
  await readBackSavedPreferences();
}

async function navigate(name: string) {
  const found = await browser.execute((label: string) => {
    const target = [...document.querySelectorAll<HTMLButtonElement>(".workbench-navigation > button")]
      .find((button) => (button.textContent ?? "").trim() === label);
    target?.click();
    return target !== undefined;
  }, name);
  // Workbench, Conversion and Project are all header tabs (direction A).
  if (!found) throw new Error(`no header tab named ${name}`);
  await frames();
}

/** A viewport screenshot, taken before the frame is judged. */
async function shot(name: string) {
  await frames();
  await browser.saveScreenshot(join(OUTPUT, `${name}.png`));
}

/**
 * The shown button inside `scope` whose name is `name`, marked so WebDriver can
 * address it. The name is its trimmed text or its `aria-label` (a row's short
 * "Skip" is named "Skip <file>").
 */
async function mark(scope: string, name: string, tag: string): Promise<string | null> {
  return browser.execute(
    (css: string, label: string, attribute: string) => {
      document.querySelectorAll(`[${attribute}]`).forEach((node) => node.removeAttribute(attribute));
      const button = [...document.querySelectorAll<HTMLButtonElement>(`${css} button`)].find(
        (candidate) => [candidate.getAttribute("aria-label"), (candidate.textContent ?? "").trim()].includes(label)
          && candidate.getClientRects().length > 0,
      );
      if (button === undefined) return null;
      button.setAttribute(attribute, "");
      return `[${attribute}]`;
    },
    scope,
    name,
    tag,
  );
}

async function focusedOn(selector: string): Promise<boolean> {
  return browser.execute((css: string) => {
    const element = document.querySelector(css);
    return element !== null && document.activeElement === element;
  }, selector);
}

/** Presses Tab from `from` until `to` has focus; the number of presses, or null if never. */
async function tabsTo(to: string, from = ".workbench-home", limit = 60): Promise<number | null> {
  await browser.execute((css: string) => document.querySelector<HTMLElement>(css)?.focus(), from);
  for (let presses = 0; presses <= limit; presses += 1) {
    if (await focusedOn(to)) return presses;
    await browser.keys(["Tab"]);
  }
  return null;
}

/** Focuses a control by script and presses a key on it, as a keyboard user does. */
async function keyPress(selector: string, key: "Enter" | "Space") {
  const focused = await browser.execute((css: string) => {
    const element = document.querySelector<HTMLElement>(css);
    element?.focus();
    return element !== null && document.activeElement === element;
  }, selector);
  expect({ selector, focused }).toEqual({ selector, focused: true });
  await browser.keys([key === "Space" ? " " : "Enter"]);
  await frames();
}

// ---------------------------------------------------------------- reading

async function requests(command: string): Promise<unknown[]> {
  return (await ipcCalls()).filter((call) => call.command === command).map((call) => call.args);
}

async function unexpectedConsole(): Promise<string[]> {
  return (await consoleEntries())
    .filter((entry) => !ALLOWED_CONSOLE_SUBSTRINGS.some((allowed) => entry.text.includes(allowed)))
    .map((entry) => `${entry.level}: ${entry.text}`);
}

/** What a control says about itself: name, refusal, emphasis, and the text its description points at. */
function control(selector: string) {
  return browser.execute((css: string) => {
    const button = document.querySelector<HTMLButtonElement>(css);
    if (button === null) return null;
    return {
      text: (button.textContent ?? "").trim(),
      disabled: button.disabled,
      ariaDisabled: button.getAttribute("aria-disabled"),
      primary: button.classList.contains("primary-button") || button.classList.contains("ui-button--primary"),
      described: (button.getAttribute("aria-describedby") ?? "")
        .split(/\s+/u)
        .filter(Boolean)
        .map((id) => (document.getElementById(id)?.textContent ?? "").trim()),
    };
  }, selector);
}

function shellPanels() {
  return browser.execute(() => {
    const shell = document.querySelector(".workbench-shell");
    return {
      roster: shell?.getAttribute("data-roster-open") ?? null,
      details: shell?.getAttribute("data-details-open") ?? null,
      toggle: document.querySelector('[aria-controls="workbench-roster"]')?.getAttribute("aria-expanded") ?? null,
    };
  });
}

/** The empty evidence column's guidance: a help line in the message under the first run's heading. */
function guidance(heading: string) {
  return browser.execute((title: string) => {
    const state = [...document.querySelectorAll(".ui-empty-state")].find(
      (node) => (node.querySelector("strong")?.textContent ?? "").trim() === title,
    );
    const help = state?.querySelector(".ui-empty-state__message > span") ?? null;
    return help === null ? null : { text: (help.textContent ?? "").trim(), shown: help.getClientRects().length > 0 };
  }, heading);
}

/** Waits until the roster toggle may be pressed. */
async function toggleOperable() {
  await browser.waitUntil(
    async () => (await browser.$(ROSTER_TOGGLE).getAttribute("aria-disabled")) === null,
    { timeout: 30_000, timeoutMsg: "the roster toggle never became operable" },
  );
}

/** Presses Tab from the scope's checked radio until Convert has focus. */
async function tabToStart(limit = 40): Promise<boolean> {
  await browser.execute(() => document.querySelector<HTMLElement>('input[name="conversion-scope"]:checked')?.focus());
  for (let step = 0; step < limit; step += 1) {
    if (await browser.execute((css: string) => document.activeElement === document.querySelector(css), CONVERT)) return true;
    await browser.keys(["Tab"]);
  }
  return browser.execute((css: string) => document.activeElement === document.querySelector(css), CONVERT);
}

/** Presses a button inside `scope` by its visible name, with the keyboard. */
async function pressByKeyboard(scope: string, name: string) {
  const found = await browser.execute(
    (css: string, label: string) => {
      // By its text or its aria-label (an icon-only Dismiss has only the label).
      const button = [...document.querySelectorAll<HTMLButtonElement>(`${css} button`)].find(
        (candidate) => [candidate.getAttribute("aria-label"), (candidate.textContent ?? "").trim()].includes(label),
      );
      button?.focus();
      return button !== undefined && document.activeElement === button;
    },
    scope,
    name,
  );
  expect({ name, found }).toEqual({ name, found: true });
  await browser.keys(["Enter"]);
  await frames();
}

// ---------------------------------------------------------------- cases

describe("Beta 1 UX changes, rendered", () => {
  before(() => {
    mkdirSync(OUTPUT, { recursive: true });
    console.log(`Beta 1 UX screenshots: ${OUTPUT}`);
  });

  afterEach(async function () {
    if (this.currentTest?.state === "failed") {
      const name = (this.currentTest.title.match(/^[\w.-]+/u)?.[0] ?? "case").replace(/[^\w.-]/gu, "-");
      await browser.saveScreenshot(join(OUTPUT, `failure-${name}-${String(Date.now())}.png`));
    }
  });

  for (const locale of LOCALES) {
    const words = BUNDLES[locale];

    it(`PM9.7-F2 the empty Project emphasises New project alone and keeps Open project… a Tab stop, ${locale}`, async () => {
      await open(emptyTable(locale), locale, 960, 640);
      await navigate(words.projectSurface);
      await browser.$("[data-project-surface]").waitForDisplayed({ timeout: 30_000 });
      await shot(`f2-empty-project-960-${locale}`);

      // Every primary under the surface, hidden or not: one, shown, and it is New project.
      const primaries = await browser.execute(() =>
        [...document.querySelectorAll<HTMLButtonElement>("#workbench-project .ui-button--primary")].map((button) => ({
          text: (button.textContent ?? "").trim(),
          shown: button.getClientRects().length > 0,
        })),
      );
      expect(primaries).toEqual([{ text: words.projectNew, shown: true }]);
      const create = await mark("#workbench-project .project-header", words.projectNew, "data-beta1-new");
      const reopen = await mark("#workbench-project .project-header", words.projectOpen, "data-beta1-open");
      expect([create, reopen].every((selector) => selector !== null)).toBe(true);
      expect(await control(create!)).toMatchObject({ ariaDisabled: null, disabled: false, primary: true });
      expect(await control(reopen!)).toMatchObject({ ariaDisabled: null, disabled: false, primary: false });

      // Both reachable by keyboard: Tab to New project, then Open project… is the next stop.
      expect(await tabsTo(create!)).not.toBeNull();
      await shot(`f2-empty-project-960-${locale}-new-focused`);
      await browser.keys(["Tab"]);
      expect(await focusedOn(reopen!)).toBe(true);
      await shot(`f2-empty-project-960-${locale}-open-focused`);

      // Emphasis only: rendering, navigating and tabbing created or opened nothing.
      expect([await requests("create_project"), await requests("open_project")]).toEqual([[], []]);

      // Wide enough for the roster beside it, Add files… gives up the accent there.
      await open(emptyTable(locale), locale, 1366, 768);
      await navigate(words.projectSurface);
      await browser.$("[data-project-surface]").waitForDisplayed({ timeout: 30_000 });
      const add = await mark(".workbench-shell", words.addFiles, "data-beta1-add");
      expect(add).not.toBeNull();
      expect(await control(add!)).toMatchObject({ primary: false });
      expect(
        await browser.execute(() =>
          [...document.querySelectorAll<HTMLButtonElement>("#workbench-project .ui-button--primary")].map((button) => (button.textContent ?? "").trim()),
        ),
      ).toEqual([words.projectNew]);
      await shot(`f2-empty-project-1366-${locale}`);
      expect([await requests("create_project"), await requests("open_project")]).toEqual([[], []]);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it(`PM9.7-F3 the empty Workbench offers Add files… itself while the roster is folded, and once when it is open, ${locale}`, async () => {
      await open(emptyTable(locale), locale, 960, 640);
      await toggleOperable();
      /** The visible buttons of the empty state under `evidenceFirstRun`, in order. */
      const offered = () => browser.execute((title: string) => {
        const state = [...document.querySelectorAll(".ui-empty-state")].find(
          (node) => (node.querySelector("strong")?.textContent ?? "").trim() === title && node.getClientRects().length > 0,
        );
        return state === undefined ? null : [...state.querySelectorAll("button")]
          .filter((button) => button.getClientRects().length > 0)
          .map((button) => (button.textContent ?? "").trim());
      }, words.evidenceFirstRun);
      /** How many Add files… buttons a person can see anywhere in the shell. */
      const addsOnScreen = () => browser.execute((label: string) =>
        [...document.querySelectorAll<HTMLButtonElement>(".workbench-shell button")]
          .filter((button) => (button.textContent ?? "").trim() === label && button.getClientRects().length > 0).length,
      words.addFiles);

      // Folded at 960: the empty evidence holds the route itself, as buttons,
      // and no sentence is left explaining the interface (rebuild spec 3.6).
      await browser.waitUntil(async () => (await offered())?.includes(words.addFiles) === true, {
        timeout: 30_000,
        timeoutMsg: "the empty Workbench never offered Add files…",
      });
      expect(await shellPanels()).toMatchObject({ roster: "false", toggle: "false" });
      expect(await offered()).toEqual([words.addFiles, words.addFolder, words.projectOpen]);
      expect(await guidance(words.evidenceFirstRun)).toBeNull();
      expect(await addsOnScreen()).toBe(1);
      const add = await mark("#workbench-evidence", words.addFiles, "data-beta1-add");
      expect(add).not.toBeNull();
      expect(await control(add!)).toMatchObject({ primary: true, ariaDisabled: null });
      expect(await tabsTo(add!)).not.toBeNull();
      await shot(`f3-empty-workbench-960-${locale}-add-focused`);

      // Tab reaches the header toggle, Enter unfolds it, and Add files… is then
      // the roster's, offered once and still a Tab stop.
      expect(await tabsTo(ROSTER_TOGGLE)).not.toBeNull();
      await browser.keys(["Enter"]);
      await browser.waitUntil(async () => (await shellPanels()).roster === "true", {
        timeoutMsg: "Enter on Acquisitions did not unfold the roster",
      });
      await frames();
      expect(await addsOnScreen()).toBe(1);
      const rosterAdd = await mark("#workbench-roster", words.addFiles, "data-beta1-add");
      expect(rosterAdd).not.toBeNull();
      expect(await tabsTo(rosterAdd!)).not.toBeNull();
      await shot(`f3-empty-workbench-960-${locale}-expanded-add-focused`);

      // With room for both, the roster's Add files… is the one on screen, and
      // the empty evidence keeps only what the roster does not offer.
      await open(emptyTable(locale), locale, 1366, 768);
      await toggleOperable();
      expect(await shellPanels()).toMatchObject({ roster: "true", toggle: "true" });
      await browser.waitUntil(async () => (await offered()) !== null, { timeout: 30_000 });
      expect(await offered()).toEqual([words.projectOpen]);
      expect(await addsOnScreen()).toBe(1);
      expect(await mark("#workbench-roster", words.addFiles, "data-beta1-add")).not.toBeNull();
      await shot(`f3-empty-workbench-1366-${locale}-expanded`);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it(`PM9.7-F3/PM9.4-O3 an mzML-only scope says the route once, as Convert's whole description, and a press sends nothing, ${locale}`, async () => {
      await open(conversionWorld(locale, [OPEN]), locale, 960, 640);
      await toggleOperable();
      await showConversion();
      const notice = say(locale, "m74CnvNoticeNoConvertibleTarget", { toggle: words.rosterToggle, add: words.addFiles });
      expect(notice).toContain(words.rosterToggle);
      expect(notice).toContain(words.addFiles);

      // Settled, Convert points at the route and at nothing else.
      await browser.waitUntil(async () => JSON.stringify((await control(CONVERT))?.described) === JSON.stringify([notice]), {
        timeout: 30_000,
        timeoutMsg: "Convert's description never became the no-target route alone",
      });
      await shot(`f3-o3-conversion-no-target-960-${locale}`);
      expect(await control(CONVERT)).toMatchObject({ ariaDisabled: "true", disabled: false, described: [notice] });
      expect(await browser.$("#conversion-availability-no-convertible-target").getText()).toBe(notice);
      expect(await browser.$(CONVERSION_SURFACE).getText()).not.toContain(words.m74CnvNoEligible);
      expect(await browser.$("#conversion-plan-pending").isExisting()).toBe(false);

      // Refused, but a Tab stop: Enter, Space and a click start nothing.
      expect(await tabToStart()).toBe(true);
      await browser.keys(["Enter"]);
      await browser.keys([" "]);
      await browser.$(CONVERT).click();
      await frames();
      expect([await requests(BEGIN), await requests(CHOOSE)]).toEqual([[], []]);
      // Saying the route moves nothing.
      expect(await shellPanels()).toMatchObject({ roster: "false", toggle: "false" });

      // The route it names is the route that exists, from this surface.
      expect(await tabsTo(ROSTER_TOGGLE)).not.toBeNull();
      await browser.keys(["Enter"]);
      await browser.waitUntil(async () => (await shellPanels()).roster === "true", {
        timeoutMsg: "Enter on Acquisitions did not unfold the roster",
      });
      const add = await mark(".workbench-shell", words.addFiles, "data-beta1-add");
      expect(add).not.toBeNull();
      expect(await tabsTo(add!)).not.toBeNull();
      await shot(`f3-o3-conversion-no-target-960-${locale}-expanded-add-focused`);
      // Hidden behind the unfolded roster at 960 px, so read from the document: the same sentence.
      expect(await browser.execute(() => (document.getElementById("conversion-availability-no-convertible-target")?.textContent ?? "").trim())).toBe(notice);

      // The mzML row checked: still the one reason, the row now named as excluded.
      await checkMembers([OPEN.handle]);
      await showConversion();
      await browser.waitUntil(async () => JSON.stringify((await control(CONVERT))?.described) === JSON.stringify([notice]), {
        timeout: 30_000,
        timeoutMsg: "with the mzML row checked, Convert's description was not the route alone",
      });
      await shot(`o3-conversion-mzml-checked-960-${locale}`);
      expect(await browser.$(".conversion-excluded-group > button").getText()).toBe(say(locale, "m74CnvExcludedNames", { count: 1 }));
      expect(await browser.$(CONVERSION_SURFACE).getText()).not.toContain(words.m74CnvNoEligible);
      expect(await tabToStart()).toBe(true);
      await browser.keys(["Enter"]);
      await browser.keys([" "]);
      expect([await requests(BEGIN), await requests(CHOOSE)]).toEqual([[], []]);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it(`PM9.4-O2/O5/O6/O7 the excluded rows, the ellipsis and a ready review's notes, ${locale}`, async () => {
      await open(conversionWorld(locale, VENDOR_AND_MZML), locale, 1366, 768);
      await answerPlans(VENDOR_AND_MZML);
      await checkMembers([FIRST.handle, OPEN.handle, LONG.handle]);
      await showConversion();
      await waitUntilOffered(CONVERT);

      // O2: the exact count, closed, outside the live scope summary.
      const summary = ".conversion-excluded-group > button";
      await shot(`o2-excluded-closed-1366-${locale}`);
      expect(await browser.$(summary).getText()).toBe(say(locale, "m74CnvExcludedNames", { count: 2 }));
      expect(await browser.$("#conversion-scope-summary").getText()).toContain(
        say(locale, "m74CnvScopeCounts", { requested: 3, eligible: 1, excluded: 2 }),
      );
      expect(await browser.execute((css: string) => {
        const node = document.querySelector(css);
        return { open: node === null ? null : node.getAttribute("aria-expanded") === "true", live: node?.closest("[aria-live]") !== null };
      }, summary)).toEqual({ open: false, live: false });
      const asked = (await requests(DESCRIBE)).length;

      // Keyboard reachable; Enter opens it and names both rows, Space closes it.
      await browser.execute(() => document.querySelector<HTMLElement>('input[name="conversion-scope"]:checked')?.focus());
      let reached = false;
      for (let step = 0; step < 30 && !reached; step += 1) {
        await browser.keys(["Tab"]);
        reached = await focusedOn(summary);
      }
      expect(reached).toBe(true);
      await browser.keys(["Enter"]);
      await frames();
      const listed = await browser.execute(() => {
        const details = document.querySelector<HTMLElement>(".conversion-excluded");
        return {
          open: details === null ? null : !details.hidden,
          names: [...(details?.querySelectorAll("li") ?? [])].map((item) => (item.textContent ?? "").trim()),
          // Long names wrap inside the disclosure rather than overflow it.
          overflow: [...(details?.querySelectorAll("li") ?? [])].some(
            (item) => item.getBoundingClientRect().right > details!.getBoundingClientRect().right + 1 || item.scrollWidth > item.clientWidth + 1,
          ),
          documentOverflow: document.documentElement.scrollWidth - innerWidth,
        };
      });
      await shot(`o2-excluded-open-1366-${locale}`);
      expect(listed).toEqual({ open: true, names: [OPEN.fileName, LONG.fileName], overflow: false, documentOverflow: 0 });
      await browser.keys([" "]);
      await frames();
      expect(await browser.execute(() => {
        const details = document.querySelector<HTMLElement>(".conversion-excluded");
        return details === null ? null : !details.hidden;
      })).toBe(false);

      // Read only: no new plan, the plan names the vendor row alone, and the mzML rows stay checked.
      expect((await requests(DESCRIBE)).length).toBe(asked);
      expect((await requests(DESCRIBE)).at(-1)).toMatchObject({ request: { handles: [FIRST.handle] } });
      expect(
        await browser.execute((handles: readonly string[]) =>
          handles.map((handle) => document.querySelector<HTMLInputElement>(`.grouped-roster [data-handle="${handle}"] input[type="checkbox"]`)?.checked ?? null),
        [OPEN.handle, LONG.handle, FIRST.handle]),
      ).toEqual([true, true, true]);

      // O6/O7: a ready review explains no Stop, and claims no check before one
      // has run; the short rail repeats nothing (C11).
      const review = await browser.$(".conversion-panel").getText();
      expect(review).not.toContain(words.m74CnvStopQueue);
      expect(review).not.toContain(words.m74CnvOutputOnly);

      // O5: the ellipsis promises the custom folder's picker, and only that.
      expect((await control(CONVERT))?.text).toBe(say(locale, "m74CnvConvertSelected", { count: 1 }));
      expect((await control(CONVERT))?.text).toMatch(/…$/u);
      await shot(`o5-convert-picker-1366-${locale}`);
      for (const destination of ["sourceSibling", "namedSubfolder"] as const) {
        await browser.$(`input[name="conversion-destination-policy"][value="${destination}"]`).click();
        await waitUntilOffered(CONVERT);
        const direct = await control(CONVERT);
        expect(direct?.text).toBe(say(locale, "m74CnvConvertSelectedDirect", { count: 1 }));
        expect(direct?.text).not.toContain("…");
        expect(direct?.primary).toBe(true);
        await shot(`o5-convert-direct-${destination}-1366-${locale}`);
      }
      await browser.$('input[name="conversion-destination-policy"][value="customFolder"]').click();
      await waitUntilOffered(CONVERT);
      expect((await control(CONVERT))?.text).toBe(say(locale, "m74CnvConvertSelected", { count: 1 }));
      expect([await requests(BEGIN), await requests(CHOOSE)]).toEqual([[], []]);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it(`PM9.4-O4/O6 a running queue offers Skip on the row it is about, and a failed Stop is named in the banner, ${locale}`, async () => {
      await open(conversionWorld(locale, VENDOR_AND_MZML, STARTED), locale, 1366, 768);
      await showConversion();
      await browser.$(".conversion-running").waitForExist({ timeout: 15_000 });

      // O6: Skip is offered on the row it skips, and its name says which; no
      // separate sentence restates it.
      const skip = await mark(CONVERSION_SURFACE, say(locale, "m74CnvSkip", { name: SECOND.fileName }), "data-beta1-skip");
      expect(skip).not.toBeNull();
      expect(await browser.$("#conversion-skip-scope").isExisting()).toBe(false);
      await shot(`o6-running-skip-offered-1366-${locale}`);

      // O4: the request fails; the one banner leads with the control's name.
      await setInvokeRejection("stop_workspace_conversion_queue", {
        kind: "conversion_not_stoppable",
        summary: "fixture",
        detail: null,
        retryable: false,
      });
      await pressByKeyboard(CONVERSION_SURFACE, words.m74CnvStopQueue);
      await browser.waitUntil(async () => (await requests("stop_workspace_conversion_queue")).length === 1, { timeout: 15_000 });
      await browser.$(`${CONVERSION_SURFACE} .notice-danger strong`).waitForExist({ timeout: 15_000 });
      await shot(`o4-stop-failed-banner-1366-${locale}`);
      const banners = await browser.execute((surface: string) =>
        [...document.querySelectorAll<HTMLElement>(`${surface} .notice-danger`)].map((banner) => ({
          role: banner.getAttribute("role"),
          lead: banner.querySelector("strong")?.textContent ?? null,
          text: (banner.textContent ?? "").trim(),
          dismiss: [...banner.querySelectorAll("button")].map((button) => button.getAttribute("aria-label") ?? (button.textContent ?? "").trim()),
        })),
      CONVERSION_SURFACE);
      const lead = say(locale, "m74CnvRequestFailed", { action: words.m74CnvStopQueue });
      expect(banners).toHaveLength(1);
      expect(banners[0]).toMatchObject({ role: "status", lead, dismiss: [words.m74CnvDismiss] });
      // The typed message follows the name rather than replacing it.
      expect(banners[0]!.text.startsWith(lead.trim())).toBe(true);
      expect(banners[0]!.text.replace(lead, "").replace(words.m74CnvDismiss, "").trim()).not.toBe("");
      // Dismiss is a keyboard route out, and nothing was retried.
      await pressByKeyboard(`${CONVERSION_SURFACE} .notice-danger`, words.m74CnvDismiss);
      expect(await browser.$(`${CONVERSION_SURFACE} .notice-danger`).isExisting()).toBe(false);
      expect((await requests("stop_workspace_conversion_queue")).length).toBe(1);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it(`PM9.5-O1/O2/O3 the setup's caveats, no read-path disclosure, its heading and the local Details hint, ${locale}`, async () => {
      await open(targetedTable(locale), locale, 1366, 768);
      await navigate(words.projectSurface);
      await browser.$(`[data-project-targeted="${LAYERS[0]}"]`).waitForDisplayed();
      await keyPress(`[data-project-targeted="${LAYERS[0]}"]`, "Enter");
      const setup = "[data-targeted-setup]";
      await browser.$(setup).waitForDisplayed();
      await shot(`pm95-o1-setup-first-screen-1366-${locale}`);

      // O1: the caveats are read before Run, outside any disclosure.
      const caveats = await browser.execute((css: string) => {
        const root = document.querySelector(css)!;
        const experimental = root.querySelector<HTMLElement>("[data-targeted-experimental]");
        const domain = experimental?.nextElementSibling as HTMLElement | null;
        const run = root.querySelector("[data-targeted-run]");
        const follows = (a: Element | null | undefined, b: Element | null | undefined) =>
          a != null && b != null && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
        const box = (node: Element | null | undefined) => {
          const rect = node?.getBoundingClientRect();
          return rect === undefined ? null : { top: Math.round(rect.top), bottom: Math.round(rect.bottom) };
        };
        return {
          experimental: (experimental?.textContent ?? "").trim(),
          domain: (domain?.textContent ?? "").trim(),
          shown: [experimental, domain].map((node) => node != null && node.getClientRects().length > 0),
          inDisclosure: [experimental, domain].map((node) => node?.closest("details") != null),
          order: follows(experimental, domain) && follows(domain, run),
          boxes: { experimental: box(experimental), domain: box(domain), innerHeight },
          readPath: root.querySelector("[data-targeted-read-path]") !== null,
        };
      }, setup);
      expect(caveats).toMatchObject({
        experimental: words.targetedExperimental,
        domain: words.targetedDomain,
        shown: [true, true],
        inDisclosure: [false, false],
        order: true,
        // O1 as revised: how the source is read is no longer a disclosure here.
        readPath: false,
      });
      // The two caveats the domain sentence now carries, in each language.
      expect(words.targetedExperimental).toContain(locale === "en" ? "not identification" : "这不是鉴定");
      expect(words.targetedDomain).toContain(locale === "en" ? "Not detected is not proof" : "未检出并不证明");
      // And on the first screen of the opened setup.
      expect(caveats.boxes.domain!.bottom).toBeLessThanOrEqual(caveats.boxes.innerHeight);
      expect(caveats.boxes.experimental!.top).toBeGreaterThanOrEqual(0);

      // O3: the open setup is set apart -- an accent bar along its top, its h3
      // in primary text a step above a project section's -- and still an h3.
      const styles = await browser.execute((css: string) => {
        const probe = (property: string, value: string) => {
          const span = document.createElement("span");
          span.style.setProperty(property, value);
          document.body.append(span);
          const computed = getComputedStyle(span).getPropertyValue(property);
          span.remove();
          return computed;
        };
        const heading = document.querySelector<HTMLElement>(`${css} > .project-section-head h3`);
        const other = [...document.querySelectorAll<HTMLElement>(".project-section:not(.targeted-setup) > .project-section-head h3")][0] ?? null;
        const own = heading === null ? null : getComputedStyle(heading);
        const section = document.querySelector<HTMLElement>(css);
        return {
          tag: heading?.tagName ?? null,
          fontSize: own?.fontSize ?? null,
          color: own?.color ?? null,
          primaryText: probe("color", "var(--color-text-primary)"),
          accent: probe("color", "var(--color-accent)"),
          shadow: section === null ? null : getComputedStyle(section).boxShadow,
          other: other === null ? null : { fontSize: getComputedStyle(other).fontSize, color: getComputedStyle(other).color },
        };
      }, setup);
      // A section title at the project's one section size, below the 17px
      // page title (rendered review).
      expect(styles).toMatchObject({ tag: "H3", fontSize: "14px" });
      expect(styles.color).toBe(styles.primaryText);
      expect(styles.shadow).toContain("inset");
      expect(styles.shadow).toContain(styles.accent);
      expect(styles.shadow).toMatch(/\b0px 3px 0px\b/u);
      expect(styles.other).not.toBeNull();
      // Every section title shares that size and primary text (V2, rebuild
      // spec 1.3); the setup stays apart by its accent bar alone.
      expect(styles.other).toEqual({ fontSize: styles.fontSize, color: styles.color });

      // O2: a run that left no result, then Show run with Details folded.
      await browser.execute(
        (css: string, typed: string) => {
          const element = document.querySelector<HTMLTextAreaElement>(css);
          if (element === null) throw new Error(`nothing matches ${css}`);
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(element, typed);
          element.dispatchEvent(new Event("input", { bubbles: true }));
        },
        "[data-targeted-text]",
        TYPED,
      );
      await frames();
      await keyPress("[data-targeted-review]", "Enter");
      await browser.$("[data-targeted-review-area] [data-targeted-plan]").waitForDisplayed();
      await setInvokeResult("run_targeted_ms1", singleEnd(0, "failed"));
      await keyPress("[data-targeted-run]", "Enter");
      const block = '[data-targeted-run-block="failed"]';
      await browser.$(block).waitForDisplayed();
      const showRun = `[data-targeted-show-run="${RUNS[0]}"]`;
      expect(await shellPanels()).toMatchObject({ details: "false" });
      // A run that ends without a result is inspected by its ending (useProject's
      // runTargetedMs1), so the hint is already true here; it is recorded, then
      // the reader looks at something else and comes back with Show run.
      await shot(`pm95-o2-run-ended-1366-${locale}`);
      await keyPress(`[data-project-show-layer="${LAYERS[1]}"]`, "Enter");
      await browser.$("[data-targeted-details-hint]").waitForExist({ reverse: true, timeout: 15_000 });
      await keyPress(showRun, "Enter");
      await browser.$("[data-targeted-details-hint]").waitForDisplayed();
      await shot(`pm95-o2-show-run-hint-1366-${locale}`);
      const hint = await browser.execute((css: string, press: string) => {
        const node = document.querySelector<HTMLElement>("[data-targeted-details-hint]");
        const button = node?.querySelector("button");
        return {
          sameBlock: node?.closest(".targeted-run") === document.querySelector(press)?.closest(".targeted-run") && node?.closest(css) !== null,
          sentence: node?.querySelector("span")?.textContent ?? null,
          button: (button?.textContent ?? "").trim(),
        };
      }, block, showRun);
      // The button names where the answer went; no sentence restates it.
      expect(hint).toEqual({ sameBlock: true, sentence: null, button: words.provenanceShowDetails });
      // Nothing unfolded and the keyboard stayed on the press.
      expect(await focusedOn(showRun)).toBe(true);
      expect(await shellPanels()).toMatchObject({ details: "false" });

      // The hint's own control shows Details, still on the inspected run.
      await keyPress("[data-targeted-details-hint] button", "Enter");
      await browser.waitUntil(async () => (await shellPanels()).details === "true", {
        timeoutMsg: "the hint's Show Details did not open Details",
      });
      await browser.$(`[data-project-inspect-run="${RUNS[0]}"]`).waitForDisplayed();
      expect(await browser.$(`[data-project-inspect-run="${RUNS[0]}"]`).getAttribute("aria-current")).toBe("true");
      await shot(`pm95-o2-details-shown-1366-${locale}`);
      expect(await unexpectedConsole()).toEqual([]);
    });

    it(`PM9.5-O4 a links check's Cancel says requested, once, until its own answer, ${locale}`, async () => {
      const table = scenario("populated", locale);
      table.check_project_links = table.get_project_state;
      await open(table, locale, 1366, 768);
      await navigate(words.projectSurface);
      await browser.$("[data-project-check]").waitForDisplayed({ timeout: 30_000 });
      await holdInvoke("check_project_links");
      await keyPress("[data-project-check]", "Enter");
      await browser.$("[data-project-cancel]").waitForDisplayed();
      expect(await control("[data-project-cancel]")).toMatchObject({ text: words.projectCancel, ariaDisabled: null });

      await keyPress("[data-project-cancel]", "Enter");
      await browser.waitUntil(async () => (await requests("cancel_project_job")).length === 1, { timeout: 15_000 });
      await browser.waitUntil(async () => (await control("[data-project-cancel]"))?.text === words.projectCancelRequested, {
        timeout: 15_000,
        timeoutMsg: "the links check's Cancel never said it was requested",
      });
      await shot(`pm95-o4-cancel-requested-1366-${locale}`);
      // Said as a request, not as the targeted run's Stop, and refused while it stands.
      expect(words.projectCancelRequested).not.toBe(words.targetedStopRequested);
      expect(await control("[data-project-cancel]")).toMatchObject({ text: words.projectCancelRequested, ariaDisabled: "true" });
      await keyPress("[data-project-cancel]", "Enter");
      await keyPress("[data-project-cancel]", "Space");
      await browser.$("[data-project-cancel]").click();
      await frames();
      expect(await requests("cancel_project_job")).toEqual([{ operationId: "project-job-1" }]);

      // Until the operation's own answer: then the control goes, and nothing still says requested.
      await releaseInvokeHold("check_project_links");
      await browser.$("[data-project-cancel]").waitForExist({ reverse: true, timeout: 15_000 });
      expect(await browser.$("#workbench-project").getText()).not.toContain(words.projectCancelRequested);
      expect(await unexpectedConsole()).toEqual([]);
    });
  }

  it("PM9.4-O1 a finalized set names each member once, beside its own Open actions, en", async () => {
    await open(conversionWorld("en", [WIFF], SET_DONE), "en", 1366, 768);
    await showConversion();
    await browser.$('li[data-item-state="finalized"]').waitForExist({ timeout: 15_000 });
    await shot("o1-set-members-1366-en");
    const row = await browser.execute((names: readonly string[], groupLabel: string) => {
      const item = document.querySelector<HTMLElement>('li[data-item-state="finalized"]')!;
      const visible = item.innerText;
      return {
        plainList: item.querySelector(".conversion-queue-set-members") !== null,
        said: names.map((name) => visible.split(name).length - 1),
        groups: names.map((name) => {
          const group = item.querySelector(`[role="group"][aria-label="${groupLabel.replace("{{name}}", name)}"]`);
          return group === null ? null : [...group.querySelectorAll("button")].map((button) => (button.textContent ?? "").trim());
        }),
      };
    }, SET_NAMES, en.outputOpenGroup);
    expect(row.plainList).toBe(false);
    expect(row.said).toEqual(SET_NAMES.map(() => 1));
    expect(row.groups.every((buttons) => buttons !== null && buttons.length >= 2)).toBe(true);
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("PM9.4-O8 staging cleanup, refused while Add runs, points at Add's status line and does nothing, en", async () => {
    await open(conversionWorld("en", VENDOR_AND_MZML, RECOVERABLE), "en", 1366, 768);
    await showConversion();
    const cleanup = await (async () => {
      await browser.waitUntil(async () => (await mark(CONVERSION_SURFACE, en.stagingRecoveryButton, "data-beta1-cleanup")) !== null, {
        timeout: 15_000,
        timeoutMsg: "no staging cleanup control",
      });
      return "[data-beta1-cleanup]";
    })();
    // Offered: `aria-disabled` is absent or "false" while nothing holds it.
    expect(await isRefused(cleanup)).toBe(false);

    await holdInvoke("adopt_workspace_conversion_outputs");
    await pressByKeyboard(CONVERSION_SURFACE, en.m74CnvAddOne);
    await browser.waitUntil(async () => (await control(cleanup))?.ariaDisabled === "true", {
      timeout: 15_000,
      timeoutMsg: "cleanup was not refused while Add ran",
    });
    await shot("o8-cleanup-refused-while-adding-1366-en");
    expect(await control(cleanup)).toMatchObject({ ariaDisabled: "true", disabled: false, described: [en.m74CnvAdoptInFlight] });
    await keyPress(cleanup, "Enter");
    await keyPress(cleanup, "Space");
    await browser.$(cleanup).click();
    await frames();
    expect(await requests("reclaim_conversion_staging")).toEqual([]);

    await releaseInvokeHold("adopt_workspace_conversion_outputs");
    await browser.waitUntil(async () => !(await isRefused(cleanup)), {
      timeout: 15_000,
      timeoutMsg: "cleanup stayed refused after Add answered",
    });
    expect((await control(cleanup))?.described).toEqual([]);
    expect(await isRefused(cleanup)).toBe(false);
    expect(await unexpectedConsole()).toEqual([]);
  });
});
