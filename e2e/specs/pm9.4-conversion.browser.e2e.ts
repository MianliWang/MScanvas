/**
 * PM9.4 -- the conversion journey, rendered: scope, settings, review, start,
 * queue, stop, failure, retry and the finished outputs.
 *
 * The real production composition in real Chrome over the real Vite dev
 * server, with only `window.__TAURI_INTERNALS__.invoke` replaced. Every
 * provider outcome here is simulated: no ProteoWizard runs, no file is
 * converted and nothing is published. A queue moves only through the slot
 * shapes Rust sends, answered by the existing commands; nothing jumps to a
 * state the contract has no path to.
 *
 * The finite acceptance list is `docs/phases/pm9/slice-04.md` §3 (R1–R12).
 * Each case captures its frames before it asserts, so the run on the starting
 * production is the before evidence and its failures are the findings' RED.
 *
 * Copy is read from the bundles, by key, so the cases hold the semantics
 * rather than one wording; a key the bundle does not hold fails as a missing
 * resource. A DOM mutation or focus trace is DOM evidence, not what a screen
 * reader says.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  ALLOWED_CONSOLE_SUBSTRINGS,
  IPC_TABLE_KEY,
  consoleEntries,
  installIpcBoundary,
  ipcCalls,
  setInvokeResult,
} from "../support/harness";
import { cdp, metrics } from "../support/cdp";
import { CONVERT, CONVERSION_SURFACE, checkMembers, isRefused, showConversion, waitUntilOffered } from "../support/conversion";
import { NO_PROJECT, scenario, type Locale } from "../support/pm9Scenarios";
import { readBackSavedPreferences } from "../support/viewer";
import {
  admittedIntents,
  availableBackend,
  completeCatalog,
  finalizedAttemptFacts,
  queueItem,
  queueOf,
  settledAt,
  shippedIntent,
  stoppedAttemptFacts,
  unavailableBackend,
} from "../../apps/desktop/src/test/previewFixtures";
import type { SelectedFile } from "../../apps/desktop/src/features/mzml-preview/contracts";
import { en } from "../../apps/desktop/src/features/preferences/locales/en";
import { zhCN as zh } from "../../apps/desktop/src/features/preferences/locales/zh-CN";

let output = "";
const evidence: unknown[] = [];

// ---------------------------------------------------------------- words

const BUNDLE: Record<Locale, Record<string, unknown>> = {
  en: en as unknown as Record<string, unknown>,
  "zh-CN": zh as unknown as Record<string, unknown>,
};

/** One resource, by key. A key the bundle does not hold is a failure, not a blank. */
function word(locale: Locale, key: string): string {
  const value = BUNDLE[locale][key];
  if (typeof value !== "string") throw Error(`the ${locale} bundle has no resource ${key}`);
  return value;
}

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/gu, (_, key: string) => String(values[key] ?? ""));
}

/** Any estimate: the lookahead lets the stop control's own "remaining items" through. */
const ESTIMATE = /\d+\s?%|\bETA\b|[Rr]emaining(?! items)|剩余|预计/u;

// ---------------------------------------------------------------- the world

const AUTHORITY = settledAt(1, 1);
const OPERATION = "pm94-queue";

function vendor(index: number, fileName: string): SelectedFile {
  return { handle: `raw-${String(index)}`, fileName, byteLength: index * 52_428_800, sourceKind: "thermo_raw", relativeContext: null };
}

/** Three Thermo acquisitions, one with a real study's long name, and one mzML file. */
const RAWS = [
  vendor(1, "QC_pool_01.raw"),
  vendor(2, "Plasma_QC_batch_08_replicate_04_long_acquisition.raw"),
  vendor(3, "Blank_03.raw"),
] as const;
const OPEN: SelectedFile = { handle: "open", fileName: "reference_run.mzML", byteLength: 4_194_304, sourceKind: "mzml", relativeContext: null };
const ROWS: readonly SelectedFile[] = [...RAWS, OPEN];
const [FIRST, SECOND, THIRD] = RAWS;
const FIRST_OUTPUT = { outputId: "pm94-output-1", fileName: "QC_pool_01.mzML" };

function slot(sequence: number, state: unknown, authority: unknown = AUTHORITY) {
  return {
    sequence,
    state,
    diagnostics: { eligibleItemCount: 0, available: false, exporting: false, lastExport: null },
    backendQuarantined: false,
    authority,
  };
}

const finalized = (row: SelectedFile, outputs: readonly { outputId: string; fileName: string }[] = []) =>
  queueItem(row.handle, row.fileName, { state: "finalized", attempts: 1, finalizedOutputs: [...outputs], ...finalizedAttemptFacts() });

/** The queue a Convert of the first two rows starts: the first converting, the second waiting. */
const STARTED = {
  status: "running",
  operationId: OPERATION,
  queue: queueOf([
    queueItem(FIRST.handle, FIRST.fileName, { state: "running", attempts: 1 }),
    queueItem(SECOND.handle, SECOND.fileName),
  ]),
};

/** A rerun under way: the first finalized, the second's earlier failure being run again. */
const RERUN = {
  status: "running",
  operationId: OPERATION,
  queue: {
    ...queueOf([
      finalized(FIRST),
      queueItem(SECOND.handle, SECOND.fileName, { state: "running", attempts: 2 }),
      queueItem(THIRD.handle, THIRD.fileName, { state: "failed", attempts: 1 }),
    ]),
    retryRound: 1,
  },
};

/** Finished on its own: one output, one failure a rerun could change and one it could not. */
const MIXED = {
  status: "terminal",
  reason: "completed",
  operationId: OPERATION,
  queue: queueOf([
    finalized(FIRST, [FIRST_OUTPUT]),
    queueItem(SECOND.handle, SECOND.fileName, { state: "failed", attempts: 1, retryable: true }),
    queueItem(THIRD.handle, THIRD.fileName, { state: "failed", attempts: 1, retryable: false }),
  ]),
};

/** Stopped by the reader: one output kept, one cancelled, one never started. */
const STOPPED = {
  status: "terminal",
  reason: "stopped",
  operationId: OPERATION,
  queue: queueOf([
    finalized(FIRST, [FIRST_OUTPUT]),
    queueItem(SECOND.handle, SECOND.fileName, { state: "cancelled", attempts: 1, ...stoppedAttemptFacts() }),
    queueItem(THIRD.handle, THIRD.fileName, { state: "notRun" }),
  ]),
};

const ADOPTED_ROW: SelectedFile = { handle: "adopted-1", fileName: FIRST_OUTPUT.fileName, byteLength: 1_048_576, sourceKind: "mzml", relativeContext: null };

function world(options: { readonly locale?: Locale; readonly slot?: unknown; readonly backend?: "available" | "unavailable" } = {}): Record<string, unknown> {
  const locale = options.locale ?? "en";
  const table = scenario("populated", locale);
  const unavailable = options.backend === "unavailable";
  const authority = unavailable ? unavailableBackend.authority : AUTHORITY;
  table.inspect_backend = unavailable ? unavailableBackend : { ...availableBackend, authority: AUTHORITY };
  table.get_workspace_roster = { datasets: ROWS, capacity: 1024 };
  table.get_project_state = NO_PROJECT;
  table.read_conversion_configuration = unavailable
    ? { authority, configuration: { configuration: "unavailableForBinding" }, outcome: { outcome: "answered" } }
    : { authority, configuration: { configuration: "ready", catalog: completeCatalog, shipped: shippedIntent.id }, outcome: { outcome: "answered" } };
  table.get_workspace_conversion_state = options.slot ?? slot(0, { status: "idle" }, authority);
  table.begin_workspace_conversion_queue = { authority, outcome: { outcome: "reserved", reservation: { reservationId: "pm94-reservation" } } };
  table.choose_workspace_conversion_destination = slot(1, STARTED);
  table.open_finalized_output = { status: "accepted" };
  table.adopt_workspace_conversion_outputs = {
    operationId: OPERATION,
    retryRound: 0,
    roster: { datasets: [...ROWS, ADOPTED_ROW], capacity: 1024 },
    outcomes: [{ kind: "added", itemIndex: 0, memberIndex: 0, sourceHandle: FIRST.handle, outputFileName: FIRST_OUTPUT.fileName, dataset: ADOPTED_ROW }],
  };
  return table;
}

/**
 * Answers each plan question for what it names, as Rust's describe does: the
 * rows asked for, in the order asked, under the combination, policies and
 * receipt asked for. Installed after navigation, before any member is
 * checked. Test boundary only; nothing in the application is patched.
 */
async function answerPlans() {
  await browser.execute(
    (tableKey: string, rows: readonly SelectedFile[], intents: readonly { id: string }[]) => {
      const table = Reflect.get(window, tableKey) as Record<string, unknown>;
      const internals = Reflect.get(window, "__TAURI_INTERNALS__") as {
        invoke: (command: string, args: Record<string, unknown>, ...rest: unknown[]) => Promise<unknown>;
      };
      const invoke = internals.invoke;
      internals.invoke = (command, args, ...rest) => {
        if (command === "describe_workspace_conversion_queue") {
          const request = args["request"] as {
            handles: string[];
            intentId: string;
            conflictPolicy: string;
            destinationPolicy: unknown;
            expectedReceipt: number;
          };
          table[command] = {
            outcome: "planned",
            plan: {
              items: request.handles.map((handle) => {
                const row = rows.find((candidate) => candidate.handle === handle)!;
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
        return invoke(command, args, ...rest);
      };
    },
    IPC_TABLE_KEY,
    ROWS,
    admittedIntents,
  );
}

async function open(table: Record<string, unknown>) {
  await installIpcBoundary(table);
  await browser.url("/");
  await browser.$(".workbench-header").waitForDisplayed({ timeout: 30_000 });
  await readBackSavedPreferences();
  await answerPlans();
}

// ---------------------------------------------------------------- reading

async function frames() {
  await browser.execute(
    () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
}

async function unexpectedConsole(): Promise<string[]> {
  return (await consoleEntries())
    .filter((entry) => !ALLOWED_CONSOLE_SUBSTRINGS.some((allowed) => entry.text.includes(allowed)))
    .map((entry) => `${entry.level}: ${entry.text}`);
}

async function requests(command: string): Promise<unknown[]> {
  return (await ipcCalls()).filter((call) => call.command === command).map((call) => call.args);
}

/** Commands that start, change or end work, or read a source. Navigation may issue none of them. */
const WORK = [
  "begin_workspace_conversion_queue",
  "choose_workspace_conversion_destination",
  "stop_workspace_conversion_queue",
  "cancel_current_workspace_conversion_item",
  "skip_pending_workspace_conversion_item",
  "retry_workspace_conversion_queue",
  "adopt_workspace_conversion_outputs",
  "open_finalized_output",
  "begin_workspace_conversion_diagnostics_export",
  "save_workspace_conversion_diagnostics",
  "reclaim_conversion_staging",
  "plan_workspace_clear",
  "execute_workspace_clear",
  "describe_workspace_conversion_queue",
  "read_conversion_configuration",
  "open_mzml_preview",
  "load_selected_spectrum",
];

/**
 * One frame of the surface: what the reader sees and the facts it is judged
 * by. The screenshot comes first, so a case that fails afterwards still leaves
 * the frame behind.
 */
async function frame(label: string) {
  await frames();
  const screenshot = await cdp("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  if (typeof screenshot.data === "string") writeFileSync(join(output, `${label}.png`), Buffer.from(screenshot.data, "base64"));
  const measured = await browser.execute((surface: string) => {
    const node = document.querySelector<HTMLElement>(surface);
    const box = node?.getBoundingClientRect() ?? null;
    const probe = document.createElement("span");
    probe.style.background = "var(--color-accent)";
    document.body.append(probe);
    const accent = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const shown = (element: Element) => element.getClientRects().length > 0 && element.closest("[hidden]") === null;
    // A filled primary: on screen, carrying the accent, and not refused.
    const filled = [...(node?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
      .filter((button) => shown(button) && !button.disabled && button.getAttribute("aria-disabled") !== "true")
      .filter((button) => getComputedStyle(button).backgroundColor === accent)
      .map((button) => (button.textContent ?? "").trim());
    // Controls under the rebuild's 30 px small-button height (v5.11 rebuild
    // spec 1.4, `--control-height-sm`), inputs aside.
    const small = [...(node?.querySelectorAll<HTMLElement>("button, summary") ?? [])]
      .filter(shown)
      .map((control) => ({ name: (control.textContent ?? "").trim().slice(0, 40), height: control.getBoundingClientRect().height }))
      .filter((control) => control.height < 29.5);
    return {
      css: { width: innerWidth, height: innerHeight },
      devicePixelRatio,
      surface: box === null ? null : { width: box.width, height: box.height, scrollHeight: node!.scrollHeight },
      lang: document.documentElement.lang,
      userAgent: navigator.userAgent,
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
      filled,
      small,
      text: node?.innerText ?? "",
    };
  }, CONVERSION_SURFACE);
  const { text, ...recorded } = measured;
  evidence.push({ label, kind: "PM9.4 frame. Controlled IPC; simulated provider outcomes.", candidate: process.env["MSCANVAS_PM9_CANDIDATE"] ?? "unlabelled", ...recorded });
  return measured;
}

/** What the start control says about itself, and the text its description points at. */
function startControl() {
  return browser.execute((css: string) => {
    const button = document.querySelector<HTMLButtonElement>(css);
    if (button === null) return null;
    const described = (button.getAttribute("aria-describedby") ?? "")
      .split(/\s+/u)
      .filter(Boolean)
      .map((id) => (document.getElementById(id)?.textContent ?? "").trim());
    const probe = document.createElement("span");
    probe.style.background = "var(--color-accent)";
    document.body.append(probe);
    const accent = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return {
      text: (button.textContent ?? "").trim(),
      disabled: button.disabled,
      ariaDisabled: button.getAttribute("aria-disabled"),
      accent: getComputedStyle(button).backgroundColor === accent,
      described,
    };
  }, CONVERT);
}

function focusedId(): Promise<string | null> {
  return browser.execute(() => {
    const active = document.activeElement;
    return active === null || active === document.body ? null : active.id || active.tagName;
  });
}

/** Presses Tab until the start control has focus, from the scope's first radio. */
async function tabToStart(limit = 30): Promise<boolean> {
  await browser.execute(() => document.querySelector<HTMLElement>('input[name="conversion-scope"]:checked')?.focus());
  for (let step = 0; step < limit; step += 1) {
    if (await browser.execute((css: string) => document.activeElement === document.querySelector(css), CONVERT)) return true;
    await browser.keys(["Tab"]);
  }
  return browser.execute((css: string) => document.activeElement === document.querySelector(css), CONVERT);
}

/** Presses a button by its visible name, with the keyboard, the way a keyboard user does. */
async function pressByKeyboard(scope: string, name: string) {
  const found = await browser.execute(
    (css: string, label: string) => {
      const button = [...document.querySelectorAll<HTMLButtonElement>(`${css} button`)].find(
        (candidate) => (candidate.textContent ?? "").trim() === label,
      );
      button?.focus();
      return button !== undefined && document.activeElement === button;
    },
    scope,
    name,
  );
  expect(found).toBe(true);
  await browser.keys(["Enter"]);
}

async function navigate(label: string) {
  const found = await browser.execute((name: string) => {
    const target = [...document.querySelectorAll<HTMLButtonElement>(".workbench-navigation > button")]
      .find((button) => (button.textContent ?? "") === name);
    target?.click();
    return target !== undefined;
  }, label);
  // Project is the header menu's first item, not a tab (rebuild spec 1.1).
  if (!found) {
    await browser.$("[data-project-menu]").click();
    await browser.$('[data-project-menu-item="surface"]').waitForDisplayed();
    await browser.$('[data-project-menu-item="surface"]').click();
  }
  await frames();
}

// ---------------------------------------------------------------- cases

describe("PM9.4 conversion journey, rendered", () => {
  before(() => {
    const root = process.env["MSCANVAS_PM9_OUTPUT_ROOT"] ?? resolve("test-results/pm9.4");
    mkdirSync(root, { recursive: true });
    output = mkdtempSync(join(root, "browser-"));
    console.log(`PM9.4 browser evidence: ${output}`);
  });

  after(async () => {
    evidence.push({ console: await consoleEntries() });
    writeFileSync(join(output, "evidence.json"), JSON.stringify(evidence, null, 2));
  });

  afterEach(async function () {
    evidence.push({ test: this.currentTest?.title, state: this.currentTest?.state, console: await consoleEntries() });
    if (this.currentTest?.state === "failed") {
      await browser.saveScreenshot(join(output, `failure-${String(evidence.length)}.png`));
      evidence.push({ failedDocument: await browser.execute(() => (document.querySelector<HTMLElement>("#workbench-conversion")?.innerText ?? document.body.innerText).slice(0, 8000)) });
    }
    writeFileSync(join(output, "evidence.json"), JSON.stringify(evidence, null, 2));
  });

  it("PM9.4-P1 refuses Convert for a checked mzML row by its reason, as a focusable control that sends nothing (R1, R6)", async () => {
    await metrics(1366, 768);
    await open(world());
    await checkMembers([OPEN.handle]);
    await showConversion();
    await frame("pm94-p1-no-eligible-en-1366x768");

    // R1: the scope says the word the roster's checkbox count says.
    const selectedLabel = await browser.execute(() => (document.querySelector('input[name="conversion-scope"][value="selected"]')?.closest("label")?.textContent ?? "").trim());
    expect(selectedLabel).toBe(word("en", "m74CnvSelected"));
    expect(selectedLabel.toLowerCase()).toContain("checked");
    // And the button counts what it converts: zero eligible, said as eligible.
    const control = await startControl();
    expect(control?.text).toBe(fill(word("en", "m74CnvConvertSelected"), { count: 0 }));
    expect(word("en", "m74CnvConvertSelected")).toContain("eligible");

    // R6: refused, but a Tab stop that gives up the accent and says why.
    expect({ disabled: control?.disabled, ariaDisabled: control?.ariaDisabled, accent: control?.accent }).toEqual({ disabled: false, ariaDisabled: "true", accent: false });
    // The route is composed from the header toggle's and Add files' own labels (PM9.7 F3).
    expect(control?.described).toContain(fill(word("en", "m74CnvNoticeNoConvertibleTarget"), { toggle: word("en", "rosterToggle"), add: word("en", "addFiles") }));
    expect(await tabToStart()).toBe(true);
    await browser.keys(["Enter"]);
    await browser.keys([" "]);
    await browser.$(CONVERT).click();
    await frames();
    expect([await requests("begin_workspace_conversion_queue"), await requests("choose_workspace_conversion_destination")]).toEqual([[], []]);
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("PM9.4-P2 says there is nothing to describe without a usable backend, rather than that it is still finding out (R3)", async () => {
    await metrics(1366, 768);
    await open(world({ backend: "unavailable" }));
    await checkMembers([FIRST.handle]);
    await showConversion();
    await browser.pause(2_500);
    await frame("pm94-p2-no-backend-en-1366x768");

    const pending = await browser.execute(() => (document.querySelector("#conversion-plan-pending")?.textContent ?? "").trim());
    expect(pending).not.toBe(en.m74CnvNoticePlanSettingsUnknown);
    expect(pending).toBe(word("en", "m74CnvPlanNoBackend"));
    const control = await startControl();
    expect(control?.ariaDisabled).toBe("true");
    expect(control?.described).toContain(word("en", "m74CnvNoticeBackendUnavailable"));
    // Asked at most once: a binding with no installation is answered, not reread.
    expect((await requests("read_conversion_configuration")).length).toBeLessThanOrEqual(1);
    expect(await requests("begin_workspace_conversion_queue")).toEqual([]);
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("PM9.4-P3 leads the review to Convert, and a keyboard start sends the reviewed question once (R4, R5, R7, R11)", async () => {
    await metrics(1366, 768);
    await open(world());
    await checkMembers([FIRST.handle, SECOND.handle]);
    await showConversion();
    await waitUntilOffered(CONVERT);
    const review = await frame("pm94-p3-review-en-1366x768");

    // R5: settings, destination and conflict in the form column, then the
    // scope, the reviewed summary and Convert in the summary column.
    const order = await browser.execute((css: string) => {
      const plan = document.querySelector(".conversion-panel");
      const at = (selector: string) => document.querySelector(selector);
      const parts = [
        at(".conversion-settings"),
        at(".conversion-destination"),
        at(".conversion-conflict"),
        at(".conversion-scope"),
        at("#conversion-plan-summary"),
        at(css),
      ];
      const ordered = parts.every((node, index) => node !== null && (index === 0 || (parts[index - 1]!.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0));
      const summary = at("#conversion-plan-summary");
      const between = summary === null ? [] : [...(plan?.querySelectorAll("fieldset") ?? [])].filter((fieldset) => (summary.compareDocumentPosition(fieldset) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
      return { ordered, settingsInPlan: plan?.contains(at(".conversion-settings")) ?? false, fieldsetsAfterSummary: between.length };
    }, CONVERT);
    expect(order).toEqual({ ordered: true, settingsInPlan: true, fieldsetsAfterSummary: 0 });
    // R4: compression in words, like the other axes.
    const compression = await browser.execute((label: string) => {
      const term = [...document.querySelectorAll(".conversion-plan-summary .metadata-list dt")].find((node) => (node.textContent ?? "").trim() === label);
      return (term?.nextElementSibling?.textContent ?? "").trim();
    }, en.m74CnvCompression);
    expect(compression).toBe(en.cnvZlib);
    // R7: one filled primary, and it is Convert.
    expect(review.filled).toEqual([fill(word("en", "m74CnvConvertSelected"), { count: 2 })]);

    await setInvokeResult("get_workspace_conversion_state", slot(1, STARTED));
    await pressByKeyboard(".conversion-panel", fill(word("en", "m74CnvConvertSelected"), { count: 2 }));
    await browser.$(".conversion-running").waitForExist({ timeout: 15_000 });
    await browser.waitUntil(async () => (await requests("choose_workspace_conversion_destination")).length === 1, { timeout: 15_000 });
    await frames();
    const started = await frame("pm94-p3-started-en-1366x768");
    expect(await requests("begin_workspace_conversion_queue")).toEqual([
      {
        request: {
          handles: [FIRST.handle, SECOND.handle],
          intentId: shippedIntent.id,
          conflictPolicy: "fail",
          destinationPolicy: { kind: "customFolder" },
          expectedReceipt: 1,
        },
      },
    ]);
    expect(await requests("choose_workspace_conversion_destination")).toEqual([{ reservationId: "pm94-reservation" }]);
    // R11: the pressed control left with the plan; focus went to the queue's status.
    expect(await focusedId()).toBe("conversion-queue-status");
    // R5: the next conversion's settings are not on screen while this one runs.
    expect(await browser.execute(() => document.querySelector("#workbench-conversion .conversion-settings") !== null)).toBe(false);
    expect(ESTIMATE.test(started.text)).toBe(false);
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("PM9.4-P4 lets the reader leave and return while a queue runs with no new work, then stops it by keyboard (V2, V3, R11)", async () => {
    await metrics(1366, 768);
    await open(world({ slot: slot(1, STARTED) }));
    await showConversion();
    await browser.$(".conversion-running").waitForExist({ timeout: 15_000 });
    const running = await frame("pm94-p4-running-en-1366x768");
    expect(ESTIMATE.test(running.text)).toBe(false);
    // R12 in the running queue too: Stop, Skip and the row disclosures at the
    // compact-control minimum.
    expect(running.small).toEqual([]);
    expect(await browser.execute(() => document.querySelector('#workbench-conversion [role="progressbar"], #workbench-conversion progress') === null)).toBe(true);

    const before = (await ipcCalls()).length;
    await navigate(en.workbench);
    await navigate(en.projectSurface);
    await showConversion();
    const trip = (await ipcCalls()).slice(before);
    evidence.push({ label: "pm94-p4-trip-requests", commands: trip.map((call) => call.command) });
    expect(trip.filter((call) => WORK.includes(call.command)).map((call) => call.command)).toEqual([]);

    await setInvokeResult("stop_workspace_conversion_queue", slot(2, { ...STARTED, status: "stopping" }));
    await setInvokeResult("get_workspace_conversion_state", slot(2, { ...STARTED, status: "stopping" }));
    await pressByKeyboard(".conversion-running", en.m74CnvStopQueue);
    await browser.waitUntil(async () => (await browser.$(".conversion-panel").getText()).includes(en.m74CnvStopping), { timeout: 15_000 });
    await frame("pm94-p4-stopping-en-1366x768");
    expect(await requests("stop_workspace_conversion_queue")).toEqual([{ operationId: OPERATION }]);
    expect(await focusedId()).toBe("conversion-queue-status");
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("PM9.4-P5 names a rerun of the earlier failures while it runs (R10)", async () => {
    await metrics(1366, 768);
    await open(world({ slot: slot(3, RERUN) }));
    await showConversion();
    await browser.$(".conversion-running").waitForExist({ timeout: 15_000 });
    await frame("pm94-p5-rerun-en-1366x768");
    const status = await browser.execute(() => (document.querySelector("#conversion-queue-status")?.textContent ?? "").trim());
    expect(status).toBe(fill(word("en", "m74CnvRerunningItem"), { position: 2, total: 3 }));
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("PM9.4-P6 finishes a mixed queue with one primary, says which failures rerun, and opens, adds and retries by their own commands (R7, R8, R11)", async () => {
    await metrics(1366, 768);
    await open(world({ slot: slot(1, MIXED) }));
    await checkMembers([THIRD.handle]);
    await showConversion();
    await waitUntilOffered(CONVERT);
    const finished = await frame("pm94-p6-mixed-en-1366x768");

    // R7: the outputs are the primary; the next conversion's start is secondary.
    expect(finished.filled).toEqual([en.m74CnvAddOne]);
    // R8: each failed row says whether Retry reruns it, and the scope is visible.
    const markers = await browser.execute(() =>
      [...document.querySelectorAll('li[data-item-state="failed"]')].map((row) => (row.querySelector(".conversion-queue-retry")?.textContent ?? "").trim() || null),
    );
    expect(markers).toEqual([word("en", "m74CnvWillRetry"), word("en", "m74CnvWillNotRetry")]);
    const scope = await browser.execute(() => {
      const node = document.querySelector<HTMLElement>("#conversion-retry-scope");
      return node === null ? null : { text: (node.textContent ?? "").trim(), hidden: node.closest(".visually-hidden") !== null || node.getBoundingClientRect().height < 2 };
    });
    expect(scope).toEqual({ text: en.m74CnvRetryScope, hidden: false });

    // Open file: the row's own ticket, and nothing else.
    await browser.execute(() => {
      [...document.querySelectorAll<HTMLButtonElement>('li[data-item-state="finalized"] .output-open-actions button')][0]?.click();
    });
    await browser.waitUntil(async () => (await requests("open_finalized_output")).length === 1, { timeout: 15_000 });
    expect(await requests("open_finalized_output")).toEqual([{ outputId: FIRST_OUTPUT.outputId, action: "file" }]);
    // Add: the queue's own operation.
    await pressByKeyboard(CONVERSION_SURFACE, en.m74CnvAddOne);
    await browser.waitUntil(async () => (await requests("adopt_workspace_conversion_outputs")).length === 1, { timeout: 15_000 });
    expect(await requests("adopt_workspace_conversion_outputs")).toEqual([{ operationId: OPERATION }]);
    await browser.waitUntil(async () => (await browser.$(".conversion-adoption-summary").getText()) !== "", { timeout: 15_000 });
    await frame("pm94-p6-added-en-1366x768");

    // Retry, by keyboard: the slot's own terminal queue, no arguments.
    const rerun = slot(2, RERUN);
    await setInvokeResult("retry_workspace_conversion_queue", rerun);
    await setInvokeResult("get_workspace_conversion_state", rerun);
    await pressByKeyboard(CONVERSION_SURFACE, fill(en.m74CnvRetry, { count: 1 }));
    await browser.waitUntil(async () => (await requests("retry_workspace_conversion_queue")).length === 1, { timeout: 15_000 });
    await browser.waitUntil(async () => (await browser.$("#conversion-queue-status").isExisting()), { timeout: 15_000 });
    await frame("pm94-p6-retrying-en-1366x768");
    expect(await requests("retry_workspace_conversion_queue")).toEqual([{}]);
    expect(await focusedId()).toBe("conversion-queue-status");
    expect(await requests("begin_workspace_conversion_queue")).toEqual([]);
    expect(await unexpectedConsole()).toEqual([]);
  });

  it("PM9.4-P7 tells a stopped queue's reader how to convert what did not finish, and keeps its outputs (R9)", async () => {
    await metrics(1366, 768);
    await open(world({ slot: slot(1, STOPPED) }));
    await showConversion();
    await browser.$('li[data-item-state="notRun"]').waitForExist({ timeout: 15_000 });
    await frame("pm94-p7-stopped-en-1366x768");
    const again = await browser.execute(() => (document.querySelector(".conversion-convert-again")?.textContent ?? "").trim());
    expect(again).toBe(word("en", "m74CnvConvertAgain"));
    expect(await browser.execute((prefix: string) =>
      [...document.querySelectorAll("#workbench-conversion button")].some((button) => (button.textContent ?? "").trim().startsWith(prefix)),
    en.m74CnvRetry.split("{{")[0]!)).toBe(false);
    expect(await isRefused(`${CONVERSION_SURFACE} .conversion-adoption button`)).toBe(false);
    expect(await unexpectedConsole()).toEqual([]);
  });

  for (const locale of ["en", "zh-CN"] as const) {
    it(`PM9.4-P8 the review and a finished mixed queue at the anchors in ${locale} (R12)`, async () => {
      const anchors = [
        [1920, 1080],
        [1366, 768],
        [960, 640],
      ] as const;
      const judged = [];

      // The review.
      await metrics(1920, 1080);
      await open(world({ locale }));
      await checkMembers([FIRST.handle, SECOND.handle]);
      await showConversion();
      await waitUntilOffered(CONVERT);
      for (const [width, height] of anchors) {
        await metrics(width, height);
        await showConversion();
        const seen = await frame(`pm94-p8-review-${locale}-${String(width)}x${String(height)}`);
        judged.push({ label: `review ${String(width)}x${String(height)}`, lang: seen.lang, overflow: seen.horizontalOverflow, estimate: ESTIMATE.test(seen.text), filled: seen.filled.length, small: seen.small });
        if (width === 960) {
          // A real wheel inside the surface's own scroll, then the keyboard.
          await browser.execute((css: string) => { document.querySelector<HTMLElement>(css)!.scrollTop = 0; }, CONVERSION_SURFACE);
          const point = await browser.execute((css: string) => {
            const box = document.querySelector(css)!.getBoundingClientRect();
            return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + Math.min(box.height / 2, 200)) };
          }, CONVERSION_SURFACE);
          let reached = false;
          for (let step = 0; step < 16 && !reached; step += 1) {
            await cdp("Input.dispatchMouseEvent", { type: "mouseWheel", x: point.x, y: point.y, deltaX: 0, deltaY: 240 });
            await frames();
            reached = await browser.execute((css: string) => {
              const box = document.querySelector(css)?.getBoundingClientRect();
              return box !== undefined && box.top >= 0 && box.bottom <= innerHeight;
            }, CONVERT);
          }
          await frame(`pm94-p8-review-${locale}-960x640-wheeled-to-convert`);
          const tabbed = await tabToStart();
          const onScreen = await browser.execute((css: string) => {
            const box = document.querySelector(css)!.getBoundingClientRect();
            return box.top >= 0 && box.bottom <= innerHeight;
          }, CONVERT);
          evidence.push({ label: `pm94-p8-${locale}-960x640-reach`, wheel: reached, tab: tabbed, focusedOnScreen: onScreen });
          expect({ wheel: reached, tab: tabbed, focusedOnScreen: onScreen }).toEqual({ wheel: true, tab: true, focusedOnScreen: true });
        }
      }
      if (locale === "en") {
        for (const [width, height] of [
          [1280, 720],
          [1536, 864],
          [2560, 1440],
        ] as const) {
          await metrics(width, height);
          await showConversion();
          const seen = await frame(`pm94-p8-review-en-${String(width)}x${String(height)}`);
          judged.push({ label: `review ${String(width)}x${String(height)}`, lang: seen.lang, overflow: seen.horizontalOverflow, estimate: ESTIMATE.test(seen.text), filled: seen.filled.length, small: seen.small });
        }
      }

      // A finished mixed queue with the next conversion below it.
      await metrics(1920, 1080);
      await open(world({ locale, slot: slot(1, MIXED) }));
      await checkMembers([THIRD.handle]);
      await showConversion();
      await waitUntilOffered(CONVERT);
      for (const [width, height] of anchors) {
        await metrics(width, height);
        await showConversion();
        const seen = await frame(`pm94-p8-mixed-${locale}-${String(width)}x${String(height)}`);
        judged.push({ label: `mixed ${String(width)}x${String(height)}`, lang: seen.lang, overflow: seen.horizontalOverflow, estimate: ESTIMATE.test(seen.text), filled: seen.filled.length, small: seen.small });
      }
      evidence.push({ label: `pm94-p8-${locale}-judged`, judged });

      // Rendered in the reader's language, inside the window, with no
      // estimate, one filled primary and every control at the compact minimum.
      expect(judged.filter((each) => each.lang !== locale || each.overflow > 1 || each.estimate || each.filled !== 1 || each.small.length > 0)).toEqual([]);
      expect(await unexpectedConsole()).toEqual([]);
    });
  }
});
